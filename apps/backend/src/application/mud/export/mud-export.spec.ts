import { toMudAscii, mudRecord, mudNum, mudQty, mudAlfa, mudCodiceFiscale } from './mud-format.util'
import { MudVersionRegistry } from './mud-version.registry'
import { MudTracciatoV604_2024 } from './versions/mud-tracciato-v604-2024'
import { MudExportData } from './mud-export.types'

describe('mud-format.util', () => {
  it('converte accenti in vocale+apice e in MAIUSCOLO', () => {
    expect(toMudAscii('Società Rifiuti àèìòù')).toBe("SOCIETA' RIFIUTI A'E'I'O'U'")
  })

  it('rimuove caratteri fuori ASCII', () => {
    expect(toMudAscii('test€™')).toBe('TEST')
  })

  it('mudRecord produce TIPO;campi;... con terminatore ;', () => {
    expect(mudRecord('AA', ['x', 'y'])).toBe('AA;X;Y;')
  })

  it('mudNum zero-padda a larghezza fissa', () => {
    expect(mudNum(1, 4)).toBe('0001')
    expect(mudNum(2024, 4)).toBe('2024')
  })

  it('mudQty formatta 7 interi + 3 decimali con virgola', () => {
    expect(mudQty(100)).toBe('0000100,000')
    expect(mudQty(100.5)).toBe('0000100,500')
    expect(mudQty(0)).toBe('0000000,000')
  })

  it('mudCodiceFiscale left-align P.IVA 11 a 16 con spazi', () => {
    expect(mudCodiceFiscale('12345678901')).toBe('12345678901     ')
    expect(mudAlfa('150101', 6)).toBe('150101')
  })
})

describe('MudVersionRegistry (versionamento per anno)', () => {
  const registry = new MudVersionRegistry()

  it('seleziona il tracciato per anno (2024 → 6.04/24)', () => {
    const v = registry.getForYear(2024)
    expect(v.version).toBe('6.04/24')
    expect(v.year).toBe(2024)
  })

  it('lancia per un anno non supportato', () => {
    expect(() => registry.getForYear(1999)).toThrow('nessun tracciato')
  })

  it('elenca anni e versioni supportate', () => {
    expect(registry.supportedYears()).toContain(2024)
    expect(registry.listVersions()).toEqual(
      expect.arrayContaining([{ year: 2024, version: '6.04/24' }]),
    )
  })
})

describe('MudTracciatoV604_2024.generate', () => {
  const data: MudExportData = {
    year: 2024,
    azienda: {
      ragioneSociale: 'Acme Spa',
      partitaIva: '12345678901',
      via: 'Via Roma 1',
      comune: 'Roma',
      provincia: 'RM',
      cap: '00100',
      pec: 'acme@pec.it',
    },
    rifiuti: [
      // metallo ferroso (rifiuto speciale): 100 kg, 80 a recupero, 20 a smaltimento
      { cerCode: '170405', prodottoKg: 100, recuperoKg: 80, smaltimentoKg: 20 },
      { cerCode: '191203', prodottoKg: 50, recuperoKg: 50, smaltimentoKg: 0 },
    ],
  }

  it('produce un file con XX primo + costante release, poi AA/AB/BA', () => {
    const out = new MudTracciatoV604_2024().generate(data)
    const lines = out.trim().split('\r\n')

    expect(lines[0].startsWith('XX;')).toBe(true)
    expect(lines[0]).toContain('6.04/24')
    expect(lines.some((l) => l.startsWith('AA;'))).toBe(true)
    expect(lines.some((l) => l.startsWith('AB;'))).toBe(true)
    expect(lines.filter((l) => l.startsWith('BA;'))).toHaveLength(2)
    expect(lines.every((l) => l.endsWith(';'))).toBe(true)
  })

  it('record BA (rifiuto speciale metallo) ha 35 campi e quantità formattate', () => {
    const out = new MudTracciatoV604_2024().generate(data)
    const ba = out.trim().split('\r\n').find((l) => l.startsWith('BA;'))!

    // "BA" + 34 campi, ognuno seguito da ; → 35 segmenti + stringa vuota finale
    const segments = ba.split(';')
    expect(segments[0]).toBe('BA')
    expect(segments).toHaveLength(36) // 35 campi + '' dopo l'ultimo ;

    // anno, CER metallo, quantità prodotta e avviata a recupero/smaltimento
    expect(ba).toContain(';2024;')
    expect(ba).toContain(';170405;')
    expect(ba).toContain('0000100,000') // prodotto
    expect(ba).toContain('0000080,000') // recupero
    expect(ba).toContain('0000020,000') // smaltimento
    // stato fisico default: solido NON polverulento → secondo flag = 1
    // (i 7 flag stanno dopo il CER)
    const idxCer = segments.indexOf('170405')
    const stati = segments.slice(idxCer + 1, idxCer + 8)
    expect(stati).toEqual(['0', '1', '0', '0', '0', '0', '0'])
  })
})
