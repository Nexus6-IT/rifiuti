import {
  sorgenteConElementi,
  sorgenteInMemoria,
} from '../../../../test-support/migrazione-sorgente'
import { StagingError } from '../manifest'
import { parsaCausaliRifiuti } from './causali-rifiuti'
import { parsaFormulari } from './formulari'
import { parsaGiacenzeRifiuti } from './giacenze-rifiuti'
import { parsaMovimenti } from './movimenti'
import { parsaRegistriRifiuti } from './registri-rifiuti'
import { parsaRenRegistrazioni } from './ren-registrazioni'
import { ContestoParser } from './scarti'
import { parsaVersis } from './versis'

const CTX: ContestoParser = { ditta: '0001', anno: 2026 }

type Valori = Record<string, string | null>

/** Movimento attivo e coerente: carico R13 da 100 kg. */
const base = (o: Valori = {}): Valori => ({
  COD: '1',
  CAUS: '01',
  OPER: '20',
  DTUK: '20260105',
  DATR: '05-01',
  CER: '150102',
  TIPOL: 'S',
  NETTO: '100',
  KGNUM: '100.000000',
  MCNUM: '0.000000',
  GIASCAR: '0.000000',
  STATO: 'R001',
  MAG1: '001',
  ...o,
})

const dodici = (n: number): string => n.toFixed(3).replace('.', ',').padStart(12, ' ')
const seg = (cod: string, kg: number): string => `C${cod.padEnd(8, ' ')}R${dodici(kg)}${dodici(0)}`

async function movimenti(...righe: Valori[]) {
  return parsaMovimenti(sorgenteInMemoria('MOVIMENTI', righe), CTX)
}
const codiciScarto = (r: { scarti: { codice: string }[] }) => r.scarti.map(s => s.codice)
const codiciAvviso = (r: { avvisi: { codice: string }[] }) => r.avvisi.map(s => s.codice)

describe('parsaMovimenti: scarti', () => {
  it.each([
    ['COD non valido', { COD: 'abc' }, 'COD_NON_VALIDO'],
    ['COD zero', { COD: '0' }, 'COD_NON_VALIDO'],
    ['DTUK non valida', { DTUK: '20261345' }, 'DTUK_NON_VALIDA'],
    ['DTUK annullata non valida', { DTUK: '$$261345' }, 'DTUK_NON_VALIDA'],
    ['OPER sconosciuto', { OPER: '19' }, 'OPER_SCONOSCIUTO'],
    ['netto non valido', { NETTO: '1.234' }, 'NUMERO_IT'],
    ['volume senza unita', { VOLU: '5', UM: '' }, 'UM_SCONOSCIUTA'],
    ['CER di formato errato', { CER: '15 01' }, 'CER_FORMATO'],
    ['RELAZ di lunghezza errata', { RELAZ: 'XX' }, 'RELAZ_LUNGHEZZA'],
    ['RELAZ con tipo ignoto', { RELAZ: seg('1', 1).replace('C', 'Z') }, 'RELAZ_TIPO'],
    ['RELAZ con classe ignota', { RELAZ: seg('1', 1).replace('R', 'Z') }, 'RELAZ_CLASSE'],
    ['RELAZ con codice non valido', { RELAZ: seg('abc', 1) }, 'RELAZ_CODICE'],
    [
      'RELAZ con quantita non valida',
      { RELAZ: `C00000001R${'1.5'.padStart(12)}${dodici(0)}` },
      'RELAZ_QUANTITA',
    ],
    ['scarico senza relazione', { OPER: '23', CAUS: '10' }, 'RELAZIONE_MANCANTE'],
  ])('%s', async (_nome, o, codice) => {
    const r = await movimenti(base(o))
    expect(r.record).toEqual([])
    expect(codiciScarto(r)).toEqual([codice])
  })

  it('COD duplicato: il primo resta, il secondo e scartato', async () => {
    const r = await movimenti(base(), base({ NETTO: '50' }))
    expect(r.record).toHaveLength(1)
    expect(r.scarti).toEqual([
      expect.objectContaining({ riga: 2, cod: '1', codice: 'COD_DUPLICATO', tabella: 'MOVIMENTI' }),
    ])
  })

  it('l obbligo di relazione non vale per gli annullati, per MAG1 zero o per netto zero', async () => {
    const r = await movimenti(
      base({ COD: '1', OPER: '23', DTUK: '$$260105' }),
      base({ COD: '2', OPER: '23', MAG1: '0' }),
      base({ COD: '3', OPER: '23', MAG1: '' }),
      base({ COD: '4', OPER: '23', NETTO: '0', KGNUM: '0.000000' }),
      base({ COD: '5', OPER: '23', NETTO: '', KGNUM: '0.000000' })
    )
    expect(r.scarti).toEqual([])
    expect(r.record).toHaveLength(5)
  })

  it('con la relazione presente lo scarico passa', async () => {
    const r = await movimenti(base({ OPER: '23', RELAZ: seg('1', 100) }))
    expect(r.scarti).toEqual([])
  })

  it('un solo scarto per riga, il primo trovato', async () => {
    const r = await movimenti(base({ DTUK: 'zz', OPER: '19', CER: 'x' }))
    expect(codiciScarto(r)).toEqual(['DTUK_NON_VALIDA'])
  })

  it('le righe di staging illeggibili diventano scarti con il numero di riga', async () => {
    const colonne = [
      'COD',
      'CAUS',
      'OPER',
      'DTUK',
      'CER',
      'TIPOL',
      'NETTO',
      'VOLU',
      'UM',
      'RELAZ',
      'MAG1',
      'KGNUM',
      'MCNUM',
      'GIASCAR',
      'STATO',
    ]
    const r = await parsaMovimenti(
      sorgenteConElementi(colonne, [
        { tipo: 'scarto', scarto: { numeroRiga: 4, codice: 'RIGA_JSON_MALFORMATA' } },
      ]),
      CTX
    )
    expect(r.righeLette).toBe(1)
    expect(r.scarti).toEqual([
      {
        tabella: 'MOVIMENTI',
        cod: '',
        riga: 4,
        codice: 'RIGA_JSON_MALFORMATA',
        dettaglio: expect.any(String),
      },
    ])
  })

  it('una colonna indispensabile assente dal manifest ferma il parser', async () => {
    const colonne = ['COD', 'DTUK']
    await expect(
      parsaMovimenti(sorgenteInMemoria('MOVIMENTI', [], colonne), CTX)
    ).rejects.toMatchObject({
      codice: 'COLONNA_OBBLIGATORIA_ASSENTE',
    })
    await expect(
      parsaMovimenti(sorgenteInMemoria('MOVIMENTI', [], colonne), CTX)
    ).rejects.toBeInstanceOf(StagingError)
  })

  it('il dettaglio di uno scarto non riporta mai il valore della colonna', async () => {
    const r = await movimenti(
      base({ COD: '1', NETTO: 'SEGRETO-1' }),
      base({ COD: '2', RELAZ: 'SEGRETO-2' }),
      base({ COD: '3', DTUK: 'SEGRETO-3' }),
      base({ COD: '4', CER: 'SEGRETO-4' })
    )
    expect(r.scarti).toHaveLength(4)
    expect(JSON.stringify(r.scarti)).not.toContain('SEGRETO')
  })
})

describe('parsaMovimenti: avvisi (il record resta)', () => {
  it.each([
    ['DATR diversa da DTUK', { DATR: '06-01' }, 'DATR_DTUK_DIVERSE'],
    ['DATR non valida', { DATR: '31-04' }, 'DATR_NON_VALIDA'],
    ['soggetto malformato', { PROD: 'xx' }, 'SOGGETTO_FORMATO'],
    ['LORDO non valido', { LORDO: 'zz' }, 'LORDO_NON_VALIDO'],
    ['TARA non valida', { TARA: 'zz' }, 'TARA_NON_VALIDO'],
    ['C4 con numero non valido', { C4: '§'.repeat(15) + 'zz' }, 'C4_NUMERO'],
    ['KGNUM diverso da NETTO', { KGNUM: '90.000000' }, 'KGNUM_INCOERENTE'],
    ['MCNUM diverso da VOLU', { VOLU: '2', UM: 'M', MCNUM: '3.000000' }, 'MCNUM_INCOERENTE'],
    ['KGNUM non decimale', { KGNUM: '1,5' }, 'KGNUM_NON_VALIDO'],
    ['MCNUM non decimale', { MCNUM: 'x' }, 'MCNUM_NON_VALIDO'],
    ['GIASCAR non decimale', { GIASCAR: 'x' }, 'GIASCAR_NON_VALIDO'],
    ['protocollo senza registro', { PROT1: '000001' }, 'REGISTRO_PROTOCOLLO_INCOERENTE'],
    ['protocollo non numerico', { REG1: '0002', PROT1: 'AB' }, 'PROTOCOLLO_NON_NUMERICO'],
    ['CER assente', { CER: '' }, 'CER_ASSENTE'],
  ])('%s', async (_nome, o, codice) => {
    const r = await movimenti(base(o))
    expect(r.scarti).toEqual([])
    expect(r.record).toHaveLength(1)
    expect(codiciAvviso(r)).toContain(codice)
    expect(r.record[0].avvisi).toContain(codice)
  })

  it('un movimento coerente non ha avvisi; la fatturazione non richiede il CER', async () => {
    const r = await movimenti(
      base(),
      base({ COD: '2', OPER: '60', CER: '', NETTO: '', KGNUM: '0.000000' })
    )
    expect(r.avvisi).toEqual([])
  })

  it('le colonne non mappate finiscono nel grezzo e le mappate no', async () => {
    const r = await movimenti(base({ DES: 'testo', LEGAME: 'C2A', CONT: '0', NOT1: '' }))
    expect(r.record[0].grezzo).toEqual({ DES: 'testo', LEGAME: 'C2A' })
  })

  it('i valori null di SQL Server sono trattati come vuoti nelle colonne opzionali', async () => {
    const r = await movimenti(base({ PROD: null, C4: null, LORDO: null }))
    expect(r.avvisi).toEqual([])
    expect(r.record[0]).toMatchObject({ produttore: null, c4: expect.any(Object), lordoKg: null })
  })
})

describe('parsaFormulari: unita', () => {
  const fir = (o: Valori = {}): Valori => ({
    COD: '1',
    CAUS: '10',
    OPER: '23',
    DTUK: '20260120',
    DATD: '20-01-2026',
    CER: '150110',
    TIPOL: 'P',
    NETTO: '600',
    KGNUM: '600',
    FORMU: 'XRIF000001/26',
    C7: '',
    C6: '',
    MAG1: '001',
    ...o,
  })
  const parsa = (...righe: Valori[]) => parsaFormulari(sorgenteInMemoria('FORMULARI', righe), CTX)

  it('il FIR emesso non ha relazione e non e scartato per questo', async () => {
    const r = await parsa(fir())
    expect(r.scarti).toEqual([])
    expect(r.record[0]).toMatchObject({ statoFir: 'EMESSO', annullato: false, digitale: false })
  })

  it.each([
    ['', 'EMESSO'],
    ['R', 'RICOPIATO'],
    ['9', 'RICOPIATO'],
    ['A', 'ANNULLATO'],
    ['0', 'PORTALE'],
    ['1', 'PORTALE'],
    ['2', 'PORTALE'],
    ['3', 'PORTALE'],
    ['4', 'PORTALE'],
    ['8ELIMINATA', 'PORTALE'],
  ])('C7 %p -> %s', async (c7, stato) => {
    const r = await parsa(fir({ C7: c7 }))
    expect(r.record[0].statoFir).toBe(stato)
  })

  it('C7 sconosciuto -> scarto; COD duplicato -> scarto; COD non valido -> scarto', async () => {
    const r = await parsa(fir({ C7: 'Z' }), fir({ COD: '2' }), fir({ COD: '2' }), fir({ COD: '' }))
    expect(codiciScarto(r)).toEqual(['C7_SCONOSCIUTO', 'COD_DUPLICATO', 'COD_NON_VALIDO'])
  })

  it('annullato da DTUK o da C7, una sola causa', async () => {
    const r = await parsa(fir({ DTUK: '$$260120', C7: 'A' }), fir({ COD: '2', C7: 'A' }))
    expect(r.record.map(f => [f.annullato, f.causaAnnullo])).toEqual([
      [true, 'PREFISSO_ANNULLO'],
      [true, 'C7_ANNULLATO'],
    ])
  })

  it('avvisi: DATD non valida o diversa da DTUK, KGNUM non valido o incoerente', async () => {
    const r = await parsa(
      fir({ COD: '1', DATD: '31-04-2026' }),
      fir({ COD: '2', DATD: '21-01-2026' }),
      fir({ COD: '3', KGNUM: 'x' }),
      fir({ COD: '4', KGNUM: '700' })
    )
    expect(r.avvisi.map(a => [a.cod, a.codice])).toEqual([
      ['1', 'DATD_NON_VALIDA'],
      ['2', 'DATD_DTUK_DIVERSE'],
      ['3', 'KGNUM_NON_VALIDO'],
      ['4', 'KGNUM_INCOERENTE'],
    ])
  })

  it('KGNUM arrotondato all unita (decimal(18,0)) non da avviso', async () => {
    const r = await parsa(fir({ NETTO: '12,5', KGNUM: '13' }))
    expect(r.avvisi).toEqual([])
  })

  it('stato digitale da C6', async () => {
    const r = await parsa(
      fir({ C6: 'DIGITALE' }),
      fir({ COD: '2', C6: 'INVIATO A RENTRI DA utente' }),
      fir({ COD: '3', C6: 'altro' })
    )
    expect(r.record.map(f => f.digitale)).toEqual([true, true, false])
  })

  it('RELAZ illeggibile in un FIR: avviso e testo conservato (in MOVIMENTI sarebbe uno scarto)', async () => {
    const r = await parsa(fir({ RELAZ: 'PORTARE ATTREZZATURA' }))
    expect(r.scarti).toEqual([])
    expect(codiciAvviso(r)).toEqual(['RELAZ_NON_DECODIFICABILE'])
    expect(r.record[0].grezzo.RELAZ).toBe('PORTARE ATTREZZATURA')
    const ok = await parsa(fir({ RELAZ: seg('1', 5) }))
    expect(ok.record[0].relaz).toHaveLength(1)
    expect(ok.record[0].grezzo.RELAZ).toBeUndefined()
  })

  it('scarti di decodifica del corpo comune anche nei FIR', async () => {
    const r = await parsa(fir({ OPER: '19' }))
    expect(codiciScarto(r)).toEqual(['OPER_SCONOSCIUTO'])
  })
})

describe('parsaGiacenzeRifiuti: unita', () => {
  const g = (o: Valori = {}): Valori => ({
    UL: 'X900000002',
    MAG: '001',
    POS: '001',
    CER: '150110',
    SF: '2',
    RIF: '',
    GIRRK: '10.000000',
    GIRRM: '0.000000',
    GIRLK: '0.000000',
    GIRLM: '0.000000',
    GIDRK: '0.000000',
    GIDRM: '0.000000',
    GIDLK: '0.000000',
    GIDLM: '0.000000',
    GIDTK: '0.000000',
    GIDTM: '0.000000',
    ...o,
  })
  const parsa = (...righe: Valori[]) =>
    parsaGiacenzeRifiuti(sorgenteInMemoria('GIACENZE RIFIUTI', righe))

  it('chiave vuota, chiave duplicata, decimale non valido', async () => {
    const r = await parsa(
      g(),
      g(),
      g({ UL: '' }),
      g({ CER: '' }),
      g({ POS: '002', GIDLK: 'x' }),
      g({ POS: '003', GIDRM: 'x' })
    )
    expect(r.scarti.map(s => [s.riga, s.codice])).toEqual([
      [2, 'CHIAVE_DUPLICATA'],
      [3, 'CHIAVE_VUOTA'],
      [4, 'CHIAVE_VUOTA'],
      [5, 'DECIMALE_SQL'],
      [6, 'DECIMALE_SQL'],
    ])
    expect(r.record).toHaveLength(1)
  })

  it('decimali nulli o vuoti valgono zero', async () => {
    const r = await parsa(g({ GIRRK: null, GIRRM: '' }))
    expect(r.record[0].giacenze.RR).toEqual({ kg: 0, m3: 0 })
  })
})

describe('parsaCausaliRifiuti / parsaRegistriRifiuti / parsaVersis / parsaRenRegistrazioni: unita', () => {
  it('causali: COD vuoto, duplicato, OPER sconosciuto', async () => {
    const c = (o: Valori = {}): Valori => ({ COD: '01', DES: 'x', TIP: '2', OPE: '0', ...o })
    const r = await parsaCausaliRifiuti(
      sorgenteInMemoria('CAUSALI RIFIUTI', [c(), c(), c({ COD: '' }), c({ COD: '02', OPE: '9' })])
    )
    expect(r.scarti.map(s => s.codice)).toEqual(['COD_DUPLICATO', 'COD_VUOTO', 'OPER_SCONOSCIUTO'])
    expect(r.record).toHaveLength(1)
    expect(r.record[0]).toMatchObject({ cod: '01', oper: { codice: '20' }, posiz: '', avanz: '' })
  })

  it('registri: COD vuoto, duplicato, PRT non valido (avviso)', async () => {
    const c = (o: Valori = {}): Valori => ({
      COD: '0001',
      DES: 'x',
      PRT: '000007',
      ULT: '04-02',
      MDL: 'm',
      ASS: '1',
      ...o,
    })
    const r = await parsaRegistriRifiuti(
      sorgenteInMemoria('REGISTRI RIFIUTI', [
        c(),
        c(),
        c({ COD: '' }),
        c({ COD: '0002', PRT: 'abc', ASS: '0' }),
      ])
    )
    expect(r.scarti.map(s => s.codice)).toEqual(['COD_DUPLICATO', 'COD_VUOTO'])
    expect(r.avvisi.map(s => s.codice)).toEqual(['PRT_NON_VALIDO'])
    expect(r.record.map(x => [x.ultimoProtocollo, x.assegnaProtocollo])).toEqual([
      [7, true],
      [null, false],
    ])
  })

  it('VERSIS: COD vuoto e duplicato; prefisso assente se il COD non inizia per lettere', async () => {
    const v = (cod: string): Valori => ({ COD: cod, C3: 'SEGRETO' })
    const r = await parsaVersis(
      sorgenteInMemoria('VERSIS', [v('FIRMARENTRI'), v('FIRMARENTRI'), v(''), v('123')])
    )
    expect(r.scarti.map(s => s.codice)).toEqual(['COD_DUPLICATO', 'COD_VUOTO'])
    expect(r.record.map(x => [x.prefisso, x.sensibile])).toEqual([
      ['FIRMARENTRI', true],
      ['', false],
    ])
    expect(JSON.stringify(r)).not.toContain('SEGRETO')
  })

  it('VERSIS: FIRMARENTRI<CF> e prefissi hub sono sensibili e il prefisso e un insieme chiuso (nessun frammento di CF)', async () => {
    const v = (cod: string): Valori => ({ COD: cod })
    const r = await parsaVersis(
      sorgenteInMemoria('VERSIS', [
        v('FIRMARENTRIRSSMRA80A01H501U'),
        v('HUBRP:X90000'),
        v('HUBRD:X90000'),
        v('HUBWWX90000'),
        v('XRENATS:1'),
        v('XRENOPW:1'),
        v('PREFISSOINVENTATO:1'),
        v('abcdef'),
      ])
    )
    expect(r.record.map(x => [x.prefisso, x.sensibile])).toEqual([
      ['FIRMARENTRI', true],
      ['HUBRP', true],
      ['HUBRD', true],
      ['HUBWW', true],
      ['XRENATS', false],
      ['XRENOPW', false],
      ['(altro)', true],
      ['(altro)', true],
    ])
    expect(JSON.stringify(r)).not.toContain('RSSMRA')
  })

  it('RENregistrazioni: CODMOVIMENTO non valido e chiave duplicata', async () => {
    const rr = (o: Valori = {}): Valori => ({
      CODMOVIMENTO: '3',
      ANNOMOVIMENTO: '2026',
      REGISTRO: '0002',
      PROTOCOLLO: '000003',
      XSEINVIATO: 'X',
      IDRENTRI: 'id',
      ...o,
    })
    const r = await parsaRenRegistrazioni(
      sorgenteInMemoria('RENregistrazioni', [rr(), rr(), rr({ CODMOVIMENTO: 'x' })])
    )
    expect(r.scarti.map(s => s.codice)).toEqual(['CHIAVE_DUPLICATA', 'CODMOVIMENTO_NON_VALIDO'])
    expect(r.record).toHaveLength(1)
  })
})
