import {
  DESTINAZIONI_ACCESSO,
  leggiRelayState,
  risolviDestinazioneAccesso,
} from './destinazioni-accesso'

describe('risolviDestinazioneAccesso (elenco chiuso, niente open redirect)', () => {
  it('«campo» porta a /campo/accesso con refresh di 30 giorni', () => {
    expect(risolviDestinazioneAccesso('campo')).toEqual(DESTINAZIONI_ACCESSO.campo)
    expect(DESTINAZIONI_ACCESSO.campo.percorso).toBe('/campo/accesso')
    expect(DESTINAZIONI_ACCESSO.campo.refreshGiorni).toBe(30)
  })

  it.each([
    undefined,
    null,
    '',
    'ufficio',
    'CAMPO',
    ' campo',
    'campo/../x',
    'https://evil.example/',
    '//evil.example',
    '/campo/',
    'constructor',
    '__proto__',
    'toString',
    ['campo'],
    { campo: true },
    42,
  ])('rifiuta %p', valore => {
    expect(risolviDestinazioneAccesso(valore)).toBeNull()
  })
})

describe('leggiRelayState (chiave + nonce anti login-CSRF)', () => {
  const NONCE = 'AbC_def-1234567890xyz'

  it('«campo.<nonce>» risolve la destinazione e restituisce il nonce', () => {
    expect(leggiRelayState(`campo.${NONCE}`)).toEqual({
      destinazione: DESTINAZIONI_ACCESSO.campo,
      nonce: NONCE,
    })
    expect(risolviDestinazioneAccesso(`campo.${NONCE}`)).toEqual(DESTINAZIONI_ACCESSO.campo)
  })

  it("«campo» senza nonce resta valido (nonce null): sara l'app a rifiutare", () => {
    expect(leggiRelayState('campo')).toEqual({
      destinazione: DESTINAZIONI_ACCESSO.campo,
      nonce: null,
    })
  })

  it.each([
    'campo.',
    'campo.corto',
    `campo.${'a'.repeat(33)}`,
    'campo.abc def ghi jkl mno pqr',
    `campo.${NONCE}.x`,
    `campo.${NONCE}\n`,
    `campo.${'a'.repeat(15)}!`,
    `CAMPO.${NONCE}`,
    `ufficio.${NONCE}`,
    `__proto__.${NONCE}`,
    `constructor.${NONCE}`,
    `toString.${NONCE}`,
    `.${NONCE}`,
    `https://evil.example/.${NONCE}`,
    [`campo.${NONCE}`],
    undefined,
    null,
    42,
  ])('rifiuta %p', valore => {
    expect(leggiRelayState(valore)).toEqual({ destinazione: null, nonce: null })
  })
})
