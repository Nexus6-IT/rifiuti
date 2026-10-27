import { CAUSALI_CARICO, CAUSALI_SCARICO } from '../../domain/waste-movement/waste-movement.entity'
import { formattaDataItaliana, giornoItaliano } from '../../core/time/anno-italiano'
import { cerCodeExists, normalizzaCerCode } from './cer-catalogo'

export interface DatiDaValidare {
  type: string
  causale: string
  cerCode: string
  movementDate: Date
  registrationDate: Date
}

/** Esito: il CER normalizzato, oppure il messaggio per l'utente. */
export type EsitoValidazioneDati = { cerCode: string; errore?: undefined } | { errore: string }

/**
 * Validazioni dei dati di un movimento comuni alla registrazione ordinaria e alla rettifica (R4):
 * causale coerente col tipo, CER normalizzato "NN NN NN" e presente in catalogo, date non nel
 * futuro. Estratta da `RegistraMovimentoUseCase.execute` senza cambiarne ordine ne' messaggi.
 */
export async function validaDatiMovimento(
  db: Parameters<typeof cerCodeExists>[0],
  d: DatiDaValidare
): Promise<EsitoValidazioneDati> {
  // Causale (prima di qualunque lettura dal database)
  if (d.type === 'CARICO') {
    if (!CAUSALI_CARICO.includes(d.causale as (typeof CAUSALI_CARICO)[number])) {
      return {
        errore: `Causale non valida per CARICO: ${d.causale}. Valori: ${CAUSALI_CARICO.join(', ')}`,
      }
    }
  } else {
    if (!CAUSALI_SCARICO.includes(d.causale as (typeof CAUSALI_SCARICO)[number])) {
      return {
        errore: `Causale non valida per SCARICO: ${d.causale}. Valori: ${CAUSALI_SCARICO.join(', ')}`,
      }
    }
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
  return { cerCode }
}
