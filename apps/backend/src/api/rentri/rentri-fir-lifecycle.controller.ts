import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { TenantId } from '../../core/decorators/tenant.decorator'
import { UserId } from '../../core/decorators/user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { LoggerService } from '../../core/logger/logger.service'
import {
  GetAzioniDisponibiliUseCase,
  GetAzioniDisponibiliResult,
} from '../../application/rentri/get-azioni-disponibili.use-case'
import {
  AccettaORespingiFIRUseCase,
  EsitoAccettaORespingiFIR,
} from '../../application/rentri/accetta-o-respingi-fir.use-case'
import { AccettaFirRentriDto } from './dto/accetta-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'

/**
 * RENTRI FIR Lifecycle Controller (R3 Task 2).
 *
 * Espone il "motore della UI" del ciclo di vita del formulario digitale:
 * quali operazioni RENTRI sono disponibili ORA su un dato FIR. Ogni
 * operazione di scrittura futura (accettazione, annullamento, allegati,
 * ...) dovrà verificare PRIMA che l'operazione compaia in questa lista.
 *
 * Controller DEDICATO (non un'estensione di `RENTRISyncController`, dominio
 * distinto — trasmissione IN USCITA verso RENTRI — né di
 * `RentriFormulariController`, dominio "cercare→agganciare"): questo è il
 * ciclo di vita del formulario già agganciato.
 *
 * Autorizzazione: stessa politica di `RENTRISyncController` — è comunque un
 * adempimento verso un ente esterno, anche in sola lettura. Nessun ruolo
 * VIEWER: un VIEWER non deve vedere quali operazioni RENTRI sono pilotabili
 * (rivelerebbe lo stato di un adempimento in corso).
 */
@ApiTags('RENTRI FIR Lifecycle')
@ApiBearerAuth()
@Controller('rentri/fir')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriFirLifecycleController {
  constructor(
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly accettaORespingiFIRUseCase: AccettaORespingiFIRUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RentriFirLifecycleController')
  }

  /**
   * Azioni RENTRI disponibili sul FIR indicato: la difesa contro il 423 e
   * la fonte di verità per quali pulsanti mostrare (v. commento di classe di
   * `GetAzioniDisponibiliUseCase`).
   */
  @Get(':id/azioni')
  @ApiOperation({
    summary: 'Azioni RENTRI disponibili sul formulario',
    description:
      'Interroga /azioni sull’ente e riconcilia lo stato del FIR: da consultare PRIMA di proporre ' +
      'qualunque operazione di scrittura RENTRI (accettazione, annullamento, allegati, ...).',
  })
  @ApiResponse({ status: 200, description: 'Azioni disponibili' })
  @ApiResponse({ status: 400, description: 'FIR non legato a RENTRI o CF tenant mancante' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async getAzioniDisponibili(
    @Param('id') firId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string
  ): Promise<GetAzioniDisponibiliResult> {
    this.logger.debug('Azioni RENTRI disponibili richieste', { firId, tenantId, userId })

    try {
      return await this.getAzioniDisponibiliUseCase.execute(firId, tenantId)
    } catch (error: any) {
      this.logger.error('Lettura azioni RENTRI disponibili non riuscita', error, {
        firId,
        tenantId,
      })

      if (error instanceof DomainException && error.code === 'NOT_FOUND') {
        throw new NotFoundException(error.message)
      }
      if (error instanceof DomainException && error.code === 'UNAUTHORIZED') {
        throw new UnauthorizedException(error.message)
      }
      if (error instanceof DomainException) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }

  /**
   * Accetta o respinge (anche parzialmente) il carico ricevuto (R3 Task 4).
   * Verifica SEMPRE prima `/azioni` (v. `AccettaORespingiFIRUseCase`): mai
   * una scrittura diretta senza quella precondizione. Se l'ente accetta i
   * dati, chiude il ciclo con la firma remota RENTRI
   * (`CompletaOperazioneConFirmaUseCase`, R3 Task 3) e ne propaga l'esito.
   */
  @Post(':id/accettazione')
  @ApiOperation({
    summary: 'Accetta o respingi (anche parzialmente) il carico',
    description:
      'Verifica la precondizione da /azioni, invia i dati di accettazione a RENTRI e completa ' +
      "il ciclo con la firma remota. NON verifica autonomamente lo stato del formulario oltre a " +
      "quanto risulta da /azioni.",
  })
  @ApiResponse({ status: 200, description: 'Accettazione inviata ed esito della firma' })
  @ApiResponse({
    status: 400,
    description: 'Validazione locale fallita, operazione non disponibile o rifiutata dall’ente',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async accettaORespingi(
    @Param('id') firId: string,
    @Body() dto: AccettaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string
  ): Promise<EsitoAccettaORespingiFIR> {
    this.logger.debug('Accettazione/respingimento RENTRI richiesto', {
      firId,
      tenantId,
      userId,
      tipoAccettazione: dto.tipoAccettazione,
    })

    try {
      return await this.accettaORespingiFIRUseCase.execute({
        firId,
        tenantId,
        tipoAccettazione: dto.tipoAccettazione,
        dataOraArrivo: dto.dataOraArrivo,
        quantitaAccettataKg: dto.quantitaAccettataKg,
        causaleRespingimento: dto.causaleRespingimento,
        motivoRespingimento: dto.motivoRespingimento,
        attesaVerificaAnalitica: dto.attesaVerificaAnalitica,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Accettazione/respingimento RENTRI non riuscito', error, {
        firId,
        tenantId,
      })

      if (error instanceof DomainException && error.code === 'NOT_FOUND') {
        throw new NotFoundException(error.message)
      }
      if (error instanceof DomainException && error.code === 'UNAUTHORIZED') {
        throw new UnauthorizedException(error.message)
      }
      if (error instanceof DomainException) {
        throw new BadRequestException(error.message)
      }
      throw error
    }
  }
}
