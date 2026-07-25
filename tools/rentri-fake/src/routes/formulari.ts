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

  app.get<{ Params: { numero_fir: string } }>(
    `${PREFISSO}/:numero_fir`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const formulario = archivio.leggiFormulario(richiesta.params.numero_fir)
      if (!formulario) {
        return risposta.status(404).send({ titolo: 'Formulario non trovato' })
      }

      return formulario
    }
  )
}
