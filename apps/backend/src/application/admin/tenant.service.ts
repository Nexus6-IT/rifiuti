import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { SubscriptionStatus, SubscriptionTier, UserRole, Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { LoggerService } from '../../core/logger/logger.service'
import { CreateTenantDto } from '../../api/admin/dto/create-tenant.dto'
import { UpdateTenantDto } from '../../api/admin/dto/update-tenant.dto'
import { seedRolesForTenant } from './system-roles'
import { TenantContext } from '../../core/context/tenant-context'
import { mapConLimite } from '../../core/utils/map-con-limite'
import { MembershipService } from '../../api/me/membership.service'
import { calcolaDeltaModuli, effectiveFeatures } from './feature-catalog'
import { assertNonPiattaforma, escludiPiattaforma } from '../../core/context/azienda-piattaforma'

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
  id: string
  tenantId: string
  role: string
}

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly logger: LoggerService,
    private readonly membership: MembershipService
  ) {
    this.logger.setContext(TenantService.name)
  }

  /**
   * Forma la riga per chi la riceve: solo il SUPER_ADMIN vede i moduli
   * (`featureFlags`, `featureTolte`) e il calcolato `moduliEffettivi`.
   */
  private perUtente<T extends { subscriptionTier?: SubscriptionTier }>(
    currentUser: CurrentUser,
    riga: T
  ): Omit<T, 'featureFlags' | 'featureTolte'> & { moduliEffettivi?: string[] } {
    const { featureFlags, featureTolte, ...resto } = riga as T & {
      featureFlags?: unknown
      featureTolte?: unknown
    }
    if (!this.isSuperAdmin(currentUser)) return resto as never
    return {
      ...resto,
      featureFlags,
      featureTolte,
      moduliEffettivi: riga.subscriptionTier
        ? effectiveFeatures({ subscriptionTier: riga.subscriptionTier, featureFlags, featureTolte })
        : [],
    } as never
  }

  /** Colonne da salvare per una selezione completa di moduli, calcolate sul piano dato. */
  private colonneModuli(tier: SubscriptionTier, selezione: readonly string[]) {
    const { aggiunti, tolti } = calcolaDeltaModuli(tier, selezione)
    return {
      featureFlags: aggiunti as unknown as Prisma.InputJsonValue,
      featureTolte: tolti as unknown as Prisma.InputJsonValue,
    }
  }

  /** Dettaglio per il controller (GET :id, solo SUPER_ADMIN). */
  async getByIdPerUtente(currentUser: CurrentUser, id: string) {
    return this.perUtente(currentUser, await this.getById(id, true))
  }

  private isSuperAdmin(currentUser: CurrentUser): boolean {
    return currentUser.role === UserRole.SUPER_ADMIN
  }

  /**
   * Esegue `fn` nel contesto dell'azienda indicata (client normale, tenant nello store).
   * Serve al super admin quando opera su un'azienda diversa da quella del proprio contesto.
   */
  private async inAzienda<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await TenantContext.run(
      { tenantId, userId: TenantContext.getUserId() ?? undefined },
      async () => await fn()
    )
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
          OR: [{ ownerUserId: currentUser.id }, { id: currentUser.tenantId }],
        }

    this.logger.info('Listing tenants', {
      requestedBy: currentUser.id,
      role: currentUser.role,
    })

    // Sistema: il super admin elenca TUTTE le aziende (where {}) con il conteggio utenti, a prescindere
    // dal tenant nello store (il middleware gli mette sempre il proprio o quello dell'header).
    if (this.isSuperAdmin(currentUser)) {
      const tutte = await this.sistema.tenant.findMany({
        where: escludiPiattaforma(where),
        orderBy: { ragioneSociale: 'asc' },
        include: {
          _count: {
            select: { users: true },
          },
        },
      })
      return tutte.map(t => this.perUtente(currentUser, t))
    }

    // ADMIN: le aziende possedute sono altre rispetto al suo contesto; il conteggio utenti di
    // ciascuna si legge nel suo contesto (client normale).
    const aziende = await this.prisma.tenant.findMany({
      where: escludiPiattaforma(where),
      orderBy: { ragioneSociale: 'asc' },
    })
    // Una transazione per azienda: al massimo 4 insieme, per non esaurire il pool.
    return await mapConLimite(aziende, 4, async azienda =>
      this.perUtente(currentUser, {
        ...azienda,
        _count: {
          users: await this.inAzienda(
            azienda.id,
            async () => await this.prisma.user.count({ where: { tenantId: azienda.id } })
          ),
        },
      })
    )
  }

  /**
   * Recupera un singolo tenant per id (con conteggio utenti).
   * @throws NotFoundException se il tenant non esiste.
   */
  async getById(id: string, nelContestoDelTenant: boolean) {
    // Il conteggio utenti e' dell'azienda richiesta: si legge nel suo contesto.
    // Solo il super admin legge nel contesto del tenant richiesto: un ADMIN non deve
    // mai leggere dentro un'altra azienda prima del controllo di proprieta'.
    const leggi = async () =>
      await this.prisma.tenant.findUnique({
        where: { id },
        include: {
          _count: {
            select: { users: true },
          },
        },
      })
    const tenant = nelContestoDelTenant ? await this.inAzienda(id, leggi) : await leggi()

    if (!tenant) {
      throw new NotFoundException(`Tenant ${id} non trovato`)
    }

    return tenant
  }

  /**
   * Crea un nuovo tenant (azienda).
   *
   * - SUPER_ADMIN: può impostare piano, feature flag e limiti; `ownerUserId` =
   *   `dto.ownerUserId` (opzionale) o null.
   * - ADMIN (self-service): la quota `currentUser.companyLimit` viene applicata
   *   (conteggio dei tenant di cui è `ownerUserId`) SOLO se non comanda la
   *   quota di gruppo (v. `parentTenantId` più sotto); il piano è forzato al
   *   default (TRIAL + feature TRIAL + `userLimitTotal` di schema) ignorando
   *   qualsiasi tier/feature/limite passato nel DTO; `ownerUserId` =
   *   `currentUser.id`.
   *
   * In entrambi i casi, dopo la create vengono seminati i ruoli di sistema del
   * nuovo tenant e l'admin proprietario viene associato (ConsultantTenantAssociation)
   * al ruolo ADMIN del nuovo tenant, così da poter switchare nell'azienda creata.
   *
   * Gruppo (`dto.parentTenantId`): un ADMIN può agganciare la figlia solo a
   * una madre su cui ha accesso (`MembershipService.checkAccess`); il
   * SUPER_ADMIN può agganciarla a qualunque madre.
   *
   * Precedenza delle quote (spec §5, non cumulative): se la madre indicata ha
   * `aziendeLimit` valorizzato comanda quello e `User.companyLimit` non viene
   * nemmeno consultato; altrimenti vale `User.companyLimit` di chi crea.
   *
   * @throws ConflictException se la partita IVA è già registrata.
   * @throws ForbiddenException se l'ADMIN ha raggiunto la quota aziende, non
   *   ha accesso alla madre indicata, o la madre ha raggiunto `aziendeLimit`.
   * @throws BadRequestException se la madre indicata non esiste o è a sua
   *   volta una figlia (gerarchia a un solo livello).
   */
  async create(currentUser: CurrentUser, dto: CreateTenantDto) {
    const isSuperAdmin = this.isSuperAdmin(currentUser)

    const existing = await this.prisma.tenant.findUnique({
      where: { partitaIva: dto.partitaIva },
      select: { id: true },
    })

    if (existing) {
      throw new ConflictException(`Partita IVA ${dto.partitaIva} già registrata`)
    }

    // --- Gruppo: validazione della madre, se richiesta una figlia ---
    // Si risolve PRIMA della quota personale: la precedenza fra i due limiti e'
    // stabilita dalla spec §5 e non ammette cumulo — se la madre dichiara
    // `aziendeLimit`, comanda quello e il `User.companyLimit` non si applica.
    let quotaDiGruppoInVigore = false
    if (dto.parentTenantId) {
      assertNonPiattaforma(dto.parentTenantId)
      const madre = await this.prisma.tenant.findUnique({
        where: { id: dto.parentTenantId },
        select: { id: true, parentTenantId: true, aziendeLimit: true },
      })
      if (!madre) {
        throw new BadRequestException('Azienda madre non trovata')
      }
      // Titolarità sulla madre: senza questo controllo un qualsiasi ADMIN
      // autenticato potrebbe agganciare la propria azienda a una madre
      // qualunque conoscendone l'UUID, consumandone la quota e — più grave —
      // ereditandone il contratto (piano/stato/limiti/feature, v. Task 2/3).
      // Il SUPER_ADMIN resta libero di agganciare qualunque madre (stesso
      // pattern di bypass usato da MembershipService.switchTenant). Delega a
      // checkAccess: è la definizione unica di "questo utente può accedere a
      // questa azienda" (tenant primario, proprietà, associazione consulente
      // valida, discesa gerarchica) — niente logica di accesso duplicata qui.
      if (!isSuperAdmin) {
        const hasAccess = await this.membership.checkAccess(
          currentUser.id,
          madre.id,
          currentUser.tenantId
        )
        if (!hasAccess) {
          throw new ForbiddenException("Nessun accesso all'azienda madre indicata")
        }
      }
      // Gerarchia a UN SOLO livello: senza questo vincolo servirebbero query
      // ricorsive e "chi vede cosa" diventerebbe un albero da risolvere a ogni
      // richiesta.
      if (madre.parentTenantId) {
        throw new BadRequestException(
          'Questa azienda e gia una figlia: non e possibile creare un gruppo dentro un gruppo.'
        )
      }
      // Quota di gruppo: se la madre la dichiara, comanda lei; altrimenti
      // resta in vigore il vecchio User.companyLimit di chi crea.
      if (madre.aziendeLimit !== null) {
        quotaDiGruppoInVigore = true
        const figlie = await this.prisma.tenant.count({
          where: { parentTenantId: madre.id },
        })
        if (figlie >= madre.aziendeLimit) {
          throw new ForbiddenException(
            `Limite aziende del gruppo raggiunto (${figlie}/${madre.aziendeLimit}). ` +
              'Aggiorna il piano per aggiungere altre aziende.'
          )
        }
      }
    }

    // Determina il proprietario (ownerUserId) e applica la quota personale per
    // gli ADMIN, ma solo se non e' gia' in vigore la quota di gruppo.
    let ownerUserId: string | null
    if (isSuperAdmin) {
      ownerUserId = dto.ownerUserId ?? null
    } else {
      // ADMIN self-service: proprietario = se stesso.
      ownerUserId = currentUser.id

      if (!quotaDiGruppoInVigore) {
        const limit = await this.getCompanyLimit(currentUser.id)
        const owned = await this.prisma.tenant.count({
          where: { ownerUserId: currentUser.id },
        })

        if (owned >= limit) {
          throw new ForbiddenException(`Limite aziende raggiunto (${owned}/${limit})`)
        }
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
      | 'featureTolte'
    >
    let subscriptionData: SubscriptionData
    if (isSuperAdmin) {
      subscriptionData = {
        subscriptionStatus: dto.subscriptionStatus ?? SubscriptionStatus.TRIAL,
        ...(dto.subscriptionTier ? { subscriptionTier: dto.subscriptionTier } : {}),
        ...(dto.firLimitPerMonth !== undefined ? { firLimitPerMonth: dto.firLimitPerMonth } : {}),
        ...(dto.userLimitTotal !== undefined ? { userLimitTotal: dto.userLimitTotal } : {}),
        // featureFlags: null di default → derivato dal piano (fix WS-F).
        // Solo se il SUPER_ADMIN ha passato un override esplicito nel DTO lo si
        // persiste; altrimenti null garantisce che le nuove feature del piano
        // si propaghino automaticamente ai tenant esistenti.
        // `dto.featureFlags` e' la selezione completa delle caselle: si salva il delta
        // rispetto al piano (aggiunti / tolti). Senza selezione, entrambe null.
        ...(dto.featureFlags
          ? this.colonneModuli(dto.subscriptionTier ?? SubscriptionTier.TRIAL, dto.featureFlags)
          : { featureFlags: Prisma.DbNull, featureTolte: Prisma.DbNull }),
      }
    } else {
      // Piano di default forzato per le aziende create dagli admin.
      // featureFlags=null → si derivano sempre dal piano (fix WS-F):
      // i nuovi tenant ricevono automaticamente tutte le feature del loro piano.
      subscriptionData = {
        subscriptionTier: SubscriptionTier.TRIAL,
        subscriptionStatus: SubscriptionStatus.TRIAL,
        // userLimitTotal/firLimitPerMonth: si lasciano i default di schema.
        featureFlags: Prisma.DbNull,
        featureTolte: Prisma.DbNull,
      }
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
      ...(dto.parentTenantId ? { madre: { connect: { id: dto.parentTenantId } } } : {}),
      ...subscriptionData,
    }

    const tenant = await this.prisma.tenant.create({ data })

    this.logger.info('Tenant created', {
      tenantId: tenant.id,
      partitaIva: tenant.partitaIva,
      ownerUserId,
      createdBy: currentUser.id,
    })

    // Seed dei 5 ruoli di sistema per il nuovo tenant. Senza questo i tenant
    // creati via API resterebbero privi di ruoli (e quindi non assegnabili
    // agli utenti). Best-effort: un fallimento del seeding non deve annullare
    // la creazione del tenant (i ruoli sono ricreabili via `prisma:seed`).
    // I passi successivi lavorano sul nuovo tenant: ciascuno nel suo contesto.
    await this.inAzienda(tenant.id, async () => await this.seedRoles(tenant.id, currentUser.id))

    // Associa l'admin proprietario al nuovo tenant (ruolo ADMIN) così da poter
    // switchare nell'azienda via /consultant/switch-tenant. Best-effort: un
    // fallimento non deve annullare la creazione.
    if (ownerUserId) {
      await this.inAzienda(
        tenant.id,
        async () => await this.associateOwner(tenant.id, ownerUserId, currentUser.id)
      )
    }

    return this.perUtente(currentUser, tenant)
  }

  /**
   * Legge la quota aziende (`companyLimit`) di un utente; 0 se non trovato.
   */
  private async getCompanyLimit(userId: string): Promise<number> {
    // Sistema: lookup per id dell'utente chiamante, il cui tenant puo' non coincidere col contesto.
    const user = await this.sistema.user.findUnique({
      where: { id: userId },
      select: { companyLimit: true },
    })
    return user?.companyLimit ?? 0
  }

  /**
   * Crea l'associazione consulente↔tenant (ruolo ADMIN del nuovo tenant) per il
   * proprietario, così da abilitarne lo switch via /consultant/switch-tenant.
   * Idempotente (upsert sul vincolo univoco consultantUserId+tenantId).
   */
  private async associateOwner(
    tenantId: string,
    ownerUserId: string,
    addedBy: string
  ): Promise<void> {
    try {
      const adminRole = await this.prisma.role.findUnique({
        where: { tenantId_name: { tenantId, name: 'ADMIN' } },
        select: { id: true },
      })

      if (!adminRole) {
        this.logger.warn(
          'Ruolo ADMIN non trovato per il nuovo tenant: associazione owner saltata',
          { tenantId, ownerUserId }
        )
        return
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
      })

      this.logger.info('Owner associato al nuovo tenant', {
        tenantId,
        ownerUserId,
      })
    } catch (error) {
      this.logger.error(
        'Associazione owner↔tenant fallita (tenant comunque creato)',
        error as Error,
        { tenantId, ownerUserId }
      )
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
  private async seedRoles(tenantId: string, requestedBy?: string): Promise<void> {
    try {
      const createdBy =
        requestedBy ??
        TenantContext.getUserId() ??
        // sistema: fallback senza utente noto, nessuna azienda nota
        (await this.sistema.user.findFirst({ select: { id: true } }))?.id

      if (!createdBy) {
        this.logger.warn(
          'Nessun utente disponibile come createdBy: seeding ruoli rimandato al seed globale',
          { tenantId }
        )
        return
      }

      const count = await seedRolesForTenant(this.prisma, tenantId, createdBy)
      this.logger.info('Ruoli di sistema creati per il nuovo tenant', {
        tenantId,
        rolesCreated: count,
      })
    } catch (error) {
      this.logger.error(
        'Seeding ruoli per il nuovo tenant fallito (tenant comunque creato)',
        error as Error,
        { tenantId }
      )
    }
  }

  /**
   * Aggiorna un tenant esistente (update parziale).
   *
   * - SUPER_ADMIN: può aggiornare tutti i campi (anagrafica + subscription).
   * - ADMIN: solo se proprietario (`ownerUserId === currentUser.id`) e SOLO
   *   l'anagrafica; i campi di piano (subscriptionTier, userLimitTotal,
   *   featureFlags, firLimitPerMonth, aziendeLimit) vengono ignorati.
   *
   * @throws NotFoundException se il tenant non esiste.
   * @throws ForbiddenException se l'ADMIN non è il proprietario.
   */
  async update(currentUser: CurrentUser, id: string, dto: UpdateTenantDto) {
    assertNonPiattaforma(id)
    // Verifica esistenza (getById lancia NotFound se assente).
    const isSuperAdmin = this.isSuperAdmin(currentUser)
    const tenant = await this.getById(id, isSuperAdmin)

    // Scoping ADMIN: deve essere il proprietario dell'azienda.
    if (!isSuperAdmin && tenant.ownerUserId !== currentUser.id) {
      throw new ForbiddenException('Non sei autorizzato a modificare questa azienda')
    }

    const data: Prisma.TenantUpdateInput = {
      ...(dto.ragioneSociale !== undefined ? { ragioneSociale: dto.ragioneSociale } : {}),
      ...(dto.codiceFiscale !== undefined ? { codiceFiscale: dto.codiceFiscale } : {}),
      ...(dto.pec !== undefined ? { pec: dto.pec } : {}),
      ...(dto.telefono !== undefined ? { telefono: dto.telefono } : {}),
      ...(dto.atecoCode !== undefined ? { atecoCode: dto.atecoCode } : {}),
      ...(dto.reaNumber !== undefined ? { reaNumber: dto.reaNumber } : {}),
      ...(dto.numeroAddetti !== undefined ? { numeroAddetti: dto.numeroAddetti } : {}),
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
      // aziendeLimit: quota di aziende del gruppo. `null` la rimuove e riporta
      // in vigore il `User.companyLimit` di chi crea (spec §5).
      ...(isSuperAdmin && dto.aziendeLimit !== undefined ? { aziendeLimit: dto.aziendeLimit } : {}),
      // featureFlags: array di override (validato in DTO contro FEATURE_KEYS).
      // Per tornare a derivare dal piano si può inviare un array vuoto o `null`.
      // featureFlags e' la selezione completa: il backend salva aggiunti e tolti rispetto
      // al piano risultante dopo questa richiesta.
      ...(isSuperAdmin && dto.featureFlags !== undefined
        ? this.colonneModuli(
            (isSuperAdmin && dto.subscriptionTier) || tenant.subscriptionTier,
            dto.featureFlags ?? []
          )
        : {}),
    }

    const updated = await this.prisma.tenant.update({
      where: { id },
      data,
    })

    this.logger.info('Tenant updated', { tenantId: id })

    return this.perUtente(currentUser, updated)
  }

  /**
   * Sospende o riattiva un tenant impostandone lo stato di subscription.
   * @throws NotFoundException se il tenant non esiste.
   */
  async setStatus(id: string, status: 'SUSPENDED' | 'ACTIVE') {
    assertNonPiattaforma(id)
    // Verifica esistenza (getById lancia NotFound se assente).
    await this.getById(id, true)

    const tenant = await this.prisma.tenant.update({
      where: { id },
      data: {
        subscriptionStatus:
          status === 'SUSPENDED' ? SubscriptionStatus.SUSPENDED : SubscriptionStatus.ACTIVE,
      },
    })

    this.logger.info('Tenant status changed', { tenantId: id, status })

    return tenant
  }
}
