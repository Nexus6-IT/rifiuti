import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CodificheAddebitoService } from './codifiche-addebito.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const K = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: K,
  tenantId: T,
  genere: 'GRUPPO',
  codice: '001',
  descrizione: 'Servizi di raccolta',
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

describe('CodificheAddebitoService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: CodificheAddebitoService

  beforeEach(() => {
    tx = {
      codificaAddebito: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      addebito: { groupBy: jest.fn().mockResolvedValue([]) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new CodificheAddebitoService(prisma)
  })

  describe('list / getById', () => {
    it('uso reale: un groupBy per colonna referente, una sola passata; eliminabile segue il conteggio', async () => {
      tx.codificaAddebito.findMany.mockResolvedValue([riga(), riga({ id: 'altro-id' })])
      tx.addebito.groupBy.mockImplementation(async (a: any) =>
        a.by[0] === 'categoriaId' ? [{ categoriaId: K, _count: { _all: 2 } }] : []
      )
      const v = await service.list(T, { genere: 'GRUPPO', incluseDisattivate: false })
      expect(tx.addebito.groupBy).toHaveBeenCalledTimes(5)
      expect(v.map(x => x.eliminabile)).toEqual([false, true])
    })

    it('filtra per genere; con incluseDisattivate non filtra su attiva', async () => {
      await service.list(T, { genere: 'CENTRO_RICAVO', incluseDisattivate: false })
      expect(tx.codificaAddebito.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        genere: 'CENTRO_RICAVO',
        attiva: true,
      })
      await service.list(T, { genere: 'CENTRO_RICAVO', incluseDisattivate: true })
      expect(tx.codificaAddebito.findMany.mock.calls[1][0].where).toEqual({
        tenantId: T,
        genere: 'CENTRO_RICAVO',
      })
    })

    it('genere non ammesso (anche uno di 4.1): 400', async () => {
      const e = await errore(service.list(T, { genere: 'TIPO' as any, incluseDisattivate: false }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_NON_VALIDA')
    })

    it('getById: non trovata = 404', async () => {
      tx.codificaAddebito.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, K))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_NON_TROVATA')
    })
  })

  describe('prossimoCodice', () => {
    it('genere vuoto: 001; salta i codici usati', async () => {
      expect(await service.prossimoCodice(T, 'GRUPPO')).toBe('001')
      tx.$queryRaw.mockResolvedValue([{ codice: '001' }, { codice: '003' }])
      expect(await service.prossimoCodice(T, 'GRUPPO')).toBe('002')
    })

    it('codici esauriti: 400', async () => {
      tx.$queryRaw.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ codice: String(i + 1).padStart(3, '0') }))
      )
      const e = await errore(service.prossimoCodice(T, 'GRUPPO'))
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
    it('senza codice (rapida): prende il lock consultivo, legge i codici senza FOR UPDATE e assegna 001', async () => {
      const v = await service.crea(T, U, { genere: 'GRUPPO', descrizione: 'Urbani' })
      expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain('pg_advisory_xact_lock')
      expect(tx.$queryRaw.mock.calls[0][0].join('?')).not.toContain('FOR UPDATE')
      expect(tx.codificaAddebito.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        genere: 'GRUPPO',
        codice: '001',
      })
      expect(v.codice).toBe('001')
    })

    it('codice null (modo normale) = come assente', async () => {
      await service.crea(T, U, { genere: 'GRUPPO', descrizione: 'Urbani', codice: null })
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
    })

    it('codice esplicito "7" si riempie a "007" e non legge i codici', async () => {
      await service.crea(T, U, { genere: 'CATEGORIA', codice: '7', descrizione: 'Cat' })
      expect(tx.$queryRaw).not.toHaveBeenCalled()
      expect(tx.codificaAddebito.create.mock.calls[0][0].data.codice).toBe('007')
    })

    it('codice alfanumerico (R2): 400 "Il codice ha da 1 a 3 cifre."', async () => {
      const e = await errore(
        service.crea(T, U, { genere: 'GRUPPO', codice: 'AB', descrizione: 'x' })
      )
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_NON_VALIDA')
      expect(e.getResponse().message).toEqual(['Il codice ha da 1 a 3 cifre.'])
    })

    it('codici esauriti: 400, nessuna scrittura', async () => {
      tx.$queryRaw.mockResolvedValue(
        Array.from({ length: 999 }, (_, i) => ({ codice: String(i + 1).padStart(3, '0') }))
      )
      const e = await errore(service.crea(T, U, { genere: 'GRUPPO', descrizione: 'x' }))
      expect(e.getResponse().message).toBe(
        'Non si possono creare più di 999 codici per questo elenco.'
      )
      expect(tx.codificaAddebito.create).not.toHaveBeenCalled()
    })

    it('P2002 al primo tentativo senza codice: riprova in una nuova transazione col successivo', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ codice: '001' }])
      tx.codificaAddebito.create
        .mockRejectedValueOnce(errP('P2002'))
        .mockImplementationOnce(async ({ data }: any) => riga(data))
      const v = await service.crea(T, U, { genere: 'GRUPPO', descrizione: 'Urbani' })
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
      expect(v.codice).toBe('002')
    })

    it('P2002 anche al secondo tentativo: 409 duplicato', async () => {
      tx.codificaAddebito.create.mockRejectedValue(errP('P2002'))
      const e = await errore(service.crea(T, U, { genere: 'GRUPPO', descrizione: 'Urbani' }))
      expect(prisma.$transaction).toHaveBeenCalledTimes(2)
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_CODICE_DUPLICATO')
    })

    it('P2002 con codice esplicito: nessun nuovo tentativo', async () => {
      tx.codificaAddebito.create.mockRejectedValue(errP('P2002'))
      const e = await errore(
        service.crea(T, U, { genere: 'GRUPPO', codice: '001', descrizione: 'Urbani' })
      )
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_CODICE_DUPLICATO')
    })

    it('audit CREATA con genere e codice, senza la descrizione', async () => {
      await service.crea(T, U, { genere: 'CENTRO_RICAVO', descrizione: 'Centro riservato' })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ userId: U, action: 'CODIFICA_ADDEBITO_CREATA' })
      expect(audit.metadata).toMatchObject({ genere: 'CENTRO_RICAVO', codice: '001' })
      expect(JSON.stringify(audit.metadata)).not.toContain('riservato')
    })
  })

  describe('modifica', () => {
    it('non trovata: 404; versione diversa: 409 senza scrivere', async () => {
      tx.codificaAddebito.findFirst.mockResolvedValueOnce(null)
      expect(
        await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 1 }))
      ).toBeInstanceOf(NotFoundException)
      const e = await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO')
      expect(tx.codificaAddebito.updateMany).not.toHaveBeenCalled()
    })

    it('nessuna differenza: nessuna scrittura né audit', async () => {
      await service.modifica(T, U, K, {
        descrizione: 'Servizi di raccolta',
        codice: '1',
        versione: 1,
      })
      expect(tx.codificaAddebito.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('codice vuoto "": 400 col messaggio di R2 (non "Indica il codice")', async () => {
      const e = await errore(service.modifica(T, U, K, { codice: '', versione: 1 }))
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_NON_VALIDA')
      expect(e.getResponse().message).toEqual(['Il codice ha da 1 a 3 cifre.'])
      expect(tx.codificaAddebito.updateMany).not.toHaveBeenCalled()
    })

    it('il genere non cambia mai: non compare fra i dati scritti', async () => {
      tx.codificaAddebito.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', versione: 2 }))
      await service.modifica(T, U, K, {
        descrizione: 'Nuova',
        versione: 1,
        genere: 'CATEGORIA',
      } as any)
      expect(tx.codificaAddebito.updateMany.mock.calls[0][0].data).toEqual({
        descrizione: 'Nuova',
        versione: { increment: 1 },
      })
      expect(tx.codificaAddebito.updateMany.mock.calls[0][0].where).toEqual({
        id: K,
        tenantId: T,
        versione: 1,
      })
    })

    it('audit con i nomi dei campi e il genere, mai il testo', async () => {
      tx.codificaAddebito.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', attiva: false, versione: 2 }))
      await service.modifica(T, U, K, { descrizione: 'Nuova', attiva: false, versione: 1 })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CODIFICA_ADDEBITO_MODIFICATA')
      expect(audit.metadata.campi).toEqual(['descrizione', 'attiva'])
      expect(audit.metadata.genere).toBe('GRUPPO')
      expect(JSON.stringify(audit.metadata)).not.toContain('Nuova')
    })

    it('P2002 sul cambio codice: 409 duplicato', async () => {
      tx.codificaAddebito.updateMany.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'genere', 'codice'] })
      )
      const e = await errore(service.modifica(T, U, K, { codice: '002', versione: 1 }))
      expect(e.getResponse().error).toBe('CODIFICA_ADDEBITO_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionata alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, K, 1)
      expect(tx.codificaAddebito.deleteMany).toHaveBeenCalledWith({
        where: { id: K, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('CODIFICA_ADDEBITO_ELIMINATA')
    })

    it('versione diversa: 409 senza deleteMany; non trovata: 404', async () => {
      expect(await errore(service.elimina(T, U, K, 9))).toBeInstanceOf(ConflictException)
      expect(tx.codificaAddebito.deleteMany).not.toHaveBeenCalled()
      tx.codificaAddebito.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, K, 1))).toBeInstanceOf(NotFoundException)
    })

    it('in uso da un addebito (P2003): 409 col testo intero di R9', async () => {
      tx.codificaAddebito.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse()).toMatchObject({
        error: 'CODIFICA_ADDEBITO_IN_USO',
        message: "La codifica è usata da addebiti dell'archivio: disattivala invece di eliminarla.",
      })
    })
  })
})
