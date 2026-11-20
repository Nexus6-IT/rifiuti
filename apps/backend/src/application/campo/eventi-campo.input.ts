/**
 * Validazione di un evento dal campo (P4): forma e limiti, senza accedere al database. La sostanza
 * (ritiro dell'autista, stato, versione) la decide `EventiCampoService`.
 */
export const TIPI_EVENTO_CAMPO = ['RITIRO_ESEGUITO', 'RITIRO_NON_ESEGUITO'] as const
export type TipoEventoCampo = (typeof TIPI_EVENTO_CAMPO)[number]

export const LUNGHEZZA_MASSIMA_TESTO_EVENTO = 500

export interface DatiEventoCampo {
  /** Obbligatorio per RITIRO_NON_ESEGUITO. */
  motivo?: string
  /** Facoltativa per RITIRO_ESEGUITO. */
  nota?: string
}

export interface EventoCampoValori {
  id: string
  ritiroId: string
  tipo: TipoEventoCampo
  versioneVista: number
  /** Data del giro e sede del produttore che l'autista aveva davanti (campi che contano per l'esito). */
  dataVista: string
  sedeVista: string
  /** Orologio del telefono: informativo, mai data legale. */
  rilevatoIl: Date
  dati: DatiEventoCampo
}

export type EsitoValidazioneEvento =
  | { ok: true; valori: EventoCampoValori }
  | { ok: false; messaggi: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** ISO 8601 completo con ora e fuso (`toISOString()` del telefono). */
const ISO_CON_ORA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/
const VERSIONE_MASSIMA = 2_147_483_647
const ANNO_MINIMO = 2020
const ANNO_MASSIMO = 2100

function testo(v: unknown): string | null {
  return typeof v === 'string' ? v.trim() : null
}

export function normalizzaEventoCampo(grezzo: {
  id?: unknown
  ritiroId?: unknown
  tipo?: unknown
  versioneVista?: unknown
  dataVista?: unknown
  sedeVista?: unknown
  rilevatoIl?: unknown
  dati?: unknown
}): EsitoValidazioneEvento {
  const messaggi: string[] = []

  const id = typeof grezzo.id === 'string' && UUID.test(grezzo.id) ? grezzo.id.toLowerCase() : null
  if (id === null) messaggi.push("L'identificativo dell'evento non è valido.")
  const ritiroId =
    typeof grezzo.ritiroId === 'string' && UUID.test(grezzo.ritiroId)
      ? grezzo.ritiroId.toLowerCase()
      : null
  if (ritiroId === null) messaggi.push('Il ritiro non è valido.')

  const tipo = (TIPI_EVENTO_CAMPO as readonly unknown[]).includes(grezzo.tipo)
    ? (grezzo.tipo as TipoEventoCampo)
    : null
  if (tipo === null) messaggi.push('Il tipo di evento non è valido.')

  const v = grezzo.versioneVista
  const versioneVista =
    typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= VERSIONE_MASSIMA ? v : null
  if (versioneVista === null) messaggi.push('La versione del ritiro non è valida.')

  const dataVista =
    typeof grezzo.dataVista === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(grezzo.dataVista)
      ? grezzo.dataVista
      : null
  if (dataVista === null) messaggi.push('La data del ritiro non è valida.')
  const sedeVista =
    typeof grezzo.sedeVista === 'string' && UUID.test(grezzo.sedeVista)
      ? grezzo.sedeVista.toLowerCase()
      : null
  if (sedeVista === null) messaggi.push('La sede del ritiro non è valida.')

  let rilevatoIl: Date | null = null
  if (typeof grezzo.rilevatoIl === 'string' && ISO_CON_ORA.test(grezzo.rilevatoIl)) {
    const d = new Date(grezzo.rilevatoIl)
    if (
      !Number.isNaN(d.getTime()) &&
      d.getUTCFullYear() >= ANNO_MINIMO &&
      d.getUTCFullYear() <= ANNO_MASSIMO
    ) {
      rilevatoIl = d
    }
  }
  if (rilevatoIl === null) messaggi.push('La data di rilevazione non è valida.')

  const dati: DatiEventoCampo = {}
  const grezziDati = grezzo.dati === undefined || grezzo.dati === null ? {} : grezzo.dati
  if (typeof grezziDati !== 'object' || Array.isArray(grezziDati)) {
    messaggi.push('I dati dell’evento non sono validi.')
  } else if (tipo !== null) {
    const ammessi = tipo === 'RITIRO_NON_ESEGUITO' ? ['motivo'] : ['nota']
    const d = grezziDati as Record<string, unknown>
    for (const k of Object.keys(d)) {
      if (!ammessi.includes(k)) messaggi.push(`Il campo «${k}» non è ammesso per questo evento.`)
    }
    if (tipo === 'RITIRO_NON_ESEGUITO') {
      const m = testo(d.motivo)
      if (m === null || m === '') messaggi.push('Il motivo è obbligatorio.')
      else if (m.length > LUNGHEZZA_MASSIMA_TESTO_EVENTO)
        messaggi.push('Il motivo è troppo lungo (massimo 500 caratteri).')
      else dati.motivo = m
    } else if (d.nota !== undefined && d.nota !== null) {
      const n = testo(d.nota)
      if (n === null) messaggi.push('La nota non è valida.')
      else if (n.length > LUNGHEZZA_MASSIMA_TESTO_EVENTO)
        messaggi.push('La nota è troppo lunga (massimo 500 caratteri).')
      else if (n !== '') dati.nota = n
    }
  }

  if (
    messaggi.length > 0 ||
    dataVista === null ||
    sedeVista === null ||
    id === null ||
    ritiroId === null ||
    tipo === null
  ) {
    return { ok: false, messaggi }
  }
  return {
    ok: true,
    valori: {
      id,
      ritiroId,
      tipo,
      versioneVista: versioneVista as number,
      dataVista,
      sedeVista,
      rilevatoIl: rilevatoIl as Date,
      dati,
    },
  }
}
