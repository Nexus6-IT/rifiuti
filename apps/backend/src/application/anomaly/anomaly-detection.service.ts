import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

export type AnomalyType =
  | 'INVALID_CER'
  | 'NON_POSITIVE_QUANTITY'
  | 'EXCESSIVE_QUANTITY'
  | 'MISSING_DESCRIPTION'
  | 'NEGATIVE_STOCK'

export type AnomalySeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Anomaly {
  type: AnomalyType
  severity: AnomalySeverity
  message: string
  firId?: string
  firNumber?: string
  cerCode?: string
}

export interface AnomalyDetectionConfig {
  /** Soglia oltre la quale una quantità FIR è considerata sospetta (kg). */
  maxQuantityKg: number
}

const DEFAULT_CONFIG: AnomalyDetectionConfig = {
  maxQuantityKg: 1_000_000,
}

/** Normalizza un CER a sole cifre per il confronto col catalogo. */
function normalizeCer(cer: string): string {
  return (cer || '').replace(/[^0-9]/g, '')
}

/**
 * Anomaly Detection — controlli a regole sui movimenti/FIR del tenant.
 *
 * Differenziatore (white space nel mercato IT): rilevamento automatico di
 * incongruenze che precedono errori normativi/sanzioni. Approccio a regole
 * (deterministico, spiegabile); estendibile in futuro con modelli statistici.
 * Tenant-scoped.
 */
@Injectable()
export class AnomalyDetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AnomalyDetectionService.name)
  }

  async detectAnomalies(
    tenantId: string,
    config: AnomalyDetectionConfig = DEFAULT_CONFIG,
  ): Promise<Anomaly[]> {
    const anomalies: Anomaly[] = []

    const firs = await this.prisma.fIR.findMany({
      where: { tenantId },
      select: {
        id: true,
        firNumber: true,
        cerCode: true,
        quantity: true,
        wasteDescription: true,
      },
    })

    // Catalogo CER valido (normalizzato) per il controllo di validità del codice.
    const catalog = await this.prisma.cERCode.findMany({ select: { code: true } })
    const validCerSet = new Set(catalog.map((c) => normalizeCer(c.code)))

    for (const fir of firs) {
      const qty = fir.quantity ? Number(fir.quantity) : 0

      if (qty <= 0) {
        anomalies.push(this.fir('NON_POSITIVE_QUANTITY', 'HIGH', fir, `Quantità non positiva (${qty})`))
      } else if (qty > config.maxQuantityKg) {
        anomalies.push(
          this.fir('EXCESSIVE_QUANTITY', 'MEDIUM', fir, `Quantità sospetta (${qty} kg)`),
        )
      }

      if (validCerSet.size > 0 && !validCerSet.has(normalizeCer(fir.cerCode))) {
        anomalies.push(
          this.fir('INVALID_CER', 'HIGH', fir, `Codice CER non presente in catalogo: ${fir.cerCode}`),
        )
      }

      if (!fir.wasteDescription || fir.wasteDescription.trim() === '') {
        anomalies.push(this.fir('MISSING_DESCRIPTION', 'LOW', fir, 'Descrizione rifiuto mancante'))
      }
    }

    // Giacenze impossibili: scarico complessivo > carico per un CER.
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type'],
      where: { tenantId },
      _sum: { quantity: true },
    })
    const stock = new Map<string, { carico: number; scarico: number }>()
    for (const row of byType) {
      const q = row._sum.quantity ? Number(row._sum.quantity) : 0
      const e = stock.get(row.cerCode) ?? { carico: 0, scarico: 0 }
      if (row.type === 'CARICO') e.carico += q
      else if (row.type === 'SCARICO') e.scarico += q
      stock.set(row.cerCode, e)
    }
    for (const [cerCode, { carico, scarico }] of stock) {
      if (scarico > carico) {
        anomalies.push({
          type: 'NEGATIVE_STOCK',
          severity: 'HIGH',
          cerCode,
          message: `Giacenza impossibile per ${cerCode}: scarico (${scarico}) supera carico (${carico})`,
        })
      }
    }

    if (anomalies.length > 0) {
      this.logger.warn(`Rilevate ${anomalies.length} anomalie per tenant ${tenantId}`)
    }
    return anomalies
  }

  private fir(
    type: AnomalyType,
    severity: AnomalySeverity,
    fir: { id: string; firNumber: string },
    message: string,
  ): Anomaly {
    return { type, severity, firId: fir.id, firNumber: fir.firNumber, message }
  }
}
