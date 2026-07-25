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

export function registraRotteFormulari(app: FastifyInstance, archivio: Archivio): void {
  app.get(`${PREFISSO}/`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta))) return
    return archivio.elencaFormulari()
  })

  // Nome del parametro `:identificativo` (non `:numero_fir`): questa rotta
  // condivide la posizione nel path con le rotte di transazione registrate
  // da `registraRotteTransazioni` (`/status`, `/result`, `/trasmissione`).
  // find-my-way (router di Fastify) ammette un solo nome di parametro per
  // posizione nell'albero delle rotte: nomi diversi qui e in
  // `transazioni.ts` causano un errore alla registrazione. Il path esterno
  // resta invariato, cambia solo il nome interno del parametro.
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const numeroFir = richiesta.params.identificativo
      const formulario = archivio.leggiFormulario(numeroFir)
      if (!formulario) {
        return risposta.status(404).send({ titolo: 'Formulario non trovato' })
      }

      return formulario
    }
  )
}
