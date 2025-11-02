/**
 * Trasportatore Repository Interface
 * Repository pattern for Trasportatore persistence
 */

import { Trasportatore } from '../entities/trasportatore'

export interface TrasportatoreRepository {
  /**
   * Save a Trasportatore (create or update)
   */
  save(trasportatore: Trasportatore): Promise<void>

  /**
   * Find a Trasportatore by ID
   */
  findById(id: string): Promise<Trasportatore | null>

  /**
   * Find all Trasportatori for a tenant
   */
  findByTenantId(tenantId: string): Promise<Trasportatore[]>

  /**
   * Find a Trasportatore by Partita IVA
   */
  findByPartitaIVA(partitaIVA: string): Promise<Trasportatore | null>

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
