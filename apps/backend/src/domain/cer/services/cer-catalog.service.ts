/**
 * CER Catalog Service - Domain Service
 * Business logic per gestione catalogo CER
 */

import { Injectable, Inject } from '@nestjs/common'
import { CERCode } from '../entities/cer-code.entity'
import { ICERRepository, CERSearchFilters } from '../repositories/cer-repository.interface'

export interface ImportCERResult {
  imported: number
  skipped: number
  errors: string[]
}

@Injectable()
export class CERCatalogService {
  constructor(@Inject('ICERRepository') private readonly repository: ICERRepository) {}

  /**
   * Search CER codes by keyword
   */
  async search(keyword: string, filters?: CERSearchFilters): Promise<CERCode[]> {
    if (!keyword || keyword.trim().length === 0) {
      throw new Error('Search keyword cannot be empty')
    }

    return this.repository.search(keyword.trim(), filters)
  }

  /**
   * Get CER code by code
   */
  async getByCode(code: string): Promise<CERCode | null> {
    return this.repository.findByCode(code)
  }

  /**
   * Validate if CER code exists
   */
  async validateCode(code: string): Promise<boolean> {
    return this.repository.exists(code)
  }

  /**
   * Get all dangerous waste codes
   */
  async getAllPericolosi(): Promise<CERCode[]> {
    return this.repository.findAllPericolosi()
  }

  /**
   * Get CER codes by category
   */
  async getByCategory(category: string): Promise<CERCode[]> {
    if (!/^\d{2}$/.test(category)) {
      throw new Error(`Invalid category format: ${category}. Expected format: "XX"`)
    }

    return this.repository.findByCategory(category)
  }

  /**
   * Import CER codes from CSV data
   */
  async importFromCSV(csvRecords: Array<{
    code: string
    description: string
    category: string
    subcategory?: string
  }>): Promise<ImportCERResult> {
    const result: ImportCERResult = {
      imported: 0,
      skipped: 0,
      errors: [],
    }

    const cersToImport: CERCode[] = []

    for (const record of csvRecords) {
      try {
        // Skip if already exists
        const exists = await this.repository.exists(record.code)
        if (exists) {
          result.skipped++
          continue
        }

        // Determine if pericoloso (codes ending with *)
        const isPericoloso = record.code.endsWith('*')

        const cer = CERCode.create({
          code: record.code,
          description: record.description,
          isPericoloso,
          category: record.category,
          subcategory: record.subcategory,
        })

        cersToImport.push(cer)
        result.imported++
      } catch (error) {
        result.errors.push(`Failed to import ${record.code}: ${error.message}`)
      }
    }

    // Bulk save
    if (cersToImport.length > 0) {
      await this.repository.saveMany(cersToImport)
    }

    return result
  }

  /**
   * Get catalog statistics
   */
  async getStatistics(): Promise<{
    total: number
    pericolosi: number
    nonPericolosi: number
  }> {
    const total = await this.repository.count()
    const pericolosi = await this.repository.findAllPericolosi()

    return {
      total,
      pericolosi: pericolosi.length,
      nonPericolosi: total - pericolosi.length,
    }
  }
}
