import { FastifyInstance, FastifyReply } from 'fastify'
import { Archivio } from '../stato/archivio'
import { RegistroOperatore, OperazioneRegistro } from '../stato/registri-operatore'
import { SitoFixture, OperatoreFixture, siti } from '../stato/fixture-anagrafiche'
import { inviaProblemDetails } from '../errori/problem-details'
import { autentica } from './anagrafiche'
import {
  validaCreaRegistro,
  validaModificaRegistro,
  verificaCoerenzaAttivita,
} from '../dominio/registro-operatore'
import { costruisciEregi } from '../dominio/vidimazione-registro-xml'

const PREFISSO = '/anagrafiche/v1.0'
const CCIAA_NOME = 'CCIAA di prova'

/** `RegistroModel` (anagrafiche.yaml, componenti): nessun campo e' `required`, la fake li popola tutti quelli che conosce. */
function registroAModello(r: RegistroOperatore, sito: SitoFixture, operatore: OperatoreFixture) {
  return {
    identificativo: r.identificativo,
    descrizione: r.descrizione,
    data_creazione: r.dataCreazione,
    data_chiusura: r.dataChiusura,
    data_modifica: r.dataModifica,
    num_iscr_associazioni: sito.delegatoDaNumIscrAss,
    identificativo_associazioni: [],
    num_iscr_sito: r.numIscrSito,
    identificativo_operatore_sito: operatore.identificativo,
    operatore_sito: operatore.denominazione,
    ipa_operatore_sito: null,
    cu_aoo_sito: null,
    cuu_sito: null,
    attivita: r.attivita,
    attivita_rec_smalt: r.attivitaRecSmalt,
    stato: r.dataChiusura ? 'Chiuso' : 'Attivo',
    uso_locale: false,
  }
}

function contestoRegistro(archivio: Archivio, r: RegistroOperatore) {
  const sito = siti.find(s => s.numIscrSito === r.numIscrSito) as SitoFixture
  const operatore = archivio.operatorePerNumIscr(sito.numIscrOperatore) as OperatoreFixture
  return { sito, operatore }
}

/**
 * Se il canale di controllo ha predisposto un esito perso per `operazione`, a
 * operazione GIA' ESEGUITA il chiamante riceve un 5xx oppure nessuna risposta
 * (connessione chiusa). Restituisce `true` se ha risposto lui.
 */
async function simulaEsitoPerso(
  archivio: Archivio,
  operazione: OperazioneRegistro,
  risposta: FastifyReply
): Promise<boolean> {
  const esito = archivio.registriOperatore.consumaEsitoPerso(operazione)
  if (!esito) return false

  if (esito.tipo === 'timeout') {
    risposta.hijack()
    risposta.raw.destroy()
    return true
  }
  await inviaProblemDetails(risposta, esito.stato, {
    title: 'Errore non gestito',
    detail: "Esito perso simulato dal canale di controllo (l'operazione e' stata eseguita).",
  })
  return true
}

function interoPositivo(valore: unknown, predefinito: number, massimo: number): number {
  const n = Number(valore)
  return Number.isInteger(n) && n >= 1 ? Math.min(n, massimo) : predefinito
}

/**
 * Registri dell'operatore (`anagrafiche.yaml`: `/operatore/{num_iscr}/siti/{num_iscr_sito}/registri`,
 * `/operatore/registri`, `/operatore/registri/{identificativo}[/xml]`).
 *
 * Il registro aperto qui NON diventa automaticamente noto al servizio
 * `dati-registri` (stato separato, v. `stato/registri.ts`): i test che
 * trasmettono movimenti lo registrano col canale
 * `/__controllo/dati-registri/registro`. Divergenza dichiarata in FEDELTA.md §9.
 */
export function registraRotteRegistriOperatore(app: FastifyInstance, archivio: Archivio): void {
  // GET /operatore/{num_iscr}/siti/{num_iscr_sito}/registri — elenco paginato.
  app.get<{
    Params: { identificativoOperatore: string; identificativoSito: string }
    Querystring: { identificativo_operatore?: string; identificativo?: string; chiuso?: string }
  }>(
    `${PREFISSO}/operatore/:identificativoOperatore/siti/:identificativoSito/registri`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const operatore = archivio.operatorePerNumIscr(richiesta.params.identificativoOperatore)
      const sito =
        operatore &&
        archivio.sitoDiOperatore(operatore.numIscr, richiesta.params.identificativoSito)
      if (!operatore || !sito) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }

      const { identificativo_operatore: cf, identificativo, chiuso } = richiesta.query
      let elenco = archivio.registriOperatore.elencaPerSito(sito.numIscrSito)
      if (cf !== undefined && cf !== operatore.identificativo) elenco = []
      if (identificativo !== undefined) elenco = elenco.filter(r => r.identificativo === identificativo)
      if (chiuso !== undefined) {
        const voluto = chiuso === 'true'
        elenco = elenco.filter(r => (r.dataChiusura !== null) === voluto)
      }

      const pagina = interoPositivo(richiesta.headers['paging-page'], 1, 2147483647)
      const dimensione = interoPositivo(richiesta.headers['paging-pagesize'], 100, 1000)
      risposta.header('Paging-Page', pagina)
      risposta.header('Paging-PageSize', dimensione)
      risposta.header('Paging-PageCount', Math.max(1, Math.ceil(elenco.length / dimensione)))
      risposta.header('Paging-TotalRecordCount', elenco.length)

      return elenco
        .slice((pagina - 1) * dimensione, pagina * dimensione)
        .map(r => registroAModello(r, sito, operatore))
    }
  )

  // POST /operatore/registri — apertura. NON idempotente: ogni POST valida crea un registro.
  app.post<{ Body: Record<string, unknown> }>(`${PREFISSO}/operatore/registri`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    const motivo = validaCreaRegistro(richiesta.body)
    if (motivo) {
      return inviaProblemDetails(risposta, 400, { title: 'Modello dati non valido', detail: motivo })
    }

    const corpo = richiesta.body as {
      num_iscr_sito: string
      attivita: string[]
      descrizione?: string | null
      attivita_rec_smalt?: string[] | null
    }
    const sito = siti.find(s => s.numIscrSito === corpo.num_iscr_sito)
    if (!sito) {
      return inviaProblemDetails(risposta, 404, { title: 'Sito non trovato a registro' })
    }

    const incoerenza = verificaCoerenzaAttivita(sito, corpo.attivita, corpo.attivita_rec_smalt, {
      controllaAttivitaSito: true,
      forza: false,
    })
    if (incoerenza) {
      return inviaProblemDetails(risposta, 400, { title: 'Modello dati non valido', detail: incoerenza })
    }

    const registro = archivio.registriOperatore.apri({
      numIscrSito: sito.numIscrSito,
      attivita: corpo.attivita,
      attivitaRecSmalt: corpo.attivita_rec_smalt,
      descrizione: corpo.descrizione,
    })

    if (await simulaEsitoPerso(archivio, 'apri', risposta)) return
    return risposta.status(201).send({ identificativo: registro.identificativo })
  })

  // GET /operatore/registri/{identificativo} — dettaglio.
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/operatore/registri/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return
      const registro = archivio.registriOperatore.trova(richiesta.params.identificativo)
      if (!registro) return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      const { sito, operatore } = contestoRegistro(archivio, registro)
      return registroAModello(registro, sito, operatore)
    }
  )

  // PUT /operatore/registri/{identificativo} — modifica.
  app.put<{ Params: { identificativo: string }; Body: Record<string, unknown> }>(
    `${PREFISSO}/operatore/registri/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const registro = archivio.registriOperatore.trova(richiesta.params.identificativo)
      if (!registro) return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })

      const motivo = validaModificaRegistro(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }
      // Divergenza restrittiva dichiarata: il contratto non dice cosa succede su un registro chiuso.
      if (registro.dataChiusura) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Registro chiuso',
          detail: 'Un registro chiuso non e modificabile.',
        })
      }

      const corpo = richiesta.body as {
        descrizione?: string | null
        attivita_rec_smalt?: string[] | null
        forza_salvataggio_attivita_rec_smalt?: boolean | null
      }
      const { sito } = contestoRegistro(archivio, registro)
      if (corpo.attivita_rec_smalt !== undefined && corpo.attivita_rec_smalt !== null) {
        const incoerenza = verificaCoerenzaAttivita(sito, registro.attivita, corpo.attivita_rec_smalt, {
          controllaAttivitaSito: false,
          forza: corpo.forza_salvataggio_attivita_rec_smalt === true,
        })
        if (incoerenza) {
          return inviaProblemDetails(risposta, 400, {
            title: 'Modello dati non valido',
            detail: incoerenza,
          })
        }
      }

      archivio.registriOperatore.modifica(registro, {
        descrizione: corpo.descrizione,
        attivitaRecSmalt: corpo.attivita_rec_smalt,
      })

      if (await simulaEsitoPerso(archivio, 'modifica', risposta)) return
      return { identificativo: registro.identificativo }
    }
  )

  // DELETE /operatore/registri/{identificativo} — chiusura, irreversibile.
  app.delete<{ Params: { identificativo: string } }>(
    `${PREFISSO}/operatore/registri/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const registro = archivio.registriOperatore.trova(richiesta.params.identificativo)
      if (!registro) return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })
      // Divergenza restrittiva dichiarata: chiudere un registro gia' chiuso e' un 400.
      if (registro.dataChiusura) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Registro gia chiuso',
          detail: 'Il registro e gia stato chiuso: l operazione e irreversibile.',
        })
      }

      archivio.registriOperatore.chiudi(registro)

      if (await simulaEsitoPerso(archivio, 'chiudi', risposta)) return
      return risposta.status(200).send()
    }
  )

  // GET /operatore/registri/{identificativo}/xml — vidimazione virtuale (eREGI), base64.
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/operatore/registri/:identificativo/xml`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const registro = archivio.registriOperatore.trova(richiesta.params.identificativo)
      if (!registro) return inviaProblemDetails(risposta, 404, { title: 'Registro non trovato' })

      const { sito, operatore } = contestoRegistro(archivio, registro)
      const xml = costruisciEregi(
        {
          identificativo: registro.identificativo,
          operatore: {
            numIscr: operatore.numIscr,
            codiceFiscale: operatore.identificativo,
            denominazione: operatore.denominazione,
          },
          numIscrSito: sito.numIscrSito,
          indirizzoSito: `${sito.indirizzo} ${sito.civico}`,
          dataRichiesta: registro.dataCreazione,
          identificativoRichiesta: registro.identificativoRichiesta,
          autoreRichiesta: 'operatore-test',
          cciaaNome: CCIAA_NOME,
        },
        {
          firma: signedInfo => archivio.firmaTesto(signedInfo),
          certificatoBase64Der: archivio.certificatoFirmaRemota(),
        }
      )

      return {
        nome_file: `eREGI-${registro.identificativo}.xml`,
        mime: 'application/xml',
        content: Buffer.from(xml, 'utf8').toString('base64'),
      }
    }
  )
}
