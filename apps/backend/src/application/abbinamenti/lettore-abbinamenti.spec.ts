import { leggiAmbitiAbbinamento, type ClientAbbinamenti } from './lettore-abbinamenti'

const riga = (o: Record<string, unknown>) => ({
  id: 'm1',
  radice_id: 'm1',
  type: 'CARICO',
  cer_code: '99 99 10',
  unit: 'KG',
  quantity: 10,
  movement_date: new Date('2026-03-01T10:00:00Z'),
  progressive_year: 2026,
  progressive_number: 1,
  radice_year: 2026,
  radice_number: 1,
  operation_code: 'R13',
  causale: 'PRODUZIONE_INTERNA',
  causale_azienda_id: null,
  ...o,
})

function clientFinto(movimenti: unknown[]): ClientAbbinamenti {
  return {
    $queryRaw: jest.fn().mockResolvedValue(movimenti),
    giacenzaIniziale: { findMany: jest.fn().mockResolvedValue([]) },
    abbinamentoCaricoScarico: { findMany: jest.fn().mockResolvedValue([]) },
    causaleRegistro: { findMany: jest.fn().mockResolvedValue([]) },
    causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as ClientAbbinamenti
}

describe('leggiAmbitiAbbinamento (mappatura)', () => {
  it('salta la quantita che arrotonda a zero millesimi e avvisa nel log', async () => {
    const warn = jest.fn()
    const client = clientFinto([
      riga({ id: 'm1', radice_id: 'm1', quantity: 0.0004 }),
      riga({ id: 'm2', radice_id: 'm2', progressive_number: 2, radice_number: 2, quantity: 5 }),
    ])
    const ambiti = await leggiAmbitiAbbinamento(
      client,
      't1',
      { registroId: 'r1' },
      { logger: { warn } }
    )
    expect(warn).toHaveBeenCalledTimes(1)
    expect(ambiti).toHaveLength(1)
    expect(ambiti[0].carichi.map(c => c.chiave)).toEqual(['M:m2'])
    expect(ambiti[0].famiglia).toBe('KG')
    expect(ambiti[0].unita).toBe('kg')
  })

  it('converte le tonnellate in kg e usa radice e numero di testa', async () => {
    const client = clientFinto([
      riga({
        id: 'testa',
        radice_id: 'radice',
        unit: 't',
        quantity: 2,
        progressive_number: 7,
        radice_number: 3,
      }),
    ])
    const [a] = await leggiAmbitiAbbinamento(client, 't1', { registroId: 'r1' })
    expect(a.carichi[0].chiave).toBe('M:radice')
    expect(a.carichi[0].evento.quantita).toBe(2000)
    expect(a.carichi[0].evento.riferimento.id).toBe('radice')
    expect(a.carichi[0].evento.ordine).toBe(2026 * 1e7 + 3)
    expect(a.carichi[0].numero).toBe('7/2026')
  })
})
