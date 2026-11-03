import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CodiciIvaService } from './codici-iva.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const K = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: K,
  tenantId: T,
  codice: '22',
  descrizione: 'IVA ordinaria 22%',
  aliquota: new Prisma.Decimal('22'),
  natura: null,
  attivo: true,
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

const dati = { codice: '22', descrizione: 'IVA ordinaria 22%', aliquota: '22' }

describe('CodiciIvaService (Prisma finto)', () => {
  let tx: any
  let prisma: any
  let service: CodiciIvaService

  beforeEach(() => {
    tx = {
      codiceIva: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      addebito: { groupBy: jest.fn().mockResolvedValue([]) },
      rigaAddebito: { groupBy: jest.fn().mockResolvedValue([]) },
      rigaLegameMovimento: { groupBy: jest.fn().mockResolvedValue([]) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new CodiciIvaService(prisma)
  })

  describe('list / getById', () => {
    it('aliquota in uscita con due decimali e uso reale in una sola passata', async () => {
      tx.codiceIva.findMany.mockResolvedValue([riga(), riga({ id: 'altro' })])
      tx.addebito.groupBy.mockResolvedValue([{ codiceIvaId: K, _count: { _all: 3 } }])
      const v = await service.list(T, true)
      expect(tx.addebito.groupBy).toHaveBeenCalledTimes(1)
      expect(tx.addebito.groupBy.mock.calls[0][0].by).toEqual(['codiceIvaId'])
      expect(v.map(x => x.eliminabile)).toEqual([false, true])
      expect(v[0].aliquota).toBe('22.00')
      expect(v[0]).toMatchObject({ id: K, codice: '22', natura: null, attivo: true, versione: 1 })
    })

    it('di default non include i disattivati', async () => {
      await service.list(T, false)
      expect(tx.codiceIva.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, attivo: true })
      await service.list(T, true)
      expect(tx.codiceIva.findMany.mock.calls[1][0].where).toEqual({ tenantId: T })
    })

    it('getById: non trovato = 404 con codice', async () => {
      tx.codiceIva.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, K))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('CODICE_IVA_NON_TROVATO')
    })
  })

  describe('crea', () => {
    it('normalizza (codice maiuscolo, aliquota a due decimali) e scrive; attivo di default true', async () => {
      const v = await service.crea(T, U, { ...dati, codice: ' n61 ', aliquota: '0,5' })
      expect(v.aliquota).toBe('0.50')
      expect(tx.codiceIva.create.mock.calls[0][0].data).toEqual({
        tenantId: T,
        codice: 'N61',
        descrizione: 'IVA ordinaria 22%',
        aliquota: '0.50',
        natura: null,
        attivo: true,
      })
    })

    it('aliquota zero con natura: ammessa', async () => {
      await service.crea(T, U, {
        codice: 'N61',
        descrizione: 'Reverse charge',
        aliquota: '0',
        natura: 'N6.1',
      })
      expect(tx.codiceIva.create.mock.calls[0][0].data).toMatchObject({
        aliquota: '0.00',
        natura: 'N6.1',
      })
    })

    it('dati non validi: 400 con l’array dei messaggi, nessuna scrittura', async () => {
      const e = await errore(service.crea(T, U, { codice: '', descrizione: '', aliquota: 'x' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CODICE_IVA_NON_VALIDO')
      expect(e.getResponse().message.length).toBeGreaterThanOrEqual(3)
      expect(tx.codiceIva.create).not.toHaveBeenCalled()
    })

    it('natura N2 generica: 400 col messaggio di R1', async () => {
      const e = await errore(
        service.crea(T, U, { codice: 'N2', descrizione: 'x', aliquota: '0', natura: 'N2' })
      )
      expect(e.getResponse().message).toContain(
        'La natura indicata non è ammessa nella fattura elettronica (usa N1, N2.1-N2.2, N3.1-N3.6, N4, N5, N6.1-N6.9 o N7).'
      )
    })

    it('P2002: 409 CODICE_IVA_CODICE_DUPLICATO', async () => {
      tx.codiceIva.create.mockRejectedValue(errP('P2002'))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'CODICE_IVA_CODICE_DUPLICATO',
        message: 'Esiste già un codice IVA con questo codice.',
      })
    })

    it('audit CREATO con id e codice, senza la descrizione', async () => {
      await service.crea(T, U, dati)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ userId: U, tenantId: T, action: 'CODICE_IVA_CREATO' })
      expect(audit.metadata).toEqual({ codiceIvaId: K, codice: '22' })
    })
  })

  describe('modifica', () => {
    it('non trovato: 404', async () => {
      tx.codiceIva.findFirst.mockResolvedValue(null)
      expect(
        await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 1 }))
      ).toBeInstanceOf(NotFoundException)
    })

    it('versione diversa: 409 senza updateMany', async () => {
      const e = await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('CODICE_IVA_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.codiceIva.updateMany).not.toHaveBeenCalled()
    })

    it('nessuna differenza (anche aliquota "22,00" = 22.00): nessuna scrittura né audit', async () => {
      await service.modifica(T, U, K, { aliquota: '22,00', versione: 1 })
      expect(tx.codiceIva.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('scrive solo i campi cambiati, condizionata alla versione, e registra l’audit coi nomi', async () => {
      tx.codiceIva.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', attivo: false, versione: 2 }))
      await service.modifica(T, U, K, { descrizione: 'Nuova', attivo: false, versione: 1 })
      const call = tx.codiceIva.updateMany.mock.calls[0][0]
      expect(call.where).toEqual({ id: K, tenantId: T, versione: 1 })
      expect(call.data).toEqual({ descrizione: 'Nuova', attivo: false, versione: { increment: 1 } })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CODICE_IVA_MODIFICATO')
      expect(audit.metadata.campi).toEqual(['descrizione', 'attivo'])
      expect(JSON.stringify(audit.metadata)).not.toContain('Nuova')
    })

    it('valida il risultato della fusione: aliquota zero senza natura = 400', async () => {
      const e = await errore(service.modifica(T, U, K, { aliquota: '0', versione: 1 }))
      expect(e.getResponse().error).toBe('CODICE_IVA_NON_VALIDO')
      expect(tx.codiceIva.updateMany).not.toHaveBeenCalled()
    })

    it('natura null azzera la natura (aliquota non zero)', async () => {
      tx.codiceIva.findFirst
        .mockResolvedValueOnce(riga({ aliquota: new Prisma.Decimal('0'), natura: 'N4' }))
        .mockResolvedValueOnce(riga())
      await service.modifica(T, U, K, { aliquota: '22', natura: null, versione: 1 })
      expect(tx.codiceIva.updateMany.mock.calls[0][0].data).toEqual({
        aliquota: '22.00',
        natura: null,
        versione: { increment: 1 },
      })
    })

    it('updateMany a zero righe: 409 modificato nel frattempo', async () => {
      tx.codiceIva.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, K, { descrizione: 'x', versione: 1 }))
      expect(e.getResponse().error).toBe('CODICE_IVA_MODIFICATO_NEL_FRATTEMPO')
    })

    it('P2002 sul cambio codice: 409 duplicato', async () => {
      tx.codiceIva.updateMany.mockRejectedValue(errP('P2002', { target: ['tenant_id', 'codice'] }))
      const e = await errore(service.modifica(T, U, K, { codice: '10', versione: 1 }))
      expect(e.getResponse().error).toBe('CODICE_IVA_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionata alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, K, 1)
      expect(tx.codiceIva.deleteMany).toHaveBeenCalledWith({
        where: { id: K, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('CODICE_IVA_ELIMINATO')
    })

    it('versione diversa: 409 senza deleteMany', async () => {
      expect(await errore(service.elimina(T, U, K, 9))).toBeInstanceOf(ConflictException)
      expect(tx.codiceIva.deleteMany).not.toHaveBeenCalled()
    })

    it('in uso da un addebito (P2003): 409 col testo intero di R9', async () => {
      tx.codiceIva.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, K, 1))
      expect(e.getResponse()).toMatchObject({
        error: 'CODICE_IVA_IN_USO',
        message:
          "Il codice IVA è usato da addebiti dell'archivio o da righe dei listini: disattivalo invece di eliminarlo.",
      })
    })

    it('non trovato: 404', async () => {
      tx.codiceIva.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, K, 1))).toBeInstanceOf(NotFoundException)
    })
  })
})
