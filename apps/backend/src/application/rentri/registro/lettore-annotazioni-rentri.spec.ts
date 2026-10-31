import { LettoreAnnotazioniRentri } from './lettore-annotazioni-rentri'

const T = 'tenant-1'
const REG = 'reg-1'

function movimento(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    tenantId: T,
    registroId: REG,
    type: 'CARICO',
    tipoAnnotazione: 'ORDINARIA',
    progressiveYear: 2026,
    progressiveNumber: 1,
    movementDate: new Date('2026-03-01T10:00:00Z'),
    registrationDate: new Date('2026-03-01T10:00:00Z'),
    causale: 'PRODUZIONE_INTERNA',
    causaleAziendaId: null,
    cerCode: '15 01 01',
    wasteDescription: null,
    quantity: 100,
    unit: 'KG',
    wastePhysicalState: 'Solido',
    wasteHazardClasses: null,
    operationCode: null,
    firId: null,
    movimentoRettificatoId: null,
    motivoAnnotazione: null,
    ...extra,
  }
}

const sistema = (codice: string, verso: string, codiceRentri: string | null) => ({
  codice,
  verso,
  descrizione: codice,
  ruoloMud: 'PRODOTTO',
  codiceRentri,
  operazione: null,
  ordine: 1,
  attiva: true,
})

interface Dati {
  movimenti?: any[]
  predecessori?: any[]
  firs?: any[]
  produttori?: any[]
  trasportatori?: any[]
  destinatari?: any[]
  sedi?: any[]
  comuni?: any[]
  vigenti?: any[]
  aperture?: any[]
  azienda?: any[]
}

function fakeTx(d: Dati) {
  // La prima findMany di wasteMovement e' la lettura delle richieste; poi predecessori; poi vigenti.
  const wm = jest.fn()
  wm.mockImplementation(async (args: any) => {
    if (args.where?.registroId && args.where?.tipoAnnotazione) return d.vigenti ?? []
    if (args.select?.progressiveYear && !args.select?.type) return d.predecessori ?? []
    return d.movimenti ?? []
  })
  const m = (dati: any[] | undefined) => ({ findMany: jest.fn().mockResolvedValue(dati ?? []) })
  const tx: any = {
    wasteMovement: { findMany: wm },
    causaleRegistro: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          sistema('PRODUZIONE_INTERNA', 'CARICO', 'DT'),
          sistema('ALTRO_SCARICO', 'SCARICO', null),
          sistema('CONFERIMENTO_TRASPORTATORE', 'SCARICO', 'aT'),
        ]),
    },
    causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue(d.azienda ?? []) },
    fIR: m(d.firs),
    produttore: m(d.produttori),
    trasportatore: m(d.trasportatori),
    destinatario: m(d.destinatari),
    sedeDitta: m(d.sedi),
    istatComune: m(d.comuni),
    giacenzaIniziale: {
      findMany: jest
        .fn()
        .mockImplementation(async (args: any) =>
          args.select?.origini
            ? (d.aperture ?? []).map(a => ({ id: a.id, origini: a.origini }))
            : (d.aperture ?? [])
        ),
    },
  }
  return tx
}

const logger = () => ({
  setContext: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})
const nuovo = (l = logger()) => ({ lettore: new LettoreAnnotazioniRentri(l as any), l })

const ditta = (extra: Record<string, unknown> = {}) => ({
  ragioneSociale: 'Ditta Srl',
  partitaIva: '01234567890',
  codiceFiscale: null,
  ...extra,
})
const sede = {
  via: 'Via Roma',
  civico: '1',
  cap: '00100',
  comune: 'Roma',
  provincia: 'RM',
  dittaId: 'd1',
}

function fir(extra: Record<string, unknown> = {}) {
  return {
    id: 'fir-1',
    rentriNumeroFir: null,
    firNumber: 'FIR/1',
    transportDate: new Date('2026-03-02T08:00:00Z'),
    actualArrivalDate: null,
    effectiveWeight: null,
    provenienza: 'URBANO',
    producerId: 'p1',
    receiverId: null,
    carrierId: null,
    producerSedeId: null,
    receiverSedeId: null,
    producerCodiceFiscale: null,
    carrierCodiceFiscale: null,
    receiverCodiceFiscale: null,
    ...extra,
  }
}

describe('LettoreAnnotazioniRentri (Prisma finto)', () => {
  it('causale aziendale risolta con la versione scelta', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { causale: 'AZ_X', causaleAziendaId: 'v2' })],
      azienda: [
        {
          id: 'v1',
          natura: 'PROPRIA',
          codice: 'AZ_X',
          verso: 'CARICO',
          descrizione: 'x',
          ruoloMud: 'PRODOTTO',
          codiceRentri: 'NP',
          operazione: null,
          ordine: 1,
          validaDal: null,
          validaAl: null,
        },
        {
          id: 'v2',
          natura: 'PROPRIA',
          codice: 'AZ_X',
          verso: 'CARICO',
          descrizione: 'x',
          ruoloMud: 'PRODOTTO',
          codiceRentri: 'RE',
          operazione: null,
          ordine: 1,
          validaDal: null,
          validaAl: null,
        },
      ],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.codiceRentri).toBe('RE')
  })

  it('causale sconosciuta o senza codice: codiceRentri null', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { type: 'SCARICO', causale: 'ALTRO_SCARICO' })],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.codiceRentri).toBeNull()
  })

  it('predecessore letto col suo numero', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [
        movimento('r', {
          tipoAnnotazione: 'RETTIFICA',
          movimentoRettificatoId: 'o',
          progressiveNumber: 5,
          motivoAnnotazione: 'errore',
        }),
      ],
      predecessori: [{ id: 'o', progressiveYear: 2025, progressiveNumber: 9 }],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['r'])
    expect(a.predecessore).toEqual({ anno: 2025, progressivo: 9 })
    expect(a.motivo).toBe('errore')
    expect(a.numero).toEqual({ anno: 2026, progressivo: 5 })
  })

  it("FIR con snapshot del CF usato prima dell'anagrafica", async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { firId: 'fir-1' })],
      firs: [fir({ producerCodiceFiscale: 'SNAP0000000000X', producerId: 'p1' })],
      produttori: [
        { id: 'p1', dittaId: 'd1', ditta: ditta({ codiceFiscale: 'ANAG000000000000' }), sede },
      ],
      comuni: [{ code: '058091', name: 'Roma', provinciaSigla: 'RM' }],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.fir?.produttore?.codiceFiscale).toBe('SNAP0000000000X')
    expect(a.fir?.produttore?.indirizzo?.citta.comune_id).toBe('058091')
    expect(a.fir?.numeroFir).toBe('FIR/1')
    expect(a.fir?.provenienza).toBe('U')
  })

  it('senza snapshot, il CF della ditta (poi la P.IVA)', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { firId: 'fir-1' })],
      firs: [fir()],
      produttori: [{ id: 'p1', dittaId: 'd1', ditta: ditta(), sede }],
      comuni: [{ code: '058091', name: 'ROMA', provinciaSigla: 'RM' }],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.fir?.produttore?.codiceFiscale).toBe('01234567890')
  })

  it('comune non risolto: il FIR passa produttore null', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { firId: 'fir-1' })],
      firs: [fir()],
      produttori: [{ id: 'p1', dittaId: 'd1', ditta: ditta(), sede }],
      comuni: [],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.fir).not.toBeNull()
    expect(a.fir?.produttore).toBeNull()
  })

  it("sede del FIR di un'altra ditta: produttore null", async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { firId: 'fir-1' })],
      firs: [fir({ producerSedeId: 's9' })],
      produttori: [{ id: 'p1', dittaId: 'd1', ditta: ditta(), sede }],
      sedi: [{ ...sede, id: 's9', dittaId: 'ALTRA' }],
      comuni: [{ code: '058091', name: 'Roma', provinciaSigla: 'RM' }],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['m1'])
    expect(a.fir?.produttore).toBeNull()
  })

  it("movimento di un altro registro (o inesistente) nell'elenco: Error", async () => {
    const { lettore } = nuovo()
    const altro = fakeTx({ movimenti: [movimento('m1', { registroId: 'altro' })] })
    await expect(lettore.leggi(altro, T, REG, ['m1'])).rejects.toThrow(/errore di programmazione/)
    const mancante = fakeTx({ movimenti: [] })
    await expect(lettore.leggi(mancante, T, REG, ['m1'])).rejects.toThrow(
      /errore di programmazione/
    )
  })

  it('elenco vuoto: nessuna query', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({})
    expect(await lettore.leggi(tx, T, REG, [])).toEqual([])
    expect(tx.wasteMovement.findMany).not.toHaveBeenCalled()
  })

  it('riferimenti di carico dal FIFO: carico vigente e apertura con origini', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [
        movimento('s1', {
          type: 'SCARICO',
          causale: 'CONFERIMENTO_TRASPORTATORE',
          quantity: 150,
          progressiveNumber: 3,
          movementDate: new Date('2026-03-05T10:00:00Z'),
        }),
      ],
      vigenti: [
        {
          id: 'c1',
          type: 'CARICO',
          movementDate: new Date('2026-03-01T10:00:00Z'),
          quantity: 100,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 1,
        },
        {
          id: 's1',
          type: 'SCARICO',
          movementDate: new Date('2026-03-05T10:00:00Z'),
          quantity: 150,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 3,
        },
      ],
      aperture: [
        {
          id: 'ap1',
          registroId: REG,
          cerCode: '15 01 01',
          quantita: 50,
          unita: 'KG',
          dataRiferimento: new Date('2026-01-01T00:00:00Z'),
          origini: [{ anno: 2025, protocollo: 7 }],
        },
      ],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['s1'])
    expect(a.riferimentiCarico).toEqual([
      { anno: 2025, progressivo: 7 },
      { anno: 2026, progressivo: 1 },
    ])
  })

  it("origini malformate: nessun riferimento da quell'apertura, con warn senza dati", async () => {
    const { lettore, l } = nuovo()
    const tx = fakeTx({
      movimenti: [
        movimento('s1', {
          type: 'SCARICO',
          quantity: 10,
          movementDate: new Date('2026-03-05T10:00:00Z'),
        }),
      ],
      vigenti: [
        {
          id: 's1',
          type: 'SCARICO',
          movementDate: new Date('2026-03-05T10:00:00Z'),
          quantity: 10,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 3,
        },
      ],
      aperture: [
        {
          id: 'ap1',
          registroId: REG,
          cerCode: '15 01 01',
          quantita: 50,
          unita: 'KG',
          dataRiferimento: new Date('2026-01-01T00:00:00Z'),
          origini: [{ anno: '2025', protocollo: 7.5 }],
        },
      ],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['s1'])
    expect(a.riferimentiCarico).toEqual([])
    expect(l.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(l.warn.mock.calls)).not.toMatch(/ap1|2025/)
  })

  it('quantita <= 0,001 fra le vigenti: esclusa con warn senza id, nessun errore del FIFO', async () => {
    const { lettore, l } = nuovo()
    const tx = fakeTx({
      movimenti: [
        movimento('s1', {
          type: 'SCARICO',
          quantity: 10,
          movementDate: new Date('2026-03-05T10:00:00Z'),
        }),
      ],
      vigenti: [
        {
          id: 'c1',
          type: 'CARICO',
          movementDate: new Date('2026-03-01T10:00:00Z'),
          quantity: 0.0004,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 1,
        },
        {
          id: 'c2',
          type: 'CARICO',
          movementDate: new Date('2026-03-02T10:00:00Z'),
          quantity: 20,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 2,
        },
        {
          id: 's1',
          type: 'SCARICO',
          movementDate: new Date('2026-03-05T10:00:00Z'),
          quantity: 10,
          unit: 'KG',
          cerCode: '15 01 01',
          progressiveYear: 2026,
          progressiveNumber: 3,
        },
      ],
    })
    const [a] = await lettore.leggi(tx, T, REG, ['s1'])
    expect(a.riferimentiCarico).toEqual([{ anno: 2026, progressivo: 2 }])
    expect(l.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(l.warn.mock.calls)).not.toMatch(/c1|s1/)
  })

  it('numero di query fisso: indipendente dal numero di annotazioni', async () => {
    const conta = async (n: number) => {
      const { lettore } = nuovo()
      const movs = Array.from({ length: n }, (_, i) =>
        movimento(`m${i}`, { firId: 'fir-1', progressiveNumber: i + 1 })
      )
      const tx = fakeTx({
        movimenti: movs,
        firs: [fir()],
        produttori: [{ id: 'p1', dittaId: 'd1', ditta: ditta(), sede }],
        comuni: [{ code: '058091', name: 'Roma', provinciaSigla: 'RM' }],
      })
      await lettore.leggi(
        tx,
        T,
        REG,
        movs.map(m => m.id)
      )
      return Object.values(tx).reduce(
        (somma: number, delegato: any) => somma + (delegato.findMany?.mock?.calls.length ?? 0),
        0
      )
    }
    expect(await conta(1)).toBe(await conta(25))
  })

  it('ogni query porta il tenantId', async () => {
    const { lettore } = nuovo()
    const tx = fakeTx({
      movimenti: [movimento('m1', { firId: 'fir-1' })],
      firs: [fir()],
      produttori: [{ id: 'p1', dittaId: 'd1', ditta: ditta(), sede }],
      comuni: [{ code: '058091', name: 'Roma', provinciaSigla: 'RM' }],
    })
    await lettore.leggi(tx, T, REG, ['m1'])
    for (const nome of ['wasteMovement', 'fIR', 'produttore', 'causaleRegistroAzienda']) {
      for (const [args] of tx[nome].findMany.mock.calls) {
        expect(JSON.stringify(args.where)).toContain(T)
      }
    }
  })
})
