import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { DomainError } from '../../core/domain/errors'
import { RUOLI_PROGRESSIVO_INIZIALE } from '../../api/registro/registro.controller'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { GiacenzeService } from './giacenze.service'
import { GiacenzeQueryDto } from './giacenze-query.dto'
import { SoglieDepositoDto } from './soglie-deposito.dto'
import { SoglieDepositoService, SoglieNonValideError } from './soglie-deposito.service'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

const MESSAGGIO_REGISTRO_NON_TROVATO = 'Registro non trovato.'

/**
 * Giacenze Controller — giacenze per CER, deposito temporaneo per registro e relative soglie.
 *
 * Il deposito temporaneo segue l'art. 185-bis D.Lgs. 152/2006: tre mesi di calendario oppure
 * 30 m3 (di cui al massimo 10 pericolosi), con un anno di durata massima. I limiti in volume
 * sono espressi in kg con la conversione indicata dall'azienda.
 */
@ApiTags('giacenze')
@Controller('giacenze')
@RichiedeModulo('giacenze')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class GiacenzeController {
  constructor(
    private readonly giacenzeService: GiacenzeService,
    private readonly soglie: SoglieDepositoService,
    private readonly membership: RuoloEffettivoService
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Giacenze correnti per CER (carico - scarico)' })
  @ApiResponse({ status: 200, description: 'Elenco giacenze per CER' })
  async getGiacenze(@Req() req: any, @Query() query: GiacenzeQueryDto) {
    // Azienda selezionata (X-Tenant-ID), non il tenant del token: con la RLS l'altra darebbe vuoto.
    return this.giacenzeService.getGiacenze(requireRequestTenantId(req), query.registroId)
  }

  @Get('deposito-temporaneo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deposito temporaneo per registro: lotti residui, scadenze e avvisi',
    description:
      "Per ogni registro dell'azienda (o per quello indicato) i CER con residuo, i lotti in ordine " +
      'FIFO per registro, la scadenza di ciascun CER e gli avvisi di durata (art. 185-bis D.Lgs. ' +
      '152/2006: tre mesi di calendario) e di quantità. I limiti di 30 m3 e 10 m3 pericolosi sono ' +
      "valutati sulla conversione in kg indicata dall'azienda; le quantità non in kg non entrano nei " +
      'totali (quantitaParziale). Oltre 50 lotti per famiglia di unità si restituiscono i 50 più vecchi.',
  })
  @ApiResponse({ status: 200, description: 'Vista del deposito temporaneo per registro' })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async getDepositoTemporaneo(@Req() req: any, @Query() query: GiacenzeQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() =>
      this.giacenzeService.getDepositoTemporaneo(tenantId, { registroId: query.registroId })
    )
  }

  @Get('deposito-temporaneo/alerts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Avvisi di deposito temporaneo (elenco piatto)',
    description:
      'API stabile non usata dal frontend, che legge la vista di `deposito-temporaneo`; resta per ' +
      'integrazioni e per un futuro riquadro in dashboard. Elenco piatto degli avvisi di durata ' +
      '(tre mesi di calendario, art. 185-bis D.Lgs. 152/2006) e di quantità, ciascuno con ' +
      'registroId e registroDescrizione. La soglia in kg è la conversione indicata dall’azienda ' +
      'del limite volumetrico.',
  })
  @ApiResponse({ status: 200, description: 'Avvisi di deposito temporaneo' })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async getDepositoTemporaneoAlerts(@Req() req: any, @Query() query: GiacenzeQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.comeHttp(() =>
      this.giacenzeService.getDepositoTemporaneoAlerts(tenantId, query.registroId)
    )
  }

  @Get('deposito-temporaneo/soglie')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soglie del deposito temporaneo: predefinite, azienda e registri',
    description:
      'Le soglie predefinite (tre mesi di calendario, 30.000 kg e 10.000 kg pericolosi, ' +
      "conversione dei 30 m3 e 10 m3 dell'art. 185-bis), quelle dell'azienda e quelle di ogni " +
      'registro. Vale la riga del registro, poi quella dell’azienda, poi le predefinite. ' +
      '`puoImpostare` dice se il ruolo effettivo può modificarle.',
  })
  @ApiResponse({ status: 200, description: 'Configurazione delle soglie' })
  async leggiSoglie(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    const configurazione = await this.soglie.leggiConfigurazione(tenantId)
    return { puoImpostare: RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo), ...configurazione }
  }

  @Put('deposito-temporaneo/soglie')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Imposta le soglie del deposito temporaneo dell'azienda (amministratori)",
    description:
      "Sostituisce la riga dell'azienda. `giorniMax` può solo anticipare i tre mesi di calendario " +
      '(al massimo 92, null = nessuna soglia aggiuntiva); i kg sono la conversione indicata ' +
      "dall'azienda dei 30 m3 e dei 10 m3 pericolosi dell'art. 185-bis D.Lgs. 152/2006.",
  })
  @ApiResponse({ status: 200, description: 'Soglie impostate' })
  @ApiResponse({ status: 400, description: 'Soglie non valide (details.messaggi)' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  async impostaSoglieAzienda(@Body() dto: SoglieDepositoDto, @Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() => this.soglie.imposta(tenantId, req.user.id, null, dto))
  }

  @Delete('deposito-temporaneo/soglie')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Rimuove le soglie dell'azienda: tornano le predefinite (amministratori)",
  })
  @ApiResponse({ status: 204, description: 'Rimosse (o già assenti)' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  async rimuoviSoglieAzienda(@Req() req: any): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    await this.comeHttp(() => this.soglie.elimina(tenantId, req.user.id, null))
  }

  @Put('deposito-temporaneo/soglie/registri/:registroId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imposta le soglie del deposito temporaneo di un registro (amministratori)',
    description:
      "Le soglie del registro sostituiscono per intero quelle dell'azienda (nessuna eredità per " +
      "campo). Stesse regole della rotta dell'azienda: tre mesi di calendario come limite di " +
      "legge, kg come conversione dei limiti volumetrici dell'art. 185-bis.",
  })
  @ApiResponse({ status: 200, description: 'Soglie impostate' })
  @ApiResponse({ status: 400, description: 'Soglie non valide (details.messaggi)' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async impostaSoglieRegistro(
    @Param('registroId', ParseUUIDPipe) registroId: string,
    @Body() dto: SoglieDepositoDto,
    @Req() req: any
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    return this.comeHttp(() => this.soglie.imposta(tenantId, req.user.id, registroId, dto))
  }

  @Delete('deposito-temporaneo/soglie/registri/:registroId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Rimuove le soglie di un registro: tornano quelle dell'azienda (amministratori)",
  })
  @ApiResponse({ status: 204, description: 'Rimosse (o già assenti)' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: "Registro non trovato (o di un'altra azienda)" })
  async rimuoviSoglieRegistro(
    @Param('registroId', ParseUUIDPipe) registroId: string,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAmministratore(req, tenantId)
    await this.comeHttp(() => this.soglie.elimina(tenantId, req.user.id, registroId))
  }

  /** La modifica spetta all'amministratore EFFETTIVO dell'azienda selezionata, prima del servizio. */
  private async richiediAmministratore(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_PROGRESSIVO_INIZIALE.includes(ruolo)) return
    throw new ForbiddenException({
      message:
        "Solo un amministratore dell'azienda può modificare le soglie del deposito temporaneo.",
      error: 'DEPOSITO_SOGLIE_RISERVATE_AMMINISTRATORI',
    })
  }

  /**
   * Gli errori di dominio del servizio diventano 404 (registro assente o di un'altra azienda, con
   * un messaggio senza id) e 400 (soglie non valide, coi messaggi in `details.messaggi`). Senza
   * questa traduzione il filtro globale li tratterebbe come errori imprevisti (500 e Bugsink).
   */
  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (err instanceof RegistroNonTrovatoError) {
        throw new NotFoundException(MESSAGGIO_REGISTRO_NON_TROVATO)
      }
      if (err instanceof SoglieNonValideError) {
        throw new BadRequestException({
          message: err.message,
          error: 'DEPOSITO_SOGLIE_NON_VALIDE',
          details: { messaggi: err.messaggi },
        })
      }
      if (err instanceof DomainError) throw new BadRequestException(err.message)
      throw err
    }
  }
}
