import { formattaDataItaliana, giornoItaliano } from '../../core/time/anno-italiano'
import type {
  CatalogoCausali,
  DefinizioneCausale,
  VersoCausale,
} from '../../domain/waste-movement/catalogo-causali'
import { cerCodeExists, normalizzaCerCode, type LettoreCatalogoCer } from './cer-catalogo'
import {
  caricaCatalogoCausali,
  type LettoreCatalogoCausali,
} from './causali/catalogo-causali.repository'

export interface DatiDaValidare {
  tenantId: string
  type: string
  causale: string
  cerCode: string
  movementDate: Date
  registrationDate: Date
  /**
   * Solo per la rettifica: la causale della testa. Se la nuova causale coincide si risolve per
   * data (una causale disattivata dopo la registrazione non impedisce di correggere la quantita').
   */
  causaleAttuale?: { codice: string; versioneId: string | null }
}

/**
 * Esito: il CER normalizzato, la versione aziendale della causale (null per le causali di
 * sistema) e la descrizione per la risposta, oppure il messaggio per l'utente.
 */
export type EsitoValidazioneDati =
  | {
      cerCode: string
      causaleAziendaId: string | null
      causaleDescrizione: string
      /** Dalla definizione risolta: nessuna seconda lettura del catalogo. */
      fatturabile: boolean
      errore?: undefined
    }
  | { errore: string }

/**
 * Validazioni dei dati di un movimento comuni alla registrazione ordinaria e alla rettifica (R4):
 * causale del catalogo dell'azienda coerente col tipo e valida alla data dell'operazione, CER
 * normalizzato "NN NN NN" e presente in catalogo, date non nel futuro. Stesso ordine e stessi
 * messaggi di sempre; il catalogo delle causali si legge una volta sola (C8).
 */
export async function validaDatiMovimento(
  db: LettoreCatalogoCer & LettoreCatalogoCausali,
  d: DatiDaValidare
): Promise<EsitoValidazioneDati> {
  // Causale (prima di CER e date)
  const verso: VersoCausale = d.type === 'CARICO' ? 'CARICO' : 'SCARICO'
  const catalogo = await caricaCatalogoCausali(db, d.tenantId)
  const giornoOperazione = giornoItaliano(d.movementDate)
  let definizione: DefinizioneCausale | null
  if (d.causaleAttuale && d.causaleAttuale.codice === d.causale) {
    // Rettifica che non cambia causale: risoluzione per data, senza versioneId.
    definizione = catalogo.comportamento(verso, d.causale, giornoOperazione)
    if (!definizione) {
      const motivo = catalogo.selezionabile(verso, d.causale, giornoOperazione)
      return {
        errore: messaggioCausale(
          catalogo,
          verso,
          d.causale,
          giornoOperazione,
          motivo.ok ? 'SCONOSCIUTA' : motivo.motivo
        ),
      }
    }
  } else {
    const esito = catalogo.selezionabile(verso, d.causale, giornoOperazione)
    if (!esito.ok) {
      return {
        errore: messaggioCausale(catalogo, verso, d.causale, giornoOperazione, esito.motivo),
      }
    }
    definizione = esito.definizione
  }

  // Codice CER contro il catalogo ufficiale: normalizza al formato canonico "NN NN NN" (con "*"
  // per i pericolosi) e verifica che esista; un CER inesistente non e' registrabile.
  const cerCode = normalizzaCerCode(d.cerCode)
  if (!(await cerCodeExists(db, cerCode))) {
    return { errore: `Codice CER non valido: ${d.cerCode}` }
  }

  // Le date di operazione/registrazione non possono essere nel futuro. Il confronto e' fra giorni
  // del calendario italiano: il frontend manda date senza ora (AAAA-MM-GG), che il backend legge
  // come mezzanotte UTC, cioe' l'01:00 o le 02:00 italiane. Confrontando gli istanti, la data di
  // oggi fra le 00:00 e quell'ora risulterebbe nel futuro.
  const oggi = giornoItaliano(new Date())
  if (giornoItaliano(d.movementDate) > oggi) {
    return {
      errore:
        `La data dell'operazione non può essere nel futuro: ` +
        `${formattaDataItaliana(d.movementDate)}`,
    }
  }
  if (giornoItaliano(d.registrationDate) > oggi) {
    return {
      errore:
        `La data di registrazione non può essere nel futuro: ` +
        `${formattaDataItaliana(d.registrationDate)}`,
    }
  }
  return {
    cerCode,
    causaleAziendaId: definizione.versioneId,
    causaleDescrizione: definizione.descrizione,
    fatturabile: definizione.fatturabile,
  }
}

function messaggioCausale(
  catalogo: CatalogoCausali,
  verso: VersoCausale,
  causale: string,
  giorno: string,
  motivo: 'SCONOSCIUTA' | 'VERSO' | 'DISATTIVATA' | 'FUORI_VALIDITA'
): string {
  const dettaglio =
    motivo === 'DISATTIVATA'
      ? " (non è attiva per l'azienda)"
      : motivo === 'FUORI_VALIDITA'
        ? " (non è valida alla data dell'operazione)"
        : ''
  const valori = catalogo.opzioni(verso, giorno).map(o => o.codice)
  return `Causale non valida per ${verso}: ${causale}${dettaglio}. Valori: ${valori.join(', ')}`
}
