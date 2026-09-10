import { ForbiddenException, HttpException } from '@nestjs/common'
import { PNG } from 'pngjs'
import jsQR from 'jsqr'
import { PdfController } from './pdf.controller'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { codificaBase45 } from '../../infrastructure/rentri/qr/base45'

/**
 * PdfController — QR del formulario su downloadFIR.
 *
 * SOSTITUITO (non affiancato, v. `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`):
 * il vecchio QR ISO/IEC 18004 puntava alla nostra verifica firme via URL —
 * vietato dalla documentazione RENTRI per un QR di formulario, proprio
 * perché una copia potrebbe rimandare a un servizio di verifica non
 * ufficiale. Il QR corretto contiene i byte firmati dall'ente
 * (`fir.rentriQrCodeBytes`, Base64) ricodificati in Base45 e disegnati a
 * livello di correzione H — mai un URL.
 *
 * Se il FIR non è (ancora) vidimato (`rentriQrCodeBytes` nullo), il PDF
 * esce SENZA QR: decisione dichiarata nel controller — un QR "di ripiego"
 * (anche con una dicitura "copia non vidimata") resterebbe comunque un
 * codice leggibile che farebbe sembrare vidimato un documento che non lo è.
 *
 * Il controller è istanziato direttamente con mock (stesso stile di
 * SignaturesController — evita il bootstrap di JwtAuthGuard/TestingModule,
 * irrilevante per verificare la logica del metodo).
 */
describe('PdfController — QR del formulario su downloadFIR', () => {
  const TENANT_ID = 'tenant-1'
  const FIR_ID = '11111111-1111-4111-8111-111111111111'

  let controller: PdfController
  let pdfService: { generateFIRPDF: jest.Mock; generateMUDPDF: jest.Mock }
  let prisma: { fIR: { findFirst: jest.Mock } }
  let mudGenerator: { generateMUDReport: jest.Mock }
  let verifySignaturesUseCase: { generateVerificationUrl: jest.Mock }
  let res: { set: jest.Mock; send: jest.Mock }

  const firVidimato = {
    id: FIR_ID,
    tenantId: TENANT_ID,
    firNumber: 'FIR-2026-000001',
    signatures: [],
    rentriQrCodeBytes: Buffer.from('byte-firmati-di-prova-dall-ente').toString('base64'),
  }

  const firNonVidimato = {
    id: FIR_ID,
    tenantId: TENANT_ID,
    firNumber: 'FIR-2026-000002',
    signatures: [],
    rentriQrCodeBytes: null,
  }

  beforeEach(() => {
    pdfService = {
      generateFIRPDF: jest.fn().mockResolvedValue(Buffer.from('%PDF-fake')),
      generateMUDPDF: jest.fn(),
    }
    prisma = { fIR: { findFirst: jest.fn().mockResolvedValue(firVidimato) } }
    mudGenerator = { generateMUDReport: jest.fn() }
    verifySignaturesUseCase = {
      generateVerificationUrl: jest.fn().mockReturnValue('https://rifiuti.ignicraft.com/verify/x'),
    }
    res = { set: jest.fn(), send: jest.fn() }

    controller = new PdfController(
      pdfService as unknown as PDFService,
      prisma as unknown as PrismaService,
      mudGenerator as unknown as MUDGeneratorService,
      verifySignaturesUseCase as unknown as VerifySignaturesUseCase
    )
  })

  it('FIR vidimato: passa a generateFIRPDF un vero QR PNG con i byte dell’ente ricodificati Base45, non un URL', async () => {
    await controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)

    expect(pdfService.generateFIRPDF).toHaveBeenCalledTimes(1)
    const [firArg, qrArg] = pdfService.generateFIRPDF.mock.calls[0]
    expect(firArg).toBe(firVidimato)

    expect(qrArg).toEqual(expect.stringMatching(/^data:image\/png;base64,/))

    const png = PNG.sync.read(Buffer.from(qrArg.replace(/^data:image\/png;base64,/, ''), 'base64'))
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)

    // Il contenuto e' il Base45 dei byte dell'ente, MAI un URL: e' proprio
    // questo il vincolo che ha imposto la sostituzione del vecchio QR.
    expect(decoded?.data).toBe(codificaBase45(Buffer.from(firVidimato.rentriQrCodeBytes, 'base64')))
    expect(decoded?.data).not.toMatch(/^https?:\/\//)
  })

  it('il vecchio meccanismo (URL di verifica firme) non viene più usato per il QR', async () => {
    await controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)

    expect(verifySignaturesUseCase.generateVerificationUrl).not.toHaveBeenCalled()
  })

  it('FIR NON vidimato (rentriQrCodeBytes nullo): generateFIRPDF riceve undefined, MAI il vecchio QR con URL', async () => {
    prisma.fIR.findFirst.mockResolvedValue(firNonVidimato)

    await controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)

    expect(pdfService.generateFIRPDF).toHaveBeenCalledWith(firNonVidimato, undefined)
    expect(verifySignaturesUseCase.generateVerificationUrl).not.toHaveBeenCalled()
  })

  it('risponde 404 se il FIR non appartiene al tenant (nessuna generazione QR/PDF)', async () => {
    prisma.fIR.findFirst.mockResolvedValue(null)

    await expect(
      controller.downloadFIR(FIR_ID, { user: { tenantId: TENANT_ID } } as any, res as any)
    ).rejects.toBeInstanceOf(HttpException)

    expect(pdfService.generateFIRPDF).not.toHaveBeenCalled()
  })

  // 403 (non 400): la risoluzione dell'azienda attiva è centralizzata in
  // `requireRequestTenantId`, che è fail-closed e uniforme su tutti gli
  // endpoint — "nessuna azienda selezionata" è un problema di autorizzazione,
  // non una richiesta malformata.
  it('rifiuta la richiesta senza azienda attiva (403, non genera nulla)', async () => {
    await expect(
      controller.downloadFIR(FIR_ID, { user: {} } as any, res as any)
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(prisma.fIR.findFirst).not.toHaveBeenCalled()
    expect(pdfService.generateFIRPDF).not.toHaveBeenCalled()
  })
})
