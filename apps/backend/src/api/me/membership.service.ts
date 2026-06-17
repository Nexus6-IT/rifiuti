import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { JwtTokensService } from '../../auth/services/jwt-tokens.service';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';

/**
 * Gestione multi-azienda dell'utente autenticato: elenco delle aziende
 * accessibili (tenant primario + possedute + associazioni attive) e switch
 * con ri-emissione del JWT sul tenant scelto.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtTokens: JwtTokensService,
  ) {}

  /** Tenant a cui l'utente ha accesso. */
  async listTenants(user: CurrentUserPayload) {
    const ids = new Set<string>();
    if (user.tenantId) ids.add(user.tenantId);

    const owned = await this.prisma.tenant.findMany({
      where: { ownerUserId: user.id },
      select: { id: true },
    });
    owned.forEach((t) => ids.add(t.id));

    const assoc = await this.prisma.consultantTenantAssociation.findMany({
      where: { consultantUserId: user.id, isActive: true },
      select: { tenantId: true },
    });
    assoc.forEach((a) => ids.add(a.tenantId));

    if (ids.size === 0) {
      return { tenants: [], currentTenantId: user.tenantId ?? null };
    }
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, ragioneSociale: true },
      orderBy: { ragioneSociale: 'asc' },
    });
    return { tenants, currentTenantId: user.tenantId ?? null };
  }

  /** Verifica l'accesso e ri-emette il JWT con il tenant target. */
  async switchTenant(user: CurrentUserPayload, targetTenantId: string) {
    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    if (!isSuperAdmin) {
      const isPrimary = user.tenantId === targetTenantId;
      let allowed = isPrimary;
      if (!allowed) {
        const owned = await this.prisma.tenant.findFirst({
          where: { id: targetTenantId, ownerUserId: user.id },
          select: { id: true },
        });
        allowed = !!owned;
      }
      if (!allowed) {
        const assoc = await this.prisma.consultantTenantAssociation.findFirst({
          where: { consultantUserId: user.id, tenantId: targetTenantId, isActive: true },
          select: { id: true },
        });
        allowed = !!assoc;
      }
      if (!allowed) {
        throw new ForbiddenException('Nessun accesso a questa azienda');
      }
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Azienda non trovata');

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, fiscalCode: true, role: true },
    });
    if (!dbUser) throw new NotFoundException('Utente non trovato');

    const tokens = this.jwtTokens.generateTokenPair({
      id: user.id,
      email: dbUser.email,
      fiscalCode: dbUser.fiscalCode ?? undefined,
      tenantId: targetTenantId,
      role: dbUser.role,
    });
    return { ...tokens, tenantId: targetTenantId };
  }
}
