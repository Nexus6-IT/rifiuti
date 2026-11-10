/**
 * Porta verso la generazione in serie dei FIR dai ritiri (4.7, T12): il controller dipende solo da
 * questa interfaccia, `RitiriModule` la lega a `GeneraFirDaRitiriService`.
 */
import type { RisultatoGenerazione } from '../../application/ritiri/genera-fir-da-ritiri.service'

export const GENERA_FIR_DA_RITIRI = Symbol('GENERA_FIR_DA_RITIRI')

export interface GeneraFirDaRitiriPorta {
  genera(
    tenantId: string,
    utenteId: string,
    ritiroIds: readonly string[]
  ): Promise<RisultatoGenerazione>
}
