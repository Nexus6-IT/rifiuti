import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { ArchivioCopie, CopiaDigitale, CopiaCartacea, soggettiCopiaCartacea } from '../stato/copie'
import { numIscrSitoValido } from '../dominio/num-iscr-sito'
import { numeroFirValido } from '../dominio/numero-fir'
import { validaCopiaDigitale } from '../dominio/copia-digitale'
import { validaCopiaCartacea } from '../dominio/copia-cartacea'
import { validaCopiaCartaceaConferma } from '../dominio/copia-cartacea-conferma'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
  archivio: Archivio
): Promise<{ ok: true; soggetto: string } | { ok: false }> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay: archivio.registroReplay,
  })

  if (!esito.valido) {
    // Come le altre rotte del servizio: il contratto documenta 403
    // "Operazione non consentita" su ogni operazione di questo gruppo, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return { ok: false }
  }

  return { ok: true, soggetto: esito.soggetto }
}

function erroreNumIscrSito(numIscrSito: string): { title: string; detail: string } {
  return {
    title: "Numero iscrizione unita' locale non valido",
    detail: `'${numIscrSito}' non rispetta il pattern num_iscr_sito del contratto.`,
  }
}

function erroreNumeroFir(numeroFir: string): { title: string; detail: string } {
  return {
    title: 'Numero FIR non valido',
    detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
  }
}

// ---- Rappresentazioni di risposta ------------------------------------------

/** `CopiaDigitaleRuoloResult`/`CopiaDigitaleRuoloItemResult` (formulari.yaml righe 6766-6816). */
function ruoloDigitale(copia: CopiaDigitale): Record<string, unknown> | null {
  if (!copia.produttoreCodiceFiscale) return null
  const [primaConferma] = copia.conferme.values()
  return {
    codice_fiscale: copia.produttoreCodiceFiscale,
    denominazione: null,
    num_iscr_sito: null,
    num_iscr_sito_conferma: primaConferma?.numIscrSito ?? null,
    data_conferma: primaConferma?.dataConferma ?? null,
    via: null,
    civico: null,
    comune_id: null,
  }
}

/**
 * `CopiaDigitaleItemResult` (elenco, formulari.yaml righe 6617-6671).
 *
 * **Divergenze dichiarate**: `data_emissione` e `tipo_accettazione` sono
 * sempre `null` — nessuno dei due è ricavabile da `CopiaDigitaleModel`
 * (che porta solo `num_iscr_sito`/`note`/`xfir`) senza un parser xFIR
 * completo, fuori dall'ambito di questo modulo (v. commento di
 * `CopiaDigitale` in `stato/copie.ts`). `trasportatori`/`intermediari`
 * restano `null` per lo stesso motivo.
 */
function aItemDigitale(copia: CopiaDigitale): Record<string, unknown> {
  return {
    identificativo: copia.identificativo,
    numero_fir: copia.numeroFir,
    data_emissione: null,
    data_caricamento: copia.dataCaricamento,
    tipo_accettazione: null,
    is_confermata: copia.conferme.size > 0,
    note: copia.note,
    produttore: ruoloDigitale(copia),
    trasportatori: null,
    intermediari: null,
  }
}

/** `CopiaDigitaleResult` (dettaglio, formulari.yaml righe 6691-6757). */
function aDettaglioDigitale(copia: CopiaDigitale): Record<string, unknown> {
  return {
    identificativo: copia.identificativo,
    numero_fir: copia.numeroFir,
    data_emissione: null,
    num_iscr_sito: copia.numIscrSitoCaricamento,
    produttore: ruoloDigitale(copia),
    destinatari: null,
    trasportatori: null,
    intermediari: null,
    note: copia.note,
    data_caricamento: copia.dataCaricamento,
    codice_fiscale_caricamento: copia.codiceFiscaleCaricamento,
    denominazione_caricamento: null,
    emesso_da_identificativo: null,
    emesso_da_denominazione: null,
  }
}

/** `CopiaCartaceaRuoloResult` (formulari.yaml righe 6513-6533). */
function ruoloCartacea(
  soggetto: { codiceFiscale: string; denominazione: string; numIscrSito?: string | null },
  conferme: CopiaCartacea['conferme']
): Record<string, unknown> {
  const conferma = conferme.get(soggetto.codiceFiscale)
  return {
    codice_fiscale: soggetto.codiceFiscale,
    denominazione: soggetto.denominazione,
    num_iscr_sito: soggetto.numIscrSito ?? null,
    data_conferma: conferma?.dataConferma ?? null,
  }
}

/** `CopiaCartaceaResult` (formulari.yaml righe 6440-6512), usato sia per l'elenco che per il dettaglio (stesso schema nel contratto). */
function aCartaceaResult(copia: CopiaCartacea): Record<string, unknown> {
  return {
    identificativo: copia.identificativo,
    numero_fir: copia.numeroFir,
    data_emissione: copia.dataEmissione,
    num_iscr_sito: copia.numIscrSitoCaricamento,
    produttore: ruoloCartacea(copia.produttore, copia.conferme),
    trasportatori: copia.trasportatori.map(t => ruoloCartacea(t, copia.conferme)),
    intermediari: copia.intermediari.map(i => ruoloCartacea(i, copia.conferme)),
    note: copia.note,
    data_caricamento: copia.dataCaricamento,
    num_iscr_sito_caricamento: copia.numIscrSitoCaricamento,
    codice_fiscale_caricamento: copia.codiceFiscaleCaricamento,
    denominazione_caricamento: null,
    emesso_da_identificativo: null,
    emesso_da_denominazione: null,
  }
}

function aSoggettoCopiaCartacea(soggetto: unknown): {
  codiceFiscale: string
  denominazione: string
  numIscrSito?: string | null
} {
  const s = soggetto as Record<string, unknown>
  return {
    // `codice_fiscale` è il campo corrente; `identificativo` è deprecato in
    // favore di `codice_fiscale` (CopiaCartaceaSoggettoInfo, righe 6555-6564)
    // — la fake legge solo il campo corrente, come il resto del programma.
    codiceFiscale: String(s.codice_fiscale),
    denominazione: String(s.denominazione),
    numIscrSito: typeof s.num_iscr_sito === 'string' ? s.num_iscr_sito : null,
  }
}

interface ParamsUnoSegmento {
  identificativo: string
}
interface ParamsDueSegmenti {
  num_iscr_sito: string
  identificativo: string
}
interface ParamsConfermaDettaglio {
  soggetto: string
  identificativo: string
}

/**
 * Rotte "Copia FIR cartaceo"/"Copia FIR digitale" (formulari.yaml, gruppi
 * `/copia-cartacea/...` righe 2898-3627 e `/copia-digitale/...` righe
 * 3628-4451): restituzione della copia del formulario, obbligo distinto
 * dalla trasmissione dati (`trasmissioni-dati.ts`) — fino al 15/09/2026 la
 * copia cartacea era l'alternativa ammessa alla copia digitale, poi resta
 * solo quest'ultima.
 *
 * Entrambi i cicli di caricamento sono **ASYNC** (🔁 nel summary del
 * contratto): 202 + `TransazioneModel` + header `Location`, stesso schema
 * NONBLOCK_PULL già canonizzato da `transazioni.ts` su
 * `/formulari/v1.0/{transazione_id}/status`/`/result` — riusato qui senza
 * reimplementarlo (stesso principio di `trasmissioni-dati.ts`, endpoint
 * `.../estrai`).
 *
 * **Divergenza dichiarata sul completamento**: a differenza della creazione
 * di un FIR (`Archivio.completaTransazione`, che materializza il
 * `Formulario` SOLO al completamento), qui la copia diventa visibile
 * immediatamente al momento del `POST` — non alla `POST
 * /__controllo/completa-transazione` successiva. Il motivo è strutturale:
 * `Archivio.completaTransazione` collega l'esito a un `Formulario` tramite
 * `richiestaCreazione`/`contestoOperazione`, un meccanismo generico definito
 * in `archivio.ts` (fuori dai file che questo task può toccare) che non sa
 * nulla di `CopiaDigitale`/`CopiaCartacea`. La transazione creata da
 * `archivio.creaTransazione()` esiste comunque ed è interrogabile da
 * `/status`/`/result` — il TEST deve comunque completarla esplicitamente per
 * ottenere un `esito` da `/result` (altrimenti resta "in elaborazione") — ma
 * la copia stessa è già consultabile da subito tramite le rotte di lettura
 * di questo stesso gruppo. E' una divergenza PERMISSIVA (la copia compare
 * prima del previsto), mai una che nasconda un rifiuto dovuto dall'ente.
 *
 * I path deprecati `/copia-{cartacea,digitale}/{transazione_id}/status` e
 * `/result` (in favore dei canonici sotto `/formulari/v1.0/`) sono
 * implementati qui delegando allo stesso `Archivio.leggiTransazione` usato
 * dai canonici, per completezza del contratto (8/8 path cartacei, 10/10
 * digitali).
 */
export function registraRotteCopie(app: FastifyInstance, archivio: Archivio): void {
  const copie = new ArchivioCopie()

  // ---------------------------------------------------------------------
  // Copia FIR digitale
  // ---------------------------------------------------------------------

  // POST /copia-digitale/caricamento/{numero_fir} (formulari.yaml righe
  // 3731-3859) e GET /copia-digitale/caricamento/{num_iscr_sito} (righe
  // 3860-3993): condividono la stessa posizione nell'albero delle rotte di
  // find-my-way (un solo parametro dopo il segmento letterale
  // "caricamento") ma con significato diverso per verbo — stesso vincolo
  // (e stessa soluzione, un nome di parametro condiviso) già documentato in
  // `trasmissioni-dati.ts`/`transazioni.ts`.
  app.post<{ Params: ParamsUnoSegmento; Body: unknown }>(
    `${PREFISSO}/copia-digitale/caricamento/:identificativo`,
    async (richiesta, risposta) => {
      const esitoAuth = await autentica(richiesta, risposta, archivio)
      if (!esitoAuth.ok) return

      const numeroFir = richiesta.params.identificativo
      if (!numeroFirValido(numeroFir)) {
        return inviaProblemDetails(risposta, 400, erroreNumeroFir(numeroFir))
      }

      const motivo = validaCopiaDigitale(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const corpo = richiesta.body as { num_iscr_sito: string; note?: string | null; xfir: string }
      const formulario = archivio.leggiFormulario(numeroFir)

      // Nessun `richiestaCreazione`: a differenza di "Crea FIR", qui non
      // vogliamo che un test che completa la transazione con un esito a
      // forma libera faccia scattare la materializzazione automatica di un
      // `Formulario` in `Archivio.completaTransazione` (v. commento di
      // testata di questo modulo). L'id della transazione DIVENTA anche
      // l'identificativo della copia (v. commento di
      // `ArchivioCopie.creaCopiaDigitale`).
      const id = archivio.creaTransazione()
      copie.creaCopiaDigitale({
        identificativo: id,
        numeroFir,
        numIscrSitoCaricamento: corpo.num_iscr_sito,
        xfir: corpo.xfir,
        note: corpo.note ?? null,
        codiceFiscaleCaricamento: esitoAuth.soggetto,
        produttoreCodiceFiscale: formulario?.produttore ?? null,
      })

      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )

  app.get<{ Params: ParamsUnoSegmento; Querystring: { numero_fir?: string } }>(
    `${PREFISSO}/copia-digitale/caricamento/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const numIscrSito = richiesta.params.identificativo
      const elenco = copie.elencaCopieDigitaliCaricate(numIscrSito, {
        numeroFir: richiesta.query.numero_fir,
      })
      const totale = elenco.length
      risposta.header('Paging-Page', 1)
      risposta.header('Paging-PageSize', 100)
      risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / 100)))
      risposta.header('Paging-TotalRecordCount', totale)
      return elenco.map(aItemDigitale)
    }
  )

  // GET/DELETE /copia-digitale/caricamento/{num_iscr_sito}/{identificativo}
  // (formulari.yaml righe 3994-4103).
  app.get<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-digitale/caricamento/:num_iscr_sito/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      if (!numIscrSitoValido(numIscrSito)) {
        return inviaProblemDetails(risposta, 400, erroreNumIscrSito(numIscrSito))
      }

      const copia = copie.leggiCopiaDigitale(identificativo)
      if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      return aDettaglioDigitale(copia)
    }
  )

  app.delete<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-digitale/caricamento/:num_iscr_sito/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const esito = copie.eliminaCopiaDigitale(numIscrSito, identificativo)
      if (esito === 'non-trovata') {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      if (esito === 'ha-conferme') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Copia gia confermata',
          detail: "Non e' possibile cancellare una copia gia' presa in visione da un soggetto.",
        })
      }
      return risposta.status(204).send()
    }
  )

  // GET .../documento (formulari.yaml righe 4104-4155).
  //
  // **Divergenza dichiarata**: il ramo 204 "No Content" (documentato dal
  // contratto per un documento assente) non e' mai raggiungibile: `xfir` e'
  // un campo obbligatorio di `CopiaDigitaleModel`, quindi ogni copia
  // caricata da questa fake ne ha sempre uno.
  app.get<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-digitale/caricamento/:num_iscr_sito/:identificativo/documento`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const copia = copie.leggiCopiaDigitale(identificativo)
      if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      return { nome_file: null, mime: null, content: copia.xfir }
    }
  )

  // GET /copia-digitale/conferma/{identificativo_soggetto} (formulari.yaml
  // righe 4156-4294) e PUT /copia-digitale/conferma/{num_iscr_sito}/{identificativo}
  // (righe 4391-4451): condividono la posizione a DUE segmenti dopo
  // "conferma" solo per il PUT; il GET elenco e' a un solo segmento e non
  // collide. Il GET dettaglio (righe 4295-4341) e il PUT condividono invece
  // la STESSA posizione a due segmenti — nome di parametro comune
  // (`:soggetto`), rinominato localmente secondo l'operazione (codice
  // fiscale per il GET, num_iscr_sito per il PUT — il contratto usa
  // volutamente due identificatori diversi per le due operazioni).
  app.get<{
    Params: ParamsUnoSegmento
    Querystring: { numero_fir?: string; confermate?: string }
  }>(`${PREFISSO}/copia-digitale/conferma/:identificativo`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio)).ok) return

    const identificativoSoggetto = richiesta.params.identificativo
    const elenco = copie.elencaCopieDigitaliPerSoggetto(identificativoSoggetto, {
      numeroFir: richiesta.query.numero_fir,
      confermate:
        richiesta.query.confermate === undefined
          ? undefined
          : richiesta.query.confermate === 'true',
    })
    const totale = elenco.length
    risposta.header('Paging-Page', 1)
    risposta.header('Paging-PageSize', 100)
    risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / 100)))
    risposta.header('Paging-TotalRecordCount', totale)
    return elenco.map(aItemDigitale)
  })

  app.get<{ Params: ParamsConfermaDettaglio }>(
    `${PREFISSO}/copia-digitale/conferma/:soggetto/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const identificativoSoggetto = richiesta.params.soggetto
      const copia = copie.leggiCopiaDigitale(richiesta.params.identificativo)
      if (!copia || copia.produttoreCodiceFiscale !== identificativoSoggetto) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      return aDettaglioDigitale(copia)
    }
  )

  app.put<{
    Params: ParamsConfermaDettaglio
    Querystring: { ruolo?: string; respingi?: string }
  }>(
    `${PREFISSO}/copia-digitale/conferma/:soggetto/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const numIscrSito = richiesta.params.soggetto
      const esito = copie.confermaCopiaDigitale(richiesta.params.identificativo, numIscrSito, {
        ruolo: richiesta.query.ruolo,
        respingi: richiesta.query.respingi === 'true',
      })
      if (esito === 'non-trovata') {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      return risposta.status(204).send()
    }
  )

  app.get<{ Params: ParamsConfermaDettaglio }>(
    `${PREFISSO}/copia-digitale/conferma/:soggetto/:identificativo/documento`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const identificativoSoggetto = richiesta.params.soggetto
      const copia = copie.leggiCopiaDigitale(richiesta.params.identificativo)
      if (!copia || copia.produttoreCodiceFiscale !== identificativoSoggetto) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR digitale non trovata' })
      }
      return { nome_file: null, mime: null, content: copia.xfir }
    }
  )

  // Deprecati: /copia-digitale/{transazione_id}/status e /result
  // (formulari.yaml righe 3628-3730), in favore dei canonici
  // /formulari/v1.0/{transazione_id}/status e /result gia' registrati da
  // `transazioni.ts`. Stessa semantica, delegano allo stesso `Archivio`.
  app.get<{ Params: ParamsUnoSegmento }>(
    `${PREFISSO}/copia-digitale/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const transazione = archivio.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(200).send()
      }
      return risposta
        .status(303)
        .header('Location', `${PREFISSO}/copia-digitale/${richiesta.params.identificativo}/result`)
        .send()
    }
  )

  app.get<{ Params: ParamsUnoSegmento }>(
    `${PREFISSO}/copia-digitale/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const transazione = archivio.leggiTransazione(richiesta.params.identificativo)
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

  // ---------------------------------------------------------------------
  // Copia FIR cartaceo
  // ---------------------------------------------------------------------

  // POST/GET /copia-cartacea/caricamento/{num_iscr_sito} (formulari.yaml
  // righe 3001-3194): a differenza della digitale, QUI il POST e il GET
  // condividono lo stesso significato di parametro (num_iscr_sito del
  // trasportatore) — nessuna rinomina necessaria.
  app.post<{ Params: { num_iscr_sito: string }; Body: unknown }>(
    `${PREFISSO}/copia-cartacea/caricamento/:num_iscr_sito`,
    async (richiesta, risposta) => {
      const esitoAuth = await autentica(richiesta, risposta, archivio)
      if (!esitoAuth.ok) return

      const numIscrSito = richiesta.params.num_iscr_sito
      if (!numIscrSitoValido(numIscrSito)) {
        return inviaProblemDetails(risposta, 400, erroreNumIscrSito(numIscrSito))
      }

      const motivo = validaCopiaCartacea(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const corpo = richiesta.body as Record<string, unknown>
      // V. commento della POST digitale: l'id della transazione diventa
      // anche l'identificativo della copia.
      const id = archivio.creaTransazione()
      copie.creaCopiaCartacea({
        identificativo: id,
        numeroFir: String(corpo.numero_fir),
        numIscrSitoCaricamento: numIscrSito,
        fileContent: String(corpo.file_content),
        nomeFile: String(corpo.nome_file),
        mime: String(corpo.mime),
        dataEmissione: String(corpo.data_emissione),
        produttore: aSoggettoCopiaCartacea(corpo.produttore),
        trasportatori: Array.isArray(corpo.trasportatori)
          ? corpo.trasportatori.map(aSoggettoCopiaCartacea)
          : [],
        intermediari: Array.isArray(corpo.intermediari)
          ? corpo.intermediari.map(aSoggettoCopiaCartacea)
          : [],
        note: typeof corpo.note === 'string' ? corpo.note : null,
        codiceFiscaleCaricamento: esitoAuth.soggetto,
      })

      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )

  app.get<{
    Params: { num_iscr_sito: string }
    Querystring: { numero_fir?: string; confermate?: string }
  }>(`${PREFISSO}/copia-cartacea/caricamento/:num_iscr_sito`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio)).ok) return

    const elenco = copie.elencaCopieCartaceeCaricate(richiesta.params.num_iscr_sito, {
      numeroFir: richiesta.query.numero_fir,
      confermate:
        richiesta.query.confermate === undefined
          ? undefined
          : richiesta.query.confermate === 'true',
    })
    const totale = elenco.length
    risposta.header('Paging-Page', 1)
    risposta.header('Paging-PageSize', 100)
    risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / 100)))
    risposta.header('Paging-TotalRecordCount', totale)
    return elenco.map(aCartaceaResult)
  })

  // GET/DELETE /copia-cartacea/caricamento/{num_iscr_sito}/{identificativo}
  // (formulari.yaml righe 3195-3304).
  app.get<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-cartacea/caricamento/:num_iscr_sito/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      if (!numIscrSitoValido(numIscrSito)) {
        return inviaProblemDetails(risposta, 400, erroreNumIscrSito(numIscrSito))
      }

      const copia = copie.leggiCopiaCartacea(identificativo)
      if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      return aCartaceaResult(copia)
    }
  )

  app.delete<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-cartacea/caricamento/:num_iscr_sito/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const esito = copie.eliminaCopiaCartacea(numIscrSito, identificativo)
      if (esito === 'non-trovata') {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      if (esito === 'ha-conferme') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Copia gia confermata',
          detail: "Non e' possibile cancellare una copia gia' presa in carico da un soggetto.",
        })
      }
      return risposta.status(204).send()
    }
  )

  // GET .../documento (formulari.yaml righe 3305-3356). V. divergenza
  // dichiarata sopra per l'analoga rotta digitale: `file_content` e'
  // obbligatorio in `CopiaCartaceaModel`, il ramo 204 non e' raggiungibile.
  app.get<{ Params: ParamsDueSegmenti }>(
    `${PREFISSO}/copia-cartacea/caricamento/:num_iscr_sito/:identificativo/documento`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const copia = copie.leggiCopiaCartacea(identificativo)
      if (!copia || copia.numIscrSitoCaricamento !== numIscrSito) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      return { nome_file: copia.nomeFile, mime: copia.mime, content: copia.fileContent }
    }
  )

  // GET/PUT /copia-cartacea/conferma/{identificativo_soggetto}
  // (formulari.yaml righe 3357-3531): stessa posizione per entrambi i verbi,
  // stesso significato di parametro (codice fiscale) — nessuna rinomina.
  app.get<{
    Params: { identificativo: string }
    Querystring: { numero_fir?: string; confermate?: string }
  }>(`${PREFISSO}/copia-cartacea/conferma/:identificativo`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio)).ok) return

    const elenco = copie.elencaCopieCartaceePerSoggetto(richiesta.params.identificativo, {
      numeroFir: richiesta.query.numero_fir,
      confermate:
        richiesta.query.confermate === undefined
          ? undefined
          : richiesta.query.confermate === 'true',
    })
    const totale = elenco.length
    risposta.header('Paging-Page', 1)
    risposta.header('Paging-PageSize', 100)
    risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / 100)))
    risposta.header('Paging-TotalRecordCount', totale)
    return elenco.map(aCartaceaResult)
  })

  app.put<{ Params: { identificativo: string }; Body: unknown }>(
    `${PREFISSO}/copia-cartacea/conferma/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const motivo = validaCopiaCartaceaConferma(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const corpo = richiesta.body as {
        identificativo: string
        num_iscr_sito?: string | null
        ruolo?: string
        respingi?: boolean
      }
      const identificativoSoggetto = richiesta.params.identificativo
      const esito = copie.confermaCopiaCartacea(corpo.identificativo, identificativoSoggetto, {
        ruolo: corpo.ruolo,
        numIscrSito: corpo.num_iscr_sito,
        respingi: corpo.respingi,
      })
      if (esito === 'non-trovata' || esito === 'soggetto-non-pertinente') {
        // Confine di visibilita' (v. `trasmissioni-dati.ts`): un soggetto non
        // pertinente riceve lo stesso 404 di un identificativo inesistente,
        // mai una rivelazione che la copia esiste per un altro soggetto.
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      return risposta.status(204).send()
    }
  )

  app.get<{ Params: ParamsConfermaDettaglio }>(
    `${PREFISSO}/copia-cartacea/conferma/:soggetto/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const identificativoSoggetto = richiesta.params.soggetto
      const copia = copie.leggiCopiaCartacea(richiesta.params.identificativo)
      const appartiene =
        copia && soggettiCopiaCartacea(copia).some(s => s.codiceFiscale === identificativoSoggetto)
      if (!copia || !appartiene) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      return aCartaceaResult(copia)
    }
  )

  app.get<{ Params: ParamsConfermaDettaglio }>(
    `${PREFISSO}/copia-cartacea/conferma/:soggetto/:identificativo/documento`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const identificativoSoggetto = richiesta.params.soggetto
      const copia = copie.leggiCopiaCartacea(richiesta.params.identificativo)
      const appartiene =
        copia && soggettiCopiaCartacea(copia).some(s => s.codiceFiscale === identificativoSoggetto)
      if (!copia || !appartiene) {
        return inviaProblemDetails(risposta, 404, { title: 'Copia FIR cartaceo non trovata' })
      }
      return { nome_file: copia.nomeFile, mime: copia.mime, content: copia.fileContent }
    }
  )

  // Deprecati: /copia-cartacea/{transazione_id}/status e /result
  // (formulari.yaml righe 2898-3000). V. commento sopra per i corrispettivi
  // digitali: stessa delega ad `Archivio.leggiTransazione`.
  app.get<{ Params: ParamsUnoSegmento }>(
    `${PREFISSO}/copia-cartacea/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const transazione = archivio.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(200).send()
      }
      return risposta
        .status(303)
        .header('Location', `${PREFISSO}/copia-cartacea/${richiesta.params.identificativo}/result`)
        .send()
    }
  )

  app.get<{ Params: ParamsUnoSegmento }>(
    `${PREFISSO}/copia-cartacea/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const transazione = archivio.leggiTransazione(richiesta.params.identificativo)
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
}
