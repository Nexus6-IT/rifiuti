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
} from '@nestjs/common';
import { UserRole, User } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { KeycloakUserAdapter } from '../../infrastructure/keycloak/keycloak-user.adapter';
import { LoggerService } from '../../core/logger/logger.service';
import { FiscalCode } from '../../domain/shared/fiscal-code.vo';
import { CreateUserDto } from '../../api/admin/dto/create-user.dto';

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
export class UserAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakUserAdapter,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('UserAdminService');
  }

  private isSuperAdmin(currentUser: CurrentUser): boolean {
    return currentUser.role === UserRole.SUPER_ADMIN;
  }

  /**
   * Elenca gli utenti.
   *  - SUPER_ADMIN: tutti, oppure quelli del `tenantId` passato.
   *  - ADMIN: solo quelli del proprio tenant (il `tenantId` passato e' ignorato
   *    se diverso dal proprio).
   */
  async listUsers(
    currentUser: CurrentUser,
    tenantId?: string,
  ): Promise<User[]> {
    let where: { tenantId?: string } = {};

    if (this.isSuperAdmin(currentUser)) {
      if (tenantId) {
        where = { tenantId };
      }
    } else {
      // ADMIN: forzato al proprio tenant
      where = { tenantId: currentUser.tenantId };
    }

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Crea un nuovo utente su Keycloak + record locale.
   */
  async createUser(currentUser: CurrentUser, dto: CreateUserDto): Promise<User> {
    // 1. Determina e valida il tenant di destinazione.
    const targetTenantId = this.isSuperAdmin(currentUser)
      ? dto.tenantId
      : currentUser.tenantId;

    if (!targetTenantId) {
      throw new BadRequestException(
        'tenantId obbligatorio per la creazione utente',
      );
    }

    if (!this.isSuperAdmin(currentUser) && dto.tenantId && dto.tenantId !== currentUser.tenantId) {
      throw new ForbiddenException(
        'Un ADMIN può creare utenti solo nel proprio tenant',
      );
    }

    // 1-bis. Enforcement del limite utenze del piano.
    // I tenant admin (ruolo ADMIN) NON contano nel limite ("a parte il tenant
    // admin"); il SUPER_ADMIN (amministratore di piattaforma) bypassa il
    // controllo del tutto.
    await this.enforceUserLimit(currentUser, targetTenantId, dto.role);

    // 2. Valida il codice fiscale (riusa la VO di dominio).
    if (!FiscalCode.isValid(dto.fiscalCode)) {
      throw new BadRequestException(
        `Codice fiscale non valido: ${dto.fiscalCode}`,
      );
    }
    const normalizedFiscalCode = new FiscalCode(dto.fiscalCode).getValue();

    // 3. Crea l'utente su Keycloak.
    let keycloakId: string;
    try {
      keycloakId = await this.keycloak.createUser({
        fiscalCode: normalizedFiscalCode,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        tenantId: targetTenantId,
      });
    } catch (error: any) {
      this.logger.error('Creazione utente su Keycloak fallita', error, {
        fiscalCode: normalizedFiscalCode,
        tenantId: targetTenantId,
      });
      throw new BadRequestException(
        'Impossibile creare l’utente sul provider di identità',
      );
    }

    if (!keycloakId) {
      throw new BadRequestException(
        'Keycloak non ha restituito un id utente valido',
      );
    }

    // 4. Imposta l'eventuale password temporanea.
    if (dto.tempPassword) {
      try {
        await this.keycloak.setPassword(keycloakId, dto.tempPassword, true);
      } catch (error: any) {
        // Rollback best-effort: l'utente esiste su KC ma senza password usabile.
        this.logger.error(
          'Impostazione password temporanea fallita, disabilito utente KC',
          error,
          { keycloakId },
        );
        await this.safeDisableKeycloak(keycloakId);
        throw new BadRequestException(
          'Impossibile impostare la password temporanea',
        );
      }
    }

    // 5. Crea il record locale. Rollback best-effort su fallimento.
    try {
      return await this.prisma.user.create({
        data: {
          keycloakId,
          tenantId: targetTenantId,
          fiscalCode: normalizedFiscalCode,
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: dto.role as UserRole,
        },
      });
    } catch (error: any) {
      this.logger.error(
        'Creazione record utente nel DB fallita dopo provisioning Keycloak (incoerenza)',
        error,
        { keycloakId, tenantId: targetTenantId },
      );
      await this.safeDisableKeycloak(keycloakId);
      throw new BadRequestException(
        'Impossibile creare l’utente: registrazione locale fallita',
      );
    }
  }

  /**
   * Abilita/disabilita un utente. Per ora la disabilitazione viene propagata a
   * Keycloak (blocca il login). Verifica lo scoping tenant.
   */
  async setEnabled(
    currentUser: CurrentUser,
    userId: string,
    enabled: boolean,
  ): Promise<User> {
    const user = await this.findScopedUser(currentUser, userId);

    if (!enabled) {
      await this.keycloak.disableUser(user.keycloakId);
    }
    // NB: la riabilitazione su Keycloak richiederebbe un updateUser con
    // { enabled: true }; non esposto dall'adapter al momento, lasciato come
    // follow-up (vedi report).

    return user;
  }

  /**
   * Aggiorna il ruolo applicativo dell'utente nel DB (con scoping tenant).
   */
  async updateRole(
    currentUser: CurrentUser,
    userId: string,
    role: UserRole,
  ): Promise<User> {
    const user = await this.findScopedUser(currentUser, userId);

    return this.prisma.user.update({
      where: { id: user.id },
      data: { role },
    });
  }

  /**
   * Verifica che la creazione di un nuovo utente non superi il limite di utenze
   * del piano del tenant (`Tenant.userLimitTotal`).
   *
   * Regole:
   *  - SUPER_ADMIN bypassa sempre il controllo.
   *  - Il nuovo utente con ruolo ADMIN non incide sul limite → consentito.
   *  - Per gli altri ruoli si contano gli utenti esistenti con ruolo DIVERSO da
   *    ADMIN (i tenant admin sono esclusi dal conteggio); se il conteggio ha già
   *    raggiunto il limite, la creazione è rifiutata.
   *
   * @throws ForbiddenException se il limite è raggiunto.
   */
  private async enforceUserLimit(
    currentUser: CurrentUser,
    targetTenantId: string,
    newRole: string,
  ): Promise<void> {
    if (this.isSuperAdmin(currentUser)) {
      return;
    }

    // Gli ADMIN (tenant admin) non rientrano nel limite.
    if (newRole === UserRole.ADMIN) {
      return;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { userLimitTotal: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant non trovato');
    }

    const nonAdminCount = await this.prisma.user.count({
      where: {
        tenantId: targetTenantId,
        role: { not: UserRole.ADMIN },
      },
    });

    if (nonAdminCount >= tenant.userLimitTotal) {
      throw new ForbiddenException('Limite utenze del piano raggiunto');
    }
  }

  /**
   * Recupera un utente verificando che il chiamante abbia visibilita' sul suo
   * tenant. SUPER_ADMIN vede tutti; ADMIN solo il proprio tenant.
   */
  private async findScopedUser(
    currentUser: CurrentUser,
    userId: string,
  ): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException('Utente non trovato');
    }

    if (
      !this.isSuperAdmin(currentUser) &&
      user.tenantId !== currentUser.tenantId
    ) {
      // Non si rivela l'esistenza dell'utente fuori tenant.
      throw new NotFoundException('Utente non trovato');
    }

    return user;
  }

  /**
   * Disabilita l'utente su Keycloak ignorando eventuali errori (rollback
   * best-effort: registriamo soltanto l'esito).
   */
  private async safeDisableKeycloak(keycloakId: string): Promise<void> {
    try {
      await this.keycloak.disableUser(keycloakId);
    } catch (error: any) {
      this.logger.error(
        'Rollback Keycloak (disableUser) fallito; intervento manuale richiesto',
        error,
        { keycloakId },
      );
    }
  }
}
