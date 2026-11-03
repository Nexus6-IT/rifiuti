import { Prisma } from '@prisma/client'
import { ElenchiAddebitiService } from './elenchi-addebiti.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const E = 'dddddddd-0000-4000-8000-000000000004'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: E,
  tenantId: T,
  contrattoId: C,
  codice: '001',
  descrizione: 'Listino',
  nota1: null,
  nota2: null,
  validoDal: null,
  validoAl: null,
  predefinito: false,
  codiceCig: null,
  codiceCup: null,
  idDocumentoPa: null,
  dataDocumentoPa: null,
  versione: 1,
  ...extra,
})

const errP = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta })

async function errore(p: Promise<unknown>): Promise<any> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('attesa un’eccezione')
}

describe('ElenchiAddebitiService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: ElenchiAddebitiService
  let stato: string

  beforeEach(() => {
    stato = 'ATTIVO'
    tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('contratti_cliente')
          ? [{ id: C, numero: 'CC-1', stato }]
          : [{ id: E }]
      ),
      $executeRaw: jest.fn().mockResolvedValue(1),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      contrattoCliente: {
        findFirst: jest.fn().mockResolvedValue({
          id: C,
          numero: 'CC-1',
          stato: 'ATTIVO',
          clienteId: 'cli',
          cliente: { ditta: { ragioneSociale: 'Rossi Ambiente Srl' } },
          contrattoPrincipale: null,
          dataInizio: new Date('2026-01-01T00:00:00Z'),
          dataFine: null,
        }),
      },
      elencoAddebiti: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(async ({ data }: any) => riga({ ...data, id: E })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      legameMovimento: { groupBy: jest.fn().mockResolvedValue([]) },
      rigaAddebito: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      allegatoElencoAddebiti: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new ElenchiAddebitiService(prisma)
  })

  describe('crea', () => {
    it('dati non validi: 400 senza toccare il database', async () => {
      const e = await errore(service.crea(T, U, C, { descrizione: '' }))
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse().message).toContain('Inserisci una descrizione per questo elenco.')
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('id contratto non UUID: 404', async () => {
      const e = await errore(service.crea(T, U, 'nope', { descrizione: 'X' }))
      expect(e.getStatus()).toBe(404)
    })

    it('contratto annullato: 409 LISTINO_NON_MODIFICABILE, niente scritto', async () => {
      stato = 'ANNULLATO'
      const e = await errore(service.crea(T, U, C, { descrizione: 'X' }))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
      expect(tx.elencoAddebiti.create).not.toHaveBeenCalled()
    })

    it('contratto assente o eliminato: 404', async () => {
      tx.$queryRaw.mockResolvedValue([])
      const e = await errore(service.crea(T, U, C, { descrizione: 'X' }))
      expect(e.getStatus()).toBe(404)
    })

    it('senza codice: lock consultivo e primo libero; codice salvato normalizzato', async () => {
      tx.elencoAddebiti.findMany.mockResolvedValue([{ codice: '001' }])
      await service.crea(T, U, C, { descrizione: ' Nuovo ' })
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.elencoAddebiti.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        contrattoId: C,
        codice: '002',
        descrizione: 'Nuovo',
        predefinito: false,
      })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'ELENCO_ADDEBITI_CREATO',
        userId: U,
      })
    })

    it('codice esplicito senza predefinito: nessun lock consultivo; "1" diventa 001, "ab" AB', async () => {
      await service.crea(T, U, C, { codice: '1', descrizione: 'X' })
      await service.crea(T, U, C, { codice: 'ab', descrizione: 'X' })
      expect(tx.$executeRaw).not.toHaveBeenCalled()
      const codici = tx.elencoAddebiti.create.mock.calls.map((c: any) => c[0].data.codice)
      expect(codici).toEqual(['001', 'AB'])
    })

    it('predefinito: lock consultivo, altri predefiniti bloccati in ordine di id, flag tolto e audit', async () => {
      const ALTRO = '99999999-0000-4000-8000-0000000000aa'
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        if (sql.includes('contratti_cliente')) return [{ id: C, numero: 'CC-1', stato }]
        if (sql.includes('predefinito AND id <>')) return [{ id: ALTRO }]
        return [{ id: E }]
      })
      tx.elencoAddebiti.findMany.mockResolvedValue([{ id: ALTRO, codice: '001' }])
      await service.crea(T, U, C, { codice: '2', descrizione: 'X', predefinito: true })
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      const sql = tx.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?')) as string[]
      expect(sql.some(q => /ORDER BY id FOR UPDATE/.test(q) && q.includes('id <>'))).toBe(true)
      expect(tx.elencoAddebiti.updateMany).toHaveBeenCalledWith({
        where: { tenantId: T, contrattoId: C, id: { in: [ALTRO] } },
        data: { predefinito: false, versione: { increment: 1 } },
      })
      const audit = tx.activityLog.create.mock.calls.map((c: any[]) => c[0].data)
      expect(audit.map((a: any) => a.action)).toEqual(
        expect.arrayContaining(['ELENCO_ADDEBITI_MODIFICATO', 'ELENCO_ADDEBITI_CREATO'])
      )
      expect(
        audit.find((a: any) => a.action === 'ELENCO_ADDEBITI_MODIFICATO').metadata
      ).toMatchObject({
        elencoId: ALTRO,
        campi: ['predefinito'],
        perdutoPer: E,
      })
    })

    it('predefinito senza altri predefiniti: nessun UPDATE sugli altri', async () => {
      tx.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) =>
        strings.join('?').includes('contratti_cliente')
          ? [{ id: C, numero: 'CC-1', stato }]
          : strings.join('?').includes('predefinito AND id <>')
            ? []
            : [{ id: E }]
      )
      await service.crea(T, U, C, { codice: '2', descrizione: 'X', predefinito: true })
      expect(tx.elencoAddebiti.updateMany).not.toHaveBeenCalled()
    })

    it('le transazioni di scrittura partono con lock_timeout e un tetto sopra', async () => {
      await service.crea(T, U, C, { codice: '2', descrizione: 'X' })
      await service.modifica(T, U, E, { descrizione: 'Y', versione: 1 })
      await service.elimina(T, U, E, 1)
      expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(3)
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(`SET LOCAL lock_timeout = '10s'`)
      for (const [, opzioni] of prisma.$transaction.mock.calls) {
        expect(opzioni.timeout).toBeGreaterThan(10_000)
      }
    })

    it('codici esauriti: 400', async () => {
      tx.elencoAddebiti.findMany.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ codice: String(i + 1).padStart(3, '0') }))
      )
      const e = await errore(service.crea(T, U, C, { descrizione: 'X' }))
      expect(e.getStatus()).toBe(400)
      expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_CODICI_ESAURITI' })
    })

    it('P2002 senza codice: riprova in una transazione nuova, poi riesce', async () => {
      tx.elencoAddebiti.create
        .mockRejectedValueOnce(errP('P2002'))
        .mockImplementation(async ({ data }: any) => riga(data))
      const v = await service.crea(T, U, C, { descrizione: 'X' })
      expect(v.codice).toBe('001')
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
    })

    it('P2002 con codice esplicito: nessun nuovo tentativo, 409 codice duplicato', async () => {
      tx.elencoAddebiti.create.mockRejectedValue(
        errP('P2002', { target: 'elenchi_addebiti_contratto_id_codice_key' })
      )
      const e = await errore(service.crea(T, U, C, { codice: '005', descrizione: 'X' }))
      expect(e.getStatus()).toBe(409)
      expect(e.getResponse()).toMatchObject({ error: 'ELENCO_ADDEBITI_CODICE_DUPLICATO' })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    })

    it('P2028 o deadlock: 409 OPERAZIONE_CONCORRENTE', async () => {
      tx.elencoAddebiti.create.mockRejectedValue(errP('P2028'))
      const e = await errore(service.crea(T, U, C, { codice: '005', descrizione: 'X' }))
      expect(e.getResponse()).toMatchObject({ error: 'OPERAZIONE_CONCORRENTE' })
      tx.elencoAddebiti.create.mockRejectedValue(errP('P2010', { code: '40P01' }))
      const d = await errore(service.crea(T, U, C, { codice: '006', descrizione: 'X' }))
      expect(d.getResponse()).toMatchObject({ error: 'OPERAZIONE_CONCORRENTE' })
    })
  })

  describe('modifica', () => {
    it('versione diversa: 409 modificato nel frattempo', async () => {
      const e = await errore(service.modifica(T, U, E, { descrizione: 'Y', versione: 9 }))
      expect(e.getStatus()).toBe(409)
      expect(tx.elencoAddebiti.updateMany).not.toHaveBeenCalled()
    })

    it('contratto annullato: 409 prima della versione', async () => {
      stato = 'ANNULLATO'
      const e = await errore(service.modifica(T, U, E, { descrizione: 'Y', versione: 9 }))
      expect(e.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
    })

    it('elenco assente: 404', async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, E, { descrizione: 'Y', versione: 1 }))
      expect(e.getStatus()).toBe(404)
    })

    it('nessuna differenza: nessuna scrittura e nessun audit', async () => {
      await service.modifica(T, U, E, { descrizione: 'Listino', versione: 1 })
      expect(tx.elencoAddebiti.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('scrive solo i campi cambiati, versione +1 con controllo condizionato; date come Date', async () => {
      tx.elencoAddebiti.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga())
        .mockResolvedValue(riga({ versione: 2 }))
      await service.modifica(T, U, E, {
        descrizione: 'Y',
        validoDal: '2026-01-01',
        validoAl: '2026-12-31',
        versione: 1,
      })
      const arg = tx.elencoAddebiti.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({ id: E, tenantId: T, versione: 1 })
      expect(arg.data).toEqual({
        descrizione: 'Y',
        validoDal: new Date('2026-01-01T00:00:00.000Z'),
        validoAl: new Date('2026-12-31T00:00:00.000Z'),
        versione: { increment: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata.campi).toEqual([
        'descrizione',
        'validoDal',
        'validoAl',
      ])
    })

    it('scrittura condizionata a zero righe: 409', async () => {
      tx.elencoAddebiti.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, E, { descrizione: 'Y', versione: 1 }))
      expect(e.getStatus()).toBe(409)
    })

    it('il codice non si svuota', async () => {
      const e = await errore(service.modifica(T, U, E, { codice: ' ', versione: 1 }))
      expect(e.getStatus()).toBe(400)
    })

    it('predefinito true: lock consultivo; da false a true toglie il flag agli altri', async () => {
      await service.modifica(T, U, E, { predefinito: true, versione: 1 })
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.elencoAddebiti.updateMany).toHaveBeenCalledTimes(2)
    })

    it('predefinito true su elenco gia predefinito: lock ma nessuna scrittura', async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValue(riga({ predefinito: true }))
      await service.modifica(T, U, E, { predefinito: true, versione: 1 })
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.elencoAddebiti.updateMany).not.toHaveBeenCalled()
    })

    it('id non UUID: 404', async () => {
      const e = await errore(service.modifica(T, U, 'x', { versione: 1 }))
      expect(e.getStatus()).toBe(404)
    })
  })

  describe('elimina', () => {
    it('cancella con la versione e lascia audit con il numero delle righe', async () => {
      tx.rigaAddebito.count.mockResolvedValue(4)
      await service.elimina(T, U, E, 1)
      expect(tx.elencoAddebiti.deleteMany).toHaveBeenCalledWith({
        where: { id: E, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata).toMatchObject({
        codice: '001',
        righe: 4,
      })
    })

    it('versione diversa o contratto annullato: 409 senza cancellare', async () => {
      const v = await errore(service.elimina(T, U, E, 5))
      expect(v.getStatus()).toBe(409)
      stato = 'ANNULLATO'
      const a = await errore(service.elimina(T, U, E, 1))
      expect(a.getResponse()).toMatchObject({ error: 'LISTINO_NON_MODIFICABILE' })
      expect(tx.elencoAddebiti.deleteMany).not.toHaveBeenCalled()
    })

    it('id non UUID: 404', async () => {
      const e = await errore(service.elimina(T, U, 'x', 1))
      expect(e.getStatus()).toBe(404)
    })
  })

  describe('letture', () => {
    it('list: contesto, viste con righe e allegati, filtro validiAl', async () => {
      tx.elencoAddebiti.findMany.mockResolvedValue([
        riga(),
        riga({
          id: 'ee',
          codice: '002',
          validoDal: new Date('2025-01-01'),
          validoAl: new Date('2025-12-31'),
        }),
      ])
      tx.rigaAddebito.groupBy.mockResolvedValue([{ elencoId: E, _count: { _all: 3 } }])
      tx.allegatoElencoAddebiti.findMany.mockResolvedValue([
        { id: 'al', elencoId: E, posizione: 1, nomeFile: 'a.pdf', dimensioneByte: 4 },
      ])
      const tutti = await service.list(T, C)
      expect(tutti.contesto.contratto).toMatchObject({
        id: C,
        numero: 'CC-1',
        clienteRagioneSociale: 'Rossi Ambiente Srl',
        dataInizio: '2026-01-01',
        dataFine: null,
      })
      expect(tutti.elenchi[0]).toMatchObject({
        righe: 3,
        modificabile: true,
        eliminabile: true,
        allegati: [{ id: 'al', posizione: 1, nomeFile: 'a.pdf', dimensioneByte: 4 }],
      })
      expect(tutti.elenchi[1].righe).toBe(0)
      const validi = await service.list(T, C, '2026-06-01')
      expect(validi.elenchi.map(e => e.codice)).toEqual(['001'])
    })

    it('list: data non valida 400, contratto assente 404, id non UUID 404', async () => {
      expect((await errore(service.list(T, C, '01/06/2026'))).getStatus()).toBe(400)
      // Forma giusta ma giorno inesistente: 400, non un confronto fra stringhe (T20 M3).
      expect((await errore(service.list(T, C, '2026-02-30'))).getStatus()).toBe(400)
      expect((await errore(service.list(T, C, '2026-13-01'))).getStatus()).toBe(400)
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect((await errore(service.list(T, C))).getStatus()).toBe(404)
      expect((await errore(service.list(T, 'x'))).getStatus()).toBe(404)
    })

    it('list di un contratto annullato: modificabile false', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue({
        id: C,
        numero: 'CC-1',
        stato: 'ANNULLATO',
        clienteId: 'cli',
        cliente: { ditta: { ragioneSociale: 'Rossi Ambiente Srl' } },
        contrattoPrincipale: { id: 'p', numero: 'CC-0' },
        dataInizio: new Date('2026-01-01T00:00:00Z'),
        dataFine: new Date('2026-12-31T00:00:00Z'),
      })
      tx.elencoAddebiti.findMany.mockResolvedValue([riga()])
      const r = await service.list(T, C)
      expect(r.elenchi[0]).toMatchObject({ modificabile: false, eliminabile: false })
      expect(r.contesto.contratto).toMatchObject({
        contrattoPrincipale: { id: 'p', numero: 'CC-0' },
        dataFine: '2026-12-31',
      })
    })

    it('getById: 404 se manca; contratto annullato non modificabile', async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValue(null)
      expect((await errore(service.getById(T, E))).getStatus()).toBe(404)
      expect((await errore(service.getById(T, 'x'))).getStatus()).toBe(404)
      tx.elencoAddebiti.findFirst.mockResolvedValue({
        ...riga(),
        contratto: { stato: 'ANNULLATO' },
      })
      expect(await service.getById(T, E)).toMatchObject({ modificabile: false })
    })

    it('prossimoCodice: primo libero; 404 se il contratto non c e', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue({ id: C })
      tx.elencoAddebiti.findMany.mockResolvedValue([{ codice: '001' }, { codice: 'AB' }])
      expect(await service.prossimoCodice(T, C)).toBe('002')
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      expect((await errore(service.prossimoCodice(T, C))).getStatus()).toBe(404)
      expect((await errore(service.prossimoCodice(T, 'x'))).getStatus()).toBe(404)
    })
  })
})
