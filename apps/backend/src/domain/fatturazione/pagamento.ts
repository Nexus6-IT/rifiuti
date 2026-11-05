import { Prisma } from '@prisma/client'
import { calcolaScadenze } from '../clienti/condizione-pagamento'
import { ibanValido, normalizzaIban } from '../clienti/iban'
import type { ErroreDocumento, Segnalazione } from './codici'
import type { RataCalcolata } from './tipi'

export interface DatiBanca {
  istituto: string | null
  iban: string | null
  bic: string | null
}

/** ABI (caratteri 6-10) e CAB (11-15) di un IBAN italiano valido; altrimenti null. */
export function abiCabDaIban(iban: string): { abi: string; cab: string } | null {
  const n = normalizzaIban(iban)
  if (!n.startsWith('IT') || !ibanValido(n)) return null
  return { abi: n.slice(5, 10), cab: n.slice(10, 15) }
}

/**
 * Rate di pagamento (spec §6.11, P2): quota = netto / n troncata al centesimo, il resto
 * sull'ultima rata. Con scissione dei pagamenti il `netto` passato dal chiamante e' gia' senza IVA.
 * MP05 usa il conto del cedente, MP12 la banca del cliente; MP01 non e' ammesso con split o differita.
 */
export function calcolaRate(i: {
  netto: string
  dataDocumento: string
  condizione: { modalita: string; giorniRate: readonly number[]; fineMese: boolean }
  esigibilita: 'I' | 'D' | 'S'
  contoCedente: DatiBanca | null
  bancaCliente: DatiBanca | null
}): {
  condizioniPagamento: 'TP01' | 'TP02'
  rate: RataCalcolata[]
  errori: Segnalazione<ErroreDocumento>[]
} {
  const errori: Segnalazione<ErroreDocumento>[] = []
  const { modalita } = i.condizione
  const n = i.condizione.giorniRate.length
  const condizioniPagamento = n > 1 ? 'TP01' : 'TP02'

  if (modalita === 'MP01' && i.esigibilita !== 'I') {
    errori.push({ codice: 'PAGAMENTO_NON_AMMESSO' })
  }

  let banca: DatiBanca | null = null
  if (modalita === 'MP05' || modalita === 'MP12') {
    const sorgente = modalita === 'MP05' ? i.contoCedente : i.bancaCliente
    const iban = sorgente?.iban ? normalizzaIban(sorgente.iban) : null
    if (sorgente === null || iban === null || !ibanValido(iban)) {
      errori.push({ codice: 'PAGAMENTO_SENZA_BANCA' })
    } else {
      banca = { istituto: sorgente.istituto, iban, bic: sorgente.bic }
    }
  }
  const abiCab = banca?.iban ? abiCabDaIban(banca.iban) : null

  if (n === 0) return { condizioniPagamento, rate: [], errori }

  const date = calcolaScadenze(i.dataDocumento, {
    giorniRate: [...i.condizione.giorniRate],
    fineMese: i.condizione.fineMese,
  })
  const netto = new Prisma.Decimal(i.netto)
  const quota = netto.div(n).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN)
  let somma = new Prisma.Decimal(0)
  const rate: RataCalcolata[] = date.map((dataScadenza, idx) => {
    const importo = idx === n - 1 ? netto.minus(somma) : quota
    somma = somma.plus(importo)
    return {
      ordine: idx + 1,
      modalita,
      dataScadenza,
      importo: importo.toFixed(2),
      istituto: banca?.istituto ?? null,
      iban: banca?.iban ?? null,
      abi: abiCab?.abi ?? null,
      cab: abiCab?.cab ?? null,
      bic: banca?.bic ?? null,
    }
  })
  return { condizioniPagamento, rate, errori }
}
