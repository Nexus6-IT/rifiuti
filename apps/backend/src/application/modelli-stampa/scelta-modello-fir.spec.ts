import { sceglieModelloFir, type ModelloSalvato } from './scelta-modello-fir'

const m = (o: Partial<ModelloSalvato>): ModelloSalvato => ({
  ambito: 'FIR',
  predefinito: false,
  copie: 2,
  logoBase64: null,
  testoIntestazione: 'H',
  testoPiePagina: 'F',
  colorePrimario: '#111111',
  coloreSecondario: '#222222',
  ...o,
})

describe('sceglieModelloFir', () => {
  it('modello esplicito FIR o GENERALE: esito OK con la forma per il PDF', () => {
    const esito = sceglieModelloFir({ tipo: 'ESPLICITO', modello: m({ ambito: 'GENERALE' }) })
    expect(esito).toEqual({
      esito: 'OK',
      modello: {
        ambito: 'GENERALE',
        copie: 2,
        logoBase64: null,
        headerText: 'H',
        footerText: 'F',
        primaryColor: '#111111',
        secondaryColor: '#222222',
      },
    })
  })

  it('modello esplicito della distinta: esito AMBITO_NON_VALIDO', () => {
    expect(
      sceglieModelloFir({ tipo: 'ESPLICITO', modello: m({ ambito: 'DISTINTA_RITIRI' }) })
    ).toEqual({ esito: 'AMBITO_NON_VALIDO' })
  })

  it('senza esplicito: predefinito FIR, poi GENERALE, poi nessuno', () => {
    const gen = m({ ambito: 'GENERALE', predefinito: true, copie: 3 })
    const fir = m({ ambito: 'FIR', predefinito: true, copie: 1 })
    const dist = m({ ambito: 'DISTINTA_RITIRI', predefinito: true })
    const copie = (e: ReturnType<typeof sceglieModelloFir>) =>
      e.esito === 'OK' ? e.modello?.copie : 'ko'
    expect(copie(sceglieModelloFir({ tipo: 'PREDEFINITO', elenco: [gen, dist, fir] }))).toBe(1)
    expect(copie(sceglieModelloFir({ tipo: 'PREDEFINITO', elenco: [dist, gen] }))).toBe(3)
    expect(
      sceglieModelloFir({ tipo: 'PREDEFINITO', elenco: [dist, m({ predefinito: false })] })
    ).toEqual({ esito: 'OK', modello: null })
  })
})
