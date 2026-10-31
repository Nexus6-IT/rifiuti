import { BadRequestException, NotFoundException } from '@nestjs/common'
import { MudIntegrazioniService } from './mud-integrazioni.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { IntegrazioniMudDto } from '../../api/mud/dtos/integrazioni-mud.dto'
import { INTEGRAZIONI_VUOTE } from './aggregazione/mud-integrazioni'

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
      registroRifiuti: { findMany: jest.fn().mockResolvedValue([]) },
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('una nazione di soli spazi vale come assente: il CF vuoto si rifiuta', async () => {
    const errore = await service
      .salva(
        't1',
        2025,
        'u1',
        dati({
          destinatari: [{ ragioneSociale: 'Ecologia Srl', codiceFiscale: '', nazione: '   ' }],
        })
      )
      .catch(e => e)
    expect(errore).toBeInstanceOf(BadRequestException)
    expect(errore.message).toContain('di "Ecologia Srl" non valido')
    expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
  })

  it('due righe con la stessa chiave nello stesso PUT: vale l ultima', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({
        destinatari: [
          { ragioneSociale: 'Ecologia Srl', codiceFiscale: '12345678903' },
          { ragioneSociale: ' ecologia srl ', codiceFiscale: '', nazione: 'Germania' },
        ],
      })
    )
    expect(scritto().destinatari).toEqual({
      'ECOLOGIA SRL': { ragioneSociale: 'ecologia srl', codiceFiscale: '', nazione: 'Germania' },
    })
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

  it('MUD: il destinatario del movimento si salva con la chiave che include il registro', async () => {
    await service.salva(
      't1',
      2025,
      'u1',
      dati({
        destinatariMovimento: [
          {
            anno: 2025,
            numero: 3,
            registroId: '11111111-1111-4111-8111-111111111111',
            ragioneSociale: 'Ecologia Srl',
            codiceFiscale: '12345678903',
          },
          {
            anno: 2025,
            numero: 3,
            registroId: '22222222-2222-4222-8222-222222222222',
            ragioneSociale: 'Altra Srl',
            codiceFiscale: '12345678903',
          },
        ],
      })
    )
    expect(Object.keys(scritto().destinatariMovimento)).toEqual([
      '2025/3@11111111-1111-4111-8111-111111111111',
      '2025/3@22222222-2222-4222-8222-222222222222',
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

  it('etichetteRegistri: vuota con un registro solo, sede per registro con più registri', async () => {
    prisma.registroRifiuti.findMany.mockResolvedValue([
      { id: 'r1', descrizione: 'Registro', unitaLocale: { denominazione: 'Sede A' } },
    ])
    expect(await service.etichetteRegistri('t1')).toEqual({})

    prisma.registroRifiuti.findMany.mockResolvedValue([
      { id: 'r1', descrizione: 'Registro', unitaLocale: { denominazione: 'Sede A' } },
      { id: 'r2', descrizione: 'Registro cronologico', unitaLocale: null },
    ])
    expect(await service.etichetteRegistri('t1')).toEqual({
      r1: 'Sede A',
      r2: 'Registro cronologico',
    })
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

  describe('destinazione delle giacenze (D9)', () => {
    const UL1 = '11111111-1111-4111-8111-111111111111'
    const sedeDi = (...ids: string[]) =>
      prisma.rentriUnitaLocale.findMany.mockResolvedValue(ids.map(id => ({ id })))
    const giacenza = (
      p: Partial<{ cerCode: string; unitaLocaleId: string | null; destinazione: any }>
    ) => ({
      cerCode: '17 04 05',
      unitaLocaleId: UL1,
      destinazione: 'R',
      ...p,
    })

    it('salva la destinazione della giacenza e la registra in ActivityLog', async () => {
      sedeDi(UL1)
      const r = await service.salva(
        't1',
        2025,
        'u1',
        dati({
          destinazioniGiacenza: [
            giacenza({}),
            giacenza({ unitaLocaleId: null, cerCode: '200301', destinazione: 'D' }),
          ],
        })
      )
      expect(r.destinazioniGiacenza).toEqual({
        [`${UL1}|170405`]: { cerCode: '170405', unitaLocaleId: UL1, destinazione: 'R' },
        'AZIENDA|200301': { cerCode: '200301', unitaLocaleId: null, destinazione: 'D' },
      })
      expect(scritto().destinazioniGiacenza).toEqual(r.destinazioniGiacenza)
      // la sede si cerca fra quelle dell'azienda
      expect(prisma.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: 't1' }) })
      )
      const modifiche = prisma.activityLog.create.mock.calls[0][0].data.metadata.modifiche
      // ordine per chiave: le cifre dell'id precedono 'AZIENDA'
      expect(modifiche).toEqual([
        { tipo: 'DESTINAZIONE_GIACENZA', chiave: `${UL1}|170405`, prima: null, dopo: 'recupero' },
        {
          tipo: 'DESTINAZIONE_GIACENZA',
          chiave: 'AZIENDA|200301',
          prima: null,
          dopo: 'smaltimento',
        },
      ])
    })

    it('una destinazione tolta compare in ActivityLog', async () => {
      sedeDi(UL1)
      prisma.mUDReport.findUnique.mockResolvedValue({
        reportData: {
          integrazioni: {
            ...INTEGRAZIONI_VUOTE,
            destinazioniGiacenza: {
              [`${UL1}|170405`]: { cerCode: '170405', unitaLocaleId: UL1, destinazione: 'R' },
            },
          },
        },
      })
      await service.salva('t1', 2025, 'u1', dati({}))
      const modifiche = prisma.activityLog.create.mock.calls[0][0].data.metadata.modifiche
      expect(modifiche).toEqual([
        { tipo: 'DESTINAZIONE_GIACENZA', chiave: `${UL1}|170405`, prima: 'recupero', dopo: null },
      ])
    })

    it('destinazione diversa da R o D → 400', async () => {
      const dto = plainToInstance(IntegrazioniMudDto, {
        destinatari: [],
        pesiSpecifici: [],
        destinazioniGiacenza: [{ cerCode: '170405', unitaLocaleId: null, destinazione: 'X' }],
      })
      const errori = await validate(dto)
      expect(JSON.stringify(errori)).toContain('destinazione')
      // un CER senza 6 cifre lo rifiuta il servizio
      const errore = await service
        .salva(
          't1',
          2025,
          'u1',
          dati({ destinazioniGiacenza: [giacenza({ cerCode: '1704', unitaLocaleId: null })] })
        )
        .catch(e => e)
      expect(errore).toBeInstanceOf(BadRequestException)
      expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    })

    it("sede di un'altra azienda → 400", async () => {
      sedeDi() // la ricerca per tenant non la trova
      const errore = await service
        .salva('t1', 2025, 'u1', dati({ destinazioniGiacenza: [giacenza({})] }))
        .catch(e => e)
      expect(errore).toBeInstanceOf(BadRequestException)
      expect(errore.message).toBe('Unità locale non trovata')
      expect(errore.message).not.toContain(UL1)
      expect(prisma.mUDReport.upsert).not.toHaveBeenCalled()
    })

    it('PUT senza destinazioniGiacenza le toglie', async () => {
      prisma.mUDReport.findUnique.mockResolvedValue({
        reportData: {
          integrazioni: {
            ...INTEGRAZIONI_VUOTE,
            destinazioniGiacenza: {
              'AZIENDA|170405': { cerCode: '170405', unitaLocaleId: null, destinazione: 'D' },
            },
          },
        },
      })
      const r = await service.salva('t1', 2025, 'u1', dati({}))
      expect(r.destinazioniGiacenza).toEqual({})
      expect(scritto().destinazioniGiacenza).toEqual({})
    })

    it('etichette delle unità locali: id → denominazione, per tenant', async () => {
      prisma.rentriUnitaLocale.findMany.mockResolvedValue([
        { id: UL1, denominazione: 'Sede di Milano' },
      ])
      await expect(service.etichetteUnitaLocali('t1')).resolves.toEqual({ [UL1]: 'Sede di Milano' })
      expect(prisma.rentriUnitaLocale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1' } })
      )
    })
  })
})
