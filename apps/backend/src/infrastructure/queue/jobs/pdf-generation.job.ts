import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable } from '@nestjs/common';
import { PDFService } from '../../pdf/pdf.service';
import { S3Service } from '../../storage/s3.service';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../../core/logger/logger.service';

export interface PdfGenerationJobData {
  tenantId: string;
  documentType: 'fir' | 'mud';
  documentIds: string[];
  batchId?: string;
  requestedBy: string;
  options?: {
    includeAttachments?: boolean;
    useTemplate?: string;
  };
}

export interface PdfGenerationJobResult {
  success: boolean;
  generatedPdfs: Array<{
    documentId: string;
    s3Key: string;
    s3Url: string;
    size: number;
  }>;
  errors: Array<{
    documentId: string;
    error: string;
  }>;
  batchS3Key?: string;
  batchS3Url?: string;
}

/**
 * PDF Generation Job Processor
 *
 * Processes PDF generation requests asynchronously:
 * - Single document PDF generation
 * - Batch PDF generation (multiple documents)
 * - S3 caching for performance
 * - Attachment inclusion
 * - Custom template support
 */
@Injectable()
@Processor('pdf-generation', {
  concurrency: 3, // Process up to 3 PDFs simultaneously
  limiter: {
    max: 10, // Max 10 jobs per window
    duration: 60000, // 1 minute window
  },
})
export class PdfGenerationJobProcessor extends WorkerHost {
  constructor(
    private readonly pdfService: PDFService,
    private readonly s3Service: S3Service,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PdfGenerationJobProcessor.name);
  }

  async process(job: Job<PdfGenerationJobData>): Promise<PdfGenerationJobResult> {
    const { tenantId, documentType, documentIds, batchId, requestedBy, options } = job.data;

    this.logger.info(
      `Processing PDF generation job: ${job.id}, type=${documentType}, count=${documentIds.length}`,
    );

    const result: PdfGenerationJobResult = {
      success: true,
      generatedPdfs: [],
      errors: [],
    };

    // Process each document
    for (const documentId of documentIds) {
      try {
        await job.updateProgress(
          ((result.generatedPdfs.length + result.errors.length) / documentIds.length) * 100,
        );

        const pdfData = await this.generateDocumentPdf(
          tenantId,
          documentType,
          documentId,
          options,
        );

        result.generatedPdfs.push(pdfData);
      } catch (error) {
        this.logger.error(`Failed to generate PDF for ${documentId}`, error);
        result.errors.push({
          documentId,
          error: error.message,
        });
        result.success = false;
      }
    }

    // If batch mode, combine into single PDF
    if (documentIds.length > 1 && batchId) {
      try {
        const batchPdfData = await this.combinePdfsIntoBatch(
          tenantId,
          documentType,
          result.generatedPdfs,
          batchId,
        );

        result.batchS3Key = batchPdfData.s3Key;
        result.batchS3Url = batchPdfData.s3Url;
      } catch (error) {
        this.logger.error('Failed to combine PDFs into batch', error);
        result.success = false;
      }
    }

    this.logger.info(
      `PDF generation job completed: ${job.id}, success=${result.success}, generated=${result.generatedPdfs.length}, errors=${result.errors.length}`,
    );

    return result;
  }

  /**
   * Generate PDF for a single document
   */
  private async generateDocumentPdf(
    tenantId: string,
    documentType: 'fir' | 'mud',
    documentId: string,
    options?: PdfGenerationJobData['options'],
  ): Promise<PdfGenerationJobResult['generatedPdfs'][0]> {
    // Check S3 cache first
    const cacheKey = this.s3Service.generatePdfKey(tenantId, documentType, documentId);
    const cachedPdf = await this.s3Service.getCachedPdf(cacheKey, 24); // 24 hour cache

    if (cachedPdf) {
      this.logger.debug(`Using cached PDF for ${documentType}/${documentId}`);
      return {
        documentId,
        s3Key: cacheKey,
        s3Url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${cacheKey}`,
        size: cachedPdf.length,
      };
    }

    // Generate new PDF
    let pdfBuffer: Buffer;

    if (documentType === 'fir') {
      const fir = await this.prisma.fIR.findUnique({
        where: { id: documentId },
        include: {
          producerUser: true,
          carrierUser: true,
          receiverUser: true,
          signatures: true,
          tenant: true,
        },
      });

      if (!fir) {
        throw new Error(`FIR not found: ${documentId}`);
      }

      pdfBuffer = await this.pdfService.generateFIRPDF(fir);
    } else if (documentType === 'mud') {
      const mudReport = await this.prisma.mUDReport.findUnique({
        where: { id: documentId },
        include: {
          tenant: true,
        },
      });

      if (!mudReport) {
        throw new Error(`MUD Report not found: ${documentId}`);
      }

      pdfBuffer = await this.pdfService.generateMUDPDF(mudReport);
    } else {
      throw new Error(`Unknown document type: ${documentType}`);
    }

    // Upload to S3 with caching metadata
    const s3Url = await this.s3Service.uploadPdfWithCache(cacheKey, pdfBuffer, {
      tenantId,
      documentType,
      documentId,
      generatedAt: new Date().toISOString(),
    });

    return {
      documentId,
      s3Key: cacheKey,
      s3Url,
      size: pdfBuffer.length,
    };
  }

  /**
   * Combine multiple PDFs into a single batch PDF
   */
  private async combinePdfsIntoBatch(
    tenantId: string,
    documentType: string,
    pdfs: PdfGenerationJobResult['generatedPdfs'],
    batchId: string,
  ): Promise<{ s3Key: string; s3Url: string }> {
    // Download all individual PDFs
    const pdfBuffers = await Promise.all(
      pdfs.map((pdf) => this.s3Service.downloadFile(pdf.s3Key)),
    );

    // For now, we concatenate PDFs (in production, use a library like pdf-lib to properly merge)
    // TODO: Implement proper PDF merging with pdf-lib
    const combinedBuffer = Buffer.concat(pdfBuffers);

    // Upload batch PDF
    const batchKey = `pdfs/${tenantId}/batches/${batchId}-${Date.now()}.pdf`;
    const batchUrl = await this.s3Service.uploadFile(batchKey, combinedBuffer, 'application/pdf', {
      tenantId,
      batchId,
      documentType,
      documentCount: pdfs.length.toString(),
      generatedAt: new Date().toISOString(),
    });

    return {
      s3Key: batchKey,
      s3Url: batchUrl,
    };
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job<PdfGenerationJobData>, result: PdfGenerationJobResult) {
    this.logger.info(
      `PDF generation job ${job.id} completed: ${result.generatedPdfs.length} PDFs generated`,
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<PdfGenerationJobData>, error: Error) {
    this.logger.error(`PDF generation job ${job.id} failed`, error);
  }

  @OnWorkerEvent('active')
  onActive(job: Job<PdfGenerationJobData>) {
    this.logger.debug(
      `PDF generation job ${job.id} started: ${job.data.documentIds.length} documents`,
    );
  }
}
