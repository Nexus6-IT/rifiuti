/**
 * Mappa di import (`wasteflow-mappa/1`): la scrive l'operatore, viaggia col pacchetto e la sua
 * impronta finisce nel lotto. Dice come i codici WinWaste diventano id e codici di WasteFlow.
 *
 * REGOLA: la mappa NON contiene dati personali. Per questo lo schema e' CHIUSO (ogni chiave e'
 * elencata, una chiave sconosciuta e' un errore: niente campi liberi dove infilare un nome) e ogni
 * stringa e' vincolata da un pattern stretto. In piu' nessun valore puo' somigliare a un codice
 * fiscale di persona fisica, a un indirizzo e-mail o a un numero di telefono. Una partita IVA
 * (11 cifre) e' ammessa solo negli agganci: identifica la ditta, non una persona.
 *
 * Nessuna dipendenza da Prisma o NestJS (la usa anche `migrazione:prepara`, che gira sulla workstation).
 */
import { createHash } from 'crypto'
import { PacchettoError } from './errori-pacchetto'

export const FORMATO_MAPPA = 'wasteflow-mappa/1'

export type VersoCausale = 'CARICO' | 'SCARICO'

export interface MappaRegistro {
  /** `REG1..REG4` o codice del magazzino WinWaste. */
  readonly legacy: string
  readonly registroId: string
}
export interface MappaUnitaLocale {
  /** Soggetto proprio WinWaste, forma `X<sede>.<ul>` (VERSIS XRENTRI). */
  readonly legacy: string
  readonly sedeId: string
  readonly unitaLocaleId: string | null
}
export interface MappaCausale {
  /** `OPER` di WinWaste (2 cifre). */
  readonly oper: string
  /** Codice della causale F2-5 (catalogo `causali_registro`). */
  readonly causale: string
  readonly verso: VersoCausale
  /** Le corrispondenze `dedotta` di `oper.ts` vanno confermate una per una dall'operatore. */
  readonly confermata: boolean
}
export interface MappaAggancio {
  /** Partita IVA della ditta gia' presente in WasteFlow. */
  readonly partitaIva: string
  readonly dittaId: string
}

export interface MappaImport {
  readonly formato: typeof FORMATO_MAPPA
  /** Ditta WinWaste, 4 cifre. */
  readonly ditta: string
  readonly anno: number
  /** Data di taglio `AAAA-MM-GG`. */
  readonly dataTaglio: string
  readonly registri: readonly MappaRegistro[]
  readonly unitaLocali: readonly MappaUnitaLocale[]
  readonly causali: readonly MappaCausale[]
  readonly agganci: readonly MappaAggancio[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODICE_LEGACY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/
const OPER = /^[0-9]{2}$/
const CAUSALE = /^[A-Z0-9][A-Z0-9_]{0,99}$/
const DATA = /^\d{4}-\d{2}-\d{2}$/
// Codice fiscale di persona fisica (anche con omocodia) e di persona giuridica (11 cifre) non
// compaiono mai: l'unico identificativo fiscale ammesso e' la partita IVA degli agganci.
const SOMIGLIA_CF = /[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]/i
const SOMIGLIA_EMAIL = /\S+@\S+\.\S+/
const SOMIGLIA_TELEFONO = /(?:\+|00)?\d[\d\s./-]{7,}\d/

function errore(dove: string, motivo: string): never {
  throw new PacchettoError('MAPPA_NON_VALIDA', `${dove}: ${motivo}`)
}

function oggetto(v: unknown, dove: string, chiavi: readonly string[]): Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) errore(dove, 'atteso un oggetto')
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) {
    if (!chiavi.includes(k)) errore(dove, `chiave non prevista «${k}»`)
  }
  for (const k of chiavi) {
    if (!(k in o)) errore(dove, `manca «${k}»`)
  }
  return o
}

function lista(v: unknown, dove: string): unknown[] {
  if (!Array.isArray(v)) errore(dove, 'atteso un elenco')
  return v as unknown[]
}

function stringa(v: unknown, dove: string, pattern: RegExp): string {
  if (typeof v !== 'string' || !pattern.test(v)) errore(dove, 'valore non valido')
  return v as string
}

function nessunDatoPersonale(valore: string, dove: string): void {
  if (SOMIGLIA_CF.test(valore))
    errore(dove, 'somiglia a un codice fiscale: dato personale non ammesso')
  if (SOMIGLIA_EMAIL.test(valore))
    errore(dove, 'somiglia a un indirizzo e-mail: dato personale non ammesso')
  if (SOMIGLIA_TELEFONO.test(valore))
    errore(dove, 'somiglia a un numero di telefono: dato personale non ammesso')
}

/** Controllo di Luhn della partita IVA italiana (11 cifre). */
export function partitaIvaItalianaValida(p: string): boolean {
  if (!/^[0-9]{11}$/.test(p)) return false
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let c = Number(p[i])
    if (i % 2 === 1) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return (10 - (somma % 10)) % 10 === Number(p[10])
}

function senzaDuplicati(valori: readonly string[], dove: string): void {
  if (new Set(valori).size !== valori.length) errore(dove, 'voci duplicate')
}

/** Valida una mappa gia' letta da JSON. @throws PacchettoError `MAPPA_NON_VALIDA` */
export function validaMappa(json: unknown): MappaImport {
  const m = oggetto(json, 'mappa', [
    'formato',
    'ditta',
    'anno',
    'dataTaglio',
    'registri',
    'unitaLocali',
    'causali',
    'agganci',
  ])
  if (m.formato !== FORMATO_MAPPA) {
    throw new PacchettoError('FORMATO_SCONOSCIUTO', `la mappa non e' ${FORMATO_MAPPA}`)
  }
  const ditta = stringa(m.ditta, 'ditta', /^\d{4}$/)
  if (typeof m.anno !== 'number' || !Number.isInteger(m.anno) || m.anno < 1990 || m.anno > 2100) {
    errore('anno', 'atteso un intero fra 1990 e 2100')
  }
  const dataTaglio = stringa(m.dataTaglio, 'dataTaglio', DATA)
  if (
    Number.isNaN(Date.parse(`${dataTaglio}T00:00:00Z`)) ||
    !new Date(`${dataTaglio}T00:00:00Z`).toISOString().startsWith(dataTaglio)
  ) {
    errore('dataTaglio', 'data inesistente')
  }

  const registri = lista(m.registri, 'registri').map((r, i) => {
    const o = oggetto(r, `registri[${i}]`, ['legacy', 'registroId'])
    return {
      legacy: stringa(o.legacy, `registri[${i}].legacy`, CODICE_LEGACY),
      registroId: stringa(o.registroId, `registri[${i}].registroId`, UUID).toLowerCase(),
    }
  })
  senzaDuplicati(
    registri.map(r => r.legacy),
    'registri'
  )

  const unitaLocali = lista(m.unitaLocali, 'unitaLocali').map((r, i) => {
    const o = oggetto(r, `unitaLocali[${i}]`, ['legacy', 'sedeId', 'unitaLocaleId'])
    return {
      legacy: stringa(o.legacy, `unitaLocali[${i}].legacy`, CODICE_LEGACY),
      sedeId: stringa(o.sedeId, `unitaLocali[${i}].sedeId`, UUID).toLowerCase(),
      unitaLocaleId:
        o.unitaLocaleId === null
          ? null
          : stringa(o.unitaLocaleId, `unitaLocali[${i}].unitaLocaleId`, UUID).toLowerCase(),
    }
  })
  senzaDuplicati(
    unitaLocali.map(r => r.legacy),
    'unitaLocali'
  )

  const causali = lista(m.causali, 'causali').map((r, i) => {
    const o = oggetto(r, `causali[${i}]`, ['oper', 'causale', 'verso', 'confermata'])
    if (o.verso !== 'CARICO' && o.verso !== 'SCARICO')
      errore(`causali[${i}].verso`, 'CARICO o SCARICO')
    if (typeof o.confermata !== 'boolean') errore(`causali[${i}].confermata`, 'atteso true o false')
    return {
      oper: stringa(o.oper, `causali[${i}].oper`, OPER),
      causale: stringa(o.causale, `causali[${i}].causale`, CAUSALE),
      verso: o.verso as VersoCausale,
      confermata: o.confermata,
    }
  })
  senzaDuplicati(
    causali.map(c => c.oper),
    'causali'
  )

  const agganci = lista(m.agganci, 'agganci').map((r, i) => {
    const o = oggetto(r, `agganci[${i}]`, ['partitaIva', 'dittaId'])
    const partitaIva = stringa(o.partitaIva, `agganci[${i}].partitaIva`, /^[0-9]{11}$/)
    if (!partitaIvaItalianaValida(partitaIva))
      errore(`agganci[${i}].partitaIva`, 'cifra di controllo errata')
    return { partitaIva, dittaId: stringa(o.dittaId, `agganci[${i}].dittaId`, UUID).toLowerCase() }
  })
  senzaDuplicati(
    agganci.map(a => a.partitaIva),
    'agganci'
  )

  // Difesa in profondita': nessuna stringa della mappa (salvo la P.IVA degli agganci, gia' validata
  // per intero) puo' somigliare a un dato personale.
  const daControllare: Array<[string, string]> = []
  registri.forEach((r, i) => daControllare.push([`registri[${i}].legacy`, r.legacy]))
  unitaLocali.forEach((r, i) => daControllare.push([`unitaLocali[${i}].legacy`, r.legacy]))
  causali.forEach((c, i) => daControllare.push([`causali[${i}].causale`, c.causale]))
  for (const [dove, valore] of daControllare) nessunDatoPersonale(valore, dove)

  return {
    formato: FORMATO_MAPPA,
    ditta,
    anno: m.anno as number,
    dataTaglio,
    registri,
    unitaLocali,
    causali,
    agganci,
  }
}

/** JSON canonico: chiavi ordinate, nessuno spazio. Stesso contenuto, stessi byte. */
export function serializzaCanonico(valore: unknown): string {
  const ordina = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(ordina)
    if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map(k => [k, ordina(o[k])])
      )
    }
    return v
  }
  return JSON.stringify(ordina(valore))
}

/** Impronta SHA-256 (esadecimale) della mappa, indipendente da spazi e ordine delle chiavi. */
export function improntaMappa(mappa: MappaImport): string {
  return createHash('sha256').update(serializzaCanonico(mappa)).digest('hex')
}
