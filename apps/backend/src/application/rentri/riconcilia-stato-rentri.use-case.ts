import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { LoggerService } from '../../core/logger/logger.service'
import { MetricsService } from '../../core/metrics/metrics.service'
import { DomainEventsService } from '../../core/domain-events.service'
import { TenantContext } from '../../core/context/tenant-context'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { IDomainEvent } from '../../domain/shared/domain-event.interface'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  RENTRIApiClient,
  RentriApiError,
  estraiNumeroFirDaEsito,
} from '../../infrastructure/rentri/rentri-api.client'

/**
 * Riconciliazione periodica dello stato RENTRI (R5, Task 4).
 *
 * Perché serve: uno stato locale (`RENTRISyncStatus`, `rentriNumeroFir`,
 * `rentriStatoFormulario`) può divergere da quello dell'ente — trasmissione
 * persa, operazione fatta sul portale da un collega, formulario annullato
 * altrove. Nessun processo lo verificava prima di questo task.
 *
 * Ambito per esecuzione (per tenant, mai l'intero archivio — v. i tre lotti
 * sotto): non un allineamento in tempo reale, un controllo di igiene
 * periodico. Ogni FIR controllato costa ESATTAMENTE una chiamata
 * (`RENTRIApiClient.leggiFormulario`/`attendiEsito`), mai un'interrogazione
 * con filtro ampio (`cercaFormulari`, `GET /` senza numero_fir specifico):
 * quest'ultima tornerebbe più dati di quanti servano e - soprattutto - non
 * passa dal budget del limitatore preventivo per-tenant nello stesso modo
 * mirato di una singola lettura per FIR.
 *
 * Decisione di prodotto che rende questo task utile invece che pericoloso:
 * la riconciliazione CORREGGE DA SOLA solo quando la correzione è quella che
 * il nostro stesso sistema avrebbe scritto in caso di successo — riempie un
 * buco, non sovrascrive un valore in cui il sistema ha già fiducia. Ogni
 * altra divergenza viene SEGNALATA (mai applicata automaticamente): un
 * auto-fix sbagliato su un documento che vale in caso di contestazione è
 * peggiore del problema che risolve. Le uniche scritture di dominio fatte da
 * questo use case sono `FIR.markRENTRISynced` — lo STESSO metodo che
 * `SyncFIRToRENTRIUseCase` chiama in caso di successo — mai un percorso di
 * scrittura parallelo.
 */
@Injectable()
export class RiconciliaStatoRentriUseCase {
  /**
   * Campionamento massimo di FIR SYNCED verificati per tenant per
   * esecuzione. Non l'intero archivio: un tenant con centinaia di
   * formulari sincronizzati non giustifica centinaia di `GET /{numero_fir}`
   * ogni 6 ore. A 20 formulari/6h per tenant, anche un tenant con 500 FIR
   * sincronizzati viene ricontrollato per intero in 6,25 giorni: sufficiente
   * per un controllo di igiene, non per un allineamento in tempo reale (che
   * non è l'obiettivo di questo task). Il campione è sempre quello dei FIR
   * MENO recentemente verificati (`rentriLastReconciledAt` NULL prima, poi
   * crescente), non un ordinamento arbitrario, altrimenti alcuni FIR non
   * verrebbero mai controllati.
   */
  static readonly MAX_CAMPIONI_SYNCED_PER_TENANT = 20

  /**
   * Soglia (ms) oltre la quale un FIR ancora in stato SYNCING è considerato
   * potenzialmente bloccato: il DOPPIO del tempo massimo di polling atteso
   * in condizioni normali. Il tempo massimo di polling "normale" è
   * `RENTRIApiClient.MAX_TENTATIVI_POLLING_DEFAULT` (30) *
   * `INTERVALLO_POLLING_DEFAULT_MS` (2000ms) = 60000ms = 60s (valori privati
   * di quella classe, verificati per iscritto qui il 2026-07-26 — se
   * cambiano lì, questa soglia va aggiornata). Il doppio (120s) lascia
   * margine a un worker semplicemente lento prima di considerare la
   * transazione bloccata su un processo morto senza che l'errore sia mai
   * stato scritto localmente.
   */
  static readonly SOGLIA_SYNCING_BLOCCATO_MS = 120_000

  /**
   * Soglia (ms, 24 ore) oltre la quale una proposta di legame RENTRI in
   * modalità IBRIDA (`FIR.rentriNumeroFirProposto`) ancora non confermata
   * dall'utente entra nel lotto di controllo: potrebbe essere stata
   * agganciata o annullata altrove nel frattempo. 24h (non un intervallo più
   * corto) perché la conferma è un'azione volutamente UMANA — questo lotto
   * serve solo a far emergere casi dimenticati, non a sostituire la
   * conferma esplicita con un'automazione.
   */
  static readonly SOGLIA_ATTESA_CONFERMA_IBRIDA_MS = 24 * 60 * 60 * 1000

  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly prisma: PrismaService,
    private readonly rentriApiClient: RENTRIApiClient,
    private readonly syncLogRepository: RENTRISyncLogRepository,
    private readonly domainEvents: DomainEventsService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService
  ) {
    this.logger.setContext('RiconciliaStatoRentriUseCase')
  }

  /**
   * Esegue la riconciliazione per UN tenant. Il chiamante (job) è
   * responsabile di isolare i tenant fra loro (try/catch per tenant): un
   * errore qui (es. credenziale scaduta) si propaga al chiamante, non viene
   * inghiottito silenziosamente.
   */
  async execute(tenantId: string, correlationId?: string): Promise<RiconciliazioneRisultato> {
    // Necessario perché IFIRRepository (client RLS-aware, v.
    // FIRPrismaRepository.findById) risolve il tenant da TenantContext, non
    // da un parametro esplicito — questo use case gira da un job in
    // background (nessuna richiesta HTTP che lo popoli da sola).
    return TenantContext.run({ tenantId }, () => this.eseguiNelContesto(tenantId, correlationId))
  }

  private async eseguiNelContesto(
    tenantId: string,
    correlationId?: string
  ): Promise<RiconciliazioneRisultato> {
    const risultato: RiconciliazioneRisultato = {
      tenantId,
      controllati: 0,
      corretti: 0,
      segnalati: 0,
      nessunaDivergenza: 0,
      dettagli: [],
    }

    const [sincingBloccati, syncedCampione, ibridaInAttesa] = await Promise.all([
      this.selezionaSyncingBloccati(tenantId),
      this.selezionaCampioneSynced(tenantId),
      this.selezionaIbridaInAttesa(tenantId),
    ])

    // Ogni candidato è isolato dagli altri (try/catch per FIR, non solo per
    // tenant, v. job che avvolge questo metodo): un errore inatteso su UN
    // FIR (es. un vincolo di dominio violato) non deve interrompere la
    // verifica degli altri candidati dello stesso tenant.
    for (const id of sincingBloccati) {
      await this.eseguiIsolato(risultato, id, () =>
        this.riconciliaSyncingBloccato(tenantId, id, correlationId)
      )
    }

    for (const id of syncedCampione) {
      await this.eseguiIsolato(risultato, id, () =>
        this.riconciliaSynced(tenantId, id, correlationId)
      )
    }

    for (const id of ibridaInAttesa) {
      await this.eseguiIsolato(risultato, id, () =>
        this.riconciliaIbridaInAttesa(tenantId, id, correlationId)
      )
    }

    this.logger.info('Riconciliazione RENTRI completata per il tenant', {
      ...risultato,
      dettagli: undefined,
    })

    return risultato
  }

  private async eseguiIsolato(
    risultato: RiconciliazioneRisultato,
    firId: string,
    azione: () => Promise<EsitoSingolo>
  ): Promise<void> {
    try {
      const esito = await azione()
      this.accumula(risultato, esito)
    } catch (error: unknown) {
      this.logger.error(
        'Riconciliazione RENTRI: errore inatteso su un FIR, si prosegue con gli altri',
        error instanceof Error ? error : new Error(String(error)),
        { firId }
      )
      this.accumula(risultato, this.segnalaSenzaLog(firId, this.messaggioErrore(error)))
    }
  }

  private accumula(risultato: RiconciliazioneRisultato, esito: EsitoSingolo): void {
    risultato.controllati++
    risultato.dettagli.push(esito)
    if (esito.classificazione === 'CORRETTO') {
      risultato.corretti++
    } else if (esito.classificazione === 'SEGNALATO') {
      risultato.segnalati++
    } else {
      risultato.nessunaDivergenza++
    }
  }

  // ---------------------------------------------------------------------
  // Selezione dei tre lotti (query di sola lettura, dirette su Prisma: non
  // sono scritture di dominio, solo selezione dei candidati da verificare).
  // ---------------------------------------------------------------------

  private async selezionaSyncingBloccati(tenantId: string): Promise<string[]> {
    const soglia = new Date(Date.now() - RiconciliaStatoRentriUseCase.SOGLIA_SYNCING_BLOCCATO_MS)
    const righe = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        rentriSyncStatus: 'SYNCING',
        updatedAt: { lt: soglia },
      },
      select: { id: true },
    })
    return righe.map(r => r.id)
  }

  /**
   * Campiona al massimo {@link MAX_CAMPIONI_SYNCED_PER_TENANT} FIR SYNCED,
   * i meno recentemente verificati (`rentriLastReconciledAt` NULL per primi
   * — mai controllati — poi in ordine crescente). Con 500 FIR SYNCED nel
   * tenant, questa query restituisce comunque al massimo 20 righe: è la
   * `take` che impone il limite, non un filtro sul totale disponibile — il
   * test dedicato lo verifica popolando 500 righe e controllando la
   * lunghezza del risultato.
   */
  private async selezionaCampioneSynced(tenantId: string): Promise<string[]> {
    const righe = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: { not: null },
      },
      orderBy: [{ rentriLastReconciledAt: { sort: 'asc', nulls: 'first' } }],
      take: RiconciliaStatoRentriUseCase.MAX_CAMPIONI_SYNCED_PER_TENANT,
      select: { id: true },
    })
    return righe.map(r => r.id)
  }

  private async selezionaIbridaInAttesa(tenantId: string): Promise<string[]> {
    const soglia = new Date(
      Date.now() - RiconciliaStatoRentriUseCase.SOGLIA_ATTESA_CONFERMA_IBRIDA_MS
    )
    const righe = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        rentriNumeroFirProposto: { not: null },
        updatedAt: { lt: soglia },
      },
      select: { id: true },
    })
    return righe.map(r => r.id)
  }

  // ---------------------------------------------------------------------
  // Classificazione + eventuale correzione, per lotto.
  // ---------------------------------------------------------------------

  /**
   * FIR SYNCING bloccato oltre la soglia. Senza `rentriTransazioneId`
   * localmente noto non esiste alcuna chiamata mirata possibile (l'unica
   * alternativa sarebbe una ricerca ampia, esplicitamente vietata dal
   * piano): SEGNALA. Con `rentriTransazioneId` noto, interroga UNA volta lo
   * stato della transazione (`RENTRIApiClient.attendiEsito` con
   * `maxTentativi: 1`, per non trasformare un controllo periodico in un
   * secondo polling bloccante) — passa quindi dal limitatore/dalla
   * resilienza del client come qualunque altra chiamata, nessuna scorciatoia:
   * - esito positivo con `numero_fir` → CORREGGE: `FIR.markRENTRISynced`,
   *   esattamente il metodo che il flusso normale (`SyncFIRToRENTRIUseCase`)
   *   avrebbe chiamato in caso di successo.
   * - qualunque altro esito (ancora in elaborazione, esito negativo, errore
   *   di trasporto) → SEGNALA: la causa è ambigua o richiede la stessa
   *   decisione umana di un fallimento di trasmissione ordinario.
   */
  private async riconciliaSyncingBloccato(
    tenantId: string,
    firId: string,
    correlationId?: string
  ): Promise<EsitoSingolo> {
    const startTime = Date.now()
    const fir = await this.firRepository.findById(firId)
    if (!fir || fir.tenantId !== tenantId) {
      return this.segnalaSenzaLog(firId, 'FIR non trovato durante la riconciliazione')
    }

    if (!fir.rentriTransazioneId) {
      return this.segnala(tenantId, fir.id, {
        requestPayload: { tipo: 'riconciliazione-syncing-bloccato', firId: fir.id },
        errorMessage:
          'FIR SYNCING bloccato senza transazione RENTRI nota: impossibile verificare automaticamente, richiede intervento manuale',
        errorCode: 'RENTRI_RICONCILIAZIONE_SYNCING_SENZA_TRANSAZIONE',
        durationMs: Date.now() - startTime,
      })
    }

    try {
      const esito = await this.rentriApiClient.attendiEsito(tenantId, fir.rentriTransazioneId, {
        maxTentativi: 1,
      })

      if (esito.errore) {
        return this.segnala(tenantId, fir.id, {
          requestPayload: {
            tipo: 'riconciliazione-syncing-bloccato',
            firId: fir.id,
            transazioneId: fir.rentriTransazioneId,
          },
          responsePayload: esito,
          errorMessage:
            'Transazione RENTRI risultata con esito negativo durante la riconciliazione',
          errorCode: 'RENTRI_RICONCILIAZIONE_ESITO_NEGATIVO',
          durationMs: Date.now() - startTime,
        })
      }

      const numeroFir = estraiNumeroFirDaEsito(esito)
      if (!numeroFir) {
        return this.segnala(tenantId, fir.id, {
          requestPayload: {
            tipo: 'riconciliazione-syncing-bloccato',
            firId: fir.id,
            transazioneId: fir.rentriTransazioneId,
          },
          responsePayload: esito,
          errorMessage:
            'Esito RENTRI privo del numero ufficiale: impossibile applicare la correzione automatica',
          errorCode: 'RENTRI_RICONCILIAZIONE_ESITO_SENZA_NUMERO_FIR',
          durationMs: Date.now() - startTime,
        })
      }

      // CORREGGE: riempie un buco (il FIR risultava bloccato localmente ma
      // l'ente aveva già completato l'elaborazione) con lo STESSO metodo di
      // dominio che il flusso normale avrebbe chiamato in caso di successo.
      fir.markRENTRISynced(
        numeroFir,
        fir.rentriTransazioneId,
        correlationId ?? `riconciliazione-${randomUUID()}`
      )
      await this.firRepository.save(fir)
      await this.pubblicaEventi(fir)

      return this.corregge(tenantId, fir.id, numeroFir, {
        requestPayload: {
          tipo: 'riconciliazione-syncing-bloccato',
          firId: fir.id,
          transazioneId: fir.rentriTransazioneId,
        },
        responsePayload: esito,
        nota: "riconciliato: la transazione risultava bloccata localmente ma l'ente aveva già completato l'elaborazione",
        durationMs: Date.now() - startTime,
      })
    } catch (error: unknown) {
      return this.segnala(tenantId, fir.id, {
        requestPayload: {
          tipo: 'riconciliazione-syncing-bloccato',
          firId: fir.id,
          transazioneId: fir.rentriTransazioneId,
        },
        errorMessage: this.messaggioErrore(error),
        errorCode:
          error instanceof RentriApiError && error.status === 404
            ? 'RENTRI_RICONCILIAZIONE_TRANSAZIONE_NON_TROVATA'
            : 'RENTRI_RICONCILIAZIONE_ERRORE_TRASPORTO',
        durationMs: Date.now() - startTime,
      })
    }
  }

  /**
   * FIR SYNCED campionato: legge il dettaglio presso l'ente
   * (`GET /{numero_fir}`, UNA chiamata) e confronta `stato_formulario` con
   * `FIR.rentriStatoFormulario` locale.
   *
   * A differenza del lotto SYNCING, qui il sistema locale ha GIÀ fiducia nel
   * dato (`rentriNumeroFir` valorizzato, legame stabile): ogni divergenza
   * trovata SEGNALA, non corregge mai automaticamente — sovrascrivere un
   * dato di cui ci si fida già, in un processo periodico che non possiede
   * il FIR (a differenza del polling dedicato che segue una trasmissione
   * appena fatta), è esattamente il tipo di auto-fix che il piano vieta.
   * `rentriLastReconciledAt` si aggiorna SEMPRE (con o senza divergenza):
   * è quello che fa avanzare il campionamento verso i FIR mai controllati.
   */
  private async riconciliaSynced(
    tenantId: string,
    firId: string,
    _correlationId?: string
  ): Promise<EsitoSingolo> {
    const startTime = Date.now()
    const fir = await this.firRepository.findById(firId)
    if (!fir || fir.tenantId !== tenantId || !fir.rentriNumeroFir) {
      return this.segnalaSenzaLog(
        firId,
        'FIR non trovato o senza numero RENTRI durante la riconciliazione'
      )
    }

    const numeroFir = fir.rentriNumeroFir

    try {
      const dettaglio = await this.rentriApiClient.leggiFormulario(tenantId, numeroFir)
      await this.aggiornaUltimaVerifica(fir.id)

      const statoRemoto = dettaglio.stato_formulario ?? null
      const statoLocale = fir.rentriStatoFormulario ?? null

      if (statoRemoto === statoLocale) {
        return this.nessunaDivergenza(tenantId, fir.id, numeroFir, {
          requestPayload: { tipo: 'riconciliazione-synced', firId: fir.id, numeroFir },
          responsePayload: dettaglio,
          durationMs: Date.now() - startTime,
        })
      }

      return this.segnala(tenantId, fir.id, {
        requestPayload: { tipo: 'riconciliazione-synced', firId: fir.id, numeroFir },
        responsePayload: dettaglio,
        errorMessage: `Stato del formulario presso l'ente (${statoRemoto ?? 'sconosciuto'}) diverso da quello noto localmente (${statoLocale ?? 'nessuno'}): richiede verifica manuale, nessuna correzione automatica applicata`,
        errorCode: 'RENTRI_RICONCILIAZIONE_DIVERGENZA_STATO',
        durationMs: Date.now() - startTime,
      })
    } catch (error: unknown) {
      await this.aggiornaUltimaVerifica(fir.id)

      const nonTrovato = error instanceof RentriApiError && error.status === 404
      return this.segnala(tenantId, fir.id, {
        requestPayload: { tipo: 'riconciliazione-synced', firId: fir.id, numeroFir },
        errorMessage: nonTrovato
          ? "L'ente non trova più il formulario risultante sincronizzato localmente: richiede verifica manuale"
          : this.messaggioErrore(error),
        errorCode: nonTrovato
          ? 'RENTRI_RICONCILIAZIONE_FORMULARIO_NON_TROVATO'
          : 'RENTRI_RICONCILIAZIONE_ERRORE_TRASPORTO',
        durationMs: Date.now() - startTime,
      })
    }
  }

  /**
   * Proposta di legame IBRIDA in attesa di conferma da oltre 24h. La
   * conferma è, per progetto, un'azione volutamente umana
   * (`FIR.confermaLegameRENTRI`) — questo lotto SEGNALA sempre, non conferma
   * né rifiuta mai da solo, anche quando l'ente conferma l'esistenza del
   * formulario: automatizzare la conferma toglierebbe all'utente esattamente
   * il controllo che la modalità IBRIDA gli garantisce di proposito.
   */
  private async riconciliaIbridaInAttesa(
    tenantId: string,
    firId: string,
    _correlationId?: string
  ): Promise<EsitoSingolo> {
    const startTime = Date.now()
    const fir = await this.firRepository.findById(firId)
    if (!fir || fir.tenantId !== tenantId || !fir.rentriNumeroFirProposto) {
      return this.segnalaSenzaLog(
        firId,
        'FIR non trovato o senza proposta di legame durante la riconciliazione'
      )
    }

    const numeroFirProposto = fir.rentriNumeroFirProposto

    try {
      const dettaglio = await this.rentriApiClient.leggiFormulario(tenantId, numeroFirProposto)
      return this.segnala(tenantId, fir.id, {
        requestPayload: {
          tipo: 'riconciliazione-ibrida-in-attesa',
          firId: fir.id,
          numeroFirProposto,
        },
        responsePayload: dettaglio,
        errorMessage:
          'Proposta di legame RENTRI (modalità IBRIDA) ancora in attesa di conferma da oltre 24 ore: richiede conferma o rifiuto esplicito da parte di un operatore',
        errorCode: 'RENTRI_RICONCILIAZIONE_IBRIDA_ATTESA_PROLUNGATA',
        durationMs: Date.now() - startTime,
      })
    } catch (error: unknown) {
      const nonTrovato = error instanceof RentriApiError && error.status === 404
      return this.segnala(tenantId, fir.id, {
        requestPayload: {
          tipo: 'riconciliazione-ibrida-in-attesa',
          firId: fir.id,
          numeroFirProposto,
        },
        errorMessage: nonTrovato
          ? "L'ente non trova (più) il formulario della proposta di legame in attesa di conferma: richiede verifica manuale"
          : this.messaggioErrore(error),
        errorCode: nonTrovato
          ? 'RENTRI_RICONCILIAZIONE_PROPOSTA_NON_TROVATA'
          : 'RENTRI_RICONCILIAZIONE_ERRORE_TRASPORTO',
        durationMs: Date.now() - startTime,
      })
    }
  }

  // ---------------------------------------------------------------------
  // Bookkeeping: log di sincronizzazione (origine RICONCILIAZIONE) e
  // aggiornamento di `rentriLastReconciledAt`.
  // ---------------------------------------------------------------------

  private async aggiornaUltimaVerifica(firId: string): Promise<void> {
    // Bookkeeping di sola infrastruttura (non un dato di dominio con
    // invarianti proprie): aggiornato direttamente, senza passare
    // dall'aggregate FIR, che non lo espone (v. commento sul campo in
    // schema.prisma). Non è la scrittura che il piano vieta di bypassare —
    // quella riguarda i metodi di dominio (`markRENTRISynced` e affini).
    await this.prisma.fIR.update({
      where: { id: firId },
      data: { rentriLastReconciledAt: new Date() },
    })
  }

  private async corregge(
    tenantId: string,
    firId: string,
    numeroFir: string,
    log: { requestPayload: unknown; responsePayload?: unknown; nota: string; durationMs: number }
  ): Promise<EsitoSingolo> {
    await this.registraLog(tenantId, firId, {
      requestPayload: log.requestPayload,
      esitoLog: 'SUCCESS',
      responsePayload: JSON.stringify({ nota: log.nota, dettaglio: log.responsePayload }),
      protocolNumber: numeroFir,
      durationMs: log.durationMs,
    })

    this.logger.info('Riconciliazione RENTRI: divergenza corretta automaticamente', {
      tenantId,
      firId,
      numeroFir,
      nota: log.nota,
    })

    // R5 Task 5: alimenta l'allarme/dashboard sulle divergenze di
    // riconciliazione (monitoring/alerts/rentri.yml legge questo counter).
    this.metrics.rentriReconciliationDivergences.inc({ tenant_id: tenantId, esito: 'corretto' })

    return { firId, classificazione: 'CORRETTO', dettaglio: log.nota }
  }

  private async nessunaDivergenza(
    tenantId: string,
    firId: string,
    numeroFir: string,
    log: { requestPayload: unknown; responsePayload?: unknown; durationMs: number }
  ): Promise<EsitoSingolo> {
    await this.registraLog(tenantId, firId, {
      requestPayload: log.requestPayload,
      esitoLog: 'SUCCESS',
      responsePayload: JSON.stringify({
        nota: 'nessuna divergenza rilevata',
        dettaglio: log.responsePayload,
      }),
      protocolNumber: numeroFir,
      durationMs: log.durationMs,
    })

    return { firId, classificazione: 'NESSUNA_DIVERGENZA' }
  }

  private async segnala(
    tenantId: string,
    firId: string,
    log: {
      requestPayload: unknown
      responsePayload?: unknown
      errorMessage: string
      errorCode: string
      durationMs: number
    }
  ): Promise<EsitoSingolo> {
    await this.registraLog(tenantId, firId, {
      requestPayload: log.requestPayload,
      esitoLog: 'FAILURE',
      responsePayload: log.responsePayload ? JSON.stringify(log.responsePayload) : undefined,
      errorMessage: log.errorMessage,
      errorCode: log.errorCode,
      durationMs: log.durationMs,
    })

    this.logger.warn(
      'Riconciliazione RENTRI: divergenza segnalata, nessuna correzione automatica',
      {
        tenantId,
        firId,
        errorCode: log.errorCode,
        errorMessage: log.errorMessage,
      }
    )

    // R5 Task 5: v. commento in `corregge`.
    this.metrics.rentriReconciliationDivergences.inc({ tenant_id: tenantId, esito: 'segnalato' })

    return { firId, classificazione: 'SEGNALATO', dettaglio: log.errorMessage }
  }

  /**
   * Fuori dai tre lotti "normali": il FIR e' sparito o e' cambiato stato fra
   * la selezione e la verifica (race con un'altra operazione). Nessuna riga
   * di sync log qui: senza un FIR valido non c'e' `firId` su cui agganciarla
   * (vincolo di RENTRISyncLog, v. `validate()`), quindi resta solo il log
   * applicativo + la segnalazione nel risultato del giro.
   */
  private segnalaSenzaLog(firId: string, messaggio: string): EsitoSingolo {
    this.logger.warn('Riconciliazione RENTRI: candidato non più verificabile', {
      firId,
      messaggio,
    })
    return { firId, classificazione: 'SEGNALATO', dettaglio: messaggio }
  }

  private async registraLog(
    tenantId: string,
    firId: string,
    esito: {
      requestPayload: unknown
      esitoLog: 'SUCCESS' | 'FAILURE'
      responsePayload?: string
      protocolNumber?: string
      errorMessage?: string
      errorCode?: string
      durationMs: number
    }
  ): Promise<void> {
    const pending = await this.syncLogRepository.createPending({
      id: randomUUID(),
      firId,
      tenantId,
      attempt: 1,
      requestPayload: JSON.stringify(esito.requestPayload),
      origine: 'RICONCILIAZIONE',
    })

    const finale =
      esito.esitoLog === 'SUCCESS'
        ? pending.markAsSuccess({
            responsePayload: esito.responsePayload ?? '{}',
            protocolNumber: esito.protocolNumber ?? 'N/A',
            durationMs: esito.durationMs,
          })
        : pending.markAsFailure({
            responsePayload: esito.responsePayload,
            errorMessage: esito.errorMessage ?? 'Divergenza rilevata dalla riconciliazione',
            errorCode: esito.errorCode,
            durationMs: esito.durationMs,
          })

    await this.syncLogRepository.save(finale)
  }

  private async pubblicaEventi(fir: FIR): Promise<void> {
    const events = fir.getDomainEvents()
    for (const event of events) {
      await this.domainEvents.publish(event as unknown as IDomainEvent)
    }
    fir.clearDomainEvents()
  }

  private messaggioErrore(error: unknown): string {
    if (error instanceof RentriApiError) {
      return error.problemDetail ?? error.problemTitle ?? error.message
    }
    return error instanceof Error
      ? error.message
      : 'Errore RENTRI sconosciuto durante la riconciliazione'
  }
}

export type ClassificazioneRiconciliazione = 'CORRETTO' | 'SEGNALATO' | 'NESSUNA_DIVERGENZA'

export interface EsitoSingolo {
  firId: string
  classificazione: ClassificazioneRiconciliazione
  dettaglio?: string
}

export interface RiconciliazioneRisultato {
  tenantId: string
  controllati: number
  corretti: number
  segnalati: number
  nessunaDivergenza: number
  dettagli: EsitoSingolo[]
}
