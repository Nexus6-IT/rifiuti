/**
 * Trasportatore Prisma Repository Implementation
 * Maps between Trasportatore domain entity and Trasportatore Prisma model
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { TenantContext } from '../../core/context/tenant-context'
import { TrasportatoreRepository } from '../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'

@Injectable()
export class TrasportatorePrismaRepository implements TrasportatoreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(trasportatore: Trasportatore): Promise<void> {
    const data = {
      ragioneSociale: trasportatore.ragioneSociale,
      partitaIVA: trasportatore.partitaIVA.getValue(),
      numeroIscrizione: trasportatore.numeroIscrizione,
      via: trasportatore.sedeLegale.getVia(),
      civico: trasportatore.sedeLegale.getCivico(),
      cap: trasportatore.sedeLegale.getCAP(),
      comune: trasportatore.sedeLegale.getCitta(), // Map domain "citta" to database "comune"
      provincia: trasportatore.sedeLegale.getProvincia(),
      email: trasportatore.email || null,
      telefono: trasportatore.telefono || null,
      pec: trasportatore.pec || null,
      updatedAt: new Date(),
    }

    const tenantId = this.getContextTenantId()

    await this.prisma.db.trasportatore.upsert({
      where: { id: trasportatore.id },
      create: {
        id: trasportatore.id,
        tenantId,
        ...data,
        createdAt: trasportatore.createdAt,
      },
      update: data,
    })
  }

  async findById(id: string): Promise<Trasportatore | null> {
    // Scoping per tenant: la RLS-extension è no-op su findUnique, quindi una
    // findUnique per sola PK esporrebbe anagrafiche di altri tenant.
    const tenantId = this.getContextTenantId()
    const trasportatore = await this.prisma.db.trasportatore.findFirst({
      where: { id, tenantId },
    })

    if (!trasportatore) {
      return null
    }

    return this.toDomain(trasportatore)
  }

  async findByTenantId(tenantId: string): Promise<Trasportatore[]> {
    const trasportatori = await this.prisma.db.trasportatore.findMany({
      where: { tenantId },
      orderBy: { ragioneSociale: 'asc' },
    })

    return trasportatori.map((t: any) => this.toDomain(t))
  }

  async findByPartitaIVA(partitaIVA: string): Promise<Trasportatore | null> {
    const tenantId = this.getContextTenantId()

    const trasportatore = await this.prisma.db.trasportatore.findFirst({
      where: {
        tenantId,
        partitaIVA,
      },
    })

    if (!trasportatore) {
      return null
    }

    return this.toDomain(trasportatore)
  }

  async findByNumeroIscrizione(numeroIscrizione: string): Promise<Trasportatore | null> {
    const tenantId = this.getContextTenantId()

    const trasportatore = await this.prisma.db.trasportatore.findFirst({
      where: {
        tenantId,
        numeroIscrizione,
      },
    })

    if (!trasportatore) {
      return null
    }

    return this.toDomain(trasportatore)
  }

  async delete(id: string): Promise<void> {
    // deleteMany scoped per tenant: impedisce la cancellazione cross-tenant.
    const tenantId = this.getContextTenantId()
    await this.prisma.db.trasportatore.deleteMany({
      where: { id, tenantId },
    })
  }

  private toDomain(record: any): Trasportatore {
    return Trasportatore.reconstitute({
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
      numeroIscrizione: record.numeroIscrizione,
      email: record.email || undefined,
      telefono: record.telefono || undefined,
      pec: record.pec || undefined,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
  }

  /**
   * Tenant corrente risolto dal contesto di richiesta (TenantContext / JWT).
   * Fail-closed: lancia se il contesto non è impostato, invece di ricadere sul
   * "primo tenant" del DB (causa del cross-tenant data leak).
   */
  private getContextTenantId(): string {
    return TenantContext.requireTenantId()
  }
}
