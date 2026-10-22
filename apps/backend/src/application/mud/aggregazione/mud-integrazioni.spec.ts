import {
  INTEGRAZIONI_VUOTE,
  chiaveDestinatario,
  chiaveMovimento,
  chiavePesoSpecifico,
  intervalloPesoSpecifico,
  leggiIntegrazioni,
  pesoSpecificoPlausibile,
} from './mud-integrazioni'

describe('mud-integrazioni', () => {
  it('chiavi normalizzate', () => {
    expect(chiaveDestinatario('  Ecologia   srl ')).toBe('ECOLOGIA SRL')
    expect(chiavePesoSpecifico('170405', 'litri')).toBe('170405|LITRI')
  })

  it('chiave del movimento: anno e numero progressivo', () => {
    expect(chiaveMovimento(2025, 5)).toBe('2025/5')
  })

  it('le integrazioni vuote hanno anche i destinatari dei movimenti e i trasportatori', () => {
    expect(INTEGRAZIONI_VUOTE.destinatariMovimento).toEqual({})
    expect(INTEGRAZIONI_VUOTE.trasportatori).toEqual({})
  })

  it('leggiIntegrazioni legge destinatari dei movimenti e trasportatori, scartando le voci incomplete', () => {
    const r = leggiIntegrazioni({
      integrazioni: {
        destinatariMovimento: {
          '2025/5': { ragioneSociale: ' Ecologia Srl ', codiceFiscale: ' 12345678903 ' },
          '2025/6': { ragioneSociale: 'Senza CF', codiceFiscale: '' },
          // senza ragione sociale il modulo DR non si compila: la voce vale come assente
          '2025/7': { codiceFiscale: '12345678903' },
          '2025/8': 'x',
        },
        trasportatori: {
          'TRASPORTI SRL': { ragioneSociale: 'Trasporti Srl', codiceFiscale: ' 22222222222' },
          'SOLO NOME': { codiceFiscale: '33333333333' },
          X: { codiceFiscale: 7 },
          Y: { ragioneSociale: 'Y', codiceFiscale: '  ' },
        },
      },
    })
    expect(r.destinatariMovimento).toEqual({
      '2025/5': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
    })
    expect(r.trasportatori).toEqual({
      'TRASPORTI SRL': { ragioneSociale: 'Trasporti Srl', codiceFiscale: '22222222222' },
      'SOLO NOME': { ragioneSociale: 'SOLO NOME', codiceFiscale: '33333333333' },
    })
    const vuote = leggiIntegrazioni({
      integrazioni: { destinatariMovimento: [], trasportatori: 'x' },
    })
    expect(vuote.destinatariMovimento).toEqual({})
    expect(vuote.trasportatori).toEqual({})
  })

  it('la chiave del peso specifico non dipende dalla forma del CER', () => {
    expect(chiavePesoSpecifico('17 04 05', 'mc')).toBe('170405|MC')
  })

  it('leggiIntegrazioni è difensiva', () => {
    expect(leggiIntegrazioni(null)).toEqual(INTEGRAZIONI_VUOTE)
    expect(leggiIntegrazioni({ altro: 1 })).toEqual(INTEGRAZIONI_VUOTE)
    expect(leggiIntegrazioni({ integrazioni: 'x' })).toEqual(INTEGRAZIONI_VUOTE)
    const r = leggiIntegrazioni({
      integrazioni: {
        destinatari: {
          'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
          X: { codiceFiscale: '' },
          Y: { codiceFiscale: 7 },
        },
        pesiSpecifici: {
          '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.2 },
          '1|M3': { kgPerUnita: -1 },
          '2|M3': { cerCode: '2', unita: 'M3', kgPerUnita: Number.NaN },
        },
      },
    })
    expect(Object.keys(r.destinatari)).toEqual(['ECOLOGIA SRL'])
    expect(Object.keys(r.pesiSpecifici)).toEqual(['170405|LITRI'])
    expect(r.aggiornateIl).toBeNull()
    expect(r.aggiornateDa).toBeNull()
  })

  it('conserva la conferma del fuori intervallo e le date di aggiornamento', () => {
    const r = leggiIntegrazioni({
      integrazioni: {
        pesiSpecifici: {
          '170405|M3': {
            cerCode: '170405',
            unita: 'M3',
            kgPerUnita: 1.2,
            confermatoFuoriIntervallo: true,
          },
        },
        aggiornateIl: '2026-10-22T10:00:00.000Z',
        aggiornateDa: 'u1',
      },
    })
    expect(r.pesiSpecifici['170405|M3'].confermatoFuoriIntervallo).toBe(true)
    expect(r.aggiornateIl).toBe('2026-10-22T10:00:00.000Z')
    expect(r.aggiornateDa).toBe('u1')
  })

  it('intervalli di plausibilità del peso specifico per unità', () => {
    expect(intervalloPesoSpecifico('litri')).toEqual({ min: 0.1, max: 3 })
    expect(intervalloPesoSpecifico('mc')).toEqual({ min: 10, max: 3000 })
    expect(intervalloPesoSpecifico('PZ')).toBeNull()
    expect(pesoSpecificoPlausibile('M3', 1200)).toBe(true)
    expect(pesoSpecificoPlausibile('M3', 1.2)).toBe(false) // t/m³ scritto al posto di kg/m³
    expect(pesoSpecificoPlausibile('LITRI', 1200)).toBe(false) // kg/m³ scritto in una riga in litri
    expect(pesoSpecificoPlausibile('PZ', 5)).toBe(false) // nessun intervallo noto: serve la conferma
  })
})
