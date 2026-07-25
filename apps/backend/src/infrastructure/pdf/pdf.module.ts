import { Module } from '@nestjs/common'
import { PDFService } from './pdf.service'
import { PdfController } from '../../api/pdf/pdf.controller'
import { PrismaModule } from '../database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { MUDModule } from '../../application/mud/mud.module'
import { SignaturesModule } from '../../application/signatures/signatures.module'

/**
 * PDF Module
 *
 * Handles PDF generation for FIR and MUD reports.
 *
 * SignaturesModule è importato per `VerifySignaturesUseCase.generateVerificationUrl`:
 * il PDF del FIR deve incorporare un QR ISO/IEC 18004 che punti all'URL pubblica
 * di verifica firme (stessa URL restituita da `GET /fir/:id/verify-url`), non un
 * valore inventato dal controller PDF (unica fonte di verità).
 */
@Module({
  imports: [LoggerModule, PrismaModule, MUDModule, SignaturesModule],
  controllers: [PdfController],
  providers: [PDFService],
  exports: [PDFService],
})
export class PDFModule {}
