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
import { Prisma, type StatoTrasmissioneRentri } from '@prisma/client'
import { NESSUNA_CATENA_DA_RICONCILIARE } from './catena-importata'
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
  const mese = giornoItaliano(piuVecchia).slice(0, 7)
  const entro = fineMeseSuccessivo(mese)
  const giorniRimanenti = giorniFra(giornoItaliano(oggi), entro)
  return { mese, entro, scaduta: giorniRimanenti < 0, giorniRimanenti }
}

/**
 * Per ogni registro dell'azienda, la data di annotazione piu' vecchia fra le annotazioni non
 * confermate. Una sola query, nessun N+1. Va chiamata dentro il contesto dell'azienda (RLS).
 *
 * Conta: (a) le righe in uno stato di `STATI_DA_TRASMETTERE_PER_TERMINE`; (b) le annotazioni SENZA
 * riga che l'adozione automatica adottera' (stesso criterio di `adottaAutomatiche`, D3): registro
 * con invio automatico, annotazione nata dalla data in poi, una correzione solo se anche il suo
 * predecessore e' nato dopo la data, mai un movimento importato ne' la correzione di un importato
 * `DA_RICONCILIARE`. Le altre senza riga non ricevono mai una riga: contarle darebbe un termine
 * superato per sempre.
 */
export async function annotazioniPiuVecchieDaTrasmettere(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<Map<string, Date>> {
  const righe = await tx.$queryRaw<Array<{ registro_id: string; piu_vecchia: Date }>>`
    SELECT m."registro_id", MIN(m."registration_date") AS "piu_vecchia"
    FROM "waste_movements" m
    JOIN "registri_rifiuti" r ON r."id" = m."registro_id" AND r."tenant_id" = m."tenant_id"
    LEFT JOIN "waste_movements" p
      ON p."id" = m."movimento_rettificato_id" AND p."tenant_id" = m."tenant_id"
    LEFT JOIN "movimenti_trasmissione_rentri" t
      ON t."movimento_id" = m."id" AND t."tenant_id" = m."tenant_id"
    WHERE m."tenant_id" = ${tenantId}::uuid
      AND r."rentri_chiuso_il" IS NULL
      AND (
        t."id" IS NOT NULL AND t."stato"::text IN (${Prisma.join([...STATI_DA_TRASMETTERE_PER_TERMINE])})
        OR (
          t."id" IS NULL
          AND r."invio_rentri_automatico_dal" IS NOT NULL
          AND m."import_source" IS NULL
          AND ${NESSUNA_CATENA_DA_RICONCILIARE}
          AND m."created_at" >= r."invio_rentri_automatico_dal"
          AND (m."movimento_rettificato_id" IS NULL
               OR p."created_at" >= r."invio_rentri_automatico_dal")
        )
      )
    GROUP BY m."registro_id"`
  return new Map(righe.map(g => [g.registro_id, g.piu_vecchia]))
}
