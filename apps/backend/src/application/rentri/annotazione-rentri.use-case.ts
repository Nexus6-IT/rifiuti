import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { FIR, StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { normalizzaCodiceFiscaleSoggetto } from '../../domain/shared/codice-fiscale-soggetto'
import { LoggerService } from '../../core/logger/logger.service'
import { EsitoFormulario, RENTRIApiClient } from '../../infrastructure/rentri/rentri-api.client'
import {
  RentriApiError,
  RispostaRentriInattesaError,
} from '../../infrastructure/rentri/rentri-http-resilienza'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import { IEventiFirRentriRepository, NuovoEventoFirRentri } from './eventi-fir-rentri.port'
import { registraEventoFirRentri } from './registra-evento-fir-rentri'
import { ISessioniFirmaRentriRepository } from './sessioni-firma-rentri.port'
import { esitoEventoDaErroreFirma, eventoDaEsitoFirma } from './evento-da-esito-firma'
import { AVVISO_FIRMA_RENTRI_DA_COMPLETARE } from './firma-partenza-rentri.use-case'

/** Limite del contratto (`DatiAnnotazioneModel.annotazione`, `maxLength`). */
export const TESTO_ANNOTAZIONE_MAX = 10000

/** `tipoOperazione` della sessione di firma dell'annotazione (finisce nel testo letto sul telefono). */
const TIPO_OPERAZIONE_ANNOTAZIONE = 'ANNOTAZIONE'

export function tipoOperazioneAnnotazione(): string {
  return TIPO_OPERAZIONE_ANNOTAZIONE
}

const OPERAZIONE_INVIO = 'Annotazione'
const OPERAZIONE_FIRMA = 'AcquisizioneFirmaAnnotazione'

export interface ComandoAnnotazione {
  firId: string
  tenantId: string
  /** Testo libero, 1..10.000 caratteri (non solo spazi). Si invia cosi' com'e', senza ritocchi. */
  testo: string
  utenteId?: string
  correlationId?: string
  /** Solo per i test: v. `ComandoCompletaOperazioneConFirma.attesaMassimaMs`. */
  attesaMassimaMs?: number
  /** Solo per i test: v. `ComandoCompletaOperazioneConFirma.intervalloPollingMs`. */
  intervalloPollingMs?: number
}

export interface ComandoFirmaAnnotazione {
  firId: string
  tenantId: string
  utenteId?: string
  /** Dopo una richiesta scaduta o rifiutata: nuova richiesta sul telefono, decisa dalla persona. */
  nuovaSessione?: boolean
  correlationId?: string
  attesaMassimaMs?: number
  intervalloPollingMs?: number
}

/** La firma non e' partita o e' fallita DOPO che l'ente ha accettato l'annotazione: si rifa' da «Firma l'annotazione». */
export interface FirmaAnnotazioneDaCompletare {
  esito: 'DA_COMPLETARE'
  codice?: string
  avviso: string
}

export type EsitoFirmaAnnotazione = EsitoCompletamentoFirma | FirmaAnnotazioneDaCompletare

export interface EsitoAnnotazione {
  operazione: typeof OPERAZIONE_INVIO
  /** Stato del formulario riletto dall'ente dopo l'invio (`FirmaAnnotazione`); `null` se la rilettura non e' riuscita. */
  statoFormulario: StatoFormulario | null
  /** Esito del ciclo di firma. L'annotazione, una volta accettata dall'ente, non si annulla mai per colpa della firma. */
  firma: EsitoFirmaAnnotazione
}

/**
 * Annotazione di un FIR digitale in viaggio (FIR in viaggio, P4): un testo libero che un soggetto del FIR
 * aggiunge al formulario, firmato con la firma remota RENTRI. Ammessa durante il viaggio e dopo
 * l'accettazione (lo decide SEMPRE `/azioni`).
 *
 * **Regole**
 * - `identificativo_soggetto` e' il codice fiscale del tenant, che DEVE comparire fra i soggetti del FIR
 *   (produttore, trasportatori, destinatario): altrimenti 409 `ANNOTAZIONE_SOGGETTO_NON_NEL_FIR`, prima di
 *   qualunque chiamata all'ente.
 * - Testo da 1 a 10.000 caratteri (limite del contratto); un testo di soli spazi non e' un'annotazione.
 * - Nessuna doppia annotazione e nessuna doppia firma: se l'ente propone gia' la firma di un'annotazione in
 *   attesa, un'altra annotazione e' rifiutata (409 `ANNOTAZIONE_DA_FIRMARE`); la firma passa dal ciclo comune
 *   (una sola richiesta sul telefono, sessione riprendibile, presa esclusiva).
 * - I campi firmati localmente all'emissione non cambiano: l'annotazione vive solo presso l'ente e nello
 *   storico `fir_eventi_rentri` (nessuna copia sul FIR, nessuna migration).
 *
 * **Sequenza fail-closed di {@link invia}**: precondizioni locali -> nessuna firma aperta -> `/azioni`
 * (`Annotazione`) -> POST -> stato riletto -> storico -> firma (best effort: se fallisce resta
 * `DA_COMPLETARE` e si ripete con {@link firma}).
 */
@Injectable()
export class AnnotazioneRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly completaOperazioneConFirma: CompletaOperazioneConFirmaUseCase,
    private readonly eventi: IEventiFirRentriRepository,
    private readonly logger: LoggerService,
    private readonly sessioni: ISessioniFirmaRentriRepository,
    private readonly moduli: ModuliAttiviService,
    private readonly prisma: PrismaService
  ) {
    this.logger.setContext('AnnotazioneRentriUseCase')
  }

  async invia(comando: ComandoAnnotazione): Promise<EsitoAnnotazione> {
    const { firId, tenantId, testo, utenteId, correlationId } = comando

    // --- 1. Precondizioni locali, PRIMA di qualunque rete ---

    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)
    if (testo.trim().length === 0) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_NON_VALIDA',
        "Scrivi il testo dell'annotazione: non può essere vuoto."
      )
    }
    if (testo.length > TESTO_ANNOTAZIONE_MAX) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_NON_VALIDA',
        `L'annotazione può avere al massimo ${TESTO_ANNOTAZIONE_MAX} caratteri (ne ha ${testo.length}).`
      )
    }
    const cf = await this.codiceFiscaleTenantNelFir(fir, tenantId)
    const numeroFir = fir.rentriNumeroFir as string

    // Una firma gia' richiesta (hash calcolato, autorizzazione sul telefono) non si cambia sotto i piedi.
    if (await this.sessioni.trovaAperta(tenantId, firId)) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_IN_CORSO',
        "C'è una richiesta di firma in attesa su questo formulario: confermala sul telefono o annullala prima di aggiungere un'annotazione."
      )
    }

    // --- 2. La disponibilita' la decide l'ente ---

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const proposte = new Set(azioni.map(a => a.operazione))
    if (proposte.has(OPERAZIONE_FIRMA)) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_DA_FIRMARE',
        "C'è già un'annotazione in attesa di firma su questo formulario: firmala (o annullala) prima di aggiungerne un'altra."
      )
    }
    if (!proposte.has(OPERAZIONE_INVIO)) {
      throw DomainException.businessRuleViolation(
        'OPERAZIONE_NON_DISPONIBILE',
        "L'ente non consente ora di aggiungere un'annotazione a questo formulario: nessuna operazione è stata inviata."
      )
    }

    // --- 3. Scrittura presso l'ente ---

    const corpo = { annotazione: testo, identificativo_soggetto: cf }
    let esito: EsitoFormulario
    try {
      esito = await this.rentriApiClient.inviaAnnotazione(tenantId, numeroFir, corpo)
    } catch (errore) {
      const rifiutoDellEnte =
        (errore instanceof RentriApiError && !errore.retryable) ||
        errore instanceof RispostaRentriInattesaError
      if (rifiutoDellEnte) {
        const dettaglio = [errore.problemTitle, errore.problemDetail].filter(Boolean).join(': ')
        await this.registraEvento({
          tenantId,
          firId,
          operazione: OPERAZIONE_INVIO,
          payload: corpo,
          transazioneId: null,
          esito: 'RIFIUTATA',
          dettaglioEnte: `${errore.status} ${dettaglio}`.trim(),
          statoFormularioDopo: null,
          utenteId: utenteId ?? null,
        })
        throw this.rifiutata(numeroFir, dettaglio)
      }
      // Rete, timeout o resilienza esaurita: non si sa se l'ente abbia registrato.
      await this.registraEvento({
        tenantId,
        firId,
        operazione: OPERAZIONE_INVIO,
        payload: corpo,
        transazioneId: null,
        esito: 'INCERTA',
        dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      throw errore
    }

    if (esito.errore) {
      await this.registraEvento({
        tenantId,
        firId,
        operazione: OPERAZIONE_INVIO,
        payload: corpo,
        transazioneId: esito.transazioneId ?? null,
        esito: 'RIFIUTATA',
        dettaglioEnte: JSON.stringify(esito.validazione),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      throw this.rifiutata(
        numeroFir,
        `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    // --- 4. Accettata: stato riletto e storico ---

    const statoDopo = await this.rileggiStatoEApplica(fir, tenantId, numeroFir, correlationId)
    await this.registraEvento({
      tenantId,
      firId,
      operazione: OPERAZIONE_INVIO,
      payload: corpo,
      transazioneId: esito.transazioneId ?? null,
      esito: 'ACCETTATA',
      dettaglioEnte: null,
      statoFormularioDopo: statoDopo,
      utenteId: utenteId ?? null,
    })
    this.logger.info('Annotazione inviata a RENTRI', {
      firId,
      tenantId,
      numeroFir,
      utenteId,
      statoFormularioDopo: statoDopo,
      correlationId,
    })

    // --- 5. Firma: l'annotazione e' gia' dell'ente, un problema qui non la annulla ---

    let firma: EsitoFirmaAnnotazione
    try {
      firma = await this.firma({
        firId,
        tenantId,
        utenteId,
        correlationId,
        attesaMassimaMs: comando.attesaMassimaMs,
        intervalloPollingMs: comando.intervalloPollingMs,
      })
    } catch (errore) {
      const codice =
        errore instanceof DomainException
          ? (errore.metadata?.rule as string | undefined)
          : undefined
      this.logger.warn("Firma dell'annotazione RENTRI non completata", {
        firId,
        tenantId,
        codice,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      firma = {
        esito: 'DA_COMPLETARE',
        ...(codice && { codice }),
        avviso:
          `${AVVISO_FIRMA_RENTRI_DA_COMPLETARE}: l'annotazione è stata registrata ma la firma non è andata a buon fine, ` +
          "puoi riprovare da «Firma l'annotazione».",
      }
    }

    return { operazione: OPERAZIONE_INVIO, statoFormulario: statoDopo, firma }
  }

  /**
   * Firma l'annotazione in attesa (`AcquisizioneFirmaAnnotazione`, proposta da `/azioni`): ripresa dopo un
   * invio la cui firma non si e' conclusa, oppure «Richiedi di nuovo». Passa dal ciclo comune (sessione
   * riprendibile, presa esclusiva, stato riletto).
   */
  async firma(comando: ComandoFirmaAnnotazione): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, utenteId, correlationId } = comando

    await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    if (!azioni.some(a => a.operazione === OPERAZIONE_FIRMA)) {
      throw DomainException.businessRuleViolation(
        'FIRMA_ANNOTAZIONE_NON_DISPONIBILE',
        "L'ente non chiede ora la firma di un'annotazione su questo formulario: non c'è nessuna annotazione da firmare. Nessuna firma è stata richiesta."
      )
    }

    let firma: EsitoCompletamentoFirma
    try {
      firma = await this.completaOperazioneConFirma.execute({
        firId,
        tenantId,
        tipoOperazione: TIPO_OPERAZIONE_ANNOTAZIONE,
        utenteId,
        nuovaSessione: comando.nuovaSessione,
        correlationId,
        attesaMassimaMs: comando.attesaMassimaMs,
        intervalloPollingMs: comando.intervalloPollingMs,
      })
    } catch (errore) {
      const esito = esitoEventoDaErroreFirma(errore)
      if (esito) {
        await this.registraEvento({
          tenantId,
          firId,
          operazione: OPERAZIONE_FIRMA,
          payload: null,
          transazioneId: null,
          esito,
          dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
          statoFormularioDopo: null,
          utenteId: utenteId ?? null,
        })
      }
      throw errore
    }

    await this.registraEvento({
      tenantId,
      firId,
      operazione: OPERAZIONE_FIRMA,
      payload: null,
      transazioneId: null,
      ...eventoDaEsitoFirma(firma),
      utenteId: utenteId ?? null,
    })
    this.logger.info("Firma dell'annotazione RENTRI", {
      firId,
      tenantId,
      esito: firma.esito,
      utenteId,
      correlationId,
    })
    return firma
  }

  private async leggiFirLegato(firId: string, tenantId: string): Promise<FIR> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    // Fase 3 (D4): FIR importato = nessuna scrittura verso RENTRI prima della riconciliazione.
    verificaFirNonBloccato(fir)
    if (!fir.rentriNumeroFir) {
      throw DomainException.businessRuleViolation(
        'FIR_NON_LEGATO_RENTRI',
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nessun formulario a cui aggiungere un'annotazione."
      )
    }
    return fir
  }

  /** Come le rotte (`@RichiedeModulo('rentri')`): senza il modulo nessuna scrittura sull'ente. */
  private async verificaModulo(tenantId: string): Promise<void> {
    if (!(await this.moduli.moduliAttivi(tenantId)).includes('rentri')) {
      throw DomainException.businessRuleViolation(
        'MODULO_NON_ATTIVO',
        "Il modulo RENTRI non è attivo per l'azienda: l'annotazione non può essere inviata."
      )
    }
  }

  /** Il CF del tenant (normalizzato) se compare fra i soggetti del FIR, altrimenti 409 chiaro. */
  private async codiceFiscaleTenantNelFir(fir: FIR, tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })
    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile aggiungere un'annotazione. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }
    const cf = normalizzaCodiceFiscaleSoggetto(tenant.codiceFiscale)

    const soggetti = [
      fir.produttore,
      fir.trasportatore,
      fir.destinatario,
      ...fir.trasportatoriAggiuntivi,
    ]
    const presente = soggetti.some(
      s =>
        s &&
        [s.codiceFiscale, s.partitaIva].some(
          valore => valore && normalizzaCodiceFiscaleSoggetto(valore) === cf
        )
    )
    if (!presente) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_SOGGETTO_NON_NEL_FIR',
        `Il codice fiscale della tua azienda (${cf}) non compare fra i soggetti di questo formulario ` +
          "(produttore, trasportatori, destinatario): non puoi aggiungere un'annotazione a nome suo."
      )
    }
    return cf
  }

  private rifiutata(numeroFir: string, dettaglio: string): DomainException {
    return DomainException.businessRuleViolation(
      'ANNOTAZIONE_RENTRI_RIFIUTATA',
      `L'ente ha rifiutato l'annotazione del formulario ${numeroFir}` +
        (dettaglio ? `: ${dettaglio}` : '.')
    )
  }

  private async rileggiStatoEApplica(
    fir: FIR,
    tenantId: string,
    numeroFir: string,
    correlationId?: string
  ): Promise<StatoFormulario | null> {
    try {
      const statoEnte = await this.rentriApiClient.leggiStato(tenantId, numeroFir)
      fir.applyRentriStato(statoEnte.stato_formulario, correlationId)
      await this.firRepository.save(fir)
      return statoEnte.stato_formulario
    } catch (errore) {
      this.logger.warn("Rilettura dello stato RENTRI non riuscita dopo l'annotazione", {
        firId: fir.id,
        tenantId,
        numeroFir,
        errore: errore instanceof Error ? errore.message : String(errore),
        correlationId,
      })
      return null
    }
  }

  private registraEvento(evento: NuovoEventoFirRentri): Promise<void> {
    return registraEventoFirRentri(this.eventi, this.logger, evento)
  }
}
