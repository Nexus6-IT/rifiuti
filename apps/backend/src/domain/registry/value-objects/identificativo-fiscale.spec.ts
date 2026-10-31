import { IdentificativoFiscale, partitaIvaDaVerificare } from './identificativo-fiscale'
import { DatiControparteNonValidiError } from '../../../core/domain/errors'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_OMOCODICO,
  CF_PERSONA_VALIDO,
  PIVA_CHECKSUM_ERRATO,
  PIVA_VALIDA,
} from '../../../test-support/anagrafiche-di-test'

function messaggio(fn: () => unknown): string {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(DatiControparteNonValidiError)
    return (e as Error).message
  }
  throw new Error('non ha lanciato')
}

describe('IdentificativoFiscale', () => {
  describe('partita IVA', () => {
    it('accetta una P.IVA valida', () => {
      const i = IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA })
      expect(i.partitaIva).toBe(PIVA_VALIDA)
      expect(i.codiceFiscale).toBeNull()
      expect(i.privato).toBe(false)
    })

    it('toglie il prefisso IT, gli spazi e normalizza il maiuscolo', () => {
      const scritta = ` it ${PIVA_VALIDA.slice(0, 5)} ${PIVA_VALIDA.slice(5)} `
      expect(IdentificativoFiscale.crea({ partitaIva: scritta }).partitaIva).toBe(PIVA_VALIDA)
    })

    it('rifiuta il checksum errato', () => {
      expect(() => IdentificativoFiscale.crea({ partitaIva: PIVA_CHECKSUM_ERRATO })).toThrow(
        DatiControparteNonValidiError
      )
    })

    it('rifiuta 10 cifre e valori non numerici', () => {
      expect(() => IdentificativoFiscale.crea({ partitaIva: '1234567890' })).toThrow(
        DatiControparteNonValidiError
      )
      expect(() => IdentificativoFiscale.crea({ partitaIva: '1234567890A' })).toThrow(
        DatiControparteNonValidiError
      )
    })
  })

  describe('codice fiscale', () => {
    it('accetta un CF di persona e lo dichiara privato', () => {
      const i = IdentificativoFiscale.crea({ codiceFiscale: CF_PERSONA_VALIDO })
      expect(i.codiceFiscale).toBe(CF_PERSONA_VALIDO)
      expect(i.partitaIva).toBeNull()
      expect(i.privato).toBe(true)
    })

    it('accetta un CF omocodico', () => {
      expect(IdentificativoFiscale.crea({ codiceFiscale: CF_PERSONA_OMOCODICO }).privato).toBe(true)
    })

    it('rifiuta un CF col carattere di controllo errato', () => {
      const errato = CF_PERSONA_VALIDO.slice(0, 15) + 'A'
      expect(() => IdentificativoFiscale.crea({ codiceFiscale: errato })).toThrow(
        DatiControparteNonValidiError
      )
    })

    it('normalizza minuscolo e spazi', () => {
      const i = IdentificativoFiscale.crea({ codiceFiscale: ' rss mra 80a01 h501u ' })
      expect(i.codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })

    it('con 17 caratteri risponde con un errore di lunghezza', () => {
      const m = messaggio(() =>
        IdentificativoFiscale.crea({ codiceFiscale: CF_PERSONA_VALIDO + 'X' })
      )
      expect(m).toContain('al massimo 16 caratteri')
    })

    it('un CF di 11 cifre valido non e privato; errato rifiutato', () => {
      const i = IdentificativoFiscale.crea({ codiceFiscale: PIVA_VALIDA })
      expect(i.codiceFiscale).toBe(PIVA_VALIDA)
      expect(i.privato).toBe(false)
      expect(() => IdentificativoFiscale.crea({ codiceFiscale: PIVA_CHECKSUM_ERRATO })).toThrow(
        DatiControparteNonValidiError
      )
    })
  })

  describe('insieme dei due', () => {
    it('con CF uguale alla P.IVA conserva solo la P.IVA', () => {
      const i = IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA, codiceFiscale: PIVA_VALIDA })
      expect(i.partitaIva).toBe(PIVA_VALIDA)
      expect(i.codiceFiscale).toBeNull()
      expect(i.valori()).toEqual([PIVA_VALIDA])
    })

    it('P.IVA con CF di persona: non e privato, valori ordinati', () => {
      const i = IdentificativoFiscale.crea({
        partitaIva: PIVA_VALIDA,
        codiceFiscale: CF_PERSONA_VALIDO,
      })
      expect(i.privato).toBe(false)
      expect(i.valori()).toEqual([PIVA_VALIDA, CF_PERSONA_VALIDO].sort())
    })

    it('l identificativo RENTRI e il CF se c e, altrimenti la P.IVA', () => {
      expect(
        IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO })
          .identificativoRentri
      ).toBe(CF_PERSONA_VALIDO)
      expect(IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA }).identificativoRentri).toBe(
        PIVA_VALIDA
      )
    })

    it('senza nessuno dei due e un errore; stringhe vuote contano come assenti', () => {
      expect(() => IdentificativoFiscale.crea({})).toThrow(DatiControparteNonValidiError)
      expect(() => IdentificativoFiscale.crea({ partitaIva: '  ', codiceFiscale: '' })).toThrow(
        DatiControparteNonValidiError
      )
      expect(
        IdentificativoFiscale.crea({ partitaIva: '', codiceFiscale: CF_PERSONA_ALTRO }).privato
      ).toBe(true)
    })
  })

  describe('nessun messaggio contiene il valore', () => {
    const valoriSbagliati: Array<{ partitaIva?: string; codiceFiscale?: string }> = [
      { partitaIva: PIVA_CHECKSUM_ERRATO },
      { partitaIva: '1234567890' },
      { codiceFiscale: CF_PERSONA_VALIDO.slice(0, 15) + 'A' },
      { codiceFiscale: CF_PERSONA_VALIDO + 'X' },
      { codiceFiscale: PIVA_CHECKSUM_ERRATO },
    ]
    it.each(valoriSbagliati)('%j', input => {
      const m = messaggio(() => IdentificativoFiscale.crea(input))
      for (const v of Object.values(input)) {
        expect(m).not.toContain(v as string)
        expect(m.replace(/\s/g, '')).not.toContain((v as string).slice(0, 8))
      }
    })
  })

  describe('partitaIvaDaVerificare', () => {
    it('vero solo per una P.IVA presente col checksum errato', () => {
      expect(partitaIvaDaVerificare(PIVA_CHECKSUM_ERRATO)).toBe(true)
      expect(partitaIvaDaVerificare(PIVA_VALIDA)).toBe(false)
      expect(partitaIvaDaVerificare(null)).toBe(false)
      expect(partitaIvaDaVerificare(undefined)).toBe(false)
    })
  })
})
