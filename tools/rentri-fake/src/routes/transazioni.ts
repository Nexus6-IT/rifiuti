import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(richiesta: FastifyRequest, risposta: FastifyReply): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, { audienceAttesa: AUDIENCE })

  if (!esito.valido) {
    await risposta.status(401).send({ titolo: 'Non autorizzato', dettaglio: esito.motivo })
    return false
  }

  return true
}

/**
 * NONBLOCK_PULL: l'operazione non restituisce il risultato ma un
 * identificativo da interrogare. La fake NON completa automaticamente la
 * transazione: il completamento avviene solo tramite il canale di controllo
 * (Task 8), così i test decidono quando e come l'elaborazione termina.
 *
 * Nota sul nome del parametro: questa rotta condivide la posizione nel path
 * (`/formulari/v1.0/:xxx`) con `GET /formulari/v1.0/:numero_fir` registrata
 * da `registraRotteFormulari`. Il router di Fastify (find-my-way) richiede
 * un unico nome di parametro per ciascuna posizione nell'albero delle
 * rotte: usare qui `:numero_fir` per la POST di trasmissione e
 * `:transazione_id` per le GET di status/result avrebbe causato un errore
 * alla registrazione. Si usa quindi un unico nome di segmento,
 * `:identificativo`, per tutte le rotte a questo livello (in questo file e
 * in `formulari.ts`); ciascun gestore lo rinomina localmente secondo il
 * proprio dominio. I path esterni restano identici al contratto ufficiale.
 */
export function registraRotteTransazioni(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/trasmissione`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const id = archivio.creaTransazione()
      return risposta.status(202).send({ transazione_id: id })
    }
  )

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const transazioneId = richiesta.params.identificativo
      const transazione = archivio.leggiTransazione(transazioneId)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      return { transazione_id: transazione.id, stato: transazione.stato }
    }
  )

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const transazioneId = richiesta.params.identificativo
      const transazione = archivio.leggiTransazione(transazioneId)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(409).send({
          titolo: 'Elaborazione in corso',
          dettaglio: "Interrogare /status finche' lo stato non e' completata.",
        })
      }

      return { transazione_id: transazione.id, risultato: transazione.risultato ?? null }
    }
  )
}
