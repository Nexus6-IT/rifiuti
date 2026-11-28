/**
 * Limite di data dell'esportazione XML mensile automatica (eREGI E7, piano Q4).
 *
 * Regola: il file di un mese si genera solo quando RENTRI ha confermato tutte le annotazioni di
 * quel mese e dei precedenti. Quindi si esportano le annotazioni con data di annotazione
 * ANTERIORE all'inizio (00:00 a Roma) del piu' basso fra:
 * - il mese corrente (il mese in corso non e' chiuso);
 * - il mese della piu' vecchia annotazione non ancora confermata da RENTRI.
 * «Non confermata» = riga `DA_TRASMETTERE`/`RIFIUTATA`/`NON_TRASMISSIBILE`/`INCERTA`, annotazione
 * che l'adozione automatica adottera' (stesse regole del termine E0) o invio ancora in corso
 * (`IN_INVIO`, `ATTESA_ESITO`). Gli importati `DA_RICONCILIARE` non pesano (non si trasmettono).
 *
 * Il mese si conta sul calendario di Roma, come il termine di trasmissione.
 */
import type { Prisma } from '@prisma/client'
import { giornoItaliano, inizioGiornoItaliano } from '../../../core/time/anno-italiano'
import { annotazioniPiuVecchieDaTrasmettere } from './scadenza-trasmissione-rentri'

/** Primo istante (00:00 a Roma) del mese di calendario di Roma che contiene `istante`. */
export function inizioMeseItaliano(istante: Date): Date {
  if (Number.isNaN(istante.getTime())) throw new Error('Data non valida')
  return inizioGiornoItaliano(`${giornoItaliano(istante).slice(0, 8)}01`)
}

/**
 * @param piuVecchiaNonConfermata data di annotazione della piu' vecchia annotazione non confermata
 *   del registro, `null` se non ce ne sono
 * @returns istante di cui le annotazioni da esportare devono essere strettamente anteriori
 * @throws Error se una data non e' valida (meglio nessun file di un limite inventato)
 */
export function limiteEsportazioneMensile(piuVecchiaNonConfermata: Date | null, oggi: Date): Date {
  const inizioCorrente = inizioMeseItaliano(oggi)
  if (piuVecchiaNonConfermata === null) return inizioCorrente
  const inizioDelMese = inizioMeseItaliano(piuVecchiaNonConfermata)
  return inizioDelMese.getTime() < inizioCorrente.getTime() ? inizioDelMese : inizioCorrente
}

/**
 * Per ogni registro dell'azienda, la data di annotazione piu' vecchia fra le annotazioni non ancora
 * confermate da RENTRI (comprese quelle con invio in corso). Va chiamata nel contesto dell'azienda.
 */
export async function piuVecchiaNonConfermataPerRegistro(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<Map<string, Date>> {
  const risultato = await annotazioniPiuVecchieDaTrasmettere(tx, tenantId)
  const inCorso = await tx.$queryRaw<Array<{ registro_id: string; piu_vecchia: Date }>>`
    SELECT m."registro_id", MIN(m."registration_date") AS "piu_vecchia"
    FROM "movimenti_trasmissione_rentri" t
    JOIN "waste_movements" m ON m."id" = t."movimento_id" AND m."tenant_id" = t."tenant_id"
    WHERE t."tenant_id" = ${tenantId}::uuid
      AND t."stato"::text IN ('IN_INVIO', 'ATTESA_ESITO')
    GROUP BY m."registro_id"`
  for (const r of inCorso) {
    const attuale = risultato.get(r.registro_id)
    if (!attuale || r.piu_vecchia.getTime() < attuale.getTime()) {
      risultato.set(r.registro_id, r.piu_vecchia)
    }
  }
  return risultato
}
