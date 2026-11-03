/**
 * Funzioni pure della gestione delle causali (ADMIN): etichette, opzioni filtrate per verso,
 * differenze per il PATCH e aritmetica dei giorni. Le regole di coerenza sono quelle del
 * backend (`causali-registro.service.ts`), che resta l'arbitro: qui si evita solo di offrire
 * scelte che il server rifiuterebbe.
 */

import type {
  CausaleAziendaleGestione,
  DatiModificaCausale,
  RuoloMudCausale,
  VersoCausaleApi,
} from './causali-registro.service'

export interface OpzioneEtichettata {
  label: string
  value: string
}

export const ETICHETTE_RUOLO_MUD: Record<RuoloMudCausale, string> = {
  PRODOTTO: 'Prodotto',
  AVVIATO: 'Avviato a recupero o smaltimento',
  RICEVUTO_DA_TERZI: 'Ricevuto da terzi',
  ESCLUSO: 'Escluso dal MUD',
}

const RUOLI_PER_VERSO: Record<VersoCausaleApi, RuoloMudCausale[]> = {
  CARICO: ['PRODOTTO', 'RICEVUTO_DA_TERZI', 'ESCLUSO'],
  SCARICO: ['AVVIATO', 'ESCLUSO'],
}

/** Descrizioni dei codici come nel contratto RENTRI (`causale_operazione`). */
export const ETICHETTE_CODICE_RENTRI: Record<string, string> = {
  DT: "Prodotto o detenuto nell'unità locale",
  NP: 'Nuovo produttore',
  'T*': 'Ricevuto da terzi',
  RE: "Prodotto al di fuori dell'unità locale",
  I: 'Scarico interno',
  aT: 'Scarico a terzi',
  M: 'Scarico per produzione di materiali',
}

const RENTRI_PER_VERSO: Record<VersoCausaleApi, string[]> = {
  CARICO: ['DT', 'NP', 'T*', 'RE'],
  SCARICO: ['I', 'aT', 'M'],
}

export const ETICHETTE_OPERAZIONE: Record<string, string> = {
  R: 'R - Recupero',
  D: 'D - Smaltimento',
}

export function etichettaRuoloMud(ruolo: string | null | undefined): string {
  if (!ruolo) return '—'
  return ETICHETTE_RUOLO_MUD[ruolo as RuoloMudCausale] ?? ruolo
}

export function etichettaCodiceRentri(codice: string | null | undefined): string {
  if (!codice) return '—'
  const d = ETICHETTE_CODICE_RENTRI[codice]
  return d ? `${codice} - ${d}` : codice
}

export function etichettaOperazione(op: string | null | undefined): string {
  if (!op) return '—'
  return ETICHETTE_OPERAZIONE[op] ?? op
}

export function opzioniRuoloMud(verso: VersoCausaleApi): OpzioneEtichettata[] {
  return RUOLI_PER_VERSO[verso].map(v => ({ value: v, label: ETICHETTE_RUOLO_MUD[v] }))
}

export function opzioniCodiceRentri(verso: VersoCausaleApi): OpzioneEtichettata[] {
  return RENTRI_PER_VERSO[verso].map(v => ({ value: v, label: etichettaCodiceRentri(v) }))
}

export function opzioniOperazione(): OpzioneEtichettata[] {
  return Object.entries(ETICHETTE_OPERAZIONE).map(([value, label]) => ({ value, label }))
}

/** L'operazione R/D vale solo per gli scarichi avviati a recupero o smaltimento. */
export function operazioneAmmessa(verso: VersoCausaleApi, ruolo: string | null): boolean {
  return verso === 'SCARICO' && ruolo === 'AVVIATO'
}

export interface ValoriModifica {
  descrizione: string
  ordine: number | null
  ruoloMud: RuoloMudCausale
  codiceRentri: string | null
  operazione: string | null
  fatturabile: boolean
  validaDal: string
}

/**
 * Corpo del PATCH con i soli campi cambiati: un campo uguale all'originale resta assente
 * (invariato); `codiceRentri` e `operazione` azzerati diventano `null`.
 */
export function differenzeModifica(
  originale: CausaleAziendaleGestione,
  v: ValoriModifica
): DatiModificaCausale {
  const out: DatiModificaCausale = {}
  const descrizione = v.descrizione.trim()
  if (descrizione !== originale.descrizione) out.descrizione = descrizione
  if (v.ordine !== null && v.ordine !== originale.ordine) out.ordine = v.ordine
  if (v.ruoloMud !== originale.ruoloMud) out.ruoloMud = v.ruoloMud
  if ((v.codiceRentri || null) !== originale.codiceRentri) out.codiceRentri = v.codiceRentri || null
  if ((v.operazione || null) !== originale.operazione) out.operazione = v.operazione || null
  if (v.fatturabile !== originale.fatturabile) out.fatturabile = v.fatturabile
  if (v.validaDal && v.validaDal !== originale.validaDal) out.validaDal = v.validaDal
  return out
}

/** Giorno successivo di un 'AAAA-MM-GG', calcolato in UTC: nessuno spostamento di fuso. */
export function giornoSuccessivo(giorno: string): string {
  const [a, m, g] = giorno.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1, g + 1))
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

/** Inizio proposto per una nuova versione: max(oggi, giorno dopo l'ultimo uso, giorno dopo l'inizio). */
export function inizioProposto(
  oggi: string,
  ultimoUso: string | null,
  validaDal?: string | null
): string {
  let g = oggi
  if (ultimoUso && giornoSuccessivo(ultimoUso) > g) g = giornoSuccessivo(ultimoUso)
  if (validaDal && giornoSuccessivo(validaDal) > g) g = giornoSuccessivo(validaDal)
  return g
}

/** Ultimo giorno proposto per la chiusura: max(oggi, inizio, ultimo uso). */
export function chiusuraProposta(
  oggi: string,
  validaDal: string,
  ultimoUso: string | null
): string {
  let g = oggi
  if (validaDal > g) g = validaDal
  if (ultimoUso && ultimoUso > g) g = ultimoUso
  return g
}

/** Messaggio e codice di un errore HTTP del backend (400/403/404/409). */
export function leggiErroreCausali(err: any): { messaggio: string; codice: string | null } {
  const corpo = err?.error
  const m = corpo?.message ?? err?.message
  const messaggio = Array.isArray(m)
    ? m.join(' · ')
    : typeof m === 'string' && m
      ? m
      : 'Operazione sulle causali non riuscita'
  const codice = typeof corpo?.error === 'string' ? corpo.error : null
  return { messaggio, codice }
}

/** Ultima versione (per validaDal) di ogni coppia verso|codice. */
export function idUltimeVersioni(righe: CausaleAziendaleGestione[]): Set<string> {
  const ultime = new Map<string, CausaleAziendaleGestione>()
  for (const r of righe) {
    const k = `${r.verso}|${r.codice}`
    const p = ultime.get(k)
    if (!p || r.validaDal > p.validaDal) ultime.set(k, r)
  }
  return new Set([...ultime.values()].map(r => r.id))
}
