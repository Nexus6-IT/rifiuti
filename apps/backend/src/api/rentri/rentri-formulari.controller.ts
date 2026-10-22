/**
 * RENTRI Formulari Controller — REST API (R2 Task 6)
 *
 * Espone il ciclo "cercare → verificare → acquisire/rilasciare" (R2 Task 4)
 * come endpoint HTTP:
 * - `GET /rentri/formulari` — ricerca (per il CF del tenant, già noto).
 * - `POST /rentri/formulari/:numeroFir/aggancia` — acquisizione (nuovo FIR
 *   locale o completamento di uno esistente, scelta esplicita del chiamante).
 * - `POST /rentri/fir/:id/rilascia-legame-rentri` — rilascio, scoped sul FIR
 *   locale (non sul numero_fir in query, per restare coerente con la
 *   convenzione già in uso su `/rentri/sync/fir/:id/conferma-legame`).
 *
 * ## Perché un controller NUOVO e non un'estensione di RENTRISyncController
 *
 * `RENTRISyncController` (`rentri-sync.controller.ts`, ~490 righe) copre già
 * cinque endpoint di un dominio distinto (trasmissione IN USCITA verso
 * RENTRI: batch/stato/log/metriche/conferma-legame di ciò che TRASMETTIAMO
 * noi). Il ciclo di questo file è il complementare — formulari che esistono
 * GIÀ su RENTRI, creati da un'altra controparte, da trovare e agganciare — e
 * ha già use case propri, isolati (`CercaFormulariRENTRIUseCase`,
 * `AcquisisciFormularioRENTRIUseCase`, `RilasciaFormularioRENTRIUseCase`, R2
 * Task 4). Infilare altri tre endpoint in un file già grande avrebbe
 * mescolato due workflow concettualmente distinti nello stesso controller;
 * un file dedicato mantiene la stessa separazione già scelta a livello di
 * use case.
 *
 * Stessa policy di ruolo di `RENTRISyncController` (R0 Task 4): un
 * aggancio/rilascio di visibilità è una scrittura verso un ente pubblico a
 * nome dell'azienda (un adempimento, non una semplice azione applicativa) —
 * un VIEWER non deve poterla né avviare né vedere l'esito della ricerca
 * (la ricerca stessa rivela cosa il tenant ha o non ha ancora agganciato).
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  HttpException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import {
  DomainError,
  FirAnnullatoNelFrattempoError,
  FormularioGiaAgganciatoError,
} from '../../core/domain/errors'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import {
  CercaFormulariRENTRIUseCase,
  RisultatoCercaFormulariRENTRI,
} from '../../application/rentri/cerca-formulari-rentri.use-case'
import {
  AcquisisciFormularioRENTRIUseCase,
  AcquisisciFormularioRENTRIResult,
} from '../../application/rentri/acquisisci-formulario-rentri.use-case'
import {
  RilasciaFormularioRENTRIUseCase,
  RilasciaFormularioRENTRIResult,
} from '../../application/rentri/rilascia-formulario-rentri.use-case'
import { traduciErroreRentri } from '../../application/rentri/rentri-error-presentation'
import { AgganciaFormularioRentriDto } from './dto/aggancia-formulario-rentri.dto'
import { RilasciaLegameRentriDto } from './dto/rilascia-legame-rentri.dto'

/** Messaggio di dominio quando il tenant non ha ancora configurato nessuna unità locale RENTRI. */
const UNITA_LOCALE_MANCANTE_RULE = 'UNITA_LOCALE_MANCANTE'

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix `api/v1` (v. main.ts): i path completi sono
// `api/v1/rentri/formulari` e `api/v1/rentri/fir/:id/rilascia-legame-rentri`.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
export class RentriFormulariController {
  constructor(
    private readonly cercaFormulariUseCase: CercaFormulariRENTRIUseCase,
    private readonly acquisisciFormularioUseCase: AcquisisciFormularioRENTRIUseCase,
    private readonly rilasciaFormularioUseCase: RilasciaFormularioRENTRIUseCase,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RentriFormulariController')
  }

  /**
   * Ricerca dei formulari RENTRI in cui il tenant compare come soggetto
   * coinvolto (anche quelli creati da terzi) — per il codice fiscale già
   * noto del tenant, nessun parametro da digitare
   * (`CercaFormulariRENTRIUseCase`, R2 Task 4).
   */
  @Get('rentri/formulari')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerca formulari RENTRI per il CF del tenant corrente',
    description:
      'Elenca i formulari in cui il tenant compare come soggetto coinvolto, anche se creati da ' +
      "un'altra controparte, segnalando per ciascuno se è già agganciato a un FIR locale.",
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Risultati della ricerca' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'CF del tenant o unità locale RENTRI non configurati',
  })
  async cerca(@CurrentUser() user: CurrentUserPayload): Promise<RisultatoCercaFormulariRENTRI> {
    this.logger.info('Ricerca formulari RENTRI richiesta', { tenantId: user.tenantId })

    try {
      return await this.cercaFormulariUseCase.execute(user.tenantId)
    } catch (error) {
      throw this.mappaErroreHttp(error)
    }
  }

  /**
   * Aggancia un formulario trovato: come nuovo FIR locale (dati importati dal
   * dettaglio RENTRI) o come completamento di un FIR locale esistente
   * (`AcquisisciFormularioRENTRIUseCase`, R2 Task 4).
   */
  @Post('rentri/formulari/:numeroFir/aggancia')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aggancia un formulario RENTRI trovato',
    description:
      'modalita=NUOVO crea un FIR locale dal dettaglio RENTRI; modalita=ESISTENTE completa un FIR ' +
      'locale già presente (firId obbligatorio in quel caso).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Formulario agganciato' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Precondizione di dominio non soddisfatta',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Ruolo non abilitato o non tra i soggetti coinvolti',
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'FIR locale indicato non trovato' })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Il formulario o il FIR locale indicato sono già legati altrove',
  })
  async aggancia(
    @Param('numeroFir') numeroFir: string,
    @Body() dto: AgganciaFormularioRentriDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<AcquisisciFormularioRENTRIResult> {
    this.logger.info('Aggancio formulario RENTRI richiesto', {
      numeroFir,
      tenantId: user.tenantId,
      modalita: dto.modalita,
    })

    try {
      const numIscrSito = await this.risolviNumIscrSito(user.tenantId)

      return await this.acquisisciFormularioUseCase.execute({
        tenantId: user.tenantId,
        userId: user.id,
        userRole: user.role,
        numeroFir,
        numIscrSito,
        visibilitaGiaAcquisita: dto.visibilitaGiaAcquisita ?? false,
        scelta:
          dto.modalita === 'ESISTENTE'
            ? { tipo: 'COLLEGA_ESISTENTE', firId: dto.firId! }
            : { tipo: 'NUOVO' },
        correlationId: dto.correlationId,
      })
    } catch (error) {
      throw this.mappaErroreHttp(error)
    }
  }

  /**
   * Rilascia il legame RENTRI di un FIR locale — "abbandona" la visibilità
   * senza cancellare il formulario dall'ente; il FIR locale resta come
   * record (`RilasciaFormularioRENTRIUseCase`, R2 Task 4). Scoped sul FIR
   * locale (non sul numero_fir): un FIR di un altro tenant risponde 404, mai
   * 403 (nessuna fuga di esistenza, convenzione P4 — v. il controllo
   * `fir.tenantId !== input.tenantId` già dentro il use case).
   */
  @Post('rentri/fir/:id/rilascia-legame-rentri')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rilascia il legame RENTRI di un FIR locale',
    description:
      'Il formulario resta su RENTRI: smette solo di essere collegato a questo FIR nel gestionale. ' +
      'Mai su un legame TRASMESSO_DA_NOI: per quello si usano gli endpoint del ciclo di vita RENTRI.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Legame rilasciato' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Nessun legame da rilasciare, o non rilasciabile',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'FIR non trovato (anche se di un altro tenant)',
  })
  async rilascia(
    @Param('id') firId: string,
    @Body() dto: RilasciaLegameRentriDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<RilasciaFormularioRENTRIResult> {
    this.logger.info('Rilascio legame RENTRI richiesto', { firId, tenantId: user.tenantId })

    try {
      const numIscrSito = await this.risolviNumIscrSito(user.tenantId)

      return await this.rilasciaFormularioUseCase.execute({
        tenantId: user.tenantId,
        userId: user.id,
        userRole: user.role,
        firId,
        numIscrSito,
        correlationId: dto.correlationId,
      })
    } catch (error) {
      throw this.mappaErroreHttp(error)
    }
  }

  /**
   * L'unità locale (`numIscrSito`) su cui operare: quella "principale" del
   * tenant (R2 multi-sede, `RentriUnitaLocaleService`). Fail-closed, PRIMA di
   * contattare RENTRI: senza una sede configurata l'acquisizione/il rilascio
   * non avrebbero comunque un `numIscrSito` valido su cui appoggiarsi (stesso
   * principio già applicato in `CercaFormulariRENTRIUseCase`, che verifica lo
   * stesso prerequisito per la ricerca).
   */
  private async risolviNumIscrSito(tenantId: string): Promise<string> {
    const sede = await this.unitaLocaleService.getPrincipale(tenantId)
    if (!sede) {
      throw DomainException.businessRuleViolation(
        UNITA_LOCALE_MANCANTE_RULE,
        'Configura prima la tua unità locale RENTRI prima di agganciare o rilasciare formulari.'
      )
    }
    return sede.numIscrSito
  }

  /**
   * Un solo punto di mappatura errore→HTTP per i tre endpoint (stessa
   * traduzione, stessa policy, mai duplicata tre volte).
   *
   * - `DomainException`: `NOT_FOUND` → 404 (messaggio fisso in italiano, MAI
   *   il messaggio grezzo dell'eccezione — `DomainException.notFound` genera
   *   testo in inglese, "FIR not found: <id>", mai presentabile). `UNAUTHORIZED`
   *   (da `assertRuoloScritturaRentri`, difesa in profondità — il `RolesGuard`
   *   blocca già lo stesso caso a monte) → 403. `BUSINESS_RULE_VIOLATION` →
   *   409 se la regola è un conflitto di stato reale (`FORMULARIO_GIA_AGGANCIATO`/
   *   `FIR_GIA_LEGATO`, un secondo aggancio dello stesso formulario/target),
   *   400 altrimenti (precondizione mancante, non un conflitto). Il testo
   *   esposto è SEMPRE `error.metadata.details` (o la traduzione dedicata per
   *   `FORMULARIO_GIA_AGGANCIATO`/`UNITA_LOCALE_MANCANTE`), mai `error.message`:
   *   quest'ultimo porta il prefisso tecnico "Business rule violated: <rule>."
   *   generato da `DomainException.businessRuleViolation`, che non deve mai
   *   arrivare all'utente. Ogni altro `code` (`validationFailed`, es.
   *   `NUMERO_FIR_MANCANTE`/`CAMPO_RENTRI_MANCANTE`) → 400 con `error.message`
   *   (già in italiano per costruzione, nessun prefisso tecnico in quel caso).
   * - `FormularioGiaAgganciatoError` (vincolo di unicità a database, R2 Task 3 —
   *   la finestra di corsa fra il controllo applicativo e la scrittura):
   *   stesso 409/stesso messaggio del caso applicativo sopra, verificato
   *   PRIMA del generico `DomainError` (ne è una sottoclasse).
   * - `RentriApiError` (403 dell'ente durante acquisizione/rilascio-visibilità):
   *   MAI lo stesso codice/messaggio del 403 di R1 (`RENTRI_FORBIDDEN`,
   *   certificato non valido) — qui la causa è "non sei tra i soggetti
   *   coinvolti" (`RENTRI_FORBIDDEN_ACQUISIZIONE`, R2 Task 7). 429/423/5xx con
   *   tentativi di resilienza esauriti (`retryable === true`) → 503, stesso
   *   messaggio di R1 (`RENTRI_RATE_LIMITED`, riusato senza duplicarlo).
   * - `FirAnnullatoNelFrattempoError` (il FIR è stato annullato mentre
   *   l'operazione lo salvava) → 409 con codice `FIR_ANNULLATO_NEL_FRATTEMPO`,
   *   come nel filtro globale; verificato prima del generico `DomainError`.
   * - Qualunque altro `DomainError` (validazioni dell'aggregate FIR non
   *   coperte sopra) → 400, difensivo.
   * - Tutto il resto: ri-sollevato invariato (finisce nel
   *   `GlobalExceptionFilter`, 500 — un errore davvero inatteso).
   */
  private mappaErroreHttp(error: unknown): Error {
    if (error instanceof DomainException) {
      if (error.code === 'NOT_FOUND') {
        return new NotFoundException('FIR non trovato')
      }

      if (error.code === 'UNAUTHORIZED') {
        return new ForbiddenException(error.message)
      }

      if (error.code === 'BUSINESS_RULE_VIOLATION') {
        const rule = error.metadata?.rule as string | undefined
        const dettaglio = (error.metadata?.details as string | undefined) || error.message

        if (rule === 'FORMULARIO_GIA_AGGANCIATO') {
          return new ConflictException(traduciErroreRentri({ errorCode: rule }).messaggio)
        }
        if (rule === 'FIR_GIA_LEGATO') {
          return new ConflictException(dettaglio)
        }
        if (rule === UNITA_LOCALE_MANCANTE_RULE) {
          return new BadRequestException(traduciErroreRentri({ errorCode: rule }).messaggio)
        }
        return new BadRequestException(dettaglio)
      }

      // validationFailed (NUMERO_FIR_MANCANTE, CAMPO_RENTRI_MANCANTE, ...):
      // il messaggio è già in italiano, senza prefisso tecnico.
      return new BadRequestException(error.message)
    }

    if (error instanceof FormularioGiaAgganciatoError) {
      return new ConflictException(
        traduciErroreRentri({ errorCode: 'FORMULARIO_GIA_AGGANCIATO' }).messaggio
      )
    }

    if (error instanceof RentriApiError) {
      if (!error.retryable) {
        return new ForbiddenException(
          traduciErroreRentri({ errorCode: 'RENTRI_FORBIDDEN_ACQUISIZIONE' }).messaggio
        )
      }
      return new HttpException(
        traduciErroreRentri({ errorCode: 'RENTRI_RATE_LIMITED' }).messaggio,
        HttpStatus.SERVICE_UNAVAILABLE
      )
    }

    if (error instanceof FirAnnullatoNelFrattempoError) {
      return new ConflictException({
        message: FirAnnullatoNelFrattempoError.MESSAGGIO_UTENTE,
        error: FirAnnullatoNelFrattempoError.CODICE,
      })
    }

    if (error instanceof DomainError) {
      return new BadRequestException(error.message)
    }

    return error as Error
  }
}
