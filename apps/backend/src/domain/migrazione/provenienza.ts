import { CHIAVE_LEGACY_PATTERN } from './chiavi-legacy'

/** Origini ammesse (CHECK `import_source IN (...)` del database; estendibile da migration). */
export const IMPORT_SOURCES = ['WINWASTE'] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]
export const IMPORT_SOURCE_WINWASTE: ImportSource = 'WINWASTE'

export interface ProvenienzaImport {
  importSource?: string | null
  legacyKey?: string | null
  lottoImportId?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const regexChiave = new RegExp(CHIAVE_LEGACY_PATTERN)

/**
 * Le tre colonne di provenienza sono «tutte o nessuna»: nessuna = record nato in WasteFlow,
 * tutte e tre valide = record importato. Qualunque altra combinazione e' un errore.
 */
export function provenienzaValida(p: ProvenienzaImport): boolean {
  const valorizzate = [p.importSource, p.legacyKey, p.lottoImportId].filter(
    v => v !== null && v !== undefined
  )
  if (valorizzate.length === 0) return true
  if (valorizzate.length !== 3) return false
  return (
    (IMPORT_SOURCES as readonly string[]).includes(p.importSource as string) &&
    regexChiave.test(p.legacyKey as string) &&
    (p.legacyKey as string).length <= 200 &&
    UUID.test(p.lottoImportId as string)
  )
}
