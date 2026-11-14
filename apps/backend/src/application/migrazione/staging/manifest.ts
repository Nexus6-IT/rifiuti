/**
 * Manifest dello staging WinWaste (`winwaste-staging/1`).
 *
 * Una cartella di staging contiene `manifest.json` e un file JSON Lines per
 * tabella. Il manifest e' la frontiera fra estrazione e trasformazione: dice
 * cosa c'e' nella cartella e permette di verificarlo (righe e SHA-256 di ogni
 * file) PRIMA di decodificare qualunque valore. Formato completo in
 * `docs/migrazione/formato-staging-winwaste.md`.
 *
 * Nessuna dipendenza da Prisma o NestJS: l'analizzatore non apre il database.
 */

export const FORMATO_STAGING = 'winwaste-staging/1'

/** Nome della cartella e del database d'origine: `WW<ditta 4 cifre><anno 4 cifre>`. */
export const PATTERN_ARCHIVIO = /^WW(\d{4})(\d{4})$/

export interface ManifestTabella {
  /** File JSON Lines, relativo alla cartella dello staging (solo nome, nessun percorso). */
  readonly file: string
  /** Numero di righe non vuote del file. */
  readonly righe: number
  /** SHA-256 esadecimale (minuscolo) dei byte del file. */
  readonly sha256: string
  /** Nomi delle colonne nell'ordine in cui compaiono nei valori di ogni riga. */
  readonly colonne: readonly string[]
}

export interface ManifestStaging {
  readonly formato: typeof FORMATO_STAGING
  /** Ditta WinWaste, 4 cifre. */
  readonly ditta: string
  readonly anno: number
  /** Database SQL Server d'origine, `WW<ditta><anno>`: coincide col nome della cartella. */
  readonly databaseOrigine: string
  /** Istante dell'estrazione (ISO 8601). */
  readonly estrattoIl: string
  readonly estrattore?: { readonly nome: string; readonly versione: string }
  /** Chiave = nome SQL Server esatto della tabella (puo' contenere spazi). */
  readonly tabelle: Readonly<Record<string, ManifestTabella>>
}

export type CodiceErroreStaging =
  | 'CARTELLA_NON_VALIDA'
  | 'MANIFEST_ASSENTE'
  | 'MANIFEST_NON_VALIDO'
  | 'FORMATO_SCONOSCIUTO'
  | 'ARCHIVIO_INCOERENTE'
  | 'FILE_ASSENTE'
  | 'HASH_NON_CORRISPONDE'
  | 'RIGHE_NON_CORRISPONDENTI'
  | 'COLONNA_OBBLIGATORIA_ASSENTE'

/** Errore che ferma la lettura dello staging prima di qualunque decodifica. */
export class StagingError extends Error {
  constructor(
    readonly codice: CodiceErroreStaging,
    readonly dettaglio: string
  ) {
    super(`${codice}: ${dettaglio}`)
    this.name = 'StagingError'
  }
}

const PATTERN_FILE = /^[a-z0-9][a-z0-9-]*\.jsonl$/
const PATTERN_SHA256 = /^[0-9a-f]{64}$/

function oggetto(valore: unknown, dove: string): Record<string, unknown> {
  if (valore === null || typeof valore !== 'object' || Array.isArray(valore)) {
    throw new StagingError('MANIFEST_NON_VALIDO', `${dove}: atteso un oggetto`)
  }
  return valore as Record<string, unknown>
}

function validaTabella(nome: string, valore: unknown): ManifestTabella {
  if (nome === '__proto__') {
    throw new StagingError('MANIFEST_NON_VALIDO', 'nome di tabella non ammesso')
  }
  const t = oggetto(valore, `tabelle["${nome}"]`)
  const { file, righe, sha256, colonne } = t
  if (typeof file !== 'string' || !PATTERN_FILE.test(file)) {
    throw new StagingError('MANIFEST_NON_VALIDO', `tabelle["${nome}"].file non valido`)
  }
  if (typeof righe !== 'number' || !Number.isInteger(righe) || righe < 0) {
    throw new StagingError('MANIFEST_NON_VALIDO', `tabelle["${nome}"].righe non valido`)
  }
  if (typeof sha256 !== 'string' || !PATTERN_SHA256.test(sha256)) {
    throw new StagingError('MANIFEST_NON_VALIDO', `tabelle["${nome}"].sha256 non valido`)
  }
  if (
    !Array.isArray(colonne) ||
    colonne.length === 0 ||
    colonne.some(c => typeof c !== 'string' || c.length === 0 || c === '__proto__') ||
    new Set(colonne).size !== colonne.length
  ) {
    throw new StagingError(
      'MANIFEST_NON_VALIDO',
      `tabelle["${nome}"].colonne: attese stringhe non vuote e distinte`
    )
  }
  return { file, righe, sha256, colonne: colonne as string[] }
}

/**
 * Valida il manifest gia' letto da JSON. `nomeCartella` e' il nome della
 * cartella che lo contiene: deve coincidere con `databaseOrigine`, e ditta e
 * anno devono essere coerenti con entrambi.
 */
export function validaManifest(json: unknown, nomeCartella: string): ManifestStaging {
  const m = oggetto(json, 'manifest')
  if (m.formato !== FORMATO_STAGING) {
    throw new StagingError('FORMATO_SCONOSCIUTO', `formato diverso da ${FORMATO_STAGING}`)
  }
  const { ditta, anno, databaseOrigine, estrattoIl, tabelle, estrattore } = m
  if (typeof ditta !== 'string' || !/^\d{4}$/.test(ditta)) {
    throw new StagingError('MANIFEST_NON_VALIDO', 'ditta: attese 4 cifre')
  }
  if (typeof anno !== 'number' || !Number.isInteger(anno) || anno < 1990 || anno > 2100) {
    throw new StagingError('MANIFEST_NON_VALIDO', 'anno: atteso un intero fra 1990 e 2100')
  }
  if (typeof databaseOrigine !== 'string') {
    throw new StagingError('MANIFEST_NON_VALIDO', 'databaseOrigine mancante')
  }
  if (typeof estrattoIl !== 'string' || Number.isNaN(Date.parse(estrattoIl))) {
    throw new StagingError('MANIFEST_NON_VALIDO', 'estrattoIl: atteso un istante ISO 8601')
  }
  const attesoDb = `WW${ditta}${anno}`
  if (databaseOrigine !== attesoDb) {
    throw new StagingError(
      'ARCHIVIO_INCOERENTE',
      `databaseOrigine (${databaseOrigine}) non coincide con ditta e anno (${attesoDb})`
    )
  }
  if (nomeCartella !== databaseOrigine) {
    throw new StagingError(
      'ARCHIVIO_INCOERENTE',
      `la cartella si chiama ${nomeCartella}, il manifest dichiara ${databaseOrigine}`
    )
  }
  const t = oggetto(tabelle, 'tabelle')
  const risultato: Record<string, ManifestTabella> = {}
  const filesVisti = new Set<string>()
  for (const nome of Object.keys(t)) {
    const tab = validaTabella(nome, t[nome])
    if (filesVisti.has(tab.file)) {
      throw new StagingError('MANIFEST_NON_VALIDO', `file ${tab.file} usato da due tabelle`)
    }
    filesVisti.add(tab.file)
    risultato[nome] = tab
  }
  let est: ManifestStaging['estrattore']
  if (estrattore !== undefined) {
    const e = oggetto(estrattore, 'estrattore')
    if (typeof e.nome !== 'string' || typeof e.versione !== 'string') {
      throw new StagingError('MANIFEST_NON_VALIDO', 'estrattore: attesi nome e versione')
    }
    est = { nome: e.nome, versione: e.versione }
  }
  return {
    formato: FORMATO_STAGING,
    ditta,
    anno,
    databaseOrigine,
    estrattoIl,
    ...(est ? { estrattore: est } : {}),
    tabelle: risultato,
  }
}
