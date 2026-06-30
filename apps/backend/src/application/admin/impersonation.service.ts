import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { JwtTokensService } from '../../auth/services/jwt-tokens.service'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

/**
 * Impersonificazione utenti per il SUPER_ADMIN (supporto/diagnosi).
 *
 * Emette un token che agisce come l'utente target (sub = utente target) con un
 * claim `impersonatorId` = id del SUPER_ADMIN, così la sessione e' tracciabile
 * e reversibile (il client conserva il proprio token e lo ripristina). Vincoli:
 * solo SUPER_ADMIN; non si impersona un altro SUPER_ADMIN; ogni evento e' loggato.
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtTokens: JwtTokensService
  ) {}

  async impersonate(currentUser: CurrentUserPayload, targetUserId: string) {
    if (currentUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException("Solo un super admin puo' impersonare un utente")
    }
    if (currentUser.impersonatorId) {
      // Evita impersonificazioni annidate: prima tornare al proprio account.
      throw new BadRequestException("Sei gia' in una sessione di impersonificazione")
    }
    if (targetUserId === currentUser.id) {
      throw new BadRequestException('Non puoi impersonare te stesso')
    }

    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        fiscalCode: true,
        firstName: true,
        lastName: true,
        tenantId: true,
        role: true,
      },
    })
    if (!target) {
      throw new NotFoundException('Utente non trovato')
    }
    if (target.role === 'SUPER_ADMIN') {
      throw new ForbiddenException("Non e' consentito impersonare un altro super admin")
    }

    const tokens = this.jwtTokens.generateTokenPair(
      {
        id: target.id,
        email: target.email,
        fiscalCode: target.fiscalCode ?? undefined,
        tenantId: target.tenantId,
        role: target.role,
      },
      currentUser.id // impersonatorId
    )

    // Audit (strutturato nei log): chi impersona chi e su quale tenant.
    this.logger.warn(
      `IMPERSONATION start: superAdmin=${currentUser.id} -> user=${target.id} (${target.email}) tenant=${target.tenantId}`
    )

    return {
      ...tokens,
      user: {
        id: target.id,
        firstName: target.firstName,
        lastName: target.lastName,
        email: target.email,
        tenantId: target.tenantId,
        role: target.role,
      },
    }
  }
}
