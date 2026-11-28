import { avvisoScortaDa } from './avviso-scorta'
import { RentriEmissionePossibile } from '../rentri/rentri-blocchi.service'

const esito = (o: Partial<RentriEmissionePossibile> = {}): RentriEmissionePossibile => ({
  possibile: true,
  numeriDisponibili: 20,
  scortaRichiesta: true,
  inEsaurimento: false,
  soglia: null,
  ...o,
})

describe('avvisoScortaDa', () => {
  it('nessun esito (chiamata fallita o non ancora arrivata): nessun avviso', () => {
    expect(avvisoScortaDa(null)).toBeNull()
  })

  it('scorta abbondante: nessun avviso', () => {
    expect(avvisoScortaDa(esito())).toBeNull()
  })

  it('l emissione non consuma scorta (es. MANUALE): nessun avviso, anche con la scorta vuota', () => {
    expect(
      avvisoScortaDa(
        esito({ scortaRichiesta: false, possibile: false, numeriDisponibili: 0, motivo: 'x' })
      )
    ).toBeNull()
  })

  it('scorta vuota: avviso di errore con il motivo del backend e l emissione bloccata', () => {
    const avviso = avvisoScortaDa(
      esito({
        possibile: false,
        numeriDisponibili: 0,
        motivo: 'Nessun numero FIR vidimato disponibile.',
      })
    )

    expect(avviso).toEqual({
      gravita: 'error',
      testo: 'Nessun numero FIR vidimato disponibile.',
    })
  })

  it('scorta vuota senza motivo: testo di ripiego che dice cosa fare', () => {
    const avviso = avvisoScortaDa(esito({ possibile: false, numeriDisponibili: 0 }))

    expect(avviso?.gravita).toBe('error')
    expect(avviso?.testo).toMatch(/vidim/i)
  })

  it('in esaurimento: avviso warn con quanti numeri restano e la soglia, senza bloccare', () => {
    const avviso = avvisoScortaDa(esito({ numeriDisponibili: 3, inEsaurimento: true, soglia: 10 }))

    expect(avviso?.gravita).toBe('warn')
    expect(avviso?.testo).toContain('3')
    expect(avviso?.testo).toContain('10')
  })

  it('un solo numero rimasto: singolare', () => {
    const avviso = avvisoScortaDa(esito({ numeriDisponibili: 1, inEsaurimento: true, soglia: 10 }))
    expect(avviso?.testo).toMatch(/1 numero /)
  })
})
