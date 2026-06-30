import { Injectable } from '@nestjs/common'
import { SubscriptionTier } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { FEATURE_KEYS, effectiveFeatures } from '../../application/admin/feature-catalog'

/** Risposta dell'endpoint GET /me/features. */
export interface MeFeaturesResponse {
  features: string[]
  tier: SubscriptionTier | null
  userLimitTotal: number | null
}

@Injectable()
export class MeFeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcola feature/piano/limite utenze per l'utente autenticato.
   *
   * - Utente con tenant → feature effettive del tenant (override featureFlags o
   *   default del piano), più tier e userLimitTotal del tenant.
   * - SUPER_ADMIN senza tenant selezionato (tenantId vuoto) → TUTTE le feature,
   *   senza tier/limite (cross-tenant).
   */
  async getFeaturesForUser(currentUser: CurrentUserPayload): Promise<MeFeaturesResponse> {
    const tenantId = currentUser.tenantId

    // SUPER_ADMIN cross-tenant (nessun tenant nel JWT): vede tutte le feature.
    if (!tenantId) {
      return {
        features: [...FEATURE_KEYS],
        tier: null,
        userLimitTotal: null,
      }
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        subscriptionTier: true,
        userLimitTotal: true,
        featureFlags: true,
      },
    })

    // Tenant assente (caso anomalo): nessuna feature, fail-closed.
    if (!tenant) {
      return { features: [], tier: null, userLimitTotal: null }
    }

    return {
      features: effectiveFeatures(tenant),
      tier: tenant.subscriptionTier,
      userLimitTotal: tenant.userLimitTotal,
    }
  }
}
