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
  Delete,
  Req,
  ParseUUIDPipe,
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
import { CreaGiacenzaInizialeDto, ModificaGiacenzaInizialeDto } from './dtos/giacenza-iniziale.dto'
import { RegistroIdQueryDto } from './dtos/registro-id-query.dto'
import { RegistriService, RegistroVista } from '../../application/registro/registri.service'
import { DomainError } from '../../core/domain/errors'
import {
  ProgressivoInizialeService,
  StatoProgressivoIniziale,
} from '../../application/registro/progressivo-iniziale.service'
import {
  EsitoCreazioneGiacenzaIniziale,
  GiacenzeInizialiService,
  GiacenzaInizialeVista,
  ElencoGiacenzeIniziali,
} from '../../application/registro/giacenze-iniziali.service'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'

/**
 * Ruoli EFFETTIVI (nell'azienda selezionata, A-C-06) che possono registrare movimenti e
 * impostare il progressivo iniziale (C-W-02). La decisione e' presa nel
 * controller sul ruolo effettivo, non con `@Roles`.
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
    private readonly membership: RuoloEffettivoService,
    private readonly registri: RegistriService,
    private readonly giacenzeIniziali: GiacenzeInizialiService
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
      dto.notes,
      dto.registroId
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
        registroId: dto.registroId,
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
   * Registri dell'azienda selezionata (uno per sede), in SOLA LETTURA: non ne crea. Aperta a
   * ogni ruolo con accesso all'azienda, come la lista. I registri nascono con
   * `POST registri/assicura` o alla prima registrazione.
   */
  @Get('registri')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Registri dell'azienda (uno per sede), in sola lettura" })
  @ApiResponse({ status: 200, description: 'Elenco dei registri' })
  async elencaRegistri(@Req() req: any): Promise<RegistroVista[]> {
    return this.comeBadRequest(() => this.registri.elenca(requireRequestTenantId(req)))
  }

  /**
   * Crea i registri mancanti (uno per sede attiva) e lega quello senza sede alla principale.
   * Idempotente. Scrive, quindi solo i ruoli che possono registrare: un utente in sola
   * consultazione non scrive mai.
   */
  @Post('registri/assicura')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assicura un registro per ogni sede attiva (idempotente)' })
  @ApiResponse({ status: 200, description: 'Elenco dei registri' })
  @ApiResponse({ status: 403, description: "Ruolo di sola consultazione nell'azienda selezionata" })
  async assicuraRegistri(@Req() req: any): Promise<RegistroVista[]> {
    const tenantId = requireRequestTenantId(req)
    if (!(await this.haRuolo(req, tenantId, RUOLI_REGISTRAZIONE))) {
      throw new ForbiddenException({
        message: "Solo un amministratore o un operatore dell'azienda può registrare movimenti.",
        error: 'REGISTRO_RISERVATO_OPERATORI',
      })
    }
    return this.comeBadRequest(() => this.registri.assicuraRegistri(tenantId))
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
    @Req() req: any,
    @Query() query?: RegistroIdQueryDto
  ): Promise<StatoProgressivoIniziale & { puoImpostare: boolean; puoRegistrare: boolean }> {
    const tenantId = requireRequestTenantId(req)
    const stato = await this.progressivoIniziale.leggi(tenantId, anno, query?.registroId)
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
    @Req() req: any,
    @Query() query?: RegistroIdQueryDto
  ): Promise<{ anno: number; primoProgressivo: number; registroId: string }> {
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
      req.user.id,
      query?.registroId
    )
  }

  /**
   * Giacenze iniziali (aperture) del registro (Fase 2 pezzo 2): lettura per chiunque legga il
   * registro; `puoImpostare` dice, col ruolo effettivo, se mostrare crea/modifica/elimina.
   * Un `registroId` esplicito inesistente è un 404; senza, vale il registro predefinito.
   */
  @Get('giacenze-iniziali')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Giacenze iniziali del registro' })
  @ApiResponse({
    status: 200,
    description:
      '{ registroId, puoImpostare, voci[] } (data come AAAA-MM-GG). `registroId` può essere ' +
      'null, con voci vuote, quando il registro non si determina (più registri senza sede ' +
      'principale, o nessun registro).',
  })
  @ApiResponse({ status: 400, description: 'registroId non è un UUID' })
  @ApiResponse({ status: 404, description: 'registroId indicato inesistente' })
  async elencaGiacenzeIniziali(
    @Req() req: any,
    @Query() query?: RegistroIdQueryDto
  ): Promise<ElencoGiacenzeIniziali & { puoImpostare: boolean }> {
    const tenantId = requireRequestTenantId(req)
    const elenco = await this.giacenzeIniziali.elenca(tenantId, query?.registroId)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { ...elenco, puoImpostare: RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo) }
  }

  @Post('giacenze-iniziali')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea una giacenza iniziale',
    description:
      'Una sola apertura per registro, CER (con o senza asterisco), stato fisico e famiglia di ' +
      'unità (kg e t sono la stessa). Non è un movimento: nessun progressivo. Gli eventuali ' +
      'avvisi (carichi «Altro carico» dello stesso CER) non bloccano.',
  })
  @ApiResponse({ status: 201, description: '{ giacenza, avvisi[] }' })
  @ApiResponse({ status: 400, description: 'Dati non validi (CER, quantita, data, origini...)' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'registroId indicato inesistente' })
  @ApiResponse({ status: 409, description: 'Esiste già una giacenza iniziale equivalente' })
  async creaGiacenzaIniziale(
    @Body() dto: CreaGiacenzaInizialeDto,
    @Req() req: any,
    @Query() query?: RegistroIdQueryDto
  ): Promise<EsitoCreazioneGiacenzaIniziale> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratoreGiacenze(req, tenantId)
    return this.giacenzeIniziali.crea(tenantId, req.user.id, dto, query?.registroId)
  }

  @Put('giacenze-iniziali/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modifica una giacenza iniziale (sostituzione completa)',
    description:
      'Sostituisce tutti i campi tranne CER e registro. quantita, unità e dataRiferimento sono ' +
      'obbligatori; statoFisico, origini e note sono facoltativi ma se omessi vengono SVUOTATI. ' +
      "Non modificabile se esiste uno scarico dello stesso CER registrato dopo l'apertura.",
  })
  @ApiResponse({ status: 200, description: '{ giacenza }' })
  @ApiResponse({ status: 400, description: 'Dati non validi' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'Giacenza iniziale non trovata' })
  @ApiResponse({ status: 409, description: 'Già usata da uno scarico, o duplicata' })
  async modificaGiacenzaIniziale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaGiacenzaInizialeDto,
    @Req() req: any
  ): Promise<{ giacenza: GiacenzaInizialeVista }> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratoreGiacenze(req, tenantId)
    return this.giacenzeIniziali.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete('giacenze-iniziali/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una giacenza iniziale (se non ancora usata da uno scarico)' })
  @ApiResponse({ status: 204, description: 'Eliminata' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'Giacenza iniziale non trovata' })
  @ApiResponse({ status: 409, description: 'Già usata da uno scarico' })
  async eliminaGiacenzaIniziale(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratoreGiacenze(req, tenantId)
    await this.giacenzeIniziali.elimina(tenantId, req.user.id, id)
  }

  /** G9: la scrittura delle giacenze iniziali spetta all'amministratore EFFETTIVO dell'azienda selezionata. */
  private async richiediAmministratoreGiacenze(req: any, tenantId: string): Promise<void> {
    if (await this.haRuolo(req, tenantId, RUOLI_PROGRESSIVO_INIZIALE)) return
    throw new ForbiddenException({
      message: "Solo un amministratore dell'azienda può gestire le giacenze iniziali del registro.",
      error: 'REGISTRO_GIACENZA_INIZIALE_RISERVATA_AMMINISTRATORI',
    })
  }

  /** Un errore di dominio dei registri (registro non trovato, da indicare...) è un 400 col suo messaggio. */
  private async comeBadRequest<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof DomainError) throw new BadRequestException(err.message)
      throw err
    }
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
