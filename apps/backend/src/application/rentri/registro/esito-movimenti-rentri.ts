/**
 * Lettura pura dell'esito di una transazione `POST .../movimenti` per annotazione (D9, Q3).
 *
 * REGOLA CHIAVE: una riga e' `TRASMESSA` SOLO se il suo (anno, progressivo) compare, una volta,
 * fra le registrazioni confermate da RENTRI (anche con `errore = true`, Q3). Nessun'altra via
 * porta a `TRASMESSA`: senza conferma esplicita la riga e' `RIFIUTATA` (difetto WinWaste 2).
 *
 * ATTENZIONE per il chiamante (Task 7-10): questa funzione riceve un esito GIA' DECODIFICATO,
 * cioe' RENTRI ha elaborato la transazione e risposto. NON va chiamata quando l'esito non e'
 * stato letto: un `TrasmissioneRentriIncertaError` (si distingue per `causa`), una
 * `TransazioneRentriNonTrovataError`, un `RentriApiError` con `retryable = true` (429/423
 * esauriti: lotto NON elaborato, resta `DA_TRASMETTERE`, non e' un rifiuto) o un timeout della
 * lettura dell'esito non sono `RIFIUTATA`. Quegli errori si mappano per `causa`/tipo, mai per
 * testo del messaggio.
 */
import type {
  EsitoMovimentiRentri,
  MessaggioRentri,
} from '../../../infrastructure/rentri/rentri-registri.client'
import type { NumeroRegistrazione } from './mappa-registrazione-rentri'

export interface EsitoPerRiga {
  movimentoId: string
  stato: 'TRASMESSA' | 'RIFIUTATA'
  /** Identificativo assegnato da RENTRI, se confermato e noto. */
  identificativo: string | null
  /** Messaggi di validazione della riga: quelli con il suo indice piu' quelli generali. */
  messaggi: MessaggioRentri[]
  /** Spiegazione per le righe `RIFIUTATA` (italiano); null se `TRASMESSA`. */
  motivo: string | null
}

const MOTIVO_INSIEME = 'Rifiutata da RENTRI insieme alle altre annotazioni dello stesso invio'
const MOTIVO_NON_CONFERMATA = "RENTRI non ha confermato l'annotazione"
const MOTIVO_DUPLICATO = 'Numero di registrazione duplicato nel lotto: esito non attribuibile'
const MOTIVO_CON_MESSAGGI = 'Rifiutata da RENTRI: vedere i messaggi di validazione'

const chiave = (n: NumeroRegistrazione) => `${n.anno}/${n.progressivo}`

/** Come {@link applicaEsito}, con in piu' i numeri confermati da RENTRI che non sono nel lotto. */
export function applicaEsitoDettagliato(
  lotto: ReadonlyArray<{ movimentoId: string; numero: NumeroRegistrazione }>,
  esito: EsitoMovimentiRentri
): { righe: EsitoPerRiga[]; fuoriLotto: NumeroRegistrazione[] } {
  const conteggio = new Map<string, number>()
  for (const l of lotto) conteggio.set(chiave(l.numero), (conteggio.get(chiave(l.numero)) ?? 0) + 1)

  const confermati = new Map<string, string | null>()
  for (const r of esito.numeroRegistrazioni) {
    confermati.set(chiave(r), r.identificativo)
  }
  const fuoriLotto = esito.numeroRegistrazioni
    .filter(r => !conteggio.has(chiave(r)))
    .map(r => ({ anno: r.anno, progressivo: r.progressivo }))

  const righe = lotto.map((l, posizione): EsitoPerRiga => {
    const k = chiave(l.numero)
    const messaggi = esito.validazione.filter(m => m.indice === null || m.indice === posizione)
    const duplicato = (conteggio.get(k) ?? 0) > 1
    if (!duplicato && confermati.has(k)) {
      return {
        movimentoId: l.movimentoId,
        stato: 'TRASMESSA',
        identificativo: confermati.get(k) ?? null,
        messaggi,
        motivo: null,
      }
    }
    let motivo: string
    if (duplicato) motivo = MOTIVO_DUPLICATO
    else if (!esito.errore) motivo = MOTIVO_NON_CONFERMATA
    else if (messaggi.length > 0) motivo = MOTIVO_CON_MESSAGGI
    else motivo = MOTIVO_INSIEME
    return {
      movimentoId: l.movimentoId,
      stato: 'RIFIUTATA',
      identificativo: null,
      messaggi,
      motivo,
    }
  })
  return { righe, fuoriLotto }
}

/** Esito per annotazione del lotto, nello stesso ordine del lotto. Vedi il commento di testa. */
export function applicaEsito(
  lotto: ReadonlyArray<{ movimentoId: string; numero: NumeroRegistrazione }>,
  esito: EsitoMovimentiRentri
): EsitoPerRiga[] {
  return applicaEsitoDettagliato(lotto, esito).righe
}
