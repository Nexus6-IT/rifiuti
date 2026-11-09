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

/**
 * Opzioni di salvataggio. `verificaVersione`: la scrittura riesce solo se la riga ha ancora la
 * versione letta dall'aggregate (altrimenti `FirModificatoNelFrattempoError`). Senza l'opzione si
 * scrive e si incrementa comunque (percorso RENTRI, piano D5).
 */
export interface OpzioniSalvataggioFir {
  verificaVersione?: boolean
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
   * Prenota in modo atomico la trasmissione RENTRI (un solo UPDATE condizionato):
   * true se la prenotazione è di chi chiama, false se il FIR è legato, annullato,
   * di un altro tenant o già prenotato da un tentativo non scaduto (`sogliaStallo`).
   */
  prenotaTrasmissioneRentri(
    firId: string,
    tenantId: string,
    ora: Date,
    sogliaStallo: Date
  ): Promise<boolean>

  /**
   * Scrive subito la transazione di creazione accettata dall'ente. Solo se il FIR è
   * ancora SYNCING con lo stesso `avviatoAt` (testimone del tentativo): false se la
   * prenotazione è andata persa.
   */
  registraTransazioneInAttesa(
    firId: string,
    tenantId: string,
    transazioneId: string,
    avviatoAt: Date
  ): Promise<boolean>

  /**
   * FIR da riprendere su tutti i tenant (job di recupero): SYNCING oltre la soglia di
   * stallo e PENDING mai avviati di aziende in AUTOMATICA/IBRIDA. `stato` e' lo stato
   * di sync del FIR. I PENDING devono avere `updated_at` successivo a `pendingAggiornatiDopo`.
   * `tenantAmmessi`: solo i FIR di queste aziende (filtro nella query, prima del limite).
   */
  elencaTrasmissioniRentriSospese(
    sogliaStallo: Date,
    limite: number,
    pendingAggiornatiDopo: Date,
    tenantAmmessi: readonly string[]
  ): Promise<Array<{ firId: string; tenantId: string; stato: 'SYNCING' | 'PENDING' }>>

  /**
   * Save FIR (create or update)
   */
  save(fir: FIR, opzioni?: OpzioniSalvataggioFir): Promise<void>

  /**
   * Delete FIR (soft delete)
   */
  delete(id: string): Promise<void>

  /**
   * Check if numero progressivo exists
   */
  existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean>

  /**
   * Emissione del FIR con assegnazione del riferimento interno, in una sola
   * transaction: lock per tenant e anno di emissione, verifica che il FIR sia
   * ancora in bozza, calcolo del progressivo, `applicaEmissione(numero)` sul
   * dominio e salvataggio di stato e firme. Restituisce il riferimento interno
   * assegnato (`formattaNumeroFir`); se il FIR non è più in bozza lancia
   * `FirNonPiuInBozzaError`.
   *
   * È la transaction di emissione in cui il piano
   * `2026-09-12-collegamento-scorta-emissione.md` aggiungerà il consumo del
   * numero vidimato.
   */
  emettiConNumerazione(
    fir: FIR,
    anno: number,
    applicaEmissione: (numeroProgressivo: string) => void
  ): Promise<string>

  /**
   * Count FIRs by filters
   */
  count(filters?: FIRSearchFilters): Promise<number>
}
