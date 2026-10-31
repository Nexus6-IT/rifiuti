/**
 * Trasportatore Repository Interface
 * Repository pattern for Trasportatore persistence
 */

import { Trasportatore } from '../entities/trasportatore'
import { OpzioniLetturaRuolo } from './ditta.repository'

export interface TrasportatoreRepository<C = unknown> {
  /**
   * Inserisce la riga di ruolo (F2-10): con il `client` della transazione che ha gia' risolto
   * ditta e sede (D3).
   */
  crea(client: C, trasportatore: Trasportatore): Promise<void>

  /**
   * Modifica un ruolo esistente in una transazione: ragione sociale della ditta, indirizzo e
   * contatti della sede, riga di ruolo (sede predefinita compresa).
   */
  save(trasportatore: Trasportatore, client?: C): Promise<void>

  /**
   * Find a Trasportatore by ID
   */
  findById(id: string, opzioni?: OpzioniLetturaRuolo, client?: C): Promise<Trasportatore | null>

  /**
   * Find all Trasportatori for a tenant
   */
  findByTenantId(tenantId: string): Promise<Trasportatore[]>

  /**
   * Il ruolo della ditta, se c'e' (una riga per ruolo per ditta, D1). Prende il `client`
   * della transazione di creazione.
   */
  findByDittaId(client: C, dittaId: string): Promise<Trasportatore | null>

  /**
   * Find a Trasportatore by Numero Iscrizione
   */
  findByNumeroIscrizione(numeroIscrizione: string): Promise<Trasportatore | null>

  /**
   * Delete a Trasportatore
   */
  delete(id: string): Promise<void>
}

export const TRASPORTATORE_REPOSITORY = Symbol('TRASPORTATORE_REPOSITORY')
