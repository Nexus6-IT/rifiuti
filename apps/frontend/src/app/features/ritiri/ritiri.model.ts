/**
 * Modello dei ritiri programmati (4.7, contratto di P7 §3 e §9). I numeri decimali viaggiano come
 * stringa (`quantitaPresunta`), le date come `AAAA-MM-GG` del giorno italiano. Lo stato visibile
 * lo calcola il backend (mai salvato): qui si traduce solo in parole e toni.
 */
import { TonoStato } from '../../shared/models/stati-fir'
import { ProvenienzaRifiuto, TipoTratta } from '../fir/fir.service'

export type StatoRitiro = 'PROGRAMMATO' | 'NON_ESEGUITO' | 'ANNULLATO'
export type FasciaRitiro = 'MATTINA' | 'POMERIGGIO'
export type StatoVisibileRitiro =
  | 'DA_GENERARE'
  | 'FIR_BOZZA'
  | 'FIR_EMESSO'
  | 'IN_TRASPORTO'
  | 'CONSEGNATO'
  | 'NON_ESEGUITO'
  | 'ANNULLATO'

export interface RitiroSoggetto {
  id: string
  nome: string
}

export interface RitiroProduttore extends RitiroSoggetto {
  sedeId: string
  indirizzo: string
}

export interface RitiroDestinatario extends RitiroSoggetto {
  sedeId: string
}

export interface RitiroFir {
  id: string
  numero: string | null
  status: string
}

export interface RitiroVista {
  id: string
  /** AAAA-MM-GG */
  dataPrevista: string
  fascia: FasciaRitiro | null
  ordineGiro: number | null
  produttore: RitiroProduttore
  trasportatore: RitiroSoggetto
  destinatario: RitiroDestinatario
  automezzo: { id: string; targa: string } | null
  cerCode: string
  descrizione: string
  /** Decimale come stringa (es. «1250.50»). */
  quantitaPresunta: string
  unita: string
  stato: StatoRitiro
  statoVisibile: StatoVisibileRitiro
  motivo: string | null
  fir: RitiroFir | null
  /** Solo nel dettaglio: i FIR annullati generati prima. */
  firPrecedenti?: RitiroFir[]
  serieId: string | null
  versione: number
  /** Campi del rifiuto e note: ci sono nel dettaglio, servono alla modifica. */
  statoFisico?: string | null
  caratteristichePericolo?: string | null
  numeroColli?: number | null
  codiceOperazione?: string | null
  provenienza?: ProvenienzaRifiuto | null
  tipoTratta?: TipoTratta | null
  annotazioni?: string | null
  noteInterne?: string | null
}

export interface ElencoRitiri {
  righe: RitiroVista[]
  totale: number
}

export interface FiltriRitiri {
  /** AAAA-MM-GG */
  dal?: string
  al?: string
  automezzoId?: string
  trasportatoreId?: string
  produttoreId?: string
  cerCode?: string
  statoVisibile?: StatoVisibileRitiro
  pagina?: number
  dimensione?: number
}

/** Ripetizione: ogni N giorni oppure ogni N settimane, fino a una data (al massimo 52 occorrenze). */
export interface RipetizioneRitiro {
  ogniGiorni?: number
  ogniSettimane?: number
  /** AAAA-MM-GG, inclusa */
  fino: string
}

/** Campi comuni a creazione e modifica. */
export interface DatiRitiro {
  dataPrevista: string
  fascia?: FasciaRitiro | null
  ordineGiro?: number | null
  produttoreId: string
  produttoreSedeId: string
  trasportatoreId: string
  destinatarioId: string
  destinatarioSedeId: string
  automezzoId?: string | null
  cerCode: string
  descrizione: string
  statoFisico?: string | null
  caratteristichePericolo?: string | null
  numeroColli?: number | null
  quantitaPresunta: string
  unita: string
  codiceOperazione?: string | null
  /** Obbligatori: il FIR non ha default e la generazione non deve fallire dopo. */
  provenienza: ProvenienzaRifiuto
  tipoTratta: TipoTratta
  annotazioni?: string | null
  noteInterne?: string | null
}

export interface NuovoRitiro extends DatiRitiro {
  /** UUID del form: un nuovo tentativo con la stessa chiave non crea doppioni. */
  chiaveIdempotenza: string
  ripetizione?: RipetizioneRitiro
}

export interface ModificaRitiro extends DatiRitiro {
  versione: number
}

export interface RisultatoCreazioneRitiri {
  ritiri: RitiroVista[]
  giaRegistrato: boolean
}

export type EsitoGenerazione = 'CREATO' | 'GIA_GENERATO' | 'ERRORE'

export interface EsitoGenerazioneRiga {
  ritiroId: string
  esito: EsitoGenerazione
  firId?: string
  /** RITIRO_NON_PROGRAMMATO, CER_NON_VALIDO, SEDE_NON_VALIDA, ANAGRAFICA_MANCANTE, ERRORE_INTERNO */
  codice?: string
  messaggio?: string
}

export interface RisultatoGenerazioneFir {
  esiti: EsitoGenerazioneRiga[]
}

export const MAX_OCCORRENZE = 52
export const MAX_RITIRI_PER_LOTTO = 100

export const ETICHETTA_STATO: Readonly<Record<StatoVisibileRitiro, string>> = {
  DA_GENERARE: 'Da generare',
  FIR_BOZZA: 'FIR in bozza',
  FIR_EMESSO: 'FIR emesso',
  IN_TRASPORTO: 'In trasporto',
  CONSEGNATO: 'Consegnato',
  NON_ESEGUITO: 'Non eseguito',
  ANNULLATO: 'Annullato',
}

export const TONO_STATO_RITIRO: Readonly<Record<StatoVisibileRitiro, TonoStato>> = {
  DA_GENERARE: 'warn',
  FIR_BOZZA: 'none',
  FIR_EMESSO: 'todo',
  IN_TRASPORTO: 'warn',
  CONSEGNATO: 'ok',
  NON_ESEGUITO: 'err',
  ANNULLATO: 'none',
}

export const ETICHETTA_FASCIA: Readonly<Record<FasciaRitiro, string>> = {
  MATTINA: 'Mattina',
  POMERIGGIO: 'Pomeriggio',
}

export const MESSAGGI_CODICE_ESITO: Readonly<Record<string, string>> = {
  RITIRO_NON_TROVATO: 'Il ritiro non esiste più.',
  RITIRO_NON_PROGRAMMATO: 'Il ritiro non è più programmato.',
  CER_NON_VALIDO: 'Il codice CER non è valido per un formulario.',
  SEDE_NON_VALIDA: 'Una delle sedi non appartiene alla ditta indicata.',
  ANAGRAFICA_MANCANTE: 'Manca un produttore, un trasportatore o un destinatario.',
  ERRORE_INTERNO: 'Errore interno: riprovare più tardi.',
}

/** Un ritiro si può spuntare per la generazione solo se non ha ancora un FIR attivo. */
export function generabile(r: RitiroVista): boolean {
  return r.stato === 'PROGRAMMATO' && r.statoVisibile === 'DA_GENERARE'
}

/** Si può spuntare ogni ritiro ancora programmato: da generare, da emettere o da stampare. */
export function selezionabile(r: RitiroVista): boolean {
  return r.stato === 'PROGRAMMATO'
}

/** FIR in bozza (ancora senza numero): si può emettere in serie. */
export function daEmettereInSerie(r: RitiroVista): boolean {
  return r.stato === 'PROGRAMMATO' && r.statoVisibile === 'FIR_BOZZA' && r.fir !== null
}

/** Modifica, non eseguito e annullo solo senza FIR attivo (il backend ricontrolla con 409). */
export function modificabile(r: RitiroVista): boolean {
  return r.stato === 'PROGRAMMATO' && r.fir === null
}

/** «2026-11-12» → «12/11/2026», senza passare da `Date` (nessuno slittamento di fuso). */
export function dataItaliana(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '')
}

/** Quantità in it-IT con le cifre che ha («1250.50» → «1.250,50»); il testo non numerico resta com'è. */
export function quantitaItaliana(q: string | null | undefined): string {
  if (q == null || q.trim() === '' || !Number.isFinite(Number(q))) return q ?? ''
  const testo = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
    useGrouping: false,
  }).format(Number(q))
  // il separatore delle migliaia anche sotto le 5 cifre (CLDR it non raggruppa 1250)
  return testo.replace(/^(-?\d+)/, intero => intero.replace(/\B(?=(\d{3})+(?!\d))/g, '.'))
}

function dataUtc(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCMonth() === +m[2] - 1 ? d : null
}

/**
 * Anteprima delle date di una ripetizione (stessa regola del backend: la prima data è quella di
 * partenza, poi ogni N giorni o settimane fino a `fino`, al massimo 52). Aritmetica in UTC su
 * giorni interi, senza fuso. Lista vuota se la data di partenza o l'intervallo non sono validi.
 */
export function anteprimaDate(partenza: string, r: RipetizioneRitiro): string[] {
  const inizio = dataUtc(partenza)
  const fine = dataUtc(r.fino)
  const passo = r.ogniSettimane ? r.ogniSettimane * 7 : (r.ogniGiorni ?? 0)
  if (!inizio || !fine || !Number.isInteger(passo) || passo < 1 || fine < inizio) return []
  const date: string[] = []
  for (let i = 0; i < MAX_OCCORRENZE; i++) {
    const d = new Date(inizio.getTime() + i * passo * 86_400_000)
    if (d > fine) break
    date.push(d.toISOString().slice(0, 10))
  }
  return date
}

/**
 * Messaggio per l'utente da un errore HTTP dei ritiri: i 409 noti hanno una frase propria, poi il
 * messaggio del backend (mai id), poi il ripiego.
 */
export function messaggioErroreRitiri(err: unknown, ripiego: string): string {
  const e = err as {
    status?: number
    error?: { error?: string; message?: string | string[] }
  } | null
  // Il filtro globale mette il codice macchina in `error` (non in `code`).
  const codice = e?.error?.error
  if (codice === 'RITIRO_CON_FIR') return 'Il ritiro ha un FIR attivo: annulla prima il FIR.'
  if (codice === 'RITIRO_MODIFICATO' || (e?.status === 409 && !e.error?.message)) {
    return 'Il ritiro è stato modificato da un altro utente: ricarica l’elenco e riprova.'
  }
  const m = e?.error?.message
  const testo = Array.isArray(m) ? m.filter(x => typeof x === 'string').join(' ') : m
  return typeof testo === 'string' && testo.trim() ? testo : ripiego
}
