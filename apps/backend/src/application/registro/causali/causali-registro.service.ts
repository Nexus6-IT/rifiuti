import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { giornoItaliano } from '../../../core/time/anno-italiano'
import {
  PREFISSO_CAUSALE_AZIENDA,
  type RuoloMudCausale,
  type VersoCausale,
} from '../../../domain/waste-movement/catalogo-causali'
import { caricaCatalogoCausali, dataColonnaComeGiorno } from './catalogo-causali.repository'

// ---------------------------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------------------------

/** Una versione di una causale dell'azienda, con le date come `AAAA-MM-GG`. */
export interface CausalePropriaVista {
  id: string
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  validaDal: string
  validaAl: string | null
  /** Le registrazioni con questa causale diventano candidate alla fatturazione (4.3). */
  fatturabile: boolean
}

export interface CausalePropriaInGestione extends CausalePropriaVista {
  /** Esiste almeno un'annotazione (anche rettificata o annullamento) che la referenzia. */
  usata: boolean
  /** Giorno italiano dell'ultima annotazione che la usa; null se mai usata. */
  ultimoGiornoUso: string | null
}

export interface CausaleSistemaInGestione {
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  attiva: boolean
  disattivataPerAzienda: boolean
  /** Sola lettura: il flag di una causale di sistema non si cambia per azienda (decisione 14). */
  fatturabile: boolean
}

export interface GestioneCausali {
  sistema: CausaleSistemaInGestione[]
  aziendali: CausalePropriaInGestione[]
}

export interface OpzioneCausale {
  codice: string
  descrizione: string
  origine: 'SISTEMA' | 'AZIENDA'
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  versioneId: string | null
  fatturabile: boolean
}

export interface DatiNuovaCausale {
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri?: string | null
  operazione?: string | null
  ordine?: number
  /** Assente = `false`. */
  fatturabile?: boolean
  /** `AAAA-MM-GG`; assente = oggi (giorno italiano). */
  validaDal?: string
}

/** PATCH: campo assente (`undefined`) = invariato; `null` = azzera, solo dove il campo e' nullable. */
export interface DatiModificaCausale {
  descrizione?: string
  ordine?: number
  ruoloMud?: RuoloMudCausale
  codiceRentri?: string | null
  operazione?: string | null
  validaDal?: string | null
  /** Su una versione gia usata cambiarlo e un cambio di comportamento: serve una nuova versione. */
  fatturabile?: boolean
}

export interface DatiNuovaVersione {
  validaDal: string
  ruoloMud: RuoloMudCausale
  /** Assenti = NULL: il comportamento verso RENTRI e l'operazione non si copiano. */
  codiceRentri?: string | null
  operazione?: string | null
  /** Assenti = copiati dalla versione precedente. */
  descrizione?: string
  ordine?: number
  /** Assente = ereditato dall'ultima versione. */
  fatturabile?: boolean
}

type Client = Prisma.TransactionClient

/** Riga di una versione letta con `FOR UPDATE`. */
interface RigaVersione {
  id: string
  codice: string
  verso: VersoCausale
  descrizione: string
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  validaDal: string
  validaAl: string | null
  fatturabile: boolean
}

interface RigaVersioneSql {
  id: string
  codice: string
  verso: string
  descrizione: string | null
  ruolo_mud: string | null
  codice_rentri: string | null
  operazione: string | null
  ordine: number
  valida_dal: Date | null
  valida_al: Date | null
  fatturabile: boolean | null
}

interface RigaUso {
  id: string
  movimenti: number
  ultimo_giorno_uso: Date | null
}

// ---------------------------------------------------------------------------------------------
// Regole pure
// ---------------------------------------------------------------------------------------------

const RUOLI_PER_VERSO: Record<VersoCausale, readonly RuoloMudCausale[]> = {
  CARICO: ['PRODOTTO', 'RICEVUTO_DA_TERZI', 'ESCLUSO'],
  SCARICO: ['AVVIATO', 'ESCLUSO'],
}

/** Gli stessi valori dei CHECK del database: TR e T*aT non ci sono (sono CaricoScarico). */
const RENTRI_PER_VERSO: Record<VersoCausale, readonly string[]> = {
  CARICO: ['DT', 'NP', 'T*', 'RE'],
  SCARICO: ['I', 'aT', 'M'],
}

const CODICE_PROPRIO = /^AZ_[A-Z0-9_]{2,40}$/
const GIORNI_AVANTI_MASSIMI = 365
const ORDINE_PREDEFINITO = 100
const ORDINE_MASSIMO = 32767

const ERR_RUOLO = 'Il ruolo nel MUD non è coerente con il tipo di movimento.'
const ERR_OPERAZIONE =
  "L'operazione R/D vale solo per gli scarichi avviati a recupero o smaltimento."
/** SQLSTATE di una violazione di vincolo (classe 23) o di un RAISE EXCEPTION (P0001). */
function eViolazioneDiDato(sqlstate: unknown): boolean {
  return typeof sqlstate === 'string' && (sqlstate === 'P0001' || /^23[0-9A-Z]{3}$/.test(sqlstate))
}

const ERR_GENERICO = 'I dati della causale non sono validi.'

export function eVerso(valore: unknown): valore is VersoCausale {
  return valore === 'CARICO' || valore === 'SCARICO'
}

function eRuolo(valore: unknown): valore is RuoloMudCausale {
  return (
    valore === 'PRODOTTO' ||
    valore === 'AVVIATO' ||
    valore === 'RICEVUTO_DA_TERZI' ||
    valore === 'ESCLUSO'
  )
}

/** `AAAA-MM-GG` di un giorno di calendario che esiste davvero (31/02 no). */
export function eGiornoValido(valore: unknown): valore is string {
  if (typeof valore !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valore)) return false
  const d = new Date(`${valore}T00:00:00.000Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valore
}

export function giornoPiuGiorni(giorno: string, n: number): string {
  const d = new Date(`${giorno}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function comeData(giorno: string): Date {
  return new Date(`${giorno}T00:00:00.000Z`)
}

function inItaliano(giorno: string): string {
  const [a, m, g] = giorno.split('-')
  return `${g}/${m}/${a}`
}

export interface RecordCausale {
  verso: VersoCausale
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
}

/** Coerenza verso/ruolo/RENTRI/operazione sul record RISULTANTE (stessi vincoli dei CHECK). */
export function validaCoerenza(r: RecordCausale): void {
  if (!RUOLI_PER_VERSO[r.verso].includes(r.ruoloMud)) throw new BadRequestException(ERR_RUOLO)
  if (r.codiceRentri !== null && !RENTRI_PER_VERSO[r.verso].includes(r.codiceRentri)) {
    throw new BadRequestException(
      `Il codice RENTRI non è ammesso per un ${r.verso === 'CARICO' ? 'carico' : 'scarico'}: ` +
        `valori ammessi ${RENTRI_PER_VERSO[r.verso].join(', ')}.`
    )
  }
  if (r.operazione !== null) {
    const coerente = r.verso === 'SCARICO' && r.ruoloMud === 'AVVIATO'
    if (!coerente || (r.operazione !== 'R' && r.operazione !== 'D')) {
      throw new BadRequestException(ERR_OPERAZIONE)
    }
  }
}

/** Testo nullable: `undefined`/`null` -> null, stringa vuota -> null, altrimenti trim. */
function testoONull(valore: unknown, nome: string): string | null {
  if (valore === undefined || valore === null) return null
  if (typeof valore !== 'string') throw new BadRequestException(`${nome} non è valido.`)
  const t = valore.trim()
  return t === '' ? null : t
}

function descrizioneValida(valore: unknown): string {
  if (typeof valore !== 'string' || valore.trim() === '') {
    throw new BadRequestException('La descrizione è obbligatoria.')
  }
  const t = valore.trim()
  if (t.length > 200) {
    throw new BadRequestException('La descrizione può avere al massimo 200 caratteri.')
  }
  return t
}

function ordineValido(valore: unknown): number {
  if (
    typeof valore !== 'number' ||
    !Number.isInteger(valore) ||
    valore < 0 ||
    valore > ORDINE_MASSIMO
  ) {
    throw new BadRequestException(`L'ordine deve essere un intero tra 0 e ${ORDINE_MASSIMO}.`)
  }
  return valore
}

const ERR_FATTURABILE = 'Il flag fatturabile deve essere true o false.'

function fatturabileValido(valore: unknown): boolean {
  if (typeof valore !== 'boolean') throw new BadRequestException(ERR_FATTURABILE)
  return valore
}

function ruoloValido(valore: unknown): RuoloMudCausale {
  if (!eRuolo(valore)) throw new BadRequestException('Il ruolo nel MUD non è valido.')
  return valore
}

function dataIniziale(valore: unknown, oggi: string): string {
  if (!eGiornoValido(valore)) {
    throw new BadRequestException('La data di inizio non è valida (formato AAAA-MM-GG).')
  }
  if (valore > giornoPiuGiorni(oggi, GIORNI_AVANTI_MASSIMI)) {
    throw new BadRequestException(
      `La data di inizio non può essere oltre ${GIORNI_AVANTI_MASSIMI} giorni da oggi.`
    )
  }
  return valore
}

// ---------------------------------------------------------------------------------------------
// Servizio
// ---------------------------------------------------------------------------------------------

/**
 * Gestione delle causali del registro per gli ADMIN dell'azienda (Fase 2 pezzo 5, C5).
 *
 * Ogni scrittura e' una transazione che prende `pg_advisory_xact_lock` sulla causale
 * (`causale|tenant|verso|codice`) e, se tocca una versione esistente, la rilegge con
 * `SELECT ... FOR UPDATE`: il `FOR UPDATE` attende le registrazioni in corso, che tengono un
 * `FOR KEY SHARE` sulla versione (`confermaVersioneAzienda` e la chiave esterna del movimento),
 * e dopo la loro commit la query sull'uso vede i movimenti appena inseriti. Una registrazione che
 * arriva dopo attende il nostro commit e, rileggendo la versione, trova la modifica -> 409
 * `CAUSALE_MODIFICATA`.
 *
 * ORDINE DEI LOCK. Questo servizio NON prende gli advisory lock del progressivo ne' della
 * giacenza: solo il proprio advisory lock di causale e il `FOR UPDATE` della riga. La registrazione
 * prende progressivo e giacenza e poi il `FOR KEY SHARE` sulla versione, e NON prende mai il lock
 * di causale: i due percorsi non hanno lock in comune presi in ordine opposto, quindi non
 * si crea un ciclo.
 *
 * Le righe dei movimenti si leggono per sapere se una versione e' "usata" e il suo ultimo giorno
 * d'uso: ogni annotazione conta (rettificate e annullamenti compresi), non solo le vigenti.
 */
@Injectable()
export class CausaliRegistroService {
  constructor(private readonly prisma: PrismaService) {}

  /** Causali selezionabili per un verso a un giorno (`AAAA-MM-GG`); assente = oggi. */
  async opzioni(tenantId: string, verso: VersoCausale, giorno?: string): Promise<OpzioneCausale[]> {
    const g = giorno ?? giornoItaliano(new Date())
    const catalogo = await caricaCatalogoCausali(this.prisma, tenantId)
    return catalogo.opzioni(verso, g).map(o => ({
      codice: o.codice,
      descrizione: o.descrizione,
      origine: o.origine,
      ruoloMud: o.ruoloMud,
      codiceRentri: o.codiceRentri,
      operazione: o.operazione,
      versioneId: o.versioneId,
      fatturabile: o.fatturabile,
    }))
  }

  /** Vista di gestione: tutte le causali di sistema e tutte le versioni dell'azienda. */
  async gestione(tenantId: string): Promise<GestioneCausali> {
    return this.prisma.$transaction(async tx => {
      const sistema = await tx.causaleRegistro.findMany({
        orderBy: [{ verso: 'asc' }, { ordine: 'asc' }],
      })
      const personalizzazioni = await tx.causaleRegistroAzienda.findMany({
        where: { tenantId, natura: 'DISATTIVAZIONE' },
        select: { codice: true, verso: true },
      })
      const versioni = await tx.causaleRegistroAzienda.findMany({
        where: { tenantId, natura: 'PROPRIA' },
        orderBy: [{ codice: 'asc' }, { verso: 'asc' }, { validaDal: 'asc' }],
      })
      const uso = await this.usoVersioni(tx, tenantId)
      const disattivate = new Set(personalizzazioni.map(p => `${p.verso}|${p.codice}`))
      return {
        sistema: sistema.map(s => ({
          codice: s.codice,
          verso: s.verso as VersoCausale,
          descrizione: s.descrizione,
          ruoloMud: s.ruoloMud as RuoloMudCausale,
          codiceRentri: s.codiceRentri,
          operazione: s.operazione,
          ordine: s.ordine,
          attiva: s.attiva,
          disattivataPerAzienda: disattivate.has(`${s.verso}|${s.codice}`),
          fatturabile: s.fatturabile,
        })),
        aziendali: versioni.map(v => {
          const u = uso.get(v.id)
          return {
            id: v.id,
            codice: v.codice,
            verso: v.verso as VersoCausale,
            descrizione: v.descrizione ?? '',
            ruoloMud: v.ruoloMud as RuoloMudCausale,
            codiceRentri: v.codiceRentri,
            operazione: v.operazione,
            ordine: v.ordine,
            validaDal: dataColonnaComeGiorno(v.validaDal as Date),
            validaAl: dataColonnaComeGiorno(v.validaAl),
            fatturabile: v.fatturabile ?? false,
            usata: (u?.movimenti ?? 0) > 0,
            ultimoGiornoUso: u?.ultimoGiornoUso ?? null,
          }
        }),
      }
    })
  }

  /** Disattiva per l'azienda una causale di sistema. Idempotente. */
  async disattiva(
    tenantId: string,
    userId: string,
    verso: VersoCausale,
    codice: string
  ): Promise<void> {
    await this.esegui(async tx => {
      const sistema = await tx.causaleRegistro.findFirst({ where: { codice, verso } })
      if (!sistema) throw new NotFoundException('Causale di sistema non trovata.')
      await this.bloccaCausale(tx, tenantId, verso, codice)
      const esistente = await tx.causaleRegistroAzienda.findFirst({
        where: { tenantId, natura: 'DISATTIVAZIONE', codice, verso },
      })
      if (esistente) return
      const riga = await tx.causaleRegistroAzienda.create({
        data: {
          tenantId,
          natura: 'DISATTIVAZIONE',
          codice,
          verso,
          causaleSistemaCodice: codice,
          // Il DEFAULT del database e' false: per una DISATTIVAZIONE il flag resta NULL (spec §4.1).
          fatturabile: null,
          creatoDa: userId,
        },
      })
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_DISATTIVATA', {
        description: `Causale di sistema ${codice} (${verso}) disattivata per l'azienda`,
        metadata: { codice, verso, id: riga.id },
      })
    })
  }

  /** Riattiva una causale di sistema disattivata. Idempotente. */
  async riattiva(
    tenantId: string,
    userId: string,
    verso: VersoCausale,
    codice: string
  ): Promise<void> {
    await this.esegui(async tx => {
      const sistema = await tx.causaleRegistro.findFirst({ where: { codice, verso } })
      if (!sistema) throw new NotFoundException('Causale di sistema non trovata.')
      await this.bloccaCausale(tx, tenantId, verso, codice)
      const { count } = await tx.causaleRegistroAzienda.deleteMany({
        where: { tenantId, natura: 'DISATTIVAZIONE', codice, verso },
      })
      if (count === 0) return
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_RIATTIVATA', {
        description: `Causale di sistema ${codice} (${verso}) riattivata per l'azienda`,
        metadata: { codice, verso },
      })
    })
  }

  async crea(
    tenantId: string,
    userId: string,
    dati: DatiNuovaCausale
  ): Promise<CausalePropriaVista> {
    const oggi = giornoItaliano(new Date())
    if (typeof dati.codice !== 'string' || !CODICE_PROPRIO.test(dati.codice)) {
      throw new BadRequestException(
        `Il codice deve iniziare con ${PREFISSO_CAUSALE_AZIENDA} e contenere solo lettere maiuscole, ` +
          'cifre e underscore (da 2 a 40 caratteri dopo il prefisso).'
      )
    }
    if (!eVerso(dati.verso)) throw new BadRequestException('Il tipo di movimento non è valido.')
    const descrizione = descrizioneValida(dati.descrizione)
    const ruoloMud = ruoloValido(dati.ruoloMud)
    const codiceRentri = testoONull(dati.codiceRentri, 'Il codice RENTRI')
    const operazione = testoONull(dati.operazione, "L'operazione")
    const ordine = dati.ordine === undefined ? ORDINE_PREDEFINITO : ordineValido(dati.ordine)
    const fatturabile = dati.fatturabile === undefined ? false : fatturabileValido(dati.fatturabile)
    const validaDal = dati.validaDal === undefined ? oggi : dataIniziale(dati.validaDal, oggi)
    validaCoerenza({ verso: dati.verso, ruoloMud, codiceRentri, operazione })

    return this.esegui(async tx => {
      await this.bloccaCausale(tx, tenantId, dati.verso, dati.codice)
      const esistenti = await tx.causaleRegistroAzienda.count({
        where: { tenantId, natura: 'PROPRIA', codice: dati.codice, verso: dati.verso },
      })
      if (esistenti > 0) {
        throw new ConflictException({
          message:
            'Esiste già una causale con questo codice per questo tipo di movimento: ' +
            'per cambiarla crea una nuova versione.',
          error: 'CAUSALE_ESISTENTE',
        })
      }
      const riga = await tx.causaleRegistroAzienda.create({
        data: {
          tenantId,
          natura: 'PROPRIA',
          codice: dati.codice,
          verso: dati.verso,
          descrizione,
          ruoloMud,
          codiceRentri,
          operazione,
          ordine,
          fatturabile,
          validaDal: comeData(validaDal),
          creatoDa: userId,
        },
      })
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_CREATA', {
        description: `Causale ${dati.codice} (${dati.verso}) creata, valida dal ${inItaliano(validaDal)}`,
        metadata: { codice: dati.codice, verso: dati.verso, id: riga.id, validaDal, fatturabile },
      })
      return this.comeVista({
        id: riga.id,
        codice: riga.codice,
        verso: dati.verso,
        descrizione,
        ruoloMud,
        codiceRentri,
        operazione,
        ordine,
        validaDal,
        validaAl: null,
        fatturabile,
      })
    })
  }

  async modifica(
    tenantId: string,
    userId: string,
    id: string,
    patch: DatiModificaCausale
  ): Promise<CausalePropriaVista> {
    const oggi = giornoItaliano(new Date())
    // Validazione dei campi presenti, prima di toccare il database. `null` e' ammesso solo per
    // codiceRentri e operazione: per gli altri campi e' un 400.
    const nonNullable = [patch.descrizione, patch.ordine, patch.ruoloMud, patch.validaDal]
    if (nonNullable.some(v => v === null)) {
      throw new BadRequestException(
        'Descrizione, ordine, ruolo MUD e data di inizio non si possono azzerare.'
      )
    }
    if (patch.descrizione !== undefined) descrizioneValida(patch.descrizione)
    if (patch.ordine !== undefined) ordineValido(patch.ordine)
    if (patch.ruoloMud !== undefined) ruoloValido(patch.ruoloMud)
    if (patch.fatturabile !== undefined) fatturabileValido(patch.fatturabile)
    if (patch.validaDal !== undefined && patch.validaDal !== null) {
      dataIniziale(patch.validaDal, oggi)
    }
    const codiceRentriNuovo =
      patch.codiceRentri === undefined
        ? undefined
        : testoONull(patch.codiceRentri, 'Il codice RENTRI')
    const operazioneNuova =
      patch.operazione === undefined ? undefined : testoONull(patch.operazione, "L'operazione")

    return this.esegui(async tx => {
      const attuale = await this.bloccaVersione(tx, tenantId, id)
      const uso = (await this.usoVersioni(tx, tenantId, id)).get(id)
      const usata = (uso?.movimenti ?? 0) > 0

      const risultante: RigaVersione = {
        ...attuale,
        descrizione:
          patch.descrizione === undefined
            ? attuale.descrizione
            : descrizioneValida(patch.descrizione),
        ordine: patch.ordine === undefined ? attuale.ordine : ordineValido(patch.ordine),
        ruoloMud: patch.ruoloMud === undefined ? attuale.ruoloMud : ruoloValido(patch.ruoloMud),
        codiceRentri: codiceRentriNuovo === undefined ? attuale.codiceRentri : codiceRentriNuovo,
        operazione: operazioneNuova === undefined ? attuale.operazione : operazioneNuova,
        validaDal:
          patch.validaDal === undefined || patch.validaDal === null
            ? attuale.validaDal
            : patch.validaDal,
        fatturabile: patch.fatturabile === undefined ? attuale.fatturabile : patch.fatturabile,
      }

      const cambiaComportamento =
        risultante.ruoloMud !== attuale.ruoloMud ||
        risultante.codiceRentri !== attuale.codiceRentri ||
        risultante.operazione !== attuale.operazione ||
        risultante.validaDal !== attuale.validaDal ||
        risultante.fatturabile !== attuale.fatturabile
      if (usata && cambiaComportamento) {
        throw new ConflictException({
          message:
            'Questa causale è già usata nel registro: per cambiarne il comportamento crea una ' +
            'nuova versione con una data di inizio.',
          error: 'CAUSALE_USATA_NUOVA_VERSIONE',
        })
      }

      validaCoerenza(risultante)
      if (risultante.validaAl !== null && risultante.validaDal > risultante.validaAl) {
        throw new BadRequestException(
          'La data di inizio non può essere successiva alla data di fine.'
        )
      }
      if (risultante.validaDal !== attuale.validaDal) {
        await this.verificaSovrapposizione(tx, tenantId, risultante)
      }

      await tx.causaleRegistroAzienda.update({
        where: { id },
        data: {
          descrizione: risultante.descrizione,
          ordine: risultante.ordine,
          ruoloMud: risultante.ruoloMud,
          codiceRentri: risultante.codiceRentri,
          operazione: risultante.operazione,
          validaDal: comeData(risultante.validaDal),
          fatturabile: risultante.fatturabile,
        },
      })
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_MODIFICATA', {
        description: `Causale ${attuale.codice} (${attuale.verso}) modificata`,
        metadata: {
          codice: attuale.codice,
          verso: attuale.verso,
          id,
          validaDal: risultante.validaDal,
          validaAl: risultante.validaAl,
          fatturabile: risultante.fatturabile,
          fatturabilePrecedente: attuale.fatturabile,
        },
      })
      return this.comeVista(risultante)
    })
  }

  /** Nuova versione, solo dall'ultima della coppia (codice, verso). */
  async nuovaVersione(
    tenantId: string,
    userId: string,
    id: string,
    dati: DatiNuovaVersione
  ): Promise<CausalePropriaVista> {
    const oggi = giornoItaliano(new Date())
    const validaDal = dataIniziale(dati.validaDal, oggi)
    const ruoloMud = ruoloValido(dati.ruoloMud)
    const codiceRentri = testoONull(dati.codiceRentri, 'Il codice RENTRI')
    const operazione = testoONull(dati.operazione, "L'operazione")
    const descrizioneIndicata =
      dati.descrizione === undefined ? undefined : descrizioneValida(dati.descrizione)
    const ordineIndicato = dati.ordine === undefined ? undefined : ordineValido(dati.ordine)
    const fatturabileIndicato =
      dati.fatturabile === undefined ? undefined : fatturabileValido(dati.fatturabile)

    return this.esegui(async tx => {
      const base = await this.bloccaVersione(tx, tenantId, id)
      const versioni = await tx.causaleRegistroAzienda.findMany({
        where: { tenantId, natura: 'PROPRIA', codice: base.codice, verso: base.verso },
        orderBy: { validaDal: 'asc' },
      })
      const ultima = versioni[versioni.length - 1]
      if (!ultima || ultima.id !== id) {
        throw new ConflictException({
          message: "La nuova versione si crea solo a partire dall'ultima versione della causale.",
          error: 'CAUSALE_NON_ULTIMA_VERSIONE',
        })
      }
      const ultimaDal = dataColonnaComeGiorno(ultima.validaDal as Date)
      const ultimaAl = dataColonnaComeGiorno(ultima.validaAl)
      if (validaDal <= ultimaDal) {
        throw new BadRequestException(
          `La nuova versione deve iniziare dopo il ${inItaliano(ultimaDal)}, inizio della versione attuale.`
        )
      }
      validaCoerenza({ verso: base.verso, ruoloMud, codiceRentri, operazione })

      let chiusa: string | null = null
      if (ultimaAl === null) {
        // Prima l'UPDATE di chiusura, poi l'INSERT: nell'ordine inverso il trigger vedrebbe
        // le due versioni sovrapposte.
        chiusa = giornoPiuGiorni(validaDal, -1)
        const ultimoUso =
          (await this.usoVersioni(tx, tenantId, id)).get(id)?.ultimoGiornoUso ?? null
        if (ultimoUso !== null && chiusa < ultimoUso) {
          throw this.erroreUltimoUso(ultimoUso, 'nuova versione')
        }
        await tx.causaleRegistroAzienda.update({
          where: { id },
          data: { validaAl: comeData(chiusa) },
        })
      } else if (validaDal <= ultimaAl) {
        throw new ConflictException({
          message: `La nuova versione deve iniziare dopo il ${inItaliano(ultimaAl)}, fine della versione attuale.`,
          error: 'CAUSALE_SOVRAPPOSTA',
        })
      }

      const descrizione = descrizioneIndicata ?? ultima.descrizione ?? ''
      const ordine = ordineIndicato ?? ultima.ordine
      const fatturabile = fatturabileIndicato ?? ultima.fatturabile ?? false
      const nuova = await tx.causaleRegistroAzienda.create({
        data: {
          tenantId,
          natura: 'PROPRIA',
          codice: base.codice,
          verso: base.verso,
          descrizione,
          ruoloMud,
          codiceRentri,
          operazione,
          ordine,
          fatturabile,
          validaDal: comeData(validaDal),
          creatoDa: userId,
        },
      })
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_VERSIONATA', {
        description: `Causale ${base.codice} (${base.verso}): nuova versione dal ${inItaliano(validaDal)}`,
        metadata: {
          codice: base.codice,
          verso: base.verso,
          versionePrecedenteId: id,
          versioneNuovaId: nuova.id,
          precedenteChiusaAl: chiusa ?? ultimaAl,
          validaDal,
          fatturabile,
          fatturabilePrecedente: ultima.fatturabile ?? false,
        },
      })
      return this.comeVista({
        id: nuova.id,
        codice: base.codice,
        verso: base.verso,
        descrizione,
        ruoloMud,
        codiceRentri,
        operazione,
        ordine,
        validaDal,
        validaAl: null,
        fatturabile,
      })
    })
  }

  /** Imposta la fine di validita' di una versione. */
  async chiudi(
    tenantId: string,
    userId: string,
    id: string,
    validaAl: string
  ): Promise<CausalePropriaVista> {
    if (!eGiornoValido(validaAl)) {
      throw new BadRequestException('La data di fine non è valida (formato AAAA-MM-GG).')
    }
    return this.esegui(async tx => {
      const attuale = await this.bloccaVersione(tx, tenantId, id)
      if (validaAl < attuale.validaDal) {
        throw new BadRequestException(
          `La data di fine non può precedere l'inizio di validità (${inItaliano(attuale.validaDal)}).`
        )
      }
      const ultimoUso = (await this.usoVersioni(tx, tenantId, id)).get(id)?.ultimoGiornoUso ?? null
      if (ultimoUso !== null && validaAl < ultimoUso) {
        throw this.erroreUltimoUso(ultimoUso, 'chiusura')
      }
      const risultante: RigaVersione = { ...attuale, validaAl }
      await this.verificaSovrapposizione(tx, tenantId, risultante)
      await tx.causaleRegistroAzienda.update({
        where: { id },
        data: { validaAl: comeData(validaAl) },
      })
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_CHIUSA', {
        description: `Causale ${attuale.codice} (${attuale.verso}) chiusa al ${inItaliano(validaAl)}`,
        metadata: { codice: attuale.codice, verso: attuale.verso, id, validaAl },
      })
      return this.comeVista(risultante)
    })
  }

  /**
   * Elimina una versione mai usata. La precedente NON si riapre: resta chiusa com'era (per
   * riaprire si crea una nuova versione).
   */
  async elimina(tenantId: string, userId: string, id: string): Promise<void> {
    await this.esegui(async tx => {
      const attuale = await this.bloccaVersione(tx, tenantId, id)
      const uso = (await this.usoVersioni(tx, tenantId, id)).get(id)
      if ((uso?.movimenti ?? 0) > 0) throw this.erroreNonEliminabile()
      try {
        await tx.causaleRegistroAzienda.delete({ where: { id } })
      } catch (err) {
        // Rete di sicurezza: la chiave esterna NoAction dei movimenti.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          throw this.erroreNonEliminabile()
        }
        throw err
      }
      await this.audit(tx, tenantId, userId, 'REGISTRO_CAUSALE_ELIMINATA', {
        description: `Causale ${attuale.codice} (${attuale.verso}) eliminata (versione dal ${inItaliano(attuale.validaDal)})`,
        metadata: {
          codice: attuale.codice,
          verso: attuale.verso,
          id,
          validaDal: attuale.validaDal,
          validaAl: attuale.validaAl,
        },
      })
    })
  }

  // -------------------------------------------------------------------------------------------

  /** Transazione che traduce gli errori del database in 400/409 senza il loro testo. */
  private async esegui<T>(fn: (tx: Client) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(fn)
    } catch (err) {
      throw this.comeErroreHttp(err)
    }
  }

  /**
   * Rete di sicurezza: per le stesse condizioni il servizio risponde prima con un 409 dal codice
   * specifico (CAUSALE_SOVRAPPOSTA, CAUSALE_USATA_NUOVA_VERSIONE, CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO...),
   * grazie al lock e al FOR UPDATE. La violazione del trigger o dei CHECK, tradotta qui in un 400
   * generico, non si raggiunge quindi nel percorso normale: serve solo a non mostrare mai il testo
   * del database se un giorno si raggiunge.
   */
  private comeErroreHttp(err: unknown): unknown {
    if (err instanceof HttpException) return err
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return new ConflictException({
          message: 'Esiste già una causale con questo codice e questa data di inizio.',
          error: 'CAUSALE_ESISTENTE',
        })
      }
      if (err.code === 'P2003') return this.erroreNonEliminabile()
      if (['P2004', 'P2011', 'P2000'].includes(err.code)) {
        return new BadRequestException(ERR_GENERICO)
      }
      // P2010 e' l'involucro di Prisma per ogni errore di una query raw: solo se lo SQLSTATE
      // sottostante e' una violazione di vincolo (classe 23) o un RAISE EXCEPTION del trigger
      // (P0001) e' un dato non valido. Deadlock (40P01), lock timeout (55P03) e simili sono
      // errori di esercizio e passano invariati (500).
      if (
        err.code === 'P2010' &&
        eViolazioneDiDato((err.meta as { code?: unknown } | undefined)?.code)
      ) {
        return new BadRequestException(ERR_GENERICO)
      }
    }
    // Violazione del trigger o dei CHECK arrivata come errore sconosciuto: mai il testo del database.
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      /causali_registro/.test(err.message)
    ) {
      return new BadRequestException(ERR_GENERICO)
    }
    return err
  }

  private erroreNonEliminabile(): ConflictException {
    return new ConflictException({
      message:
        'Questa causale è già usata nel registro e non si può eliminare: puoi chiuderla con una ' +
        'data di fine.',
      error: 'CAUSALE_USATA_NON_ELIMINABILE',
    })
  }

  private erroreUltimoUso(ultimoUso: string, azione: 'chiusura' | 'nuova versione') {
    const prima = azione === 'chiusura' ? ultimoUso : giornoPiuGiorni(ultimoUso, 1)
    return new ConflictException({
      message:
        `La causale è già stata usata fino al ${inItaliano(ultimoUso)}: la ${azione} ` +
        `${azione === 'chiusura' ? 'non può avere effetto prima di quel giorno' : 'non può iniziare entro quel giorno'} ` +
        `(prima data ammessa: ${inItaliano(prima)}).`,
      error: 'CAUSALE_DATA_PRIMA_DELL_ULTIMO_USO',
    })
  }

  /** Advisory lock che serializza le scritture sulla stessa causale (e non altro). */
  private async bloccaCausale(
    tx: Client,
    tenantId: string,
    verso: string,
    codice: string
  ): Promise<void> {
    const chiave = `causale|${tenantId}|${verso}|${codice}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }

  /**
   * Lock di una versione esistente: legge codice e verso (senza lock), prende l'advisory lock della
   * causale e rilegge la riga con `FOR UPDATE`. Id inesistente o di un'altra azienda -> 404.
   */
  private async bloccaVersione(tx: Client, tenantId: string, id: string): Promise<RigaVersione> {
    const trovata = await tx.$queryRaw<Array<{ codice: string; verso: string }>>`
      SELECT codice, verso::text AS verso
      FROM causali_registro_azienda
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND natura = 'PROPRIA'`
    if (trovata.length === 0) throw new NotFoundException('Causale non trovata.')
    await this.bloccaCausale(tx, tenantId, trovata[0].verso, trovata[0].codice)
    const righe = await tx.$queryRaw<RigaVersioneSql[]>`
      SELECT id::text AS id, codice, verso::text AS verso, descrizione,
             ruolo_mud::text AS ruolo_mud, codice_rentri, operazione,
             ordine::int AS ordine, valida_dal, valida_al, fatturabile
      FROM causali_registro_azienda
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND natura = 'PROPRIA'
      FOR UPDATE`
    if (righe.length === 0) throw new NotFoundException('Causale non trovata.')
    const r = righe[0]
    return {
      id: r.id,
      codice: r.codice,
      verso: r.verso as VersoCausale,
      descrizione: r.descrizione ?? '',
      ruoloMud: r.ruolo_mud as RuoloMudCausale,
      codiceRentri: r.codice_rentri,
      operazione: r.operazione,
      ordine: r.ordine,
      validaDal: dataColonnaComeGiorno(r.valida_dal as Date),
      validaAl: dataColonnaComeGiorno(r.valida_al),
      fatturabile: r.fatturabile ?? false,
    }
  }

  /**
   * Uso delle versioni dell'azienda: una sola query sui movimenti (tutte le annotazioni, anche
   * rettificate e annullamenti). Il giorno italiano e' l'unica espressione ammessa (C5).
   */
  private async usoVersioni(
    tx: Client,
    tenantId: string,
    id?: string
  ): Promise<Map<string, { movimenti: number; ultimoGiornoUso: string | null }>> {
    const filtro = id ? Prisma.sql`AND c.id = ${id}::uuid` : Prisma.empty
    const righe = await tx.$queryRaw<RigaUso[]>`
      SELECT c.id::text AS id,
             count(m.id)::int AS movimenti,
             max((m.movement_date AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Rome')::date) AS ultimo_giorno_uso
      FROM causali_registro_azienda c
      LEFT JOIN waste_movements m
        ON m.causale_azienda_id = c.id AND m.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenantId}::uuid AND c.natura = 'PROPRIA' ${filtro}
      GROUP BY c.id`
    return new Map(
      righe.map(r => [
        r.id,
        { movimenti: r.movimenti, ultimoGiornoUso: dataColonnaComeGiorno(r.ultimo_giorno_uso) },
      ])
    )
  }

  /** Il periodo risultante non deve sovrapporsi alle altre versioni della stessa causale. */
  private async verificaSovrapposizione(
    tx: Client,
    tenantId: string,
    r: RigaVersione
  ): Promise<void> {
    const altre = await tx.causaleRegistroAzienda.findMany({
      where: {
        tenantId,
        natura: 'PROPRIA',
        codice: r.codice,
        verso: r.verso,
        NOT: { id: r.id },
      },
      select: { validaDal: true, validaAl: true },
    })
    const fine = r.validaAl ?? '9999-12-31'
    const sovrapposta = altre.some(a => {
      const aDal = dataColonnaComeGiorno(a.validaDal as Date)
      const aAl = dataColonnaComeGiorno(a.validaAl) ?? '9999-12-31'
      return aDal <= fine && r.validaDal <= aAl
    })
    if (sovrapposta) {
      throw new ConflictException({
        message: "Il periodo di validità si sovrappone a un'altra versione della stessa causale.",
        error: 'CAUSALE_SOVRAPPOSTA',
      })
    }
  }

  private comeVista(r: RigaVersione): CausalePropriaVista {
    return {
      id: r.id,
      codice: r.codice,
      verso: r.verso,
      descrizione: r.descrizione,
      ruoloMud: r.ruoloMud,
      codiceRentri: r.codiceRentri,
      operazione: r.operazione,
      ordine: r.ordine,
      validaDal: r.validaDal,
      validaAl: r.validaAl,
      fatturabile: r.fatturabile,
    }
  }

  private async audit(
    tx: Client,
    tenantId: string,
    userId: string,
    action: string,
    dati: { description: string; metadata: Prisma.InputJsonObject }
  ): Promise<void> {
    await tx.activityLog.create({
      data: { tenantId, userId, action, description: dati.description, metadata: dati.metadata },
    })
  }
}
