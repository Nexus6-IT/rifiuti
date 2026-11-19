/**
 * Manifest del pacchetto di caricamento (`wasteflow-pacchetto/1`). Formato completo in
 * `docs/migrazione/formato-pacchetto.md`. Nessuna dipendenza da Prisma o NestJS.
 */
import { PacchettoError } from './errori-pacchetto'

export const FORMATO_PACCHETTO = 'wasteflow-pacchetto/1'
export const IMPORT_SOURCE_WINWASTE = 'WINWASTE'
export const NOME_MANIFEST = 'manifest.json'
export const NOME_MAPPA = 'mappa-import.json'

export const AMBITI_PACCHETTO = ['ANAGRAFICHE', 'REGISTRO', 'GIACENZE', 'FIR'] as const
export type AmbitoPacchetto = (typeof AMBITI_PACCHETTO)[number]

export interface FilePacchetto {
  readonly ambito: AmbitoPacchetto
  /** Fase dentro l'ambito, es. `ditte`, `sedi`, `ruoli`. */
  readonly fase: string
  /** Solo il nome del file, nella cartella del pacchetto. */
  readonly file: string
  readonly righe: number
  readonly sha256: string
}

export interface ManifestPacchetto {
  readonly formato: typeof FORMATO_PACCHETTO
  readonly importSource: typeof IMPORT_SOURCE_WINWASTE
  /** `WW<ditta4><anno4>`. */
  readonly archivio: string
  /** SHA-256 del `manifest.json` dello staging d'origine. */
  readonly hashStaging: string
  /** Impronta canonica della mappa (vedi `improntaMappa`). */
  readonly hashMappa: string
  readonly creatoIl: string
  readonly file: readonly FilePacchetto[]
}

const PATTERN_FILE = /^[a-z0-9][a-z0-9-]*\.jsonl$/
const PATTERN_FASE = /^[a-z][a-z0-9-]{0,39}$/
const PATTERN_SHA256 = /^[0-9a-f]{64}$/

function nonValido(dettaglio: string): never {
  throw new PacchettoError('MANIFEST_NON_VALIDO', dettaglio)
}

export function nomeFilePacchetto(ambito: AmbitoPacchetto, fase: string): string {
  return `${ambito.toLowerCase()}-${fase}.jsonl`
}

export function validaManifestPacchetto(json: unknown): ManifestPacchetto {
  if (json === null || typeof json !== 'object' || Array.isArray(json))
    nonValido('atteso un oggetto')
  const m = json as Record<string, unknown>
  if (m.formato !== FORMATO_PACCHETTO) {
    throw new PacchettoError('FORMATO_SCONOSCIUTO', `formato diverso da ${FORMATO_PACCHETTO}`)
  }
  if (m.importSource !== IMPORT_SOURCE_WINWASTE) nonValido('importSource non ammesso')
  if (typeof m.archivio !== 'string' || !/^WW\d{8}$/.test(m.archivio))
    nonValido('archivio non valido')
  if (typeof m.hashStaging !== 'string' || !PATTERN_SHA256.test(m.hashStaging))
    nonValido('hashStaging non valido')
  if (typeof m.hashMappa !== 'string' || !PATTERN_SHA256.test(m.hashMappa))
    nonValido('hashMappa non valido')
  if (typeof m.creatoIl !== 'string' || Number.isNaN(Date.parse(m.creatoIl)))
    nonValido('creatoIl non valido')
  if (!Array.isArray(m.file)) nonValido('file: atteso un elenco')
  const visti = new Set<string>()
  const file = (m.file as unknown[]).map((f, i): FilePacchetto => {
    if (f === null || typeof f !== 'object' || Array.isArray(f))
      nonValido(`file[${i}]: atteso un oggetto`)
    const { ambito, fase, file: nome, righe, sha256 } = f as Record<string, unknown>
    if (typeof ambito !== 'string' || !(AMBITI_PACCHETTO as readonly string[]).includes(ambito)) {
      nonValido(`file[${i}].ambito non valido`)
    }
    if (typeof fase !== 'string' || !PATTERN_FASE.test(fase))
      nonValido(`file[${i}].fase non valida`)
    if (typeof nome !== 'string' || !PATTERN_FILE.test(nome))
      nonValido(`file[${i}].file non valido`)
    if (typeof righe !== 'number' || !Number.isInteger(righe) || righe < 0)
      nonValido(`file[${i}].righe non valido`)
    if (typeof sha256 !== 'string' || !PATTERN_SHA256.test(sha256))
      nonValido(`file[${i}].sha256 non valido`)
    const chiave = `${ambito}/${fase as string}`
    if (visti.has(chiave) || visti.has(`file:${nome as string}`))
      nonValido(`file[${i}]: voce duplicata`)
    visti.add(chiave)
    visti.add(`file:${nome as string}`)
    return {
      ambito: ambito as AmbitoPacchetto,
      fase: fase as string,
      file: nome as string,
      righe: righe as number,
      sha256: sha256 as string,
    }
  })
  return {
    formato: FORMATO_PACCHETTO,
    importSource: IMPORT_SOURCE_WINWASTE,
    archivio: m.archivio,
    hashStaging: m.hashStaging,
    hashMappa: m.hashMappa,
    creatoIl: m.creatoIl,
    file,
  }
}
