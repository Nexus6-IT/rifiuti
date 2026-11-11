/**
 * FIR Controller - REST API (Extended)
 * Gestione completa Formulari Identificazione Rifiuti
 */

import {
  Controller,
  Post,
  Put,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common'
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiPropertyOptional,
} from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsUUID, Max, Min, ValidateIf } from 'class-validator'
import { CreateFIRDto } from './dtos/create-fir.dto'
import { ModificaFIRDto } from './dtos/modifica-fir.dto'
import { ListFIRsDto } from './dtos/list-firs.dto'
import { FIRResponseDto } from './dtos/fir-response.dto'
import { PaginatedFIRResponseDto } from './dtos/paginated-fir-response.dto'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { ModificaFIRUseCase } from '../../application/fir/use-cases/modifica-fir.use-case'
import { EmettiFIRUseCase } from '../../application/fir/use-cases/emetti-fir.use-case'
import { PresaInCaricoFIRUseCase } from '../../application/fir/use-cases/presa-in-carico-fir.use-case'
import { ConfermaConsegnaFIRUseCase } from '../../application/fir/use-cases/conferma-consegna-fir.use-case'
import { AnnullaFIRUseCase } from '../../application/fir/use-cases/annulla-fir.use-case'
import { GetFIRByIdQueryHandler } from '../../application/fir/queries/get-fir-by-id.handler'
import { ListFIRsQueryHandler } from '../../application/fir/queries/list-firs.handler'
import { CreateFIRCommand } from '../../application/fir/commands/create-fir.command'
import { EmettiFIRCommand } from '../../application/fir/commands/emetti-fir.command'
import { PresaInCaricoFIRCommand } from '../../application/fir/commands/presa-in-carico-fir.command'
import { ConfermaConsegnaFIRCommand } from '../../application/fir/commands/conferma-consegna-fir.command'
import { AnnullaFIRCommand } from '../../application/fir/commands/annulla-fir.command'
import { GetFIRByIdQuery } from '../../application/fir/queries/get-fir-by-id.query'
import { ListFIRsQuery } from '../../application/fir/queries/list-firs.query'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { SubscriptionEnforcementService } from '../../application/billing/subscription-enforcement.service'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import { comeHttpPese } from '../pese/errori-http'
import { RUOLI_OPERATORE_PESA } from '../pese/ruoli-pesa'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MaxDecimali } from '../../core/validators/max-decimali'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

/**
 * Ruoli EFFETTIVI (nell'azienda selezionata, A-C-06) che possono creare un FIR. Come nel
 * registro la decisione e' presa nel controller sul ruolo effettivo, non con `@Roles`.
 */
const RUOLI_CREAZIONE: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

/** Messaggio del 403 per creazione e modifica: stessa regola di ruolo, stesso testo. */
const MESSAGGIO_RUOLO_NON_AMMESSO =
  "Solo un amministratore o un operatore dell'azienda può creare o modificare FIR."

// La firma (produttore/trasportatore/destinatario) NON è più fornita dal
// client (Task 4, pipeline P3): il frontend non costruisce firme, chiede al
// backend di firmare e riceve l'esito. Emetti/PresaInCarico non richiedono
// più alcun body; ConfermaConsegna richiede solo il peso effettivo rilevato.
export class EmettiFIRDto {}

export class PresaInCaricoFIRDto {}

export class ConfermaConsegnaFIRDto {
  // Quantità verificata a destino, nell'unità del FIR. Nessuna tolleranza: il limite
  // alto e i 2 decimali sono quelli della colonna effective_weight Decimal(10,2).
  // Esattamente uno fra `pesoEffettivo` e `accessoId` (lo verifica il controller).
  @ApiPropertyOptional({ description: 'Peso verificato a destino, nell’unità del FIR' })
  @ValidateIf(o => o.pesoEffettivo !== undefined) // null non e' "assente": resta un errore
  @MaxDecimali(2, 'Il peso verificato')
  @Min(0.01)
  @Max(99999999.99)
  pesoEffettivo?: number

  // Accesso alla pesa CHIUSO di carico da cui prendere il netto (D12).
  @ApiPropertyOptional({ description: 'Accesso alla pesa da cui prendere il netto' })
  @ValidateIf(o => o.accessoId !== undefined)
  @IsUUID('all', { message: 'Accesso non valido.' })
  accessoId?: string
}

export class AnnullaFIRDto {
  // Un FIR è un documento legale: l'annullamento richiede sempre una motivazione
  // (tracciabilità/audit). Campo obbligatorio non vuoto.
  @IsString()
  @IsNotEmpty()
  motivo: string
}

@ApiTags('fir')
@Controller('fir')
@RichiedeModulo('fir')
// RolesGuard oltre a JwtAuthGuard: le azioni sul ciclo di vita (emetti/presa-in-carico/
// conferma-consegna/annulla) richiedono un ruolo operativo tramite @Roles. La creazione
// decide invece sul ruolo EFFETTIVO nell'azienda selezionata, dentro il controller. Le
// letture (list/get) restano aperte a chi ha accesso all'azienda selezionata (il RolesGuard
// lascia passare i metodi privi di @Roles).
// List, get e create operano sull'azienda selezionata (`requireRequestTenantId`), come il
// registro: il picker FIR del registro deve elencare i FIR dell'azienda su cui si registra.
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FIRControllerV2 {
  constructor(
    private readonly createFIRUseCase: CreateFIRUseCase,
    private readonly emettiFIRUseCase: EmettiFIRUseCase,
    private readonly presaInCaricoFIRUseCase: PresaInCaricoFIRUseCase,
    private readonly confermaConsegnaFIRUseCase: ConfermaConsegnaFIRUseCase,
    private readonly annullaFIRUseCase: AnnullaFIRUseCase,
    private readonly getFIRByIdHandler: GetFIRByIdQueryHandler,
    private readonly listFIRsHandler: ListFIRsQueryHandler,
    private readonly enforcement: SubscriptionEnforcementService,
    private readonly membership: RuoloEffettivoService,
    private readonly modificaFIRUseCase: ModificaFIRUseCase,
    private readonly collegamentiAccesso: CollegamentiAccessoService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea nuovo FIR in stato BOZZA',
    description: 'Crea un nuovo Formulario Identificazione Rifiuti in stato bozza',
  })
  @ApiResponse({ status: 201, description: 'FIR creato con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Dati non validi' })
  @ApiResponse({ status: 403, description: "Ruolo di sola consultazione nell'azienda selezionata" })
  async create(@Body() dto: CreateFIRDto, @Req() req: any): Promise<FIRResponseDto> {
    const user: CurrentUserPayload = req.user
    // Azienda selezionata, non il tenant primario del token: con un cliente selezionato il
    // FIR appartiene al cliente (e al suo registro e MUD), non allo studio del consulente.
    const tenantId = requireRequestTenantId(req)
    if (!RUOLI_CREAZIONE.includes(await this.membership.ruoloEffettivo(user, tenantId))) {
      throw new ForbiddenException({
        message: MESSAGGIO_RUOLO_NON_AMMESSO,
        error: 'FIR_RISERVATO_OPERATORI',
      })
    }

    // Enforcement abbonamento: blocca se tenant sospeso/scaduto o FIR limit raggiunto.
    await this.enforcement.assertNotSuspended(tenantId)
    await this.enforcement.assertFirLimitNotReached(tenantId)

    const command = new CreateFIRCommand(
      dto.produttoreId,
      dto.rifiuto,
      dto.trasportatoreId,
      dto.destinatarioId,
      user.id,
      tenantId,
      dto.provenienza,
      dto.tipoTrattaPrincipale,
      dto.trasportatoriAggiuntivi ?? [],
      dto.annotazioni,
      dto.produttoreSedeId,
      dto.destinatarioSedeId
    )

    const result = await this.createFIRUseCase.execute(command)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modifica una bozza di FIR',
    description:
      'Sostituisce il contenuto di una bozza (stesso corpo della creazione più la versione letta). ' +
      'Un FIR emesso, firmato, in attesa di firma o legato a RENTRI non si modifica.',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da modificare' })
  @ApiResponse({ status: 200, description: 'Bozza modificata', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Dati non validi' })
  @ApiResponse({ status: 403, description: "Ruolo di sola consultazione nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'FIR non trovato (codice FIR_NON_TROVATO)' })
  @ApiResponse({
    status: 409,
    description:
      'FIR_MODIFICATO_NEL_FRATTEMPO (versione non più corrente) oppure FIR_NON_MODIFICABILE ' +
      '(il messaggio indica il motivo)',
  })
  async modifica(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModificaFIRDto,
    @Req() req: any
  ): Promise<FIRResponseDto> {
    const user: CurrentUserPayload = req.user
    // Azienda selezionata e ruolo effettivo lì, come nella creazione.
    const tenantId = requireRequestTenantId(req)
    if (!RUOLI_CREAZIONE.includes(await this.membership.ruoloEffettivo(user, tenantId))) {
      throw new ForbiddenException({
        message: MESSAGGIO_RUOLO_NON_AMMESSO,
        error: 'FIR_RISERVATO_OPERATORI',
      })
    }

    // Abbonamento sospeso o scaduto; non il limite FIR, perché non si crea un FIR.
    await this.enforcement.assertNotSuspended(tenantId)

    // Gli errori di dominio D10 (409/404) non si convertono qui: li gestisce il filtro globale.
    const result = await this.modificaFIRUseCase.execute({
      firId: id,
      tenantId,
      userId: user.id,
      versione: dto.versione,
      produttoreId: dto.produttoreId,
      produttoreSedeId: dto.produttoreSedeId,
      trasportatoreId: dto.trasportatoreId,
      destinatarioId: dto.destinatarioId,
      destinatarioSedeId: dto.destinatarioSedeId,
      rifiuto: dto.rifiuto,
      provenienza: dto.provenienza,
      tipoTrattaPrincipale: dto.tipoTrattaPrincipale,
      trasportatoriAggiuntivi: dto.trasportatoriAggiuntivi ?? [],
      annotazioni: dto.annotazioni,
    })

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  // Lettura usata anche da pese (collega documento), registro e RENTRI: basta una delle chiavi.
  @RichiedeModulo('fir', 'registro', 'pese', 'rentri')
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lista FIR del tenant',
    description: 'Restituisce lista paginata di FIR con filtri opzionali',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista FIR restituita con successo',
    type: PaginatedFIRResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Parametri non validi' })
  async list(@Query() dto: ListFIRsDto, @Req() req: any): Promise<PaginatedFIRResponseDto> {
    const tenantId = requireRequestTenantId(req)
    // Build filters object
    const filters: any = {}
    if (dto.stato) {
      filters.stato = dto.stato
    }
    if (dto.cerCode) {
      filters.cerCode = dto.cerCode
    }
    if (dto.dataFrom) {
      filters.dataFrom = new Date(dto.dataFrom)
    }
    if (dto.dataTo) {
      filters.dataTo = new Date(dto.dataTo)
    }

    // Build pagination object
    const pagination = {
      page: dto.page ? parseInt(dto.page, 10) : 1,
      limit: dto.limit ? parseInt(dto.limit, 10) : 10,
    }

    const query = new ListFIRsQuery(
      tenantId,
      req.user.id,
      Object.keys(filters).length > 0 ? filters : undefined,
      pagination
    )

    const result = await this.listFIRsHandler.execute(query)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    // Map domain FIRs to response DTOs
    return {
      items: result.value.items.map(fir => FIRResponseDto.fromDomain(fir)),
      total: result.value.total,
      page: result.value.page,
      limit: result.value.limit,
      totalPages: result.value.totalPages,
    }
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recupera FIR per ID',
    description: 'Restituisce i dettagli di un FIR specifico',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR' })
  @ApiResponse({ status: 200, description: 'FIR trovato', type: FIRResponseDto })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 403, description: 'Non autorizzato' })
  async getById(@Param('id') id: string, @Req() req: any): Promise<FIRResponseDto> {
    const query = new GetFIRByIdQuery(id, req.user.id, requireRequestTenantId(req))

    const result = await this.getFIRByIdHandler.execute(query)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/emetti')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emetti FIR',
    description: 'Emette un FIR in stato BOZZA con numero progressivo e firma digitale',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da emettere' })
  @ApiResponse({ status: 200, description: 'FIR emesso con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async emetti(
    @Param('id') id: string,
    @Body() _dto: EmettiFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // La firma del produttore è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4): qui si passa solo l'identità di chi esegue
    // l'operazione (tracciabilità), non un valore costruito dal client.
    const command = new EmettiFIRCommand(id, user.id, user.email)

    const result = await this.emettiFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      // Il codice macchina (es. FIRMA_NON_RIUSCITA) viaggia in `error`: il client non legge il testo.
      throw new BadRequestException(
        result.code ? { message: result.error, error: result.code } : result.error
      )
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/presa-in-carico')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Presa in carico FIR',
    description: 'Presa in carico FIR da parte del trasportatore (EMESSO → IN_TRANSITO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da prendere in carico' })
  @ApiResponse({
    status: 200,
    description: 'FIR preso in carico con successo',
    type: FIRResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Stato non valido o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async presaInCarico(
    @Param('id') id: string,
    @Body() _dto: PresaInCaricoFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // La firma del trasportatore è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4).
    const command = new PresaInCaricoFIRCommand(id, user.id, user.email)

    const result = await this.presaInCaricoFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/conferma-consegna')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conferma consegna FIR',
    description: 'Conferma consegna FIR da parte del destinatario (IN_TRANSITO → CONSEGNATO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da confermare' })
  @ApiResponse({
    status: 200,
    description: 'Consegna FIR confermata con successo',
    type: FIRResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Stato non valido o peso non valido',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async confermaConsegna(
    @Param(
      'id',
      new ParseUUIDPipe({
        exceptionFactory: () => new BadRequestException('Identificativo FIR non valido'),
      })
    )
    id: string,
    @Body() dto: ConfermaConsegnaFIRDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req?: any
  ): Promise<FIRResponseDto> {
    if ((dto.pesoEffettivo != null) === (dto.accessoId != null)) {
      throw new BadRequestException(
        "Indicare il peso verificato oppure l'accesso da cui prenderlo."
      )
    }
    let peso = dto.pesoEffettivo as number
    if (dto.accessoId != null) {
      // Peso dal netto di un accesso alla pesa (4.8a): azienda selezionata e ruolo effettivo
      // lì. Il collegamento resta anche se lo use case poi fallisce (e' revocabile).
      const tenantId = requireRequestTenantId(req)
      // `req.user` e' l'utente del token (non quello "commutato" dall'interceptor): il ruolo
      // effettivo si risolve su di lui, come in creazione e modifica.
      const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
      if (!RUOLI_OPERATORE_PESA.includes(ruolo)) {
        throw new ForbiddenException({
          message: "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese.",
          error: 'PESE_RISERVATE_OPERATORI',
        })
      }
      const accessoId = dto.accessoId
      peso = await comeHttpPese(() =>
        this.collegamentiAccesso.pesoPerConsegnaFir(tenantId, req.user.id, id, accessoId)
      )
    }
    // La firma del destinatario è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4).
    const command = new ConfermaConsegnaFIRCommand(id, peso, user.id, user.email)

    const result = await this.confermaConsegnaFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/annulla')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annulla FIR',
    description:
      'Annulla un FIR non ancora consegnato (qualsiasi stato tranne CONSEGNATO → ANNULLATO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da annullare' })
  @ApiResponse({ status: 200, description: 'FIR annullato con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido (FIR già consegnato)' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async annulla(
    @Param('id') id: string,
    @Body() dto: AnnullaFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new AnnullaFIRCommand(id, dto.motivo, user.id)

    const result = await this.annullaFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }
}
