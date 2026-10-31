import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { DomainError } from '../../core/domain/errors'
import { AutomezziService } from '../../application/pese/automezzi.service'
import {
  AutomezzoDuplicatoError,
  AutomezzoNonTrovatoError,
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  StrumentoDuplicatoError,
  StrumentoNonTrovatoError,
  TrasportatoreNonTrovatoError,
} from '../../application/pese/errori-pese'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { AutomezzoDto, ElencoAutomezziQueryDto } from './dto/automezzo.dto'
import { StrumentoPesaDto } from './dto/strumento-pesa.dto'
import { ImpostaTaraDto } from './dto/tara.dto'
import { RUOLI_OPERATORE_PESA, RUOLI_RESPONSABILE_PESA } from './ruoli-pesa'

/**
 * Pese (4.8a) — anagrafiche di strumenti e automezzi. L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`) e i permessi seguono il ruolo EFFETTIVO in quell'azienda (D10),
 * controllati prima del servizio. La lettura e' aperta a chi ha accesso all'azienda.
 */
@ApiTags('pese')
@Controller('pese')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PeseController {
  constructor(
    private readonly strumenti: StrumentiPesaService,
    private readonly automezzi: AutomezziService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get('strumenti')
  @ApiOperation({ summary: 'Strumenti di pesa dell’azienda' })
  @ApiResponse({ status: 200, description: 'Elenco con i permessi del ruolo effettivo' })
  async elencaStrumenti(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const righe = await this.comeHttp(() => this.strumenti.elenca(tenantId))
    return { righe, ...this.permessi(ruolo) }
  }

  @Post('strumenti')
  @ApiOperation({ summary: 'Crea uno strumento di pesa (amministratori)' })
  async creaStrumento(@Req() req: any, @Body() dto: StrumentoPesaDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return this.comeHttp(() => this.strumenti.crea(tenantId, req.user.id, dto))
  }

  @Put('strumenti/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggiorna uno strumento di pesa (amministratori)' })
  async aggiornaStrumento(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StrumentoPesaDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    return this.comeHttp(() => this.strumenti.aggiorna(tenantId, req.user.id, id, dto))
  }

  @Get('automezzi')
  @ApiOperation({ summary: 'Automezzi dell’azienda, con filtro per targa' })
  async elencaAutomezzi(@Req() req: any, @Query() query: ElencoAutomezziQueryDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const righe = await this.comeHttp(() => this.automezzi.elenca(tenantId, query.targa))
    return { righe, ...this.permessi(ruolo) }
  }

  @Post('automezzi')
  @ApiOperation({ summary: 'Crea un automezzo (operatori)' })
  @ApiResponse({ status: 409, description: 'Esiste già un automezzo con queste targhe.' })
  async creaAutomezzo(@Req() req: any, @Body() dto: AutomezzoDto) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    return this.comeHttp(() => this.automezzi.crea(tenantId, req.user.id, dto))
  }

  @Put('automezzi/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggiorna un automezzo (operatori)' })
  async aggiornaAutomezzo(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutomezzoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    return this.comeHttp(() => this.automezzi.aggiorna(tenantId, req.user.id, id, dto))
  }

  @Put('automezzi/:id/tara')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imposta la tara dell’automezzo',
    description:
      '`{ taraKg }` = tara dichiarata (amministratori); `{ pesataId }` = tara dal peso effettivo ' +
      'di una pesata (operatori).',
  })
  async impostaTara(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImpostaTaraDto
  ) {
    const tenantId = requireRequestTenantId(req)
    const dichiarata = dto.taraKg !== undefined
    if (dichiarata === (dto.pesataId !== undefined)) {
      throw new BadRequestException('Indicare la tara oppure la pesata da cui prenderla.')
    }
    if (dichiarata) {
      await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
      return this.comeHttp(() =>
        this.automezzi.impostaTara(tenantId, req.user.id, id, { taraKg: dto.taraKg as number })
      )
    }
    await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    return this.comeHttp(() =>
      this.automezzi.impostaTara(tenantId, req.user.id, id, { pesataId: dto.pesataId as string })
    )
  }

  private permessi(ruolo: RuoloApplicativo) {
    return {
      puoOperare: RUOLI_OPERATORE_PESA.includes(ruolo),
      puoRettificare: RUOLI_RESPONSABILE_PESA.includes(ruolo),
    }
  }

  /** Ruolo EFFETTIVO nell'azienda selezionata, verificato prima del servizio (403 con `error` macchina). */
  private async richiedi(
    req: any,
    tenantId: string,
    ammessi: readonly RuoloApplicativo[],
    chi: 'OPERATORI' | 'AMMINISTRATORI'
  ): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (ammessi.includes(ruolo)) return
    throw new ForbiddenException({
      message:
        chi === 'AMMINISTRATORI'
          ? "Solo un amministratore dell'azienda può eseguire questa operazione sulle pese."
          : "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese.",
      error: `PESE_RISERVATE_${chi}`,
    })
  }

  /** Errori di dominio tradotti in HTTP, con messaggi senza id. */
  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof DatiPesaNonValidiError) {
        throw new BadRequestException({
          message: err.message,
          error: 'PESE_DATI_NON_VALIDI',
          details: { messaggi: err.messaggi },
        })
      }
      if (err instanceof RegolaPesataError) {
        throw new UnprocessableEntityException({
          message: err.message,
          error: 'PESE_REGOLA_NON_RISPETTATA',
          details: { messaggi: err.messaggi },
        })
      }
      if (err instanceof AutomezzoDuplicatoError || err instanceof StrumentoDuplicatoError) {
        throw new ConflictException(err.message)
      }
      if (
        err instanceof AutomezzoNonTrovatoError ||
        err instanceof StrumentoNonTrovatoError ||
        err instanceof TrasportatoreNonTrovatoError ||
        err instanceof PesataNonTrovataError
      ) {
        throw new NotFoundException(err.message)
      }
      if (err instanceof RegistroNonTrovatoError)
        throw new NotFoundException('Registro non trovato.')
      if (err instanceof DomainError) throw new BadRequestException(err.message)
      throw err
    }
  }
}
