/**
 * Repository delle ditte e delle loro sedi (F2-10).
 *
 * Ogni metodo riceve il client (`tx` di una transazione o il client normale) come primo
 * argomento: la creazione di un ruolo e' UNA transazione che comprende lock, ricerca della ditta,
 * sede e insert della riga di ruolo (D3), quindi il chiamante decide il client. Ogni query porta
 * il `tenantId` del TenantContext nel `where`.
 */
import { Ditta } from '../entities/ditta'
import { RuoloControparte, SedeDitta } from '../entities/sede-ditta'

/** Una riga di ruolo (produttore, trasportatore, destinatario) della ditta. */
export interface RuoloDitta {
  ruolo: RuoloControparte
  id: string
  /** Sede predefinita del ruolo. */
  sedeId: string | null
}

export interface DittaRepository<C = unknown> {
  /** Advisory lock di transazione su ciascun valore, in ordine alfabetico (niente deadlock). */
  bloccaIdentificativi(client: C, valori: string[]): Promise<void>

  /** Advisory lock che serializza le scritture sulle sedi di una ditta. */
  bloccaSedi(client: C, dittaId: string): Promise<void>

  /** Le ditte dell'azienda che hanno uno dei valori come partita IVA o come codice fiscale. */
  cercaPerIdentificativi(client: C, valori: string[]): Promise<Ditta[]>

  trovaPerId(client: C, id: string): Promise<Ditta | null>

  trovaSede(client: C, dittaId: string, sedeId: string): Promise<SedeDitta | null>

  /** Tutte le sedi (anche disattivate): principale per prima, poi per indirizzo. */
  sedi(client: C, dittaId: string): Promise<SedeDitta[]>

  crea(client: C, ditta: Ditta): Promise<void>

  aggiorna(client: C, ditta: Ditta): Promise<void>

  creaSede(client: C, sede: SedeDitta): Promise<void>

  aggiornaSede(client: C, sede: SedeDitta): Promise<void>

  /** Prima toglie la principale a tutte le sedi della ditta, poi la mette a quella indicata. */
  impostaPrincipale(client: C, dittaId: string, sedeId: string): Promise<void>

  ruoliDellaDitta(client: C, dittaId: string): Promise<RuoloDitta[]>
}

export const DITTA_REPOSITORY = Symbol('DITTA_REPOSITORY')
