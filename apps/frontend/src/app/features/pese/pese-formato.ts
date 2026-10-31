import type { FontePesata, PesataVista, QualitaNetto } from './pese.service'

const FONTI: Record<FontePesata, string> = {
  STRUMENTO: 'Strumento',
  FILE: 'File dello strumento',
  MANUALE: 'Manuale',
  TARA_ANAGRAFICA: 'Tara dichiarata',
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
const formatoOffset = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO,
  timeZoneName: 'longOffset',
})

/** Offset di Europe/Rome in minuti all'istante dato (+60, +120). */
function offsetRomaMinuti(istanteMs: number): number {
  const nome =
    formatoOffset.formatToParts(new Date(istanteMs)).find(p => p.type === 'timeZoneName')?.value ??
    'GMT'
  const m = /^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/.exec(nome)
  if (!m) throw new Error(`Offset non riconosciuto: ${nome}`)
  if (!m[1]) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0))
}

const due = (n: number) => String(n).padStart(2, '0')

/**
 * Giorno (campi locali di `data`) e ora "HH:mm" letti come ora di Roma, in ISO 8601 con
 * l'offset di quel momento (+01:00 / +02:00), indipendente dal fuso del browser.
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
export const LATO_LUNGO_PX = 2000
export const QUALITA_JPEG = 0.85

/** Sostituibile nei test: il browser reale usa `motoreBrowser`. */
export interface MotoreImmagine {
  ridimensiona(file: File, latoLungoPx: number, qualita: number): Promise<Blob>
}

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
