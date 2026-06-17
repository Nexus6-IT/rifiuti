import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { MeFeaturesService } from './me-features.service';

/**
 * MeFeaturesController
 *
 * Espone le feature effettivamente abilitate per il tenant dell'utente
 * autenticato. Usato dal frontend per pilotare la UI (mostrare/nascondere
 * moduli) e dalle guardie applicative.
 *
 * Prefix globale `api/v1` applicato dall'app → risolve a `/api/v1/me/features`.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeFeaturesController {
  constructor(private readonly meFeaturesService: MeFeaturesService) {}

  /**
   * GET /api/v1/me/features
   * Ritorna `{ features, tier, userLimitTotal }` per il tenant corrente.
   * Per un SUPER_ADMIN senza tenant selezionato ritorna TUTTE le feature.
   */
  @Get('features')
  async getFeatures(@CurrentUser() currentUser: CurrentUserPayload) {
    return this.meFeaturesService.getFeaturesForUser(currentUser);
  }
}
