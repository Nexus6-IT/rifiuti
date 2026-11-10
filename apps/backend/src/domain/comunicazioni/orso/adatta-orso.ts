import { giornoItaliano } from '../../../core/time/anno-italiano'
import type { AggregatoOrso, MovimentoOrso } from './aggregato'
import type { ImpiantoMesiDati, RifiutoProdottoDati, RifiutoRicevutoDati } from './impianto-mesi'

/**
 * Adattatori puri del servizio O.R.SO. (4.9a, T4): dal movimento del lettore Prisma a quello
 * dell'aggregatore, e dall'uscita dell'aggregatore al tipo d'ingresso del serializzatore XML.
 */

/** Forma minima del movimento del lettore (`application/comunicazioni/lettore-movimenti-orso`). */
export interface MovimentoLetto {
  id: string
  tipo: 'CARICO' | 'SCARICO'
  movementDate: Date
  cer: string
  descrizione: string | null
  quantita: number
  unita: string | null
  /** kg già convertiti dal lettore (peso specifico compreso); null se non convertibile */
  kg: number | null
  ruolo: string
  operationCode: string | null
  conFir: boolean
  provinciaConferitore: string | null
}

/**
 * Il lettore ha già convertito in kg: se c'è un valore lo si passa come `kg`, altrimenti si
 * lascia l'unità originale, che l'aggregatore riconosce come non convertibile (avviso bloccante).
 */
export function adattaMovimentiOrso(letti: readonly MovimentoLetto[]): MovimentoOrso[] {
  return letti.map(m => {
    const operazione = (m.operationCode ?? '').trim()
    return {
      id: m.id,
      mese: Number(giornoItaliano(m.movementDate).slice(5, 7)),
      verso: m.tipo,
      ruoloMud: m.ruolo,
      cer: m.cer,
      descrizione: m.descrizione,
      quantita: m.kg !== null ? m.kg : m.quantita,
      unita: m.kg !== null ? 'kg' : m.unita,
      kgPerUnita: null,
      operazione: operazione === '' ? null : operazione,
      conFir: m.conFir,
      provinciaConferitore: m.provinciaConferitore,
    }
  })
}

const NON_ZERO = /[1-9]/

/** Uscita dell'aggregatore → dati del serializzatore (soggetto «Tot» per tutti, `s` = 0). */
export function aggregatoInImpiantoMesi(a: AggregatoOrso, autore?: string): ImpiantoMesiDati {
  const mesi = a.mesi.map(m => ({
    mese: m.mese,
    ricevuti: m.ricevuti.map((r): RifiutoRicevutoDati => {
      const ingressi: RifiutoRicevutoDati['ingressi'] = [{ q: r.totale, f: r.f, ts: 'Tot', s: '0' }]
      if (NON_ZERO.test(r.extra)) ingressi.push({ q: r.extra, f: r.f, ts: 'Extra', s: '0' })
      return { cer: r.cer, descrizione: r.descrizione, operazioni: r.operazioni, ingressi }
    }),
    prodotti: m.prodotti.map(
      (p): RifiutoProdottoDati => ({
        cer: p.cer,
        descrizione: p.descrizione,
        quantitaTrattataInternamente: p.trattatoInternamente,
        uscite: NON_ZERO.test(p.totale) ? [{ q: p.totale, ts: 'Tot', s: '0' }] : [],
      })
    ),
  }))
  return { ...(autore ? { autore } : {}), anni: [{ anno: a.anno, mesi }] }
}

/**
 * Movimenti che l'aggregatore conta davvero (carichi ricevuti da terzi, scarichi non esclusi) e
 * che hanno una quantità in kg: sono quelli dell'istantanea di una comunicazione.
 */
export function movimentiConteggiati<T extends MovimentoLetto>(letti: readonly T[]): T[] {
  return letti.filter(
    m =>
      m.kg !== null &&
      ((m.tipo === 'CARICO' && m.ruolo === 'RICEVUTO_DA_TERZI') ||
        (m.tipo === 'SCARICO' && m.ruolo !== 'ESCLUSO'))
  )
}

/** Movimenti conteggiati con descrizione vuota: l'XSD pretende 1-100 caratteri. */
export function movimentiSenzaDescrizione<T extends MovimentoLetto>(letti: readonly T[]): T[] {
  return movimentiConteggiati(letti).filter(m => (m.descrizione ?? '').trim() === '')
}
