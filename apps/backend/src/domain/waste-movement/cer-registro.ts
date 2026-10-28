/**
 * Codice CER nel registro: unico punto in cui sta la regola "il CER si confronta
 * sulle sole cifre". Con o senza spazi, punti e asterisco è lo stesso rifiuto
 * (le righe storiche sono state scritte anche senza la forma "NN NN NN").
 * Registro, giacenze, anomalie e MUD lo importano, nessuno la ridefinisce.
 */

/** Le sole cifre del codice (stringa vuota se non ce ne sono). Va bene anche come parametro SQL. */
export function cerSoloCifre(cer: string): string {
  return (cer ?? '').replace(/[^0-9]/g, '')
}

/**
 * Forma canonica "NN NN NN" (con "*" finale se il codice lo porta) per ogni
 * formato di 6 cifre; fuori formato restituisce il testo ripulito dagli spazi
 * esterni, quindi un input non vuoto non diventa mai una stringa vuota.
 */
export function cerCanonico(cer: string): string {
  const testo = (cer ?? '').trim()
  const cifre = cerSoloCifre(testo)
  if (cifre.length !== 6) return testo
  const spaziato = `${cifre.slice(0, 2)} ${cifre.slice(2, 4)} ${cifre.slice(4)}`
  return testo.includes('*') ? `${spaziato}*` : spaziato
}

/**
 * Chiave per raggruppare in memoria: le cifre o, per un codice che non ne ha,
 * la forma canonica. Così due codici senza cifre non finiscono nello stesso gruppo.
 */
export function chiaveConfrontoCer(cer: string): string {
  return cerSoloCifre(cer) || cerCanonico(cer).toUpperCase()
}
