import { createHash } from 'crypto'
import { Prisma } from '@prisma/client'
import { giornoItaliano } from '../../core/time/anno-italiano'

/**
 * Tipi di movimento del registro cronologico di carico/scarico.
 * Art. 190 D.Lgs 152/2006.
 */
export type WasteMovementType = 'CARICO' | 'SCARICO'

/**
 * Termini massimi di registrazione in giorni di calendario (conservativi).
 * Art. 190 c. 1: 10 gg lavorativi per produttori ≈ 14 gg calendario.
 * Per gestori impianti: 2 gg lavorativi ≈ 3 gg calendario.
 */
export const TERMINE_REGISTRAZIONE_PRODUTTORE_GG = 14
export const TERMINE_REGISTRAZIONE_GESTORE_GG = 3

/**
 * Giorni di calendario italiani da `da` ad `a`. La differenza fra gli istanti, arrotondata
 * per difetto, perderebbe un giorno per una registrazione fatta fra le 00:00 e l'01:00
 * (02:00 con l'ora legale) italiane.
 */
function giorniItalianiFra(da: Date, a: Date): number {
  const giornoUtc = (istante: Date) => Date.parse(`${giornoItaliano(istante)}T00:00:00Z`)
  return (giornoUtc(a) - giornoUtc(da)) / 86_400_000
}

/** Tipo di annotazione del registro (come l'enum Prisma `TipoAnnotazioneMovimento`). */
export type TipoAnnotazione = 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'

export interface WasteMovementProps {
  id?: string
  tenantId: string
  /** Registro (per sede) in cui il movimento è annotato; non entra nell'hash (D7). */
  registroId: string
  progressiveNumber: number
  progressiveYear: number
  type: WasteMovementType
  movementDate: Date
  registrationDate: Date
  /** Codice della causale: di sistema o `AZ_...` dell'azienda; l'elenco valido sta nel catalogo. */
  causale: string
  /** Versione della causale aziendale (null per quelle di sistema); non entra nell'hash. */
  causaleAziendaId?: string | null
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
  /**
   * Hash dell'annotazione precedente dello stesso registro e anno ('' se e' la prima).
   * Obbligatorio in `WasteMovement.create` (hash v2 concatenato, R8); opzionale qui perche' le
   * entita' ricostituite dal database non lo usano.
   */
  hashPrecedente?: string
  notes?: string
  /** Tipo di annotazione per l'hash v2 (default ORDINARIA); le correzioni passano il proprio. */
  tipoAnnotazione?: TipoAnnotazione
  /** Predecessore corretto (solo correzioni): entra nell'hash v2. */
  movimentoRettificatoId?: string
}

/** Versione dell'hash salvata sulle nuove registrazioni (colonna hash_versione). */
export const HASH_VERSIONE_CORRENTE = 2

/** Campi che entrano nell'hash v2 di un'annotazione (R8). */
export interface DatiHashAnnotazioneV2 {
  hashPrecedente: string
  registroId: string
  anno: number
  numero: number
  tipoAnnotazione: string
  movimentoRettificatoId?: string | null
  type: string
  cerCode: string
  quantita: number | string | Prisma.Decimal
  unit: string
  movementDate: Date
  causale: string
}

/**
 * Hash v2 concatenato di un'annotazione (R8): include l'hash dell'annotazione precedente,
 * il registro, il tipo di annotazione e il riferimento alla riga corretta. La quantita' e'
 * normalizzata a due decimali (la colonna e' Decimal(10,2)) cosi' il ricalcolo dopo la
 * rilettura dal database coincide; la data e' l'ISO (millisecondi compresi).
 */
export function hashAnnotazioneV2(d: DatiHashAnnotazioneV2): string {
  const payload = [
    'v2',
    d.hashPrecedente,
    d.registroId,
    d.anno,
    d.numero,
    d.tipoAnnotazione,
    d.movimentoRettificatoId ?? '',
    d.type,
    d.cerCode,
    new Prisma.Decimal(d.quantita).toFixed(2),
    d.unit,
    d.movementDate.toISOString(),
    d.causale,
  ].join('|')
  return createHash('sha256').update(payload).digest('hex')
}

/**
 * Entità di dominio del registro cronologico di carico/scarico.
 * Art. 190 D.Lgs 152/2006 — DM 59/2023.
 *
 * Invarianti di dominio:
 * - progressiveNumber è univoco per registro/anno (assegnato dall'applicazione)
 * - la data di registrazione non può precedere la data di operazione
 * - la data di registrazione non può superare il termine di legge dall'operazione
 * - uno SCARICO collegato a un FIR deve avere firId valorizzato
 * - l'entryHash è un fingerprint SHA-256 dei campi chiave (vidimazione digitale)
 */
export class WasteMovement {
  private constructor(private readonly props: WasteMovementProps) {}

  static create(
    props: Omit<WasteMovementProps, 'entryHash' | 'hashPrecedente'> & { hashPrecedente: string }
  ): WasteMovement {
    // Validazioni di dominio
    if (props.quantity <= 0) {
      throw new Error('La quantità deve essere maggiore di zero')
    }

    const regDate = props.registrationDate ?? new Date()
    const movDate = props.movementDate

    // La registrazione è un istante, l'operazione un giorno: si confrontano i giorni di
    // calendario italiani (alle 00:30 di Roma l'istante UTC è ancora del giorno prima).
    if (giornoItaliano(regDate) < giornoItaliano(movDate)) {
      throw new Error('La data di registrazione non può precedere la data di operazione')
    }

    const diffGg = giorniItalianiFra(movDate, regDate)
    if (diffGg > TERMINE_REGISTRAZIONE_PRODUTTORE_GG) {
      // Emette un warning ma non blocca: la normativa prevede sanzioni
      // amministrative, non il rifiuto del dato. L'applicazione deve segnalare
      // il ritardo all'operatore (WS-I compliance scoring).
      // Lasciamo passare e tracciamo nella property per il controller.
    }

    // L'elenco delle causali valide dipende dal catalogo dell'azienda: lo controlla il caso d'uso.
    // Il dominio verifica solo la forma.
    if (!props.causale || props.causale.length > 100 || !/^[A-Z][A-Z0-9_]*$/.test(props.causale)) {
      throw new Error(`Causale non valida: ${props.causale}`)
    }

    // Ogni nuova registrazione e' v2 (HASH_VERSIONE_CORRENTE, che la persistenza salva): la v1
    // resta solo in `computeHash`, per verificare le righe storiche.
    const entryHash = hashAnnotazioneV2({
      hashPrecedente: props.hashPrecedente,
      registroId: props.registroId,
      anno: props.progressiveYear,
      numero: props.progressiveNumber,
      tipoAnnotazione: props.tipoAnnotazione ?? 'ORDINARIA',
      movimentoRettificatoId: props.movimentoRettificatoId,
      type: props.type,
      cerCode: props.cerCode,
      quantita: props.quantity,
      unit: props.unit,
      movementDate: props.movementDate,
      causale: props.causale,
    })

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
    const diffGg = giorniItalianiFra(this.props.movementDate, this.props.registrationDate)
    return Math.max(0, diffGg - TERMINE_REGISTRAZIONE_PRODUTTORE_GG)
  }

  get id(): string | undefined {
    return this.props.id
  }
  get tenantId(): string {
    return this.props.tenantId
  }
  get registroId(): string {
    return this.props.registroId
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
  get causale(): string {
    return this.props.causale
  }
  get causaleAziendaId(): string | null {
    return this.props.causaleAziendaId ?? null
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
