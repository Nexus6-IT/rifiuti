/**
 * Solo per i test (I6): MOVIMENTI e GIACENZE RIFIUTI sintetici da aggiungere allo staging delle
 * anagrafiche di prova. Nessun dato reale; nessun `.bak` disponibile: le colonne e le forme dei
 * campi vengono da `docs/movimenti.md` §2.2, `docs/giacenze.md` §2.2-2.3 e `docs/schema-db-winwaste.md`.
 * Forme PRESUNTE: magazzino del carico `MAG1` (T, X) o `MAG2` (R/D), magazzino dei segmenti G/P =
 * `MAG1` dello scarico, `SF` di `[GIACENZE RIFIUTI]` = `FISI` dei movimenti.
 *
 * Casi (taglio della mappa di prova: 2026-06-30; magazzino 001 -> registro A, 002 -> registro B,
 * 009 non in mappa; `REG1` -> registro A):
 *   carico 1   R13 CER 15 01 01, netto 1000, GIASCAR 400 (giusto), protocollo 12; scaricato 400 dallo scarico 2
 *   carico 3   T CER 20 03 01, netto 300, GIASCAR 0 (giusto), protocollo 13
 *   carico 4   D15 CER 13 02 05* pericoloso, netto 100, GIASCAR 30 ma nessuno scarico lo cita: DIFFERENZA
 *   carico 5   dopo il taglio (2026-09-01): CARICO_DOPO_IL_TAGLIO
 *   carico 6   annullato: ignorato
 *   scarico 7  T, RELAZ G5 20 su CER 15 01 01 (apertura)
 *   scarico 8  R/D, RELAZ P 10 su CER 15 01 01 (carico dell'anno precedente, classe R)
 *   riga 10001/001 CER 150101: DT 50, RR 100 -> apertura 50-20 + 100-10 = 120
 *   riga 80001/001 CER 150101: compensazione (-30), NON sommata
 *   riga 10001/002 CER 150102: RR 80 (registro B)
 *   riga 10001/009 CER 150103: RR 5 (magazzino non in mappa: scarto)
 *   => registro A 15 01 01: 600 + 120 = 720; 20 03 01: 300; 13 02 05*: 100; registro B 15 01 02: 80.
 */
import {
  scriviStagingAnagraficheProva,
  StagingAnagraficheProva,
} from './staging-anagrafiche-di-prova'

export const COL_MOVIMENTI_GIACENZE = [
  'COD',
  'CAUS',
  'OPER',
  'POSI',
  'DTUK',
  'PROD',
  'MAG1',
  'SMAL',
  'MAG2',
  'MODA',
  'CER',
  'TIPOL',
  'FISI',
  'NETTO',
  'VOLU',
  'UM',
  'RELAZ',
  'REG1',
  'PROT1',
  'KGNUM',
  'MCNUM',
  'GIASCAR',
  'STATO',
] as const

export const COL_GIACENZE_RIFIUTI = [
  'UL',
  'MAG',
  'POS',
  'CER',
  'SF',
  'RIF',
  'GIRRK',
  'GIRRM',
  'GIRLK',
  'GIRLM',
  'GIDRK',
  'GIDRM',
  'GIDLK',
  'GIDLM',
  'GIDTK',
  'GIDTM',
] as const

const dodici = (n: number): string => n.toFixed(3).replace('.', ',').padStart(12, ' ')
/** Segmento di RELAZ (34 caratteri). */
export const segmento = (
  tipo: 'C' | 'P' | 'G',
  codice: string,
  classe: string,
  kg: number
): string => `${tipo}${codice.padEnd(8, ' ')}${classe}${dodici(kg)}${dodici(0)}`

type Riga = (string | null)[]

export interface CasoMovimentoGiacenze {
  cod: number
  oper: string
  dtuk?: string
  mag1?: string
  mag2?: string
  moda?: string
  cer?: string
  tipol?: string
  fisi?: string
  netto: number
  relaz?: string
  prot?: string
  giascar?: string
}

export function rigaMovimentoGiacenze(c: CasoMovimentoGiacenze): Riga {
  const netto = String(c.netto)
  return [
    String(c.cod),
    'A1',
    c.oper,
    '',
    c.dtuk ?? '20260310',
    '',
    c.mag1 ?? '001',
    '',
    c.mag2 ?? '',
    c.moda ?? '',
    c.cer ?? '150101',
    c.tipol ?? 'N',
    c.fisi ?? '',
    netto,
    '',
    '',
    c.relaz ?? '',
    c.prot ? 'REG1' : '',
    c.prot ?? '',
    netto,
    '0',
    c.giascar ?? '0.000000',
    '',
  ]
}

export const CASI_MOVIMENTI_GIACENZE: readonly CasoMovimentoGiacenze[] = [
  { cod: 1, oper: '20', mag2: '001', moda: 'R13', netto: 1000, prot: '12', giascar: '400.000000' },
  { cod: 2, oper: '21', dtuk: '20260510', netto: 400, relaz: segmento('C', '1', 'R', 400) },
  { cod: 3, oper: '10', cer: '200301', netto: 300, prot: '13' },
  { cod: 4, oper: '20', mag2: '001', moda: 'D15', cer: '130205', tipol: 'P', netto: 100, prot: '14', giascar: '30.000000' },
  { cod: 5, oper: '20', dtuk: '20260901', mag2: '001', moda: 'R13', netto: 40 },
  { cod: 6, oper: '20', dtuk: '$$260110', mag2: '001', moda: 'R13', netto: 999 },
  { cod: 7, oper: '11', dtuk: '20260520', netto: 20, relaz: segmento('G', 'G5', 'T', 20) },
  { cod: 8, oper: '21', dtuk: '20260521', netto: 10, relaz: segmento('P', '77', 'R', 10) },
]

export const RIGHE_GIACENZE_RIFIUTI_PROVA: readonly Riga[] = [
  ['10001', '001', '', '150101', '', '', '100.000000', '0', '0', '0', '0', '0', '0', '0', '50.000000', '0'],
  ['80001', '001', '', '150101', '', '', '-30.000000', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
  ['10001', '002', '', '150102', '', '', '80.000000', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
  ['10001', '009', '', '150103', '', '', '5.000000', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
]

export async function scriviStagingGiacenzeProva(
  radice: string,
  seme: number,
  opzioni: { casi?: readonly CasoMovimentoGiacenze[]; righe?: readonly Riga[] } = {}
): Promise<StagingAnagraficheProva> {
  return await scriviStagingAnagraficheProva(radice, seme, {
    senzaMovimenti: true,
    tabelleExtra: [
      {
        nome: 'MOVIMENTI',
        colonne: COL_MOVIMENTI_GIACENZE,
        righe: (opzioni.casi ?? CASI_MOVIMENTI_GIACENZE).map(rigaMovimentoGiacenze),
      },
      {
        nome: 'GIACENZE RIFIUTI',
        colonne: COL_GIACENZE_RIFIUTI,
        righe: [...(opzioni.righe ?? RIGHE_GIACENZE_RIFIUTI_PROVA)],
      },
    ],
  })
}
