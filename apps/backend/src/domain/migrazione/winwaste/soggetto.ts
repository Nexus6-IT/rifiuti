import { errore, Esito, ok } from './risultato'

/**
 * `PROD`, `TRAS`, `SMAL`, `INTE`: soggetto e unita' locale come
 * `soggetto.unita` in 11 caratteri (`docs/schema-db-winwaste.md` §2.2:
 * `CLIFOR.COD` 6 caratteri, `UNITA LOCALI.COD` 4; `docs/rentri/03` §2.2 per i
 * siti propri `X9…`).
 *
 * FORMA PRESUNTA (`dedotta: true`): ricostruita dalle larghezze delle colonne,
 * da verificare sul `.bak`. Vuoto e `0` significano "nessun soggetto".
 */
export interface SoggettoMovimento {
  readonly codice: string
  readonly unita: string
}

export interface SoggettoDecodificato {
  readonly soggetto: SoggettoMovimento | null
  readonly dedotta: true
}

export type CodiceSoggetto = 'SOGGETTO_FORMATO'

export function decodificaSoggetto(
  valore: string | null
): Esito<SoggettoDecodificato, CodiceSoggetto> {
  const t = (valore ?? '').trim()
  if (t === '' || t === '0') return ok({ soggetto: null, dedotta: true })
  const m = /^([0-9A-Za-z]{1,6})\.([0-9A-Za-z]{1,4})$/.exec(t)
  if (!m) return errore('SOGGETTO_FORMATO', 'soggetto: atteso codice.unita (6+4 caratteri)')
  return ok({ soggetto: { codice: m[1], unita: m[2] }, dedotta: true })
}
