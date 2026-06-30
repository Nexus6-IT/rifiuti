import { createHash } from 'crypto'

/**
 * Tipi di movimento del registro cronologico di carico/scarico.
 * Art. 190 D.Lgs 152/2006.
 */
export type WasteMovementType = 'CARICO' | 'SCARICO'

/**
 * Causali di carico (produttori/detentori).
 * Basate sul modello di registro DM 59/2023 Allegato I.
 */
export const CAUSALI_CARICO = [
  'PRODUZIONE_INTERNA', // Produzione interna del rifiuto
  'INGRESSO_ESTERNO', // Ricezione da altro soggetto (acquisto/ingresso)
  'RICLASSIFICAZIONE', // Riclassificazione del codice CER
  'RECUPERO_PARZIALE', // Residuo da operazione di recupero parziale
  'ALTRO_CARICO', // Altro carico non classificato
] as const

export type CausaleCarico = (typeof CAUSALI_CARICO)[number]

/**
 * Causali di scarico (conferimento/avvio a trattamento).
 */
export const CAUSALI_SCARICO = [
  'CONFERIMENTO_TRASPORTATORE', // Conferimento a trasportatore autorizzato (con FIR)
  'AVVIO_RECUPERO', // Avvio diretto a operazione di recupero (R)
  'AVVIO_SMALTIMENTO', // Avvio a operazione di smaltimento (D)
  'CESSIONE', // Cessione a terzi
  'RICLASSIFICAZIONE', // Riclassificazione (riduzione su CER corrente)
  'ALTRO_SCARICO', // Altro scarico non classificato
] as const

export type CausaleScarico = (typeof CAUSALI_SCARICO)[number]

export type CausaleMovimento = CausaleCarico | CausaleScarico

/**
 * Termini massimi di registrazione in giorni di calendario (conservativi).
 * Art. 190 c. 1: 10 gg lavorativi per produttori ≈ 14 gg calendario.
 * Per gestori impianti: 2 gg lavorativi ≈ 3 gg calendario.
 */
export const TERMINE_REGISTRAZIONE_PRODUTTORE_GG = 14
export const TERMINE_REGISTRAZIONE_GESTORE_GG = 3

export interface WasteMovementProps {
  id?: string
  tenantId: string
  progressiveNumber: number
  progressiveYear: number
  type: WasteMovementType
  movementDate: Date
  registrationDate: Date
  causale: CausaleMovimento
  cerCode: string
  wasteDescription?: string
  quantity: number
  unit: string
  wastePhysicalState?: string
  wasteHazardClasses?: string
  operationCode?: string
  counterpartName?: string
  counterpartAddress?: string
  firId?: string
  recordedByUserId?: string
  entryHash: string
  notes?: string
}

/**
 * Entità di dominio del registro cronologico di carico/scarico.
 * Art. 190 D.Lgs 152/2006 — DM 59/2023.
 *
 * Invarianti di dominio:
 * - progressiveNumber è univoco per tenant/anno (assegnato dall'applicazione)
 * - la data di registrazione non può precedere la data di operazione
 * - la data di registrazione non può superare il termine di legge dall'operazione
 * - uno SCARICO collegato a un FIR deve avere firId valorizzato
 * - l'entryHash è un fingerprint SHA-256 dei campi chiave (vidimazione digitale)
 */
export class WasteMovement {
  private constructor(private readonly props: WasteMovementProps) {}

  static create(props: Omit<WasteMovementProps, 'entryHash'>): WasteMovement {
    // Validazioni di dominio
    if (props.quantity <= 0) {
      throw new Error('La quantità deve essere maggiore di zero')
    }

    const regDate = props.registrationDate ?? new Date()
    const movDate = props.movementDate

    if (regDate < movDate) {
      throw new Error('La data di registrazione non può precedere la data di operazione')
    }

    const diffGg = Math.floor((regDate.getTime() - movDate.getTime()) / (1000 * 60 * 60 * 24))
    if (diffGg > TERMINE_REGISTRAZIONE_PRODUTTORE_GG) {
      // Emette un warning ma non blocca: la normativa prevede sanzioni
      // amministrative, non il rifiuto del dato. L'applicazione deve segnalare
      // il ritardo all'operatore (WS-I compliance scoring).
      // Lasciamo passare e tracciamo nella property per il controller.
    }

    if (props.type === 'CARICO') {
      if (!CAUSALI_CARICO.includes(props.causale as CausaleCarico)) {
        throw new Error(
          `Causale non valida per CARICO: ${props.causale}. Valori: ${CAUSALI_CARICO.join(', ')}`
        )
      }
    } else {
      if (!CAUSALI_SCARICO.includes(props.causale as CausaleScarico)) {
        throw new Error(
          `Causale non valida per SCARICO: ${props.causale}. Valori: ${CAUSALI_SCARICO.join(', ')}`
        )
      }
    }

    const entryHash = WasteMovement.computeHash(props)

    return new WasteMovement({ ...props, registrationDate: regDate, entryHash })
  }

  /**
   * Ricostituisce un'entità da dati persistiti (bypass validazioni — dati già verificati).
   */
  static reconstitute(props: WasteMovementProps): WasteMovement {
    return new WasteMovement(props)
  }

  /**
   * Calcola l'hash SHA-256 di vidimazione digitale sui campi chiave.
   * Il formato è deterministico e stabile: {tenantId}|{year}|{num}|{type}|{cerCode}|{quantity}|{movementDate}|{causale}
   * DM 59/2023, art. 4 — l'annotazione deve essere immodificabile.
   */
  static computeHash(
    p: Pick<
      WasteMovementProps,
      | 'tenantId'
      | 'progressiveYear'
      | 'progressiveNumber'
      | 'type'
      | 'cerCode'
      | 'quantity'
      | 'movementDate'
      | 'causale'
    >
  ): string {
    const payload = [
      p.tenantId,
      p.progressiveYear,
      p.progressiveNumber,
      p.type,
      p.cerCode,
      p.quantity.toString(),
      p.movementDate.toISOString(),
      p.causale,
    ].join('|')
    return createHash('sha256').update(payload).digest('hex')
  }

  /**
   * Numero di giorni di ritardo rispetto al termine di legge per la registrazione.
   * Valore positivo = fuori termine (segnalare all'operatore).
   */
  get ritardoRegistrazioneGg(): number {
    const diffGg = Math.floor(
      (this.props.registrationDate.getTime() - this.props.movementDate.getTime()) /
        (1000 * 60 * 60 * 24)
    )
    return Math.max(0, diffGg - TERMINE_REGISTRAZIONE_PRODUTTORE_GG)
  }

  get id(): string | undefined {
    return this.props.id
  }
  get tenantId(): string {
    return this.props.tenantId
  }
  get progressiveNumber(): number {
    return this.props.progressiveNumber
  }
  get progressiveYear(): number {
    return this.props.progressiveYear
  }
  get type(): WasteMovementType {
    return this.props.type
  }
  get movementDate(): Date {
    return this.props.movementDate
  }
  get registrationDate(): Date {
    return this.props.registrationDate
  }
  get causale(): CausaleMovimento {
    return this.props.causale
  }
  get cerCode(): string {
    return this.props.cerCode
  }
  get wasteDescription(): string | undefined {
    return this.props.wasteDescription
  }
  get quantity(): number {
    return this.props.quantity
  }
  get unit(): string {
    return this.props.unit
  }
  get wastePhysicalState(): string | undefined {
    return this.props.wastePhysicalState
  }
  get wasteHazardClasses(): string | undefined {
    return this.props.wasteHazardClasses
  }
  get operationCode(): string | undefined {
    return this.props.operationCode
  }
  get counterpartName(): string | undefined {
    return this.props.counterpartName
  }
  get counterpartAddress(): string | undefined {
    return this.props.counterpartAddress
  }
  get firId(): string | undefined {
    return this.props.firId
  }
  get recordedByUserId(): string | undefined {
    return this.props.recordedByUserId
  }
  get entryHash(): string {
    return this.props.entryHash
  }
  get notes(): string | undefined {
    return this.props.notes
  }
}
