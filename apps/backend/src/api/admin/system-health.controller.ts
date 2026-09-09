/**
 * SystemHealthController — pagina «Stato del sistema».
 *
 * PERCHE' SOLO SUPER_ADMIN (e non anche ADMIN, come per utenti e tenant):
 * questa pagina misura la PIATTAFORMA, non un'azienda. Conteggi di code,
 * freschezza dei dati, numero di certificati in scadenza sono aggregati su
 * tutte le aziende — letti apposta con il client Prisma NON filtrato per
 * tenant (v. `EvidenzeDbService`). Darla a un ADMIN di tenant significherebbe
 * mostrargli l'attivita' aggregata dei concorrenti sulla stessa istanza.
 * L'ADMIN ha gia' la sua diagnostica di azienda: `GET /rentri/diagnostica`.
 *
 * Prefix globale `api/v1` applicato dall'app (NON ripetuto qui).
 */

import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { SystemHealthService } from '../../application/admin/system-health/system-health.service'
import { SystemHealth } from '../../application/admin/system-health/health-item'
import {
  EsitoAvvioJob,
  EventoAuditJob,
  JobActionsService,
} from '../../application/admin/system-health/job-actions.service'

@ApiTags('admin-system-health')
@ApiBearerAuth()
@Controller('admin/system-health')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class SystemHealthController {
  constructor(
    private readonly systemHealth: SystemHealthService,
    private readonly jobActions: JobActionsService
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Stato di salute della piattaforma, sezione per sezione',
    description:
      'Ogni voce dichiara stato, da quando e la prova numerica. Lo stato "unknown" significa ' +
      '«non misurabile con i dati disponibili» ed e\' deliberatamente distinto da "ok".',
  })
  @ApiResponse({ status: 200, description: 'Stato del sistema' })
  @ApiResponse({ status: 403, description: 'Riservato al SUPER_ADMIN' })
  async stato(): Promise<SystemHealth> {
    return this.systemHealth.stato()
  }

  @Post('actions/:key/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Rilancia subito un job schedulato',
    description:
      'Risponde 202 AVVIATO, non «eseguito»: alcuni giri durano minuti e attendere la fine ' +
      "trasformerebbe un timeout del proxy in un falso fallimento. L'esito si legge nello storico.",
  })
  @ApiResponse({ status: 202, description: 'Job avviato' })
  @ApiResponse({ status: 400, description: 'Chiave non corrispondente a un job rilanciabile' })
  @ApiResponse({ status: 409, description: 'Job gia in corso' })
  async avviaJob(
    @Param('key') key: string,
    @CurrentUser() utente: CurrentUserPayload
  ): Promise<EsitoAvvioJob> {
    const esito = await this.jobActions.avvia(key, {
      id: utente.id,
      email: utente.email,
      tenantId: utente.tenantId,
    })
    // L'effetto del rilancio deve potersi vedere al prossimo caricamento,
    // non fra un minuto di cache.
    this.systemHealth.invalidaCache()
    return esito
  }

  @Get('actions/audit')
  @ApiOperation({ summary: 'Storico dei rilanci manuali: chi, quando, quale job, con quale esito' })
  @ApiResponse({ status: 200, description: 'Storico dei rilanci' })
  async storico(@Query('limit') limite?: string): Promise<EventoAuditJob[]> {
    const richiesto = limite ? Number(limite) : 50
    return this.jobActions.storico(Number.isFinite(richiesto) ? richiesto : 50)
  }
}
