import { AvvisoStaging } from '../staging/lettore-staging'
import { Segnalazione } from '../staging/parser/scarti'

/**
 * Rapporto sorgente: il lato WinWaste dei confronti di riconciliazione
 * (rapporto 04 §4.5). Deterministico (nessun orario di generazione: la data e'
 * quella dell'estrazione), senza valori personali (solo codici, conteggi e
 * totali). Il lato destinazione (WasteFlow) e il confronto vero e proprio sono
 * di 3.6.
 */
export const FORMATO_RAPPORTO = 'winwaste-rapporto-sorgente/1'

export interface SintesiTabella {
  readonly tabella: string
  readonly presente: boolean
  readonly righeDichiarate: number
  readonly righeLette: number
  readonly record: number
  readonly scartate: number
  readonly conAvvisi: number
}

export interface ConteggioCodice {
  readonly tabella: string
  readonly codice: string
  readonly conteggio: number
}

export interface Confronto1 {
  readonly perTabella: readonly SintesiTabella[]
  readonly movimentiPerCausale: readonly { causale: string; attivi: number; annullati: number }[]
  readonly movimentiPerOper: readonly {
    oper: string
    tipo: string
    dedotta: boolean
    attivi: number
    annullati: number
  }[]
  readonly formulariPerStato: readonly { stato: string; conteggio: number }[]
}

export interface RigaTotale {
  readonly anno: number | null
  readonly cer: string
  readonly tipo: string
  readonly movimenti: number
  readonly kgnum: number
  readonly mcnum: number
  /** Movimenti attivi senza `KGNUM` leggibile (non entrano nella somma dei kg). */
  readonly senzaKgnum: number
}

export interface DifferenzaCarico {
  readonly cod: number
  readonly cer: string
  readonly kgnum: number
  readonly giascar: number
  /** Somma dei segmenti `C` di `RELAZ` che citano il carico. */
  readonly scaricatoDaRelaz: number
  /** `giascar - scaricatoDaRelaz`. */
  readonly differenza: number
}

export interface GiacenzaAlTaglio {
  readonly cer: string
  readonly classe: string
  readonly posizione: string
  readonly magazzino: string
  readonly carichi: number
  readonly residuoDaRelaz: number
  readonly residuoDaGiascar: number
  readonly differenza: number
}

export interface Confronto3 {
  readonly carichiEsaminati: number
  readonly sogliaKg: number
  readonly differenze: readonly DifferenzaCarico[]
  readonly carichiCitatiInesistenti: readonly { cod: number; kg: number }[]
  /** Kg scaricati da giacenze iniziali, per riga `G0`..`G5`. */
  readonly scaricatoDaGiacenzeIniziali: Readonly<Record<string, number>>
  /** Kg scaricati da carichi dell'anno precedente (segmenti `P`). */
  readonly scaricatoDaAnnoPrecedente: number
  readonly giacenzaAlTaglio: readonly GiacenzaAlTaglio[]
}

export interface GruppoProtocolli {
  readonly registro: string
  readonly anno: number
  readonly conteggio: number
  readonly primo: number
  readonly ultimo: number
  readonly buchi: readonly number[]
  readonly buchiTotali: number
  readonly duplicati: readonly number[]
  /** Ultimo protocollo stampato dalla tabella dei registri (`PRT`), se presente. */
  readonly ultimoStampato: number | null
}

export interface Confronto4 {
  readonly registri: readonly GruppoProtocolli[]
  readonly firPerSerie: readonly {
    serie: string
    anno2: string
    conteggio: number
    primo: number
    ultimo: number
  }[]
}

export interface Confronto5 {
  readonly versis:
    | { presente: false }
    | {
        presente: true
        righe: number
        perPrefisso: Readonly<Record<string, number>>
        righeSensibili: number
      }
  readonly renRegistrazioni:
    | { presente: false; nota: string }
    | {
        presente: true
        righe: number
        inviate: number
        conIdRentri: number
        inviateSenzaIdRentri: number
        movimentiRiferitiInesistenti: number
      }
}

export interface RapportoSorgente {
  readonly formato: typeof FORMATO_RAPPORTO
  readonly archivio: string
  readonly ditta: string
  readonly anno: number
  readonly estrattoIl: string
  /** SHA-256 del manifest (finira' in `lotti_import.hash_staging`). */
  readonly hashManifest: string
  readonly avvisiStaging: readonly AvvisoStaging[]
  readonly scartiPerCodice: readonly ConteggioCodice[]
  readonly avvisiPerCodice: readonly ConteggioCodice[]
  readonly scarti: readonly Segnalazione[]
  readonly scartiTroncati: boolean
  readonly confronto1: Confronto1
  readonly confronto2: { readonly righe: readonly RigaTotale[] }
  readonly confronto3: Confronto3
  readonly confronto4: Confronto4
  readonly confronto5: Confronto5
  /** Corrispondenze `OPER` dedotte con confidenza media, con quanti movimenti toccano. */
  readonly corrispondenzeDedotte: readonly { oper: string; movimenti: number }[]
}

// --- Markdown -----------------------------------------------------------------

function tabella(intestazioni: string[], righe: (string | number)[][]): string {
  if (righe.length === 0) return '_nessuna riga_\n'
  const riga = (c: (string | number)[]) => `| ${c.join(' | ')} |`
  return [riga(intestazioni), riga(intestazioni.map(() => '---')), ...righe.map(riga), ''].join(
    '\n'
  )
}

const n = (x: number): string => x.toLocaleString('it-IT', { maximumFractionDigits: 3 })

export function rapportoInMarkdown(r: RapportoSorgente): string {
  const out: string[] = []
  out.push(`# Rapporto sorgente ${r.archivio}`, '')
  out.push(
    `Ditta ${r.ditta}, anno ${r.anno}. Estratto il ${r.estrattoIl}. Impronta del manifest \`${r.hashManifest}\`.`,
    '',
    'Questo e il lato WinWaste dei confronti di riconciliazione (rapporto 04 §4.5): non contiene valori personali.',
    ''
  )

  out.push('## Avvisi dello staging', '')
  out.push(
    tabella(
      ['Codice', 'Tabella', 'Colonna'],
      r.avvisiStaging.map(a => [a.codice, a.tabella, a.colonna ?? ''])
    )
  )

  out.push('## Scarti e avvisi per codice', '')
  out.push('Scarti (righe NON importabili):', '')
  out.push(
    tabella(
      ['Tabella', 'Codice', 'Righe'],
      r.scartiPerCodice.map(c => [c.tabella, c.codice, c.conteggio])
    )
  )
  out.push('Avvisi (righe tenute con anomalia):', '')
  out.push(
    tabella(
      ['Tabella', 'Codice', 'Righe'],
      r.avvisiPerCodice.map(c => [c.tabella, c.codice, c.conteggio])
    )
  )
  out.push(`Elenco degli scarti (${r.scarti.length}${r.scartiTroncati ? ', troncato' : ''}):`, '')
  out.push(
    tabella(
      ['Tabella', 'COD', 'Riga', 'Codice', 'Dettaglio'],
      r.scarti.map(s => [s.tabella, s.cod, s.riga, s.codice, s.dettaglio])
    )
  )

  const c1 = r.confronto1
  out.push('## Confronto 1: conteggi', '')
  out.push(
    tabella(
      [
        'Tabella',
        'Presente',
        'Righe dichiarate',
        'Righe lette',
        'Record',
        'Scartate',
        'Con avvisi',
      ],
      c1.perTabella.map(t => [
        t.tabella,
        t.presente ? 'si' : 'no',
        t.righeDichiarate,
        t.righeLette,
        t.record,
        t.scartate,
        t.conAvvisi,
      ])
    )
  )
  out.push('Movimenti per causale:', '')
  out.push(
    tabella(
      ['Causale', 'Attivi', 'Annullati'],
      c1.movimentiPerCausale.map(c => [c.causale, c.attivi, c.annullati])
    )
  )
  out.push('Movimenti per OPER:', '')
  out.push(
    tabella(
      ['OPER', 'Tipo', 'Dedotta', 'Attivi', 'Annullati'],
      c1.movimentiPerOper.map(c => [c.oper, c.tipo, c.dedotta ? 'si' : 'no', c.attivi, c.annullati])
    )
  )
  out.push('Formulari per stato:', '')
  out.push(
    tabella(
      ['Stato', 'Formulari'],
      c1.formulariPerStato.map(c => [c.stato, c.conteggio])
    )
  )

  out.push('## Confronto 2: totali per CER, anno e tipo', '')
  out.push(
    'Solo movimenti attivi. Kg (`KGNUM`) e m3 (`MCNUM`) sono somme separate: mai sommati fra loro.',
    ''
  )
  out.push(
    tabella(
      ['Anno', 'CER', 'Tipo', 'Movimenti', 'Kg', 'm3', 'Senza KGNUM'],
      r.confronto2.righe.map(t => [
        t.anno ?? '-',
        t.cer,
        t.tipo,
        t.movimenti,
        n(t.kgnum),
        n(t.mcnum),
        t.senzaKgnum,
      ])
    )
  )

  const c3 = r.confronto3
  out.push('## Confronto 3: giacenza', '')
  out.push(
    `Carichi esaminati: ${c3.carichiEsaminati}. Per ogni carico si confronta \`GIASCAR\` con la somma dei segmenti \`C\` di \`RELAZ\` che lo citano (soglia ${n(c3.sogliaKg)} kg).`,
    ''
  )
  out.push('Carichi con differenza:', '')
  out.push(
    tabella(
      ['COD', 'CER', 'KGNUM', 'GIASCAR', 'Da RELAZ', 'Differenza'],
      c3.differenze.map(d => [
        d.cod,
        d.cer,
        n(d.kgnum),
        n(d.giascar),
        n(d.scaricatoDaRelaz),
        n(d.differenza),
      ])
    )
  )
  out.push('Carichi citati da una `RELAZ` ma non presenti fra i carichi attivi:', '')
  out.push(
    tabella(
      ['COD', 'Kg'],
      c3.carichiCitatiInesistenti.map(c => [c.cod, n(c.kg)])
    )
  )
  out.push(
    'Scaricato da giacenze iniziali (kg per riga):',
    '',
    tabella(
      ['Riga', 'Kg'],
      Object.entries(c3.scaricatoDaGiacenzeIniziali).map(([k, v]) => [k, n(v)])
    )
  )
  out.push(
    `Scaricato da carichi dell'anno precedente (segmenti P): ${n(c3.scaricatoDaAnnoPrecedente)} kg.`,
    ''
  )
  out.push('Giacenza al taglio (carichi attivi):', '')
  out.push(
    tabella(
      [
        'CER',
        'Classe',
        'Posizione',
        'Magazzino',
        'Carichi',
        'Residuo da RELAZ',
        'Residuo da GIASCAR',
        'Differenza',
      ],
      c3.giacenzaAlTaglio.map(g => [
        g.cer,
        g.classe,
        g.posizione,
        g.magazzino,
        g.carichi,
        n(g.residuoDaRelaz),
        n(g.residuoDaGiascar),
        n(g.differenza),
      ])
    )
  )

  out.push('## Confronto 4: numerazione', '')
  out.push(
    'Protocolli per registro e anno (movimenti attivi e annullati). I protocolli di righe scartate non sono visibili qui e possono comparire come buchi.',
    ''
  )
  out.push(
    tabella(
      [
        'Registro',
        'Anno',
        'Protocolli',
        'Primo',
        'Ultimo',
        'Buchi',
        'Duplicati',
        'Ultimo stampato',
      ],
      r.confronto4.registri.map(g => [
        g.registro,
        g.anno,
        g.conteggio,
        g.primo,
        g.ultimo,
        g.buchiTotali === 0
          ? '-'
          : `${g.buchiTotali}: ${g.buchi.join(', ')}${g.buchiTotali > g.buchi.length ? ', ...' : ''}`,
        g.duplicati.length === 0 ? '-' : g.duplicati.join(', '),
        g.ultimoStampato ?? '-',
      ])
    )
  )
  out.push('Numeri fiscali dei FIR per serie:', '')
  out.push(
    tabella(
      ['Serie', 'Anno', 'FIR', 'Primo', 'Ultimo'],
      r.confronto4.firPerSerie.map(f => [f.serie || '-', f.anno2, f.conteggio, f.primo, f.ultimo])
    )
  )

  out.push('## Confronto 5: RENTRI', '')
  const v = r.confronto5.versis
  out.push(
    v.presente
      ? `VERSIS: ${v.righe} righe (${
          Object.entries(v.perPrefisso)
            .map(([k, c]) => `${k}: ${c}`)
            .join(', ') || 'nessuna'
        }), di cui ${v.righeSensibili} con segreti non letti.`
      : 'VERSIS: assente dallo staging.',
    ''
  )
  const rr = r.confronto5.renRegistrazioni
  out.push(
    rr.presente
      ? `RENregistrazioni: ${rr.righe} righe, ${rr.inviate} con XSEINVIATO = X, ${rr.conIdRentri} con IDRENTRI, ${rr.inviateSenzaIdRentri} inviate senza IDRENTRI, ${rr.movimentiRiferitiInesistenti} che citano un movimento assente dallo staging.`
      : `RENregistrazioni: ${rr.nota}`,
    ''
  )

  out.push('## Corrispondenze dedotte', '')
  out.push(
    tabella(
      ['OPER', 'Movimenti'],
      r.corrispondenzeDedotte.map(c => [c.oper, c.movimenti])
    )
  )
  return `${out.join('\n')}\n`
}
