import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriModalitaLegameService } from '../../infrastructure/rentri/rentri-modalita-legame.service'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { FirAnnullatoNelFrattempoError } from '../../core/domain/errors'
import { CODICE_CERTIFICATO_MANCANTE, MESSAGGIO_CERTIFICATO_MANCANTE } from '../../infrastructure/rentri/rentri-credential.resolver'

/**
 * Trasmetti FIR Secondo Modalità — Use Case
 *
 * Punto di aggancio tra il ciclo di vita del FIR e la trasmissione a RENTRI
 * (R1 Task 2): decide SE avviare una trasmissione automatica all'emissione,
 * secondo la modalità scelta dal tenant (`Tenant.rentriModalitaLegame`,
 * R1 Task 1), e se sì la accoda.
 *
 * Perché l'aggancio è un'invocazione diretta da `EmettiFIRUseCase`, non un
 * handler di eventi di dominio: l'aggregate del ciclo di vita FIR emette
 * eventi che implementano `DomainEvent` (`{occurredOn, eventName}`, v.
 * `core/domain/aggregate-root.ts`), mentre `DomainEventsService`/
 * `IDomainEventHandler` parlano un'altra interfaccia, `IDomainEvent`
 * (`{eventId, aggregateId, eventType, tenantId, payload}`, v.
 * `domain/shared/domain-event.interface.ts`) — due famiglie mai riconciliate
 * (il residuo noto di R0: `FIRConsegnatoHandler` era cablato in DI ma non
 * riceveva mai l'evento `FIRConsegnatoEvent` reale). Riconciliare le due
 * famiglie di eventi avrebbe richiesto introdurre un adattatore generale e
 * toccare ogni evento/handler esistente nel progetto, un rischio sproporzionato
 * rispetto a questo task. L'invocazione diretta è inoltre l'unico modo di
 * rispettare il vincolo fail-closed del Task 2: la decisione "si può
 * trasmettere?" (modalità + certificato) va presa PRIMA di mettere qualunque
 * cosa in coda, non dentro un handler event-driven che scatterebbe comunque
 * dopo il fatto. Per coerenza, `FIRConsegnatoHandler` (il pezzo non
 * funzionante) è stato rimosso: era anche modalità-agnostico — se mai fosse
 * scattato, avrebbe messo in coda una sincronizzazione a prescindere dalla
 * modalità del tenant, violando la regola "in MANUALE nulla parte da solo".
 *
 * La trasmissione vera e propria resta ACCODATA (BullMQ, stessa infrastruttura
 * usata dal trigger manuale — v. `RENTRISyncController.syncFIR`), non
 * eseguita in linea: l'emissione del FIR non deve attendere il polling
 * dell'esito RENTRI (che può richiedere secondi) per completarsi, e "il
 * numero ufficiale compare quando arriva" (v. piano R1) implica per
 * definizione un esito asincrono rispetto alla risposta di emissione.
 */
@Injectable()
export class TrasmettiFIRSecondoModalitaUseCase {
  constructor(
    private readonly modalitaLegameService: RentriModalitaLegameService,
    private readonly rentriSyncQueue: RENTRISyncQueue,
    private readonly firRepository: IFIRRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('TrasmettiFIRSecondoModalitaUseCase')
  }

  /**
   * Da chiamare subito dopo l'emissione riuscita di un FIR (transizione a
   * EMESSO, già persistita). Non lancia mai eccezioni per condizioni attese
   * (modalità MANUALE, certificato mancante): l'emissione del FIR resta
   * valida indipendentemente dall'esito di questa orchestrazione.
   */
  async eseguiSeAutomatica(params: {
    firId: string
    tenantId: string
    correlationId?: string
  }): Promise<EsitoOrchestrazioneRENTRI> {
    const { firId, tenantId, correlationId } = params

    const { modalitaLegame, certificatoConfigurato } =
      await this.modalitaLegameService.getForTenant(tenantId)

    if (modalitaLegame === 'MANUALE') {
      this.logger.debug("Modalità MANUALE: nessuna trasmissione automatica all'emissione", {
        firId,
        tenantId,
      })
      return { avviata: false, motivo: 'MANUALE' }
    }

    if (!certificatoConfigurato) {
      // Fail-closed. `RentriModalitaLegameService.setForTenant` impedisce già
      // di IMPOSTARE automatica/ibrida senza un certificato configurato, ma
      // un certificato può essere rimosso DOPO che la modalità è stata
      // scelta (nessun vincolo referenziale lo impedisce): va ricontrollato
      // qui, ad ogni trasmissione, non solo al cambio modalità. Partire
      // comunque produrrebbe una richiesta che RENTRI rifiuterebbe subito —
      // e insistere con richieste non valide rischia il ban (423) del
      // chiamante, quindi meglio non accodare nulla che accodare un
      // fallimento certo.
      this.logger.warn(
        'Trasmissione RENTRI automatica non avviata: nessun certificato RENTRI configurato per il tenant',
        { firId, tenantId, modalitaLegame }
      )
      // Senza job nessuno produrrebbe l'esito: il FIR resterebbe PENDING in silenzio. Gli si dà
      // quello definitivo della trasmissione (PERMANENTLY_FAILED + codice), cosi' l'utente vede
      // «Vai al certificato» e il caricamento del certificato lo riapre e lo riaccoda da solo.
      const esitoRegistrato = await this.registraCertificatoMancante(firId, tenantId)
      return { avviata: false, motivo: 'CERTIFICATO_MANCANTE', esitoRegistrato }
    }

    const richiedeConferma = modalitaLegame === 'IBRIDA'

    const jobId = await this.rentriSyncQueue.addSyncJob({
      firId,
      tenantId,
      correlationId,
      priority: 'normal',
      richiedeConferma,
    })

    this.logger.info("Trasmissione RENTRI avviata automaticamente all'emissione del FIR", {
      firId,
      tenantId,
      modalitaLegame,
      jobId,
      richiedeConferma,
    })

    return { avviata: true, richiedeConferma, jobId }
  }

  /**
   * Segna il FIR come fallito in modo permanente per certificato mancante. Non lancia mai:
   * l'emissione e' gia' valida, un errore qui si logga (senza dati sensibili) e si segnala
   * con `false`. Un FIR annullato nel frattempo non e' un errore.
   */
  private async registraCertificatoMancante(firId: string, tenantId: string): Promise<boolean> {
    try {
      const fir = await this.firRepository.findById(firId)
      if (!fir) {
        this.logger.error('Esito "certificato mancante" non registrato: FIR non trovato', undefined, {
          firId,
          tenantId,
        })
        return false
      }
      fir.markRENTRISyncFailed(MESSAGGIO_CERTIFICATO_MANCANTE, CODICE_CERTIFICATO_MANCANTE)
      await this.firRepository.save(fir)
      return true
    } catch (error) {
      if (error instanceof FirAnnullatoNelFrattempoError) {
        this.logger.info('FIR annullato nel frattempo: esito "certificato mancante" non registrato', {
          firId,
          tenantId,
        })
        return false
      }
      this.logger.error(
        'Esito "certificato mancante" non registrato: salvataggio del FIR non riuscito',
        error as Error,
        { firId, tenantId }
      )
      return false
    }
  }
}

export interface EsitoOrchestrazioneRENTRI {
  /** Se una trasmissione è stata effettivamente accodata. */
  avviata: boolean
  /** Perché NON è partita nulla, quando avviata è false. */
  motivo?: 'MANUALE' | 'CERTIFICATO_MANCANTE'
  /** true se, a trasmissione riuscita, il legame richiederà conferma esplicita (modalità IBRIDA). */
  richiedeConferma?: boolean
  /** Identificativo del job accodato, quando avviata è true. */
  jobId?: string
  /** Con motivo CERTIFICATO_MANCANTE: true se l'esito definitivo e' stato salvato sul FIR, false se il salvataggio non e' riuscito. */
  esitoRegistrato?: boolean
}
