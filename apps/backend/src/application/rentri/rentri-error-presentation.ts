/**
 * Traduzione degli errori RENTRI in messaggi azionabili (R1 Task 5).
 *
 * Il criterio del task: dopo aver letto il messaggio, l'utente sa cosa fare
 * senza aprire il portale RENTRI e senza chiedere a nessuno. Il
 * `ProblemDetails` grezzo (`RentriApiError.problemTitle`/`problemDetail`,
 * il body di `/result`) resta nel log tecnico (`errorMessage`/
 * `responsePayload` di `RENTRISyncLog`) — questa funzione traduce SOLO ciò
 * che arriva già filtrato dal client/use case (v. `SyncFIRToRENTRIUseCase`,
 * `RENTRIApiClient.gestisciRispostaNonPrevista`), non riceve mai il corpo
 * HTTP originale.
 *
 * Un solo punto di traduzione (qui) evita che frontend e backend inventino
 * due testi diversi per lo stesso `errorCode` — l'API espone direttamente
 * il messaggio pronto per l'utente (v. `SyncLogEntryDto`, `FIRResponseDto`).
 */

/**
 * Azione che l'interfaccia può proporre per un errore tradotto.
 *
 * - `RIPROVA`: un nuovo tentativo ha senso (l'esito precedente non dipende
 *   da una condizione che il tempo/i tentativi automatici risolvono da soli).
 * - `VEDI_CERTIFICATO`: serve un intervento sul certificato dell'azienda,
 *   non un nuovo tentativo.
 * - `NESSUNA`: nessuna azione manuale utile in questo momento — o perché
 *   ritentare non cambierebbe nulla (403, dati non validi), o perché un
 *   ritentativo manuale peggiorerebbe la situazione (429/423), o perché la
 *   trasmissione riprenderà comunque da sola (5xx/rete, in attesa dei
 *   tentativi automatici già pianificati).
 */
export type RentriAzioneUtente = 'RIPROVA' | 'VEDI_CERTIFICATO' | 'NESSUNA'

export interface RentriErrorePresentabile {
  /** Testo in italiano pronto per l'utente: mai un codice, mai lo status HTTP. */
  messaggio: string
  /** Azione proposta in UI (determina anche la presenza del pulsante «Riprova»). */
  azione: RentriAzioneUtente
  /**
   * Campo del formulario indicato dall'ente come causa del rifiuto, quando
   * ricavabile da `validazione` (v. `estraiCampoValidazione`). Solo per
   * `RENTRI_VALIDATION_ERROR`.
   */
  campo?: string
}

export interface RentriErroreInput {
  /** Uno dei codici assegnati da `SyncFIRToRENTRIUseCase` (v. `markRENTRISyncFailed`). */
  errorCode?: string | null
  /** Messaggio tecnico già filtrato (title/detail del ProblemDetails, o messaggio di validazione). */
  errorMessage?: string | null
  /**
   * Corpo JSON dell'esito RENTRI (`EsitoFormularioModel`, via
   * `RENTRISyncLog.responsePayload`), da cui estrarre `validazione[].campo`
   * quando l'errore è di validazione. Facoltativo: non sempre disponibile
   * (es. errori di trasporto, dove non esiste un esito da RENTRI).
   */
  responsePayload?: string | null
}

/**
 * Traduce un fallimento di sincronizzazione RENTRI in un messaggio
 * azionabile. Ignora qualunque `errorCode` non riconosciuto trattandolo come
 * la famiglia transitoria (5xx/rete): stesso comportamento sicuro di un
 * errore di rete generico, mai un testo tecnico non tradotto.
 */
export function traduciErroreRentri(input: RentriErroreInput): RentriErrorePresentabile {
  switch (input.errorCode) {
    case 'RENTRI_FORBIDDEN':
      return {
        messaggio:
          'Il certificato della tua azienda non è valido per questa operazione: verifica il certificato nella pagina dedicata. Ritentare non risolve il problema.',
        azione: 'VEDI_CERTIFICATO',
      }

    case 'RENTRI_RATE_LIMITED':
      return {
        messaggio:
          'RENTRI ha temporaneamente sospeso le richieste per troppi tentativi non validi: la trasmissione riprenderà da sola, senza bisogno di intervenire.',
        azione: 'NESSUNA',
      }

    case 'RENTRI_VALIDATION_ERROR': {
      const campo = estraiCampoValidazione(input.responsePayload)
      const dettaglio = input.errorMessage?.trim() || 'il formulario contiene dati non validi.'
      return {
        messaggio: campo
          ? `RENTRI ha respinto il formulario: ${dettaglio} (campo interessato: ${campo})`
          : `RENTRI ha respinto il formulario: ${dettaglio}`,
        azione: 'NESSUNA',
        campo,
      }
    }

    case 'RENTRI_MISSING_NUMERO_FIR':
      return {
        messaggio:
          'RENTRI ha accettato la trasmissione ma non ha restituito il numero ufficiale del formulario: il FIR non risulta ancora legato. Riprova la trasmissione.',
        azione: 'RIPROVA',
      }

    case 'RENTRI_API_ERROR':
    default:
      return {
        messaggio:
          'RENTRI non è momentaneamente raggiungibile: la trasmissione riprenderà automaticamente.',
        azione: 'NESSUNA',
      }
  }
}

/**
 * Estrae il primo campo indicato dall'ente in `validazione` (`EsitoMessaggioModel.campo`,
 * contratto ufficiale — v. anche `formatEsitoErrors` in `SyncFIRToRENTRIUseCase`, che
 * appiattisce lo stesso array in una stringa per il log tecnico). Accetta anche la
 * forma legacy `{field}` per coerenza con `formatEsitoErrors`.
 *
 * Restituisce `undefined` — mai un valore inventato — se il payload manca, non è
 * JSON valido, o non contiene un campo utilizzabile: è meglio nessun campo che uno
 * sbagliato che manda l'utente a correggere la riga sbagliata del formulario.
 */
function estraiCampoValidazione(responsePayload?: string | null): string | undefined {
  if (!responsePayload) {
    return undefined
  }

  try {
    const esito = JSON.parse(responsePayload)
    const validazione = esito?.validazione
    if (!Array.isArray(validazione) || validazione.length === 0) {
      return undefined
    }

    const primo = validazione[0]
    const campo = primo?.campo ?? primo?.field
    return typeof campo === 'string' && campo.trim() !== '' ? campo : undefined
  } catch {
    return undefined
  }
}
