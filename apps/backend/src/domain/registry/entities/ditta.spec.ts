import { Ditta } from './ditta'
import { IdentificativoFiscale } from '../value-objects/identificativo-fiscale'
import {
  DatiControparteNonValidiError,
  IdentificativoNonCorrispondenteError,
} from '../../../core/domain/errors'
import {
  CF_PERSONA_ALTRO,
  CF_PERSONA_VALIDO,
  PIVA_CHECKSUM_ERRATO,
  PIVA_VALIDA,
  partitaIvaValida,
} from '../../../test-support/anagrafiche-di-test'

const crea = (input: { partitaIva?: string; codiceFiscale?: string }) =>
  Ditta.crea({ ragioneSociale: 'Rossi S.r.l.', identificativo: IdentificativoFiscale.crea(input) })

/** Una ditta come esce dal database: la P.IVA puo' non passare il checksum. */
const dalDatabase = (partitaIva: string | null, codiceFiscale: string | null = null) =>
  Ditta.ripristina({
    id: 'd1',
    ragioneSociale: 'Verdi',
    partitaIva,
    codiceFiscale,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

describe('Ditta', () => {
  it('si crea con ragione sociale tagliata e identificativi', () => {
    const d = Ditta.crea({
      ragioneSociale: '  Rossi S.r.l. ',
      identificativo: IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA }),
    })
    expect(d.ragioneSociale).toBe('Rossi S.r.l.')
    expect(d.partitaIva).toBe(PIVA_VALIDA)
    expect(d.codiceFiscale).toBeNull()
    expect(d.privato).toBe(false)
    expect(d.partitaIvaDaVerificare).toBe(false)
  })

  it('rifiuta la ragione sociale vuota o troppo lunga', () => {
    const identificativo = IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA })
    expect(() => Ditta.crea({ ragioneSociale: '   ', identificativo })).toThrow(
      DatiControparteNonValidiError
    )
    expect(() => Ditta.crea({ ragioneSociale: 'x'.repeat(256), identificativo })).toThrow(
      DatiControparteNonValidiError
    )
  })

  it('un privato ha solo il CF di 16 caratteri', () => {
    expect(crea({ codiceFiscale: CF_PERSONA_VALIDO }).privato).toBe(true)
  })

  it('segnala la P.IVA migrata senza checksum, senza correggerla', () => {
    const d = dalDatabase(PIVA_CHECKSUM_ERRATO)
    expect(d.partitaIvaDaVerificare).toBe(true)
    expect(d.partitaIva).toBe(PIVA_CHECKSUM_ERRATO)
  })

  describe('aggiungiIdentificativi (D2.7)', () => {
    it('aggiunge il CF mancante', () => {
      const d = crea({ partitaIva: PIVA_VALIDA })
      const cambiata = d.aggiungiIdentificativi(
        IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO })
      )
      expect(cambiata).toBe(true)
      expect(d.codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })

    it('aggiunge la P.IVA mancante a un privato', () => {
      const d = crea({ codiceFiscale: CF_PERSONA_VALIDO })
      d.aggiungiIdentificativi(IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA }))
      expect(d.partitaIva).toBe(PIVA_VALIDA)
      expect(d.privato).toBe(false)
    })

    it('gli stessi identificativi non cambiano nulla', () => {
      const d = crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO })
      expect(
        d.aggiungiIdentificativi(
          IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO })
        )
      ).toBe(false)
    })

    it('un CF contraddittorio e rifiutato senza il valore nel messaggio', () => {
      const d = crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO })
      try {
        d.aggiungiIdentificativi(
          IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_ALTRO })
        )
        throw new Error('non ha lanciato')
      } catch (e) {
        expect(e).toBeInstanceOf(IdentificativoNonCorrispondenteError)
        expect((e as Error).message).not.toContain(CF_PERSONA_VALIDO)
        expect((e as Error).message).not.toContain(CF_PERSONA_ALTRO)
      }
    })

    it('una P.IVA diversa da quella registrata e rifiutata', () => {
      const d = crea({ partitaIva: PIVA_VALIDA })
      expect(() =>
        d.aggiungiIdentificativi(IdentificativoFiscale.crea({ partitaIva: partitaIvaValida(7) }))
      ).toThrow(IdentificativoNonCorrispondenteError)
    })

    it('un CF numerico uguale alla P.IVA registrata non contraddice nulla', () => {
      const d = crea({ partitaIva: PIVA_VALIDA })
      expect(
        d.aggiungiIdentificativi(IdentificativoFiscale.crea({ codiceFiscale: PIVA_VALIDA }))
      ).toBe(false)
      expect(d.codiceFiscale).toBeNull()
    })

    it('una P.IVA uguale al CF numerico registrato lo assorbe (resta solo la P.IVA)', () => {
      const d = crea({ codiceFiscale: PIVA_VALIDA })
      d.aggiungiIdentificativi(IdentificativoFiscale.crea({ partitaIva: PIVA_VALIDA }))
      expect(d.partitaIva).toBe(PIVA_VALIDA)
      expect(d.codiceFiscale).toBeNull()
    })
  })

  describe('sostituisciPartitaIva (D2.8)', () => {
    it('sostituisce una P.IVA senza checksum con una valida', () => {
      const d = dalDatabase(PIVA_CHECKSUM_ERRATO)
      d.sostituisciPartitaIva(PIVA_VALIDA)
      expect(d.partitaIva).toBe(PIVA_VALIDA)
      expect(d.partitaIvaDaVerificare).toBe(false)
    })

    it('rifiuta se quella attuale e valida', () => {
      const d = crea({ partitaIva: PIVA_VALIDA })
      expect(() => d.sostituisciPartitaIva(partitaIvaValida(9))).toThrow(
        IdentificativoNonCorrispondenteError
      )
      expect(d.partitaIva).toBe(PIVA_VALIDA)
    })

    it('rifiuta se la nuova non passa il checksum', () => {
      const d = dalDatabase(PIVA_CHECKSUM_ERRATO)
      expect(() => d.sostituisciPartitaIva('12345678902')).toThrow(
        IdentificativoNonCorrispondenteError
      )
      expect(d.partitaIva).toBe(PIVA_CHECKSUM_ERRATO)
    })

    it('rifiuta se la ditta non ha P.IVA (si aggiunge, non si sostituisce)', () => {
      const d = crea({ codiceFiscale: CF_PERSONA_VALIDO })
      expect(() => d.sostituisciPartitaIva(PIVA_VALIDA)).toThrow(
        IdentificativoNonCorrispondenteError
      )
    })
  })

  it('rinomina riporta se qualcosa e cambiato', () => {
    const d = crea({ partitaIva: PIVA_VALIDA })
    expect(d.rinomina('  Rossi S.r.l. ')).toBe(false)
    expect(d.rinomina('Rossi Group')).toBe(true)
    expect(d.ragioneSociale).toBe('Rossi Group')
    expect(() => d.rinomina(' ')).toThrow(DatiControparteNonValidiError)
  })
})
