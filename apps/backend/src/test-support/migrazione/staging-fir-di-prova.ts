/**
 * Solo per i test (I5): FORMULARI e XRENTRIFIRTRASMESSI sintetici da aggiungere allo staging delle
 * anagrafiche di prova. Nessun dato reale; nessun `.bak` disponibile: le colonne e le forme dei
 * campi vengono da `docs/formulari.md` §2.1-2.3 e `docs/schema-db-winwaste.md` (FORMULARI,
 * XRENTRIFIRTRASMESSI). Forme PRESUNTE: `MEZ` = codice mezzo del trasportatore (4), `DATF`
 * `gg-mm-aaaa`, `C6` `DIGITALE`, `FORMU` dei digitali = numero RENTRI (13 caratteri).
 */
import {
  scriviStagingAnagraficheProva,
  StagingAnagraficheProva,
} from './staging-anagrafiche-di-prova'

export const COL_FORMULARI = [
  'COD',
  'CAUS',
  'OPER',
  'POSI',
  'DATR',
  'FORMU',
  'DATD',
  'DTUK',
  'PROD',
  'AUTP',
  'MAG1',
  'TRAS',
  'AUTT',
  'MEZ',
  'SMAL',
  'AUTS',
  'MODA',
  'CER',
  'TIPOL',
  'FISI',
  'NETTO',
  'VOLU',
  'UM',
  'DES',
  'DATF',
  'RELAZ',
  'C6',
  'C7',
  'KGNUM',
] as const

export const COL_XFIR = [
  'IDRENTRI',
  'CODICEFISCALE',
  'NUMEROFIR',
  'UNITALOCALE',
  'XSEANNULLATO',
] as const

export interface CasoFir {
  cod: number
  formu: string
  prod?: string
  tras?: string
  mez?: string
  smal?: string
  cer?: string
  tipol?: string
  netto?: string
  datd?: string
  dtuk?: string
  datf?: string
  c6?: string
  c7?: string
  des?: string
  moda?: string
}

/** Riga FORMULARI con i soli campi dei casi; tutto il resto vuoto. */
export function rigaFormulari(c: CasoFir): (string | null)[] {
  const netto = c.netto ?? '1200'
  return [
    String(c.cod),
    'A1',
    '10',
    '',
    '',
    c.formu,
    c.datd ?? '05-03-2026',
    c.dtuk ?? '20260305',
    c.prod ?? '000001.0001',
    '',
    '',
    c.tras ?? '000002.0001',
    '',
    c.mez ?? '0001',
    c.smal ?? 'X1.0001',
    '',
    c.moda ?? '',
    c.cer ?? '150101',
    c.tipol ?? 'N',
    '',
    netto,
    '',
    '',
    c.des ?? 'IMBALLAGGI MISTI',
    c.datf ?? '',
    '',
    c.c6 ?? '',
    c.c7 ?? '',
    netto,
  ]
}

export const CASI_FIR: readonly CasoFir[] = [
  // 1: cartaceo emesso, stato dedotto AWAITING_RECEIVER (nessuna data di fine)
  { cod: 1, formu: 'A0001/26' },
  // 2: ricopiato in un movimento (C7 R), con data di fine e peso: COMPLETED
  { cod: 2, formu: 'A0002/26', c7: 'R', datf: '06-03-2026' },
  // 3: ricopiato con C7 numerico 9 (richiesta di servizio ricopiata)
  { cod: 3, formu: 'A0003/26', c7: '9' },
  // 4: digitale (non si copia)
  { cod: 4, formu: 'ABCDE1234567', c6: 'DIGITALE' },
  // 5: digitale gia' inviato, senza riga in XRENTRIFIRTRASMESSI
  { cod: 5, formu: 'FGHIJ7654321', c6: 'INVIATO A RENTRI DA PROVA' },
  // 6: annullato
  { cod: 6, formu: 'A0006/26', c7: 'A' },
  // 7: richiesta del portale
  { cod: 7, formu: 'A0007/26', c7: '4' },
  // 8: produttore non in CLIFOR
  { cod: 8, formu: 'A0008/26', prod: '000099.0001' },
  // 9: peso assente
  { cod: 9, formu: 'A0009/26', netto: '0' },
  // 10: stesso numero fiscale del FIR 1 (collisione da segnalare, mai rinominata)
  { cod: 10, formu: 'A0001/26' },
  // 11: destinatario ambiguo (stesso COD in C e F)
  { cod: 11, formu: 'A0011/26', smal: '000007.0001' },
  // 12: trasportatore assente, produttore doppione F000005 (unita' locale senza sede -> sede legale)
  { cod: 12, formu: 'A0012/26', prod: '000005.0001', tras: '' },
  // 13: produttore = ditta agganciata (gia' in WasteFlow), pericoloso con volume assente
  { cod: 13, formu: 'A0013/26', prod: '000006.0001', cer: '130205', tipol: 'P' },
  // 14: sito proprio non in mappa
  { cod: 14, formu: 'A0014/26', smal: 'X9.0009' },
  // 15: recupero (moda R)
  { cod: 15, formu: 'A0015/26', moda: 'R' },
  // 16: FORMU assente
  { cod: 16, formu: '' },
]

export async function scriviStagingFirProva(
  radice: string,
  seme: number,
  opzioni: { casi?: readonly CasoFir[] } = {}
): Promise<StagingAnagraficheProva> {
  return await scriviStagingAnagraficheProva(radice, seme, {
    tabelleExtra: [
      {
        nome: 'FORMULARI',
        colonne: COL_FORMULARI,
        righe: (opzioni.casi ?? CASI_FIR).map(rigaFormulari),
      },
      {
        nome: 'XRENTRIFIRTRASMESSI',
        colonne: COL_XFIR,
        righe: [
          ['ID-RENTRI-0001', 'ZZZZZZ00A00Z000Z', 'ABCDE1234567', 'UL01', ''],
          ['ID-RENTRI-ALTRO', '01234567897', 'ZZZZZ0000000', 'UL01', ''],
        ],
      },
    ],
  })
}
