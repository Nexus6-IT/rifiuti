import { Injectable, Inject, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import {
  ReferenceDataConfig,
  REFERENCE_DATA_CONFIG,
  DatasetSource,
} from './reference-data.config'
import { parseCsv } from './csv.util'

export type ReferenceDataset = 'ateco' | 'nazioni' | 'province' | 'comuni'

/**
 * Popolamento automatico dei dati di riferimento (ATECO, ISTAT) da CSV
 * ufficiali. Idempotente (upsert). Si attiva:
 *  - all'avvio se le tabelle sono vuote (seedOnBootIfEmpty);
 *  - via cron mensile (refresh);
 *  - su richiesta admin (reseed).
 *
 * Robusto: se una sorgente non è configurata o irraggiungibile, il dataset viene
 * saltato con un log (non blocca l'avvio né gli altri dataset).
 *
 * NB sul formato CSV atteso (colonne, in ordine):
 *  - ateco:    [code, description]
 *  - nazioni:  [code, name, iso3?]
 *  - province: [sigla, code, name, regione]
 *  - comuni:   [code, name, provinciaSigla, codiceCatastale?, cap?]
 * I file ISTAT/ATECO grezzi possono richiedere una normalizzazione a monte in
 * questo ordine (o un adattatore ops). Separatore configurabile per dataset.
 */
@Injectable()
export class ReferenceDataSeederService implements OnModuleInit {
  private readonly CHUNK = 500

  constructor(
    private readonly http: HttpService,
    private readonly prisma: PrismaService,
    @Inject(REFERENCE_DATA_CONFIG) private readonly config: ReferenceDataConfig,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ReferenceDataSeederService.name)
  }

  async onModuleInit(): Promise<void> {
    if (this.config.seedOnBootIfEmpty) {
      // Best-effort: non bloccare l'avvio dell'app.
      this.seedIfEmpty().catch((e) =>
        this.logger.warn(`Seed reference data al boot fallito: ${e.message}`),
      )
    }
  }

  /** Cron mensile di refresh (primo del mese, 03:00). */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async scheduledRefresh(): Promise<void> {
    this.logger.info('Refresh schedulato dei dati di riferimento')
    await this.reseedAll()
  }

  /** Seed dei soli dataset attualmente vuoti. */
  async seedIfEmpty(): Promise<void> {
    const counts = await this.counts()
    if (counts.ateco === 0) await this.safe('ateco', () => this.seedAteco())
    if (counts.nazioni === 0) await this.safe('nazioni', () => this.seedNazioni())
    if (counts.province === 0) await this.safe('province', () => this.seedProvince())
    if (counts.comuni === 0) await this.safe('comuni', () => this.seedComuni())
  }

  /** Reseed di tutti i dataset (o di uno solo). */
  async reseedAll(dataset?: ReferenceDataset): Promise<void> {
    if (!dataset || dataset === 'ateco') await this.safe('ateco', () => this.seedAteco())
    if (!dataset || dataset === 'nazioni') await this.safe('nazioni', () => this.seedNazioni())
    if (!dataset || dataset === 'province') await this.safe('province', () => this.seedProvince())
    if (!dataset || dataset === 'comuni') await this.safe('comuni', () => this.seedComuni())
  }

  async counts() {
    const [ateco, nazioni, province, comuni] = await Promise.all([
      this.prisma.atecoCode.count(),
      this.prisma.istatNazione.count(),
      this.prisma.istatProvincia.count(),
      this.prisma.istatComune.count(),
    ])
    return { ateco, nazioni, province, comuni }
  }

  // --- Seeders per dataset ---

  async seedAteco(): Promise<number> {
    const rows = await this.fetchRows(this.config.ateco)
    return this.upsertChunked(rows, (r) =>
      r[0]
        ? this.prisma.atecoCode.upsert({
            where: { code: r[0] },
            create: { code: r[0], description: r[1] || '' },
            update: { description: r[1] || '' },
          })
        : null,
    )
  }

  async seedNazioni(): Promise<number> {
    const rows = await this.fetchRows(this.config.nazioni)
    return this.upsertChunked(rows, (r) =>
      r[0]
        ? this.prisma.istatNazione.upsert({
            where: { code: r[0] },
            create: { code: r[0], name: r[1] || '', iso3: r[2] || null },
            update: { name: r[1] || '', iso3: r[2] || null },
          })
        : null,
    )
  }

  async seedProvince(): Promise<number> {
    const rows = await this.fetchRows(this.config.province)
    return this.upsertChunked(rows, (r) =>
      r[0]
        ? this.prisma.istatProvincia.upsert({
            where: { sigla: r[0].toUpperCase() },
            create: { sigla: r[0].toUpperCase(), code: r[1] || '', name: r[2] || '', regione: r[3] || '' },
            update: { code: r[1] || '', name: r[2] || '', regione: r[3] || '' },
          })
        : null,
    )
  }

  async seedComuni(): Promise<number> {
    const rows = await this.fetchRows(this.config.comuni)
    return this.upsertChunked(rows, (r) =>
      r[0]
        ? this.prisma.istatComune.upsert({
            where: { code: r[0] },
            create: {
              code: r[0],
              name: r[1] || '',
              provinciaSigla: (r[2] || '').toUpperCase(),
              codiceCatastale: r[3] || null,
              cap: r[4] || null,
            },
            update: {
              name: r[1] || '',
              provinciaSigla: (r[2] || '').toUpperCase(),
              codiceCatastale: r[3] || null,
              cap: r[4] || null,
            },
          })
        : null,
    )
  }

  // --- Helpers ---

  /** Scarica e parsa il CSV di un dataset; [] se non configurato/irraggiungibile. */
  private async fetchRows(source: DatasetSource): Promise<string[][]> {
    if (!source.url) {
      this.logger.warn('Sorgente reference data non configurata: dataset saltato')
      return []
    }
    const response = await firstValueFrom(
      this.http.get(source.url, { responseType: 'text', timeout: 60000 }),
    )
    const rows = parseCsv(String(response.data), source.separator)
    return source.hasHeader ? rows.slice(1) : rows
  }

  /** Upsert a blocchi; ritorna il numero di righe processate. */
  private async upsertChunked(
    rows: string[][],
    op: (row: string[]) => Promise<unknown> | null,
  ): Promise<number> {
    let processed = 0
    for (let i = 0; i < rows.length; i += this.CHUNK) {
      const chunk = rows.slice(i, i + this.CHUNK)
      const ops = chunk.map(op).filter((p): p is Promise<unknown> => p !== null)
      await Promise.all(ops)
      processed += ops.length
    }
    return processed
  }

  /** Esegue un seed isolando gli errori per dataset. */
  private async safe(name: string, fn: () => Promise<number>): Promise<void> {
    try {
      const n = await fn()
      this.logger.info(`Reference data '${name}': ${n} righe popolate`)
    } catch (e: any) {
      this.logger.error(`Seed reference data '${name}' fallito: ${e.message}`)
    }
  }
}
