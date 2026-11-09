/**
 * RENTRI Siti Controller — REST API (R4 Task 3)
 *
 * "Le unità locali si leggono, non si digitano": espone le unità locali
 * dell'operatore così come RENTRI le restituisce (`GET /anagrafiche/v1.0/operatore/{num_iscr}/siti`),
 * allineate nella stessa tabella (`RentriUnitaLocale`) che R2 popola
 * manualmente — v. commento del model in schema.prisma.
 *
 * Distinto da `RentriUnitaLocaleController` (`/rentri/unita-locali`, CRUD
 * manuale R2): questo controller non crea/modifica righe di propria
 * iniziativa, orchestra solo la LETTURA (da cache) e l'ALLINEAMENTO (da
 * RENTRI) tramite {@link SincronizzaSitiUseCase}. Le due tabelle sono la
 * STESSA tabella: un'unità locale inserita manualmente e una letta
 * dall'ente convivono, l'allineamento aggiorna denominazione/stato di
 * quelle che l'ente riconosce senza toccare quelle inserite a mano che
 * l'ente non restituisce (nessuna cancellazione automatica, mai).
 *
 * Ruoli: SUPER_ADMIN/ADMIN su entrambi gli endpoint — stesso principio di
 * R1 Task 1: leggere/allineare le unità locali RENTRI è una configurazione
 * che impegna l'azienda verso l'ente, non un'azione operativa quotidiana.
 */

import { Controller, Get, Post, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { RentriUnitaLocale } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { SincronizzaSitiUseCase } from '../../application/rentri/use-cases/sincronizza-siti.use-case'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

interface RisultatoSiti {
  items: RentriUnitaLocale[]
}

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix è `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/siti`.
@Controller('rentri/siti')
@RichiedeModulo('rentri')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class RentriSitiController {
  constructor(private readonly sincronizzaSitiUseCase: SincronizzaSitiUseCase) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Elenca le unità locali RENTRI del tenant corrente (dalla cache locale)',
    description:
      'Se il tenant ha configurato numIscrOperatore e la cache è scaduta (oltre un’ora), allinea silenziosamente dall’ente prima di rispondere; un guasto verso RENTRI in questa fase non blocca la lettura, restituisce comunque la cache. Se numIscrOperatore non è configurato, restituisce la cache senza tentare alcuna chiamata.',
  })
  @ApiResponse({ status: 200, description: 'Elenco unità locali' })
  async list(@Req() req: any): Promise<RisultatoSiti> {
    const tenantId = requireRequestTenantId(req)
    const items = await this.sincronizzaSitiUseCase.esegui(tenantId)
    return { items }
  }

  @Post('aggiorna')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forza la rilettura delle unità locali dall’ente (ignora il TTL della cache)',
    description:
      'Fail-closed: se il tenant non ha configurato numIscrOperatore, risponde 400 con un messaggio azionabile invece di contattare RENTRI. Un errore dell’ente qui propaga (l’utente ha chiesto esplicitamente l’aggiornamento).',
  })
  @ApiResponse({ status: 200, description: 'Unità locali aggiornate dall’ente' })
  @ApiResponse({
    status: 400,
    description: 'numIscrOperatore non configurato: l’allineamento non parte',
  })
  async aggiorna(@Req() req: any): Promise<RisultatoSiti> {
    const tenantId = requireRequestTenantId(req)
    const items = await this.sincronizzaSitiUseCase.esegui(tenantId, { forza: true })
    return { items }
  }
}
