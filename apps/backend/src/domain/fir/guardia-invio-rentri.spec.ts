import { FirBloccatoAllInvioError, verificaFirNonBloccato } from './guardia-invio-rentri'

describe('verificaFirNonBloccato (Fase 3, D4)', () => {
  it('un FIR non bloccato passa', () => {
    expect(() =>
      verificaFirNonBloccato({ id: 'f1', bloccatoInvio: false, motivoBloccoInvio: null })
    ).not.toThrow()
  })

  it('un FIR bloccato lancia con il motivo', () => {
    const f = { id: 'f1', bloccatoInvio: true, motivoBloccoInvio: 'Importato da WinWaste' }
    expect(() => verificaFirNonBloccato(f)).toThrow(FirBloccatoAllInvioError)
    try {
      verificaFirNonBloccato(f)
    } catch (e) {
      expect((e as FirBloccatoAllInvioError).motivo).toBe('Importato da WinWaste')
      expect((e as Error).message).toContain('Importato da WinWaste')
    }
  })

  it("il messaggio per l'utente e' quello di D4, senza id", () => {
    expect(FirBloccatoAllInvioError.MESSAGGIO_UTENTE).toBe(
      "FIR importato: l'invio a RENTRI è bloccato fino alla riconciliazione"
    )
    expect(FirBloccatoAllInvioError.CODICE).toBe('FIR_BLOCCATO_ALL_INVIO')
  })
})
