/**
 * FIR Prisma Repository - Infrastructure Layer
 * Implementazione concreta del repository FIR con Prisma ORM
 */

import { Injectable } from '@nestjs/common'
import { FIRStatus as PrismaFIRStatus } from '@prisma/client'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository, FIRSearchFilters } from '../../domain/fir/repositories/fir-repository.interface'
import { Quantita, UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { PrismaService } from './prisma.service'

@Injectable()
export class FIRPrismaRepository implements IFIRRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<FIR | null> {
    const record = await this.prisma.fIR.findUnique({
      where: { id },
      // TODO: cerCode is a string field, not a relation
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    // Public access without tenant filter - used for signature verification
    const record = await this.prisma.fIR.findUnique({
      where: { id },
      // TODO: cerCode is a string field, not a relation
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null> {
    // TODO: Schema uses 'firNumber' not 'numeroProgressivo'
    // Also firNumber is not unique by itself, only with tenantId
    const record = await this.prisma.fIR.findFirst({
      where: { firNumber: numeroProgressivo },
    })

    if (!record) return null

    return this.toDomain(record)
  }

  async findByTenant(tenantId: string, filters?: FIRSearchFilters): Promise<FIR[]> {
    const where: any = {
      tenantId: tenantId,
      // TODO: Domain model uses produttoreId/trasportatoreId/destinatarioId
      // Schema uses producerUserId/carrierUserId/receiverUserId
    }

    if (filters?.stato) {
      // TODO: Map domain FIRStato to Prisma FIRStatus
      where.status = filters.stato
    }

    if (filters?.cerCode) {
      where.cerCode = filters.cerCode
    }

    if (filters?.dataFrom || filters?.dataTo) {
      where.createdAt = {}
      if (filters.dataFrom) where.createdAt.gte = filters.dataFrom
      if (filters.dataTo) where.createdAt.lte = filters.dataTo
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async findByStato(stato: FIRStato, tenantId?: string): Promise<FIR[]> {
    const where: any = {
      // TODO: Map domain FIRStato to Prisma FIRStatus
      status: stato as any
    }

    if (tenantId) {
      where.tenantId = tenantId
    }

    const records = await this.prisma.fIR.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })

    return records.map((r: any) => this.toDomain(r))
  }

  async save(fir: FIR): Promise<void> {
    await this.prisma.fIR.upsert({
      where: { id: fir.id },
      create: this.toPersistence(fir),
      update: this.toPersistence(fir),
    })
  }

  async delete(id: string): Promise<void> {
    // Soft delete by updating status to CANCELLED
    await this.prisma.fIR.update({
      where: { id },
      data: {
        status: PrismaFIRStatus.CANCELLED,
        cancelledAt: new Date()
      },
    })
  }

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    // TODO: Schema uses 'firNumber' not 'numeroProgressivo'
    const count = await this.prisma.fIR.count({
      where: { firNumber: numeroProgressivo },
    })
    return count > 0
  }

  async generateNumeroProgressivo(tenantId: string, anno: number): Promise<string> {
    // Get count of FIRs for this tenant in this year
    // TODO: Schema doesn't have 'anno' field, need to filter by date range
    const count = await this.prisma.fIR.count({
      where: {
        tenantId: tenantId,
        createdAt: {
          gte: new Date(anno, 0, 1),
          lte: new Date(anno, 11, 31, 23, 59, 59)
        }
      },
    })

    const progressive = String(count + 1).padStart(6, '0')
    return `FIR-${anno}-${progressive}`
  }

  async count(filters?: FIRSearchFilters): Promise<number> {
    const where: any = {}

    if (filters?.stato) {
      // TODO: Map domain FIRStato to Prisma FIRStatus
      where.status = filters.stato
    }

    if (filters?.produttoreId) {
      // TODO: Schema uses tenantId or producerUserId
      where.tenantId = filters.produttoreId
    }

    return this.prisma.fIR.count({ where })
  }

  private toDomain(record: any): FIR {
    // TODO: Domain model structure doesn't match Prisma schema
    // This is a placeholder implementation until models are aligned

    // Reconstitute FIR aggregate with available data
    const fir = FIR.create({
      produttoreId: record.producerUserId || record.tenantId,
      rifiuto: {
        cerCode: record.cerCode, // String in schema
        quantita: Number(record.quantity),
        unitaMisura: record.unit as UnitaMisura,
        statoFisico: undefined, // Not in schema
        caratteristichePericolo: undefined, // Not in schema
      },
      trasportatoreId: record.carrierUserId || '',
      destinatarioId: record.receiverUserId || '',
    })

    // Restore state (using reflection - in production use proper reconstitution)
    Object.assign(fir, {
      _id: record.id,
      _stato: record.status as any, // Map FIRStatus to FIRStato
      _numeroProgressivo: record.firNumber,
      _dataPresaCarico: record.transportDate,
      _dataConsegna: record.actualArrivalDate,
      _pesoEffettivo: undefined, // Not in schema
      _firme: {}, // Would come from signatures relation
      _createdAt: record.createdAt,
    })

    return fir
  }

  private toPersistence(fir: FIR): any {
    // TODO: Domain model structure doesn't match Prisma schema
    // This is a placeholder implementation until models are aligned
    return {
      id: fir.id,
      status: fir.stato as any, // Map FIRStato to FIRStatus
      firNumber: fir.numeroProgressivo,
      tenantId: fir.produttoreId, // Using produttoreId as tenantId
      producerUserId: fir.produttoreId,
      producerPartitaIva: '', // TODO: need to get from tenant
      producerName: '', // TODO: need to get from tenant
      producerAddress: '', // TODO: need to get from tenant
      carrierUserId: fir.trasportatoreId || undefined,
      carrierPartitaIva: '', // TODO: need to get from tenant
      carrierName: '', // TODO: need to get from tenant
      carrierVehiclePlate: '', // TODO: not in domain model
      receiverUserId: fir.destinatarioId || undefined,
      receiverPartitaIva: '', // TODO: need to get from tenant
      receiverName: '', // TODO: need to get from tenant
      receiverAddress: '', // TODO: need to get from tenant
      cerCode: fir.rifiuto.cerCode,
      wasteDescription: '', // TODO: not in domain model
      wasteCategory: '', // TODO: not in domain model
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      transportDate: fir.dataPresaCarico || new Date(),
      actualArrivalDate: fir.dataConsegna,
    }
  }
}
