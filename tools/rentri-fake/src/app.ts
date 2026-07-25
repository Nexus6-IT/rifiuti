import Fastify, { FastifyInstance } from 'fastify'
import { registraRotteToken } from './routes/token'

/**
 * Compone l'applicazione senza avviarla, così i test possono usare
 * `app.inject()` senza occupare porte.
 */
export function creaApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/__salute', async () => ({ servizio: 'rentri-fake', stato: 'ok' }))
  registraRotteToken(app)

  return app
}
