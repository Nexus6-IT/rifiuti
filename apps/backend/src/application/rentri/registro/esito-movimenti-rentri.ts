/**
 * Lettura pura dell'esito di una transazione `POST .../movimenti` per annotazione (D9, Q3).
 *
 * REGOLA CHIAVE: una riga e' `TRASMESSA` SOLO se il suo (anno, progressivo) compare, una volta,
 * fra le registrazioni confermate da RENTRI (anche con `errore = true`, Q3). Nessun'altra via
 * porta a `TRASMESSA`. `RIFIUTATA` (riaccodabile) SOLO con `errore = true`, riga non confermata e
 * nessuna registrazione ignota nell'esito (Q3). Ogni altro caso di riga non confermata e'
 * `INCERTA`: `errore = false` senza conferma (esito incompleto ma valido per il contratto) o
 * registrazioni che RENTRI riporta senza (anno, progressivo): RENTRI potrebbe averla registrata.
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
import { NumeroDuplicatoNelLottoError } from './selezione-lotto-rentri'

export interface EsitoPerRiga {
  movimentoId: string
  stato: 'TRASMESSA' | 'RIFIUTATA' | 'INCERTA'
  /** Identificativo assegnato da RENTRI, se confermato e noto. */
  identificativo: string | null
  /** Messaggi di validazione della riga: quelli con il suo indice piu' quelli generali. */
  messaggi: MessaggioRentri[]
  /** Spiegazione per le righe `RIFIUTATA`/`INCERTA` (italiano); null se `TRASMESSA`. */
  motivo: string | null
}

/**
 * Base dell'`indice` dei messaggi di validazione (`EsitoMessaggioModel.indice`, "Indice
 * dell'elemento di input relativo al messaggio di validazione"): il contratto
 * (`docs/contracts/rentri/dati-registri.yaml`) NON specifica se parta da 0 o da 1. Assunta 0,
 * DA VERIFICARE sull'ambiente demo RENTRI (follow-up). Il lotto passato a `applicaEsito` deve
 * avere lo STESSO ordine del payload inviato, altrimenti gli indici puntano alla riga sbagliata.
 */
export const BASE_INDICE_RENTRI = 0

/** Cose strane nell'esito di RENTRI: non cambiano lo stato delle righe, ma vanno viste. */
export type AnomaliaEsito =
  | { tipo: 'INDICE_FUORI_INTERVALLO'; indice: number }
  | { tipo: 'IDENTIFICATIVI_DISCORDANTI'; numero: NumeroRegistrazione }

const MOTIVO_INSIEME = 'Rifiutata da RENTRI insieme alle altre annotazioni dello stesso invio'
export const MOTIVO_NON_CONFERMATA =
  "RENTRI non ha confermato l'annotazione: verificare prima di ritrasmettere"
export const MOTIVO_REGISTRAZIONI_IGNOTE =
  'RENTRI ha registrato elementi non attribuibili alle annotazioni: verificare prima di ritrasmettere'
const MOTIVO_CON_MESSAGGI = 'Rifiutata da RENTRI: vedere i messaggi di validazione'

const chiave = (n: NumeroRegistrazione) => `${n.anno}/${n.progressivo}`

/** Come {@link applicaEsito}, con in piu' i numeri confermati da RENTRI che non sono nel lotto e le anomalie.
 * @throws NumeroDuplicatoNelLottoError se il lotto ha due volte lo stesso (anno, progressivo): errore
 *   di programmazione, il chiamante tratta il lotto come incerto (mai RIFIUTATA).
 */
export function applicaEsitoDettagliato(
  lotto: ReadonlyArray<{ movimentoId: string; numero: NumeroRegistrazione }>,
  esito: EsitoMovimentiRentri
): { righe: EsitoPerRiga[]; fuoriLotto: NumeroRegistrazione[]; anomalie: AnomaliaEsito[] } {
  const visti = new Set<string>()
  for (const l of lotto) {
    const k = chiave(l.numero)
    if (visti.has(k)) throw new NumeroDuplicatoNelLottoError(l.numero)
    visti.add(k)
  }

  const anomalie: AnomaliaEsito[] = []
  // Stesso numero confermato piu' volte: due identificativi diversi non si scelgono (null + anomalia).
  const confermati = new Map<string, string | null>()
  const discordanti = new Set<string>()
  for (const r of esito.numeroRegistrazioni) {
    const k = chiave(r)
    if (!confermati.has(k)) {
      confermati.set(k, r.identificativo)
      continue
    }
    const attuale = confermati.get(k) ?? null
    if (attuale === null) confermati.set(k, r.identificativo)
    else if (r.identificativo !== null && r.identificativo !== attuale && !discordanti.has(k)) {
      discordanti.add(k)
      anomalie.push({
        tipo: 'IDENTIFICATIVI_DISCORDANTI',
        numero: { anno: r.anno, progressivo: r.progressivo },
      })
    }
  }
  const fuoriLotto = esito.numeroRegistrazioni
    .filter(r => !visti.has(chiave(r)))
    .map(r => ({ anno: r.anno, progressivo: r.progressivo }))

  const fuoriIntervallo = esito.validazione.filter(
    m =>
      m.indice !== null &&
      (m.indice < BASE_INDICE_RENTRI || m.indice >= BASE_INDICE_RENTRI + lotto.length)
  )
  for (const m of fuoriIntervallo) {
    anomalie.push({ tipo: 'INDICE_FUORI_INTERVALLO', indice: m.indice as number })
  }

  const righe = lotto.map((l, posizione): EsitoPerRiga => {
    const k = chiave(l.numero)
    const messaggi = esito.validazione.filter(
      m =>
        m.indice === null ||
        fuoriIntervallo.includes(m) ||
        m.indice === BASE_INDICE_RENTRI + posizione
    )
    if (confermati.has(k)) {
      return {
        movimentoId: l.movimentoId,
        stato: 'TRASMESSA',
        identificativo: discordanti.has(k) ? null : (confermati.get(k) ?? null),
        messaggi,
        motivo: null,
      }
    }
    if (!esito.errore || (esito.registrazioniSenzaNumero ?? 0) > 0) {
      return {
        movimentoId: l.movimentoId,
        stato: 'INCERTA',
        identificativo: null,
        messaggi,
        motivo: esito.errore ? MOTIVO_REGISTRAZIONI_IGNOTE : MOTIVO_NON_CONFERMATA,
      }
    }
    let motivo: string
    if (messaggi.length > 0) motivo = MOTIVO_CON_MESSAGGI
    else motivo = MOTIVO_INSIEME
    return {
      movimentoId: l.movimentoId,
      stato: 'RIFIUTATA',
      identificativo: null,
      messaggi,
      motivo,
    }
  })
  return { righe, fuoriLotto, anomalie }
}

/** Esito per annotazione del lotto, nello stesso ordine del lotto. Vedi il commento di testa. */
export function applicaEsito(
  lotto: ReadonlyArray<{ movimentoId: string; numero: NumeroRegistrazione }>,
  esito: EsitoMovimentiRentri
): EsitoPerRiga[] {
  return applicaEsitoDettagliato(lotto, esito).righe
}
