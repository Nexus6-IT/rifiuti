import {
  MESSAGGIO_CODICE_FISCALE_NON_VALIDO,
  MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO,
  MESSAGGIO_IDENTIFICATIVO_ASSENTE,
  MESSAGGIO_PARTITA_IVA_NON_VALIDA,
  MESSAGGIO_PRIVATO_SOLO_PRODUTTORE,
  identificativiPerSalvataggio,
  identificativoPerRicerca,
  normalizzaIdentificativo,
  partitaIvaDaVerificare,
  validaIdentificativi,
} from './identificativo-fiscale'

// Gemella del VO del backend (domain/registry/value-objects/identificativo-fiscale.ts):
// stessi casi, stessi messaggi.
const CF_PERSONA_VALIDO = 'RSSMRA80A01H501U'
const PIVA_VALIDA = '12345678903'
const PIVA_CHECKSUM_ERRATO = '12345678901'
const CF_OMOCODICO = 'RSSMRA80A01H5RMD'
const CF_ALTRO = 'BNCLRA85M41F205C'

describe('identificativo-fiscale (gemella del VO del backend)', () => {
  describe('partita IVA', () => {
    it('accetta una P.IVA valida', () => {
      const r = validaIdentificativi({ partitaIva: PIVA_VALIDA }, 'produttore')
      expect(r.errori).toEqual({})
      expect(r.partitaIva).toBe(PIVA_VALIDA)
      expect(r.codiceFiscale).toBeNull()
      expect(r.privato).toBeFalse()
    })

    it('toglie il prefisso IT, gli spazi e normalizza il maiuscolo', () => {
      const scritta = ` it ${PIVA_VALIDA.slice(0, 5)} ${PIVA_VALIDA.slice(5)} `
      expect(normalizzaIdentificativo(scritta)).toBe(PIVA_VALIDA)
      expect(validaIdentificativi({ partitaIva: scritta }, 'produttore').partitaIva).toBe(
        PIVA_VALIDA
      )
    })

    it('rifiuta il checksum errato', () => {
      const r = validaIdentificativi({ partitaIva: PIVA_CHECKSUM_ERRATO }, 'produttore')
      expect(r.errori.partitaIva).toBe(MESSAGGIO_PARTITA_IVA_NON_VALIDA)
    })

    it('rifiuta 10 cifre e valori non numerici', () => {
      for (const v of ['1234567890', '1234567890A', 'ABCDEFGHIJK']) {
        expect(validaIdentificativi({ partitaIva: v }, 'produttore').errori.partitaIva).toBe(
          MESSAGGIO_PARTITA_IVA_NON_VALIDA
        )
      }
    })
  })

  describe('codice fiscale', () => {
    it('accetta un CF di persona e lo dichiara privato', () => {
      const r = validaIdentificativi({ codiceFiscale: CF_PERSONA_VALIDO }, 'produttore')
      expect(r.errori).toEqual({})
      expect(r.codiceFiscale).toBe(CF_PERSONA_VALIDO)
      expect(r.privato).toBeTrue()
    })

    it('accetta un CF omocodico', () => {
      expect(validaIdentificativi({ codiceFiscale: CF_OMOCODICO }, 'produttore').privato).toBeTrue()
    })

    it('rifiuta un CF col carattere di controllo errato', () => {
      const errato = CF_PERSONA_VALIDO.slice(0, 15) + 'A'
      expect(
        validaIdentificativi({ codiceFiscale: errato }, 'produttore').errori.codiceFiscale
      ).toBe(MESSAGGIO_CODICE_FISCALE_NON_VALIDO)
    })

    it('normalizza minuscolo e spazi', () => {
      const r = validaIdentificativi({ codiceFiscale: ' rss mra 80a01 h501u ' }, 'produttore')
      expect(r.codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })

    it('con 17 caratteri risponde con un errore di lunghezza', () => {
      const r = validaIdentificativi({ codiceFiscale: CF_PERSONA_VALIDO + 'X' }, 'produttore')
      expect(r.errori.codiceFiscale).toBe(MESSAGGIO_CODICE_FISCALE_TROPPO_LUNGO)
    })

    it('un CF di 11 cifre valido non è privato; errato rifiutato', () => {
      const ok = validaIdentificativi({ codiceFiscale: PIVA_VALIDA }, 'produttore')
      expect(ok.errori).toEqual({})
      expect(ok.privato).toBeFalse()
      const ko = validaIdentificativi({ codiceFiscale: PIVA_CHECKSUM_ERRATO }, 'produttore')
      expect(ko.errori.codiceFiscale).toBe(MESSAGGIO_CODICE_FISCALE_NON_VALIDO)
    })

    it('con CF uguale alla P.IVA conserva solo la P.IVA', () => {
      const r = validaIdentificativi(
        { partitaIva: PIVA_VALIDA, codiceFiscale: PIVA_VALIDA },
        'produttore'
      )
      expect(r.partitaIva).toBe(PIVA_VALIDA)
      expect(r.codiceFiscale).toBeNull()
    })

    it('P.IVA con CF di persona: non è privato', () => {
      const r = validaIdentificativi(
        { partitaIva: PIVA_VALIDA, codiceFiscale: CF_ALTRO },
        'produttore'
      )
      expect(r.privato).toBeFalse()
      expect(r.partitaIva).toBe(PIVA_VALIDA)
      expect(r.codiceFiscale).toBe(CF_ALTRO)
    })
  })

  describe('assenza e privato', () => {
    it('senza nessuno dei due è un errore; stringhe vuote contano come assenti', () => {
      expect(validaIdentificativi({}, 'produttore').errori.generale).toBe(
        MESSAGGIO_IDENTIFICATIVO_ASSENTE
      )
      expect(
        validaIdentificativi({ partitaIva: '  ', codiceFiscale: '' }, 'produttore').errori.generale
      ).toBe('Indica la partita IVA o il codice fiscale.')
    })

    it('un privato (solo CF di 16 caratteri) è ammesso solo come produttore (D2.5)', () => {
      expect(
        validaIdentificativi({ codiceFiscale: CF_PERSONA_VALIDO }, 'produttore').errori
      ).toEqual({})
      for (const tipo of ['trasportatore', 'destinatario'] as const) {
        expect(
          validaIdentificativi({ codiceFiscale: CF_PERSONA_VALIDO }, tipo).errori.codiceFiscale
        ).toBe(MESSAGGIO_PRIVATO_SOLO_PRODUTTORE)
      }
      // con la P.IVA lo stesso CF non è un privato
      expect(
        validaIdentificativi(
          { partitaIva: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO },
          'destinatario'
        ).errori
      ).toEqual({})
    })
  })

  describe('nessun messaggio contiene il valore', () => {
    const casi: Array<{ partitaIva?: string; codiceFiscale?: string }> = [
      { partitaIva: PIVA_CHECKSUM_ERRATO },
      { partitaIva: '1234567890' },
      { codiceFiscale: CF_PERSONA_VALIDO.slice(0, 15) + 'A' },
      { codiceFiscale: CF_PERSONA_VALIDO + 'X' },
      { codiceFiscale: PIVA_CHECKSUM_ERRATO },
    ]
    casi.forEach(input => {
      it(JSON.stringify(Object.keys(input)), () => {
        const r = validaIdentificativi(input, 'trasportatore')
        const messaggi = Object.values(r.errori).join(' ')
        expect(messaggi).not.toBe('')
        for (const v of Object.values(input)) {
          expect(messaggi).not.toContain(v as string)
          expect(messaggi.replace(/\s/g, '')).not.toContain((v as string).slice(0, 8))
        }
      })
    })
  })

  describe('partitaIvaDaVerificare', () => {
    it('vero solo per una P.IVA presente col checksum errato', () => {
      expect(partitaIvaDaVerificare(PIVA_CHECKSUM_ERRATO)).toBeTrue()
      expect(partitaIvaDaVerificare(PIVA_VALIDA)).toBeFalse()
      expect(partitaIvaDaVerificare(null)).toBeFalse()
      expect(partitaIvaDaVerificare(undefined)).toBeFalse()
    })
  })

  describe('identificativoPerRicerca', () => {
    it('sceglie la P.IVA valida, altrimenti il CF valido, altrimenti nulla', () => {
      expect(identificativoPerRicerca(PIVA_VALIDA, CF_PERSONA_VALIDO)).toBe(PIVA_VALIDA)
      expect(identificativoPerRicerca('', CF_PERSONA_VALIDO)).toBe(CF_PERSONA_VALIDO)
      expect(identificativoPerRicerca(PIVA_CHECKSUM_ERRATO, '')).toBeNull()
      expect(identificativoPerRicerca('', 'abc')).toBeNull()
    })
  })

  describe('identificativiPerSalvataggio', () => {
    const base = { partitaIVA: '', codiceFiscale: '' }

    it('in creazione valida tutto e invia i valori normalizzati', () => {
      const r = identificativiPerSalvataggio(
        { partitaIVA: ` it${PIVA_VALIDA}`, codiceFiscale: ' rssmra80a01h501u' },
        'produttore',
        null
      )
      expect(r.errori).toEqual({})
      expect(r.partitaIVA).toBe(PIVA_VALIDA)
      expect(r.codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })

    it('in creazione senza nulla chiede almeno un identificativo', () => {
      expect(identificativiPerSalvataggio(base, 'produttore', null).errori.generale).toBe(
        MESSAGGIO_IDENTIFICATIVO_ASSENTE
      )
    })

    it('in modifica, identificativi invariati: nulla da inviare e nessun errore (anche se la P.IVA è da verificare)', () => {
      const r = identificativiPerSalvataggio(
        { partitaIVA: PIVA_CHECKSUM_ERRATO, codiceFiscale: '' },
        'trasportatore',
        { partitaIva: PIVA_CHECKSUM_ERRATO, codiceFiscale: null, partitaIvaDaVerificare: true }
      )
      expect(r).toEqual({ errori: {}, partitaIVA: undefined, codiceFiscale: undefined })
    })

    it('in modifica una P.IVA valida non si può cambiare', () => {
      const r = identificativiPerSalvataggio(
        { partitaIVA: '12345678919', codiceFiscale: '' },
        'produttore',
        { partitaIva: PIVA_VALIDA, codiceFiscale: null, partitaIvaDaVerificare: false }
      )
      expect(r.partitaIVA).toBeUndefined()
    })

    it('D2.8: la P.IVA da verificare si sostituisce con una valida, non con una errata', () => {
      const impostati = {
        partitaIva: PIVA_CHECKSUM_ERRATO,
        codiceFiscale: null,
        partitaIvaDaVerificare: true,
      }
      expect(
        identificativiPerSalvataggio(
          { partitaIVA: PIVA_VALIDA, codiceFiscale: '' },
          'produttore',
          impostati
        ).partitaIVA
      ).toBe(PIVA_VALIDA)
      expect(
        identificativiPerSalvataggio(
          { partitaIVA: '12345678902', codiceFiscale: '' },
          'produttore',
          impostati
        ).errori.partitaIva
      ).toBe(MESSAGGIO_PARTITA_IVA_NON_VALIDA)
    })

    it('in modifica si può aggiungere il CF mancante; con la P.IVA presente non è un privato', () => {
      const r = identificativiPerSalvataggio(
        { partitaIVA: PIVA_VALIDA, codiceFiscale: CF_PERSONA_VALIDO },
        'destinatario',
        { partitaIva: PIVA_VALIDA, codiceFiscale: null, partitaIvaDaVerificare: false }
      )
      expect(r.errori).toEqual({})
      expect(r.codiceFiscale).toBe(CF_PERSONA_VALIDO)
    })
  })
})
