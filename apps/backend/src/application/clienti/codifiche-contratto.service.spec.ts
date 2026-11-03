import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CodificheContrattoService } from './codifiche-contratto.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const K = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: K,
  tenantId: T,
  genere: 'CATEGORIA',
  codice: '001',
  descrizione: 'Rifiuti urbani',
  attiva: true,
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

describe('CodificheContrattoService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: CodificheContrattoService

  beforeEach(() => {
    tx = {
      codificaContratto: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      // Lettura dei codici del genere (nessun codice usato) dopo il lock consultivo (R25).
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      cliente: { groupBy: jest.fn().mockResolvedValue([]) },
      contrattoCliente: { groupBy: jest.fn().mockResolvedValue([]) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new CodificheContrattoService(prisma)
  })

  describe('list / getById', () => {
    it('uso reale (R23): un groupBy per colonna referente e una sola chiamata per list; eliminabile segue il conteggio', async () => {
      const base = await tx.codificaContratto.findFirst()
      const id = base.id
      tx.codificaContratto.findMany.mockResolvedValue([base, { ...base, id: 'altro-id' }])
      tx.contrattoCliente.groupBy.mockImplementation(async (a: any) =>
        a.by[0] === 'categoriaId' ? [{ [a.by[0]]: id, _count: { _all: 2 } }] : []
      )
      const v = await service.list(T, { genere: 'CATEGORIA', incluseDisattivate: false })
      expect(tx.cliente.groupBy).toHaveBeenCalledTimes(0)
      expect(tx.contrattoCliente.groupBy).toHaveBeenCalledTimes(3)
      expect(tx.contrattoCliente.groupBy.mock.calls.map((c: any) => c[0].by[0])).toEqual([
        'categoriaId',
        'tipoId',
        'motivoAnnulloId',
      ])
      expect(tx.contrattoCliente.groupBy.mock.calls[0][0].where.tenantId).toBe(T)
      expect(v.map((x: any) => x.eliminabile)).toEqual([false, true])
    })

    it('filtra per genere e di default non include le disattivate', async () => {
      await service.list(T, { genere: 'TIPO', incluseDisattivate: false })
      expect(tx.codificaContratto.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        genere: 'TIPO',
        attiva: true,
      })
    })

    it('con incluseDisattivate non filtra su attiva', async () => {
      await service.list(T, { genere: 'MOTIVO_ANNULLO', incluseDisattivate: true })
      expect(tx.codificaContratto.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        genere: 'MOTIVO_ANNULLO',
      })
    })

    it('la vista porta genere, versione ed eliminabile', async () => {
      const [v] = await service.list(T, { genere: 'CATEGORIA', incluseDisattivate: false })
      expect(v).toMatchObject({
        id: K,
        genere: 'CATEGORIA',
        codice: '001',
        attiva: true,
        versione: 1,
        eliminabile: true,
      })
    })

    it('genere non ammesso: 400', async () => {
      const e = await errore(service.list(T, { genere: 'ALTRO' as any, incluseDisattivate: false }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_NON_VALIDA')
    })

    it('getById: non trovata = 404 con codice', async () => {
      tx.codificaContratto.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, K))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_NON_TROVATA')
    })
  })

  describe('prossimoCodice', () => {
    it('genere vuoto: 001', async () => {
      expect(await service.prossimoCodice(T, 'CATEGORIA')).toBe('001')
    })

    it('salta i codici usati (anche con buchi)', async () => {
      tx.$queryRaw.mockResolvedValue([{ codice: '001' }, { codice: '003' }, { codice: 'AB' }])
      expect(await service.prossimoCodice(T, 'TIPO')).toBe('002')
    })

    it('codici esauriti: 400 di D26', async () => {
      tx.$queryRaw.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ codice: String(i + 1).padStart(3, '0') }))
      )
      const e = await errore(service.prossimoCodice(T, 'TIPO'))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toBe(
        'Non si possono creare più di 999 codici per questo elenco.'
      )
    })

    it('genere non ammesso: 400', async () => {
      expect(await errore(service.prossimoCodice(T, 'X' as any))).toBeInstanceOf(
        BadRequestException
      )
    })
  })

  describe('crea', () => {
    it('senza codice: prende il lock consultivo, legge i codici del genere e assegna 001', async () => {
      const v = await service.crea(T, U, { genere: 'CATEGORIA', descrizione: 'Urbani' })
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
      // R25: stesso lock consultivo delle codifiche di addebito (il FOR UPDATE non copriva il genere vuoto)
      expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock')
      expect(tx.$queryRaw.mock.calls[0][0].join('?')).not.toContain('FOR UPDATE')
      expect(tx.codificaContratto.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        genere: 'CATEGORIA',
        codice: '001',
      })
      expect(v.codice).toBe('001')
    })

    it('il secondo senza codice ottiene 002', async () => {
      await service.crea(T, U, { genere: 'CATEGORIA', descrizione: 'Uno' })
      tx.$queryRaw.mockResolvedValue([{ codice: '001' }])
      await service.crea(T, U, { genere: 'CATEGORIA', descrizione: 'Due' })
      expect(tx.codificaContratto.create.mock.calls[1][0].data.codice).toBe('002')
    })

    it('con codice esplicito: non legge i codici', async () => {
      await service.crea(T, U, { genere: 'TIPO', codice: 'AB', descrizione: 'Tipo' })
      expect(tx.$queryRaw).not.toHaveBeenCalled()
      expect(tx.codificaContratto.create.mock.calls[0][0].data.codice).toBe('AB')
    })

    it('codici esauriti: 400, nessuna scrittura', async () => {
      tx.$queryRaw.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ codice: String(i + 1).padStart(3, '0') }))
      )
      const e = await errore(service.crea(T, U, { genere: 'TIPO', descrizione: 'x' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().message).toBe(
        'Non si possono creare più di 999 codici per questo elenco.'
      )
      expect(tx.codificaContratto.create).not.toHaveBeenCalled()
    })

    it('dati non validi: 400 con l’array dei messaggi', async () => {
      const e = await errore(
        service.crea(T, U, { genere: 'TIPO', codice: 'ABCD', descrizione: '' })
      )
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_NON_VALIDA')
      expect(e.getResponse().message.length).toBeGreaterThanOrEqual(2)
    })

    it('P2002 al primo tentativo: riprova in una nuova transazione col codice successivo', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ codice: '001' }])
      tx.codificaContratto.create
        .mockRejectedValueOnce(errP('P2002'))
        .mockImplementationOnce(async ({ data }: any) => riga(data))
      const v = await service.crea(T, U, { genere: 'CATEGORIA', descrizione: 'Urbani' })
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
      expect(tx.codificaContratto.create.mock.calls[1][0].data.codice).toBe('002')
      expect(v.codice).toBe('002')
    })

    it('P2002 anche al secondo tentativo: 409 CODIFICA_CONTRATTO_CODICE_DUPLICATO', async () => {
      tx.codificaContratto.create.mockRejectedValue(errP('P2002'))
      const e = await errore(service.crea(T, U, { genere: 'CATEGORIA', descrizione: 'Urbani' }))
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_CODICE_DUPLICATO')
    })

    it('P2002 con codice esplicito: nessun nuovo tentativo, 409 subito', async () => {
      tx.codificaContratto.create.mockRejectedValue(errP('P2002'))
      const e = await errore(
        service.crea(T, U, { genere: 'CATEGORIA', codice: '001', descrizione: 'Urbani' })
      )
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_CODICE_DUPLICATO')
    })

    it('audit CREATA con genere e codice, senza la descrizione', async () => {
      await service.crea(T, U, { genere: 'MOTIVO_ANNULLO', descrizione: 'Disdetta cliente' })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ userId: U, action: 'CODIFICA_CONTRATTO_CREATA' })
      expect(audit.metadata).toMatchObject({ genere: 'MOTIVO_ANNULLO', codice: '001' })
      expect(JSON.stringify(audit.metadata)).not.toContain('Disdetta')
    })
  })

  describe('modifica', () => {
    it('non trovata: 404', async () => {
      tx.codificaContratto.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 1 }))
      expect(e).toBeInstanceOf(NotFoundException)
    })

    it('versione diversa: 409 senza updateMany', async () => {
      const e = await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_MODIFICATA_NEL_FRATTEMPO')
      expect(tx.codificaContratto.updateMany).not.toHaveBeenCalled()
    })

    it('nessuna differenza: nessuna scrittura e nessun audit', async () => {
      await service.modifica(T, U, K, { descrizione: 'Rifiuti urbani', versione: 1 })
      expect(tx.codificaContratto.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('valida il risultato della fusione: 400', async () => {
      const e = await errore(service.modifica(T, U, K, { codice: 'ABCD', versione: 1 }))
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_NON_VALIDA')
      expect(tx.codificaContratto.updateMany).not.toHaveBeenCalled()
    })

    it('il genere non cambia mai: non compare fra i dati scritti', async () => {
      tx.codificaContratto.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', versione: 2 }))
      await service.modifica(T, U, K, { descrizione: 'Nuova', versione: 1, genere: 'TIPO' } as any)
      const data = tx.codificaContratto.updateMany.mock.calls[0][0].data
      expect(data).toEqual({ descrizione: 'Nuova', versione: { increment: 1 } })
      expect(tx.codificaContratto.updateMany.mock.calls[0][0].where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
      })
    })

    it('audit con i nomi dei campi e il genere, mai il testo', async () => {
      tx.codificaContratto.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', attiva: false, versione: 2 }))
      await service.modifica(T, U, K, { descrizione: 'Nuova', attiva: false, versione: 1 })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CODIFICA_CONTRATTO_MODIFICATA')
      expect(audit.metadata.campi).toEqual(['descrizione', 'attiva'])
      expect(audit.metadata.genere).toBe('CATEGORIA')
      expect(JSON.stringify(audit.metadata)).not.toContain('Nuova')
    })

    it('P2002 sul cambio codice: 409 codice duplicato', async () => {
      tx.codificaContratto.updateMany.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'genere', 'codice'] })
      )
      const e = await errore(service.modifica(T, U, K, { codice: '002', versione: 1 }))
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionata alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, K, 1)
      expect(tx.codificaContratto.deleteMany).toHaveBeenCalledWith({
        where: { id: K, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe(
        'CODIFICA_CONTRATTO_ELIMINATA'
      )
    })

    it('versione diversa: 409 senza deleteMany', async () => {
      expect(await errore(service.elimina(T, U, K, 9))).toBeInstanceOf(ConflictException)
      expect(tx.codificaContratto.deleteMany).not.toHaveBeenCalled()
    })

    it('in uso (P2003): 409 CODIFICA_CONTRATTO_IN_USO', async () => {
      tx.codificaContratto.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse().error).toBe('CODIFICA_CONTRATTO_IN_USO')
    })

    it('non trovata: 404', async () => {
      tx.codificaContratto.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, K, 1))).toBeInstanceOf(NotFoundException)
    })
  })
})
