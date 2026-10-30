import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

export type ContractStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'TERMINATED'

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
    await this.assertPartiEsistono(
      tenantId,
      input.producerId,
      input.counterpartyId,
      input.counterpartyType
    )

    return this.prisma.contract.create({
      data: {
        tenantId,
        contractNumber: input.contractNumber,
        producerId: input.producerId,
        counterpartyId: input.counterpartyId,
        counterpartyType: input.counterpartyType as any,
        contractType: input.contractType as any,
        description: input.description,
        cerCodes: input.cerCodes,
        pricingModel: input.pricingModel as any,
        basePrice: input.basePrice,
        unitOfMeasure: input.unitOfMeasure || 'kg',
        pricingConfig: input.pricingConfig,
        startDate: input.startDate,
        endDate: input.endDate,
        durationMonths: input.durationMonths,
        autoRenew: input.autoRenew ?? false,
        renewalNoticeDays: input.renewalNoticeDays ?? 60,
        paymentTerms: input.paymentTerms || 'net_30',
        billingFrequency: input.billingFrequency || 'monthly',
        status: 'DRAFT',
      },
    })
  }

  async list(tenantId: string, status?: ContractStatus) {
    const contracts = await this.prisma.contract.findMany({
      where: { tenantId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    })
    return this.risolviParti(tenantId, contracts)
  }

  /** Lettura grezza tenant-scoped, senza risoluzione delle parti. */
  private async findOrFail(tenantId: string, id: string) {
    const contract = await this.prisma.contract.findFirst({ where: { id, tenantId } })
    if (!contract) throw new NotFoundException('Contratto non trovato')
    return contract
  }

  async getById(tenantId: string, id: string) {
    const contract = await this.findOrFail(tenantId, id)
    const [risolto] = await this.risolviParti(tenantId, [contract])
    return risolto
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
  async changeStatus(tenantId: string, id: string, newStatus: ContractStatus) {
    // Lettura grezza di proposito: il cambio di stato non ha bisogno delle
    // anagrafiche risolte, e interrogarle qui sarebbe lavoro sprecato.
    const contract = await this.findOrFail(tenantId, id)
    const current = contract.status as ContractStatus

    if (current === newStatus) return contract

    if (!ALLOWED_TRANSITIONS[current].includes(newStatus)) {
      throw new BadRequestException(`Transizione non ammessa: ${current} → ${newStatus}`)
    }

    this.logger.info(`Contratto ${id}: ${current} → ${newStatus}`)
    return this.prisma.contract.update({
      where: { id },
      data: { status: newStatus as any },
    })
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
