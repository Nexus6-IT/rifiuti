/**
 * Generatore deterministico della fixture `WW00012026` (ditta 0001, anno 2026).
 *
 * Tutti i dati sono SINTETICI: ragioni sociali assenti, codici soggetto
 * inventati, un solo codice fiscale (formato valido, inventato, dichiarato in
 * `CODICI_FISCALI_INVENTATI`). Le colonne e i tipi rispettano lo schema reale
 * dei database modello dell'installer (`docs/schema-db-winwaste.md`, §6):
 *  - MOVIMENTI: `docs/schema-db-winwaste.md` §6 `MOVIMENTI` + `docs/movimenti.md` §2.2
 *  - FORMULARI: stesse 101 colonne, tipi diversi per STATO/NFATT/LEGAME (§2.1)
 *  - GIACENZE RIFIUTI: `docs/giacenze.md` §2.3
 *  - CAUSALI RIFIUTI / REGISTRI RIFIUTI: CSV delle codifiche del modello
 *    (`codifiche/`, solo codifiche, nessun dato personale)
 *  - VERSIS, RENregistrazioni: `docs/rentri/03-aggancio-a-winwaste.md` §2.2 e §3.1
 *
 * Uso: `npx ts-node test/fixtures/winwaste/genera-fixture.ts` (riscrive la
 * cartella `WW00012026` accanto a questo file). Il test `fixture.spec.ts`
 * verifica che i file committati coincidano con l'output del generatore.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { TABELLE_DOCUMENTATE } from '../../../src/application/migrazione/staging/colonne-documentate'
import { scriviStaging } from '../../../src/application/migrazione/staging/scrittore-staging'

/** Unici codici fiscali ammessi nelle fixture (formato valido, persone inesistenti). */
export const CODICI_FISCALI_INVENTATI: readonly string[] = ['RSSMRA80A01H501U']

export const META_FIXTURE = {
  ditta: '0001',
  anno: 2026,
  estrattoIl: '2026-11-14T00:00:00.000Z',
  estrattore: { nome: 'fixture-sintetica', versione: '1' },
} as const

type Valore = string | null
type Riga = Valore[]

function colonneDi(tabella: string): string[] {
  const t = TABELLE_DOCUMENTATE.find(x => x.nome === tabella)
  if (!t) throw new Error(`tabella non documentata: ${tabella}`)
  return t.colonne.map(c => c.nome)
}

function costruttore(tabella: string, predefiniti: Record<string, Valore> = {}) {
  const colonne = colonneDi(tabella)
  return (valori: Record<string, Valore>): Riga => {
    for (const k of Object.keys(valori)) {
      if (!colonne.includes(k)) throw new Error(`${tabella}: colonna sconosciuta ${k}`)
    }
    return colonne.map(c => (c in valori ? valori[c] : c in predefiniti ? predefiniti[c] : ''))
  }
}

/** Numero con virgola decimale a 3 cifre, allineato a destra su 12 caratteri (`RELAZ`). */
function dodici(n: number): string {
  return n.toFixed(3).replace('.', ',').padStart(12, ' ')
}

/** Segmento di `RELAZ` di 34 caratteri (`docs/giacenze.md` §2.2). */
function segmento(
  tipo: 'C' | 'P' | 'G',
  codice: string,
  classe: string,
  kg: number,
  m3 = 0
): string {
  return `${tipo}${codice.padEnd(8, ' ')}${classe}${dodici(kg)}${dodici(m3)}`
}

/** Campo composito `C4`: 31 posizioni separate da `§` (`docs/formulari.md` §2.2). */
function c4(posizioni: Record<number, string>): string {
  const v = Array.from({ length: 31 }, (_, i) => posizioni[i] ?? '')
  return v.join('§')
}

const dec = (n: number, cifre = 6): string => n.toFixed(cifre)

// --- MOVIMENTI --------------------------------------------------------------
const movimento = costruttore('MOVIMENTI', {
  IMPORT: null,
  C9: null,
  GIASCAR: '0.000000',
  KGNUM: '0.000000',
  MCNUM: '0.000000',
})

const PROD = '000020.0001'
const TRAS = '000030.0001'
const NOSTRA_UL = 'X90000.0002'

function carico(cod: number, o: Record<string, Valore>): Riga {
  return movimento({
    COD: String(cod),
    CAUS: '01',
    OPER: '20',
    POSI: '001',
    CLIE: '000020',
    CONT: '0',
    PROD,
    MAG1: '001',
    TRAS,
    SMAL: NOSTRA_UL,
    MAG2: '001',
    MODA: 'R13',
    REG1: '0002',
    NATU: '1',
    ...o,
  })
}

function scarico(cod: number, o: Record<string, Valore>): Riga {
  return movimento({
    COD: String(cod),
    CAUS: '10',
    OPER: '23',
    POSI: '001',
    CLIE: '000020',
    CONT: '0',
    PROD: NOSTRA_UL,
    MAG1: '001',
    TRAS,
    SMAL: '000040.0001',
    MODA: 'R13',
    REG1: '0002',
    ...o,
  })
}

const MOVIMENTI: Riga[] = [
  // 1: carico 1000 kg, scaricato 600 + 200 (vedi 3 e 15)
  carico(1, {
    DATR: '05-01',
    DTUK: '20260105',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    LORDO: '1100',
    TARA: '100',
    NETTO: '1000',
    PROT1: '000001',
    KGNUM: dec(1000),
    GIASCAR: dec(800),
    STATO: 'R001',
    DES: 'IMBALLAGGI CONTAMINATI',
    C4: c4({ 15: '1000', 16: 'K', 14: '^EXT-0001^' }),
  }),
  // 2: carico 2000 kg, scaricato 400 + 100 ma GIASCAR dice 450 (differenza di 50 kg)
  carico(2, {
    DATR: '10-01',
    DTUK: '20260110',
    CER: '150102',
    TIPOL: 'S',
    FISI: '2',
    NETTO: '2000',
    PROT1: '000002',
    KGNUM: dec(2000),
    GIASCAR: dec(450),
    STATO: 'R001',
    DES: 'Imballaggi in plastica: nota con à, è e § dentro',
  }),
  // 3: scarico di 600 kg dal carico 1
  scarico(3, {
    DATR: '20-01',
    DTUK: '20260120',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    NETTO: '600',
    RELAZ: segmento('C', '00000001', 'R', 600),
    PROT1: '000003',
    KGNUM: dec(600),
  }),
  // 4: scarico di 400 kg dal carico 2
  scarico(4, {
    DATR: '21-01',
    DTUK: '20260121',
    CER: '150102',
    TIPOL: 'S',
    FISI: '2',
    NETTO: '400',
    RELAZ: segmento('C', '00000002', 'R', 400),
    PROT1: '000004',
    KGNUM: dec(400),
  }),
  // 5: annullato (prefisso $$)
  carico(5, {
    DATR: '25-01',
    DTUK: '$$20260125',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    NETTO: '300',
    KGNUM: dec(300),
    STATO: 'R001',
  }),
  // 6: causale 50 (OPER 60), solo fatturazione
  movimento({
    COD: '6',
    CAUS: '50',
    OPER: '60',
    DATR: '30-01',
    DTUK: '20260130',
    CLIE: '000020',
    CONT: '0',
  }),
  // 7: scarico senza relazione con magazzino e netto positivi -> RELAZIONE_MANCANTE
  scarico(7, {
    DATR: '01-02',
    DTUK: '20260201',
    CER: '150102',
    TIPOL: 'S',
    FISI: '2',
    NETTO: '500',
    PROT1: '000005',
    KGNUM: dec(500),
  }),
  // 8: DTUK con mese 13 -> DTUK_NON_VALIDA
  carico(8, { DATR: '15-12', DTUK: '20261345', CER: '150102', TIPOL: 'S', NETTO: '100' }),
  // 9: carico in litri: 2000 L = 2 m3
  carico(9, {
    DATR: '02-02',
    DTUK: '20260202',
    CER: '130205',
    TIPOL: 'P',
    FISI: '3',
    NETTO: '1800',
    VOLU: '2000',
    UM: 'L',
    PROT1: '000006',
    KGNUM: dec(1800),
    MCNUM: dec(2),
    STATO: 'R001',
  }),
  // 10: KGNUM non coincide con NETTO -> avviso KGNUM_INCOERENTE; salta il protocollo 000007
  carico(10, {
    DATR: '03-02',
    DTUK: '20260203',
    CER: '170504',
    TIPOL: 'S',
    FISI: '2',
    NETTO: '1000',
    PROT1: '000008',
    KGNUM: dec(900),
    STATO: 'R001',
  }),
  // 11: OPER inesistente -> OPER_SCONOSCIUTO
  carico(11, { OPER: '19', DATR: '04-02', DTUK: '20260204', CER: '150102', NETTO: '10' }),
  // 12: DATR diversa da DTUK -> avviso DATR_DTUK_DIVERSE
  carico(12, {
    DATR: '04-03',
    DTUK: '20260305',
    CER: '150102',
    TIPOL: 'S',
    NETTO: '50',
    KGNUM: dec(50),
    STATO: 'R001',
  }),
  // 13: scarico da giacenza iniziale G1
  scarico(13, {
    CAUS: '05',
    OPER: '21',
    DATR: '10-03',
    DTUK: '20260310',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    NETTO: '100',
    RELAZ: segmento('G', 'G1', 'R', 100),
    PROT1: '000009',
    KGNUM: dec(100),
    NOT3: 'riga 1\nriga 2\tcon tab',
  }),
  // 14: scarico da carico dell'anno precedente
  scarico(14, {
    DATR: '11-03',
    DTUK: '20260311',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    NETTO: '50',
    RELAZ: segmento('P', '00000077', 'R', 50),
    PROT1: '000010',
    KGNUM: dec(50),
  }),
  // 15: scarico di 300 kg da due carichi (200 dal 1, 100 dal 2)
  scarico(15, {
    DATR: '12-03',
    DTUK: '20260312',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    NETTO: '300',
    RELAZ: segmento('C', '00000001', 'R', 200) + segmento('C', '00000002', 'R', 100),
    PROT1: '000011',
    KGNUM: dec(300),
  }),
  // 16: RELAZ di lunghezza non multipla di 34 -> RELAZ_LUNGHEZZA
  scarico(16, {
    DATR: '13-03',
    DTUK: '20260313',
    CER: '150110',
    TIPOL: 'P',
    NETTO: '20',
    RELAZ: `${segmento('C', '00000001', 'R', 20)}XXXXXX`,
  }),
  // 17: CER con formato errato -> CER_FORMATO
  carico(17, { DATR: '14-03', DTUK: '20260314', CER: '1501', TIPOL: 'S', NETTO: '10' }),
  // 18: carico al deposito temporaneo (OPER 10) con registro 0001 senza protocollo assegnato
  movimento({
    COD: '18',
    CAUS: '18',
    OPER: '10',
    POSI: '001',
    DATR: '15-03',
    DTUK: '20260315',
    CLIE: '000020',
    CONT: '0',
    PROD: NOSTRA_UL,
    MAG1: '001',
    CER: '150102',
    TIPOL: 'S',
    FISI: '2',
    NETTO: '70',
    REG1: '0001',
    KGNUM: dec(70),
    STATO: 'T001',
  }),
]

// --- FORMULARI --------------------------------------------------------------
const formulario = costruttore('FORMULARI', {
  IMPORT: null,
  C9: null,
  GIASCAR: '0.000000',
  KGNUM: '0',
  MCNUM: '0',
})

function fir(cod: number, o: Record<string, Valore>): Riga {
  return formulario({
    COD: String(cod),
    CAUS: '10',
    OPER: '23',
    POSI: '001',
    CLIE: '000020',
    CONT: '0',
    PROD: NOSTRA_UL,
    TRAS,
    SMAL: '000040.0001',
    CER: '150110',
    TIPOL: 'P',
    FISI: '2',
    ...o,
  })
}

const FORMULARI: Riga[] = [
  // emesso, non ancora ricopiato in un movimento
  fir(1, {
    FORMU: 'XRIF000001/26',
    DATD: '20-01-2026',
    DTUK: '20260120',
    NETTO: '600',
    ORA: '0',
    C4: c4({ 15: '600', 16: 'K' }),
    C6: 'DIGITALE',
    C7: '',
    KGNUM: '600',
  }),
  // ricopiato in un movimento
  fir(2, {
    FORMU: 'XRIF000002/26',
    DATD: '21-01-2026',
    DTUK: '20260121',
    NETTO: '400',
    C7: 'R',
    KGNUM: '400',
  }),
  // annullato: BLOK conserva il vecchio C7
  fir(3, {
    FORMU: 'XRIF000003/26',
    DATD: '22-01-2026',
    DTUK: '20260122',
    NETTO: '100',
    C7: 'A',
    BLOK: 'R',
    KGNUM: '100',
  }),
  // richiesta del portale (accettata)
  fir(4, { FORMU: '', DATD: '23-01-2026', DTUK: '20260123', NETTO: '250', C7: '0', KGNUM: '250' }),
  // ricopiato quando C7 era numerico
  fir(5, {
    FORMU: 'XRIF000004/26',
    DATD: '24-01-2026',
    DTUK: '20260124',
    NETTO: '80',
    C7: '9',
    KGNUM: '80',
  }),
  // C7 inatteso -> C7_SCONOSCIUTO
  fir(6, {
    FORMU: 'XRIF000005/26',
    DATD: '25-01-2026',
    DTUK: '20260125',
    NETTO: '10',
    C7: 'Q',
    KGNUM: '10',
  }),
]

// --- GIACENZE RIFIUTI -------------------------------------------------------
const giacenza = costruttore(
  'GIACENZE RIFIUTI',
  Object.fromEntries(
    colonneDi('GIACENZE RIFIUTI')
      .filter(c => /^(GI|CR|CD|CL|SI|ST|GF)/.test(c))
      .map(c => [c, '0.000000'])
  )
)

const GIACENZE: Riga[] = [
  // riga normale: giacenza iniziale R13 da terzi (kg e m3)
  giacenza({
    UL: 'X900000002',
    MAG: '001',
    POS: '001',
    CER: '150110',
    SF: '2',
    RIF: '',
    GIRRK: dec(1500),
    GIRRM: dec(3),
    VER: '1',
    ID: 'Administrator',
  }),
  // riga normale con piu' classi
  giacenza({
    UL: 'X900000002',
    MAG: '001',
    POS: '002',
    CER: '150102',
    SF: '2',
    RIF: '',
    GIRRK: dec(500),
    GIDRK: dec(250),
    GIDTK: dec(75),
    VER: '1',
    ID: 'Administrator',
  }),
  // riga di compensazione (UL inizia per 8): residuo in negativo, solo kg
  giacenza({
    UL: '8900000002',
    MAG: '001',
    POS: '001',
    CER: '150110',
    SF: '2',
    RIF: '',
    GIRRK: dec(-200),
    VER: '1',
    ID: 'Administrator',
  }),
]

// --- Codifiche dai CSV del modello -------------------------------------------
function leggiCsv(nome: string): string[][] {
  const testo = readFileSync(join(__dirname, 'codifiche', nome), 'utf8')
  return testo
    .split(/\r?\n/)
    .filter(l => l.length > 0)
    .map(l => l.split(','))
}

function daCsv(nome: string, tabella: string): Riga[] {
  const [intestazione, ...righe] = leggiCsv(nome)
  const attese = colonneDi(tabella).map(c => c.toUpperCase())
  const ordine = intestazione.map(c => c.toUpperCase())
  if (JSON.stringify(ordine) !== JSON.stringify(attese)) {
    throw new Error(`${nome}: colonne diverse da quelle documentate per ${tabella}`)
  }
  return righe.map(r => {
    if (r.length !== intestazione.length) throw new Error(`${nome}: riga con virgole inattese`)
    return r
  })
}

// --- VERSIS e RENregistrazioni ------------------------------------------------
const versis = costruttore('VERSIS')
const VERSIS: Riga[] = [
  versis({ COD: 'XRENTRI:X90000.0002', IDSIS: 'SITO-0002', VERSIS: '1', VERTOT: '1' }),
  versis({ COD: 'XRENTRI:0002', IDSIS: 'REG-0002', VERSIS: '1' }),
  // riga con segreti (host, utente, password cifrata, licenza): non deve mai finire nei rapporti
  versis({
    COD: 'HUBRW:X90000',
    IDSIS: '',
    VERSIS: '1',
    C1: 'hub.esempio.invalid',
    C2: 'utente-finto',
    C3: 'PASSWORD-CIFRATA-FINTA',
    C4: 'LICENZA-FINTA',
    C5: '1',
  }),
]

const rego = costruttore('RENregistrazioni')
const RENREGISTRAZIONI: Riga[] = [
  rego({
    CODMOVIMENTO: '3',
    ANNOMOVIMENTO: '2026',
    REGISTRO: '0002',
    PROTOCOLLO: '000003',
    DATAREGISTRAZIONE: '20260120',
    CAUSALERENTRI: 'ST',
    TIPOMOVIMENTO: 'S',
    XSEINVIATO: 'X',
    IDRENTRI: 'ID-FINTO-0001',
    Cer: '150110',
    QuantitaRifiuto: '600.000',
    XSeMisurakg: 'X',
    CodFisProd: CODICI_FISCALI_INVENTATI[0],
    RagSocProd: 'DITTA PROVA 1',
  }),
  rego({
    CODMOVIMENTO: '4',
    ANNOMOVIMENTO: '2026',
    REGISTRO: '0002',
    PROTOCOLLO: '000004',
    DATAREGISTRAZIONE: '20260121',
    CAUSALERENTRI: 'ST',
    TIPOMOVIMENTO: 'S',
    XSEINVIATO: '',
    Cer: '150102',
    QuantitaRifiuto: '400.000',
    XSeMisurakg: 'X',
  }),
]

/** Scrive la fixture in `<radice>/WW00012026/`. */
export async function generaFixture(radice: string): Promise<string> {
  const tab = (nome: string, righe: Riga[]) => ({ nome, colonne: colonneDi(nome), righe })
  const { cartella } = await scriviStaging(radice, META_FIXTURE, [
    tab('MOVIMENTI', MOVIMENTI),
    tab('FORMULARI', FORMULARI),
    tab('GIACENZE RIFIUTI', GIACENZE),
    tab('CAUSALI RIFIUTI', daCsv('ww00002014_causali_rifiuti.csv', 'CAUSALI RIFIUTI')),
    tab('REGISTRI RIFIUTI', daCsv('ww00002014_registri_rifiuti.csv', 'REGISTRI RIFIUTI')),
    tab('VERSIS', VERSIS),
    tab('RENregistrazioni', RENREGISTRAZIONI),
  ])
  return cartella
}

if (require.main === module) {
  generaFixture(__dirname).then(c => process.stdout.write(`fixture scritta in ${c}\n`))
}
