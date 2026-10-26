import { MudAggregazioneService } from './mud-aggregazione.service'
import { hashAggregato, limitiAnnoMud } from './mud-regole'
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
    /** movimenti registrati prima dell'anno, restituiti per i FIR richiesti */
    precedenti?: any[]
  }) => {
    prisma.wasteMovement.findMany.mockImplementation(async (args: any) => {
      if (args.where.type === 'SCARICO') return d.scarichiDeiFirAnno ?? []
      if (args.where.movementDate && !args.where.movementDate.gte) {
        return (d.precedenti ?? []).filter(p => args.where.firId.in.includes(p.firId))
      }
      return d.movimenti ?? []
    })
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
      wasteMovement: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      fIR: { findMany: jest.fn().mockResolvedValue([]) },
      destinatario: { findMany: jest.fn().mockResolvedValue([]) },
      trasportatore: { findMany: jest.fn().mockResolvedValue([]) },
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

  describe('stato fisico dal registro (A-W-11)', () => {
    it('un CER tutto liquido esce liquido', async () => {
      impostaDati({
        movimenti: [
          mov({ cerCode: '20 03 04', quantity: 10, unit: 'litri', wastePhysicalState: 'Liquido' }),
          mov({
            progressiveNumber: 2,
            cerCode: '20 03 04',
            quantity: 5,
            unit: 'litri',
            wastePhysicalState: 'liquido',
          }),
        ],
      })
      integrazioni({
        destinatari: {},
        pesiSpecifici: { '200304|LITRI': { cerCode: '200304', unita: 'LITRI', kgPerUnita: 1 } },
      })

      const r = await service.aggrega('t1', 2025)

      expect(r.righe[0].statoFisico).toBe('LIQUIDO')
      expect(codici(r.controlli)).not.toContain('STATO_FISICO_NON_UNIVOCO')
    })

    it('senza stato nel registro la riga non lo valorizza (default del tracciato)', async () => {
      impostaDati({ movimenti: [mov({ wastePhysicalState: null }), mov({ progressiveNumber: 2 })] })
      const r = await service.aggrega('t1', 2025)
      expect(r.righe[0].statoFisico).toBeUndefined()
      expect(codici(r.controlli)).not.toContain('STATO_FISICO_NON_UNIVOCO')
    })

    it('stati diversi avvisano e non valorizzano lo stato', async () => {
      impostaDati({
        movimenti: [
          mov({ wastePhysicalState: 'Liquido' }),
          mov({ progressiveNumber: 2, wastePhysicalState: 'Solido' }),
        ],
      })
      const r = await service.aggrega('t1', 2025)
      expect(r.righe[0].statoFisico).toBeUndefined()
      expect(conCodice(r.controlli, 'STATO_FISICO_NON_UNIVOCO')).toEqual([
        controlliMud.statoFisicoNonUnivoco('170405', ['LIQUIDO', 'SOLIDO_NON_POLVERULENTO']),
      ])
    })

    it("un CER pericoloso con stati diversi è mostrato con l'asterisco", async () => {
      impostaDati({
        movimenti: [
          mov({ cerCode: '160601', wastePhysicalState: 'Liquido' }),
          mov({ progressiveNumber: 2, cerCode: '16 06 01*', wastePhysicalState: 'Solido' }),
        ],
      })
      const r = await service.aggrega('t1', 2025)
      expect(conCodice(r.controlli, 'STATO_FISICO_NON_UNIVOCO')[0].messaggio).toMatch(
        /^Il rifiuto CER 16 06 01\* è registrato con stati fisici diversi/
      )
    })

    it('uno stato non riconosciuto avvisa invece di cadere in silenzio sul predefinito', async () => {
      impostaDati({ movimenti: [mov({ wastePhysicalState: 'Rifiuto strano' })] })
      const r = await service.aggrega('t1', 2025)
      expect(r.righe[0].statoFisico).toBeUndefined()
      expect(conCodice(r.controlli, 'STATO_FISICO_NON_UNIVOCO')).toEqual([
        controlliMud.statoFisicoNonUnivoco('170405', ['NON_RICONOSCIUTO']),
      ])
    })

    it('liquido più vischioso avvisa', async () => {
      impostaDati({
        movimenti: [
          mov({ wastePhysicalState: 'Liquido' }),
          mov({ progressiveNumber: 2, wastePhysicalState: 'Vischioso' }),
        ],
      })
      const r = await service.aggrega('t1', 2025)
      expect(conCodice(r.controlli, 'STATO_FISICO_NON_UNIVOCO')).toHaveLength(1)
    })

    it('un movimento escluso non conta per lo stato', async () => {
      impostaDati({
        movimenti: [
          mov({ wastePhysicalState: 'Liquido' }),
          mov({
            progressiveNumber: 2,
            causale: 'CAUSALE_SCONOSCIUTA',
            wastePhysicalState: 'Solido',
          }),
        ],
      })
      const r = await service.aggrega('t1', 2025)
      expect(r.righe[0].statoFisico).toBe('LIQUIDO')
      expect(codici(r.controlli)).not.toContain('STATO_FISICO_NON_UNIVOCO')
    })
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
    expect(r.pericolosiPerCer).toEqual({})
  })

  it("il CER pericoloso è segnato a parte, senza cambiare le righe del file né l'hash", async () => {
    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, cerCode: '17 04 05' }),
        mov({ progressiveNumber: 2, cerCode: '170405*' }),
      ],
    })
    const pericoloso = await service.aggrega('t1', 2025)
    expect(pericoloso.pericolosiPerCer).toEqual({ '170405': true })

    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, cerCode: '17 04 05' }),
        mov({ progressiveNumber: 2, cerCode: '170405' }),
      ],
    })
    const nonPericoloso = await service.aggrega('t1', 2025)
    expect(nonPericoloso.pericolosiPerCer).toEqual({})
    expect(pericoloso.righe).toEqual(nonPericoloso.righe)
    expect(hashAggregato(pericoloso.righe)).toBe(hashAggregato(nonPericoloso.righe))
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

  it("MUD: con due sedi i numeri non cambiano e l'avviso PIU_UNITA_LOCALI non dice più che il registro non indica la sede", async () => {
    const sedi = [
      { denominazione: 'Sede', numIscrSito: 'OP1', principale: true },
      { denominazione: 'Deposito', numIscrSito: 'OP2', principale: false },
    ]
    impostaDati({ movimenti: [mov({})] })
    prisma.rentriUnitaLocale.findMany.mockResolvedValue([sedi[0]])
    const conUna = await service.aggrega('t1', 2025)

    impostaDati({ movimenti: [mov({})] })
    prisma.rentriUnitaLocale.findMany.mockResolvedValue(sedi)
    const conDue = await service.aggrega('t1', 2025)

    const senzaAvviso = (c: typeof conDue.controlli) =>
      c.filter(x => x.codice !== 'PIU_UNITA_LOCALI')
    expect({ ...conDue, controlli: senzaAvviso(conDue.controlli) }).toEqual({
      ...conUna,
      controlli: senzaAvviso(conUna.controlli),
    })
    const avviso = conDue.controlli.find(x => x.codice === 'PIU_UNITA_LOCALI')
    expect(avviso?.messaggio).toContain('tutti i registri')
    expect(avviso?.messaggio).not.toContain('il registro non indica la sede')
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
    // l'unico bloccante è che non resta nulla da dichiarare, non il FIR annullato
    expect(r.controlli.filter(c => c.gravita === 'BLOCCANTE').map(c => c.codice)).toEqual([
      'NESSUN_RIFIUTO_DICHIARABILE',
    ])
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
    // le integrazioni lette restano nell'aggregato: la traccia dell'export registra queste
    expect(r.integrazioni.destinatari['ECOLOGIA SRL']).toEqual(
      expect.objectContaining({ codiceFiscale: '12345678903' })
    )
  })

  // (confutazione dopo l'esecuzione, A-W-05)
  it('un DR estero non blocca: nazione al posto del CF e avviso', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir()] })
    integrazioni({
      destinatari: {
        'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '', nazione: 'Germania' },
      },
      pesiSpecifici: {},
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({ codiceFiscale: '', nazione: 'Germania', quantitaKg: 300 }),
    ])
    expect(r.controlli).toContainEqual(controlliMud.destinatarioEstero('Ecologia Srl', 'Germania'))
    // il comune ISTAT non serve a un destinatario estero
    expect(codici(r.controlli)).not.toContain('DESTINATARIO_SENZA_ISTAT')
    expect(codici(r.controlli)).not.toContain('DESTINATARIO_SENZA_CF')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 19
  it('scarico senza destinatario blocca con la voce del movimento', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir({ counterpartName: null })] })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(300)
    expect(r.righe[0].dr).toEqual([])
    expect(conCodice(r.controlli, 'DESTINATARIO_NON_INDICATO')).toEqual([
      expect.objectContaining({
        gravita: 'BLOCCANTE',
        messaggio:
          'Movimento n. 5/2025 (scarico CER 17 04 05, 300 KG): né FIR né destinatario nel registro, e il modulo DR è obbligatorio. Inserire destinatario e codice fiscale in MUD > Integrazioni 2025, riga "Movimento n. 5/2025".',
        integrazione: { tipo: 'DESTINATARIO_MOVIMENTO', chiave: '2025/5', numero: 5, anno: 2025 },
      }),
    ])
    expect(haBloccanti(r.controlli)).toBe(true)
  })

  // 19-bis (A-W-07, A-C-04)
  it('con il destinatario del movimento nelle integrazioni il BA è coerente', async () => {
    impostaDati({ movimenti: [scaricoSenzaFir({ counterpartName: null })] })
    integrazioni({
      destinatariMovimento: {
        '2025/5': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      },
    })

    const r = await service.aggrega('t1', 2025)

    const riga0 = r.righe[0]
    expect(riga0.dr).toEqual([
      { codiceFiscale: '12345678903', ragioneSociale: 'Ecologia Srl', quantitaKg: 300 },
    ])
    const consegnatoATerzi = riga0.dr!.reduce((s, d) => s + d.quantitaKg, 0)
    expect(consegnatoATerzi).toBe(riga0.smaltimentoKg + riga0.recuperoKg)
    expect(codici(r.controlli)).not.toContain('DESTINATARIO_NON_INDICATO')
    expect(codici(r.controlli)).not.toContain('DESTINATARIO_SENZA_CF')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  // 19-ter
  it('il destinatario del movimento integrato si fonde per CF con quello del registro', async () => {
    impostaDati({
      movimenti: [
        scaricoSenzaFir({ progressiveNumber: 5, counterpartName: 'Ecologia Srl' }),
        scaricoSenzaFir({ progressiveNumber: 6, counterpartName: null }),
      ],
    })
    integrazioni({
      destinatari: {
        'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      },
      destinatariMovimento: {
        '2025/6': { ragioneSociale: 'ECOLOGIA S.R.L.', codiceFiscale: 'IT12345678903' },
      },
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].dr).toEqual([
      expect.objectContaining({ codiceFiscale: '12345678903', quantitaKg: 600 }),
    ])
    expect(r.righe[0].smaltimentoKg).toBe(600)
  })

  // 19-quater (A-W-08)
  it('TE senza CF blocca, con le integrazioni si completa', async () => {
    const firSenzaCf = fir({ carrierId: null, carrierPartitaIva: '', carrierName: 'Trasporti Srl' })
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [firSenzaCf],
    })

    const bloccato = await service.aggrega('t1', 2025)

    expect(bloccato.righe[0].te).toEqual([{ codiceFiscale: '', ragioneSociale: 'Trasporti Srl' }])
    expect(conCodice(bloccato.controlli, 'TRASPORTATORE_SENZA_CF')).toEqual([
      controlliMud.trasportatoreSenzaCf('Trasporti Srl', 'FIR-2025-000123', 2025),
    ])
    expect(haBloccanti(bloccato.controlli)).toBe(true)

    integrazioni({
      trasportatori: {
        'TRASPORTI SRL': { ragioneSociale: 'Trasporti Srl', codiceFiscale: '22222222222' },
      },
    })
    const completato = await service.aggrega('t1', 2025)

    expect(completato.righe[0].te).toEqual([
      { codiceFiscale: '22222222222', ragioneSociale: 'Trasporti Srl' },
    ])
    expect(codici(completato.controlli)).not.toContain('TRASPORTATORE_SENZA_CF')
    expect(haBloccanti(completato.controlli)).toBe(false)
  })

  it('un solo TRASPORTATORE_SENZA_CF per ragione sociale, anche da FIR e CER diversi', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, firId: 'f1' }),
        scarico({ progressiveNumber: 8, firId: 'f2', cerCode: '15 01 01' }),
      ],
      firCollegati: [
        fir({ carrierId: null, carrierPartitaIva: '', carrierName: 'Trasporti Srl' }),
        fir({
          id: 'f2',
          firNumber: 'FIR-2025-000124',
          carrierId: null,
          carrierPartitaIva: '',
          carrierName: ' TRASPORTI   srl',
        }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(conCodice(r.controlli, 'TRASPORTATORE_SENZA_CF')).toHaveLength(1)
    // righe in ordine di CER: 150101 (FIR f2), poi 170405 (FIR f1)
    expect(r.righe.map(x => x.te)).toEqual([
      [{ codiceFiscale: '', ragioneSociale: 'TRASPORTI   srl' }],
      [{ codiceFiscale: '', ragioneSociale: 'Trasporti Srl' }],
    ])
  })

  it('TE con il solo nome: un modulo per ragione sociale nello stesso CER', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, firId: 'f1' }),
        scarico({ progressiveNumber: 8, firId: 'f2' }),
      ],
      firCollegati: [
        fir({ carrierId: null, carrierPartitaIva: '', carrierName: 'Trasporti Srl' }),
        fir({ id: 'f2', carrierId: null, carrierPartitaIva: '', carrierName: 'TRASPORTI SRL ' }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].te).toHaveLength(1)
  })

  it("il CF del trasportatore senza partita IVA sul FIR si prende dall'anagrafica", async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [fir({ carrierId: 'car-9', carrierPartitaIva: '', carrierName: '' })],
    })
    prisma.trasportatore.findMany.mockResolvedValue([
      { id: 'car-9', partitaIVA: '44444444444', ragioneSociale: 'Autotrasporti Rossi Srl' },
    ])

    const r = await service.aggrega('t1', 2025)

    expect(prisma.trasportatore.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', id: { in: ['car-9'] } } })
    )
    expect(r.righe[0].te).toEqual([
      { codiceFiscale: '44444444444', ragioneSociale: 'Autotrasporti Rossi Srl' },
    ])
    expect(codici(r.controlli)).not.toContain('TRASPORTATORE_SENZA_CF')
  })

  // Piano R, Minor 8 (deciso nel Task 10 del piano A): un nome segnaposto non diventa la chiave
  // di un'integrazione. Senza nome, partita IVA né anagrafica il trasportatore non è
  // identificato: avviso come per il FIR che non lo indica, nessun TE e nessuna riga da compilare.
  it('trasportatore senza nome, partita IVA né anagrafica: non identificato, nessuna integrazione', async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [fir({ carrierId: 'car-9', carrierPartitaIva: '', carrierName: ' ' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].te).toEqual([])
    expect(codici(r.controlli)).not.toContain('TRASPORTATORE_SENZA_CF')
    expect(conCodice(r.controlli, 'TRASPORTATORE_NON_INDICATO')).toHaveLength(1)
    expect(r.controlli.some(c => c.integrazione?.tipo === 'CF_TRASPORTATORE')).toBe(false)
  })

  it('trasportatore con la sola partita IVA sul FIR: il TE ha il CF e nessuna integrazione', async () => {
    impostaDati({
      movimenti: [scarico({ firId: 'f1' })],
      firCollegati: [fir({ carrierId: null, carrierPartitaIva: '22222222222', carrierName: '' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].te).toEqual([
      { codiceFiscale: '22222222222', ragioneSociale: 'trasportatore del FIR FIR-2025-000123' },
    ])
    expect(codici(r.controlli)).not.toContain('TRASPORTATORE_SENZA_CF')
  })

  it('TE con lo stesso CF dopo le integrazioni: un solo modulo', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 7, firId: 'f1' }),
        scarico({ progressiveNumber: 8, firId: 'f2' }),
      ],
      firCollegati: [
        fir({}),
        fir({
          id: 'f2',
          carrierId: 'car-2',
          carrierPartitaIva: '',
          carrierName: 'Trasporti S.r.l.',
        }),
      ],
    })
    integrazioni({
      trasportatori: {
        'TRASPORTI S.R.L.': { ragioneSociale: 'Trasporti S.r.l.', codiceFiscale: 'IT22222222222' },
      },
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].te).toEqual([
      { codiceFiscale: '22222222222', ragioneSociale: 'Trasporti Srl' },
    ])
  })

  it('FIR senza trasportatore avvisa', async () => {
    impostaDati({
      movimenti: [scarico({ progressiveNumber: 7, firId: 'f1' })],
      firCollegati: [fir({ carrierId: null, carrierPartitaIva: '', carrierName: '' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].te).toEqual([])
    expect(conCodice(r.controlli, 'TRASPORTATORE_NON_INDICATO')).toEqual([
      expect.objectContaining({
        gravita: 'AVVISO',
        movimenti: [expect.objectContaining({ numero: 7, incluso: true })],
      }),
    ])
    expect(codici(r.controlli)).not.toContain('TRASPORTATORE_SENZA_CF')
    expect(prisma.trasportatore.findMany).not.toHaveBeenCalled()
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

  it('movimenti tutti esclusi: nessun rifiuto da dichiarare, il file non si genera', async () => {
    impostaDati({
      movimenti: [
        mov({ progressiveNumber: 1, quantity: 40, causale: 'RICLASSIFICAZIONE' }),
        mov({ progressiveNumber: 2, quantity: 50, causale: 'INGRESSO_ESTERNO' }),
      ],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe).toEqual([])
    expect(r.controlli).toContainEqual({
      codice: 'NESSUN_RIFIUTO_DICHIARABILE',
      gravita: 'BLOCCANTE',
      messaggio:
        'Nel 2025 il registro ha 2 movimenti, ma nessuno entra nel MUD (i motivi sono negli avvisi): il file non dichiarerebbe alcun rifiuto.',
    })
    expect(codici(r.controlli)).not.toContain('NESSUN_MOVIMENTO')
    expect(haBloccanti(r.controlli)).toBe(true)
  })

  it('un solo movimento escluso: messaggio al singolare', async () => {
    impostaDati({
      movimenti: [mov({ progressiveNumber: 1, quantity: 40, causale: 'RICLASSIFICAZIONE' })],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(
      expect.objectContaining({
        codice: 'NESSUN_RIFIUTO_DICHIARABILE',
        messaggio:
          'Nel 2025 il registro ha 1 movimento, ma non entra nel MUD (il motivo è negli avvisi): il file non dichiarerebbe alcun rifiuto.',
      })
    )
  })

  // 29
  it('saldo al 31/12 dal registro: avviso con i kg in deposito', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.wasteMovement.groupBy.mockResolvedValue([
      { cerCode: '17 04 05', type: 'CARICO', unit: 'KG', _sum: { quantity: 200 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'kg', _sum: { quantity: 80 } },
    ])

    const r = await service.aggrega('t1', 2025)

    const g = conCodice(r.controlli, 'GIACENZE_NON_CALCOLATE')
    expect(g).toEqual([controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }])])
    expect(g[0].kgNonDichiarati).toBe(120)
    const args = prisma.wasteMovement.groupBy.mock.calls[0][0]
    expect(args.by).toEqual(['cerCode', 'type', 'unit'])
    expect(args.where.tenantId).toBe('t1')
    expect(args.where.movementDate.lt).toEqual(limitiAnnoMud(2025).fine)
    expect(args.where.movementDate.gte).toBeUndefined()
  })

  it('saldo zero o negativo, o solo unità non di massa: nessun avviso delle giacenze', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.wasteMovement.groupBy.mockResolvedValue([
      { cerCode: '170405', type: 'CARICO', unit: 'KG', _sum: { quantity: 80 } },
      { cerCode: '170405', type: 'SCARICO', unit: 'KG', _sum: { quantity: 80 } },
      { cerCode: '150110', type: 'SCARICO', unit: 'T', _sum: { quantity: 1 } },
      { cerCode: '160101', type: 'CARICO', unit: 'LITRI', _sum: { quantity: 500 } },
    ])

    const r = await service.aggrega('t1', 2025)

    expect(conCodice(r.controlli, 'GIACENZE_NON_CALCOLATE')).toEqual([])
  })

  it('saldo con tonnellate, unità vuota e CER pericoloso: kg e asterisco', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.wasteMovement.groupBy.mockResolvedValue([
      { cerCode: '17 05 03*', type: 'CARICO', unit: 't', _sum: { quantity: 0.5 } },
      { cerCode: '170503', type: 'CARICO', unit: '', _sum: { quantity: 20 } },
    ])

    const r = await service.aggrega('t1', 2025)

    const g = conCodice(r.controlli, 'GIACENZE_NON_CALCOLATE')
    expect(g[0].kgNonDichiarati).toBe(520)
    expect(g[0].messaggio).toContain('(CER 17 05 03*: 520 kg)')
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

  it('senza provincia il comune non si risolve e il file non esce', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({
      city: 'Roma',
      province: null,
      atecoCode: '381100',
    })

    const r = await service.aggrega('t1', 2025)

    expect(referenceData.findComuneByName).not.toHaveBeenCalled()
    expect(r.dichiarante.comuneCode).toBeNull()
    expect(r.controlli).toContainEqual(controlliMud.dichiaranteSenzaComuneIstat('Roma', null))
    expect(haBloccanti(r.controlli)).toBe(true)
  })

  it('il comune risolto una volta è nel dichiarante', async () => {
    impostaDati({ movimenti: [mov({})] })

    const r = await service.aggrega('t1', 2025)

    expect(referenceData.findComuneByName).toHaveBeenCalledTimes(1)
    expect(r.dichiarante.comuneCode).toBe('015146')
  })

  it('ATECO con i punti è normalizzato', async () => {
    impostaDati({ movimenti: [mov({})] })

    const r = await service.aggrega('t1', 2025)

    expect(r.dichiarante.atecoNormalizzato).toBe('381100')
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  it('azienda non tenuta: avviso e mudNonDovuto true', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({
      city: 'Roma',
      province: 'RM',
      atecoCode: '381100',
      mudNonDovuto: true,
      mudNonDovutoMotivo: 'Meno di 10 dipendenti',
    })

    const r = await service.aggrega('t1', 2025)

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: expect.objectContaining({ mudNonDovuto: true, mudNonDovutoMotivo: true }),
    })
    expect(r.mudNonDovuto).toBe(true)
    expect(r.controlli).toContainEqual(controlliMud.mudNonDovuto('Meno di 10 dipendenti'))
    // il file si genera comunque: nessun bloccante in più
    expect(haBloccanti(r.controlli)).toBe(false)
  })

  it('azienda tenuta al MUD: nessun avviso e mudNonDovuto false', async () => {
    impostaDati({ movimenti: [mov({})] })

    const r = await service.aggrega('t1', 2025)

    expect(r.mudNonDovuto).toBe(false)
    expect(codici(r.controlli)).not.toContain('MUD_NON_DOVUTO')
  })

  it('ATECO di 4 cifre blocca', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({ city: 'Roma', province: 'RM', atecoCode: '38.11' })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(controlliMud.dichiaranteAtecoNonValido('38.11'))
    expect(codici(r.controlli)).not.toContain('DICHIARANTE_SENZA_ATECO')
  })

  it.each([
    ['5 cifre', '38.11.0'],
    ['7 cifre', '38.11.001'],
    ['lettere', '38.1A.00'],
  ])('ATECO di %s blocca', async (_caso, ateco) => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({ city: 'Roma', province: 'RM', atecoCode: ateco })

    const r = await service.aggrega('t1', 2025)

    expect(r.controlli).toContainEqual(controlliMud.dichiaranteAtecoNonValido(ateco))
    expect(haBloccanti(r.controlli)).toBe(true)
  })

  it('un codice comune che non è di 6 cifre non entra nel dichiarante', async () => {
    impostaDati({ movimenti: [mov({})] })
    referenceData.findComuneByName.mockResolvedValue({ code: '58091' })

    const r = await service.aggrega('t1', 2025)

    expect(r.dichiarante.comuneCode).toBeNull()
    expect(r.controlli).toContainEqual(controlliMud.dichiaranteSenzaComuneIstat('Roma', 'RM'))
  })

  it('città e provincia si cercano senza gli spazi attorno', async () => {
    impostaDati({ movimenti: [mov({})] })
    prisma.tenant.findUnique.mockResolvedValue({
      city: ' Roma ',
      province: ' RM ',
      atecoCode: '381100',
    })

    const r = await service.aggrega('t1', 2025)

    expect(referenceData.findComuneByName).toHaveBeenCalledWith('Roma', 'RM')
    expect(r.dichiarante.comuneCode).toBe('015146')
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
    // l'unico bloccante è che non resta nulla da dichiarare, non il FIR annullato
    expect(r.controlli.filter(c => c.gravita === 'BLOCCANTE').map(c => c.codice)).toEqual([
      'NESSUN_RIFIUTO_DICHIARABILE',
    ])
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

  // Task 14 (A-C-03, A-C-05): doppi fra movimenti con lo stesso ruolo, anche negli anni precedenti
  it('una causale sbagliata e il conferimento sullo stesso FIR non sono doppi', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 1,
          causale: 'ALTRO_SCARICO',
          firId: 'f1',
          movementDate: new Date('2025-03-01T08:00:00Z'),
        }),
        scarico({
          progressiveNumber: 2,
          firId: 'f1',
          movementDate: new Date('2025-03-05T08:00:00Z'),
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(100)
    expect(conCodice(r.controlli, 'CAUSALE_ESCLUSA')).toHaveLength(1)
    expect(conCodice(r.controlli, 'CAUSALE_ESCLUSA')[0].movimenti![0].numero).toBe(1)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_IDENTICO')
  })

  const precedente812 = (p: Partial<any> = {}) =>
    scarico({
      progressiveNumber: 812,
      progressiveYear: 2025,
      firId: 'f1',
      movementDate: new Date('2025-12-30T08:00:00Z'),
      ...p,
    })
  const corrente4 = (p: Partial<any> = {}) =>
    scarico({
      progressiveNumber: 4,
      progressiveYear: 2026,
      firId: 'f1',
      movementDate: new Date('2026-01-03T08:00:00Z'),
      ...p,
    })

  it("un doppio pre-piano C nell'anno dopo è escluso", async () => {
    impostaDati({
      movimenti: [corrente4()],
      precedenti: [precedente812()],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2026)

    expect(r.righe).toEqual([])
    expect(r.movimentiPerCer).toEqual({})
    expect(conCodice(r.controlli, 'FIR_DOPPIO_ANNO_PRECEDENTE')).toEqual([
      {
        codice: 'FIR_DOPPIO_ANNO_PRECEDENTE',
        gravita: 'AVVISO',
        messaggio:
          'Il FIR FIR-2025-000123 risulta già scaricato con gli stessi dati nel movimento n. 812/2025 del 30/12/2025: il movimento n. 4/2026 del 03/01/2026 è un doppio ed è escluso da questo MUD.',
        movimenti: [expect.objectContaining({ numero: 4, anno: 2026, kg: 100, incluso: false })],
      },
    ])
    expect(codici(r.controlli)).not.toContain('FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_IDENTICO')
  })

  it('dopo il piano C lo stesso FIR in due anni con date diverse non è un doppio', async () => {
    impostaDati({
      movimenti: [corrente4({ firIdRicopia: 'f1' })],
      precedenti: [precedente812()],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2026)

    expect(r.righe[0].smaltimentoKg).toBe(100)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_ANNO_PRECEDENTE')
    expect(codici(r.controlli)).toContain('FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')
  })

  it('stesso FIR scaricato in due anni con dati diversi avvisa', async () => {
    impostaDati({
      movimenti: [corrente4()],
      precedenti: [precedente812({ quantity: 80 })],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2026)

    expect(r.righe[0].smaltimentoKg).toBe(100)
    expect(conCodice(r.controlli, 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')).toEqual([
      {
        codice: 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE',
        gravita: 'AVVISO',
        messaggio:
          'Il FIR FIR-2025-000123 risulta scaricato anche in anni precedenti (n. 812/2025): il movimento n. 4/2026 è nel MUD. Verificare che non sia lo stesso conferimento dichiarato due volte.',
        movimenti: [expect.objectContaining({ numero: 4, anno: 2026, kg: 100, incluso: true })],
      },
    ])
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_ANNO_PRECEDENTE')
  })

  it("un precedente con un altro ruolo non riguarda il movimento dell'anno", async () => {
    impostaDati({
      movimenti: [corrente4()],
      precedenti: [precedente812({ causale: 'ALTRO_SCARICO' })],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2026)

    expect(r.righe[0].smaltimentoKg).toBe(100)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_ANNO_PRECEDENTE')
    expect(codici(r.controlli)).not.toContain('FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')
  })

  it('fra gli anni precedenti si elencano solo i movimenti contati', async () => {
    // 811 e 812, storici con gli stessi dati: 812 era un doppio di 811 e non è stato dichiarato.
    impostaDati({
      movimenti: [corrente4({ quantity: 90 })],
      precedenti: [
        precedente812({ progressiveNumber: 811, movementDate: new Date('2025-12-01T08:00:00Z') }),
        precedente812(),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2026)

    expect(r.righe[0].smaltimentoKg).toBe(90)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_ANNO_PRECEDENTE')
    expect(conCodice(r.controlli, 'FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')[0].messaggio).toContain(
      '(n. 811/2025)'
    )
  })

  it("la query dei precedenti porta tenantId e il limite dell'anno", async () => {
    impostaDati({
      movimenti: [corrente4(), corrente4({ progressiveNumber: 5, firId: 'f2', quantity: 7 })],
      firCollegati: [fir({}), fir({ id: 'f2' })],
    })

    await service.aggrega('t1', 2026)

    const chiamate = prisma.wasteMovement.findMany.mock.calls.map((c: any[]) => c[0])
    expect(chiamate).toContainEqual({
      where: {
        tenantId: 't1',
        firId: { in: ['f1', 'f2'] },
        movementDate: { lt: new Date('2025-12-31T23:00:00.000Z') },
      },
      select: chiamate[0].select,
      // stessa data e stesso numero in anni diversi: senza l'anno l'"originale" citato
      // dipenderebbe dall'ordine fisico delle righe
      orderBy: [{ movementDate: 'asc' }, { progressiveYear: 'asc' }, { progressiveNumber: 'asc' }],
    })
  })

  it("senza FIR nei movimenti dell'anno la query dei precedenti non parte", async () => {
    impostaDati({ movimenti: [mov({})] })

    await service.aggrega('t1', 2025)

    const chiamate = prisma.wasteMovement.findMany.mock.calls.map((c: any[]) => c[0])
    expect(chiamate.filter((a: any) => a.where.movementDate && !a.where.movementDate.gte)).toEqual(
      []
    )
  })

  // Rinviato dalla revisione del Task 4 del piano A: la data si ignora solo se ENTRAMBI i
  // movimenti precedono il piano C, e un doppio si confronta solo con i movimenti contati.
  it('un movimento storico e una ricopia dopo il piano C dello stesso FIR non sono doppi', async () => {
    impostaDati({
      movimenti: [
        scarico({
          progressiveNumber: 1,
          firId: 'f1',
          movementDate: new Date('2025-06-10T08:00:00Z'),
        }),
        scarico({
          progressiveNumber: 2,
          firId: 'f1',
          movementDate: new Date('2025-06-12T08:00:00Z'),
        }),
        scarico({
          progressiveNumber: 3,
          firId: 'f1',
          firIdRicopia: 'f1',
          movementDate: new Date('2025-06-12T08:00:00Z'),
        }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(r.righe[0].smaltimentoKg).toBe(200)
    const numeri = (codice: string) =>
      conCodice(r.controlli, codice).map(e => e.movimenti!.map(m => m.numero))
    expect(numeri('FIR_DOPPIO_IDENTICO')).toEqual([[1, 2]])
    expect(numeri('FIR_SCARICATO_PIU_VOLTE')).toEqual([[1, 3]])
  })

  it("un movimento dell'anno escluso per altri motivi non avvisa degli anni precedenti", async () => {
    impostaDati({
      movimenti: [corrente4()],
      precedenti: [precedente812({ quantity: 80 })],
      firCollegati: [fir({ status: 'CANCELLED' })],
    })

    const r = await service.aggrega('t1', 2026)

    expect(codici(r.controlli)).toContain('FIR_ANNULLATO')
    expect(codici(r.controlli)).not.toContain('FIR_SCARICATO_ANCHE_ANNO_PRECEDENTE')
  })

  it('due scarichi con causale esclusa non partecipano ai doppi', async () => {
    impostaDati({
      movimenti: [
        scarico({ progressiveNumber: 1, causale: 'ALTRO_SCARICO', firId: 'f1' }),
        scarico({ progressiveNumber: 2, causale: 'ALTRO_SCARICO', firId: 'f1' }),
      ],
      firCollegati: [fir({})],
    })

    const r = await service.aggrega('t1', 2025)

    expect(conCodice(r.controlli, 'CAUSALE_ESCLUSA')).toHaveLength(2)
    expect(codici(r.controlli)).not.toContain('FIR_DOPPIO_IDENTICO')
  })
})
