import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { MudExportService } from './mud-export.service'
import { aziendaDichiarante } from './mud-dichiarante'
import { MudVersionRegistry } from './mud-version.registry'
import { HttpExceptionFilter } from '../../../core/filters/http-exception.filter'
import { controlliMud, riepilogaAvvisi, type RifMovimento } from '../aggregazione/mud-controlli'
import { INTEGRAZIONI_VUOTE } from '../aggregazione/mud-integrazioni'
import {
  hashAggregato,
  hashDichiarante,
  hashDichiaranteMud,
  hashDichiarazioni,
} from '../aggregazione/mud-regole'
import type { MudRifiutoLine } from './mud-export.types'

describe('MudExportService', () => {
  let service: MudExportService
  let prisma: any
  let aggregazione: { aggrega: jest.Mock }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  const admin = { id: 'u1', role: 'ADMIN' }
  const viewer = { id: 'u9', role: 'VIEWER' }

  // metallo ferroso 170405: 80 a recupero e 20 a smaltimento, tutti al destinatario D1
  // trasportati da T1
  const rigaValida: MudRifiutoLine = {
    cerCode: '170405',
    prodottoKg: 100,
    recuperoKg: 80,
    smaltimentoKg: 20,
    dr: [
      {
        codiceFiscale: '33333333333',
        ragioneSociale: 'Recupero Metalli Srl',
        istatProvincia: '015',
        istatComune: '146',
        indirizzo: 'Via Industria',
        civico: '5',
        cap: '20100',
        quantitaKg: 100,
      },
    ],
    te: [{ codiceFiscale: '22222222222', ragioneSociale: 'Trasporti Srl' }],
  }

  const rifMovimento: RifMovimento = {
    registroId: 'reg-A',
    progressiveNumber: 7,
    progressiveYear: 2024,
    cerCode: '170405',
    causale: 'SCARICO',
    quantity: 100,
    unit: 'kg',
  }

  const DICHIARANTE_OK = { atecoNormalizzato: '381100', comuneCode: '058091' }

  const tenantCompleto = {
    ragioneSociale: 'Acme Spa',
    partitaIva: '12345678901',
    codiceFiscale: '12345678901',
    address: 'Via Roma 1',
    civico: '10',
    city: 'Roma',
    province: 'RM',
    postalCode: '00100',
    pec: 'acme@pec.it',
    telefono: '0612345678',
    atecoCode: '381100',
    reaNumber: '123456',
    numeroAddetti: 42,
    legaleRappresentanteNome: 'Mario',
    legaleRappresentanteCognome: 'Rossi',
  }

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue(tenantCompleto) },
      // Schede SA-AUT: senza autorizzazioni registrate nessun record AU è emesso.
      autorizzazioneImpianto: { findMany: jest.fn().mockResolvedValue([]) },
      mUDReport: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      activityLog: { create: jest.fn() },
      // lock di aggiornaReportData
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    }
    aggregazione = { aggrega: jest.fn() }
    service = new MudExportService(prisma, new MudVersionRegistry(), aggregazione as any, logger)
  })

  it("il record AA porta l'ATECO senza punti", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: { atecoNormalizzato: '381100', comuneCode: '058091' },
      movimentiPerCer: { '170405': 2 },
      controlli: [],
    })
    prisma.tenant.findUnique.mockResolvedValue({ ...tenantCompleto, atecoCode: '38.11.00' })

    const result = await service.exportTelematico('t1', 2024, admin, [])

    expect(result.content).toContain(';381100;')
    expect(result.content).not.toContain('38.11.')
  })

  it("usa il comune già risolto dall'aggregazione, senza rifare la ricerca", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: { atecoNormalizzato: '381100', comuneCode: '015146' },
      movimentiPerCer: { '170405': 2 },
      controlli: [],
    })

    const result = await service.exportTelematico('t1', 2024, admin, [])

    expect(result.content).toContain(';015;146;')
    expect(result.content).not.toContain(';058;091;')
  })

  it('genera il file MUD della versione corretta per anno', async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 2 },
      controlli: [controlliMud.giacenzeNonCalcolate(2024, [{ cerCode6: '170405', kg: 120 }])],
    })

    const result = await service.exportTelematico('t1', 2024, admin, ['GIACENZE_NON_CALCOLATE'])

    expect(aggregazione.aggrega).toHaveBeenCalledWith('t1', 2024)
    expect(result.version).toBe('6.04/24')
    expect(result.filename).toBe('MUD_2024_12345678901.txt')
    expect(result.content).toContain(';170405;')
    expect(result.content).toContain('0000100,000') // prodotto = 100
    expect(result.content).toContain('0000080,000') // recupero
    expect(result.content).toContain('0000020,000') // smaltimento
    // ATECO + ISTAT provincia(3)+comune(3) dichiarante nel record AA
    expect(result.content).toContain('381100')
    expect(result.content).toContain(';058;091;')

    const lines = result.content.trim().split('\r\n')
    // AA contiene REA, addetti, legale rappresentante e mantiene la lunghezza 338
    const aa = lines.find(l => l.startsWith('AA;'))!
    expect(aa.length).toBe(338)
    expect(aa).toContain('000123456') // REA (9)
    expect(aa).toContain('00042') // addetti (5)
    expect(aa).toContain('ROSSI')
    expect(aa).toContain('MARIO')
    // modulo BB DR (destinatario) e TE (trasportatore)
    const dr = lines.find(l => l.startsWith('BB;') && l.includes(';DR;'))!
    const te = lines.find(l => l.startsWith('BB;') && l.includes(';TE;'))!
    expect(dr).toContain('RECUPERO METALLI SRL')
    expect(dr).toContain('33333333333') // CF destinatario
    expect(dr).toContain('0000100,000') // quantità conferita = 80+20
    expect(te).toContain('TRASPORTI SRL')
    expect(te).toContain('22222222222')
  })

  it('anno vuoto: 422 con NESSUN_MOVIMENTO in details', async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2025,
      righe: [],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: {},
      controlli: [controlliMud.nessunMovimento(2025)],
    })
    const errore = await service.exportTelematico('t1', 2025, admin).catch(e => e)
    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse()).toEqual({
      message: 'Il file MUD non può essere generato: ci sono errori da correggere (1).',
      error: 'MUD_NON_GENERABILE',
      details: { controlli: [controlliMud.nessunMovimento(2025)] },
    })
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
  })

  it('la 422 arriva al client con i controlli in details', async () => {
    // attraverso il filtro globale, come in produzione
    const controlli = [
      controlliMud.nessunMovimento(2025),
      controlliMud.giacenzeNonCalcolate(2025, [{ cerCode6: '170405', kg: 120 }]),
    ]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2025,
      righe: [],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: {},
      controlli,
    })
    const errore = await service.exportTelematico('t1', 2025, admin).catch(e => e)
    const json = jest.fn()
    const response = { status: jest.fn(() => ({ json })) }
    const request = {
      method: 'GET',
      url: '/api/v1/mud/export?year=2025',
      correlationId: 'c1',
      user: { id: 'u1' },
    }
    const host: any = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    }
    new HttpExceptionFilter({ setContext: jest.fn(), error: jest.fn() } as any).catch(errore, host)
    expect(response.status).toHaveBeenCalledWith(422)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 422,
        error: 'MUD_NON_GENERABILE',
        message: 'Il file MUD non può essere generato: ci sono errori da correggere (1).',
        details: { controlli },
      })
    )
  })

  it("un bloccante del dichiarante, arrivato dall'aggregazione, ferma il file anche con gli avvisi confermati", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [controlliMud.dichiaranteSenzaAteco()],
    })
    const errore = await service
      .exportTelematico('t1', 2024, admin, ['GIACENZE_NON_CALCOLATE'])
      .catch(e => e)
    expect(errore.getResponse().error).toBe('MUD_NON_GENERABILE')
    expect(errore.getResponse().details.controlli).toContainEqual(
      controlliMud.dichiaranteSenzaAteco()
    )
  })

  it('con avvisi non confermati: 422 con i codici mancanti in details', async () => {
    const controlli = [
      controlliMud.giacenzeNonCalcolate(2024, [{ cerCode6: '170405', kg: 120 }]),
      controlliMud.scaricoSenzaFir(rifMovimento),
    ]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    const errore = await service
      .exportTelematico('t1', 2024, admin, ['SCARICO_SENZA_FIR'])
      .catch(e => e)
    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse()).toEqual({
      message: 'Il file MUD non è stato generato: ci sono avvisi da confermare (1).',
      error: 'MUD_AVVISI_DA_CONFERMARE',
      details: {
        controlli,
        avvisiDaConfermare: ['GIACENZE_NON_CALCOLATE'],
        riepilogo: riepilogaAvvisi(controlli),
      },
    })
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('con avvisi che cambiano le quantità (kg esclusi) solo ADMIN e SUPER_ADMIN generano il file', async () => {
    const controlli = [
      controlliMud.giacenzeNonCalcolate(2024, [{ cerCode6: '170405', kg: 120 }]),
      controlliMud.firAnnullato(rifMovimento, 'ABC 123'),
    ]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    const confermati = ['FIR_ANNULLATO', 'GIACENZE_NON_CALCOLATE']
    const errore = await service.exportTelematico('t1', 2024, viewer, confermati).catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse()).toMatchObject({
      error: 'MUD_CONFERMA_RISERVATA_AMMINISTRATORI',
      message: 'Il file MUD ha avvisi da confermare: chiedi a un amministratore di generarlo.',
    })
    expect(errore.getResponse().details).toEqual({
      controlli,
      riepilogo: riepilogaAvvisi(controlli),
    })
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()

    // ADMIN e SUPER_ADMIN generano
    await expect(service.exportTelematico('t1', 2024, admin, confermati)).resolves.toBeDefined()
    await expect(
      service.exportTelematico('t1', 2024, { id: 'u2', role: 'SUPER_ADMIN' }, confermati)
    ).resolves.toBeDefined()

    // senza avvisi il VIEWER scarica come oggi
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    await expect(service.exportTelematico('t1', 2024, viewer)).resolves.toBeDefined()
  })

  it('un movimento escluso che non è in kg (quantità non quantificata) riserva il file agli amministratori', async () => {
    const inLitri: RifMovimento = { ...rifMovimento, causale: 'XYZ', quantity: 50, unit: 'L' }
    const controlli = [controlliMud.causaleEsclusa(inLitri)]
    expect(riepilogaAvvisi(controlli)).toMatchObject({
      kgInMeno: 0,
      kgInPiu: 0,
      movimentiNonQuantificati: 1,
    })
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    const errore = await service
      .exportTelematico('t1', 2024, viewer, ['CAUSALE_ESCLUSA'])
      .catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse().error).toBe('MUD_CONFERMA_RISERVATA_AMMINISTRATORI')
  })

  it('con le sole giacenze quantificate un VIEWER genera il file, ma con un movimento escluso no', async () => {
    const solo = [controlliMud.giacenzeNonCalcolate(2024, [{ cerCode6: '170405', kg: 120 }])]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: solo,
    })
    const nonConfermato = await service.exportTelematico('t1', 2024, viewer).catch(e => e)
    expect(nonConfermato).toBeInstanceOf(UnprocessableEntityException)
    await expect(
      service.exportTelematico('t1', 2024, viewer, ['GIACENZE_NON_CALCOLATE'])
    ).resolves.toBeDefined()

    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [...solo, controlliMud.firAnnullato(rifMovimento, 'ABC 123')],
    })
    const errore = await service
      .exportTelematico('t1', 2024, viewer, ['GIACENZE_NON_CALCOLATE', 'FIR_ANNULLATO'])
      .catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
  })

  it('un avviso R/D riserva il file agli amministratori', async () => {
    const controlli = [controlliMud.operazioneNonIndicata(rifMovimento)]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    const errore = await service
      .exportTelematico('t1', 2024, viewer, ['OPERAZIONE_NON_INDICATA'])
      .catch(e => e)
    expect(errore).toBeInstanceOf(ForbiddenException)
    expect(errore.getResponse().error).toBe('MUD_CONFERMA_RISERVATA_AMMINISTRATORI')
    await expect(
      service.exportTelematico('t1', 2024, admin, ['OPERAZIONE_NON_INDICATA'])
    ).resolves.toBeDefined()
  })

  it('con avvisi solo informativi anche un VIEWER genera il file, dopo averli confermati', async () => {
    const controlli = [controlliMud.scaricoSenzaFir(rifMovimento)]
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    // la conferma resta obbligatoria
    const errore = await service.exportTelematico('t1', 2024, viewer).catch(e => e)
    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse().error).toBe('MUD_AVVISI_DA_CONFERMARE')

    const r = await service.exportTelematico('t1', 2024, viewer, ['SCARICO_SENZA_FIR'])
    expect(r.content.startsWith('XX;')).toBe(true)
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u9', action: 'MUD_ESPORTATO' }),
    })
  })

  it('la traccia registra le integrazioni usate dal file, non quelle salvate nel frattempo', async () => {
    const usate = {
      ...INTEGRAZIONI_VUOTE,
      destinatari: {
        'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      },
    }
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
      integrazioni: usate,
    })
    // un salvataggio delle integrazioni arrivato fra l'aggregazione e la scrittura della traccia
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      submittedAt: null,
      reportData: { integrazioni: { destinatari: {}, pesiSpecifici: {} } },
    })
    await service.exportTelematico('t1', 2024, admin)
    const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
    expect(voce.integrazioniUsate).toEqual(usate)
  })

  it("con gli avvisi confermati genera il file e salva l'esportazione", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      integrazioni: INTEGRAZIONI_VUOTE,
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [
        controlliMud.giacenzeNonCalcolate(2024, [{ cerCode6: '170405', kg: 120 }]),
        controlliMud.scaricoSenzaFir(rifMovimento),
      ],
    })
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'SUBMITTED',
      reportData: { hashAggregato: 'h0' },
    })
    const r = await service.exportTelematico('t1', 2024, admin, [
      'SCARICO_SENZA_FIR',
      'GIACENZE_NON_CALCOLATE',
    ])
    expect(r.content.startsWith('XX;')).toBe(true)
    const upsert = prisma.mUDReport.upsert.mock.calls[0][0]
    expect(upsert.where).toEqual({ tenantId_year: { tenantId: 't1', year: 2024 } })
    expect(upsert.update.status).toBeUndefined()
    expect(upsert.update.reportData).toEqual({
      hashAggregato: 'h0',
      esportazioni: [
        expect.objectContaining({
          generatoDa: 'u1',
          versione: '6.04/24',
          hashAggregato: hashAggregato([rigaValida]),
          avvisiConfermati: ['GIACENZE_NON_CALCOLATE', 'SCARICO_SENZA_FIR'],
          riepilogo: expect.objectContaining({ kgInMeno: 120, voci: expect.any(Array) }),
          integrazioniUsate: INTEGRAZIONI_VUOTE,
        }),
      ],
    })
    const voce = upsert.update.reportData.esportazioni[0]
    expect(new Date(voce.generatoIl).toISOString()).toBe(voce.generatoIl)
    expect(prisma.$executeRaw).toHaveBeenCalled() // lock di aggiornaReportData prima della lettura
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 't1', userId: 'u1', action: 'MUD_ESPORTATO' }),
    })
    const log = prisma.activityLog.create.mock.calls[0][0].data
    expect(log.description).toBe(
      'File MUD dei dati 2024 generato (tracciato 6.04/24) con 2 avvisi confermati: ' +
        'Il file dichiara 120 kg in meno del registro per i motivi elencati sotto.'
    )
    expect(log.metadata).toEqual(
      expect.objectContaining({
        year: 2024,
        versione: '6.04/24',
        hashAggregato: hashAggregato([rigaValida]),
        avvisiConfermati: ['GIACENZE_NON_CALCOLATE', 'SCARICO_SENZA_FIR'],
      })
    )
  })

  it('accoda la nuova esportazione a quelle già registrate', async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      reportData: { esportazioni: [{ vecchia: true }] },
    })
    await service.exportTelematico('t1', 2024, admin)
    const reportData = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData
    expect(reportData.esportazioni).toHaveLength(2)
    expect(reportData.esportazioni[0]).toEqual({ vecchia: true })
  })

  it("l'esportazione registra anche l'hash dei dati del dichiarante usati nel file", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    await service.exportTelematico('t1', 2024, admin)
    const voce = prisma.mUDReport.upsert.mock.calls[0][0].create.reportData.esportazioni[0]
    expect(voce.hashDichiarante).toBe(
      hashDichiarante({
        azienda: aziendaDichiarante(tenantCompleto, DICHIARANTE_OK),
        autorizzazioni: [],
      })
    )
  })

  describe('dichiarazioni per unità locale (Task 5b)', () => {
    const rigaSede: MudRifiutoLine = { ...rigaValida, cerCode: '150106', prodottoKg: 50 }
    const base = {
      scheda: null as null,
      numeroAddetti: 42,
      comuneCode: '058091',
      movimentiPerCer: {},
      pericolosiPerCer: {},
      conAutorizzazioni: false,
      conAllegatiAzienda: false,
    }
    const sedeAnagrafica = {
      id: 'ul-2',
      denominazione: 'Sede Venezia',
      numIscrSito: 'VE001',
      principale: false,
      createdAt: new Date(0),
      indirizzo: 'Via della Sede',
      civico: '5',
      cap: '30100',
      comune: 'Venezia',
      provincia: 'VE',
      numeroAddetti: 7,
      progressivoMud: 2,
    }
    const unaDichiarazione = {
      ...base,
      codice: '000000000000001',
      progressivo: 1,
      unitaLocale: { id: null, denominazione: 'Azienda', numIscrSito: null, principale: false },
      anagrafica: null,
      righe: [rigaValida],
      conAutorizzazioni: true,
      conAllegatiAzienda: true,
    }
    const dueDichiarazioni = [
      {
        ...unaDichiarazione,
        unitaLocale: { id: 'ul-1', denominazione: 'Sede', numIscrSito: 'RM001', principale: true },
      },
      {
        ...base,
        codice: '000000000000002',
        progressivo: 2,
        unitaLocale: {
          id: 'ul-2',
          denominazione: 'Sede Venezia',
          numIscrSito: 'VE001',
          principale: false,
        },
        anagrafica: sedeAnagrafica,
        numeroAddetti: 7,
        comuneCode: '027042',
        righe: [rigaSede],
        // flag di entrambe a vero: l'export non deve duplicare AU, AR e INT
        conAutorizzazioni: true,
        conAllegatiAzienda: true,
      },
    ]
    const aggregatoCon = (dichiarazioni: any[], controlli: any[] = []) => ({
      anno: 2024,
      versioneCalcolo: 2,
      righe: dichiarazioni.flatMap(d => d.righe),
      dichiarazioni,
      dichiarante: DICHIARANTE_OK,
      integrazioni: INTEGRAZIONI_VUOTE,
      movimentiPerCer: { '170405': 1 },
      controlli,
    })
    const voceSalvata = () =>
      prisma.mUDReport.upsert.mock.calls[0][0].create.reportData.esportazioni[0]

    it('la voce salva versioneCalcolo 2', async () => {
      aggregazione.aggrega.mockResolvedValue(aggregatoCon([unaDichiarazione]))
      await service.exportTelematico('t1', 2024, admin, [])
      expect(voceSalvata().versioneCalcolo).toBe(2)
      expect(aggregazione.aggrega).toHaveBeenCalledWith('t1', 2024)
    })

    it("con una sede senza giacenze l'hash è quello di hashAggregato", async () => {
      aggregazione.aggrega.mockResolvedValue(aggregatoCon([unaDichiarazione]))
      await service.exportTelematico('t1', 2024, admin, [])
      const voce = voceSalvata()
      expect(voce.hashAggregato).toBe(hashAggregato([rigaValida]))
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata).toEqual(
        expect.objectContaining({ hashAggregato: hashAggregato([rigaValida]), dichiarazioni: 1 })
      )
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.versioneCalcolo).toBe(2)
    })

    it('con due sedi il file ha due pacchetti', async () => {
      aggregazione.aggrega.mockResolvedValue(aggregatoCon(dueDichiarazioni))
      const r = await service.exportTelematico('t1', 2024, admin, [])
      const tipi = r.content
        .split('\r\n')
        .filter(Boolean)
        .map(l => l.slice(0, 2))
      expect(tipi.filter(t => t === 'AA')).toHaveLength(2)
      expect(tipi.filter(t => t === 'BA')).toHaveLength(2)
      const aa = r.content.split('\r\n').filter(l => l.startsWith('AA;'))
      expect(aa[1]).toContain('VIA DELLA SEDE')
      expect(aa[1]).toContain(';027;042;')
      // hash: dichiarazioni (più di una) e dichiarante con le anagrafiche dei pacchetti
      const voce = voceSalvata()
      expect(voce.hashAggregato).toBe(
        hashDichiarazioni([
          { codice: '000000000000001', righe: [rigaValida] },
          { codice: '000000000000002', righe: [rigaSede] },
        ])
      )
      expect(voce.hashDichiarante).toBe(
        hashDichiaranteMud(
          { azienda: aziendaDichiarante(tenantCompleto, DICHIARANTE_OK), autorizzazioni: [] },
          { dichiarazioni: dueDichiarazioni }
        )
      )
      expect(voce.hashDichiarante).not.toBe(
        hashDichiarante({
          azienda: aziendaDichiarante(tenantCompleto, DICHIARANTE_OK),
          autorizzazioni: [],
        })
      )
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.dichiarazioni).toBe(2)
      expect(prisma.activityLog.create.mock.calls[0][0].data.description).toContain(
        '2 dichiarazioni'
      )
    })

    it('AU esce in un solo pacchetto (la principale) anche se i flag sono su tutti', async () => {
      prisma.autorizzazioneImpianto.findMany.mockResolvedValue([
        {
          estremi: 'AUT-1',
          dataRilascio: new Date('2020-01-01'),
          dataScadenza: null,
          enteAutorizzante: '1',
          tipoAutorizzazione: 1,
          rinnovoAutocertificazione: false,
          operazioniRecupero: ['R13'],
          operazioniSmaltimento: [],
          gestisceVfu: false,
          gestisceRaee: false,
          autorizzazioneEow: false,
          impiantoIncenerimento: false,
          capacitaComplessivaTa: 0,
          capacitaPericolosiTa: 0,
          capacitaNonPericolosiTa: 0,
          impiantoCoincenerimento: false,
          capacitaCoincComplessivaTa: 0,
          capacitaCoincPericolosiTa: 0,
          capacitaCoincNonPericolosiTa: 0,
          discariche: [],
          emasPrimaRegistrazione: null,
          emasNumeroRegistrazione: null,
          iso14001Emissione: null,
        },
      ])
      aggregazione.aggrega.mockResolvedValue(aggregatoCon(dueDichiarazioni))
      const r = await service.exportTelematico('t1', 2024, admin, [])
      const righe = r.content.split('\r\n')
      expect(righe.filter(l => l.startsWith('AU;'))).toHaveLength(1)
      const ab = righe.filter(l => l.startsWith('AB;'))
      expect(ab).toHaveLength(2)
      // schede AUT e RIC: ultimi due campi prima del filler
      const coda = (l: string) => l.split(';').slice(-4, -2)
      expect(coda(ab[0])).toEqual(['01', '00'])
      expect(coda(ab[1])).toEqual(['00', '00'])
    })

    it("principale senza indirizzo con addetti propri: telefono dell'azienda nel record AA", async () => {
      aggregazione.aggrega.mockResolvedValue(
        aggregatoCon([{ ...unaDichiarazione, numeroAddetti: 5 }])
      )
      const r = await service.exportTelematico('t1', 2024, admin, [])
      const aa = r.content.split('\r\n').find(l => l.startsWith('AA;'))!
      // telefono UL e telefono SL entrambi dell'azienda
      expect(aa.split(';').filter(c => c === '0612345678')).toHaveLength(2)
    })

    it('principale senza indirizzo: il hash del dichiarante cambia con gli addetti della sede', async () => {
      aggregazione.aggrega.mockResolvedValue(
        aggregatoCon([{ ...unaDichiarazione, numeroAddetti: 5 }])
      )
      await service.exportTelematico('t1', 2024, admin, [])
      const h5 = voceSalvata().hashDichiarante
      prisma.mUDReport.upsert.mockClear()
      aggregazione.aggrega.mockResolvedValue(
        aggregatoCon([{ ...unaDichiarazione, numeroAddetti: 6 }])
      )
      await service.exportTelematico('t1', 2024, admin, [])
      expect(voceSalvata().hashDichiarante).not.toBe(h5)
    })

    it('una dichiarazione "azienda" con addetti uguali: file identico a quello senza dichiarazioni', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2025-03-10T10:00:00Z'))
      try {
        aggregazione.aggrega.mockResolvedValue(aggregatoCon([unaDichiarazione]))
        const con = await service.exportTelematico('t1', 2024, admin, [])
        aggregazione.aggrega.mockResolvedValue(aggregatoCon([]))
        aggregazione.aggrega.mockResolvedValue({
          ...aggregatoCon([]),
          righe: [rigaValida],
        })
        const senza = await service.exportTelematico('t1', 2024, admin, [])
        expect(con.content).toBe(senza.content)
      } finally {
        jest.useRealTimers()
      }
    })

    it('aggregazione senza dichiarazioni: un solo pacchetto come prima', async () => {
      aggregazione.aggrega.mockResolvedValue({ ...aggregatoCon([]), righe: [rigaValida] })
      const r = await service.exportTelematico('t1', 2024, admin, [])
      expect(r.content.split('\r\n').filter(l => l.startsWith('AA;'))).toHaveLength(1)
      expect(voceSalvata().hashAggregato).toBe(hashAggregato([rigaValida]))
    })

    it('con i soli avvisi di giacenza un utente non amministratore genera il file dopo la conferma', async () => {
      const g = {
        cerCode: '170405',
        cer6: '170405',
        unitaLocaleId: null,
        sede: 'Azienda',
        kg: 10,
      }
      const controlli = [
        controlliMud.giacenzaRipartita(2024, { ...g, recuperoKg: 6, smaltimentoKg: 4 }),
        controlliMud.giacenzaDestinazioneNonIndicata(2024, g),
      ]
      aggregazione.aggrega.mockResolvedValue(aggregatoCon([unaDichiarazione], controlli))
      const senza = await service.exportTelematico('t1', 2024, viewer).catch(e => e)
      expect(senza).toBeInstanceOf(UnprocessableEntityException)
      expect(senza.getResponse()).toMatchObject({ error: 'MUD_AVVISI_DA_CONFERMARE' })
      await expect(
        service.exportTelematico('t1', 2024, viewer, [
          'GIACENZA_RIPARTITA',
          'GIACENZA_DESTINAZIONE_NON_INDICATA',
        ])
      ).resolves.toBeDefined()
    })
  })

  it('la città del dichiarante entra nel file senza spazi ai lati (XX e AA)', async () => {
    prisma.tenant.findUnique.mockResolvedValue({ ...tenantCompleto, city: '  Roma ' })
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    const r = await service.exportTelematico('t1', 2024, admin)
    expect(aziendaDichiarante({ ...tenantCompleto, city: '  Roma ' }, DICHIARANTE_OK).comune).toBe(
      'Roma'
    )
    expect(r.content).toContain(';ROMA ')
    expect(r.content).not.toContain('; ROMA')
  })

  describe('dichiarazione sostitutiva (A-W-04)', () => {
    beforeEach(() => {
      aggregazione.aggrega.mockResolvedValue({
        anno: 2024,
        righe: [rigaValida],
        dichiarante: DICHIARANTE_OK,
        movimentiPerCer: { '170405': 1 },
        controlli: [],
      })
    })
    const recordAA = (contenuto: string) => contenuto.split('\r\n').find(l => l.startsWith('AA;'))!

    it('con un MUD già presentato il record AA dichiara la sostituzione', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        submittedBy: 'u1',
        reportData: {},
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(prisma.mUDReport.findUnique).toHaveBeenCalledWith({
        where: { tenantId_year: { tenantId: 't1', year: 2024 } },
        select: { status: true, submittedAt: true, reportData: true },
      })
      const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
      expect(voce.sostituisce).toBe('2026-06-30T10:00:00.000Z')
      const aa = recordAA(r.content)
      expect(aa.endsWith(';1;20260630;')).toBe(true)
      expect(aa).toHaveLength(338)
    })

    it('dopo un annullamento per DICHIARAZIONE_DA_SOSTITUIRE il file sostituisce quella comunicazione', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'DRAFT',
        submittedAt: null,
        submittedBy: null,
        reportData: {
          annullamenti: [
            { motivo: 'SEGNATURA_ERRATA', submittedAt: '2026-05-10T10:00:00.000Z' },
            { motivo: 'DICHIARAZIONE_DA_SOSTITUIRE', submittedAt: '2026-06-30T10:00:00.000Z' },
          ],
        },
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(recordAA(r.content).endsWith(';1;20260630;')).toBe(true)
    })

    it('una segnatura errata più recente non cancella la dichiarazione da sostituire (S1 → DA_SOSTITUIRE → S2 → ERRATA)', async () => {
      // 1. S1 presentata davvero e annullata per sostituirla; 2. S2 segnata troppo presto;
      // 3. S2 annullata come segnatura errata (non era stata inviata). S1 resta in Camera di
      // Commercio: il file deve ancora annullare e sostituire S1, non uscire come prima.
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'DRAFT',
        submittedAt: null,
        submittedBy: null,
        reportData: {
          annullamenti: [
            { motivo: 'DICHIARAZIONE_DA_SOSTITUIRE', submittedAt: '2026-05-10T10:00:00.000Z' },
            { motivo: 'SEGNATURA_ERRATA', submittedAt: '2026-06-30T10:00:00.000Z' },
          ],
        },
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(recordAA(r.content).endsWith(';1;20260510;')).toBe(true)
      const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
      expect(voce.sostituisce).toBe('2026-05-10T10:00:00.000Z')
    })

    it('con sole segnature errate annullate il file è una prima dichiarazione', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'DRAFT',
        submittedAt: null,
        submittedBy: null,
        reportData: {
          annullamenti: [
            { motivo: 'SEGNATURA_ERRATA', submittedAt: '2026-05-10T10:00:00.000Z' },
            { motivo: 'SEGNATURA_ERRATA', submittedAt: '2026-06-30T10:00:00.000Z' },
          ],
        },
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(recordAA(r.content).endsWith(';0;00000000;')).toBe(true)
      const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
      expect(voce.sostituisce).toBeNull()
    })

    it('tra più dichiarazioni da sostituire vale la più recente', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'DRAFT',
        submittedAt: null,
        submittedBy: null,
        reportData: {
          annullamenti: [
            { motivo: 'DICHIARAZIONE_DA_SOSTITUIRE', submittedAt: '2026-05-10T10:00:00.000Z' },
            { motivo: 'DICHIARAZIONE_DA_SOSTITUIRE', submittedAt: '2026-06-30T10:00:00.000Z' },
            { motivo: 'SEGNATURA_ERRATA', submittedAt: '2026-07-02T10:00:00.000Z' },
          ],
        },
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(recordAA(r.content).endsWith(';1;20260630;')).toBe(true)
    })

    describe('con più dichiarazioni (F1)', () => {
      const ul = (id: string, progressivo: number) => ({
        id,
        denominazione: `Sede ${progressivo}`,
        numIscrSito: `S${progressivo}`,
        principale: progressivo === 1,
      })
      const dich = (progressivo: number) => ({
        codice: String(progressivo).padStart(15, '0'),
        progressivo,
        unitaLocale: ul(`ul-${progressivo}`, progressivo),
        anagrafica: null,
        scheda: null,
        numeroAddetti: 5,
        comuneCode: '058091',
        movimentiPerCer: {},
        pericolosiPerCer: {},
        righe: [{ ...rigaValida, cerCode: progressivo === 1 ? '170405' : '150106' }],
        conAutorizzazioni: progressivo === 1,
        conAllegatiAzienda: progressivo === 1,
      })
      const duePacchetti = () => {
        const dichiarazioni = [dich(1), dich(2)]
        aggregazione.aggrega.mockResolvedValue({
          anno: 2024,
          versioneCalcolo: 2,
          righe: dichiarazioni.flatMap(d => d.righe),
          dichiarazioni,
          dichiarante: DICHIARANTE_OK,
          integrazioni: INTEGRAZIONI_VUOTE,
          movimentiPerCer: {},
          controlli: [],
        })
      }
      const presentato = (reportData: Record<string, unknown> = {}) =>
        prisma.mUDReport.findUnique.mockResolvedValue({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          submittedBy: 'u1',
          reportData,
        })
      const soloProgressivo = (progressivo: number) => {
        const dichiarazioni = [dich(progressivo)]
        aggregazione.aggrega.mockResolvedValue({
          anno: 2024,
          versioneCalcolo: 2,
          righe: dichiarazioni.flatMap(d => d.righe),
          dichiarazioni,
          dichiarante: DICHIARANTE_OK,
          integrazioni: INTEGRAZIONI_VUOTE,
          movimentiPerCer: {},
          controlli: [],
        })
      }

      it('presentazione v1 (insieme {1}) e file con 1 e 2: avviso da confermare, poi solo il pacchetto 1 sostituisce', async () => {
        duePacchetti()
        presentato()
        await expect(service.exportTelematico('t1', 2024, admin, [])).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'MUD_AVVISI_DA_CONFERMARE' }),
        })
        const r = await service.exportTelematico('t1', 2024, admin, [
          'SOSTITUTIVA_PIU_DICHIARAZIONI',
        ])
        const aa = r.content.split('\r\n').filter(l => l.startsWith('AA;'))
        expect(aa[0].endsWith(';1;20260630;')).toBe(true)
        expect(aa[1].endsWith(';0;00000000;')).toBe(true)
        const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
        expect(voce.avvisiConfermati).toContain('SOSTITUTIVA_PIU_DICHIARAZIONI')
        expect(voce.progressiviUnitaLocale).toEqual([1, 2])
        expect(
          prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
            .avvisiConfermati
        ).toEqual(['SOSTITUTIVA_PIU_DICHIARAZIONI'])
        const dettagli = await service
          .exportTelematico('t1', 2024, admin, [])
          .catch((e: any) => e.response.details)
        expect(dettagli.avvisiDaConfermare).toEqual(['SOSTITUTIVA_PIU_DICHIARAZIONI'])
        const avviso = dettagli.controlli.find(
          (c: any) => c.codice === 'SOSTITUTIVA_PIU_DICHIARAZIONI'
        )
        expect(avviso.messaggio).toContain('già presentate (1),')
      })

      it('presentazione v2 con 1 e 2: il nuovo file con 1 e 2 sostituisce entrambi, nessun avviso (G2)', async () => {
        duePacchetti()
        presentato({ progressiviUnitaLocale: [1, 2] })
        const r = await service.exportTelematico('t1', 2024, admin, [])
        const aa = r.content.split('\r\n').filter(l => l.startsWith('AA;'))
        expect(aa[0].endsWith(';1;20260630;')).toBe(true)
        expect(aa[1].endsWith(';1;20260630;')).toBe(true)
      })

      it('pacchetto unico con progressivo 2 che sostituisce {2}: flag sul 2, nessun avviso (G2)', async () => {
        soloProgressivo(2)
        presentato({ progressiviUnitaLocale: [2] })
        const r = await service.exportTelematico('t1', 2024, admin, [])
        expect(recordAA(r.content).endsWith(';1;20260630;')).toBe(true)
        const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
        expect(voce.progressiviUnitaLocale).toEqual([2])
      })

      it('pacchetto unico con progressivo 2 che sostituisce {1}: nessun flag e avviso (G2)', async () => {
        soloProgressivo(2)
        presentato({ progressiviUnitaLocale: [1] })
        await expect(service.exportTelematico('t1', 2024, admin, [])).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'MUD_AVVISI_DA_CONFERMARE' }),
        })
        const r = await service.exportTelematico('t1', 2024, admin, [
          'SOSTITUTIVA_PIU_DICHIARAZIONI',
        ])
        expect(recordAA(r.content).endsWith(';0;00000000;')).toBe(true)
      })

      it('il file non contiene uno dei progressivi sostituiti: avviso (G2)', async () => {
        soloProgressivo(1)
        presentato({ progressiviUnitaLocale: [1, 2] })
        await expect(service.exportTelematico('t1', 2024, admin, [])).rejects.toMatchObject({
          response: expect.objectContaining({ error: 'MUD_AVVISI_DA_CONFERMARE' }),
        })
      })

      it("l'avviso lo conferma anche chi non è amministratore", async () => {
        duePacchetti()
        presentato()
        const r = await service.exportTelematico('t1', 2024, { id: 'u2', role: 'OPERATOR' }, [
          'SOSTITUTIVA_PIU_DICHIARAZIONI',
        ])
        expect(r.content).toContain('AA;')
      })

      it('due dichiarazioni ma nessuna sostituzione: nessun avviso', async () => {
        duePacchetti()
        prisma.mUDReport.findUnique.mockResolvedValue(null)
        const r = await service.exportTelematico('t1', 2024, admin, [])
        expect(r.content.split('\r\n').filter(l => l.startsWith('AA;'))).toHaveLength(2)
      })

      it('sostitutiva con una sola dichiarazione: nessun avviso', async () => {
        const dichiarazioni = [dich(1)]
        aggregazione.aggrega.mockResolvedValue({
          anno: 2024,
          versioneCalcolo: 2,
          righe: dichiarazioni.flatMap(d => d.righe),
          dichiarazioni,
          dichiarante: DICHIARANTE_OK,
          integrazioni: INTEGRAZIONI_VUOTE,
          movimentiPerCer: {},
          controlli: [],
        })
        presentato()
        const r = await service.exportTelematico('t1', 2024, admin, [])
        expect(recordAA(r.content).endsWith(';1;20260630;')).toBe(true)
      })
    })

    it("senza dichiarazioni nell'aggregato (pacchetto unico di sempre) la voce registra {1}", async () => {
      prisma.mUDReport.findUnique.mockResolvedValue(null)
      await service.exportTelematico('t1', 2024, admin)
      const voce = prisma.mUDReport.upsert.mock.calls[0][0].update.reportData.esportazioni[0]
      expect(voce.progressiviUnitaLocale).toEqual([1])
    })

    it('senza una presentazione il record AA non sostituisce nulla', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        status: 'DRAFT',
        submittedAt: null,
        submittedBy: null,
        reportData: {},
      })
      const r = await service.exportTelematico('t1', 2024, admin)
      expect(recordAA(r.content).endsWith(';0;00000000;')).toBe(true)
    })
  })

  it('un DR senza codice fiscale non rompe la lunghezza dei record', async () => {
    // l'aggregazione lo segnala come bloccante (Task 4); qui si prova solo il formato, quindi nessun controllo
    aggregazione.aggrega.mockResolvedValue({
      anno: 2025,
      righe: [
        {
          ...rigaValida,
          dr: [{ codiceFiscale: '', ragioneSociale: 'Ecologia Srl', quantitaKg: 300 }],
        },
      ],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    await expect(service.exportTelematico('t1', 2025, admin)).resolves.toBeDefined() // generate() verifica le lunghezze (Task 1)
  })

  it('10.000.000 kg escono in tonnellate e il record BA resta di 217 caratteri', async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2025,
      righe: [
        {
          cerCode: '170405',
          prodottoKg: 10000000,
          recuperoKg: 10000000,
          smaltimentoKg: 0,
          dr: [],
          te: [],
        },
      ],
      dichiarante: DICHIARANTE_OK,
      movimentiPerCer: { '170405': 1 },
      controlli: [],
    })
    const r = await service.exportTelematico('t1', 2025, admin)
    const ba = r.content.split('\r\n').find(l => l.startsWith('BA;'))!
    expect(ba.length).toBe(217)
    expect(ba).toContain(';0010000,000;2;')
  })

  it('propaga errore per anno non supportato (prima di toccare il DB)', async () => {
    await expect(service.exportTelematico('t1', 1999, admin)).rejects.toThrow(
      'Versione tracciato MUD non disponibile'
    )
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled()
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })

  it('supportedVersions elenca anno/versione', () => {
    expect(service.supportedVersions()).toEqual(
      expect.arrayContaining([{ year: 2024, version: '6.04/24' }])
    )
  })
})
