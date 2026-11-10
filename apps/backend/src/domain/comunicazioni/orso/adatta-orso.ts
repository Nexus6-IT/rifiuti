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
    const operazione = normalizzaOperazione(m.operationCode)
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
      operazione,
      conFir: m.conFir,
      provinciaConferitore: m.provinciaConferitore,
    }
  })
}

/**
 * Codice operazione R/D come lo vuole O.R.SO.: «R 13» e «r13» diventano «R13». Un codice che non
 * si riconosce (per esempio «R13/R4») diventa null: l'aggregatore lo segnala per movimento.
 */
export function normalizzaOperazione(codice: string | null | undefined): string | null {
  const c = (codice ?? '').replace(/\s+/g, '').toUpperCase()
  return /^[RD]\d{1,2}$/.test(c) ? c : null
}

const NON_ZERO = /[1-9]/

/** Uscita dell'aggregatore → dati del serializzatore (soggetto «Tot» per tutti, `s` = 0). */
export function aggregatoInImpiantoMesi(
  a: AggregatoOrso,
  autore?: string,
  ultimoMese = 12
): ImpiantoMesiDati {
  // Tutti i mesi dell'anno: un mese senza nodi dice a O.R.SO. che non si sono ritirati né prodotti
  // rifiuti (guida v2.5, pag. 16); un mese assente resterebbe non compilato.
  const perMese = new Map(a.mesi.map(m => [m.mese, m]))
  const tutti = Array.from({ length: ultimoMese }, (_, i) => {
    return perMese.get(i + 1) ?? { mese: i + 1, ricevuti: [], prodotti: [] }
  })
  const mesi = tutti.map(m => ({
    mese: m.mese,
    ricevuti: m.ricevuti.map((r): RifiutoRicevutoDati => {
      const ingressi: RifiutoRicevutoDati['ingressi'] = [{ q: r.totale, f: r.f, ts: 'Tot', s: '0' }]
      // Tot ed Extra sono entrambi obbligatori in modalità normale (guida v2.5, pag. 14)
      ingressi.push({ q: r.extra, f: r.f, ts: 'Extra', s: '0' })
      return { cer: r.cer, descrizione: r.descrizione, operazioni: r.operazioni, ingressi }
    }),
    prodotti: m.prodotti.map(
      (p): RifiutoProdottoDati => ({
        cer: p.cer,
        descrizione: p.descrizione,
        quantitaTrattataInternamente: p.giacenzaFineMese,
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
