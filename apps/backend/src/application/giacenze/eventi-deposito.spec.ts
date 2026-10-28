import { leggiEventiDeposito } from './eventi-deposito'

type Riga = Partial<{
  id: string
  registroId: string
  cerCode: string
  type: string
  unit: string
  quantity: number
  movementDate: Date
  progressiveYear: number
  progressiveNumber: number
}>

let seq = 0
const mov = (o: Riga = {}) => ({
  id: `m${++seq}`,
  registroId: 'reg-A',
  cerCode: '200301',
  type: 'CARICO',
  unit: 'KG',
  quantity: 100,
  movementDate: new Date('2026-03-01T10:00:00Z'),
  progressiveYear: 2026,
  progressiveNumber: seq,
  ...o,
})

function creaClient(opts: {
  movimenti?: any[]
  aperture?: any[]
  asterisco?: { mov?: string[]; ap?: string[] }
  catalogo?: Array<{ cifre: string; pericoloso: boolean }>
}) {
  const wasteMovement = {
    findMany: jest.fn().mockResolvedValue(opts.movimenti ?? []),
    groupBy: jest.fn().mockResolvedValue((opts.asterisco?.mov ?? []).map(cerCode => ({ cerCode }))),
  }
  const giacenzaIniziale = {
    findMany: jest.fn().mockResolvedValue(opts.aperture ?? []),
    groupBy: jest.fn().mockResolvedValue((opts.asterisco?.ap ?? []).map(cerCode => ({ cerCode }))),
  }
  const $queryRaw = jest.fn().mockResolvedValue(opts.catalogo ?? [])
  return { wasteMovement, giacenzaIniziale, $queryRaw } as any
}

const apertura = (o: Record<string, unknown> = {}) => ({
  id: 'ap1',
  registroId: 'reg-A',
  cerCode: '20 03 01',
  quantita: 40,
  unita: 'KG',
  // le aperture passano da leggiApertureRegistro: il mock del client restituisce righe Prisma
  dataRiferimento: new Date('2026-01-15T00:00:00Z'),
  ...o,
})

describe('leggiEventiDeposito', () => {
  it('raggruppa per registro e per CER sulle sole cifre', async () => {
    const client = creaClient({
      movimenti: [
        mov({ cerCode: '200301' }),
        mov({ cerCode: '20 03 01' }),
        mov({ registroId: 'reg-B', cerCode: '20 03 01' }),
      ],
    })
    const r = await leggiEventiDeposito(client, 't1')
    expect([...r.keys()].sort()).toEqual(['reg-A', 'reg-B'])
    const gruppoA = r.get('reg-A')!
    expect([...gruppoA.keys()]).toEqual(['200301'])
    expect(gruppoA.get('200301')!.cerCode).toBe('20 03 01')
    expect(gruppoA.get('200301')!.famiglie.get('KG')).toHaveLength(2)
    expect(r.get('reg-B')!.get('200301')!.famiglie.get('KG')).toHaveLength(1)
  })

  it('separa le famiglie: kg e t insieme (t x 1000), litri a parte', async () => {
    const client = creaClient({
      movimenti: [
        mov({ unit: 'KG', quantity: 10 }),
        mov({ unit: 'T', quantity: 2 }),
        mov({ unit: 'L', quantity: 50 }),
      ],
    })
    const g = (await leggiEventiDeposito(client, 't1')).get('reg-A')!.get('200301')!
    expect([...g.famiglie.keys()].sort()).toEqual(['KG', 'L'])
    expect(g.famiglie.get('KG')!.map(e => e.quantita)).toEqual([10, 2000])
    expect(g.famiglie.get('L')!.map(e => e.quantita)).toEqual([50])
  })

  it('il giorno e quello italiano: le 23:30 UTC del 31/12 sono il 1 gennaio', async () => {
    const client = creaClient({
      movimenti: [mov({ movementDate: new Date('2026-12-31T23:30:00Z'), progressiveNumber: 7 })],
    })
    const g = (await leggiEventiDeposito(client, 't1')).get('reg-A')!.get('200301')!
    const e = g.famiglie.get('KG')![0]
    expect(e.giorno).toBe('2027-01-01')
    expect(e.ordine).toBe(2026 * 1e7 + 7)
    expect(e.origine).toBe('MOVIMENTO')
    expect(e.riferimento).toMatchObject({ numero: '7/2026' })
  })

  it('le aperture sono CARICO con origine APERTURA e riferimento.id', async () => {
    const client = creaClient({ aperture: [apertura()] })
    const g = (await leggiEventiDeposito(client, 't1')).get('reg-A')!.get('200301')!
    expect(g.famiglie.get('KG')![0]).toEqual({
      tipo: 'CARICO',
      giorno: '2026-01-15',
      quantita: 40,
      origine: 'APERTURA',
      ordine: 0,
      riferimento: { id: 'ap1' },
    })
  })

  it('salta con un avviso le quantita <= 0 e quelle che arrotondano a zero', async () => {
    const logger = { warn: jest.fn() }
    const client = creaClient({
      movimenti: [
        mov({ quantity: 0 }),
        mov({ quantity: -5 }),
        mov({ quantity: 0.0004 }),
        mov({ quantity: 5 }),
      ],
      aperture: [apertura({ quantita: 0 })],
    })
    const r = await leggiEventiDeposito(client, 't1', { logger })
    expect(r.get('reg-A')!.get('200301')!.famiglie.get('KG')).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledTimes(4)
  })

  it('legge solo le vigenti e filtra per tenant e registro', async () => {
    const client = creaClient({})
    await leggiEventiDeposito(client, 't1', { registroId: 'reg-A' })
    const where = client.wasteMovement.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      tenantId: 't1',
      registroId: 'reg-A',
      tipoAnnotazione: { not: 'ANNULLAMENTO' },
      correzioni: { none: {} },
    })
  })

  describe('pericolosita (I5)', () => {
    it('asterisco solo in un altro registro: pericoloso anche in quello richiesto', async () => {
      const client = creaClient({
        movimenti: [mov({ cerCode: '200301' })],
        asterisco: { mov: ['20 03 01*'] },
      })
      const g = (await leggiEventiDeposito(client, 't1', { registroId: 'reg-A' }))
        .get('reg-A')!
        .get('200301')!
      expect(g.pericoloso).toBe(true)
      expect(g.cerCode).toBe('20 03 01*')
    })

    it('asterisco solo su una giacenza iniziale di un altro registro', async () => {
      const client = creaClient({
        movimenti: [mov({ cerCode: '200301' })],
        asterisco: { ap: ['200301*'] },
      })
      const g = (await leggiEventiDeposito(client, 't1', { registroId: 'reg-A' }))
        .get('reg-A')!
        .get('200301')!
      expect(g.pericoloso).toBe(true)
    })

    it("senza registroId l'asterisco di una riga non vigente conta lo stesso", async () => {
      // la riga con l'asterisco e' stata rettificata: non e' fra le vigenti lette
      const client = creaClient({
        movimenti: [mov({ cerCode: '200301' }), mov({ registroId: 'reg-B', cerCode: '20 03 01' })],
        asterisco: { mov: ['20 03 01*'] },
      })
      const r = await leggiEventiDeposito(client, 't1')
      expect(r.get('reg-A')!.get('200301')!.pericoloso).toBe(true)
      expect(r.get('reg-B')!.get('200301')!.pericoloso).toBe(true)
      expect(client.wasteMovement.groupBy).toHaveBeenCalledTimes(1)
      expect(client.giacenzaIniziale.groupBy).toHaveBeenCalledTimes(1)
    })

    it('senza asterisco ma pericoloso nel catalogo: pericoloso', async () => {
      const client = creaClient({
        movimenti: [mov({ cerCode: '160601' })],
        catalogo: [{ cifre: '160601', pericoloso: true }],
      })
      const g = (await leggiEventiDeposito(client, 't1')).get('reg-A')!.get('160601')!
      expect(g.pericoloso).toBe(true)
      expect(g.cerCode).toBe('16 06 01*')
    })

    it('nessuno dei due: non pericoloso', async () => {
      const client = creaClient({
        movimenti: [mov({ cerCode: '200301' })],
        catalogo: [{ cifre: '200301', pericoloso: false }],
      })
      const g = (await leggiEventiDeposito(client, 't1')).get('reg-A')!.get('200301')!
      expect(g.pericoloso).toBe(false)
      expect(g.cerCode).toBe('20 03 01')
    })

    it('stesso CER, stesso esito in tutte le sedi', async () => {
      const client = creaClient({
        movimenti: [
          mov({ registroId: 'reg-A', cerCode: '160601' }),
          mov({ registroId: 'reg-B', cerCode: '16 06 01' }),
          mov({ registroId: 'reg-C', cerCode: '16 06 01*' }),
        ],
        asterisco: { mov: ['16 06 01*'] },
      })
      const r = await leggiEventiDeposito(client, 't1')
      for (const reg of ['reg-A', 'reg-B', 'reg-C']) {
        expect(r.get(reg)!.get('160601')!.pericoloso).toBe(true)
      }
    })
  })

  it('usa le aperture passate dal chiamante senza rileggerle', async () => {
    const client = creaClient({})
    const r = await leggiEventiDeposito(client, 't1', {
      aperture: [
        {
          id: 'ap9',
          registroId: 'reg-A',
          cerCode: '200301',
          quantita: 3,
          unita: 'KG',
          dataRiferimento: '2026-01-02',
        },
      ],
    })
    expect(client.giacenzaIniziale.findMany).not.toHaveBeenCalled()
    expect(r.get('reg-A')!.get('200301')!.famiglie.get('KG')).toHaveLength(1)
  })

  describe('numero di query fisso (M4)', () => {
    const tre = ['reg-A', 'reg-B', 'reg-C']
    const dieci = Array.from({ length: 10 }, (_, i) => `20 03 ${String(i + 1).padStart(2, '0')}`)
    const movimenti = tre.flatMap(registroId => dieci.map(cerCode => mov({ registroId, cerCode })))

    it('senza registroId: stesse query, compresi i due groupBy', async () => {
      const client = creaClient({ movimenti })
      await leggiEventiDeposito(client, 't1')
      expect(client.wasteMovement.findMany).toHaveBeenCalledTimes(1)
      expect(client.giacenzaIniziale.findMany).toHaveBeenCalledTimes(1)
      expect(client.$queryRaw).toHaveBeenCalledTimes(1)
      expect(client.wasteMovement.groupBy).toHaveBeenCalledTimes(1)
      expect(client.giacenzaIniziale.groupBy).toHaveBeenCalledTimes(1)
    })

    it('con registroId: stesso numero di query', async () => {
      const client = creaClient({ movimenti })
      await leggiEventiDeposito(client, 't1', { registroId: 'reg-A' })
      expect(client.wasteMovement.findMany).toHaveBeenCalledTimes(1)
      expect(client.giacenzaIniziale.findMany).toHaveBeenCalledTimes(1)
      expect(client.$queryRaw).toHaveBeenCalledTimes(1)
      expect(client.wasteMovement.groupBy).toHaveBeenCalledTimes(1)
      expect(client.giacenzaIniziale.groupBy).toHaveBeenCalledTimes(1)
    })
  })
})
