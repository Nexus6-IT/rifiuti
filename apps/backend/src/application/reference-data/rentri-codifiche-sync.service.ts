import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriCerSyncService } from './rentri-cer-sync.service'
import { RentriCodificheSempliciSyncService } from './rentri-codifiche-semplici-sync.service'
import { RentriTerritorialiSyncService } from './rentri-territoriali-sync.service'
import { attendiMs } from '../../infrastructure/rentri/rentri-http-resilienza'

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
 */
@Injectable()
export class RentriCodificheSyncService {
  private static readonly PAUSA_TRA_PASSI_MS = 250

  constructor(
    private readonly cerSync: RentriCerSyncService,
    private readonly codificheSempliciSync: RentriCodificheSempliciSyncService,
    private readonly territorialiSync: RentriTerritorialiSyncService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriCodificheSyncService.name)
  }

  /** Cron mensile (primo del mese, mezzanotte) — stessa cadenza prudente di `reference-data`/Task 4. */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async allineamentoSchedulato(): Promise<void> {
    await this.allineaTutto()
  }

  /** Eseguibile anche manualmente (senza attendere il cron), stessa logica del ciclo schedulato. */
  async allineaTutto(tenantId?: string): Promise<void> {
    await this.eseguiPasso('CER', () => this.cerSync.allinea(tenantId))
    await attendiMs(RentriCodificheSyncService.PAUSA_TRA_PASSI_MS)

    await this.eseguiPasso(
      'codifiche semplici (unità di misura, stati fisici, caratteristiche di pericolo, attività R/D)',
      () => this.codificheSempliciSync.allinea(tenantId)
    )
    await attendiMs(RentriCodificheSyncService.PAUSA_TRA_PASSI_MS)

    await this.eseguiPasso('territoriali (province, nazioni, comuni)', () =>
      this.territorialiSync.allinea(tenantId)
    )
  }

  private async eseguiPasso<T>(nome: string, passo: () => Promise<T>): Promise<void> {
    try {
      await passo()
      this.logger.info(`Allineamento RENTRI — passo "${nome}" completato.`)
    } catch (e: any) {
      this.logger.warn(`Allineamento RENTRI — passo "${nome}" fallito: ${e.message}`)
    }
  }
}
