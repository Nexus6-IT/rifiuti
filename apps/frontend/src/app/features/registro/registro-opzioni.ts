import { UNITA_GIACENZA } from './giacenze-iniziali-dialog.component'
import {
  CAUSALE_LABELS,
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
  CausaleMovimento,
  STATI_FISICI,
  TipoMovimento,
} from './registro.service'

/**
 * Opzioni e conversioni del form di un movimento, condivise fra la registrazione
 * (`RegistroComponent`) e la rettifica (`CorreggiMovimentoDialogComponent`): un solo elenco
 * di causali per tipo, di stati fisici e di unità (quello dei FIR, `UNITA_GIACENZA`), e un solo modo di trasformare un giorno.
 */

export interface OpzioneRegistro<T = string> {
  label: string
  value: T
}

/** Causali valide per il tipo di movimento, con le etichette leggibili. */
export function opzioniCausali(tipo: TipoMovimento): OpzioneRegistro<CausaleMovimento>[] {
  const causali = tipo === 'CARICO' ? CAUSALI_CARICO : CAUSALI_SCARICO
  return causali.map(c => ({ label: CAUSALE_LABELS[c], value: c }))
}

export const OPZIONI_STATO_FISICO: OpzioneRegistro[] = STATI_FISICI.map(s => ({
  label: s,
  value: s,
}))

/**
 * Stati fisici selezionabili. Un valore storico fuori elenco (o in maiuscolo, come lo salva
 * il backend per le giacenze) resta selezionabile: si riconduce all'etichetta dell'elenco se
 * coincide ignorando le maiuscole, altrimenti si aggiunge com'è.
 */
export function opzioniStatoFisico(corrente?: string | null): OpzioneRegistro[] {
  const lista = [...OPZIONI_STATO_FISICO]
  if (corrente && !lista.some(o => o.value === corrente)) {
    lista.push({ label: corrente, value: corrente })
  }
  return lista
}

/** Porta uno stato fisico al valore dell'elenco se coincide ignorando le maiuscole. */
export function normalizzaStatoFisico(stato?: string | null): string | null {
  if (!stato) return null
  return STATI_FISICI.find(s => s.toUpperCase() === stato.toUpperCase()) ?? stato
}

/** Unità selezionabili: un'unità storica fuori elenco (es. LITRI) resta selezionabile. */
export function opzioniUnita(corrente?: string | null): OpzioneRegistro[] {
  const lista = [...UNITA_GIACENZA]
  // Il confronto ignora le maiuscole solo per decidere se aggiungere la voce: il valore resta quello originale.
  if (corrente && !lista.some(u => u.value === corrente.toUpperCase())) {
    lista.push({ label: corrente, value: corrente })
  }
  return lista
}

/** Giorno di calendario locale 'AAAA-MM-GG' da una `Date` (nessuno spostamento di fuso). */
export function giornoLocale(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** `Date` locale a mezzanotte dal giorno 'AAAA-MM-GG' (o dai primi 10 caratteri di un ISO). */
export function dataDaGiorno(giorno: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(giorno)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
