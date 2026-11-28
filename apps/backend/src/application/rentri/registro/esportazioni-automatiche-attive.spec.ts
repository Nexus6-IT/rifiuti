import { esportazioniAutomaticheAttive } from './esportazioni-automatiche-attive'

describe('esportazioniAutomaticheAttive', () => {
  const originale = process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE
  afterEach(() => {
    if (originale === undefined) delete process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE
    else process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE = originale
  })

  it('spento se la variabile e assente', () => {
    delete process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE
    expect(esportazioniAutomaticheAttive()).toBe(false)
  })

  it('acceso solo con il testo esatto "true"', () => {
    process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE = 'true'
    expect(esportazioniAutomaticheAttive()).toBe(true)
  })

  it.each(['TRUE', 'True', '1', 'si', 'yes', ' true', 'true ', '', 'false', 'on'])(
    'spento con il valore ambiguo %j',
    valore => {
      process.env.RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE = valore
      expect(esportazioniAutomaticheAttive()).toBe(false)
    }
  )
})
