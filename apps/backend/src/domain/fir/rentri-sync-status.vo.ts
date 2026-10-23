import { DomainException } from '../shared/domain-exception'

/**
 * RENTRI Sync Status Value Object
 *
 * Manages sync status, retry logic, and exponential backoff for RENTRI synchronization.
 *
 * States:
 * - PENDING: Not yet synced, ready to sync
 * - SYNCING: Sync in progress
 * - SYNCED: Successfully synced to RENTRI
 * - FAILED: Sync failed, will retry
 * - PERMANENTLY_FAILED: Max retries exceeded, OR last error non-retryable
 *   (manual intervention required)
 *
 * Retry Strategy:
 * - Max attempts: 5
 * - Exponential backoff: 2^attempt * 60 seconds
 * - Backoff cap: 60 minutes
 * - Un `lastErrorCode` non ritentabile (v. `NON_RETRYABLE_ERROR_CODES`) ferma
 *   il ciclo subito, indipendentemente dal conteggio dei tentativi: il
 *   conteggio resta il limite SUPERIORE del numero di tentativi, non l'unico
 *   criterio per decidere se ritentare.
 */
export class RENTRISyncStatus {
  private static readonly MAX_ATTEMPTS = 5
  private static readonly BASE_BACKOFF_SECONDS = 60
  private static readonly MAX_BACKOFF_SECONDS = 3600 // 60 minutes

  /**
   * Codici errore per cui ritentare non ha alcun senso, indipendentemente dai
   * tentativi residui: la causa non è transitoria e un nuovo tentativo
   * fallirebbe allo stesso modo.
   *
   * - `RENTRI_FORBIDDEN`: 403, credenziale/certificato non valido o
   *   operazione non consentita (v. `RentriApiError.retryable === false` in
   *   `RENTRIApiClient`). Il contratto RENTRI tratta il 423 come ban del
   *   chiamante per troppe richieste non valide: insistere su un 403 con lo
   *   stesso payload è esattamente il comportamento che porta al ban.
   * - `RENTRI_TRASMISSIONE_INCERTA` e `RENTRI_MISSING_NUMERO_FIR`: la
   *   creazione potrebbe essere già avvenuta presso l'ente; si riapre solo
   *   dopo verifica manuale (v. `riapriDopoVerificaManuale`).
   * - `RENTRI_VALIDATION_ERROR`: l'ente ha elaborato la transazione e ha
   *   rifiutato il contenuto del formulario — serve una correzione dei dati,
   *   non un nuovo tentativo automatico (v. `SyncFIRToRENTRIUseCase`, ramo
   *   esito negativo).
   *
   * Elenco chiuso e mantenuto qui perché la decisione "questo fallimento
   * ferma il ciclo" è una politica di dominio, non un dettaglio di trasporto:
   * si applica sia al tentativo appena eseguito (via `failed()`) sia a un
   * qualunque lettore futuro dello stato persistito (job/scheduler che
   * ricostruisce da `reconstitute()` e chiama `canRetry()`), non solo al
   * percorso che ha appena osservato l'errore in diretta.
   */
  private static readonly NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
    'RENTRI_FORBIDDEN',
    'RENTRI_VALIDATION_ERROR',
    // La creazione ha avuto esito incerto (timeout/rete dopo l'invio): il
    // formulario potrebbe esistere già presso l'ente. Ritentare in automatico
    // creerebbe un doppione: serve prima una verifica manuale.
    'RENTRI_TRASMISSIONE_INCERTA',
    // Transazione elaborata ma esito privo di numero_fir: la creazione è
    // avvenuta, rilanciarla duplicherebbe il formulario.
    'RENTRI_MISSING_NUMERO_FIR',
  ])

  private constructor(
    private readonly status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'PERMANENTLY_FAILED',
    private readonly attempts: number = 0,
    private readonly lastError?: string,
    private readonly protocolNumber?: string,
    private readonly syncedAt?: Date,
    // Codice macchina dell'ultimo fallimento (v. SyncFIRToRENTRIUseCase,
    // es. RENTRI_FORBIDDEN/RENTRI_RATE_LIMITED/RENTRI_VALIDATION_ERROR):
    // senza distinguerlo da `lastError` (testo libero) non è possibile
    // decidere in modo affidabile se offrire «Riprova» — v. R1 Task 5,
    // rentri-error-presentation.ts.
    private readonly lastErrorCode?: string
  ) {
    this.validate()
  }

  /**
   * Create pending status
   */
  static pending(): RENTRISyncStatus {
    return new RENTRISyncStatus('PENDING', 0)
  }

  /**
   * Create syncing status
   */
  static syncing(): RENTRISyncStatus {
    return new RENTRISyncStatus('SYNCING', 0)
  }

  /**
   * Create synced status with protocol number
   */
  static synced(protocolNumber: string, syncedAt?: Date): RENTRISyncStatus {
    if (!protocolNumber || protocolNumber.trim() === '') {
      throw new DomainException('Protocol number is required for synced status')
    }
    return new RENTRISyncStatus('SYNCED', 0, undefined, protocolNumber, syncedAt || new Date())
  }

  /**
   * Ricostruisce lo stato da valori già persistiti (righe `firs.rentri_*`),
   * senza passare dalle transizioni di dominio (markAsSyncing/Synced/Failed):
   * quelle producono un NUOVO stato da uno stato corrente, mentre qui si
   * riparte da zero con i valori così come sono in DB. Necessario perché il
   * costruttore è privato — senza questa fabbrica il repository non avrebbe
   * modo di ricostruire l'aggregate al reload (esattamente il tranello della
   * lettura dimenticata: vedi persistSignatures/firmeFromRecord).
   */
  static reconstitute(params: {
    status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'PERMANENTLY_FAILED'
    attempts: number
    lastError?: string
    protocolNumber?: string
    syncedAt?: Date
    lastErrorCode?: string
  }): RENTRISyncStatus {
    return new RENTRISyncStatus(
      params.status,
      params.attempts,
      params.lastError,
      params.protocolNumber,
      params.syncedAt,
      params.lastErrorCode
    )
  }

  /**
   * Create failed status with error
   */
  static failed(attempts: number, error: string, errorCode?: string): RENTRISyncStatus {
    if (attempts < 0) {
      throw new DomainException('Attempts must be non-negative')
    }
    if (!error || error.trim() === '') {
      throw new DomainException('Error message is required for failed status')
    }

    const status =
      attempts >= RENTRISyncStatus.MAX_ATTEMPTS || RENTRISyncStatus.isNonRetryable(errorCode)
        ? 'PERMANENTLY_FAILED'
        : 'FAILED'
    return new RENTRISyncStatus(status, attempts, error, undefined, undefined, errorCode)
  }

  /**
   * Transition to syncing state
   */
  markAsSyncing(): RENTRISyncStatus {
    if (this.status === 'SYNCED') {
      throw new DomainException('Cannot sync already synced FIR')
    }
    return new RENTRISyncStatus('SYNCING', this.attempts)
  }

  /**
   * Riapre un fallimento da verifica manuale (trasmissione incerta o esito
   * senza numero_fir): torna PENDING conservando i tentativi già consumati.
   * Per qualunque altro codice è un errore: gli altri fallimenti permanenti
   * non si sbloccano a mano da qui.
   */
  riapriDopoVerificaManuale(): RENTRISyncStatus {
    if (
      this.lastErrorCode !== 'RENTRI_TRASMISSIONE_INCERTA' &&
      this.lastErrorCode !== 'RENTRI_MISSING_NUMERO_FIR'
    ) {
      throw new DomainException(
        'Solo una trasmissione incerta o un esito senza numero FIR può essere riaperto dopo verifica manuale'
      )
    }
    return new RENTRISyncStatus('PENDING', this.attempts)
  }

  /**
   * Transition to synced state
   */
  markAsSynced(protocolNumber: string): RENTRISyncStatus {
    if (this.status === 'SYNCED') {
      throw new DomainException('FIR already synced')
    }
    return RENTRISyncStatus.synced(protocolNumber)
  }

  /**
   * Transition to failed state (increments attempts)
   */
  markAsFailed(error: string, errorCode?: string): RENTRISyncStatus {
    if (this.status === 'SYNCED') {
      throw new DomainException('Cannot mark synced FIR as failed')
    }
    return RENTRISyncStatus.failed(this.attempts + 1, error, errorCode)
  }

  /**
   * Check if retry is allowed.
   *
   * Il conteggio dei tentativi da solo non basta: un `lastErrorCode` non
   * ritentabile (v. `NON_RETRYABLE_ERROR_CODES`) blocca subito il ciclo,
   * anche quando `attempts` non ha ancora raggiunto `MAX_ATTEMPTS`. Il
   * controllo resta qui — non solo in `failed()` — a difesa di uno stato
   * `FAILED` ricostruito da dati persistiti prima di questa correzione (righe
   * con `rentri_sync_status = FAILED`, `rentri_last_sync_error_code =
   * RENTRI_FORBIDDEN` e tentativi ancora disponibili): senza questo secondo
   * controllo quelle righe risulterebbero ancora ritentabili finché non
   * vengono corrette da un nuovo fallimento.
   */
  canRetry(): boolean {
    if (RENTRISyncStatus.isNonRetryable(this.lastErrorCode)) {
      return false
    }

    return (
      this.status === 'PENDING' ||
      (this.status === 'FAILED' && this.attempts < RENTRISyncStatus.MAX_ATTEMPTS)
    )
  }

  /**
   * Vero se il codice errore indica una causa non transitoria (v.
   * `NON_RETRYABLE_ERROR_CODES`). Un codice assente o sconosciuto è trattato
   * come ritentabile — stessa scelta prudente di `traduciErroreRentri`
   * (`rentri-error-presentation.ts`), che tratta un codice non riconosciuto
   * come la famiglia transitoria.
   */
  private static isNonRetryable(errorCode?: string): boolean {
    return !!errorCode && RENTRISyncStatus.NON_RETRYABLE_ERROR_CODES.has(errorCode)
  }

  /**
   * Calculate next retry delay in seconds using exponential backoff
   */
  getNextRetryDelay(): number {
    if (!this.canRetry()) {
      return 0
    }

    // Exponential backoff: 2^attempt * base
    const delay = Math.pow(2, this.attempts) * RENTRISyncStatus.BASE_BACKOFF_SECONDS

    // Cap at maximum
    return Math.min(delay, RENTRISyncStatus.MAX_BACKOFF_SECONDS)
  }

  /**
   * Calculate next retry timestamp
   */
  getNextRetryAt(): Date {
    const delaySeconds = this.getNextRetryDelay()
    return new Date(Date.now() + delaySeconds * 1000)
  }

  // Getters
  getStatus(): string {
    return this.status
  }

  getAttempts(): number {
    return this.attempts
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  getLastErrorCode(): string | undefined {
    return this.lastErrorCode
  }

  getProtocolNumber(): string | undefined {
    return this.protocolNumber
  }

  getSyncedAt(): Date | undefined {
    return this.syncedAt
  }

  /**
   * Value object equality
   */
  equals(other: RENTRISyncStatus): boolean {
    return (
      this.status === other.status &&
      this.attempts === other.attempts &&
      this.protocolNumber === other.protocolNumber
    )
  }

  /**
   * Validate invariants
   */
  private validate(): void {
    if (this.status === 'SYNCED' && !this.protocolNumber) {
      throw new DomainException('Synced status requires protocol number')
    }

    if (this.status === 'FAILED' || this.status === 'PERMANENTLY_FAILED') {
      if (!this.lastError) {
        throw new DomainException('Failed status requires error message')
      }
      if (this.attempts <= 0) {
        throw new DomainException('Failed status requires at least 1 attempt')
      }
    }
  }
}
