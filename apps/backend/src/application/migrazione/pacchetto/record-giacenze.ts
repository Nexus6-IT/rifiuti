/**
 * Record della fase `giacenze` (ambito GIACENZE, pezzo I6) e sua validazione. Pura: la usano
 * `migrazione:prepara` (workstation) e il caricamento lato server, che NON si fida del pacchetto e
 * rivalida ogni riga. Gli errori non riportano mai valori: solo la fase e il nome del campo.
 *
 * Una riga = una famiglia (registro, CER, stato fisico) con la quantita' in kg al taglio. Il CER e'
 * nella forma `NN NN NN` (con `*` se il rifiuto e' pericoloso): il catalogo ha l'ultima parola.
 */
import { dataValida } from '../../../domain/migrazione/winwaste/risultato'
import { PacchettoError } from './errori-pacchetto'
import { MappaImport } from './mappa-import'

export interface OrigineGiacenzaPacchetto {
  readonly anno: number
  readonly protocollo: number
  readonly quantita: number
}

export interface RecordGiacenza {
  /** `ditta|anno|GIACENZE|registroId|cer a 6 cifre|stato fisico o -`. */
  readonly legacyKey: string
  readonly registroId: string
  readonly cerCode: string
  readonly statoFisico: string | null
  /** kg, maggiore di zero, al massimo 2 decimali. */
  readonly quantita: number
  readonly unita: 'KG'
  /** `AAAA-MM-GG`: il giorno di taglio della mappa. */
  readonly dataRiferimento: string
  readonly origini: readonly OrigineGiacenzaPacchetto[]
}

const re = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const QUANTITA_MASSIMA = 99_999_999.99
export const ORIGINI_MASSIME_PACCHETTO = 200

function riga(campo: string): never {
  throw new PacchettoError('RIGA_NON_VALIDA', `giacenze: ${campo}`)
}

function oggetto(v: unknown, chiavi: readonly string[], campo: string): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return riga(campo)
  const o = v as Record<string, unknown>
  const k = Object.keys(o)
  if (k.length !== chiavi.length || !chiavi.every(c => c in o)) return riga(campo)
  return o
}

const centesimi = (n: number): number => Math.round(n * 100)
const dueDecimali = (n: number): boolean => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6

function quantita(v: unknown, campo: string): number {
  if (
    typeof v !== 'number' ||
    !Number.isFinite(v) ||
    v <= 0 ||
    v > QUANTITA_MASSIMA ||
    !dueDecimali(v)
  ) {
    return riga(campo)
  }
  return v
}

export function validaRecordGiacenza(valore: unknown, mappa: MappaImport): RecordGiacenza {
  const o = oggetto(
    valore,
    [
      'legacyKey',
      'registroId',
      'cerCode',
      'statoFisico',
      'quantita',
      'unita',
      'dataRiferimento',
      'origini',
    ],
    'FORMA'
  )
  const registroId = typeof o.registroId === 'string' ? o.registroId.toLowerCase() : ''
  if (!new RegExp(`^${UUID}$`).test(registroId)) riga('REGISTRO')
  if (!mappa.registri.some(r => r.registroId === registroId)) riga('REGISTRO')
  if (typeof o.cerCode !== 'string' || !/^\d{2} \d{2} \d{2}\*?$/.test(o.cerCode)) riga('CER')
  const cifre = o.cerCode.replace(/\D/g, '')
  let stato: string | null = null
  if (o.statoFisico !== null) {
    const s = o.statoFisico
    // eslint-disable-next-line no-control-regex
    if (typeof s !== 'string' || s.length < 1 || s.length > 50 || /[|\u0000-\u001f\u007f]/.test(s))
      riga('STATO_FISICO')
    if (s !== s.trim() || s === '-') riga('STATO_FISICO')
    stato = s
  }
  const chiaveAttesa = `${mappa.ditta}|${mappa.anno}|GIACENZE|${registroId}|${cifre}|${stato ?? '-'}`
  if (
    typeof o.legacyKey !== 'string' ||
    !new RegExp(
      `^${re(mappa.ditta)}\\|${mappa.anno}\\|GIACENZE\\|${UUID}\\|[0-9]{6}\\|[^|]{1,50}$`
    ).test(o.legacyKey) ||
    o.legacyKey !== chiaveAttesa
  ) {
    riga('CHIAVE')
  }
  const q = quantita(o.quantita, 'QUANTITA')
  if (o.unita !== 'KG') riga('UNITA')
  if (o.dataRiferimento !== mappa.dataTaglio) riga('DATA')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(mappa.dataTaglio)
  if (!m || !dataValida(+m[1], +m[2], +m[3])) riga('DATA')
  if (!Array.isArray(o.origini) || o.origini.length > ORIGINI_MASSIME_PACCHETTO) riga('ORIGINI')
  const viste = new Set<string>()
  let somma = 0
  const origini = (o.origini as unknown[]).map((x): OrigineGiacenzaPacchetto => {
    const p = oggetto(x, ['anno', 'protocollo', 'quantita'], 'ORIGINI')
    if (!Number.isInteger(p.anno) || (p.anno as number) < 1990 || (p.anno as number) > 2100)
      riga('ORIGINI')
    if (!Number.isInteger(p.protocollo) || (p.protocollo as number) < 1) riga('ORIGINI')
    const k = `${p.anno}/${p.protocollo}`
    if (viste.has(k)) riga('ORIGINI')
    viste.add(k)
    const oq = quantita(p.quantita, 'ORIGINI')
    somma += centesimi(oq)
    return { anno: p.anno as number, protocollo: p.protocollo as number, quantita: oq }
  })
  if (somma > centesimi(q)) riga('ORIGINI')
  return {
    legacyKey: o.legacyKey,
    registroId,
    cerCode: o.cerCode,
    statoFisico: stato,
    quantita: q,
    unita: 'KG',
    dataRiferimento: mappa.dataTaglio,
    origini,
  }
}
