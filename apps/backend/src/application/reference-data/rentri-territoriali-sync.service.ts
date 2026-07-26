import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { RentriCodificheClient } from '../../infrastructure/rentri/codifiche/rentri-codifiche.client'
import { CodificaItem } from '../../infrastructure/rentri/codifiche/rentri-codifiche.model'
import { RentriTerritorialeRepository } from '../../infrastructure/persistence/rentri-territoriale.repository'
import { attendiMs } from '../../infrastructure/rentri/rentri-http-resilienza'

export interface EsitoAllineamentoTerritoriale {
  tabella: 'province' | 'nazioni' | 'comuni'
  nuovi: number
  aggiornati: number
  rimossi: number
}

/**
 * Allinea le 3 cache territoriali RENTRI (R4 Task 5): `RentriProvincia`,
 * `RentriNazione`, `RentriComune`. Distinte da `IstatProvincia`/
 * `IstatComune`/`IstatNazione` (v. commento di testata dei model in
 * `schema.prisma` per il perché) — questo servizio è l'unico che scrive
 * sulle tabelle `Rentri*`, mai su `Istat*`.
 *
 * Stessa politica "mai cancellare, solo marcare" di `RentriCerSyncService`
 * (Task 4): un indirizzo (`Produttore`/`Trasportatore`/`Destinatario`) che
 * referenzia un comune poi soppresso resta storicamente coerente.
 *
 * **Sequenza fissa province → nazioni → comuni, con pausa tra una tabella e
 * l'altra**: comuni è il catalogo più grande (migliaia di righe contro
 * poche centinaia per l'ente), messo per ultimo per non ritardare
 * l'allineamento delle tabelle più piccole in caso di errore a metà ciclo.
 */
@Injectable()
export class RentriTerritorialiSyncService {
  private static readonly PAUSA_TRA_TABELLE_MS = 250

  constructor(
    private readonly client: RentriCodificheClient,
    private readonly repository: RentriTerritorialeRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriTerritorialiSyncService.name)
  }

  /** Nessun cron proprio: schedulato dall'orchestratore unico, `RentriCodificheSyncService`. */
  async allinea(tenantId?: string): Promise<EsitoAllineamentoTerritoriale[]> {
    const esitoProvince = await this.allineaProvince(tenantId)
    await attendiMs(RentriTerritorialiSyncService.PAUSA_TRA_TABELLE_MS)

    const esitoNazioni = await this.allineaNazioni(tenantId)
    await attendiMs(RentriTerritorialiSyncService.PAUSA_TRA_TABELLE_MS)

    const esitoComuni = await this.allineaComuni(tenantId)

    return [esitoProvince, esitoNazioni, esitoComuni]
  }

  private async allineaProvince(tenantId?: string): Promise<EsitoAllineamentoTerritoriale> {
    const voci = await this.client.leggiTabella('province', tenantId)

    const confermate = new Map<
      string,
      { code: string; name: string; regioneId: string; attivo: boolean; fineValidita: Date | null }
    >()
    for (const voce of voci) {
      const id = this.idStringa(voce)
      if (!id) continue
      confermate.set(id, {
        code: voce.code ?? '',
        name: voce.name ?? '',
        regioneId: this.stringaProperty(voce, 'regione-id') ?? '',
        attivo: this.booleanProperty(voce, 'attivo') ?? true,
        fineValidita: this.dataProperty(voce, 'fine-validita'),
      })
    }

    let nuovi = 0
    let aggiornati = 0
    for (const [id, dati] of confermate) {
      const esistente = await this.repository.findProvincia(id)
      await this.repository.upsertProvincia({ id, ...dati })
      esistente ? aggiornati++ : nuovi++
    }

    let rimossi = 0
    const ora = new Date()
    for (const id of await this.repository.listTuttiGliIdProvincia()) {
      if (confermate.has(id)) continue
      if (await this.repository.marcaProvinciaRimossaSeAttiva(id, ora)) rimossi++
    }

    this.logga('province', nuovi, aggiornati, rimossi)
    return { tabella: 'province', nuovi, aggiornati, rimossi }
  }

  private async allineaNazioni(tenantId?: string): Promise<EsitoAllineamentoTerritoriale> {
    const voci = await this.client.leggiTabella('nazioni', tenantId)

    const confermate = new Map<string, { code: string; name: string }>()
    for (const voce of voci) {
      const id = this.idStringa(voce)
      if (!id) continue
      confermate.set(id, { code: voce.code ?? '', name: voce.name ?? '' })
    }

    let nuovi = 0
    let aggiornati = 0
    for (const [id, dati] of confermate) {
      const esistente = await this.repository.findNazione(id)
      await this.repository.upsertNazione({ id, ...dati })
      esistente ? aggiornati++ : nuovi++
    }

    let rimossi = 0
    const ora = new Date()
    for (const id of await this.repository.listTuttiGliIdNazione()) {
      if (confermate.has(id)) continue
      if (await this.repository.marcaNazioneRimossaSeAttiva(id, ora)) rimossi++
    }

    this.logga('nazioni', nuovi, aggiornati, rimossi)
    return { tabella: 'nazioni', nuovi, aggiornati, rimossi }
  }

  private async allineaComuni(tenantId?: string): Promise<EsitoAllineamentoTerritoriale> {
    const voci = await this.client.comuni(tenantId)

    const confermati = new Map<
      string,
      {
        code: string
        name: string
        provinciaId: string
        cciaa: string
        attivo: boolean
        nuovoId: string | null
        fineValidita: Date | null
      }
    >()
    for (const voce of voci) {
      const id = this.idStringa(voce)
      if (!id) continue
      confermati.set(id, {
        code: voce.code ?? '',
        name: voce.name ?? '',
        // Il contratto non espone un id di provincia nelle `properties` di
        // `/lookup/comuni` (solo cciaa/lat/long/attivo/nuovo-id/fine-validita
        // — v. docs/contracts/rentri/codifiche.yaml). Derivato dal codice
        // ISTAT del comune stesso: convenzione reale ISTAT, i primi 3
        // caratteri del codice comune coincidono col codice ISTAT della
        // provincia (verificato sulla fixture dell'oracolo: "015146" Milano
        // → provincia "015" Milano, "048033" San Piero a Sieve → provincia
        // "048" Firenze).
        provinciaId: id.slice(0, 3),
        cciaa: this.stringaProperty(voce, 'cciaa') ?? '',
        attivo: this.booleanProperty(voce, 'attivo') ?? true,
        nuovoId: this.stringaProperty(voce, 'nuovo-id'),
        fineValidita: this.dataProperty(voce, 'fine-validita'),
      })
    }

    let nuovi = 0
    let aggiornati = 0
    for (const [id, dati] of confermati) {
      const esistente = await this.repository.findComune(id)
      await this.repository.upsertComune({ id, ...dati })
      esistente ? aggiornati++ : nuovi++
    }

    let rimossi = 0
    const ora = new Date()
    for (const id of await this.repository.listTuttiGliIdComune()) {
      if (confermati.has(id)) continue
      if (await this.repository.marcaComuneRimossoSeAttivo(id, ora)) rimossi++
    }

    this.logga('comuni', nuovi, aggiornati, rimossi)
    return { tabella: 'comuni', nuovi, aggiornati, rimossi }
  }

  private idStringa(voce: CodificaItem): string | null {
    if (voce.id === null || voce.id === undefined) return null
    return String(voce.id)
  }

  private stringaProperty(voce: CodificaItem, chiave: string): string | null {
    const valore = voce.properties?.[chiave]
    return typeof valore === 'string' ? valore : null
  }

  private booleanProperty(voce: CodificaItem, chiave: string): boolean | null {
    const valore = voce.properties?.[chiave]
    return typeof valore === 'boolean' ? valore : null
  }

  private dataProperty(voce: CodificaItem, chiave: string): Date | null {
    const valore = voce.properties?.[chiave]
    if (typeof valore !== 'string') return null
    const data = new Date(valore)
    return Number.isNaN(data.getTime()) ? null : data
  }

  private logga(tabella: string, nuovi: number, aggiornati: number, rimossi: number): void {
    this.logger.info(
      `Allineamento territoriale "${tabella}" completato: ${nuovi} nuovi, ${aggiornati} aggiornati, ${rimossi} non più confermati (marcati, MAI cancellati)`
    )
  }
}
