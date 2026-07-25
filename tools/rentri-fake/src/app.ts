import Fastify, { FastifyInstance } from 'fastify'
import { registraRotteToken } from './routes/token'
import { registraRotteFormulari } from './routes/formulari'
import { registraRotteTransazioni } from './routes/transazioni'
import { registraRotteControllo } from './routes/controllo'
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

  const archivio = new Archivio()
  app.decorate('archivio', archivio)

  // Aggancio globale: applica il guasto impostato dal canale di controllo a
  // tutte le richieste, tranne quelle dirette al canale stesso (altrimenti un
  // guasto attivo renderebbe impossibile disattivarlo).
  app.addHook('onRequest', async (richiesta, risposta) => {
    if (richiesta.url.startsWith('/__controllo')) {
      return
    }

    const guasto = archivio.guastoAttivo()
    if (guasto) {
      await risposta.status(guasto.stato).send({
        titolo: 'Guasto simulato',
        dettaglio: `Guasto iniettato dal canale di controllo (stato ${guasto.stato}).`,
      })
    }
  })

  registraRotteControllo(app, archivio)
  registraRotteToken(app)
  registraRotteFormulari(app, archivio)
  registraRotteTransazioni(app, archivio)

  return app
}
