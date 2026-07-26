import { FastifyInstance } from 'fastify'
import { Archivio, EsitoMessaggio, Formulario } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'

/**
 * Apparato di prova: prefisso __controllo, inesistente in RENTRI e
 * deliberatamente riconoscibile. Non richiede autenticazione perche' serve
 * ai test per pilotare guasti, popolare l'archivio e completare
 * l'elaborazione asincrona.
 */
export function registraRotteControllo(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Body: { stato: number; volte: number } }>('/__controllo/guasto', async richiesta => {
    archivio.impostaGuasto({ stato: richiesta.body.stato, volte: richiesta.body.volte })
    return { impostato: true }
  })

  app.post<{
    Body: {
      transazione_id: string
      errore?: boolean
      validazione?: EsitoMessaggio[]
      esito?: unknown
      tipo?: string
      tempo_elaborazione?: string
    }
  }>('/__controllo/completa-transazione', async (richiesta, risposta) => {
    const transazione = archivio.leggiTransazione(richiesta.body.transazione_id)
    if (!transazione) {
      return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
    }

    archivio.completaTransazione(richiesta.body.transazione_id, {
      esito: richiesta.body.esito,
      tipo: richiesta.body.tipo,
      validazione: richiesta.body.validazione ?? [],
      errore: richiesta.body.errore ?? false,
      tempo_elaborazione: richiesta.body.tempo_elaborazione,
    })
    return { completata: true }
  })

  // Punto 7 della correzione di fedeltà: senza un modo di popolare
  // l'archivio, nessuno scenario di lettura positiva è verificabile
  // (`Archivio` nasce vuoto e nessuna rotta di dominio scrive un
  // formulario).
  app.post<{ Body: Formulario }>('/__controllo/formulario', async richiesta => {
    archivio.salvaFormulario(richiesta.body)
    return { salvato: true }
  })

  app.post('/__controllo/azzera', async () => {
    archivio.azzera()
    return { azzerato: true }
  })

  // R4 Task 8: simula l'ente che smette di confermare un codice EER tra due
  // cicli di allineamento (v. `Archivio.rimuoviCodiceEer`), stesso motivo e
  // stesso pattern di `/__controllo/formulario`.
  app.post<{ Body: { code: string } }>('/__controllo/rimuovi-codice-eer', async richiesta => {
    const rimosso = archivio.rimuoviCodiceEer(richiesta.body.code)
    return { rimosso }
  })

  // R3 Task 3 — firma remota (`ca-rentri`). Simula la conferma dell'utente
  // sul PROPRIO dispositivo con l'app ufficiale RENTRI: e' l'unico modo per
  // far passare una sessione a `AUTORIZZATA`, perche' quel gesto e' per
  // definizione fuori dal nostro backend (che infatti non chiama mai
  // `PUT /credentials/authorize-confirmation`). Se la fake si autorizzasse da
  // sola, nessun test potrebbe distinguere «confermato» da «non ancora
  // confermato».
  app.post<{ Params: { handle: string } }>(
    '/__controllo/ca-rentri/autorizza/:handle',
    async (richiesta, risposta) => {
      const autorizzata = archivio.autorizzaSessioneFirma(richiesta.params.handle)
      if (!autorizzata) {
        return inviaProblemDetails(risposta, 404, { title: 'Autorizzazione non trovata' })
      }
      return { autorizzata: true }
    }
  )

  // Porta la scadenza nel passato: verifica il ramo «autorizzazione scaduta»
  // senza far attendere alla suite il tempo reale di `expires_in`.
  app.post<{ Params: { handle: string } }>(
    '/__controllo/ca-rentri/scadi/:handle',
    async (richiesta, risposta) => {
      const scaduta = archivio.scadiSessioneFirma(richiesta.params.handle)
      if (!scaduta) {
        return inviaProblemDetails(risposta, 404, { title: 'Autorizzazione non trovata' })
      }
      return { scaduta: true }
    }
  )
}
