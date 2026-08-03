import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger'
import { Response } from 'express'
import * as QRCode from 'qrcode'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'

/**
 * PDF Controller
 *
 * Handles PDF export for FIR documents and MUD reports.
 */
@Controller('pdf')
@UseGuards(JwtAuthGuard)
@ApiTags('PDF Export')
@ApiBearerAuth()
export class PdfController {
  constructor(
    private readonly pdfService: PDFService,
    private readonly prisma: PrismaService,
    private readonly mudGenerator: MUDGeneratorService,
    private readonly verifySignaturesUseCase: VerifySignaturesUseCase
  ) {}

  @Get('fir/:id')
  @ApiOperation({ summary: 'Download FIR as PDF' })
  @ApiParam({ name: 'id', type: String, description: 'FIR ID' })
  async downloadFIR(@Param('id') id: string, @Req() req: any, @Res() res: Response) {
    // Il tenant DEVE essere quello dell'utente autenticato: senza questo vincolo
    // qualsiasi utente scaricherebbe il FIR di qualsiasi tenant conoscendone l'id.
    const tenantId = requireRequestTenantId(req)
    if (!tenantId) {
      throw new BadRequestException('Tenant non disponibile per l’utente corrente')
    }

    const fir = await this.prisma.fIR.findFirst({
      where: { id, tenantId },
      include: {
        producerUser: true,
        carrierUser: true,
        receiverUser: true,
        signatures: true,
        tenant: true,
      },
    })

    // FIR di un altro tenant → 404 e non 403: un 403 confermerebbe che l'id esiste.
    if (!fir) {
      throw new HttpException('FIR not found', HttpStatus.NOT_FOUND)
    }

    // QR ISO/IEC 18004 verso la verifica pubblica firme: RENTRI prevede solo
    // codici bidimensionali (nessun barcode 1D). L'URL è la stessa generata
    // per GET /fir/:id/verify-url — unica fonte di verità, non un valore
    // ricostruito qui a mano.
    const verificationUrl = this.verifySignaturesUseCase.generateVerificationUrl(fir.id)
    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
    })

    const pdfBuffer = await this.pdfService.generateFIRPDF(fir, qrCodeDataUrl)

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="FIR-${fir.firNumber}.pdf"`,
      'Content-Length': pdfBuffer.length,
    })

    res.send(pdfBuffer)
  }

  @Get('mud/:year')
  @ApiOperation({ summary: 'Download MUD report as PDF' })
  @ApiParam({ name: 'year', type: Number, description: 'Report year' })
  async downloadMUD(@Param('year') year: string, @Req() req: any, @Res() res: Response) {
    const reportYear = parseInt(year, 10)

    // Valida l'anno: deve essere numerico e in un intervallo plausibile.
    const currentYear = new Date().getFullYear()
    if (!/^\d+$/.test(year) || Number.isNaN(reportYear)) {
      throw new BadRequestException('Anno non valido')
    }
    if (reportYear < 2000 || reportYear > currentYear + 1) {
      throw new BadRequestException(`Anno fuori intervallo consentito (2000-${currentYear + 1})`)
    }

    // Usa il tenant reale dell'utente autenticato (mai un placeholder).
    const tenantId = requireRequestTenantId(req)
    if (!tenantId) {
      throw new BadRequestException('Tenant non disponibile per l’utente corrente')
    }

    // Generate MUD report data
    const mudReport = await this.mudGenerator.generateMUDReport(tenantId, reportYear)

    // Generate PDF
    const pdfBuffer = await this.pdfService.generateMUDPDF(mudReport)

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MUD-${reportYear}.pdf"`,
      'Content-Length': pdfBuffer.length,
    })

    res.send(pdfBuffer)
  }
}
