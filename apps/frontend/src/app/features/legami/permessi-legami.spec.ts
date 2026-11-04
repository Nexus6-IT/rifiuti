import { permessiLegami, puoImpostareFatturazione } from './permessi-legami'

describe('permessiLegami', () => {
  it('VIEWER: niente', () => {
    expect(permessiLegami('VIEWER')).toEqual({
      scrive: false,
      aggiornaPrezzi: false,
      impostaFatturazione: false,
    })
  })
  it('OPERATOR: solo scrittura', () => {
    expect(permessiLegami('OPERATOR')).toEqual({
      scrive: true,
      aggiornaPrezzi: false,
      impostaFatturazione: false,
    })
  })
  it('ADMIN e SUPER_ADMIN: tutto', () => {
    for (const r of ['ADMIN', 'SUPER_ADMIN']) {
      expect(permessiLegami(r)).toEqual({
        scrive: true,
        aggiornaPrezzi: true,
        impostaFatturazione: true,
      })
    }
  })
  it('ruolo assente o sconosciuto: niente', () => {
    for (const r of [null, undefined, '', 'X']) {
      expect(permessiLegami(r)).toEqual({
        scrive: false,
        aggiornaPrezzi: false,
        impostaFatturazione: false,
      })
    }
  })
  it('puoImpostareFatturazione resta invariata', () => {
    expect(puoImpostareFatturazione('ADMIN')).toBe(true)
    expect(puoImpostareFatturazione('OPERATOR')).toBe(false)
  })
})
