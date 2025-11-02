/**
 * Destinatario Repository Interface
 * Repository pattern for Destinatario persistence
 */

import { Destinatario } from '../entities/destinatario'

export interface DestinatarioRepository {
  /**
   * Save a Destinatario (create or update)
   */
  save(destinatario: Destinatario): Promise<void>

  /**
   * Find a Destinatario by ID
   */
  findById(id: string): Promise<Destinatario | null>

  /**
   * Find all Destinatari for a tenant
   */
  findByTenantId(tenantId: string): Promise<Destinatario[]>

  /**
   * Find a Destinatario by Partita IVA
   */
  findByPartitaIVA(partitaIVA: string): Promise<Destinatario | null>

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
