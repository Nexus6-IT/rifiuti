/**
 * Legami movimento-cliente-prezzo (4.3b, Task 22, spec §8.1 e §9): `@Controller('legami-movimento')`.
 * Azienda SELEZIONATA (`requireRequestTenantId`), mai dal corpo ne' dal token; `@Roles` esplicito su
 * ogni rotta: lettura a tutti i ruoli (la proposta e` di sola lettura), scrittura dei legami a
 * SUPER_ADMIN/ADMIN/OPERATOR, «Aggiorna prezzi» solo ad ADMIN e SUPER_ADMIN. I codici 404/409 dei
 * servizi arrivano al client intatti. Rotte fisse (`contatori`, `proposta`, `azioni`,
 * `aggiorna-prezzi`, `da-movimento`) prima di `:id`.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AggiornaPrezziService } from '../../application/legami-movimento/aggiorna-prezzi.service'
import { AzioniMassaService } from '../../application/legami-movimento/azioni-massa.service'
import { LegamiService } from '../../application/legami-movimento/conferma-legame.service'
import {
  ListaLegamiService,
  type FiltriLista,
} from '../../application/legami-movimento/lista-legami.service'
import {
  PropostaLegameService,
  type InputProposta,
  type ScelteProposta,
} from '../../application/legami-movimento/proposta-legame.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AggiornaPrezziDto } from './dto/aggiorna-prezzi.dto'
import { AzioneMassaDto } from './dto/azione-massa.dto'
import { ConfermaLegameDto, EscludiLegameDto, RiammettiLegameDto } from './dto/conferma.dto'
import { ContatoriPerContrattoQueryDto, ListaLegamiQueryDto } from './dto/lista-legami.dto'
import { ModificaLegameDto } from './dto/modifica-legame.dto'
import { PropostaLegameDto } from './dto/proposta.dto'
import { RUOLI_AMMINISTRATORI, RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

/** Corpo della proposta -> input del servizio (nomi del registro) e scelte (`righe` -> `righeIds`). */
export function inputEScelteDaProposta(dto: PropostaLegameDto): {
  input: InputProposta
  scelte: ScelteProposta
} {
  const input: InputProposta = {
    causale: dto.causale,
    ...(dto.causaleAziendaId !== undefined && { causaleAziendaId: dto.causaleAziendaId }),
    type: dto.type,
    cerCode: dto.cerCode,
    movementDate: dto.movementDate,
    unit: dto.unit,
    quantity: dto.quantity,
    ...(dto.firId !== undefined && { firId: dto.firId }),
    ...(dto.producerSedeId !== undefined && { producerSedeId: dto.producerSedeId }),
  }
  const s = dto.scelte
  const scelte: ScelteProposta = {
    ...(s?.clienteId !== undefined && { clienteId: s.clienteId }),
    ...(s?.contrattoId !== undefined && { contrattoId: s.contrattoId }),
    ...(s?.elencoId !== undefined && { elencoId: s.elencoId }),
    ...(s?.righe !== undefined && { righeIds: s.righe.map(r => r.rigaAddebitoId) }),
  }
  return { input, scelte }
}

@ApiTags('legami-movimento')
@ApiBearerAuth()
@Controller('legami-movimento')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LegamiMovimentoController {
  constructor(
    private readonly proposte: PropostaLegameService,
    private readonly legami: LegamiService,
    private readonly lista_: ListaLegamiService,
    private readonly prezzi: AggiornaPrezziService,
    private readonly massa: AzioniMassaService
  ) {}

  @Post('proposta')
  @Roles(...RUOLI_LETTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Proposta di legame per un movimento da registrare (sola lettura)' })
  @ApiResponse({ status: 404, description: 'FIR_NON_TROVATO' })
  proposta(@Req() req: any, @Body() dto: PropostaLegameDto) {
    const { input, scelte } = inputEScelteDaProposta(dto)
    return this.proposte.calcola(requireRequestTenantId(req), input, scelte)
  }

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Lista «Da collegare»: { elementi, totale }' })
  @ApiResponse({ status: 400, description: 'FILTRI_LISTA_NON_VALIDI' })
  lista(@Req() req: any, @Query() query: ListaLegamiQueryDto) {
    // I valori arrivano come testo: `normalizzaFiltri` li valida e li converte (400 FILTRI_LISTA_NON_VALIDI).
    return this.lista_.lista(requireRequestTenantId(req), { ...query } as FiltriLista)
  }

  // `contatori` prima di `:id`: non va scambiata per un UUID.
  @Get('contatori')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({
    summary: 'Contatori della lista: { daCollegare, proposti, mancanti, daRiallineare }',
  })
  contatori(@Req() req: any) {
    return this.lista_.contatori(requireRequestTenantId(req))
  }

  // Rotta fissa su due segmenti: prima di `:id`.
  @Get('contatori/per-contratto')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({
    summary:
      'Contatori «da collegare» per contratto: { perContratto, senzaContratto }; ?contratti=id,id restringe ai contratti indicati',
  })
  @ApiResponse({ status: 400, description: 'FILTRI_LISTA_NON_VALIDI' })
  contatoriPerContratto(@Req() req: any, @Query() query: ContatoriPerContrattoQueryDto) {
    const ids =
      query.contratti === undefined ? undefined : query.contratti.split(',').filter(Boolean)
    return this.lista_.contatoriPerContratto(requireRequestTenantId(req), ids)
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio del legame, con i candidati per le scelte' })
  @ApiResponse({ status: 404, description: 'LEGAME_MOVIMENTO_NON_TROVATO' })
  dettaglio(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.legami.dettaglio(requireRequestTenantId(req), id)
  }

  @Put(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({
    summary: 'Modifica cliente, contratto, elenco, righe, quantità, prezzo e sconto',
  })
  @ApiResponse({ status: 409, description: 'VERSIONE_SUPERATA, STATO_LEGAME_NON_AMMESSO, …' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { versione, ...modifiche }: ModificaLegameDto
  ) {
    return this.legami.modifica(requireRequestTenantId(req), req.user.id, id, versione, modifiche)
  }

  @Post(':id/conferma')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Conferma il legame (congela i valori), con modifiche facoltative' })
  @ApiResponse({
    status: 409,
    description: 'LEGAME_INCOMPLETO (details.motivi), VERSIONE_SUPERATA, …',
  })
  conferma(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfermaLegameDto
  ) {
    return this.legami.conferma(
      requireRequestTenantId(req),
      req.user.id,
      id,
      dto.versione,
      dto.modifiche
    )
  }

  @Post(':id/escludi')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Esclude il legame dalla fatturazione, con un motivo' })
  escludi(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EscludiLegameDto) {
    return this.legami.escludi(
      requireRequestTenantId(req),
      req.user.id,
      id,
      dto.versione,
      dto.motivo
    )
  }

  @Post(':id/riammetti')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Riammette un legame escluso' })
  riammetti(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RiammettiLegameDto
  ) {
    return this.legami.riammetti(requireRequestTenantId(req), req.user.id, id, dto.versione)
  }

  @Post('azioni')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Conferma o esclude in massa (al massimo 500): { riusciti, falliti }' })
  @ApiResponse({ status: 200, description: 'Anche con tutti gli elementi falliti' })
  azioni(@Req() req: any, @Body() dto: AzioneMassaDto) {
    return this.massa.esegui(requireRequestTenantId(req), req.user.id, {
      azione: dto.azione,
      elementi: dto.elementi ?? [],
      movimentoIds: dto.movimentoIds,
      motivo: dto.motivo,
    })
  }

  @Post('aggiorna-prezzi')
  @Roles(...RUOLI_AMMINISTRATORI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '«Aggiorna prezzi»: senza firma anteprima, con la firma applica' })
  @ApiResponse({ status: 409, description: 'ANTEPRIMA_SUPERATA, LISTINO_NON_MODIFICABILE' })
  aggiornaPrezzi(@Req() req: any, @Body() dto: AggiornaPrezziDto) {
    const tenantId = requireRequestTenantId(req)
    return dto.firma === undefined
      ? this.prezzi.anteprima(tenantId, dto.perimetro)
      : this.prezzi.applica(tenantId, req.user.id, dto.perimetro, dto.firma)
  }

  @Post('da-movimento/:movimentoId')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera la proposta di un movimento senza legame (o lo riallinea)' })
  @ApiResponse({
    status: 409,
    description: 'CAUSALE_NON_FATTURABILE, MOVIMENTO_FUORI_FATTURAZIONE, …',
  })
  daMovimento(@Req() req: any, @Param('movimentoId', ParseUUIDPipe) movimentoId: string) {
    return this.massa.daMovimento(requireRequestTenantId(req), req.user.id, movimentoId)
  }
}
