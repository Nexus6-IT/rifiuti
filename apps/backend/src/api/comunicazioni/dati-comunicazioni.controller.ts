import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import {
  ANAGRAFICA_COMUNICAZIONI_SERVICE,
  AnagraficaComunicazioniNonValidaError,
  SedeDittaNonTrovataError,
  type AnagraficaComunicazioniPort,
} from '../../application/comunicazioni/anagrafica-comunicazioni.port'
import {
  CONFIGURAZIONE_COMUNICAZIONI_SERVICE,
  ConfigurazioneComunicazioniNonValidaError,
  UnitaLocaleNonTrovataError,
  type ConfigurazioneComunicazioniPort,
} from '../../application/comunicazioni/configurazione-comunicazioni.port'
import {
  DATI_TRACCIATO_SERVICE,
  DatiTracciatoNonValidiError,
  type DatiTracciatoPort,
} from '../../application/comunicazioni/dati-tracciato.port'
import { MovimentoNonTrovatoError } from '../../application/comunicazioni/marcatura-consorzi.port'
import type { ConsorzioConfigurabile } from '../../domain/comunicazioni/configurazione-sede'
import type { TracciatoDati } from '../../domain/comunicazioni/dati-tracciato'
import { RuoloApplicativo, RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { AnagraficaComunicazioniDto } from './dto/dati-comunicazioni.dto'
import { RUOLI_OPERATORE_COMUNICAZIONI } from './ruoli'

enum TracciatoParam {
  CONOU = 'CONOU',
  COBAT = 'COBAT',
  ORR = 'ORR',
}

enum ConsorzioConfigurabileParam {
  CONOU = 'CONOU',
  COBAT = 'COBAT',
  ORSO = 'ORSO',
  ORR = 'ORR',
}

/**
 * Dati per i tracciati dei consorzi (4.9c-f): dati per movimento (CONOU, COBAT, O.R.R.), anagrafica
 * delle sedi delle ditte e configurazione per sede propria. Lettura: ogni ruolo dell'azienda
 * selezionata; scrittura: SUPER_ADMIN, ADMIN, OPERATOR (D16), sul ruolo EFFETTIVO in quell'azienda.
 * Un movimento o una sede di un'altra azienda e' un 404.
 */
@ApiTags('comunicazioni')
@Controller('comunicazioni/dati')
@RichiedeModulo('comunicazioni')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DatiComunicazioniController {
  constructor(
    @Inject(DATI_TRACCIATO_SERVICE) private readonly datiTracciato: DatiTracciatoPort,
    @Inject(ANAGRAFICA_COMUNICAZIONI_SERVICE)
    private readonly anagrafica: AnagraficaComunicazioniPort,
    @Inject(CONFIGURAZIONE_COMUNICAZIONI_SERVICE)
    private readonly configurazione: ConfigurazioneComunicazioniPort,
    private readonly membership: RuoloEffettivoService
  ) {}

  // --- Dati del tracciato per movimento -----------------------------------------------------

  @Get('movimenti/:id/:tracciato')
  @ApiOperation({ summary: 'Dati del tracciato di un movimento (null se non ne ha)' })
  async leggiDatiMovimento(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tracciato', new ParseEnumPipe(TracciatoParam)) tracciato: TracciatoDati
  ) {
    const tenantId = requireRequestTenantId(req)
    const dati = await this.comeHttp(() => this.datiTracciato.leggi(tenantId, id, tracciato))
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { dati, puoModificare: RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Put('movimenti/:id/:tracciato')
  @ApiOperation({ summary: 'Imposta i dati del tracciato di un movimento' })
  async impostaDatiMovimento(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tracciato', new ParseEnumPipe(TracciatoParam)) tracciato: TracciatoDati,
    @Body() dati: Record<string, unknown>
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    return this.comeHttp(() =>
      this.datiTracciato.imposta(tenantId, req.user.id, id, tracciato, dati)
    )
  }

  @Delete('movimenti/:id/:tracciato')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Toglie i dati del tracciato di un movimento' })
  async cancellaDatiMovimento(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tracciato', new ParseEnumPipe(TracciatoParam)) tracciato: TracciatoDati
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    await this.comeHttp(() => this.datiTracciato.cancella(tenantId, id, tracciato))
  }

  // --- Anagrafica della sede ditta ----------------------------------------------------------

  @Get('sedi-ditta/:id')
  @ApiOperation({ summary: 'Dati di una sede ditta per le comunicazioni, con l’ISTAT risolto' })
  async leggiAnagrafica(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    const [anagrafica, istat] = await this.comeHttp(() =>
      Promise.all([this.anagrafica.leggi(tenantId, id), this.anagrafica.risolviIstat(tenantId, id)])
    )
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { anagrafica, istat, puoModificare: RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Put('sedi-ditta/:id')
  @ApiOperation({ summary: 'Imposta i dati di una sede ditta per le comunicazioni' })
  async impostaAnagrafica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnagraficaComunicazioniDto
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    return this.comeHttp(() => this.anagrafica.imposta(tenantId, id, dto))
  }

  // --- Configurazione per sede propria ------------------------------------------------------

  @Get('sedi/:id/:consorzio')
  @ApiOperation({ summary: 'Configurazione di una sede per un consorzio (predefiniti se assente)' })
  async leggiConfigurazione(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consorzio', new ParseEnumPipe(ConsorzioConfigurabileParam))
    consorzio: ConsorzioConfigurabile
  ) {
    const tenantId = requireRequestTenantId(req)
    const configurazione = await this.comeHttp(() =>
      this.configurazione.leggi(tenantId, id, consorzio)
    )
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    return { ...configurazione, puoModificare: RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo) }
  }

  @Put('sedi/:id/:consorzio')
  @ApiOperation({ summary: 'Imposta la configurazione di una sede per un consorzio' })
  async impostaConfigurazione(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('consorzio', new ParseEnumPipe(ConsorzioConfigurabileParam))
    consorzio: ConsorzioConfigurabile,
    @Body() dati: Record<string, unknown>
  ) {
    const tenantId = requireRequestTenantId(req)
    await this.richiediOperatore(req, tenantId)
    return this.comeHttp(() => this.configurazione.imposta(tenantId, id, consorzio, dati))
  }

  private async richiediOperatore(req: any, tenantId: string): Promise<RuoloApplicativo> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (RUOLI_OPERATORE_COMUNICAZIONI.includes(ruolo)) return ruolo
    throw new ForbiddenException({
      message:
        "Il tuo ruolo nell'azienda selezionata non consente di modificare i dati delle comunicazioni.",
      error: 'COMUNICAZIONI_RISERVATE_OPERATORI',
    })
  }

  private async comeHttp<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (err) {
      if (
        err instanceof DatiTracciatoNonValidiError ||
        err instanceof AnagraficaComunicazioniNonValidaError ||
        err instanceof ConfigurazioneComunicazioniNonValidaError
      ) {
        throw new BadRequestException({
          message: err.message,
          error: 'DATI_COMUNICAZIONE_NON_VALIDI',
          details: { errori: err.errori },
        })
      }
      if (err instanceof MovimentoNonTrovatoError) {
        throw new NotFoundException({ message: err.message, error: 'MOVIMENTO_NON_TROVATO' })
      }
      if (err instanceof SedeDittaNonTrovataError || err instanceof UnitaLocaleNonTrovataError) {
        throw new NotFoundException({ message: err.message, error: 'SEDE_NON_TROVATA' })
      }
      throw err
    }
  }
}
