import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AutomezziService } from '../../application/pese/automezzi.service'
import { AccessiPesaService } from '../../application/pese/accessi-pesa.service'
import { AllegatiPesaService } from '../../application/pese/allegati-pesa.service'
import { RettifichePesoService } from '../../application/pese/rettifiche-peso.service'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import {
  AperturaAccessoDto,
  CollegamentoDto,
  FiltriAccessiQueryDto,
  MotivoDto,
  RettificaDto,
  SecondaPesataDto,
} from './dto/accesso.dto'
import {
  allegatoDaRichiesta,
  contentDispositionInline,
  AllegatoInterceptor,
  RuoloPesaGuard,
  FileMulter,
} from './allegato-upload'
import { comeHttpPese } from './errori-http'
import { leggiDatiMultipart } from './multipart-dati'
import { AutomezzoDto, ElencoAutomezziQueryDto } from './dto/automezzo.dto'
import { StrumentoPesaDto } from './dto/strumento-pesa.dto'
import { ImpostaTaraDto } from './dto/tara.dto'
import { RUOLI_OPERATORE_PESA, RUOLI_RESPONSABILE_PESA } from './ruoli-pesa'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

function schemaMultipart(dto: string) {
  return {
    type: 'object',
    properties: {
      dati: { type: 'string', description: `JSON di ${dto} (max 16 kB)` },
      allegato: { type: 'string', format: 'binary', description: 'JPEG, PNG o PDF, max 4 MB' },
    },
    required: ['dati'],
  }
}

/**
 * Pese (4.8a) — anagrafiche di strumenti e automezzi. L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`) e i permessi seguono il ruolo EFFETTIVO in quell'azienda (D10),
 * controllati prima del servizio. La lettura e' aperta a chi ha accesso all'azienda.
 */
@ApiTags('pese')
@Controller('pese')
@RichiedeModulo('pese')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PeseController {
  constructor(
    private readonly strumenti: StrumentiPesaService,
    private readonly automezzi: AutomezziService,
    private readonly accessi: AccessiPesaService,
    private readonly allegati: AllegatiPesaService,
    private readonly rettifiche: RettifichePesoService,
    private readonly collegamenti: CollegamentiAccessoService,
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
    const dichiarata = dto.taraKg != null
    if (dichiarata === (dto.pesataId != null)) {
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

  // ---------------------------------------------------------------------------------------
  // Accessi, pesate manuali, rettifiche, collegamenti, allegati
  // ---------------------------------------------------------------------------------------

  @Get('accessi')
  @ApiOperation({ summary: 'Accessi alla pesa, più recenti prima (20 per pagina)' })
  @ApiResponse({ status: 200, description: 'Righe, totale, pagina e permessi del ruolo effettivo' })
  async elencaAccessi(@Req() req: any, @Query() query: FiltriAccessiQueryDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const elenco = await this.comeHttp(() => this.accessi.elenca(tenantId, query))
    return { ...elenco, ...this.permessi(ruolo) }
  }

  @Get('accessi/:id')
  @ApiOperation({ summary: 'Dettaglio di un accesso con pesate, rettifiche e collegamenti' })
  @ApiResponse({ status: 404, description: 'Accesso non trovato.' })
  async dettaglioAccesso(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const vista = await this.comeHttp(() => this.accessi.dettaglio(tenantId, id))
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('accessi')
  @UseGuards(RuoloPesaGuard(RUOLI_OPERATORE_PESA, 'OPERATORI'))
  @UseInterceptors(AllegatoInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: schemaMultipart('AperturaAccessoDto') })
  @ApiOperation({
    summary: 'Apre un accesso con la prima pesata manuale (operatori)',
    description:
      'Multipart: campo `dati` (JSON, max 16 kB, vedi AperturaAccessoDto) e file facoltativo ' +
      '`allegato` (JPEG, PNG o PDF, max 4 MB). Una pesata manuale NON ha garanzia metrologica: ' +
      "e' un peso dichiarato dall'operatore e come tale resta tracciato. Con la stessa " +
      "`chiaveIdempotenza` non si crea nulla e si restituisce l'accesso con `giaRegistrata: true`.",
  })
  @ApiResponse({ status: 201, description: 'Accesso aperto' })
  @ApiResponse({ status: 413, description: "L'allegato supera i 4 MB." })
  @ApiResponse({ status: 415, description: 'Sono ammessi solo foto JPEG o PNG e documenti PDF.' })
  async apriAccesso(
    @Req() req: any,
    @Body('dati') grezzo: unknown,
    @UploadedFile() file?: FileMulter
  ) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    const dati = await leggiDatiMultipart(AperturaAccessoDto, grezzo)
    const allegato = allegatoDaRichiesta(file)
    const vista = await this.comeHttp(() =>
      this.accessi.apri(tenantId, { id: req.user.id, ruolo }, dati, allegato)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('accessi/:id/seconda-pesata')
  @UseGuards(RuoloPesaGuard(RUOLI_OPERATORE_PESA, 'OPERATORI'))
  @UseInterceptors(AllegatoInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: schemaMultipart('SecondaPesataDto') })
  @ApiOperation({
    summary: 'Registra la seconda pesata manuale e chiude l’accesso (operatori)',
    description:
      'Multipart come l’apertura (`dati` = SecondaPesataDto). Pesata manuale: nessuna garanzia ' +
      'metrologica. Se il netto non è calcolabile l’accesso resta aperto.',
  })
  @ApiResponse({ status: 409, description: 'L’accesso non è più aperto.' })
  async secondaPesata(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('dati') grezzo: unknown,
    @UploadedFile() file?: FileMulter
  ) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    const dati = await leggiDatiMultipart(SecondaPesataDto, grezzo)
    const allegato = allegatoDaRichiesta(file)
    const vista = await this.comeHttp(() =>
      this.accessi.secondaPesata(tenantId, { id: req.user.id, ruolo }, id, dati, allegato)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('accessi/:id/annulla')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annulla un accesso con motivo',
    description: 'Operatori per un accesso aperto; solo amministratori per uno chiuso.',
  })
  async annulla(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    const vista = await this.comeHttp(() =>
      this.accessi.annulla(tenantId, { id: req.user.id, ruolo }, id, dto.motivo)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('pesate/:id/rettifiche')
  @UseGuards(RuoloPesaGuard(RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI'))
  @UseInterceptors(AllegatoInterceptor)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: schemaMultipart('RettificaDto') })
  @ApiOperation({
    summary: 'Rettifica il peso di una pesata, con motivo (amministratori)',
    description:
      'Multipart: `dati` = { pesoNuovoKg, motivo } e allegato facoltativo. La pesata originale ' +
      'non viene mai modificata: la rettifica è una riga aggiuntiva e tracciata.',
  })
  async rettifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('dati') grezzo: unknown,
    @UploadedFile() file?: FileMulter
  ) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    const dati = await leggiDatiMultipart(RettificaDto, grezzo)
    const allegato = allegatoDaRichiesta(file)
    const vista = await this.comeHttp(() =>
      this.rettifiche.rettifica(tenantId, { id: req.user.id, ruolo }, id, dati, allegato)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('accessi/:id/collegamenti')
  @ApiOperation({
    summary: 'Collega l’accesso a un FIR o a un’annotazione di registro (operatori)',
    description: '`{ tipo: "FIR", firId }` oppure `{ tipo: "MOVIMENTO", movimentoId }`.',
  })
  @ApiResponse({ status: 409, description: 'L’accesso o il documento è già collegato.' })
  async collega(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollegamentoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_OPERATORE_PESA, 'OPERATORI')
    const utente = { id: req.user.id, ruolo }
    if (dto.tipo === 'FIR') {
      if (!dto.firId || dto.movimentoId) {
        throw new BadRequestException('Per un collegamento a un FIR indicare solo il FIR.')
      }
      const firId = dto.firId
      const vista = await this.comeHttp(() =>
        this.collegamenti.collegaFir(tenantId, utente, id, firId)
      )
      return { ...vista, ...this.permessi(ruolo) }
    }
    if (!dto.movimentoId || dto.firId) {
      throw new BadRequestException('Per un collegamento al registro indicare solo l’annotazione.')
    }
    const movimentoId = dto.movimentoId
    const vista = await this.comeHttp(() =>
      this.collegamenti.collegaMovimento(tenantId, utente, id, movimentoId)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Post('collegamenti/:id/revoca')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoca un collegamento, con motivo (amministratori)' })
  async revoca(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MotivoDto) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiedi(req, tenantId, RUOLI_RESPONSABILE_PESA, 'AMMINISTRATORI')
    const vista = await this.comeHttp(() =>
      this.collegamenti.revoca(tenantId, { id: req.user.id, ruolo }, id, dto.motivo)
    )
    return { ...vista, ...this.permessi(ruolo) }
  }

  @Get('allegati/:id')
  @ApiOperation({
    summary: 'Scarica un allegato di una pesata',
    description: 'Byte con il tipo salvato, `nosniff` e senza cache.',
  })
  @ApiResponse({ status: 404, description: 'Allegato non trovato.' })
  async scaricaAllegato(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const a = await this.comeHttp(() => this.allegati.leggi(tenantId, id))
    res.status(HttpStatus.OK)
    res.setHeader('Content-Type', a.mimeType)
    res.setHeader('Content-Disposition', contentDispositionInline(a.nomeFile))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', 'sandbox')
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Length', String(a.contenuto.length))
    res.end(a.contenuto)
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
  ): Promise<RuoloApplicativo> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (ammessi.includes(ruolo)) return ruolo
    throw new ForbiddenException({
      message:
        chi === 'AMMINISTRATORI'
          ? "Solo un amministratore dell'azienda può eseguire questa operazione sulle pese."
          : "Il tuo ruolo nell'azienda selezionata non consente di operare sulle pese.",
      error: `PESE_RISERVATE_${chi}`,
    })
  }

  private comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    return comeHttpPese(fn)
  }
}
