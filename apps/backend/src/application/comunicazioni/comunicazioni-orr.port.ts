import type { AttivitaOrr } from '../../domain/comunicazioni/orr/costanti'
import type { AvvisoTracciato } from './comunicazioni-tracciato.port'
import type {
  AnteprimaTracciato,
  ComunicazioneTracciatoVista,
} from './comunicazioni-tracciato.port'

/**
 * Comunicazione O.R.R. Campania (4.9f D4): una sede e un periodo a mesi interi producono UN file per
 * attivita' (D13). Questo servizio orchestra il servizio generico, che resta quello di ogni file:
 * idempotenza, hash, storico e «segna inviata» sono per file.
 */
export const COMUNICAZIONI_ORR_SERVICE = Symbol('COMUNICAZIONI_ORR_SERVICE')

export interface RichiestaOrr {
  unitaLocaleId: string
  /** Primo giorno del primo mese, `AAAA-MM-GG`. */
  da: string
  /** Ultimo giorno del mese finale, `AAAA-MM-GG`, nello stesso anno. */
  a: string
  /** Se presente, solo questa attivita'. */
  attivita?: AttivitaOrr
}

export interface AnteprimaFileOrr extends AnteprimaTracciato {
  attivita: AttivitaOrr
}

export interface AnteprimaOrr {
  unitaLocaleId: string
  periodo: { da: string; a: string }
  /** Un'anteprima per ogni attivita' che ha movimenti. */
  file: AnteprimaFileOrr[]
  /**
   * Avvisi bloccanti che non appartengono a un file (sede non campana, tipo impianto mancante...).
   * Con `file` vuoto e nessun avviso: «Non ci sono dati da comunicare».
   */
  avvisiGenerali: AvvisoTracciato[]
  /** Vero se c'e' almeno un bloccante in un file o fra i generali: nessun file si genera (D14). */
  bloccanti: boolean
  nessunDato: boolean
}

export interface ComunicazioneOrrVista extends ComunicazioneTracciatoVista {
  attivita: AttivitaOrr
}

export interface ComunicazioniOrrPort {
  anteprima(tenantId: string, richiesta: RichiestaOrr): Promise<AnteprimaOrr>
  /** Genera tutti i file; se uno solo ha un bloccante non ne genera nessuno (`ComunicazioneConBloccantiError`). */
  genera(
    tenantId: string,
    utenteId: string,
    richiesta: RichiestaOrr
  ): Promise<ComunicazioneOrrVista[]>
  /** Storico dei file O.R.R. di una sede nel periodo. */
  elenca(
    tenantId: string,
    filtri: { unitaLocaleId?: string; da?: string; a?: string }
  ): Promise<ComunicazioneOrrVista[]>
}
