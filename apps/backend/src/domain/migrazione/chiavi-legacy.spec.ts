import {
  CHIAVE_LEGACY_PATTERN,
  LUNGHEZZA_MASSIMA_CHIAVE_LEGACY,
  chiaveAutomezzo,
  chiaveDitta,
  chiaveGiacenza,
  chiaveMovimento,
  chiaveRecordAnnuale,
  chiaveSede,
  chiaveSedeDaSoggettoUnita,
  chiaveSoggetto,
  precDellaRiga,
} from './chiavi-legacy'
import { ChiaveLegacyError } from './errori'

// Forma delle chiavi: rapporto 04 §4.4 (`ditta|anno|TABELLA|COD`) e docs/schema-db-winwaste.md §2
// (MOVIMENTI e FORMULARI: `COD int identity`; CLIFOR: PRECOD varchar(1) C/F + COD varchar(6);
// UNITA LOCALI: PRECOD varchar(7) = soggetto, COD varchar(4) = unita', senza PK).

const regex = new RegExp(CHIAVE_LEGACY_PATTERN)

describe('chiaveMovimento / chiaveRecordAnnuale', () => {
  it('compone ditta|anno|TABELLA|COD', () => {
    expect(chiaveMovimento('0001', 2026, 'MOVIMENTI', 12345)).toBe('0001|2026|MOVIMENTI|12345')
    expect(chiaveRecordAnnuale('0001', 2026, 'FORMULARI', 7)).toBe('0001|2026|FORMULARI|7')
  })

  it.each([
    ['ditta di 3 cifre', '001', 2026, 'MOVIMENTI', 1],
    ['ditta di 5 cifre', '00001', 2026, 'MOVIMENTI', 1],
    ['ditta con lettere', '00A1', 2026, 'MOVIMENTI', 1],
    ['ditta con pipe', '00|1', 2026, 'MOVIMENTI', 1],
    ['anno prima del 1990', '0001', 1989, 'MOVIMENTI', 1],
    ['anno dopo il 2100', '0001', 2101, 'MOVIMENTI', 1],
    ['anno non intero', '0001', 2026.5, 'MOVIMENTI', 1],
    ['COD zero', '0001', 2026, 'MOVIMENTI', 0],
    ['COD negativo', '0001', 2026, 'MOVIMENTI', -3],
    ['COD non intero', '0001', 2026, 'MOVIMENTI', 1.5],
    ['COD oltre i limiti di int', '0001', 2026, 'MOVIMENTI', 2147483648],
    ['tabella fuori elenco', '0001', 2026, 'RITIRI', 1],
  ])('rifiuta: %s', (_nome, ditta, anno, tabella, cod) => {
    expect(() =>
      chiaveRecordAnnuale(ditta, anno as number, tabella as never, cod as number)
    ).toThrow(ChiaveLegacyError)
  })

  it("il codice dell'errore e' stabile", () => {
    let errore: unknown
    try {
      chiaveMovimento('1', 2026, 'MOVIMENTI', 1)
    } catch (e) {
      errore = e
    }
    expect(errore).toBeInstanceOf(ChiaveLegacyError)
    expect((errore as ChiaveLegacyError).codice).toBe('DITTA_NON_VALIDA')
  })

  it("la lunghezza e' sempre entro il limite", () => {
    const k = chiaveMovimento('9999', 2100, 'FORMULARI', 2147483647)
    expect(k.length).toBeLessThanOrEqual(LUNGHEZZA_MASSIMA_CHIAVE_LEGACY)
  })
})

describe('chiavi delle anagrafiche (forma confermata sullo schema reale)', () => {
  it('ditta: per partita IVA o codice fiscale', () => {
    expect(chiaveDitta('0001', '00012345678')).toBe('0001|FISC|00012345678')
    expect(chiaveDitta('0001', 'rssmra80a01h501u')).toBe('0001|FISC|RSSMRA80A01H501U')
  })

  it('ditta: codice fiscale/IVA vuoto o con pipe o spazi interni -> errore', () => {
    expect(() => chiaveDitta('0001', '')).toThrow(ChiaveLegacyError)
    expect(() => chiaveDitta('0001', '   ')).toThrow(ChiaveLegacyError)
    expect(() => chiaveDitta('0001', '123|456')).toThrow(ChiaveLegacyError)
    expect(() => chiaveDitta('0001', '123 456')).toThrow(ChiaveLegacyError)
  })

  it('soggetto: PRECOD C/F (1 carattere) + COD (max 6)', () => {
    expect(chiaveSoggetto('0001', 'C', '000123')).toBe('0001|C|000123')
    expect(chiaveSoggetto('0001', 'F', '42')).toBe('0001|F|42')
    expect(() => chiaveSoggetto('0001', 'X', '000123')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'CF', '000123')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'C', '')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'C', '1234567')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'C', '12|3')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'C', ' 123')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSoggetto('0001', 'C', '12\n3')).toThrow(ChiaveLegacyError)
  })

  it("sede/unita' locale: soggetto + COD unita' (max 4)", () => {
    expect(chiaveSede('0001', 'C', '000123', '0001')).toBe('0001|C|000123|0001')
    expect(() => chiaveSede('0001', 'C', '000123', '')).toThrow(ChiaveLegacyError)
    expect(() => chiaveSede('0001', 'C', '000123', '12345')).toThrow(ChiaveLegacyError)
  })
})

describe('CHIAVE_LEGACY_PATTERN', () => {
  it('accetta tutte le chiavi prodotte', () => {
    const chiavi = [
      chiaveMovimento('0001', 2026, 'MOVIMENTI', 12345),
      chiaveRecordAnnuale('0002', 1990, 'FORMULARI', 1),
      chiaveDitta('0001', '00012345678'),
      chiaveSoggetto('0001', 'F', '000001'),
      chiaveSede('0001', 'C', '000123', '0002'),
    ]
    for (const k of chiavi) expect(regex.test(k)).toBe(true)
  })

  it.each([
    [''],
    ['0001'],
    ['0001|'],
    ['0001|2026'],
    ['001|2026|MOVIMENTI|1'],
    ['00001|2026|MOVIMENTI|1'],
    ['0001||2026|MOVIMENTI|1'],
    ['0001|2026|MOVIMENTI|'],
    ['0001|2026|MOVIMENTI|1|'],
    ['abcd|2026|MOVIMENTI|1'],
  ])('rifiuta %j', k => {
    expect(regex.test(k)).toBe(false)
  })
})

describe('chiaveAutomezzo', () => {
  it('ditta|MEZ|soggetto.unita|COD, accettata dal pattern', () => {
    const k = chiaveAutomezzo('0001', '000123.0002', '0007')
    expect(k).toBe('0001|MEZ|000123.0002|0007')
    expect(new RegExp(CHIAVE_LEGACY_PATTERN).test(k)).toBe(true)
  })
  it('rifiuta componenti vuoti, con barra verticale o troppo lunghi', () => {
    expect(() => chiaveAutomezzo('0001', '', '0007')).toThrow(ChiaveLegacyError)
    expect(() => chiaveAutomezzo('0001', '1|2', '0007')).toThrow(ChiaveLegacyError)
    expect(() => chiaveAutomezzo('0001', '000123.0002', '00007')).toThrow(ChiaveLegacyError)
    expect(() => chiaveAutomezzo('1', 'a', 'b')).toThrow(ChiaveLegacyError)
  })
})

describe('precDellaRiga / chiaveSedeDaSoggettoUnita (regola della chiave sede delle UL)', () => {
  it('il PRECOD a 7 caratteri vince su tutto', () => {
    expect(precDellaRiga('F', new Set(['C', 'F']), 'C')).toBe('F')
  })

  it("senza C/F nel PRECOD: l'unico PRECOD con quel COD", () => {
    expect(precDellaRiga(undefined, new Set(['F']), 'C')).toBe('F')
  })

  it('C e F con lo stesso COD (stessa ditta): la riga tenuta', () => {
    expect(precDellaRiga(undefined, new Set(['C', 'F']), 'C')).toBe('C')
    expect(precDellaRiga(undefined, undefined, 'F')).toBe('F')
  })

  it('compone la chiave come chiaveSede con il soggetto della RIGA, non quello tenuto', () => {
    expect(
      chiaveSedeDaSoggettoUnita('0001', { soggetto: '000005', precod: undefined }, '0001', {
        precPerCod: new Set(['F']),
        precTenuto: 'C',
      })
    ).toBe('0001|F|000005|0001')
    expect(
      chiaveSedeDaSoggettoUnita('0001', { soggetto: '000005', precod: 'C' }, '0002', {
        precPerCod: new Set(['C', 'F']),
        precTenuto: 'F',
      })
    ).toBe('0001|C|000005|0002')
  })

  it('componenti non validi: ChiaveLegacyError', () => {
    expect(() =>
      chiaveSedeDaSoggettoUnita('0001', { soggetto: '000005' }, '', {
        precPerCod: new Set(['C']),
        precTenuto: 'C',
      })
    ).toThrow(ChiaveLegacyError)
  })
})

describe('chiaveGiacenza', () => {
  const R = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  it('ditta|anno|GIACENZE|registro|cer|stato fisico, accettata dal pattern', () => {
    const k = chiaveGiacenza('0001', 2026, R, '150101', 'S')
    expect(k).toBe(`0001|2026|GIACENZE|${R}|150101|S`)
    expect(new RegExp(CHIAVE_LEGACY_PATTERN).test(k)).toBe(true)
    expect(k.length).toBeLessThanOrEqual(LUNGHEZZA_MASSIMA_CHIAVE_LEGACY)
  })
  it('stato fisico assente: un trattino', () => {
    expect(chiaveGiacenza('0001', 2026, R, '150101', null)).toBe(`0001|2026|GIACENZE|${R}|150101|-`)
  })
  it('rifiuta CER non di 6 cifre, registro non UUID, stato fisico con pipe o troppo lungo', () => {
    expect(() => chiaveGiacenza('0001', 2026, R, '1501', null)).toThrow(ChiaveLegacyError)
    expect(() => chiaveGiacenza('0001', 2026, 'x', '150101', null)).toThrow(ChiaveLegacyError)
    expect(() => chiaveGiacenza('0001', 2026, R, '150101', 'a|b')).toThrow(ChiaveLegacyError)
    expect(() => chiaveGiacenza('0001', 2026, R, '150101', 'x'.repeat(51))).toThrow(
      ChiaveLegacyError
    )
    expect(() => chiaveGiacenza('1', 2026, R, '150101', null)).toThrow(ChiaveLegacyError)
  })
})
