import { Prisma } from '@prisma/client'
import { leggiMovimentiCollegati, leggiRadiceOrdinaria } from './movimenti-collegati'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const R1 = '11111111-0000-4000-8000-000000000001'

const riga = (extra: Record<string, unknown>) => ({
  id: R1,
  progressiveNumber: 7,
  progressiveYear: 2026,
  quantity: new Prisma.Decimal('17000'),
  unit: 'KG',
  movimentoOriginaleId: null,
  ...extra,
})

describe('movimenti-collegati', () => {
  it('leggiRadiceOrdinaria interroga per azienda e id', async () => {
    const tx: any = { wasteMovement: { findFirst: jest.fn().mockResolvedValue(null) } }

    await expect(leggiRadiceOrdinaria(tx, T, R1)).resolves.toBeNull()

    expect(tx.wasteMovement.findFirst.mock.calls[0][0].where).toMatchObject({
      id: R1,
      tenantId: T,
    })
  })

  it('catena senza correzioni: la testa e la radice stessa', async () => {
    const tx: any = {
      wasteMovement: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([riga({})]) // radici
          .mockResolvedValueOnce([riga({})]), // vigenti
      },
    }

    const m = await leggiMovimentiCollegati(tx, T, [R1])

    expect(m.get(R1)).toEqual({
      radiceId: R1,
      numero: '7/2026',
      numeroVigente: '7/2026',
      quantita: 17000,
      unita: 'KG',
      annullato: false,
    })
  })

  it('catena rettificata: mostra la testa vigente', async () => {
    const testa = riga({
      id: 'ffffffff-0000-4000-8000-000000000002',
      progressiveNumber: 9,
      quantity: new Prisma.Decimal('16500'),
      movimentoOriginaleId: R1,
    })
    const tx: any = {
      wasteMovement: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([riga({})])
          .mockResolvedValueOnce([testa]),
      },
    }

    const m = await leggiMovimentiCollegati(tx, T, [R1])

    expect(m.get(R1)).toMatchObject({
      numero: '7/2026',
      numeroVigente: '9/2026',
      quantita: 16500,
      annullato: false,
    })
  })

  it('catena annullata: nessuna vigente → annullato', async () => {
    const tx: any = {
      wasteMovement: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([riga({})])
          .mockResolvedValueOnce([]),
      },
    }

    const m = await leggiMovimentiCollegati(tx, T, [R1])

    expect(m.get(R1)).toMatchObject({
      annullato: true,
      numeroVigente: null,
      quantita: null,
      unita: null,
    })
  })

  it('nessun id: nessuna query', async () => {
    const tx: any = { wasteMovement: { findMany: jest.fn() } }
    expect((await leggiMovimentiCollegati(tx, T, [])).size).toBe(0)
    expect(tx.wasteMovement.findMany).not.toHaveBeenCalled()
  })
})
