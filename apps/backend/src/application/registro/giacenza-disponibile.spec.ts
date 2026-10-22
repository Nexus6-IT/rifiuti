import { giacenzaDisponibileAl } from './giacenza-disponibile'

describe('giacenzaDisponibileAl', () => {
  it('senza righe dalla query vale zero, col limite al giorno richiesto', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) } as any

    const g = await giacenzaDisponibileAl(tx, {
      tenantId: '11111111-1111-4111-8111-111111111111',
      cerCode: '20 03 01',
      alla: new Date('2026-10-21T10:00:00Z'),
    })

    expect(g).toEqual({
      saldoComplessivoKg: 0,
      disponibileAllaDataKg: 0,
      vincoloAl: new Date('2026-10-21T00:00:00Z'),
    })
  })
})
