import { formattaQuantita } from '../../core/format/formatta-quantita'

export const ANNI_VERIFICAZIONE = 3
export const PESO_MASSIMO_KG = 99_999_999.99
const TOLLERANZA_OROLOGIO_MS = 5 * 60 * 1000
/** Portata minima tipica: 20 divisioni (classe III, da confermare per classe). */
const DIVISIONI_MINIME = 20

export interface StrumentoPerRegole {
  portataMaxKg: number | null
  divisioneKg: number | null
  /** YYYY-MM-DD */
  dataUltimaVerificazione: string | null
  attivo: boolean
}

export interface InputPesataManuale {
  pesoKg: number
  oraStrumento: Date | null
  adesso: Date
  strumento: StrumentoPerRegole | null
  oraPrimaPesata?: Date | null
}

function dataItaliana(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Verificazione scaduta se l'ultima è più vecchia di 3 anni (`data` e `oggi` YYYY-MM-DD). */
export function verificazioneScaduta(data: string, oggi: string): boolean {
  const scadenza = `${Number(data.slice(0, 4)) + ANNI_VERIFICAZIONE}${data.slice(4, 10)}`
  return scadenza < oggi
}

export function validaPesataManuale(input: InputPesataManuale): {
  errori: string[]
  avvisi: string[]
} {
  const errori: string[] = []
  const avvisi: string[] = []
  const { pesoKg, strumento } = input

  const centesimi = pesoKg * 100
  const pesoValido = Number.isFinite(pesoKg) && pesoKg > 0 && pesoKg <= PESO_MASSIMO_KG
  if (!Number.isFinite(pesoKg)) {
    errori.push('Il peso non è un numero valido.')
  } else if (pesoKg <= 0) {
    errori.push('Il peso deve essere maggiore di zero.')
  } else if (pesoKg > PESO_MASSIMO_KG) {
    errori.push(`Il peso non può superare ${formattaQuantita(PESO_MASSIMO_KG)} kg.`)
  } else if (Math.abs(centesimi - Math.round(centesimi)) > 1e-6) {
    errori.push('Il peso ammette al massimo due decimali.')
  }
  const pesoUtilizzabile = pesoValido && Math.abs(centesimi - Math.round(centesimi)) <= 1e-6

  if (strumento) {
    if (!strumento.attivo) errori.push('Lo strumento non è attivo.')
    if (pesoUtilizzabile && strumento.portataMaxKg !== null && pesoKg > strumento.portataMaxKg) {
      errori.push(
        `Il peso supera la portata massima dello strumento (${formattaQuantita(strumento.portataMaxKg)} kg): non è una pesata valida.`
      )
    }
  }

  if (input.oraStrumento) {
    if (input.oraStrumento.getTime() > input.adesso.getTime() + TOLLERANZA_OROLOGIO_MS) {
      errori.push("L'ora dello strumento è nel futuro: controlla data e ora.")
    }
    if (input.oraPrimaPesata && input.oraStrumento.getTime() < input.oraPrimaPesata.getTime()) {
      errori.push('La seconda pesata non può essere precedente alla prima.')
    }
  }

  if (strumento && pesoUtilizzabile) {
    const div = strumento.divisioneKg
    if (div !== null && div > 0) {
      const pesoMilli = Math.round(pesoKg * 1000)
      const divMilli = Math.round(div * 1000)
      if (pesoMilli % divMilli !== 0) {
        avvisi.push(
          `Il peso non è un multiplo della divisione dello strumento (${formattaQuantita(div)} kg): controlla di averlo trascritto bene.`
        )
      }
      if (pesoKg < DIVISIONI_MINIME * div) {
        avvisi.push(
          `Il peso è inferiore a ${DIVISIONI_MINIME} divisioni dello strumento (${formattaQuantita(DIVISIONI_MINIME * div)} kg): sotto la portata minima.`
        )
      }
    }
  }

  if (strumento) {
    if (!strumento.dataUltimaVerificazione) {
      avvisi.push('Nessuna verificazione registrata per lo strumento.')
    } else {
      const oggi = input.adesso.toISOString().slice(0, 10)
      if (verificazioneScaduta(strumento.dataUltimaVerificazione, oggi)) {
        avvisi.push(
          `La verificazione periodica dello strumento è scaduta (ultima il ${dataItaliana(strumento.dataUltimaVerificazione)}).`
        )
      }
    }
  }

  return { errori, avvisi }
}
