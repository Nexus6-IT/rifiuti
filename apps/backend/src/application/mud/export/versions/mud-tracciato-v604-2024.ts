import { MudExportData, MudTracciatoVersion } from '../mud-export.types'
import { mudRecord, mudKg } from '../mud-format.util'

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

    // BA — Scheda RIF (comunicazione rifiuti): una per codice CER.
    for (const r of data.rifiuti) {
      lines.push(this.recordBA(data, r))
    }

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

  /** BA — Scheda RIF: riga rifiuto (CER + quantità in kg). */
  private recordBA(data: MudExportData, r: { cerCode: string; quantitaKg: number }): string {
    return mudRecord('BA', [
      data.azienda.partitaIva,
      r.cerCode,
      mudKg(r.quantitaKg),
      '1', // unità di misura: 1 = kg (tabella codici di procedura)
    ])
  }
}
