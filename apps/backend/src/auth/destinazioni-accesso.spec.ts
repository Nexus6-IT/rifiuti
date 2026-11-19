import { DESTINAZIONI_ACCESSO, risolviDestinazioneAccesso } from './destinazioni-accesso'

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
