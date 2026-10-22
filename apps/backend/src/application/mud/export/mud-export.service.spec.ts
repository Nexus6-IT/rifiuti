import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common'
import { MudExportService } from './mud-export.service'
import { MudVersionRegistry } from './mud-version.registry'
import { HttpExceptionFilter } from '../../../core/filters/http-exception.filter'
import { controlliMud, riepilogaAvvisi, type RifMovimento } from '../aggregazione/mud-controlli'
import { INTEGRAZIONI_VUOTE } from '../aggregazione/mud-integrazioni'
import { hashAggregato } from '../aggregazione/mud-regole'
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

  it("con gli avvisi confermati genera il file e salva l'esportazione", async () => {
    aggregazione.aggrega.mockResolvedValue({
      anno: 2024,
      righe: [rigaValida],
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
