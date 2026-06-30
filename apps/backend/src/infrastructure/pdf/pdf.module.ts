import { Module } from '@nestjs/common'
import { PDFService } from './pdf.service'
import { PdfController } from '../../api/pdf/pdf.controller'
import { PrismaModule } from '../database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { MUDModule } from '../../application/mud/mud.module'

/**
 * PDF Module
 *
 * Handles PDF generation for FIR and MUD reports.
 */
@Module({
  imports: [LoggerModule, PrismaModule, MUDModule],
  controllers: [PdfController],
  providers: [PDFService],
  exports: [PDFService],
})
export class PDFModule {}
