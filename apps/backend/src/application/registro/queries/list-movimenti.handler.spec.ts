import { ListMovimentiHandler } from './list-movimenti.handler'
import { ListMovimentiQuery } from './list-movimenti.query'
import { righeCausaliSistema } from '../causali/catalogo-causali.fixture'

const riga = (registroId: string) => ({
  id: `m-${registroId}`,
  tenantId: 't1',
  registroId,
  progressiveNumber: 3,
  progressiveYear: 2026,
  type: 'CARICO',
  movementDate: new Date('2026-03-01'),
  registrationDate: new Date('2026-03-01'),
  causale: 'PRODUZIONE_INTERNA',
  causaleAziendaId: null as string | null,
  cerCode: '200301',
  wasteDescription: null,
  quantity: 10,
  unit: 'KG',
  wastePhysicalState: null,
  wasteHazardClasses: null,
  operationCode: null,
  counterpartName: null,
  counterpartAddress: null,
  firId: null,
  recordedByUserId: null,
  entryHash: 'h',
  notes: null,
  createdAt: new Date('2026-03-01'),
  tipoAnnotazione: 'ORDINARIA',
  motivoAnnotazione: null,
  rettificato: null,
  correzioni: [] as unknown[],
  trasmissioneRentri: null as null | Record<string, unknown>,
})

describe('ListMovimentiHandler', () => {
  let prisma: {
    wasteMovement: { count: jest.Mock; findMany: jest.Mock }
    $queryRaw: jest.Mock
    causaleRegistro: { findMany: jest.Mock }
    causaleRegistroAzienda: { findMany: jest.Mock }
  }
  let handler: ListMovimentiHandler
  let logger: { setContext: jest.Mock; warn: jest.Mock }

  beforeEach(() => {
    prisma = {
      wasteMovement: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([riga('reg-A')]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
      causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
    }
    logger = { setContext: jest.fn(), warn: jest.fn() }
    handler = new ListMovimentiHandler(prisma as any, logger as any)
  })

  it('lista movimenti: filtra per registroId e restituisce registroId', async () => {
    const result = await handler.execute(
      new ListMovimentiQuery('t1', { registroId: 'reg-A' }, { page: 1, limit: 20 })
    )

    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      registroId: 'reg-A',
    })
    expect(prisma.wasteMovement.count.mock.calls[0][0].where).toEqual({
      tenantId: 't1',
      registroId: 'reg-A',
    })
    expect(result.value.items[0].registroId).toBe('reg-A')
  })

  describe('trasmissione RENTRI', () => {
    const lista = () => handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))

    it('movimento senza riga: trasmissioneRentri null', async () => {
      const { value } = await lista()
      expect(value.items[0].trasmissioneRentri).toBeNull()
    })

    it('movimento con riga: stato, identificativo e motivo (blocco o ultimo errore), niente altro', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        {
          ...riga('reg-A'),
          trasmissioneRentri: {
            stato: 'RIFIUTATA',
            identificativoRentri: null,
            motivoBlocco: null,
            ultimoErrore: 'Quantita non valida',
            origine: 'MANUALE',
            esclusoIl: null,
            motivoEsclusione: null,
            transazioneId: 'tx',
            accodatoDa: 'u',
          },
        },
        {
          ...riga('reg-B'),
          id: 'm2',
          trasmissioneRentri: {
            stato: 'TRASMESSA',
            identificativoRentri: 'M0000000000000000001',
            motivoBlocco: 'Trasmessa a RENTRI',
            ultimoErrore: null,
            origine: 'AUTOMATICA',
            esclusoIl: null,
            motivoEsclusione: null,
          },
        },
        {
          ...riga('reg-C'),
          id: 'm3',
          trasmissioneRentri: {
            stato: 'DA_TRASMETTERE',
            identificativoRentri: null,
            motivoBlocco: null,
            ultimoErrore: null,
            origine: 'AUTOMATICA',
            esclusoIl: new Date('2026-11-02T10:00:00Z'),
            motivoEsclusione: 'Da correggere',
          },
        },
      ])
      const { value } = await lista()
      expect(value.items[0].trasmissioneRentri).toEqual({
        stato: 'RIFIUTATA',
        identificativo: null,
        motivo: 'Quantita non valida',
        origine: 'MANUALE',
        escluso: false,
      })
      expect(value.items[1].trasmissioneRentri).toEqual({
        stato: 'TRASMESSA',
        identificativo: 'M0000000000000000001',
        motivo: 'Trasmessa a RENTRI',
        origine: 'AUTOMATICA',
        escluso: false,
      })
      expect(value.items[2].trasmissioneRentri).toEqual({
        stato: 'DA_TRASMETTERE',
        identificativo: null,
        motivo: 'Da correggere',
        origine: 'AUTOMATICA',
        escluso: true,
      })
      const include = prisma.wasteMovement.findMany.mock.calls[0][0].include
      expect(include.trasmissioneRentri).toEqual({
        select: {
          stato: true,
          identificativoRentri: true,
          motivoBlocco: true,
          ultimoErrore: true,
          origine: true,
          esclusoIl: true,
          motivoEsclusione: true,
        },
      })
    })
  })

  it('lista movimenti: senza registroId non filtra per registro', async () => {
    await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))

    expect(prisma.wasteMovement.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1' })
  })

  describe('descrizione della causale', () => {
    const versione = (
      id: string,
      dal: string,
      al: string | null,
      descrizione: string,
      rentri: string | null
    ) => ({
      id,
      natura: 'PROPRIA',
      codice: 'AZ_RESO',
      verso: 'CARICO',
      descrizione,
      ruoloMud: 'PRODOTTO',
      codiceRentri: rentri,
      operazione: null,
      ordine: 100,
      validaDal: new Date(`${dal}T00:00:00.000Z`),
      validaAl: al ? new Date(`${al}T00:00:00.000Z`) : null,
    })
    const lista = () => handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))

    it('causale di sistema: descrizione e codice RENTRI del catalogo', async () => {
      const { value } = await lista()
      expect(value.items[0]).toMatchObject({
        causaleDescrizione: 'Produzione interna',
        causaleCodiceRentri: 'DT',
      })
    })

    it('versioni diverse della stessa causale propria: il versioneId vince sulla data, senza versioneId vale la data', async () => {
      prisma.causaleRegistroAzienda.findMany.mockResolvedValue([
        versione('v1', '2026-01-01', '2026-06-30', 'Reso (vecchio)', null),
        versione('v2', '2026-07-01', null, 'Reso cliente', 'RE'),
      ])
      const vecchio = {
        ...riga('reg-A'),
        id: 'a',
        causale: 'AZ_RESO',
        causaleAziendaId: 'v1',
        movementDate: new Date('2026-03-01T10:00:00Z'),
      }
      const nuovo = {
        ...riga('reg-A'),
        id: 'b',
        causale: 'AZ_RESO',
        causaleAziendaId: 'v2',
        movementDate: new Date('2026-08-01T10:00:00Z'),
      }
      // Il versioneId vince sulla data: v1 e chiusa al 30/06 ma il movimento e di agosto.
      const retrodatato = { ...vecchio, id: 'c', movementDate: new Date('2026-08-01T10:00:00Z') }
      // Senza versioneId si risolve per data: dentro v2.
      const perData = { ...nuovo, id: 'd', causaleAziendaId: null }
      prisma.wasteMovement.findMany.mockResolvedValue([nuovo, vecchio, retrodatato, perData])
      const { value } = await lista()
      expect(value.items.map(i => [i.causaleDescrizione, i.causaleCodiceRentri])).toEqual([
        ['Reso cliente', 'RE'],
        ['Reso (vecchio)', null],
        ['Reso (vecchio)', null],
        ['Reso cliente', 'RE'],
      ])
    })

    it('codice sconosciuto: la descrizione e il codice, senza codice RENTRI', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), causale: 'VECCHIA_CAUSALE' },
      ])
      const { value } = await lista()
      expect(value.items[0]).toMatchObject({
        causaleDescrizione: 'VECCHIA_CAUSALE',
        causaleCodiceRentri: null,
      })
    })

    it('il catalogo si legge UNA volta per pagina, qualunque sia il numero di righe', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, i) => ({ ...riga('reg-A'), id: `m${i}` }))
      )
      await lista()
      expect(prisma.causaleRegistro.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.causaleRegistroAzienda.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.causaleRegistroAzienda.findMany.mock.calls[0][0].where).toEqual({
        tenantId: 't1',
      })
    })
  })

  describe('stato delle righe', () => {
    const rif = (n: number, tipo: string) => ({
      progressiveNumber: n,
      progressiveYear: 2026,
      tipoAnnotazione: tipo,
    })

    it('una riga ordinaria senza correzioni e vigente e non lancia la query ricorsiva', async () => {
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0]).toMatchObject({
        stato: 'VIGENTE',
        tipoAnnotazione: 'ORDINARIA',
      })
      expect(result.value.items[0].rettificaDi).toBeUndefined()
      expect(result.value.items[0].correttoDa).toBeUndefined()
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('include predecessore e correzioni nella pagina, senza filtrare per vigenza', async () => {
      await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      const arg = prisma.wasteMovement.findMany.mock.calls[0][0]
      expect(arg.include.rettificato.select).toEqual({
        progressiveNumber: true,
        progressiveYear: true,
        tipoAnnotazione: true,
      })
      expect(arg.include.correzioni.select).toEqual(arg.include.rettificato.select)
      expect(arg.where).toEqual({ tenantId: 't1' })
    })

    it('rettificato, annullato, rettifica e annullamento, con UNA query per la testa', async () => {
      const ordinaria = { ...riga('reg-A'), id: 'o', correzioni: [rif(2, 'RETTIFICA')] }
      const rettifica = {
        ...riga('reg-A'),
        id: 'r',
        tipoAnnotazione: 'RETTIFICA',
        motivoAnnotazione: 'errore di battitura',
        rettificato: rif(1, 'ORDINARIA'),
        correzioni: [rif(3, 'ANNULLAMENTO')],
      }
      const annullamento = {
        ...riga('reg-A'),
        id: 'a',
        tipoAnnotazione: 'ANNULLAMENTO',
        motivoAnnotazione: 'registrato per errore',
        rettificato: rif(2, 'RETTIFICA'),
      }
      prisma.wasteMovement.findMany.mockResolvedValue([annullamento, rettifica, ordinaria])
      prisma.$queryRaw.mockResolvedValue([
        { partenza: 'o', tipo_testa: 'ANNULLAMENTO' },
        { partenza: 'r', tipo_testa: 'ANNULLAMENTO' },
      ])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      const [a, r, o] = result.value.items
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1)
      expect([a.stato, r.stato, o.stato]).toEqual(['ANNULLATO', 'ANNULLATO', 'ANNULLATO'])
      expect(a.rettificaDi).toEqual(rif(2, 'RETTIFICA'))
      expect(r.rettificaDi).toEqual(rif(1, 'ORDINARIA'))
      expect(r.correttoDa).toEqual(rif(3, 'ANNULLAMENTO'))
      expect(r.motivoAnnotazione).toBe('errore di battitura')
      expect(o.correttoDa).toEqual(rif(2, 'RETTIFICA'))
    })

    it('la query ricorsiva non restituisce la testa: stato dal tipo della riga (RETTIFICATO) e warning senza id di azienda', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), correzioni: [rif(2, 'RETTIFICA')] },
      ])
      prisma.$queryRaw.mockResolvedValue([])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0].stato).toBe('RETTIFICATO')
      expect(logger.warn).toHaveBeenCalledTimes(1)
      const [messaggio, meta] = logger.warn.mock.calls[0]
      expect(messaggio).toContain('non ha restituito la testa')
      expect(meta).toEqual({ righe: 1 })
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('t1')
    })

    it('nessun warning quando ogni riga con correzioni ha la sua testa', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), id: 'o', correzioni: [rif(2, 'RETTIFICA')] },
      ])
      prisma.$queryRaw.mockResolvedValue([{ partenza: 'o', tipo_testa: 'RETTIFICA', livello: 1 }])
      await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('guardia di profondita scattata: warning, testa non affidabile', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), id: 'o', correzioni: [rif(2, 'RETTIFICA')] },
      ])
      prisma.$queryRaw.mockResolvedValue([
        { partenza: 'o', tipo_testa: 'RETTIFICA', livello: 1000 },
      ])
      await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(logger.warn).toHaveBeenCalledTimes(1)
      expect(logger.warn.mock.calls[0][0]).toContain('profondita massima')
      expect(logger.warn.mock.calls[0][1]).toEqual({ catene: 1, livelloMassimo: 1000 })
    })

    it('una riga corretta da una rettifica vigente e RETTIFICATA', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        { ...riga('reg-A'), correzioni: [rif(2, 'RETTIFICA')] },
      ])
      prisma.$queryRaw.mockResolvedValue([{ partenza: 'm-reg-A', tipo_testa: 'RETTIFICA' }])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0].stato).toBe('RETTIFICATO')
    })

    it('la riga di annullamento senza correzioni e ANNULLATA senza query', async () => {
      prisma.wasteMovement.findMany.mockResolvedValue([
        {
          ...riga('reg-A'),
          tipoAnnotazione: 'ANNULLAMENTO',
          motivoAnnotazione: 'm',
          rettificato: rif(1, 'ORDINARIA'),
        },
      ])
      const result = await handler.execute(new ListMovimentiQuery('t1', {}, { page: 1, limit: 20 }))
      expect(result.value.items[0].stato).toBe('ANNULLATO')
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })
  })
})
