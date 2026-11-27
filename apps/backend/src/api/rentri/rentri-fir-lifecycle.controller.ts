import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  Req,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { TenantId } from '../../core/decorators/tenant.decorator'
import { UserId } from '../../core/decorators/user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { richiediRuoloEffettivo } from '../me/richiedi-ruolo-effettivo'
import { LoggerService } from '../../core/logger/logger.service'
import {
  GetAzioniDisponibiliUseCase,
  GetAzioniDisponibiliResult,
} from '../../application/rentri/get-azioni-disponibili.use-case'
import {
  AccettaORespingiFIRUseCase,
  EsitoAccettaORespingiFIR,
} from '../../application/rentri/accetta-o-respingi-fir.use-case'
import {
  AnnullaFIRRentriUseCase,
  EsitoAnnullaFIRRentri,
} from '../../application/rentri/annulla-fir-rentri.use-case'
import {
  GestisciAllegatiFIRUseCase,
  AllegatoFIR,
} from '../../application/rentri/gestisci-allegati-fir.use-case'
import { ScaricaPdfFirUseCase } from '../../application/rentri/scarica-pdf-fir.use-case'
import {
  RollbackEResetFirRentriUseCase,
  EsitoRollbackOReset,
} from '../../application/rentri/rollback-e-reset-fir-rentri.use-case'
import {
  GestisciSessioneFirmaRentriUseCase,
  SessioneFirmaInAttesa,
} from '../../application/rentri/gestisci-sessione-firma-rentri.use-case'
import { EsitoCompletamentoFirma } from '../../application/rentri/completa-operazione-con-firma.use-case'
import {
  EsitoInviaDatiViaggio,
  InviaDatiViaggioFirRentriUseCase,
} from '../../application/rentri/invia-dati-viaggio-fir-rentri.use-case'
import { ElencaEventiFirRentriUseCase } from '../../application/rentri/elenca-eventi-fir-rentri.use-case'
import { EventoFirRentri } from '../../application/rentri/eventi-fir-rentri.port'
import { TrovaUltimoTrasportoAutomezzoUseCase } from '../../application/rentri/trova-ultimo-trasporto-automezzo.use-case'
import {
  EsitoFirmaPartenza,
  FirmaPartenzaRentriUseCase,
} from '../../application/rentri/firma-partenza-rentri.use-case'
import { FirmaPartenzaFirRentriDto } from './dto/firma-partenza-fir-rentri.dto'
import {
  AnnotazioneRentriUseCase,
  EsitoAnnotazione,
} from '../../application/rentri/annotazione-rentri.use-case'
import { AnnotazioneFirRentriDto } from './dto/annotazione-fir-rentri.dto'
import {
  EsitoSostaTecnica,
  SostaTecnicaRentriUseCase,
} from '../../application/rentri/sosta-tecnica-rentri.use-case'
import { SostaTecnicaFirRentriDto } from './dto/sosta-tecnica-fir-rentri.dto'
import {
  EsitoTrasbordoTotale,
  EsitoVerificaTrasbordoTotale,
  TrasbordoTotaleRentriUseCase,
} from '../../application/rentri/trasbordo-totale-rentri.use-case'
import { TrasbordoTotaleFirRentriDto } from './dto/trasbordo-totale-fir-rentri.dto'
import { UltimoTrasportoAutomezzo } from '../../application/rentri/dati-viaggio-fir.port'
import { InviaQuantitaFirRentriDto } from './dto/invia-quantita-fir-rentri.dto'
import { InviaTrasportoFirRentriDto } from './dto/invia-trasporto-fir-rentri.dto'
import { RiprendiFirmaRentriDto } from './dto/riprendi-firma-rentri.dto'
import { RollbackOResetFirRentriDto } from './dto/rollback-o-reset-fir-rentri.dto'
import { AccettaFirRentriDto } from './dto/accetta-fir-rentri.dto'
import { AnnullaFirRentriDto } from './dto/annulla-fir-rentri.dto'
import { CaricaAllegatoFirRentriDto } from './dto/carica-allegato-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'
import { traduciErroreRentri } from '../../application/rentri/rentri-error-presentation'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

/**
 * `rule` di `DomainException.businessRuleViolation` per cui esiste una
 * traduzione dedicata in `traduciErroreRentri` (R3 Task 9). Qualunque altro
 * `rule` (es. `FIR_NON_LEGATO_RENTRI`, `CF_TENANT_MANCANTE`,
 * `ALLEGATO_RENTRI_RIFIUTATO`, `ALLEGATO_ID_MANCANTE`) NON è in questo elenco
 * di proposito: `traduciErroreRentri` non ha un case dedicato per loro e il
 * suo `default` è pensato per il flusso di sincronizzazione RENTRI, non per
 * un errore di validazione locale — chiamarla comunque restituirebbe un
 * messaggio falso ("RENTRI non è momentaneamente raggiungibile..."). Stessa
 * cautela già adottata in `RentriFormulariController.mappaErroreHttp`.
 */
const RULE_TRADOTTE_TASK_9 = new Set([
  'ACCETTAZIONE_NON_DISPONIBILE',
  'ANNULLAMENTO_NON_DISPONIBILE',
  'ALLEGATO_NON_DISPONIBILE',
  'FIRMA_RENTRI_RIFIUTATA',
  'FORMATO_ALLEGATO_NON_AMMESSO',
  'ALLEGATO_TROPPO_GRANDE',
])

/**
 * `rule` che l'interfaccia deve poter distinguere come CONFLITTO di stato (409, non 400): l'operazione
 * non e' disponibile ora (lo dice l'ente) oppure c'e' gia' una firma in corso. Il messaggio e' gia'
 * scritto per l'utente; il `rule` viaggia nel corpo (`codice`) per il FE.
 */
/**
 * `rule` degli errori di VALIDAZIONE dei dati di viaggio (FIR in viaggio, P2): 400 con `codice` stabile e il
 * messaggio gia' scritto per l'utente (senza il prefisso tecnico di `DomainException`).
 */
const RULE_DATI_VIAGGIO = new Set([
  'DATI_VIAGGIO_NON_VALIDI',
  'TRASPORTO_NON_TERRESTRE',
  'QUANTITA_RENTRI_RIFIUTATA',
  'TRASPORTO_RENTRI_RIFIUTATO',
  'ANNOTAZIONE_NON_VALIDA',
  'ANNOTAZIONE_RENTRI_RIFIUTATA',
  'SOSTA_TECNICA_NON_VALIDA',
  'SOSTA_TECNICA_RENTRI_RIFIUTATA',
  'TRASBORDO_TOTALE_NON_VALIDO',
  'TRASBORDO_TOTALE_RENTRI_RIFIUTATO',
])

const RULE_CONFLITTO = new Set([
  'OPERAZIONE_NON_DISPONIBILE',
  'FIRMA_PARTENZA_NON_DISPONIBILE',
  'SESSIONE_FIRMA_IN_CORSO',
  'SESSIONE_FIRMA_NON_ATTIVA',
  'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR',
  'ANNOTAZIONE_DA_FIRMARE',
  'ANNOTAZIONE_DI_ALTRO_SOGGETTO',
  'ANNOTAZIONE_IN_VERIFICA',
  // Esito ignoto (P4/P5/P6): uno stato da verificare, mai un 500 generico.
  'ANNOTAZIONE_ESITO_INCERTO',
  'FIRMA_ANNOTAZIONE_NON_DISPONIBILE',
  'SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR',
  'SOSTA_TECNICA_DA_FIRMARE',
  'SOSTA_TECNICA_DI_ALTRO_SOGGETTO',
  'SOSTA_TECNICA_IN_VERIFICA',
  'SOSTA_TECNICA_ESITO_INCERTO',
  'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE',
  'TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR',
  'TRASBORDO_TOTALE_DA_FIRMARE',
  'TRASBORDO_TOTALE_DI_ALTRO_SOGGETTO',
  'TRASBORDO_TOTALE_IN_VERIFICA',
  // Esito ignoto: non e' un errore del server ne' un rifiuto, e' uno stato da verificare (mai un 500 generico).
  'TRASBORDO_TOTALE_ESITO_INCERTO',
  'TRASBORDO_TOTALE_FIRMA_NON_TUA',
  'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE',
])

/**
 * RENTRI FIR Lifecycle Controller (R3 Task 2).
 *
 * Espone il "motore della UI" del ciclo di vita del formulario digitale:
 * quali operazioni RENTRI sono disponibili ORA su un dato FIR. Ogni
 * operazione di scrittura futura (accettazione, annullamento, allegati,
 * ...) dovrà verificare PRIMA che l'operazione compaia in questa lista.
 *
 * Controller DEDICATO (non un'estensione di `RENTRISyncController`, dominio
 * distinto — trasmissione IN USCITA verso RENTRI — né di
 * `RentriFormulariController`, dominio "cercare→agganciare"): questo è il
 * ciclo di vita del formulario già agganciato.
 *
 * Autorizzazione: stessa politica di `RENTRISyncController` — è comunque un
 * adempimento verso un ente esterno, anche in sola lettura. Nessun ruolo
 * VIEWER: un VIEWER non deve vedere quali operazioni RENTRI sono pilotabili
 * (rivelerebbe lo stato di un adempimento in corso).
 */
@ApiTags('RENTRI FIR Lifecycle')
@ApiBearerAuth()
@Controller('rentri/fir')
@RichiedeModulo('rentri')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriFirLifecycleController {
  constructor(
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly accettaORespingiFIRUseCase: AccettaORespingiFIRUseCase,
    private readonly annullaFIRRentriUseCase: AnnullaFIRRentriUseCase,
    private readonly gestisciAllegatiFIRUseCase: GestisciAllegatiFIRUseCase,
    private readonly scaricaPdfFirUseCase: ScaricaPdfFirUseCase,
    private readonly logger: LoggerService,
    private readonly ruoloEffettivo: RuoloEffettivoService,
    private readonly rollbackEResetUseCase: RollbackEResetFirRentriUseCase,
    private readonly sessioneFirmaUseCase: GestisciSessioneFirmaRentriUseCase,
    private readonly inviaDatiViaggioUseCase: InviaDatiViaggioFirRentriUseCase,
    private readonly elencaEventiUseCase: ElencaEventiFirRentriUseCase,
    private readonly ultimoTrasportoUseCase: TrovaUltimoTrasportoAutomezzoUseCase,
    private readonly firmaPartenzaUseCase: FirmaPartenzaRentriUseCase,
    private readonly annotazioneUseCase: AnnotazioneRentriUseCase,
    private readonly sostaTecnicaUseCase: SostaTecnicaRentriUseCase,
    private readonly trasbordoTotaleUseCase: TrasbordoTotaleRentriUseCase
  ) {
    this.logger.setContext('RentriFirLifecycleController')
  }

  /**
   * Conducente e rimorchio dell'ultimo trasporto fatto con una targa: precompila il form del FIR
   * (decisione D3). Rotta fissa, prima delle `:id/...`: nessuna ambiguita' con un id.
   */
  @Get('ultimo-trasporto')
  @ApiOperation({
    summary: "Conducente dell'ultimo trasporto con una targa",
    description: 'Cerca fra i FIR dell’azienda l’ultimo con quella targa e un conducente indicato.',
  })
  @ApiResponse({ status: 200, description: 'Conducente e rimorchio, oppure null' })
  async ultimoTrasporto(
    @Query('targa') targa: string,
    @TenantId() tenantId: string
  ): Promise<{ trasporto: UltimoTrasportoAutomezzo | null }> {
    return { trasporto: await this.ultimoTrasportoUseCase.execute(tenantId, targa ?? '') }
  }

  /**
   * Azioni RENTRI disponibili sul FIR indicato: la difesa contro il 423 e
   * la fonte di verità per quali pulsanti mostrare (v. commento di classe di
   * `GetAzioniDisponibiliUseCase`).
   */
  @Get(':id/azioni')
  @ApiOperation({
    summary: 'Azioni RENTRI disponibili sul formulario',
    description:
      'Interroga /azioni sull’ente e riconcilia lo stato del FIR: da consultare PRIMA di proporre ' +
      'qualunque operazione di scrittura RENTRI (accettazione, annullamento, allegati, ...).',
  })
  @ApiResponse({ status: 200, description: 'Azioni disponibili' })
  @ApiResponse({ status: 400, description: 'FIR non legato a RENTRI o CF tenant mancante' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async getAzioniDisponibili(
    @Param('id') firId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string
  ): Promise<GetAzioniDisponibiliResult> {
    this.logger.debug('Azioni RENTRI disponibili richieste', { firId, tenantId, userId })

    try {
      return await this.getAzioniDisponibiliUseCase.execute(firId, tenantId)
    } catch (error: any) {
      this.logger.error('Lettura azioni RENTRI disponibili non riuscita', error, {
        firId,
        tenantId,
      })

      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Accetta o respinge (anche parzialmente) il carico ricevuto (R3 Task 4).
   * Verifica SEMPRE prima `/azioni` (v. `AccettaORespingiFIRUseCase`): mai
   * una scrittura diretta senza quella precondizione. Se l'ente accetta i
   * dati, chiude il ciclo con la firma remota RENTRI
   * (`CompletaOperazioneConFirmaUseCase`, R3 Task 3) e ne propaga l'esito.
   */
  @Post(':id/accettazione')
  @ApiOperation({
    summary: 'Accetta o respingi (anche parzialmente) il carico',
    description:
      'Verifica la precondizione da /azioni, invia i dati di accettazione a RENTRI e completa ' +
      'il ciclo con la firma remota. NON verifica autonomamente lo stato del formulario oltre a ' +
      'quanto risulta da /azioni.',
  })
  @ApiResponse({ status: 200, description: 'Accettazione inviata ed esito della firma' })
  @ApiResponse({
    status: 400,
    description: 'Validazione locale fallita, operazione non disponibile o rifiutata dall’ente',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async accettaORespingi(
    @Param('id') firId: string,
    @Body() dto: AccettaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoAccettaORespingiFIR> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Accettazione/respingimento RENTRI richiesto', {
      firId,
      tenantId,
      userId,
      tipoAccettazione: dto.tipoAccettazione,
    })

    try {
      return await this.accettaORespingiFIRUseCase.execute({
        firId,
        tenantId,
        tipoAccettazione: dto.tipoAccettazione,
        dataOraArrivo: dto.dataOraArrivo,
        quantitaAccettataKg: dto.quantitaAccettataKg,
        causaleRespingimento: dto.causaleRespingimento,
        motivoRespingimento: dto.motivoRespingimento,
        attesaVerificaAnalitica: dto.attesaVerificaAnalitica,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Accettazione/respingimento RENTRI non riuscito', error, {
        firId,
        tenantId,
      })

      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Annulla il formulario RENTRI, con nota (R3 Task 5). Verifica SEMPRE
   * prima `/azioni` (v. `AnnullaFIRRentriUseCase`) — DUE volte: una per
   * `Annulla`, una per `NoteAnnullamento` dopo che l'ente ha confermato
   * l'annullamento. Chiude il ciclo di firma con
   * `CompletaOperazioneConFirmaUseCase` (R3 Task 3) prima di trasmettere la
   * nota.
   */
  @Post(':id/annullamento')
  @ApiOperation({
    summary: 'Annulla il formulario RENTRI',
    description:
      'Verifica la precondizione da /azioni, avvia annulla-fir, completa il ciclo con la firma ' +
      'remota e, solo dopo la conferma dell’ente, trasmette la nota di annullamento.',
  })
  @ApiResponse({ status: 200, description: 'Annullamento avviato ed esito della firma/nota' })
  @ApiResponse({
    status: 400,
    description: 'Validazione locale fallita, operazione non disponibile o rifiutata dall’ente',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async annulla(
    @Param('id') firId: string,
    @Body() dto: AnnullaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoAnnullaFIRRentri> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Annullamento RENTRI richiesto', {
      firId,
      tenantId,
      userId,
    })

    try {
      return await this.annullaFIRRentriUseCase.execute({
        firId,
        tenantId,
        motivo: dto.motivo,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Annullamento RENTRI non riuscito', error, {
        firId,
        tenantId,
      })

      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Elenca gli allegati registrati localmente (R3 Task 6) — lettura pura,
   * mai una chiamata a RENTRI (v. commento di classe di
   * `GestisciAllegatiFIRUseCase`).
   */
  @Get(':id/allegati')
  @ApiOperation({
    summary: 'Allegati registrati localmente sul formulario',
    description: 'Elenco locale, senza alcuna chiamata a RENTRI.',
  })
  @ApiResponse({ status: 200, description: 'Elenco allegati' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async elencaAllegati(
    @Param('id') firId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string
  ): Promise<AllegatoFIR[]> {
    this.logger.debug('Elenco allegati RENTRI richiesto', { firId, tenantId, userId })

    try {
      return await this.gestisciAllegatiFIRUseCase.elencaAllegati(firId, tenantId)
    } catch (error: any) {
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Carica un allegato (R3 Task 6). Verifica SEMPRE prima formato/dimensione
   * (locale, PRIMA di qualunque rete) e poi `/azioni` (v.
   * `GestisciAllegatiFIRUseCase`): mai una scrittura diretta senza quelle
   * precondizioni. Nessuna firma remota: il contratto dichiara che
   * l'allegato non la richiede.
   */
  @Post(':id/allegati')
  @ApiOperation({
    summary: 'Aggiungi un allegato al formulario',
    description:
      'Verifica formato (solo PDF) e dimensione (1 MB) localmente, poi la precondizione da ' +
      '/azioni, poi invia l’allegato a RENTRI. Nessuna firma successiva.',
  })
  @ApiResponse({ status: 201, description: 'Allegato caricato e registrato localmente' })
  @ApiResponse({
    status: 400,
    description: 'Formato/dimensione non ammessi, operazione non disponibile o rifiutata',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async caricaAllegato(
    @Param('id') firId: string,
    @Body() dto: CaricaAllegatoFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<AllegatoFIR> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Caricamento allegato RENTRI richiesto', {
      firId,
      tenantId,
      userId,
      nomeFile: dto.nomeFile,
    })

    try {
      return await this.gestisciAllegatiFIRUseCase.caricaAllegato({
        firId,
        tenantId,
        userId,
        nomeFile: dto.nomeFile,
        contentType: dto.contentType,
        contenutoBase64: dto.contenutoBase64,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Caricamento allegato RENTRI non riuscito', error, { firId, tenantId })

      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Elimina un allegato (R3 Task 6). Verifica SEMPRE prima `/azioni`, poi
   * chiama l'ente e riflette l'eliminazione in locale SOLO dopo la sua
   * conferma (v. `GestisciAllegatiFIRUseCase.eliminaAllegato`): un
   * fallimento a metà propaga come errore esplicito, mai in silenzio.
   */
  @Delete(':id/allegati/:allegatoId')
  @ApiOperation({
    summary: 'Rimuovi un allegato dal formulario',
    description:
      'Verifica la precondizione da /azioni, chiama RENTRI e SOLO dopo la sua conferma cancella ' +
      'la copia locale.',
  })
  @ApiResponse({ status: 200, description: 'Allegato eliminato su RENTRI e in locale' })
  @ApiResponse({
    status: 400,
    description: 'Operazione non disponibile o rifiutata dall’ente',
  })
  @ApiResponse({ status: 404, description: 'FIR o allegato non trovato' })
  async eliminaAllegato(
    @Param('id') firId: string,
    @Param('allegatoId') allegatoId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<{ eliminato: true }> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Eliminazione allegato RENTRI richiesta', {
      firId,
      allegatoId,
      tenantId,
      userId,
    })

    try {
      await this.gestisciAllegatiFIRUseCase.eliminaAllegato({
        firId,
        tenantId,
        allegatoLocaleId: allegatoId,
      })
      return { eliminato: true }
    } catch (error: any) {
      this.logger.error('Eliminazione allegato RENTRI non riuscita', error, {
        firId,
        allegatoId,
        tenantId,
      })

      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Stampa PDF del formulario (R3 Task 7): scarica il PDF da RENTRI e lo
   * trasmette come STREAM di byte al chiamante — NESSUN redirect al
   * portale RENTRI (v. commento di classe di `ScaricaPdfFirUseCase`): il
   * criterio di valore del programma è che l'utente non cambi mai
   * piattaforma, per lo stesso motivo per cui `PdfController.downloadFIR`
   * serve già i PDF generati localmente senza mai rimandare altrove.
   *
   * `@Res()` NON-passthrough (come `PdfController`): l'uso case viene
   * invocato PRIMA di toccare `res`, quindi un errore di dominio propaga
   * ancora come eccezione HTTP gestita normalmente da Nest — solo dopo un
   * esito positivo la risposta viene scritta a mano (headers + buffer).
   */
  @Get(':id/pdf')
  @ApiOperation({
    summary: 'Stampa PDF del formulario',
    description:
      'Scarica il PDF da RENTRI e lo trasmette come stream: nessun redirect al portale, ' +
      'il browser del chiamante non contatta mai l’ente direttamente.',
  })
  @ApiResponse({ status: 200, description: 'PDF del formulario' })
  @ApiResponse({ status: 204, description: 'Nessun PDF disponibile ancora per questo formulario' })
  @ApiResponse({ status: 400, description: 'FIR non legato a RENTRI' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async scaricaPdf(
    @Param('id') firId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Res() res: Response
  ): Promise<void> {
    this.logger.debug('Stampa PDF RENTRI richiesta', { firId, tenantId, userId })

    let pdf: Awaited<ReturnType<ScaricaPdfFirUseCase['execute']>>
    try {
      pdf = await this.scaricaPdfFirUseCase.execute(firId, tenantId)
    } catch (error: any) {
      this.logger.error('Stampa PDF RENTRI non riuscita', error, { firId, tenantId })

      throw this.mappaErroreDominio(error)
    }

    // Esito 204 dichiarato dal contratto (riga 1764): nessun PDF disponibile
    // ORA per questo formulario. Propagato COSÌ COM'È al chiamante, mai
    // travestito da errore.
    if (!pdf.disponibile || !pdf.contenutoBase64) {
      res.status(204).send()
      return
    }

    const buffer = Buffer.from(pdf.contenutoBase64, 'base64')
    res.set({
      'Content-Type': pdf.mime || 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdf.nomeFile || `FIR-${firId}.pdf`}"`,
      'Content-Length': buffer.length,
    })
    res.send(buffer)
  }

  /**
   * Sessione di firma in attesa di conferma sul dispositivo (FIR in viaggio, P1): alimenta il banner.
   * Sola lettura, nessuna chiamata all'ente; `sessione` e' `null` se non c'e' nulla in attesa.
   */
  @Get(':id/firme/in-attesa')
  @ApiOperation({
    summary: 'Sessione di firma in attesa sul formulario',
    description: 'Restituisce la sessione di firma aperta (id, operazione, scadenza) o null.',
  })
  @ApiResponse({ status: 200, description: 'Sessione in attesa o null' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async firmaInAttesa(
    @Param('id') firId: string,
    @TenantId() tenantId: string
  ): Promise<{ sessione: SessioneFirmaInAttesa | null }> {
    try {
      return { sessione: await this.sessioneFirmaUseCase.inAttesa(firId, tenantId) }
    } catch (error: any) {
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * «Ho confermato, controlla»: riprende il polling della firma in attesa (stesso handle, nessuna
   * seconda richiesta sul telefono). Dopo una scadenza una nuova richiesta parte solo con
   * `nuovaSessione: true`.
   */
  @Post(':id/firme/:sessioneId/riprendi')
  @ApiOperation({
    summary: 'Riprendi la firma in attesa di conferma',
    description:
      'Riaggancia il polling della sessione di firma aperta. Esiti: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA.',
  })
  @ApiResponse({ status: 200, description: 'Esito della ripresa' })
  @ApiResponse({ status: 404, description: 'FIR o sessione non trovati' })
  @ApiResponse({
    status: 409,
    description: 'Sessione gia conclusa o firma di un altra operazione in corso',
  })
  async riprendiFirma(
    @Param('id') firId: string,
    @Param('sessioneId') sessioneId: string,
    @Body() dto: RiprendiFirmaRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoCompletamentoFirma> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Ripresa firma RENTRI richiesta', { firId, sessioneId, tenantId, userId })

    try {
      return await this.sessioneFirmaUseCase.riprendi({
        firId,
        tenantId,
        sessioneId,
        utenteId: userId,
        nuovaSessione: dto.nuovaSessione,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Ripresa firma RENTRI non riuscita', error, { firId, sessioneId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Annulla l'ultima firma apposta (`RollbackFirma`): riporta il formulario all'attesa di firma
   * precedente. La disponibilita' la decide l'ente (`/azioni`); se manca, 409 senza chiamate.
   */
  @Post(':id/rollback-firma')
  @ApiOperation({
    summary: "Annulla l'ultima firma apposta",
    description:
      "Verifica /azioni (RollbackFirma), poi chiede all'ente il rollback e rilegge lo stato.",
  })
  @ApiResponse({ status: 200, description: "Rollback eseguito, stato riletto dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 409, description: 'OPERAZIONE_NON_DISPONIBILE' })
  async rollbackFirma(
    @Param('id') firId: string,
    @Body() dto: RollbackOResetFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoRollbackOReset> {
    return this.eseguiRollbackOReset('RollbackFirma', firId, dto, tenantId, userId, req)
  }

  /**
   * Reset: cancella gli ultimi dati inseriti e non ancora firmati. E' anche il «Annulla la richiesta»
   * del banner di firma in attesa: chiude la sessione aperta come ANNULLATA.
   */
  @Post(':id/reset')
  @ApiOperation({
    summary: "Annulla l'ultima richiesta non ancora firmata (reset)",
    description:
      "Verifica /azioni (Reset), poi chiede all'ente il reset e chiude la sessione di firma aperta.",
  })
  @ApiResponse({ status: 200, description: "Reset eseguito, stato riletto dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 409, description: 'OPERAZIONE_NON_DISPONIBILE' })
  async reset(
    @Param('id') firId: string,
    @Body() dto: RollbackOResetFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoRollbackOReset> {
    return this.eseguiRollbackOReset('Reset', firId, dto, tenantId, userId, req)
  }

  private async eseguiRollbackOReset(
    operazione: 'RollbackFirma' | 'Reset',
    firId: string,
    dto: RollbackOResetFirRentriDto,
    tenantId: string,
    userId: string,
    req: any
  ): Promise<EsitoRollbackOReset> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Rollback/reset RENTRI richiesto', { firId, tenantId, userId, operazione })

    try {
      return await this.rollbackEResetUseCase.execute({
        firId,
        tenantId,
        operazione,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Rollback/reset RENTRI non riuscito', error, {
        firId,
        tenantId,
        operazione,
      })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Quantita' del rifiuto, colli e rinfusa (FIR in viaggio, P2): chiude la fase iniziale quando la creazione
   * non portava la quantita', oppure la corregge. La disponibilita' la decide l'ente (`/azioni`); la copia
   * locale si aggiorna solo dopo il suo esito positivo.
   */
  @Post(':id/quantita')
  @ApiOperation({
    summary: 'Indica o correggi la quantità del rifiuto',
    description:
      'Verifica /azioni (DatiQuantita o DatiQuantitaUpdate), invia quantità, colli o rinfusa e verifica ' +
      'in partenza, rilegge lo stato e aggiorna la copia locale solo a esito positivo.',
  })
  @ApiResponse({ status: 201, description: "Quantità accettata dall'ente, stato riletto" })
  @ApiResponse({ status: 400, description: "Dati non validi o rifiutati dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 409, description: 'OPERAZIONE_NON_DISPONIBILE' })
  async inviaQuantita(
    @Param('id') firId: string,
    @Body() dto: InviaQuantitaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoInviaDatiViaggio> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Quantità RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.inviaDatiViaggioUseCase.inviaQuantita({
        firId,
        tenantId,
        quantita: dto.quantita,
        unitaMisura: dto.unitaMisura,
        numeroColli: dto.numeroColli,
        rinfusa: dto.rinfusa,
        verificatoInPartenza: dto.verificatoInPartenza,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Quantità RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Dati del trasporto terrestre (conducente, targhe, percorso): stessa sequenza e stesse garanzie di
   * {@link inviaQuantita}.
   */
  @Post(':id/trasporto')
  @ApiOperation({
    summary: 'Indica o correggi i dati del trasporto',
    description:
      'Verifica /azioni (Trasporto o TrasportoUpdate), invia conducente, targhe e percorso, rilegge lo ' +
      'stato e aggiorna la copia locale solo a esito positivo. Solo trasporto terrestre.',
  })
  @ApiResponse({ status: 201, description: "Trasporto accettato dall'ente, stato riletto" })
  @ApiResponse({ status: 400, description: "Dati non validi o rifiutati dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 409, description: 'OPERAZIONE_NON_DISPONIBILE' })
  async inviaTrasporto(
    @Param('id') firId: string,
    @Body() dto: InviaTrasportoFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoInviaDatiViaggio> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Trasporto RENTRI richiesto', { firId, tenantId, userId })

    try {
      return await this.inviaDatiViaggioUseCase.inviaTrasporto({
        firId,
        tenantId,
        conducenteNome: dto.conducenteNome,
        conducenteCognome: dto.conducenteCognome,
        targaAutomezzo: dto.targaAutomezzo,
        targaRimorchio: dto.targaRimorchio,
        percorso: dto.percorso,
        dataOraInizioTrasporto: dto.dataOraInizioTrasporto
          ? new Date(dto.dataOraInizioTrasporto)
          : undefined,
        annotazioni: dto.annotazioni,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Trasporto RENTRI non riuscito', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Firma di partenza (FIR in viaggio, P3): produttore e/o trasportatore firmano l'avvio del viaggio. L'operazione
   * la sceglie `/azioni`; la firma passa dal ciclo comune (una sola richiesta sul telefono, ripresa della
   * sessione aperta), e lo stato di viaggio e' RILETTO dall'ente.
   */
  @Post(':id/firma-partenza')
  @ApiOperation({
    summary: 'Firma la partenza su RENTRI',
    description:
      'Verifica /azioni (firma di produttore e/o trasportatore), chiede la firma remota e, a conferma, rilegge lo stato di viaggio. ' +
      'Esiti: COMPLETATA, IN_ATTESA (conferma sul telefono), SCADUTA, RIFIUTATA.',
  })
  @ApiResponse({ status: 201, description: 'Operazione scelta ed esito della firma' })
  @ApiResponse({ status: 400, description: 'FIR non legato a RENTRI o firma rifiutata' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description: 'FIRMA_PARTENZA_NON_DISPONIBILE o SESSIONE_FIRMA_IN_CORSO',
  })
  async firmaPartenza(
    @Param('id') firId: string,
    @Body() dto: FirmaPartenzaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoFirmaPartenza> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Firma di partenza RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.firmaPartenzaUseCase.execute({
        firId,
        tenantId,
        utenteId: userId,
        nuovaSessione: dto?.nuovaSessione,
        correlationId: dto?.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Firma di partenza RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Annotazione (FIR in viaggio, P4): un testo libero del soggetto (l'azienda selezionata) aggiunto al
   * formulario e firmato con la firma remota. La disponibilita' la decide `/azioni`; se la firma non si
   * conclude l'annotazione resta registrata presso l'ente e si firma dopo da `firma-annotazione`.
   */
  @Post(':id/annotazione')
  @ApiOperation({
    summary: "Aggiungi un'annotazione al formulario",
    description:
      "Verifica che il CF dell'azienda compaia nel FIR e che /azioni proponga l'annotazione, la invia e " +
      'chiede la firma remota. Esiti della firma: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA, DA_COMPLETARE.',
  })
  @ApiResponse({ status: 201, description: "Annotazione accettata dall'ente, esito della firma" })
  @ApiResponse({ status: 400, description: "Testo non valido o annotazione rifiutata dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description:
      'OPERAZIONE_NON_DISPONIBILE, ANNOTAZIONE_SOGGETTO_NON_NEL_FIR, ANNOTAZIONE_DA_FIRMARE, ANNOTAZIONE_DI_ALTRO_SOGGETTO, ANNOTAZIONE_IN_VERIFICA, ANNOTAZIONE_ESITO_INCERTO o SESSIONE_FIRMA_IN_CORSO',
  })
  async aggiungiAnnotazione(
    @Param('id') firId: string,
    @Body() dto: AnnotazioneFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoAnnotazione> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Annotazione RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.annotazioneUseCase.invia({
        firId,
        tenantId,
        testo: dto.testo,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Annotazione RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Firma dell'annotazione in attesa (FIR in viaggio, P4): quando la firma dopo l'invio non si e' conclusa
   * (conferma sul telefono mancata, rete) o va richiesta di nuovo. Una sola richiesta sul telefono.
   */
  @Post(':id/firma-annotazione')
  @ApiOperation({
    summary: "Firma l'annotazione su RENTRI",
    description:
      'Verifica /azioni (AcquisizioneFirmaAnnotazione), chiede la firma remota e rilegge lo stato. Esiti: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA.',
  })
  @ApiResponse({ status: 201, description: 'Esito della firma' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description: 'FIRMA_ANNOTAZIONE_NON_DISPONIBILE o SESSIONE_FIRMA_IN_CORSO',
  })
  async firmaAnnotazione(
    @Param('id') firId: string,
    @Body() dto: FirmaPartenzaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoCompletamentoFirma> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Firma annotazione RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.annotazioneUseCase.firma({
        firId,
        tenantId,
        utenteId: userId,
        nuovaSessione: dto?.nuovaSessione,
        correlationId: dto?.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Firma annotazione RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Sosta tecnica (FIR in viaggio, P5): il trasportatore che ha in carico il rifiuto dichiara dove e quando il
   * mezzo si e' fermato e firma con la firma remota. La disponibilita' la decide `/azioni`; se la firma non si
   * conclude la sosta resta registrata presso l'ente e si firma dopo da `firma-sosta-tecnica`.
   */
  @Post(':id/sosta-tecnica')
  @ApiOperation({
    summary: 'Dichiara una sosta tecnica del formulario',
    description:
      "Verifica che l'azienda sia un trasportatore del FIR e che /azioni proponga la sosta, la invia (luogo " +
      'e date in UTC) e chiede la firma remota. Esiti della firma: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA, DA_COMPLETARE.',
  })
  @ApiResponse({ status: 201, description: "Sosta accettata dall'ente, esito della firma" })
  @ApiResponse({ status: 400, description: "Dati non validi o sosta rifiutata dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description:
      'OPERAZIONE_NON_DISPONIBILE, SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR, SOSTA_TECNICA_DA_FIRMARE, SOSTA_TECNICA_DI_ALTRO_SOGGETTO, SOSTA_TECNICA_IN_VERIFICA, SOSTA_TECNICA_ESITO_INCERTO o SESSIONE_FIRMA_IN_CORSO',
  })
  async dichiaraSostaTecnica(
    @Param('id') firId: string,
    @Body() dto: SostaTecnicaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoSostaTecnica> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Sosta tecnica RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.sostaTecnicaUseCase.invia({
        firId,
        tenantId,
        luogoStazionamento: dto.luogoStazionamento,
        dataOraSospensione: dto.dataOraSospensione,
        dataOraRipresa: dto.dataOraRipresa,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Sosta tecnica RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Firma della sosta tecnica in attesa (FIR in viaggio, P5): quando la firma dopo l'invio non si e' conclusa
   * (conferma sul telefono mancata, rete) o va richiesta di nuovo. Una sola richiesta sul telefono.
   */
  @Post(':id/firma-sosta-tecnica')
  @ApiOperation({
    summary: 'Firma la sosta tecnica su RENTRI',
    description:
      'Verifica /azioni (AcquisizioneFirmaSostaTecnica), chiede la firma remota del trasportatore e rilegge lo stato. Esiti: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA.',
  })
  @ApiResponse({ status: 201, description: 'Esito della firma' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description: 'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE o SESSIONE_FIRMA_IN_CORSO',
  })
  async firmaSostaTecnica(
    @Param('id') firId: string,
    @Body() dto: FirmaPartenzaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoCompletamentoFirma> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Firma sosta tecnica RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.sostaTecnicaUseCase.firma({
        firId,
        tenantId,
        utenteId: userId,
        nuovaSessione: dto?.nuovaSessione,
        correlationId: dto?.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Firma sosta tecnica RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Trasbordo totale (FIR in viaggio, P6): il trasportatore che ha in carico il rifiuto lo passa a un NUOVO
   * trasportatore (dall'anagrafica) con i dati di trasporto del suo mezzo. La disponibilita' la decide `/azioni`.
   * La nuova tratta del FIR nasce solo dopo l'esito positivo dell'ente. La firma e' del nuovo trasportatore.
   */
  @Post(':id/trasbordo-totale')
  @ApiOperation({
    summary: 'Dichiara il trasbordo totale del rifiuto a un nuovo trasportatore',
    description:
      "Verifica che l'azienda sia un trasportatore del FIR e che /azioni proponga il trasbordo, lo invia (inizio in UTC) " +
      "e, solo se l'ente accetta, aggiunge il nuovo trasportatore al formulario. La firma spetta al nuovo trasportatore.",
  })
  @ApiResponse({ status: 201, description: "Trasbordo accettato dall'ente" })
  @ApiResponse({ status: 400, description: "Dati non validi o trasbordo rifiutato dall'ente" })
  @ApiResponse({ status: 404, description: 'FIR o trasportatore non trovato' })
  @ApiResponse({
    status: 409,
    description:
      'OPERAZIONE_NON_DISPONIBILE, TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR, TRASBORDO_TOTALE_DA_FIRMARE, TRASBORDO_TOTALE_DI_ALTRO_SOGGETTO, TRASBORDO_TOTALE_IN_VERIFICA, TRASBORDO_TOTALE_ESITO_INCERTO o SESSIONE_FIRMA_IN_CORSO',
  })
  async dichiaraTrasbordoTotale(
    @Param('id') firId: string,
    @Body() dto: TrasbordoTotaleFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoTrasbordoTotale> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Trasbordo totale RENTRI richiesto', { firId, tenantId, userId })

    try {
      return await this.trasbordoTotaleUseCase.invia({
        firId,
        tenantId,
        trasportatoreId: dto.trasportatoreId,
        conducenteNome: dto.conducenteNome,
        conducenteCognome: dto.conducenteCognome,
        targaAutomezzo: dto.targaAutomezzo,
        targaRimorchio: dto.targaRimorchio,
        percorso: dto.percorso,
        dataOraInizioTrasporto: dto.dataOraInizioTrasporto,
        presaInCaricoRimorchioPrecedente: dto.presaInCaricoRimorchioPrecedente,
        annotazioni: dto.annotazioni,
        utenteId: userId,
        correlationId: dto.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Trasbordo totale RENTRI non riuscito', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Firma del trasbordo totale (FIR in viaggio, P6): solo il NUOVO trasportatore, e solo se l'ente mostra un
   * trasbordo non firmato a suo nome. Una sola richiesta sul telefono.
   */
  @Post(':id/firma-trasbordo-totale')
  @ApiOperation({
    summary: 'Firma il trasbordo totale su RENTRI come nuovo trasportatore',
    description:
      'Verifica /azioni (AcquisizioneFirmaTrasbordoTotale) e che il nuovo trasportatore mostrato dall’ente sia l’azienda, poi chiede la firma remota. Esiti: COMPLETATA, IN_ATTESA, SCADUTA, RIFIUTATA.',
  })
  @ApiResponse({ status: 201, description: 'Esito della firma' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description:
      'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE, TRASBORDO_TOTALE_FIRMA_NON_TUA o SESSIONE_FIRMA_IN_CORSO',
  })
  async firmaTrasbordoTotale(
    @Param('id') firId: string,
    @Body() dto: FirmaPartenzaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoCompletamentoFirma> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Firma trasbordo totale RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.trasbordoTotaleUseCase.firma({
        firId,
        tenantId,
        utenteId: userId,
        nuovaSessione: dto?.nuovaSessione,
        correlationId: dto?.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Firma trasbordo totale RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * «Verifica con l'ente» (FIR in viaggio, P6): chiude un invio di trasbordo totale rimasto senza esito. Fa solo
   * la riconciliazione (lettura presso l'ente, tratta locale se il trasbordo c'e'): nessun nuovo invio, nessuna firma.
   */
  @Post(':id/trasbordo-totale/verifica')
  @ApiOperation({
    summary: 'Verifica con l’ente un trasbordo totale rimasto senza esito',
    description:
      "Legge il formulario presso l'ente e chiude l'invio rimasto senza esito: se il trasbordo c'e' aggiunge il nuovo trasportatore al formulario (una volta sola), se non c'e' piu' dopo la finestra di attesa lo segna non riuscito. Non invia nulla e non chiede firme.",
  })
  @ApiResponse({ status: 201, description: 'PRESENTE, ASSENTE o NIENTE_DA_VERIFICARE' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({
    status: 409,
    description: 'TRASBORDO_TOTALE_IN_VERIFICA o SESSIONE_FIRMA_IN_CORSO',
  })
  async verificaTrasbordoTotale(
    @Param('id') firId: string,
    @Body() dto: FirmaPartenzaFirRentriDto,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Req() req: any
  ): Promise<EsitoVerificaTrasbordoTotale> {
    await richiediRuoloEffettivo(this.ruoloEffettivo, req.user, tenantId)
    this.logger.debug('Verifica trasbordo totale RENTRI richiesta', { firId, tenantId, userId })

    try {
      return await this.trasbordoTotaleUseCase.verifica({
        firId,
        tenantId,
        utenteId: userId,
        correlationId: dto?.correlationId,
      })
    } catch (error: any) {
      this.logger.error('Verifica trasbordo totale RENTRI non riuscita', error, { firId, tenantId })
      throw this.mappaErroreDominio(error)
    }
  }

  /** Storico delle operazioni del viaggio inviate all'ente (sola lettura, nessuna chiamata a RENTRI). */
  @Get(':id/eventi')
  @ApiOperation({
    summary: 'Storico delle operazioni inviate a RENTRI',
    description: 'Dal più recente: operazione, esito, utente, stato del formulario dopo.',
  })
  @ApiResponse({ status: 200, description: 'Elenco eventi' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async elencaEventi(
    @Param('id') firId: string,
    @TenantId() tenantId: string
  ): Promise<{ eventi: EventoFirRentri[] }> {
    try {
      return { eventi: await this.elencaEventiUseCase.execute(firId, tenantId) }
    } catch (error: any) {
      throw this.mappaErroreDominio(error)
    }
  }

  /**
   * Mappa una `DomainException` sull'eccezione HTTP corrispondente,
   * traducendo in italiano-utente i sei `errorCode` del Task 9 quando la
   * regola violata è una di quelle (R3 Task 9/10, debito chiuso qui: prima
   * di questo metodo ogni endpoint faceva sempre
   * `BadRequestException(error.message)`, esponendo il prefisso tecnico
   * "Business rule violated: <regola>." generato da
   * `DomainException.businessRuleViolation`).
   *
   * Stesso pattern di `RentriFormulariController.mappaErroreHttp` (il
   * modello da cui questo metodo è stato copiato, non reinventato): NOT_FOUND
   * e UNAUTHORIZED restano invariati; una `BUSINESS_RULE_VIOLATION` con
   * `rule` fuori da `RULE_TRADOTTE_TASK_9` ricade su `error.message`, mai su
   * `traduciErroreRentri` (il suo `default` non è adatto a un errore di
   * validazione locale). `errorMessage: error.message` è passato SEMPRE:
   * `FIRMA_RENTRI_RIFIUTATA` ne estrae il tipo di operazione con una regex
   * (`estraiTipoOperazioneFirma`) — omesso, il fallback generico scatterebbe
   * sempre anche quando l'operazione è riconoscibile.
   */
  private mappaErroreDominio(error: unknown): Error {
    if (!(error instanceof DomainException)) {
      return error as Error
    }

    if (error.code === 'NOT_FOUND') {
      return new NotFoundException(error.message)
    }
    if (error.code === 'UNAUTHORIZED') {
      return new UnauthorizedException(error.message)
    }
    if (error.code === 'BUSINESS_RULE_VIOLATION') {
      const rule = error.metadata?.rule as string | undefined
      if (rule && RULE_CONFLITTO.has(rule)) {
        return new ConflictException({
          statusCode: 409,
          codice: rule,
          message: error.metadata?.details ?? error.message,
        })
      }
      if (rule && RULE_DATI_VIAGGIO.has(rule)) {
        return new BadRequestException({
          statusCode: 400,
          codice: rule,
          message: error.metadata?.details ?? error.message,
        })
      }
      if (rule && RULE_TRADOTTE_TASK_9.has(rule)) {
        return new BadRequestException(
          traduciErroreRentri({ errorCode: rule, errorMessage: error.message }).messaggio
        )
      }
      return new BadRequestException(error.message)
    }

    return new BadRequestException(error.message)
  }
}
