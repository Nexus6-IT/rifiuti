import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriCodificheClient } from '../../infrastructure/rentri/codifiche/rentri-codifiche.client'
import { RentriCodificaSempliceRepository } from '../../infrastructure/persistence/rentri-codifica-semplice.repository'
import { attendiMs } from '../../infrastructure/rentri/rentri-http-resilienza'

/**
 * Le 4 tabelle "allinea ora" della famiglia di tabelle RENTRI "semplici"
 * (nessun filtro, `{ id, code, name }`, nessuna logica di dominio propria
 * — a differenza del CER, che ha `CERCatalogService`/`CreateFIRUseCase`).
 * V. l'audit per la motivazione campo-per-campo:
 * `docs/audits/rentri-codifiche-campi-2026-07-26.md`.
 */
export const TABELLE_CODIFICHE_SEMPLICI_ALLINEA_ORA = [
  'unita-misura',
  'stati-fisici',
  'caratteristiche-pericolo',
  'attivita-rs',
] as const

export type TabellaCodificaSempliceAllineaOra =
  (typeof TABELLE_CODIFICHE_SEMPLICI_ALLINEA_ORA)[number]

export interface EsitoAllineamentoTabella {
  tabella: string
  nuovi: number
  aggiornati: number
  rimossi: number
}

/**
 * Allinea la cache generica `RentriCodificaSemplice` (R4 Task 5) con le 4
 * tabelle RENTRI corrispondenti a campi oggi liberi/hardcoded nel dominio
 * FIR/WasteMovement/Contract: `unita-misura`, `stati-fisici`,
 * `caratteristiche-pericolo`, `attivita-rs`.
 *
 * Stessa politica di `RentriCerSyncService` (Task 4): mai cancellare una
 * riga, solo marcarla (`presenteInRentri=false`, `rimossoDaRentriAl`
 * valorizzato) quando l'ente smette di confermarla — un movimento/FIR
 * storico che referenzia il valore come stringa libera resta leggibile.
 *
 * **Sequenza, non parallelo, con pausa tra una tabella e l'altra** — stessa
 * postura prudente di `RentriCodificheClient.scaricaTutte` e del piano R4
 * Task 4 Step 5: per 4 tabelle che cambiano a mesi di distanza non c'è
 * motivo di fare burst, nemmeno restando ben sotto la soglia nominale.
 */
@Injectable()
export class RentriCodificheSempliciSyncService {
  constructor(
    private readonly client: RentriCodificheClient,
    private readonly repository: RentriCodificaSempliceRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriCodificheSempliciSyncService.name)
  }

  /** Nessun cron proprio: schedulato dall'orchestratore unico, `RentriCodificheSyncService`. */
  async allinea(tenantId?: string): Promise<EsitoAllineamentoTabella[]> {
    const esiti: EsitoAllineamentoTabella[] = []

    for (const tabella of TABELLE_CODIFICHE_SEMPLICI_ALLINEA_ORA) {
      esiti.push(await this.allineaTabella(tabella, tenantId))
      if (tabella !== TABELLE_CODIFICHE_SEMPLICI_ALLINEA_ORA.at(-1)) {
        await attendiMs(RentriCodificheSempliciSyncService.PAUSA_TRA_TABELLE_MS)
      }
    }

    return esiti
  }

  private static readonly PAUSA_TRA_TABELLE_MS = 250

  private async allineaTabella(
    tabella: TabellaCodificaSempliceAllineaOra,
    tenantId?: string
  ): Promise<EsitoAllineamentoTabella> {
    const voci = await this.client.leggiTabella(tabella, tenantId)

    const confermati = new Map<string, { externalId: string; name: string }>()
    for (const voce of voci) {
      if (!voce.code) continue
      confermati.set(voce.code, { externalId: String(voce.id), name: voce.name ?? voce.code })
    }

    let nuovi = 0
    let aggiornati = 0
    for (const [code, dati] of confermati) {
      const esistente = await this.repository.findByTabellaECode(tabella, code)
      await this.repository.upsertFromRentri({ tabella, code, ...dati })
      if (esistente) {
        aggiornati++
      } else {
        nuovi++
      }
    }

    let rimossi = 0
    const ora = new Date()
    const tuttiICodici = await this.repository.listTuttiICodici(tabella)
    for (const code of tuttiICodici) {
      if (confermati.has(code)) continue
      const marcatoOra = await this.repository.marcaRimossoSeAttivo(tabella, code, ora)
      if (marcatoOra) rimossi++
    }

    this.logger.info(
      `Allineamento tabella "${tabella}" completato: ${nuovi} nuovi, ${aggiornati} aggiornati, ${rimossi} non più confermati (marcati, MAI cancellati)`
    )

    return { tabella, nuovi, aggiornati, rimossi }
  }
}
