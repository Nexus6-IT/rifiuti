import { createHash } from 'crypto'
import type { MudRifiutoLine, StatoFisico } from '../export/mud-export.types'

// Regole pure dell'aggregazione MUD: nessun accesso a database, nessun I/O.
// La conversione in kg sta in `convertiInKg` (domain/waste-movement/unita-misura-registro)
// e gli stati del FIR in `domain/fir/stati-fir`.

/**
 * Finestra dell'anno di dichiarazione in anno solare italiano; `fine` è esclusa.
 * Stessa regola di `annoSolareItaliano` (core/time/anno-italiano): il 1° gennaio l'Italia è
 * in UTC+1, quindi l'anno comincia alle 23:00 UTC del 31 dicembre. Lo verifica il test.
 */
export function limitiAnnoMud(anno: number): { inizio: Date; fine: Date } {
  return {
    inizio: new Date(Date.UTC(anno - 1, 11, 31, 23)),
    fine: new Date(Date.UTC(anno, 11, 31, 23)),
  }
}

export type RuoloMovimento = 'PRODOTTO' | 'AVVIATO' | 'RICEVUTO_DA_TERZI' | 'ESCLUSO'

// Mappa della decisione 4. Le costanti CAUSALI_CARICO/CAUSALI_SCARICO di
// waste-movement.entity.ts sono solo di riferimento: una causale non elencata è ESCLUSA.
const RUOLO_CARICO: Record<string, RuoloMovimento> = {
  PRODUZIONE_INTERNA: 'PRODOTTO',
  RECUPERO_PARZIALE: 'PRODOTTO',
  INGRESSO_ESTERNO: 'RICEVUTO_DA_TERZI',
}

const RUOLO_SCARICO: Record<string, RuoloMovimento> = {
  CONFERIMENTO_TRASPORTATORE: 'AVVIATO',
  AVVIO_RECUPERO: 'AVVIATO',
  AVVIO_SMALTIMENTO: 'AVVIATO',
  CESSIONE: 'AVVIATO',
}

export function classificaMovimento(type: 'CARICO' | 'SCARICO', causale: string): RuoloMovimento {
  const mappa = type === 'CARICO' ? RUOLO_CARICO : RUOLO_SCARICO
  return Object.prototype.hasOwnProperty.call(mappa, causale) ? mappa[causale] : 'ESCLUSO'
}

/** 'R' o 'D' dalla prima lettera di un codice operazione (R13, D15...), altrimenti undefined. */
export function operazioneDaCodice(codice: string | null | undefined): 'R' | 'D' | undefined {
  const lettera = (codice ?? '').trim().charAt(0).toUpperCase()
  return lettera === 'R' || lettera === 'D' ? lettera : undefined
}

export function operazioneDaCausale(causale: string): 'R' | 'D' | undefined {
  if (causale === 'AVVIO_RECUPERO') return 'R'
  if (causale === 'AVVIO_SMALTIMENTO') return 'D'
  return undefined
}

/** Valore del registro non vuoto che non corrisponde a nessun flag del tracciato. */
export type StatoFisicoRegistro = StatoFisico | 'NON_RICONOSCIUTO'

// Chiavi normalizzate come `normalizzaChiave` del ponte RENTRI (mappa-rifiuto.ts: maiuscolo,
// spazi e trattini a underscore); gli alias di quel ponte ci sono tutti, più gassoso/misto/altro
// e le forme del tracciato. Il bersaglio è diverso (flag MUD, non codici RENTRI), quindi la
// tabella non è condivisa.
const STATO_FISICO_DAL_REGISTRO: Record<string, StatoFisico> = {
  SOLIDO: 'SOLIDO_NON_POLVERULENTO',
  SOLIDO_NON_POLVERULENTO: 'SOLIDO_NON_POLVERULENTO',
  POLVERE: 'SOLIDO_POLVERULENTO',
  POLVERULENTO: 'SOLIDO_POLVERULENTO',
  SOLIDO_POLVERULENTO: 'SOLIDO_POLVERULENTO',
  IN_POLVERE_O_PULVERULENTO: 'SOLIDO_POLVERULENTO',
  FANGOSO: 'FANGOSO_PALABILE',
  FANGOSO_PALABILE: 'FANGOSO_PALABILE',
  LIQUIDO: 'LIQUIDO',
  GASSOSO: 'AERIFORME',
  AERIFORME: 'AERIFORME',
  VISCHIOSO: 'VISCHIOSO_SCIROPPOSO',
  VISCHIOSO_SCIROPPOSO: 'VISCHIOSO_SCIROPPOSO',
  VISCOSO: 'VISCHIOSO_SCIROPPOSO',
  VISCOSO_SCIROPPOSO: 'VISCHIOSO_SCIROPPOSO',
  MISTO: 'ALTRO',
  ALTRO: 'ALTRO',
}

/**
 * Stato fisico del tracciato dal valore scritto nel registro (`WasteMovement.wastePhysicalState`).
 * Vuoto o assente vale `null` («non indicato»: il tracciato userà il suo predefinito); un valore
 * non vuoto che non si riconosce vale `NON_RICONOSCIUTO`, così non sparisce in silenzio.
 */
export function statoFisicoMud(valore: string | null | undefined): StatoFisicoRegistro | null {
  const chiave = (valore ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
  if (!chiave) return null
  return Object.prototype.hasOwnProperty.call(STATO_FISICO_DAL_REGISTRO, chiave)
    ? STATO_FISICO_DAL_REGISTRO[chiave]
    : 'NON_RICONOSCIUTO'
}

const arrotonda3 = (n: number): number => Math.round(n * 1000) / 1000

// Forma canonica: numeri a 3 decimali e chiavi degli oggetti in ordine alfabetico,
// così il JSON non dipende dall'ordine di inserimento.
function canonico(valore: unknown): unknown {
  if (typeof valore === 'number') return arrotonda3(valore)
  if (Array.isArray(valore)) return valore.map(canonico)
  if (valore && typeof valore === 'object') {
    const fuori: Record<string, unknown> = {}
    for (const chiave of Object.keys(valore).sort()) {
      const v = (valore as Record<string, unknown>)[chiave]
      if (v !== undefined) fuori[chiave] = canonico(v)
    }
    return fuori
  }
  return valore
}

const confronta = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const json = (valore: unknown): string => JSON.stringify(valore)

// Ordine totale: prima la chiave di dominio, poi il JSON canonico dell'elemento intero,
// così due elementi con la stessa chiave non dipendono dall'ordine di lettura.
function ordina<T>(elementi: T[] | undefined, chiave: (e: T) => string): T[] | undefined {
  return (
    elementi &&
    elementi
      .map(e => ({ e, k: chiave(e), j: json(e) }))
      .sort((a, b) => confronta(a.k, b.k) || confronta(a.j, b.j))
      .map(x => x.e)
  )
}

const perSoggetto = (s: { codiceFiscale: string; ragioneSociale: string }): string =>
  `${s.codiceFiscale}\u0000${s.ragioneSociale}`

/**
 * SHA-256 esadecimale dei dati aggregati. Tutto è portato in forma canonica (numeri a 3
 * decimali, chiavi in ordine) e poi ordinato: righe per `cerCode`; `dr`, `te` e `rt` per codice
 * fiscale e ragione sociale; `re` e `mg` solo per contenuto; a parità di chiave decide il
 * JSON dell'elemento. Non dipende dall'ordine di lettura.
 */
export function hashAggregato(righe: MudRifiutoLine[]): string {
  const normalizzate = ordina(
    righe.map(riga => canonico(riga) as MudRifiutoLine),
    riga => riga.cerCode
  )!.map(riga => ({
    ...riga,
    dr: ordina(riga.dr, perSoggetto),
    te: ordina(riga.te, perSoggetto),
    rt: ordina(riga.rt, perSoggetto),
    re: ordina(riga.re, () => ''),
    mg: ordina(riga.mg, () => ''),
  }))
  return createHash('sha256')
    .update(json(canonico(normalizzate)))
    .digest('hex')
}
