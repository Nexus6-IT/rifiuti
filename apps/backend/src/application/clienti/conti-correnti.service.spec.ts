import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ContiCorrentiService } from './conti-correnti.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const IBAN = 'IT60X0542811101000000123456'
const IBAN2 = 'DE89370400440532013000'

const riga = (extra: Record<string, unknown> = {}) => ({
  id: C,
  tenantId: T,
  codice: 'C1',
  descrizione: 'Conto principale',
  banca: 'Banca di prova',
  iban: IBAN,
  bic: null,
  attivo: true,
  versione: 1,
  ...extra,
})

const dati = {
  codice: 'C1',
  descrizione: 'Conto principale',
  banca: 'Banca di prova',
  iban: 'it60 x054 2811 1010 0000 0123 456',
  bic: null,
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

describe('ContiCorrentiService (Prisma finto)', () => {
  let tx: any
  let service: ContiCorrentiService

  beforeEach(() => {
    tx = {
      contoCorrente: {
        findFirst: jest.fn().mockResolvedValue(riga()),
        findMany: jest.fn().mockResolvedValue([riga()]),
        create: jest.fn(async ({ data }: any) => riga(data)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    const prisma: any = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new ContiCorrentiService(prisma)
  })

  describe('list / getById', () => {
    it('di default non include i disattivati; con incluseDisattivate non filtra', async () => {
      await service.list(T, false)
      expect(tx.contoCorrente.findMany.mock.calls[0][0].where).toEqual({
        tenantId: T,
        attivo: true,
      })
      await service.list(T, true)
      expect(tx.contoCorrente.findMany.mock.calls[1][0].where).toEqual({ tenantId: T })
    })

    it('l’elenco ha l’IBAN mascherato e non l’IBAN intero', async () => {
      const [v] = await service.list(T, false)
      expect(v.ibanMascherato).toBe('IT60 **** **** 3456')
      expect(JSON.stringify(v)).not.toContain(IBAN)
      expect(v).toMatchObject({ id: C, versione: 1, attivo: true, eliminabile: true })
    })

    it('il dettaglio ha l’IBAN intero e quello mascherato', async () => {
      const v = await service.getById(T, C)
      expect(v.iban).toBe(IBAN)
      expect(v.ibanMascherato).toBe('IT60 **** **** 3456')
    })

    it('getById: non trovato = 404 con codice', async () => {
      tx.contoCorrente.findFirst.mockResolvedValue(null)
      const e = await errore(service.getById(T, C))
      expect(e).toBeInstanceOf(NotFoundException)
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_NON_TROVATO')
    })
  })

  describe('crea', () => {
    it('dati non validi: 400 CONTO_CORRENTE_NON_VALIDO senza scrivere né rivelare l’IBAN', async () => {
      const e = await errore(service.crea(T, U, { ...dati, codice: '', iban: 'IT00ABC' }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_NON_VALIDO')
      expect(JSON.stringify(e.getResponse())).not.toContain('IT00ABC')
      expect(tx.contoCorrente.create).not.toHaveBeenCalled()
    })

    it('salva l’IBAN normalizzato; l’audit non contiene IBAN, BIC, banca né descrizione', async () => {
      const v = await service.crea(T, U, { ...dati, bic: 'bpmoit22' })
      expect(tx.contoCorrente.create.mock.calls[0][0].data).toMatchObject({
        tenantId: T,
        iban: IBAN,
        bic: 'BPMOIT22',
      })
      expect(v.id).toBe(C)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ tenantId: T, userId: U, action: 'CONTO_CORRENTE_CREATO' })
      const json = JSON.stringify(audit)
      for (const vietato of [IBAN, 'BPMOIT22', 'Banca di prova', 'Conto principale']) {
        expect(json).not.toContain(vietato)
      }
    })

    it('P2002 sull’IBAN (target col nome del vincolo): 409 CONTO_CORRENTE_IBAN_DUPLICATO', async () => {
      tx.contoCorrente.create.mockRejectedValue(
        errP('P2002', { target: 'conti_correnti_tenant_id_iban_key' })
      )
      const e = await errore(service.crea(T, U, dati))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')
      expect(JSON.stringify(e.getResponse())).not.toContain(IBAN)
    })

    it('P2002 senza target (RLS) con IBAN già presente: riletto, IBAN_DUPLICATO', async () => {
      tx.contoCorrente.create.mockRejectedValue(errP('P2002', { target: null }))
      tx.contoCorrente.findFirst.mockResolvedValue(riga({ id: 'altro' }))
      const e = await errore(service.crea(T, U, dati))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')
      expect(tx.contoCorrente.findFirst.mock.calls[0][0].where).toMatchObject({
        tenantId: T,
        iban: IBAN,
      })
    })

    it('P2002 senza target e IBAN libero: CODICE_DUPLICATO', async () => {
      tx.contoCorrente.create.mockRejectedValue(errP('P2002', { target: null }))
      tx.contoCorrente.findFirst.mockResolvedValue(null)
      const e = await errore(service.crea(T, U, dati))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_CODICE_DUPLICATO')
    })
  })

  describe('modifica', () => {
    it('non trovato: 404; versione diversa: 409 senza scrivere', async () => {
      tx.contoCorrente.findFirst.mockResolvedValueOnce(null)
      expect(await errore(service.modifica(T, U, C, { banca: 'x', versione: 1 }))).toBeInstanceOf(
        NotFoundException
      )
      const e = await errore(service.modifica(T, U, C, { banca: 'x', versione: 5 }))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.contoCorrente.updateMany).not.toHaveBeenCalled()
    })

    it('nessuna differenza: nessuna scrittura né audit (IBAN con spazi = stesso IBAN)', async () => {
      await service.modifica(T, U, C, { iban: 'IT60 X054 2811 1010 0000 0123 456', versione: 1 })
      expect(tx.contoCorrente.updateMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('modifica dell’IBAN: audit con campi [iban] e senza valori', async () => {
      tx.contoCorrente.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ iban: IBAN2, versione: 2 }))
      const v = await service.modifica(T, U, C, { iban: IBAN2, versione: 1 })
      expect(tx.contoCorrente.updateMany).toHaveBeenCalledWith({
        where: { id: C, tenantId: T, versione: 1 },
        data: { iban: IBAN2, versione: { increment: 1 } },
      })
      expect(v.versione).toBe(2)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CONTO_CORRENTE_MODIFICATO')
      expect(audit.metadata.campi).toEqual(['iban'])
      const json = JSON.stringify(audit)
      expect(json).not.toContain(IBAN)
      expect(json).not.toContain(IBAN2)
    })

    it('bic null azzera il BIC; disattivazione = campi [attivo]', async () => {
      tx.contoCorrente.findFirst
        .mockResolvedValueOnce(riga({ bic: 'BPMOIT22' }))
        .mockResolvedValueOnce(riga({ versione: 2 }))
      await service.modifica(T, U, C, { bic: null, versione: 1 })
      expect(tx.contoCorrente.updateMany.mock.calls[0][0].data).toEqual({
        bic: null,
        versione: { increment: 1 },
      })
      tx.contoCorrente.findFirst
        .mockResolvedValueOnce(riga())
        .mockResolvedValueOnce(riga({ attivo: false, versione: 2 }))
      await service.modifica(T, U, C, { attivo: false, versione: 1 })
      expect(tx.activityLog.create.mock.calls[1][0].data.metadata.campi).toEqual(['attivo'])
    })

    it('valida il risultato della fusione: IBAN non valido = 400', async () => {
      const e = await errore(service.modifica(T, U, C, { iban: 'IT00', versione: 1 }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(tx.contoCorrente.updateMany).not.toHaveBeenCalled()
    })

    it('updateMany con count 0: 409 modificato nel frattempo', async () => {
      tx.contoCorrente.updateMany.mockResolvedValue({ count: 0 })
      const e = await errore(service.modifica(T, U, C, { banca: 'Altra', versione: 1 }))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO')
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('P2002 sull’IBAN in modifica: 409 IBAN_DUPLICATO (la rilettura esclude la riga stessa)', async () => {
      tx.contoCorrente.updateMany.mockRejectedValue(errP('P2002', { target: null }))
      tx.contoCorrente.findFirst.mockResolvedValueOnce(riga()).mockResolvedValue(riga({ id: 'x' }))
      const e = await errore(service.modifica(T, U, C, { iban: IBAN2, versione: 1 }))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_IBAN_DUPLICATO')
      const rilettura = tx.contoCorrente.findFirst.mock.calls[1][0].where
      expect(rilettura).toMatchObject({ tenantId: T, iban: IBAN2, id: { not: C } })
    })
  })

  describe('elimina', () => {
    it('cancella condizionato alla versione e scrive l’audit senza IBAN', async () => {
      await service.elimina(T, U, C, 1)
      expect(tx.contoCorrente.deleteMany).toHaveBeenCalledWith({
        where: { id: C, tenantId: T, versione: 1 },
      })
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit.action).toBe('CONTO_CORRENTE_ELIMINATO')
      expect(JSON.stringify(audit)).not.toContain(IBAN)
    })

    it('versione vecchia: 409; non trovato: 404', async () => {
      const e = await errore(service.elimina(T, U, C, 9))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_MODIFICATO_NEL_FRATTEMPO')
      tx.contoCorrente.findFirst.mockResolvedValue(null)
      expect(await errore(service.elimina(T, U, C, 1))).toBeInstanceOf(NotFoundException)
    })

    it('P2003 (FK dei referenti): 409 CONTO_CORRENTE_IN_USO', async () => {
      tx.contoCorrente.deleteMany.mockRejectedValue(errP('P2003'))
      const e = await errore(service.elimina(T, U, C, 1))
      expect(e.getResponse().error).toBe('CONTO_CORRENTE_IN_USO')
    })
  })
})
