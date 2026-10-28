import { cerCanonico } from '../../domain/waste-movement/cer-registro'

/**
 * Chiave dell'advisory lock che serializza tutto cio' che cambia la giacenza di un CER in un
 * registro: lo scarico (`verificaGiacenza`) e la creazione, modifica e cancellazione di una
 * giacenza iniziale. Stessa chiave = stesso lock, quindi uno scarico concorrente o vede
 * l'apertura o la aspetta.
 *
 * Accetta un CER qualunque (con o senza spazi, punti, asterisco, minuscole): la chiave e' la forma
 * canonica "NN NN NN" senza asterisco, perche' con o senza "*" e' lo stesso rifiuto.
 */
export function chiaveLockGiacenza(registroId: string, cer: string): string {
  return `giacenza|${registroId}|${cerCanonico((cer ?? '').toUpperCase()).replace(/\*$/, '')}`
}
