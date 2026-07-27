import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Res,
  UseGuards,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { Response } from 'express'
import { TenantId } from '../../core/decorators/tenant.decorator'
import { UserId } from '../../core/decorators/user.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
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
import { AccettaFirRentriDto } from './dto/accetta-fir-rentri.dto'
import { AnnullaFirRentriDto } from './dto/annulla-fir-rentri.dto'
import { CaricaAllegatoFirRentriDto } from './dto/carica-allegato-fir-rentri.dto'
import { DomainException } from '../../domain/shared/domain-exception'
import { traduciErroreRentri } from '../../application/rentri/rentri-error-presentation'

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
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriFirLifecycleController {
  constructor(
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly accettaORespingiFIRUseCase: AccettaORespingiFIRUseCase,
    private readonly annullaFIRRentriUseCase: AnnullaFIRRentriUseCase,
    private readonly gestisciAllegatiFIRUseCase: GestisciAllegatiFIRUseCase,
    private readonly scaricaPdfFirUseCase: ScaricaPdfFirUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RentriFirLifecycleController')
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
    @UserId() userId: string
  ): Promise<EsitoAccettaORespingiFIR> {
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
    @UserId() userId: string
  ): Promise<EsitoAnnullaFIRRentri> {
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
    @UserId() userId: string
  ): Promise<AllegatoFIR> {
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
    @UserId() userId: string
  ): Promise<{ eliminato: true }> {
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
