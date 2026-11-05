import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { RegistriIvaService } from './registri-iva.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const R = 'cccccccc-0000-4000-8000-000000000003'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: R,
  tenantId: T,
  codice: '01',
  descrizione: 'Vendite',
  ricevuteSplit: false,
  attivo: true,
  versione: 1,
  ...extra,
})

const dati = { codice: '01', descrizione: 'Vendite', ricevuteSplit: false }

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

describe('RegistriIvaService (Prisma finto)', () => {
  let tx: any
  let service: RegistriIvaService

  beforeEach(() => {
    tx = {
      registroIva: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      cliente: { groupBy: jest.fn().mockResolvedValue([]) },
      contrattoCliente: { groupBy: jest.fn().mockResolvedValue([]) },
      documentoFattura: { groupBy: jest.fn().mockResolvedValue([]) },
      numerazioneFattura: {
        groupBy: jest.fn().mockResolvedValue([]),
        fields: { numeroPartenza: {} },
      },
      cedenteFatturazione: { groupBy: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
    }
    const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new RegistriIvaService(prisma)
  })

  /** Testo di tutte le query raw lanciate (letture dei definitivi comprese). */
  const sqlDelleChiamate = () =>
    tx.$queryRaw.mock.calls.map((c: any) => (c[0] as string[]).join(' ')).join('\n')

  describe('list / getById', () => {
    it('uso reale (R23): un groupBy per colonna referente e una sola chiamata per list; eliminabile segue il conteggio', async () => {
      const base = await tx.registroIva.findFirst()
      const id = base.id
      tx.registroIva.findMany.mockResolvedValue([base, { ...base, id: 'altro-id' }])
      tx.contrattoCliente.groupBy.mockImplementation(async (a: any) =>
        a.by[0] === 'registroIvaId' ? [{ [a.by[0]]: id, _count: { _all: 2 } }] : []
      )
      const v = await service.list(T, false)
      expect(tx.cliente.groupBy).toHaveBeenCalledTimes(1)
      expect(tx.contrattoCliente.groupBy).toHaveBeenCalledTimes(1)
      expect(tx.contrattoCliente.groupBy.mock.calls.map((c: any) => c[0].by[0])).toEqual([
        'registroIvaId',
      ])
      expect(tx.contrattoCliente.groupBy.mock.calls[0][0].where.tenantId).toBe(T)
      expect(v.map((x: any) => x.eliminabile)).toEqual([false, true])
    })

    it('di default non include i disattivati', async () => {
      await service.list(T, false)
      expect(tx.registroIva.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, attivo: true })
    })

    it('con incluseDisattivate non filtra su attivo', async () => {
      await service.list(T, true)
      expect(tx.registroIva.findMany.mock.calls[0][0].where).toEqual({ tenantId: T })
    })

    it('la vista porta ricevuteSplit, versione ed eliminabile', async () => {
      tx.registroIva.findMany.mockResolvedValue([riga({ ricevuteSplit: true })])
      const [v] = await service.list(T, false)
      expect(v).toMatchObject({
        id: R,
        codice: '01',
        ricevuteSplit: true,
        attivo: true,
        versione: 1,
        eliminabile: true,
      })
    })

    it('getById: non trovato = 404 con codice', async () => {
      tx.registroIva.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, R))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('REGISTRO_IVA_NON_TROVATO')
    })
  })

  describe('crea', () => {
    it('dati non validi: 400 REGISTRO_IVA_NON_VALIDO con l’array dei messaggi', async () => {
      const e = await errore(service.crea(T, U, { ...dati, codice: '100', descrizione: '' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('REGISTRO_IVA_NON_VALIDO')
      expect(e.getResponse().message.length).toBeGreaterThanOrEqual(2)
      expect(tx.registroIva.create).not.toHaveBeenCalled()
    })

    it('completa il codice a due cifre (1 -> 01) e scrive l’audit senza testo libero', async () => {
      await service.crea(T, U, { ...dati, codice: '1' })
      expect(tx.registroIva.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        codice: '01',
        ricevuteSplit: false,
      })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ tenantId: T, userId: U, action: 'REGISTRO_IVA_CREATO' })
      expect(JSON.stringify(audit.metadata)).not.toContain('Vendite')
    })

    it('P2002 sul codice: 409 codice duplicato', async () => {
      tx.registroIva.create.mockRejectedValue(errP('P2002', { target: ['tenant_id', 'codice'] }))
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('REGISTRO_IVA_CODICE_DUPLICATO')
    })

    it('P2002 senza target (RLS): con un solo vincolo noto e’ comunque il codice', async () => {
      tx.registroIva.create.mockRejectedValue(errP('P2002'))
      const e = await errore(service.crea(T, U, dati))
      expect(e.getResponse().error).toBe('REGISTRO_IVA_CODICE_DUPLICATO')
    })
  })

  describe('modifica', () => {
    it('non trovato: 404, nessuna scrittura', async () => {
      tx.registroIva.findFirst.mockResolvedValue(null)
      const e = await errore(service.modifica(T, U, R, { descrizione: 'x', versione: 1 }))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(tx.registroIva.updateMany).not.toHaveBeenCalled()
    })

    it('versione diversa: 409 senza updateMany', async () => {
      const e = await errore(service.modifica(T, U, R, { descrizione: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('REGISTRO_IVA_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.registroIva.updateMany).not.toHaveBeenCalled()
    })

    it('updateMany con count 0: 409 modificato nel frattempo, nessun audit', async () => {
      tx.registroIva.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, R, { descrizione: 'Nuovo', versione: 1 }))
      expect(e.getResponse().error).toBe('REGISTRO_IVA_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('nessuna differenza: nessuna scrittura e nessun audit', async () => {
      await service.modifica(T, U, R, { descrizione: 'Vendite', versione: 1 })
      expect(tx.registroIva.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('valida il risultato della fusione: 400 senza scrivere', async () => {
      const e = await errore(service.modifica(T, U, R, { codice: 'AB', versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('REGISTRO_IVA_NON_VALIDO')
      expect(tx.registroIva.updateMany).not.toHaveBeenCalled()
    })

    it('scrive condizionato alla versione; audit con i nomi dei campi', async () => {
      tx.registroIva.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ descrizione: 'Nuovo', ricevuteSplit: true, versione: 2 }))
      const v = await service.modifica(T, U, R, {
        descrizione: 'Nuovo',
        ricevuteSplit: true,
        versione: 1,
      })
      expect(tx.registroIva.updateMany).toHaveBeenCalledWith({
        where: { id: R, tenantId: T, versione: 1 },
        data: { descrizione: 'Nuovo', ricevuteSplit: true, versione: { increment: 1 } },
      })
      expect(v.versione).toBe(2)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('REGISTRO_IVA_MODIFICATO')
      expect(audit.metadata.campi).toEqual(['descrizione', 'ricevuteSplit'])
      expect(JSON.stringify(audit.metadata)).not.toContain('Nuovo')
    })

    it('registro usato che diventa delle ricevute split: 409 REGISTRO_IVA_IN_USO, riga letta FOR UPDATE prima (R24)', async () => {
      tx.contrattoCliente.groupBy.mockResolvedValue([{ registroIvaId: R, _count: { _all: 1 } }])
      const e = await errore(service.modifica(T, U, R, { ricevuteSplit: true, versione: 1 }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toMatchObject({
        error: 'REGISTRO_IVA_IN_USO',
        message:
          'Il registro IVA è usato da clienti, contratti o documenti: non può diventare il registro delle ricevute split payment.',
      })
      expect(sqlDelleChiamate()).toContain('FOR UPDATE')
      expect(tx.registroIva.updateMany).not.toHaveBeenCalled()
    })

    it('registro usato: le altre modifiche restano ammesse, senza il lock', async () => {
      tx.contrattoCliente.groupBy.mockResolvedValue([{ registroIvaId: R, _count: { _all: 1 } }])
      await service.modifica(T, U, R, { descrizione: 'Altro', versione: 1 })
      expect(tx.registroIva.updateMany).toHaveBeenCalled()
      expect(sqlDelleChiamate()).not.toContain('FOR UPDATE')
    })

    it('disattivazione: campi [attivo]', async () => {
      tx.registroIva.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ attivo: false, versione: 2 }))
      await service.modifica(T, U, R, { attivo: false, versione: 1 })
      expect(tx.registroIva.updateMany.mock.calls[0][0].data).toEqual({
        attivo: false,
        versione: { increment: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.metadata.campi).toEqual(['attivo'])
    })

    it('P2002 sul cambio codice: 409 codice duplicato', async () => {
      tx.registroIva.updateMany.mockRejectedValue(
        errP('P2002', { target: ['tenant_id', 'codice'] })
      )
      const e = await errore(service.modifica(T, U, R, { codice: '02', versione: 1 }))
      expect(e.getResponse().error).toBe('REGISTRO_IVA_CODICE_DUPLICATO')
    })
  })

  describe('elimina', () => {
    it('cancella condizionato alla versione e scrive l’audit', async () => {
      await service.elimina(T, U, R, 1)
      expect(tx.registroIva.deleteMany).toHaveBeenCalledWith({
        where: { id: R, tenantId: T, versione: 1 },
      })
      expect(tx.activityLog.create.mock.calls[0][0].data.action).toBe('REGISTRO_IVA_ELIMINATO')
    })

    it('versione diversa: 409 senza deleteMany', async () => {
      const e = await errore(service.elimina(T, U, R, 9))
      expect(e).toBeInstanceOf(ConflictException)
      expect(tx.registroIva.deleteMany).not.toHaveBeenCalled()
    })

    it('in uso (P2003): 409 REGISTRO_IVA_IN_USO', async () => {
      tx.registroIva.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, R, 1))
      expect(e.getResponse().error).toBe('REGISTRO_IVA_IN_USO')
    })

    it('non trovato: 404', async () => {
      tx.registroIva.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, R, 1))).toBeInstanceOf(NotFoundException)
    })
  })
})
