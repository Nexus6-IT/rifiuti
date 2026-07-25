import { MudTracciatoV604Base } from './mud-tracciato-v604-base'

/**
 * Tracciato MUD **versione 6.04/24** — dichiarazione **MUD 2025** sui dati 2024.
 *
 * Approvato dal **DPCM 29 gennaio 2025**, pubblicato in **GU Serie Generale
 * n. 49 del 28 febbraio 2025**; scadenza di presentazione **28 giugno 2025**.
 * Specifiche: `docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf`
 * (Allegato 4 al DPCM, documento v1.0 del 29/01/2025).
 *
 * `year` è l'anno **dei dati dichiarati**, non quello di presentazione.
 *
 * Struttura, lunghezze record e regole di formattazione sono nella classe base
 * comune alla famiglia 6.04. Questa annualità usa la tabella ISTAT delle
 * attività economiche **ATECO 2007 – aggiornamento 2022** e ammette i tipi di
 * autorizzazione da 1 a 6 nel record AU (i tipi 7, 8 e 9 arrivano col 6.04/25).
 */
export class MudTracciatoV604_2024 extends MudTracciatoV604Base {
  readonly version = '6.04/24'
  readonly year = 2024
}
