/**
 * CER Repository Interface
 * Abstract repository per il dominio CER
 */

import { CERCode } from '../entities/cer-code.entity'

export interface CERSearchFilters {
  pericoloso?: boolean
  category?: string
  subcategory?: string
}

export interface ICERRepository {
  /**
   * Find CER code by unique code
   */
  findByCode(code: string): Promise<CERCode | null>

  /**
   * Find CER code by ID
   */
  findById(id: string): Promise<CERCode | null>

  /**
   * Search CER codes by keyword (full-text search on description)
   */
  search(keyword: string, filters?: CERSearchFilters): Promise<CERCode[]>

  /**
   * Find all CER codes in a category
   */
  findByCategory(category: string): Promise<CERCode[]>

  /**
   * Find all dangerous waste CER codes
   */
  findAllPericolosi(): Promise<CERCode[]>

  /**
   * Save single CER code
   */
  save(cer: CERCode): Promise<void>

  /**
   * Save multiple CER codes (bulk import)
   */
  saveMany(cers: CERCode[]): Promise<void>

  /**
   * Count total CER codes
   */
  count(): Promise<number>

  /**
   * Check if CER code exists
   */
  exists(code: string): Promise<boolean>
}
