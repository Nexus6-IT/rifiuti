import { DatiViaggioInput } from './commands/create-fir.command'
import { DatiPartenzaDaSalvare } from '../rentri/dati-viaggio-fir.port'

/** Testo ripulito; vuoto = `null` (svuota la colonna). */
function testo(valore: string | undefined, maiuscolo = false): string | null | undefined {
  if (valore === undefined) return undefined
  const pulito = valore.trim()
  if (pulito === '') return null
  return maiuscolo ? pulito.toUpperCase() : pulito
}

/**
 * Traduce i dati di viaggio del comando (`undefined` = non toccare, stringa vuota = svuota) nelle colonne
 * da scrivere. La targa dell'automezzo NON e' qui: vive nello snapshot del trasportatore (`carrier_vehicle_plate`).
 */
export function colonneDatiViaggio(d: DatiViaggioInput | undefined): DatiPartenzaDaSalvare {
  if (!d) return {}
  return {
    verificatoInPartenza: d.verificatoInPartenza,
    rinfusa: d.rinfusa,
    conducenteNome: testo(d.conducenteNome),
    conducenteCognome: testo(d.conducenteCognome),
    targaRimorchio: testo(d.targaRimorchio, true),
    percorso: testo(d.percorso),
  }
}

/** Targa dell'automezzo per lo snapshot del trasportatore: `undefined` = non toccare, `null` = nessuna. */
export function targaAutomezzoDa(d: DatiViaggioInput | undefined): string | null | undefined {
  return d ? testo(d.targaAutomezzo, true) : undefined
}

export function haDatiViaggio(d: DatiViaggioInput | undefined): d is DatiViaggioInput {
  if (!d) return false
  return Object.values(d).some(v => v !== undefined)
}
