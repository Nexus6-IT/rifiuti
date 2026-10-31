/**
 * Produttore Repository Interface
 * Repository pattern for Produttore persistence
 */

import { Produttore } from '../entities/produttore'
import { OpzioniLetturaRuolo } from './ditta.repository'

export interface ProduttoreRepository<C = unknown> {
  /**
   * Inserisce la riga di ruolo (F2-10): con il `client` della transazione che ha gia' risolto
   * ditta e sede (D3).
   */
  crea(client: C, produttore: Produttore): Promise<void>

  /**
   * Modifica un ruolo esistente in una transazione: ragione sociale della ditta, indirizzo e
   * contatti della sede, riga di ruolo (sede predefinita compresa).
   */
  save(produttore: Produttore, client?: C): Promise<void>

  /**
   * Find a Produttore by ID
   */
  findById(id: string, opzioni?: OpzioniLetturaRuolo, client?: C): Promise<Produttore | null>

  /**
   * Find all Produttori for a tenant
   */
  findByTenantId(tenantId: string): Promise<Produttore[]>

  /**
   * Il ruolo della ditta, se c'e' (una riga per ruolo per ditta, D1). Prende il `client`
   * della transazione di creazione.
   */
  findByDittaId(client: C, dittaId: string): Promise<Produttore | null>

  /**
   * Delete a Produttore
   */
  delete(id: string): Promise<void>
}

export const PRODUTTORE_REPOSITORY = Symbol('PRODUTTORE_REPOSITORY')
