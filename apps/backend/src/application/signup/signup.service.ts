/**
 * SignupService — registrazione self-service di una nuova azienda (WS-G).
 *
 * Crea atomicamente:
 *  1. Utente Keycloak (emailVerified=false, VERIFY_EMAIL required action)
 *  2. Tenant (piano TRIAL) + User (ruolo ADMIN) in una transazione Prisma
 *  3. Seed ruoli di sistema per il tenant (best-effort)
 *  4. Associazione owner/tenant per il tenant switcher (best-effort)
 *  5. Invio mail di verifica via Keycloak Admin REST (best-effort)
 *
 * Rollback: se la transazione Prisma fallisce dopo la creazione KC, l'utente
 * KC viene eliminato per evitare conflitti email/CF sui tentativi successivi.
 */

import {
  Injectable,
  ConflictException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { UserRole, SubscriptionTier, SubscriptionStatus, Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { KeycloakUserAdapter } from '../../infrastructure/keycloak/keycloak-user.adapter'
import { LoggerService } from '../../core/logger/logger.service'
import { FiscalCode } from '../../domain/shared/fiscal-code.vo'
import { seedRolesForTenant } from '../admin/system-roles'
import { SignupDto } from '../../api/signup/dto/signup.dto'

export interface SignupResult {
  /** Messaggio localizzato da mostrare all'utente. */
  message: string
  /** UUID del tenant appena creato. */
  tenantId: string
}

@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakUserAdapter,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(SignupService.name)
  }

  /**
   * Esegue la registrazione self-service:
   *  - valida i dati in input
   *  - crea l'utente su Keycloak con verifica email richiesta
   *  - crea Tenant (TRIAL) + User (ADMIN) in transazione atomica
   *  - esegue best-effort: seed ruoli, associazione owner, invio mail verifica
   *
   * @throws ConflictException  se P.IVA o email/CF già registrati
   * @throws BadRequestException se il codice fiscale non è valido
   * @throws InternalServerErrorException per errori imprevisti
   */
  async signup(dto: SignupDto): Promise<SignupResult> {
    // ── 1. Validazione CF ─────────────────────────────────────────────────
    if (!FiscalCode.isValid(dto.fiscalCode)) {
      throw new BadRequestException(`Codice fiscale non valido: ${dto.fiscalCode}`)
    }
    const normalizedCf = new FiscalCode(dto.fiscalCode).getValue()

    // ── 2. Unicità P.IVA ──────────────────────────────────────────────────
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { partitaIva: dto.partitaIva },
      select: { id: true },
    })
    if (existingTenant) {
      throw new ConflictException(
        `Partita IVA ${dto.partitaIva} già registrata. Contatta il supporto se pensi sia un errore.`
      )
    }

    // ── 3. Pre-genera gli UUID per poterli passare a Keycloak prima della tx ──
    const tenantId = randomUUID()
    const userId = randomUUID()

    // ── 4. Crea l'utente su Keycloak (email non ancora verificata) ────────
    let keycloakId: string
    try {
      keycloakId = await this.keycloak.createUser({
        fiscalCode: normalizedCf,
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        tenantId,
        emailVerified: false,
        requiredActions: ['VERIFY_EMAIL'],
      })
    } catch (error: any) {
      this.logger.error('Creazione utente su Keycloak fallita durante signup', error, {
        email: dto.email,
        partitaIva: dto.partitaIva,
      })
      if (error?.response?.status === 409) {
        throw new ConflictException('Esiste già un account con questa email o codice fiscale.')
      }
      throw new BadRequestException(
        "Impossibile creare l'account sul provider di identità. Riprova più tardi."
      )
    }

    if (!keycloakId) {
      throw new InternalServerErrorException(
        'Il provider di identità non ha restituito un identificativo utente valido.'
      )
    }

    // ── 5. Transazione Prisma: Tenant + User + ownerUserId ────────────────
    let result: { tenantId: string; userId: string }
    try {
      result = await this.prisma.$transaction(async tx => {
        // 5a. Crea il tenant (piano TRIAL, featureFlags null = derivate dal piano)
        const tenant = await tx.tenant.create({
          data: {
            id: tenantId,
            partitaIva: dto.partitaIva,
            ragioneSociale: dto.ragioneSociale,
            subscriptionTier: SubscriptionTier.TRIAL,
            subscriptionStatus: SubscriptionStatus.TRIAL,
            featureFlags: Prisma.DbNull,
          },
        })

        // 5b. Crea l'utente ADMIN del tenant
        const user = await tx.user.create({
          data: {
            id: userId,
            keycloakId,
            tenantId: tenant.id,
            fiscalCode: normalizedCf,
            email: dto.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            role: UserRole.ADMIN,
          },
        })

        // 5c. Imposta l'owner del tenant (FK userId → user.id)
        await tx.tenant.update({
          where: { id: tenant.id },
          data: { ownerUserId: user.id },
        })

        return { tenantId: tenant.id, userId: user.id }
      })
    } catch (error: any) {
      // Rollback Keycloak: elimina l'utente creato per non lasciare orfani
      // che causerebbero conflitti 409 sui tentativi successivi.
      await this.safeDeleteKeycloak(keycloakId)

      this.logger.error('Transazione DB fallita durante signup (utente KC rimosso)', error, {
        keycloakId,
        tenantId,
        email: dto.email,
      })

      if (error?.code === 'P2002') {
        throw new ConflictException('Esiste già un account con questa email o codice fiscale.')
      }
      throw new InternalServerErrorException(
        'Registrazione non completata per un errore interno. Riprova più tardi.'
      )
    }

    // ── 6. Best-effort: seed ruoli di sistema per il nuovo tenant ─────────
    await this.seedRolesBestEffort(result.tenantId, result.userId)

    // ── 7. Best-effort: associa l'admin al tenant per il tenant switcher ──
    await this.associateOwnerBestEffort(result.tenantId, result.userId)

    // ── 8. Best-effort: invia mail di verifica via Keycloak ───────────────
    // Se SMTP non è configurato nel realm Keycloak, questo step fallisce silenziosamente.
    // L'utente è comunque creato; il super admin può attivarlo manualmente o
    // inviare la mail di verifica dalla console Keycloak.
    // ATTIVARE: configurare SMTP provider nel realm `ignicraft` su Keycloak.
    await this.sendVerifyEmailBestEffort(keycloakId, dto.email)

    this.logger.info('Signup self-service completato', {
      tenantId: result.tenantId,
      userId: result.userId,
      partitaIva: dto.partitaIva,
    })

    return {
      message:
        "Registrazione completata. Controlla la tua email per verificare l'account e accedere a WasteFlow.",
      tenantId: result.tenantId,
    }
  }

  // ── Helper privati ────────────────────────────────────────────────────────

  private async seedRolesBestEffort(tenantId: string, createdBy: string): Promise<void> {
    try {
      const count = await seedRolesForTenant(this.prisma, tenantId, createdBy)
      this.logger.info('Ruoli di sistema seminati per il nuovo tenant signup', {
        tenantId,
        rolesCreated: count,
      })
    } catch (error) {
      this.logger.error('Seeding ruoli fallito (tenant comunque creato)', error as Error, {
        tenantId,
      })
    }
  }

  private async associateOwnerBestEffort(tenantId: string, ownerUserId: string): Promise<void> {
    try {
      const adminRole = await this.prisma.role.findUnique({
        where: { tenantId_name: { tenantId, name: 'ADMIN' } },
        select: { id: true },
      })

      if (!adminRole) {
        this.logger.warn(
          'Ruolo ADMIN non trovato per il tenant signup: associazione owner saltata',
          { tenantId, ownerUserId }
        )
        return
      }

      await this.prisma.consultantTenantAssociation.upsert({
        where: { consultantUserId_tenantId: { consultantUserId: ownerUserId, tenantId } },
        update: { roleId: adminRole.id, isActive: true },
        create: {
          consultantUserId: ownerUserId,
          tenantId,
          roleId: adminRole.id,
          addedBy: ownerUserId,
          isActive: true,
        },
      })

      this.logger.info('Owner associato al tenant (signup)', { tenantId, ownerUserId })
    } catch (error) {
      this.logger.error(
        'Associazione owner↔tenant fallita nel signup (tenant comunque creato)',
        error as Error,
        { tenantId, ownerUserId }
      )
    }
  }

  private async sendVerifyEmailBestEffort(keycloakId: string, email: string): Promise<void> {
    try {
      await this.keycloak.sendVerifyEmail(keycloakId)
      this.logger.info('Mail di verifica inviata tramite Keycloak', { keycloakId, email })
    } catch (error) {
      // Non blocca il signup: l'utente esiste già; il super admin può inviare
      // la mail di verifica manualmente dalla console Keycloak.
      // ATTIVARE: configurare SMTP nel realm `ignicraft` per abilitare l'invio automatico.
      this.logger.warn(
        'Invio mail di verifica via Keycloak fallito (best-effort). ' +
          'Verificare la configurazione SMTP del realm o inviare la mail manualmente.',
        { keycloakId, email }
      )
    }
  }

  /**
   * Elimina l'utente Keycloak in modo silenzioso (rollback best-effort):
   * registra l'esito senza propagare l'eccezione.
   */
  private async safeDeleteKeycloak(keycloakId: string): Promise<void> {
    try {
      await this.keycloak.deleteUser(keycloakId)
    } catch (error: any) {
      this.logger.error(
        'Rollback KC (deleteUser) fallito durante signup; intervento manuale richiesto',
        error,
        { keycloakId }
      )
    }
  }
}
