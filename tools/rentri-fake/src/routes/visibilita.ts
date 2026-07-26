import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { numeroFirValido } from '../dominio/numero-fir'
import { numIscrSitoValido } from '../dominio/num-iscr-sito'
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
    // Come le altre rotte del servizio: il contratto documenta 403
    // "Operazione non consentita" su ogni operazione, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

/**
 * Rotta dedicata (v. nota nel piano R2 Task 2: non toccare `formulari.ts`
 * più del necessario per la ricerca) per le due operazioni di
 * acquisizione/rilascio della visibilità in ricerca su un FIR creato da
 * terzi (formulari.yaml righe 657-703 e 2030-2075).
 *
 * Nome del parametro `:identificativo` per il primo segmento del path,
 * NON `:numero_fir`: condivide la posizione nell'albero delle rotte di
 * find-my-way con `GET /formulari/v1.0/:identificativo` (`formulari.ts`) e
 * `GET /formulari/v1.0/:identificativo/status|result` (`transazioni.ts`),
 * che usano lo stesso nome per lo stesso motivo (v. commento in
 * `transazioni.ts`). I path esterni restano identici al contratto.
 *
 * **Sincrone, non NONBLOCK_PULL**: il contratto dichiara solo `200`
 * immediato per queste due operazioni (nessun `202`/`TransazioneModel`,
 * nessuna voce "[ASYNC]" nel `summary`, a differenza di "Crea FIR"). La
 * fake risponde quindi subito, senza creare alcuna transazione.
 */
export function registraRotteVisibilita(app: FastifyInstance, archivio: Archivio): void {
  interface ParamsVisibilita {
    identificativo: string
    num_iscr_sito: string
  }

  function validaParametri(
    numeroFir: string,
    numIscrSito: string
  ): { title: string; detail: string } | null {
    if (!numeroFirValido(numeroFir)) {
      return {
        title: 'Numero FIR non valido',
        detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
      }
    }
    if (!numIscrSitoValido(numIscrSito)) {
      return {
        title: "Numero iscrizione unita' locale non valido",
        detail: `'${numIscrSito}' non rispetta il pattern num_iscr_sito del contratto.`,
      }
    }
    return null
  }

  app.post<{ Params: ParamsVisibilita }>(
    `${PREFISSO}/:identificativo/acquisizione-visibilita/:num_iscr_sito`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const numeroFir = richiesta.params.identificativo
      const numIscrSito = richiesta.params.num_iscr_sito

      const erroreValidazione = validaParametri(numeroFir, numIscrSito)
      if (erroreValidazione) {
        return inviaProblemDetails(risposta, 400, erroreValidazione)
      }

      const trovato = archivio.acquisisciVisibilita(numeroFir, numIscrSito)
      if (!trovato) {
        return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
      }

      return risposta.status(200).send()
    }
  )

  app.post<{ Params: ParamsVisibilita }>(
    `${PREFISSO}/:identificativo/rilascio-visibilita/:num_iscr_sito`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const numeroFir = richiesta.params.identificativo
      const numIscrSito = richiesta.params.num_iscr_sito

      const erroreValidazione = validaParametri(numeroFir, numIscrSito)
      if (erroreValidazione) {
        return inviaProblemDetails(risposta, 400, erroreValidazione)
      }

      const trovato = archivio.rilasciaVisibilita(numeroFir, numIscrSito)
      if (!trovato) {
        return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
      }

      return risposta.status(200).send()
    }
  )
}
