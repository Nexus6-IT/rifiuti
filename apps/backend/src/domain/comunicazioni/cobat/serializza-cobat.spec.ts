import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codificaCp1252 } from '../fisso/codifica-cp1252'
import type { BloccoSedeLegaleCobat, BloccoUnitaLocaleCobat, RecordCobat } from './record-cobat'
import {
  LAYOUT_COBAT,
  TracciatoCobat,
  serializzaRecordCobat,
  validaRecordCobat,
} from './serializza-cobat'

const golden = readFileSync(join(__dirname, '__fixtures__', 'cobat-sintetico.txt'))
const campi: Array<{ campo: string; offset: number; lunghezza: number }> = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'cobat-campi.json'), 'utf8')
)

const sl = (o: Partial<BloccoSedeLegaleCobat>): BloccoSedeLegaleCobat => ({
  descrizione: '',
  codreg: 'D',
  via: '',
  cap: '',
  codcom: '',
  localita: '',
  telefono: '',
  fax: '',
  codiceFiscale: '',
  civico: '',
  legaleRappresentanteCognome: '',
  legaleRappresentanteNome: '',
  comune: 'N',
  partitaIva: '',
  ...o,
})
const ul = (o: Partial<BloccoUnitaLocaleCobat>): BloccoUnitaLocaleCobat => ({
  codreg: 'D',
  via: '',
  cap: '',
  codcom: '',
  localita: '',
  telefono: '',
  fax: '',
  codiceAttivita: '',
  civico: '',
  ...o,
})

const noiSl = sl({
  descrizione: 'RICICLO BATTERIE SRL',
  via: 'VIA DELLE OFFICINE',
  cap: '24100',
  codcom: '016024',
  localita: 'BERGAMO',
  telefono: '035123456',
  codiceFiscale: '01234567890',
  civico: '5',
  legaleRappresentanteCognome: 'BIANCHI',
  legaleRappresentanteNome: 'MARIO',
  partitaIva: '01234567890',
})
const noiUl = ul({
  via: 'VIA DELLE OFFICINE',
  cap: '24100',
  codcom: '016024',
  localita: 'BERGAMO',
  codiceAttivita: '383200',
  civico: '5',
})

const base: RecordCobat = {
  riferimento: '12/2026',
  dataRegistrazione: '2026-04-02',
  progressivo: '000012',
  codazi: '09876543210',
  tipoMovimento: 6,
  targa: 'AB123CD',
  rimorchio: '',
  bolla: 'ABC123/26',
  dataFormulario: '2026-04-01',
  causa: 5,
  autista: '',
  dataConferimento: '2026-04-02',
  cer: '160601',
  pgf: 'A',
  quam3: 0,
  quaton: 1.25,
  produttore: {
    sedeLegale: sl({
      descrizione: 'AUTORICAMBI VERDI SNC',
      via: 'VIA MILANO',
      cap: '20100',
      codcom: '015146',
      localita: 'MILANO',
      telefono: '02111222',
      codiceFiscale: '05555555555',
      civico: '10',
      legaleRappresentanteCognome: 'VERDI',
      legaleRappresentanteNome: 'LUCA',
      partitaIva: '05555555555',
    }),
    unitaLocale: ul({
      via: 'VIA MILANO',
      cap: '20100',
      codcom: '015146',
      localita: 'MILANO',
      codiceAttivita: '452010',
      civico: '10',
    }),
  },
  trasportatore: {
    sedeLegale: sl({
      descrizione: 'Trasporti Rapidi di Città',
      via: 'VIA TORINO',
      cap: '25121',
      codcom: '017029',
      localita: 'BRESCIA',
      telefono: '030987654',
      codiceFiscale: '09876543210',
      civico: '7',
      legaleRappresentanteCognome: 'NERI',
      legaleRappresentanteNome: 'ANNA',
      partitaIva: '09876543210',
    }),
  },
  smaltitore: { sedeLegale: noiSl, unitaLocale: noiUl },
  intermediario: null,
  campagnaCodice: '00',
  campagnaDescrizione: '',
}
const secondo: RecordCobat = {
  ...base,
  riferimento: '13/2026',
  dataRegistrazione: '2026-04-15',
  progressivo: '000013',
  codazi: '11122233344',
  tipoMovimento: 4,
  targa: 'XY987ZT',
  bolla: 'ABC124/26',
  dataFormulario: '2026-04-15',
  causa: 3,
  dataConferimento: '2026-04-16',
  pgf: 'B',
  quaton: 3,
  produttore: { sedeLegale: noiSl, unitaLocale: noiUl },
  trasportatore: null,
  smaltitore: {
    sedeLegale: sl({
      descrizione: 'COBAT RECUPERI SPA',
      codreg: 'I',
      via: 'VIA EMILIA',
      cap: '40100',
      codcom: '037006',
      localita: 'BOLOGNA',
      telefono: '051333444',
      codiceFiscale: '11122233344',
      civico: '100',
      legaleRappresentanteCognome: 'ROSSI',
      legaleRappresentanteNome: 'PAOLO',
      partitaIva: '11122233344',
    }),
    unitaLocale: ul({
      codreg: 'I',
      via: 'VIA EMILIA',
      cap: '40100',
      codcom: '037006',
      localita: 'BOLOGNA',
      codiceAttivita: '383200',
      civico: '100',
    }),
  },
  campagnaCodice: '01',
  campagnaDescrizione: 'CAMPAGNA SPERIMENTALE',
}

describe('TracciatoCobat: golden sintetico (D15)', () => {
  it('1. il serializzatore produce il golden byte per byte dopo la codifica', () => {
    const file = TracciatoCobat.serializza({ record: [base, secondo] })
    expect(codificaCp1252(file).equals(golden)).toBe(true)
  })

  it('2. tagliando il golden con gli offset del JSON si ottengono i valori attesi', () => {
    expect(golden.length).toBe(2 * 1628)
    const rec1 = golden.subarray(0, 1409).toString('latin1')
    const rec2 = golden.subarray(1628, 1628 + 1409).toString('latin1')
    const campo = (rec: string, nome: string) => {
      const c = campi.find(x => x.campo === nome)!
      return rec.slice(c.offset - 1, c.offset - 1 + c.lunghezza).trim()
    }
    expect(campo(rec1, 'dtreg')).toBe('20260402')
    expect(campo(rec1, 'progdta')).toBe('000012')
    expect(campo(rec1, 'codazi')).toBe('09876543210')
    expect(campo(rec1, 'tipmov')).toBe('6')
    expect(campo(rec1, 'causa')).toBe('5')
    expect(campo(rec1, 'quaton')).toBe('1.2500000')
    expect(campo(rec1, 'pdescr')).toBe('AUTORICAMBI VERDI SNC')
    expect(campo(rec1, 'xcodatt')).toBe('452010')
    // Difetto di WinWaste corretto: cognome e nome, non descrizione e ISTAT dell'unita' locale.
    expect(campo(rec1, 'tlegrap')).toBe('NERI')
    expect(campo(rec1, 'tnolegrap')).toBe('ANNA')
    expect(campo(rec1, 'tdescr')).toBe('Trasporti Rapidi di Città')
    expect(campo(rec1, 'sdescr')).toBe('RICICLO BATTERIE SRL')
    expect(campo(rec2, 'tipmov')).toBe('4')
    expect(campo(rec2, 'tdescr')).toBe('')
    expect(campo(rec2, 'cdescr')).toBe('')
    expect(campo(rec2, 'sdescr')).toBe('COBAT RECUPERI SPA')
    // Coda: 185 spazi, campagna 2 + descrizione 30, CRLF.
    const coda = golden.subarray(1628 + 1409, 2 * 1628).toString('latin1')
    expect(coda).toBe(`${' '.repeat(185)}01${'CAMPAGNA SPERIMENTALE'.padEnd(30)}\r\n`)
    expect(golden.includes(0xe0)).toBe(true)
  })

  it('3. la tabella di layout coincide con il JSON copiato dal documento WinWaste', () => {
    expect(
      LAYOUT_COBAT.map(c => ({ campo: c.nome, offset: c.offset + 1, lunghezza: c.lunghezza }))
    ).toEqual(campi)
  })
})

describe('TracciatoCobat: forma del file', () => {
  it('descrive il tracciato (D7)', () => {
    expect(TracciatoCobat).toMatchObject({
      consorzio: 'COBAT',
      versione: 'Movcob-ww1',
      estensione: 'txt',
      codifica: 'windows-1252',
      affidabilita: 'RICAVATO_WINWASTE',
    })
  })
  it('i blocchi iniziano agli offset del documento (p 179, x 415, t 584, s 820, y 1056, c 1225)', () => {
    const inizio = (n: string) => LAYOUT_COBAT.find(c => c.nome === n)!.offset + 1
    expect([inizio('pdescr'), inizio('xcodreg'), inizio('tdescr'), inizio('sdescr')]).toEqual([
      179, 415, 584, 820,
    ])
    expect([inizio('ycodreg'), inizio('cdescr')]).toEqual([1056, 1225])
  })
  it('record di 1628 byte esatti dopo la codifica, nessun separatore fra record', () => {
    const file = TracciatoCobat.serializza({ record: [base, secondo, base] })
    const byte = codificaCp1252(file)
    expect(byte.length).toBe(3 * 1628)
    expect(byte.subarray(1409, 1628).toString('latin1').endsWith('\r\n')).toBe(true)
    expect(byte.subarray(1628, 1636).toString('latin1')).toBe('20260415')
  })
  it('un testo troppo lungo si tronca alla lunghezza del campo', () => {
    const lungo = {
      ...base,
      smaltitore: { ...base.smaltitore!, sedeLegale: { ...noiSl, descrizione: 'Y'.repeat(100) } },
    }
    const file = TracciatoCobat.serializza({ record: [lungo] })
    expect(file.slice(0, 1409)).toHaveLength(1409)
    expect(file.slice(819, 879)).toBe('Y'.repeat(60))
  })
  it('anni <= 2009 rifiutati con errore', () => {
    const e = TracciatoCobat.validaDati({ record: [{ ...base, dataRegistrazione: '2009-12-31' }] })
    expect(e.join('|')).toContain('2010')
    expect(() =>
      TracciatoCobat.serializza({ record: [{ ...base, dataRegistrazione: '2009-12-31' }] })
    ).toThrow()
  })
})

describe('difetto di WinWaste corretto', () => {
  it('il trasportatore porta cognome e nome, non descrizione e ISTAT (WinWaste ComuCou:2388)', () => {
    const rec = serializzaRecordCobat(base)
    const t = LAYOUT_COBAT.find(c => c.nome === 'tlegrap')!
    const n = LAYOUT_COBAT.find(c => c.nome === 'tnolegrap')!
    expect(rec.slice(t.offset, t.offset + t.lunghezza).trim()).toBe('NERI')
    expect(rec.slice(n.offset, n.offset + n.lunghezza).trim()).toBe('ANNA')
    expect(rec.slice(t.offset, n.offset + n.lunghezza)).not.toContain('017029')
  })
})

describe('validaDati', () => {
  const errori = (patch: Partial<RecordCobat>) => validaRecordCobat({ ...base, ...patch })
  it('un record corretto non ha errori', () => expect(errori({})).toEqual([]))
  it('la causa mancante non blocca (spazio con avviso nel preparatore)', () => {
    expect(errori({ causa: null })).toEqual([])
  })
  it.each([
    [{ codazi: '' }, 'codazi'],
    [{ tipoMovimento: null }, 'Tipo di movimento'],
    [{ tipoMovimento: 9 }, 'Tipo di movimento'],
    [{ cer: '1606' }, 'CER errato'],
    [{ pgf: 'Z' }, 'PGF errato'],
    [{ progressivo: '12' }, 'Progressivo'],
    [{ dataFormulario: '01/04/2026' }, 'formulario'],
    [{ campagnaCodice: '' }, 'campagna'],
  ] as Array<[Partial<RecordCobat>, string]>)('%j -> %s', (patch, atteso) => {
    expect(errori(patch).join('|')).toContain(atteso)
  })
  it('senza regione di un blocco valorizzato si ferma (come WinWaste)', () => {
    const senza = {
      ...base,
      produttore: {
        ...base.produttore!,
        sedeLegale: { ...base.produttore!.sedeLegale, codreg: '' },
      },
    }
    expect(validaRecordCobat(senza).join('|')).toContain('Regione di produttore')
  })
  it('un blocco assente non richiede la regione', () => {
    expect(errori({ trasportatore: null, intermediario: null })).toEqual([])
  })
  it('un carattere fuori da Windows-1252 blocca, con il campo (D6)', () => {
    const r = errori({ autista: 'Mario 北' })
    expect(r.join('|')).toContain('autista')
    expect(r.join('|')).toContain('non rappresentabile')
  })
  it('nessun record: errore; gli errori portano record e movimento', () => {
    expect(TracciatoCobat.validaDati({ record: [] })).toHaveLength(1)
    const e = TracciatoCobat.validaDati({
      record: [base, { ...base, riferimento: '9/2026', cer: '' }],
    })
    expect(e[0]).toMatch(/^Record 2 \(9\/2026\)/)
  })
})
