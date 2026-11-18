/**
 * Fase 3 (3.1), D5/D6: tipi del motore di caricamento a blocchi. Il motore e' generico (non conosce
 * WinWaste): lotto, blocchi, RLS e `ON CONFLICT` non dipendono dalla sorgente.
 */
import type { AmbitoLottoImport, Prisma, StatoLottoImport } from '@prisma/client'

export type Tx = Prisma.TransactionClient

/** Conteggi del lotto (D5). Mai valori delle righe: solo numeri. */
export interface ConteggiLotto {
  lette: number
  inserite: number
  saltate: number
  scartate: number
  blocchi: number
}

export const CONTEGGI_VUOTI: Readonly<ConteggiLotto> = Object.freeze({
  lette: 0,
  inserite: 0,
  saltate: 0,
  scartate: 0,
  blocchi: 0,
})

export interface AvviaLotto {
  importSource: string
  /** `WW<ditta4><anno4>`, es. `WW00012026`. */
  archivio: string
  ambito: AmbitoLottoImport
  formatoStaging: string
  /** SHA-256 hex del manifest dello staging. */
  hashStaging: string
  avviatoDa?: string | null
}

export interface LottoCreato {
  id: string
  stato: StatoLottoImport
}

/** Contesto passato a `inserisciBlocco`: id tecnici e numero del blocco, mai dati. */
export interface ContestoBlocco {
  tenantId: string
  lottoId: string
  /** 1-based. */
  numeroBlocco: number
}

/**
 * Scrive un blocco DENTRO la transazione `tx` del motore e restituisce quante righe sono state
 * inserite (le altre, in conflitto sulla chiave legacy, sono «saltate»). Va scritto con SQL
 * parametrizzato e `ON CONFLICT (tenant_id, import_source, legacy_key) WHERE import_source IS NOT
 * NULL DO NOTHING RETURNING id`: il bersaglio e' sempre nominato, cosi' un conflitto su un ALTRO
 * unico (per esempio la P.IVA) fallisce invece di sparire.
 */
export type InserisciBlocco<R> = (
  tx: Tx,
  righe: readonly R[],
  contesto: ContestoBlocco
) => Promise<number>

export interface OpzioniInserimento<R> {
  dimensioneBlocco?: number
  inserisciBlocco: InserisciBlocco<R>
  /**
   * Vincoli differiti da chiudere con `SET CONSTRAINTS ... IMMEDIATE` come ULTIMO statement del
   * blocco. Con il client esteso di `PrismaService` e' ridondante (chiude gia' `ALL` da solo);
   * serve con un client nudo, dove Prisma 5.22 perde l'errore del COMMIT (la transazione e'
   * annullata ma la promise si risolve). Default: la rete dei movimenti importati.
   */
  vincoliDifferiti?: readonly string[]
}

export const VINCOLI_DIFFERITI_DEFAULT: readonly string[] = ['waste_movements_importato_bloccato']
export const DIMENSIONE_BLOCCO_DEFAULT = 200
