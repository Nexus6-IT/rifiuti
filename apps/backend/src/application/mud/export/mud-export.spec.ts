import { toMudAscii, mudRecord, mudKg } from './mud-format.util'
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

  it('mudKg arrotonda a intero', () => {
    expect(mudKg(120.7)).toBe('121')
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
      { cerCode: '150101', quantitaKg: 100 },
      { cerCode: '170504', quantitaKg: 50 },
    ],
  }

  it('produce un file con XX primo + costante release, poi AA/AB/BA', () => {
    const out = new MudTracciatoV604_2024().generate(data)
    const lines = out.trim().split('\r\n')

    expect(lines[0].startsWith('XX;')).toBe(true)
    expect(lines[0]).toContain('6.04/24')
    expect(lines.some((l) => l.startsWith('AA;'))).toBe(true)
    expect(lines.some((l) => l.startsWith('AB;'))).toBe(true)
    // una riga BA per ogni rifiuto
    expect(lines.filter((l) => l.startsWith('BA;'))).toHaveLength(2)
    // separatore ; e terminatore
    expect(lines.every((l) => l.endsWith(';'))).toBe(true)
    // CER e quantità presenti
    expect(out).toContain('150101')
    expect(out).toContain('100')
  })
})
