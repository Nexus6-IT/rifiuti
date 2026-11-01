import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CondizioniPagamentoService } from './condizioni-pagamento.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: C,
  tenantId: T,
  codice: 'BB30',
  descrizione: 'Bonifico 30 giorni',
  modalita: 'MP05',
  giorniRate: [30],
  fineMese: false,
  attiva: true,
  versione: 1,
  ...extra,
})

const dati = {
  codice: 'BB30',
  descrizione: 'Bonifico 30 giorni',
  modalita: 'MP05' as const,
  giorniRate: [30],
  fineMese: false,
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

describe('CondizioniPagamentoService (Prisma finto)', () => {
  let tx: any
  let service: CondizioniPagamentoService

  beforeEach(() => {
    tx = {
      condizionePagamento: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new CondizioniPagamentoService(prisma)
  })

  describe('list / getById', () => {
    it('di default non include le disattivate', async () => {
      await service.list(T, false)
      expect(tx.condizionePagamento.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        attiva: true,
      })
    })

    it('con incluseDisattivate non filtra su attiva', async () => {
      await service.list(T, true)
      expect(tx.condizionePagamento.findMany.mock.calls[0][0].where).toEqual({ tenantId: T })
    })

    it('la vista porta descrizione delle rate, versione ed eliminabile', async () => {
      const [v] = await service.list(T, false)
      expect(v).toMatchObject({
        id: C,
        codice: 'BB30',
        giorniRate: [30],
        attiva: true,
        versione: 1,
        descrizioneRate: '30 gg',
        eliminabile: true,
      })
    })

    it('getById: non trovata = 404 con codice', async () => {
      tx.condizionePagamento.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, C))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_NON_TROVATA')
    })
  })

  describe('crea', () => {
    it('dati non validi: 400 CONDIZIONE_PAGAMENTO_NON_VALIDA con l’array dei messaggi', async () => {
      const e = await errore(service.crea(T, U, { ...dati, codice: '', giorniRate: [60, 30] }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_NON_VALIDA')
      expect(Array.isArray(e.getResponse().message)).toBe(true)
      expect(e.getResponse().message.length).toBeGreaterThanOrEqual(2)
      expect(tx.condizionePagamento.create).not.toHaveBeenCalled()
    })

    it('scrive i dati normalizzati e l’audit CREATA senza testo libero', async () => {
      const v = await service.crea(T, U, { ...dati, codice: ' BB30 ', modalita: 'mp05' as any })
      expect(tx.condizionePagamento.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        codice: 'BB30',
        modalita: 'MP05',
      })
      expect(v.id).toBe(C)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({
        tenantId: T,
        userId: U,
        action: 'CONDIZIONE_PAGAMENTO_CREATA',
      })
      expect(JSON.stringify(audit.metadata)).not.toContain('Bonifico')
    })

    it('P2002 sul codice: 409 codice duplicato', async () => {
      tx.condizionePagamento.create.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'codice'] })
      )
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_CODICE_DUPLICATO')
    })
  })

  describe('modifica', () => {
    it('non trovata: 404, nessuna scrittura', async () => {
      tx.condizionePagamento.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, C, { descrizione: 'x', versione: 1 }))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(tx.condizionePagamento.updateMany).not.toHaveBeenCalled()
    })

    it('versione diversa: 409 senza updateMany', async () => {
      const e = await errore(service.modifica(T, U, C, { descrizione: 'x', versione: 5 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_MODIFICATA_NEL_FRATTEMPO')
      expect(tx.condizionePagamento.updateMany).not.toHaveBeenCalled()
    })

    it('updateMany con count 0: 409 modificata nel frattempo', async () => {
      tx.condizionePagamento.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, C, { descrizione: 'Nuova', versione: 1 }))
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_MODIFICATA_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('nessuna differenza: nessuna scrittura e nessun audit', async () => {
      const v = await service.modifica(T, U, C, { descrizione: 'Bonifico 30 giorni', versione: 1 })
      expect(v.id).toBe(C)
      expect(tx.condizionePagamento.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('valida il risultato della fusione: 400 senza scrivere', async () => {
      const e = await errore(service.modifica(T, U, C, { giorniRate: [0, 30], versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_NON_VALIDA')
      expect(tx.condizionePagamento.updateMany).not.toHaveBeenCalled()
    })

    it('scrive condizionato alla versione e incrementa; audit con i nomi dei campi', async () => {
      tx.condizionePagamento.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuova', fineMese: true, versione: 2 }))
      const v = await service.modifica(T, U, C, {
        descrizione: 'Nuova',
        fineMese: true,
        versione: 1,
      })
      expect(tx.condizionePagamento.updateMany).toHaveBeenCalledWith({
        where: { id: C, tenantId: T, versione: 1 },
        data: { descrizione: 'Nuova', fineMese: true, versione: { increment: 1 } },
      })
      expect(v.versione).toBe(2)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CONDIZIONE_PAGAMENTO_MODIFICATA')
      expect(audit.metadata.campi).toEqual(['descrizione', 'fineMese'])
      expect(JSON.stringify(audit.metadata)).not.toContain('Nuova')
    })

    it('disattivazione: audit MODIFICATA con campi [attiva]', async () => {
      tx.condizionePagamento.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ attiva: false, versione: 2 }))
      await service.modifica(T, U, C, { attiva: false, versione: 1 })
      expect(tx.condizionePagamento.updateMany.mock.calls[0][0].data).toEqual({
        attiva: false,
        versione: { increment: 1 },
      })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CONDIZIONE_PAGAMENTO_MODIFICATA')
      expect(audit.metadata.campi).toEqual(['attiva'])
    })

    it('P2002 sul cambio codice: 409 codice duplicato', async () => {
      tx.condizionePagamento.updateMany.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'codice'] })
      )
      const e = await errore(service.modifica(T, U, C, { codice: 'ALTRO', versione: 1 }))
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionato alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, C, 1)
      expect(tx.condizionePagamento.deleteMany).toHaveBeenCalledWith({
        where: { id: C, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe(
        'CONDIZIONE_PAGAMENTO_ELIMINATA'
      )
    })

    it('versione diversa: 409 senza deleteMany', async () => {
      const e = await errore(service.elimina(T, U, C, 9))
      expect(e).toBeInstanceOf(ConflictException)
      expect(tx.condizionePagamento.deleteMany).not.toHaveBeenCalled()
    })

    it('in uso (P2003): 409 CONDIZIONE_PAGAMENTO_IN_USO', async () => {
      tx.condizionePagamento.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, C, 1))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONDIZIONE_PAGAMENTO_IN_USO')
    })

    it('non trovata: 404', async () => {
      tx.condizionePagamento.findFirst.mockResolvedValue(null)
      const e = await errore(service.elimina(T, U, C, 1))
      expect(e).toBeInstanceOf(NotFoundException)
    })
  })
})
