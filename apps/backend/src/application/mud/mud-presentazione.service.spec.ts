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
import { hashAggregato, hashDichiarante } from './aggregazione/mud-regole'
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

      await esporta.exportTelematico('t1', 2025, admin)
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
})
