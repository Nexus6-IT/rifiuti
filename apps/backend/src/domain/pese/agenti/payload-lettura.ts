import { verify, type KeyObject } from 'crypto'
import { decodificaBase64Rigorosa } from './credenziali-agente'

/**
 * Payload firmato di una lettura, versione 1 (Fase 4 pezzo 8b, D6). Dominio puro.
 *
 * Il server NON ricostruisce mai il payload: l'agente invia i byte esatti che ha firmato, qui si
 * verifica la firma su quei byte e SOLO DOPO si interpreta il JSON. Nessuna canonicalizzazione
 * fra Go e JavaScript. Contratto fra linguaggi: `tools/agente-pesa/testdata/contratto/lettura-v1.json`.
 */

export const PREFISSO_FIRMA_LETTURA = 'wasteflow-lettura-pesa-v1\n'
export const BYTE_MASSIMI_PAYLOAD = 2048
export const BYTE_MASSIMI_GREZZO = 256
export const PESO_MASSIMO_CENTESIMI = 9_999_999_999

export interface PayloadLettura {
  v: 1
  agenteId: string
  strumentoId: string
  chiaveIdempotenza: string
  sequenza: number
  /** stringa fissa `^\d{1,8}\.\d{2}$` */
  pesoKg: string
  pesoCentesimi: number
  unita: 'kg'
  stabile: boolean
  alibiId: string | null
  oraStrumento: Date | null
  oraAgente: Date
  driver: string
  simulata: boolean
  /** frame dello strumento in base64 (≤ 256 byte) o null */
  grezzo: string | null
}

export type EsitoLetturaPayload =
  | { ok: true; payload: PayloadLettura; bytes: Buffer }
  | { ok: false; codice: 'FIRMA_NON_VALIDA' | 'PAYLOAD_NON_VALIDO'; dettaglio: string }

const CHIAVI = [
  'v',
  'agenteId',
  'strumentoId',
  'chiaveIdempotenza',
  'sequenza',
  'pesoKg',
  'unita',
  'stabile',
  'alibiId',
  'oraStrumento',
  'oraAgente',
  'driver',
  'simulata',
  'grezzo',
] as const

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const RE_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RE_PESO = /^\d{1,8}\.\d{2}$/
const RE_DRIVER = /^[A-Z0-9_-]{2,30}$/
const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/

const nonValido = (dettaglio: string): EsitoLetturaPayload => ({
  ok: false,
  codice: 'PAYLOAD_NON_VALIDO',
  dettaglio,
})

/** ISO 8601 con offset obbligatorio e componenti reali (Date da sola «arrotonda» il 31 febbraio). */
function dataIsoConOffset(s: unknown): Date | null {
  if (typeof s !== 'string') return null
  const m = RE_ISO.exec(s)
  if (!m) return null
  const [anno, mese, giorno, ore, minuti, secondi] = m.slice(1, 7).map(Number)
  if (mese < 1 || mese > 12 || ore > 23 || minuti > 59 || secondi > 59) return null
  const giorniDelMese = new Date(Date.UTC(anno, mese, 0)).getUTCDate()
  if (giorno < 1 || giorno > giorniDelMese) return null
  const off = m[7]
  if (off !== 'Z') {
    const [oh, om] = off.slice(1).split(':').map(Number)
    if (oh > 23 || om > 59) return null
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

function alibiValido(v: unknown): v is string {
  // Più largo dell'agente (ASCII stampabile): niente caratteri di controllo, 1..40, non vuoto.
  if (typeof v !== 'string' || v.length < 1 || v.length > 40 || v.trim() === '') return false
  for (const ch of v) {
    const c = ch.codePointAt(0) as number
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

function interpreta(bytes: Buffer): EsitoLetturaPayload {
  // TextDecoder toglie un BOM iniziale in silenzio: i byte conservati e quelli interpretati
  // potrebbero divergere. L'agente non ne scrive mai: si rifiuta.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return nonValido('BOM iniziale non ammesso')
  }
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return nonValido('JSON non valido')
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return nonValido('il payload deve essere un oggetto')
  }
  const o = json as Record<string, unknown>
  const chiavi = Object.keys(o)
  if (chiavi.length !== CHIAVI.length || !CHIAVI.every(k => k in o)) {
    return nonValido('chiavi diverse da quelle della versione 1')
  }
  if (o.v !== 1) return nonValido('versione non supportata')
  if (typeof o.agenteId !== 'string' || !RE_UUID.test(o.agenteId)) return nonValido('agenteId')
  if (typeof o.strumentoId !== 'string' || !RE_UUID.test(o.strumentoId))
    return nonValido('strumentoId')
  if (typeof o.chiaveIdempotenza !== 'string' || !RE_UUID_V4.test(o.chiaveIdempotenza)) {
    return nonValido('chiaveIdempotenza')
  }
  if (typeof o.sequenza !== 'number' || !Number.isSafeInteger(o.sequenza) || o.sequenza < 1) {
    return nonValido('sequenza')
  }
  if (typeof o.pesoKg !== 'string' || !RE_PESO.test(o.pesoKg)) return nonValido('pesoKg')
  if (o.unita !== 'kg') return nonValido('unita')
  if (typeof o.stabile !== 'boolean') return nonValido('stabile')
  if (o.alibiId !== null && !alibiValido(o.alibiId)) return nonValido('alibiId')
  const oraAgente = dataIsoConOffset(o.oraAgente)
  if (!oraAgente) return nonValido('oraAgente')
  let oraStrumento: Date | null = null
  if (o.oraStrumento !== null) {
    oraStrumento = dataIsoConOffset(o.oraStrumento)
    if (!oraStrumento) return nonValido('oraStrumento')
  }
  if (typeof o.driver !== 'string' || !RE_DRIVER.test(o.driver)) return nonValido('driver')
  if (typeof o.simulata !== 'boolean' || o.simulata !== (o.driver === 'SIMULATA')) {
    return nonValido('simulata incoerente col driver')
  }
  if (o.grezzo !== null) {
    const g = typeof o.grezzo === 'string' ? decodificaBase64Rigorosa(o.grezzo) : null
    if (!g || g.length > BYTE_MASSIMI_GREZZO) return nonValido('grezzo')
  }
  const [intero, dec] = o.pesoKg.split('.')
  return {
    ok: true,
    bytes,
    payload: {
      v: 1,
      agenteId: o.agenteId,
      strumentoId: o.strumentoId,
      chiaveIdempotenza: o.chiaveIdempotenza,
      sequenza: o.sequenza,
      pesoKg: o.pesoKg,
      pesoCentesimi: Number(intero) * 100 + Number(dec),
      unita: 'kg',
      stabile: o.stabile,
      alibiId: o.alibiId,
      oraStrumento,
      oraAgente,
      driver: o.driver,
      simulata: o.simulata,
      grezzo: o.grezzo as string | null,
    },
  }
}

/**
 * Verifica la firma Ed25519 sui byte `PREFISSO + payload` e solo poi interpreta il JSON.
 * Un payload oltre 2048 byte o con base64 malformato è `PAYLOAD_NON_VALIDO` senza verificare.
 */
export function leggiPayloadLettura(
  payloadB64: string,
  firmaB64: string,
  chiavePubblica: KeyObject
): EsitoLetturaPayload {
  const bytes = decodificaBase64Rigorosa(payloadB64)
  if (!bytes) return nonValido('payload non è base64')
  if (bytes.length < 2 || bytes.length > BYTE_MASSIMI_PAYLOAD)
    return nonValido('lunghezza del payload')
  const firma = decodificaBase64Rigorosa(firmaB64)
  if (!firma || firma.length !== 64) {
    return { ok: false, codice: 'FIRMA_NON_VALIDA', dettaglio: 'firma malformata' }
  }
  let valida = false
  try {
    valida = verify(
      null,
      Buffer.concat([Buffer.from(PREFISSO_FIRMA_LETTURA, 'utf8'), bytes]),
      chiavePubblica,
      firma
    )
  } catch {
    valida = false
  }
  if (!valida) return { ok: false, codice: 'FIRMA_NON_VALIDA', dettaglio: 'firma non corrisponde' }
  return interpreta(bytes)
}
