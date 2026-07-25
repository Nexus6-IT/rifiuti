import Fastify, { FastifyInstance } from 'fastify'
import { registraRotteToken } from './routes/token'
import { registraRotteFormulari } from './routes/formulari'
import { Archivio } from './stato/archivio'

// Module augmentation: dichiara la decorazione `archivio` sull'istanza
// Fastify, così `app.decorate('archivio', ...)` e un futuro `app.archivio`
// restano tipati in strict mode senza ricorrere ad `any`.
declare module 'fastify' {
  interface FastifyInstance {
    archivio: Archivio
  }
}

/**
 * Compone l'applicazione senza avviarla, così i test possono usare
 * `app.inject()` senza occupare porte.
 */
export function creaApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/__salute', async () => ({ servizio: 'rentri-fake', stato: 'ok' }))
  registraRotteToken(app)

  const archivio = new Archivio()
  app.decorate('archivio', archivio)
  registraRotteFormulari(app, archivio)

  return app
}
