/**
 * Condizioni di pagamento e calcolo delle scadenze (D6, 4.1a): regole pure.
 *
 * Una condizione e' un elenco di rate espresse in giorni dalla data documento (1-8 rate, 0-365,
 * crescenti; `0` e' ammesso solo come rata unica = "a vista"), piu' il flag "fine mese".
 *
 * Regola "30 giorni = un mese" (E15, fonte WinWaste): i giorni multipli di 30 sono mesi di
 * calendario (31/01 + 30 -> 28/02 o 29/02, clamp all'ultimo giorno del mese), gli altri sono
 * giorni. Con `fineMese` la scadenza va all'ultimo giorno del mese risultante.
 *
 * Le date viaggiano come stringhe `YYYY-MM-DD`: nessun fuso orario, nessun `Date` locale (il
 * calcolo usa `Date.UTC` solo come calendario). La ripartizione degli importi fra le rate e'
 * di 4.4.
 */
import { validaCodiceTabella } from './codice-tabella'

export { validaCodiceTabella }

export const MODALITA_PAGAMENTO = ['MP01', 'MP02', 'MP05', 'MP08', 'MP12', 'MP19', 'MP23'] as const
export type ModalitaPagamento = (typeof MODALITA_PAGAMENTO)[number]

export const ETICHETTE_MODALITA: Readonly<Record<ModalitaPagamento, string>> = {
  MP01: 'Contanti',
  MP02: 'Assegno',
  MP05: 'Bonifico',
  MP08: 'Carta di pagamento',
  MP12: 'RiBa',
  MP19: 'SEPA Direct Debit',
  MP23: 'PagoPA',
}

export interface DatiCondizionePagamento {
  codice: string
  descrizione: string
  modalita: ModalitaPagamento
  giorniRate: number[]
  fineMese: boolean
}

type ParteRate = Pick<DatiCondizionePagamento, 'giorniRate' | 'fineMese'>

export function normalizzaCondizione(
  g: Partial<Record<keyof DatiCondizionePagamento, unknown>>
): DatiCondizionePagamento {
  const testo = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  return {
    codice: testo(g.codice),
    descrizione: testo(g.descrizione),
    modalita: testo(g.modalita).toUpperCase() as ModalitaPagamento,
    giorniRate: Array.isArray(g.giorniRate)
      ? g.giorniRate.map(x => (typeof x === 'string' && x.trim() === '' ? NaN : Number(x)))
      : [],
    fineMese: g.fineMese === true || g.fineMese === 'true',
  }
}

export function validaCondizione(d: DatiCondizionePagamento): string[] {
  const errori: string[] = []

  const mCodice = validaCodiceTabella(d.codice, 10, 'Il codice')
  if (mCodice) errori.push(mCodice)

  if (d.descrizione === '') errori.push('Indica la descrizione.')
  else if (d.descrizione.length > 100) {
    errori.push('La descrizione può avere al massimo 100 caratteri.')
  }

  if (!MODALITA_PAGAMENTO.includes(d.modalita)) errori.push('Modalità di pagamento non ammessa.')

  const giorni = d.giorniRate
  if (giorni.length === 0) errori.push('Indica almeno una rata.')
  else if (giorni.length > 8) errori.push('Al massimo 8 rate.')
  else if (giorni.some(x => !Number.isInteger(x) || x < 0 || x > 365)) {
    errori.push('I giorni delle rate vanno da 0 a 365.')
  } else if (giorni.includes(0) && giorni.length > 1) {
    errori.push('Il pagamento a vista ha una sola rata.')
  } else if (giorni.some((x, i) => i > 0 && x <= giorni[i - 1])) {
    errori.push('I giorni delle rate devono essere crescenti.')
  }

  return errori
}

function analizza(data: string): { a: number; m: number; g: number } {
  const [a, m, g] = data.split('-').map(Number)
  return { a, m, g }
}

function formatta(a: number, m: number, g: number): string {
  return `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`
}

function giorniDelMese(a: number, m: number): number {
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}

function aggiungiMesi(a: number, m: number, g: number, mesi: number): [number, number, number] {
  const indice = a * 12 + (m - 1) + mesi
  const na = Math.floor(indice / 12)
  const nm = (indice % 12) + 1
  return [na, nm, Math.min(g, giorniDelMese(na, nm))]
}

function aggiungiGiorni(a: number, m: number, g: number, giorni: number): [number, number, number] {
  const d = new Date(Date.UTC(a, m - 1, g + giorni))
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
}

/** Scadenze (`YYYY-MM-DD`) di ogni rata a partire dalla data documento. */
export function calcolaScadenze(dataDocumento: string, c: ParteRate): string[] {
  const { a, m, g } = analizza(dataDocumento)
  return c.giorniRate.map(giorni => {
    const [na, nm, giorno] =
      giorni === 0
        ? ([a, m, g] as [number, number, number])
        : giorni % 30 === 0
          ? aggiungiMesi(a, m, g, giorni / 30)
          : aggiungiGiorni(a, m, g, giorni)
    return formatta(na, nm, c.fineMese ? giorniDelMese(na, nm) : giorno)
  })
}

/** Descrizione breve per elenchi: "a vista", "30-60 gg fine mese". */
export function descriviRate(c: ParteRate): string {
  if (c.giorniRate.length === 1 && c.giorniRate[0] === 0 && !c.fineMese) return 'a vista'
  const rate =
    c.giorniRate.length === 1 && c.giorniRate[0] === 0 ? 'a vista' : `${c.giorniRate.join('-')} gg`
  return c.fineMese ? `${rate} fine mese` : rate
}
