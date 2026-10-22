import { MudAggregazioneService } from './mud-aggregazione.service'
import { controlliMud, haBloccanti, type MudEsitoControllo } from './mud-controlli'

describe('MudAggregazioneService', () => {
  let service: MudAggregazioneService
  let prisma: any
  let referenceData: any
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  const mov = (p: Partial<any>) => ({
    progressiveNumber: 1,
    progressiveYear: 2025,
    type: 'CARICO',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '17 04 05',
    quantity: 100,
    unit: 'KG',
    operationCode: null,
    firId: null,
    firIdRicopia: null,
    ricopiaChiave: '',
    counterpartName: null,
    movementDate: new Date('2025-06-10T08:00:00Z'),
    ...p,
  })
  const scarico = (p: Partial<any>) =>
    mov({ type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE', ...p })
  const fir = (p: Partial<any>) => ({
    id: 'f1',
    firNumber: 'FIR-2025-000123',
    rentriNumeroFir: null,
    status: 'COMPLETED',
    rentriStatoFormulario: null,
    wasteOperationType: 'DISPOSAL',
    wasteOperationCode: null,
    receiverId: 'dest-1',
    receiverName: 'Recupero Metalli Srl',
    receiverPartitaIva: '33333333333',
    carrierId: 'car-1',
    carrierName: 'Trasporti Srl',
    carrierPartitaIva: '22222222222',
    ...p,
  })
  const destinatarioDest1 = {
    id: 'dest-1',
    partitaIVA: '33333333333',
    ragioneSociale: 'Recupero Metalli Srl',
    comune: 'Milano',
    provincia: 'MI',
    via: 'Via Roma',
    civico: '1',
    cap: '20100',
  }
  const integrazioni = (i: any) =>
    prisma.mUDReport.findUnique.mockResolvedValue({ reportData: { integrazioni: i } })

  // Le query su wasteMovement e fIR sono più d'una: si distinguono dal `where`.
  const impostaDati = (d: {
    movimenti?: any[]
    firCollegati?: any[]
    firAnno?: any[]
    scarichiDeiFirAnno?: any[]
  }) => {
    prisma.wasteMovement.findMany.mockImplementation(async (args: any) =>
      args.where.type === 'SCARICO' ? (d.scarichiDeiFirAnno ?? []) : (d.movimenti ?? [])
    )
    prisma.fIR.findMany.mockImplementation(async (args: any) => {
      if (args.where.id?.in) {
        return (d.firCollegati ?? []).filter(f => args.where.id.in.includes(f.id))
      }
      if (args.where.status) return d.firAnno ?? []
      return []
    })
  }

  const codici = (c: MudEsitoControllo[]) => c.map(e => e.codice)
  const conCodice = (c: MudEsitoControllo[], codice: string) => c.filter(e => e.codice === codice)

  beforeEach(() => {
    prisma = {
      wasteMovement: { findMany: jest.fn().mockResolvedValue([]) },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
      destinatario: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ city: 'Roma', province: 'RM', atecoCode: '38.11.00' }),
      },
      rentriUnitaLocale: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ denominazione: 'Sede', numIscrSito: 'OP1', principale: true }]),
      },
      mUDReport: { findUnique: jest.fn().mockResolvedValue(null) },
    }
    referenceData = { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) }
    service = new MudAggregazioneService(prisma, referenceData, logger)
  })

  // 1
  it("legge il registro del tenant nella finestra dell'anno italiano", async () => {
    impostaDati({ movimenti: [mov({})] })

    await service.aggrega('t1', 2025)

    expect(prisma.wasteMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 't1',
          movementDate: {
            gte: new Date('2024-12-31T23:00:00.000Z'),
            lt: new Date('2025-12-31T23:00:00.000Z'),
          },
        },
      })
    )
    expect(prisma.mUDReport.findUnique).toHaveBeenCalledWith({
      where: { tenantId_year: { tenantId: 't1', year: 2025 } },
      select: { reportData: true },
    })
  })

  const unitaMiste = () => [
    mov({ progressiveNumber: 1, quantity: 1, unit: 't' }),
    mov({ progressiveNumber: 2, quantity: 500, unit: 'KG' }),
    mov({ progressiveNumber: 3, quantity: 200, unit: 'kg' }),
    mov({ progressiveNumber: 4, quantity: 30, unit: 'litri' }),
  ]

  // 2
  it('somma in kg unità miste dello stesso CER e blocca i litri senza peso specifico', async () => {
    impostaDati({ movimenti: unitaMiste() })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toHaveLength(1)
    expect(r.righe[0]).toEqual(expect.objectContaining({ cerCode: '170405', prodottoKg: 1700 }))
    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'UNITA_NON_DI_MASSA',
        gravita: 'BLOCCANTE',
        movimenti: [
          expect.objectContaining({ numero: 4, quantita: 30, unita: 'litri', incluso: false }),
        ],
        integrazione: {
          tipo: 'PESO_SPECIFICO',
          chiave: '170405|LITRI',
          cerCode: '170405',
          unita: 'LITRI',
        },
      })
    )
    expect(haBloccanti(r.controlli)).toBe(true)
    expect(r.movimentiPerCer['170405']).toBe(3)
  })

  // 3
  it('con il peso specifico i litri entrano nel MUD con un avviso', async () => {
    impostaDati({ movimenti: unitaMiste() })
    integrazioni({
      destinatari: {},
      pesiSpecifici: { '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.2 } },
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].prodottoKg).toBe(1736)
    expect(r.movimentiPerCer['170405']).toBe(4)
    expect(r.controlli).toContainEqual(
      expect.objectContaining({ codice: 'CONVERTITO_CON_PESO_SPECIFICO', gravita: 'AVVISO' })
    )
    expect(codici(r.controlli)).not.toContain('UNITA_NON_DI_MASSA')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 4
  it('un CER tutto in m3 senza peso specifico non sparisce in silenzio', async () => {
    impostaDati({
      movimenti: [scarico({ cerCode: '20 03 04', quantity: 5, unit: 'm3', counterpartName: 'X' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toEqual([])
    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'UNITA_NON_DI_MASSA',
        gravita: 'BLOCCANTE',
        integrazione: expect.objectContaining({ cerCode: '200304' }),
      })
    )
  })

  // 5
  it('unità vuota vale kg con un avviso', async () => {
    impostaDati({ movimenti: [mov({ quantity: 50, unit: '' })] })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].prodottoKg).toBe(50)
    expect(codici(r.controlli)).toContain('UNITA_VUOTA_COME_KG')
  })

  // 6
  it('CER scritti in modo diverso finiscono nella stessa riga', async () => {
    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, cerCode: '17 04 05' }),
        mov({ progressiveNumber: 2, cerCode: '170405' }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toHaveLength(1)
    expect(r.righe[0].prodottoKg).toBe(200)
    expect(r.movimentiPerCer).toEqual({ '170405': 2 })
  })

  // 7
  it('causali escluse entrano negli avvisi con la quantità', async () => {
    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, quantity: 100 }),
        mov({ progressiveNumber: 3, quantity: 40, causale: 'RICLASSIFICAZIONE' }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].prodottoKg).toBe(100)
    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'CAUSALE_ESCLUSA',
        gravita: 'AVVISO',
        movimenti: [expect.objectContaining({ numero: 3, quantita: 40, incluso: false })],
      })
    )
  })

  // 8
  it('un carico ricevuto da terzi è escluso con PROFILO_NON_SUPPORTATO', async () => {
    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, quantity: 100 }),
        mov({ progressiveNumber: 2, quantity: 50, causale: 'INGRESSO_ESTERNO' }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].prodottoKg).toBe(100)
    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'PROFILO_NON_SUPPORTATO',
        gravita: 'AVVISO',
        movimenti: [expect.objectContaining({ numero: 2, incluso: false })],
      })
    )
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 9
  it("più unità locali attive: avviso con l'elenco", async () => {
    const sedi = [
      { denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
      { denominazione: 'Deposito', numIscrSito: 'OP2', principale: false },
    ]
    prisma.rentriUnitaLocale.findMany.mockResolvedValue(sedi)
    impostaDati({ movimenti: [mov({})] })

    const r = await service.aggrega('t1', 2025)

    expect(prisma.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', attiva: true } })
    )
    expect(r.controlli).toContainEqual(controlliMud.piuUnitaLocali(sedi))
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 10
  it('scarico con FIR: DR del destinatario con la quantità del movimento in kg e TE del trasportatore', async () => {
    impostaDati({
      movimenti: [scarico({ quantity: 2, unit: 't', firId: 'f1', operationCode: 'R13' })],
      firCollegati: [fir({ wasteOperationType: 'DISPOSAL' })],
    })
    prisma.destinatario.findMany.mockResolvedValue([destinatarioDest1])

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].recuperoKg).toBe(2000)
    expect(r.righe[0].smaltimentoKg).toBe(0)
    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({
        codiceFiscale: '33333333333',
        quantitaKg: 2000,
        istatProvincia: '015',
        istatComune: '146',
      }),
    ])
    expect(r.righe[0].te![0].codiceFiscale).toBe('22222222222')
    expect(prisma.fIR.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', id: { in: ['f1'] } } })
    )
  })

  // 11
  it.each([
    {
      caso: 'operationCode D15 e FIR RECOVERY danno D',
      movimento: { operationCode: 'D15', firId: 'f1' },
      firP: { wasteOperationType: 'RECOVERY' },
      atteso: 'D',
      avviso: undefined,
    },
    {
      caso: 'causale AVVIO_RECUPERO, nessun codice, FIR DISPOSAL danno R',
      movimento: { causale: 'AVVIO_RECUPERO', firId: 'f1' },
      firP: { wasteOperationType: 'DISPOSAL' },
      atteso: 'R',
      avviso: undefined,
    },
    {
      caso: 'CONFERIMENTO_TRASPORTATORE con FIR wasteOperationCode R4 dà R',
      movimento: { firId: 'f1' },
      firP: { wasteOperationCode: 'R4', wasteOperationType: 'DISPOSAL' },
      atteso: 'R',
      avviso: undefined,
    },
    {
      caso: 'solo FIR RECOVERY dà R con OPERAZIONE_DEDOTTA_DAL_FIR',
      movimento: { firId: 'f1' },
      firP: { wasteOperationType: 'RECOVERY' },
      atteso: 'R',
      avviso: 'OPERAZIONE_DEDOTTA_DAL_FIR',
    },
    {
      caso: 'senza FIR né codice dà D con OPERAZIONE_NON_INDICATA',
      movimento: { counterpartName: 'Ecologia Srl' },
      firP: undefined,
      atteso: 'D',
      avviso: 'OPERAZIONE_NON_INDICATA',
    },
  ])(
    'ordine di risoluzione recupero/smaltimento: $caso',
    async ({ movimento, firP, atteso, avviso }) => {
      impostaDati({
        movimenti: [scarico({ quantity: 300, ...movimento })],
        firCollegati: firP ? [fir(firP)] : [],
      })
      integrazioni({
        destinatari: {
          'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
        },
        pesiSpecifici: {},
      })

      const r = await service.aggrega('t1', 2025)

      expect(r.righe[0].recuperoKg).toBe(atteso === 'R' ? 300 : 0)
      expect(r.righe[0].smaltimentoKg).toBe(atteso === 'D' ? 300 : 0)
      const deduzioni = ['OPERAZIONE_DEDOTTA_DAL_FIR', 'OPERAZIONE_NON_INDICATA']
      expect(codici(r.controlli).filter(c => deduzioni.includes(c))).toEqual(avviso ? [avviso] : [])
    }
  )

  // 12
  it('FIR annullato a dicembre: lo scarico collegato è escluso con un avviso', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 12,
          firId: 'f1',
          movementDate: new Date('2025-12-15T09:00:00Z'),
        }),
      ],
      firCollegati: [fir({ status: 'CANCELLED' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toEqual([])
    const annullati = conCodice(r.controlli, 'FIR_ANNULLATO')
    expect(annullati).toEqual([
      expect.objectContaining({
        codice: 'FIR_ANNULLATO',
        gravita: 'AVVISO',
        movimenti: [expect.objectContaining({ numero: 12, incluso: false })],
      }),
    ])
    expect(annullati[0].messaggio).toContain('FIR FIR-2025-000123')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 13
  it("FIR annullato all'ente: escluso", async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' }), mov({ progressiveNumber: 2 })],
      firCollegati: [fir({ status: 'AWAITING_CARRIER', rentriStatoFormulario: 'Annullato' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(codici(r.controlli)).toContain('FIR_ANNULLATO')
    expect(r.righe[0].smaltimentoKg).toBe(0)
  })

  // 14
  it.each(['DRAFT', 'AWAITING_PRODUCER'])(
    'FIR in bozza o in attesa del produttore, senza numero RENTRI: escluso con avviso (%s)',
    async status => {
      impostaDati({
        movimenti: [scarico({ firId: 'f1' }), mov({ progressiveNumber: 2 })],
        firCollegati: [fir({ status })],
      })

      const r = await service.aggrega('t1', 2025)

      expect(codici(r.controlli)).toContain('FIR_IN_BOZZA')
      expect(r.righe[0].smaltimentoKg).toBe(0)
    }
  )

  // 15
  it('FIR in bozza locale con numero RENTRI: lo scarico entra', async () => {
    impostaDati({
      movimenti: [scarico({ quantity: 70, firId: 'f1' })],
      firCollegati: [fir({ status: 'DRAFT', rentriNumeroFir: 'RENTRI-1' })],
    })
    prisma.destinatario.findMany.mockResolvedValue([destinatarioDest1])

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(70)
    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({ codiceFiscale: '33333333333', quantitaKg: 70 }),
    ])
    expect(codici(r.controlli)).not.toContain('FIR_IN_BOZZA')
  })

  // 16
  it("FIR collegato ma non dell'azienda", async () => {
    impostaDati({
      movimenti: [scarico({ quantity: 60, firId: 'f-altro', counterpartName: 'Ecologia Srl' })],
      firCollegati: [],
    })

    const r = await service.aggrega('t1', 2025)

    expect(codici(r.controlli)).toContain('FIR_NON_TROVATO')
    expect(r.righe[0].smaltimentoKg).toBe(60)
    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({
        codiceFiscale: '',
        ragioneSociale: 'Ecologia Srl',
        quantitaKg: 60,
      }),
    ])
  })

  const scaricoSenzaFir = (p: Partial<any> = {}) =>
    scarico({
      progressiveNumber: 5,
      quantity: 300,
      unit: 'KG',
      causale: 'AVVIO_SMALTIMENTO',
      counterpartName: 'Ecologia Srl',
      ...p,
    })

  // 17
  it('scarico senza FIR: entra, con il destinatario del registro, e il CF mancante blocca', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir()] })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(300)
    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({
        codiceFiscale: '',
        ragioneSociale: 'Ecologia Srl',
        quantitaKg: 300,
      }),
    ])
    expect(r.controlli).toContainEqual(
      expect.objectContaining({ codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO' })
    )
    expect(r.controlli).toContainEqual(
      controlliMud.destinatarioSenzaCf('Ecologia Srl', 'dal registro', 2025)
    )
    expect(haBloccanti(r.controlli)).toBe(true)
  })

  // 18
  it('il CF delle integrazioni completa il DR', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir()] })
    integrazioni({
      destinatari: {
        'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      },
      pesiSpecifici: {},
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].dr![0].codiceFiscale).toBe('12345678903')
    expect(codici(r.controlli)).not.toContain('DESTINATARIO_SENZA_CF')
  })

  // 19
  it('scarico senza FIR né destinatario: quantità nel MUD, nessun DR', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir({ counterpartName: null })] })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(300)
    expect(r.righe[0].dr).toEqual([])
    expect(codici(r.controlli)).toContain('DESTINATARIO_NON_INDICATO')
  })

  // 20
  it('stesso FIR scaricato due volte con dati diversi', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, quantity: 100, firId: 'f1' }),
        scarico({ progressiveNumber: 9, quantity: 80, firId: 'f1' }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'FIR_SCARICATO_PIU_VOLTE',
        gravita: 'AVVISO',
        movimenti: [
          expect.objectContaining({ numero: 7, incluso: true }),
          expect.objectContaining({ numero: 9, incluso: true }),
        ],
      })
    )
    expect(r.righe[0].smaltimentoKg).toBe(180)
  })

  // 21
  it('due scarichi identici dello stesso FIR si contano una volta', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, quantity: 300, firId: 'f1', firIdRicopia: 'f1' }),
        scarico({ progressiveNumber: 9, quantity: 300, firId: 'f1', firIdRicopia: 'f1' }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(300)
    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'FIR_DOPPIO_IDENTICO',
        movimenti: [
          expect.objectContaining({ numero: 7, incluso: true }),
          expect.objectContaining({ numero: 9, incluso: false }),
        ],
      })
    )
    expect(codici(r.controlli)).not.toContain('FIR_SCARICATO_PIU_VOLTE')
  })

  it('dopo il piano C due scarichi dello stesso FIR con date diverse non sono doppi', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 7,
          quantity: 300,
          firId: 'f1',
          firIdRicopia: 'f1',
          movementDate: new Date('2025-06-10T00:00:00Z'),
        }),
        scarico({
          progressiveNumber: 9,
          quantity: 300,
          firId: 'f1',
          firIdRicopia: 'f1',
          movementDate: new Date('2025-06-12T00:00:00Z'),
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(600)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_IDENTICO')
    expect(codici(r.controlli)).toContain('FIR_SCARICATO_PIU_VOLTE')
  })

  it('due quote uguali con chiavi diverse contano entrambe', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 7,
          quantity: 300,
          firId: 'f1',
          firIdRicopia: 'f1',
          ricopiaChiave: 'prod:a',
        }),
        scarico({
          progressiveNumber: 9,
          quantity: 300,
          firId: 'f1',
          firIdRicopia: 'f1',
          ricopiaChiave: 'prod:b',
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(600)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_IDENTICO')
    // Preflight F21: l'avviso dei più scarichi dello stesso FIR resta per FIR, anche per le quote.
    expect(codici(r.controlli)).toContain('FIR_SCARICATO_PIU_VOLTE')
    // La chiave si legge dal database: senza la select i movimenti reali non l'avrebbero.
    expect(prisma.wasteMovement.findMany.mock.calls[0][0].select).toMatchObject({
      ricopiaChiave: true,
    })
  })

  // 22
  it('esito del FIR respinto o parziale', async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [fir({ rentriStatoFormulario: 'RespintoAccettatoParzialmente' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(codici(r.controlli)).toContain('ESITO_FIR_RESPINTO')
  })

  // 23
  it('destinatario del FIR senza CF blocca, senza ISTAT avvisa', async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [fir({ receiverId: null, receiverPartitaIva: '' })],
    })

    const senzaCf = await service.aggrega('t1', 2025)

    expect(senzaCf.controlli).toContainEqual(
      controlliMud.destinatarioSenzaCf('Recupero Metalli Srl', 'FIR FIR-2025-000123', 2025)
    )

    // Il comune del dichiarante si risolve, quello del destinatario no.
    impostaDati({ movimenti: [scarico({ firId: 'f1' })], firCollegati: [fir({})] })
    prisma.destinatario.findMany.mockResolvedValue([destinatarioDest1])
    referenceData.findComuneByName.mockImplementation(async (nome: string) =>
      nome === 'Roma' ? { code: '058091' } : undefined
    )

    const senzaIstat = await service.aggrega('t1', 2025)

    expect(senzaIstat.controlli).toContainEqual(
      controlliMud.destinatarioSenzaIstat('Recupero Metalli Srl')
    )
    expect(codici(senzaIstat.controlli)).not.toContain('DICHIARANTE_SENZA_COMUNE_ISTAT')
    expect(codici(senzaIstat.controlli)).not.toContain('DESTINATARIO_SENZA_CF')
  })

  // 24
  it("cerca i destinatari solo dentro l'azienda", async () => {
    // Il servizio usa il client Prisma SENZA estensione RLS: il perimetro
    // dell'azienda deve stare nella query, altrimenti l'anagrafica di un
    // destinatario omonimo di un altro tenant finirebbe nel MUD.
    impostaDati({ movimenti: [scarico({ firId: 'f1' })], firCollegati: [fir({})] })

    await service.aggrega('t1', 2025)

    expect(prisma.destinatario.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['dest-1'] }, tenantId: 't1' },
    })
  })

  const firEmessi = [
    { id: 'f1', firNumber: 'FIR-2025-000123', rentriNumeroFir: null },
    { id: 'f2', firNumber: 'FIR-2025-000124', rentriNumeroFir: null },
    { id: 'f3', firNumber: 'FIR-2025-000125', rentriNumeroFir: null },
  ]

  // 25
  it('registro vuoto con FIR emessi blocca', async () => {
    impostaDati({ movimenti: [], firAnno: firEmessi })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'REGISTRO_VUOTO_CON_FIR',
        gravita: 'BLOCCANTE',
        messaggio:
          'Il registro di carico e scarico del 2025 non ha movimenti, ma risultano 3 FIR emessi con trasporto nel 2025: il MUD si compila dal registro. Registrare i movimenti prima di generare il file.',
      })
    )
    expect(codici(r.controlli)).not.toContain('NESSUN_MOVIMENTO')
  })

  // 26
  it("i FIR dell'anno sono solo quelli emessi e non annullati", async () => {
    impostaDati({ movimenti: [] })

    await service.aggrega('t1', 2025)

    expect(prisma.fIR.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't1',
        status: { in: ['AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED', 'SYNCED_TO_RENTRI'] },
        signatures: { some: { role: 'TRASPORTATORE' } },
        transportDate: {
          gte: new Date('2024-12-31T23:00:00.000Z'),
          lt: new Date('2025-12-31T23:00:00.000Z'),
        },
        OR: [{ rentriStatoFormulario: null }, { rentriStatoFormulario: { not: 'Annullato' } }],
      },
      select: expect.anything(),
    })
  })

  // 27
  it('FIR emesso non scaricato nel registro avvisa', async () => {
    impostaDati({
      movimenti: [mov({})],
      firAnno: firEmessi.slice(0, 2),
      scarichiDeiFirAnno: [{ firId: 'f1' }],
    })

    const r = await service.aggrega('t1', 2025)

    expect(prisma.wasteMovement.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', type: 'SCARICO', firId: { in: ['f1', 'f2'] } },
      select: { firId: true },
    })
    expect(r.controlli).toContainEqual(
      expect.objectContaining({ codice: 'FIR_NON_REGISTRATO', fir: ['FIR-2025-000124'] })
    )
  })

  // 28
  it('anno senza movimenti né FIR', async () => {
    impostaDati({ movimenti: [] })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toEqual([])
    expect(r.controlli).toEqual([controlliMud.nessunMovimento(2025)])
  })

  // 29
  it('avviso sulle giacenze quando ci sono righe', async () => {
    impostaDati({ movimenti: [mov({})] })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(controlliMud.giacenzeNonCalcolate(2025))
  })

  // 30
  it('dichiarante senza ATECO o senza comune ISTAT blocca', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({ city: 'Roma', province: 'RM', atecoCode: null })

    const senzaAteco = await service.aggrega('t1', 2025)

    expect(senzaAteco.controlli).toContainEqual(controlliMud.dichiaranteSenzaAteco())

    prisma.tenant.findUnique.mockResolvedValue({
      city: 'Roma',
      province: 'RM',
      atecoCode: '38.11.00',
    })
    referenceData.findComuneByName.mockResolvedValue(undefined)

    const senzaComune = await service.aggrega('t1', 2025)

    expect(senzaComune.controlli).toContainEqual(
      controlliMud.dichiaranteSenzaComuneIstat('Roma', 'RM')
    )
    expect(haBloccanti(senzaComune.controlli)).toBe(true)
  })

  // 31
  it('doppi storici con date diverse si contano una volta', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 7,
          quantity: 300,
          firId: 'f1',
          movementDate: new Date('2025-06-10T00:00:00Z'),
        }),
        scarico({
          progressiveNumber: 9,
          quantity: 300,
          firId: 'f1',
          movementDate: new Date('2025-06-12T00:00:00Z'),
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(300)
    const doppi = conCodice(r.controlli, 'FIR_DOPPIO_IDENTICO')
    expect(doppi).toHaveLength(1)
    expect(doppi[0].movimenti).toEqual([
      expect.objectContaining({ numero: 7, incluso: true }),
      expect.objectContaining({ numero: 9, incluso: false }),
    ])
    expect(doppi[0].messaggio).toContain('n. 7/2025 del 10/06/2025, 9/2025 del 12/06/2025')
    expect(codici(r.controlli)).not.toContain('FIR_SCARICATO_PIU_VOLTE')
  })

  // 32
  it('il doppio si confronta con ogni movimento già contato', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 1,
          quantity: 100,
          firId: 'f1',
          movementDate: new Date('2025-06-10T00:00:00Z'),
        }),
        scarico({
          progressiveNumber: 2,
          quantity: 80,
          firId: 'f1',
          movementDate: new Date('2025-06-11T00:00:00Z'),
        }),
        scarico({
          progressiveNumber: 3,
          quantity: 100,
          firId: 'f1',
          movementDate: new Date('2025-06-12T00:00:00Z'),
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(180)
    const numeri = (codice: string) =>
      conCodice(r.controlli, codice).map(e => e.movimenti!.map(m => m.numero))
    expect(numeri('FIR_DOPPIO_IDENTICO')).toEqual([[1, 3]])
    expect(numeri('FIR_SCARICATO_PIU_VOLTE')).toEqual([[1, 2]])
  })

  it("l'originale di un doppio escluso dal FIR annullato risulta non incluso", async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, firId: 'f1' }),
        scarico({ progressiveNumber: 9, firId: 'f1' }),
      ],
      firCollegati: [fir({ status: 'CANCELLED' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(conCodice(r.controlli, 'FIR_DOPPIO_IDENTICO')[0].movimenti).toEqual([
      expect.objectContaining({ numero: 7, incluso: false }),
      expect.objectContaining({ numero: 9, incluso: false }),
    ])
    expect(conCodice(r.controlli, 'FIR_ANNULLATO')).toHaveLength(1)
  })

  // 33
  it('uno scarico in m3 collegato a un FIR annullato dà solo FIR_ANNULLATO', async () => {
    impostaDati({
      movimenti: [scarico({ cerCode: '20 03 04', quantity: 5, unit: 'm3', firId: 'f1' })],
      firCollegati: [fir({ status: 'CANCELLED' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(codici(r.controlli)).toContain('FIR_ANNULLATO')
    expect(codici(r.controlli)).not.toContain('UNITA_NON_DI_MASSA')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 34
  it('lo stesso destinatario con e senza FIR diventa un solo DR', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 1, quantity: 100, firId: 'f1' }),
        scarico({ progressiveNumber: 2, quantity: 50, counterpartName: 'Recupero Metalli Srl' }),
      ],
      firCollegati: [fir({})],
    })
    prisma.destinatario.findMany.mockResolvedValue([destinatarioDest1])
    integrazioni({
      destinatari: {
        'RECUPERO METALLI SRL': {
          ragioneSociale: 'Recupero Metalli Srl',
          codiceFiscale: '33333333333',
        },
      },
      pesiSpecifici: {},
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].dr).toHaveLength(1)
    expect(r.righe[0].dr![0]).toEqual(
      expect.objectContaining({ codiceFiscale: '33333333333', quantitaKg: 150, cap: '20100' })
    )
  })
})
