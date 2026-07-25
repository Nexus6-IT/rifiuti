import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { numeroFirValido } from '../dominio/numero-fir'
import { inviaProblemDetails } from '../errori/problem-details'
import { validaAsicE } from '../xfir/validatore-asice'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

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

/**
 * Decodifica il campo `xfir` (base64, `format: byte` nel contratto) e lo fa
 * validare dal validatore ASiC-E/XAdES della fake, poi apre e completa
 * subito una transazione NONBLOCK_PULL con l'esito. La fake non simula
 * un'elaborazione differita per questa operazione: l'input e' interamente
 * noto alla richiesta, quindi il completamento immediato non contraddice il
 * principio conservato altrove (FEDELTA.md §5.3) per cui la fake non
 * completa da sola le transazioni che richiedono un intervento successivo
 * (es. la firma di un FIR) — qui non ce n'e' uno.
 */
async function validaEApriTransazione(archivio: Archivio, xfirBase64: unknown) {
  const id = archivio.creaTransazione()

  let contenuto: Buffer
  try {
    contenuto = Buffer.from(String(xfirBase64), 'base64')
  } catch {
    contenuto = Buffer.alloc(0)
  }

  const risultato = await validaAsicE(contenuto)

  archivio.completaTransazione(id, {
    tipo: 'ValidazioneXfir',
    errore: !risultato.valido,
    validazione: risultato.valido
      ? []
      : [{ campo: 'xfir', tipo: 'Errore', codice_messaggio: risultato.motivo }],
  })

  return id
}

/**
 * FEDELTA.md §5.2 punto 7: il validatore xFIR esisteva solo come libreria
 * interna, mai raggiungibile via HTTP. Espone le due rotte del contratto che
 * lo interrogano:
 * - `POST /xfir/valida` (formulari.yaml righe 5981-6047): validazione
 *   dell'xFIR "dell'ente", eseguibile da qualunque soggetto accreditato.
 * - `POST /{numero_fir}/xfir` (formulari.yaml righe 2681-2743): upload di un
 *   xFIR esterno per un formulario specifico.
 * Entrambe seguono lo stesso pattern NONBLOCK_PULL gia' usato da
 * `registraRotteTransazioni`: 202, corpo `TransazioneModel`
 * (`transazione_id` uuid), header `Location` verso `/{transazione_id}/status`.
 * Il polling di stato/risultato e' quindi lo stesso gia' registrato altrove:
 * queste rotte condividono l'`Archivio` e non ne aggiungono uno nuovo.
 */
export function registraRotteXfir(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Body: { xfir?: unknown } }>(`${PREFISSO}/xfir/valida`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    // ValidaXfirModel (formulari.yaml righe 10478-10487): `xfir` e'
    // obbligatorio.
    if (typeof richiesta.body?.xfir !== 'string' || richiesta.body.xfir.length === 0) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Modello dati non valido',
        detail: "Il campo 'xfir' (contenuto del file, base64) e' obbligatorio.",
      })
    }

    const id = await validaEApriTransazione(archivio, richiesta.body.xfir)

    return risposta
      .status(202)
      .header('Location', `${PREFISSO}/${id}/status`)
      .send({ transazione_id: id })
  })

  app.post<{ Params: { identificativo: string }; Body: { num_iscr_sito?: unknown; xfir?: unknown } }>(
    `${PREFISSO}/:identificativo/xfir`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const numeroFir = richiesta.params.identificativo
      if (!numeroFirValido(numeroFir)) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Numero FIR non valido',
          detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
        })
      }

      // UploadXfirModel (formulari.yaml righe 10462-10477): `num_iscr_sito` e
      // `xfir` sono entrambi obbligatori.
      if (
        typeof richiesta.body?.num_iscr_sito !== 'string' ||
        richiesta.body.num_iscr_sito.length === 0 ||
        typeof richiesta.body?.xfir !== 'string' ||
        richiesta.body.xfir.length === 0
      ) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: "I campi 'num_iscr_sito' e 'xfir' sono entrambi obbligatori.",
        })
      }

      const id = await validaEApriTransazione(archivio, richiesta.body.xfir)

      return risposta
        .status(202)
        .header('Location', `${PREFISSO}/${id}/status`)
        .send({ transazione_id: id })
    }
  )
}
