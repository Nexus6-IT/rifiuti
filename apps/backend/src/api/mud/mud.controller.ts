import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UseGuards,
  Req,
  Res,
  BadRequestException,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { Response } from 'express'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { MUDGeneratorService, MudRiepilogo } from '../../application/mud/mud-generator.service'
import { MudExportService } from '../../application/mud/export/mud-export.service'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MudObbligoService, ObbligoMud } from '../../application/mud/mud-obbligo.service'
import { ImpostaObbligoMudDto } from './dtos/obbligo-mud.dto'
import {
  MudPresentazioneService,
  StatoPresentazioneMud,
} from '../../application/mud/mud-presentazione.service'
import { SegnaPresentatoDto } from './dtos/segna-presentato.dto'
import { AnnullaPresentazioneDto } from './dtos/annulla-presentazione.dto'
import { MudIntegrazioniService } from '../../application/mud/mud-integrazioni.service'
import type { IntegrazioniMud } from '../../application/mud/aggregazione/mud-integrazioni'
import { IntegrazioniMudDto } from './dtos/integrazioni-mud.dto'

/**
 * Ruoli EFFETTIVI (nell'azienda selezionata, A-C-06) che possono segnare l'azienda come non
 * tenuta al MUD (A-W-10). Non si usa `@Roles`: `RolesGuard` vede solo il ruolo del token e
 * gira prima del `TenantSwitchInterceptor`, che seleziona l'azienda.
 */
const RUOLI_OBBLIGO_MUD: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']

/** Ruoli EFFETTIVI che possono segnare o annullare la presentazione del MUD (A-C-06). */
const RUOLI_PRESENTAZIONE_MUD: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']

/** Ruoli EFFETTIVI che possono modificare le integrazioni del MUD (A-C-06). */
const RUOLI_INTEGRAZIONI_MUD: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']

/**
 * MUD Controller
 *
 * Handles MUD (Modello Unico Dichiarazione) annual report generation + export
 * telematico versionato per anno.
 */
@Controller('mud')
@UseGuards(JwtAuthGuard)
@ApiTags('MUD Reports')
@ApiBearerAuth()
export class MudController {
  constructor(
    private readonly mudGenerator: MUDGeneratorService,
    private readonly mudExport: MudExportService,
    private readonly membership: RuoloEffettivoService,
    private readonly obbligo: MudObbligoService,
    private readonly presentazione: MudPresentazioneService,
    private readonly integrazioni: MudIntegrazioniService
  ) {}

  /**
   * Riepilogo dell'anno, con il ruolo dell'utente nell'azienda selezionata (A-C-06): la pagina
   * lo usa per mostrare il download con avvisi, la presentazione e l'obbligo, perché il ruolo
   * del token non è quello effettivo nell'azienda del cliente.
   */
  @Get('generate')
  @ApiOperation({ summary: 'Generate MUD report for a specific year' })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2024 })
  async generateReport(
    @Req() req: any,
    @Query('year') year: string
  ): Promise<MudRiepilogo & { ruoloEffettivo: RuoloApplicativo }> {
    const tenantId = requireRequestTenantId(req)
    const reportYear = this.parseYear(year)

    const [riepilogo, ruoloEffettivo] = await Promise.all([
      this.mudGenerator.generateMUDReport(tenantId, reportYear),
      this.membership.ruoloEffettivo(req.user, tenantId),
    ])
    return { ...riepilogo, ruoloEffettivo }
  }

  @Get('export')
  @ApiOperation({
    summary: 'Esporta il file MUD telematico (versionato per anno)',
    description:
      'Genera il file MUD nel formato telematico Unioncamere della versione ' +
      "corrispondente all'anno richiesto. Il file va validato sull'applicazione " +
      "ufficiale (mudtelematico.it) prima dell'invio.",
  })
  @ApiQuery({ name: 'year', required: true, type: Number, example: 2024 })
  @ApiQuery({
    name: 'avvisiConfermati',
    required: false,
    type: String,
    description: 'Codici degli avvisi confermati, separati da virgola',
  })
  async exportTelematico(
    @Req() req: any,
    @Res() res: Response,
    @Query('year') year: string,
    @Query('avvisiConfermati') avvisiConfermati?: string | string[]
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    // Codici degli avvisi confermati, separati da virgola; il parametro ripetuto arriva da
    // Express come array e vale come lo stesso elenco.
    const confermati = [avvisiConfermati ?? []]
      .flat()
      .join(',')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    // La conferma degli avvisi dipende dal ruolo nell'azienda selezionata, non da quello del
    // token (A-C-06): un consulente ADMIN del proprio studio, associato al cliente come
    // CONSULTANT, nel MUD del cliente non è un amministratore. Si decide qui e non con un
    // guard perché `RolesGuard` gira prima del `TenantSwitchInterceptor`.
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const result = await this.mudExport.exportTelematico(
      tenantId,
      this.parseYear(year),
      { id: req.user.id, role: ruolo },
      confermati
    )

    res.setHeader('Content-Type', 'text/plain; charset=us-ascii')
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`)
    res.setHeader('X-MUD-Version', result.version)
    res.send(result.content)
  }

  @Get('export/versions')
  @ApiOperation({ summary: 'Versioni tracciato MUD supportate (per anno)' })
  async exportVersions() {
    return { versions: this.mudExport.supportedVersions() }
  }

  /**
   * Obbligo del MUD dell'azienda selezionata (A-W-10): lo leggono tutti i ruoli. `puoModificare`
   * applica la stessa regola del PUT, così il frontend non la ripete.
   */
  @Get('obbligo')
  @ApiOperation({ summary: "Se l'azienda è segnata come non tenuta al MUD" })
  @ApiResponse({
    status: 200,
    description: "Flag, motivo, data, utente che lo ha impostato e se l'utente può modificarlo",
  })
  async leggiObbligo(@Req() req: any): Promise<ObbligoMud & { puoModificare: boolean }> {
    const tenantId = requireRequestTenantId(req)
    const [obbligo, puoModificare] = await Promise.all([
      this.obbligo.leggi(tenantId),
      this.puoModificareObbligo(req, tenantId),
    ])
    return { ...obbligo, puoModificare }
  }

  /**
   * Segna l'azienda selezionata come non tenuta al MUD, o di nuovo tenuta (A-W-10). Solo un
   * amministratore nell'azienda selezionata (ruolo effettivo, non quello del token).
   */
  @Put('obbligo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Imposta se l'azienda è tenuta al MUD",
    description:
      'Con il flag attivo lo scadenzario non manda promemoria del MUD; il file si può ' +
      'generare comunque, con un avviso. Il motivo è obbligatorio con il flag attivo.',
  })
  @ApiResponse({ status: 200, description: 'Obbligo aggiornato' })
  @ApiResponse({ status: 400, description: 'Motivo mancante o non valido' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  async impostaObbligo(@Body() dto: ImpostaObbligoMudDto, @Req() req: any): Promise<ObbligoMud> {
    const tenantId = requireRequestTenantId(req)
    if (!(await this.puoModificareObbligo(req, tenantId))) {
      throw new ForbiddenException({
        message: "Solo un amministratore dell'azienda può modificare l'obbligo del MUD.",
        error: 'MUD_OBBLIGO_RISERVATO_AMMINISTRATORI',
      })
    }
    return this.obbligo.imposta(tenantId, req.user.id, dto.mudNonDovuto, dto.motivo ?? null)
  }

  /** Stato della presentazione del MUD dell'anno dei dati: lo leggono tutti i ruoli. */
  @Get(':year/presentazione')
  @ApiOperation({ summary: 'Stato della presentazione del MUD (anno dei dati)' })
  async statoPresentazione(
    @Req() req: any,
    @Param('year', ParseIntPipe) year: number
  ): Promise<StatoPresentazioneMud> {
    return this.presentazione.stato(requireRequestTenantId(req), year)
  }

  /**
   * Segna il MUD dell'anno come presentato, legato a un'esportazione registrata. Solo un
   * amministratore nell'azienda selezionata (ruolo effettivo, non quello del token, A-C-06).
   */
  @Post(':year/presentazione')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Segna il MUD come presentato' })
  @ApiResponse({ status: 200, description: 'Stato della presentazione aggiornato' })
  @ApiResponse({ status: 400, description: 'Data futura' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 409, description: 'MUD già presentato: annullare prima la segnatura' })
  @ApiResponse({ status: 422, description: 'Esportazione indicata non trovata' })
  async segnaPresentato(
    @Req() req: any,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: SegnaPresentatoDto
  ): Promise<StatoPresentazioneMud> {
    const tenantId = await this.richiediAmministratorePresentazione(req)
    return this.presentazione.segnaPresentato(
      tenantId,
      year,
      req.user.id,
      dto.dataPresentazione ? new Date(dto.dataPresentazione) : undefined,
      dto.esportazioneGenerataIl
    )
  }

  /**
   * Annulla la presentazione del MUD dell'anno, conservandola nello storico con il motivo:
   * con `DICHIARAZIONE_DA_SOSTITUIRE` il prossimo file annulla e sostituisce quella
   * comunicazione (A-W-04).
   */
  @Delete(':year/presentazione')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Annulla la presentazione del MUD' })
  @ApiResponse({ status: 200, description: 'Stato della presentazione aggiornato' })
  @ApiResponse({ status: 400, description: 'Motivo mancante o non valido' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  async annullaPresentazione(
    @Req() req: any,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: AnnullaPresentazioneDto
  ): Promise<StatoPresentazioneMud> {
    const tenantId = await this.richiediAmministratorePresentazione(req)
    return this.presentazione.annullaPresentazione(tenantId, year, req.user.id, dto.motivo)
  }

  /**
   * Integrazioni del MUD dell'anno dei dati: le leggono tutti i ruoli. `codiciAzienda` (partita
   * IVA e CF dell'azienda) serve alla pagina per chiedere la conferma quando un destinatario ha
   * il codice dell'azienda stessa (A-W-13), con la stessa regola del PUT.
   */
  @Get(':year/integrazioni')
  @ApiOperation({ summary: 'Integrazioni del MUD (anno dei dati)' })
  async leggiIntegrazioni(
    @Req() req: any,
    @Param('year', ParseIntPipe) year: number
  ): Promise<IntegrazioniMud & { codiciAzienda: string[] }> {
    const tenantId = requireRequestTenantId(req)
    const [integrazioni, codiciAzienda] = await Promise.all([
      this.integrazioni.leggi(tenantId, year),
      this.integrazioni.codiciAzienda(tenantId),
    ])
    return { ...integrazioni, codiciAzienda }
  }

  /**
   * Sostituisce le integrazioni del MUD dell'anno (Decisione 18): CF dei destinatari e dei
   * trasportatori, destinatario degli scarichi senza FIR, peso specifico per le unità non di
   * massa. Solo un amministratore nell'azienda selezionata (ruolo effettivo, A-C-06): niente
   * `@Roles`, che vedrebbe solo il ruolo del token.
   */
  @Put(':year/integrazioni')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Salva le integrazioni del MUD' })
  @ApiResponse({ status: 200, description: 'Integrazioni salvate' })
  @ApiResponse({
    status: 400,
    description: 'CF non valido, codice della propria azienda o peso specifico non confermati',
  })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'Anno senza tracciato' })
  async salvaIntegrazioni(
    @Req() req: any,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: IntegrazioniMudDto
  ): Promise<IntegrazioniMud> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!RUOLI_INTEGRAZIONI_MUD.includes(ruolo)) {
      throw new ForbiddenException({
        message: "Solo un amministratore dell'azienda può modificare le integrazioni del MUD.",
        error: 'MUD_INTEGRAZIONI_RISERVATE_AMMINISTRATORI',
      })
    }
    return this.integrazioni.salva(tenantId, year, req.user.id, dto)
  }

  /**
   * Azienda selezionata, se l'utente vi è amministratore; altrimenti 403. Niente `@Roles`:
   * `RolesGuard` gira prima del `TenantSwitchInterceptor` e vede solo il ruolo del token.
   */
  private async richiediAmministratorePresentazione(req: any): Promise<string> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!RUOLI_PRESENTAZIONE_MUD.includes(ruolo)) {
      throw new ForbiddenException({
        message: "Solo un amministratore dell'azienda può segnare o annullare la presentazione.",
        error: 'MUD_PRESENTAZIONE_RISERVATA_AMMINISTRATORI',
      })
    }
    return tenantId
  }

  /** Vero se il ruolo nell'azienda selezionata permette di modificare l'obbligo del MUD. */
  private async puoModificareObbligo(req: any, tenantId: string): Promise<boolean> {
    return RUOLI_OBBLIGO_MUD.includes(await this.membership.ruoloEffettivo(req.user, tenantId))
  }

  /**
   * Valida e converte il parametro `year`: obbligatorio e numerico.
   * Manca o non numerico → 400.
   */
  private parseYear(year: string): number {
    if (year === undefined || year === null || year === '') {
      throw new BadRequestException('Parametro year obbligatorio')
    }
    if (!/^\d+$/.test(String(year).trim())) {
      throw new BadRequestException(`Parametro year non valido: "${year}"`)
    }
    return parseInt(year, 10)
  }

  @Get('years')
  @ApiOperation({ summary: 'Get available years for MUD reporting' })
  async getAvailableYears(@Req() _req: any) {
    const currentYear = new Date().getFullYear()
    const years = []

    // Last 5 years
    for (let i = 0; i < 5; i++) {
      years.push(currentYear - i)
    }

    return { years }
  }
}
