import {
  MESSAGGIO_CONCORRENTE,
  eConcorrente,
  leggiErroriAzione,
  naturaConflitto,
} from './errori-azione'

describe('leggiErroriAzione', () => {
  it('error.errori con campo e messaggio', () => {
    const r = leggiErroriAzione(
      { status: 400, error: { errori: [{ campo: 'prezzo', messaggio: 'Prezzo errato.' }] } },
      'x'
    )
    expect(r.messaggi).toEqual(['Prezzo errato.'])
    expect(r.campi).toEqual([{ campo: 'prezzo', messaggio: 'Prezzo errato.' }])
    expect(r.conflitto).toBeFalse()
  })

  it('error.details.errori (filtro globale, R60), anche stringhe', () => {
    const r = leggiErroriAzione(
      { status: 400, error: { details: { errori: ['Uno.', { messaggio: 'Due.' }] } } },
      'x'
    )
    expect(r.messaggi).toEqual(['Uno.', 'Due.'])
  })

  it('message come array o stringa', () => {
    expect(
      leggiErroriAzione({ status: 400, error: { message: ['A.', 'B.'] } }, 'x').messaggi
    ).toEqual(['A.', 'B.'])
    expect(leggiErroriAzione({ status: 400, error: { message: 'C.' } }, 'x').messaggi).toEqual([
      'C.',
    ])
  })

  it('409 è un conflitto; senza messaggio vale il ripiego', () => {
    const r = leggiErroriAzione({ status: 409 }, 'Ripiego.')
    expect(r.messaggi).toEqual(['Ripiego.'])
    expect(r.conflitto).toBeTrue()
    expect(r.codice).toBeNull()
    expect(leggiErroriAzione(null, 'Ripiego.').conflitto).toBe(false)
  })

  it('due 409 distinti: il codice sta in error.error', () => {
    const superata = leggiErroriAzione(
      { status: 409, error: { error: 'VARIAZIONE_SUPERATA' } },
      'x'
    )
    const concorrente = leggiErroriAzione(
      { status: 409, error: { error: 'OPERAZIONE_CONCORRENTE' } },
      'x'
    )
    expect(superata.codice).toBe('VARIAZIONE_SUPERATA')
    expect(eConcorrente(superata)).toBeFalse()
    expect(eConcorrente(concorrente)).toBeTrue()
  })

  describe('natura del 409 (M1)', () => {
    const e409 = (codice?: string) => ({ status: 409, error: codice ? { error: codice } : {} })

    it('versione superata, listino non modificabile, anteprima superata: rilettura', () => {
      for (const c of [
        'ELENCO_ADDEBITI_MODIFICATO_NEL_FRATTEMPO',
        'RIGA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO',
        'LISTINO_NON_MODIFICABILE',
        'CONTRATTO_CLIENTE_NON_MODIFICABILE',
        'VARIAZIONE_SUPERATA',
      ]) {
        expect(naturaConflitto(e409(c)))
          .withContext(c)
          .toBe('rilettura')
        expect(leggiErroriAzione(e409(c), 'x').rilettura)
          .withContext(c)
          .toBeTrue()
      }
    })

    it('senza codice non si sa: rilettura, la scelta prudente', () => {
      expect(naturaConflitto(e409())).toBe('rilettura')
    })

    it('duplicati e voci già presenti sono colpa di quanto scritto: dato, niente "Ricarica"', () => {
      for (const c of [
        'ELENCO_ADDEBITI_CODICE_DUPLICATO',
        'RIGA_ADDEBITO_DUPLICATA',
        'MINIMO_GIA_PRESENTE',
        'ACCONTO_GIA_PRESENTE',
        'DETRAZIONE_GIA_PRESENTE',
      ]) {
        expect(naturaConflitto(e409(c)))
          .withContext(c)
          .toBe('dato')
        expect(leggiErroriAzione(e409(c), 'x').rilettura)
          .withContext(c)
          .toBeFalse()
      }
    })

    it('operazione concorrente: un solo testo, niente "Ricarica"', () => {
      const r = leggiErroriAzione(
        { status: 409, error: { error: 'OPERAZIONE_CONCORRENTE', message: 'testo del backend' } },
        'x'
      )
      expect(r.natura).toBe('concorrente')
      expect(r.rilettura).toBeFalse()
      expect(r.messaggi).toEqual([MESSAGGIO_CONCORRENTE])
      expect(r.campi).toEqual([{ campo: null, messaggio: MESSAGGIO_CONCORRENTE }])
    })

    it('altri stati non sono conflitti', () => {
      expect(naturaConflitto({ status: 400 })).toBeNull()
      expect(naturaConflitto(null)).toBeNull()
    })
  })
})
