/**
 * FIR Repository Interface
 * Abstract repository per il dominio FIR
 */

import { FIR, FIRStato } from '../aggregates/fir.aggregate'

export interface FIRSearchFilters {
  stato?: FIRStato
  produttoreId?: string
  trasportatoreId?: string
  destinatarioId?: string
  cerCode?: string
  dataFrom?: Date
  dataTo?: Date
}

export interface IFIRRepository {
  /**
   * Find FIR by ID
   */
  findById(id: string): Promise<FIR | null>

  /**
   * Find FIR by ID (public access without tenant filter)
   * Used for public signature verification
   */
  findByIdPublic(id: string): Promise<FIR | null>

  /**
   * Find FIR by numero progressivo
   */
  findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null>

  /**
   * Find FIRs by tenant (produttore, trasportatore, destinatario)
   */
  findByTenant(tenantId: string, filters?: FIRSearchFilters): Promise<FIR[]>

  /**
   * Find FIRs by stato
   */
  findByStato(stato: FIRStato, tenantId?: string): Promise<FIR[]>

  /**
   * Save FIR (create or update)
   */
  save(fir: FIR): Promise<void>

  /**
   * Delete FIR (soft delete)
   */
  delete(id: string): Promise<void>

  /**
   * Check if numero progressivo exists
   */
  existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean>

  /**
   * Generate next numero progressivo for tenant
   */
  generateNumeroProgressivo(tenantId: string, anno: number): Promise<string>

  /**
   * Count FIRs by filters
   */
  count(filters?: FIRSearchFilters): Promise<number>
}
