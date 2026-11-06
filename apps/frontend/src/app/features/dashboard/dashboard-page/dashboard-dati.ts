import { formatNumber, formatPercent } from '@angular/common'
import { DashboardData } from '../../../core/services/dashboard.service'
import {
  DepositoCer,
  DepositoRegistro,
  DepositoTemporaneoVista,
} from '../../giacenze/giacenze.service'
import { AndamentoMensileVoce } from '../andamento.service'
import { VoceAttenzione } from '../attenzione.service'
import { TonoStato } from '../../../shared/models/stati-fir'

/**
 * Dal 1° del mese di `oggi` alle 00:00 UTC fino a `oggi`. Mese UTC come nel backend (barre e
 * previsione), cosi' «FIR del mese» e «Formulari per mese» contano lo stesso mese.
 */
export function intervalloMeseCorrente(oggi: Date): { startDate: Date; endDate: Date } {
  return {
    startDate: new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth(), 1)),
    endDate: new Date(oggi.getTime()),
  }
}

// ---------------------------------------------------------------------------
// Da fare oggi
// ---------------------------------------------------------------------------

/** Gli avvisi del deposito temporaneo diventano voci di «Da fare oggi». */
export function vociDaDeposito(vista: DepositoTemporaneoVista): VoceAttenzione[] {
  const voci: VoceAttenzione[] = []
  for (const registro of vista.registri) {
    if (!registro.attivo) continue
    for (const avviso of registro.avvisi) {
      voci.push({
        chiave: `deposito-${avviso.tipo.toLowerCase().replace(/_/g, '-')}`,
        gravita: avviso.livello === 'SUPERATO' ? 'critico' : 'avviso',
        titolo: avviso.messaggio,
        dettaglio: registro.registroDescrizione,
        azione: { etichetta: 'Vedi le giacenze', rotta: '/giacenze' },
      })
    }
  }
  return voci
}

const ORDINE_GRAVITA: Record<VoceAttenzione['gravita'], number> = {
  critico: 0,
  avviso: 1,
  informativo: 2,
}

/** Unisce le due liste per gravità (critici per primi); a parità tiene l'ordine di arrivo. */
export function unisciVoci(
  attenzione: VoceAttenzione[],
  deposito: VoceAttenzione[]
): VoceAttenzione[] {
  return [...attenzione, ...deposito]
    .map((voce, posizione) => ({ voce, posizione }))
    .sort(
      (a, b) =>
        ORDINE_GRAVITA[a.voce.gravita] - ORDINE_GRAVITA[b.voce.gravita] || a.posizione - b.posizione
    )
    .map(x => x.voce)
}

/** La frase sotto il titolo: quante cose da fare oggi e quante urgenti. */
export function rispostaDelGiorno(voci: readonly VoceAttenzione[]): string {
  if (voci.length === 0) return 'Nessuna scadenza da seguire oggi'
  const urgenti = voci.filter(v => v.gravita === 'critico').length
  const base = voci.length === 1 ? '1 cosa da fare oggi' : `${voci.length} cose da fare oggi`
  if (urgenti === 0) return base
  return `${base}, ${urgenti === 1 ? '1 urgente' : `${urgenti} urgenti`}`
}

// ---------------------------------------------------------------------------
// Deposito temporaneo
// ---------------------------------------------------------------------------

export interface BarraDeposito {
  etichetta: string
  valore: number
  limite: number
  unita: 'kg' | 'giorni'
  allarme: boolean
  nota: string | null
}

const MS_GIORNO = 24 * 60 * 60 * 1000

function giornoUtc(iso: string): number {
  const [a, m, g] = iso.split('-').map(Number)
  return Date.UTC(a, m - 1, g)
}

/** «2026-11-07» → «07/11» */
function dataBreve(iso: string): string {
  const [, m, g] = iso.split('-')
  return `${g}/${m}`
}

/** Il CER in giacenza da più tempo, con data di partenza e scadenza note. */
function cerPiuVecchio(cer: DepositoCer[]): DepositoCer | null {
  let scelto: DepositoCer | null = null
  for (const c of cer) {
    if (c.etaGiorni === null || !c.giornoPiuVecchio || !c.scadenza) continue
    if (!scelto || c.etaGiorni > (scelto.etaGiorni ?? -1)) scelto = c
  }
  return scelto
}

/**
 * Le barre del deposito temporaneo di un registro, secondo il criterio scelto (P9):
 * TEMPORALE solo la durata; QUANTITATIVO le due quantita' e la durata sul tetto annuale;
 * NON_SCELTO tutte e tre, con la nota che il criterio non e' ancora scelto.
 */
export function barreDeposito(r: DepositoRegistro): BarraDeposito[] {
  const criterio = r.soglie.criterio
  const conQuantita = criterio !== 'TEMPORALE'
  const barre: BarraDeposito[] = []
  const ha = (...tipi: string[]): boolean => r.avvisi.some(a => tipi.includes(a.tipo))

  const notaQuantita = (): string | null => {
    const parti: string[] = []
    if (criterio === 'NON_SCELTO') parti.push('Criterio non ancora scelto')
    if (r.quantitaParziale) parti.push('solo i rifiuti in kg')
    return parti.length ? parti.join(' · ') : null
  }

  if (conQuantita) {
    barre.push({
      etichetta: 'Pericolosi',
      valore: r.totalePericolosiKg,
      limite: r.soglie.kgMaxPericolosi,
      unita: 'kg',
      allarme: ha('QUANTITA_PERICOLOSI'),
      nota: notaQuantita(),
    })
    barre.push({
      etichetta: 'Totale',
      valore: r.totaleKg,
      limite: r.soglie.kgMaxTotale,
      unita: 'kg',
      allarme: ha('QUANTITA_TOTALE'),
      // La nota vale per tutto il registro: basta una volta, sotto «Pericolosi».
      nota: null,
    })
  }

  const vecchio = cerPiuVecchio(r.cer)
  if (vecchio && vecchio.etaGiorni !== null && vecchio.giornoPiuVecchio && vecchio.scadenza) {
    const limite = Math.round(
      (giornoUtc(vecchio.scadenza) - giornoUtc(vecchio.giornoPiuVecchio)) / MS_GIORNO
    )
    barre.push({
      etichetta: 'Giacenza più vecchia',
      valore: vecchio.etaGiorni,
      limite,
      unita: 'giorni',
      allarme: ha('DURATA', 'DURATA_ANNUALE'),
      nota: `${vecchio.cerCode} · entro il ${dataBreve(vecchio.scadenza)}`,
    })
  }
  return barre
}

// ---------------------------------------------------------------------------
// Analisi dell'azienda
// ---------------------------------------------------------------------------

export interface CellaAnalisi {
  etichetta: string
  valore: string
  dettaglio: string | null
  /** Variazione in parole sul mese scorso (solo la cella Andamento). */
  variazione?: string | null
  vuota: boolean
}

const TRATTINO = '—'
// Il locale it-IT e' registrato in `app.config.ts`. Si usa `formatNumber` di Angular e non
// `Intl`: quest'ultimo non raggruppa le 4 cifre in italiano («1240»), la regola P8 vuole «1.240».
const LOCALE = 'it-IT'
const formatoNumero = { format: (n: number): string => formatNumber(n, LOCALE, '1.0-1') }
const formatoIntero = { format: (n: number): string => formatNumber(n, LOCALE, '1.0-0') }
const formatoPercento = { format: (n: number): string => formatPercent(n, LOCALE, '1.0-0') }

function variazioneInParole(corrente: number, precedente: number): string {
  if (precedente === 0) return corrente === 0 ? 'come il mese scorso' : 'nuovo'
  const pct = Math.round(((corrente - precedente) / precedente) * 100)
  if (pct === 0) return 'come il mese scorso'
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct)}% sul mese scorso`
}

/**
 * Le quattro celle della striscia «Analisi dell'azienda». Con 0 formulari il punteggio di
 * conformita' e' un artefatto della formula (P11): tutte le celle mostrano «—».
 * «Questo mese» e «il mese scorso» vengono dalla serie di `GET /dashboard/andamento`, la
 * stessa delle barre, non da `trends.monthOverMonth` (M8).
 */
export function celleAnalisi(
  d: DashboardData,
  mesi: readonly AndamentoMensileVoce[]
): CellaAnalisi[] {
  if (d.overview.totalFIRs === 0) {
    return [
      {
        etichetta: 'Conformità',
        valore: TRATTINO,
        dettaglio: 'Si calcola dal primo formulario',
        vuota: true,
      },
      { etichetta: 'Firme', valore: TRATTINO, dettaglio: null, vuota: true },
      { etichetta: 'RENTRI', valore: TRATTINO, dettaglio: null, vuota: true },
      { etichetta: 'Andamento', valore: TRATTINO, dettaglio: null, vuota: true },
    ]
  }

  const f = d.compliance.factors
  const conformita: CellaAnalisi = {
    etichetta: 'Conformità',
    valore: formatoPercento.format(d.compliance.score),
    dettaglio: `Firme ${formatoPercento.format(f.signatureCompletionRate)} · RENTRI ${formatoPercento.format(f.rentriSyncRate)} · Ritardi ${formatoPercento.format(f.overdueRate)}`,
    vuota: false,
  }

  const s = d.signatures
  let tempo: string
  if (s.completed === 0) tempo = TRATTINO
  else if (s.averageTimeHours <= 0) tempo = "meno di un'ora"
  else tempo = `${formatoNumero.format(s.averageTimeHours)} h`
  const firme: CellaAnalisi = {
    etichetta: 'Firme',
    valore: `${formatoIntero.format(s.completed)} di ${formatoIntero.format(s.total)}`,
    dettaglio: `Tempo medio ${tempo}`,
    vuota: false,
  }

  const rentri: CellaAnalisi = {
    etichetta: 'RENTRI',
    valore: `${formatoIntero.format(d.rentri.synced)} di ${formatoIntero.format(d.rentri.totalCompleted)}`,
    dettaglio: `${formatoIntero.format(d.rentri.pending)} in attesa`,
    vuota: false,
  }

  const previsioneValore = d.trends.prediction.nextMonth
  const previsione = previsioneValore === null ? TRATTINO : formatoIntero.format(previsioneValore)
  let andamento: CellaAnalisi
  if (mesi.length === 0) {
    andamento = {
      etichetta: 'Andamento',
      valore: TRATTINO,
      dettaglio: `previsione del mese ${previsione}`,
      variazione: null,
      vuota: true,
    }
  } else {
    const corrente = mesi[mesi.length - 1].conteggio
    const precedenteVoce = mesi.length >= 2 ? mesi[mesi.length - 2] : null
    andamento = {
      etichetta: 'Andamento',
      valore: `${formatoIntero.format(corrente)} questo mese`,
      dettaglio: precedenteVoce
        ? `${formatoIntero.format(precedenteVoce.conteggio)} il mese scorso · previsione del mese ${previsione}`
        : `previsione del mese ${previsione}`,
      variazione: precedenteVoce ? variazioneInParole(corrente, precedenteVoce.conteggio) : null,
      vuota: false,
    }
  }
  return [conformita, firme, rentri, andamento]
}

const LIVELLI: Record<DashboardData['compliance']['level'], { parola: string; tono: TonoStato }> = {
  EXCELLENT: { parola: 'Eccellente', tono: 'ok' },
  GOOD: { parola: 'Buona', tono: 'ok' },
  NEEDS_IMPROVEMENT: { parola: 'Da migliorare', tono: 'warn' },
  CRITICAL: { parola: 'Critica', tono: 'err' },
}

/** La pillola del livello di conformita'; nessuna pillola con 0 formulari. */
export function livelloConformita(d: DashboardData): { parola: string; tono: TonoStato } | null {
  if (d.overview.totalFIRs === 0) return null
  return LIVELLI[d.compliance.level] ?? null
}

export interface VoceClassifica {
  nome: string
  partitaIva: string
  conteggio: number
}

/** Ragione sociale in testa; senza nome (FIR vecchi) resta la P. IVA, che non si ripete. */
export function vociClassifica(
  top: ReadonlyArray<{ partitaIva: string; nome: string | null; count: number }>
): VoceClassifica[] {
  return top.map(t => {
    const nome = t.nome?.trim()
    return { nome: nome ? nome : t.partitaIva, partitaIva: t.partitaIva, conteggio: t.count }
  })
}
