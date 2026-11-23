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

/** Limite del contratto (`DatiSostaTecnicaModel.luogo_stazionamento`, `maxLength`). */
export const LUOGO_SOSTA_MAX = 1000

/** `tipoOperazione` della sessione di firma della sosta (finisce nel testo letto sul telefono). */
const TIPO_OPERAZIONE_SOSTA = 'SOSTA_TECNICA'

export function tipoOperazioneSostaTecnica(): string {
  return TIPO_OPERAZIONE_SOSTA
}

/**
 * `tipoOperazione` della prenotazione che serializza gli INVII (come per l'annotazione): nasce prima di
 * `/azioni` e del POST e si rilascia prima della firma, che ha la sua sessione.
 */
const TIPO_PRENOTAZIONE_INVIO = 'SOSTA_TECNICA_INVIO'

export function tipoPrenotazioneInvioSostaTecnica(): string {
  return TIPO_PRENOTAZIONE_INVIO
}

/**
 * Finestra entro cui un invio senza esito puo' essere ancora in elaborazione presso l'ente (durata massima di
 * una fase che parla con l'ente): finche' non e' passata, una sosta che l'ente non mostra ancora NON si
 * considera assente, perche' reinviare potrebbe produrne due.
 */
export const FINESTRA_RICONCILIAZIONE_SOSTA_MS = DURATA_MASSIMA_FASE_ENTE_MS

const OPERAZIONE_INVIO = 'SostaTecnica'
const OPERAZIONE_FIRMA = 'AcquisizioneFirmaSostaTecnica'
/** Operazioni dello storico dopo le quali una sosta ACCETTATA precedente non e' piu' «in sospeso». */
const OPERAZIONI_CHE_AZZERANO: readonly string[] = ['Reset', 'RollbackFirma']

export interface ComandoSostaTecnica {
  firId: string
  tenantId: string
  /** Luogo di stazionamento, 1..1000 caratteri (non solo spazi). Si invia senza gli spazi ai lati. */
  luogoStazionamento: string
  /** ISO 8601 con fuso orario esplicito (`Z` o `±hh:mm`): all'ente parte sempre in UTC. */
  dataOraSospensione: string
  dataOraRipresa: string
  utenteId?: string
  correlationId?: string
  /** Solo per i test: v. `ComandoCompletaOperazioneConFirma.attesaMassimaMs`. */
  attesaMassimaMs?: number
  /** Solo per i test: v. `ComandoCompletaOperazioneConFirma.intervalloPollingMs`. */
  intervalloPollingMs?: number
}

export interface ComandoRiprendiInvioSostaTecnica {
  firId: string
  tenantId: string
  /** La prenotazione `SOSTA_TECNICA_INVIO` da cui l'utente riparte. */
  sessioneId: string
  utenteId?: string
  correlationId?: string
}

export interface ComandoFirmaSostaTecnica {
  firId: string
  tenantId: string
  utenteId?: string
  /** Dopo una richiesta scaduta o rifiutata: nuova richiesta sul telefono, decisa dalla persona. */
  nuovaSessione?: boolean
  correlationId?: string
  attesaMassimaMs?: number
  intervalloPollingMs?: number
}

/** La firma non e' partita o e' fallita DOPO che l'ente ha accettato la sosta: si rifa' da «Firma la sosta tecnica». */
export interface FirmaSostaTecnicaDaCompletare {
  esito: 'DA_COMPLETARE'
  codice?: string
  avviso: string
}

export type EsitoFirmaSostaTecnica = EsitoCompletamentoFirma | FirmaSostaTecnicaDaCompletare

export interface EsitoSostaTecnica {
  operazione: typeof OPERAZIONE_INVIO
  /** Stato del formulario riletto dall'ente dopo l'invio (`FirmaSostaTecnica`); `null` se la rilettura non e' riuscita. */
  statoFormulario: StatoFormulario | null
  /** Esito del ciclo di firma. La sosta, una volta accettata dall'ente, non si annulla mai per colpa della firma. */
  firma: EsitoFirmaSostaTecnica
}

/** Corpo di `POST /{numero_fir}/sosta-tecnica` (`DatiSostaTecnicaModel`). */
interface CorpoSosta {
  luogo_stazionamento: string
  data_ora_sospensione: string
  data_ora_ripresa: string
}

/**
 * Sosta tecnica di un FIR digitale in viaggio (FIR in viaggio, P5): il trasportatore che ha in carico il
 * rifiuto dichiara dove e quando il mezzo si e' fermato (luogo, sospensione, ripresa) e firma la dichiarazione
 * con la firma remota RENTRI. Ammessa solo durante il viaggio (`InserimentoAccettazione`,
 * `InserimentoTrasportoSuccessivo`): lo decide SEMPRE `/azioni`.
 *
 * **Regole**
 * - Luogo da 1 a 1000 caratteri (non solo spazi); `sospensione < ripresa` (strettamente); le date arrivano con
 *   fuso esplicito e all'ente partono sempre in UTC. Tutto controllato PRIMA di qualunque chiamata all'ente.
 * - Il codice fiscale del tenant deve essere di un trasportatore del FIR (principale o aggiuntivo): produttore e
 *   destinatario non fanno soste tecniche (409 `SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR`).
 * - Nessuna doppia sosta e nessuna doppia firma: se l'ente propone gia' la firma di una sosta, un'altra sosta e'
 *   rifiutata; la firma passa dal ciclo comune (una sola richiesta sul telefono, sessione riprendibile, presa
 *   esclusiva) ed e' sempre quella del trasportatore, mai di una sosta che non abbiamo dichiarato noi.
 * - I campi firmati localmente all'emissione non cambiano: la sosta vive solo presso l'ente e nello storico
 *   `fir_eventi_rentri` (nessuna copia sul FIR, nessuna migration).
 *
 * **Sequenza fail-closed di {@link invia}** (stessa dell'annotazione): precondizioni locali -> prenotazione
 * dell'invio -> riconciliazione di un invio precedente senza esito -> `/azioni` -> riga INVIATA -> POST ->
 * stato riletto -> storico -> firma (best effort: se fallisce resta `DA_COMPLETARE` e si ripete con
 * {@link firma}).
 *
 * **Ciclo di vita dell'invio nello storico** (`operazione = 'SostaTecnica'`, solo inserimenti): `INVIATA` prima
 * del POST, poi `ACCETTATA`, `RIFIUTATA` o `INCERTA`. Un invio rimasto `INVIATA`/`INCERTA` si riconcilia
 * ({@link riconciliaInvioSenzaEsito}) leggendo `dati_soste_tecniche` dal dettaglio del formulario: trovata non
 * firmata e uguale (luogo e istanti) = `ACCETTATA` «riconciliata»; non trovata fuori finestra = `RIFIUTATA`;
 * dentro la finestra (o transazione ancora in elaborazione) = 409 `SOSTA_TECNICA_IN_VERIFICA`.
 */
@Injectable()
export class SostaTecnicaRentriUseCase {
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
    this.logger.setContext('SostaTecnicaRentriUseCase')
  }

  async invia(comando: ComandoSostaTecnica): Promise<EsitoSostaTecnica> {
    const { firId, tenantId, utenteId, correlationId } = comando

    // --- 1. Precondizioni locali, PRIMA di qualunque rete ---
    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)
    const corpo = this.validaCorpo(comando)
    await this.verificaTenantTrasportatore(fir, tenantId)

    // --- 2. Prenotazione locale: PRIMA di /azioni e del POST (v. AnnotazioneRentriUseCase) ---
    const prenotazione = await this.prenotaInvio(tenantId, firId, utenteId)
    let statoDopo: StatoFormulario | null
    try {
      await this.riconciliaInvioSenzaEsito(fir, tenantId, correlationId)
      statoDopo = await this.scrivi(fir, corpo, comando)
    } finally {
      await this.rilascia(prenotazione)
    }

    // --- 3. Firma: la sosta e' gia' dell'ente, un problema qui non la annulla ---
    let firma: EsitoFirmaSostaTecnica
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
      this.logger.warn('Firma della sosta tecnica RENTRI non completata', {
        firId,
        tenantId,
        codice,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      firma = {
        esito: 'DA_COMPLETARE',
        ...(codice && { codice }),
        avviso:
          `${AVVISO_FIRMA_RENTRI_DA_COMPLETARE}: la sosta tecnica è stata registrata ma la firma non è andata a buon fine, ` +
          'puoi riprovare da «Firma la sosta tecnica».',
      }
    }

    return { operazione: OPERAZIONE_INVIO, statoFormulario: statoDopo, firma }
  }

  /** Passi `/azioni`, riga INVIATA, POST, stato riletto, storico: tutti sotto prenotazione. */
  private async scrivi(
    fir: FIR,
    corpo: CorpoSosta,
    comando: ComandoSostaTecnica
  ): Promise<StatoFormulario | null> {
    const { firId, tenantId, utenteId, correlationId } = comando
    const numeroFir = fir.rentriNumeroFir as string

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const proposte = new Set(azioni.map(a => a.operazione))
    if (proposte.has(OPERAZIONE_FIRMA)) {
      if (await this.sostaInSospeso(tenantId, firId)) {
        throw DomainException.businessRuleViolation(
          'SOSTA_TECNICA_DA_FIRMARE',
          "C'è già una sosta tecnica della tua azienda in attesa di firma su questo formulario: firmala (o annullala) prima di dichiararne un'altra."
        )
      }
      throw DomainException.businessRuleViolation(
        'SOSTA_TECNICA_DI_ALTRO_SOGGETTO',
        "Su questo formulario c'è una sosta tecnica inserita da un altro soggetto, in attesa della sua firma: " +
          'non è tua e non puoi firmarla da qui. Dichiara la tua quando sarà conclusa.'
      )
    }
    if (!proposte.has(OPERAZIONE_INVIO)) {
      throw DomainException.businessRuleViolation(
        'OPERAZIONE_NON_DISPONIBILE',
        "L'ente non consente ora di dichiarare una sosta tecnica su questo formulario: nessuna operazione è stata inviata."
      )
    }

    // Riga INVIATA PRIMA del POST, e NON best effort: se non si puo' scrivere, il POST non parte.
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
      esito = await this.rentriApiClient.inviaSostaTecnica(tenantId, numeroFir, corpo)
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
      // Rete, timeout o resilienza esaurita: non si sa se l'ente abbia registrato. Se la transazione e' nota la
      // si conserva: la riconciliazione ne interroga lo stato.
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
    this.logger.info('Sosta tecnica inviata a RENTRI', {
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
   * Firma la sosta in attesa (`AcquisizioneFirmaSostaTecnica`, proposta da `/azioni`): ripresa dopo un invio la
   * cui firma non si e' conclusa, oppure «Richiedi di nuovo». Passa dal ciclo comune. Firma SOLO una sosta
   * nostra (storico locale) che l'ente conferma uguale (luogo e istanti) e unica non firmata.
   */
  async firma(comando: ComandoFirmaSostaTecnica): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, utenteId, correlationId } = comando

    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)

    // Un invio in corso in un altro processo (prenotazione viva) ha la precedenza: niente riconciliazione
    // concorrente (due righe ACCETTATA) e niente firma.
    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    if (
      aperta?.tipoOperazione === TIPO_PRENOTAZIONE_INVIO &&
      aperta.scadenza.getTime() > Date.now()
    ) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_IN_CORSO',
        'Una sosta tecnica è in invio all’ente su questo formulario: attendi qualche secondo e riprova la firma.'
      )
    }

    await this.riconciliaInvioSenzaEsito(fir, tenantId, correlationId)

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    if (!azioni.some(a => a.operazione === OPERAZIONE_FIRMA)) {
      throw DomainException.businessRuleViolation(
        'FIRMA_SOSTA_TECNICA_NON_DISPONIBILE',
        "L'ente non chiede ora la firma di una sosta tecnica su questo formulario: non c'è nessuna sosta da firmare. Nessuna firma è stata richiesta."
      )
    }

    const sospesa = await this.sostaInSospeso(tenantId, firId)
    const corpoSospeso = sospesa ? corpoDaPayload(sospesa.payload) : null
    if (!sospesa || !corpoSospeso) {
      throw this.dAltroSoggetto(
        "La sosta tecnica in attesa di firma non risulta dichiarata dalla tua azienda da WasteFlow: la deve firmare chi l'ha inserita."
      )
    }
    const legame = {
      transazioneIdSosta: sospesa.transazioneId,
      sostaSha256: sostaSha256(corpoSospeso),
    }

    // Lo storico locale non basta (un reset dal portale e una nuova sosta di un altro soggetto lo renderebbero
    // falso): prima di ogni authorize l'ente deve mostrare UNA sola sosta non firmata, uguale alla nostra.
    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    const nonFirmate = sosteDelDettaglio(dettaglio.dati_soste_tecniche).filter(s => !s.firmata)
    const confermata =
      nonFirmate.length === 1 && sostaSha256(nonFirmate[0].corpo) === legame.sostaSha256
    if (!confermata) {
      throw this.dAltroSoggetto(
        "La sosta tecnica in attesa di firma presso l'ente non è quella dichiarata dalla tua azienda (luogo o date diversi): la deve firmare chi l'ha inserita."
      )
    }

    let firma: EsitoCompletamentoFirma
    try {
      firma = await this.completaOperazioneConFirma.execute({
        firId,
        tenantId,
        tipoOperazione: TIPO_OPERAZIONE_SOSTA,
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
      const anomalia = await this.verificaFirmaPressoEnte(fir, tenantId, legame.sostaSha256)
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
    this.logger.info('Firma della sosta tecnica RENTRI', {
      firId,
      tenantId,
      esito: firma.esito,
      utenteId,
      correlationId,
    })
    return firma
  }

  /**
   * Ripresa di una prenotazione `SOSTA_TECNICA_INVIO`: MAI una firma da riprendere con il ciclo comune. Viva =
   * invio in corso (409); appesa (processo morto) si chiude e si passa da {@link firma}, che riconcilia
   * l'invio con l'ente prima di qualunque authorize.
   */
  async riprendiInvio(comando: ComandoRiprendiInvioSostaTecnica): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, sessioneId, utenteId, correlationId } = comando
    await this.leggiFirLegato(firId, tenantId)

    const prenotazione = await this.sessioni.trovaPerId(tenantId, sessioneId)
    if (
      !prenotazione ||
      prenotazione.firId !== firId ||
      prenotazione.tipoOperazione !== TIPO_PRENOTAZIONE_INVIO
    ) {
      throw DomainException.notFound('Prenotazione dell’invio della sosta tecnica', sessioneId)
    }
    if (STATI_SESSIONE_APERTA.includes(prenotazione.stato)) {
      if (prenotazione.scadenza.getTime() > Date.now()) {
        throw DomainException.businessRuleViolation(
          'SESSIONE_FIRMA_IN_CORSO',
          'La sosta tecnica è ancora in invio all’ente: attendi qualche secondo e controlla lo storico.'
        )
      }
      await this.sessioni.chiudi(
        tenantId,
        prenotazione.id,
        'ANNULLATA',
        'Invio della sosta tecnica interrotto: ripreso con riconciliazione'
      )
    }
    return this.firma({ firId, tenantId, utenteId, correlationId })
  }

  /**
   * Dopo una firma accettata l'ente deve mostrare la nostra sosta con `dati_firma`. Se non e' cosi' (o il
   * dettaglio non si legge) la firma resta valida (l'esito e' dell'ente) ma la riga dello storico lo segnala.
   */
  private async verificaFirmaPressoEnte(
    fir: FIR,
    tenantId: string,
    hash: string
  ): Promise<string | null> {
    try {
      const dettaglio = await this.rentriApiClient.leggiFormulario(
        tenantId,
        fir.rentriNumeroFir as string
      )
      const nostre = sosteDelDettaglio(dettaglio.dati_soste_tecniche).filter(
        s => sostaSha256(s.corpo) === hash
      )
      if (nostre.some(s => s.firmata) && !nostre.some(s => !s.firmata)) return null
      this.logger.warn('Firma della sosta tecnica accettata ma senza dati_firma presso l’ente', {
        firId: fir.id,
        tenantId,
      })
      return 'firma accettata, ma il dettaglio dell’ente non mostra dati_firma sulla sosta tecnica: da verificare'
    } catch (errore) {
      this.logger.warn('Verifica di dati_firma dopo la firma della sosta tecnica non riuscita', {
        firId: fir.id,
        tenantId,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
      return 'firma accettata; verifica di dati_firma presso l’ente non riuscita'
    }
  }

  /** Il nostro ultimo invio rimasto senza esito: la riga `SostaTecnica` piu' recente se e' `INVIATA` o `INCERTA`. */
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
   * Risolve un invio senza esito leggendo `dati_soste_tecniche` dal dettaglio. E' propria la sosta NON firmata,
   * unica non firmata, con lo stesso luogo e gli stessi istanti: `ACCETTATA` «riconciliata». Se non c'e' e la
   * finestra e' passata: `RIFIUTATA` «non risulta presso l'ente». Dentro la finestra (o con la transazione
   * ancora in elaborazione): 409 `SOSTA_TECNICA_IN_VERIFICA`, nessuna scrittura. Un errore di lettura si propaga.
   */
  private async riconciliaInvioSenzaEsito(
    fir: FIR,
    tenantId: string,
    correlationId?: string
  ): Promise<void> {
    const pendente = await this.invioSenzaEsito(tenantId, fir.id)
    if (!pendente) return

    const inviato = corpoDaPayload(pendente.payload)

    let statoTransazioneNoto = false
    if (pendente.transazioneId) {
      const transazione = await this.rentriApiClient.leggiStatoTransazione(
        tenantId,
        pendente.transazioneId
      )
      if (transazione.stato === 'IN_ELABORAZIONE') {
        throw this.inVerifica(
          "L'ultima sosta tecnica inviata è ancora in elaborazione presso l'ente: riprova fra qualche minuto."
        )
      }
      statoTransazioneNoto = true
    }

    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    // Al massimo una sosta non firmata alla volta (`FirmaSostaTecnica`): se l'ente ne mostra piu' d'una non si
    // sa quale sia la nostra e non si adotta nulla.
    const nonFirmate = sosteDelDettaglio(dettaglio.dati_soste_tecniche).filter(s => !s.firmata)
    const presente =
      inviato !== null &&
      nonFirmate.length === 1 &&
      sostaSha256(nonFirmate[0].corpo) === sostaSha256(inviato)

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
          'riconciliata: sosta tecnica trovata nel dettaglio del formulario, non firmata, con lo stesso luogo e gli stessi istanti',
        statoFormularioDopo: dettaglio.stato_formulario ?? null,
      })
      this.logger.info('Invio di sosta tecnica senza esito riconciliato: presente presso l’ente', {
        firId: fir.id,
        tenantId,
        eventoId: pendente.id,
        correlationId,
      })
      return
    }

    if (
      !statoTransazioneNoto &&
      Date.now() - pendente.createdAt.getTime() < FINESTRA_RICONCILIAZIONE_SOSTA_MS
    ) {
      throw this.inVerifica(
        "L'ultima sosta tecnica inviata è ancora senza esito e l'ente non la mostra: potrebbe essere ancora in elaborazione. Riprova fra qualche minuto."
      )
    }
    await this.registraEvento({
      ...base,
      esito: 'RIFIUTATA',
      dettaglioEnte:
        'riconciliata: la sosta tecnica inviata senza esito non risulta presso l’ente (nessuna sosta non firmata con lo stesso luogo e gli stessi istanti)',
      statoFormularioDopo: dettaglio.stato_formulario ?? null,
    })
    this.logger.info('Invio di sosta tecnica senza esito riconciliato: assente presso l’ente', {
      firId: fir.id,
      tenantId,
      eventoId: pendente.id,
      correlationId,
    })
  }

  /** Validazione del comando; restituisce il corpo del contratto (luogo ripulito, istanti in UTC). */
  private validaCorpo(comando: ComandoSostaTecnica): CorpoSosta {
    const luogo =
      typeof comando.luogoStazionamento === 'string' ? comando.luogoStazionamento.trim() : ''
    if (luogo.length === 0) {
      throw this.nonValida('Indica il luogo in cui il mezzo si è fermato: non può essere vuoto.')
    }
    if (luogo.length > LUOGO_SOSTA_MAX) {
      throw this.nonValida(
        `Il luogo può avere al massimo ${LUOGO_SOSTA_MAX} caratteri (ne ha ${luogo.length}).`
      )
    }
    const sospensione = istanteIso(comando.dataOraSospensione)
    if (sospensione === null) {
      throw this.nonValida(
        'La data e ora di sospensione non è valida: serve una data ISO 8601 con il fuso orario (per esempio 2026-11-18T10:00:00Z).'
      )
    }
    const ripresa = istanteIso(comando.dataOraRipresa)
    if (ripresa === null) {
      throw this.nonValida(
        'La data e ora di ripresa non è valida: serve una data ISO 8601 con il fuso orario (per esempio 2026-11-18T12:30:00Z).'
      )
    }
    if (sospensione >= ripresa) {
      throw this.nonValida('La ripresa deve essere successiva alla sospensione.')
    }
    return {
      luogo_stazionamento: luogo,
      data_ora_sospensione: new Date(sospensione).toISOString(),
      data_ora_ripresa: new Date(ripresa).toISOString(),
    }
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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nessun formulario a cui dichiarare una sosta tecnica."
      )
    }
    return fir
  }

  /** Come le rotte (`@RichiedeModulo('rentri')`): senza il modulo nessuna scrittura sull'ente. */
  private async verificaModulo(tenantId: string): Promise<void> {
    if (!(await this.moduli.moduliAttivi(tenantId)).includes('rentri')) {
      throw DomainException.businessRuleViolation(
        'MODULO_NON_ATTIVO',
        "Il modulo RENTRI non è attivo per l'azienda: la sosta tecnica non può essere inviata."
      )
    }
  }

  /** Il CF del tenant deve essere di un trasportatore del FIR (principale o aggiuntivo), altrimenti 409. */
  private async verificaTenantTrasportatore(fir: FIR, tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })
    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile dichiarare soste tecniche. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }
    const cf = normalizzaCodiceFiscaleSoggetto(tenant.codiceFiscale)

    // Contratto (formulari.yaml, `/sosta-tecnica`): la dichiara il trasportatore che ha in carico il rifiuto.
    const soggetti = [fir.trasportatore, ...fir.trasportatoriAggiuntivi]
    const presente = soggetti.some(
      s =>
        s &&
        [s.codiceFiscale, s.partitaIva].some(
          valore => valore && normalizzaCodiceFiscaleSoggetto(valore) === cf
        )
    )
    if (!presente) {
      throw DomainException.businessRuleViolation(
        'SOSTA_TECNICA_SOGGETTO_NON_NEL_FIR',
        `Il codice fiscale della tua azienda (${cf}) non compare fra i trasportatori di questo formulario: ` +
          'la sosta tecnica la può dichiarare solo il trasportatore che ha in carico il rifiuto.'
      )
    }
  }

  /**
   * L'ultima sosta NOSTRA accettata dall'ente e non ancora firmata, dallo storico locale (e' li' che restano
   * luogo e istanti inviati). `null` se l'ultima sosta accettata e' gia' stata firmata o se un reset/rollback
   * ha cambiato cio' che c'e' presso l'ente.
   */
  private async sostaInSospeso(tenantId: string, firId: string): Promise<EventoFirRentri | null> {
    const storico = await this.eventi.elenca(tenantId, firId) // dal piu' recente
    for (const e of storico) {
      if (e.operazione === OPERAZIONE_FIRMA && e.esito === 'ACCETTATA') return null
      if (OPERAZIONI_CHE_AZZERANO.includes(e.operazione) && e.esito === 'ACCETTATA') return null
      if (e.operazione === OPERAZIONE_INVIO && e.esito === 'ACCETTATA') return e
    }
    return null
  }

  /** Prenota la riga di sessione che serializza gli invii (v. {@link TIPO_PRENOTAZIONE_INVIO}). */
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
          "C'è una richiesta di firma in attesa, o un'altra sosta tecnica in invio, su questo formulario: " +
            'confermala sul telefono, annullala o attendi qualche secondo prima di dichiarare una sosta tecnica.'
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
          'Un’altra sosta tecnica su questo formulario è appena partita: attendi qualche secondo e controlla lo storico.'
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
        'invio sosta tecnica concluso'
      )
    } catch (errore) {
      this.logger.warn('Rilascio della prenotazione della sosta tecnica non riuscito', {
        sessioneId: prenotazione.id,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
    }
  }

  private nonValida(messaggio: string): DomainException {
    return DomainException.businessRuleViolation('SOSTA_TECNICA_NON_VALIDA', messaggio)
  }

  private dAltroSoggetto(motivo: string): DomainException {
    return DomainException.businessRuleViolation(
      'SOSTA_TECNICA_DI_ALTRO_SOGGETTO',
      `${motivo} Nessuna firma è stata richiesta.`
    )
  }

  private inVerifica(motivo: string): DomainException {
    return DomainException.businessRuleViolation(
      'SOSTA_TECNICA_IN_VERIFICA',
      `${motivo} Nessuna operazione è stata inviata.`
    )
  }

  /**
   * Esito ignoto (rete, timeout, 5xx): non e' un errore del server ne' un rifiuto, e' uno stato da verificare.
   * 409 dedicato (mai un 500 generico). La riga INCERTA e' gia' nello storico: al prossimo tentativo la
   * riconciliazione legge il formulario presso l'ente PRIMA di inviare qualunque cosa, quindi non si duplica.
   */
  private esitoIncerto(): DomainException {
    return DomainException.businessRuleViolation(
      'SOSTA_TECNICA_ESITO_INCERTO',
      'Non sappiamo se l’ente ha registrato la sosta tecnica (nessuna risposta o esito non arrivato). ' +
        'WasteFlow non la reinvia da solo: attendi qualche minuto e riprova a dichiararla, perché prima di ' +
        'inviare qualunque cosa controlla con l’ente se è già stata registrata, senza duplicarla. ' +
        'Nessuna firma è stata richiesta.'
    )
  }

  private rifiutata(numeroFir: string, dettaglio: string): DomainException {
    return DomainException.businessRuleViolation(
      'SOSTA_TECNICA_RENTRI_RIFIUTATA',
      `L'ente ha rifiutato la sosta tecnica del formulario ${numeroFir}` +
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
      this.logger.warn('Rilettura dello stato RENTRI non riuscita dopo la sosta tecnica', {
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

const ISO_CON_FUSO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/

/**
 * Istante (ms dall'epoca) di una data ISO 8601 con fuso esplicito, oppure `null`. Rifiuta le date senza fuso
 * (ambigue) e quelle impossibili (31 febbraio, ora 25): niente aggiustamenti silenziosi.
 */
export function istanteIso(valore: unknown): number | null {
  if (typeof valore !== 'string') return null
  const m = ISO_CON_FUSO.exec(valore.trim())
  if (!m) return null
  const [, a, me, g, h, mi, s, frazione, fuso] = m
  const anno = Number(a)
  const mese = Number(me)
  const giorno = Number(g)
  const ora = Number(h)
  const minuti = Number(mi)
  const secondi = s === undefined ? 0 : Number(s)
  if (mese < 1 || mese > 12 || ora > 23 || minuti > 59 || secondi > 59) return null
  const base = Date.UTC(anno, mese - 1, giorno, ora, minuti, secondi)
  if (new Date(base).getUTCDate() !== giorno) return null
  let offsetMs = 0
  if (fuso !== 'Z') {
    const oreFuso = Number(fuso.slice(1, 3))
    const minutiFuso = Number(fuso.slice(4, 6))
    if (oreFuso > 23 || minutiFuso > 59) return null
    offsetMs = (oreFuso * 60 + minutiFuso) * 60_000 * (fuso.startsWith('-') ? -1 : 1)
  }
  const millisecondi = frazione ? Number(frazione.slice(0, 3).padEnd(3, '0')) : 0
  return base + millisecondi - offsetMs
}

/** Luogo + istanti: identita' di una sosta (non ha altro identificativo), indipendente dal formato delle date. */
function sostaSha256(corpo: CorpoSosta): string {
  const sosp = istanteIso(corpo.data_ora_sospensione)
  const ripr = istanteIso(corpo.data_ora_ripresa)
  return createHash('sha256')
    .update(JSON.stringify([corpo.luogo_stazionamento.trim(), sosp, ripr]), 'utf8')
    .digest('hex')
}

/** Il corpo inviato, riletto dal payload dello storico; `null` se incompleto (non si firma a scatola chiusa). */
function corpoDaPayload(payload: unknown): CorpoSosta | null {
  if (!payload || typeof payload !== 'object') return null
  const { luogo_stazionamento, data_ora_sospensione, data_ora_ripresa } = payload as Record<
    string,
    unknown
  >
  if (
    typeof luogo_stazionamento !== 'string' ||
    istanteIso(data_ora_sospensione) === null ||
    istanteIso(data_ora_ripresa) === null
  ) {
    return null
  }
  return {
    luogo_stazionamento,
    data_ora_sospensione: data_ora_sospensione as string,
    data_ora_ripresa: data_ora_ripresa as string,
  }
}

interface SostaDellEnte {
  corpo: CorpoSosta
  firmata: boolean
}

/**
 * `DettaglioFormulario.dati_soste_tecniche` (`DatiSostaTecnicaResultModel[]`), letto con prudenza: una voce
 * senza luogo o con date illeggibili si scarta, `dati_firma` assente o `null` = non firmata.
 */
function sosteDelDettaglio(dati: unknown[] | null | undefined): SostaDellEnte[] {
  if (!Array.isArray(dati)) return []
  const risultato: SostaDellEnte[] = []
  for (const voce of dati) {
    const corpo = corpoDaPayload(voce)
    if (!corpo) continue
    const { dati_firma } = voce as Record<string, unknown>
    risultato.push({ corpo, firmata: dati_firma !== null && dati_firma !== undefined })
  }
  return risultato
}
