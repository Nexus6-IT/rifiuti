import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'
import { DepositoTemporaneoConfig, DEFAULT_DEPOSITO_TEMPORANEO } from './deposito-temporaneo.config'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import {
  firAnnullato,
  etichettaFir,
  STATO_FIR_ANNULLATO,
  STATO_RENTRI_ANNULLATO,
} from '../../domain/fir/stati-fir'

/** Giacenza in un'unità che non è di massa (litri, m³, ...): non si somma ai kg. */
export interface GiacenzaAltraUnita {
  unita: string
  carico: number
  scarico: number
  giacenza: number
}

/** Scarico collegato a un FIR poi annullato: la giacenza lo conta ancora, il MUD no. */
export interface ScaricoSuFirAnnullato {
  /** `progressiveYear/progressiveNumber` */
  numero: string
  quantita: number
  unita: string
  fir: string
}

export interface GiacenzaCer {
  cerCode: string
  /** Solo la famiglia di massa, con le tonnellate convertite in kg. */
  caricoKg: number
  scaricoKg: number
  /** Giacenza attuale in deposito = carico - scarico (>= 0). */
  giacenzaKg: number
  /** Data del carico più vecchio ancora "in giacenza" (per il criterio temporale). */
  oldestCaricoDate: Date | null
  altreUnita: GiacenzaAltraUnita[]
  scarichiSuFirAnnullati: ScaricoSuFirAnnullato[]
}

export type DepositoTemporaneoAlertReason = 'DURATION' | 'QUANTITY'

export interface DepositoTemporaneoAlert {
  cerCode: string
  giacenzaKg: number
  reasons: DepositoTemporaneoAlertReason[]
  /** Giorni trascorsi dal carico più vecchio (se disponibile). */
  durationDays?: number
  oldestCaricoDate: Date | null
}

/** Chiave di confronto del CER: le sole cifre (con o senza spazi e asterisco è lo stesso rifiuto). */
const cerSoloCifre = (cer: string): string => cer.replace(/[^0-9]/g, '')

/** Forma canonica "NN NN NN", con asterisco se presente nella riga. */
function cerCanonico(cer: string): string {
  const cifre = cerSoloCifre(cer)
  if (cifre.length !== 6) return cer
  return `${cifre.slice(0, 2)} ${cifre.slice(2, 4)} ${cifre.slice(4)}${cer.includes('*') ? '*' : ''}`
}

const arrotonda3 = (v: number): number => Math.round(v * 1000) / 1000

/**
 * Giacenze e monitoraggio del deposito temporaneo, calcolati dal registro
 * cronologico di carico/scarico (WasteMovement). Tutte le query sono
 * tenant-scoped.
 */
@Injectable()
export class GiacenzeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(GiacenzeService.name)
  }

  /** Giacenza corrente per CER (carico - scarico) con data del carico più vecchio. */
  async getGiacenze(tenantId: string): Promise<GiacenzaCer[]> {
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type', 'unit'],
      where: { tenantId },
      _sum: { quantity: true },
    })

    // Data del carico più vecchio per CER (criterio temporale del deposito).
    const oldestCarico = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode'],
      where: { tenantId, type: 'CARICO' },
      _min: { movementDate: true },
    })
    const oldestByCer = new Map<string, Date | null>()
    for (const row of oldestCarico) {
      const chiave = cerSoloCifre(row.cerCode)
      const data = row._min.movementDate ?? null
      const attuale = oldestByCer.get(chiave) ?? null
      oldestByCer.set(chiave, attuale && (!data || attuale < data) ? attuale : data)
    }

    interface Parziale {
      cerCode: string
      caricoKg: number
      scaricoKg: number
      altre: Map<string, GiacenzaAltraUnita>
    }
    const perCer = new Map<string, Parziale>()
    for (const row of byType) {
      const chiave = cerSoloCifre(row.cerCode)
      const qty = row._sum.quantity ? Number(row._sum.quantity) : 0
      const entry = perCer.get(chiave) ?? {
        cerCode: cerCanonico(row.cerCode),
        caricoKg: 0,
        scaricoKg: 0,
        altre: new Map<string, GiacenzaAltraUnita>(),
      }
      // L'asterisco vince: se una riga lo porta, il CER si mostra pericoloso.
      if (row.cerCode.includes('*') && !entry.cerCode.endsWith('*')) entry.cerCode += '*'
      const carico = row.type === 'CARICO'
      const u = normalizzaUnitaRegistro(row.unit)
      if (u.massa) {
        const kg = qty * (u.fattoreKg as number)
        if (carico) entry.caricoKg += kg
        else if (row.type === 'SCARICO') entry.scaricoKg += kg
      } else {
        const altra = entry.altre.get(u.unita) ?? {
          unita: u.unita,
          carico: 0,
          scarico: 0,
          giacenza: 0,
        }
        if (carico) altra.carico += qty
        else if (row.type === 'SCARICO') altra.scarico += qty
        altra.giacenza = altra.carico - altra.scarico
        entry.altre.set(u.unita, altra)
      }
      perCer.set(chiave, entry)
    }

    const suFirAnnullati = await this.scarichiSuFirAnnullati(tenantId)

    const result: GiacenzaCer[] = []
    for (const [chiave, entry] of perCer) {
      const caricoKg = arrotonda3(entry.caricoKg)
      const scaricoKg = arrotonda3(entry.scaricoKg)
      result.push({
        cerCode: entry.cerCode,
        caricoKg,
        scaricoKg,
        // Non negativa: scarichi > carichi indicano dati incoerenti (gestiti
        // a parte dall'anomaly detection), qui clampiamo a 0.
        giacenzaKg: Math.max(0, arrotonda3(caricoKg - scaricoKg)),
        oldestCaricoDate: oldestByCer.get(chiave) ?? null,
        altreUnita: [...entry.altre.values()],
        scarichiSuFirAnnullati: suFirAnnullati.get(chiave) ?? [],
      })
    }

    result.sort((a, b) => b.giacenzaKg - a.giacenzaKg)
    return result
  }

  /** Scarichi collegati a un FIR annullato (in locale o all'ente), per CER (solo cifre). */
  private async scarichiSuFirAnnullati(
    tenantId: string
  ): Promise<Map<string, ScaricoSuFirAnnullato[]>> {
    const perCer = new Map<string, ScaricoSuFirAnnullato[]>()
    const firs = await this.prisma.fIR.findMany({
      where: {
        tenantId,
        OR: [{ status: STATO_FIR_ANNULLATO }, { rentriStatoFormulario: STATO_RENTRI_ANNULLATO }],
      },
      select: {
        id: true,
        status: true,
        firNumber: true,
        rentriNumeroFir: true,
        rentriStatoFormulario: true,
      },
    })
    const etichette = new Map(firs.filter(f => firAnnullato(f)).map(f => [f.id, etichettaFir(f)]))
    if (etichette.size === 0) return perCer

    const scarichi = await this.prisma.wasteMovement.findMany({
      where: { tenantId, type: 'SCARICO', firId: { in: [...etichette.keys()] } },
      select: {
        cerCode: true,
        progressiveNumber: true,
        progressiveYear: true,
        quantity: true,
        unit: true,
        firId: true,
      },
      orderBy: [{ progressiveYear: 'asc' }, { progressiveNumber: 'asc' }],
    })
    for (const s of scarichi) {
      const chiave = cerSoloCifre(s.cerCode)
      const elenco = perCer.get(chiave) ?? []
      elenco.push({
        numero: `${s.progressiveYear}/${s.progressiveNumber}`,
        quantita: Number(s.quantity),
        unita: s.unit,
        fir: etichette.get(s.firId as string) ?? '',
      })
      perCer.set(chiave, elenco)
    }
    return perCer
  }

  /**
   * Alert di deposito temporaneo: per ogni CER con giacenza > 0, segnala il
   * superamento del limite temporale e/o quantitativo (soglie configurabili).
   */
  async getDepositoTemporaneoAlerts(
    tenantId: string,
    config: DepositoTemporaneoConfig = DEFAULT_DEPOSITO_TEMPORANEO,
    now: Date = new Date()
  ): Promise<DepositoTemporaneoAlert[]> {
    const giacenze = await this.getGiacenze(tenantId)
    const alerts: DepositoTemporaneoAlert[] = []

    for (const g of giacenze) {
      if (g.giacenzaKg <= 0) continue

      const reasons: DepositoTemporaneoAlertReason[] = []
      let durationDays: number | undefined

      if (g.oldestCaricoDate) {
        durationDays = Math.floor(
          (now.getTime() - g.oldestCaricoDate.getTime()) / (24 * 60 * 60 * 1000)
        )
        if (durationDays > config.maxDurationDays) reasons.push('DURATION')
      }
      if (g.giacenzaKg > config.maxQuantityKg) reasons.push('QUANTITY')

      if (reasons.length > 0) {
        alerts.push({
          cerCode: g.cerCode,
          giacenzaKg: g.giacenzaKg,
          reasons,
          durationDays,
          oldestCaricoDate: g.oldestCaricoDate,
        })
      }
    }

    if (alerts.length > 0) {
      this.logger.warn(
        `Deposito temporaneo: ${alerts.length} CER oltre soglia per tenant ${tenantId}`
      )
    }
    return alerts
  }
}
