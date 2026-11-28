import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'

/** Da dove consumare il numero vidimato all'emissione: sede e, se configurato, blocco. */
export interface RichiestaNumeroVidimato {
  numIscrSito: string
  codiceBlocco?: string
}

/**
 * Decide SE un FIR che si sta emettendo e' soggetto a RENTRI (e quindi deve portare un numero
 * vidimato dalla scorta) e DA DOVE prenderlo. Porta verso l'emissione: l'use case non conosce
 * moduli, modalita' di legame ne' unita' locali.
 *
 * `null` = FIR non soggetto a RENTRI: nessun consumo, emissione come prima.
 */
export abstract class SorgenteNumeroVidimato {
  abstract perEmissione(fir: FIR, tenantId: string): Promise<RichiestaNumeroVidimato | null>

  /** Le stesse condizioni senza un FIR (avvisi preventivi: form e cruscotto). */
  abstract perTenant(tenantId: string): Promise<RichiestaNumeroVidimato | null>
}
