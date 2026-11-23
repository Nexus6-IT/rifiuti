import { createHash } from 'crypto'
import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { FIR, StatoFormulario } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { normalizzaCodiceFiscaleSoggetto } from '../../domain/shared/codice-fiscale-soggetto'
import { LoggerService } from '../../core/logger/logger.service'
import {
  EsitoFormulario,
  RENTRIApiClient,
  TrasmissioneRentriIncertaError,
} from '../../infrastructure/rentri/rentri-api.client'
import {
  RentriApiError,
  RispostaRentriInattesaError,
} from '../../infrastructure/rentri/rentri-http-resilienza'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { ModuliAttiviService } from '../admin/moduli-attivi.service'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  DURATA_AVVIO_SESSIONE_MS,
  DURATA_MASSIMA_FASE_ENTE_MS,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import {
  EventoFirRentri,
  IEventiFirRentriRepository,
  NuovoEventoFirRentri,
} from './eventi-fir-rentri.port'
import { registraEventoFirRentri } from './registra-evento-fir-rentri'
import {
  ISessioniFirmaRentriRepository,
  STATI_SESSIONE_APERTA,
  SessioneFirmaGiaApertaError,
  SessioneFirmaRentri,
} from './sessioni-firma-rentri.port'
import { esitoEventoDaErroreFirma, eventoDaEsitoFirma } from './evento-da-esito-firma'
import { AVVISO_FIRMA_RENTRI_DA_COMPLETARE } from './firma-partenza-rentri.use-case'

/** Limite del contratto (`DatiAnnotazioneModel.annotazione`, `maxLength`). */
export const TESTO_ANNOTAZIONE_MAX = 10000

/** `tipoOperazione` della sessione di firma dell'annotazione (finisce nel testo letto sul telefono). */
const TIPO_OPERAZIONE_ANNOTAZIONE = 'ANNOTAZIONE'

export function tipoOperazioneAnnotazione(): string {
  return TIPO_OPERAZIONE_ANNOTAZIONE
}

/**
 * `tipoOperazione` della prenotazione che serializza gli INVII: nasce prima di `/azioni` e del POST (l'indice
 * unico parziale fa vincere una sola richiesta) e si rilascia prima della firma, che ha la sua sessione.
 */
const TIPO_PRENOTAZIONE_INVIO = 'ANNOTAZIONE_INVIO'

export function tipoPrenotazioneInvioAnnotazione(): string {
  return TIPO_PRENOTAZIONE_INVIO
}

/**
 * Finestra entro cui un invio senza esito (INCERTA, o INVIATA di un processo morto) puo' essere ancora in
 * elaborazione presso l'ente: e' la durata massima di una fase che parla con l'ente (POST + polling). Finche'
 * non e' passata, un'annotazione che l'ente non mostra ancora NON si considera assente: reinviare potrebbe
 * produrne due.
 */
export const FINESTRA_RICONCILIAZIONE_ANNOTAZIONE_MS = DURATA_MASSIMA_FASE_ENTE_MS

const OPERAZIONE_INVIO = 'Annotazione'
const OPERAZIONE_FIRMA = 'AcquisizioneFirmaAnnotazione'
/** Operazioni dello storico dopo le quali un'annotazione ACCETTATA precedente non e' piu' «in sospeso». */
const OPERAZIONI_CHE_AZZERANO: readonly string[] = ['Reset', 'RollbackFirma']

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

export interface ComandoRiprendiInvioAnnotazione {
  firId: string
  tenantId: string
  /** La prenotazione `ANNOTAZIONE_INVIO` da cui l'utente riparte. */
  sessioneId: string
  utenteId?: string
  correlationId?: string
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
 *   (trasportatori o destinatario, come da contratto: il solo produttore no): altrimenti 409 `ANNOTAZIONE_SOGGETTO_NON_NEL_FIR`, prima di
 *   qualunque chiamata all'ente.
 * - Testo da 1 a 10.000 caratteri (limite del contratto); un testo di soli spazi non e' un'annotazione.
 * - Nessuna doppia annotazione e nessuna doppia firma: se l'ente propone gia' la firma di un'annotazione in
 *   attesa, un'altra annotazione e' rifiutata (409 `ANNOTAZIONE_DA_FIRMARE`); la firma passa dal ciclo comune
 *   (una sola richiesta sul telefono, sessione riprendibile, presa esclusiva).
 * - I campi firmati localmente all'emissione non cambiano: l'annotazione vive solo presso l'ente e nello
 *   storico `fir_eventi_rentri` (nessuna copia sul FIR, nessuna migration).
 *
 * **Sequenza fail-closed di {@link invia}**: precondizioni locali -> prenotazione dell'invio ->
 * riconciliazione di un invio precedente senza esito -> `/azioni` (`Annotazione`) -> riga INVIATA -> POST ->
 * stato riletto -> storico -> firma (best effort: se fallisce resta `DA_COMPLETARE` e si ripete con
 * {@link firma}).
 *
 * **Ciclo di vita dell'invio nello storico** (`operazione = 'Annotazione'`, solo inserimenti):
 * - `INVIATA` scritta PRIMA del POST, con testo e CF: se il processo muore a meta' resta la prova di cosa
 *   potrebbe essere arrivato all'ente;
 * - poi `ACCETTATA` (esito positivo), `RIFIUTATA` (rifiuto dell'ente) o `INCERTA` (rete, 5xx, timeout);
 * - un invio rimasto `INVIATA`/`INCERTA` si **riconcilia** ({@link riconciliaInvioSenzaEsito}) leggendo le
 *   annotazioni dal dettaglio del formulario: trovata non firmata, con il nostro CF e lo stesso testo (hash)
 *   -> nuova riga `ACCETTATA` «riconciliata», quindi propria e firmabile; non trovata e fuori dalla
 *   {@link FINESTRA_RICONCILIAZIONE_ANNOTAZIONE_MS} -> nuova riga `RIFIUTATA` «non risulta presso l'ente» e si
 *   puo' reinviare; non trovata ma ancora dentro la finestra -> 409 `ANNOTAZIONE_IN_VERIFICA`, nessuna scrittura.
 *   La riconciliazione precede SEMPRE `/azioni` di un nuovo invio e ogni `authorize` ({@link firma},
 *   {@link riprendiInvio}): nessun FIR resta bloccato da un esito ignoto, e nessun testo ignoto si firma.
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

    // --- 2. Prenotazione locale: PRIMA di /azioni e del POST ---
    // Due invii concorrenti (due utenti, due schede) supererebbero entrambi `/azioni`, perche' la transizione a
    // `FirmaAnnotazione` avviene all'elaborazione della transazione, non alla ricezione del POST. L'indice
    // unico fa vincere una sola richiesta; l'altra riceve 409 senza aver scritto nulla.
    const prenotazione = await this.prenotaInvio(tenantId, firId, utenteId)
    let statoDopo: StatoFormulario | null
    try {
      // R1: un invio precedente senza esito si risolve PRIMA di decidere se ne parte un altro.
      await this.riconciliaInvioSenzaEsito(fir, tenantId, comando.correlationId)
      statoDopo = await this.scrivi(fir, cf, numeroFir, comando)
    } finally {
      await this.rilascia(prenotazione)
    }

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
   * Passi 3-6 sotto prenotazione: `/azioni`, POST, stato riletto, storico. Restituisce lo stato dopo l'invio.
   */
  private async scrivi(
    fir: FIR,
    cf: string,
    numeroFir: string,
    comando: ComandoAnnotazione
  ): Promise<StatoFormulario | null> {
    const { firId, tenantId, testo, utenteId, correlationId } = comando

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const proposte = new Set(azioni.map(a => a.operazione))
    if (proposte.has(OPERAZIONE_FIRMA)) {
      if (await this.annotazioneInSospeso(tenantId, firId, cf)) {
        throw DomainException.businessRuleViolation(
          'ANNOTAZIONE_DA_FIRMARE',
          "C'è già un'annotazione della tua azienda in attesa di firma su questo formulario: firmala (o annullala) prima di aggiungerne un'altra."
        )
      }
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_DI_ALTRO_SOGGETTO',
        "Su questo formulario c'è un'annotazione inserita da un altro soggetto, in attesa della sua firma: " +
          'non è tua e non puoi firmarla da qui. Aggiungi la tua quando sarà conclusa.'
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
    // Riga INVIATA PRIMA del POST, e NON best effort: se non si puo' scrivere, il POST non parte. E' cio'
    // che permette di riconciliare un invio il cui processo muore prima di registrarne l'esito.
    await this.eventi.registra({
      tenantId,
      firId,
      operazione: OPERAZIONE_INVIO,
      payload: corpo,
      transazioneId: null,
      esito: 'INVIATA',
      dettaglioEnte: "in invio all'ente",
      statoFormularioDopo: null,
      utenteId: utenteId ?? null,
    })
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
      // Rete, timeout o resilienza esaurita: non si sa se l'ente abbia registrato. Se la transazione e' nota
      // (202 ricevuto, esito non arrivato) la si conserva: la riconciliazione ne interroga lo stato (R5).
      await this.registraEvento({
        tenantId,
        firId,
        operazione: OPERAZIONE_INVIO,
        payload: corpo,
        transazioneId:
          errore instanceof TrasmissioneRentriIncertaError ? (errore.transazioneId ?? null) : null,
        esito: 'INCERTA',
        dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
        statoFormularioDopo: null,
        utenteId: utenteId ?? null,
      })
      this.logger.warn('Esito dell’invio RENTRI incerto: nessun reinvio automatico', {
        firId,
        tenantId,
        numeroFir,
        causa: errore instanceof Error ? errore.message : String(errore),
        correlationId,
      })
      throw this.esitoIncerto()
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

    // Accettata: stato riletto e storico.
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

    return statoDopo
  }

  /**
   * Firma l'annotazione in attesa (`AcquisizioneFirmaAnnotazione`, proposta da `/azioni`): ripresa dopo un
   * invio la cui firma non si e' conclusa, oppure «Richiedi di nuovo». Passa dal ciclo comune (sessione
   * riprendibile, presa esclusiva, stato riletto).
   */
  async firma(comando: ComandoFirmaAnnotazione): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, utenteId, correlationId } = comando

    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)

    // R7: un invio in corso in un altro processo (prenotazione viva) ha la precedenza: niente riconciliazione
    // concorrente (eviterebbe due righe ACCETTATA per la stessa annotazione) e niente firma.
    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    if (
      aperta?.tipoOperazione === TIPO_PRENOTAZIONE_INVIO &&
      aperta.scadenza.getTime() > Date.now()
    ) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_IN_CORSO',
        "Un'annotazione è in invio all'ente su questo formulario: attendi qualche secondo e riprova la firma."
      )
    }

    // R1: un nostro invio senza esito si riconcilia con l'ente PRIMA di qualunque authorize. Nessuna
    // prenotazione qui: una sessione di firma ANNOTAZIONE puo' essere aperta (ripresa), e un invio in corso
    // (INVIATA recente, non ancora presso l'ente) da' 409 grazie alla finestra, senza scrivere nulla.
    await this.riconciliaInvioSenzaEsito(fir, tenantId, correlationId)

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

    // Il contratto vuole la firma del soggetto che l'ha inserita: si firma solo un'annotazione NOSTRA, di cui
    // conosciamo il testo (storico locale). Un testo sconosciuto non si firma mai a scatola chiusa.
    const cf = await this.codiceFiscaleTenant(tenantId)
    const sospesa = await this.annotazioneInSospeso(tenantId, firId, cf)
    if (!sospesa) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_DI_ALTRO_SOGGETTO',
        "L'annotazione in attesa di firma non risulta inserita dalla tua azienda da WasteFlow: la deve firmare " +
          "il soggetto che l'ha inserita. Nessuna firma è stata richiesta."
      )
    }
    // M1: la firma si lega al testo che si firma (transazione dell'annotazione e hash del testo).
    const testoSospeso = String(
      (sospesa.payload as { annotazione?: string } | null)?.annotazione ?? ''
    )
    const legame = {
      transazioneIdAnnotazione: sospesa.transazioneId,
      testoSha256: sha256(testoSospeso),
    }

    // R4: lo storico locale non basta (un reset dal banner o dal portale e una nuova annotazione di un altro
    // soggetto lo renderebbero falso). Prima di ogni authorize l'ente deve mostrare UNA sola annotazione non
    // firmata, con il nostro codice fiscale e lo stesso hash del testo che mostriamo e leghiamo.
    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    const nonFirmate = annotazioniDelDettaglio(dettaglio.dati_annotazioni).filter(a => !a.firmata)
    const confermata =
      nonFirmate.length === 1 &&
      normalizzaCodiceFiscaleSoggetto(nonFirmate[0].identificativoSoggetto) === cf &&
      sha256(nonFirmate[0].testo) === legame.testoSha256
    if (!confermata) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_DI_ALTRO_SOGGETTO',
        "L'annotazione in attesa di firma presso l'ente non è quella inserita dalla tua azienda (soggetto o testo " +
          "diversi): la deve firmare chi l'ha inserita. Nessuna firma è stata richiesta."
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
          payload: legame,
          transazioneId: null,
          esito,
          dettaglioEnte: errore instanceof Error ? errore.message : String(errore),
          statoFormularioDopo: null,
          utenteId: utenteId ?? null,
        })
      }
      throw errore
    }

    const evento = eventoDaEsitoFirma(firma)
    if (firma.esito === 'COMPLETATA') {
      const anomalia = await this.verificaFirmaPressoEnte(fir, tenantId, cf, legame.testoSha256)
      if (anomalia) evento.dettaglioEnte = anomalia
    }
    await this.registraEvento({
      tenantId,
      firId,
      operazione: OPERAZIONE_FIRMA,
      payload: legame,
      transazioneId: null,
      ...evento,
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

  /**
   * Ripresa di una prenotazione `ANNOTAZIONE_INVIO` (R2), per esempio dal banner di un altro processo. Non e'
   * MAI una firma da riprendere con il ciclo comune: una prenotazione viva e' un invio in corso (409); una
   * appesa (processo morto) si chiude e si passa da {@link firma}, che riconcilia l'invio con l'ente prima di
   * qualunque authorize e firma solo un'annotazione propria proposta da `/azioni`.
   */
  async riprendiInvio(comando: ComandoRiprendiInvioAnnotazione): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, sessioneId, utenteId, correlationId } = comando
    await this.leggiFirLegato(firId, tenantId)

    const prenotazione = await this.sessioni.trovaPerId(tenantId, sessioneId)
    if (
      !prenotazione ||
      prenotazione.firId !== firId ||
      prenotazione.tipoOperazione !== TIPO_PRENOTAZIONE_INVIO
    ) {
      throw DomainException.notFound("Prenotazione dell'invio dell'annotazione", sessioneId)
    }
    if (STATI_SESSIONE_APERTA.includes(prenotazione.stato)) {
      if (prenotazione.scadenza.getTime() > Date.now()) {
        throw DomainException.businessRuleViolation(
          'SESSIONE_FIRMA_IN_CORSO',
          "L'annotazione è ancora in invio all'ente: attendi qualche secondo e controlla lo storico."
        )
      }
      await this.sessioni.chiudi(
        tenantId,
        prenotazione.id,
        'ANNULLATA',
        "Invio dell'annotazione interrotto: ripreso con riconciliazione"
      )
    }
    return this.firma({ firId, tenantId, utenteId, correlationId })
  }

  /**
   * R6: dopo una firma accettata l'ente deve mostrare la nostra annotazione con `dati_firma`. Se non e' cosi'
   * (o il dettaglio non si legge) la firma resta valida (l'esito e' dell'ente) ma la riga dello storico lo
   * segnala: e' l'ipotesi FEDELTA §8.3 su cui poggiano riconciliazione e R4.
   */
  private async verificaFirmaPressoEnte(
    fir: FIR,
    tenantId: string,
    cf: string,
    testoSha256: string
  ): Promise<string | null> {
    try {
      const dettaglio = await this.rentriApiClient.leggiFormulario(
        tenantId,
        fir.rentriNumeroFir as string
      )
      const nostre = annotazioniDelDettaglio(dettaglio.dati_annotazioni).filter(
        a =>
          normalizzaCodiceFiscaleSoggetto(a.identificativoSoggetto) === cf &&
          sha256(a.testo) === testoSha256
      )
      if (nostre.some(a => a.firmata) && !nostre.some(a => !a.firmata)) return null
      this.logger.warn("Firma dell'annotazione accettata ma senza dati_firma presso l'ente", {
        firId: fir.id,
        tenantId,
      })
      return "firma accettata, ma il dettaglio dell'ente non mostra dati_firma sull'annotazione: da verificare"
    } catch (errore) {
      this.logger.warn("Verifica di dati_firma dopo la firma dell'annotazione non riuscita", {
        firId: fir.id,
        tenantId,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      return "firma accettata; verifica di dati_firma presso l'ente non riuscita"
    }
  }

  /**
   * Il nostro ultimo invio rimasto senza esito: la riga `Annotazione` piu' recente (dopo l'ultima firma
   * accettata di un'annotazione) se e' `INVIATA` o `INCERTA`. Una riga successiva `ACCETTATA`/`RIFIUTATA`
   * (esito o riconciliazione) lo chiude.
   */
  private async invioSenzaEsito(tenantId: string, firId: string): Promise<EventoFirRentri | null> {
    const storico = await this.eventi.elenca(tenantId, firId) // dal piu' recente
    for (const e of storico) {
      if (e.operazione === OPERAZIONE_FIRMA && e.esito === 'ACCETTATA') return null
      if (e.operazione === OPERAZIONE_INVIO) {
        return e.esito === 'INVIATA' || e.esito === 'INCERTA' ? e : null
      }
    }
    return null
  }

  /**
   * R1: risolve un invio senza esito leggendo le annotazioni dal dettaglio del formulario
   * (`DatiAnnotazioneResultModel`). E' propria l'annotazione NON firmata con lo stesso soggetto e lo stesso
   * testo (SHA-256) del payload inviato: si scrive `ACCETTATA` «riconciliata» (diventa firmabile). Se non c'e'
   * e la {@link FINESTRA_RICONCILIAZIONE_ANNOTAZIONE_MS} e' passata, si scrive `RIFIUTATA` «non risulta presso
   * l'ente» (si puo' reinviare); dentro la finestra si risponde 409 `ANNOTAZIONE_IN_VERIFICA` senza scrivere.
   * Un errore di lettura si propaga: nessuna decisione, l'invio resta da riconciliare.
   */
  private async riconciliaInvioSenzaEsito(
    fir: FIR,
    tenantId: string,
    correlationId?: string
  ): Promise<void> {
    const pendente = await this.invioSenzaEsito(tenantId, fir.id)
    if (!pendente) return

    const inviato = (pendente.payload ?? {}) as {
      annotazione?: unknown
      identificativo_soggetto?: unknown
    }
    const testo = typeof inviato.annotazione === 'string' ? inviato.annotazione : null
    const soggetto =
      typeof inviato.identificativo_soggetto === 'string'
        ? normalizzaCodiceFiscaleSoggetto(inviato.identificativo_soggetto)
        : null

    // R5: se la transazione e' nota se ne chiede lo stato all'ente invece di affidarsi solo al tempo: in
    // elaborazione = ancora da decidere; non trovata o completata = decisione possibile subito.
    let statoTransazioneNoto = false
    if (pendente.transazioneId) {
      const transazione = await this.rentriApiClient.leggiStatoTransazione(
        tenantId,
        pendente.transazioneId
      )
      if (transazione.stato === 'IN_ELABORAZIONE') {
        throw DomainException.businessRuleViolation(
          'ANNOTAZIONE_IN_VERIFICA',
          "L'ultima annotazione inviata è ancora in elaborazione presso l'ente: riprova fra qualche minuto. " +
            'Nessuna operazione è stata inviata.'
        )
      }
      statoTransazioneNoto = true
    }

    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    // Al massimo una annotazione non firmata alla volta (`FirmaAnnotazione`): se l'ente ne mostra piu' d'una
    // non si sa quale sia la nostra (per esempio `dati_firma` non valorizzato), e non si adotta nulla.
    const nonFirmate = annotazioniDelDettaglio(dettaglio.dati_annotazioni).filter(a => !a.firmata)
    const presente =
      testo !== null &&
      soggetto !== null &&
      nonFirmate.length === 1 &&
      normalizzaCodiceFiscaleSoggetto(nonFirmate[0].identificativoSoggetto) === soggetto &&
      sha256(nonFirmate[0].testo) === sha256(testo)

    const base = {
      tenantId,
      firId: fir.id,
      operazione: OPERAZIONE_INVIO,
      payload: pendente.payload,
      transazioneId: pendente.transazioneId,
      utenteId: pendente.utenteId,
    }
    if (presente) {
      await this.registraEvento({
        ...base,
        esito: 'ACCETTATA',
        dettaglioEnte:
          'riconciliata: annotazione trovata nel dettaglio del formulario, non firmata, con il nostro soggetto e lo stesso testo',
        statoFormularioDopo: dettaglio.stato_formulario ?? null,
      })
      this.logger.info('Invio di annotazione senza esito riconciliato: presente presso l ente', {
        firId: fir.id,
        tenantId,
        eventoId: pendente.id,
        correlationId,
      })
      return
    }

    if (
      !statoTransazioneNoto &&
      Date.now() - pendente.createdAt.getTime() < FINESTRA_RICONCILIAZIONE_ANNOTAZIONE_MS
    ) {
      throw DomainException.businessRuleViolation(
        'ANNOTAZIONE_IN_VERIFICA',
        "L'ultima annotazione inviata è ancora senza esito e l'ente non la mostra: potrebbe essere ancora in " +
          'elaborazione. Riprova fra qualche minuto: nessuna operazione è stata inviata.'
      )
    }
    await this.registraEvento({
      ...base,
      esito: 'RIFIUTATA',
      dettaglioEnte:
        "riconciliata: l'annotazione inviata senza esito non risulta presso l'ente (nessuna annotazione non firmata con il nostro soggetto e lo stesso testo)",
      statoFormularioDopo: dettaglio.stato_formulario ?? null,
    })
    this.logger.info('Invio di annotazione senza esito riconciliato: assente presso l ente', {
      firId: fir.id,
      tenantId,
      eventoId: pendente.id,
      correlationId,
    })
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
  private async codiceFiscaleTenant(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })
    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile gestire le annotazioni. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }
    return normalizzaCodiceFiscaleSoggetto(tenant.codiceFiscale)
  }

  /** Il CF del tenant (normalizzato) se compare fra i soggetti ammessi del FIR, altrimenti 409 chiaro. */
  private async codiceFiscaleTenantNelFir(fir: FIR, tenantId: string): Promise<string> {
    const cf = await this.codiceFiscaleTenant(tenantId)

    // Contratto (formulari.yaml:1046): l'annotazione la inserisce il trasportatore o il destinatario che ha in
    // carico il rifiuto dopo le firme di partenza. Il produttore conta solo se ha anche uno di questi ruoli.
    const soggetti = [fir.trasportatore, fir.destinatario, ...fir.trasportatoriAggiuntivi]
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
        `Il codice fiscale della tua azienda (${cf}) non compare fra i trasportatori o il destinatario di questo formulario: ` +
          "l'annotazione la può aggiungere solo chi ha in carico il rifiuto dopo la partenza, non il solo produttore."
      )
    }
    return cf
  }

  /**
   * L'ultima annotazione NOSTRA accettata dall'ente e non ancora firmata, dallo storico locale (e' li' che
   * restano testo e CF inviati). `null` se l'ultima annotazione accettata e' gia' stata firmata o se non e'
   * nostra: in quel caso la firma richiesta dall'ente riguarda il testo di un altro soggetto.
   */
  private async annotazioneInSospeso(
    tenantId: string,
    firId: string,
    cf: string
  ): Promise<EventoFirRentri | null> {
    const storico = await this.eventi.elenca(tenantId, firId) // dal piu' recente
    for (const e of storico) {
      if (e.operazione === OPERAZIONE_FIRMA && e.esito === 'ACCETTATA') return null
      // Un reset o un rollback accettati cambiano cio' che c'e' presso l'ente: lo storico precedente non vale.
      if (OPERAZIONI_CHE_AZZERANO.includes(e.operazione) && e.esito === 'ACCETTATA') return null
      if (e.operazione === OPERAZIONE_INVIO && e.esito === 'ACCETTATA') {
        const soggetto = (e.payload as { identificativo_soggetto?: string } | null)
          ?.identificativo_soggetto
        return soggetto && normalizzaCodiceFiscaleSoggetto(soggetto) === cf ? e : null
      }
    }
    return null
  }

  /**
   * Prenota la riga di sessione che serializza gli invii (v. {@link TIPO_PRENOTAZIONE_INVIO}). Una sessione
   * di firma aperta e valida, o una prenotazione concorrente, danno 409 `SESSIONE_FIRMA_IN_CORSO`; una
   * prenotazione rimasta a meta' (processo morto, scaduta) si chiude e si riparte.
   */
  private async prenotaInvio(
    tenantId: string,
    firId: string,
    utenteId?: string
  ): Promise<SessioneFirmaRentri> {
    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    if (aperta) {
      const morta = aperta.stato !== 'IN_ATTESA' && aperta.scadenza.getTime() <= Date.now()
      if (!morta) {
        throw DomainException.businessRuleViolation(
          'SESSIONE_FIRMA_IN_CORSO',
          "C'è una richiesta di firma in attesa, o un'altra annotazione in invio, su questo formulario: " +
            "confermala sul telefono, annullala o attendi qualche secondo prima di aggiungere un'annotazione."
        )
      }
      await this.sessioni.chiudi(
        tenantId,
        aperta.id,
        'ANNULLATA',
        "Sessione rimasta a meta': scaduta senza completarsi"
      )
    }
    try {
      return await this.sessioni.prenota({
        tenantId,
        firId,
        tipoOperazione: TIPO_PRENOTAZIONE_INVIO,
        scadenza: new Date(Date.now() + DURATA_AVVIO_SESSIONE_MS),
        utenteId: utenteId ?? null,
      })
    } catch (errore) {
      if (errore instanceof SessioneFirmaGiaApertaError) {
        throw DomainException.businessRuleViolation(
          'SESSIONE_FIRMA_IN_CORSO',
          "Un'altra annotazione su questo formulario è appena partita: attendi qualche secondo e controlla lo storico."
        )
      }
      throw errore
    }
  }

  /** Rilascia la prenotazione: non deve mai bloccare il FIR ne' mascherare l'esito dell'invio. */
  private async rilascia(prenotazione: SessioneFirmaRentri): Promise<void> {
    try {
      await this.sessioni.chiudi(
        prenotazione.tenantId,
        prenotazione.id,
        'ANNULLATA',
        'invio annotazione concluso'
      )
    } catch (errore) {
      this.logger.warn("Rilascio della prenotazione dell'annotazione non riuscito", {
        sessioneId: prenotazione.id,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
    }
  }

  /**
   * Esito ignoto (rete, timeout, 5xx): non e' un errore del server ne' un rifiuto, e' uno stato da verificare.
   * 409 dedicato (mai un 500 generico). La riga INCERTA e' gia' nello storico: al prossimo tentativo la
   * riconciliazione legge il formulario presso l'ente PRIMA di inviare qualunque cosa, quindi non si duplica.
   */
  private esitoIncerto(): DomainException {
    return DomainException.businessRuleViolation(
      'ANNOTAZIONE_ESITO_INCERTO',
      'Non sappiamo se l’ente ha registrato l’annotazione (nessuna risposta o esito non arrivato). ' +
        'WasteFlow non la reinvia da solo: attendi qualche minuto e riprova a dichiararla, perché prima di ' +
        'inviare qualunque cosa controlla con l’ente se è già stata registrata, senza duplicarla. ' +
        'Nessuna firma è stata richiesta.'
    )
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

function sha256(testo: string): string {
  return createHash('sha256').update(testo, 'utf8').digest('hex')
}

interface AnnotazioneDellEnte {
  testo: string
  identificativoSoggetto: string
  firmata: boolean
}

/**
 * `DettaglioFormulario.dati_annotazioni` (`DatiAnnotazioneResultModel[]`), letto con prudenza: una voce senza
 * testo o soggetto si scarta (non si puo' attribuire), `dati_firma` assente o `null` = non firmata.
 */
function annotazioniDelDettaglio(dati: unknown[] | null | undefined): AnnotazioneDellEnte[] {
  if (!Array.isArray(dati)) return []
  const risultato: AnnotazioneDellEnte[] = []
  for (const voce of dati) {
    if (!voce || typeof voce !== 'object') continue
    const { annotazione, identificativo_soggetto, dati_firma } = voce as Record<string, unknown>
    if (typeof annotazione !== 'string' || typeof identificativo_soggetto !== 'string') continue
    risultato.push({
      testo: annotazione,
      identificativoSoggetto: identificativo_soggetto,
      firmata: dati_firma !== null && dati_firma !== undefined,
    })
  }
  return risultato
}
