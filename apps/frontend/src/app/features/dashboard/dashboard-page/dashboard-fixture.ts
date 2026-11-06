// Dati di prova condivisi dagli spec della Dashboard (importato solo dai test).
import { LOCALE_ID } from '@angular/core'
import { registerLocaleData } from '@angular/common'
import localeIt from '@angular/common/locales/it'
import { DashboardData } from '../../../core/services/dashboard.service'
import {
  DepositoCer,
  DepositoRegistro,
  DepositoTemporaneoVista,
} from '../../giacenze/giacenze.service'

registerLocaleData(localeIt, 'it-IT')

/** Locale it-IT come in produzione (`app.config.ts`): migliaia con il punto, virgola decimale. */
export const LOCALE_IT = { provide: LOCALE_ID, useValue: 'it-IT' }

export function dashboardFixture(over: Partial<DashboardData> = {}): DashboardData {
  return {
    overview: {
      totalFIRs: 20,
      totalWasteKg: 31000,
      completedFIRs: 15,
      pendingFIRs: 5,
      overdueFIRs: 1,
    },
    status: {
      breakdown: {
        DRAFT: 3,
        AWAITING_PRODUCER: 1,
        AWAITING_CARRIER: 6,
        AWAITING_RECEIVER: 9,
        COMPLETED: 20,
        SYNCED_TO_RENTRI: 1,
        CANCELLED: 1,
      },
      chart: [],
    },
    waste: {
      totalKg: 31000,
      byCERCode: [
        { cerCode: '17 04 05', count: 6, totalQuantity: 12400 },
        { cerCode: '15 01 06', count: 4, totalQuantity: 6200 },
        { cerCode: '08 01 11*', count: 2, totalQuantity: 3100 },
      ],
      byDestination: {
        recovery: { count: 14, quantity: 24800 },
        disposal: { count: 6, quantity: 6200 },
        recyclingRate: 0.8,
      },
      recyclingRate: 0.8,
    },
    rentri: { syncRate: 0.75, totalCompleted: 20, synced: 15, pending: 5 },
    signatures: { completionRate: 0.9, total: 20, completed: 18, averageTimeHours: 12.5 },
    compliance: {
      score: 0.82,
      level: 'GOOD',
      factors: { signatureCompletionRate: 0.9, rentriSyncRate: 0.75, overdueRate: 0.04 },
    },
    trends: {
      monthOverMonth: { current: 7, previous: 7, percentage: 0 },
      prediction: { nextMonth: 45 },
    },
    top: {
      producers: [
        { partitaIva: '01234567890', nome: 'Acciaierie Valdelsa S.p.A.', count: 12 },
        { partitaIva: '09876543210', nome: null, count: 3 },
      ],
      carriers: [{ partitaIva: '11111111111', nome: 'Trasporti Arno S.r.l.', count: 8 }],
    },
    generatedAt: new Date(2026, 10, 5),
    ...over,
  }
}

export function dashboardSenzaFir(): DashboardData {
  return dashboardFixture({
    overview: { totalFIRs: 0, totalWasteKg: 0, completedFIRs: 0, pendingFIRs: 0, overdueFIRs: 0 },
    status: { breakdown: {}, chart: [] },
    waste: {
      totalKg: 0,
      byCERCode: [],
      byDestination: {
        recovery: { count: 0, quantity: 0 },
        disposal: { count: 0, quantity: 0 },
        recyclingRate: 0,
      },
      recyclingRate: 0,
    },
    rentri: { syncRate: 0, totalCompleted: 0, synced: 0, pending: 0 },
    signatures: { completionRate: 0, total: 0, completed: 0, averageTimeHours: 0 },
    compliance: {
      score: 0.2,
      level: 'CRITICAL',
      factors: { signatureCompletionRate: 0, rentriSyncRate: 0, overdueRate: 0 },
    },
    trends: {
      monthOverMonth: { current: 0, previous: 0, percentage: 0 },
      prediction: { nextMonth: null },
    },
    top: { producers: [], carriers: [] },
  })
}

export function cerFixture(over: Partial<DepositoCer> = {}): DepositoCer {
  return {
    cerCode: '08 01 11*',
    pericoloso: true,
    residuoKg: 320,
    giornoPiuVecchio: '2026-08-08',
    etaGiorni: 89,
    scadenza: '2026-11-08',
    unitaMiste: false,
    famiglie: [],
    ...over,
  }
}

export function registroFixture(over: Partial<DepositoRegistro> = {}): DepositoRegistro {
  return {
    registroId: 'r1',
    registroDescrizione: 'Registro impianto di Sesto',
    attivo: true,
    soglie: {
      criterio: 'TEMPORALE',
      giorniMax: null,
      kgMaxTotale: 30000,
      kgMaxPericolosi: 10000,
      preavvisoGiorni: 15,
      preavvisoPercentuale: 80,
      origine: 'REGISTRO',
    },
    cer: [cerFixture()],
    totaleKg: 17900,
    totalePericolosiKg: 6400,
    quantitaParziale: false,
    scopertoPresente: false,
    avvisi: [],
    ...over,
  }
}

export function depositoFixture(
  registri: DepositoRegistro[] = [registroFixture()]
): DepositoTemporaneoVista {
  return { oggi: '2026-11-05', registri }
}

/** Colore calcolato (rgb) di un token del tema: serve ai test che confrontano i colori. */
export function coloreDelToken(token: string): string {
  const sonda = document.createElement('span')
  sonda.style.color = `var(${token})`
  document.body.appendChild(sonda)
  const colore = getComputedStyle(sonda).color
  sonda.remove()
  return colore
}
