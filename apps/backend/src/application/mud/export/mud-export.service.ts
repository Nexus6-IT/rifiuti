import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { MUDGeneratorService } from '../mud-generator.service'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { MudVersionRegistry } from './mud-version.registry'
import { MudExportData, MudExportResult } from './mud-export.types'

/**
 * Orchestratore dell'export telematico MUD, **versionato e diviso per anno**.
 *
 * Dato (tenant, anno): seleziona il tracciato della versione corretta (per
 * anno), recupera l'anagrafica del dichiarante e aggrega i dati rifiuti
 * (riusando MUDGeneratorService), poi genera il file conforme.
 */
@Injectable()
export class MudExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mudGenerator: MUDGeneratorService,
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

    const report = await this.mudGenerator.generateMUDReport(tenantId, year)

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
      rifiuti: report.wasteProduced.map((w: any) => ({
        cerCode: w.cerCode,
        quantitaKg: w.totalQuantity,
      })),
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
}
