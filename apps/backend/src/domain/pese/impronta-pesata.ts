import { createHash } from 'crypto'
import type { FontePesataDominio } from './tipi'

type Opzionale<T> = T | null | undefined

export interface CampiImprontaPesata {
  tenantId: string
  accessoId: string
  ordine: number
  fonte: FontePesataDominio
  strumentoId?: Opzionale<string>
  strumentoEsterno?: Opzionale<string>
  alibiId?: Opzionale<string>
  /** numero o stringa decimale (es. `Prisma.Decimal.toFixed(2)`) */
  pesoKg: number | string
  stabile: boolean
  oraStrumento?: Opzionale<Date>
  oraRicezione: Date
  operatoreId?: Opzionale<string>
  allegatoSha256?: Opzionale<string>
  automezzoId?: Opzionale<string>
  taraAggiornataIl?: Opzionale<Date>
  chiaveIdempotenza: string
}

export interface CampiImprontaRettifica {
  tenantId: string
  pesataId: string
  numero: number
  pesoPrecedenteKg: number | string
  pesoNuovoKg: number | string
  motivo: string
  autoreId: string
  allegatoSha256?: Opzionale<string>
  createdAt: Date
}

/** Peso a 2 decimali con il punto, via centesimi interi (mai `toString()` di un float). */
export function formattaDecimaleCanonico(n: number | string): string {
  const v = typeof n === 'string' ? (/^-?\d+(\.\d+)?$/.test(n.trim()) ? Number(n) : NaN) : n
  if (!Number.isFinite(v)) throw new Error('Valore decimale non valido per l’impronta.')
  const c = Math.round(Math.abs(v) * 100)
  const intero = Math.floor(c / 100)
  const dec = String(c % 100).padStart(2, '0')
  return `${v < 0 && c > 0 ? '-' : ''}${intero}.${dec}`
}

const iso = (d: Opzionale<Date>): string => (d ? d.toISOString() : '')
const txt = (s: Opzionale<string>): string => s ?? ''
const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

/** Impronta di una pesata (nessuna catena fra righe). */
export function improntaPesata(c: CampiImprontaPesata): string {
  return sha256(
    'p1|' +
      [
        c.tenantId,
        c.accessoId,
        String(c.ordine),
        c.fonte,
        txt(c.strumentoId),
        txt(c.strumentoEsterno),
        txt(c.alibiId),
        formattaDecimaleCanonico(c.pesoKg),
        c.stabile ? '1' : '0',
        iso(c.oraStrumento),
        c.oraRicezione.toISOString(),
        txt(c.operatoreId),
        txt(c.allegatoSha256),
        txt(c.automezzoId),
        iso(c.taraAggiornataIl),
        c.chiaveIdempotenza,
      ].join('|')
  )
}

/** Impronta di una rettifica. */
export function improntaRettifica(c: CampiImprontaRettifica): string {
  return sha256(
    'r1|' +
      [
        c.tenantId,
        c.pesataId,
        String(c.numero),
        formattaDecimaleCanonico(c.pesoPrecedenteKg),
        formattaDecimaleCanonico(c.pesoNuovoKg),
        c.motivo,
        c.autoreId,
        txt(c.allegatoSha256),
        c.createdAt.toISOString(),
      ].join('|')
  )
}
