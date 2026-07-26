import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { LookupItem } from '../stato/fixture-codifiche'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/codifiche/v1.0'

/**
 * V. formulari.ts: il contratto (codifiche.yaml) non documenta mai 401 sulle
 * sue rotte — anzi non documenta esplicitamente nemmeno il 403 sui singoli
 * path di lookup, ma la sicurezza globale (`security: - Bearer: []`) si
 * applica a tutto tranne `/status`. Manteniamo lo stesso comportamento delle
 * altre rotte della fake: credenziale assente o non valida => 403, mai 200.
 */
async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
  archivio: Archivio
): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay: archivio.registroReplay,
  })

  if (!esito.valido) {
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

/** Registra una rotta di lookup semplice, sola lettura, senza filtri. */
function registraLookup(
  app: FastifyInstance,
  archivio: Archivio,
  percorso: string,
  leggi: (archivio: Archivio) => LookupItem[]
): void {
  app.get(`${PREFISSO}${percorso}`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return
    return leggi(archivio)
  })
}

interface QueryCodiciEer {
  pericoloso?: string
  escludi00?: string
}

interface QueryComuniProvincia {
  comune_id?: string
  attivi?: string
}

export function registraRotteCodifiche(app: FastifyInstance, archivio: Archivio): void {
  // Tabelle "Rifiuto": nessun filtro applicato dalla fake tranne dove il
  // contratto lo dichiara esplicitamente (codici-eer).
  registraLookup(app, archivio, '/lookup/attivita', a => a.attivita())
  registraLookup(app, archivio, '/lookup/attivita-rs', a => a.attivitaRs())
  registraLookup(app, archivio, '/lookup/stati-fisici', a => a.statiFisici())
  registraLookup(app, archivio, '/lookup/caratteristiche-pericolo', a =>
    a.caratteristichePericolo()
  )
  registraLookup(app, archivio, '/lookup/adr-classi', a => a.adrClassi())
  registraLookup(app, archivio, '/lookup/categorie-raee', a => a.categorieRaee())
  registraLookup(app, archivio, '/lookup/materiali', a => a.materiali())
  registraLookup(app, archivio, '/lookup/provenienza', a => a.provenienza())
  registraLookup(app, archivio, '/lookup/unita-misura', a => a.unitaMisura())

  // Tabelle "FIR/Registro": fuori dall'uso applicativo di R4 (arriveranno
  // con R3), ma il contratto le espone e l'oracolo deve poterle rifiutare
  // o servire allo stesso modo delle altre.
  registraLookup(app, archivio, '/lookup/stati-formulario', a => a.statiFormulario())
  registraLookup(app, archivio, '/lookup/tipi-accettazione', a => a.tipiAccettazione())
  registraLookup(app, archivio, '/lookup/tipi-autorizzazione', a => a.tipiAutorizzazione())
  registraLookup(app, archivio, '/lookup/tipi-respingimento', a => a.tipiRespingimento())
  registraLookup(app, archivio, '/lookup/causali-operazione', a => a.causaliOperazione())
  registraLookup(app, archivio, '/lookup/causali-respingimento', a => a.causaliRespingimento())
  registraLookup(app, archivio, '/lookup/tipi-tratte', a => a.tipiTratte())
  registraLookup(app, archivio, '/lookup/tipi-trasporto-transfrontaliero', a =>
    a.tipiTrasportoTransfrontaliero()
  )

  registraLookup(app, archivio, '/lookup/codici-errore', a => a.codiciErrore())
  registraLookup(app, archivio, '/lookup/regioni', a => a.regioni())
  registraLookup(app, archivio, '/lookup/nazioni', a => a.nazioni())
  registraLookup(app, archivio, '/lookup/province', a => a.province())

  // codici-eer.yaml righe 245-293: `pericoloso` filtra i soli codici
  // pericolosi/non pericolosi, `escludi00` esclude le voci di capitolo
  // (nella fixture, quelle marcate `properties.capitolo=true`).
  app.get<{ Querystring: QueryCodiciEer }>(
    `${PREFISSO}/lookup/codici-eer`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      let elenco = archivio.codiciEer()
      if (richiesta.query.pericoloso !== undefined) {
        const vuolePericolosi = richiesta.query.pericoloso === 'true'
        elenco = elenco.filter(c => (c.properties?.pericoloso ?? false) === vuolePericolosi)
      }
      if (richiesta.query.escludi00 === 'true') {
        elenco = elenco.filter(c => !(c.properties?.capitolo ?? false))
      }
      return elenco
    }
  )

  // /lookup/comuni: nessun filtro provincia (quello è il path successivo),
  // restituisce l'intero catalogo — inclusi i comuni non più attivi, non
  // essendo un parametro dichiarato su questa rotta.
  app.get(`${PREFISSO}/lookup/comuni`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return
    return archivio.comuni()
  })

  // /lookup/comuni/{provincia_id}: qui il contratto dichiara `attivi`
  // (default true) — un comune soppresso non compare a meno che il
  // chiamante chieda esplicitamente `attivi=false`.
  app.get<{ Params: { provincia_id: string }; Querystring: QueryComuniProvincia }>(
    `${PREFISSO}/lookup/comuni/:provincia_id`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const soloAttivi = richiesta.query.attivi !== 'false'
      return archivio.comuni({
        provinciaId: richiesta.params.provincia_id,
        comuneId: richiesta.query.comune_id,
        soloAttivi,
      })
    }
  )

  // /status: il contratto non documenta 403 su questo path — a differenza
  // di formulari.yaml, qui non c'è alcuna dichiarazione di sicurezza per
  // /status che lo escluda dallo schema globale, ma nemmeno un 403 elencato
  // tra le risposte: la fake lo serve senza richiedere autenticazione,
  // simmetrico a quanto già fatto per /formulari/v1.0/status.
  app.get(`${PREFISSO}/status`, async () => {
    return { status: 'Ok', warnings: [], planned_notices: [] }
  })
}
