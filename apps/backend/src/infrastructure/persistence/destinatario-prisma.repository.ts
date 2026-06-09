/**
 * Destinatario Prisma Repository Implementation
 * Maps between Destinatario domain entity and Destinatario Prisma model
 */

import { Injectable } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { TenantContext } from '../../core/context/tenant-context'
import { DestinatarioRepository } from '../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'

@Injectable()
export class DestinatarioPrismaRepository implements DestinatarioRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(destinatario: Destinatario): Promise<void> {
    const data = {
      ragioneSociale: destinatario.ragioneSociale,
      partitaIVA: destinatario.partitaIVA.getValue(),
      numeroAutorizzazione: destinatario.numeroAutorizzazione,
      via: destinatario.sede.getVia(),
      civico: destinatario.sede.getCivico(),
      cap: destinatario.sede.getCAP(),
      comune: destinatario.sede.getCitta(), // Map domain "citta" to database "comune"
      provincia: destinatario.sede.getProvincia(),
      email: destinatario.email || null,
      telefono: destinatario.telefono || null,
      pec: destinatario.pec || null,
      updatedAt: new Date(),
    }

    const tenantId = this.getContextTenantId()

    await this.prisma.db.destinatario.upsert({
      where: { id: destinatario.id },
      create: {
        id: destinatario.id,
        tenantId,
        ...data,
        createdAt: destinatario.createdAt,
      },
      update: data,
    })
  }

  async findById(id: string): Promise<Destinatario | null> {
    // Scoping per tenant: la RLS-extension è no-op su findUnique, quindi una
    // findUnique per sola PK esporrebbe anagrafiche di altri tenant.
    const tenantId = this.getContextTenantId()
    const destinatario = await this.prisma.db.destinatario.findFirst({
      where: { id, tenantId },
    })

    if (!destinatario) {
      return null
    }

    return this.toDomain(destinatario)
  }

  async findByTenantId(tenantId: string): Promise<Destinatario[]> {
    const destinatari = await this.prisma.db.destinatario.findMany({
      where: { tenantId },
      orderBy: { ragioneSociale: 'asc' },
    })

    return destinatari.map((d: any) => this.toDomain(d))
  }

  async findByPartitaIVA(partitaIVA: string): Promise<Destinatario | null> {
    const tenantId = this.getContextTenantId()

    const destinatario = await this.prisma.db.destinatario.findFirst({
      where: {
        tenantId,
        partitaIVA
      },
    })

    if (!destinatario) {
      return null
    }

    return this.toDomain(destinatario)
  }

  async findByNumeroAutorizzazione(numeroAutorizzazione: string): Promise<Destinatario | null> {
    const tenantId = this.getContextTenantId()

    const destinatario = await this.prisma.db.destinatario.findFirst({
      where: {
        tenantId,
        numeroAutorizzazione
      },
    })

    if (!destinatario) {
      return null
    }

    return this.toDomain(destinatario)
  }

  async delete(id: string): Promise<void> {
    // deleteMany scoped per tenant: impedisce la cancellazione cross-tenant.
    const tenantId = this.getContextTenantId()
    await this.prisma.db.destinatario.deleteMany({
      where: { id, tenantId },
    })
  }

  private toDomain(record: any): Destinatario {
    return Destinatario.reconstitute({
      id: record.id,
      ragioneSociale: record.ragioneSociale,
      partitaIVA: PartitaIVA.create(record.partitaIVA),
      sede: Indirizzo.create({
        via: record.via,
        civico: record.civico,
        cap: record.cap,
        citta: record.comune, // Map database "comune" to domain "citta"
        provincia: record.provincia,
      }),
      numeroAutorizzazione: record.numeroAutorizzazione,
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
