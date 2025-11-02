/**
 * Produttore Repository Interface
 * Repository pattern for Produttore persistence
 */

import { Produttore } from '../entities/produttore'

export interface ProduttoreRepository {
  /**
   * Save a Produttore (create or update)
   */
  save(produttore: Produttore): Promise<void>

  /**
   * Find a Produttore by ID
   */
  findById(id: string): Promise<Produttore | null>

  /**
   * Find all Produttori for a tenant
   */
  findByTenantId(tenantId: string): Promise<Produttore[]>

  /**
   * Find a Produttore by Partita IVA
   */
  findByPartitaIVA(partitaIVA: string): Promise<Produttore | null>

  /**
   * Delete a Produttore
   */
  delete(id: string): Promise<void>
}

export const PRODUTTORE_REPOSITORY = Symbol('PRODUTTORE_REPOSITORY')
