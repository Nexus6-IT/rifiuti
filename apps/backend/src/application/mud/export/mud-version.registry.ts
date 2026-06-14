import { Injectable } from '@nestjs/common'
import { MudTracciatoVersion } from './mud-export.types'
import { MudTracciatoV604_2024 } from './versions/mud-tracciato-v604-2024'

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
  private readonly versions: MudTracciatoVersion[] = [
    new MudTracciatoV604_2024(), // MUD 2024 — ver. 6.04/24
    // MUD 2025/2026 → aggiungere qui la rispettiva classe versione.
  ]

  /** Ritorna il tracciato per l'anno richiesto; lancia se non supportato. */
  getForYear(year: number): MudTracciatoVersion {
    const version = this.versions.find((v) => v.year === year)
    if (!version) {
      throw new Error(
        `MUD: nessun tracciato disponibile per l'anno ${year}. Anni supportati: ${this.supportedYears().join(', ')}`,
      )
    }
    return version
  }

  /** Anni di dichiarazione supportati (con relativa versione tracciato). */
  supportedYears(): number[] {
    return this.versions.map((v) => v.year).sort((a, b) => b - a)
  }

  /** Elenco versioni supportate (anno → versione). */
  listVersions(): Array<{ year: number; version: string }> {
    return this.versions.map((v) => ({ year: v.year, version: v.version }))
  }
}
