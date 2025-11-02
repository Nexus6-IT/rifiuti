/**
 * Produttore Prisma Repository Implementation
 * Maps between Produttore domain entity and Produttore Prisma model
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { ProduttoreRepository } from '../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'

@Injectable()
export class ProduttorePrismaRepository implements ProduttoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(produttore: Produttore): Promise<void> {
    const data = {
      ragioneSociale: produttore.ragioneSociale,
      partitaIVA: produttore.partitaIVA.getValue(),
      via: produttore.sedeLegale.getVia(),
      civico: produttore.sedeLegale.getCivico(),
      cap: produttore.sedeLegale.getCAP(),
      comune: produttore.sedeLegale.getCitta(), // Map domain "citta" to database "comune"
      provincia: produttore.sedeLegale.getProvincia(),
      email: produttore.email || null,
      telefono: produttore.telefono || null,
      pec: produttore.pec || null,
      updatedAt: new Date(),
    }

    // Get tenantId from request context (for now use a default)
    // TODO: Extract tenantId from request context
    const tenantId = await this.getContextTenantId()

    await this.prisma.produttore.upsert({
      where: { id: produttore.id },
      create: {
        id: produttore.id,
        tenantId,
        ...data,
        createdAt: produttore.createdAt,
      },
      update: data,
    })
  }

  async findById(id: string): Promise<Produttore | null> {
    const produttore = await this.prisma.produttore.findUnique({
      where: { id },
    })

    if (!produttore) {
      return null
    }

    return this.toDomain(produttore)
  }

  async findByTenantId(tenantId: string): Promise<Produttore[]> {
    const produttori = await this.prisma.produttore.findMany({
      where: { tenantId },
      orderBy: { ragioneSociale: 'asc' },
    })

    return produttori.map((p: any) => this.toDomain(p))
  }

  async findByPartitaIVA(partitaIVA: string): Promise<Produttore | null> {
    // TODO: Filter by tenantId from context
    const tenantId = await this.getContextTenantId()

    const produttore = await this.prisma.produttore.findFirst({
      where: {
        tenantId,
        partitaIVA
      },
    })

    if (!produttore) {
      return null
    }

    return this.toDomain(produttore)
  }

  async delete(id: string): Promise<void> {
    await this.prisma.produttore.delete({
      where: { id },
    })
  }

  private toDomain(record: any): Produttore {
    return Produttore.reconstitute({
      id: record.id,
      ragioneSociale: record.ragioneSociale,
      partitaIVA: PartitaIVA.create(record.partitaIVA),
      sedeLegale: Indirizzo.create({
        via: record.via,
        civico: record.civico,
        cap: record.cap,
        citta: record.comune, // Map database "comune" to domain "citta"
        provincia: record.provincia,
      }),
      email: record.email || undefined,
      telefono: record.telefono || undefined,
      pec: record.pec || undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
  }

  /**
   * Get tenantId from request context
   * TODO: Implement proper tenant context extraction from JWT
   */
  private async getContextTenantId(): Promise<string> {
    // For now, get the first tenant
    // In production, extract this from JWT token in request context
    const tenant = await this.prisma.tenant.findFirst()
    return tenant?.id || 'default-tenant-id'
  }
}
