import {
  codiceRegione,
  istatNoveConou,
  letteraRegione,
  REGIONE_LETTERA,
  REGIONI,
} from './regioni-istat'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('regioni-istat', () => {
  it('REGIONE_LETTERA coincide con la mappa di WinWaste (A01 B02 C07 ... Z20)', () => {
    const attesa = 'A01 B02 C07 D03 E04 F05 G06 I08 L11 M09 N10 O12 P15 Q13 R14 S16 T17 U18 V19 Z20'
    const mappa = Object.entries(REGIONE_LETTERA)
      .map(([cod, lett]) => `${lett}${cod}`)
      .sort()
    expect(mappa).toEqual(attesa.split(' ').sort())
  })

  it('20 regioni, codici 01..20 distinti', () => {
    expect(REGIONI).toHaveLength(20)
    expect(new Set(REGIONI.map(r => r.codice)).size).toBe(20)
  })

  it('i nomi coincidono con quelli di prisma/reference-data/province.csv', () => {
    const csv = readFileSync(join(__dirname, '../../../prisma/reference-data/province.csv'), 'utf8')
    const nomi = new Set(
      csv
        .split(/\r?\n/)
        .slice(1)
        .filter(Boolean)
        .map(r => r.split(';')[3])
    )
    expect([...nomi].sort()).toEqual(REGIONI.map(r => r.nome).sort())
  })

  it('nome → codice e lettera (anche con apostrofo tipografico e maiuscole)', () => {
    expect(codiceRegione('Campania')).toBe('15')
    expect(letteraRegione('Campania')).toBe('P')
    expect(letteraRegione('VALLE D’AOSTA/VALLÉE D’AOSTE')).toBe('B')
    expect(codiceRegione('Atlantide')).toBeNull()
    expect(letteraRegione('Atlantide')).toBeNull()
  })

  it('istatNoveConou = 0 + regione + comune', () => {
    expect(istatNoveConou('Campania', '063049')).toBe('015063049')
    expect(istatNoveConou('Lombardia', '015146')).toBe('003015146')
  })

  it('istatNoveConou lancia su regione sconosciuta o comune non a 6 cifre', () => {
    expect(() => istatNoveConou('Atlantide', '063049')).toThrow(/Regione sconosciuta/)
    expect(() => istatNoveConou('Campania', '6304')).toThrow(/non valido/)
  })
})
