import { DataIso, dataValida, errore, Esito, iso, ok } from './risultato'
import { DtukDecodificata } from './dtuk'

/**
 * Date a testo di `MOVIMENTI` e `FORMULARI`.
 *
 * `DATR` e' `gg-mm`: l'anno non c'e', e' quello del database (un database per
 * anno, `docs/movimenti.md` §2.1). `DATD` e' `gg-mm-aaaa` (`docs/formulari.md`
 * §2.1 col. 8). Un campo vuoto e' "assente", non un errore.
 */
export type CodiceDataRegistrazione = 'DATR_NON_VALIDA' | 'DATD_NON_VALIDA'

export function decodificaDatr(
  datr: string | null,
  annoDatabase: number
): Esito<DataIso | null, 'DATR_NON_VALIDA'> {
  const t = (datr ?? '').trim()
  if (t === '') return ok(null)
  const m = /^(\d{2})-(\d{2})$/.exec(t)
  if (!m) return errore('DATR_NON_VALIDA', 'DATR: atteso gg-mm')
  const giorno = Number(m[1])
  const mese = Number(m[2])
  if (!dataValida(annoDatabase, mese, giorno)) {
    return errore('DATR_NON_VALIDA', 'DATR: giorno e mese non validi per l anno del database')
  }
  return ok(iso(annoDatabase, mese, giorno))
}

export function decodificaDataDocumento(
  datd: string | null
): Esito<DataIso | null, 'DATD_NON_VALIDA'> {
  const t = (datd ?? '').trim()
  if (t === '') return ok(null)
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(t)
  if (!m) return errore('DATD_NON_VALIDA', 'DATD: atteso gg-mm-aaaa')
  const giorno = Number(m[1])
  const mese = Number(m[2])
  const anno = Number(m[3])
  if (!dataValida(anno, mese, giorno)) {
    return errore('DATD_NON_VALIDA', 'DATD: data non valida')
  }
  return ok(iso(anno, mese, giorno))
}

/**
 * Coerenza fra la data letta da `DATR`/`DATD` e `DTUK`: se diverse e' un
 * AVVISO (`DATA_DTUK_DIVERSE`), mai uno scarto. Niente da confrontare se una
 * delle due manca.
 */
export function confrontaConDtuk(data: DataIso | null, dtuk: DtukDecodificata): boolean {
  if (data === null || dtuk.data === null) return true
  return data === dtuk.data
}
