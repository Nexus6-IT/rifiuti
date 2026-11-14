import { numeroZeri } from '../fisso/campo-fisso'
import {
  ATTIVITA_ORR,
  LETTERA_ATTIVITA_ORR,
  MESI_ORR,
  PROVINCE_CAMPANIA,
  type AttivitaOrr,
} from './costanti'

/**
 * Nome del file O.R.R.: `<iniziale provincia><codice sede 4 cifre><mese finale 2 lettere><aa><attivita'>.txt`
 * (`Campania:nomefile`). L'esempio `N0001GE25T.txt` e' ricostruito, non letto da un file reale.
 */

/** Iniziale della provincia scelta (`A B C N S`): primo carattere della sigla di una provincia campana. */
export function inizialeProvinciaOrr(siglaProvincia: string): string {
  const sigla = siglaProvincia.trim().toUpperCase()
  if (!(sigla in PROVINCE_CAMPANIA)) {
    throw new RangeError(`provincia non campana: ${JSON.stringify(siglaProvincia)}`)
  }
  return sigla[0]
}

// INFERENZA (WinWaste, 14/11): WinWaste usa la parte dopo il punto del codice `ul` (4 caratteri); in
// WasteFlow non esiste, si usa il progressivo MUD della sede a 4 cifre.
export function codiceUnitaLocaleOrr(progressivoMud: number | null | undefined): string | null {
  if (progressivoMud === null || progressivoMud === undefined) return null
  if (!Number.isInteger(progressivoMud) || progressivoMud < 0 || progressivoMud > 9999) return null
  return numeroZeri(progressivoMud, 4)
}

/** Mese a due lettere (`GE`..`DI`) da un mese 1-12. */
export function meseOrr(mese: number): string {
  if (!Number.isInteger(mese) || mese < 1 || mese > 12) {
    throw new RangeError(`mese non valido: ${mese}`)
  }
  return MESI_ORR[mese - 1]
}

export function nomeFileOrr(
  siglaProvincia: string,
  codiceSede: string,
  meseFinale: number,
  anno: number,
  attivita: AttivitaOrr
): string {
  if (!/^[0-9]{4}$/.test(codiceSede)) {
    throw new RangeError(`codice sede non valido: ${JSON.stringify(codiceSede)}`)
  }
  if (!Number.isInteger(anno) || anno < 1000 || anno > 9999) {
    throw new RangeError(`anno non valido: ${anno}`)
  }
  if (!ATTIVITA_ORR.includes(attivita)) throw new RangeError(`attivita' non valida: ${attivita}`)
  const aa = String(anno % 100).padStart(2, '0')
  return `${inizialeProvinciaOrr(siglaProvincia)}${codiceSede}${meseOrr(meseFinale)}${aa}${LETTERA_ATTIVITA_ORR[attivita]}.txt`
}
