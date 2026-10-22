import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { MudPresentazioneService } from './mud-presentazione.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { controlliMud, type RifMovimento } from './aggregazione/mud-controlli'
import { hashAggregato, hashDichiarante } from './aggregazione/mud-regole'
import { aziendaDichiarante } from './export/mud-export.service'
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
  const hashDichiaranteOggi = hashDichiarante(aziendaDichiarante(tenant, DICHIARANTE))

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

  /** Primo argomento passato a `upsert`. */
  const scritto = () => prisma.mUDReport.upsert.mock.calls[0][0]

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
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

  it('stato senza record è DRAFT', async () => {
    const stato = await service.stato('t1', 2025)

    expect(stato).toEqual({
      year: 2025,
      status: 'DRAFT',
      submittedAt: null,
      datiModificatiDopoPresentazione: false,
      fileTracciato: null,
    })
    expect(prisma.mUDReport.findUnique).toHaveBeenCalledWith({
      where: { tenantId_year: { tenantId: 't1', year: 2025 } },
    })
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })

  it('segnaPresentato salva l hash dei dati e scrive nel registro attività', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({ reportData: { esportazioni: [{}], integrazioni: { x: 1 } } })
    )

    await service.segnaPresentato('t1', 2025, 'u1', new Date('2026-06-30T10:00:00Z'), [
      'SCARICO_SENZA_FIR',
    ])

    const arg = scritto()
    expect(arg.where).toEqual({ tenantId_year: { tenantId: 't1', year: 2025 } })
    expect(arg.update.status).toBe('SUBMITTED')
    expect(arg.update.submittedBy).toBe('u1')
    expect(arg.update.submittedAt).toEqual(new Date('2026-06-30T10:00:00Z'))
    expect(arg.update.reportData.hashAggregato).toBe(hashAggregato([riga170405]))
    expect(arg.update.reportData.avvisiConfermatiAllaPresentazione).toEqual(['SCARICO_SENZA_FIR'])
    expect(arg.update.reportData.riepilogoAllaPresentazione).toEqual(
      expect.objectContaining({ kgInMeno: 0, kgInPiu: 0, movimentiNonQuantificati: 0 })
    )
    expect(arg.update.reportData.riepilogoAllaPresentazione.testo).toBeUndefined()
    expect(arg.update.reportData.fileTracciato).toBe(true)
    expect(arg.update.reportData.annullamenti).toEqual([])
    // le chiavi esistenti si conservano
    expect(arg.update.reportData.esportazioni).toEqual([{}])
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
          hashAggregato: hashAggregato([riga170405]),
        }),
      }),
    })
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

  it('un anno con esportazioni e bloccanti no', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato([riga170405], [controlliMud.registroVuotoConFir(2025, ['FIR 1/2025'])])
    )
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni: [{}] } }))

    const errore = await service.segnaPresentato('t1', 2025, 'u1').catch(e => e)

    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse().error).toBe('MUD_NON_GENERABILE')
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
  })

  it('la segnatura richiede la conferma degli avvisi e la salva', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni: [{}] } }))

    const errore = await service.segnaPresentato('t1', 2025, 'u1').catch(e => e)

    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse().error).toBe('MUD_AVVISI_DA_CONFERMARE')
    expect(errore.getResponse().message).toBe(
      'Il MUD non è stato segnato come presentato: ci sono avvisi da confermare (1).'
    )
    expect(errore.getResponse().details.avvisiDaConfermare).toEqual(['SCARICO_SENZA_FIR'])
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()

    // attraverso il filtro globale i dati arrivano al client in details
    const json = jest.fn()
    const response: any = { status: jest.fn().mockReturnValue({ json }) }
    const host: any = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ url: '/x' }) }),
    }
    new HttpExceptionFilter({ setContext: jest.fn(), error: jest.fn() } as any).catch(errore, host)
    expect(response.status).toHaveBeenCalledWith(422)
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'MUD_AVVISI_DA_CONFERMARE',
        details: { controlli: [avvisoScarico], avvisiDaConfermare: ['SCARICO_SENZA_FIR'] },
      })
    )
  })

  it('non si segna un MUD con bloccanti', async () => {
    aggregazione.aggrega.mockResolvedValue(
      aggregato([riga170405], [controlliMud.dichiaranteSenzaAteco()])
    )
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni: [{}] } }))

    const errore = await service.segnaPresentato('t1', 2025, 'u1').catch(e => e)

    expect(errore).toBeInstanceOf(UnprocessableEntityException)
    expect(errore.getResponse()).toEqual({
      message: 'Il MUD non può essere segnato come presentato: ci sono errori da correggere (1).',
      error: 'MUD_NON_GENERABILE',
      details: { controlli: [controlliMud.dichiaranteSenzaAteco()] },
    })
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
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

  it('con più esportazioni si lega all ultima, o a quella indicata', async () => {
    const esportazioni = [
      { generatoIl: '2026-04-01T08:00:00.000Z', hashAggregato: 'h-vecchio', hashDichiarante: 'd0' },
      { generatoIl: '2026-04-02T08:00:00.000Z', hashAggregato: 'h-ultimo', hashDichiarante: 'd1' },
    ]
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni } }))

    await service.segnaPresentato('t1', 2025, 'u1', undefined, ['SCARICO_SENZA_FIR'])
    expect(scritto().update.reportData.hashAggregato).toBe('h-ultimo')
    expect(scritto().update.reportData.hashDichiarante).toBe('d1')
    expect(scritto().update.reportData.esportazionePresentata).toBe('2026-04-02T08:00:00.000Z')

    prisma.mUDReport.upsert.mockClear()
    await service.segnaPresentato(
      't1',
      2025,
      'u1',
      undefined,
      ['SCARICO_SENZA_FIR'],
      '2026-04-01T08:00:00.000Z'
    )
    expect(scritto().update.reportData.hashAggregato).toBe('h-vecchio')
    expect(scritto().update.reportData.esportazionePresentata).toBe('2026-04-01T08:00:00.000Z')

    prisma.mUDReport.upsert.mockClear()
    const errore = await service
      .segnaPresentato('t1', 2025, 'u1', undefined, ['SCARICO_SENZA_FIR'], '2026-01-01')
      .catch(e => e)
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe("Esportazione indicata non trovata fra quelle dell'anno.")
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('esportazione h1, dati cambiati, segnatura: dati modificati già veri', async () => {
    const esportazioni = [
      {
        generatoIl: '2026-04-02T08:00:00.000Z',
        hashAggregato: 'h1',
        hashDichiarante: hashDichiaranteOggi,
      },
    ]
    prisma.mUDReport.findUnique.mockResolvedValue(record({ reportData: { esportazioni } }))

    await service.segnaPresentato('t1', 2025, 'u1', undefined, ['SCARICO_SENZA_FIR'])
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

  it('annullaPresentazione riporta a DRAFT e conserva lo storico', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(
      record({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        submittedBy: 'u1',
        reportData: { hashAggregato: 'h1', annullamenti: [], esportazioni: [{}] },
      })
    )

    await service.annullaPresentazione('t1', 2025, 'u2')

    const arg = scritto()
    expect(arg.update.status).toBe('DRAFT')
    expect(arg.update.submittedAt).toBeNull()
    expect(arg.update.submittedBy).toBeNull()
    expect(arg.update.reportData.annullamenti).toEqual([
      expect.objectContaining({
        annullataDa: 'u2',
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
      }),
    })
  })

  it('annullaPresentazione su un MUD non presentato non scrive nulla', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(record({ status: 'DRAFT' }))

    const stato = await service.annullaPresentazione('t1', 2025, 'u2')

    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    expect(prisma.activityLog.create).not.toHaveBeenCalled()
    expect(stato.status).toBe('DRAFT')
  })

  it('segnatura e annullamento prendono il lock del report', async () => {
    const ordine: string[] = []
    prisma.$executeRaw.mockImplementation(async () => {
      ordine.push('lock')
    })
    prisma.mUDReport.findUnique.mockImplementation(async () => {
      ordine.push('read')
      return record({
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        reportData: { esportazioni: [{}] },
      })
    })

    await service.segnaPresentato('t1', 2025, 'u1', undefined, ['SCARICO_SENZA_FIR'])
    expect(ordine.slice(0, 2)).toEqual(['lock', 'read'])
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['mud-report|t1|2025'])

    ordine.length = 0
    prisma.$executeRaw.mockClear()
    await service.annullaPresentazione('t1', 2025, 'u2')
    expect(ordine.slice(0, 2)).toEqual(['lock', 'read'])
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['mud-report|t1|2025'])
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

  it('segnala come dati modificati anche un cambio dei dati del dichiarante (ATECO)', async () => {
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
    expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(false)

    aggregazione.aggrega.mockResolvedValue({
      ...aggregato([riga170405], []),
      dichiarante: { ...DICHIARANTE, atecoNormalizzato: '382100' },
    })
    expect((await service.stato('t1', 2025)).datiModificatiDopoPresentazione).toBe(true)
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
    })
    expect(aggregazione.aggrega).not.toHaveBeenCalled()
  })
})
