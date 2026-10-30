import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { MudPresentazioneService } from './mud-presentazione.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import { MudExportService } from './export/mud-export.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { controlliMud, type RifMovimento } from './aggregazione/mud-controlli'
import { hashAggregato, hashCalcoloMud, hashDichiarante } from './aggregazione/mud-regole'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import { MudAggregazioneOracoloA2bf11e } from './aggregazione/mud-aggregazione-a2bf11e.oracolo-spec'
import { creaPrismaFinto, type MovimentoFinto } from './aggregazione/mud-prisma-finto.fixture-spec'
import { aziendaDichiarante } from './export/mud-dichiarante'
import type { MudRifiutoLine } from './export/mud-export.types'

describe('MudPresentazioneService', () => {
  let service: MudPresentazioneService
  let prisma: any
  let aggregazione: { aggrega: jest.Mock }
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  const riga170405: MudRifiutoLine = {
    cerCode: '170405',
    prodottoKg: 100,
    recuperoKg: 100,
    smaltimentoKg: 0,
    te: [{ codiceFiscale: '22222222222', ragioneSociale: 'Trasporti Srl' }],
  }

  const rifMovimento: RifMovimento = {
    registroId: 'reg-A',
    progressiveNumber: 7,
    progressiveYear: 2025,
    cerCode: '170405',
    causale: 'SCARICO',
    quantity: 100,
    unit: 'kg',
  }
  const avvisoScarico = controlliMud.scaricoSenzaFir(rifMovimento)

  const DICHIARANTE = { atecoNormalizzato: '381100', comuneCode: '058091' }
  const tenant = {
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
  const hashDichiaranteOggi = hashDichiarante({
    azienda: aziendaDichiarante(tenant, DICHIARANTE),
    autorizzazioni: [],
  })

  // Autorizzazione come la restituisce Prisma (record AU)
  const autorizzazione = (estremi: string) => ({
    estremi,
    dataRilascio: new Date('2020-01-15T00:00:00Z'),
    dataScadenza: null,
    enteAutorizzante: 1,
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
  })

  const aggregato = (righe: MudRifiutoLine[], controlli: any[]) => ({
    anno: 2025,
    righe,
    controlli,
    dichiarante: DICHIARANTE,
    movimentiPerCer: {},
    pericolosiPerCer: {},
    mudNonDovuto: false,
  })

  const record = (r: Partial<any>) => ({
    status: 'DRAFT',
    submittedAt: null,
    submittedBy: null,
    reportData: {},
    ...r,
  })

  const RIEPILOGO_FILE = {
    kgInMeno: 0,
    kgInPiu: 0,
    movimentiNonQuantificati: 0,
    voci: [{ codice: 'SCARICO_SENZA_FIR', casi: 1, movimenti: 0, kgEsclusi: 0, kgAggiunti: 0 }],
  }
  /** Voce di `reportData.esportazioni` come la scrive l'export. */
  const voce = (r: Partial<any> = {}) => ({
    generatoIl: '2026-04-02T08:00:00.000Z',
    generatoDa: 'u1',
    versione: '6.04/25',
    hashAggregato: 'h-file',
    hashDichiarante: 'd-file',
    avvisiConfermati: ['SCARICO_SENZA_FIR'],
    riepilogo: RIEPILOGO_FILE,
    sostituisce: null,
    ...r,
  })

  /** Primo argomento passato a `upsert`. */
  const scritto = () => prisma.mUDReport.upsert.mock.calls[0][0]

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
      autorizzazioneImpianto: { findMany: jest.fn().mockResolvedValue([]) },
      mUDReport: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      activityLog: { create: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    }
    aggregazione = {
      aggrega: jest.fn().mockResolvedValue(aggregato([riga170405], [avvisoScarico])),
    }
    service = new MudPresentazioneService(
      prisma,
      new MudVersionRegistry(),
      aggregazione as any,
      logger
    )
  })

  afterEach(() => jest.useRealTimers())

  /** Risposta che il filtro globale manda al client per l'errore indicato. */
  function attraversoIlFiltro(errore: any) {
    const json = jest.fn()
    const response: any = { status: jest.fn().mockReturnValue({ json }) }
    const host: any = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/x' }) }),
    }
    new HttpExceptionFilter({ setContext: jest.fn(), error: jest.fn() } as any).catch(errore, host)
    return { status: response.status.mock.calls[0][0], body: json.mock.calls[0][0] }
  }

  it('stato senza record è DRAFT', async () => {
    const stato = await service.stato('t1', 2025)

    expect(stato).toEqual({
      year: 2025,
      status: 'DRAFT',
      submittedAt: null,
      datiModificatiDopoPresentazione: false,
      fileTracciato: null,
      esportazioni: [],
      prossimoFileSostituisce: null,
      versioneCalcolo: null,
      versioneCalcoloAttuale: 2,
    })
    expect(prisma.mUDReport.findUnique).toHaveBeenCalledWith({
      where: { tenantId_year: { tenantId: 't1', year: 2025 } },
    })
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })

  it("segnaPresentato si lega all'esportazione: hash, avvisi e riepilogo del file, e scrive nel registro attività", async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [voce()], integrazioni: { x: 1 } } })
    )

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'))

    const arg = scritto()
    expect(arg.where).toEqual({ tenantId_year: { tenantId: 't1', year: 2025 } })
    expect(arg.update.status).toBe('SUBMITTED')
    expect(arg.update.submittedBy).toBe('u1')
    expect(arg.update.submittedAt).toEqual(new Date('2026-06-30T10:00:00Z'))
    expect(arg.update.reportData.hashAggregato).toBe('h-file')
    expect(arg.update.reportData.hashDichiarante).toBe('d-file')
    expect(arg.update.reportData.esportazionePresentata).toBe('2026-04-02T08:00:00.000Z')
    expect(arg.update.reportData.avvisiConfermatiAllaPresentazione).toEqual(['SCARICO_SENZA_FIR'])
    expect(arg.update.reportData.riepilogoAllaPresentazione).toEqual(RIEPILOGO_FILE)
    expect(arg.update.reportData.fileTracciato).toBe(true)
    expect(arg.update.reportData.annullamenti).toEqual([])
    // le chiavi esistenti si conservano
    expect(arg.update.reportData.esportazioni).toEqual([voce()])
    expect(arg.update.reportData.integrazioni).toEqual({ x: 1 })

    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't1',
        userId: 'u1',
        action: 'MUD_PRESENTATO',
        description: 'MUD dei dati 2025 segnato come presentato il 30/06/2026',
        metadata: expect.objectContaining({
          year: 2025,
          avvisiConfermati: ['SCARICO_SENZA_FIR'],
          fileTracciato: true,
          hashAggregato: 'h-file',
        }),
      }),
    })
  })

  it('una voce senza hash (forma inattesa) ripiega sull hash dei dati attuali', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni: [{}] } }))

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'))

    expect(scritto().update.reportData.hashAggregato).toBe(hashAggregato([riga170405]))
    expect(scritto().update.reportData.avvisiConfermatiAllaPresentazione).toEqual([])
    expect(scritto().update.reportData.riepilogoAllaPresentazione).toBeNull()
  })

  it('un anno il cui file non è uscito da questa versione si segna con fileTracciato false', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: {} }))

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-04-20T10:00:00Z'))

    const arg = scritto()
    expect(arg.update.reportData.fileTracciato).toBe(false)
    expect(arg.update.reportData.avvisiConfermatiAllaPresentazione).toEqual([])
    expect(arg.update.reportData.riepilogoAllaPresentazione).toBeNull()
    expect(arg.update.reportData.controlliAllaPresentazione).toEqual([
      { codice: 'SCARICO_SENZA_FIR', gravita: 'AVVISO' },
    ])
    expect(prisma.activityLog.create.mock.calls[0][0].data.description).toBe(
      'MUD dei dati 2025 segnato come presentato il 20/04/2026 (file non generato da questa versione)'
    )

    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: arg.update.submittedAt,
        reportData: arg.update.reportData,
      })
    )
    const stato = await service.stato('t1', 2025)
    expect(stato.fileTracciato).toBe(false)
    expect(stato.datiModificatiDopoPresentazione).toBe(false)
  })

  it('un anno con REGISTRO_VUOTO_CON_FIR e senza esportazioni si segna', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato([], [controlliMud.registroVuotoConFir(2025, ['FIR 1/2025'])])
    )
    prisma.mUDReport.findUnique.mockResolvedValue(null)

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-04-20T10:00:00Z'))

    const arg = scritto()
    expect(arg.create.status).toBe('SUBMITTED')
    expect(arg.create.reportData.fileTracciato).toBe(false)
    expect(arg.create.reportData.controlliAllaPresentazione).toEqual([
      { codice: 'REGISTRO_VUOTO_CON_FIR', gravita: 'BLOCCANTE' },
    ])
  })

  it('con un esportazione legata, bloccanti e avvisi nuovi di oggi non impediscono la segnatura (A-W-03)', async () => {
    // il file presentato ha già superato i controlli quando è stato generato; i dati cambiati
    // dopo li segnala stato(), non la segnatura
    aggregazione.aggrega.mockResolvedValue(
      aggregato(
        [{ ...riga170405, prodottoKg: 150 }],
        [controlliMud.dichiaranteSenzaAteco(), avvisoScarico]
      )
    )
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [voce()] } })
    )

    await service.segnaPresentato('t1', 2025, 'u1')

    const arg = scritto()
    expect(arg.update.status).toBe('SUBMITTED')
    expect(arg.update.reportData.avvisiConfermatiAllaPresentazione).toEqual(['SCARICO_SENZA_FIR'])
    expect(arg.update.reportData.riepilogoAllaPresentazione).toEqual(RIEPILOGO_FILE)
  })

  it('con più esportazioni si lega all ultima, o a quella indicata', async () => {
    const esportazioni = [
      voce({
        generatoIl: '2026-04-01T08:00:00.000Z',
        hashAggregato: 'h-vecchio',
        hashDichiarante: 'd0',
        avvisiConfermati: [],
        riepilogo: null,
      }),
      voce({ generatoIl: '2026-04-02T08:00:00.000Z', hashAggregato: 'h-ultimo' }),
    ]
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni } }))

    await service.segnaPresentato('t1', 2025, 'u1')
    expect(scritto().update.reportData.hashAggregato).toBe('h-ultimo')
    expect(scritto().update.reportData.esportazionePresentata).toBe('2026-04-02T08:00:00.000Z')

    prisma.mUDReport.upsert.mockClear()
    await service.segnaPresentato('t1', 2025, 'u1', undefined, '2026-04-01T08:00:00.000Z')
    expect(scritto().update.reportData.hashAggregato).toBe('h-vecchio')
    expect(scritto().update.reportData.hashDichiarante).toBe('d0')
    expect(scritto().update.reportData.esportazionePresentata).toBe('2026-04-01T08:00:00.000Z')
    expect(scritto().update.reportData.avvisiConfermatiAllaPresentazione).toEqual([])
  })

  it('rifiuta una data di presentazione precedente alla generazione del file scelto (422)', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-01T10:00:00Z') })
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [voce({ generatoIl: '2026-04-02T08:00:00.000Z' })] } })
    )

    const errore = await service
      .segnaPresentato('t1', 2025, 'u1', new Date('2026-04-01'))
      .catch(e => e)

    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse()).toEqual({
      message:
        'La data di presentazione (01/04/2026) è precedente alla generazione del file scelto (02/04/2026).',
      error: 'MUD_DATA_PRECEDENTE_AL_FILE',
    })
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()

    // lo stesso giorno della generazione va bene
    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-04-02'))
    expect(scritto().update.submittedAt).toEqual(new Date('2026-04-02'))
  })

  it('rifiuta un esportazione indicata che non esiste (422)', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [voce()] } })
    )

    const errore = await service
      .segnaPresentato('t1', 2025, 'u1', undefined, '2026-01-01')
      .catch(e => e)

    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse()).toEqual({
      message: "Esportazione indicata non trovata fra quelle dell'anno.",
      error: 'MUD_ESPORTAZIONE_NON_TROVATA',
    })
    expect(attraversoIlFiltro(errore).status).toBe(422)
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
  })

  it('un MUD già presentato non si segna di nuovo: 409, prima va annullata la segnatura', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        submittedBy: 'u1',
        reportData: { esportazioni: [voce()], hashAggregato: 'h-file' },
      })
    )

    const errore = await service.segnaPresentato('t1', 2025, 'u2').catch(e => e)

    expect(errore).toBeInstanceOf(ConflictException)
    const { status, body } = attraversoIlFiltro(errore)
    expect(status).toBe(409)
    expect(body).toEqual(
      expect.objectContaining({
        error: 'MUD_GIA_PRESENTATO',
        message:
          'Il MUD dei dati 2025 risulta già presentato: per segnarlo di nuovo annullare prima la segnatura.',
      })
    )
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
  })

  it('rifiuta una data futura', async () => {
    jest.useFakeTimers({ now: new Date('2026-07-01T10:00:00Z') })

    const errore = await service
      .segnaPresentato('t1', 2025, 'u1', new Date('2026-07-05T10:00:00Z'))
      .catch(e => e)

    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe('La data di presentazione non può essere nel futuro.')
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('subito dopo la mezzanotte italiana la data di oggi non è futura', async () => {
    // 00:30 del 01/07 a Roma; la pagina manda '2026-07-01', cioè la mezzanotte UTC
    jest.useFakeTimers({ now: new Date('2026-06-30T22:30:00Z') })
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [voce({ generatoIl: '2026-06-29T08:00:00.000Z' })] } })
    )

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-07-01'))

    expect(scritto().update.submittedAt).toEqual(new Date('2026-07-01'))
  })

  it('rifiuta un anno senza tracciato', async () => {
    const errore = await service.segnaPresentato('t1', 2019, 'u1').catch(e => e)

    expect(errore).toBeInstanceOf(NotFoundException)
    expect(errore.message).toContain('non disponibile')
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })

  it('esportazione h1, dati cambiati, segnatura: dati modificati già veri', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        reportData: {
          esportazioni: [voce({ hashAggregato: 'h1', hashDichiarante: hashDichiaranteOggi })],
        },
      })
    )

    await service.segnaPresentato('t1', 2025, 'u1')
    const arg = scritto()
    expect(arg.update.reportData.hashAggregato).toBe('h1')

    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: arg.update.submittedAt,
        reportData: arg.update.reportData,
      })
    )
    const stato = await service.stato('t1', 2025)
    expect(stato.status).toBe('SUBMITTED')
    expect(stato.fileTracciato).toBe(true)
    expect(stato.datiModificatiDopoPresentazione).toBe(true)
  })

  it.each(['SEGNATURA_ERRATA', 'DICHIARAZIONE_DA_SOSTITUIRE'] as const)(
    'annullaPresentazione (%s) riporta a DRAFT e conserva lo storico con il motivo',
    async motivo => {
      prisma.mUDReport.findUnique.mockResolvedValue(
        record({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          submittedBy: 'u1',
          reportData: { hashAggregato: 'h1', annullamenti: [], esportazioni: [{}] },
        })
      )

      await service.annullaPresentazione('t1', 2025, 'u2', motivo)

      const arg = scritto()
      expect(arg.update.status).toBe('DRAFT')
      expect(arg.update.submittedAt).toBeNull()
      expect(arg.update.submittedBy).toBeNull()
      expect(arg.update.reportData.annullamenti).toEqual([
        expect.objectContaining({
          motivo,
          annullataDa: 'u2',
          submittedAt: '2026-06-30T10:00:00.000Z',
          submittedBy: 'u1',
          hashAggregato: 'h1',
          avvisiConfermati: [],
          riepilogo: null,
          fileTracciato: null,
        }),
      ])
      expect(arg.update.reportData.hashAggregato).toBeNull()
      expect(arg.update.reportData.fileTracciato).toBeNull()
      expect(arg.update.reportData.esportazioni).toEqual([{}])
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 't1',
          userId: 'u2',
          action: 'MUD_PRESENTAZIONE_ANNULLATA',
          metadata: expect.objectContaining({ motivo, hashAggregato: 'h1' }),
        }),
      })
    }
  )

  it('annullaPresentazione su un MUD non presentato non scrive nulla', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(record({ status: 'DRAFT' }))

    const stato = await service.annullaPresentazione('t1', 2025, 'u2', 'SEGNATURA_ERRATA')

    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
    expect(stato.status).toBe('DRAFT')
  })

  it('segnatura e annullamento prendono il lock del report', async () => {
    const ordine: string[] = []
    prisma.$executeRaw.mockImplementation(async () => {
      ordine.push('lock')
    })
    let stato = 'DRAFT'
    prisma.mUDReport.findUnique.mockImplementation(async () => {
      ordine.push('read')
      return record({
        status: stato,
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        reportData: { esportazioni: [voce()] },
      })
    })

    await service.segnaPresentato('t1', 2025, 'u1')
    expect(ordine.slice(0, 2)).toEqual(['lock', 'read'])
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['mud-report|t1|2025'])

    stato = 'SUBMITTED'
    ordine.length = 0
    prisma.$executeRaw.mockClear()
    await service.annullaPresentazione('t1', 2025, 'u2', 'SEGNATURA_ERRATA')
    expect(ordine.slice(0, 2)).toEqual(['lock', 'read'])
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['mud-report|t1|2025'])
  })

  // (confutazione dopo l'esecuzione, A-W-03): la pagina sceglie a quale file legare la
  // segnatura e mostra le quantità di quel file nella conferma
  it('elenca le esportazioni dell anno con versione, avvisi confermati e quantità del file', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        reportData: {
          esportazioni: [
            voce({
              generatoIl: '2026-04-01T08:00:00.000Z',
              riepilogo: { ...RIEPILOGO_FILE, kgInMeno: 350, kgInPiu: 36 },
            }),
            'voce di forma inattesa',
            voce({ versione: 7, avvisiConfermati: 'X', riepilogo: null }),
          ],
        },
      })
    )

    const stato = await service.stato('t1', 2025)

    expect(stato.esportazioni).toEqual([
      {
        generatoIl: '2026-04-01T08:00:00.000Z',
        versione: '6.04/25',
        avvisiConfermati: ['SCARICO_SENZA_FIR'],
        kgInMeno: 350,
        kgInPiu: 36,
      },
      {
        generatoIl: '2026-04-02T08:00:00.000Z',
        versione: null,
        avvisiConfermati: [],
        kgInMeno: 0,
        kgInPiu: 0,
      },
    ])
  })

  it('segnala i dati modificati dopo la presentazione', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        reportData: { hashAggregato: hashAggregato([riga170405]), fileTracciato: true },
      })
    )
    aggregazione.aggrega.mockResolvedValue(
      aggregato([{ ...riga170405, prodottoKg: 101, recuperoKg: 101 }], [])
    )
    expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(true)

    aggregazione.aggrega.mockResolvedValue(aggregato([riga170405], []))
    expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(false)
  })

  describe('dati del dichiarante modificati dopo la presentazione', () => {
    beforeEach(() => {
      prisma.mUDReport.findUnique.mockResolvedValue(
        record({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          reportData: {
            hashAggregato: hashAggregato([riga170405]),
            hashDichiarante: hashDichiaranteOggi,
            fileTracciato: true,
          },
        })
      )
      aggregazione.aggrega.mockResolvedValue(aggregato([riga170405], []))
    })

    it('stessi dati: nessuna modifica', async () => {
      expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(false)
    })

    it('cambio di ATECO', async () => {
      aggregazione.aggrega.mockResolvedValue({
        ...aggregato([riga170405], []),
        dichiarante: { ...DICHIARANTE, atecoNormalizzato: '382100' },
      })
      expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(true)
    })

    it('una nuova autorizzazione (record AU del file)', async () => {
      prisma.autorizzazioneImpianto.findMany.mockResolvedValue([autorizzazione('AUT-1')])
      expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(true)
    })

    it('azienda non trovata: nessun falso positivo', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null)
      expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(false)
    })
  })

  it('una data diversa nelle autorizzazioni cambia l hash del dichiarante', () => {
    const azienda = aziendaDichiarante(tenant, DICHIARANTE)
    const a = { ...autorizzazione('AUT-1'), dataRilascio: new Date('2020-01-15T00:00:00Z') }
    const b = { ...autorizzazione('AUT-1'), dataRilascio: new Date('2021-01-15T00:00:00Z') }
    expect(hashDichiarante({ azienda, autorizzazioni: [a as any] })).not.toBe(
      hashDichiarante({ azienda, autorizzazioni: [b as any] })
    )
  })

  it('un record segnato prima di questo piano, senza le chiavi, vale fileTracciato false', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-04-30T10:00:00Z'),
        reportData: null,
      })
    )

    const stato = await service.stato('t1', 2025)

    expect(stato).toEqual({
      year: 2025,
      status: 'SUBMITTED',
      submittedAt: new Date('2026-04-30T10:00:00Z'),
      datiModificatiDopoPresentazione: false,
      fileTracciato: false,
      esportazioni: [],
      prossimoFileSostituisce: new Date('2026-04-30T10:00:00Z'),
      // record segnato prima di F2-8: nessuna versione salvata = 1
      versioneCalcolo: 1,
      versioneCalcoloAttuale: 2,
    })
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })

  describe('annullamento e nuovo file: dichiarazione sostitutiva (A-W-04)', () => {
    /** Database finto con un solo MUDReport che si aggiorna davvero. */
    function databaseFinto(iniziale: any) {
      let rec = iniziale
      const db: any = {
        tenant: { findUnique: jest.fn(async () => tenant) },
        autorizzazioneImpianto: { findMany: jest.fn(async () => []) },
        mUDReport: {
          findUnique: jest.fn(async () => (rec ? { ...rec } : null)),
          upsert: jest.fn(async ({ create, update }: any) => {
            rec = rec ? { ...rec, ...update } : { ...create }
          }),
        },
        activityLog: { create: jest.fn() },
        $executeRaw: jest.fn(),
        $transaction: async (fn: any) => fn(db),
        letto: () => rec,
      }
      return db
    }

    async function annullaEdEsporta(motivo: 'SEGNATURA_ERRATA' | 'DICHIARAZIONE_DA_SOSTITUIRE') {
      const db = databaseFinto(
        record({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          submittedBy: 'u1',
          reportData: { esportazioni: [voce()], hashAggregato: 'h-file' },
        })
      )
      const agg = { aggrega: jest.fn().mockResolvedValue(aggregato([riga170405], [])) }
      const registry = new MudVersionRegistry()
      await new MudPresentazioneService(db, registry, agg as any, logger).annullaPresentazione(
        't1',
        2025,
        'u2',
        motivo
      )
      const file = await new MudExportService(db, registry, agg as any, logger).exportTelematico(
        't1',
        2025,
        { id: 'u2', role: 'ADMIN' }
      )
      const aa = file.content.split('\r\n').find(l => l.startsWith('AA;'))!
      const esportazioni = db.letto().reportData.esportazioni
      return { aa, nuovaVoce: esportazioni[esportazioni.length - 1] }
    }

    it('annullata per DICHIARAZIONE_DA_SOSTITUIRE: il nuovo file sostituisce la comunicazione del 30/06/2026', async () => {
      const { aa, nuovaVoce } = await annullaEdEsporta('DICHIARAZIONE_DA_SOSTITUIRE')
      expect(aa.endsWith(';1;20260630;')).toBe(true)
      expect(aa).toHaveLength(338)
      expect(nuovaVoce.sostituisce).toBe('2026-06-30T10:00:00.000Z')
    })

    it('annullata per SEGNATURA_ERRATA: il nuovo file è una prima dichiarazione', async () => {
      const { aa, nuovaVoce } = await annullaEdEsporta('SEGNATURA_ERRATA')
      expect(aa.endsWith(';0;00000000;')).toBe(true)
      expect(aa).toHaveLength(338)
      expect(nuovaVoce.sostituisce).toBeNull()
    })

    it('lo stato dice quale comunicazione sostituirà il prossimo file', async () => {
      const db = databaseFinto(
        record({
          status: 'SUBMITTED',
          submittedAt: new Date('2026-06-30T10:00:00Z'),
          submittedBy: 'u1',
          reportData: { esportazioni: [voce()], hashAggregato: 'h-file' },
        })
      )
      const agg = { aggrega: jest.fn().mockResolvedValue(aggregato([riga170405], [])) }
      const s = new MudPresentazioneService(db, new MudVersionRegistry(), agg as any, logger)
      const stato = await s.annullaPresentazione('t1', 2025, 'u2', 'DICHIARAZIONE_DA_SOSTITUIRE')
      expect(stato.status).toBe('DRAFT')
      expect(stato.prossimoFileSostituisce).toEqual(new Date('2026-06-30T10:00:00.000Z'))
    })

    it('S1 → DA_SOSTITUIRE → S2 → SEGNATURA_ERRATA: il nuovo file sostituisce ancora S1', async () => {
      const db = databaseFinto(null)
      const agg = { aggrega: jest.fn().mockResolvedValue(aggregato([riga170405], [])) }
      const registry = new MudVersionRegistry()
      const presentazione = new MudPresentazioneService(db, registry, agg as any, logger)
      const esporta = new MudExportService(db, registry, agg as any, logger)
      const admin = { id: 'u1', role: 'ADMIN' as const }

      // il file si genera prima delle date di presentazione usate sotto
      jest.useFakeTimers({ now: new Date('2026-05-02T08:00:00Z') })
      await esporta.exportTelematico('t1', 2025, admin)
      jest.setSystemTime(new Date('2026-07-01T08:00:00Z'))
      await presentazione.segnaPresentato('t1', 2025, 'u1', new Date('2026-05-10T00:00:00Z'))
      await presentazione.annullaPresentazione('t1', 2025, 'u1', 'DICHIARAZIONE_DA_SOSTITUIRE')
      await presentazione.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-01T00:00:00Z'))
      const stato = await presentazione.annullaPresentazione('t1', 2025, 'u1', 'SEGNATURA_ERRATA')

      expect(stato.prossimoFileSostituisce).toEqual(new Date('2026-05-10T00:00:00.000Z'))
      const file = await esporta.exportTelematico('t1', 2025, admin)
      const aa = file.content.split('\r\n').find(l => l.startsWith('AA;'))!
      expect(aa.endsWith(';1;20260510;')).toBe(true)
    })
  })

  describe('versione del calcolo della presentazione (D10)', () => {
    const SUBMITTED = (reportData: Record<string, unknown>) =>
      record({ status: 'SUBMITTED', submittedAt: new Date('2026-06-30T10:00:00Z'), reportData })

    // Dichiarazione a una sede con una giacenza al 31/12: 500 prodotti - 200 avviati = 300 kg
    // ancora in registro, che la versione 2 dichiara e la versione 1 no.
    const mov = (p: Partial<MovimentoFinto>): MovimentoFinto => ({
      registroId: 'reg-A',
      progressiveNumber: 1,
      progressiveYear: 2025,
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      causaleAziendaId: null,
      cerCode: '17 04 05',
      quantity: 500,
      unit: 'KG',
      operationCode: null,
      firId: null,
      firIdRicopia: null,
      ricopiaChiave: '',
      counterpartName: null,
      wastePhysicalState: null,
      movementDate: new Date('2025-06-10T08:00:00Z'),
      ...p,
    })
    const movimenti = [
      mov({}),
      mov({
        progressiveNumber: 2,
        type: 'SCARICO',
        causale: 'AVVIO_RECUPERO',
        quantity: 200,
        operationCode: 'R13',
        counterpartName: 'Recuperi Nord Srl',
        movementDate: new Date('2025-07-01T08:00:00Z'),
      }),
    ]
    const loggerAgg: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const referenceData: any = { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) }
    const reale = () => {
      const finto = creaPrismaFinto({ movimenti })
      const servizio = new MudAggregazioneService(finto, referenceData, loggerAgg)
      return {
        servizio,
        oracolo: new MudAggregazioneOracoloA2bf11e(finto, referenceData, loggerAgg, servizio),
      }
    }

    it('stato: un MUD presentato senza versioneCalcolo si confronta con la versione 1 e non risulta modificato dopo le giacenze nuove', async () => {
      const { servizio, oracolo } = reale()
      // il calcolo di oggi ha davvero le giacenze al 31/12 (300 kg), quello di prima no
      const oggi = await servizio.aggrega('t1', 2025)
      expect(oggi.righe[0].giacenzaRecuperoKg).toBe(300)
      const storico = await oracolo.aggrega('t1', 2025)
      expect(storico.righe[0].giacenzaRecuperoKg).toBeUndefined()
      // presentazione salvata con l'hash dell'oracolo (a2bf11e), senza versioneCalcolo
      prisma.mUDReport.findUnique.mockResolvedValue(
        SUBMITTED({ hashAggregato: hashAggregato(storico.righe), fileTracciato: true })
      )
      const spia = jest.spyOn(servizio, 'aggrega')
      const reale1 = new MudPresentazioneService(prisma, new MudVersionRegistry(), servizio, logger)

      const stato = await reale1.stato('t1', 2025)

      expect(spia).toHaveBeenCalledWith('t1', 2025, { versioneCalcolo: 1 })
      expect(stato.datiModificatiDopoPresentazione).toBe(false)
      expect(stato.versioneCalcolo).toBe(1)
      expect(stato.versioneCalcoloAttuale).toBe(2)
      // controprova: col calcolo di oggi lo stesso hash risulterebbe diverso
      expect(hashCalcoloMud(oggi)).not.toBe(hashAggregato(storico.righe))
    })

    it('stato: con versione 2 una rettifica dopo la presentazione risulta', async () => {
      const { servizio } = reale()
      const presentato = await servizio.aggrega('t1', 2025)
      prisma.mUDReport.findUnique.mockResolvedValue(
        SUBMITTED({
          hashAggregato: hashCalcoloMud(presentato),
          versioneCalcolo: 2,
          fileTracciato: true,
        })
      )
      const s = new MudPresentazioneService(prisma, new MudVersionRegistry(), servizio, logger)
      expect((await s.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(false)

      // una rettifica dopo la presentazione: 200 kg avviati diventano 250
      const finto2 = creaPrismaFinto({
        movimenti: [movimenti[0], { ...movimenti[1], quantity: 250 }],
      })
      const servizio2 = new MudAggregazioneService(finto2, referenceData, loggerAgg)
      const spia = jest.spyOn(servizio2, 'aggrega')
      const s2 = new MudPresentazioneService(prisma, new MudVersionRegistry(), servizio2, logger)
      const stato = await s2.stato('t1', 2025)
      expect(spia).toHaveBeenCalledWith('t1', 2025, { versioneCalcolo: 2 })
      expect(stato.datiModificatiDopoPresentazione).toBe(true)
      expect(stato.versioneCalcolo).toBe(2)
    })

    it('stato: una versione salvata fuori dall elenco vale 1', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue(
        SUBMITTED({
          hashAggregato: hashAggregato([riga170405]),
          versioneCalcolo: '2',
          fileTracciato: true,
        })
      )
      const stato = await service.stato('t1', 2025)
      expect(aggregazione.aggrega).toHaveBeenCalledWith('t1', 2025, { versioneCalcolo: 1 })
      expect(stato.versioneCalcolo).toBe(1)
    })

    it('segna: copia la versione della voce', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue(
        record({
          reportData: {
            esportazioni: [
              voce({ generatoIl: '2026-04-02T08:00:00.000Z', versioneCalcolo: 2 }),
              voce({ generatoIl: '2026-04-01T08:00:00.000Z', versioneCalcolo: undefined }),
            ],
          },
        })
      )
      // ultima voce (senza versione, di prima di F2-8) → 1
      await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'))
      expect(scritto().update.reportData.versioneCalcolo).toBe(1)
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.versioneCalcolo).toBe(1)

      // voce indicata con la versione 2 → 2
      prisma.mUDReport.upsert.mockClear()
      prisma.activityLog.create.mockClear()
      await service.segnaPresentato(
        't1',
        2025,
        'u1',
        new Date('2026-06-30T10:00:00Z'),
        '2026-04-02T08:00:00.000Z'
      )
      expect(scritto().update.reportData.versioneCalcolo).toBe(2)
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.versioneCalcolo).toBe(2)
    })

    it('segna: hash di ripiego con la versione attuale', async () => {
      // voce di forma inattesa, senza hash: si salva l'hash di oggi e la versione di oggi
      prisma.mUDReport.findUnique.mockResolvedValue(
        record({ reportData: { esportazioni: [{ versioneCalcolo: 1 }] } })
      )
      await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'))
      expect(scritto().update.reportData.hashAggregato).toBe(hashAggregato([riga170405]))
      expect(scritto().update.reportData.versioneCalcolo).toBe(2)
    })

    it('segna senza file: versione attuale', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: {} }))
      await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'))
      expect(scritto().update.reportData.fileTracciato).toBe(false)
      expect(scritto().update.reportData.versioneCalcolo).toBe(2)
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.versioneCalcolo).toBe(2)
    })

    it('annulla: conserva la versione nello storico', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue(
        SUBMITTED({
          hashAggregato: 'h-file',
          versioneCalcolo: 2,
          fileTracciato: true,
          annullamenti: [],
        })
      )
      await service.annullaPresentazione('t1', 2025, 'u2', 'SEGNATURA_ERRATA')
      const dati = scritto().update.reportData
      expect(dati.versioneCalcolo).toBeNull()
      expect(dati.annullamenti).toHaveLength(1)
      expect(dati.annullamenti[0].versioneCalcolo).toBe(2)
      expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.versioneCalcolo).toBe(2)

      // una presentazione di prima di F2-8 non ha la chiave: resta null nello storico
      prisma.mUDReport.upsert.mockClear()
      prisma.mUDReport.findUnique.mockResolvedValue(
        SUBMITTED({ hashAggregato: 'h-file', fileTracciato: true })
      )
      await service.annullaPresentazione('t1', 2025, 'u2', 'SEGNATURA_ERRATA')
      expect(scritto().update.reportData.annullamenti[0].versioneCalcolo).toBeNull()
    })
  })
})
