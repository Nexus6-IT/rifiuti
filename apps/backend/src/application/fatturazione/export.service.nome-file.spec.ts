import { dataNomeFile, nomeFileCsv, nomeFileXmlZip, nomeFileZipAdattatore } from './export.service'

// Seguito m5 della 4.4b2: la data nel nome del file e` quella di Europe/Rome, non quella UTC.
describe('nome dei file di export: data di Europe/Rome', () => {
  it('a cavallo di mezzanotte in inverno (CET, UTC+1): le 23:30 UTC sono gia` il giorno dopo', () => {
    expect(dataNomeFile(new Date('2026-11-06T23:30:00Z'))).toBe('20261107')
    expect(dataNomeFile(new Date('2026-11-06T22:59:59Z'))).toBe('20261106')
  })

  it('a cavallo di mezzanotte in estate (CEST, UTC+2): le 22:30 UTC sono gia` il giorno dopo', () => {
    expect(dataNomeFile(new Date('2026-07-06T22:30:00Z'))).toBe('20260707')
    expect(dataNomeFile(new Date('2026-07-06T21:59:59Z'))).toBe('20260706')
  })

  it('a cavallo d`anno', () => {
    expect(dataNomeFile(new Date('2026-12-31T23:30:00Z'))).toBe('20270101')
  })

  it('i quattro nomi usano la stessa data', () => {
    const adesso = new Date('2026-11-06T23:30:00Z')
    expect(nomeFileCsv(false, adesso)).toBe('fatture-20261107.zip')
    expect(nomeFileCsv(true, adesso)).toBe('fatture-ANTEPRIMA-20261107.zip')
    expect(nomeFileXmlZip(adesso)).toBe('fatture-XML-20261107.zip')
    expect(nomeFileZipAdattatore('FINTO', adesso)).toBe('export-FINTO-20261107.zip')
  })
})
