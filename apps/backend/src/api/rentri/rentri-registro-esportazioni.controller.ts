import {
  BadGatewayException,
  BadRequestException,
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
  Req,
  Res,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import { RUOLI_SCRITTURA_RENTRI } from '../../application/rentri/verifica-ruolo-scrittura-rentri'
import { EsportazioneRegistroNonValidaError } from '../../application/rentri/registro/costruisci-esportazione-registro'
import {
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import {
  CatenaEsportazioniNonCoerenteError,
  EregiNonDisponibileError,
  EsportazioneNonRivalidabileError,
  EsportazioneNonTrovataError,
  UltimaEsportazioneRifiutataError,
} from '../../application/rentri/registro/errori-esportazioni-registro-rentri'
import {
  EsportazioniRegistroRentriService,
  type VoceElencoEsportazione,
} from '../../application/rentri/registro/esportazioni-registro-rentri.service'
import {
  GeneraEsportazioneRegistroRentriUseCase,
  type EsitoGenerazioneEsportazione,
} from '../../application/rentri/registro/genera-esportazione-registro-rentri.use-case'
import {
  ValidaEsportazioneRegistroRentriUseCase,
  type EsitoValidazioneEsportazione,
} from '../../application/rentri/registro/valida-esportazione-registro-rentri.use-case'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { traduciRentriApiError } from './traduci-rentri-api-error'

const uuid = (messaggio: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException(messaggio) })
const uuidRegistro = uuid('Identificativo del registro non valido.')
const uuidEsportazione = uuid("Identificativo dell'esportazione non valido.")

/**
 * Esportazioni XML firmate del registro (eREGI E6). Stesso prefisso del controller del registro.
 * Lettura (elenco, file): qualunque ruolo dell'azienda selezionata, e' solo database. Generare e
 * rivalidare chiamano RENTRI (quota condivisa dell'azienda): stesso ruolo di chi trasmette.
 * Il ruolo e' sempre quello EFFETTIVO nell'azienda selezionata.
 */
@ApiTags('rentri-registro')
@Controller('rentri/registro')
@RichiedeModulo('rentri')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RentriRegistroEsportazioniController {
  constructor(
    private readonly genera: GeneraEsportazioneRegistroRentriUseCase,
    private readonly valida: ValidaEsportazioneRegistroRentriUseCase,
    private readonly esportazioni: EsportazioniRegistroRentriService,
    private readonly membership: RuoloEffettivoService
  ) {}

  /** Errori di dominio e dell'ente -> HTTP; messaggi in italiano, senza dati fiscali ne' id interni. */
  private traduci(err: unknown): unknown {
    if (err instanceof RegistroNonTrovatoError || err instanceof EsportazioneNonTrovataError) {
      return new NotFoundException(err.message)
    }
    if (
      err instanceof RegistroNonCollegatoRentriError ||
      err instanceof RegistroRentriChiusoError ||
      err instanceof UltimaEsportazioneRifiutataError ||
      err instanceof CatenaEsportazioniNonCoerenteError ||
      err instanceof EsportazioneNonRivalidabileError
    ) {
      return new ConflictException(err.message)
    }
    if (err instanceof EsportazioneRegistroNonValidaError) {
      return new UnprocessableEntityException({
        message:
          'Non è stato possibile produrre un file XML valido dalle annotazioni del registro. Nessun file è stato salvato.',
        details: { motivi: err.dettagli.slice(0, 10) },
      })
    }
    if (err instanceof EregiNonDisponibileError) return new BadGatewayException(err.message)
    return traduciRentriApiError(err) ?? err
  }

  private async conErrori<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      throw this.traduci(err)
    }
  }

  private async richiediScrittura(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.membership.ruoloEffettivo(req.user, tenantId)
    if (!(RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo)) {
      throw new ForbiddenException(
        'Il tuo ruolo in questa azienda non consente di generare o validare le esportazioni del registro.'
      )
    }
  }

  @Get('registri/:registroId/esportazioni')
  @ApiOperation({ summary: 'Esportazioni XML del registro, dalla più recente' })
  @ApiResponse({ status: 200, description: 'Elenco con stato, intervallo e digest abbreviato' })
  async elenca(
    @Param('registroId', uuidRegistro) registroId: string,
    @Req() req: any
  ): Promise<{ esportazioni: VoceElencoEsportazione[] }> {
    const tenantId = requireRequestTenantId(req)
    return {
      esportazioni: await this.conErrori(() => this.esportazioni.elenca(tenantId, registroId)),
    }
  }

  @Post('registri/:registroId/esportazioni')
  @ApiOperation({
    summary: 'Genera la prossima esportazione XML firmata del registro e la fa validare da RENTRI',
  })
  @ApiResponse({
    status: 201,
    description: 'Esportazione generata (anche con fermata a un numero)',
  })
  @ApiResponse({
    status: 200,
    description: 'Niente da esportare (ultima esportazione restituita) oppure bloccata a un numero',
  })
  @ApiResponse({ status: 409, description: 'Non collegato, in chiusura, catena non coerente' })
  @ApiResponse({ status: 422, description: 'Certificato mancante o XML non producibile' })
  async generaEsportazione(
    @Param('registroId', uuidRegistro) registroId: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response
  ): Promise<EsitoGenerazioneEsportazione> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    const esito = await this.conErrori(() =>
      this.genera.genera(tenantId, registroId, { creataDa: req.user.id })
    )
    res.status(esito.esito === 'CREATA' ? HttpStatus.CREATED : HttpStatus.OK)
    return esito
  }

  @Get('esportazioni/:esportazioneId/file')
  @ApiOperation({ summary: "Scarica l'XML firmato dell'esportazione" })
  @ApiResponse({ status: 200, description: 'application/xml' })
  async scarica(
    @Param('esportazioneId', uuidEsportazione) esportazioneId: string,
    @Req() req: any,
    @Res() res: Response
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const file = await this.conErrori(() => this.esportazioni.scarica(tenantId, esportazioneId))
    res.setHeader('Content-Type', 'application/xml; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${file.nomeFile}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.status(HttpStatus.OK).send(file.xml)
  }

  @Post('esportazioni/:esportazioneId/rivalida')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Riprova la validazione di un'esportazione senza esito definitivo" })
  @ApiResponse({ status: 200, description: 'Stato aggiornato' })
  @ApiResponse({ status: 409, description: "L'esportazione ha già un esito definitivo" })
  async rivalida(
    @Param('esportazioneId', uuidEsportazione) esportazioneId: string,
    @Req() req: any
  ): Promise<EsitoValidazioneEsportazione> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return this.conErrori(() => this.valida.rivalida(tenantId, esportazioneId))
  }
}
