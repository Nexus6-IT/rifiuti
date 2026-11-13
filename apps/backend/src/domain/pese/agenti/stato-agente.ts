/**
 * Stato di un agente di pesa (Fase 4 pezzo 8b, D2/D3). Dominio puro.
 * Le transizioni sono fatte rispettare anche dal trigger `agenti_pesa_controlli` (B2).
 */
export type StatoAgentePesaDominio = 'IN_ATTESA' | 'ATTIVO' | 'REVOCATO'

/** Un agente è «in linea» se l'ultimo contatto è di meno di 3 minuti fa. */
export const MINUTI_AGENTE_IN_LINEA = 3

export function agenteInLinea(ultimoContatto: Date | null, adesso: Date): boolean {
  if (!ultimoContatto) return false
  return adesso.getTime() - ultimoContatto.getTime() < MINUTI_AGENTE_IN_LINEA * 60_000
}

/** IN_ATTESA→ATTIVO, IN_ATTESA→REVOCATO, ATTIVO→REVOCATO; da REVOCATO nulla cambia. */
export function transizioneAmmessa(da: StatoAgentePesaDominio, a: StatoAgentePesaDominio): boolean {
  if (da === 'IN_ATTESA') return a === 'ATTIVO' || a === 'REVOCATO'
  if (da === 'ATTIVO') return a === 'REVOCATO'
  return false
}
