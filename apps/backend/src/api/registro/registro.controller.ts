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
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { RegistraMovimentoCommand } from '../../application/registro/commands/registra-movimento.command'
import { ListMovimentiQuery } from '../../application/registro/queries/list-movimenti.query'
import { RegistraMovimentoDto, ListMovimentiDto } from './dtos/registra-movimento.dto'

@ApiTags('registro')
@Controller('registro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RegistroController {
  constructor(
    private readonly registraMovimentoUseCase: RegistraMovimentoUseCase,
    private readonly listMovimentiHandler: ListMovimentiHandler,
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
  @ApiResponse({ status: 201, description: 'Movimento registrato con numero progressivo e hash vidimazione' })
  @ApiResponse({ status: 400, description: 'Dati non validi o giacenza insufficiente (per SCARICO)' })
  async registra(
    @Body() dto: RegistraMovimentoDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const movementDate = new Date(dto.movementDate)
    const registrationDate = dto.registrationDate ? new Date(dto.registrationDate) : new Date()

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
      dto.notes,
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
      { page: dto.page ?? 1, limit: dto.limit ?? 20 },
    )

    const result = await this.listMovimentiHandler.execute(query)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return result.value
  }
}
