/**
 * Scadenza della trasmissione mensile del registro a RENTRI (eREGI, pezzo E0).
 *
 * Regola applicata: i dati del registro si trasmettono con cadenza mensile, ENTRO LA FINE DEL MESE
 * SUCCESSIVO a quello dell'annotazione (DM 59/2023 art. 15 comma 2); nei mesi senza annotazioni la
 * trasmissione non e' dovuta. Il mese e il termine si contano sul calendario di Roma.
 *
 * ATTENZIONE, FONTE SECONDARIA: la regola e' ricavata da slide ANCE sul DM 59/2023 e dalla scheda
 * informativa RENTRI di Certifico, NON dal testo ufficiale. Il comma va riletto su Normattiva prima
 * di presentarlo come «termine di legge»: fino ad allora la UI lo chiama «termine indicativo»
 * (piano eREGI, rischio R6). Se il testo dovesse dire altro, si cambia solo `fineMeseSuccessivo`.
 *
 * Il termine e' una lettura: non chiama RENTRI e non scrive nulla.
 */
import type { Prisma, StatoTrasmissioneRentri } from '@prisma/client'
import { giornoItaliano } from '../../../core/time/anno-italiano'

export interface ScadenzaTrasmissione {
  /** Mese (Roma) dell'annotazione piu' vecchia ancora da trasmettere, 'AAAA-MM'. */
  mese: string
  /** Ultimo giorno utile, 'AAAA-MM-GG' (fine del mese successivo). */
  entro: string
  /** Vero se oggi (Roma) e' dopo `entro`. */
  scaduta: boolean
  /** Giorni di calendario da oggi a `entro`: 0 = scade oggi, negativo = scaduta da N giorni. */
  giorniRimanenti: number
}

/**
 * Stati che contano come «non ancora confermata da RENTRI»: la riga e' ferma e serve un'azione
 * (la riga assente conta allo stesso modo). `IN_INVIO` e `ATTESA_ESITO` sono in corso, `TRASMESSA`
 * e `GIA_SU_RENTRI` sono a posto, `DA_RICONCILIARE` (importati) non si trasmette prima della
 * riconciliazione: nessuno dei tre pesa sul termine.
 */
export const STATI_DA_TRASMETTERE_PER_TERMINE: readonly StatoTrasmissioneRentri[] = [
  'DA_TRASMETTERE',
  'RIFIUTATA',
  'NON_TRASMISSIBILE',
  'INCERTA',
]

const MS_GIORNO = 24 * 60 * 60 * 1000

/** Ultimo giorno del mese successivo a 'AAAA-MM', come 'AAAA-MM-GG'. */
function fineMeseSuccessivo(mese: string): string {
  const [anno, m] = mese.split('-').map(Number)
  // Giorno 0 del mese m+2 (indice m+1 + 1) = ultimo giorno del mese m+1 (successivo).
  const ultimo = new Date(Date.UTC(anno, m + 1, 0))
  return ultimo.toISOString().slice(0, 10)
}

function giorniFra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / MS_GIORNO)
}

/**
 * @param annotazioniNonConfermate date di annotazione (`registrationDate`) delle annotazioni che
 *   non risultano ancora confermate da RENTRI; l'ordine non conta.
 * @returns il termine della piu' vecchia, `null` se non ce ne sono
 * @throws Error se una data non e' valida (meglio nessun termine di uno inventato)
 */
export function scadenzaTrasmissione(
  annotazioniNonConfermate: readonly Date[],
  oggi: Date
): ScadenzaTrasmissione | null {
  if (annotazioniNonConfermate.length === 0) return null
  let piuVecchia = annotazioniNonConfermate[0]
  for (const d of annotazioniNonConfermate) {
    if (Number.isNaN(d.getTime())) throw new Error('Data di annotazione non valida')
    if (d.getTime() < piuVecchia.getTime()) piuVecchia = d
  }
  if (Number.isNaN(piuVecchia.getTime())) throw new Error('Data di annotazione non valida')
  const mese = giornoItaliano(piuVecchia).slice(0, 7)
  const entro = fineMeseSuccessivo(mese)
  const giorniRimanenti = giorniFra(giornoItaliano(oggi), entro)
  return { mese, entro, scaduta: giorniRimanenti < 0, giorniRimanenti }
}

/**
 * Per ogni registro dell'azienda, la data di annotazione piu' vecchia fra le annotazioni non
 * confermate (riga assente o in uno stato di `STATI_DA_TRASMETTERE_PER_TERMINE`). Una sola query,
 * nessun N+1. Va chiamata dentro il contesto dell'azienda (RLS).
 */
export async function annotazioniPiuVecchieDaTrasmettere(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<Map<string, Date>> {
  const gruppi = await tx.wasteMovement.groupBy({
    by: ['registroId'],
    where: {
      tenantId,
      OR: [
        { trasmissioneRentri: null },
        { trasmissioneRentri: { stato: { in: [...STATI_DA_TRASMETTERE_PER_TERMINE] } } },
      ],
    },
    _min: { registrationDate: true },
  })
  const mappa = new Map<string, Date>()
  for (const g of gruppi) {
    if (g._min.registrationDate) mappa.set(g.registroId, g._min.registrationDate)
  }
  return mappa
}
