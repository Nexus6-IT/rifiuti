import {
  ATECO_PRIVATO_CONOU,
  CODIFICA_CONOU,
  FINE_RIGA_CONOU,
  NOME_FILE_CONOU,
  PERCENTUALE_OLIO_MASSIMA,
} from './costanti'

/** Ogni inferenza ha un nome e un test che la nomina: da ri-verificare con un file reale. */
describe('inferenze CONOU isolate', () => {
  it('CODIFICA_CONOU = windows-1252', () => expect(CODIFICA_CONOU).toBe('windows-1252'))
  it('FINE_RIGA_CONOU = CRLF', () => expect(FINE_RIGA_CONOU).toBe('\r\n'))
  it('NOME_FILE_CONOU = Movi.txt', () => expect(NOME_FILE_CONOU).toBe('Movi.txt'))
  it('PERCENTUALE_OLIO_MASSIMA = 9999', () => expect(PERCENTUALE_OLIO_MASSIMA).toBe(9999))
  it('ATECO_PRIVATO_CONOU = 0000', () => expect(ATECO_PRIVATO_CONOU).toBe('0000'))
})
