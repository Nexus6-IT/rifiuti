import { EstrattoConsorziService } from './estratto-consorzi.service'
import { leggiMovimentiOrso } from './lettore-movimenti-orso'

jest.mock('./lettore-movimenti-orso')
jest.mock('../registro/causali/catalogo-causali.repository', () => ({
  caricaCatalogoCausali: jest.fn().mockResolvedValue({}),
}))

const mov = (id: string, registroId: string) => ({
  id,
  registroId,
  radiceId: id,
  tipo: 'CARICO' as const,
  movementDate: new Date('2026-03-10T10:00:00Z'),
  cer: '160601',
  pericoloso: true,
  descrizione: null,
  quantita: 1,
  unita: 'kg',
  kg: 1,
  causale: 'X',
  numero: '1/2026',
  controparte: null,
  indirizzoControparte: null,
  firNumero: null,
})

describe('EstrattoConsorziService.estratto', () => {
  it('legge le regole una volta sola, anche con piu sedi (classifica unica per tutti gli ambiti)', async () => {
    const prisma = {
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]) },
      mUDReport: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    const classifica = jest.fn(async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    )
    ;(leggiMovimentiOrso as jest.Mock).mockImplementation(async (_p, par) => ({
      movimenti: [mov(`m-${par.unitaLocaleId}`, `r-${par.unitaLocaleId}`)],
    }))
    const servizio = new EstrattoConsorziService(prisma as never, { classifica } as never)

    const esito = await servizio.estratto('t1', {
      consorzio: 'COBAT',
      da: '2026-03-01',
      a: '2026-03-31',
    })

    expect(esito.righe).toBe(3)
    expect(classifica).toHaveBeenCalledTimes(1)
  })
})
