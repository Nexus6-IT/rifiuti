/**
 * PdfController (4.7, T7): modello di stampa su `GET /pdf/fir/:id?modelloId` e serie
 * `POST /pdf/fir/serie`, con pipe e filtro reali e servizi finti (validazione del corpo, 400/404,
 * ordine, esclusi, modulo).
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { ModelloStampaNonValidoError } from '../../infrastructure/pdf/definizione-fir'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PdfController } from './pdf.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const F3 = '33333333-3333-4333-8333-333333333333'
const M = '7e7e7e7e-0000-4000-8000-000000000004'

const modello = (extra: Record<string, unknown> = {}) => ({
  id: M,
  nome: 'FIR',
  ambito: 'FIR',
  copie: 2,
  testoIntestazione: 'Intestazione',
  testoPiePagina: 'Piede',
  colorePrimario: '#112233',
  coloreSecondario: '#445566',
  logoBase64: null,
  predefinito: true,
  versione: 1,
  ...extra,
})

describe('PdfController — modelli di stampa e serie di FIR (HTTP)', () => {
  let app: INestApplication
  let pdf: { generateFIRPDF: jest.Mock; generateFIRSeriePDF: jest.Mock }
  let prisma: { fIR: { findFirst: jest.Mock; findMany: jest.Mock } }
  let modelli: { list: jest.Mock; getById: jest.Mock }

  beforeEach(async () => {
    pdf = {
      generateFIRPDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-uno')),
      generateFIRSeriePDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-serie')),
    }
    prisma = {
      fIR: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: F1, firNumber: 'N1', rentriQrCodeBytes: null }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    modelli = { list: jest.fn().mockResolvedValue([]), getById: jest.fn() }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [PdfController],
      providers: [
        { provide: PDFService, useValue: pdf },
        { provide: PrismaService, useValue: prisma },
        { provide: MUDGeneratorService, useValue: {} },
        { provide: VerifySignaturesUseCase, useValue: {} },
        { provide: ModelliStampaService, useValue: modelli },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest()
          req.user = { id: 'u1', tenantId: 'altro-tenant-del-token', role: 'ADMIN' }
          req.tenantId = TENANT
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())

  describe('GET /pdf/fir/:id', () => {
    it('senza modelloId usa il predefinito FIR e lo passa al servizio (campi mappati)', async () => {
      modelli.list.mockResolvedValue([
        modello({ id: 'g', ambito: 'GENERALE', nome: 'G' }),
        modello(),
      ])
      const r = await http().get(`/pdf/fir/${F1}`)
      expect(r.status).toBe(200)
      expect(pdf.generateFIRPDF).toHaveBeenCalledWith(expect.anything(), undefined, {
        ambito: 'FIR',
        copie: 2,
        logoBase64: null,
        headerText: 'Intestazione',
        footerText: 'Piede',
        primaryColor: '#112233',
        secondaryColor: '#445566',
      })
      expect(modelli.list).toHaveBeenCalledWith(TENANT)
    })

    it('senza predefinito FIR ripiega sul predefinito GENERALE', async () => {
      modelli.list.mockResolvedValue([
        modello({ ambito: 'FIR', predefinito: false }),
        modello({ id: 'g', ambito: 'GENERALE', copie: 3 }),
      ])
      await http().get(`/pdf/fir/${F1}`)
      expect(pdf.generateFIRPDF.mock.calls[0][2]).toMatchObject({ ambito: 'GENERALE', copie: 3 })
    })

    it('senza alcun modello: PDF come prima (nessun terzo argomento)', async () => {
      await http().get(`/pdf/fir/${F1}`)
      expect(pdf.generateFIRPDF.mock.calls[0]).toHaveLength(2)
    })

    it('modelloId esplicito: letto per id nell’azienda selezionata', async () => {
      modelli.getById.mockResolvedValue(modello({ predefinito: false }))
      const r = await http().get(`/pdf/fir/${F1}?modelloId=${M}`)
      expect(r.status).toBe(200)
      expect(modelli.getById).toHaveBeenCalledWith(TENANT, M)
      expect(modelli.list).not.toHaveBeenCalled()
    })

    it('modelloId non UUID: 400 e niente PDF', async () => {
      const r = await http().get(`/pdf/fir/${F1}?modelloId=abc`)
      expect(r.status).toBe(400)
      expect(pdf.generateFIRPDF).not.toHaveBeenCalled()
    })

    it('modelloId della distinta: 400', async () => {
      modelli.getById.mockResolvedValue(modello({ ambito: 'DISTINTA_RITIRI' }))
      const r = await http().get(`/pdf/fir/${F1}?modelloId=${M}`)
      expect(r.status).toBe(400)
      expect(pdf.generateFIRPDF).not.toHaveBeenCalled()
    })

    it('modello salvato ma non stampabile (logo corrotto): 400, non 500', async () => {
      modelli.list.mockResolvedValue([modello()])
      pdf.generateFIRPDF.mockRejectedValue(new ModelloStampaNonValidoError('logo'))
      expect((await http().get(`/pdf/fir/${F1}`)).status).toBe(400)
    })
  })

  describe('POST /pdf/fir/serie', () => {
    const firTrovato = (id: string) => ({ id, firNumber: `N-${id[0]}`, rentriQrCodeBytes: null })

    it('un solo PDF, FIR nell’ordine richiesto (non in quello del database), filtro per azienda', async () => {
      prisma.fIR.findMany.mockResolvedValue([firTrovato(F1), firTrovato(F2), firTrovato(F3)])
      const r = await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F3, F1, F2] })
      expect(r.status).toBe(201)
      expect(r.headers['content-type']).toMatch(/application\/pdf/)
      expect(r.headers['x-fir-esclusi']).toBe('0')
      expect(prisma.fIR.findMany.mock.calls[0][0].where).toEqual({
        id: { in: [F3, F1, F2] },
        tenantId: TENANT,
      })
      const elementi = pdf.generateFIRSeriePDF.mock.calls[0][0]
      expect(elementi.map((e: any) => e.fir.id)).toEqual([F3, F1, F2])
    })

    it('FIR di altre aziende o inesistenti: esclusi, contati, nessun errore se ne resta qualcuno', async () => {
      prisma.fIR.findMany.mockResolvedValue([firTrovato(F2)])
      const r = await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F1, F2, F3] })
      expect(r.status).toBe(201)
      expect(r.headers['x-fir-esclusi']).toBe('2')
      expect(pdf.generateFIRSeriePDF.mock.calls[0][0]).toHaveLength(1)
    })

    it('nessun FIR dell’azienda: 404 e niente PDF', async () => {
      const r = await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F1] })
      expect(r.status).toBe(404)
      expect(pdf.generateFIRSeriePDF).not.toHaveBeenCalled()
    })

    it('modello: predefinito se assente, esplicito se presente', async () => {
      prisma.fIR.findMany.mockResolvedValue([firTrovato(F1)])
      modelli.list.mockResolvedValue([modello()])
      await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F1] })
      expect(pdf.generateFIRSeriePDF.mock.calls[0][1]).toMatchObject({ copie: 2 })
      modelli.getById.mockResolvedValue(modello({ copie: 4 }))
      await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F1], modelloId: M })
      expect(pdf.generateFIRSeriePDF.mock.calls[1][1]).toMatchObject({ copie: 4 })
    })

    it('QR solo per i FIR vidimati', async () => {
      prisma.fIR.findMany.mockResolvedValue([
        firTrovato(F1),
        { ...firTrovato(F2), rentriQrCodeBytes: Buffer.from('byte-ente').toString('base64') },
      ])
      await http()
        .post('/pdf/fir/serie')
        .send({ firIds: [F1, F2] })
      const [a, b] = pdf.generateFIRSeriePDF.mock.calls[0][0]
      expect(a.qrCodeDataUrl).toBeUndefined()
      expect(b.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/)
    })

    const array101 = Array.from(
      { length: 101 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    )
    it.each([
      ['senza firIds', {}],
      ['array vuoto', { firIds: [] }],
      ['oltre 100', { firIds: array101 }],
      ['id non UUID', { firIds: ['x'] }],
      ['id duplicati', { firIds: [F1, F1] }],
      ['modelloId non UUID', { firIds: [F1], modelloId: 'x' }],
      ['campo sconosciuto', { firIds: [F1], altro: 1 }],
    ])('400: %s', async (_nome, corpo) => {
      const r = await http().post('/pdf/fir/serie').send(corpo)
      expect(r.status).toBe(400)
      expect(prisma.fIR.findMany).not.toHaveBeenCalled()
    })

    it('esattamente 100 FIR: accettato', async () => {
      const ids = array101.slice(0, 100)
      prisma.fIR.findMany.mockResolvedValue([firTrovato(ids[0])])
      expect((await http().post('/pdf/fir/serie').send({ firIds: ids })).status).toBe(201)
    })
  })
})
