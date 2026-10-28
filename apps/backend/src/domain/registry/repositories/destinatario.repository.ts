/**
 * Destinatario Repository Interface
 * Repository pattern for Destinatario persistence
 */

import { Destinatario } from '../entities/destinatario'
import { OpzioniLetturaRuolo } from './ditta.repository'

export interface DestinatarioRepository<C = unknown> {
  /**
   * Inserisce la riga di ruolo (F2-10): con il `client` della transazione che ha gia' risolto
   * ditta e sede (D3). Per ora scrive anche le colonne vecchie (doppia scrittura, Task 3b-2).
   */
  crea(client: C, destinatario: Destinatario): Promise<void>

  /**
   * Modifica un ruolo esistente in una transazione: ragione sociale della ditta, indirizzo e
   * contatti della sede, riga di ruolo (sede predefinita compresa).
   */
  save(destinatario: Destinatario): Promise<void>

  /**
   * Find a Destinatario by ID
   */
  findById(id: string, opzioni?: OpzioniLetturaRuolo): Promise<Destinatario | null>

  /**
   * Find all Destinatari for a tenant
   */
  findByTenantId(tenantId: string): Promise<Destinatario[]>

  /**
   * Il ruolo della ditta, se c'e' (una riga per ruolo per ditta, D1). Prende il `client`
   * della transazione di creazione.
   */
  findByDittaId(client: C, dittaId: string): Promise<Destinatario | null>

  /**
   * Find a Destinatario by Numero Autorizzazione
   */
  findByNumeroAutorizzazione(numeroAutorizzazione: string): Promise<Destinatario | null>

  /**
   * Delete a Destinatario
   */
  delete(id: string): Promise<void>
}

export const DESTINATARIO_REPOSITORY = Symbol('DESTINATARIO_REPOSITORY')
