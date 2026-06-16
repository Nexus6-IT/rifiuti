import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SubscriptionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { LoggerService } from '../../core/logger/logger.service';
import { CreateTenantDto } from '../../api/admin/dto/create-tenant.dto';
import { UpdateTenantDto } from '../../api/admin/dto/update-tenant.dto';

/**
 * TenantService (admin)
 *
 * Gestione anagrafica dei tenant riservata al SUPER_ADMIN.
 *
 * NB: il modello `Tenant` è la tabella-tenant stessa (non possiede `tenantId`),
 * quindi NON è soggetto a Row-Level Security: un SUPER_ADMIN può elencare e
 * gestire tutti i tenant della piattaforma. Per questo usiamo il client base
 * `this.prisma.tenant` (non la vista RLS `this.prisma.db`).
 */
@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TenantService.name);
  }

  /**
   * Elenca tutti i tenant ordinati per ragione sociale, con il conteggio
   * degli utenti associati.
   */
  async list() {
    this.logger.info('Listing all tenants');

    return this.prisma.tenant.findMany({
      orderBy: { ragioneSociale: 'asc' },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });
  }

  /**
   * Recupera un singolo tenant per id (con conteggio utenti).
   * @throws NotFoundException se il tenant non esiste.
   */
  async getById(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} non trovato`);
    }

    return tenant;
  }

  /**
   * Crea un nuovo tenant.
   * - Valida l'univocità della partita IVA.
   * - Applica lo stato di subscription di default (TRIAL) se non fornito.
   * @throws ConflictException se la partita IVA è già registrata.
   */
  async create(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { partitaIva: dto.partitaIva },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `Partita IVA ${dto.partitaIva} già registrata`,
      );
    }

    const data: Prisma.TenantCreateInput = {
      partitaIva: dto.partitaIva,
      ragioneSociale: dto.ragioneSociale,
      codiceFiscale: dto.codiceFiscale,
      pec: dto.pec,
      telefono: dto.telefono,
      atecoCode: dto.atecoCode,
      reaNumber: dto.reaNumber,
      numeroAddetti: dto.numeroAddetti,
      legaleRappresentanteNome: dto.legaleRappresentanteNome,
      legaleRappresentanteCognome: dto.legaleRappresentanteCognome,
      address: dto.address,
      civico: dto.civico,
      city: dto.city,
      province: dto.province,
      postalCode: dto.postalCode,
      country: dto.country ?? 'IT',
      // Default subscription: TRIAL (sovrascrivibile dal SUPER_ADMIN).
      subscriptionStatus: dto.subscriptionStatus ?? SubscriptionStatus.TRIAL,
      ...(dto.subscriptionTier ? { subscriptionTier: dto.subscriptionTier } : {}),
      ...(dto.firLimitPerMonth !== undefined
        ? { firLimitPerMonth: dto.firLimitPerMonth }
        : {}),
      ...(dto.userLimitTotal !== undefined
        ? { userLimitTotal: dto.userLimitTotal }
        : {}),
    };

    const tenant = await this.prisma.tenant.create({ data });

    this.logger.info('Tenant created', {
      tenantId: tenant.id,
      partitaIva: tenant.partitaIva,
    });

    return tenant;
  }

  /**
   * Aggiorna un tenant esistente (update parziale).
   * @throws NotFoundException se il tenant non esiste.
   */
  async update(id: string, dto: UpdateTenantDto) {
    // Verifica esistenza (getById lancia NotFound se assente).
    await this.getById(id);

    const data: Prisma.TenantUpdateInput = {
      ...(dto.ragioneSociale !== undefined
        ? { ragioneSociale: dto.ragioneSociale }
        : {}),
      ...(dto.codiceFiscale !== undefined
        ? { codiceFiscale: dto.codiceFiscale }
        : {}),
      ...(dto.pec !== undefined ? { pec: dto.pec } : {}),
      ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
      ...(dto.atecoCode !== undefined ? { atecoCode: dto.atecoCode } : {}),
      ...(dto.reaNumber !== undefined ? { reaNumber: dto.reaNumber } : {}),
      ...(dto.numeroAddetti !== undefined
        ? { numeroAddetti: dto.numeroAddetti }
        : {}),
      ...(dto.legaleRappresentanteNome !== undefined
        ? { legaleRappresentanteNome: dto.legaleRappresentanteNome }
        : {}),
      ...(dto.legaleRappresentanteCognome !== undefined
        ? { legaleRappresentanteCognome: dto.legaleRappresentanteCognome }
        : {}),
      ...(dto.address !== undefined ? { address: dto.address } : {}),
      ...(dto.civico !== undefined ? { civico: dto.civico } : {}),
      ...(dto.city !== undefined ? { city: dto.city } : {}),
      ...(dto.province !== undefined ? { province: dto.province } : {}),
      ...(dto.postalCode !== undefined ? { postalCode: dto.postalCode } : {}),
      ...(dto.country !== undefined ? { country: dto.country } : {}),
      ...(dto.subscriptionTier !== undefined
        ? { subscriptionTier: dto.subscriptionTier }
        : {}),
      ...(dto.subscriptionStatus !== undefined
        ? { subscriptionStatus: dto.subscriptionStatus }
        : {}),
      ...(dto.firLimitPerMonth !== undefined
        ? { firLimitPerMonth: dto.firLimitPerMonth }
        : {}),
      ...(dto.userLimitTotal !== undefined
        ? { userLimitTotal: dto.userLimitTotal }
        : {}),
    };

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    this.logger.info('Tenant updated', { tenantId: id });

    return tenant;
  }

  /**
   * Sospende o riattiva un tenant impostandone lo stato di subscription.
   * @throws NotFoundException se il tenant non esiste.
   */
  async setStatus(id: string, status: 'SUSPENDED' | 'ACTIVE') {
    // Verifica esistenza (getById lancia NotFound se assente).
    await this.getById(id);

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        subscriptionStatus:
          status === 'SUSPENDED'
            ? SubscriptionStatus.SUSPENDED
            : SubscriptionStatus.ACTIVE,
      },
    });

    this.logger.info('Tenant status changed', { tenantId: id, status });

    return tenant;
  }
}
