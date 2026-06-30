/**
 * Produttore Prisma Repository Implementation
 * Maps between Produttore domain entity and Produttore Prisma model
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { TenantContext } from '../../core/context/tenant-context'
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

    const tenantId = this.getContextTenantId()

    await this.prisma.db.produttore.upsert({
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
    // Scoping per tenant: una findUnique per sola PK restituirebbe anche
    // anagrafiche di altri tenant (la RLS-extension è no-op su findUnique).
    const tenantId = this.getContextTenantId()
    const produttore = await this.prisma.db.produttore.findFirst({
      where: { id, tenantId },
    })

    if (!produttore) {
      return null
    }

    return this.toDomain(produttore)
  }

  async findByTenantId(tenantId: string): Promise<Produttore[]> {
    const produttori = await this.prisma.db.produttore.findMany({
      where: { tenantId },
      orderBy: { ragioneSociale: 'asc' },
    })

    return produttori.map((p: any) => this.toDomain(p))
  }

  async findByPartitaIVA(partitaIVA: string): Promise<Produttore | null> {
    const tenantId = this.getContextTenantId()

    const produttore = await this.prisma.db.produttore.findFirst({
      where: {
        tenantId,
        partitaIVA,
      },
    })

    if (!produttore) {
      return null
    }

    return this.toDomain(produttore)
  }

  async delete(id: string): Promise<void> {
    // deleteMany scoped per tenant: impedisce la cancellazione di anagrafiche
    // di un altro tenant passando un id noto.
    const tenantId = this.getContextTenantId()
    await this.prisma.db.produttore.deleteMany({
      where: { id, tenantId },
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
   * Tenant corrente risolto dal contesto di richiesta (TenantContext / JWT).
   * Fail-closed: lancia se il contesto non è impostato, invece di ricadere sul
   * "primo tenant" del DB (causa del cross-tenant data leak).
   */
  private getContextTenantId(): string {
    return TenantContext.requireTenantId()
  }
}
