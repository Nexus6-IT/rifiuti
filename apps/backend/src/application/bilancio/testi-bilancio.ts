import { formattaDataItaliana } from '../../core/time/anno-italiano'
import { formattaQuantita } from '../../core/format/formatta-quantita'
import type {
  BloccoBilancio,
  ConteggiSegnali,
  LacunaBilancio,
  PeriodoBilancio,
} from './bilancio.types'

// Testi fissati del bilancio (lacune e fonti): in italiano piano, mai "dichiarazione" o
// "attestazione". I test li confrontano carattere per carattere.

export function tonnellate(kg: number): string {
  return formattaQuantita(Math.round(kg) / 1000) + ' t'
}

const MESI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]

const NOME_SEGNALE: Record<keyof ConteggiSegnali, string> = {
  ritardiRegistro: 'Ritardi del registro',
  firSenzaRiscontro: 'FIR senza riscontro',
  avvisiDeposito: 'Avvisi del deposito temporaneo',
}

export const lacune = {
  nessunMovimento(): LacunaBilancio {
    return {
      blocco: 'PRODOTTO',
      codice: 'NESSUN_MOVIMENTO',
      testo: 'Nessun movimento vigente nel registro per il periodo: i totali sono a zero.',
    }
  },

  unitaNonConvertite(n: number): LacunaBilancio {
    return {
      blocco: 'PRODOTTO',
      codice: 'UNITA_NON_CONVERTITE',
      testo:
        n === 1
          ? "Un movimento in un'unità diversa da kg e t (litri, m³ o altro) non ha il peso specifico: non è nei totali."
          : `${n} movimenti in unità diverse da kg e t (litri, m³ o altro) non hanno il peso specifico: non sono nei totali.`,
    }
  },

  stimaPesoSpecifico(kg: number): LacunaBilancio {
    return {
      blocco: 'PRODOTTO',
      codice: 'STIMA_PESO_SPECIFICO',
      testo: `${tonnellate(kg)} vengono da litri o m³ convertiti con il peso specifico delle integrazioni del MUD: sono una stima.`,
    }
  },

  esclusiComeNelMud(kg: number, nonQuantificati: number): LacunaBilancio {
    let testo = `${tonnellate(kg)} del registro non sono conteggiati, con le stesse regole del MUD (causali escluse, FIR annullati o in bozza, doppi dello stesso FIR, rifiuti ricevuti da terzi): i motivi sono nella pagina MUD.`
    if (nonQuantificati === 1) testo += ' Un altro movimento escluso non è in kg.'
    else if (nonQuantificati > 1)
      testo += ` Altri ${nonQuantificati} movimenti esclusi non sono in kg.`
    return { blocco: 'PRODOTTO', codice: 'ESCLUSI_COME_NEL_MUD', testo }
  },

  confrontoParziale(
    annoPrecedente: number,
    anno: number,
    kgConfronto: number,
    kgMud: number
  ): LacunaBilancio {
    return {
      blocco: 'PRODOTTO',
      codice: 'CONFRONTO_PARZIALE',
      testo: `Il confronto con il ${annoPrecedente} conta solo i movimenti in kg e t, senza pesi specifici e senza togliere i doppi dello stesso FIR: per il ${anno} risultano ${tonnellate(kgConfronto)} invece di ${tonnellate(kgMud)}.`,
    }
  },

  /**
   * `senzaKg`: movimenti della quota in litri, m³ o altra unità, senza kg: sono contati in
   * `movimenti` ma non in `kg`, e il testo lo dice.
   */
  operazioneDaVerificare(kg: number, movimenti: number, senzaKg = 0): LacunaBilancio {
    let testo = `${tonnellate(kg)} (${movimenti === 1 ? '1 movimento' : `${movimenti} movimenti`}) hanno recupero o smaltimento dedotto dal FIR o non indicato: sono la quota da verificare.`
    if (senzaKg === 1) {
      testo += ' Di questi, uno non ha i kg: i suoi kg non sono compresi in questa cifra.'
    } else if (senzaKg > 1) {
      testo += ` Di questi, ${senzaKg} non hanno i kg: i loro kg non sono compresi in questa cifra.`
    }
    return { blocco: 'DESTINAZIONE', codice: 'OPERAZIONE_DA_VERIFICARE', testo }
  },

  scarichiNonRiconciliati(grezzoKg: number, mudKg: number): LacunaBilancio {
    return {
      blocco: 'DESTINAZIONE',
      codice: 'SCARICHI_NON_RICONCILIATI',
      testo: `Gli scarichi vigenti avviati a terzi sommano ${tonnellate(grezzoKg)} nel registro e non coincidono con recupero e smaltimento del MUD (${tonnellate(mudKg)}), che applica le sue regole di deduplica e di esclusione: la quota in operazioni preliminari (R13/D15) e il confronto con l'anno precedente sono una stima.`,
    }
  },

  preliminariNonCoerenti(): LacunaBilancio {
    return {
      blocco: 'DESTINAZIONE',
      codice: 'PRELIMINARI_NON_COERENTI',
      testo:
        'La quota in operazioni preliminari (R13/D15) supera il totale di recupero o di smaltimento: probabilmente ci sono scarichi doppi dello stesso FIR. Verificare nella pagina MUD.',
    }
  },

  mesiSenzaMovimenti(mesi: number[]): LacunaBilancio {
    return {
      blocco: 'MESI',
      codice: 'MESI_SENZA_MOVIMENTI',
      testo: `Mesi senza movimenti: ${mesi.map(m => MESI[m - 1]).join(', ')}. Un mese senza produzione è possibile: verificare che non manchino annotazioni.`,
    }
  },

  segnaleNonDisponibile(segnale: keyof ConteggiSegnali): LacunaBilancio {
    return {
      blocco: 'SEGNALI',
      codice: 'SEGNALE_NON_DISPONIBILE',
      testo: `${NOME_SEGNALE[segnale]}: conteggio non ancora disponibile.`,
    }
  },
}

export function fontiBilancio(
  periodo: PeriodoBilancio,
  oggi: Date
): Record<BloccoBilancio, string> {
  const [aaaa, mm, gg] = periodo.al.split('-')
  const R = `Dal registro di carico e scarico, movimenti al ${gg}/${mm}/${aaaa}`
  return {
    PRODOTTO: `${R}: carichi vigenti con causale di produzione, con le regole del MUD.`,
    DESTINAZIONE: `${R}: scarichi vigenti avviati a terzi; recupero o smaltimento dal codice operazione del movimento, poi dalla causale, poi dal FIR, come nel MUD.`,
    PRINCIPALI: `${R}: prodotto per codice EER.`,
    PERICOLOSI: `${R}: prodotto con codice EER pericoloso (asterisco).`,
    MUD: "Stato registrato nella pagina MUD; scadenza dal tracciato dell'anno, altrimenti il 30 aprile.",
    MESI: `${R}: mesi con almeno un movimento vigente.`,
    GIACENZA: `${R}: carichi e giacenze iniziali meno scarichi, solo kg e t.`,
    SEGNALI: `Conteggi al ${formattaDataItaliana(oggi)}.`,
  }
}
