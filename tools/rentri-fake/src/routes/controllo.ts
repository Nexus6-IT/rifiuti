import { FastifyInstance } from 'fastify'
import { Archivio } from '../stato/archivio'

/**
 * Apparato di prova: prefisso __controllo, inesistente in RENTRI e
 * deliberatamente riconoscibile. Non richiede autenticazione perche' serve
 * ai test per pilotare guasti e completamenti asincroni.
 */
export function registraRotteControllo(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Body: { stato: number; volte: number } }>(
    '/__controllo/guasto',
    async (richiesta) => {
      archivio.impostaGuasto({ stato: richiesta.body.stato, volte: richiesta.body.volte })
      return { impostato: true }
    }
  )

  app.post<{ Body: { transazione_id: string; risultato: unknown } }>(
    '/__controllo/completa-transazione',
    async (richiesta, risposta) => {
      const transazione = archivio.leggiTransazione(richiesta.body.transazione_id)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      archivio.completaTransazione(richiesta.body.transazione_id, richiesta.body.risultato)
      return { completata: true }
    }
  )

  app.post('/__controllo/azzera', async () => {
    archivio.azzera()
    return { azzerato: true }
  })
}
