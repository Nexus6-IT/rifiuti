/**
 * UserAdminService
 *
 * Logica di gestione utenti in-app con provisioning su Keycloak.
 *
 * Regole di scoping tenant:
 *  - SUPER_ADMIN: opera su qualunque tenant.
 *  - ADMIN: opera SOLO sul proprio `currentUser.tenantId`.
 *
 * Flusso di creazione: prima si crea l'utente su Keycloak (source of truth per
 * l'autenticazione), si imposta l'eventuale password temporanea, poi si crea il
 * record locale in `User`. Se la create DB fallisce dopo aver creato l'utente su
 * Keycloak, si tenta un rollback best-effort disabilitando l'utente KC e si
 * logga l'incoerenza.
 */

import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common'
import { UserRole, User } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { assertNonPiattaforma } from '../../core/context/azienda-piattaforma'
import { TenantContext } from '../../core/context/tenant-context'
import { KeycloakUserAdapter } from '../../infrastructure/keycloak/keycloak-user.adapter'
import { LoggerService } from '../../core/logger/logger.service'
import { FiscalCode } from '../../domain/shared/fiscal-code.vo'
import { CreateUserDto } from '../../api/admin/dto/create-user.dto'
import { SubscriptionEnforcementService } from './../../application/billing/subscription-enforcement.service'

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
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    private readonly keycloak: KeycloakUserAdapter,
    private readonly logger: LoggerService,
    private readonly enforcement: SubscriptionEnforcementService
  ) {
    this.logger.setContext('UserAdminService')
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

  /** Super admin: nel contesto dell'azienda dell'utente; ADMIN: invariato (contesto corrente). */
  private async inAziendaDi<T>(
    currentUser: CurrentUser,
    tenantId: string,
    fn: () => Promise<T>
  ): Promise<T> {
    return this.isSuperAdmin(currentUser) ? await this.inAzienda(tenantId, fn) : await fn()
  }

  /**
   * Elenca gli utenti.
   *  - SUPER_ADMIN: tutti, oppure quelli del `tenantId` passato.
   *  - ADMIN: solo quelli del proprio tenant (il `tenantId` passato e' ignorato
   *    se diverso dal proprio).
   */
  async listUsers(currentUser: CurrentUser, tenantId?: string): Promise<User[]> {
    let where: { tenantId?: string } = {}

    if (this.isSuperAdmin(currentUser)) {
      if (tenantId) {
        where = { tenantId }
      }
    } else {
      // ADMIN: forzato al proprio tenant
      where = { tenantId: currentUser.tenantId }
    }

    const lettura = (client: PrismaService | PrismaSistemaService) =>
      client.user.findMany({ where, orderBy: { createdAt: 'desc' } })

    if (this.isSuperAdmin(currentUser)) {
      // Azienda richiesta: nel suo contesto, client normale.
      if (tenantId) return await this.inAzienda(tenantId, async () => await lettura(this.prisma))
      // Sistema: elenco su tutte le aziende, nessuna azienda nota.
      return await lettura(this.sistema)
    }
    return await lettura(this.prisma)
  }

  /**
   * Crea un nuovo utente su Keycloak + record locale.
   */
  async createUser(currentUser: CurrentUser, dto: CreateUserDto): Promise<User> {
    // 1. Determina e valida il tenant di destinazione.
    const targetTenantId = this.isSuperAdmin(currentUser) ? dto.tenantId : currentUser.tenantId

    assertNonPiattaforma(targetTenantId)
    if (!targetTenantId) {
      throw new BadRequestException('tenantId obbligatorio per la creazione utente')
    }

    if (!this.isSuperAdmin(currentUser) && dto.tenantId && dto.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException('Un ADMIN può creare utenti solo nel proprio tenant')
    }

    // 1-bis. Enforcement abbonamento: verifica sospensione e limite utenti.
    // Il SUPER_ADMIN (amministratore di piattaforma) bypassa i controlli.
    //
    // Il limite passa da SubscriptionEnforcementService: il tetto vive sul
    // contratto della MADRE (una figlia non ha un abbonamento proprio), mentre
    // il conteggio resta sull'azienda su cui si sta creando — stessa regola del
    // tetto FIR. Leggerlo dalla figlia bloccava a due utenti anche i gruppi
    // ENTERPRISE (userLimitTotal = 0 = illimitato sulla radice).
    if (!this.isSuperAdmin(currentUser)) {
      await this.enforcement.assertNotSuspended(targetTenantId)
      await this.enforcement.assertUserLimitNotReached(targetTenantId, dto.role)
    }

    // 2. Valida il codice fiscale (riusa la VO di dominio).
    if (!FiscalCode.isValid(dto.fiscalCode)) {
      throw new BadRequestException(`Codice fiscale non valido: ${dto.fiscalCode}`)
    }
    const normalizedFiscalCode = new FiscalCode(dto.fiscalCode).getValue()

    // 2-bis. Valida la password temporanea contro la policy del realm
    // (length >= 10) prima di toccare Keycloak: errore chiaro e niente utenti
    // orfani sull'IdP.
    if (dto.tempPassword && dto.tempPassword.length < 10) {
      throw new BadRequestException('La password temporanea deve avere almeno 10 caratteri')
    }

    // 3. Crea l'utente su Keycloak.
    let keycloakId: string
    try {
      keycloakId = await this.keycloak.createUser({
        fiscalCode: normalizedFiscalCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        tenantId: targetTenantId,
      })
    } catch (error: any) {
      this.logger.error('Creazione utente su Keycloak fallita', error, {
        fiscalCode: normalizedFiscalCode,
        tenantId: targetTenantId,
      })
      // 409 dal realm = username (codice fiscale) o email gia' esistenti.
      if (error?.response?.status === 409) {
        throw new ConflictException('Esiste già un utente con questa email o codice fiscale')
      }
      throw new BadRequestException('Impossibile creare l’utente sul provider di identità')
    }

    if (!keycloakId) {
      throw new BadRequestException('Keycloak non ha restituito un id utente valido')
    }

    // 4. Imposta l'eventuale password temporanea.
    if (dto.tempPassword) {
      try {
        await this.keycloak.setPassword(keycloakId, dto.tempPassword, true)
      } catch (error: any) {
        // Rollback: l'utente esiste su KC ma senza password usabile → lo CANCELLO
        // (non solo disabilito) per non lasciare conflitti su email/CF nei retry.
        this.logger.error('Impostazione password temporanea fallita, rimuovo utente KC', error, {
          keycloakId,
        })
        await this.safeDeleteKeycloak(keycloakId)
        throw new BadRequestException(
          'Password non valida per la policy del provider (minimo 10 caratteri)'
        )
      }
    }

    // 5. Crea il record locale. Rollback best-effort su fallimento.
    try {
      // Super admin su un'azienda che puo' non essere quella del contesto: crea nel contesto di destinazione.
      const crea = async () =>
        await this.prisma.user.create({
          data: {
            keycloakId,
            tenantId: targetTenantId,
            fiscalCode: normalizedFiscalCode,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: dto.role as UserRole,
            // La quota aziende è impostabile SOLO dal SUPER_ADMIN; altrimenti
            // resta il default di schema (1).
            ...(this.isSuperAdmin(currentUser) && dto.companyLimit !== undefined
              ? { companyLimit: dto.companyLimit }
              : {}),
          },
        })
      return this.isSuperAdmin(currentUser)
        ? await this.inAzienda(targetTenantId, crea)
        : await crea()
    } catch (error: any) {
      this.logger.error(
        'Creazione record utente nel DB fallita dopo provisioning Keycloak (incoerenza)',
        error,
        { keycloakId, tenantId: targetTenantId }
      )
      await this.safeDeleteKeycloak(keycloakId)
      // P2002 = violazione unique (es. fiscalCode gia' presente nel tenant).
      if (error?.code === 'P2002') {
        throw new ConflictException(
          'Esiste già un utente con questo codice fiscale in questa azienda'
        )
      }
      throw new BadRequestException('Impossibile creare l’utente: registrazione locale fallita')
    }
  }

  /**
   * Abilita/disabilita un utente. Per ora la disabilitazione viene propagata a
   * Keycloak (blocca il login). Verifica lo scoping tenant.
   */
  async setEnabled(currentUser: CurrentUser, userId: string, enabled: boolean): Promise<User> {
    const user = await this.findScopedUser(currentUser, userId)

    if (!enabled) {
      await this.keycloak.disableUser(user.keycloakId)
    }
    // NB: la riabilitazione su Keycloak richiederebbe un updateUser con
    // { enabled: true }; non esposto dall'adapter al momento, lasciato come
    // follow-up (vedi report).

    return user
  }

  /**
   * Aggiorna il ruolo applicativo dell'utente nel DB (con scoping tenant).
   */
  async updateRole(currentUser: CurrentUser, userId: string, role: UserRole): Promise<User> {
    const user = await this.findScopedUser(currentUser, userId)

    return await this.inAziendaDi(
      currentUser,
      user.tenantId,
      async () =>
        await this.prisma.user.update({
          where: { id: user.id },
          data: { role },
        })
    )
  }

  /**
   * Imposta la quota di aziende creabili in autonomia da un utente.
   * Riservato al SUPER_ADMIN (controllo a livello di endpoint + qui difensivo).
   *
   * @throws ForbiddenException se il chiamante non è SUPER_ADMIN.
   * @throws NotFoundException se l'utente non esiste.
   */
  async setCompanyLimit(
    currentUser: CurrentUser,
    userId: string,
    companyLimit: number
  ): Promise<User> {
    if (!this.isSuperAdmin(currentUser)) {
      throw new ForbiddenException('Solo il super admin può impostare la quota aziende')
    }

    // Sistema: lookup per id prima di conoscere l'azienda dell'utente (solo super admin, verificato sopra).
    const user = await this.sistema.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new NotFoundException('Utente non trovato')
    }

    return await this.inAzienda(
      user.tenantId,
      async () =>
        await this.prisma.user.update({
          where: { id: userId },
          data: { companyLimit },
        })
    )
  }

  /**
   * Recupera un utente verificando che il chiamante abbia visibilita' sul suo
   * tenant. SUPER_ADMIN vede tutti; ADMIN solo il proprio tenant.
   */
  private async findScopedUser(currentUser: CurrentUser, userId: string): Promise<User> {
    // Sistema (solo super admin): lookup per id prima di conoscere l'azienda dell'utente.
    const client = this.isSuperAdmin(currentUser) ? this.sistema : this.prisma
    const user = await client.user.findUnique({ where: { id: userId } })

    if (!user) {
      throw new NotFoundException('Utente non trovato')
    }

    if (!this.isSuperAdmin(currentUser) && user.tenantId !== currentUser.tenantId) {
      // Non si rivela l'esistenza dell'utente fuori tenant.
      throw new NotFoundException('Utente non trovato')
    }

    return user
  }

  /**
   * Disabilita l'utente su Keycloak ignorando eventuali errori (rollback
   * best-effort: registriamo soltanto l'esito).
   */
  private async safeDisableKeycloak(keycloakId: string): Promise<void> {
    try {
      await this.keycloak.disableUser(keycloakId)
    } catch (error: any) {
      this.logger.error(
        'Rollback Keycloak (disableUser) fallito; intervento manuale richiesto',
        error,
        { keycloakId }
      )
    }
  }

  /**
   * Cancella l'utente su Keycloak ignorando errori (rollback best-effort):
   * usato quando il provisioning fallisce, per non lasciare utenti orfani che
   * causerebbero conflitti (409) sui tentativi successivi.
   */
  private async safeDeleteKeycloak(keycloakId: string): Promise<void> {
    try {
      await this.keycloak.deleteUser(keycloakId)
    } catch (error: any) {
      this.logger.error(
        'Rollback Keycloak (deleteUser) fallito; intervento manuale richiesto',
        error,
        { keycloakId }
      )
    }
  }
}
