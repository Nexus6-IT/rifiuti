/**
 * Porta della modifica di una bozza FIR (Fase 2 pezzo 4, piano D1/D8/D11).
 *
 * Separata da `IFIRRepository` di proposito: allargare quella interfaccia costringerebbe a toccare
 * i mock di sette spec e di un oracolo RENTRI che non c'entrano con la modifica.
 */

import { FIR } from '../aggregates/fir.aggregate'

/** Dati dell'audit scritto nella stessa transaction della modifica (D11). */
export interface AuditModificaBozza {
  userId: string
  campiModificati: string[]
  partiRisnapshottate: string[]
}

export interface IFIRModificaBozzaRepository {
  /** Carica il FIR dell'azienda corrente (RLS), o `null` se assente. */
  findById(id: string): Promise<FIR | null>

  /**
   * Salva una bozza modificata in una sola transaction: lock della riga, ricontrollo di legame
   * RENTRI, stato, firme e versione (`versioneAttesa`), scrittura esplicita del contenuto
   * (anche dei campi svuotati), sostituzione delle tratte se cambiate, audit.
   *
   * @throws FirNonTrovatoError riga assente o di un'altra azienda
   * @throws FirNonModificabileError uno dei motivi di D1
   * @throws FirModificatoNelFrattempoError la versione non e' piu' quella attesa
   */
  salvaModificaBozza(fir: FIR, versioneAttesa: number, audit: AuditModificaBozza): Promise<void>
}
