import { MudExportData, MudRifiutoLine, MudTracciatoVersion, StatoFisico } from '../mud-export.types'
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

    // BA — Scheda RIF (comunicazione rifiuti, Sezione Rifiuti Speciali):
    // una scheda per codice CER, con numero d'ordine progressivo.
    data.rifiuti.forEach((r, idx) => {
      lines.push(this.recordBA(data, r, idx + 1))
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
      mudNum(0, 5), // nr moduli TE
      mudQty(0), // consegnato a terzi per recupero/smaltimento
      MUD_UM_KG, // UM
      mudNum(0, 5), // nr moduli DR
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
}
