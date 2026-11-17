import { CAUSALI_CONOU, type CausaleConou, type DatiConou } from '../dati-tracciato'
import type { ConfigurazioneConou } from '../configurazione-sede'
import { ATECO_PRIVATO_CONOU, PERCENTUALE_OLIO_MASSIMA } from './costanti'
import {
  PRODOTTI_CONOU,
  prodottiAmmessiPerCer,
  prodottoPredefinito,
  type ProdottoConou,
} from './prodotti-per-cer'

/**
 * Regole pure del CONOU (D11 e piano 4.9c-f, B1).
 */

/**
 * Causale (campo 24). Carico -> `E` (entrata), scarico -> `U` (uscita); `B`, `M`, `L`, `D` solo per
 * forzatura nei dati del movimento, mai dedotte (D11).
 */
export function causaleConou(
  verso: 'CARICO' | 'SCARICO',
  forzatura?: CausaleConou | null
): CausaleConou {
  if (forzatura && (CAUSALI_CONOU as readonly string[]).includes(forzatura)) return forzatura
  return verso === 'CARICO' ? 'E' : 'U'
}

/**
 * Quantita' in kg (campo 22): intero, con segno `-` per lo scarico interno (D11).
 * `null` se il peso non e' noto o non e' positivo.
 */
export function quantitaConou(kg: number | null, scaricoInterno: boolean): number | null {
  if (kg === null || !Number.isFinite(kg)) return null
  const intero = Math.round(Math.abs(kg))
  if (intero === 0) return null
  return scaricoInterno ? -intero : intero
}

export type FonteProdotto = 'MOVIMENTO' | 'PREDEFINITO_SEDE' | 'UNICO_AMMESSO'

export interface EsitoProdotto {
  prodotto: ProdottoConou | null
  fonte: FonteProdotto | null
  /** Vero se la tabella CER -> prodotti conosce il CER e il prodotto scelto non e' fra gli ammessi. */
  fuoriTabella: boolean
}

/**
 * Prodotto (campo 23): dati del movimento > predefinito per CER della sede > unico ammesso dalla
 * tabella CER -> prodotti > assente (avviso bloccante nel preparatore).
 */
export function prodottoConou(
  cer: string,
  dati: Pick<DatiConou, 'prodotto'> | null | undefined,
  configurazione: Pick<ConfigurazioneConou, 'predefinitiPerCer'> | null | undefined
): EsitoProdotto {
  const cifre = cer.replace(/\D/g, '')
  let prodotto: ProdottoConou | null = null
  let fonte: FonteProdotto | null = null
  if (dati?.prodotto && PRODOTTI_CONOU.includes(dati.prodotto)) {
    prodotto = dati.prodotto
    fonte = 'MOVIMENTO'
  } else {
    const p = configurazione?.predefinitiPerCer?.[cifre]?.prodotto
    if (p && PRODOTTI_CONOU.includes(p)) {
      prodotto = p
      fonte = 'PREDEFINITO_SEDE'
    } else {
      const u = prodottoPredefinito(cifre)
      if (u) {
        prodotto = u
        fonte = 'UNICO_AMMESSO'
      }
    }
  }
  const ammessi = prodottiAmmessiPerCer(cifre)
  const fuoriTabella = prodotto !== null && ammessi.length > 0 && !ammessi.includes(prodotto)
  return { prodotto, fonte, fuoriTabella }
}

/**
 * Percentuale di olio (campo 20): dati del movimento > predefinito per CER della sede.
 * `null` se non indicata.
 */
export function percentualeOlioEffettiva(
  cer: string,
  dati: Pick<DatiConou, 'percentualeOlio'> | null | undefined,
  configurazione: Pick<ConfigurazioneConou, 'predefinitiPerCer'> | null | undefined
): number | null {
  if (dati?.percentualeOlio !== undefined) return dati.percentualeOlio
  const p = configurazione?.predefinitiPerCer?.[cer.replace(/\D/g, '')]?.percentualeOlio
  return p ?? null
}

/**
 * Percentuale x 100 intera (`84.99` -> `8499`). `null` se fuori da 1..9999 (`PERCENTUALE_OLIO_MASSIMA`).
 */
export function percentualeConou(percentuale: number | null): number | null {
  if (percentuale === null || !Number.isFinite(percentuale)) return null
  const x100 = Math.round(percentuale * 100)
  return x100 >= 1 && x100 <= PERCENTUALE_OLIO_MASSIMA ? x100 : null
}

/**
 * ATECO (campo 8) nel formato `NN.NN.NN`; per un privato `0000` (`tipaz = 'P'`).
 * `null` se mancante o non valido (bloccante, come in WinWaste).
 */
export function atecoConou(ateco: string | null | undefined, privato: boolean): string | null {
  if (privato) return ATECO_PRIVATO_CONOU
  const v = (ateco ?? '').trim()
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(v)) return v
  if (/^\d{6}$/.test(v)) return `${v.slice(0, 2)}.${v.slice(2, 4)}.${v.slice(4, 6)}`
  return null
}
