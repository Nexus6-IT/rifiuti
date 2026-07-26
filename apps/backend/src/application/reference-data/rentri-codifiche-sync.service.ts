import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriCerSyncService, EsitoAllineamentoCer } from './rentri-cer-sync.service'
import {
  RentriCodificheSempliciSyncService,
  EsitoAllineamentoTabella,
} from './rentri-codifiche-semplici-sync.service'
import {
  RentriTerritorialiSyncService,
  EsitoAllineamentoTerritoriale,
} from './rentri-territoriali-sync.service'
import { attendiMs } from '../../infrastructure/rentri/rentri-http-resilienza'

/**
 * Esito dell'ultimo ciclo di allineamento completato (R4 Task 7): stato in
 * memoria dell'istanza, NON persistito — stessa scelta architetturale del
 * lock `inCorso` (v. commento di classe): un singleton per processo Node è
 * già l'assunzione di base di tutto il sottosistema RENTRI. Si azzera al
 * riavvio del processo: la sezione «Codifiche» dell'area RENTRI (Task 7
 * Step 2) lo tratta come "nessun dato disponibile in questo processo", non
 * come "mai allineato" — la UI mostra un messaggio distinto nei due casi.
 */
export interface UltimoEsitoAllineamentoCodifiche {
  quando: Date
  cer: EsitoAllineamentoCer | null
  codificheSemplici: EsitoAllineamentoTabella[] | null
  territoriali: EsitoAllineamentoTerritoriale[] | null
}

/** Sollevato quando un allineamento è già in corso (lock in memoria, v. commento di classe). */
export class AllineamentoRentriGiaInCorsoError extends Error {
  constructor() {
    super(
      'Un allineamento delle codifiche RENTRI è già in corso (schedulato o avviato da un altro amministratore): riprova tra qualche minuto.'
    )
    this.name = 'AllineamentoRentriGiaInCorsoError'
  }
}

/**
 * Orchestratore UNICO di tutta la sincronizzazione delle codifiche RENTRI
 * "allinea ora" (R4 Task 5, Step 4) — v. l'audit
 * `docs/audits/rentri-codifiche-campi-2026-07-26.md` per l'elenco completo
 * delle tabelle incluse/escluse e il perché.
 *
 * Chiama in SEQUENZA — mai in parallelo — i tre sotto-servizi già
 * responsabili ciascuno della propria tabella/famiglia di tabelle:
 * 1. `RentriCerSyncService.allinea()` (CER, riusato dal Task 4, invariato);
 * 2. `RentriCodificheSempliciSyncService.allinea()` (unità di misura, stati
 *    fisici, caratteristiche di pericolo, attività R/D);
 * 3. `RentriTerritorialiSyncService.allinea()` (province, nazioni, comuni).
 *
 * Con una pausa breve tra un passo e l'altro: anche restando ben sotto la
 * soglia nota di RENTRI (100 richieste/5s), un burst non è mai giustificato
 * per dati che cambiano a mesi di distanza — stessa postura prudente di
 * `RentriCodificheClient.scaricaTutte` (§7 rischi del design, «un'
 * automazione mal tarata non rallenta, viene bandita»). Ogni sotto-servizio
 * applica già la propria pausa TRA le tabelle che gli competono: qui la
 * pausa è tra un sotto-servizio e il successivo, non tra ogni singola `GET`
 * — un livello di granularità in più non comprerebbe margine di sicurezza
 * aggiuntivo (il throughput resta comunque concorrenza 1, mai un ventaglio
 * parallelo) a fronte di un ciclo mensile più lungo senza motivo.
 *
 * **Unico proprietario del cron mensile**: `RentriCerSyncService` non ha più
 * un proprio `@Cron` (v. il suo commento di testata) proprio per evitare due
 * allineamenti CER indipendenti nello stesso mese. Un fallimento in un passo
 * non blocca gli altri: ogni passo è avvolto nel proprio try/catch, loggato
 * e il ciclo prosegue — un guasto transitorio su `comuni` non deve impedire
 * l'allineamento (già scaricato) di CER o delle tabelle semplici.
 *
 * **Lock di concorrenza (R4 Task 6, in memoria).** Il servizio Nest è un
 * singleton per processo (provider di default): un semplice booleano
 * sull'istanza basta a impedire che due giri (il cron mensile e una
 * chiamata manuale dall'endpoint admin, o due chiamate manuali sovrapposte)
 * partano in parallelo verso RENTRI. Non serve un lock distribuito
 * (Redis): l'intero sottosistema RENTRI di questo progetto (cron,
 * credenziali, rate limiting) assume già un singolo processo Node per
 * l'app, e introdurre una dipendenza nuova per un'operazione
 * mensile/amministrativa sarebbe sproporzionato. Due giri paralleli
 * sarebbero esattamente il rischio per cui l'ente RENTRI banderebbe (423)
 * il chiamante — v. {@link AllineamentoRentriGiaInCorsoError}.
 */
@Injectable()
export class RentriCodificheSyncService {
  private static readonly PAUSA_TRA_PASSI_MS = 250

  private inCorso = false
  private ultimoEsito: UltimoEsitoAllineamentoCodifiche | null = null

  constructor(
    private readonly cerSync: RentriCerSyncService,
    private readonly codificheSempliciSync: RentriCodificheSempliciSyncService,
    private readonly territorialiSync: RentriTerritorialiSyncService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriCodificheSyncService.name)
  }

  /**
   * Cron mensile (primo del mese, mezzanotte) — stessa cadenza prudente di
   * `reference-data`/Task 4. Se un allineamento è già in corso (lock in
   * memoria: un'altra esecuzione del cron ancora in volo, o una chiamata
   * manuale dall'endpoint admin), il ciclo schedulato viene saltato con un
   * warning: uno scheduler NestJS che lancia un'eccezione non gestita non
   * deve mai propagare.
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async allineamentoSchedulato(): Promise<void> {
    try {
      await this.allineaTutto()
    } catch (e) {
      if (e instanceof AllineamentoRentriGiaInCorsoError) {
        this.logger.warn(
          'Ciclo schedulato di allineamento codifiche RENTRI saltato: un allineamento è già in corso.'
        )
        return
      }
      throw e
    }
  }

  /**
   * Eseguibile anche manualmente (senza attendere il cron), stessa logica
   * del ciclo schedulato. Protetto dal lock in memoria: se un altro giro è
   * già in corso, rigetta immediatamente con
   * {@link AllineamentoRentriGiaInCorsoError} senza contattare RENTRI.
   */
  async allineaTutto(tenantId?: string): Promise<void> {
    if (this.inCorso) {
      throw new AllineamentoRentriGiaInCorsoError()
    }
    this.inCorso = true
    try {
      const cer = await this.eseguiPasso('CER', () => this.cerSync.allinea(tenantId))
      await attendiMs(RentriCodificheSyncService.PAUSA_TRA_PASSI_MS)

      const codificheSemplici = await this.eseguiPasso(
        'codifiche semplici (unità di misura, stati fisici, caratteristiche di pericolo, attività R/D)',
        () => this.codificheSempliciSync.allinea(tenantId)
      )
      await attendiMs(RentriCodificheSyncService.PAUSA_TRA_PASSI_MS)

      const territoriali = await this.eseguiPasso('territoriali (province, nazioni, comuni)', () =>
        this.territorialiSync.allinea(tenantId)
      )

      // Registrato SOLO a ciclo concluso (anche se uno o più passi sono
      // falliti: eseguiPasso ritorna null in quel caso, v. sotto), mai a metà
      // — così la diagnostica (Task 7) non mostra un giro parziale come se
      // fosse completo.
      this.ultimoEsito = { quando: new Date(), cer, codificheSemplici, territoriali }
    } finally {
      this.inCorso = false
    }
  }

  /**
   * Esito dell'ultimo ciclo concluso in QUESTO processo, per la diagnostica
   * di sola lettura dell'area RENTRI (Task 7 Step 2). `null` se nessun ciclo
   * è ancora terminato da quando il processo è partito (non vuol dire "mai
   * allineato": il cron può aver girato prima di un riavvio).
   */
  ottieniUltimoEsito(): UltimoEsitoAllineamentoCodifiche | null {
    return this.ultimoEsito
  }

  private async eseguiPasso<T>(nome: string, passo: () => Promise<T>): Promise<T | null> {
    try {
      const risultato = await passo()
      this.logger.info(`Allineamento RENTRI — passo "${nome}" completato.`)
      return risultato
    } catch (e: any) {
      this.logger.warn(`Allineamento RENTRI — passo "${nome}" fallito: ${e.message}`)
      return null
    }
  }
}
