import {
  BadGatewayException,
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import { RUOLI_SCRITTURA_RENTRI } from '../../application/rentri/verifica-ruolo-scrittura-rentri'
import {
  ApriRegistroRentriUseCase,
  type EsitoApertura,
} from '../../application/rentri/registro/apri-registro-rentri.use-case'
import {
  CandidatiRegistroRentriUseCase,
  type CandidatoRegistroRentri,
} from '../../application/rentri/registro/candidati-registro-rentri.use-case'
import { CollegaRegistroRentriUseCase } from '../../application/rentri/registro/collega-registro-rentri.use-case'
import { AbbandonaAperturaRegistroRentriUseCase } from '../../application/rentri/registro/abbandona-apertura-registro-rentri.use-case'
import {
  ChiudiRegistroRentriUseCase,
  type EsitoChiusura,
} from '../../application/rentri/registro/chiudi-registro-rentri.use-case'
import {
  ModificaRegistroRentriUseCase,
  type EsitoModifica,
} from '../../application/rentri/registro/modifica-registro-rentri.use-case'
import {
  AperturaRegistroInCorsoError,
  AperturaRegistroNonRisoltaError,
  ChiusuraRegistroNonConfermataError,
  ChiusuraRegistroNonPossibileError,
  IdentificativoGiaUsatoError,
  NessunaAperturaDaAbbandonareError,
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
  IdentificativoRegistroNonValidoError,
  OperatoreRentriNonConfiguratoError,
  RegistroGiaCollegatoError,
  RegistroRentriNonCollegabileError,
  RegistroRentriNonTrovatoError,
  RegistroSenzaSedeRentriError,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
  TrasmissioneNonModificabileError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import type { ImpostazioniRegistro } from '../../application/rentri/registro/impostazioni-rentri-registro.service'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import {
  ApriRegistroRentriDto,
  ChiudiRegistroRentriDto,
  CollegaRegistroRentriDto,
  ModificaRegistroRentriDto,
} from './dto/rentri-registro.dto'

const uuidRegistro = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('Identificativo del registro non valido.'),
})

/**
 * Collegare o aprire il registro su RENTRI (eREGI E2). Stesso prefisso del controller del registro,
 * file separato: le rotte chiamano RENTRI (anagrafiche) e hanno errori propri.
 * Ruolo sempre quello EFFETTIVO nell'azienda selezionata.
 */
@ApiTags('rentri-registro')
@Controller('rentri/registro')
@RichiedeModulo('rentri')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RentriRegistroCollegamentoController {
  constructor(
    private readonly candidati: CandidatiRegistroRentriUseCase,
    private readonly collega: CollegaRegistroRentriUseCase,
    private readonly apri: ApriRegistroRentriUseCase,
    private readonly modifica: ModificaRegistroRentriUseCase,
    private readonly chiudi: ChiudiRegistroRentriUseCase,
    private readonly abbandona: AbbandonaAperturaRegistroRentriUseCase,
    private readonly membership: RuoloEffettivoService
  ) {}

  /** Errori di dominio e dell'ente -> HTTP; messaggi in italiano, senza dati fiscali (l'identificativo del registro RENTRI non e' un dato sensibile). */
  private traduci(err: unknown): unknown {
    if (err instanceof RuoloNonAutorizzatoRentriError) return new ForbiddenException(err.message)
    if (err instanceof RegistroNonTrovatoError) return new NotFoundException(err.message)
    if (
      err instanceof IdentificativoRegistroNonValidoError ||
      err instanceof RichiestaTrasmissioneNonValidaError ||
      err instanceof RegistroRentriNonTrovatoError
    ) {
      return new BadRequestException(err.message)
    }
    if (err instanceof ChiusuraRegistroNonPossibileError) {
      return new ConflictException({
        message: err.message,
        details: { conteggi: err.conteggi },
      })
    }
    if (
      err instanceof RegistroRentriNonCollegabileError ||
      err instanceof RegistroSenzaSedeRentriError ||
      err instanceof OperatoreRentriNonConfiguratoError ||
      err instanceof AperturaRegistroInCorsoError ||
      err instanceof AperturaRegistroNonRisoltaError ||
      err instanceof RegistroGiaCollegatoError ||
      err instanceof RegistroNonCollegatoRentriError ||
      err instanceof RegistroRentriChiusoError ||
      err instanceof ChiusuraRegistroNonConfermataError ||
      err instanceof NessunaAperturaDaAbbandonareError ||
      err instanceof TrasmissioneNonModificabileError ||
      err instanceof IdentificativoGiaUsatoError
    ) {
      return new ConflictException(err.message)
    }
    if (err instanceof RentriApiError) {
      if (err.status === 403) {
        return new ForbiddenException(
          "RENTRI non consente l'accesso a questa risorsa: verifica il certificato della tua azienda e che il registro appartenga alla tua azienda."
        )
      }
      if (err.retryable || err.status >= 500) {
        return new ServiceUnavailableException(
          'RENTRI non risponde in questo momento: riprova tra qualche minuto.'
        )
      }
      if (err.status === 400 || err.status === 404 || err.status === 422) {
        return new BadRequestException(
          `RENTRI ha rifiutato la richiesta${err.problemTitle ? `: ${err.problemTitle}` : '.'}`
        )
      }
      return new BadGatewayException('RENTRI ha risposto in modo inatteso: riprova più tardi.')
    }
    return err
  }

  private async conErrori<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw this.traduci(err)
    }
  }

  private async ruolo(req: any, tenantId: string): Promise<string> {
    return await this.membership.ruoloEffettivo(req.user, tenantId)
  }

  private async richiediAdmin(req: any, tenantId: string): Promise<string> {
    const ruolo = await this.ruolo(req, tenantId)
    if (!['SUPER_ADMIN', 'ADMIN'].includes(ruolo)) {
      throw this.traduci(new RuoloNonAutorizzatoRentriError())
    }
    return ruolo
  }

  @Get('registri/:registroId/rentri/candidati')
  @ApiOperation({ summary: 'Registri RENTRI della sede del registro, a cui collegarlo' })
  @ApiResponse({ status: 200, description: 'Elenco dei registri aperti della sede' })
  async elencaCandidati(
    @Param('registroId', uuidRegistro) registroId: string,
    @Req() req: any
  ): Promise<{ candidati: CandidatoRegistroRentri[] }> {
    const tenantId = requireRequestTenantId(req)
    // Chiama RENTRI (quota condivisa dell'azienda): stesso ruolo di chi trasmette.
    const ruolo = await this.ruolo(req, tenantId)
    if (!(RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo)) {
      throw new ForbiddenException(
        'Il tuo ruolo in questa azienda non consente di leggere i registri RENTRI.'
      )
    }
    return { candidati: await this.conErrori(() => this.candidati.esegui(tenantId, registroId)) }
  }

  @Post('registri/:registroId/rentri/collega')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Collega il registro a uno già aperto su RENTRI (amministratori)' })
  @ApiResponse({ status: 200, description: 'Registro collegato' })
  @ApiResponse({ status: 400, description: 'Identificativo non valido o non trovato su RENTRI' })
  @ApiResponse({
    status: 409,
    description: 'Altra sede, chiuso, già usato o annotazioni già partite',
  })
  async collegaRegistro(
    @Param('registroId', uuidRegistro) registroId: string,
    @Body() dto: CollegaRegistroRentriDto,
    @Req() req: any
  ): Promise<ImpostazioniRegistro> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    return this.conErrori(() =>
      this.collega.esegui(tenantId, req.user.id, ruolo, registroId, dto.identificativo)
    )
  }

  @Post('registri/:registroId/rentri/apri')
  @ApiOperation({ summary: 'Apre un nuovo registro su RENTRI (amministratori)' })
  @ApiResponse({ status: 201, description: 'Registro aperto (o ritrovato dopo un esito incerto)' })
  @ApiResponse({
    status: 202,
    description: "Esito dell'apertura incerto: non riprovare, WasteFlow lo verifica",
  })
  @ApiResponse({ status: 409, description: 'Già collegato, apertura in corso o non risolta' })
  async apriRegistro(
    @Param('registroId', uuidRegistro) registroId: string,
    @Body() dto: ApriRegistroRentriDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response
  ): Promise<EsitoApertura> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    const esito = await this.conErrori(() =>
      this.apri.esegui(tenantId, req.user.id, ruolo, registroId, {
        attivita: dto.attivita,
        attivitaRecSmalt: dto.attivitaRecSmalt ?? [],
        descrizione: dto.descrizione ?? null,
      })
    )
    res.status(esito.esito === 'INCERTO' ? HttpStatus.ACCEPTED : HttpStatus.CREATED)
    return esito
  }

  @Put('registri/:registroId/rentri')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modifica descrizione e codici R/D del registro su RENTRI (amministratori)',
  })
  @ApiResponse({ status: 200, description: 'Registro modificato' })
  @ApiResponse({ status: 202, description: 'Esito incerto: il registro non risulta cambiato' })
  @ApiResponse({ status: 409, description: 'Non collegato o chiuso su RENTRI' })
  async modificaRegistro(
    @Param('registroId', uuidRegistro) registroId: string,
    @Body() dto: ModificaRegistroRentriDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response
  ): Promise<EsitoModifica> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    const esito = await this.conErrori(() =>
      this.modifica.esegui(tenantId, req.user.id, ruolo, registroId, {
        ...(dto.descrizione !== undefined ? { descrizione: dto.descrizione } : {}),
        ...(dto.attivitaRecSmalt !== undefined ? { attivitaRecSmalt: dto.attivitaRecSmalt } : {}),
        ...(dto.forza !== undefined ? { forza: dto.forza } : {}),
      })
    )
    res.status(esito.esito === 'INCERTO' ? HttpStatus.ACCEPTED : HttpStatus.OK)
    return esito
  }

  @Post('registri/:registroId/rentri/chiudi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chiude il registro su RENTRI, IRREVERSIBILE (amministratori, doppia conferma)',
  })
  @ApiResponse({ status: 200, description: 'Registro chiuso' })
  @ApiResponse({ status: 202, description: 'Esito incerto: invii fermi, ripetere la richiesta' })
  @ApiResponse({
    status: 409,
    description: 'Annotazioni in volo o da trasmettere (con i conteggi), non collegato, già chiuso',
  })
  async chiudiRegistro(
    @Param('registroId', uuidRegistro) registroId: string,
    @Body() dto: ChiudiRegistroRentriDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response
  ): Promise<EsitoChiusura> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    const esito = await this.conErrori(() =>
      this.chiudi.esegui(tenantId, req.user.id, ruolo, registroId, dto.conferma)
    )
    res.status(esito.esito === 'INCERTO' ? HttpStatus.ACCEPTED : HttpStatus.OK)
    return esito
  }

  @Post('registri/:registroId/rentri/abbandona-apertura')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Abbandona un'apertura rimasta incerta (amministratori)" })
  @ApiResponse({ status: 200, description: "Prenotazione dell'apertura azzerata" })
  @ApiResponse({ status: 409, description: 'Nessuna apertura, già collegato o troppo presto' })
  async abbandonaApertura(
    @Param('registroId', uuidRegistro) registroId: string,
    @Req() req: any
  ): Promise<ImpostazioniRegistro> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    return this.conErrori(() => this.abbandona.esegui(tenantId, req.user.id, ruolo, registroId))
  }
}
