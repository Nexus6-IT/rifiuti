import { MudTracciatoV604Base } from './mud-tracciato-v604-base'
import { MudTipoAutorizzazione } from '../mud-export.types'

/**
 * Tracciato MUD **versione 6.04/25** — dichiarazione **MUD 2026** sui dati 2025.
 *
 * Approvato dal **DPCM 30 gennaio 2026**, pubblicato in **GU Serie Generale
 * n. 53 del 5 marzo 2026**; scadenza di presentazione **3 luglio 2026**
 * (120 giorni dalla pubblicazione, art. 6 L. 25/1/1994 n. 70).
 * Specifiche: Allegato 4 al DPCM, documento v1.0 del 26/01/2026
 * (`20260126_TracciatiRecord_MUD_V604-25-rev01`).
 *
 * `year` è l'anno **dei dati dichiarati**, non quello di presentazione.
 *
 * ## Differenze rispetto al 6.04/24
 *
 * **Le lunghezze dei record sono identiche** (XX 488, AA 338, BA 217, …): la
 * struttura non cambia, quindi tutta la generazione resta nella classe base.
 * Cambiano:
 *
 * 1. **Costante di release** del file: `"6.04/24"` → `"6.04/25"` (campo 2 di XX).
 * 2. **Tabella ISTAT delle attività economiche**: «ATECO 2025» (6 cifre) al
 *    posto di «ATECO 2007 – aggiornamento 2022». È il vero costo di adeguamento
 *    ed è **esterno al tracciato**: riguarda i dati di riferimento, che vanno
 *    validati contro la tabella dell'anno di dichiarazione.
 * 3. **Record AU**: tre nuovi tipi di autorizzazione — `7` bonifiche
 *    (art. 242 c.7), `8` autorizzazioni straordinarie (art. 191, ordinanza
 *    contingibile e urgente), `9` comunicazione di trattamento in impianti di
 *    acque reflue urbane (art. 110 c.3). Vedi `tipiAutorizzazioneAmmessi`.
 * 4. **Etichette** rinominate, senza effetto sulla struttura: negli stati fisici
 *    dei record BA e DA «Solido polverulento» → «In polvere o polverulento»,
 *    «Solido NON polverulento» → «Solido», «Fangoso palabile» → «Fangoso»;
 *    nel record MA «Aggregati riciclati» → «Aggregati recuperati». Posizioni e
 *    semantica invariate: gli identificatori di dominio restano quelli storici.
 */
export class MudTracciatoV604_2025 extends MudTracciatoV604Base {
  readonly version = '6.04/25'
  readonly year = 2025

  /** Il 6.04/25 aggiunge i tipi 7, 8 e 9 al record AU. */
  protected readonly tipiAutorizzazioneAmmessi: readonly MudTipoAutorizzazione[] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
  ]
}
