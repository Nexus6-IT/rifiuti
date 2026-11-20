/**
 * Solo per i test (I2): staging sintetico con la tabella CLIFOR, scritto con lo scrittore vero.
 * Nessun dato reale: ragioni sociali inventate, partite IVA generate con cifra di controllo valida.
 */
import { scriviStaging } from '../../application/migrazione/staging/scrittore-staging'
import { partitaIvaValida } from '../anagrafiche-di-test'

export const COLONNE_CLIFOR_PROVA = ['PRECOD', 'COD', 'DES', 'EST', 'CODFIS', 'PIVA'] as const

export interface StagingDitteProva {
  readonly cartella: string
  readonly pivaUno: string
  readonly pivaAgganciata: string
  readonly cfPrivato: string
  readonly pivaNonValida: string
}

/** 6 righe: due ditte nuove (una con P.IVA, una privata con CF), un duplicato, una agganciabile, due scarti. */
export async function scriviStagingDitteProva(
  radice: string,
  seme: number
): Promise<StagingDitteProva> {
  const pivaUno = partitaIvaValida(seme)
  const pivaAgganciata = partitaIvaValida(seme + 1)
  const cfPrivato = 'ZZZZZZ00A00Z000Z'
  const pivaNonValida = '12345678901'
  const righe: (string | null)[][] = [
    ['C', '000001', 'DITTA PROVA UNO', 'SRL', null, pivaUno],
    ['C', '000002', 'PRIVATO DI PROVA', null, cfPrivato, null],
    ['F', '000003', 'DITTA PROVA UNO', 'DOPPIONE', null, pivaUno],
    ['F', '000004', 'DITTA GIA PRESENTE', null, null, pivaAgganciata],
    ['F', '000005', 'PIVA SBAGLIATA', null, null, pivaNonValida],
    ['C', '000006', 'SENZA DATI FISCALI', null, null, null],
  ]
  const { cartella } = await scriviStaging(
    radice,
    { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' },
    [{ nome: 'CLIFOR', colonne: COLONNE_CLIFOR_PROVA, righe }]
  )
  return { cartella, pivaUno, pivaAgganciata, cfPrivato, pivaNonValida }
}

/** Staging con le sole righe CLIFOR date: `[PRECOD, COD, DES, EST, CODFIS, PIVA]`. */
export async function scriviStagingClifor(
  radice: string,
  righe: (string | null)[][]
): Promise<string> {
  const { cartella } = await scriviStaging(
    radice,
    { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' },
    [{ nome: 'CLIFOR', colonne: COLONNE_CLIFOR_PROVA, righe }]
  )
  return cartella
}
