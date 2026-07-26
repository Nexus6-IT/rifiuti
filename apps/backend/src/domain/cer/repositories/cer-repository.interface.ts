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
   * Lista paginata del catalogo (con filtri opzionali).
   */
  findPaginated(
    page: number,
    limit: number,
    filters?: CERSearchFilters
  ): Promise<{ items: CERCode[]; total: number }>

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
   * True se il codice esiste per RIFERIMENTO STORICO (qualunque sia
   * `presenteInRentri`). Va usata per ogni lettura di un FIR esistente
   * (dettaglio, PDF, export MUD): un documento a valore legale non deve mai
   * risultare incoerente solo perché l'ente ha smesso di confermare il
   * codice. Comportamento invariato rispetto a prima del Task 4 R4.
   */
  exists(code: string): Promise<boolean>

  /**
   * True se il codice è UTILIZZABILE per un FIR NUOVO: deve esistere E avere
   * `presenteInRentri = true`. Va usata SOLO in creazione (v.
   * `CreateFIRUseCase`) — mai per le letture di un FIR già emesso, che devono
   * restare valide anche dopo che l'ente ha smesso di confermare il codice.
   */
  isUtilizzabilePerNuovoFormulario(code: string): Promise<boolean>

  /**
   * Upsert di un codice CONFERMATO dall'ente in un ciclo di allineamento
   * RENTRI (v. `RentriCerSyncService`): marca `fonte='rentri'`,
   * `presenteInRentri=true`, azzera `rimossoDaRentriAl` (se il codice era
   * stato marcato rimosso in un ciclo precedente e torna a comparire, la
   * marcatura si ritira). NON tocca `category`/`subcategory`: l'ente non li
   * fornisce su questa rotta, non vanno sovrascritti con un dato che non ha.
   */
  upsertFromRentri(data: {
    code: string
    description: string
    isPericoloso: boolean
  }): Promise<void>

  /**
   * Marca il codice come non più confermato dall'ente SE al momento risulta
   * ancora `presenteInRentri=true` (scrittura condizionale e idempotente: non
   * sovrascrive `rimossoDaRentriAl` se già marcato in un ciclo precedente).
   * NON cancella mai la riga. Restituisce true se la marcatura è avvenuta
   * ora (per il conteggio dei "rimossi" del ciclo corrente).
   */
  marcaRimossoDaRentriSeAttivo(code: string, rimossoAl: Date): Promise<boolean>

  /**
   * Elenco di tutti i codici attualmente in catalogo (qualunque fonte/stato):
   * usato da `RentriCerSyncService` per calcolare per differenza quali
   * codici l'ente ha smesso di restituire in un ciclo di allineamento.
   */
  listTuttiICodici(): Promise<string[]>
}
