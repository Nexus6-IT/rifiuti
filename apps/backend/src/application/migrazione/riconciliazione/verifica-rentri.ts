/**
 * Confronto 5, parte RENTRI (I8 T3): verifica IN SOLA LETTURA degli identificativi importati. Usa solo
 * `GET .../movimento/{identificativo}` (`dettaglioMovimentoPerIdentificativo`); non esiste nessun
 * percorso verso `inviaMovimenti` o altre POST: l'interfaccia `LettoreRentri` espone un solo metodo, e il
 * test prova che un finto client con `inviaMovimenti` che lancia non viene mai toccato.
 *
 * Il dubbio non si risolve mai reinviando: un 404 e' `ASSENTE`, qualunque altro errore e'
 * `NON_RAGGIUNGIBILE` (e il confronto resta differenza, da accettare con motivo).
 */
import {
  EsitoVerificaRentri,
  VerificaRentri,
} from '../../../domain/migrazione/riconciliazione/tipi'

/** Il solo metodo del client RENTRI che la riconciliazione puo' usare. */
export interface LettoreRentri {
  dettaglioMovimentoPerIdentificativo(
    identificativoRegistro: string,
    identificativoMovimento: string,
    opzioni?: { variazioni?: boolean },
    tenantId?: string
  ): Promise<unknown>
}

export interface OpzioniVerificaRentri {
  /** Pausa fra due richieste (limite di frequenza); 0 nei test. */
  readonly pausaMs?: number
  /** Al massimo questo numero di identificativi: gli altri restano non verificati. */
  readonly massimo?: number
  readonly tenantId?: string
}

const attendi = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function esitoDaErrore(errore: unknown): EsitoVerificaRentri {
  const status = (errore as { status?: unknown } | null)?.status
  return status === 404 ? 'ASSENTE' : 'NON_RAGGIUNGIBILE'
}

export async function verificaRentriSolaLettura(
  lettore: LettoreRentri,
  identificativi: ReadonlyArray<{ identificativo: string; registroRentri: string | null }>,
  opzioni: OpzioniVerificaRentri = {}
): Promise<VerificaRentri[]> {
  const pausa = opzioni.pausaMs ?? 250
  const daVerificare = identificativi.slice(0, opzioni.massimo ?? identificativi.length)
  const esiti: VerificaRentri[] = []
  for (const [i, voce] of daVerificare.entries()) {
    if (i > 0 && pausa > 0) await attendi(pausa)
    if (!voce.registroRentri) {
      esiti.push({ identificativo: voce.identificativo, esito: 'NON_RAGGIUNGIBILE' })
      continue
    }
    try {
      await lettore.dettaglioMovimentoPerIdentificativo(
        voce.registroRentri,
        voce.identificativo,
        { variazioni: false },
        opzioni.tenantId
      )
      esiti.push({ identificativo: voce.identificativo, esito: 'PRESENTE' })
    } catch (errore) {
      esiti.push({ identificativo: voce.identificativo, esito: esitoDaErrore(errore) })
    }
  }
  // Quelli oltre il massimo non sono stati verificati: non compaiono fra gli esiti, quindi il confronto
  // li vede come mancanti (`verifica-presenti` < identificativi) e resta differenza.
  return esiti
}
