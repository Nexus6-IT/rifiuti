/**
 * Solo per i test (I4): staging sintetico con CLIFOR, SEDI LEGALI, UNITA LOCALI, AUTORIZZAZIONI,
 * AUTOMEZZI e MOVIMENTI (solo le colonne che servono). Nessun dato reale: nomi inventati, partite
 * IVA generate con cifra di controllo valida. Le forme di PRECOD (6 caratteri per UNITA LOCALI,
 * `soggetto.unita` per AUTORIZZAZIONI/AUTOMEZZI/MOVIMENTI) sono quelle PRESUNTE dal documento di
 * schema: vanno riverificate sul primo `.bak` vero.
 */
import { scriviStaging } from '../../application/migrazione/staging/scrittore-staging'
import { partitaIvaValida } from '../anagrafiche-di-test'

type Riga = (string | null)[]

/** Tabella aggiuntiva (es. FORMULARI, XRENTRIFIRTRASMESSI) da scrivere nello stesso staging. */
export interface TabellaStagingExtra {
  readonly nome: string
  readonly colonne: readonly string[]
  readonly righe: Riga[]
}

export interface StagingAnagraficheProva {
  readonly cartella: string
  readonly piva: Record<'uno' | 'due' | 'tre' | 'agganciata' | 'ambiguaC' | 'ambiguaF', string>
  readonly cfPrivato: string
}

const COL_CLIFOR = [
  'PRECOD',
  'COD',
  'DES',
  'EST',
  'CODFIS',
  'PIVA',
  'IND',
  'NUM',
  'COM',
  'CAP',
  'PROV',
  'TEL',
  'RAG2',
  'EST2',
  'IND2',
  'NUM2',
  'COM2',
  'CAP2',
  'PRO2',
] as const
const COL_SEDI = ['PRECOD', 'COD', 'IND', 'NUM', 'COM', 'CAP', 'PROV'] as const
const COL_UL = ['PRECOD', 'COD', 'DES', 'IND', 'NUM', 'COM', 'CAP', 'PROV', 'TEL'] as const
const COL_AUT = ['PRECOD', 'COD', 'NUM', 'SCAD'] as const
const COL_MEZ = ['PRECOD', 'COD', 'TARGA', 'RIMORCHIO', 'TARA'] as const
const COL_MOV = ['COD', 'PROD', 'AUTP', 'TRAS', 'AUTT', 'SMAL', 'AUTS', 'INTE', 'AUTI'] as const

const cl = (
  prec: string,
  cod: string,
  des: string,
  fisc: { piva?: string; cf?: string },
  ind: Partial<Record<'IND' | 'NUM' | 'COM' | 'CAP' | 'PROV' | 'TEL', string>> = {
    IND: 'VIA ROMA',
    NUM: '1',
    COM: 'NAPOLI',
    CAP: '80100',
    PROV: 'NA',
  },
  seconda: Partial<Record<'RAG2' | 'IND2' | 'NUM2' | 'COM2' | 'CAP2' | 'PRO2', string>> = {}
): Riga => [
  prec,
  cod,
  des,
  null,
  fisc.cf ?? null,
  fisc.piva ?? null,
  ind.IND ?? null,
  ind.NUM ?? null,
  ind.COM ?? null,
  ind.CAP ?? null,
  ind.PROV ?? null,
  ind.TEL ?? null,
  seconda.RAG2 ?? null,
  null,
  seconda.IND2 ?? null,
  seconda.NUM2 ?? null,
  seconda.COM2 ?? null,
  seconda.CAP2 ?? null,
  seconda.PRO2 ?? null,
]

export async function scriviStagingAnagraficheProva(
  radice: string,
  seme: number,
  opzioni: { senzaMovimenti?: boolean; tabelleExtra?: readonly TabellaStagingExtra[] } = {}
): Promise<StagingAnagraficheProva> {
  const piva = {
    uno: partitaIvaValida(seme),
    due: partitaIvaValida(seme + 1),
    tre: partitaIvaValida(seme + 2),
    agganciata: partitaIvaValida(seme + 3),
    ambiguaC: partitaIvaValida(seme + 4),
    ambiguaF: partitaIvaValida(seme + 5),
  }
  const cfPrivato = 'ZZZZZZ00A00Z000Z'
  const clifor: Riga[] = [
    cl('C', '000001', 'PRODUTTORE UNO SRL', { piva: piva.uno }),
    cl(
      'F',
      '000002',
      'TRASPORTI DUE SRL',
      { piva: piva.due },
      { IND: 'VIA DUE', NUM: '', COM: 'ROMA', CAP: '00100', PROV: 'rm', TEL: '0612345678' }
    ),
    cl('F', '000003', 'IMPIANTO TRE SPA', { piva: piva.tre }, undefined, {
      RAG2: 'DEPOSITO TRE',
      IND2: 'VIA SECONDA',
      NUM2: '9',
      COM2: 'CASERTA',
      CAP2: '81100',
      PRO2: 'CE',
    }),
    cl(
      'C',
      '000004',
      'PRIVATO SENZA CAP',
      { cf: cfPrivato },
      { IND: 'VIA X', NUM: '2', COM: 'NAPOLI', CAP: '', PROV: 'NA' }
    ),
    cl('F', '000005', 'PRODUTTORE UNO DOPPIONE', { piva: piva.uno }),
    cl('C', '000006', 'DITTA GIA PRESENTE', { piva: piva.agganciata }),
    cl('C', '000007', 'AMBIGUO CLIENTE', { piva: piva.ambiguaC }),
    cl('F', '000007', 'AMBIGUO FORNITORE', { piva: piva.ambiguaF }),
  ]
  const sediLegali: Riga[] = [['C', '000001', 'VIA LEGALE', '5', 'SALERNO', '84100', 'SA']]
  const unitaLocali: Riga[] = [
    ['C000001', '0001', 'DEPOSITO UNO', 'VIA UL', '3', 'NAPOLI', '80100', 'NA', null],
    ['000002', '0001', 'RIMESSA DUE', 'VIA RIMESSA', '4', 'ROMA', '00100', 'RM', '06 1234'],
    ['X90001', '0001', 'SITO PROPRIO', 'VIA PROPRIA', '1', 'NAPOLI', '80100', 'NA', null],
    ['000099', '0001', 'SCONOSCIUTO', 'VIA Y', '1', 'NAPOLI', '80100', 'NA', null],
    ['000007', '0001', 'AMBIGUA', 'VIA Z', '1', 'NAPOLI', '80100', 'NA', null],
    ['000001', 'SL', 'CODICE RISERVATO', 'VIA R', '1', 'NAPOLI', '80100', 'NA', null],
    ['000001', '0002', 'INCOMPLETA', '', '', '', '', '', null],
  ]
  const autorizzazioni: Riga[] = [
    ['000002.0001', '01', 'NA/1234', '31-12-2028'],
    ['000003.0001', '02', 'AUT-77', ''],
    ['000003.0001', '03', '', ''],
  ]
  const automezzi: Riga[] = [
    ['000002.0001', '0001', 'ab 123 cd', '', '7500'],
    ['000002.0001', '0002', 'XY999ZZ', 'S', '4000'],
    ['000002.0001', '0003', 'AB123CD', '', ''],
    ['X90001.0001', '0004', 'EF456GH', '', ''],
    ['000001.0001', '0005', 'ZZ111ZZ', '', '0'],
    ['000002.0001', '0006', '***', '', ''],
  ]
  const movimenti: Riga[] = [
    ['1', '000001.0001', '', '000002.0001', '01', '000003.0001', '02', '000001.0001', ''],
    ['2', '000007.0001', '', '000002.0001', '01', '', '', '', ''],
    ['3', 'X90001.0001', '', '', '', '', '', '', ''],
    // una ditta agganciata (gia' in WasteFlow) che produce: ruolo su ditta esistente
    ['4', '000006.0001', '', '', '', '', '', '', ''],
  ]
  const tabelle = [
    { nome: 'CLIFOR', colonne: COL_CLIFOR, righe: clifor },
    { nome: 'SEDI LEGALI', colonne: COL_SEDI, righe: sediLegali },
    { nome: 'UNITA LOCALI', colonne: COL_UL, righe: unitaLocali },
    { nome: 'AUTORIZZAZIONI', colonne: COL_AUT, righe: autorizzazioni },
    { nome: 'AUTOMEZZI', colonne: COL_MEZ, righe: automezzi },
    ...(opzioni.senzaMovimenti ? [] : [{ nome: 'MOVIMENTI', colonne: COL_MOV, righe: movimenti }]),
    ...(opzioni.tabelleExtra ?? []),
  ]
  const { cartella } = await scriviStaging(
    radice,
    { ditta: '0001', anno: 2026, estrattoIl: '2026-11-14T00:00:00.000Z' },
    tabelle
  )
  return { cartella, piva, cfPrivato }
}
