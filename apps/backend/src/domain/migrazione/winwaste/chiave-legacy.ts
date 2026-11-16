/**
 * Chiave legacy di un record WinWaste: `ditta|anno|TABELLA|COD`
 * (es. `0001|2026|MOVIMENTI|12345`), come rapporto 04 §4.4 e decisione D1 del
 * piano Fase 3.
 *
 * NOTA DI INTEGRAZIONE: questa funzione e' la versione minima che serve al
 * parser dello staging (PR B). Il modulo canonico e' `domain/migrazione/
 * chiavi-legacy.ts` del Task 1 (PR A, `chiaveMovimento`, con `ImportSource` e la
 * regex D1 condivisa con la migration): al merge delle due PR questo file si
 * riduce a una chiamata a quello. Le regole sono le stesse e sono verificate
 * dalla spec.
 */
export type TabellaConChiave = 'MOVIMENTI' | 'FORMULARI'

const TABELLE: readonly string[] = ['MOVIMENTI', 'FORMULARI']

/** Pattern D1 della colonna `legacy_key` (da usare anche nel commento della migration). */
export const PATTERN_CHIAVE_LEGACY = /^[0-9]{4}\|[^|]+(\|[^|]+)+$/

export class ChiaveLegacyNonValidaError extends Error {
  constructor(dettaglio: string) {
    super(`Chiave legacy non valida: ${dettaglio}`)
    this.name = 'ChiaveLegacyNonValidaError'
  }
}

export function chiaveLegacyWinwaste(
  ditta: string,
  anno: number,
  tabella: TabellaConChiave,
  cod: number
): string {
  if (!/^\d{4}$/.test(ditta)) throw new ChiaveLegacyNonValidaError('ditta di 4 cifre')
  if (!Number.isInteger(anno) || anno < 1990 || anno > 2100) {
    throw new ChiaveLegacyNonValidaError('anno fra 1990 e 2100')
  }
  if (!TABELLE.includes(tabella)) throw new ChiaveLegacyNonValidaError('tabella non ammessa')
  if (!Number.isInteger(cod) || cod < 1) throw new ChiaveLegacyNonValidaError('COD intero positivo')
  // Con questi vincoli la chiave e' sempre <= 40 caratteri e rispetta PATTERN_CHIAVE_LEGACY.
  return `${ditta}|${anno}|${tabella}|${cod}`
}
