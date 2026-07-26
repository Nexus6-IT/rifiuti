/**
 * CER Catalog Service - Domain Service
 * Business logic per gestione catalogo CER
 */

import { Injectable, Inject, BadRequestException } from '@nestjs/common'
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
    const trimmed = keyword?.trim()
    if (!trimmed) {
      throw new BadRequestException('Il parametro di ricerca "q" è obbligatorio')
    }

    // Ricerca per codice: gli spazi nel catalogo sono canonici ("15 01 06"),
    // ma l'utente può digitare "150106", "1501" o "15 01 06". Se il termine è
    // puramente numerico, lo riformattiamo nel formato a coppie separate da
    // spazi così che il "contains" del repository trovi comunque la voce.
    const digitsOnly = trimmed.replace(/\s+/g, '')
    const searchTerm = /^\d+$/.test(digitsOnly)
      ? (digitsOnly.match(/.{1,2}/g)?.join(' ') ?? digitsOnly)
      : trimmed

    return this.repository.search(searchTerm, filters)
  }

  /**
   * Get CER code by code
   */
  async getByCode(code: string): Promise<CERCode | null> {
    return this.repository.findByCode(code)
  }

  /**
   * Validate if CER code exists (riferimento STORICO, v.
   * `ICERRepository.exists`): usare per le letture di un FIR esistente, mai
   * per decidere se un codice è selezionabile in un FIR nuovo.
   */
  async validateCode(code: string): Promise<boolean> {
    return this.repository.exists(code)
  }

  /**
   * True se il codice è UTILIZZABILE per un FIR NUOVO (esiste E
   * `presenteInRentri=true`). Distinta da `validateCode`: un codice che
   * l'ente ha smesso di confermare resta storicamente valido ma non
   * selezionabile qui — v. `CreateFIRUseCase` e piano R4 Task 4.
   */
  async isUtilizzabilePerNuovoFormulario(code: string): Promise<boolean> {
    return this.repository.isUtilizzabilePerNuovoFormulario(code)
  }

  /**
   * Get all dangerous waste codes
   */
  async getAllPericolosi(): Promise<CERCode[]> {
    return this.repository.findAllPericolosi()
  }

  /**
   * Lista paginata del catalogo (con filtri opzionali categoria/pericoloso).
   */
  async list(
    page: number,
    limit: number,
    filters?: CERSearchFilters
  ): Promise<{ items: CERCode[]; total: number }> {
    const safePage = page > 0 ? page : 1
    const safeLimit = limit > 0 && limit <= 200 ? limit : 50
    return this.repository.findPaginated(safePage, safeLimit, filters)
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
  async importFromCSV(
    csvRecords: Array<{
      code: string
      description: string
      category: string
      subcategory?: string
    }>
  ): Promise<ImportCERResult> {
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
