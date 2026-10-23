import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  ElencaBlocchiRentriUseCase,
  BloccoRentriDto,
} from '../../application/rentri/scorta/elenca-blocchi-rentri.use-case'
import {
  GetScortaRentriUseCase,
  GetScortaRentriResult,
} from '../../application/rentri/scorta/get-scorta-rentri.use-case'
import { AvviaVidimazioneScortaUseCase } from '../../application/rentri/scorta/avvia-vidimazione-scorta.use-case'
import {
  ImpostaBloccoPredefinitoUseCase,
  EsitoImpostaBloccoPredefinito,
} from '../../application/rentri/scorta/imposta-blocco-predefinito.use-case'
import {
  VerificaEmissionePossibileRentriUseCase,
  EsitoEmissionePossibile,
} from '../../application/rentri/scorta/verifica-emissione-possibile.use-case'
import { VidimaScortaRentriDto } from './dto/vidima-scorta-rentri.dto'

/**
 * REST API della scorta di numeri FIR pre-vidimati RENTRI (R6). Contratto
 * concordato col frontend (v. prompt del task) — path ed forme di risposta
 * NON vanno cambiati senza coordinarsi.
 *
 * Controller DEDICATO (non un'estensione di `RentriUnitaLocaleController` o
 * `RentriFirLifecycleController`): dominio distinto — qui si parla di
 * blocchi/scorta/vidimazione anticipata, non di anagrafica sedi né di ciclo
 * di vita di un FIR già legato.
 *
 * Autorizzazione: stessa politica di `RentriFirLifecycleController`
 * (adempimento verso un ente esterno, niente VIEWER). La sola scrittura di
 * configurazione (`PUT .../predefinito`) è ristretta a SUPER_ADMIN/ADMIN,
 * come le altre scritture di configurazione RENTRI
 * (`RentriUnitaLocaleController`).
 */
@ApiTags('rentri')
@ApiBearerAuth()
@Controller('rentri')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriScortaController {
  constructor(
    private readonly elencaBlocchi: ElencaBlocchiRentriUseCase,
    private readonly getScorta: GetScortaRentriUseCase,
    private readonly avviaVidimazione: AvviaVidimazioneScortaUseCase,
    private readonly impostaBloccoPredefinito: ImpostaBloccoPredefinitoUseCase,
    private readonly verificaEmissionePossibile: VerificaEmissionePossibileRentriUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RentriScortaController')
  }

  @Get('blocchi')
  @ApiOperation({
    summary: 'Blocchi virtuali RENTRI del tenant, letti dall’ente',
    description:
      'Nessuna API di creazione esiste: il blocco si crea solo sul portale RENTRI. Questo endpoint ' +
      'si limita a elencare quelli già esistenti.',
  })
  @ApiResponse({ status: 200, description: 'Elenco blocchi' })
  async getBlocchi(
    @CurrentUser() user: CurrentUserPayload
  ): Promise<{ blocchi: BloccoRentriDto[] }> {
    try {
      return await this.elencaBlocchi.execute(user.tenantId)
    } catch (error: unknown) {
      throw this.mappaErroreDominio(error)
    }
  }

  @Get('scorta')
  @ApiOperation({ summary: 'Numeri FIR pre-vidimati disponibili in scorta, per blocco' })
  @ApiResponse({ status: 200, description: 'Stato della scorta' })
  async getScortaCorrente(@CurrentUser() user: CurrentUserPayload): Promise<GetScortaRentriResult> {
    return this.getScorta.execute(user.tenantId)
  }

  @Post('scorta/vidima')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Avvia la vidimazione di un lotto di numeri sul blocco indicato',
    description:
      'La vidimazione NON è immediata: questo endpoint risponde 202 e avvia il lotto in background. ' +
      'Consultare GET /rentri/scorta per vedere quando i numeri diventano disponibili.',
  })
  @ApiResponse({ status: 202, description: 'Vidimazione avviata' })
  @ApiResponse({
    status: 404,
    description: 'Nessun blocco virtuale RENTRI con questo codice trovato per questo operatore',
  })
  async vidimaLotto(
    @Body() dto: VidimaScortaRentriDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<{ avviato: true; richiesti: number }> {
    this.logger.debug('Avvio vidimazione lotto RENTRI richiesto', {
      tenantId: user.tenantId,
      codiceBlocco: dto.codiceBlocco,
      quantita: dto.quantita,
    })

    // Verifica preventiva ATTESA: impedisce davvero la scrittura (e le
    // chiamate a vidimaFir) per un blocco inesistente, e il suo esito
    // risale al chiamante come errore vero (404), non come log silenzioso
    // dentro un fire-and-forget. Un ente irraggiungibile qui è transitorio
    // e NON fa fallire questa verifica (v. `AvviaVidimazioneScortaUseCase.verificaBlocco`).
    try {
      await this.avviaVidimazione.verificaBlocco(user.tenantId, dto.codiceBlocco)
    } catch (error: unknown) {
      throw this.mappaErroreDominio(error)
    }

    // Fire-and-forget deliberato SOLO per il ciclo di vidimazione: non è
    // immediato (v. audit RENTRI), l'endpoint risponde subito 202 dopo la
    // verifica di cui sopra. L'esito arriva via GET /scorta.
    this.avviaVidimazione.execute(user.tenantId, dto.codiceBlocco, dto.quantita).catch(error => {
      this.logger.error(
        'Vidimazione lotto RENTRI non riuscita in background',
        error instanceof Error ? error : new Error(String(error)),
        { tenantId: user.tenantId, codiceBlocco: dto.codiceBlocco }
      )
    })

    return { avviato: true, richiesti: dto.quantita }
  }

  @Put('blocchi/:codiceBlocco/predefinito')
  @Roles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Imposta questo blocco come predefinito per la sua unità locale' })
  @ApiResponse({ status: 200, description: 'Blocco predefinito impostato' })
  @ApiResponse({
    status: 404,
    description: 'Blocco non trovato presso l’ente, o sede non registrata',
  })
  async impostaPredefinito(
    @Param('codiceBlocco') codiceBlocco: string,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<EsitoImpostaBloccoPredefinito> {
    try {
      return await this.impostaBloccoPredefinito.execute(user.tenantId, codiceBlocco)
    } catch (error: unknown) {
      throw this.mappaErroreDominio(error)
    }
  }

  @Get('emissione-possibile')
  @ApiQuery({ name: 'numIscrSito', required: false })
  @ApiOperation({
    summary: 'Verifica se è possibile emettere ora un FIR RENTRI',
    description:
      'Da consultare PRIMA che l’utente compili un formulario: qui si scopre l’assenza di numeri ' +
      'disponibili subito, non al salvataggio.',
  })
  @ApiResponse({ status: 200, description: 'Esito della verifica' })
  async getEmissionePossibile(
    @CurrentUser() user: CurrentUserPayload,
    @Query('numIscrSito') numIscrSito?: string
  ): Promise<EsitoEmissionePossibile> {
    try {
      return await this.verificaEmissionePossibile.execute(user.tenantId, numIscrSito)
    } catch (error: unknown) {
      throw this.mappaErroreDominio(error)
    }
  }

  /** Stesso pattern di `RentriFirLifecycleController.mappaErroreDominio`. */
  private mappaErroreDominio(error: unknown): Error {
    if (error instanceof NotFoundException || error instanceof BadRequestException) {
      return error
    }
    if (!(error instanceof DomainException)) {
      return error as Error
    }
    if (error.code === 'NOT_FOUND') {
      return new NotFoundException(error.message)
    }
    return new BadRequestException(error.message)
  }
}
