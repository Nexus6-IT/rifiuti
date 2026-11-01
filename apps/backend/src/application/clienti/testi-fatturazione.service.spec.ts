import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TestiFatturazioneService } from './testi-fatturazione.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const X = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: X,
  tenantId: T,
  codice: 'T1',
  titolo: 'Pagamento',
  righe: ['Prima riga', 'Seconda riga'],
  attivo: true,
  versione: 1,
  ...extra,
})

const dati = { codice: 'T1', titolo: 'Pagamento', righe: ['Prima riga', 'Seconda riga'] }

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

describe('TestiFatturazioneService (Prisma finto)', () => {
  let tx: any
  let service: TestiFatturazioneService

  beforeEach(() => {
    tx = {
      testoFatturazione: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new TestiFatturazioneService(prisma)
  })

  describe('list / getById', () => {
    it('di default non include i disattivati', async () => {
      await service.list(T, false)
      expect(tx.testoFatturazione.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        attivo: true,
      })
    })

    it('con incluseDisattivate non filtra su attivo', async () => {
      await service.list(T, true)
      expect(tx.testoFatturazione.findMany.mock.calls[0][0].where).toEqual({ tenantId: T })
    })

    it('la vista porta le righe, versione ed eliminabile', async () => {
      const [v] = await service.list(T, false)
      expect(v).toMatchObject({
        id: X,
        codice: 'T1',
        titolo: 'Pagamento',
        righe: ['Prima riga', 'Seconda riga'],
        attivo: true,
        versione: 1,
        eliminabile: true,
      })
    })

    it('getById: non trovato = 404 con codice', async () => {
      tx.testoFatturazione.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, X))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_NON_TROVATO')
    })
  })

  describe('crea', () => {
    it('17 righe: 400 TESTO_FATTURAZIONE_NON_VALIDO con l’array dei messaggi', async () => {
      const righe = Array.from({ length: 17 }, (_, i) => `riga ${i + 1}`)
      const e = await errore(service.crea(T, U, { ...dati, righe }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_NON_VALIDO')
      expect(Array.isArray(e.getResponse().message)).toBe(true)
      expect(tx.testoFatturazione.create).not.toHaveBeenCalled()
    })

    it('toglie le righe vuote in coda e scrive l’audit senza il testo', async () => {
      await service.crea(T, U, { ...dati, righe: ['Prima riga', '', ''] })
      expect(tx.testoFatturazione.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        codice: 'T1',
        righe: ['Prima riga'],
      })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ userId: U, action: 'TESTO_FATTURAZIONE_CREATO' })
      expect(JSON.stringify(audit.metadata)).not.toContain('Prima riga')
      expect(JSON.stringify(audit.metadata)).not.toContain('Pagamento')
    })

    it('P2002 sul codice: 409 codice duplicato', async () => {
      tx.testoFatturazione.create.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'codice'] })
      )
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_CODICE_DUPLICATO')
    })
  })

  describe('modifica', () => {
    it('non trovato: 404', async () => {
      tx.testoFatturazione.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, X, { titolo: 'x', versione: 1 }))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(tx.testoFatturazione.updateMany).not.toHaveBeenCalled()
    })

    it('versione diversa: 409 senza updateMany', async () => {
      const e = await errore(service.modifica(T, U, X, { titolo: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.testoFatturazione.updateMany).not.toHaveBeenCalled()
    })

    it('updateMany con count 0: 409, nessun audit', async () => {
      tx.testoFatturazione.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, X, { titolo: 'Nuovo', versione: 1 }))
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('righe invariate: nessuna scrittura (il confronto e’ sull’array)', async () => {
      await service.modifica(T, U, X, { righe: ['Prima riga', 'Seconda riga'], versione: 1 })
      expect(tx.testoFatturazione.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('fusione non valida (righe vuote): 400 senza scrivere', async () => {
      const e = await errore(service.modifica(T, U, X, { righe: ['', ''], versione: 1 }))
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_NON_VALIDO')
      expect(tx.testoFatturazione.updateMany).not.toHaveBeenCalled()
    })

    it('scrive condizionato alla versione; audit con i nomi dei campi', async () => {
      tx.testoFatturazione.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ titolo: 'Nuovo', righe: ['Sola riga'], versione: 2 }))
      const v = await service.modifica(T, U, X, {
        titolo: 'Nuovo',
        righe: ['Sola riga'],
        versione: 1,
      })
      expect(tx.testoFatturazione.updateMany).toHaveBeenCalledWith({
        where: { id: X, tenantId: T, versione: 1 },
        data: { titolo: 'Nuovo', righe: ['Sola riga'], versione: { increment: 1 } },
      })
      expect(v.versione).toBe(2)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('TESTO_FATTURAZIONE_MODIFICATO')
      expect(audit.metadata.campi).toEqual(['titolo', 'righe'])
      expect(JSON.stringify(audit.metadata)).not.toContain('Sola riga')
    })

    it('disattivazione: campi [attivo]', async () => {
      tx.testoFatturazione.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ attivo: false, versione: 2 }))
      await service.modifica(T, U, X, { attivo: false, versione: 1 })
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata.campi).toEqual(['attivo'])
    })

    it('P2002 sul cambio codice: 409 codice duplicato', async () => {
      tx.testoFatturazione.updateMany.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'codice'] })
      )
      const e = await errore(service.modifica(T, U, X, { codice: 'T2', versione: 1 }))
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionato alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, X, 1)
      expect(tx.testoFatturazione.deleteMany).toHaveBeenCalledWith({
        where: { id: X, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe(
        'TESTO_FATTURAZIONE_ELIMINATO'
      )
    })

    it('versione diversa: 409 senza deleteMany', async () => {
      const e = await errore(service.elimina(T, U, X, 9))
      expect(e).toBeInstanceOf(ConflictException)
      expect(tx.testoFatturazione.deleteMany).not.toHaveBeenCalled()
    })

    it('in uso (P2003): 409 TESTO_FATTURAZIONE_IN_USO', async () => {
      tx.testoFatturazione.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, X, 1))
      expect(e.getResponse().error).toBe('TESTO_FATTURAZIONE_IN_USO')
    })

    it('non trovato: 404', async () => {
      tx.testoFatturazione.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, X, 1))).toBeInstanceOf(NotFoundException)
    })
  })
})
