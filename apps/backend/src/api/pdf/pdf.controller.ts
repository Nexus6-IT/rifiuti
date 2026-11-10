import {
  Controller,
  Body,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger'
import { Response } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { MUDGeneratorService } from '../../application/mud/mud-generator.service'
import { VerifySignaturesUseCase } from '../../application/signatures/verify-signatures.use-case'
import { generaQrVidimazione } from '../../infrastructure/rentri/qr/qr-vidimazione'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'
import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import {
  ModelloStampaNonValidoError,
  type ModelloStampaFir,
} from '../../infrastructure/pdf/definizione-fir'
import { FirSerieDto } from './dto/fir-serie.dto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INCLUDE_FIR = {
  producerUser: true,
  carrierUser: true,
  receiverUser: true,
  signatures: true,
  tenant: true,
} as const

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
    private readonly verifySignaturesUseCase: VerifySignaturesUseCase,
    private readonly modelliStampa: ModelliStampaService
  ) {}

  /**
   * Modello di stampa del FIR. Con `modelloId` esplicito: 400 se non e' un UUID o ha ambito
   * DISTINTA_RITIRI, 404 se non e' dell'azienda (RLS + filtro). Senza: il predefinito
   * dell'ambito FIR, poi quello GENERALE, altrimenti nessun modello (PDF come prima).
   */
  private async modelloPerFir(
    tenantId: string,
    modelloId: string | undefined
  ): Promise<ModelloStampaFir | null> {
    let scelto
    if (modelloId !== undefined) {
      if (!UUID.test(modelloId)) {
        throw new BadRequestException({
          message: 'modelloId non valido',
          error: 'MODELLO_STAMPA_NON_VALIDO',
        })
      }
      scelto = await this.modelliStampa.getById(tenantId, modelloId)
      if (scelto.ambito === 'DISTINTA_RITIRI') {
        throw new BadRequestException({
          message: 'Il modello della distinta dei ritiri non si usa per il FIR',
          error: 'MODELLO_STAMPA_AMBITO_NON_VALIDO',
        })
      }
    } else {
      const tutti = await this.modelliStampa.list(tenantId)
      scelto =
        tutti.find(m => m.predefinito && m.ambito === 'FIR') ??
        tutti.find(m => m.predefinito && m.ambito === 'GENERALE')
    }
    if (!scelto) return null
    return {
      ambito: scelto.ambito,
      copie: scelto.copie,
      logoBase64: scelto.logoBase64,
      headerText: scelto.testoIntestazione,
      footerText: scelto.testoPiePagina,
      primaryColor: scelto.colorePrimario,
      secondaryColor: scelto.coloreSecondario,
    }
  }

  /** Un modello salvato ma non stampabile (es. logo corrotto) e' un 400, non un 500. */
  private async rendi<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof ModelloStampaNonValidoError) {
        throw new BadRequestException({ message: e.message, error: 'MODELLO_STAMPA_NON_VALIDO' })
      }
      throw e
    }
  }

  private async qrDelFir(fir: { rentriQrCodeBytes?: string | null }): Promise<string | undefined> {
    return fir.rentriQrCodeBytes ? await generaQrVidimazione(fir.rentriQrCodeBytes) : undefined
  }

  @Get('fir/:id')
  @ApiOperation({ summary: 'Download FIR as PDF' })
  @ApiParam({ name: 'id', type: String, description: 'FIR ID' })
  @ApiQuery({ name: 'modelloId', required: false, description: 'Modello di stampa (UUID)' })
  @RichiedeModulo('fir')
  async downloadFIR(
    @Param('id') id: string,
    @Req() req: any,
    @Res() res: Response,
    @Query('modelloId') modelloId?: string
  ) {
    // Il tenant DEVE essere quello dell'utente autenticato: senza questo vincolo
    // qualsiasi utente scaricherebbe il FIR di qualsiasi tenant conoscendone l'id.
    const tenantId = requireRequestTenantId(req)
    if (!tenantId) {
      throw new BadRequestException('Tenant non disponibile per l’utente corrente')
    }

    const fir = await this.prisma.fIR.findFirst({
      where: { id, tenantId },
      include: INCLUDE_FIR,
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
    const qrCodeDataUrl = await this.qrDelFir(fir)

    const modello = await this.modelloPerFir(tenantId, modelloId)
    const pdfBuffer = await this.rendi(() =>
      modello
        ? this.pdfService.generateFIRPDF(fir, qrCodeDataUrl, modello)
        : this.pdfService.generateFIRPDF(fir, qrCodeDataUrl)
    )

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="FIR-${fir.firNumber}.pdf"`,
      'Content-Length': pdfBuffer.length,
    })

    res.send(pdfBuffer)
  }

  /**
   * Un solo PDF per piu' FIR, nell'ordine di `firIds`. I FIR che non sono dell'azienda (o non
   * esistono) sono esclusi senza distinguere i due casi (niente oracolo sugli id altrui): il loro
   * numero e' nell'header `X-Fir-Esclusi`. Se non ne resta nessuno: 404.
   */
  @Post('fir/serie')
  @ApiOperation({ summary: 'PDF unico di piu’ FIR (massimo 100), con il modello di stampa' })
  @RichiedeModulo('fir')
  async downloadFIRSerie(@Body() dto: FirSerieDto, @Req() req: any, @Res() res: Response) {
    const tenantId = requireRequestTenantId(req)
    if (!tenantId) {
      throw new BadRequestException('Tenant non disponibile per l’utente corrente')
    }

    const trovati = await this.prisma.fIR.findMany({
      where: { id: { in: dto.firIds }, tenantId },
      include: INCLUDE_FIR,
    })
    const perId = new Map(trovati.map(f => [f.id, f]))
    const ordinati = dto.firIds.flatMap(id => perId.get(id) ?? [])
    if (ordinati.length === 0) {
      throw new HttpException('FIR not found', HttpStatus.NOT_FOUND)
    }

    const elementi = await Promise.all(
      ordinati.map(async fir => ({ fir, qrCodeDataUrl: await this.qrDelFir(fir) }))
    )
    const modello = await this.modelloPerFir(tenantId, dto.modelloId)
    const pdfBuffer = await this.rendi(() => this.pdfService.generateFIRSeriePDF(elementi, modello))

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="FIR-serie.pdf"',
      'Content-Length': pdfBuffer.length,
      'X-Fir-Esclusi': String(dto.firIds.length - ordinati.length),
    })
    res.send(pdfBuffer)
  }

  @Get('mud/:year')
  @ApiOperation({ summary: 'Download MUD report as PDF' })
  @ApiParam({ name: 'year', type: Number, description: 'Report year' })
  @RichiedeModulo('mud')
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
