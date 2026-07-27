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
   * Find multiple FIRs by ID, filtrando per tenant (isolamento multi-tenant).
   * Usato dal sync batch verso RENTRI per validare in un colpo solo che tutti
   * gli ID richiesti esistano e appartengano al tenant chiamante.
   */
  findByIds(ids: string[], tenantId: string): Promise<FIR[]>

  /**
   * Trova il FIR del tenant già agganciato a questo numero_fir RENTRI, se
   * esiste (R2 Task 4, `CercaFormulariRENTRIUseCase`/`AcquisisciFormularioRENTRIUseCase`):
   * verifica LOCALE, ridondante col vincolo unico a DB (`@@unique([tenantId,
   * rentriNumeroFir])`, R2 Task 3), ma necessaria per dare all'utente un
   * errore di dominio leggibile ("già agganciato") invece di scoprirlo da un
   * 500/P2002 dopo aver già chiamato RENTRI.
   */
  findByRentriNumeroFir(tenantId: string, numeroFir: string): Promise<FIR | null>

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
