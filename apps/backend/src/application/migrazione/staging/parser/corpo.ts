import { decodificaC4 } from '../../../../domain/migrazione/winwaste/c4'
import { decodificaCer } from '../../../../domain/migrazione/winwaste/cer'
import { chiaveLegacyWinwaste } from '../../../../domain/migrazione/winwaste/chiave-legacy'
import {
  confrontaConDtuk,
  decodificaDatr,
} from '../../../../domain/migrazione/winwaste/data-registrazione'
import { decodificaDtuk } from '../../../../domain/migrazione/winwaste/dtuk'
import { decodificaNumeroIt } from '../../../../domain/migrazione/winwaste/numero-it'
import { decodificaOper } from '../../../../domain/migrazione/winwaste/oper'
import { decodificaQuantita } from '../../../../domain/migrazione/winwaste/quantita'
import { RecordCorpoComune } from '../../../../domain/migrazione/winwaste/record'
import { decodificaRelaz } from '../../../../domain/migrazione/winwaste/relaz'
import { decodificaSoggetto } from '../../../../domain/migrazione/winwaste/soggetto'
import { RigaGrezza } from '../lettore-staging'
import { Anomalia, ContestoParser, raccogliGrezzo } from './scarti'

/**
 * Decodifica delle 86 colonne posizionali comuni a `MOVIMENTI` e `FORMULARI`
 * (`docs/movimenti.md` §2.2, `docs/formulari.md` §2.1: le due tabelle hanno le
 * stesse colonne). Le parti specifiche di ciascuna tabella stanno nei rispettivi
 * parser.
 */

/** Colonne senza le quali il parser non puo' decodificare nulla in modo sensato. */
export const COLONNE_CORPO_RICHIESTE: readonly string[] = [
  'COD',
  'CAUS',
  'OPER',
  'DTUK',
  'CER',
  'TIPOL',
  'NETTO',
  'VOLU',
  'UM',
  'RELAZ',
  'MAG1',
]

/** Colonne lette dal corpo comune (le altre vanno nel `grezzo`). */
export const COLONNE_CORPO_MAPPATE: readonly string[] = [
  'COD',
  'CAUS',
  'OPER',
  'POSI',
  'DATR',
  'DTUK',
  'CLIE',
  'CONT',
  'PROD',
  'MAG1',
  'TRAS',
  'SMAL',
  'MAG2',
  'MODA',
  'INTE',
  'CER',
  'TIPOL',
  'FISI',
  'LORDO',
  'TARA',
  'NETTO',
  'VOLU',
  'UM',
  'C4',
  'RELAZ',
]

export type CorpoDecodificato = Omit<RecordCorpoComune, 'avvisi' | 'grezzo'> & {
  readonly grezzoCorpo: Record<string, string>
}

export type EsitoCorpo =
  | { readonly corpo: CorpoDecodificato; readonly avvisi: Anomalia[] }
  | { readonly cod: string; readonly scarto: Anomalia; readonly avvisi: Anomalia[] }

const v = (riga: RigaGrezza, nome: string): string | null => riga.campi[nome] ?? null
const t = (riga: RigaGrezza, nome: string): string => (riga.campi[nome] ?? '').trim()

export function decodificaCorpo(
  riga: RigaGrezza,
  contesto: ContestoParser,
  tabella: 'MOVIMENTI' | 'FORMULARI',
  mappateExtra: ReadonlySet<string>
): EsitoCorpo {
  const avvisi: Anomalia[] = []
  const codTesto = t(riga, 'COD')
  if (!/^\d+$/.test(codTesto) || Number(codTesto) < 1) {
    return {
      cod: '',
      scarto: { codice: 'COD_NON_VALIDO', dettaglio: 'COD: atteso intero positivo' },
      avvisi,
    }
  }
  const cod = Number(codTesto)
  const fallisce = (a: Anomalia): EsitoCorpo => ({
    cod: String(cod),
    scarto: { codice: a.codice, dettaglio: a.dettaglio },
    avvisi,
  })

  const dtuk = decodificaDtuk(v(riga, 'DTUK'), contesto.anno)
  if (!dtuk.ok) return fallisce(dtuk)
  const oper = decodificaOper(v(riga, 'OPER'))
  if (!oper.ok) return fallisce(oper)
  const quantita = decodificaQuantita({
    netto: v(riga, 'NETTO'),
    volu: v(riga, 'VOLU'),
    um: v(riga, 'UM'),
  })
  if (!quantita.ok) return fallisce(quantita)
  const cer = decodificaCer(v(riga, 'CER'), v(riga, 'TIPOL'))
  if (!cer.ok) return fallisce(cer)
  // In MOVIMENTI RELAZ e' la relazione di carico/scarico: un valore illeggibile e' uno scarto.
  // In FORMULARI, sul database modello, contiene testo libero (note) imbottito con Chr(255):
  // non e' una relazione, quindi resta nel `grezzo` con un avviso e non scarta il FIR.
  const relaz = decodificaRelaz(v(riga, 'RELAZ'))
  if (!relaz.ok && tabella === 'MOVIMENTI') return fallisce(relaz)
  if (!relaz.ok) {
    avvisi.push({
      codice: 'RELAZ_NON_DECODIFICABILE',
      dettaglio:
        'RELAZ: non e una relazione di carico/scarico (testo libero?), conservata nel grezzo',
    })
  }

  const datr = decodificaDatr(v(riga, 'DATR'), contesto.anno)
  if (!datr.ok) avvisi.push({ codice: datr.codice, dettaglio: datr.dettaglio })
  const dataRegistrazione = datr.ok ? datr.valore : null
  if (dataRegistrazione !== null && !confrontaConDtuk(dataRegistrazione, dtuk.valore)) {
    avvisi.push({ codice: 'DATR_DTUK_DIVERSE', dettaglio: 'DATR e DTUK indicano date diverse' })
  }

  const soggetto = (nome: string) => {
    const r = decodificaSoggetto(v(riga, nome))
    if (!r.ok) {
      avvisi.push({ codice: r.codice, dettaglio: `${nome}: ${r.dettaglio}` })
      return null
    }
    return r.valore.soggetto
  }
  const produttore = soggetto('PROD')
  const trasportatore = soggetto('TRAS')
  const destinatario = soggetto('SMAL')
  const intermediario = soggetto('INTE')

  const peso = (nome: string): number | null => {
    const r = decodificaNumeroIt(v(riga, nome))
    if (!r.ok) {
      avvisi.push({ codice: `${nome}_NON_VALIDO`, dettaglio: `${nome}: numero non valido` })
      return null
    }
    return r.valore
  }
  const lordoKg = peso('LORDO')
  const taraKg = peso('TARA')

  const c4 = decodificaC4(v(riga, 'C4'))
  if (!c4.ok) avvisi.push({ codice: c4.codice, dettaglio: c4.dettaglio })

  if (oper.valore.tipo !== 'SOLO_FATTURAZIONE' && cer.valore === null) {
    avvisi.push({ codice: 'CER_ASSENTE', dettaglio: 'CER: assente in un movimento di rifiuti' })
  }

  const mappate = new Set([...COLONNE_CORPO_MAPPATE, ...mappateExtra])
  // RELAZ non decodificata: il testo originale non si perde.
  if (!relaz.ok) mappate.delete('RELAZ')
  return {
    avvisi,
    corpo: {
      cod,
      riga: riga.numeroRiga,
      legacyKey: chiaveLegacyWinwaste(contesto.ditta, contesto.anno, tabella, cod),
      annullato: dtuk.valore.annullato,
      causaAnnullo: dtuk.valore.annullato ? dtuk.valore.causa : null,
      data: dtuk.valore.data,
      causale: t(riga, 'CAUS'),
      oper: oper.valore,
      posizione: t(riga, 'POSI'),
      dataRegistrazione,
      cliente: t(riga, 'CLIE'),
      contratto: t(riga, 'CONT'),
      produttore,
      trasportatore,
      destinatario,
      intermediario,
      mag1: t(riga, 'MAG1'),
      mag2: t(riga, 'MAG2'),
      moda: t(riga, 'MODA'),
      cer: cer.valore,
      tipologia: t(riga, 'TIPOL'),
      statoFisico: t(riga, 'FISI'),
      nettoKg: quantita.valore.nettoKg,
      volumeM3: quantita.valore.volumeM3,
      lordoKg,
      taraKg,
      c4: c4.ok ? c4.valore : null,
      relaz: relaz.ok ? relaz.valore : [],
      grezzoCorpo: raccogliGrezzo(riga.campi, mappate),
    },
  }
}
