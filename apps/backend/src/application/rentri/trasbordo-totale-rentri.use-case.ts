import { createHash } from 'crypto'
import { Injectable } from '@nestjs/common'
import { verificaFirNonBloccato } from '../../domain/fir/guardia-invio-rentri'
import { FIR, StatoFormulario, TipoTratta } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { TrasportatoreRepository } from '../../domain/registry/repositories/trasportatore.repository'
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
import { snapshotTratta } from '../fir/snapshot-parti'
import { GetAzioniDisponibiliUseCase } from './get-azioni-disponibili.use-case'
import {
  CompletaOperazioneConFirmaUseCase,
  DURATA_AVVIO_SESSIONE_MS,
  DURATA_MASSIMA_FASE_ENTE_MS,
  EsitoCompletamentoFirma,
} from './completa-operazione-con-firma.use-case'
import { IDatiViaggioFirRepository, NuovaTrattaTrasbordoTotale } from './dati-viaggio-fir.port'
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
import { DatoMancantePerRentriError } from './mappatura/mappa-parti'
import { ValoreNonTraducibilePerRentriError } from './mappatura/mappa-rifiuto'
import { mappaTrasbordoTotale, TrasbordoTotaleRentri } from './mappatura/mappa-viaggio'
import { istanteIso } from './sosta-tecnica-rentri.use-case'

/** `tipoOperazione` della sessione di firma del NUOVO trasportatore (finisce nel testo letto sul telefono). */
const TIPO_OPERAZIONE_TRASBORDO = 'TRASBORDO_TOTALE'

export function tipoOperazioneTrasbordoTotale(): string {
  return TIPO_OPERAZIONE_TRASBORDO
}

/**
 * `tipoOperazione` della prenotazione che serializza gli INVII (come per annotazione e sosta): nasce prima di
 * `/azioni` e del POST e si rilascia prima di tornare.
 */
const TIPO_PRENOTAZIONE_INVIO = 'TRASBORDO_TOTALE_INVIO'

export function tipoPrenotazioneInvioTrasbordoTotale(): string {
  return TIPO_PRENOTAZIONE_INVIO
}

/**
 * Finestra entro cui un invio senza esito puo' essere ancora in elaborazione presso l'ente: finche' non e'
 * passata, un trasbordo che l'ente non mostra ancora NON si considera assente (reinviare lo duplicherebbe).
 */
export const FINESTRA_RICONCILIAZIONE_TRASBORDO_MS = DURATA_MASSIMA_FASE_ENTE_MS

const OPERAZIONE_INVIO = 'TrasbordoTotale'
const OPERAZIONE_FIRMA = 'AcquisizioneFirmaTrasbordoTotale'
/** Operazioni dello storico dopo le quali un trasbordo ACCETTATO precedente non e' piu' «in sospeso». */
const OPERAZIONI_CHE_AZZERANO: readonly string[] = ['Reset', 'RollbackFirma']

export interface ComandoTrasbordoTotale {
  firId: string
  tenantId: string
  /** Il NUOVO trasportatore, dall'anagrafica dell'azienda. */
  trasportatoreId: string
  conducenteNome: string
  conducenteCognome: string
  targaAutomezzo?: string
  targaRimorchio?: string
  percorso?: string
  /** ISO 8601 con fuso orario esplicito: all'ente parte sempre in UTC. */
  dataOraInizioTrasporto: string
  presaInCaricoRimorchioPrecedente?: boolean
  annotazioni?: string
  utenteId?: string
  correlationId?: string
}

export interface ComandoRiprendiInvioTrasbordoTotale {
  firId: string
  tenantId: string
  /** La prenotazione `TRASBORDO_TOTALE_INVIO` da cui l'utente riparte. */
  sessioneId: string
  utenteId?: string
  correlationId?: string
}

/** Comando di {@link TrasbordoTotaleRentriUseCase.verifica}. */
export interface ComandoVerificaTrasbordoTotale {
  firId: string
  tenantId: string
  utenteId?: string
  correlationId?: string
}

/** Esito della riconciliazione di un invio senza esito. */
export type EsitoRiconciliazione = 'PRESENTE' | 'ASSENTE' | 'NIENTE_DA_VERIFICARE'

export interface EsitoVerificaTrasbordoTotale {
  operazione: string
  esito: EsitoRiconciliazione
}

export interface ComandoFirmaTrasbordoTotale {
  firId: string
  tenantId: string
  utenteId?: string
  /** Dopo una richiesta scaduta o rifiutata: nuova richiesta sul telefono, decisa dalla persona. */
  nuovaSessione?: boolean
  correlationId?: string
  attesaMassimaMs?: number
  intervalloPollingMs?: number
}

/**
 * Dopo l'invio la firma non e' di chi ha dichiarato il trasbordo ma del NUOVO trasportatore, che la apporra'
 * dal suo accesso (o dall'app RENTRI): da qui non si chiede nessuna firma.
 */
export interface FirmaDelNuovoTrasportatore {
  esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE'
  avviso: string
}

export interface EsitoTrasbordoTotale {
  operazione: typeof OPERAZIONE_INVIO
  /** Stato riletto dall'ente dopo l'invio (`FirmaTrasbordoTotale`); `null` se la rilettura non e' riuscita. */
  statoFormulario: StatoFormulario | null
  /**
   * `false` se l'ente ha accettato ma la tratta locale (nuova `FIRTransporter`) non si e' potuta salvare:
   * l'operazione e' riuscita e l'evento ACCETTATA lo segnala. Mai `true` prima dell'esito dell'ente.
   */
  trattaLocaleCreata: boolean
  firma: FirmaDelNuovoTrasportatore
}

/** Cio' che identifica un trasbordo presso l'ente: nuovo trasportatore, inizio, conducente. */
interface IdentitaTrasbordo {
  codiceFiscale: string
  inizio: number
  conducente: string
}

/**
 * Trasbordo totale di un FIR digitale in viaggio (FIR in viaggio, P6): il trasportatore che ha in carico il
 * rifiuto lo passa a un NUOVO trasportatore, scelto dall'anagrafica, con i dati di trasporto del suo mezzo
 * (conducente, targhe, inizio). Ammesso solo durante il viaggio (`InserimentoAccettazione`,
 * `InserimentoTrasportoSuccessivo`): lo decide SEMPRE `/azioni`.
 *
 * **Regola chiave: nessuna tratta locale (nuova `FIRTransporter`, ordine + 1) prima dell'esito positivo
 * dell'ente.** Se l'ente rifiuta, o l'esito e' incerto, la tratta non nasce: l'incertezza si chiude solo con
 * {@link riconciliaInvioSenzaEsito}, che la crea (una volta sola) se l'ente mostra il trasbordo.
 *
 * **Regole**
 * - Il CF del tenant deve essere di un trasportatore del FIR (principale o aggiuntivo); quale abbia in carico
 *   il rifiuto lo decide l'ente (403). Il nuovo trasportatore non puo' essere il tenant ne' chi ha gia' in
 *   carico il rifiuto (l'ultima tratta). Dati del trasporto fail-closed come per `/trasporto`.
 * - Il contratto prevede UN SOLO trasbordo totale (`dati_trasbordo_totale` e' un oggetto): un secondo non si
 *   propone in `/azioni` e non si manda.
 * - La firma (`AcquisizioneFirmaTrasbordoTotale`) e' del NUOVO trasportatore: {@link firma} la chiede solo se il
 *   CF del tenant e' quello del nuovo trasportatore mostrato dall'ente. Chi ha dichiarato il trasbordo non firma.
 * - I campi firmati all'emissione non cambiano: la tratta aggiuntiva non entra nel documento firmato e il
 *   trasbordo vive presso l'ente e nello storico `fir_eventi_rentri`.
 *
 * **Sequenza fail-closed di {@link invia}**: precondizioni locali -> prenotazione dell'invio -> riconciliazione
 * di un invio precedente senza esito -> `/azioni` -> riga INVIATA -> POST (mai ritentato) -> stato riletto ->
 * tratta locale -> storico ACCETTATA. La tratta si scrive PRIMA della riga ACCETTATA: se il processo muore in
 * mezzo resta una riga INVIATA, che la riconciliazione risolve senza duplicare la tratta.
 */
@Injectable()
export class TrasbordoTotaleRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly getAzioniDisponibiliUseCase: GetAzioniDisponibiliUseCase,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly completaOperazioneConFirma: CompletaOperazioneConFirmaUseCase,
    private readonly eventi: IEventiFirRentriRepository,
    private readonly logger: LoggerService,
    private readonly sessioni: ISessioniFirmaRentriRepository,
    private readonly moduli: ModuliAttiviService,
    private readonly prisma: PrismaService,
    private readonly trasportatori: TrasportatoreRepository,
    private readonly datiViaggio: IDatiViaggioFirRepository
  ) {
    this.logger.setContext('TrasbordoTotaleRentriUseCase')
  }

  async invia(comando: ComandoTrasbordoTotale): Promise<EsitoTrasbordoTotale> {
    const { firId, tenantId, utenteId, correlationId } = comando

    // --- 1. Precondizioni locali, PRIMA di qualunque rete ---
    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)
    const cfTenant = await this.cfDelTenant(tenantId)
    this.verificaTenantTrasportatore(fir, cfTenant)
    const nuovo = await this.trasportatori.findById(comando.trasportatoreId)
    if (!nuovo) {
      throw DomainException.notFound('Trasportatore', comando.trasportatoreId)
    }
    const snapshot = snapshotTratta(nuovo, 0, TipoTratta.TERRESTRE)
    const corpo = this.costruisciCorpo(comando, snapshot)
    this.verificaNuovoTrasportatore(fir, cfTenant, corpo)

    // --- 2. Prenotazione locale: PRIMA di /azioni e del POST (v. SostaTecnicaRentriUseCase) ---
    const prenotazione = await this.prenotaInvio(tenantId, firId, utenteId)
    let esito: { statoDopo: StatoFormulario | null; trattaLocaleCreata: boolean }
    try {
      await this.riconciliaInvioSenzaEsito(fir, tenantId, correlationId)
      esito = await this.scrivi(fir, corpo, comando, snapshot.trasportatoreId ?? null)
    } finally {
      await this.rilascia(prenotazione)
    }

    return {
      operazione: OPERAZIONE_INVIO,
      statoFormulario: esito.statoDopo,
      trattaLocaleCreata: esito.trattaLocaleCreata,
      firma: {
        esito: 'DA_FIRMARE_DAL_NUOVO_TRASPORTATORE',
        avviso:
          'Il trasbordo totale è registrato presso l’ente: la firma spetta al nuovo trasportatore, che deve ' +
          'confermarla dal suo accesso a WasteFlow o dall’app RENTRI FIR Digitale.',
      },
    }
  }

  /** Passi `/azioni`, riga INVIATA, POST, stato riletto, tratta locale, storico: tutti sotto prenotazione. */
  private async scrivi(
    fir: FIR,
    corpo: TrasbordoTotaleRentri,
    comando: ComandoTrasbordoTotale,
    trasportatoreId: string | null
  ): Promise<{ statoDopo: StatoFormulario | null; trattaLocaleCreata: boolean }> {
    const { firId, tenantId, utenteId, correlationId } = comando
    const numeroFir = fir.rentriNumeroFir as string

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    const proposte = new Set(azioni.map(a => a.operazione))
    if (proposte.has(OPERAZIONE_FIRMA)) {
      if (await this.trasbordoInSospeso(tenantId, firId)) {
        throw DomainException.businessRuleViolation(
          'TRASBORDO_TOTALE_DA_FIRMARE',
          'Su questo formulario c’è già un trasbordo totale dichiarato dalla tua azienda, in attesa della firma ' +
            'del nuovo trasportatore: non se ne può inviare un altro. Annullalo prima, se è sbagliato.'
        )
      }
      throw DomainException.businessRuleViolation(
        'TRASBORDO_TOTALE_DI_ALTRO_SOGGETTO',
        'Su questo formulario c’è un trasbordo totale in attesa di firma che non risulta dichiarato dalla tua ' +
          'azienda: non si può inviarne un altro da qui.'
      )
    }
    if (!proposte.has(OPERAZIONE_INVIO)) {
      throw DomainException.businessRuleViolation(
        'OPERAZIONE_NON_DISPONIBILE',
        "L'ente non consente ora il trasbordo totale su questo formulario: nessuna operazione è stata inviata."
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
      esito = await this.rentriApiClient.inviaTrasbordoTotale(
        tenantId,
        numeroFir,
        corpo as unknown as {
          trasportatore: Record<string, unknown>
          presa_in_carico: Record<string, unknown>
        }
      )
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
        throw this.rifiutato(numeroFir, dettaglio)
      }
      // Rete, timeout o resilienza esaurita: non si sa se l'ente abbia registrato. Nessuna tratta locale; se la
      // transazione e' nota la si conserva (la riconciliazione ne interroga lo stato).
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
      this.logger.warn('Esito del trasbordo totale RENTRI incerto: nessuna tratta locale', {
        firId,
        tenantId,
        numeroFir,
        causa: errore instanceof Error ? errore.message : String(errore),
        correlationId,
      })
      throw DomainException.businessRuleViolation(
        'TRASBORDO_TOTALE_ESITO_INCERTO',
        'Non sappiamo se l’ente ha registrato il trasbordo totale (nessuna risposta o esito non arrivato). ' +
          'WasteFlow non ha aggiunto il nuovo trasportatore al formulario e non lo reinvia da solo: attendi qualche ' +
          'minuto, poi usa «Verifica con l’ente» nel dettaglio del formulario.'
      )
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
      throw this.rifiutato(
        numeroFir,
        `Dettaglio della validazione RENTRI: ${JSON.stringify(esito.validazione)}`
      )
    }

    // --- Esito positivo dell'ente: SOLO ORA la copia locale ---
    const statoDopo = await this.rileggiStatoEApplica(fir, tenantId, numeroFir, correlationId)
    const { creata: trattaLocaleCreata, dettaglio } = await this.creaTrattaLocale(
      fir,
      tenantId,
      corpo,
      trasportatoreId,
      correlationId
    )
    await this.registraEvento({
      tenantId,
      firId,
      operazione: OPERAZIONE_INVIO,
      payload: corpo,
      transazioneId: esito.transazioneId ?? null,
      esito: 'ACCETTATA',
      dettaglioEnte: dettaglio,
      statoFormularioDopo: statoDopo,
      utenteId: utenteId ?? null,
    })
    this.logger.info('Trasbordo totale inviato a RENTRI', {
      firId,
      tenantId,
      numeroFir,
      utenteId,
      statoFormularioDopo: statoDopo,
      trattaLocaleCreata,
      correlationId,
    })
    return { statoDopo, trattaLocaleCreata }
  }

  /**
   * «Verifica con l'ente»: azione esplicita dell'utente per chiudere un invio rimasto senza esito (`INVIATA` o
   * `INCERTA`) quando non c'e' altro modo di arrivarci dall'interfaccia. Esegue SOLO la riconciliazione, sotto
   * prenotazione: nessun `/azioni`, nessun POST, nessuna authorize. Esiti: `PRESENTE` (l'ente ha il trasbordo:
   * ACCETTATA riconciliata e tratta locale), `ASSENTE` (finestra passata e nulla presso l'ente: RIFIUTATA),
   * `NIENTE_DA_VERIFICARE`; ancora in elaborazione = 409 `TRASBORDO_TOTALE_IN_VERIFICA`.
   */
  async verifica(comando: ComandoVerificaTrasbordoTotale): Promise<EsitoVerificaTrasbordoTotale> {
    const { firId, tenantId, utenteId, correlationId } = comando
    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)
    const esito = await this.riconciliaSottoPrenotazione(fir, tenantId, utenteId, correlationId)
    return { operazione: OPERAZIONE_INVIO, esito }
  }

  /**
   * Firma del trasbordo totale: spetta al NUOVO trasportatore. Si chiede (ciclo comune: una sola richiesta sul
   * telefono, sessione riprendibile) solo se `/azioni` propone `AcquisizioneFirmaTrasbordoTotale` E l'ente
   * mostra un trasbordo NON firmato il cui nuovo trasportatore ha il CF dell'azienda. Chi ha dichiarato il
   * trasbordo, o un'azienda estranea, non firma mai: 409 `TRASBORDO_TOTALE_FIRMA_NON_TUA`, nessuna authorize.
   */
  async firma(comando: ComandoFirmaTrasbordoTotale): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, utenteId, correlationId } = comando

    const fir = await this.leggiFirLegato(firId, tenantId)
    await this.verificaModulo(tenantId)
    const cfTenant = await this.cfDelTenant(tenantId)

    // Un invio in corso in un altro processo (prenotazione viva) ha la precedenza.
    const aperta = await this.sessioni.trovaAperta(tenantId, firId)
    if (
      aperta?.tipoOperazione === TIPO_PRENOTAZIONE_INVIO &&
      aperta.scadenza.getTime() > Date.now()
    ) {
      throw DomainException.businessRuleViolation(
        'SESSIONE_FIRMA_IN_CORSO',
        'Un trasbordo totale è in invio all’ente su questo formulario: attendi qualche secondo e riprova la firma.'
      )
    }

    await this.riconciliaSottoPrenotazione(fir, tenantId, utenteId, correlationId)

    const { azioni } = await this.getAzioniDisponibiliUseCase.execute(
      firId,
      tenantId,
      correlationId
    )
    if (!azioni.some(a => a.operazione === OPERAZIONE_FIRMA)) {
      throw DomainException.businessRuleViolation(
        'FIRMA_TRASBORDO_TOTALE_NON_DISPONIBILE',
        "L'ente non chiede ora la firma di un trasbordo totale su questo formulario: non c'è nulla da firmare. Nessuna firma è stata richiesta."
      )
    }

    // `/azioni` dice che qualcuno deve firmare; qui si verifica che sia la nostra azienda, il nuovo trasportatore.
    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    const dellEnte = trasbordoDelDettaglio(dettaglio.dati_trasbordo_totale)
    if (!dellEnte) {
      throw this.firmaNonTua(
        'L’ente non mostra nessun trasbordo totale su questo formulario: non c’è nulla da firmare.'
      )
    }
    if (dellEnte.firmato) {
      throw this.firmaNonTua('Il trasbordo totale risulta già firmato.')
    }
    if (dellEnte.identita.codiceFiscale !== cfTenant) {
      throw this.firmaNonTua(
        'Il trasbordo totale va firmato dal nuovo trasportatore, che non è la tua azienda: la firma di chi ha ' +
          'dichiarato il trasbordo, o di un’azienda estranea, non è ammessa.'
      )
    }
    const legame = { trasbordoSha256: identitaSha256(dellEnte.identita) }

    let firma: EsitoCompletamentoFirma
    try {
      firma = await this.completaOperazioneConFirma.execute({
        firId,
        tenantId,
        tipoOperazione: TIPO_OPERAZIONE_TRASBORDO,
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

    await this.registraEvento({
      tenantId,
      firId,
      operazione: OPERAZIONE_FIRMA,
      payload: legame,
      transazioneId: null,
      ...eventoDaEsitoFirma(firma),
      utenteId: utenteId ?? null,
    })
    this.logger.info('Firma del trasbordo totale RENTRI', {
      firId,
      tenantId,
      esito: firma.esito,
      utenteId,
      correlationId,
    })
    return firma
  }

  /**
   * Ripresa di una prenotazione `TRASBORDO_TOTALE_INVIO`: MAI una firma da riprendere con il ciclo comune.
   * Viva = invio in corso (409); appesa (processo morto) si chiude e si passa da {@link firma}, che riconcilia
   * l'invio con l'ente prima di qualunque authorize.
   */
  async riprendiInvio(
    comando: ComandoRiprendiInvioTrasbordoTotale
  ): Promise<EsitoCompletamentoFirma> {
    const { firId, tenantId, sessioneId, utenteId, correlationId } = comando
    await this.leggiFirLegato(firId, tenantId)

    const prenotazione = await this.sessioni.trovaPerId(tenantId, sessioneId)
    if (
      !prenotazione ||
      prenotazione.firId !== firId ||
      prenotazione.tipoOperazione !== TIPO_PRENOTAZIONE_INVIO
    ) {
      throw DomainException.notFound('Prenotazione dell’invio del trasbordo totale', sessioneId)
    }
    if (STATI_SESSIONE_APERTA.includes(prenotazione.stato)) {
      if (prenotazione.scadenza.getTime() > Date.now()) {
        throw DomainException.businessRuleViolation(
          'SESSIONE_FIRMA_IN_CORSO',
          'Il trasbordo totale è ancora in invio all’ente: attendi qualche secondo e controlla lo storico.'
        )
      }
      await this.sessioni.chiudi(
        tenantId,
        prenotazione.id,
        'ANNULLATA',
        'Invio del trasbordo totale interrotto: ripreso con riconciliazione'
      )
    }
    return this.firma({ firId, tenantId, utenteId, correlationId })
  }

  /**
   * Riconciliazione fuori da {@link invia}: se c'e' un invio senza esito la si esegue SOTTO prenotazione, come
   * l'invio, cosi' non si sovrappone a un invio, a un'altra firma o a un'altra verifica dello stesso FIR. Senza
   * invii in sospeso non si prenota nulla (una sessione di firma da riprendere non deve essere bloccata).
   */
  private async riconciliaSottoPrenotazione(
    fir: FIR,
    tenantId: string,
    utenteId: string | undefined,
    correlationId?: string
  ): Promise<EsitoRiconciliazione> {
    if (!(await this.invioSenzaEsito(tenantId, fir.id))) return 'NIENTE_DA_VERIFICARE'
    const prenotazione = await this.prenotaInvio(tenantId, fir.id, utenteId)
    try {
      return await this.riconciliaInvioSenzaEsito(fir, tenantId, correlationId)
    } finally {
      await this.rilascia(prenotazione)
    }
  }

  /** Il nostro ultimo invio rimasto senza esito: la riga `TrasbordoTotale` piu' recente se e' `INVIATA` o `INCERTA`. */
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
   * Risolve un invio senza esito leggendo `dati_trasbordo_totale` dal dettaglio. E' proprio il trasbordo con
   * lo stesso nuovo trasportatore, lo stesso inizio e lo stesso conducente, firmato o no (la firma e' del nuovo
   * trasportatore, che puo' avere firmato prima che il mittente riconciliasse): `ACCETTATA`
   * «riconciliata» e SOLO ORA la tratta locale (idempotente). Se non c'e' e la finestra e' passata:
   * `RIFIUTATA` «non risulta presso l'ente», nessuna tratta. Dentro la finestra (o con la transazione ancora in
   * elaborazione): 409 `TRASBORDO_TOTALE_IN_VERIFICA`, nessuna scrittura. Un errore di lettura si propaga.
   */
  private async riconciliaInvioSenzaEsito(
    fir: FIR,
    tenantId: string,
    correlationId?: string
  ): Promise<EsitoRiconciliazione> {
    const pendente = await this.invioSenzaEsito(tenantId, fir.id)
    if (!pendente) return 'NIENTE_DA_VERIFICARE'

    const inviato = corpoDaPayload(pendente.payload)

    let statoTransazioneNoto = false
    if (pendente.transazioneId) {
      const transazione = await this.rentriApiClient.leggiStatoTransazione(
        tenantId,
        pendente.transazioneId
      )
      if (transazione.stato === 'IN_ELABORAZIONE') {
        throw this.inVerifica(
          "L'ultimo trasbordo totale inviato è ancora in elaborazione presso l'ente: riprova fra qualche minuto."
        )
      }
      statoTransazioneNoto = true
    }

    const dettaglio = await this.rentriApiClient.leggiFormulario(
      tenantId,
      fir.rentriNumeroFir as string
    )
    const dellEnte = trasbordoDelDettaglio(dettaglio.dati_trasbordo_totale)
    const presente =
      inviato !== null &&
      dellEnte !== null &&
      identitaSha256(dellEnte.identita) === identitaSha256(identitaDaCorpo(inviato))

    const base = {
      tenantId,
      firId: fir.id,
      operazione: OPERAZIONE_INVIO,
      payload: pendente.payload,
      transazioneId: pendente.transazioneId,
      utenteId: pendente.utenteId,
    }
    if (presente && inviato) {
      // Esito positivo dell'ente (accertato): la tratta locale nasce ora, una volta sola.
      const { creata, dettaglio: nota } = await this.creaTrattaLocale(
        fir,
        tenantId,
        inviato,
        null,
        correlationId
      )
      await this.registraEvento({
        ...base,
        esito: 'ACCETTATA',
        dettaglioEnte:
          'riconciliata: trasbordo totale trovato nel dettaglio del formulario con lo stesso nuovo ' +
          `trasportatore, lo stesso inizio e lo stesso conducente${nota ? `; ${nota}` : ''}`,
        statoFormularioDopo: dettaglio.stato_formulario ?? null,
      })
      this.logger.info(
        'Invio di trasbordo totale senza esito riconciliato: presente presso l’ente',
        {
          firId: fir.id,
          tenantId,
          eventoId: pendente.id,
          trattaLocaleCreata: creata,
          correlationId,
        }
      )
      return 'PRESENTE'
    }

    if (
      !statoTransazioneNoto &&
      Date.now() - pendente.createdAt.getTime() < FINESTRA_RICONCILIAZIONE_TRASBORDO_MS
    ) {
      throw this.inVerifica(
        "L'ultimo trasbordo totale inviato è ancora senza esito e l'ente non lo mostra: potrebbe essere ancora in elaborazione. Riprova fra qualche minuto."
      )
    }
    if (statoTransazioneNoto && dellEnte) {
      // La transazione e' conclusa e l'ente mostra un trasbordo che non e' il nostro: non si adotta nulla e non
      // si reinvia (ne' il contratto ne' /azioni consentirebbero un secondo).
      throw this.inVerifica(
        "L'ente mostra un trasbordo totale diverso da quello inviato dalla tua azienda: controlla il formulario sul portale RENTRI."
      )
    }
    await this.registraEvento({
      ...base,
      esito: 'RIFIUTATA',
      dettaglioEnte:
        'riconciliata: il trasbordo totale inviato senza esito non risulta presso l’ente (nessun trasbordo con lo stesso nuovo trasportatore, inizio e conducente)',
      statoFormularioDopo: dettaglio.stato_formulario ?? null,
    })
    this.logger.info('Invio di trasbordo totale senza esito riconciliato: assente presso l’ente', {
      firId: fir.id,
      tenantId,
      eventoId: pendente.id,
      correlationId,
    })
    return 'ASSENTE'
  }

  /**
   * Scrive la tratta del nuovo trasportatore. Mai un errore verso l'utente: l'ente ha gia' accettato. Se la
   * scrittura fallisce lo dice la nota (che finisce nella riga ACCETTATA) e `creata` e' `false`.
   */
  private async creaTrattaLocale(
    fir: FIR,
    tenantId: string,
    corpo: TrasbordoTotaleRentri,
    trasportatoreId: string | null,
    correlationId?: string
  ): Promise<{ creata: boolean; dettaglio: string | null }> {
    try {
      const esito = await this.datiViaggio.aggiungiTrattaTrasbordoTotale(
        tenantId,
        fir.id,
        trattaDaCorpo(corpo, trasportatoreId)
      )
      return { creata: true, dettaglio: esito.creata ? null : 'tratta locale già presente' }
    } catch (errore) {
      this.logger.error(
        'Trasbordo totale accettato dall’ente ma tratta locale non salvata',
        errore instanceof Error ? errore : new Error(String(errore)),
        { firId: fir.id, tenantId, correlationId }
      )
      return {
        creata: false,
        dettaglio:
          'trasbordo accettato dall’ente ma tratta locale (nuovo trasportatore) non salvata: il formulario ' +
          'presso l’ente è corretto, la copia locale va completata',
      }
    }
  }

  /** Costruisce il corpo del contratto; un dato mancante o fuori limite e' 400, mai un valore inventato. */
  private costruisciCorpo(
    comando: ComandoTrasbordoTotale,
    snapshot: ReturnType<typeof snapshotTratta>
  ): TrasbordoTotaleRentri {
    const inizio = istanteIso(comando.dataOraInizioTrasporto)
    if (inizio === null) {
      throw this.nonValido(
        'La data e ora di inizio del trasporto non è valida: serve una data ISO 8601 con il fuso orario (per esempio 2026-11-18T12:00:00Z).'
      )
    }
    try {
      return mappaTrasbordoTotale({
        trasportatore: {
          ragioneSociale: snapshot.denominazione,
          partitaIva: snapshot.partitaIva ?? '',
          codiceFiscale: snapshot.codiceFiscale ?? null,
          numeroIscrizioneAlbo: snapshot.numeroIscrizioneAlbo ?? null,
        },
        presaInCarico: {
          conducenteNome: comando.conducenteNome,
          conducenteCognome: comando.conducenteCognome,
          targaAutomezzo: comando.targaAutomezzo,
          targaRimorchio: comando.targaRimorchio,
          percorso: comando.percorso,
          dataOraInizioTrasporto: new Date(inizio),
          annotazioni: comando.annotazioni,
          presaInCaricoRimorchioPrecedente: comando.presaInCaricoRimorchioPrecedente,
        },
      })
    } catch (errore) {
      if (
        errore instanceof DatoMancantePerRentriError ||
        errore instanceof ValoreNonTraducibilePerRentriError
      ) {
        throw this.nonValido(errore.message)
      }
      throw errore
    }
  }

  /** Il nuovo trasportatore non e' chi invia ne' chi ha gia' in carico il rifiuto (l'ultima tratta del FIR). */
  private verificaNuovoTrasportatore(
    fir: FIR,
    cfTenant: string,
    corpo: TrasbordoTotaleRentri
  ): void {
    const cfNuovo = normalizzaCodiceFiscaleSoggetto(corpo.trasportatore.codice_fiscale)
    if (cfNuovo === cfTenant) {
      throw this.nonValido(
        'Il nuovo trasportatore è la tua stessa azienda: scegli il trasportatore a cui passi il rifiuto.'
      )
    }
    const tratte = [
      fir.trasportatore,
      ...[...fir.trasportatoriAggiuntivi].sort((a, b) => a.ordine - b.ordine),
    ]
    const inCarico = tratte[tratte.length - 1]
    const identificativi = [inCarico?.codiceFiscale, inCarico?.partitaIva]
      .filter((v): v is string => !!v)
      .map(normalizzaCodiceFiscaleSoggetto)
    if (identificativi.includes(cfNuovo)) {
      throw this.nonValido(
        'Il nuovo trasportatore è già quello che ha in carico il rifiuto: scegli un altro trasportatore.'
      )
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
        "Questo FIR non è ancora legato a un formulario RENTRI: non c'è nessun formulario su cui fare un trasbordo totale."
      )
    }
    return fir
  }

  /** Come le rotte (`@RichiedeModulo('rentri')`): senza il modulo nessuna scrittura sull'ente. */
  private async verificaModulo(tenantId: string): Promise<void> {
    if (!(await this.moduli.moduliAttivi(tenantId)).includes('rentri')) {
      throw DomainException.businessRuleViolation(
        'MODULO_NON_ATTIVO',
        "Il modulo RENTRI non è attivo per l'azienda: il trasbordo totale non può essere inviato."
      )
    }
  }

  /** CF (o P.IVA) del tenant, normalizzato. */
  private async cfDelTenant(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { codiceFiscale: true },
    })
    if (!tenant?.codiceFiscale) {
      throw DomainException.businessRuleViolation(
        'CF_TENANT_MANCANTE',
        "Codice fiscale dell'azienda non configurato: impossibile gestire il trasbordo totale. " +
          'Configuralo nei dati anagrafici del tenant.'
      )
    }
    return normalizzaCodiceFiscaleSoggetto(tenant.codiceFiscale)
  }

  /** Il CF del tenant deve essere di un trasportatore del FIR (principale o aggiuntivo), altrimenti 409. */
  private verificaTenantTrasportatore(fir: FIR, cf: string): void {
    // Contratto (formulari.yaml, `/trasbordo-totale`): lo invia il trasportatore che ha in carico il rifiuto.
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
        'TRASBORDO_TOTALE_SOGGETTO_NON_NEL_FIR',
        `Il codice fiscale della tua azienda (${cf}) non compare fra i trasportatori di questo formulario: ` +
          'il trasbordo totale lo può dichiarare solo il trasportatore che ha in carico il rifiuto.'
      )
    }
  }

  /**
   * L'ultimo trasbordo NOSTRO accettato dall'ente e non azzerato: dallo storico locale. `null` se l'ultimo
   * trasbordo accettato e' stato firmato, azzerato da un reset/rollback.
   */
  private async trasbordoInSospeso(
    tenantId: string,
    firId: string
  ): Promise<EventoFirRentri | null> {
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
          "C'è una richiesta di firma in attesa, o un altro invio in corso, su questo formulario: " +
            'confermala sul telefono, annullala o attendi qualche secondo prima di fare un trasbordo totale.'
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
          'Un altro trasbordo totale su questo formulario è appena partito: attendi qualche secondo e controlla lo storico.'
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
        'invio trasbordo totale concluso'
      )
    } catch (errore) {
      this.logger.warn('Rilascio della prenotazione del trasbordo totale non riuscito', {
        sessioneId: prenotazione.id,
        causa: errore instanceof Error ? errore.message : String(errore),
      })
    }
  }

  private nonValido(messaggio: string): DomainException {
    return DomainException.businessRuleViolation('TRASBORDO_TOTALE_NON_VALIDO', messaggio)
  }

  private firmaNonTua(motivo: string): DomainException {
    return DomainException.businessRuleViolation(
      'TRASBORDO_TOTALE_FIRMA_NON_TUA',
      `${motivo} Nessuna firma è stata richiesta.`
    )
  }

  private inVerifica(motivo: string): DomainException {
    return DomainException.businessRuleViolation(
      'TRASBORDO_TOTALE_IN_VERIFICA',
      `${motivo} Nessuna operazione è stata inviata.`
    )
  }

  private rifiutato(numeroFir: string, dettaglio: string): DomainException {
    return DomainException.businessRuleViolation(
      'TRASBORDO_TOTALE_RENTRI_RIFIUTATO',
      `L'ente ha rifiutato il trasbordo totale del formulario ${numeroFir}` +
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
      this.logger.warn('Rilettura dello stato RENTRI non riuscita dopo il trasbordo totale', {
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

/** Identita' di un trasbordo, indipendente dal formato delle date: nuovo trasportatore, istante, conducente. */
function identitaSha256(i: IdentitaTrasbordo): string {
  return createHash('sha256')
    .update(JSON.stringify([i.codiceFiscale, i.inizio, i.conducente]), 'utf8')
    .digest('hex')
}

function conducenteNormalizzato(nome: unknown, cognome: unknown): string {
  return `${String(nome ?? '')
    .trim()
    .toLowerCase()}|${String(cognome ?? '')
    .trim()
    .toLowerCase()}`
}

function identitaDaCorpo(corpo: TrasbordoTotaleRentri): IdentitaTrasbordo {
  return {
    codiceFiscale: normalizzaCodiceFiscaleSoggetto(corpo.trasportatore.codice_fiscale),
    inizio: istanteIso(corpo.presa_in_carico.data_ora_inizio_trasporto) as number,
    conducente: conducenteNormalizzato(
      corpo.presa_in_carico.conducente.nome,
      corpo.presa_in_carico.conducente.cognome
    ),
  }
}

/** Il corpo inviato, riletto dal payload dello storico; `null` se incompleto (non si adotta a scatola chiusa). */
function corpoDaPayload(payload: unknown): TrasbordoTotaleRentri | null {
  if (!payload || typeof payload !== 'object') return null
  const { trasportatore, presa_in_carico } = payload as Record<string, any>
  if (
    typeof trasportatore?.codice_fiscale !== 'string' ||
    typeof trasportatore?.denominazione !== 'string' ||
    typeof presa_in_carico?.conducente?.nome !== 'string' ||
    typeof presa_in_carico?.conducente?.cognome !== 'string' ||
    istanteIso(presa_in_carico?.data_ora_inizio_trasporto) === null
  ) {
    return null
  }
  return payload as TrasbordoTotaleRentri
}

interface TrasbordoDellEnte {
  identita: IdentitaTrasbordo
  firmato: boolean
}

/**
 * `DettaglioFormulario.dati_trasbordo_totale` (`DatiTrasbordoTotaleResultModel`, UN solo oggetto), letto con
 * prudenza: voce senza trasportatore o con date illeggibili = non riconosciuta; `dati_firma_trasportatore`
 * assente o `null` = non firmato.
 */
function trasbordoDelDettaglio(dato: unknown): TrasbordoDellEnte | null {
  if (!dato || typeof dato !== 'object') return null
  const { trasportatore, presa_in_carico } = dato as Record<string, any>
  const inizio = istanteIso(presa_in_carico?.data_ora_inizio_trasporto)
  if (typeof trasportatore?.codice_fiscale !== 'string' || inizio === null) return null
  const firma = presa_in_carico?.dati_firma_trasportatore
  return {
    identita: {
      codiceFiscale: normalizzaCodiceFiscaleSoggetto(trasportatore.codice_fiscale),
      inizio,
      conducente: conducenteNormalizzato(
        presa_in_carico?.conducente?.nome,
        presa_in_carico?.conducente?.cognome
      ),
    },
    firmato: firma !== null && firma !== undefined,
  }
}

/**
 * La tratta locale dal corpo accettato dall'ente (e non dall'anagrafica, che nel frattempo puo' cambiare):
 * stesso risultato sia nel percorso diretto sia nella riconciliazione, cosi' l'idempotenza regge.
 */
function trattaDaCorpo(
  corpo: TrasbordoTotaleRentri,
  trasportatoreId: string | null
): NuovaTrattaTrasbordoTotale {
  const cf = normalizzaCodiceFiscaleSoggetto(corpo.trasportatore.codice_fiscale)
  const ePartitaIva = /^\d{11}$/.test(cf)
  const p = corpo.presa_in_carico
  return {
    trasportatoreId,
    denominazione: corpo.trasportatore.denominazione.slice(0, 255),
    partitaIva: ePartitaIva ? cf : null,
    // La colonna ha 16 caratteri: un identificativo estero piu' lungo non entra (la tratta nasce comunque).
    codiceFiscale: !ePartitaIva && cf.length <= 16 ? cf : null,
    numeroIscrizioneAlbo: corpo.trasportatore.numero_iscrizione_albo ?? null,
    mezzo: p.targa_automezzo ?? p.targa_rimorchio ?? null,
    conducenteNome: p.conducente.nome,
    conducenteCognome: p.conducente.cognome,
    targaRimorchio: p.targa_rimorchio ?? null,
    percorso: p.percorso ?? null,
    dataOraInizioTrasporto: new Date(istanteIso(p.data_ora_inizio_trasporto) as number),
  }
}
