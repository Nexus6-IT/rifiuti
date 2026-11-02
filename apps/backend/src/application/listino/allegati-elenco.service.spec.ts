import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { createHash } from 'crypto'
import { AllegatiElencoService } from './allegati-elenco.service'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const U = 'bbbbbbbb-0000-4000-8000-000000000002'
const K = 'ffffffff-0000-4000-8000-000000000006'
const A = '99999999-0000-4000-8000-000000000009'

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('contenuto')])
const file = (extra: Record<string, unknown> = {}) => ({
  originalname: 'elenco.pdf',
  size: PDF.length,
  buffer: PDF,
  ...extra,
})

describe('AllegatiElencoService', () => {
  let tx: any
  let prisma: any
  let service: AllegatiElencoService

  beforeEach(() => {
    tx = {
      elencoAddebiti: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: K, contrattoId: 'cccccccc-0000-4000-8000-00000000000c' }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: K }]),
      allegatoElencoAddebiti: {
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
    service = new AllegatiElencoService(prisma)
  })

  describe('carica', () => {
    it('elenco inesistente o di contratto eliminato: 404 e nessuna scrittura', async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValue(null)
      await expect(service.carica(T, U, K, 1, file())).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.elencoAddebiti.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: K, tenantId: T, contratto: { eliminatoIl: null } } })
      )
      expect(tx.allegatoElencoAddebiti.create).not.toHaveBeenCalled()
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
      await expect(p).rejects.toThrow("L'allegato dell'elenco deve essere un PDF.")
      expect(tx.allegatoElencoAddebiti.create).not.toHaveBeenCalled()
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
      expect(tx.allegatoElencoAddebiti.create).not.toHaveBeenCalled()
    })

    it('esattamente 4 MiB: ammesso', async () => {
      const limite = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(4 * 1024 * 1024 - 5)])
      const v = await service.carica(T, U, K, 2, file({ buffer: limite, size: limite.length }))
      expect(v.dimensioneByte).toBe(4 * 1024 * 1024)
    })

    it('salva con sha256, mime fisso, posizione e utente; restituisce la vista senza contenuto', async () => {
      const v = await service.carica(T, U, K, 2, file())
      const data = tx.allegatoElencoAddebiti.create.mock.calls[0][0].data
      expect(data).toMatchObject({
        tenantId: T,
        elencoId: K,
        posizione: 2,
        nomeFile: 'elenco.pdf',
        mimeType: 'application/pdf',
        dimensioneByte: PDF.length,
        caricatoDa: U,
        sha256: createHash('sha256').update(PDF).digest('hex'),
      })
      expect(v).toEqual({
        id: A,
        posizione: 2,
        nomeFile: 'elenco.pdf',
        dimensioneByte: PDF.length,
        caricatoIl: '2026-11-02T10:00:00.000Z',
      })
      expect(v).not.toHaveProperty('contenuto')
    })

    it('ripulisce il nome da percorsi e lo limita a 255 caratteri', async () => {
      await service.carica(T, U, K, 1, file({ originalname: '../../etc/x.pdf' }))
      expect(tx.allegatoElencoAddebiti.create.mock.calls[0][0].data.nomeFile).toBe('x.pdf')
      await service.carica(T, U, K, 1, file({ originalname: 'C:\\temp\\y.pdf' }))
      expect(tx.allegatoElencoAddebiti.create.mock.calls[1][0].data.nomeFile).toBe('y.pdf')
      await service.carica(T, U, K, 1, file({ originalname: 'a'.repeat(400) + '.pdf' }))
      expect(tx.allegatoElencoAddebiti.create.mock.calls[2][0].data.nomeFile).toHaveLength(255)
    })

    it('audit CARICATO con elencoId, posizione e dimensione, senza il nome del file', async () => {
      await service.carica(T, U, K, 1, file({ originalname: 'riservato.pdf' }))
      const a = tx.activityLog.create.mock.calls[0][0].data
      expect(a.action).toBe('ALLEGATO_ELENCO_ADDEBITI_CARICATO')
      expect(a.tenantId).toBe(T)
      expect(a.userId).toBe(U)
      expect(a.metadata).toEqual({ elencoId: K, posizione: 1, dimensioneByte: PDF.length })
      expect(JSON.stringify(a)).not.toContain('riservato')
    })

    it('P2002: 409 ALLEGATO_POSIZIONE_OCCUPATA', async () => {
      tx.allegatoElencoAddebiti.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' })
      )
      const p = service.carica(T, U, K, 1, file())
      await expect(p).rejects.toBeInstanceOf(ConflictException)
      await expect(p).rejects.toMatchObject({
        response: { error: 'ALLEGATO_POSIZIONE_OCCUPATA' },
      })
    })
  })

  describe('lock e contratto annullato (R47, eccezione a D16)', () => {
    it('contratto ed elenco FOR SHARE prima di scrivere, senza filtro sullo stato del contratto', async () => {
      await service.carica(T, U, K, 1, file())
      expect(tx.$queryRaw).toHaveBeenCalledTimes(2)
      const sql = tx.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?'))
      expect(sql[0]).toContain('contratti_cliente')
      expect(sql[0]).toContain('FOR SHARE')
      expect(sql[1]).toContain('elenchi_addebiti')
      expect(sql[1]).toContain('FOR SHARE')
      for (const q of sql) expect(q).not.toMatch(/stato/i)
      const where = tx.elencoAddebiti.findFirst.mock.calls[0][0].where
      expect(JSON.stringify(where)).not.toMatch(/stato/i)
    })

    it('contratto sparito fra la lettura e il lock: 404 e nessuna scrittura', async () => {
      tx.$queryRaw.mockResolvedValueOnce([])
      await expect(service.carica(T, U, K, 1, file())).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.allegatoElencoAddebiti.create).not.toHaveBeenCalled()
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'c' }]).mockResolvedValueOnce([])
      await expect(service.rimuovi(T, U, K, A)).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.allegatoElencoAddebiti.deleteMany).not.toHaveBeenCalled()
    })

    it('id non UUID: 404 senza toccare il database', async () => {
      await expect(service.elenco(T, 'x')).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.contenuto(T, K, 'x')).rejects.toBeInstanceOf(NotFoundException)
      await expect(service.rimuovi(T, U, 'x', A)).rejects.toBeInstanceOf(NotFoundException)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('elenco', () => {
    it("404 se l'elenco non c'è; select senza contenuto, ordinato per posizione", async () => {
      tx.elencoAddebiti.findFirst.mockResolvedValueOnce(null)
      await expect(service.elenco(T, K)).rejects.toBeInstanceOf(NotFoundException)
      tx.allegatoElencoAddebiti.findMany.mockResolvedValue([
        { id: A, posizione: 1, nomeFile: 'a.pdf', dimensioneByte: 9, createdAt: new Date(0) },
      ])
      const r = await service.elenco(T, K)
      const arg = tx.allegatoElencoAddebiti.findMany.mock.calls[0][0]
      expect(arg.where).toEqual({ elencoId: K, tenantId: T })
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
      tx.allegatoElencoAddebiti.findFirst.mockResolvedValue(null)
      await expect(service.contenuto(T, K, A)).rejects.toBeInstanceOf(NotFoundException)
      expect(tx.allegatoElencoAddebiti.findFirst.mock.calls[0][0].where).toEqual({
        id: A,
        elencoId: K,
        tenantId: T,
      })
    })

    it('restituisce nome e byte', async () => {
      tx.allegatoElencoAddebiti.findFirst.mockResolvedValue({
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
      expect(tx.allegatoElencoAddebiti.deleteMany).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()

      tx.allegatoElencoAddebiti.findFirst.mockResolvedValue({ posizione: 2 })
      await service.rimuovi(T, U, K, A)
      expect(tx.allegatoElencoAddebiti.deleteMany).toHaveBeenLastCalledWith({
        where: { id: A, elencoId: K, tenantId: T },
      })
      const a = tx.activityLog.create.mock.calls[0][0].data
      expect(a.action).toBe('ALLEGATO_ELENCO_ADDEBITI_RIMOSSO')
      expect(a.metadata).toEqual({ elencoId: K, posizione: 2 })
    })
  })
})
