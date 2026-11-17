import {
  ANNO_MINIMO_COBAT,
  CODIFICA_COBAT,
  FINE_RIGA_COBAT,
  LUNGHEZZA_RECORD_COMPLETO_COBAT,
  NOME_FILE_COBAT,
  PROGRESSIVO_COBAT_MASSIMO,
  SPAZI_CODA_COBAT_DOPO_2009,
} from './costanti'

/** Ogni inferenza ha un nome e un test che la nomina: da ri-verificare con un file reale. */
describe('inferenze COBAT isolate', () => {
  it('CODIFICA_COBAT = windows-1252', () => expect(CODIFICA_COBAT).toBe('windows-1252'))
  it('FINE_RIGA_COBAT = CRLF', () => expect(FINE_RIGA_COBAT).toBe('\r\n'))
  it('NOME_FILE_COBAT = Movcob.txt', () => expect(NOME_FILE_COBAT).toBe('Movcob.txt'))
  it('CODA_COBAT_DOPO_2009 = 185 spazi + 32 + CRLF (record 1409 + 219)', () => {
    expect(SPAZI_CODA_COBAT_DOPO_2009).toBe(185)
    expect(ANNO_MINIMO_COBAT).toBe(2010)
    expect(LUNGHEZZA_RECORD_COMPLETO_COBAT).toBe(1628)
  })
  it('PROGRESSIVO_COBAT_MASSIMO = 999999', () => expect(PROGRESSIVO_COBAT_MASSIMO).toBe(999999))
})
