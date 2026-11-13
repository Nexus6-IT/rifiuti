import type { FontePesata, PesataVista, QualitaNetto } from './pese.service'

const FONTI: Record<FontePesata, string> = {
  STRUMENTO: 'Strumento',
  FILE: 'File dello strumento',
  MANUALE: 'Manuale',
  TARA_ANAGRAFICA: 'Tara dichiarata',
  SIMULATA: 'Simulata',
}

const QUALITA: Record<QualitaNetto, string> = {
  DUE_PESATE: 'Due pesate',
  TARA_DICHIARATA: 'Tara dichiarata',
  PESATA_SINGOLA: 'Pesata singola',
}

export const etichettaFonte = (fonte: FontePesata | string): string =>
  FONTI[fonte as FontePesata] ?? fonte

export const etichettaQualita = (q: QualitaNetto | null): string => (q ? QUALITA[q] : '')

/** Badge fissi di una pesata (D16): chi legge deve vedere subito che il dato e' manuale. */
export function badgePesata(p: PesataVista): string[] {
  const badge: string[] = []
  if (p.fonte === 'MANUALE') badge.push('Manuale')
  if (p.fonte === 'TARA_ANAGRAFICA') badge.push('Tara dichiarata')
  if (p.rettifiche.length > 0) badge.push('Rettificato')
  if (p.fonte === 'MANUALE' && !p.allegato) badge.push('Senza prova documentale')
  if (!p.integra) badge.push('Dato alterato')
  return badge
}

const FUSO = 'Europe/Rome'
// Campi dell'ora di Roma a un istante dato; niente `longOffset` (non ovunque supportato).
const formatoCampiRoma = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
})

/** Offset di Europe/Rome in minuti all'istante dato (+60, +120). */
function offsetRomaMinuti(istanteMs: number): number {
  const c: Record<string, number> = {}
  for (const p of formatoCampiRoma.formatToParts(new Date(istanteMs))) {
    if (p.type !== 'literal') c[p.type] = Number(p.value)
  }
  const comeUtc = Date.UTC(c['year'], c['month'] - 1, c['day'], c['hour'], c['minute'], c['second'])
  return Math.round((comeUtc - Math.floor(istanteMs / 1000) * 1000) / 60_000)
}

const due = (n: number) => String(n).padStart(2, '0')

/**
 * Giorno (campi locali di `data`) e ora "HH:mm" letti come ora di Roma, in ISO 8601 con
 * l'offset di quel momento (+01:00 / +02:00), indipendente dal fuso del browser.
 * Casi di cambio d'ora: un'ora inesistente (29/03 02:30) prende +01:00, cioe' l'istante delle
 * 03:30 legali; un'ora ripetuta (25/10 02:30) prende la seconda occorrenza (+01:00).
 */
export function oraLocaleInIso(data: Date, ora: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(ora)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('Ora non valida (HH:mm).')
  const a = data.getFullYear()
  const mese = data.getMonth()
  const g = data.getDate()
  const ipotesi = Date.UTC(a, mese, g, Number(m[1]), Number(m[2]))
  // Primo giro con l'offset all'ipotesi, secondo giro all'istante risultante (cambio d'ora).
  const o1 = offsetRomaMinuti(ipotesi)
  const o2 = offsetRomaMinuti(ipotesi - o1 * 60_000)
  const segno = o2 < 0 ? '-' : '+'
  const abs = Math.abs(o2)
  return `${a}-${due(mese + 1)}-${due(g)}T${m[1]}:${m[2]}:00${segno}${due(Math.floor(abs / 60))}:${due(abs % 60)}`
}

export const SOGLIA_RIDIMENSIONAMENTO_BYTE = 1_500_000
export const LIMITE_ALLEGATO_BYTE = 4 * 1024 * 1024
export const LATO_LUNGO_PX = 2000
export const QUALITA_JPEG = 0.85
export const MSG_TIPO_ALLEGATO = 'Sono ammessi solo foto JPEG o PNG e documenti PDF.'
export const MSG_ALLEGATO_GRANDE = "L'allegato supera i 4 MB."

/** Sostituibile nei test: il browser reale usa `motoreBrowser`. */
export interface MotoreImmagine {
  ridimensiona(file: File, latoLungoPx: number, qualita: number): Promise<Blob>
}

/** La conversione via canvas ricodifica l'immagine e ne elimina l'EXIF (posizione, orientamento). */
export const motoreBrowser: MotoreImmagine = {
  async ridimensiona(file, latoLungoPx, qualita) {
    const bitmap = await createImageBitmap(file)
    try {
      const scala = Math.min(1, latoLungoPx / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scala))
      canvas.height = Math.max(1, Math.round(bitmap.height * scala))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Impossibile ridimensionare la foto.')
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      return await new Promise<Blob>((ok, ko) =>
        canvas.toBlob(
          b => (b ? ok(b) : ko(new Error('Impossibile ridimensionare la foto.'))),
          'image/jpeg',
          qualita
        )
      )
    } finally {
      bitmap.close()
    }
  },
}

/** Foto oltre 1,5 MB: lato lungo 2000 px, JPEG 0,85. I PDF e le foto piccole restano intatti. */
export async function ridimensionaImmagine(
  file: File,
  motore: MotoreImmagine = motoreBrowser
): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size <= SOGLIA_RIDIMENSIONAMENTO_BYTE) return file
  return motore.ridimensiona(file, LATO_LUNGO_PX, QUALITA_JPEG)
}

const TIPI_IMMAGINE = ['image/jpeg', 'image/png']

/** Nome con l'estensione giusta per il tipo (la ricodifica produce un JPEG). */
function nomeConEstensione(nome: string, estensione: string): string {
  const base = nome.replace(/\.[^./\\]*$/, '') || 'allegato'
  return `${base}.${estensione}`
}

/**
 * Prepara l'allegato per l'invio con le stesse regole del backend: solo JPEG, PNG e PDF (altro
 * -> errore italiano subito), foto ridimensionate se grandi, al massimo 4 MiB dopo la
 * preparazione (anche per i PDF). Restituisce il blob e il nome da inviare.
 */
export async function preparaAllegato(
  file: File,
  motore: MotoreImmagine = motoreBrowser
): Promise<{ blob: Blob; nomeFile: string }> {
  const pdf = file.type === 'application/pdf'
  if (!pdf && !TIPI_IMMAGINE.includes(file.type)) throw new Error(MSG_TIPO_ALLEGATO)
  let blob: Blob = file
  let nomeFile = file.name
  if (!pdf && file.size > SOGLIA_RIDIMENSIONAMENTO_BYTE) {
    blob = await ridimensionaImmagine(file, motore)
    if (blob !== file) nomeFile = nomeConEstensione(file.name, 'jpg')
  }
  if (blob.size > LIMITE_ALLEGATO_BYTE) throw new Error(MSG_ALLEGATO_GRANDE)
  return { blob, nomeFile }
}

const CARATTERI_TARGA = /^[A-Za-z0-9\s.-]+$/
const FORMATO_TARGA = /^[A-Z0-9]{2,15}$/

/** Come il backend (`domain/pese/targa.ts`): la forma che verra' salvata, null se non valida. */
export function normalizzaTarga(s: string): string | null {
  if (!CARATTERI_TARGA.test(s)) return null
  const t = s.toUpperCase().replace(/[\s.-]/g, '')
  return FORMATO_TARGA.test(t) ? t : null
}

export const ANNI_VERIFICAZIONE = 3
export const GIORNI_TARA_VECCHIA = 365

/** Verificazione scaduta se l'ultima e' piu' vecchia di 3 anni (`data` e `oggi` AAAA-MM-GG). */
export function verificazioneScaduta(data: string, oggi: string): boolean {
  const scadenza = `${Number(data.slice(0, 4)) + ANNI_VERIFICAZIONE}${data.slice(4, 10)}`
  return scadenza < oggi
}

const formatoGiornoRoma = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Oggi (o l'istante dato) come 'AAAA-MM-GG' nel calendario di Roma. */
export const giornoRoma = (istante: Date = new Date()): string => formatoGiornoRoma.format(istante)

/** Tara aggiornata l'ultima volta oltre un anno fa. */
export function taraVecchia(taraAggiornataIl: string | null, adesso: Date = new Date()): boolean {
  if (!taraAggiornataIl) return false
  return (
    (adesso.getTime() - new Date(taraAggiornataIl).getTime()) / 86_400_000 > GIORNI_TARA_VECCHIA
  )
}

// 'always': l'it-IT di default non raggruppa le migliaia a 4 cifre (8000), qui si vuole 8.000
const formatoKg = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 2,
  useGrouping: 'always',
} as unknown as Intl.NumberFormatOptions)
export const formattaKg = (n: number): string => `${formatoKg.format(n)} kg`

const formatoData = new Intl.DateTimeFormat('it-IT', {
  timeZone: FUSO,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
/** Data (ISO con ora o AAAA-MM-GG) come GG/MM/AAAA in ora di Roma. */
export const dataItalianaDa = (iso: string): string =>
  formatoData.format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso))

/** Messaggio del backend (400/403/404/409/422) o, in mancanza, uno generico. */
export function messaggioErrorePese(err: any, generico = 'Operazione non riuscita.'): string {
  const m = err?.error?.message
  if (Array.isArray(m)) return m.join(' · ')
  return typeof m === 'string' && m ? m : generico
}

/** Il backend ha riconosciuto la chiave di idempotenza: la pesata era gia' stata registrata. */
export const MESSAGGIO_GIA_REGISTRATA =
  'Pesata già registrata in precedenza: controllare i dati mostrati'

/**
 * UUID v4. `crypto.randomUUID` esiste solo in contesti sicuri (https/localhost): in http su
 * LAN manca, quindi si ripiega su `getRandomValues`, disponibile ovunque.
 */
export interface MotoreUuid {
  getRandomValues(a: Uint8Array): Uint8Array
  randomUUID?: () => string
}

export function uuidV4(motore: MotoreUuid = crypto as unknown as MotoreUuid): string {
  if (typeof motore.randomUUID === 'function') return motore.randomUUID()
  const b = motore.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// --- agenti di pesa (4.8b) -------------------------------------------------------------------

/** Oltre questo tempo senza battito un agente attivo e' "non in linea". */
export const MINUTI_NON_IN_LINEA = 3
/** Scarto dell'orologio del PC oltre il quale lo si segnala. */
export const SECONDI_SCARTO_OROLOGIO = 60

/** "adesso", "5 min fa", "3 h fa", "2 g fa" rispetto a `adesso`; "mai" senza contatto. */
export function tempoTrascorso(iso: string | null, adesso: Date = new Date()): string {
  if (!iso) return 'mai'
  const s = Math.max(0, Math.round((adesso.getTime() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'adesso'
  const min = Math.floor(s / 60)
  if (min < 60) return `${min} min fa`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h fa`
  return `${Math.floor(h / 24)} g fa`
}

/** "Da 4 min" per "non in linea da ...": senza il "fa" finale. */
export const tempoDa = (iso: string | null, adesso: Date = new Date()): string => {
  const t = tempoTrascorso(iso, adesso)
  return t === 'mai' ? 'sempre' : t === 'adesso' ? 'meno di un minuto' : t.replace(/ fa$/, '')
}

/** Scarto dell'orologio da mostrare: solo se oltre la soglia, con il segno (+ = PC avanti). */
export function scartoOrologioTesto(s: number | null): string | null {
  if (s === null || Math.abs(s) <= SECONDI_SCARTO_OROLOGIO) return null
  const min = Math.round(Math.abs(s) / 60)
  const durata = min >= 1 ? `${min} min` : `${Math.abs(s)} s`
  return `Orologio del PC ${s > 0 ? 'avanti' : 'indietro'} di ${durata}`
}

/** Conto alla rovescia "mm:ss" fino alla scadenza; "scaduto" a tempo finito. */
export function contoAllaRovescia(scadeIl: string, adesso: Date = new Date()): string {
  const s = Math.ceil((new Date(scadeIl).getTime() - adesso.getTime()) / 1000)
  if (s <= 0) return 'scaduto'
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Indirizzo del backend da dare all'agente: assoluto e con `/api/v1` in coda (e' gia' in apiUrl). */
export function indirizzoServerAgente(apiUrl: string, origine: string): string {
  return new URL(apiUrl, origine).href.replace(/\/+$/, '')
}
