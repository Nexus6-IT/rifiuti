import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { AllegatiContrattoClienteService } from './allegati-contratto-cliente.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const K = 'ffffffff-0000-4000-8000-000000000006'
const A = '99999999-0000-4000-8000-000000000009'

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenuto')])
const file = (extra: Record<string, unknown> = {}) => ({
  originalname: 'contratto.pdf',
  size: PDF.length,
  buffer: PDF,
  ...extra,
})

describe('AllegatiContrattoClienteService', () => {
  let tx: any
  let prisma: any
  let service: AllegatiContrattoClienteService

  beforeEach(() => {
    tx = {
      contrattoCliente: { findFirst: jest.fn().mockResolvedValue({ id: K }) },
      allegatoContrattoCliente: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(async ({ data }: any) => ({
          id: A,
          createdAt: new Date('2026-11-02T10:00:00.000Z'),
          ...data,
        })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = { ...tx, $transaction: jest.fn(async (fn: any) => fn(tx)) }
    service = new AllegatiContrattoClienteService(prisma)
  })

  describe('carica', () => {
    it('contratto inesistente o eliminato: 404 e nessuna scrittura', async () => {
      tx.contrattoCliente.findFirst.mockResolvedValue(null)
      await expect(service.carica(T, U, K, 1, file())).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.contrattoCliente.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: K, tenantId: T, eliminatoIl: null } })
      )
      expect(tx.allegatoContrattoCliente.create).not.toHaveBeenCalled()
    })

    it('posizione 3: 400 con il messaggio esatto', async () => {
      const p = service.carica(T, U, K, 3 as any, file())
      await expect(p).rejects.toBeInstanceOf(BadRequestException)
      await expect(p).rejects.toThrow("La posizione dell'allegato è 1 o 2.")
    })

    it('file non PDF per i magic bytes (anche se chiamato .pdf): 415', async () => {
      const exe = Buffer.from('MZ\x90\x00 non sono un pdf')
      const p = service.carica(T, U, K, 1, file({ originalname: 'x.pdf', buffer: exe }))
      await expect(p).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
      await expect(p).rejects.toThrow("L'allegato del contratto deve essere un PDF.")
      expect(tx.allegatoContrattoCliente.create).not.toHaveBeenCalled()
    })

    it("un'immagine PNG è riconosciuta ma non ammessa: 415", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])
      await expect(service.carica(T, U, K, 1, file({ buffer: png }))).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException
      )
    })

    it('file vuoto: 415', async () => {
      await expect(
        service.carica(T, U, K, 1, file({ buffer: Buffer.alloc(0), size: 0 }))
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException)
    })

    it('oltre 4 MiB: 413 e nessuna riga', async () => {
      const grande = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024)])
      const p = service.carica(T, U, K, 1, file({ buffer: grande, size: grande.length }))
      await expect(p).rejects.toBeInstanceOf(PayloadTooLargeException)
      await expect(p).rejects.toThrow("L'allegato supera i 4 MB.")
      expect(tx.allegatoContrattoCliente.create).not.toHaveBeenCalled()
    })

    it('esattamente 4 MiB: ammesso', async () => {
      const limite = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024 - 5)])
      const v = await service.carica(T, U, K, 2, file({ buffer: limite, size: limite.length }))
      expect(v.dimensioneByte).toBe(4 * 1024 * 1024)
    })

    it('salva con sha256, mime fisso, posizione e utente; restituisce la vista senza contenuto', async () => {
      const v = await service.carica(T, U, K, 2, file())
      const data = tx.allegatoContrattoCliente.create.mock.calls[0][0].data
      expect(data).toMatchObject({
        tenantId: T,
        contrattoId: K,
        posizione: 2,
        nomeFile: 'contratto.pdf',
        mimeType: 'application/pdf',
        dimensioneByte: PDF.length,
        caricatoDa: U,
        sha256: createHash('sha256').update(PDF).digest('hex'),
      })
      expect(v).toEqual({
        id: A,
        posizione: 2,
        nomeFile: 'contratto.pdf',
        dimensioneByte: PDF.length,
        caricatoIl: '2026-11-02T10:00:00.000Z',
      })
      expect(v).not.toHaveProperty('contenuto')
    })

    it('ripulisce il nome da percorsi e lo limita a 255 caratteri', async () => {
      await service.carica(T, U, K, 1, file({ originalname: '../../etc/x.pdf' }))
      expect(tx.allegatoContrattoCliente.create.mock.calls[0][0].data.nomeFile).toBe('x.pdf')
      await service.carica(T, U, K, 1, file({ originalname: 'C:\\temp\\y.pdf' }))
      expect(tx.allegatoContrattoCliente.create.mock.calls[1][0].data.nomeFile).toBe('y.pdf')
      await service.carica(T, U, K, 1, file({ originalname: 'a'.repeat(400) + '.pdf' }))
      expect(tx.allegatoContrattoCliente.create.mock.calls[2][0].data.nomeFile).toHaveLength(255)
    })

    it('audit CARICATO con contrattoId, posizione e dimensione, senza il nome del file', async () => {
      await service.carica(T, U, K, 1, file({ originalname: 'riservato.pdf' }))
      const a = tx.activityLog.create.mock.calls[0][0].data
      expect(a.action).toBe('ALLEGATO_CONTRATTO_CLIENTE_CARICATO')
      expect(a.tenantId).toBe(T)
      expect(a.userId).toBe(U)
      expect(a.metadata).toEqual({ contrattoId: K, posizione: 1, dimensioneByte: PDF.length })
      expect(JSON.stringify(a)).not.toContain('riservato')
    })

    it('P2002: 409 ALLEGATO_POSIZIONE_OCCUPATA', async () => {
      tx.allegatoContrattoCliente.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
      )
      const p = service.carica(T, U, K, 1, file())
      await expect(p).rejects.toBeInstanceOf(ConflictException)
      await expect(p).rejects.toMatchObject({
        response: { error: 'ALLEGATO_POSIZIONE_OCCUPATA' },
      })
    })
  })

  describe('elenco', () => {
    it("404 se il contratto non c'è; select senza contenuto, ordinato per posizione", async () => {
      tx.contrattoCliente.findFirst.mockResolvedValueOnce(null)
      await expect(service.elenco(T, K)).rejects.toBeInstanceOf(NotFoundException)
      tx.allegatoContrattoCliente.findMany.mockResolvedValue([
        { id: A, posizione: 1, nomeFile: 'a.pdf', dimensioneByte: 9, createdAt: new Date(0) },
      ])
      const r = await service.elenco(T, K)
      const arg = tx.allegatoContrattoCliente.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ contrattoId: K, tenantId: T })
      expect(arg.select.contenuto).toBeUndefined()
      expect(arg.orderBy).toEqual({ posizione: 'asc' })
      expect(r).toEqual([
        {
          id: A,
          posizione: 1,
          nomeFile: 'a.pdf',
          dimensioneByte: 9,
          caricatoIl: '1970-01-01T00:00:00.000Z',
        },
      ])
    })
  })

  describe('contenuto', () => {
    it("404 se l'allegato non è di quel contratto/azienda", async () => {
      tx.allegatoContrattoCliente.findFirst.mockResolvedValue(null)
      await expect(service.contenuto(T, K, A)).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.allegatoContrattoCliente.findFirst.mock.calls[0][0].where).toEqual({
        id: A,
        contrattoId: K,
        tenantId: T,
      })
    })

    it('restituisce nome e byte', async () => {
      tx.allegatoContrattoCliente.findFirst.mockResolvedValue({
        nomeFile: 'a.pdf',
        contenuto: new Uint8Array(PDF),
      })
      const r = await service.contenuto(T, K, A)
      expect(r.nomeFile).toBe('a.pdf')
      expect(Buffer.isBuffer(r.contenuto)).toBe(true)
      expect(r.contenuto.equals(PDF)).toBe(true)
    })
  })

  describe('rimuovi', () => {
    it("404 se non c'è; altrimenti cancella e lascia l'audit RIMOSSO", async () => {
      await expect(service.rimuovi(T, U, K, A)).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.allegatoContrattoCliente.deleteMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()

      tx.allegatoContrattoCliente.findFirst.mockResolvedValue({ posizione: 2 })
      await service.rimuovi(T, U, K, A)
      expect(tx.allegatoContrattoCliente.deleteMany).toHaveBeenLastCalledWith({
        where: { id: A, contrattoId: K, tenantId: T },
      })
      const a = tx.activityLog.create.mock.calls[0][0].data
      expect(a.action).toBe('ALLEGATO_CONTRATTO_CLIENTE_RIMOSSO')
      expect(a.metadata).toEqual({ contrattoId: K, posizione: 2 })
    })
  })
})
