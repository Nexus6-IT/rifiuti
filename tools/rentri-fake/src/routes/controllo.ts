import { FastifyInstance } from 'fastify'
import { Archivio, EsitoMessaggio, Formulario } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'
import { OperazioneRegistro } from '../stato/registri-operatore'
import { siti } from '../stato/fixture-anagrafiche'
import { applicaNumeroRichiesto } from '../dominio/esito-creazione'

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
      /** Simula un ente difettoso: ammette un numero_fir diverso da quello richiesto. */
      esito_non_conforme?: boolean
    }
  }>('/__controllo/completa-transazione', async (richiesta, risposta) => {
    const transazione = archivio.leggiTransazione(richiesta.body.transazione_id)
    if (!transazione) {
      return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
    }

    let esito = richiesta.body.esito
    // Creazione riuscita: il numero e' quello richiesto (contratto), mai uno diverso in silenzio.
    if (
      !(richiesta.body.errore ?? false) &&
      transazione.richiestaCreazione &&
      !richiesta.body.esito_non_conforme
    ) {
      const verifica = applicaNumeroRichiesto(transazione.richiestaCreazione, esito)
      if (!verifica.conforme) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Esito non conforme al contratto',
          detail: verifica.motivo,
        })
      }
      esito = verifica.esito
    }

    archivio.completaTransazione(richiesta.body.transazione_id, {
      esito,
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

  // Simula l'utente che RIFIUTA la firma sul dispositivo: rende raggiungibile
  // lo stato RIFIUTATA, che senza questo canale resterebbe irraggiungibile e
  // lascerebbe il ramo corrispondente di `authorize-check` come codice morto.
  app.post<{ Params: { handle: string } }>(
    '/__controllo/ca-rentri/rifiuta/:handle',
    async (richiesta, risposta) => {
      const rifiutata = archivio.rifiutaSessioneFirma(richiesta.params.handle)
      if (!rifiutata) {
        return inviaProblemDetails(risposta, 404, { title: 'Autorizzazione non trovata' })
      }
      return { rifiutata: true }
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

  // Registri dell'operatore (`/operatore/registri`, pezzo E1 del registro eREGI).
  //
  // Esito PERSO: l'operazione viene eseguita ma il chiamante riceve un 5xx o
  // nessuna risposta (connessione chiusa). Riproduce lo scenario che rende non
  // idempotente la POST di apertura: il registro esiste, il client non lo sa.
  // Diverso da `/__controllo/guasto`, che fallisce PRIMA di elaborare.
  app.post<{
    Body: {
      operazione: OperazioneRegistro
      tipo: '5xx' | 'timeout'
      stato?: number
      volte?: number
    }
  }>('/__controllo/registri/esito-perso', async (richiesta, risposta) => {
    const { operazione, tipo, stato, volte } = richiesta.body
    if (
      !['apri', 'modifica', 'chiudi'].includes(operazione) ||
      !['5xx', 'timeout'].includes(tipo)
    ) {
      return inviaProblemDetails(risposta, 400, { title: 'Parametri non validi' })
    }
    archivio.registriOperatore.impostaEsitoPerso(operazione, {
      tipo,
      stato: stato ?? 503,
      volte: volte ?? 1,
    })
    return { impostato: true }
  })

  // Popola un registro gia' esistente (come quelli aperti dal portale), senza
  // passare dalla POST: serve agli scenari "collega da elenco" e a quelli in cui
  // la POST e' andata persa. Non applica le regole di coerenza: e' una scorciatoia
  // dichiarata, non un campo di protocollo.
  app.post<{
    Body: {
      num_iscr_sito: string
      attivita: string[]
      descrizione?: string | null
      attivita_rec_smalt?: string[] | null
      identificativo?: string
      chiuso?: boolean
    }
  }>('/__controllo/registri/registro', async (richiesta, risposta) => {
    const corpo = richiesta.body
    if (!siti.some(s => s.numIscrSito === corpo.num_iscr_sito)) {
      return inviaProblemDetails(risposta, 404, { title: 'Sito non trovato a registro' })
    }
    const registro = archivio.registriOperatore.apri({
      numIscrSito: corpo.num_iscr_sito,
      attivita: corpo.attivita,
      attivitaRecSmalt: corpo.attivita_rec_smalt,
      descrizione: corpo.descrizione,
      identificativo: corpo.identificativo,
      chiuso: corpo.chiuso,
    })
    return { identificativo: registro.identificativo }
  })
}
