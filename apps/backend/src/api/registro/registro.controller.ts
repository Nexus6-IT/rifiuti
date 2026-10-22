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
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
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

/**
 * Ruoli che possono impostare il progressivo iniziale del registro (C-W-02).
 * Oggi si confrontano col ruolo del token; il Task 18 (F28) li confronterà col ruolo
 * effettivo nell'azienda selezionata, sostituendo @Roles e `puoImpostareProgressivo`.
 */
const RUOLI_PROGRESSIVO_INIZIALE = ['SUPER_ADMIN', 'ADMIN'] as const

@ApiTags('registro')
@Controller('registro')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class RegistroController {
  constructor(
    private readonly registraMovimentoUseCase: RegistraMovimentoUseCase,
    private readonly listMovimentiHandler: ListMovimentiHandler,
    private readonly progressivoIniziale: ProgressivoInizialeService
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
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
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
  async registra(@Body() dto: RegistraMovimentoDto, @CurrentUser() user: CurrentUserPayload) {
    const movementDate = new Date(dto.movementDate)
    // La data di registrazione è l'istante in cui il movimento viene scritto (Decisione 10):
    // la assegna il server, quella eventualmente inviata dal client si ignora.
    const registrationDate = new Date()

    const command = new RegistraMovimentoCommand(
      user.tenantId,
      user.id,
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
  async lista(@Query() dto: ListMovimentiDto, @CurrentUser() user: CurrentUserPayload) {
    const query = new ListMovimentiQuery(
      user.tenantId,
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
   * `puoImpostare` (ruolo), così il client non deve dedurli da sé.
   */
  @Get('progressivo-iniziale/:anno')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Progressivo iniziale del registro per l'anno" })
  @ApiResponse({ status: 200, description: 'Stato del progressivo iniziale' })
  async leggiProgressivoIniziale(
    @Param('anno', ParseIntPipe) anno: number,
    @Req() req: any
  ): Promise<StatoProgressivoIniziale & { puoImpostare: boolean }> {
    const tenantId = requireRequestTenantId(req)
    const stato = await this.progressivoIniziale.leggi(tenantId, anno)
    return { ...stato, puoImpostare: this.puoImpostareProgressivo(req) }
  }

  /**
   * Imposta il primo numero del registro dell'anno (C-W-02): una volta sola, per l'anno
   * in corso o il prossimo, prima del primo movimento dell'anno.
   */
  @Put('progressivo-iniziale/:anno')
  @Roles(...RUOLI_PROGRESSIVO_INIZIALE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Imposta il progressivo iniziale del registro per l'anno",
    description:
      'Per chi arriva da un altro programma a metà anno: il primo movimento registrato qui ' +
      'prende questo numero. Si imposta una volta sola, prima del primo movimento.',
  })
  @ApiResponse({ status: 200, description: 'Progressivo iniziale impostato' })
  @ApiResponse({ status: 400, description: "Anno diverso dall'anno in corso o dal prossimo" })
  @ApiResponse({ status: 409, description: "Già impostato, o l'anno ha già movimenti" })
  async impostaProgressivoIniziale(
    @Param('anno', ParseIntPipe) anno: number,
    @Body() dto: ImpostaProgressivoInizialeDto,
    @Req() req: any
  ): Promise<{ anno: number; primoProgressivo: number }> {
    const tenantId = requireRequestTenantId(req)
    return this.progressivoIniziale.imposta(
      tenantId,
      anno,
      dto.primoProgressivo,
      dto.motivo,
      req.user.id
    )
  }

  /** Controllo del ruolo isolato qui: il Task 18 lo sostituisce col ruolo effettivo. */
  private puoImpostareProgressivo(req: any): boolean {
    return (RUOLI_PROGRESSIVO_INIZIALE as readonly string[]).includes(req?.user?.role)
  }
}
