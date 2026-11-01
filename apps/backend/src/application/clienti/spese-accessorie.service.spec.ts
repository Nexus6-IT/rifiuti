import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { SpeseAccessorieService } from './spese-accessorie.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const S = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: S,
  tenantId: T,
  tipo: 'INCASSO',
  codice: 'INC',
  descrizione: 'Spese di incasso',
  importo: new Prisma.Decimal('2.5'),
  attiva: true,
  versione: 1,
  ...extra,
})

const dati = {
  tipo: 'INCASSO' as const,
  codice: 'INC',
  descrizione: 'Spese di incasso',
  importo: '2.50',
}

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

describe('SpeseAccessorieService (Prisma finto)', () => {
  let tx: any
  let service: SpeseAccessorieService

  beforeEach(() => {
    tx = {
      spesaAccessoria: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) =>
          riga({ ...data, importo: new Prisma.Decimal(data.importo) })
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      cliente: { groupBy: jest.fn().mockResolvedValue([]) },
      contrattoCliente: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    }
    const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new SpeseAccessorieService(prisma)
  })

  describe('list / getById', () => {
    it('uso reale (R23): un groupBy per colonna referente e una sola chiamata per list; eliminabile segue il conteggio', async () => {
      const base = await tx.spesaAccessoria.findFirst()
      const id = base.id
      tx.spesaAccessoria.findMany.mockResolvedValue([base, { ...base, id: 'altro-id' }])
      tx.contrattoCliente.groupBy.mockImplementation(async (a: any) =>
        a.by[0] === 'speseIncassoId' ? [{ [a.by[0]]: id, _count: { _all: 2 } }] : []
      )
      const v = await service.list(T, { incluseDisattivate: false })
      expect(tx.cliente.groupBy).toHaveBeenCalledTimes(2)
      expect(tx.contrattoCliente.groupBy).toHaveBeenCalledTimes(2)
      expect(tx.contrattoCliente.groupBy.mock.calls.map((c: any) => c[0].by[0])).toEqual([
        'speseIncassoId',
        'bolloId',
      ])
      expect(tx.contrattoCliente.groupBy.mock.calls[0][0].where.tenantId).toBe(T)
      expect(v.map((x: any) => x.eliminabile)).toEqual([false, true])
    })

    it('filtra su tipo e attiva solo se richiesto', async () => {
      await service.list(T, { incluseDisattivate: false })
      expect(tx.spesaAccessoria.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        attiva: true,
      })
      await service.list(T, { tipo: 'BOLLO', incluseDisattivate: true })
      expect(tx.spesaAccessoria.findMany.mock.calls[1][0].where).toEqual({
        tenantId: T,
        tipo: 'BOLLO',
      })
    })

    it('la vista ha l’importo come stringa a due decimali, versione ed eliminabile', async () => {
      const [v] = await service.list(T, { incluseDisattivate: false })
      expect(v).toMatchObject({
        id: S,
        tipo: 'INCASSO',
        importo: '2.50',
        attiva: true,
        versione: 1,
        eliminabile: true,
      })
      expect(typeof v.importo).toBe('string')
    })

    it('getById: non trovata = 404 con codice', async () => {
      tx.spesaAccessoria.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, S))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('SPESA_ACCESSORIA_NON_TROVATA')
    })
  })

  describe('crea', () => {
    it('dati non validi: 400 SPESA_ACCESSORIA_NON_VALIDA', async () => {
      const e = await errore(service.crea(T, U, { ...dati, importo: '-1', codice: '' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('SPESA_ACCESSORIA_NON_VALIDA')
      expect(tx.spesaAccessoria.create).not.toHaveBeenCalled()
    })

    it('importo "4,5" salvato 4.50; audit senza descrizione né importo', async () => {
      const v = await service.crea(T, U, { ...dati, importo: '4,5' })
      expect(tx.spesaAccessoria.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        tipo: 'INCASSO',
        importo: '4.50',
      })
      expect(v.importo).toBe('4.50')
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('SPESA_ACCESSORIA_CREATA')
      expect(JSON.stringify(audit.metadata)).not.toContain('Spese di incasso')
    })

    it('P2002 (anche senza target: vincolo unico): 409 SPESA_ACCESSORIA_CODICE_DUPLICATO', async () => {
      tx.spesaAccessoria.create.mockRejectedValue(errP('P2002', { target: null }))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('SPESA_ACCESSORIA_CODICE_DUPLICATO')
    })
  })

  describe('modifica', () => {
    it('non trovata: 404; versione diversa: 409', async () => {
      tx.spesaAccessoria.findFirst.mockResolvedValueOnce(null)
      expect(await errore(service.modifica(T, U, S, { importo: '1', versione: 1 }))).toBeInstanceOf(
        NotFoundException
      )
      const e = await errore(service.modifica(T, U, S, { importo: '1', versione: 4 }))
      expect(e.getResponse().error).toBe('SPESA_ACCESSORIA_MODIFICATA_NEL_FRATTEMPO')
      expect(tx.spesaAccessoria.updateMany).not.toHaveBeenCalled()
    })

    it('importo uguale in altra forma ("2,5" = 2.50): nessuna scrittura', async () => {
      await service.modifica(T, U, S, { importo: '2,5', versione: 1 })
      expect(tx.spesaAccessoria.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('scrive condizionato alla versione; audit con i nomi dei campi', async () => {
      tx.spesaAccessoria.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ importo: new Prisma.Decimal('4.5'), versione: 2 }))
      const v = await service.modifica(T, U, S, { importo: '4,5', versione: 1 })
      expect(tx.spesaAccessoria.updateMany).toHaveBeenCalledWith({
        where: { id: S, tenantId: T, versione: 1 },
        data: { importo: '4.50', versione: { increment: 1 } },
      })
      expect(v.importo).toBe('4.50')
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata.campi).toEqual(['importo'])
    })

    it('spesa non usata: il tipo si cambia, con la riga letta FOR UPDATE prima del conteggio (R24)', async () => {
      tx.spesaAccessoria.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ tipo: 'BOLLO', versione: 2 }))
      await service.modifica(T, U, S, { tipo: 'BOLLO', versione: 1 })
      expect(tx.spesaAccessoria.updateMany.mock.calls[0][0].data.tipo).toBe('BOLLO')
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      expect(String(tx.$queryRaw.mock.calls[0][0].join(' '))).toContain('FOR UPDATE')
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.contrattoCliente.groupBy.mock.invocationCallOrder[0]
      )
    })

    it("spesa usata da un cliente o da un contratto: cambiare il tipo e' 409 SPESA_ACCESSORIA_IN_USO", async () => {
      tx.cliente.groupBy.mockImplementation(async (a: any) =>
        a.by[0] === 'bolloId' ? [{ bolloId: S, _count: { _all: 1 } }] : []
      )
      const e = await errore(service.modifica(T, U, S, { tipo: 'BOLLO', versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'SPESA_ACCESSORIA_IN_USO',
        message: 'La spesa è usata da clienti o contratti: non se ne cambia il tipo.',
      })
      expect(tx.spesaAccessoria.updateMany).not.toHaveBeenCalled()
    })

    it('spesa usata: le altre modifiche (descrizione, importo) restano ammesse, senza il lock', async () => {
      await service.modifica(T, U, S, { descrizione: 'Nuova', versione: 1 })
      expect(tx.spesaAccessoria.updateMany).toHaveBeenCalled()
      expect(tx.$queryRaw).not.toHaveBeenCalled()
    })

    it('valida il risultato della fusione', async () => {
      const e = await errore(service.modifica(T, U, S, { importo: 'abc', versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
    })

    it('count 0: 409; P2002: 409 codice duplicato', async () => {
      tx.spesaAccessoria.updateMany.mockResolvedValueOnce({ count: 0 })
      const e = await errore(service.modifica(T, U, S, { descrizione: 'N', versione: 1 }))
      expect(e.getResponse().error).toBe('SPESA_ACCESSORIA_MODIFICATA_NEL_FRATTEMPO')
      tx.spesaAccessoria.updateMany.mockRejectedValueOnce(errP('P2002', { target: null }))
      const d = await errore(service.modifica(T, U, S, { codice: 'ALTRO', versione: 1 }))
      expect(d.getResponse().error).toBe('SPESA_ACCESSORIA_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionato alla versione, con audit', async () => {
      await service.elimina(T, U, S, 1)
      expect(tx.spesaAccessoria.deleteMany).toHaveBeenCalledWith({
        where: { id: S, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('SPESA_ACCESSORIA_ELIMINATA')
    })

    it('versione vecchia: 409; non trovata: 404; P2003: SPESA_ACCESSORIA_IN_USO', async () => {
      expect((await errore(service.elimina(T, U, S, 9))).getResponse().error).toBe(
        'SPESA_ACCESSORIA_MODIFICATA_NEL_FRATTEMPO'
      )
      tx.spesaAccessoria.deleteMany.mockRejectedValue(errP('P2003'))
      expect((await errore(service.elimina(T, U, S, 1))).getResponse().error).toBe(
        'SPESA_ACCESSORIA_IN_USO'
      )
      tx.spesaAccessoria.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, S, 1))).toBeInstanceOf(NotFoundException)
    })
  })
})
