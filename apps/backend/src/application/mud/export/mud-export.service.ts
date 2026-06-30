import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/database/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { ReferenceDataService } from '../../reference-data/reference-data.service'
import { MudVersionRegistry } from './mud-version.registry'
import {
  MudExportData,
  MudExportResult,
  MudRifiutoLine,
  MudAllegatoDR,
  MudAllegatoTE,
} from './mud-export.types'

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
    private readonly logger: LoggerService
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
    // city/province potrebbero essere null per tenant creati via signup self-service
    // (WS-G): in quel caso il comune non viene risolto (undefined).
    const comune =
      tenant.city && tenant.province
        ? await this.referenceData.findComuneByName(tenant.city, tenant.province)
        : undefined

    const data: MudExportData = {
      year,
      azienda: {
        ragioneSociale: tenant.ragioneSociale,
        partitaIva: tenant.partitaIva,
        codiceFiscale: tenant.codiceFiscale ?? undefined,
        via: tenant.address ?? undefined,
        civico: tenant.civico ?? undefined,
        comune: tenant.city ?? undefined,
        comuneCode: comune?.code,
        provincia: tenant.province ?? undefined,
        cap: tenant.postalCode ?? undefined,
        pec: tenant.pec ?? undefined,
        telefono: tenant.telefono ?? undefined,
        atecoCode: tenant.atecoCode ?? undefined,
        reaNumber: tenant.reaNumber ?? undefined,
        numeroAddetti: tenant.numeroAddetti ?? undefined,
        legaleRappresentanteNome: tenant.legaleRappresentanteNome ?? undefined,
        legaleRappresentanteCognome: tenant.legaleRappresentanteCognome ?? undefined,
      },
      rifiuti: await this.aggregaRifiuti(tenantId, year),
    }

    const content = tracciato.generate(data)
    this.logger.info(
      `MUD export generato: tenant ${tenantId}, anno ${year}, versione ${tracciato.version}, ${data.rifiuti.length} righe`
    )

    return {
      filename: `MUD_${year}_${tenant.partitaIva}.txt`,
      content,
      version: tracciato.version,
      year,
    }
  }

  /**
   * Aggrega i rifiuti del tenant per l'anno dai FIR del periodo: per ogni CER
   * calcola prodotto/recupero/smaltimento e costruisce i moduli BB allegati:
   *  - DR (conferiti a terzi): per destinatario, con anagrafica + codice ISTAT;
   *  - TE (trasportatori): per trasportatore (solo CF + ragione sociale).
   */
  private async aggregaRifiuti(tenantId: string, year: number): Promise<MudRifiutoLine[]> {
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31, 23, 59, 59)

    const firs = await this.prisma.fIR.findMany({
      where: { tenantId, createdAt: { gte: start, lte: end } },
      select: {
        cerCode: true,
        quantity: true,
        wasteOperationType: true,
        carrierId: true,
        carrierName: true,
        carrierPartitaIva: true,
        receiverId: true,
        receiverName: true,
        receiverPartitaIva: true,
      },
    })

    // Anagrafica + codici ISTAT dei destinatari (per i moduli DR).
    const destInfo = await this.loadDestinatariInfo(firs.map(f => f.receiverId))

    interface Acc {
      recuperoKg: number
      smaltimentoKg: number
      dr: Map<string, MudAllegatoDR>
      te: Map<string, MudAllegatoTE>
    }
    const perCer = new Map<string, Acc>()

    for (const f of firs) {
      const qty = f.quantity ? Number(f.quantity) : 0
      const acc =
        perCer.get(f.cerCode) ??
        ({ recuperoKg: 0, smaltimentoKg: 0, dr: new Map(), te: new Map() } as Acc)

      if (f.wasteOperationType === 'RECOVERY') acc.recuperoKg += qty
      else if (f.wasteOperationType === 'DISPOSAL') acc.smaltimentoKg += qty

      // DR — per destinatario (merge quantità).
      const drKey = f.receiverId || f.receiverPartitaIva
      if (drKey) {
        const info = f.receiverId ? destInfo.get(f.receiverId) : undefined
        const existing = acc.dr.get(drKey)
        if (existing) {
          existing.quantitaKg += qty
        } else {
          acc.dr.set(drKey, {
            codiceFiscale: info?.partitaIVA || f.receiverPartitaIva || '',
            ragioneSociale: info?.ragioneSociale || f.receiverName || '',
            istatProvincia: info?.istatProvincia,
            istatComune: info?.istatComune,
            indirizzo: info?.via,
            civico: info?.civico,
            cap: info?.cap,
            quantitaKg: qty,
          })
        }
      }

      // TE — per trasportatore (distinti, solo identità).
      const teKey = f.carrierId || f.carrierPartitaIva
      if (teKey && !acc.te.has(teKey)) {
        acc.te.set(teKey, {
          codiceFiscale: f.carrierPartitaIva || '',
          ragioneSociale: f.carrierName || '',
        })
      }

      perCer.set(f.cerCode, acc)
    }

    return Array.from(perCer.entries()).map(([cerCode, v]) => ({
      cerCode,
      prodottoKg: v.recuperoKg + v.smaltimentoKg,
      recuperoKg: v.recuperoKg,
      smaltimentoKg: v.smaltimentoKg,
      dr: Array.from(v.dr.values()),
      te: Array.from(v.te.values()),
    }))
  }

  /**
   * Carica anagrafica + codice ISTAT (provincia 3 + comune 3) dei destinatari
   * indicati, risolvendo il comune dalle tabelle di riferimento condivise.
   */
  private async loadDestinatariInfo(receiverIds: Array<string | null>) {
    const ids = Array.from(new Set(receiverIds.filter((id): id is string => !!id)))
    const info = new Map<
      string,
      {
        ragioneSociale: string
        partitaIVA: string
        via: string
        civico: string
        cap: string
        istatProvincia?: string
        istatComune?: string
      }
    >()
    if (ids.length === 0) return info

    const destinatari = await this.prisma.destinatario.findMany({ where: { id: { in: ids } } })
    for (const d of destinatari) {
      const comune = await this.referenceData.findComuneByName(d.comune, d.provincia)
      info.set(d.id, {
        ragioneSociale: d.ragioneSociale,
        partitaIVA: d.partitaIVA,
        via: d.via,
        civico: d.civico,
        cap: d.cap,
        // Codice ISTAT 6 cifre = provincia(3) + comune(3).
        istatProvincia: comune?.code?.slice(0, 3),
        istatComune: comune?.code?.slice(3, 6),
      })
    }
    return info
  }
}
