import { Injectable, NotFoundException } from '@nestjs/common'
import { MudTracciatoVersion } from './mud-export.types'
import { MudTracciatoV604_2024 } from './versions/mud-tracciato-v604-2024'
import { MudTracciatoV604_2025 } from './versions/mud-tracciato-v604-2025'

/**
 * Registro dei tracciati MUD **versionati per anno**.
 *
 * Il MUD cambia ogni anno (nuovo DPCM → nuova versione del tracciato). Qui ogni
 * anno di dichiarazione è mappato alla propria implementazione. Aggiungere una
 * nuova annualità = creare una classe `MudTracciatoVYYY` e registrarla in
 * `VERSIONS`. Nessun'altra modifica necessaria a valle.
 */
@Injectable()
export class MudVersionRegistry {
  // `year` è l'anno DEI DATI dichiarati: la dichiarazione si presenta l'anno dopo.
  private readonly versions: MudTracciatoVersion[] = [
    // Dati 2025 → MUD 2026, ver. 6.04/25 (DPCM 30/1/2026, GU 53 del 5/3/2026,
    // scadenza 3/7/2026).
    new MudTracciatoV604_2025(),
    // Dati 2024 → MUD 2025, ver. 6.04/24 (DPCM 29/1/2025, GU 49 del 28/2/2025,
    // scadenza 28/6/2025).
    new MudTracciatoV604_2024(),
    // Nuova annualità → sottoclasse di MudTracciatoV604Base + una riga qui.
  ]

  /** Ritorna il tracciato per l'anno richiesto; lancia se non supportato. */
  getForYear(year: number): MudTracciatoVersion {
    const version = this.versions.find(v => v.year === year)
    if (!version) {
      throw new NotFoundException(
        `Versione tracciato MUD non disponibile per l'anno ${year}. Anni supportati: ${this.supportedYears().join(', ')}`
      )
    }
    return version
  }

  /** Anni di dichiarazione supportati (con relativa versione tracciato). */
  supportedYears(): number[] {
    return this.versions.map(v => v.year).sort((a, b) => b - a)
  }

  /** Elenco versioni supportate (anno → versione). */
  listVersions(): Array<{ year: number; version: string }> {
    return this.versions.map(v => ({ year: v.year, version: v.version }))
  }
}
