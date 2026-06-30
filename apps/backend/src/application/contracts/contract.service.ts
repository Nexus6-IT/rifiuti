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
    return this.prisma.contract.findMany({
      where: { tenantId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getById(tenantId: string, id: string) {
    const contract = await this.prisma.contract.findFirst({ where: { id, tenantId } })
    if (!contract) throw new NotFoundException('Contratto non trovato')
    return contract
  }

  /** Cambia stato applicando le transizioni ammesse del workflow. */
  async changeStatus(tenantId: string, id: string, newStatus: ContractStatus) {
    const contract = await this.getById(tenantId, id)
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
