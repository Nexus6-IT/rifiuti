import { DataIso, dataValida, errore, Esito, iso, ok } from './risultato'

/**
 * `DTUK`: chiave di ordinamento `aaaammgg` di `MOVIMENTI` e `FORMULARI`
 * (`docs/movimenti.md` §2.2 pos. 11, `docs/formulari.md` §2.1 col. 12).
 *
 * Le query di WinWaste considerano attivi solo i record con `dtuk > '0'`.
 * Un valore `<= '0'` (vuoto, `'0'`, NULL) lo esclude comunque.
 *
 * FORMA DEI RECORD ANNULLATI, VERIFICATA sul database modello dell'installer
 * (dati demo, 9 record su 16): il prefisso `$$` SOSTITUISCE le prime due cifre
 * dell'anno, quindi `$$140131` = 31/01/2014 (8 caratteri come una data
 * normale). Il secolo non c'e': si prende da quello dell'anno del database
 * (un database per anno). Un `$$` seguito da altro e' uno scarto.
 */
export type DtukDecodificata =
  | { readonly annullato: false; readonly data: DataIso }
  | {
      readonly annullato: true
      readonly data: DataIso | null
      readonly causa: 'PREFISSO_ANNULLO' | 'NON_POSITIVA'
    }

export type CodiceDtuk = 'DTUK_NON_VALIDA'

function dataDaOtto(testo: string): DataIso | null {
  if (!/^\d{8}$/.test(testo)) return null
  const anno = Number(testo.slice(0, 4))
  const mese = Number(testo.slice(4, 6))
  const giorno = Number(testo.slice(6, 8))
  return dataValida(anno, mese, giorno) ? iso(anno, mese, giorno) : null
}

export function decodificaDtuk(
  valore: string | null,
  annoDatabase: number
): Esito<DtukDecodificata, CodiceDtuk> {
  const t = (valore ?? '').trim()
  if (t.startsWith('$$')) {
    const m = /^\$\$(\d{2})(\d{4})$/.exec(t)
    const secolo = Math.floor(annoDatabase / 100) * 100
    const data = m ? dataDaOtto(`${secolo + Number(m[1])}${m[2]}`) : null
    return data
      ? ok({ annullato: true, data, causa: 'PREFISSO_ANNULLO' })
      : errore('DTUK_NON_VALIDA', 'DTUK: dopo il prefisso $$ attesi aammgg validi')
  }
  // Confronto per codice di carattere, come `dtuk > '0'` con collation binaria.
  if (t <= '0') return ok({ annullato: true, data: null, causa: 'NON_POSITIVA' })
  const data = dataDaOtto(t)
  return data
    ? ok({ annullato: false, data })
    : errore('DTUK_NON_VALIDA', 'DTUK: attesa una data aaaammgg valida')
}
