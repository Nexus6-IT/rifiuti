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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { generaQrVidimazione } from '../../infrastructure/rentri/qr/qr-vidimazione'
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

    // QR del formulario: SOSTITUITO (non affiancato) al precedente QR verso
    // la nostra verifica firme. La documentazione RENTRI vieta di includere
    // qualunque URL nel QR di un formulario, proprio per impedire che una
    // copia rimandi a un servizio di verifica non ufficiale — v.
    // `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`. Il contenuto
    // corretto è quello restituito dall'ente alla vidimazione
    // (`fir.rentriQrCodeBytes`, Base64), ricodificato in Base45 e disegnato
    // a livello di correzione H da `generaQrVidimazione`.
    //
    // **Decisione dichiarata**: se il FIR non è (ancora) vidimato dall'ente
    // (`rentriQrCodeBytes` nullo — nessun flusso di questo programma lo
    // valorizza ancora, v. l'audit), il PDF esce SENZA QR, non con un QR
    // "di ripiego". Un QR con una dicitura testuale tipo "copia non
    // vidimata" resterebbe comunque un codice bidimensionale stampato su un
    // formulario, leggibile da chi non legge la dicitura accanto: il rischio
    // che una copia non vidimata *sembri* vidimata (l'esatto problema che
    // questa modifica corregge) è più alto del beneficio di un QR "parlante".
    // L'assenza di QR è un segnale univoco, verificabile a colpo d'occhio.
    const qrCodeDataUrl = fir.rentriQrCodeBytes
      ? await generaQrVidimazione(fir.rentriQrCodeBytes)
      : undefined

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
