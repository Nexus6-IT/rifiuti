import {
  AZIENDA_PIATTAFORMA_ID,
  escludiPiattaforma,
  escludiPiattaformaDaId,
} from './azienda-piattaforma'

describe('azienda piattaforma', () => {
  it('ha l id fisso', () => {
    expect(AZIENDA_PIATTAFORMA_ID).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('escludiPiattaforma: senza where aggiunge solo il filtro', () => {
    expect(escludiPiattaforma()).toEqual({ id: { not: AZIENDA_PIATTAFORMA_ID } })
    expect(escludiPiattaforma({})).toEqual({ id: { not: AZIENDA_PIATTAFORMA_ID } })
  })

  it('escludiPiattaforma: compone in AND senza alterare il where originale', () => {
    const where = { subscriptionStatus: { in: ['ACTIVE' as const] } }
    expect(escludiPiattaforma(where)).toEqual({
      AND: [where, { id: { not: AZIENDA_PIATTAFORMA_ID } }],
    })
  })

  it('escludiPiattaformaDaId filtra gli id', () => {
    expect(escludiPiattaformaDaId(['a', AZIENDA_PIATTAFORMA_ID, 'b'])).toEqual(['a', 'b'])
  })
})
