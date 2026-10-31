import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt, RegistroReplayMemoria } from '../auth/jwt-verifier'
import { inviaProblemDetails } from '../errori/problem-details'
import {
  identificativoRegistroValido,
  PATTERN_IDENTIFICATIVO_REGISTRO,
} from '../dominio/identificativo-registro'
import { validaElencoMovimenti, validaRichiestaValidaRegistro } from '../dominio/movimento'
import { Registri, MovimentoRegistrato, EsitoMessaggio } from '../stato/registri'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/dati-registri/v1.0'

/**
 * Registro anti-replay dei `jti` DEDICATO a questo servizio (`dati-registri`),
 * non condiviso con `Archivio.registroReplay` (usato da `formulari`/
 * `codifiche`/`anagrafiche`): nel RENTRI reale ogni servizio ha un proprio
 * server (`servers[0].url` di ciascun contratto e' un host diverso), quindi
 * anti-replay per-servizio e' la scelta piu' fedele, non una scorciatoia. E'
 * anche l'unico modo di rispettare il vincolo "in `app.ts` solo una riga di
 * import e una di registrazione": niente `Archivio` da passare qui.
 */
const registroReplay = new RegistroReplayMemoria()

async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply
): Promise<{ ok: true } | { ok: false }> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay,
  })

  if (!esito.valido) {
    // Come `formulari.ts`/`trasmissioni-dati.ts`: il contratto documenta 403
    // "Operazione non consentita" su ogni operazione, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return { ok: false }
  }
  return { ok: true }
}

function erroreIdentificativoRegistro(identificativoRegistro: string): {
  title: string
  detail: string
} {
  return {
    title: 'Identificativo registro non valido',
    detail: `'${identificativoRegistro}' non rispetta il pattern ${PATTERN_IDENTIFICATIVO_REGISTRO}.`,
  }
}

/** `IdentificativoMovimentoCompletoModel`/`DatiRiferimentiCompletoModel` semplificati, per la risposta. */
function aDatiMovimentoModel(
  identificativoRegistro: string,
  m: MovimentoRegistrato,
  registri: Registri,
  conVariazioni: boolean
): Record<string, unknown> {
  const corpo = m.corpo
  const riferimentiOriginali = (corpo.riferimenti ?? {}) as Record<string, unknown>

  const base: Record<string, unknown> = {
    riferimenti: {
      numero_registrazione: {
        anno: m.anno,
        progressivo: m.progressivo,
        identificativo: m.identificativo,
      },
      data_ora_registrazione: m.dataOraRegistrazione,
      causale_operazione: riferimentiOriginali.causale_operazione ?? null,
      causale_operazione_cs: riferimentiOriginali.causale_operazione_cs ?? null,
      numero_registrazione_di_rettifica: m.numeroRegistrazioneDiRettifica ?? null,
      numero_registrazione_rettifica: m.numeroRegistrazioneRettifica ?? null,
      identificativo_registro: identificativoRegistro,
      data_creazione: m.dataCreazione,
      data_trasmissione: m.dataTrasmissione,
    },
    rifiuto: corpo.rifiuto ?? null,
    materiali: corpo.materiali ?? null,
    integrazione_fir: corpo.integrazione_fir ?? null,
    esito: corpo.esito ?? null,
    produttore: corpo.produttore ?? null,
    trasportatore: corpo.trasportatore ?? null,
    intermediario: corpo.intermediario ?? null,
    intermediari: corpo.intermediari ?? null,
    destinatario: corpo.destinatario ?? null,
    annotazioni: corpo.annotazioni ?? null,
    annullato: m.annullato,
    rettificato: m.rettificato,
    trasmesso_da_soggetto_delegato: false,
  }

  if (!conVariazioni) return base

  return {
    ...base,
    variazioni: registri
      .variazioniDi(identificativoRegistro, m)
      .map(v => aDatiMovimentoModel(identificativoRegistro, v, registri, false)),
  }
}

interface ParamsRegistro {
  identificativo_registro: string
}

interface QueryElencoMovimenti {
  identificativi_movimento?: string | string[]
  anno?: string
  progressivo?: string
  annullato?: string
  rettificato?: string
}

/**
 * Servizio `dati-registri` (`docs/contracts/rentri/dati-registri.yaml`,
 * versione 1.0.20260909-1089): registro cronologico digitale di carico e
 * scarico, R6. Solo la variante **operatore** (`/operatore/...`), come da
 * indicazione del task — `/soggetto-delegato/...` resta fuori dall'ambito.
 *
 * Il registro NON si apre tramite alcuna API di questo contratto: ogni path
 * presuppone un `identificativo_registro` gia' esistente (apertura sul
 * portale). Il canale di controllo `POST /__controllo/dati-registri/registro`
 * simula quell'apertura, altrimenti nessun test potrebbe mai raggiungere un
 * registro "esistente" (stesso principio di `Archivio.salvaFormulario`).
 *
 * **Fuori scope dichiarato** (priorita' del task: trasmissione > lettura >
 * valida > rettifica, tutte e quattro coperte qui):
 * - `/operatore/transazioni/movimenti/{num_iscr_sito}[...]`: tracciamento
 *   delle transazioni per unita' locale, una funzionalita' di consultazione
 *   accessoria mai richiesta da alcun caso d'uso del backend.
 * - `/status` (bare, riga 2683): stato operativo generale del servizio
 *   (`StatusResponse`), non specifico ai registri.
 * - La validazione XSD/XML reale di `POST .../valida`: richiederebbe un
 *   parser dello schema ufficiale del registro cronologico, fuori
 *   dall'ambito di un oracolo che verifica la FORMA delle chiamate HTTP, non
 *   il contenuto di un file XML. L'esito (`errore`/`validazione`) resta una
 *   decisione del canale di controllo, come ogni altro ciclo NONBLOCK_PULL di
 *   questa fake.
 */
export function registraRotteDatiRegistri(app: FastifyInstance): void {
  const registri = new Registri()

  // --- Canale di controllo (v. commento di testata) -----------------------

  app.post<{ Body: { identificativo_registro: string } }>(
    '/__controllo/dati-registri/registro',
    async richiesta => {
      registri.registraRegistro(richiesta.body.identificativo_registro)
      return { registrato: true }
    }
  )

  app.post<{
    Body: {
      transazione_id: string
      errore?: boolean
      validazione?: EsitoMessaggio[]
      esito?: unknown
      tipo?: string
      tempo_elaborazione?: string
    }
  }>('/__controllo/dati-registri/completa-transazione', async (richiesta, risposta) => {
    const transazione = registri.leggiTransazione(richiesta.body.transazione_id)
    if (!transazione) {
      return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
    }

    registri.completaTransazione(richiesta.body.transazione_id, {
      errore: richiesta.body.errore ?? false,
      validazione: richiesta.body.validazione ?? [],
      tipo: richiesta.body.tipo,
      tempo_elaborazione: richiesta.body.tempo_elaborazione,
      esito: richiesta.body.esito,
    })
    return { completata: true }
  })

  // Per i test end-to-end: l'id dell'ultima transazione `Movimenti` inviata a un registro,
  // senza dover firmare un JWT per la rotta pubblica `last-transazione-id`.
  app.get<{ Params: { identificativo: string } }>(
    '/__controllo/dati-registri/ultima-transazione/:identificativo',
    async (richiesta, risposta) => {
      const id = registri.ultimaTransazioneMovimentiDi(richiesta.params.identificativo)
      if (!id) return inviaProblemDetails(risposta, 404, { title: 'Nessuna transazione' })
      return { transazione_id: id }
    }
  )

  app.post('/__controllo/dati-registri/azzera', async () => {
    registri.azzera()
    return { azzerato: true }
  })

  // --- Ciclo NONBLOCK_PULL generico (righe 15-226) -------------------------

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const transazione = registri.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(200).send()
      }
      return risposta.status(303).header('Location', `${PREFISSO}/${transazione.id}/result`).send()
    }
  )

  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const transazione = registri.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Richiesta non ancora elaborata',
          detail: "Interrogare /status finche' non risponde 303.",
        })
      }
      return { transazione_id: transazione.id, ...transazione.esito }
    }
  )

  // `GET /{identificativo_registro}/last-transazione-id` (righe 15-83):
  // condivide la posizione (`${PREFISSO}/:identificativo/...`) con
  // status/result sopra, ma un segmento letterale diverso — nessuna
  // collisione di nome di parametro in find-my-way (stesso principio di
  // `formulari.ts`, dove la collisione si verifica solo a PARITA' di
  // segmento successivo).
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/last-transazione-id`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const id = registri.ultimaTransazioneMovimentiDi(richiesta.params.identificativo)
      if (!id) {
        return risposta.status(204).send()
      }
      return { transazione_id: id }
    }
  )

  // --- Trasmissione registrazioni (righe 227-597, priorita' 1) -------------

  app.post<{ Params: ParamsRegistro; Body: unknown }>(
    `${PREFISSO}/operatore/:identificativo_registro/movimenti`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!identificativoRegistroValido(identificativoRegistro)) {
        return inviaProblemDetails(
          risposta,
          400,
          erroreIdentificativoRegistro(identificativoRegistro)
        )
      }
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const motivo = validaElencoMovimenti(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const id = registri.creaTransazioneMovimenti(
        identificativoRegistro,
        richiesta.body as Record<string, unknown>[]
      )
      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )

  // --- Lettura (righe 227-1025, priorita' 2) -------------------------------

  app.get<{ Params: ParamsRegistro; Querystring: QueryElencoMovimenti }>(
    `${PREFISSO}/operatore/:identificativo_registro/movimenti`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!identificativoRegistroValido(identificativoRegistro)) {
        return []
      }
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const q = richiesta.query
      const identificativiMovimento = q.identificativi_movimento
        ? Array.isArray(q.identificativi_movimento)
          ? q.identificativi_movimento
          : [q.identificativi_movimento]
        : undefined

      const elenco = registri.elenca(identificativoRegistro, {
        identificativiMovimento,
        anno: q.anno !== undefined ? Number(q.anno) : undefined,
        progressivo: q.progressivo !== undefined ? Number(q.progressivo) : undefined,
        annullato: q.annullato !== undefined ? q.annullato === 'true' : undefined,
        rettificato: q.rettificato !== undefined ? q.rettificato === 'true' : undefined,
      })
      const pagingPage = Number(richiesta.headers['paging-page'] ?? 1)
      const pagingPageSize = Number(richiesta.headers['paging-pagesize'] ?? 100)
      const totale = elenco.length

      risposta.header('Paging-Page', pagingPage)
      risposta.header('Paging-PageSize', pagingPageSize)
      risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / pagingPageSize)))
      risposta.header('Paging-TotalRecordCount', totale)

      return elenco.map(m => aDatiMovimentoModel(identificativoRegistro, m, registri, false))
    }
  )

  app.get<{ Params: ParamsRegistro; Querystring: QueryElencoMovimenti }>(
    `${PREFISSO}/operatore/:identificativo_registro/movimenti/count`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!identificativoRegistroValido(identificativoRegistro)) {
        return 0
      }
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const q = richiesta.query
      const identificativiMovimento = q.identificativi_movimento
        ? Array.isArray(q.identificativi_movimento)
          ? q.identificativi_movimento
          : [q.identificativi_movimento]
        : undefined

      return registri.conta(identificativoRegistro, {
        identificativiMovimento,
        anno: q.anno !== undefined ? Number(q.anno) : undefined,
        progressivo: q.progressivo !== undefined ? Number(q.progressivo) : undefined,
        annullato: q.annullato !== undefined ? q.annullato === 'true' : undefined,
        rettificato: q.rettificato !== undefined ? q.rettificato === 'true' : undefined,
      })
    }
  )

  app.get<{
    Params: ParamsRegistro & { anno: string; progressivo: string }
    Querystring: { variazioni?: string }
  }>(
    `${PREFISSO}/operatore/:identificativo_registro/movimento/:anno/:progressivo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const movimento = registri.dettaglioPerAnnoProgressivo(
        identificativoRegistro,
        Number(richiesta.params.anno),
        Number(richiesta.params.progressivo)
      )
      if (!movimento) {
        return inviaProblemDetails(risposta, 404, { title: 'Registrazione non trovata' })
      }
      const conVariazioni = richiesta.query.variazioni !== 'false'
      return aDatiMovimentoModel(identificativoRegistro, movimento, registri, conVariazioni)
    }
  )

  app.get<{
    Params: ParamsRegistro & { identificativo_movimento: string }
    Querystring: { variazioni?: string }
  }>(
    `${PREFISSO}/operatore/:identificativo_registro/movimento/:identificativo_movimento`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const movimento = registri.dettaglioPerIdentificativo(
        identificativoRegistro,
        richiesta.params.identificativo_movimento
      )
      if (!movimento) {
        return inviaProblemDetails(risposta, 404, { title: 'Registrazione non trovata' })
      }
      const conVariazioni = richiesta.query.variazioni !== 'false'
      return aDatiMovimentoModel(identificativoRegistro, movimento, registri, conVariazioni)
    }
  )

  // --- Verifica registro locale (righe 1026-1151, priorita' 3) -------------

  app.post<{ Params: ParamsRegistro; Body: unknown }>(
    `${PREFISSO}/operatore/:identificativo_registro/valida`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const { identificativo_registro: identificativoRegistro } = richiesta.params
      if (!identificativoRegistroValido(identificativoRegistro)) {
        return inviaProblemDetails(
          risposta,
          400,
          erroreIdentificativoRegistro(identificativoRegistro)
        )
      }
      if (!registri.registroConosciuto(identificativoRegistro)) {
        return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      }

      const motivo = validaRichiestaValidaRegistro(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const id = registri.creaTransazioneValidaRegistro(
        identificativoRegistro,
        richiesta.body as Record<string, unknown>
      )
      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )
}

// Le rettifiche (priorita' 4) non hanno un endpoint proprio: si effettuano
// trasmettendo un `MovimentoModel` con `riferimenti.numero_registrazione_rettifica`
// valorizzato (righe 3383-3388 del contratto) tramite lo stesso
// `POST .../movimenti` sopra — v. `Registri.applicaMovimenti`. Un
// `AnnullamentoMovimentoModel` (stesso endpoint) copre l'annullamento.
