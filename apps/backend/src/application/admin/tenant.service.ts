import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  SubscriptionStatus,
  SubscriptionTier,
  UserRole,
  Prisma,
} from '@prisma/client';
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
 *
 * Self-service ADMIN: oltre al SUPER_ADMIN, anche un ADMIN può creare e gestire
 * le PROPRIE aziende (tenant) entro la quota `User.companyLimit` decisa dal
 * super admin. Lo scoping fine è applicato qui nel service a partire da
 * `currentUser` (il controller ammette entrambi i ruoli).
 */

/**
 * Forma minima dell'utente autenticato letto dalla request (req.user).
 * Allineata a `CurrentUserPayload` della JWT strategy.
 */
export interface CurrentUser {
  id: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TenantService.name);
  }

  private isSuperAdmin(currentUser: CurrentUser): boolean {
    return currentUser.role === UserRole.SUPER_ADMIN;
  }

  /**
   * Elenca i tenant ordinati per ragione sociale, con il conteggio degli utenti.
   *  - SUPER_ADMIN: tutti i tenant della piattaforma.
   *  - ADMIN: solo le proprie aziende (create in self-service, `ownerUserId` =
   *    currentUser.id) più il tenant di appartenenza (`currentUser.tenantId`).
   */
  async list(currentUser: CurrentUser) {
    const where: Prisma.TenantWhereInput = this.isSuperAdmin(currentUser)
      ? {}
      : {
          OR: [
            { ownerUserId: currentUser.id },
            { id: currentUser.tenantId },
          ],
        };

    this.logger.info('Listing tenants', {
      requestedBy: currentUser.id,
      role: currentUser.role,
    });

    return this.prisma.tenant.findMany({
      where,
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
   * Crea un nuovo tenant (azienda).
   *
   * - SUPER_ADMIN: può impostare piano, feature flag e limiti; `ownerUserId` =
   *   `dto.ownerUserId` (opzionale) o null.
   * - ADMIN (self-service): la quota `currentUser.companyLimit` viene applicata
   *   (conteggio dei tenant di cui è `ownerUserId`); il piano è forzato al
   *   default (TRIAL + feature TRIAL + `userLimitTotal` di schema) ignorando
   *   qualsiasi tier/feature/limite passato nel DTO; `ownerUserId` =
   *   `currentUser.id`.
   *
   * In entrambi i casi, dopo la create vengono seminati i ruoli di sistema del
   * nuovo tenant e l'admin proprietario viene associato (ConsultantTenantAssociation)
   * al ruolo ADMIN del nuovo tenant, così da poter switchare nell'azienda creata.
   *
   * @throws ConflictException se la partita IVA è già registrata.
   * @throws ForbiddenException se l'ADMIN ha raggiunto la quota aziende.
   */
  async create(currentUser: CurrentUser, dto: CreateTenantDto) {
    const isSuperAdmin = this.isSuperAdmin(currentUser);

    const existing = await this.prisma.tenant.findUnique({
      where: { partitaIva: dto.partitaIva },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `Partita IVA ${dto.partitaIva} già registrata`,
      );
    }

    // Determina il proprietario (ownerUserId) e applica la quota per gli ADMIN.
    let ownerUserId: string | null;
    if (isSuperAdmin) {
      ownerUserId = dto.ownerUserId ?? null;
    } else {
      // ADMIN self-service: proprietario = se stesso + enforcement quota.
      ownerUserId = currentUser.id;

      const limit = await this.getCompanyLimit(currentUser.id);
      const owned = await this.prisma.tenant.count({
        where: { ownerUserId: currentUser.id },
      });

      if (owned >= limit) {
        throw new ForbiddenException(
          `Limite aziende raggiunto (${owned}/${limit})`,
        );
      }
    }

    // Costruzione dati di subscription:
    //  - SUPER_ADMIN: rispetta i valori del DTO (default TRIAL dove omessi).
    //  - ADMIN: piano forzato al default (TRIAL + feature TRIAL + limiti schema),
    //    ignorando tier/feature/limiti eventualmente passati.
    type SubscriptionData = Pick<
      Prisma.TenantCreateInput,
      | 'subscriptionTier'
      | 'subscriptionStatus'
      | 'firLimitPerMonth'
      | 'userLimitTotal'
      | 'featureFlags'
    >;
    let subscriptionData: SubscriptionData;
    if (isSuperAdmin) {
      const effectiveTier = dto.subscriptionTier ?? SubscriptionTier.TRIAL;
      const featureFlags = dto.featureFlags ?? PLAN_FEATURES[effectiveTier];

      subscriptionData = {
        subscriptionStatus:
          dto.subscriptionStatus ?? SubscriptionStatus.TRIAL,
        ...(dto.subscriptionTier
          ? { subscriptionTier: dto.subscriptionTier }
          : {}),
        ...(dto.firLimitPerMonth !== undefined
          ? { firLimitPerMonth: dto.firLimitPerMonth }
          : {}),
        ...(dto.userLimitTotal !== undefined
          ? { userLimitTotal: dto.userLimitTotal }
          : {}),
        featureFlags: featureFlags as unknown as Prisma.InputJsonValue,
      };
    } else {
      // Piano di default forzato per le aziende create dagli admin.
      subscriptionData = {
        subscriptionTier: SubscriptionTier.TRIAL,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        // userLimitTotal/firLimitPerMonth: si lasciano i default di schema.
        featureFlags: PLAN_FEATURES[
          SubscriptionTier.TRIAL
        ] as unknown as Prisma.InputJsonValue,
      };
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
      ownerUserId,
      ...subscriptionData,
    };

    const tenant = await this.prisma.tenant.create({ data });

    this.logger.info('Tenant created', {
      tenantId: tenant.id,
      partitaIva: tenant.partitaIva,
      ownerUserId,
      createdBy: currentUser.id,
    });

    // Seed dei 5 ruoli di sistema per il nuovo tenant. Senza questo i tenant
    // creati via API resterebbero privi di ruoli (e quindi non assegnabili
    // agli utenti). Best-effort: un fallimento del seeding non deve annullare
    // la creazione del tenant (i ruoli sono ricreabili via `prisma:seed`).
    await this.seedRoles(tenant.id, currentUser.id);

    // Associa l'admin proprietario al nuovo tenant (ruolo ADMIN) così da poter
    // switchare nell'azienda via /consultant/switch-tenant. Best-effort: un
    // fallimento non deve annullare la creazione.
    if (ownerUserId) {
      await this.associateOwner(tenant.id, ownerUserId, currentUser.id);
    }

    return tenant;
  }

  /**
   * Legge la quota aziende (`companyLimit`) di un utente; 0 se non trovato.
   */
  private async getCompanyLimit(userId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyLimit: true },
    });
    return user?.companyLimit ?? 0;
  }

  /**
   * Crea l'associazione consulente↔tenant (ruolo ADMIN del nuovo tenant) per il
   * proprietario, così da abilitarne lo switch via /consultant/switch-tenant.
   * Idempotente (upsert sul vincolo univoco consultantUserId+tenantId).
   */
  private async associateOwner(
    tenantId: string,
    ownerUserId: string,
    addedBy: string,
  ): Promise<void> {
    try {
      const adminRole = await this.prisma.role.findUnique({
        where: { tenantId_name: { tenantId, name: 'ADMIN' } },
        select: { id: true },
      });

      if (!adminRole) {
        this.logger.warn(
          'Ruolo ADMIN non trovato per il nuovo tenant: associazione owner saltata',
          { tenantId, ownerUserId },
        );
        return;
      }

      await this.prisma.consultantTenantAssociation.upsert({
        where: {
          consultantUserId_tenantId: {
            consultantUserId: ownerUserId,
            tenantId,
          },
        },
        update: { roleId: adminRole.id, isActive: true },
        create: {
          consultantUserId: ownerUserId,
          tenantId,
          roleId: adminRole.id,
          addedBy,
          isActive: true,
        },
      });

      this.logger.info('Owner associato al nuovo tenant', {
        tenantId,
        ownerUserId,
      });
    } catch (error) {
      this.logger.error(
        'Associazione owner↔tenant fallita (tenant comunque creato)',
        error as Error,
        { tenantId, ownerUserId },
      );
    }
  }

  /**
   * Crea i ruoli di sistema per il tenant appena creato.
   *
   * `createdBy` richiede un utente esistente (FK): si usa l'utente che ha
   * effettuato la richiesta (passato dal chiamante), in fallback il
   * TenantContext e, in mancanza, il primo utente in DB. Se nessun utente
   * esiste (es. bootstrap iniziale) il seeding è rimandato al seed globale e si
   * registra solo un warning.
   */
  private async seedRoles(
    tenantId: string,
    requestedBy?: string,
  ): Promise<void> {
    try {
      const createdBy =
        requestedBy ??
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
   *
   * - SUPER_ADMIN: può aggiornare tutti i campi (anagrafica + subscription).
   * - ADMIN: solo se proprietario (`ownerUserId === currentUser.id`) e SOLO
   *   l'anagrafica; i campi di piano (subscriptionTier, userLimitTotal,
   *   featureFlags, firLimitPerMonth) vengono ignorati.
   *
   * @throws NotFoundException se il tenant non esiste.
   * @throws ForbiddenException se l'ADMIN non è il proprietario.
   */
  async update(currentUser: CurrentUser, id: string, dto: UpdateTenantDto) {
    // Verifica esistenza (getById lancia NotFound se assente).
    const tenant = await this.getById(id);

    const isSuperAdmin = this.isSuperAdmin(currentUser);

    // Scoping ADMIN: deve essere il proprietario dell'azienda.
    if (!isSuperAdmin && tenant.ownerUserId !== currentUser.id) {
      throw new ForbiddenException(
        'Non sei autorizzato a modificare questa azienda',
      );
    }

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
      // Campi di piano: modificabili SOLO dal SUPER_ADMIN. Per gli ADMIN
      // vengono ignorati anche se presenti nel payload.
      ...(isSuperAdmin && dto.subscriptionTier !== undefined
        ? { subscriptionTier: dto.subscriptionTier }
        : {}),
      ...(dto.subscriptionStatus !== undefined && isSuperAdmin
        ? { subscriptionStatus: dto.subscriptionStatus }
        : {}),
      ...(isSuperAdmin && dto.firLimitPerMonth !== undefined
        ? { firLimitPerMonth: dto.firLimitPerMonth }
        : {}),
      ...(isSuperAdmin && dto.userLimitTotal !== undefined
        ? { userLimitTotal: dto.userLimitTotal }
        : {}),
      // featureFlags: array di override (validato in DTO contro FEATURE_KEYS).
      // Per tornare a derivare dal piano si può inviare un array vuoto o `null`.
      ...(isSuperAdmin && dto.featureFlags !== undefined
        ? {
            featureFlags:
              dto.featureFlags as unknown as Prisma.InputJsonValue,
          }
        : {}),
    };

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    });

    this.logger.info('Tenant updated', { tenantId: id });

    return updated;
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
