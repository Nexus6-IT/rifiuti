import { dataValida, DataIso, Esito, errore, iso, ok } from './risultato'

/**
 * Decodifica delle anagrafiche WinWaste (`CLIFOR`, `UNITA LOCALI`, `AUTORIZZAZIONI`, `AUTOMEZZI`).
 *
 * FORMA PRESUNTA (`dedotta`): le larghezze e i formati vengono da `docs/schema-db-winwaste.md`
 * §2.2 e §2.5, non da un `.bak` vero. Nessun errore riporta valori (possono essere dati
 * dell'azienda): solo codici e il nome del campo.
 */

export interface Indirizzo {
  readonly via: string
  readonly civico: string
  readonly cap: string
  readonly comune: string
  readonly provincia: string
}

export type CodiceIndirizzo = 'INDIRIZZO_INCOMPLETO'

const pulisci = (v: string | null | undefined): string => (v ?? '').replace(/\s+/g, ' ').trim()

/**
 * Indirizzo di una sede di WasteFlow: via, comune, CAP (5 cifre) e provincia (2 lettere) sono
 * obbligatori; il civico mancante diventa `SNC` (senza numero civico), non un valore inventato.
 */
export function decodificaIndirizzo(c: {
  via: string | null
  civico: string | null
  cap: string | null
  comune: string | null
  provincia: string | null
}): Esito<Indirizzo, CodiceIndirizzo> {
  const via = pulisci(c.via)
  const comune = pulisci(c.comune)
  const cap = pulisci(c.cap)
  const provincia = pulisci(c.provincia).toUpperCase()
  const civico = pulisci(c.civico) || 'SNC'
  if (
    via === '' ||
    via.length > 255 ||
    comune === '' ||
    comune.length > 100 ||
    !/^[0-9]{5}$/.test(cap) ||
    !/^[A-Z]{2}$/.test(provincia) ||
    civico.length > 20
  ) {
    return errore(
      'INDIRIZZO_INCOMPLETO',
      'indirizzo: via, civico, CAP, comune o provincia non validi'
    )
  }
  return ok({ via, civico, cap, comune, provincia })
}

/** Targa come la vuole il CHECK di `automezzi`: `^[A-Z0-9]{2,15}$`. `null` se non e' normalizzabile. */
export function normalizzaTarga(v: string | null | undefined): string | null {
  const t = pulisci(v)
    .toUpperCase()
    .replace(/[\s.-]/g, '')
  return /^[A-Z0-9]{2,15}$/.test(t) ? t : null
}

/** `AUTOMEZZI.TARA` (varchar 6) in kg interi positivi; il punto e' separatore delle migliaia. */
export function decodificaTaraKg(v: string | null | undefined): number | null {
  const t = pulisci(v).replace(/\./g, '')
  if (!/^[0-9]{1,6}$/.test(t)) return null
  const n = Number(t)
  return n > 0 ? n : null
}

/** `AUTOMEZZI.RIMORCHIO` e' un flag da 1 carattere: vuoto, `0` e `N` = motrice. Forma presunta. */
export function esRimorchio(v: string | null | undefined): boolean {
  const t = pulisci(v).toUpperCase()
  return !(t === '' || t === '0' || t === 'N')
}

/** Data testo di `AUTORIZZAZIONI` (`gg-mm-aaaa`, `gg/mm/aaaa`, `aaaammgg`, `aaaa-mm-gg`) o `null`. */
export function dataAutorizzazione(v: string | null | undefined): DataIso | null {
  const t = pulisci(v)
  let m = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(t)
  if (m) return dataValida(+m[3], +m[2], +m[1]) ? iso(+m[3], +m[2], +m[1]) : null
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(t) ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) return dataValida(+m[1], +m[2], +m[3]) ? iso(+m[1], +m[2], +m[3]) : null
  return null
}

/**
 * `soggetto.unita'` (11 caratteri, `PROD`/`TRAS`/`SMAL` di `MOVIMENTI`, `PRECOD` di `AUTORIZZAZIONI`
 * e `AUTOMEZZI`) oppure il solo soggetto (`PRECOD` di `UNITA LOCALI`, 6 caratteri o 7 con il C/F
 * davanti). `null` se non ha la forma attesa o e' «nessun soggetto» (vuoto, `0`).
 */
export function separaSoggettoUnita(
  v: string | null | undefined
): { soggetto: string; unita: string | null } | null {
  const t = pulisci(v)
  if (t === '' || t === '0') return null
  const m = /^([0-9A-Za-z]{1,6})\.([0-9A-Za-z]{1,4})$/.exec(t)
  if (m) return { soggetto: m[1], unita: m[2] }
  if (/^[CF][0-9A-Za-z]{6}$/.test(t)) return { soggetto: t.slice(1), unita: null }
  if (/^[0-9A-Za-z]{1,6}$/.test(t)) return { soggetto: t, unita: null }
  return null
}
