import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { LoggerService } from '../../core/logger/logger.service';
import { Readable } from 'stream';

/**
 * S3 Storage Service
 *
 * Handles file uploads, downloads, and caching to AWS S3.
 * Used for:
 * - PDF document caching
 * - Company logos storage
 * - Backup files storage
 * - Attachment storage
 */
@Injectable()
export class S3Service {
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;

  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(S3Service.name);

    // Initialize S3 client
    this.region = process.env.AWS_REGION || 'eu-south-1';
    this.bucketName = process.env.AWS_S3_BUCKET || 'wasteflow-documents';

    this.s3Client = new S3Client({
      region: this.region,
      credentials: process.env.AWS_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          }
        : undefined, // Use IAM role if running on AWS
    });

    this.logger.info(`S3 Service initialized: bucket=${this.bucketName}, region=${this.region}`);
  }

  /**
   * Upload file to S3
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string, metadata?: Record<string, string>): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        Metadata: metadata,
      });

      await this.s3Client.send(command);

      const url = `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
      this.logger.info(`File uploaded to S3: ${key}`);

      return url;
    } catch (error) {
      this.logger.error(`Failed to upload file to S3: ${key}`, error);
      throw new Error(`S3 upload failed: ${error.message}`);
    }
  }

  /**
   * Download file from S3
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      // Convert stream to buffer
      const stream = response.Body as Readable;
      const chunks: Buffer[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      this.logger.error(`Failed to download file from S3: ${key}`, error);
      throw new Error(`S3 download failed: ${error.message}`);
    }
  }

  /**
   * Check if file exists in S3
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      this.logger.error(`Failed to check file existence in S3: ${key}`, error);
      throw new Error(`S3 head failed: ${error.message}`);
    }
  }

  /**
   * Delete file from S3
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);
      this.logger.info(`File deleted from S3: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${key}`, error);
      throw new Error(`S3 delete failed: ${error.message}`);
    }
  }

  /**
   * Generate S3 key for PDF caching
   */
  generatePdfKey(tenantId: string, documentType: 'fir' | 'mud', documentId: string): string {
    const timestamp = Date.now();
    return `pdfs/${tenantId}/${documentType}/${documentId}-${timestamp}.pdf`;
  }

  /**
   * Generate S3 key for attachments
   */
  generateAttachmentKey(tenantId: string, firId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `attachments/${tenantId}/${firId}/${timestamp}-${sanitizedFilename}`;
  }

  /**
   * Generate S3 key for company logos
   */
  generateLogoKey(tenantId: string, filename: string): string {
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    return `logos/${tenantId}/${timestamp}-${sanitizedFilename}`;
  }

  /**
   * Generate S3 key for backups
   */
  generateBackupKey(tenantId: string, backupType: 'full' | 'incremental', timestamp: number): string {
    return `backups/${tenantId}/${backupType}/${timestamp}.sql.gz`;
  }

  /**
   * Get file metadata from S3
   */
  async getFileMetadata(key: string): Promise<Record<string, string> | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      return response.Metadata || null;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      this.logger.error(`Failed to get file metadata from S3: ${key}`, error);
      throw new Error(`S3 metadata retrieval failed: ${error.message}`);
    }
  }

  /**
   * Upload PDF with caching metadata
   */
  async uploadPdfWithCache(
    key: string,
    pdfBuffer: Buffer,
    metadata: {
      tenantId: string;
      documentType: string;
      documentId: string;
      generatedAt: string;
    },
  ): Promise<string> {
    return this.uploadFile(key, pdfBuffer, 'application/pdf', metadata);
  }

  /**
   * Get cached PDF if exists and not expired
   */
  async getCachedPdf(key: string, maxAgeHours: number = 24): Promise<Buffer | null> {
    try {
      const metadata = await this.getFileMetadata(key);

      if (!metadata) {
        return null;
      }

      // Check if cache is expired
      const generatedAt = new Date(metadata.generatedAt || 0);
      const ageHours = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60);

      if (ageHours > maxAgeHours) {
        this.logger.debug(`Cached PDF expired: ${key} (age: ${ageHours.toFixed(2)}h)`);
        await this.deleteFile(key); // Clean up expired cache
        return null;
      }

      this.logger.debug(`Cached PDF hit: ${key} (age: ${ageHours.toFixed(2)}h)`);
      return await this.downloadFile(key);
    } catch (error) {
      this.logger.warn(`Failed to get cached PDF: ${key}`, error);
      return null;
    }
  }
}
