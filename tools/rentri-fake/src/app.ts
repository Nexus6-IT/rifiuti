import Fastify, { FastifyInstance } from 'fastify'
import { registraRotteToken } from './routes/token'
import { registraRotteFormulari } from './routes/formulari'
import { registraRotteTransazioni } from './routes/transazioni'
import { registraRotteVisibilita } from './routes/visibilita'
import { registraRotteXfir } from './routes/xfir'
import { registraRotteControllo } from './routes/controllo'
import { registraRotteCodifiche } from './routes/codifiche'
import { registraRotteAnagrafiche } from './routes/anagrafiche'
import { Archivio } from './stato/archivio'
import { inviaProblemDetails } from './errori/problem-details'

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
  // guasto attivo renderebbe impossibile disattivarlo) e quelle all'endpoint
  // di salute (quest'ultimo è usato dall'healthcheck del container e non deve
  // riportare lo stato simulato del guasto).
  app.addHook('onRequest', async (richiesta, risposta) => {
    if (richiesta.url.startsWith('/__controllo') || richiesta.url === '/__salute') {
      return
    }

    const guasto = archivio.guastoAttivo()
    if (guasto) {
      // Punto 8 della correzione: il 429 dichiarato dal contratto porta
      // sempre l'header Retry-After (formulari.yaml righe 176-180 e
      // analoghi), pilotabile qui perché il canale di controllo consente di
      // iniettare qualunque codice di stato, incluso 429/423/403.
      if (guasto.stato === 429) {
        risposta.header('Retry-After', '5')
      }

      await inviaProblemDetails(risposta, guasto.stato, {
        title: 'Guasto simulato',
        detail: `Guasto iniettato dal canale di controllo (stato ${guasto.stato}).`,
      })
    }
  })

  registraRotteControllo(app, archivio)
  registraRotteToken(app)
  registraRotteFormulari(app, archivio)
  registraRotteTransazioni(app, archivio)
  registraRotteVisibilita(app, archivio)
  registraRotteXfir(app, archivio)
  registraRotteCodifiche(app, archivio)
  registraRotteAnagrafiche(app, archivio)

  return app
}
