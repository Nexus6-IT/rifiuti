import {
  BadRequestException,
  ConflictException,
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
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { StatoTrasmissioneRentri } from '@prisma/client'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { TenantContext } from '../../core/context/tenant-context'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { RentriCredentialResolver } from '../../infrastructure/rentri/rentri-credential.resolver'
import { RUOLI_SCRITTURA_RENTRI } from '../../application/rentri/verifica-ruolo-scrittura-rentri'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import {
  EsitoAccodamento,
  AccodaTrasmissioneRentriUseCase,
  EsitoDichiarazione,
} from '../../application/rentri/registro/accoda-trasmissione-rentri.use-case'
import { inviiRegistroAttivi } from '../../application/rentri/registro/invii-registro-attivi'
import { TrasmettiLottoRegistroUseCase } from '../../application/rentri/registro/trasmetti-lotto-registro.use-case'
import {
  EsitoVerifica,
  VerificaTrasmissioneRentriUseCase,
} from '../../application/rentri/registro/verifica-trasmissione-rentri.use-case'
import {
  Allineamento,
  ImpostazioniRegistro,
  ImpostazioniRentriRegistroService,
} from '../../application/rentri/registro/impostazioni-rentri-registro.service'
import {
  DettaglioTrasmissione,
  DettaglioTrasmissioneRentriService,
} from '../../application/rentri/registro/dettaglio-trasmissione-rentri.service'
import {
  IdentificativoGiaUsatoError,
  IdentificativoRegistroNonValidoError,
  MovimentoNonTrovatoError,
  richiediAmministratore,
  RUOLI_AMMINISTRATORE_RENTRI,
  RichiestaTrasmissioneNonValidaError,
  RuoloNonAutorizzatoRentriError,
  TrasmissioneNonModificabileError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import {
  AllineamentoQueryDto,
  DichiaraGiaTrasmessiDto,
  EscludiInvioAutomaticoDto,
  ImpostaRegistroRentriDto,
  TrasmettiRentriDto,
  TrasmettiStoricoRentriDto,
} from './dto/rentri-registro.dto'

const uuid = (messaggio: string) =>
  new ParseUUIDPipe({ exceptionFactory: () => new BadRequestException(messaggio) })
const uuidRegistro = uuid('Identificativo del registro non valido.')
const uuidAnnotazione = uuid("Identificativo dell'annotazione non valido.")

const MOTIVO_SALTATA: Partial<Record<StatoTrasmissioneRentri, string>> = {
  DA_TRASMETTERE: 'Già in coda',
  IN_INVIO: 'Invio in corso',
  ATTESA_ESITO: "Inviata, in attesa dell'esito da RENTRI",
  INCERTA: 'Esito incerto: da verificare prima di ritrasmettere',
  TRASMESSA: 'Già trasmessa a RENTRI',
  GIA_SU_RENTRI: 'Già su RENTRI',
}

const MOTIVO_SALTATA_ESCLUSA = "Esclusa dall'invio automatico: reincludila prima di trasmetterla"

/**
 * Stato dell'avvio dell'invio dopo l'accodamento. L'invio gira dopo la risposta: l'esito vero si
 * legge dallo stato di ogni annotazione (`fase`), mai da questa risposta.
 * - `AVVIATO`: l'invio e' partito in background (puo' ancora trovare un altro giro in corso).
 * - `SENZA_CERTIFICATO`: accodato ma non avviato, manca il certificato RENTRI dell'azienda.
 * - `NIENTE_DA_INVIARE`: nulla di nuovo da accodare e nessuna riga gia' in coda.
 * - `NON_AVVIATO`: accodato ma non si e' potuto verificare il certificato; l'invio parte al giro periodico.
 * - `SOSPESO`: accodato ma gli invii sono sospesi dall'amministratore del sistema
 *   (`RENTRI_REGISTRO_INVII_ATTIVI=false`); ripartono quando vengono riattivati.
 */
export type AvvioInvio =
  | 'AVVIATO'
  | 'SENZA_CERTIFICATO'
  | 'NIENTE_DA_INVIARE'
  | 'NON_AVVIATO'
  | 'SOSPESO'

export interface RispostaAccodamento {
  accodate: number
  saltate: Array<{ motivo: string; numero: number }>
  avvio: AvvioInvio
}

@ApiTags('rentri-registro')
@Controller('rentri/registro')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RentriRegistroController {
  constructor(
    private readonly accoda: AccodaTrasmissioneRentriUseCase,
    private readonly trasmetti: TrasmettiLottoRegistroUseCase,
    private readonly verifica: VerificaTrasmissioneRentriUseCase,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly dettaglio: DettaglioTrasmissioneRentriService,
    private readonly credenziali: RentriCredentialResolver,
    private readonly membership: RuoloEffettivoService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriRegistroController.name)
  }

  // --- Autorizzazione: sempre sul ruolo EFFETTIVO nell'azienda selezionata, mai su quello del token ---

  private async ruolo(req: any, tenantId: string): Promise<string> {
    return await this.membership.ruoloEffettivo(req.user, tenantId)
  }

  private async richiediScrittura(req: any, tenantId: string): Promise<void> {
    const ruolo = await this.ruolo(req, tenantId)
    if (!(RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo)) {
      throw new ForbiddenException(
        'Il tuo ruolo in questa azienda non consente di trasmettere il registro a RENTRI.'
      )
    }
  }

  private async richiediAdmin(req: any, tenantId: string): Promise<string> {
    const ruolo = await this.ruolo(req, tenantId)
    try {
      richiediAmministratore(ruolo)
    } catch (err) {
      throw this.traduci(err)
    }
    return ruolo
  }

  /** Errori di dominio -> HTTP, con il messaggio del dominio (italiano, senza id). */
  private traduci(err: unknown): unknown {
    if (err instanceof RuoloNonAutorizzatoRentriError) return new ForbiddenException(err.message)
    if (err instanceof RegistroNonTrovatoError || err instanceof MovimentoNonTrovatoError) {
      return new NotFoundException(err.message)
    }
    if (
      err instanceof TrasmissioneNonModificabileError ||
      err instanceof IdentificativoGiaUsatoError
    ) {
      return new ConflictException(err.message)
    }
    if (err instanceof IdentificativoRegistroNonValidoError) {
      return new BadRequestException(err.message)
    }
    if (err instanceof RichiestaTrasmissioneNonValidaError) {
      return new BadRequestException(err.message)
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

  /**
   * Avvia l'invio del registro SENZA attenderlo: la risposta HTTP non dipende dall'esito.
   * Un giro gia' in corso (`GIA_IN_CORSO`) e' normale, non un errore.
   */
  private async avviaInvio(tenantId: string, registroId: string): Promise<AvvioInvio> {
    if (!inviiRegistroAttivi()) return 'SOSPESO'
    let haCertificato: boolean
    try {
      haCertificato = await TenantContext.run(
        { tenantId },
        async () => await this.credenziali.haCredenziale(tenantId)
      )
    } catch (error: unknown) {
      this.logger.error(
        "Invio del registro a RENTRI: certificato non verificabile, l'invio resta al giro periodico",
        error instanceof Error ? error : new Error(String(error)),
        { tenantId, registroId }
      )
      segnalaErroreJob('trasmettiOra', error, { tenantId })
      return 'NON_AVVIATO'
    }
    if (!haCertificato) return 'SENZA_CERTIFICATO'
    void TenantContext.run(
      { tenantId },
      async () => await this.trasmetti.trasmettiRegistro(tenantId, registroId)
    )
      .then(esito => {
        this.logger.info("Invio del registro a RENTRI avviato dall'utente: giro concluso", {
          tenantId,
          registroId,
          esito: esito.esito,
          attesaEsito: esito.attesaEsito,
          incerte: esito.incerte ?? 0,
        })
      })
      .catch((error: unknown) => {
        this.logger.error(
          "Invio del registro a RENTRI avviato dall'utente: fallito",
          error instanceof Error ? error : new Error(String(error)),
          { tenantId, registroId }
        )
        segnalaErroreJob('trasmettiOra', error, { tenantId })
      })
    return 'AVVIATO'
  }

  /**
   * Parte anche se non c'e' nulla di nuovo ma ci sono righe gia' in coda (per esempio dopo aver
   * caricato il certificato): "Trasmetti" deve avviarle adesso.
   */
  private async avvioDopoAccodamento(
    tenantId: string,
    registroId: string,
    esito: EsitoAccodamento
  ): Promise<AvvioInvio> {
    const giaInCoda = esito.saltatePerStato.DA_TRASMETTERE ?? 0
    if (esito.accodate + esito.riaccodate === 0 && giaInCoda === 0) return 'NIENTE_DA_INVIARE'
    return await this.avviaInvio(tenantId, registroId)
  }

  private rispostaAccodamento(esito: EsitoAccodamento): Omit<RispostaAccodamento, 'avvio'> {
    const saltate = Object.entries(esito.saltatePerStato).map(([stato, numero]) => ({
      motivo: MOTIVO_SALTATA[stato as StatoTrasmissioneRentri] ?? 'Non accodabile in questo stato',
      numero: numero as number,
    }))
    if ((esito.saltateEscluse ?? 0) > 0) {
      saltate.push({ motivo: MOTIVO_SALTATA_ESCLUSA, numero: esito.saltateEscluse })
    }
    return { accodate: esito.accodate + esito.riaccodate, saltate }
  }

  // --- Rotte ---

  @Get('registri')
  @ApiOperation({ summary: "Registri dell'azienda con le impostazioni di trasmissione a RENTRI" })
  @ApiResponse({ status: 200, description: '{ registri[], puoConfigurare, puoTrasmettere }' })
  async registri(@Req() req: any): Promise<{
    registri: ImpostazioniRegistro[]
    puoConfigurare: boolean
    puoTrasmettere: boolean
  }> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.ruolo(req, tenantId)
    return {
      registri: await this.impostazioni.leggi(tenantId),
      puoConfigurare: RUOLI_AMMINISTRATORE_RENTRI.includes(ruolo),
      puoTrasmettere: (RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo),
    }
  }

  @Put('registri/:registroId')
  @ApiOperation({ summary: 'Imposta identificativo RENTRI e invio automatico (amministratori)' })
  @ApiResponse({ status: 200, description: 'Impostazioni aggiornate' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 404, description: 'Registro non trovato' })
  @ApiResponse({ status: 409, description: 'Annotazioni già partite o identificativo già usato' })
  @ApiResponse({ status: 400, description: 'Identificativo in un formato non valido' })
  async imposta(
    @Param('registroId', uuidRegistro) registroId: string,
    @Body() dto: ImpostaRegistroRentriDto,
    @Req() req: any
  ): Promise<ImpostazioniRegistro> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    const dati: { identificativoRentri?: string | null; invioAutomatico?: boolean } = {}
    if (dto.identificativoRentri !== undefined) dati.identificativoRentri = dto.identificativoRentri
    if (dto.invioAutomatico !== undefined) dati.invioAutomatico = dto.invioAutomatico
    return this.conErrori(() =>
      this.impostazioni.imposta(tenantId, req.user.id, ruolo, registroId, dati)
    )
  }

  @Get('registri/:registroId/allineamento')
  @ApiOperation({ summary: 'Confronto fra le annotazioni locali e quelle presenti su RENTRI' })
  @ApiResponse({ status: 200, description: '{ locali, trasmessi, suRentri|null }' })
  async allineamento(
    @Param('registroId', uuidRegistro) registroId: string,
    @Query() query: AllineamentoQueryDto,
    @Req() req: any
  ): Promise<Allineamento> {
    const tenantId = requireRequestTenantId(req)
    // Chiama RENTRI (quota condivisa dell'azienda): stesso ruolo di chi trasmette.
    await this.richiediScrittura(req, tenantId)
    return this.conErrori(() => this.impostazioni.allineamento(tenantId, registroId, query.anno))
  }

  @Post('trasmetti')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: "Accoda le annotazioni scelte e avvia l'invio a RENTRI",
    description:
      "Risponde subito: l'invio prosegue dopo la risposta. `avvio` dice se e' partito; l'esito " +
      'vero (confermato, in attesa di conferma, incerto) si legge dalla `fase` di ogni annotazione.',
  })
  @ApiResponse({ status: 202, description: '{ accodate, saltate[{motivo, numero}], avvio }' })
  async trasmettiOra(
    @Body() dto: TrasmettiRentriDto,
    @Req() req: any
  ): Promise<RispostaAccodamento> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    const esito = await this.conErrori(() =>
      this.accoda.accoda(tenantId, req.user.id, dto.registroId, dto.movimentoIds)
    )
    const risposta = this.rispostaAccodamento(esito)
    return { ...risposta, avvio: await this.avvioDopoAccodamento(tenantId, dto.registroId, esito) }
  }

  @Post('trasmetti-storico')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Accoda tutte le annotazioni di un anno mai trasmesse (amministratori)',
  })
  @ApiResponse({ status: 202, description: '{ accodate, saltate[], avvio }' })
  async trasmettiStorico(
    @Body() dto: TrasmettiStoricoRentriDto,
    @Req() req: any
  ): Promise<RispostaAccodamento> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediAdmin(req, tenantId)
    const esito = await this.conErrori(() =>
      this.accoda.accodaStorico(tenantId, req.user.id, dto.registroId, dto.anno, dto.conferma)
    )
    const risposta = this.rispostaAccodamento(esito)
    return { ...risposta, avvio: await this.avvioDopoAccodamento(tenantId, dto.registroId, esito) }
  }

  @Delete('movimenti/:movimentoId/coda')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Toglie dalla coda un'annotazione accodata a mano",
    description:
      "Un'annotazione dell'invio automatico non si toglie: un amministratore la esclude con " +
      '`POST .../escludi-invio-automatico`; qui riceve 409.',
  })
  @ApiResponse({ status: 204, description: 'Tolta dalla coda' })
  @ApiResponse({ status: 409, description: "Non più in coda, o accodata dall'invio automatico" })
  async togliDallaCoda(
    @Param('movimentoId', uuidAnnotazione) movimentoId: string,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    await this.conErrori(() => this.accoda.togliDallaCoda(tenantId, req.user.id, movimentoId))
  }

  @Post('movimenti/:movimentoId/escludi-invio-automatico')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Esclude un'annotazione dall'invio automatico (amministratori, con motivo)",
  })
  @ApiResponse({ status: 204, description: 'Esclusa: resta in coda ma non parte da sola' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 409, description: 'Già partita, già esclusa o accodata a mano' })
  async escludiInvioAutomatico(
    @Param('movimentoId', uuidAnnotazione) movimentoId: string,
    @Body() dto: EscludiInvioAutomaticoDto,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    await this.conErrori(() =>
      this.accoda.escludiDaInvioAutomatico(tenantId, req.user.id, ruolo, movimentoId, dto.motivo)
    )
  }

  @Post('movimenti/:movimentoId/includi-invio-automatico')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Annulla l'esclusione dall'invio automatico (amministratori)" })
  @ApiResponse({ status: 204, description: 'Reinclusa: il prossimo giro la riadotta se spetta' })
  @ApiResponse({ status: 403, description: "Non amministratore nell'azienda selezionata" })
  @ApiResponse({ status: 409, description: "L'annotazione non è esclusa" })
  async includiInvioAutomatico(
    @Param('movimentoId', uuidAnnotazione) movimentoId: string,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    await this.conErrori(() =>
      this.accoda.reincludiNellInvioAutomatico(tenantId, req.user.id, ruolo, movimentoId)
    )
  }

  @Post('movimenti/:movimentoId/verifica')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Verifica su RENTRI un'annotazione dall'esito incerto" })
  @ApiResponse({ status: 200, description: '{ esito, stato, messaggio }' })
  async verificaAnnotazione(
    @Param('movimentoId', uuidAnnotazione) movimentoId: string,
    @Req() req: any
  ): Promise<EsitoVerifica> {
    const tenantId = requireRequestTenantId(req)
    await this.richiediScrittura(req, tenantId)
    return this.conErrori(() => this.verifica.verifica(tenantId, req.user.id, movimentoId))
  }

  @Post('dichiara-gia-trasmessi')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dichiara già presenti su RENTRI le annotazioni di un intervallo (amministratori)',
  })
  @ApiResponse({ status: 200, description: '{ dichiarate, saltate, ... }' })
  async dichiara(
    @Body() dto: DichiaraGiaTrasmessiDto,
    @Req() req: any
  ): Promise<EsitoDichiarazione> {
    const tenantId = requireRequestTenantId(req)
    const ruolo = await this.richiediAdmin(req, tenantId)
    return this.conErrori(() =>
      this.accoda.dichiaraGiaSuRentri(
        tenantId,
        req.user.id,
        ruolo,
        dto.registroId,
        dto.anno,
        dto.daProgressivo,
        dto.aProgressivo,
        dto.motivo
      )
    )
  }

  @Get('movimenti/:movimentoId')
  @ApiOperation({ summary: "Stato di trasmissione di un'annotazione" })
  @ApiResponse({
    status: 200,
    description: '{ stato, fase, confermata, origine, identificativo, ... }',
  })
  @ApiResponse({ status: 404, description: "L'annotazione non ha una trasmissione" })
  async dettaglioAnnotazione(
    @Param('movimentoId', uuidAnnotazione) movimentoId: string,
    @Req() req: any
  ): Promise<DettaglioTrasmissione> {
    const tenantId = requireRequestTenantId(req)
    return this.conErrori(() => this.dettaglio.dettaglio(tenantId, movimentoId))
  }
}
