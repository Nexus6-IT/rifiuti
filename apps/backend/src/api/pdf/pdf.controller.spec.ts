import { BadRequestException, HttpException } from '@nestjs/common'
import { PdfController } from './pdf.controller'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'

/**
 * PdfController — QR ISO/IEC 18004 sul PDF del FIR.
 *
 * RENTRI prevede solo codici bidimensionali per la verifica (nessun barcode
 * 1D): il controller deve generare un vero QR PNG che punta all'URL pubblica
 * di verifica firme e passarlo al generatore PDF. Prima di questa modifica
 * `generateFIRPDF` veniva chiamato senza secondo argomento: il PDF non
 * conteneva mai il QR nonostante il generatore lo supportasse già.
 *
 * Il controller è istanziato direttamente con mock (stesso stile di
 * SignaturesController — evita il bootstrap di JwtAuthGuard/TestingModule,
 * irrilevante per verificare la logica del metodo).
 */
describe('PdfController — QR verifica su downloadFIR', () => {
  const TENANT_ID = 'tenant-1'
  const FIR_ID = '11111111-1111-4111-8111-111111111111'
  const VERIFICATION_URL = `https://rifiuti.ignicraft.com/verify/${FIR_ID}`

  let controller: PdfController
  let pdfService: { generateFIRPDF: jest.Mock; generateMUDPDF: jest.Mock }
  let prisma: { fIR: { findFirst: jest.Mock } }
  let mudGenerator: { generateMUDReport: jest.Mock }
  let verifySignaturesUseCase: { generateVerificationUrl: jest.Mock }
  let res: { set: jest.Mock; send: jest.Mock }

  const fakeFir = {
    id: FIR_ID,
    tenantId: TENANT_ID,
    firNumber: 'FIR-2026-000001',
    signatures: [],
  }

  beforeEach(() => {
    pdfService = {
      generateFIRPDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
      generateMUDPDF: jest.fn(),
    }
    prisma = { fIR: { findFirst: jest.fn().mockResolvedValue(fakeFir) } }
    mudGenerator = { generateMUDReport: jest.fn() }
    verifySignaturesUseCase = {
      generateVerificationUrl: jest.fn().mockReturnValue(VERIFICATION_URL),
    }
    res = { set: jest.fn(), send: jest.fn() }

    controller = new PdfController(
      pdfService as unknown as PDFService,
      prisma as unknown as PrismaService,
      mudGenerator as unknown as MUDGeneratorService,
      verifySignaturesUseCase as unknown as VerifySignaturesUseCase
    )
  })

  it('genera l’URL di verifica dal FIR caricato e la passa al generatore QR', async () => {
    await controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)

    expect(verifySignaturesUseCase.generateVerificationUrl).toHaveBeenCalledWith(FIR_ID)
  })

  it('passa a generateFIRPDF un vero QR PNG (data URL), non undefined', async () => {
    await controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)

    expect(pdfService.generateFIRPDF).toHaveBeenCalledTimes(1)
    const [firArg, qrArg] = pdfService.generateFIRPDF.mock.calls[0]
    expect(firArg).toBe(fakeFir)

    // Un vero QR ISO/IEC 18004: data URL PNG, non un URL nudo né un placeholder.
    expect(qrArg).toEqual(expect.stringMatching(/^data:image\/png;base64,/))

    // Il PNG deve essere decodificabile come QR e ricondurre esattamente
    // all'URL di verifica: se il controller incollasse per errore il firId
    // nudo, un hash sbagliato o un URL diverso, questa asserzione fallirebbe.
    const { PNG } = require('pngjs')
    const jsQR = require('jsqr')
    const png = PNG.sync.read(Buffer.from(qrArg.replace(/^data:image\/png;base64,/, ''), 'base64'))
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    expect(decoded?.data).toBe(VERIFICATION_URL)
  })

  it('risponde 404 se il FIR non appartiene al tenant (nessuna generazione QR/PDF)', async () => {
    prisma.fIR.findFirst.mockResolvedValue(null)

    await expect(
      controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)
    ).rejects.toBeInstanceOf(HttpException)

    expect(verifySignaturesUseCase.generateVerificationUrl).not.toHaveBeenCalled()
    expect(pdfService.generateFIRPDF).not.toHaveBeenCalled()
  })

  it('rifiuta la richiesta senza tenant nel token (400, non genera nulla)', async () => {
    await expect(
      controller.downloadFIR(FIR_ID, { user: {} } as any, res as any)
    ).rejects.toBeInstanceOf(BadRequestException)

    expect(prisma.fIR.findFirst).not.toHaveBeenCalled()
    expect(pdfService.generateFIRPDF).not.toHaveBeenCalled()
  })
})
