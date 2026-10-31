import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { Contract } from '@prisma/client'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

import {
  CAMPI_MODIFICABILI,
  STATI_ELIMINABILI,
  motivoNonEliminabile,
  motivoNonModificabile,
  normalizzaDati,
  pianificaModifica,
  validaDatiContratto,
} from '../../domain/contracts/regole-contratto'
import type {
  CampoContratto,
  ContractStatus,
  ModificaContratto,
} from '../../domain/contracts/regole-contratto'

export type { ContractStatus } from '../../domain/contracts/regole-contratto'

/**
 * Transizioni di stato ammesse del contratto (workflow di approvazione).
 * EXPIRED e TERMINATED sono terminali.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<ContractStatus, ContractStatus[]>> = {
  DRAFT: ['PENDING_APPROVAL', 'TERMINATED'],
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
}

export interface CreateContractInput {
  contractNumber: string
  producerId: string
  counterpartyId: string
  counterpartyType: 'TRANSPORTER' | 'DISPOSER' | 'BROKER'
  contractType: 'WASTE_DISPOSAL' | 'WASTE_TRANSPORT' | 'FULL_SERVICE' | 'FRAMEWORK'
  description?: string
  cerCodes: string[]
  pricingModel: string
  basePrice?: number
  unitOfMeasure?: string
  pricingConfig?: any
  startDate: Date
  endDate?: Date
  durationMonths?: number
  autoRenew?: boolean
  renewalNoticeDays?: number
  paymentTerms?: string
  billingFrequency?: string
}

/** Parte del contratto risolta verso il registro anagrafico. */
export interface ContractParty {
  id: string
  ragioneSociale: string
  partitaIVA: string | null
  codiceFiscale: string | null
}

/** Contratto con produttore e controparte risolti (null se non più in registro). */
export type ContractWithParties<T> = T & {
  producer: ContractParty | null
  counterparty: ContractParty | null
}

/** Suggerimento per l'auto-compilazione di un FIR da contratto attivo. */
export interface FirAutoFill {
  contractId: string
  contractNumber: string
  counterpartyId: string
  counterpartyType: string
  pricingModel: string
  basePrice: number | null
  unitOfMeasure: string
}

export type ContrattoVista = Omit<ContractWithParties<Contract>, 'eliminatoIl' | 'eliminatoDa'> & {
  modificabili: CampoContratto[]
  eliminabile: boolean
}

export interface ModificaContrattoInput extends ModificaContratto {
  versione: number
}

const MSG_FRATTEMPO =
  "Il contratto è stato modificato nel frattempo da un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione."
const MSG_NUMERO_DUPLICATO = 'Esiste già un contratto con questo numero.'

const conflitto = (error: string, message: string) => new ConflictException({ message, error })
const eP2002 = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'

/** Valore di un campo per l'audit: date in ISO, il resto così com'è. */
const perAudit = (v: unknown) => (v instanceof Date ? v.toISOString() : v)

/**
 * Gestione contratti produttore↔controparte: CRUD, workflow di stato e
 * auto-compilazione FIR da contratto attivo. Tenant-scoped.
 *
 * MVP: billing automatico, firma digitale, ottimizzazione AI e integrazione
 * marketplace sono follow-up (vedi docs/planning/CONTRACT_MANAGEMENT_MODULE.md).
 */
@Injectable()
export class ContractService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(ContractService.name)
  }

  async create(tenantId: string, input: CreateContractInput) {
    const dati = normalizzaDati({
      contractNumber: input.contractNumber ?? '',
      producerId: input.producerId,
      counterpartyId: input.counterpartyId,
      counterpartyType: input.counterpartyType,
      contractType: input.contractType,
      description: input.description ?? null,
      cerCodes: input.cerCodes ?? [],
      pricingModel: input.pricingModel,
      basePrice: input.basePrice ?? null,
      unitOfMeasure: input.unitOfMeasure || 'kg',
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      durationMonths: input.durationMonths ?? null,
      autoRenew: input.autoRenew ?? false,
      renewalNoticeDays: input.renewalNoticeDays ?? 60,
      paymentTerms: input.paymentTerms || 'net_30',
      billingFrequency: input.billingFrequency || 'monthly',
    })
    const errori = validaDatiContratto(dati)
    if (errori.length > 0) {
      throw new BadRequestException({ message: errori, error: 'CONTRATTO_NON_VALIDO' })
    }

    await this.assertPartiEsistono(
      tenantId,
      input.producerId,
      input.counterpartyId,
      input.counterpartyType
    )

    try {
      return await this.prisma.contract.create({
        data: {
          tenantId,
          contractNumber: dati.contractNumber,
          producerId: dati.producerId,
          counterpartyId: dati.counterpartyId,
          counterpartyType: dati.counterpartyType as any,
          contractType: dati.contractType as any,
          description: dati.description ?? undefined,
          cerCodes: dati.cerCodes,
          pricingModel: dati.pricingModel as any,
          basePrice: dati.basePrice ?? undefined,
          unitOfMeasure: dati.unitOfMeasure,
          pricingConfig: input.pricingConfig,
          startDate: dati.startDate,
          endDate: dati.endDate ?? undefined,
          durationMonths: dati.durationMonths ?? undefined,
          autoRenew: dati.autoRenew,
          renewalNoticeDays: dati.renewalNoticeDays,
          paymentTerms: dati.paymentTerms,
          billingFrequency: dati.billingFrequency,
          status: 'DRAFT',
        },
      })
    } catch (e) {
      if (eP2002(e)) throw conflitto('CONTRATTO_NUMERO_DUPLICATO', MSG_NUMERO_DUPLICATO)
      throw e
    }
  }

  async list(tenantId: string, status?: ContractStatus): Promise<ContrattoVista[]> {
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, eliminatoIl: null, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    const risolti = await this.risolviParti(tenantId, contracts)
    return risolti.map(c => this.vista(c))
  }

  /** Toglie i campi di cancellazione e aggiunge cosa si può fare in questo stato (D10). */
  private vista(c: ContractWithParties<Contract>): ContrattoVista {
    const { eliminatoIl: _il, eliminatoDa: _da, ...resto } = c
    const stato = c.status as ContractStatus
    return {
      ...resto,
      modificabili: motivoNonModificabile(stato) ? [] : [...CAMPI_MODIFICABILI[stato]],
      eliminabile: motivoNonEliminabile(stato) === null,
    }
  }

  /** Lettura grezza tenant-scoped, senza risoluzione delle parti. */
  private async findOrFail(tenantId: string, id: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId, eliminatoIl: null },
    })
    if (!contract) throw new NotFoundException('Contratto non trovato')
    return contract
  }

  async getById(tenantId: string, id: string): Promise<ContrattoVista> {
    const contract = await this.findOrFail(tenantId, id)
    const [risolto] = await this.risolviParti(tenantId, [contract])
    return this.vista(risolto)
  }

  /**
   * Modifica parziale con lock ottimistico (D4, D7, D8). L'ordine dei controlli e' quello di D4.
   * `motivoNonModificabile` va chiamato SEMPRE prima di `pianificaModifica`: il messaggio di
   * CAMPI_NON_AMMESSI presuppone un contratto attivo o sospeso (gli altri stati senza campi
   * modificabili si fermano prima, con il loro motivo).
   */
  async update(
    tenantId: string,
    utenteId: string,
    id: string,
    input: ModificaContrattoInput
  ): Promise<ContrattoVista> {
    const contract = await this.findOrFail(tenantId, id)
    const stato = contract.status as ContractStatus

    const motivo = motivoNonModificabile(stato)
    if (motivo) throw conflitto('CONTRATTO_NON_MODIFICABILE', motivo)

    if (contract.versione !== input.versione) {
      throw conflitto('CONTRATTO_MODIFICATO_NEL_FRATTEMPO', MSG_FRATTEMPO)
    }

    const { versione: _versione, ...modifica } = input
    const attuale = normalizzaDati(contract)
    const piano = pianificaModifica(stato, attuale, modifica)

    if (piano.esito === 'NESSUNA_MODIFICA') return this.getById(tenantId, id)
    if (piano.esito === 'CAMPI_NON_AMMESSI') {
      throw conflitto('CONTRATTO_CAMPI_NON_AMMESSI', piano.messaggio)
    }
    if (piano.esito === 'NON_VALIDA') {
      throw new BadRequestException({ message: piano.messaggi, error: 'CONTRATTO_NON_VALIDO' })
    }

    const { dopo, cambiati } = piano
    if (
      cambiati.some(c => c === 'producerId' || c === 'counterpartyId' || c === 'counterpartyType')
    ) {
      await this.assertPartiEsistono(
        tenantId,
        dopo.producerId,
        dopo.counterpartyId,
        dopo.counterpartyType
      )
    }

    const prima: Record<string, unknown> = {}
    const dopoAudit: Record<string, unknown> = {}
    const data: Record<string, unknown> = {}
    for (const campo of cambiati) {
      prima[campo] = perAudit(attuale[campo])
      dopoAudit[campo] = perAudit(dopo[campo])
      data[campo] = dopo[campo]
    }

    try {
      await this.prisma.$transaction(async tx => {
        const { count } = await tx.contract.updateMany({
          where: { id, tenantId, versione: contract.versione, eliminatoIl: null },
          data: { ...data, versione: { increment: 1 }, updatedAt: new Date() },
        })
        if (count === 0) throw conflitto('CONTRATTO_MODIFICATO_NEL_FRATTEMPO', MSG_FRATTEMPO)
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'CONTRATTO_MODIFICATO',
            description: `Contratto ${attuale.contractNumber} modificato`,
            metadata: { contrattoId: id, campi: cambiati, prima, dopo: dopoAudit } as any,
          },
        })
      })
    } catch (e) {
      if (eP2002(e)) throw conflitto('CONTRATTO_NUMERO_DUPLICATO', MSG_NUMERO_DUPLICATO)
      throw e
    }

    this.logger.info(`Contratto ${id} modificato: ${cambiati.join(', ')}`)
    return this.getById(tenantId, id)
  }

  /** Cancellazione logica (D3): solo DRAFT e PENDING_APPROVAL, con la versione letta dal client. */
  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    const contract = await this.findOrFail(tenantId, id)
    const stato = contract.status as ContractStatus

    const motivo = motivoNonEliminabile(stato)
    if (motivo) throw conflitto('CONTRATTO_NON_ELIMINABILE', motivo)
    if (contract.versione !== versione) {
      throw conflitto('CONTRATTO_MODIFICATO_NEL_FRATTEMPO', MSG_FRATTEMPO)
    }

    await this.prisma.$transaction(async tx => {
      const { count } = await tx.contract.updateMany({
        where: {
          id,
          tenantId,
          versione: contract.versione,
          eliminatoIl: null,
          status: { in: [...STATI_ELIMINABILI] as any },
        },
        data: {
          eliminatoIl: new Date(),
          eliminatoDa: utenteId,
          versione: { increment: 1 },
          updatedAt: new Date(),
        },
      })
      if (count === 0) throw conflitto('CONTRATTO_MODIFICATO_NEL_FRATTEMPO', MSG_FRATTEMPO)
      await tx.activityLog.create({
        data: {
          tenantId,
          userId: utenteId,
          action: 'CONTRATTO_ELIMINATO',
          description: `Contratto ${contract.contractNumber} eliminato`,
          metadata: { contrattoId: id, numero: contract.contractNumber, stato },
        },
      })
    })
    this.logger.info(`Contratto ${id} eliminato`)
  }

  /**
   * Prossimo numero contratto suggerito: `CTR-<anno>-<progressivo a 3 cifre>`.
   *
   * È un SUGGERIMENTO per la UI, non una prenotazione: l'unicità vera resta
   * garantita dal vincolo @@unique([tenantId, contractNumber]). Il progressivo
   * riparte da 001 a ogni anno nuovo e considera solo i numeri già nel formato
   * canonico, ignorando quelli inseriti a mano con altre convenzioni.
   */
  async nextContractNumber(tenantId: string, now: Date = new Date()): Promise<string> {
    const anno = now.getFullYear()
    const prefisso = `CTR-${anno}-`

    const esistenti = await this.prisma.contract.findMany({
      where: { tenantId, contractNumber: { startsWith: prefisso } },
      select: { contractNumber: true },
    })

    const massimo = esistenti.reduce((max, { contractNumber }) => {
      const coda = contractNumber.slice(prefisso.length)
      // Solo progressivi puramente numerici: "004" conta, "004-bis" no.
      if (!/^\d+$/.test(coda)) return max
      return Math.max(max, Number(coda))
    }, 0)

    return `${prefisso}${String(massimo + 1).padStart(3, '0')}`
  }

  /** Cambia stato applicando le transizioni ammesse del workflow. */
  async changeStatus(
    tenantId: string,
    id: string,
    newStatus: ContractStatus
  ): Promise<ContrattoVista> {
    // Lettura grezza di proposito: il cambio di stato non ha bisogno delle
    // anagrafiche risolte, e interrogarle qui sarebbe lavoro sprecato.
    const contract = await this.findOrFail(tenantId, id)
    const current = contract.status as ContractStatus

    if (current === newStatus) return this.getById(tenantId, id)

    if (!ALLOWED_TRANSITIONS[current].includes(newStatus)) {
      throw new BadRequestException(`Transizione non ammessa: ${current} → ${newStatus}`)
    }

    // Scrittura condizionata sulla versione letta (D1/D7): una modifica o un cambio di stato
    // concorrente fa fallire questa, che risponde 409 invece di sovrascrivere.
    const { count } = await this.prisma.contract.updateMany({
      where: { id, tenantId, versione: contract.versione, eliminatoIl: null },
      data: { status: newStatus as any, versione: { increment: 1 }, updatedAt: new Date() },
    })
    if (count === 0) throw conflitto('CONTRATTO_MODIFICATO_NEL_FRATTEMPO', MSG_FRATTEMPO)
    this.logger.info(`Contratto ${id}: ${current} → ${newStatus}`)
    return this.getById(tenantId, id)
  }

  /** Registro anagrafico in cui cercare una controparte, per tipo. */
  private registroPerTipo(tipo: 'TRANSPORTER' | 'DISPOSER' | 'BROKER') {
    switch (tipo) {
      case 'TRANSPORTER':
        return { delegate: this.prisma.trasportatore, etichetta: 'Trasportatore' }
      case 'DISPOSER':
        return { delegate: this.prisma.destinatario, etichetta: 'Destinatario' }
      default:
        // BROKER non ha un registro dedicato: nessun riferimento da verificare.
        return null
    }
  }

  /**
   * Verifica che produttore e controparte esistano nel registro corretto e
   * nello stesso tenant. Prima che le parti si scegliessero da una tendina si
   * poteva salvare un id inventato: ora che arrivano da un registro, un id che
   * non risolve è un errore, non un dato lecito.
   */
  private async assertPartiEsistono(
    tenantId: string,
    producerId: string,
    counterpartyId: string,
    counterpartyType: 'TRANSPORTER' | 'DISPOSER' | 'BROKER'
  ): Promise<void> {
    const produttore = await this.prisma.produttore.findFirst({
      where: { id: producerId, tenantId },
      select: { id: true },
    })
    if (!produttore) {
      throw new BadRequestException('Produttore non trovato nel registro')
    }

    const registro = this.registroPerTipo(counterpartyType)
    if (!registro) return

    const controparte = await (registro.delegate as any).findFirst({
      where: { id: counterpartyId, tenantId },
      select: { id: true },
    })
    if (!controparte) {
      throw new BadRequestException(`${registro.etichetta} non trovato nel registro`)
    }
  }

  /**
   * Arricchisce i contratti con ragione sociale e P.IVA delle parti.
   *
   * Il contratto salva solo gli id: senza questo passaggio l'elenco può
   * mostrare soltanto il TIPO della controparte, non chi sia. Risolve con 3
   * query in tutto (una per registro), non una per riga. Un id che non risolve
   * più — anagrafica cancellata, contratto storico — dà `null`: è un dato
   * mancante, non un errore che deve far fallire la lista.
   */
  private async risolviParti<T extends { producerId: string; counterpartyId: string }>(
    tenantId: string,
    contracts: T[]
  ): Promise<ContractWithParties<T>[]> {
    if (contracts.length === 0) return []

    const produttoriIds = [...new Set(contracts.map(c => c.producerId))]
    const controparteIds = [...new Set(contracts.map(c => c.counterpartyId))]
    // Nome e identificativi vengono dalla ditta (D10): se la ditta cambia nome, la lista segue
    const select = {
      id: true,
      ditta: { select: { ragioneSociale: true, partitaIva: true, codiceFiscale: true } },
    }

    const [produttori, trasportatori, destinatari] = await Promise.all([
      this.prisma.produttore.findMany({ where: { tenantId, id: { in: produttoriIds } }, select }),
      this.prisma.trasportatore.findMany({
        where: { tenantId, id: { in: controparteIds } },
        select,
      }),
      this.prisma.destinatario.findMany({
        where: { tenantId, id: { in: controparteIds } },
        select,
      }),
    ])

    const comeParte = (r: (typeof produttori)[number]): ContractParty => ({
      id: r.id,
      ragioneSociale: r.ditta.ragioneSociale,
      partitaIVA: r.ditta.partitaIva,
      codiceFiscale: r.ditta.codiceFiscale,
    })
    const perId = (righe: (typeof produttori)[number][]) =>
      new Map(righe.map(r => [r.id, comeParte(r)]))
    const mappaProduttori = perId(produttori)
    // Trasportatori e destinatari sono registri distinti: un id sta in uno solo
    // dei due, quindi una mappa unica non può generare collisioni.
    const mappaControparti = perId([...trasportatori, ...destinatari])

    return contracts.map(c => ({
      ...c,
      producer: mappaProduttori.get(c.producerId) ?? null,
      counterparty: mappaControparti.get(c.counterpartyId) ?? null,
    }))
  }

  /**
   * Auto-compilazione FIR: dato il produttore e il CER, trova il contratto
   * ATTIVO e in corso di validità che copre quel CER e ne restituisce i dati
   * della controparte + pricing per precompilare il FIR. Null se nessuno.
   */
  async getAutoFillForFir(
    tenantId: string,
    producerId: string,
    cerCode: string,
    now: Date = new Date()
  ): Promise<FirAutoFill | null> {
    if (!producerId?.trim()) {
      throw new BadRequestException('Parametro obbligatorio mancante: producerId')
    }
    if (!cerCode?.trim()) {
      throw new BadRequestException('Parametro obbligatorio mancante: cerCode')
    }

    const contract = await this.prisma.contract.findFirst({
      where: {
        tenantId,
        producerId,
        status: 'ACTIVE',
        eliminatoIl: null,
        cerCodes: { has: cerCode },
        startDate: { lte: now },
        OR: [{ endDate: null }, { endDate: { gte: now } }],
      },
      orderBy: { startDate: 'desc' },
    })
    if (!contract) return null

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      counterpartyId: contract.counterpartyId,
      counterpartyType: contract.counterpartyType,
      pricingModel: contract.pricingModel,
      basePrice: contract.basePrice ? Number(contract.basePrice) : null,
      unitOfMeasure: contract.unitOfMeasure,
    }
  }
}
