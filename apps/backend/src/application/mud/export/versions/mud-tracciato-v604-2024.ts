import {
  MudExportData,
  MudRifiutoLine,
  MudTracciatoVersion,
  StatoFisico,
  MudAllegatoDR,
  MudAllegatoTE,
} from '../mud-export.types'
import {
  mudRecord,
  mudNum,
  mudQty,
  mudAlfa,
  mudCodiceFiscale,
  MUD_UM_KG,
} from '../mud-format.util'
import { normalizeCer } from '../../../esg/emission-factors'

/** Ordine dei 7 flag di stato fisico nel record BA. */
const STATO_FISICO_ORDER: StatoFisico[] = [
  'SOLIDO_POLVERULENTO',
  'SOLIDO_NON_POLVERULENTO',
  'FANGOSO_PALABILE',
  'LIQUIDO',
  'AERIFORME',
  'VISCHIOSO_SCIROPPOSO',
  'ALTRO',
]

/**
 * Tracciato MUD **versione 6.04/24 — dichiarazione MUD 2024**
 * (docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf).
 *
 * Produce il file telematico sequenziale multirecord. Sequenza:
 *   XX (testata, primo e unico) → { AA, AB, BA, BB } per ogni dichiarazione.
 * Campi separati da `;`; testo ASCII MAIUSCOLO.
 *
 * ⚠️ NOTA DI COMPLETEZZA: questa implementazione genera la STRUTTURA corretta
 * (tipi record, sequenza, separatori, costante release, anagrafica e righe
 * rifiuto dai nostri dati) ma NON copre ancora tutti i campi posizionali del
 * tracciato (codici ISTAT/ATECO/comuni, autorizzazioni, moduli RT/DR/TE, schede
 * veicoli, ecc.). Prima dell'invio reale il file va validato con l'applicazione
 * ufficiale su mudtelematico.it. Le nuove annualità si aggiungono creando una
 * nuova classe versione (vedi MudVersionRegistry) — versionamento per anno.
 */
export class MudTracciatoV604_2024 implements MudTracciatoVersion {
  readonly version = '6.04/24'
  readonly year = 2024

  generate(data: MudExportData): string {
    const lines: string[] = []

    // XX — Testata del file di export e modulo riepilogativo (primo e unico).
    lines.push(this.recordXX(data))

    // AA — Scheda SA-1: anagrafica azienda e unità locale.
    lines.push(this.recordAA(data))
    // AB — Scheda SA-2: anagrafica riassuntiva.
    lines.push(this.recordAB(data))

    // BA — Scheda RIF (Sezione Rifiuti Speciali): una scheda per CER, seguita
    // dai suoi moduli allegati BB (DR conferiti a terzi, TE trasportatori).
    data.rifiuti.forEach((r, idx) => {
      const progr = idx + 1
      lines.push(this.recordBA(data, r, progr))

      let drNum = 0
      for (const dr of r.dr ?? []) {
        lines.push(this.recordBB_DR(data, r, progr, ++drNum, dr))
      }
      let teNum = 0
      for (const te of r.te ?? []) {
        lines.push(this.recordBB_TE(data, r, progr, ++teNum, te))
      }
    })

    // Terminatore di riga CRLF su ogni record.
    return lines.join('\r\n') + '\r\n'
  }

  /** XX — testata: costante release del tracciato di questa versione. */
  private recordXX(data: MudExportData): string {
    return mudRecord('XX', [
      this.version, // costante release file (es. "6.04/24")
      data.year, // anno di riferimento della dichiarazione
      data.rifiuti.length, // numero schede rifiuto nel file (riepilogo)
    ])
  }

  /** AA — Scheda SA-1: anagrafica azienda + unità locale. */
  private recordAA(data: MudExportData): string {
    const a = data.azienda
    return mudRecord('AA', [
      a.partitaIva,
      a.codiceFiscale || a.partitaIva,
      a.ragioneSociale,
      a.atecoCode || '', // codice attività economica ISTAT (ATECO)
      a.via,
      a.comuneCode || '', // codice ISTAT comune (dalle tabelle di riferimento)
      a.comune,
      a.provincia,
      a.cap,
      a.pec || '',
    ])
  }

  /** AB — Scheda SA-2: anagrafica riassuntiva (riepilogo unità locale). */
  private recordAB(data: MudExportData): string {
    const a = data.azienda
    return mudRecord('AB', [a.partitaIva, a.ragioneSociale, a.provincia])
  }

  /**
   * BA — Scheda RIF (Sezione Rifiuti Speciali): 35 campi a lunghezza fissa,
   * lunghezza totale record 217 (tracciato V6.04/24). Mappa i nostri dati:
   * rifiuto prodotto nell'unità locale, quantità avviate a recupero/smaltimento;
   * i campi non disponibili (ricevuto da terzi, prodotto fuori UL, trasportato,
   * consegnato a terzi, giacenze, moduli RT/RE/TE/DR) sono a 0 finché non
   * implementati i moduli BB. Unità di misura: kg.
   */
  private recordBA(data: MudExportData, r: MudRifiutoLine, progressivo: number): string {
    const cf = mudCodiceFiscale(data.azienda.codiceFiscale || data.azienda.partitaIva)
    const unitaLocale = mudNum(1, 15) // unità locale unica (codice progressivo 1)
    const stati = this.statoFisicoFlags(r.statoFisico)

    return mudRecord('BA', [
      mudNum(data.year, 4), // anno
      cf, // codice fiscale (16)
      unitaLocale, // codice identificazione univoca unità locale (15)
      mudNum(progressivo, 4), // nr ordine progressivo scheda RIF
      mudAlfa(normalizeCer(r.cerCode), 6), // CER (solo catalogo europeo)
      ...stati, // 7 flag stato fisico
      mudQty(r.prodottoKg), // rifiuto prodotto nell'unità locale
      MUD_UM_KG, // UM
      mudQty(0), // ricevuto da terzi
      MUD_UM_KG, // UM
      mudNum(0, 5), // nr moduli RT
      mudQty(0), // prodotto fuori unità locale
      MUD_UM_KG, // UM
      mudNum(0, 5), // nr moduli RE
      mudQty(0), // trasportato dal dichiarante
      MUD_UM_KG, // UM
      mudNum(r.te?.length ?? 0, 5), // nr moduli TE
      mudQty(this.sommaDR(r)), // consegnato a terzi per recupero/smaltimento
      MUD_UM_KG, // UM
      mudNum(r.dr?.length ?? 0, 5), // nr moduli DR
      mudQty(0), // giacenza al 31/12 da avviare a recupero
      MUD_UM_KG, // UM
      mudQty(0), // giacenza al 31/12 da avviare a smaltimento
      MUD_UM_KG, // UM
      mudQty(r.recuperoKg), // quantità complessiva avviata a recupero
      MUD_UM_KG, // UM
      mudQty(r.smaltimentoKg), // quantità complessiva avviata a smaltimento
      MUD_UM_KG, // UM
    ])
  }

  /** 7 flag (0/1) di stato fisico nell'ordine del tracciato; default solido NON polverulento. */
  private statoFisicoFlags(stato?: StatoFisico): string[] {
    const selected = stato ?? 'SOLIDO_NON_POLVERULENTO'
    return STATO_FISICO_ORDER.map((s) => (s === selected ? '1' : '0'))
  }

  /** Totale conferito a terzi (somma quantità dei moduli DR). */
  private sommaDR(r: MudRifiutoLine): number {
    return (r.dr ?? []).reduce((sum, d) => sum + (d.quantitaKg || 0), 0)
  }

  /**
   * BB — Modulo DR (rifiuto conferito a terzi): 32 campi a lunghezza fissa
   * (lunghezza record 310). Valorizza anagrafica destinatario + quantità.
   */
  private recordBB_DR(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    dr: MudAllegatoDR,
  ): string {
    return this.recordBB(data, r, schedaProgr, 'DR', allegatoProgr, {
      cf: dr.codiceFiscale,
      ragioneSociale: dr.ragioneSociale,
      istatProvincia: dr.istatProvincia,
      istatComune: dr.istatComune,
      indirizzo: dr.indirizzo,
      civico: dr.civico,
      cap: dr.cap,
      quantitaKg: dr.quantitaKg,
    })
  }

  /**
   * BB — Modulo TE (trasportatore): valorizza solo CF + ragione sociale
   * (gli altri campi restano azzerati, come da specifica).
   */
  private recordBB_TE(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    allegatoProgr: number,
    te: MudAllegatoTE,
  ): string {
    return this.recordBB(data, r, schedaProgr, 'TE', allegatoProgr, {
      cf: te.codiceFiscale,
      ragioneSociale: te.ragioneSociale,
    })
  }

  /** Costruisce un record BB generico per tipo allegato (DR/TE/RT). */
  private recordBB(
    data: MudExportData,
    r: MudRifiutoLine,
    schedaProgr: number,
    tipo: 'RT' | 'DR' | 'TE',
    allegatoProgr: number,
    f: {
      cf: string
      ragioneSociale: string
      istatProvincia?: string
      istatComune?: string
      indirizzo?: string
      civico?: string
      cap?: string
      quantitaKg?: number
    },
  ): string {
    return mudRecord('BB', [
      mudNum(data.year, 4),
      mudCodiceFiscale(data.azienda.codiceFiscale || data.azienda.partitaIva),
      mudNum(1, 15), // unità locale
      mudNum(schedaProgr, 4), // nr scheda RIF
      mudAlfa(normalizeCer(r.cerCode), 6),
      mudAlfa(tipo, 2), // tipo allegato
      mudNum(allegatoProgr, 5), // nr progressivo allegato
      mudCodiceFiscale(f.cf), // CF soggetto
      mudAlfa(f.ragioneSociale, 60),
      mudAlfa(f.istatProvincia ?? '', 3), // ISTAT provincia (DR/RT)
      mudAlfa(f.istatComune ?? '', 3), // ISTAT comune (DR/RT)
      mudAlfa(f.indirizzo ?? '', 30),
      mudAlfa(f.civico ?? '', 6),
      mudAlfa(f.cap ?? '', 5),
      mudQty(f.quantitaKg ?? 0), // quantità dichiarata
      MUD_UM_KG, // UM
      mudAlfa('', 20), // nome nazione (estero)
      mudAlfa('', 6), // codice reg. CEE 1013/2006
      mudNum(0, 1), // ricevuto da privati (solo RT)
      mudQty(0), // altre op. smaltimento (estero)
      MUD_UM_KG,
      mudQty(0), // recupero di materia (estero)
      MUD_UM_KG,
      mudQty(0), // recupero di energia (estero)
      MUD_UM_KG,
      mudQty(0), // incenerimento (estero)
      MUD_UM_KG,
      mudQty(0), // discarica (estero)
      MUD_UM_KG,
      mudNum(0, 1), // origine urbana (solo RT)
      mudNum(0, 1), // pile e accumulatori portatili (solo RT)
    ])
  }
}
