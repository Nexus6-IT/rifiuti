import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import {
  cerCanonico,
  cerSoloCifre,
  chiaveConfrontoCer,
} from '../../domain/waste-movement/cer-registro'
import {
  convertiInKg,
  normalizzaUnitaRegistro,
  simboloUnita,
} from '../../domain/waste-movement/unita-misura-registro'

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

/** Carico e scarico di un CER in una famiglia di unità (kg per la massa, altrimenti l'unità). */
interface SaldoUnita {
  carico: number
  scarico: number
}

interface SaldoCer {
  cerCode: string
  /** chiave: 'KG' per la massa (kg e t convertiti), altrimenti l'unità normalizzata */
  perUnita: Map<string, SaldoUnita>
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
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(AnomalyDetectionService.name)
  }

  async detectAnomalies(
    tenantId: string,
    config: AnomalyDetectionConfig = DEFAULT_CONFIG
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
    const validCerSet = new Set(catalog.map(c => cerSoloCifre(c.code)))

    for (const fir of firs) {
      const qty = fir.quantity ? Number(fir.quantity) : 0

      if (qty <= 0) {
        anomalies.push(
          this.fir('NON_POSITIVE_QUANTITY', 'HIGH', fir, `Quantità non positiva (${qty})`)
        )
      } else if (qty > config.maxQuantityKg) {
        anomalies.push(
          this.fir('EXCESSIVE_QUANTITY', 'MEDIUM', fir, `Quantità sospetta (${qty} kg)`)
        )
      }

      if (validCerSet.size > 0 && !validCerSet.has(cerSoloCifre(fir.cerCode))) {
        anomalies.push(
          this.fir(
            'INVALID_CER',
            'HIGH',
            fir,
            `Codice CER non presente in catalogo: ${fir.cerCode}`
          )
        )
      }

      if (!fir.wasteDescription || fir.wasteDescription.trim() === '') {
        anomalies.push(this.fir('MISSING_DESCRIPTION', 'LOW', fir, 'Descrizione rifiuto mancante'))
      }
    }

    anomalies.push(...(await this.giacenzeImpossibili(tenantId)))

    if (anomalies.length > 0) {
      this.logger.warn(`Rilevate ${anomalies.length} anomalie per tenant ${tenantId}`)
    }
    return anomalies
  }

  /**
   * Giacenze impossibili (scarico complessivo oltre il carico) con le stesse regole del
   * registro: CER confrontato sulle sole cifre, kg e tonnellate sommati in kg, ogni unità
   * non di massa valutata a parte, mai mescolata ai kg, e solo se ha almeno un carico.
   */
  private async giacenzeImpossibili(tenantId: string): Promise<Anomaly[]> {
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type', 'unit'],
      where: { tenantId },
      _sum: { quantity: true },
    })

    const perCer = new Map<string, SaldoCer>()
    for (const row of byType) {
      const chiave = chiaveConfrontoCer(row.cerCode)
      const entry = perCer.get(chiave) ?? {
        cerCode: cerCanonico(row.cerCode),
        perUnita: new Map<string, SaldoUnita>(),
      }
      // L'asterisco vince: se una riga lo porta, il CER si mostra pericoloso.
      if (row.cerCode.includes('*') && !entry.cerCode.endsWith('*')) entry.cerCode += '*'

      const qty = row._sum.quantity ? Number(row._sum.quantity) : 0
      const u = normalizzaUnitaRegistro(row.unit)
      const unita = u.massa ? 'KG' : u.unita
      const quantita = u.massa ? (convertiInKg(qty, row.unit) as number) : qty
      const saldo = entry.perUnita.get(unita) ?? { carico: 0, scarico: 0 }
      if (row.type === 'CARICO') saldo.carico += quantita
      else if (row.type === 'SCARICO') saldo.scarico += quantita
      entry.perUnita.set(unita, saldo)
      perCer.set(chiave, entry)
    }

    const anomalies: Anomaly[] = []
    for (const { cerCode, perUnita } of perCer.values()) {
      for (const [unita, { carico, scarico }] of perUnita) {
        // Un'unità non di massa si confronta solo se ha almeno un carico: i carichi manuali sono
        // sempre in kg, quindi uno scarico in litri o m3 ricopiato da un FIR non è confrontabile.
        if (unita !== 'KG' && carico <= 0) continue
        if (scarico <= carico + 1e-9) continue
        const um = simboloUnita(normalizzaUnitaRegistro(unita))
        anomalies.push({
          type: 'NEGATIVE_STOCK',
          severity: 'HIGH',
          cerCode,
          message:
            `Giacenza impossibile per ${cerCode}: scarico (${formattaQuantita(scarico)} ${um}) ` +
            `supera carico (${formattaQuantita(carico)} ${um})`,
        })
      }
    }
    return anomalies
  }

  private fir(
    type: AnomalyType,
    severity: AnomalySeverity,
    fir: { id: string; firNumber: string | null },
    message: string
  ): Anomaly {
    return { type, severity, firId: fir.id, firNumber: fir.firNumber ?? '', message }
  }
}
