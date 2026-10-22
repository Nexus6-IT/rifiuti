import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MudIntegrazioniService } from './mud-integrazioni.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import { INTEGRAZIONI_VUOTE } from './aggregazione/mud-integrazioni'
import type { IntegrazioniMudDto } from '../../api/mud/dtos/integrazioni-mud.dto'

describe('MudIntegrazioniService', () => {
  let service: MudIntegrazioniService
  let prisma: any
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }

  /** Corpo del PUT: le liste mancanti valgono come vuote (preflight F32). */
  const dati = (d: Partial<IntegrazioniMudDto>): IntegrazioniMudDto => ({
    destinatari: [],
    pesiSpecifici: [],
    ...d,
  })

  beforeEach(() => {
    prisma = {
      mUDReport: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ partitaIva: '01234567897', codiceFiscale: null }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    }
    service = new MudIntegrazioniService(prisma, new MudVersionRegistry(), logger)
  })

  const scritto = () => prisma.mUDReport.upsert.mock.calls[0][0].create.reportData.integrazioni

  it('rifiuta un CF o una partita IVA con il controllo sbagliato', async () => {
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678901' }] })
      )
    ).rejects.toThrow(
      'Codice fiscale o partita IVA "12345678901" di "Ecologia Srl" non valido: il carattere di controllo non corrisponde.'
    )
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it("rifiuta il codice dell'azienda stessa come destinatario", async () => {
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '01234567897' }] })
      )
    ).rejects.toThrow('è quello della vostra azienda')
  })

  // (confutazione dopo l'esecuzione, A-W-13)
  it('il CF della propria azienda si accetta solo con la conferma', async () => {
    const voce = { ragioneSociale: 'Impianto Nord', codiceFiscale: '01234567897' }
    const errore = await service
      .salva('t1', 2025, 'u1', dati({ destinatari: [voce] }))
      .catch(e => e)
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toBe(
      'Il codice "01234567897" è quello della vostra azienda: se "Impianto Nord" è un vostro impianto confermarlo esplicitamente, altrimenti inserire il codice del destinatario.'
    )
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()

    await service.salva(
      't1',
      2025,
      'u1',
      dati({ destinatari: [{ ...voce, confermaPropriaAzienda: true }] })
    )
    expect(scritto().destinatari['IMPIANTO NORD']).toEqual({
      ragioneSociale: 'Impianto Nord',
      codiceFiscale: '01234567897',
      confermatoPropriaAzienda: true,
    })
    expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.modifiche).toEqual([
      {
        tipo: 'CF_DESTINATARIO',
        chiave: 'IMPIANTO NORD',
        prima: null,
        dopo: '01234567897 (codice della propria azienda, confermato)',
      },
    ])
  })

  it('riconosce il codice della propria azienda anche dal codice fiscale e con il prefisso IT', async () => {
    prisma.tenant.findUnique.mockResolvedValue({
      partitaIva: '01234567897',
      codiceFiscale: 'RSSMRA80A01H501U',
    })
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ destinatari: [{ ragioneSociale: 'X', codiceFiscale: 'rssmra80a01h501u' }] })
      )
    ).rejects.toThrow('è quello della vostra azienda')
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ destinatari: [{ ragioneSociale: 'X', codiceFiscale: 'IT01234567897' }] })
      )
    ).rejects.toThrow('è quello della vostra azienda')
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { partitaIva: true, codiceFiscale: true },
    })
  })

  // (confutazione dopo l'esecuzione, A-W-05)
  it('un destinatario estero si salva con la nazione e senza CF', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({
        destinatari: [
          { ragioneSociale: 'Recycling GmbH', codiceFiscale: '', nazione: ' Germania ' },
        ],
      })
    )
    expect(scritto().destinatari).toEqual({
      'RECYCLING GMBH': {
        ragioneSociale: 'Recycling GmbH',
        codiceFiscale: '',
        nazione: 'Germania',
      },
    })
    expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.modifiche).toEqual([
      { tipo: 'CF_DESTINATARIO', chiave: 'RECYCLING GMBH', prima: null, dopo: 'estero: Germania' },
    ])
  })

  // (confutazione dopo l'esecuzione, A-W-07 e A-W-08)
  it('salva destinatario del movimento e CF del trasportatore', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({
        destinatariMovimento: [
          { anno: 2025, numero: 5, ragioneSociale: ' Ecologia Srl ', codiceFiscale: '12345678903' },
        ],
        trasportatori: [{ ragioneSociale: 'Trasporti Srl', codiceFiscale: 'IT12345678903' }],
      })
    )
    const i = scritto()
    // chiave del movimento come la scrive il backend nei controlli: anno/numero
    expect(i.destinatariMovimento).toEqual({
      '2025/5': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
    })
    expect(i.trasportatori).toEqual({
      'TRASPORTI SRL': { ragioneSociale: 'Trasporti Srl', codiceFiscale: '12345678903' },
    })
    expect(prisma.activityLog.create.mock.calls[0][0].data.metadata.modifiche).toEqual([
      {
        tipo: 'DESTINATARIO_MOVIMENTO',
        chiave: '2025/5',
        prima: null,
        dopo: 'Ecologia Srl – 12345678903',
      },
      { tipo: 'CF_TRASPORTATORE', chiave: 'TRASPORTI SRL', prima: null, dopo: '12345678903' },
    ])
  })

  it('verifica il CF anche dei destinatari dei movimenti e dei trasportatori', async () => {
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({
          destinatariMovimento: [
            { anno: 2025, numero: 5, ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678901' },
          ],
        })
      )
    ).rejects.toThrow('"12345678901" di "Ecologia Srl" non valido')
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ trasportatori: [{ ragioneSociale: 'Trasporti Srl', codiceFiscale: '12345678901' }] })
      )
    ).rejects.toThrow('"12345678901" di "Trasporti Srl" non valido')
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({
          destinatariMovimento: [
            { anno: 2025, numero: 5, ragioneSociale: 'Nostro', codiceFiscale: '01234567897' },
          ],
        })
      )
    ).rejects.toThrow('è quello della vostra azienda')
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('il CF della propria azienda vale per il trasportatore senza conferma (trasporto in conto proprio)', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({ trasportatori: [{ ragioneSociale: 'Noi Spa', codiceFiscale: '01234567897' }] })
    )
    expect(scritto().trasportatori).toEqual({
      'NOI SPA': { ragioneSociale: 'Noi Spa', codiceFiscale: '01234567897' },
    })
  })

  it('un peso specifico fuori intervallo richiede la conferma', async () => {
    const voce = { cerCode: '200304', unita: 'm3', kgPerUnita: 1.2 } // t/m³ scritto al posto di kg/m³
    await expect(service.salva('t1', 2025, 'u1', dati({ pesiSpecifici: [voce] }))).rejects.toThrow(
      "Il peso specifico di 1,2 kg per M3 del CER 200304 è fuori dall'intervallo consueto (10–3.000 kg per M3): controllare l'unità (kg, non tonnellate) o confermarlo esplicitamente."
    )
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    await service.salva(
      't1',
      2025,
      'u1',
      dati({ pesiSpecifici: [{ ...voce, confermaFuoriIntervallo: true }] })
    )
    expect(scritto().pesiSpecifici['200304|M3']).toEqual({
      cerCode: '200304',
      unita: 'M3',
      kgPerUnita: 1.2,
      confermatoFuoriIntervallo: true,
    })
  })

  it("per un'unità senza intervallo serve sempre la conferma", async () => {
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ pesiSpecifici: [{ cerCode: '150106', unita: 'pz', kgPerUnita: 1234.5 }] })
      )
    ).rejects.toThrow(
      "Per l'unità PZ non c'è un intervallo di riferimento: confermare esplicitamente il peso specifico di 1.234,5 kg per PZ del CER 150106."
    )
  })

  it('il CER del peso specifico si confronta sulle sole cifre e ne servono 6 (preflight F36)', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({ pesiSpecifici: [{ cerCode: '17 04 05*', unita: 'litri', kgPerUnita: 1.1 }] })
    )
    expect(scritto().pesiSpecifici).toEqual({
      '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.1 },
    })
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ pesiSpecifici: [{ cerCode: '17 04', unita: 'litri', kgPerUnita: 1.1 }] })
      )
    ).rejects.toThrow('Il codice CER "17 04" non è valido: servono 6 cifre.')
  })

  it('il registro attività conserva i valori prima e dopo', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      submittedAt: null,
      submittedBy: null,
      reportData: {
        integrazioni: {
          destinatari: {},
          pesiSpecifici: {
            '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.1 },
          },
        },
      },
    })
    await service.salva(
      't1',
      2025,
      'u1',
      dati({ pesiSpecifici: [{ cerCode: '170405', unita: 'litri', kgPerUnita: 1.2 }] })
    )
    expect(prisma.activityLog.create.mock.calls[0][0].data.metadata).toEqual({
      year: 2025,
      modifiche: [{ tipo: 'PESO_SPECIFICO', chiave: '170405|LITRI', prima: 1.1, dopo: 1.2 }],
    })
  })

  it('senza modifiche non scrive nel registro attività; una voce tolta compare con dopo null', async () => {
    const precedente = {
      destinatari: {
        'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
      },
      pesiSpecifici: {},
    }
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'DRAFT',
      reportData: { integrazioni: precedente },
    })
    await service.salva(
      't1',
      2025,
      'u1',
      dati({ destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' }] })
    )
    expect(prisma.activityLog.create).not.toHaveBeenCalled()

    await service.salva('t1', 2025, 'u1', dati({}))
    expect(prisma.activityLog.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        description: 'Integrazioni del MUD dei dati 2025 aggiornate (1 modifica)',
        metadata: {
          year: 2025,
          modifiche: [
            { tipo: 'CF_DESTINATARIO', chiave: 'ECOLOGIA SRL', prima: '12345678903', dopo: null },
          ],
        },
      })
    )
  })

  it('salva le integrazioni conservando le altre chiavi di reportData e lo stato', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue({
      status: 'SUBMITTED',
      reportData: { hashAggregato: 'h1', esportazioni: [{}] },
    })
    await service.salva('t1', 2025, 'u1', {
      destinatari: [{ ragioneSociale: ' Ecologia Srl ', codiceFiscale: '12345678903' }],
      pesiSpecifici: [{ cerCode: '170405', unita: 'litri', kgPerUnita: 1.2 }],
    })
    const upsert = prisma.mUDReport.upsert.mock.calls[0][0]
    expect(upsert.update.status).toBeUndefined()
    expect(upsert.update.reportData).toEqual({
      hashAggregato: 'h1',
      esportazioni: [{}],
      integrazioni: expect.objectContaining({
        destinatari: {
          'ECOLOGIA SRL': { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
        },
        destinatariMovimento: {},
        trasportatori: {},
        pesiSpecifici: {
          '170405|LITRI': { cerCode: '170405', unita: 'LITRI', kgPerUnita: 1.2 },
        },
        aggiornateDa: 'u1',
      }),
    })
    expect(prisma.$executeRaw).toHaveBeenCalled() // lock di aggiornaReportData
    expect(prisma.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'MUD_INTEGRAZIONI_MODIFICATE',
        tenantId: 't1',
        userId: 'u1',
      }),
    })
  })

  it('rifiuta un peso specifico per un unità di massa', async () => {
    await expect(
      service.salva(
        't1',
        2025,
        'u1',
        dati({ pesiSpecifici: [{ cerCode: '170405', unita: 'kg', kgPerUnita: 1 }] })
      )
    ).rejects.toThrow('Il peso specifico serve solo per le unità diverse da kg e tonnellate.')
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('un anno senza tracciato risponde 404 prima di ogni controllo', async () => {
    await expect(service.salva('t1', 1999, 'u1', dati({}))).rejects.toBeInstanceOf(
      NotFoundException
    )
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled()
  })

  it("codiciAzienda: partita IVA e codice fiscale dell'azienda, normalizzati e senza vuoti", async () => {
    prisma.tenant.findUnique.mockResolvedValue({ partitaIva: 'IT01234567897', codiceFiscale: null })
    expect(await service.codiciAzienda('t1')).toEqual(['01234567897'])
    prisma.tenant.findUnique.mockResolvedValue({
      partitaIva: '01234567897',
      codiceFiscale: 'rssmra80a01h501u',
    })
    expect(await service.codiciAzienda('t1')).toEqual(['01234567897', 'RSSMRA80A01H501U'])
    prisma.tenant.findUnique.mockResolvedValue({
      partitaIva: '01234567897',
      codiceFiscale: '01234567897',
    })
    expect(await service.codiciAzienda('t1')).toEqual(['01234567897'])
  })

  it('leggi restituisce le integrazioni vuote se il record manca', async () => {
    prisma.mUDReport.findUnique.mockResolvedValue(null)
    expect(await service.leggi('t1', 2025)).toEqual(INTEGRAZIONI_VUOTE)
    expect(prisma.mUDReport.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId_year: { tenantId: 't1', year: 2025 } } })
    )
  })
})
