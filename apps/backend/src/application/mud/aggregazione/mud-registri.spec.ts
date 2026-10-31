import { sediDeiRegistri } from './mud-registri'

describe('sediDeiRegistri', () => {
  it('mappa registro -> sede con una sola query sui registri', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: 'r1', unitaLocaleId: 'ul1' },
      { id: 'r2', unitaLocaleId: null },
    ])
    const mappa = await sediDeiRegistri({ registroRifiuti: { findMany } } as never, 't1')
    expect(mappa).toEqual(
      new Map([
        ['r1', 'ul1'],
        ['r2', null],
      ])
    )
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      select: { id: true, unitaLocaleId: true },
    })
  })
})
