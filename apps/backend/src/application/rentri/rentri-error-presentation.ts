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

    case 'FORMULARIO_GIA_AGGANCIATO':
      // Coperto sia dalla precondizione applicativa (AcquisisciFormularioRENTRIUseCase)
      // sia dal vincolo di unicità a database (repository) — stesso messaggio in
      // entrambi i casi, per questo va tradotto qui e non lasciato al testo generato
      // al volo dall'eccezione di dominio (che porta un prefisso tecnico "Business
      // rule violated: ..." non presentabile all'utente).
      return {
        messaggio:
          'Questo formulario è già collegato a un altro FIR nel gestionale: rilascialo da lì prima di riprovare qui.',
        azione: 'NESSUNA',
      }

    case 'UNITA_LOCALE_MANCANTE':
      // Stessa azione di RENTRI_FORBIDDEN (destinazione: pagina del certificato), ma
      // causa distinta — qui manca la configurazione della sede, non il certificato è
      // invalido — e infatti il messaggio è diverso.
      return {
        messaggio:
          'Configura il numero di iscrizione della tua unità locale nella pagina del certificato prima di cercare i formulari.',
        azione: 'VEDI_CERTIFICATO',
      }

    case 'RENTRI_FORBIDDEN_ACQUISIZIONE':
      // RENTRI risponde 403 sia quando il certificato non è valido (RENTRI_FORBIDDEN)
      // sia quando l'utenza non ha titolo su nessuno dei soggetti coinvolti in
      // un'acquisizione-visibilità: il contratto ufficiale (ProblemDetails) non
      // distingue i due casi con un campo diverso, solo testo libero dell'ente non
      // affidabile per un branching. La distinzione arriva dal CHIAMANTE, che assegna
      // questo errorCode in base a QUALE operazione ha prodotto il 403 (stessa tecnica
      // già in uso in SyncFIRToRENTRIUseCase per RENTRI_FORBIDDEN), non dal contenuto
      // della risposta RENTRI.
      return {
        messaggio:
          'Non risulti tra i soggetti coinvolti in questo formulario: RENTRI non consente di agganciarlo.',
        azione: 'NESSUNA',
      }

    case 'RENTRI_MISSING_NUMERO_FIR':
      return {
        messaggio:
          'RENTRI ha accettato la trasmissione ma non ha restituito il numero ufficiale del formulario: il FIR non risulta ancora legato. Riprova la trasmissione.',
        azione: 'RIPROVA',
      }

    case 'ACCETTAZIONE_NON_DISPONIBILE':
    case 'ANNULLAMENTO_NON_DISPONIBILE':
    case 'ALLEGATO_NON_DISPONIBILE':
      // I tre nascono dalla stessa causa (R3 Task 2): la precondizione locale
      // contro `/azioni` ha rifiutato l'operazione. Non dovrebbe mai arrivare
      // fin qui — l'use case verifica `/azioni` PRIMA di chiamare RENTRI — ma
      // se il messaggio arriva comunque all'utente, deve dirgli cosa succede
      // ADESSO (lo stato è cambiato), non solo cosa è andato storto.
      return {
        messaggio:
          'Il formulario non è più nella fase in cui questa operazione è possibile: la pagina si aggiornerà con lo stato corrente.',
        azione: 'NESSUNA',
      }

    case 'FIRMA_RENTRI_RIFIUTATA': {
      // L'ente ha rifiutato la firma a metà di un'operazione (R3 Task 3): il
      // messaggio grezzo nomina sempre l'operazione in maiuscolo
      // ("l'operazione ACCETTAZIONE NON è stata completata" / "ANNULLAMENTO"
      // — v. `completa-operazione-con-firma.use-case.ts`). Ritentare la
      // stessa operazione ha senso: non è un rifiuto definitivo dell'ente
      // sui dati, è la firma che non si è conclusa.
      const operazione = estraiTipoOperazioneFirma(input.errorMessage)
      const messaggio =
        operazione === 'ACCETTAZIONE'
          ? "L'accettazione non si è completata sull'ente: puoi riprovare."
          : operazione === 'ANNULLAMENTO'
            ? "L'annullamento non si è completato sull'ente: puoi riprovare."
            : "L'operazione non si è completata sull'ente: puoi riprovare."
      return {
        messaggio,
        azione: 'RIPROVA',
      }
    }

    case 'FORMATO_ALLEGATO_NON_AMMESSO':
      // Validazione locale (R3 Task 2), eseguita PRIMA di qualunque chiamata
      // di rete: nessuna richiesta è mai partita verso RENTRI, quindi il
      // messaggio non deve MAI sembrare un rifiuto dell'ente.
      return {
        messaggio:
          "Il formato del file non è ammesso: l'ente accetta solo allegati in PDF. Scegli un altro file.",
        azione: 'NESSUNA',
      }

    case 'ALLEGATO_TROPPO_GRANDE':
      // Stessa natura di FORMATO_ALLEGATO_NON_AMMESSO: validazione locale,
      // nessuna richiesta partita verso l'ente.
      return {
        messaggio: 'Il file supera la dimensione massima ammessa: scegli un file più piccolo.',
        azione: 'NESSUNA',
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

/**
 * Estrae il tipo di operazione (`'ACCETTAZIONE'` | `'ANNULLAMENTO'`) dal
 * messaggio grezzo prodotto da `CompletaOperazioneConFirmaUseCase` quando
 * l'ente rifiuta la firma (`FIRMA_RENTRI_RIFIUTATA`). Il chiamante scrive
 * sempre, per costruzione, la frase
 * "l'operazione <TIPO> non è stata completata" con `<TIPO>` in MAIUSCOLO
 * (v. `tipoOperazione` in `ComandoCompletaOperazioneConFirma`, valorizzato da
 * `accetta-o-respingi-fir.use-case.ts` e `annulla-fir-rentri.use-case.ts`).
 *
 * Restituisce `undefined` — mai un valore inventato — se il messaggio manca
 * o non contiene la frase attesa: il chiamante ricade sul testo generico
 * piuttosto che nominare un'operazione sbagliata.
 */
function estraiTipoOperazioneFirma(
  errorMessage?: string | null
): 'ACCETTAZIONE' | 'ANNULLAMENTO' | undefined {
  if (!errorMessage) {
    return undefined
  }

  const match = errorMessage.match(/l'operazione\s+(\S+)\s+non è stata completata/i)
  const tipo = match?.[1]?.toUpperCase()
  return tipo === 'ACCETTAZIONE' || tipo === 'ANNULLAMENTO' ? tipo : undefined
}
