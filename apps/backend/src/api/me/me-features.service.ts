import { Injectable } from '@nestjs/common'
import { SubscriptionTier } from '@prisma/client'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { FEATURE_KEYS } from '../../application/admin/feature-catalog'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'

/** Risposta dell'endpoint GET /me/features. */
export interface MeFeaturesResponse {
  features: string[]
  tier: SubscriptionTier | null
  userLimitTotal: number | null
}

@Injectable()
export class MeFeaturesService {
  constructor(private readonly moduliAttivi: ModuliAttiviService) {}

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

    // Piano, feature e limite utenti vengono dal contratto della radice.
    const piano = await this.moduliAttivi.pianoAzienda(tenantId)

    // Tenant assente (caso anomalo): nessuna feature, fail-closed.
    if (!piano) {
      return { features: [], tier: null, userLimitTotal: null }
    }

    return {
      features: piano.moduli,
      tier: piano.tier,
      userLimitTotal: piano.userLimitTotal,
    }
  }
}
