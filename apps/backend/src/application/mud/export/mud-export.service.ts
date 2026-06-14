import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { MudVersionRegistry } from './mud-version.registry'
import { MudExportData, MudExportResult, MudRifiutoLine } from './mud-export.types'

/**
 * Orchestratore dell'export telematico MUD, **versionato e diviso per anno**.
 *
 * Dato (tenant, anno): seleziona il tracciato della versione corretta (per
 * anno), recupera l'anagrafica del dichiarante e aggrega i dati rifiuti
 * (prodotto + recupero/smaltimento per CER), poi genera il file conforme.
 */
@Injectable()
export class MudExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MudVersionRegistry,
    private readonly referenceData: ReferenceDataService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MudExportService.name)
  }

  /** Anni supportati (con versione tracciato). */
  supportedVersions() {
    return this.registry.listVersions()
  }

  /** Genera il file MUD telematico per il tenant e l'anno indicati. */
  async exportTelematico(tenantId: string, year: number): Promise<MudExportResult> {
    // Seleziona la versione per anno (lancia se anno non supportato).
    const tracciato = this.registry.getForYear(year)

    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant) {
      throw new NotFoundException('Tenant non trovato')
    }

    // Risolve il codice ISTAT del comune dalle tabelle di riferimento condivise.
    const comune = await this.referenceData.findComuneByName(tenant.city, tenant.province)

    const data: MudExportData = {
      year,
      azienda: {
        ragioneSociale: tenant.ragioneSociale,
        partitaIva: tenant.partitaIva,
        via: tenant.address,
        comune: tenant.city,
        comuneCode: comune?.code,
        provincia: tenant.province,
        cap: tenant.postalCode,
        pec: tenant.pec ?? undefined,
        atecoCode: tenant.atecoCode ?? undefined,
      },
      rifiuti: await this.aggregaRifiuti(tenantId, year),
    }

    const content = tracciato.generate(data)
    this.logger.info(
      `MUD export generato: tenant ${tenantId}, anno ${year}, versione ${tracciato.version}, ${data.rifiuti.length} righe`,
    )

    return {
      filename: `MUD_${year}_${tenant.partitaIva}.txt`,
      content,
      version: tracciato.version,
      year,
    }
  }

  /**
   * Aggrega i rifiuti del tenant per l'anno: per ogni CER calcola la quantità
   * prodotta (= recupero + smaltimento) e le quote avviate a recupero/
   * smaltimento, dai FIR del periodo (campo wasteOperationType).
   */
  private async aggregaRifiuti(tenantId: string, year: number): Promise<MudRifiutoLine[]> {
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31, 23, 59, 59)

    const groups = await this.prisma.fIR.groupBy({
      by: ['cerCode', 'wasteOperationType'],
      where: { tenantId, createdAt: { gte: start, lte: end } },
      _sum: { quantity: true },
    })

    const perCer = new Map<string, { recuperoKg: number; smaltimentoKg: number }>()
    for (const g of groups) {
      const qty = g._sum.quantity ? Number(g._sum.quantity) : 0
      const e = perCer.get(g.cerCode) ?? { recuperoKg: 0, smaltimentoKg: 0 }
      if (g.wasteOperationType === 'RECOVERY') e.recuperoKg += qty
      else if (g.wasteOperationType === 'DISPOSAL') e.smaltimentoKg += qty
      perCer.set(g.cerCode, e)
    }

    return Array.from(perCer.entries()).map(([cerCode, v]) => ({
      cerCode,
      prodottoKg: v.recuperoKg + v.smaltimentoKg,
      recuperoKg: v.recuperoKg,
      smaltimentoKg: v.smaltimentoKg,
    }))
  }
}
