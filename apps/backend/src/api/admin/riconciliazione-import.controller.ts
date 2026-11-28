/**
 * Riconciliazione dell'import WinWaste (I8): rapporto, campione a mano, differenze, verbale e chiusura.
 * Solo SUPER_ADMIN: l'import si governa dalla piattaforma, azienda per azienda. L'azienda si indica
 * sempre (`tenantId`) e ogni operazione gira nel suo contesto con il client applicativo (RLS): il
 * SUPER_ADMIN non legge ne' scrive nulla fuori da quell'azienda.
 *
 * Prefix globale `api/v1` applicato dall'app (NON ripetuto qui). Il rapporto lo genera la CLI
 * `migrazione:riconcilia` (il rapporto sorgente WinWaste non sta sul server).
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  ForbiddenException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
  PayloadTooLargeException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import {
  AccettazioneNonConsentitaError,
  CampioneInesistenteError,
  DifferenzaInesistenteError,
  MotivoNonValidoError,
  RapportoChiusoError,
  RapportoNonChiudibileError,
  RapportoNonTrovatoError,
  VerbaleGiaCaricatoError,
  VerbaleNonValidoError,
  VersioneCambiataError,
} from '../../application/migrazione/riconciliazione/errori'
import {
  DIMENSIONE_MASSIMA_VERBALE,
  RapportoLetto,
  RiconciliazioneService,
  RiepilogoRapporto,
} from '../../application/migrazione/riconciliazione/riconciliazione.service'
import {
  AccettaDifferenzaDto,
  ChiudiRapportoDto,
  EsitoCampioneDto,
  TenantRiconciliazioneQuery,
} from './dto/riconciliazione.dto'

/** Traduce gli errori del dominio in risposte HTTP; il resto passa invariato (500 generico). */
export function comeEccezioneHttp(e: unknown): unknown {
  if (e instanceof RapportoNonTrovatoError || e instanceof CampioneInesistenteError)
    return new NotFoundException(e.message)
  if (e instanceof VersioneCambiataError)
    return new ConflictException({
      message: e.message,
      codice: 'VERSIONE_CAMBIATA',
      versioneAttuale: e.attuale,
    })
  if (e instanceof AccettazioneNonConsentitaError) return new ForbiddenException(e.message)
  if (e instanceof RapportoChiusoError) return new ConflictException(e.message)
  if (e instanceof VerbaleGiaCaricatoError) return new ConflictException(e.message)
  if (e instanceof RapportoNonChiudibileError)
    return new UnprocessableEntityException({
      message: e.message,
      codice: 'NON_CHIUDIBILE',
      valutazione: e.valutazione,
    })
  if (
    e instanceof DifferenzaInesistenteError ||
    e instanceof MotivoNonValidoError ||
    e instanceof VerbaleNonValidoError
  )
    return new BadRequestException(e.message)
  return e
}

/** Legge il corpo grezzo con un tetto di dimensione: oltre, 413 senza accumulare il resto in memoria. */
export async function leggiCorpoGrezzo(req: Request, massimo: number): Promise<Buffer> {
  const parti: Buffer[] = []
  let totale = 0
  for await (const parte of req as AsyncIterable<Buffer | string>) {
    const b = typeof parte === 'string' ? Buffer.from(parte) : parte
    totale += b.length
    if (totale > massimo) throw new PayloadTooLargeException('il verbale supera i 10 MB')
    parti.push(b)
  }
  return Buffer.concat(parti)
}

@ApiTags('admin-import-riconciliazione')
@ApiBearerAuth()
@Controller('admin/import/rapporti')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
export class RiconciliazioneImportController {
  constructor(private readonly servizio: RiconciliazioneService) {}

  private async esegui<R>(fn: () => Promise<R>): Promise<R> {
    try {
      return await fn()
    } catch (e) {
      throw comeEccezioneHttp(e)
    }
  }

  @Get()
  @ApiOperation({
    summary: 'Rapporti di riconciliazione di un azienda (ultima versione, riepilogo)',
  })
  async elenca(@Query() q: TenantRiconciliazioneQuery): Promise<RiepilogoRapporto[]> {
    return await this.esegui(() => this.servizio.elenca(q.tenantId))
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Rapporto con i sei confronti, il campione, i verbali e la valutazione di chiusura',
  })
  @ApiResponse({ status: 404, description: 'Rapporto inesistente per l azienda' })
  async leggi(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: TenantRiconciliazioneQuery
  ): Promise<RapportoLetto> {
    return await this.esegui(() => this.servizio.leggi(q.tenantId, id))
  }

  @Post(':id/campioni/:campioneId/esito')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Esito a mano di una riga del campione (confronto 6)' })
  async esitoCampione(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('campioneId', ParseUUIDPipe) campioneId: string,
    @Body() dto: EsitoCampioneDto,
    @CurrentUser() utente: CurrentUserPayload
  ): Promise<void> {
    await this.esegui(() =>
      this.servizio.registraEsitoCampione({
        tenantId: dto.tenantId,
        radiceId: id,
        campioneId,
        esito: dto.esito,
        nota: dto.nota,
        utenteId: utente.id,
      })
    )
  }

  @Post(':id/differenze/accetta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accetta una differenza con un motivo: nasce una nuova versione' })
  @ApiResponse({ status: 409, description: 'Il rapporto e cambiato (versione) o e chiuso' })
  async accetta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccettaDifferenzaDto,
    @CurrentUser() utente: CurrentUserPayload
  ): Promise<RapportoLetto> {
    return await this.esegui(() =>
      this.servizio.accettaDifferenza({
        tenantId: dto.tenantId,
        radiceId: id,
        versione: dto.versione,
        chiave: dto.chiave,
        motivo: dto.motivo,
        utenteId: utente.id,
        ruolo: utente.role,
      })
    )
  }

  @Post(':id/chiudi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chiude il rapporto alla versione indicata' })
  @ApiResponse({ status: 409, description: 'Versione cambiata o rapporto gia chiuso' })
  @ApiResponse({ status: 422, description: 'Differenze aperte o campione incompleto' })
  async chiudi(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChiudiRapportoDto,
    @CurrentUser() utente: CurrentUserPayload
  ): Promise<RapportoLetto> {
    return await this.esegui(() =>
      this.servizio.chiudi({
        tenantId: dto.tenantId,
        radiceId: id,
        versione: dto.versione,
        utenteId: utente.id,
      })
    )
  }

  @Post(':id/verbale')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Carica il verbale firmato: corpo `application/pdf`, nome in `?nomeFile=`',
  })
  async verbale(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: TenantRiconciliazioneQuery,
    @Query('versione') versione: string,
    @Query('nomeFile') nomeFile: string | undefined,
    @Req() req: Request,
    @CurrentUser() utente: CurrentUserPayload
  ): Promise<RapportoLetto> {
    const v = Number(versione)
    if (!Number.isInteger(v) || v < 1) throw new BadRequestException('versione non valida')
    if (!String(req.headers['content-type'] ?? '').startsWith('application/pdf'))
      throw new BadRequestException('il corpo deve essere application/pdf')
    const contenuto = await leggiCorpoGrezzo(req, DIMENSIONE_MASSIMA_VERBALE)
    return await this.esegui(() =>
      this.servizio.caricaVerbale({
        tenantId: q.tenantId,
        radiceId: id,
        versione: v,
        nomeFile: nomeFile || 'verbale.pdf',
        contenuto,
        utenteId: utente.id,
      })
    )
  }
}
