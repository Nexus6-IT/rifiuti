import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
  archivio: Archivio
): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay: archivio.registroReplay,
  })

  if (!esito.valido) {
    // V. formulari.ts: il contratto documenta 403, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

/**
 * NONBLOCK_PULL secondo il contratto ufficiale:
 * - `POST /` (Crea FIR, formulari.yaml righe 187-265): 202, corpo
 *   `TransazioneModel` (transazione_id uuid), header `Location`. Sostituisce
 *   la rotta inventata `POST /{numero_fir}/trasmissione`, che non esiste in
 *   alcun path del contratto ed e' stata rimossa.
 * - `GET /{transazione_id}/status` (formulari.yaml righe 2847-2897): 200
 *   senza corpo se non ancora elaborata, 303 con header `Location` verso
 *   `/result` quando l'esito e' disponibile. Nessun campo `stato`: non
 *   esiste nello schema di risposta del contratto.
 * - `GET /{transazione_id}/result` (formulari.yaml righe 2801-2846): 400
 *   `application/problem+json` se non ancora elaborata (non 409), corpo di
 *   successo aderente a `EsitoFormularioModel` con almeno `errore` e
 *   `validazione`.
 *
 * La fake NON completa automaticamente la transazione: il completamento
 * avviene solo tramite il canale di controllo, così i test decidono quando
 * e come l'elaborazione termina.
 *
 * Nota sul nome del parametro: questa rotta condivide la posizione nel path
 * (`/formulari/v1.0/:xxx`) con `GET /formulari/v1.0/:numero_fir` registrata
 * da `registraRotteFormulari`. Il router di Fastify (find-my-way) ammette
 * un unico nome di parametro per ciascuna posizione nell'albero delle
 * rotte: usare qui `:numero_fir` per una rotta e `:transazione_id` per
 * un'altra alla stessa posizione avrebbe causato un errore alla
 * registrazione. Si usa quindi un unico nome di segmento,
 * `:identificativo`, per tutte le rotte a questo livello (in questo file e
 * in `formulari.ts`); ciascun gestore lo rinomina localmente secondo il
 * proprio dominio. I path esterni restano identici al contratto ufficiale.
 */
export function registraRotteTransazioni(app: FastifyInstance, archivio: Archivio): void {
  app.post(`${PREFISSO}/`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    const id = archivio.creaTransazione(richiesta.body as Record<string, unknown>)
    return risposta
      .status(202)
      .header('Location', `${PREFISSO}/${id}/status`)
      .send({ transazione_id: id })
  })

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const transazioneId = richiesta.params.identificativo
      const transazione = archivio.leggiTransazione(transazioneId)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }

      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(200).send()
      }

      return risposta
        .status(303)
        .header('Location', `${PREFISSO}/${transazioneId}/result`)
        .send()
    }
  )

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const transazioneId = richiesta.params.identificativo
      const transazione = archivio.leggiTransazione(transazioneId)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }

      if (transazione.stato === 'in_elaborazione') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Richiesta non ancora elaborata',
          detail: "Interrogare /status finche' non risponde 303.",
        })
      }

      return { transazione_id: transazione.id, ...transazione.esito }
    }
  )
}
