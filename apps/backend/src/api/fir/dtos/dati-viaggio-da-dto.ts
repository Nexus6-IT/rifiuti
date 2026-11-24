import { DatiViaggioInput } from '../../../application/fir/commands/create-fir.command'
import { DatiTrasportoFirDto } from './create-fir.dto'

/**
 * Dati di viaggio del comando a partire dal DTO di creazione o modifica (FIR in viaggio, P2).
 * `rinfusa`/`verificatoInPartenza` assenti restano `undefined` (non si toccano). Il blocco
 * `datiTrasporto`, se presente (anche vuoto), SOSTITUISCE i dati di trasporto: un campo mancante vale
 * stringa vuota, cioe' lo svuota; se assente i dati di trasporto non si toccano.
 */
export function datiViaggioDaDto(dto: {
  rifiuto: { rinfusa?: boolean; verificatoInPartenza?: boolean }
  datiTrasporto?: DatiTrasportoFirDto
}): DatiViaggioInput | undefined {
  const dati: DatiViaggioInput = {
    rinfusa: dto.rifiuto.rinfusa,
    verificatoInPartenza: dto.rifiuto.verificatoInPartenza,
  }
  if (dto.datiTrasporto !== undefined && dto.datiTrasporto !== null) {
    const t = dto.datiTrasporto
    dati.targaAutomezzo = t.targaAutomezzo ?? ''
    dati.conducenteNome = t.conducenteNome ?? ''
    dati.conducenteCognome = t.conducenteCognome ?? ''
    dati.targaRimorchio = t.targaRimorchio ?? ''
    dati.percorso = t.percorso ?? ''
  }
  return Object.values(dati).some(v => v !== undefined) ? dati : undefined
}
