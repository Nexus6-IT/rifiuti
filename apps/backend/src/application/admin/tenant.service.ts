import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { SubscriptionStatus, SubscriptionTier, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { LoggerService } from '../../core/logger/logger.service';
import { CreateTenantDto } from '../../api/admin/dto/create-tenant.dto';
import { UpdateTenantDto } from '../../api/admin/dto/update-tenant.dto';
import { PLAN_FEATURES } from './feature-catalog';
import { seedRolesForTenant } from './system-roles';
import { TenantContext } from '../../core/context/tenant-context';

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

    // Piano effettivo: quello indicato dal SUPER_ADMIN o il default di schema (TRIAL).
    const effectiveTier =
      dto.subscriptionTier ?? SubscriptionTier.TRIAL;

    // Feature flags: override esplicito dal DTO, altrimenti default dal piano.
    const featureFlags =
      dto.featureFlags ?? PLAN_FEATURES[effectiveTier];

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
      // Feature flag iniziali derivati dal piano (o override esplicito).
      featureFlags: featureFlags as unknown as Prisma.InputJsonValue,
    };

    const tenant = await this.prisma.tenant.create({ data });

    this.logger.info('Tenant created', {
      tenantId: tenant.id,
      partitaIva: tenant.partitaIva,
    });

    // Seed dei 5 ruoli di sistema per il nuovo tenant. Senza questo i tenant
    // creati via API resterebbero privi di ruoli (e quindi non assegnabili
    // agli utenti). Best-effort: un fallimento del seeding non deve annullare
    // la creazione del tenant (i ruoli sono ricreabili via `prisma:seed`).
    await this.seedRoles(tenant.id);

    return tenant;
  }

  /**
   * Crea i ruoli di sistema per il tenant appena creato.
   *
   * `createdBy` richiede un utente esistente (FK): si usa il SUPER_ADMIN che ha
   * effettuato la richiesta (TenantContext) e, in mancanza, il primo utente in
   * DB. Se nessun utente esiste (es. bootstrap iniziale) il seeding è rimandato
   * al seed globale e si registra solo un warning.
   */
  private async seedRoles(tenantId: string): Promise<void> {
    try {
      const createdBy =
        TenantContext.getUserId() ??
        (await this.prisma.user.findFirst({ select: { id: true } }))?.id;

      if (!createdBy) {
        this.logger.warn(
          'Nessun utente disponibile come createdBy: seeding ruoli rimandato al seed globale',
          { tenantId },
        );
        return;
      }

      const count = await seedRolesForTenant(this.prisma, tenantId, createdBy);
      this.logger.info('Ruoli di sistema creati per il nuovo tenant', {
        tenantId,
        rolesCreated: count,
      });
    } catch (error) {
      this.logger.error(
        'Seeding ruoli per il nuovo tenant fallito (tenant comunque creato)',
        error as Error,
        { tenantId },
      );
    }
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
      // featureFlags: array di override (validato in DTO contro FEATURE_KEYS).
      // Per tornare a derivare dal piano si può inviare un array vuoto o `null`.
      ...(dto.featureFlags !== undefined
        ? {
            featureFlags:
              dto.featureFlags as unknown as Prisma.InputJsonValue,
          }
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
