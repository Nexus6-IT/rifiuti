import { SCHEMA_QUANTITA, DEFINIZIONI_QUANTITA } from './schema-quantita'
import {
  SCHEMA_TRASPORTO_TERRESTRE,
  DEFINIZIONI_TRASPORTO_TERRESTRE,
} from './schema-trasporto-terrestre'
import { SCHEMA_ANNOTAZIONE, DEFINIZIONI_ANNOTAZIONE } from './schema-annotazione'
import { SCHEMA_SOSTA_TECNICA, DEFINIZIONI_SOSTA_TECNICA } from './schema-sosta-tecnica'
import { SCHEMA_TRASBORDO_TOTALE, DEFINIZIONI_TRASBORDO_TOTALE } from './schema-trasbordo-totale'
import {
  SCHEMA_TRASBORDO_PARZIALE,
  DEFINIZIONI_TRASBORDO_PARZIALE,
} from './schema-trasbordo-parziale'
import { SCHEMA_DESTINATARIO, DEFINIZIONI_DESTINATARIO } from './schema-destinatario'
import { SCHEMA_DESTINATARIO_SITO, DEFINIZIONI_DESTINATARIO_SITO } from './schema-destinatario-sito'
import { creaValidatoreContratto } from './validatore-contratto'

/**
 * Validatori dei corpi delle operazioni del FIR in viaggio, tutti generati dal
 * contratto ufficiale (v. `scripts/genera-schema.js` e
 * `test/schema-viaggio-allineato-al-contratto.test.ts`): niente regole scritte
 * a mano, e' il meccanismo che ha lasciato passare per mesi un segnaposto
 * (v. `modello-dati-scrittura.test.ts`).
 *
 * Ognuno restituisce il motivo del rifiuto, oppure `null` se il corpo e'
 * accettabile.
 */
export const validaQuantita = creaValidatoreContratto(SCHEMA_QUANTITA, DEFINIZIONI_QUANTITA)

/**
 * `POST /{numero_fir}/trasporto` e' un `oneOf` terrestre/marittimo/ferroviario
 * (formulari.yaml, riga 2518). La fake modella solo il terrestre, l'unico che
 * WasteFlow invia (piano FIR in viaggio, P2): gli altri due ricevono un 400,
 * una divergenza restrittiva dichiarata in FEDELTA.md.
 */
export const validaTrasportoTerrestre = creaValidatoreContratto(
  SCHEMA_TRASPORTO_TERRESTRE,
  DEFINIZIONI_TRASPORTO_TERRESTRE
)

export const validaAnnotazione = creaValidatoreContratto(
  SCHEMA_ANNOTAZIONE,
  DEFINIZIONI_ANNOTAZIONE
)

/**
 * Oltre al contratto: la ripresa deve seguire la sospensione. Il contratto
 * descrive solo due `date-time`; l'ordine lo pretende il buon senso (e il
 * piano, P5) e un'ente che accettasse una sosta "al contrario" nasconderebbe
 * un errore del client.
 */
const validaSostaTecnicaContratto = creaValidatoreContratto(
  SCHEMA_SOSTA_TECNICA,
  DEFINIZIONI_SOSTA_TECNICA
)

export function validaSostaTecnica(corpo: unknown): string | null {
  const motivo = validaSostaTecnicaContratto(corpo)
  if (motivo) return motivo

  const { data_ora_sospensione: sospensione, data_ora_ripresa: ripresa } = corpo as {
    data_ora_sospensione: string
    data_ora_ripresa: string
  }
  const inizio = Date.parse(sospensione)
  const fine = Date.parse(ripresa)
  if (Number.isNaN(inizio) || Number.isNaN(fine)) {
    return "'data_ora_sospensione' e 'data_ora_ripresa' devono essere date-time ISO 8601."
  }
  return fine > inizio
    ? null
    : "'data_ora_ripresa' deve essere successiva a 'data_ora_sospensione'."
}

export const validaTrasbordoTotale = creaValidatoreContratto(
  SCHEMA_TRASBORDO_TOTALE,
  DEFINIZIONI_TRASBORDO_TOTALE
)

export const validaTrasbordoParziale = creaValidatoreContratto(
  SCHEMA_TRASBORDO_PARZIALE,
  DEFINIZIONI_TRASBORDO_PARZIALE
)

const validaDestinatarioCompleto = creaValidatoreContratto(
  SCHEMA_DESTINATARIO,
  DEFINIZIONI_DESTINATARIO
)
const validaDestinatarioSito = creaValidatoreContratto(
  SCHEMA_DESTINATARIO_SITO,
  DEFINIZIONI_DESTINATARIO_SITO
)

/**
 * `POST /{numero_fir}/destinatario` e' un `oneOf` fra il destinatario descritto
 * per intero (`DatiDestinatarioFormularioModel`) e quello indicato col solo
 * numero di iscrizione del sito (`...SitoModel`, riga 1393). Un corpo e'
 * valido se rispetta almeno una delle due forme; altrimenti si riportano i
 * motivi di entrambe, che sono quelli che aiutano a correggere.
 */
export function validaDestinatario(corpo: unknown): string | null {
  const completo = validaDestinatarioCompleto(corpo)
  if (completo === null) return null
  const sito = validaDestinatarioSito(corpo)
  if (sito === null) return null
  return `Il corpo non rispetta nessuna delle due forme ammesse. Come destinatario completo: ${completo} Come sito iscritto: ${sito}`
}
