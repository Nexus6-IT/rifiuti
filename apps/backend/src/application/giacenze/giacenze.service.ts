import { Injectable } from '@nestjs/common'
import { WHERE_VIGENTE } from '../../domain/waste-movement/vigenza'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { leggiApertureRegistro } from '../registro/aperture-registro'
import { LoggerService } from '../../core/logger/logger.service'
import { DepositoTemporaneoConfig, DEFAULT_DEPOSITO_TEMPORANEO } from './deposito-temporaneo.config'
import { normalizzaUnitaRegistro } from '../../domain/waste-movement/unita-misura-registro'
import { cerCanonico, chiaveConfrontoCer } from '../../domain/waste-movement/cer-registro'
import { calcolaFifo } from '../../domain/waste-movement/fifo-deposito'
import { leggiEventiDeposito } from './eventi-deposito'
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
  /** Parte di `carico` che viene dalle giacenze iniziali (aperture del registro). */
  iniziale: number
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
  /** Parte di `caricoKg` che viene dalle giacenze iniziali (aperture del registro), non da movimenti. */
  inizialeKg: number
  scaricoKg: number
  /** Giacenza attuale in deposito = carico - scarico (>= 0). */
  giacenzaKg: number
  /**
   * Giorno (a mezzanotte UTC) del lotto residuo più vecchio, cioè del carico o dell'apertura
   * non ancora coperto dagli scarichi secondo il FIFO del registro (F2-6, D9); `null` se non
   * c'è residuo. Senza `registroId` è il minimo fra i registri, ciascuno calcolato a sé.
   */
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

  /**
   * Giacenza corrente per CER (carico - scarico) con data del carico più vecchio.
   * Con `registroId` conta solo quel registro; senza, somma tutti i registri dell'azienda
   * (la giacenza fisica in deposito; lo scarico è comunque bloccato per registro).
   */
  async getGiacenze(tenantId: string, registroId?: string): Promise<GiacenzaCer[]> {
    const perRegistro = registroId ? { registroId } : {}
    const byType = await this.prisma.wasteMovement.groupBy({
      by: ['cerCode', 'type', 'unit'],
      where: { tenantId, ...perRegistro, ...WHERE_VIGENTE },
      _sum: { quantity: true },
    })

    // Giorno del lotto residuo più vecchio per CER: FIFO per registro e per famiglia di unità,
    // poi il minimo fra registri e famiglie (le somme restano quelle del groupBy).
    const aperture = await leggiApertureRegistro(this.prisma, tenantId, { registroId })
    const eventi = await leggiEventiDeposito(this.prisma, tenantId, {
      registroId,
      aperture,
      logger: this.logger,
    })
    const oldestByCer = new Map<string, string>()
    for (const perCerRegistro of eventi.values()) {
      for (const [chiave, gruppo] of perCerRegistro) {
        for (const lista of gruppo.famiglie.values()) {
          const giorno = calcolaFifo(lista).giornoPiuVecchio
          const attuale = oldestByCer.get(chiave)
          if (giorno && (!attuale || giorno < attuale)) oldestByCer.set(chiave, giorno)
        }
      }
    }

    interface Parziale {
      cerCode: string
      caricoKg: number
      inizialeKg: number
      scaricoKg: number
      altre: Map<string, GiacenzaAltraUnita>
    }
    const perCer = new Map<string, Parziale>()
    /** Voce del CER (chiave sulle sole cifre); l'asterisco vince: se una riga lo porta, il CER si mostra pericoloso. */
    const voceDi = (cerCode: string): { chiave: string; entry: Parziale } => {
      const chiave = chiaveConfrontoCer(cerCode)
      const entry = perCer.get(chiave) ?? {
        cerCode: cerCanonico(cerCode),
        caricoKg: 0,
        inizialeKg: 0,
        scaricoKg: 0,
        altre: new Map<string, GiacenzaAltraUnita>(),
      }
      if (cerCode.includes('*') && !entry.cerCode.endsWith('*')) entry.cerCode += '*'
      return { chiave, entry }
    }
    for (const row of byType) {
      const { chiave, entry } = voceDi(row.cerCode)
      const qty = row._sum.quantity ? Number(row._sum.quantity) : 0
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
          iniziale: 0,
        }
        if (carico) altra.carico += qty
        else if (row.type === 'SCARICO') altra.scarico += qty
        altra.giacenza = altra.carico - altra.scarico
        entry.altre.set(u.unita, altra)
      }
      perCer.set(chiave, entry)
    }

    // Le aperture del registro contano come carichi (e restano distinte in `inizialeKg`/`iniziale`);
    // un CER con la sola apertura compare comunque.
    for (const ap of aperture) {
      const { chiave, entry } = voceDi(ap.cerCode)
      const u = normalizzaUnitaRegistro(ap.unita)
      if (u.massa) {
        const kg = ap.quantita * (u.fattoreKg as number)
        entry.caricoKg += kg
        entry.inizialeKg += kg
      } else {
        const altra = entry.altre.get(u.unita) ?? {
          unita: u.unita,
          carico: 0,
          scarico: 0,
          giacenza: 0,
          iniziale: 0,
        }
        altra.carico += ap.quantita
        altra.iniziale += ap.quantita
        altra.giacenza = altra.carico - altra.scarico
        entry.altre.set(u.unita, altra)
      }
      perCer.set(chiave, entry)
    }

    const suFirAnnullati = await this.scarichiSuFirAnnullati(tenantId, registroId)

    const result: GiacenzaCer[] = []
    for (const [chiave, entry] of perCer) {
      const caricoKg = arrotonda3(entry.caricoKg)
      const scaricoKg = arrotonda3(entry.scaricoKg)
      result.push({
        cerCode: entry.cerCode,
        caricoKg,
        inizialeKg: arrotonda3(entry.inizialeKg),
        scaricoKg,
        // Non negativa: scarichi > carichi indicano dati incoerenti (gestiti
        // a parte dall'anomaly detection), qui clampiamo a 0.
        giacenzaKg: Math.max(0, arrotonda3(caricoKg - scaricoKg)),
        oldestCaricoDate: oldestByCer.has(chiave)
          ? new Date(`${oldestByCer.get(chiave)}T00:00:00Z`)
          : null,
        altreUnita: [...entry.altre.values()],
        scarichiSuFirAnnullati: suFirAnnullati.get(chiave) ?? [],
      })
    }

    result.sort((a, b) => b.giacenzaKg - a.giacenzaKg)
    return result
  }

  /** Scarichi collegati a un FIR annullato (in locale o all'ente), per CER (solo cifre). */
  private async scarichiSuFirAnnullati(
    tenantId: string,
    registroId?: string
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
      where: {
        tenantId,
        type: 'SCARICO',
        firId: { in: [...etichette.keys()] },
        ...(registroId ? { registroId } : {}),
        ...WHERE_VIGENTE,
      },
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
      const chiave = chiaveConfrontoCer(s.cerCode)
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
    now: Date = new Date(),
    registroId?: string
  ): Promise<DepositoTemporaneoAlert[]> {
    const giacenze = await this.getGiacenze(tenantId, registroId)
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
