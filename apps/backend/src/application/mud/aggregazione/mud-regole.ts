import { createHash } from 'crypto'
import { giornoItaliano } from '../../../core/time/anno-italiano'
import type {
  CatalogoCausali,
  DefinizioneCausale,
} from '../../../domain/waste-movement/catalogo-causali'
import {
  codiceUnitaLocale,
  pacchettiPerExport,
  type DichiarazionePerExport,
} from './mud-dichiarazioni'
import type {
  MudAutorizzazione,
  MudAzienda,
  MudRifiutoLine,
  StatoFisico,
} from '../export/mud-export.types'

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

/** Quanto serve di un movimento per classificarlo: verso, causale, versione aziendale e data. */
export interface MovimentoClassificabile {
  type: string
  causale: string
  causaleAziendaId: string | null
  movementDate: Date
}

function comportamentoDelMovimento(
  catalogo: CatalogoCausali,
  m: MovimentoClassificabile
): DefinizioneCausale | null {
  // Il verso arriva dal database (CHECK su CARICO/SCARICO): qualunque altro valore non ha
  // causali e finisce escluso.
  if (m.type !== 'CARICO' && m.type !== 'SCARICO') return null
  return catalogo.comportamento(
    m.type,
    m.causale,
    giornoItaliano(m.movementDate),
    m.causaleAziendaId
  )
}

/**
 * Ruolo del movimento nel MUD dal catalogo delle causali (decisione 4, ora dati): conta la
 * versione della causale che il movimento porta (`causaleAziendaId`), anche se oggi è chiusa o
 * disattivata. Una causale sconosciuta per quel verso è ESCLUSA.
 */
export function classificaMovimento(
  catalogo: CatalogoCausali,
  m: MovimentoClassificabile
): RuoloMovimento {
  return comportamentoDelMovimento(catalogo, m)?.ruoloMud ?? 'ESCLUSO'
}

/** 'R' o 'D' dalla prima lettera di un codice operazione (R13, D15...), altrimenti undefined. */
export function operazioneDaCodice(codice: string | null | undefined): 'R' | 'D' | undefined {
  const lettera = (codice ?? '').trim().charAt(0).toUpperCase()
  return lettera === 'R' || lettera === 'D' ? lettera : undefined
}

/** 'R' o 'D' indicata dalla causale del movimento nel catalogo, altrimenti undefined. */
export function operazioneDaCatalogo(
  catalogo: CatalogoCausali,
  m: MovimentoClassificabile
): 'R' | 'D' | undefined {
  return comportamentoDelMovimento(catalogo, m)?.operazione ?? undefined
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

// Righe in forma canonica e ordinata, condivisa da hashAggregato e hashDichiarazioni: il valore
// di hashAggregato non deve cambiare, quindi la normalizzazione è quella di sempre.
function normalizzaRighe(righe: MudRifiutoLine[]): unknown[] {
  return ordina(
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
}

/**
 * SHA-256 esadecimale dei dati aggregati. Tutto è portato in forma canonica (numeri a 3
 * decimali, chiavi in ordine) e poi ordinato: righe per `cerCode`; `dr`, `te` e `rt` per codice
 * fiscale e ragione sociale; `re` e `mg` solo per contenuto; a parità di chiave decide il
 * JSON dell'elemento. Non dipende dall'ordine di lettura.
 */
export function hashAggregato(righe: MudRifiutoLine[]): string {
  return createHash('sha256')
    .update(json(canonico(normalizzaRighe(righe))))
    .digest('hex')
}

/**
 * SHA-256 esadecimale di più dichiarazioni (D10): JSON canonico di `[{ codice, righe }]` con le
 * righe normalizzate come in `hashAggregato`, ordinato per codice. Il codice entra nell'hash:
 * le stesse righe in un'altra sede danno un valore diverso.
 */
export function hashDichiarazioni(
  dichiarazioni: Array<{ codice: string; righe: MudRifiutoLine[] }>
): string {
  const normalizzate = [...dichiarazioni]
    .sort((a, b) => confronta(a.codice, b.codice))
    .map(d => ({ codice: d.codice, righe: normalizzaRighe(d.righe) }))
  return createHash('sha256')
    .update(json(canonico(normalizzate)))
    .digest('hex')
}

/** Quanto serve dell'aggregato per gli hash (sottoinsieme di `MudAggregato`). */
export interface AggregatoPerHash {
  versioneCalcolo?: 1 | 2
  righe: MudRifiutoLine[]
  dichiarazioni?: Array<{ codice: string; righe: MudRifiutoLine[] }>
}

/**
 * D10: hash dei dati calcolati. Versione 1, o nessuna dichiarazione → `hashAggregato(righe)`
 * (valore di oggi); versione 2 con UNA dichiarazione di codice 1 → `hashAggregato` delle sue
 * righe (uguale alla versione 1 se non ci sono giacenze); altrimenti `hashDichiarazioni`.
 */
export function hashCalcoloMud(aggregato: AggregatoPerHash): string {
  const dichiarazioni = aggregato.dichiarazioni ?? []
  if (aggregato.versioneCalcolo === 1 || dichiarazioni.length === 0) {
    return hashAggregato(aggregato.righe)
  }
  if (dichiarazioni.length === 1 && dichiarazioni[0].codice === codiceUnitaLocale(1)) {
    return hashAggregato(dichiarazioni[0].righe)
  }
  return hashDichiarazioni(dichiarazioni)
}

/**
 * SHA-256 esadecimale dei dati del dichiarante come entrano nel file: anagrafica del record AA
 * (ATECO, comune ISTAT, indirizzo, legale rappresentante…) e autorizzazioni dei record AU, in
 * forma canonica. Separato da `hashAggregato`, che copre solo le righe: serve a capire se il
 * dichiarante è cambiato dopo la presentazione. Le date passano dal JSON (ISO), altrimenti la
 * forma canonica le ridurrebbe a oggetti vuoti; l'ordine delle autorizzazioni è quello del file.
 */
export function hashDichiarante(dichiarante: {
  azienda: MudAzienda
  autorizzazioni: MudAutorizzazione[]
  /** pacchetti del file con la loro anagrafica (D10): solo se non sono la sola azienda */
  unitaLocali?: Array<{ progressivo: number; unitaLocale: unknown }>
}): string {
  return createHash('sha256')
    .update(json(canonico(JSON.parse(json(dichiarante)))))
    .digest('hex')
}

/**
 * D10: `hashDichiarante` con le anagrafiche dei pacchetti (D5) solo se le dichiarazioni sono più
 * di una o almeno una non usa l'anagrafica dell'azienda; altrimenti il valore resta quello di oggi.
 */
export function hashDichiaranteMud(
  dichiarante: { azienda: MudAzienda; autorizzazioni: MudAutorizzazione[] },
  aggregato: { dichiarazioni?: DichiarazionePerExport[] }
): string {
  const dichiarazioni = aggregato.dichiarazioni ?? []
  const pacchetti = pacchettiPerExport(dichiarazioni, dichiarante.azienda)
  const conSedi = pacchetti.length > 1 || pacchetti.some(p => p.unitaLocale !== null)
  if (!conSedi) return hashDichiarante(dichiarante)
  return hashDichiarante({
    ...dichiarante,
    unitaLocali: pacchetti.map(p => ({
      progressivo: p.progressivoUnitaLocale,
      unitaLocale: p.unitaLocale,
    })),
  })
}
