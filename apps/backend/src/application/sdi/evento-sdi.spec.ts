import { corpoDaNotifica, notificaDaCorpo } from './evento-sdi'

describe('corpo dell’evento SDI', () => {
  it('round-trip di una notifica con file e data', () => {
    const n = {
      tipo: 'NE' as const,
      esitoCommittente: 'EC01' as const,
      codiciErrore: ['00404'],
      dataRicezioneSdi: new Date('2026-11-19T10:00:00.000Z'),
      idNotifica: 'n-1',
      file: Buffer.from('<xml/>'),
    }
    const letto = notificaDaCorpo(JSON.parse(JSON.stringify(corpoDaNotifica('p-1', n))))
    expect(letto?.idProvider).toBe('p-1')
    expect(letto?.notifica).toEqual(n)
  })

  it.each([
    null,
    'x',
    {},
    { idProvider: 'p' },
    { idProvider: 'p', notifica: { tipo: 'XX' } },
    {
      idProvider: 'p',
      notifica: { tipo: 'RC', dataRicezioneSdi: 'non-una-data' },
    },
  ])('forma non valida %j -> null', corpo => {
    expect(notificaDaCorpo(corpo)).toBeNull()
  })

  it('esito committente sconosciuto e campi opzionali assenti diventano null/vuoti', () => {
    const l = notificaDaCorpo({
      idProvider: 'p',
      notifica: { tipo: 'RC', esitoCommittente: 'EC99' },
    })
    expect(l?.notifica).toMatchObject({
      esitoCommittente: null,
      codiciErrore: [],
      dataRicezioneSdi: null,
      idNotifica: null,
      file: null,
    })
  })
})
