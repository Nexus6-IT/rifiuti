import { PRODOTTI_CONOU, ProdottoConou } from './conou/prodotti-per-cer'
import { percentualeOlioValida } from './dati-tracciato'
import {
  CER_SEI_CIFRE,
  EsitoValidazione,
  Oggetto,
  booleanoOpz,
  eOggetto,
  enumOpz,
  oggettoOpz,
  rifiutaSconosciuti,
  senzaUndefined,
  stringaOpz,
} from './validazione'

/**
 * Configurazione delle comunicazioni per sede propria e consorzio (tabella
 * `configurazione_comunicazione_sede`, D4). Ogni consorzio ha il suo schema `strict`; i valori
 * mancanti si completano con i predefiniti.
 */

export type ConsorzioConfigurabile = 'CONOU' | 'COBAT' | 'ORSO' | 'ORR'
export const CONSORZI_CONFIGURABILI: readonly ConsorzioConfigurabile[] = [
  'CONOU',
  'COBAT',
  'ORSO',
  'ORR',
]
export const VERSIONE_SCHEMA_CONFIGURAZIONE = 1

export const TIPI_IMPIANTO_ORR = ['STO', 'SMA', 'REC', 'R/S', 'AUT', 'ROT', 'FRA'] as const
export type TipoImpiantoOrr = (typeof TIPI_IMPIANTO_ORR)[number]

export interface ConfigurazioneConou {
  /** Codice deposito, 3-10 caratteri (campo 11 del tracciato). */
  codiceDeposito?: string
  /** CER (6 cifre) → prodotto e percentuale predefiniti. */
  predefinitiPerCer: Record<string, { prodotto: ProdottoConou; percentualeOlio?: number }>
}
export interface ConfigurazioneCobat {
  campagnaPredefinita: { codice: string; descrizione: string }
  /** CER (6 cifre) → PGF/tipologia `A..E`. */
  pgfPerCer: Record<string, 'A' | 'B' | 'C' | 'D' | 'E'>
}
export interface ConfigurazioneOrso {
  modalita: 'NORMALE' | 'DETTAGLIATA'
}
export interface ConfigurazioneOrr {
  tipoImpianto?: TipoImpiantoOrr
  autorizzazioneImpiantoId?: string
  /** L'`atec00` di WinWaste: ATECO del produttore mancante scritto come zeri. */
  atecoProduttoreMancanteComeZero: boolean
  /** Il `sino` di WinWaste: usa le autorizzazioni predefinite. */
  usaAutorizzazioniPredefinite: boolean
}

export type ConfigurazionePerConsorzio = {
  CONOU: ConfigurazioneConou
  COBAT: ConfigurazioneCobat
  ORSO: ConfigurazioneOrso
  ORR: ConfigurazioneOrr
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Configurazione di partenza quando la sede non ne ha una salvata. */
export function configurazionePredefinita<C extends ConsorzioConfigurabile>(
  consorzio: C
): ConfigurazionePerConsorzio[C] {
  const p: ConfigurazionePerConsorzio = {
    CONOU: { predefinitiPerCer: {} },
    // INFERENZA (WinWaste, 14/11): campagna `00` senza descrizione se la sede non ne indica una.
    COBAT: { campagnaPredefinita: { codice: '00', descrizione: '' }, pgfPerCer: {} },
    ORSO: { modalita: 'NORMALE' },
    ORR: { atecoProduttoreMancanteComeZero: false, usaAutorizzazioniPredefinite: false },
  }
  return structuredClone(p[consorzio]) as ConfigurazionePerConsorzio[C]
}

function mappaPerCer<V>(
  o: Oggetto,
  k: string,
  errori: string[],
  valida: (voce: unknown, percorso: string, errori: string[]) => V | undefined
): Record<string, V> {
  const m = oggettoOpz(o, k, '', errori)
  const risultato: Record<string, V> = {}
  if (!m) return risultato
  for (const [cer, voce] of Object.entries(m)) {
    const percorso = `${k}.${cer}`
    if (!CER_SEI_CIFRE.test(cer)) {
      errori.push(`${percorso}: il CER deve avere 6 cifre`)
      continue
    }
    const v = valida(voce, percorso, errori)
    if (v !== undefined) risultato[cer] = v
  }
  return risultato
}

function validaConou(o: Oggetto, errori: string[]): ConfigurazioneConou {
  rifiutaSconosciuti(o, ['codiceDeposito', 'predefinitiPerCer'], '', errori)
  const codiceDeposito = stringaOpz(
    o,
    'codiceDeposito',
    '',
    errori,
    s => /^[A-Za-z0-9]{3,10}$/.test(s),
    'da 3 a 10 caratteri alfanumerici'
  )
  const predefinitiPerCer = mappaPerCer(o, 'predefinitiPerCer', errori, (voce, percorso, errs) => {
    if (!eOggetto(voce)) {
      errs.push(`${percorso}: deve essere un oggetto`)
      return undefined
    }
    rifiutaSconosciuti(voce, ['prodotto', 'percentualeOlio'], `${percorso}.`, errs)
    const prodotto = enumOpz(voce, 'prodotto', `${percorso}.`, errs, PRODOTTI_CONOU)
    if (voce.prodotto === undefined) errs.push(`${percorso}.prodotto: obbligatorio`)
    let percentualeOlio: number | undefined
    if (voce.percentualeOlio !== undefined) {
      if (typeof voce.percentualeOlio === 'number' && percentualeOlioValida(voce.percentualeOlio)) {
        percentualeOlio = voce.percentualeOlio
      } else
        errs.push(
          `${percorso}.percentualeOlio: numero maggiore di 0 e al massimo 99.99, con due decimali`
        )
    }
    return prodotto === undefined ? undefined : senzaUndefined({ prodotto, percentualeOlio })
  })
  return senzaUndefined({ codiceDeposito, predefinitiPerCer })
}

function validaCobat(o: Oggetto, errori: string[]): ConfigurazioneCobat {
  rifiutaSconosciuti(o, ['campagnaPredefinita', 'pgfPerCer'], '', errori)
  const base = configurazionePredefinita('COBAT')
  let campagnaPredefinita = base.campagnaPredefinita
  const c = oggettoOpz(o, 'campagnaPredefinita', '', errori)
  if (c) {
    rifiutaSconosciuti(c, ['codice', 'descrizione'], 'campagnaPredefinita.', errori)
    const codice = stringaOpz(
      c,
      'codice',
      'campagnaPredefinita.',
      errori,
      s => /^[A-Za-z0-9]{2}$/.test(s),
      'esattamente 2 caratteri alfanumerici'
    )
    const descrizione = stringaOpz(
      c,
      'descrizione',
      'campagnaPredefinita.',
      errori,
      s => s.length <= 30,
      'al massimo 30 caratteri'
    )
    if (c.codice === undefined) errori.push('campagnaPredefinita.codice: obbligatorio')
    if (codice !== undefined) campagnaPredefinita = { codice, descrizione: descrizione ?? '' }
  }
  const pgfPerCer = mappaPerCer(o, 'pgfPerCer', errori, (voce, percorso, errs) => {
    if (typeof voce === 'string' && ['A', 'B', 'C', 'D', 'E'].includes(voce))
      return voce as 'A' | 'B' | 'C' | 'D' | 'E'
    errs.push(`${percorso}: uno tra A, B, C, D, E`)
    return undefined
  })
  return { campagnaPredefinita, pgfPerCer }
}

function validaOrso(o: Oggetto, errori: string[]): ConfigurazioneOrso {
  rifiutaSconosciuti(o, ['modalita'], '', errori)
  const modalita = enumOpz(o, 'modalita', '', errori, ['NORMALE', 'DETTAGLIATA'] as const)
  return { modalita: modalita ?? 'NORMALE' }
}

function validaOrr(o: Oggetto, errori: string[]): ConfigurazioneOrr {
  rifiutaSconosciuti(
    o,
    [
      'tipoImpianto',
      'autorizzazioneImpiantoId',
      'atecoProduttoreMancanteComeZero',
      'usaAutorizzazioniPredefinite',
    ],
    '',
    errori
  )
  const tipoImpianto = enumOpz(o, 'tipoImpianto', '', errori, TIPI_IMPIANTO_ORR)
  const autorizzazioneImpiantoId = stringaOpz(
    o,
    'autorizzazioneImpiantoId',
    '',
    errori,
    s => UUID.test(s),
    "identificativo (uuid) di un'autorizzazione"
  )
  const atecoZero = booleanoOpz(o, 'atecoProduttoreMancanteComeZero', '', errori)
  const sino = booleanoOpz(o, 'usaAutorizzazioniPredefinite', '', errori)
  return senzaUndefined({
    tipoImpianto,
    autorizzazioneImpiantoId,
    atecoProduttoreMancanteComeZero: atecoZero ?? false,
    usaAutorizzazioniPredefinite: sino ?? false,
  })
}

/** Valida una configurazione e la completa con i predefiniti. */
export function validaConfigurazione<C extends ConsorzioConfigurabile>(
  consorzio: C,
  dati: unknown
): EsitoValidazione<ConfigurazionePerConsorzio[C]> {
  if (!eOggetto(dati)) return { ok: false, errori: ['la configurazione deve essere un oggetto'] }
  const errori: string[] = []
  let valore: unknown
  switch (consorzio) {
    case 'CONOU':
      valore = validaConou(dati, errori)
      break
    case 'COBAT':
      valore = validaCobat(dati, errori)
      break
    case 'ORSO':
      valore = validaOrso(dati, errori)
      break
    case 'ORR':
      valore = validaOrr(dati, errori)
      break
    default:
      return { ok: false, errori: [`consorzio sconosciuto: ${String(consorzio)}`] }
  }
  return errori.length > 0
    ? { ok: false, errori }
    : { ok: true, valore: valore as ConfigurazionePerConsorzio[C] }
}
