/**
 * Registro Cronologico Controller — REST API
 * Registro di carico e scarico rifiuti (art. 190 D.Lgs 152/2006, DM 59/2023).
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Put,
  Req,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { RegistraMovimentoCommand } from '../../application/registro/commands/registra-movimento.command'
import { ListMovimentiQuery } from '../../application/registro/queries/list-movimenti.query'
import { RegistraMovimentoDto, ListMovimentiDto } from './dtos/registra-movimento.dto'
import { ImpostaProgressivoInizialeDto } from './dtos/progressivo-iniziale.dto'
import {
  ProgressivoInizialeService,
  StatoProgressivoIniziale,
} from '../../application/registro/progressivo-iniziale.service'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'

/**
 * Ruoli EFFETTIVI (nell'azienda selezionata, A-C-06) che possono registrare movimenti e
 * impostare il progressivo iniziale (C-W-02). Non si usa `@Roles`: `RolesGuard` vede solo il
 * ruolo del token e gira prima del `TenantSwitchInterceptor`, che seleziona l'azienda.
 */
const RUOLI_REGISTRAZIONE: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']
const RUOLI_PROGRESSIVO_INIZIALE: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']

@ApiTags('registro')
@Controller('registro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RegistroController {
  constructor(
    private readonly registraMovimentoUseCase: RegistraMovimentoUseCase,
    private readonly listMovimentiHandler: ListMovimentiHandler,
    private readonly progressivoIniziale: ProgressivoInizialeService,
    private readonly membership: RuoloEffettivoService
  ) {}

  /**
   * Registra un movimento di carico o scarico nel registro cronologico.
   * Assegna automaticamente il numero progressivo per l'anno corrente.
   * Calcola e persiste l'hash SHA-256 di vidimazione digitale (DM 59/2023).
   *
   * Per gli SCARICO verifica preventivamente che la giacenza del CER sia
   * sufficiente (anomaly detection: "scarico > carico" bloccante).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Registra movimento di carico/scarico nel registro cronologico',
    description:
      'Art. 190 D.Lgs 152/2006 — DM 59/2023. Assegna numero progressivo per anno. ' +
      'Per SCARICO: verifica giacenza preventiva e blocca se insufficiente. ' +
      'Hash SHA-256 di vidimazione digitale calcolato e persistito automaticamente.',
  })
  @ApiResponse({
    status: 201,
    description: 'Movimento registrato con numero progressivo e hash vidimazione',
  })
  @ApiResponse({
    status: 400,
    description: 'Dati non validi o giacenza insufficiente (per SCARICO)',
  })
  @ApiResponse({
    status: 403,
    description: "Ruolo di sola consultazione nell'azienda selezionata",
  })
  async registra(@Body() dto: RegistraMovimentoDto, @Req() req: any) {
    // Azienda selezionata, non il tenant del token: la selezione arriva con l'header
    // `X-Tenant-ID` (validato dal `TenantSwitchInterceptor`) e `user.tenantId` resta il
    // tenant del token; scrivere lì metterebbe il movimento nel registro di un'altra azienda.
    const tenantId = requireRequestTenantId(req)
    if (!(await this.haRuolo(req, tenantId, RUOLI_REGISTRAZIONE))) {
      throw new ForbiddenException({
        message: "Solo un amministratore o un operatore dell'azienda può registrare movimenti.",
        error: 'REGISTRO_RISERVATO_OPERATORI',
      })
    }

    const movementDate = new Date(dto.movementDate)
    // La data di registrazione è l'istante in cui il movimento viene scritto (Decisione 10):
    // la assegna il server, quella eventualmente inviata dal client si ignora.
    const registrationDate = new Date()

    const command = new RegistraMovimentoCommand(
      tenantId,
      req.user.id,
      dto.type,
      movementDate,
      registrationDate,
      dto.causale,
      dto.cerCode,
      dto.wasteDescription,
      dto.quantity,
      dto.unit ?? 'KG',
      dto.wastePhysicalState,
      dto.wasteHazardClasses,
      dto.operationCode,
      dto.counterpartName,
      dto.counterpartAddress,
      dto.firId,
      dto.notes
    )

    const result = await this.registraMovimentoUseCase.execute(command)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value
  }

  /**
   * Lista paginata del registro cronologico con filtri.
   * Filtri disponibili: tipo (CARICO/SCARICO), CER, causale, periodo, FIR collegato.
   * Ordinamento: data operazione DESC.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lista registro cronologico carico/scarico',
    description:
      'Registro cronologico paginato con filtri per tipo, CER, causale, periodo e FIR. ' +
      'Ordinato per data operazione decrescente.',
  })
  @ApiResponse({ status: 200, description: 'Lista movimenti paginata' })
  async lista(@Query() dto: ListMovimentiDto, @Req() req: any) {
    // Aperta a ogni ruolo con accesso all'azienda selezionata (l'accesso lo verifica il
    // TenantSwitchInterceptor); si legge il registro dell'azienda selezionata.
    const query = new ListMovimentiQuery(
      requireRequestTenantId(req),
      {
        type: dto.type,
        cerCode: dto.cerCode,
        causale: dto.causale,
        dataFrom: dto.dataFrom ? new Date(dto.dataFrom) : undefined,
        dataTo: dto.dataTo ? new Date(dto.dataTo) : undefined,
        firId: dto.firId,
      },
      { page: dto.page ?? 1, limit: dto.limit ?? 20 }
    )

    const result = await this.listMovimentiHandler.execute(query)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value
  }

  /**
   * Stato del progressivo iniziale del registro per l'anno (C-W-02), con quello che
   * serve al frontend per decidere se offrire l'impostazione: `haMovimenti` e
   * `puoImpostare` (ruolo effettivo nell'azienda selezionata), così il client non deve
   * dedurli da sé. `puoRegistrare` dice, con lo stesso ruolo, se mostrare la registrazione
   * di un movimento: chi è in sola consultazione riceverebbe comunque 403.
   */
  @Get('progressivo-iniziale/:anno')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Progressivo iniziale del registro per l'anno" })
  @ApiResponse({ status: 200, description: 'Stato del progressivo iniziale' })
  async leggiProgressivoIniziale(
    @Param('anno', ParseIntPipe) anno: number,
    @Req() req: any
  ): Promise<StatoProgressivoIniziale & { puoImpostare: boolean; puoRegistrare: boolean }> {
    const tenantId = requireRequestTenantId(req)
    const stato = await this.progressivoIniziale.leggi(tenantId, anno)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return {
      ...stato,
      puoImpostare: RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo),
      puoRegistrare: RUOLI_REGISTRAZIONE.includes(ruolo),
    }
  }

  /**
   * Imposta il primo numero del registro dell'anno (C-W-02): una volta sola, per l'anno
   * in corso o il prossimo, prima del primo movimento dell'anno.
   */
  @Put('progressivo-iniziale/:anno')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Imposta il progressivo iniziale del registro per l'anno",
    description:
      'Per chi arriva da un altro programma a metà anno: il primo movimento registrato qui ' +
      'prende questo numero. Si imposta una volta sola, prima del primo movimento.',
  })
  @ApiResponse({ status: 200, description: 'Progressivo iniziale impostato' })
  @ApiResponse({ status: 400, description: "Anno diverso dall'anno in corso o dal prossimo" })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 409, description: "Già impostato, o l'anno ha già movimenti" })
  async impostaProgressivoIniziale(
    @Param('anno', ParseIntPipe) anno: number,
    @Body() dto: ImpostaProgressivoInizialeDto,
    @Req() req: any
  ): Promise<{ anno: number; primoProgressivo: number }> {
    const tenantId = requireRequestTenantId(req)
    if (!(await this.haRuolo(req, tenantId, RUOLI_PROGRESSIVO_INIZIALE))) {
      throw new ForbiddenException({
        message:
          "Solo un amministratore dell'azienda può impostare il progressivo iniziale del registro.",
        error: 'REGISTRO_PROGRESSIVO_RISERVATO_AMMINISTRATORI',
      })
    }
    return this.progressivoIniziale.imposta(
      tenantId,
      anno,
      dto.primoProgressivo,
      dto.motivo,
      req.user.id
    )
  }

  /** Vero se il ruolo dell'utente nell'azienda selezionata è fra quelli indicati. */
  private async haRuolo(
    req: any,
    tenantId: string,
    ammessi: readonly RuoloApplicativo[]
  ): Promise<boolean> {
    return ammessi.includes(await this.membership.ruoloEffettivo(req.user, tenantId))
  }
}
