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
    // Reconstitute the FIR aggregate from the persisted columns, including the
    // frozen anagrafica snapshots. produttoreId/trasportatoreId/destinatarioId
    // are the registry references (fallback to legacy columns for old rows).
    const fir = FIR.create({
      produttoreId: record.producerId || record.producerUserId || record.tenantId,
      rifiuto: {
        cerCode: record.cerCode,
        quantita: Number(record.quantity),
        unitaMisura: record.unit as UnitaMisura,
        statoFisico: undefined, // Not persisted yet
        caratteristichePericolo: undefined, // Not persisted yet
        descrizione: record.wasteDescription || undefined,
        categoria: record.wasteCategory || undefined,
        tipoOperazione: record.wasteOperationType || undefined,
      },
      trasportatoreId: record.carrierId || record.carrierUserId || '',
      destinatarioId: record.receiverId || record.receiverUserId || '',
      creatoDaUserId: record.producerUserId || undefined,
      produttore: this.partyFromRecord(
        record.producerId,
        record.producerName,
        record.producerPartitaIva,
        record.producerAddress,
        record.producerContact,
      ),
      trasportatore: this.partyFromRecord(
        record.carrierId,
        record.carrierName,
        record.carrierPartitaIva,
        undefined,
        record.carrierContact,
        record.carrierVehiclePlate,
      ),
      destinatario: this.partyFromRecord(
        record.receiverId,
        record.receiverName,
        record.receiverPartitaIva,
        record.receiverAddress,
        record.receiverContact,
      ),
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

  /** Ricostruisce uno snapshot di parte FIR dai campi persistiti, o null se vuoto. */
  private partyFromRecord(
    registroId?: string | null,
    ragioneSociale?: string | null,
    partitaIva?: string | null,
    indirizzo?: string | null,
    contatto?: string | null,
    targaVeicolo?: string | null,
  ) {
    if (!ragioneSociale && !partitaIva && !registroId) return undefined
    return {
      registroId: registroId || undefined,
      ragioneSociale: ragioneSociale || '',
      partitaIva: partitaIva || '',
      indirizzo: indirizzo || undefined,
      contatto: contatto || undefined,
      targaVeicolo: targaVeicolo || undefined,
    }
  }

  private toPersistence(fir: FIR): any {
    // Mappa l'aggregate FIR sui campi Prisma. I dati anagrafici vengono presi
    // dagli snapshot congelati (parte del documento legale), non più stringhe
    // vuote. producerUserId = utente creatore (FK a User); producer/carrier/
    // receiverId = riferimento al registro di provenienza dello snapshot.
    const produttore = fir.produttore
    const trasportatore = fir.trasportatore
    const destinatario = fir.destinatario

    return {
      id: fir.id,
      status: fir.stato as any, // Map FIRStato to FIRStatus
      firNumber: fir.numeroProgressivo,
      tenantId: fir.produttoreId, // Using produttoreId as tenantId
      producerUserId: fir.creatoDaUserId || fir.produttoreId,
      producerId: produttore?.registroId || fir.produttoreId || undefined,
      producerPartitaIva: produttore?.partitaIva || '',
      producerName: produttore?.ragioneSociale || '',
      producerAddress: produttore?.indirizzo || '',
      producerContact: produttore?.contatto || undefined,
      carrierId: trasportatore?.registroId || fir.trasportatoreId || undefined,
      carrierUserId: undefined, // il trasportatore è un'anagrafica, non uno User
      carrierPartitaIva: trasportatore?.partitaIva || '',
      carrierName: trasportatore?.ragioneSociale || '',
      carrierVehiclePlate: trasportatore?.targaVeicolo || '', // dato di trasporto, compilato alla presa in carico
      carrierContact: trasportatore?.contatto || undefined,
      receiverId: destinatario?.registroId || fir.destinatarioId || undefined,
      receiverUserId: undefined, // il destinatario è un'anagrafica, non uno User
      receiverPartitaIva: destinatario?.partitaIva || '',
      receiverName: destinatario?.ragioneSociale || '',
      receiverAddress: destinatario?.indirizzo || '',
      receiverContact: destinatario?.contatto || undefined,
      cerCode: fir.rifiuto.cerCode,
      wasteDescription: fir.rifiuto.descrizione || '',
      wasteCategory: fir.rifiuto.categoria || '',
      wasteOperationType: fir.rifiuto.tipoOperazione || undefined,
      quantity: fir.rifiuto.quantita.valore,
      unit: fir.rifiuto.quantita.unitaMisura,
      transportDate: fir.dataPresaCarico || new Date(),
      actualArrivalDate: fir.dataConsegna,
    }
  }
}
