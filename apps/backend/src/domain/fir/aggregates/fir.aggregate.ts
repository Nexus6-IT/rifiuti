/**
 * FIR Aggregate Root - Core Domain Model
 * Formulario Identificazione Rifiuti
 * Implements business rules and state transitions
 */

import { AggregateRoot, DomainEvent } from '../../../core/domain/aggregate-root'
import { DomainError, InvalidStateTransitionError } from '../../../core/domain/errors'
import { Quantita, UnitaMisura } from '../value-objects/quantita'
import { RENTRISyncStatus } from '../rentri-sync-status.vo'

export enum FIRStato {
  BOZZA = 'BOZZA',
  EMESSO = 'EMESSO',
  IN_TRANSITO = 'IN_TRANSITO',
  CONSEGNATO = 'CONSEGNATO',
  ANNULLATO = 'ANNULLATO',
}

export type TipoOperazioneRifiuto = 'RECOVERY' | 'DISPOSAL'

/**
 * Origine del legame tra il FIR interno e il numero_fir RENTRI (v. Task 1,
 * `schema.prisma` — `RentriOrigineLegame`). Replicato qui come union/enum di
 * dominio perché l'aggregate del ciclo di vita non dipende dal client Prisma
 * generato.
 */
export enum RentriOrigineLegame {
  /** Il formulario è stato creato da una nostra trasmissione (questo aggregate, markRENTRISynced). */
  TRASMESSO_DA_NOI = 'TRASMESSO_DA_NOI',
  /** Il formulario esiste già su RENTRI (creato da un'altra controparte): legame da acquisizione di visibilità. */
  ACQUISITO_DA_TERZI = 'ACQUISITO_DA_TERZI',
  /** Legame impostato manualmente da un operatore (es. correzione/riconciliazione). */
  AGGANCIO_MANUALE = 'AGGANCIO_MANUALE',
}

export interface FIRRifiuto {
  cerCode: string
  quantita: Quantita
  /** Campo 2 FIR (DM 59/2023): stato fisico del rifiuto. */
  statoFisico?: string
  /** Campo 2 FIR: caratteristiche di pericolo HP (Reg. UE 1357/2014), multi-valore. */
  caratteristichePericolo?: string
  /** Campo 2 FIR: numero di colli dichiarato. */
  numeroColli?: number
  descrizione?: string
  categoria?: string
  /** RECOVERY / DISPOSAL — categoria macro (per aggregazioni MUD). */
  tipoOperazione?: TipoOperazioneRifiuto
  /** Campo 3 FIR: codice operazione R/D specifico (es. "R1", "D13"). */
  codiceOperazione?: string
}

/**
 * Snapshot anagrafico immutabile di una parte del FIR (produttore/
 * trasportatore/destinatario), "congelato" al momento della creazione a
 * partire dal registro. Il FIR è un documento legale: conserva i dati così
 * com'erano, non un riferimento vivo che potrebbe cambiare nel tempo.
 */
export interface ParteFIR {
  registroId?: string
  ragioneSociale: string
  partitaIva: string
  indirizzo?: string
  targaVeicolo?: string
  contatto?: string
}

/**
 * Tipo di tratta di un trasporto intermodale (FIR multimodale):
 * trasporto su gomma (TERRESTRE), su rotaia (FERROVIARIA) o via mare (MARITTIMA).
 */
export enum TipoTratta {
  TERRESTRE = 'TERRESTRE',
  FERROVIARIA = 'FERROVIARIA',
  MARITTIMA = 'MARITTIMA',
}

/**
 * Snapshot anagrafico immutabile di un trasportatore aggiuntivo (tratta
 * intermodale), "congelato" alla creazione del FIR a partire dal registro
 * Trasportatore. Il trasportatore principale resta inline (vedi ParteFIR);
 * qui si modellano le N tratte successive, ordinate.
 */
export interface TrattaTrasportoFIR {
  /** Ordine della tratta nella sequenza del trasporto intermodale (1-based). */
  ordine: number
  tipoTratta: TipoTratta
  /** Riferimento al registro Trasportatore di provenienza dello snapshot. */
  trasportatoreId?: string
  denominazione: string
  partitaIva?: string
  codiceFiscale?: string
  numeroIscrizioneAlbo?: string
  /** Mezzo/identificativo: targa, numero treno o nome nave. */
  mezzo?: string
  dataPresaInCarico?: Date
}

export interface FirmaDigitale {
  firmatario: string
  timestamp: Date
  certificato: string
  /**
   * Utente (operatore autenticato) che ha apposto la firma applicativa.
   * Opzionale per retrocompatibilità con i test che costruiscono FirmaDigitale
   * senza contesto di persistenza; necessario a runtime perché il repository
   * deve valorizzare la FK obbligatoria `fir_signatures.user_id`.
   */
  userId?: string
  /**
   * Campi del sottosistema crittografico (Task 4, pipeline P3): la firma del
   * ciclo di vita non è più una costante ('FIRMA-NON-QUALIFICATA') ma una
   * firma ECDSA reale prodotta da DigitalSignatureService sul documento
   * canonico del FIR (fir.aggregate.ts, toSignableDocument()). Opzionali per
   * retrocompatibilità con i test/fixture che costruiscono FirmaDigitale a
   * mano senza passare dal provider di firma.
   */
  documentHash?: string
  certificateHash?: string
  publicKey?: string
  timestampToken?: string
  /** Algoritmo crittografico effettivo (es. 'ECDSA-SHA256'), non il metodo legacy. */
  signatureMethod?: string
  /** false = sandbox/non qualificata (default finché non c'è un contratto QTSP). */
  isQualified?: boolean
}

export interface FirmeDigitali {
  produttore?: FirmaDigitale
  trasportatore?: FirmaDigitale
  destinatario?: FirmaDigitale
}

export interface CreateFIRProps {
  produttoreId: string
  rifiuto: {
    cerCode: string
    quantita: number
    unitaMisura?: UnitaMisura
    statoFisico?: string
    caratteristichePericolo?: string
    numeroColli?: number
    descrizione?: string
    categoria?: string
    tipoOperazione?: TipoOperazioneRifiuto
    codiceOperazione?: string
  }
  trasportatoreId: string
  destinatarioId: string
  /** Campo 17 FIR: annotazioni libere. */
  annotazioni?: string
  /** Tenant proprietario del FIR (isolamento multi-tenant). */
  tenantId?: string
  /** Utente (operatore) che crea il FIR — FK obbligatoria a User in persistenza. */
  creatoDaUserId?: string
  /** Snapshot anagrafici delle parti, presi dal registro al momento della creazione. */
  produttore?: ParteFIR
  trasportatore?: ParteFIR
  destinatario?: ParteFIR
  /** Trasportatori aggiuntivi (tratte intermodali), snapshot ordinati. */
  trasportatoriAggiuntivi?: TrattaTrasportoFIR[]
}

// Domain Events
export class FIREmessoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.emesso'
  constructor(
    public readonly firId: string,
    public readonly numeroProgressivo: string
  ) {}
}

export class FIRPresaInCaricoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.presa_in_carico'
  constructor(public readonly firId: string) {}
}

export class FIRConsegnatoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.consegnato'
  constructor(
    public readonly firId: string,
    public readonly pesoEffettivo: number
  ) {}
}

export class FIRRENTRISincronizzatoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.rentri_sincronizzato'
  constructor(
    public readonly firId: string,
    public readonly numeroFir: string,
    public readonly attempts: number,
    public readonly correlationId?: string
  ) {}
}

export class FIRRENTRISyncFallitoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.rentri_sync_fallito'
  constructor(
    public readonly firId: string,
    public readonly errorMessage: string,
    public readonly errorCode: string | undefined,
    public readonly attempts: number,
    public readonly willRetry: boolean,
    public readonly nextRetryAt: Date | undefined,
    public readonly correlationId?: string
  ) {}
}

/**
 * Emesso quando una trasmissione automatica (modalità IBRIDA) ottiene un
 * numero ufficiale RENTRI ma il legame resta in attesa di conferma esplicita
 * dell'utente (v. `proporreLegameRENTRI`/`confermaLegameRENTRI`).
 */
export class FIRRENTRILegameDaConfermareEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.rentri_legame_da_confermare'
  constructor(
    public readonly firId: string,
    public readonly numeroFirProposto: string,
    public readonly correlationId?: string
  ) {}
}

/**
 * Emesso quando il FIR viene legato a un formulario RENTRI nato altrove
 * (Task 3, R2): acquisizione di visibilità o aggancio manuale dell'operatore.
 * Distinto da FIRRENTRISincronizzatoEvent (che copre solo TRASMESSO_DA_NOI):
 * qui il formulario esisteva già presso l'ente prima che questo gestionale
 * se ne accorgesse.
 */
export class FIRRENTRIAgganciatoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.rentri_agganciato'
  constructor(
    public readonly firId: string,
    public readonly numeroFir: string,
    public readonly origine: RentriOrigineLegame,
    public readonly correlationId?: string
  ) {}
}

/**
 * Emesso dallo sgancio (`rilasciaLegameRENTRI`): il FIR locale resta, ma
 * perde il legame con il numero_fir RENTRI. Riporta anche l'origine che
 * aveva il legame appena rilasciato, utile per l'audit (v. Task 4,
 * `RilasciaFormularioRENTRIUseCase` → ActivityLog).
 */
export class FIRRENTRILegameRilasciatoEvent implements DomainEvent {
  readonly occurredOn = new Date()
  readonly eventName = 'fir.rentri_legame_rilasciato'
  constructor(
    public readonly firId: string,
    public readonly numeroFirRilasciato: string,
    public readonly origineRilasciata: RentriOrigineLegame,
    public readonly correlationId?: string
  ) {}
}

export class FIR extends AggregateRoot {
  private constructor(
    private readonly _id: string,
    private _stato: FIRStato,
    private _numeroProgressivo: string | null,
    private readonly _produttoreId: string,
    private readonly _rifiuto: FIRRifiuto,
    private readonly _trasportatoreId: string,
    private readonly _destinatarioId: string,
    private _dataPresaCarico: Date | null,
    private _dataConsegna: Date | null,
    private _pesoEffettivo: number | null,
    private _firme: FirmeDigitali,
    private readonly _createdAt: Date,
    private readonly _creatoDaUserId: string | null = null,
    private readonly _produttore: ParteFIR | null = null,
    private readonly _trasportatore: ParteFIR | null = null,
    private readonly _destinatario: ParteFIR | null = null,
    private readonly _tenantId: string | null = null,
    private readonly _trasportatoriAggiuntivi: TrattaTrasportoFIR[] = [],
    /** Campo 17 FIR: annotazioni libere (obbligatorie per alcune tipologie). */
    private readonly _annotazioni: string | null = null,
    /** Data restituzione 4ª copia dal destinatario al produttore. */
    private _fourthCopyReturnedAt: Date | null = null,
    /** Note/esito del destinatario (4ª copia FIR). */
    private _fourthCopyNotes: string | null = null,
    /** Stato di sincronizzazione RENTRI (tentativi, backoff, ultimo errore). */
    private _rentriSyncStatus: RENTRISyncStatus = RENTRISyncStatus.pending(),
    /** Numero ufficiale RENTRI (numero_fir): chiave stabile del legame, valorizzata solo dopo l'aggancio. */
    private _rentriNumeroFir: string | null = null,
    /** Identificativo tecnico dell'ultima trasmissione REST (cambia ad ogni tentativo). */
    private _rentriTransazioneId: string | null = null,
    /** Come è nato il legame con rentriNumeroFir. */
    private _rentriOrigineLegame: RentriOrigineLegame | null = null,
    /**
     * Numero ufficiale RENTRI ricevuto ma NON ancora legame confermato
     * (modalità IBRIDA, v. `proporreLegameRENTRI`): valorizzato dall'esito
     * positivo di una trasmissione automatica in attesa che un operatore la
     * confermi esplicitamente. Finché è valorizzato, `rentriNumeroFir` resta
     * `null` — il FIR non è "legato" a tutti gli effetti.
     */
    private _rentriNumeroFirProposto: string | null = null
  ) {
    super()
  }

  static create(props: CreateFIRProps): FIR {
    const rifiuto: FIRRifiuto = {
      cerCode: props.rifiuto.cerCode,
      quantita: Quantita.create(
        props.rifiuto.quantita,
        props.rifiuto.unitaMisura || UnitaMisura.KG
      ),
      statoFisico: props.rifiuto.statoFisico,
      caratteristichePericolo: props.rifiuto.caratteristichePericolo,
      numeroColli: props.rifiuto.numeroColli,
      descrizione: props.rifiuto.descrizione,
      categoria: props.rifiuto.categoria,
      tipoOperazione: props.rifiuto.tipoOperazione,
      codiceOperazione: props.rifiuto.codiceOperazione,
    }

    return new FIR(
      this.generateId(),
      FIRStato.BOZZA,
      null, // numeroProgressivo assegnato all'emissione
      props.produttoreId,
      rifiuto,
      props.trasportatoreId,
      props.destinatarioId,
      null,
      null,
      null,
      {},
      new Date(),
      props.creatoDaUserId ?? null,
      props.produttore ?? null,
      props.trasportatore ?? null,
      props.destinatario ?? null,
      props.tenantId ?? null,
      props.trasportatoriAggiuntivi ?? [],
      props.annotazioni ?? null
    )
  }

  // Business Methods

  emetti(numeroProgressivo: string, firmaProduttore: FirmaDigitale): void {
    if (this._stato !== FIRStato.BOZZA) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.EMESSO)
    }

    if (!firmaProduttore) {
      throw new DomainError('FIR requires produttore signature before emission')
    }

    this._stato = FIRStato.EMESSO
    this._numeroProgressivo = numeroProgressivo
    this._firme.produttore = firmaProduttore

    this.addDomainEvent(new FIREmessoEvent(this._id, numeroProgressivo))
  }

  presaInCarico(data: Date, firmaTrasportatore: FirmaDigitale): void {
    if (this._stato !== FIRStato.EMESSO) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.IN_TRANSITO)
    }

    this._stato = FIRStato.IN_TRANSITO
    this._dataPresaCarico = data
    this._firme.trasportatore = firmaTrasportatore

    this.addDomainEvent(new FIRPresaInCaricoEvent(this._id))
  }

  confermaConsegna(
    pesoEffettivo: number,
    firmaDestinatario: FirmaDigitale,
    noteDestinatario?: string
  ): void {
    if (this._stato !== FIRStato.IN_TRANSITO) {
      throw new InvalidStateTransitionError(this._stato, FIRStato.CONSEGNATO)
    }

    // Validate peso within tolerance (±10%)
    if (!this._rifiuto.quantita.isWithinTolerance(pesoEffettivo, 10)) {
      throw new DomainError(
        `Peso effettivo (${pesoEffettivo}) eccede tolleranza 10% rispetto a quantità dichiarata (${this._rifiuto.quantita.valore})`
      )
    }

    this._stato = FIRStato.CONSEGNATO
    this._dataConsegna = new Date()
    this._pesoEffettivo = pesoEffettivo
    this._firme.destinatario = firmaDestinatario

    // 4ª copia: la firma/risposta del destinatario equivale alla restituzione
    // della 4ª copia al produttore (DM 59/2023). Si registra la data e le note.
    this._fourthCopyReturnedAt = new Date()
    if (noteDestinatario) {
      this._fourthCopyNotes = noteDestinatario
    }

    this.addDomainEvent(new FIRConsegnatoEvent(this._id, pesoEffettivo))
  }

  annulla(_motivo: string): void {
    if (this._stato === FIRStato.CONSEGNATO) {
      throw new DomainError('Cannot annull a completed FIR')
    }

    this._stato = FIRStato.ANNULLATO
    // In production, store motivo in a separate field or event
  }

  // RENTRI sync — business methods
  //
  // Regole di dominio (decise per questo task, v. report R0 Task 2):
  // 1. Trasmissibilità: solo un FIR emesso (EMESSO/IN_TRANSITO/CONSEGNATO)
  //    può essere trasmesso a RENTRI. Una BOZZA non è ancora un documento
  //    definitivo (l'operatore può ancora modificarla o scartarla), quindi
  //    non genera alcun adempimento verso l'ente. Un FIR ANNULLATO, per lo
  //    stesso motivo, non va notificato.
  // 2. Anti-duplicazione: un FIR già legato a un numero_fir RENTRI (in
  //    qualunque modo l'aggancio sia nato: nostra trasmissione, acquisizione
  //    da terzi, aggancio manuale) non è ritrasmissibile. Ritrasmettere
  //    creerebbe un secondo formulario duplicato presso l'ente — un
  //    problema normativo, non un semplice errore tecnico da poter
  //    ritentare.
  // 3. Tentativi e backoff: delegati a RENTRISyncStatus (già esistente),
  //    che implementa max 5 tentativi con backoff esponenziale 60s→60min.
  //    È deliberatamente più conservativo del backoff del client HTTP
  //    (1s→30s, per singola richiesta con Retry-After): qui si parla del
  //    ritentativo dell'INTERA operazione di sync (un nuovo job), non della
  //    singola chiamata REST. Un backoff troppo aggressivo a questo livello
  //    rischierebbe di martellare un ente che risponde 423 bandendo il
  //    chiamante per troppe richieste non valide.
  // 4. markRENTRISynced registra il numero ufficiale (rentriNumeroFir,
  //    chiave stabile del legame) e, se disponibile, l'identificativo
  //    tecnico dell'ultima trasmissione (rentriTransazioneId) separatamente:
  //    è il punto del Task 1 (i due campi hanno semantica diversa e non
  //    vanno confusi).

  /**
   * Verifica se il FIR può essere trasmesso a RENTRI ora (v. regole 1 e 2
   * sopra), incluso lo stato di sincronizzazione (RENTRISyncStatus.canRetry():
   * esclude un sync già in corso e un fallimento permanente).
   */
  canSyncToRENTRI(): boolean {
    const statoEmesso =
      this._stato === FIRStato.EMESSO ||
      this._stato === FIRStato.IN_TRANSITO ||
      this._stato === FIRStato.CONSEGNATO
    const nonGiaLegato = this._rentriNumeroFir === null

    return statoEmesso && nonGiaLegato && this._rentriSyncStatus.canRetry()
  }

  /**
   * Segna l'avvio di un tentativo di trasmissione a RENTRI.
   */
  startRENTRISync(): void {
    if (!this.canSyncToRENTRI()) {
      throw new DomainError('FIR non trasmissibile a RENTRI nello stato corrente')
    }
    this._rentriSyncStatus = this._rentriSyncStatus.markAsSyncing()
  }

  /**
   * Registra l'esito positivo della trasmissione. `numeroFir` è il numero
   * ufficiale assegnato dall'ente (obbligatorio, v. regola 4); `transazioneId`
   * è l'identificativo tecnico dell'ultima chiamata REST (opzionale, utile
   * per correlazione/supporto ma non è la chiave del legame). L'origine del
   * legame è sempre TRASMESSO_DA_NOI: questo metodo modella solo l'esito di
   * una trasmissione partita da qui.
   */
  markRENTRISynced(numeroFir: string, transazioneId?: string, correlationId?: string): void {
    if (!numeroFir || numeroFir.trim() === '') {
      throw new DomainError(
        'Numero FIR RENTRI mancante: impossibile registrare la sincronizzazione'
      )
    }

    this._rentriSyncStatus = this._rentriSyncStatus.markAsSynced(numeroFir)
    this._rentriNumeroFir = numeroFir
    if (transazioneId) {
      this._rentriTransazioneId = transazioneId
    }
    this._rentriOrigineLegame = RentriOrigineLegame.TRASMESSO_DA_NOI

    this.addDomainEvent(
      new FIRRENTRISincronizzatoEvent(
        this._id,
        numeroFir,
        this._rentriSyncStatus.getAttempts(),
        correlationId
      )
    )
  }

  /**
   * Registra un fallimento di trasmissione (v. regola 3 per tentativi/backoff).
   */
  markRENTRISyncFailed(errorMessage: string, errorCode?: string, correlationId?: string): void {
    this._rentriSyncStatus = this._rentriSyncStatus.markAsFailed(errorMessage, errorCode)

    const willRetry = this._rentriSyncStatus.canRetry()

    this.addDomainEvent(
      new FIRRENTRISyncFallitoEvent(
        this._id,
        errorMessage,
        errorCode,
        this._rentriSyncStatus.getAttempts(),
        willRetry,
        willRetry ? this._rentriSyncStatus.getNextRetryAt() : undefined,
        correlationId
      )
    )
  }

  /**
   * Registra un esito POSITIVO di trasmissione che, a differenza di
   * `markRENTRISynced`, NON diventa subito il legame ufficiale: è il
   * comportamento della modalità IBRIDA (v. `TrasmettiFIRSecondoModalitaUseCase`),
   * dove la trasmissione parte da sola ma l'aggancio richiede una conferma
   * esplicita dell'utente prima di considerare il FIR legato.
   *
   * Perché riusare `RENTRISyncStatus.markAsSynced` invece di uno stato
   * dedicato: il VO passa a SYNCED (che blocca `canRetry()`), esattamente
   * l'effetto voluto — nessun nuovo tentativo automatico mentre una proposta
   * è in attesa — senza introdurre un sesto stato nell'enum persistito
   * (`rentri_sync_status`, colonna DB) solo per questa sfumatura. La
   * distinzione "tecnicamente riuscito ma non ancora legato" vive invece nel
   * nuovo campo `rentriNumeroFirProposto`: finché è valorizzato e
   * `rentriNumeroFir` resta `null`, il FIR è "in attesa di conferma".
   */
  proporreLegameRENTRI(numeroFir: string, transazioneId?: string, correlationId?: string): void {
    if (!numeroFir || numeroFir.trim() === '') {
      throw new DomainError('Numero FIR RENTRI mancante: impossibile proporre il legame')
    }

    this._rentriSyncStatus = this._rentriSyncStatus.markAsSynced(numeroFir)
    this._rentriNumeroFirProposto = numeroFir
    if (transazioneId) {
      // rentriTransazioneId è solo l'identificativo tecnico dell'ultima
      // trasmissione (non la chiave di aggancio): può essere registrato da
      // subito, anche prima della conferma, senza implicare alcun legame.
      this._rentriTransazioneId = transazioneId
    }

    this.addDomainEvent(new FIRRENTRILegameDaConfermareEvent(this._id, numeroFir, correlationId))
  }

  /**
   * Conferma esplicita dell'utente: promuove la proposta in attesa
   * (`proporreLegameRENTRI`) al legame ufficiale, con la stessa semantica di
   * `markRENTRISynced` (origine TRASMESSO_DA_NOI, perché la trasmissione è
   * partita da qui).
   */
  confermaLegameRENTRI(correlationId?: string): void {
    if (!this._rentriNumeroFirProposto) {
      throw new DomainError('Nessun legame RENTRI in attesa di conferma per questo FIR')
    }

    const numeroFir = this._rentriNumeroFirProposto
    this._rentriNumeroFir = numeroFir
    this._rentriOrigineLegame = RentriOrigineLegame.TRASMESSO_DA_NOI
    this._rentriNumeroFirProposto = null

    this.addDomainEvent(
      new FIRRENTRISincronizzatoEvent(
        this._id,
        numeroFir,
        this._rentriSyncStatus.getAttempts(),
        correlationId
      )
    )
  }

  /**
   * Rifiuta la proposta di legame in attesa (es. l'operatore riconosce un
   * errore prima di confermare). Riporta lo stato di sync a PENDING: il FIR
   * torna trasmissibile per un nuovo tentativo (manuale o automatico).
   * Non ancora esposta da alcun endpoint (Task 2 di R1 copre solo l'avvio
   * automatico e la conferma): disponibile per l'interfaccia di conferma
   * esplicita che R1 Task 3/4 costruiranno lato utente.
   */
  rifiutaLegameRENTRI(): void {
    if (!this._rentriNumeroFirProposto) {
      throw new DomainError('Nessun legame RENTRI in attesa di conferma per questo FIR')
    }

    this._rentriNumeroFirProposto = null
    this._rentriSyncStatus = RENTRISyncStatus.pending()
  }

  // Aggancio a un formulario altrui (R2 Task 3) — due modi distinti di
  // legare questo FIR a un numero_fir che NON è nato da una nostra
  // trasmissione (v. markRENTRISynced/confermaLegameRENTRI, sopra):
  //
  // 1. agganciaFormularioAcquisito: il FIR locale nasce da zero a partire
  //    dal dettaglio RENTRI di un formulario di cui si è appena acquisita
  //    la visibilità (creato da un'altra controparte, es. il produttore).
  //    Si invoca subito dopo la creazione del FIR (Task 5), mai su un FIR
  //    preesistente — quello è il caso del metodo successivo.
  // 2. agganciaManualmente: un FIR locale preesistente (tipicamente una
  //    bozza o un record incompleto creato prima di conoscere il numero
  //    ufficiale) viene riconciliato a mano dall'operatore con un
  //    numero_fir che solo l'operatore può riconoscere come lo stesso
  //    movimento — non automatizzabile.
  //
  // Entrambi condividono la stessa precondizione: il FIR non deve avere già
  // un legame (in nessuna delle tre origini). Un formulario già legato non
  // si ri-lega direttamente a un numero diverso: bisogna prima rilasciare
  // il legame esistente (rilasciaLegameRENTRI). La ragione è di tracciabilità,
  // non solo tecnica — un secondo aggancio silenzioso su un FIR già legato
  // cancellerebbe, senza lasciarne evidenza, il fatto che era legato a
  // *un altro* formulario: un errore di questo tipo va reso visibile ed
  // esplicito (sgancio, poi nuovo aggancio), non nascosto da una sovrascrittura.

  /**
   * Lega questo FIR a un formulario RENTRI di cui si è acquisita la
   * visibilità (creato da un'altra controparte). Vedi nota sopra: si usa
   * solo sul FIR appena creato dal dettaglio RENTRI (Task 5), non per
   * riconciliare un FIR preesistente (v. agganciaManualmente).
   */
  agganciaFormularioAcquisito(numeroFir: string, correlationId?: string): void {
    this.assertNonGiaLegatoRENTRI()
    if (!numeroFir || numeroFir.trim() === '') {
      throw new DomainError(
        "Numero FIR RENTRI mancante: impossibile registrare l'acquisizione del formulario"
      )
    }

    this._rentriNumeroFir = numeroFir
    this._rentriOrigineLegame = RentriOrigineLegame.ACQUISITO_DA_TERZI

    this.addDomainEvent(
      new FIRRENTRIAgganciatoEvent(
        this._id,
        numeroFir,
        RentriOrigineLegame.ACQUISITO_DA_TERZI,
        correlationId
      )
    )
  }

  /**
   * Lega manualmente questo FIR (preesistente nel gestionale) a un
   * numero_fir che l'operatore riconosce essere lo stesso movimento. È una
   * riconciliazione a giudizio umano: nessuna validazione automatica può
   * sostituirla, quindi il metodo non verifica altro oltre alla
   * precondizione comune (nessun legame già presente).
   */
  agganciaManualmente(numeroFir: string, correlationId?: string): void {
    this.assertNonGiaLegatoRENTRI()
    if (!numeroFir || numeroFir.trim() === '') {
      throw new DomainError("Numero FIR RENTRI mancante: impossibile registrare l'aggancio manuale")
    }

    this._rentriNumeroFir = numeroFir
    this._rentriOrigineLegame = RentriOrigineLegame.AGGANCIO_MANUALE

    this.addDomainEvent(
      new FIRRENTRIAgganciatoEvent(
        this._id,
        numeroFir,
        RentriOrigineLegame.AGGANCIO_MANUALE,
        correlationId
      )
    )
  }

  /**
   * Precondizione comune ai due metodi di aggancio sopra: rifiuta se il FIR
   * ha già un legame, citando l'origine esistente nel messaggio (utile
   * all'utente e al log) — un formulario legato non si ri-lega, va prima
   * rilasciato con `rilasciaLegameRENTRI`.
   */
  private assertNonGiaLegatoRENTRI(): void {
    if (this._rentriNumeroFir) {
      throw new DomainError(
        `FIR già legato al numero RENTRI ${this._rentriNumeroFir} (origine: ${this._rentriOrigineLegame}): ` +
          'rilasciare il legame esistente prima di agganciarne un altro'
      )
    }
  }

  /**
   * Lo sgancio: operazione inversa dell'aggancio, corrispondente al
   * rilascio di visibilità verso RENTRI (POST /{numero_fir}/rilascio-
   * visibilita/{num_iscr_sito}). Riporta il FIR a "non legato"
   * (rentriNumeroFir/rentriOrigineLegame = null) — il FIR locale NON viene
   * cancellato, resta come record, coerente con la semantica del contratto
   * ("abbandona senza cancellare dall'ente": il formulario resta su RENTRI,
   * smette solo di comparire tra quelli visibili a questa unità locale).
   *
   * Consentito SOLO se l'origine corrente è ACQUISITO_DA_TERZI o
   * AGGANCIO_MANUALE — MAI su TRASMESSO_DA_NOI: un formulario che questo
   * gestionale ha creato non si "rilascia" (l'ente continuerebbe a
   * considerarlo nostro), si annullerebbe con gli endpoint del ciclo di
   * vita (R3). Impedire questa confusione qui, con un messaggio di dominio
   * esplicito, invece di lasciare che sia solo una convenzione della UI che
   * un futuro chiamante (script, altro endpoint) potrebbe ignorare.
   */
  rilasciaLegameRENTRI(correlationId?: string): void {
    if (!this._rentriNumeroFir || !this._rentriOrigineLegame) {
      throw new DomainError('Nessun legame RENTRI da rilasciare per questo FIR')
    }
    if (this._rentriOrigineLegame === RentriOrigineLegame.TRASMESSO_DA_NOI) {
      throw new DomainError(
        'Un formulario trasmesso da questo gestionale non si rilascia: ' +
          'per annullarlo usare gli endpoint del ciclo di vita RENTRI (R3)'
      )
    }

    const numeroFirRilasciato = this._rentriNumeroFir
    const origineRilasciata = this._rentriOrigineLegame

    this._rentriNumeroFir = null
    this._rentriOrigineLegame = null

    this.addDomainEvent(
      new FIRRENTRILegameRilasciatoEvent(
        this._id,
        numeroFirRilasciato,
        origineRilasciata,
        correlationId
      )
    )
  }

  /**
   * Indica se il FIR è idoneo per un nuovo tentativo automatico dopo un
   * fallimento (delega a RENTRISyncStatus.canRetry()): tiene conto sia del
   * conteggio dei tentativi residui sia del codice dell'ultimo errore — un
   * errore non ritentabile (es. RENTRI_FORBIDDEN, 403) ferma il ciclo subito,
   * anche con tentativi ancora disponibili.
   */
  needsRENTRIRetry(): boolean {
    return this._rentriSyncStatus.canRetry()
  }

  /**
   * Prossimo istante utile per ritentare, secondo il backoff esponenziale di
   * RENTRISyncStatus.
   */
  getNextRENTRIRetryAt(): Date {
    return this._rentriSyncStatus.getNextRetryAt()
  }

  /**
   * Alias esplicito su AggregateRoot.domainEvents: alcuni chiamanti
   * applicativi (es. SyncFIRToRENTRIUseCase) invocano un metodo invece di
   * leggere la proprietà.
   */
  getDomainEvents(): DomainEvent[] {
    return this.domainEvents
  }

  // Getters
  get id(): string {
    return this._id
  }

  get stato(): FIRStato {
    return this._stato
  }

  get numeroProgressivo(): string | null {
    return this._numeroProgressivo
  }

  get produttoreId(): string {
    return this._produttoreId
  }

  get rifiuto(): FIRRifiuto {
    return this._rifiuto
  }

  get trasportatoreId(): string {
    return this._trasportatoreId
  }

  get destinatarioId(): string {
    return this._destinatarioId
  }

  get dataPresaCarico(): Date | null {
    return this._dataPresaCarico
  }

  get dataConsegna(): Date | null {
    return this._dataConsegna
  }

  get pesoEffettivo(): number | null {
    return this._pesoEffettivo
  }

  get firme(): FirmeDigitali {
    return this._firme
  }

  get createdAt(): Date {
    return this._createdAt
  }

  /** Tenant proprietario del FIR (isolamento multi-tenant). */
  get tenantId(): string | null {
    return this._tenantId
  }

  /** Utente (operatore) che ha creato il FIR. */
  get creatoDaUserId(): string | null {
    return this._creatoDaUserId
  }

  /** Snapshot anagrafico del produttore al momento della creazione. */
  get produttore(): ParteFIR | null {
    return this._produttore
  }

  /** Snapshot anagrafico del trasportatore al momento della creazione. */
  get trasportatore(): ParteFIR | null {
    return this._trasportatore
  }

  /** Snapshot anagrafico del destinatario al momento della creazione. */
  get destinatario(): ParteFIR | null {
    return this._destinatario
  }

  /**
   * Trasportatori aggiuntivi (tratte intermodali), snapshot ordinati per
   * `ordine`. Vuoto per un FIR mono-trasportatore.
   */
  get trasportatoriAggiuntivi(): TrattaTrasportoFIR[] {
    return this._trasportatoriAggiuntivi
  }

  /** Campo 17 FIR (DM 59/2023): annotazioni libere. */
  get annotazioni(): string | null {
    return this._annotazioni
  }

  /** Data restituzione 4ª copia dal destinatario al produttore. */
  get fourthCopyReturnedAt(): Date | null {
    return this._fourthCopyReturnedAt
  }

  /** Note/esito del destinatario (4ª copia FIR). */
  get fourthCopyNotes(): string | null {
    return this._fourthCopyNotes
  }

  /** Stato di sincronizzazione RENTRI (tentativi, backoff, ultimo errore). */
  get rentriSyncStatus(): RENTRISyncStatus {
    return this._rentriSyncStatus
  }

  /** Numero ufficiale RENTRI (numero_fir): chiave stabile del legame. */
  get rentriNumeroFir(): string | null {
    return this._rentriNumeroFir
  }

  /** Identificativo tecnico dell'ultima trasmissione REST verso RENTRI. */
  get rentriTransazioneId(): string | null {
    return this._rentriTransazioneId
  }

  /** Come è nato il legame con rentriNumeroFir. */
  get rentriOrigineLegame(): RentriOrigineLegame | null {
    return this._rentriOrigineLegame
  }

  /**
   * Numero ufficiale RENTRI in attesa di conferma (modalità IBRIDA):
   * valorizzato da `proporreLegameRENTRI`, azzerato da
   * `confermaLegameRENTRI`/`rifiutaLegameRENTRI`. `null` se non c'è alcuna
   * proposta pendente (nessuna trasmissione IBRIDA in corso o già decisa).
   */
  get rentriNumeroFirProposto(): string | null {
    return this._rentriNumeroFirProposto
  }

  private static generateId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }
}
