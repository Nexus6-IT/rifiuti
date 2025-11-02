import { Injectable, inject } from '@angular/core';
import { Observable, from } from 'rxjs';
import { LoggerService } from './logger.service';

/**
 * QR Code Generator Service
 *
 * Generates QR codes for FIR signature verification URLs.
 * Used in PDF exports to embed public verification links.
 *
 * Uses qrcode library for QR code generation.
 */
@Injectable({
  providedIn: 'root',
})
export class QRCodeService {
  private readonly logger = inject(LoggerService);

  constructor() {
    this.logger.setContext(QRCodeService.name);
  }

  /**
   * Generate QR code as data URL
   *
   * Creates QR code image containing verification URL.
   * Returns base64-encoded PNG image.
   *
   * @param url - URL to encode in QR code
   * @param options - QR code options
   * @returns Data URL of QR code image
   */
  generateQRCode(
    url: string,
    options?: QRCodeOptions,
  ): Observable<string> {
    this.logger.debug(`Generating QR code for URL: ${url}`);

    const defaultOptions: QRCodeGenerationOptions = {
      width: options?.width || 300,
      margin: options?.margin || 4,
      color: {
        dark: options?.darkColor || '#000000',
        light: options?.lightColor || '#FFFFFF',
      },
      errorCorrectionLevel: options?.errorCorrectionLevel || 'M',
    };

    return from(this.generateQRCodeInternal(url, defaultOptions));
  }

  /**
   * Generate QR code for FIR verification
   *
   * Creates QR code with verification URL and Italian text.
   *
   * @param firId - FIR identifier
   * @param verificationUrl - Public verification URL
   * @returns Data URL of QR code image
   */
  generateVerificationQRCode(
    firId: string,
    verificationUrl: string,
  ): Observable<string> {
    this.logger.info(`Generating verification QR code for FIR ${firId}`);

    return this.generateQRCode(verificationUrl, {
      width: 300,
      margin: 4,
      errorCorrectionLevel: 'H', // High error correction for printed documents
    });
  }

  /**
   * Generate QR code with logo
   *
   * Embeds logo in center of QR code.
   * Used for branded verification QR codes.
   *
   * @param url - URL to encode
   * @param logoUrl - Logo image URL
   * @param options - QR code options
   * @returns Data URL of QR code image with logo
   */
  async generateQRCodeWithLogo(
    url: string,
    logoUrl: string,
    options?: QRCodeOptions,
  ): Promise<string> {
    this.logger.debug(`Generating QR code with logo for URL: ${url}`);

    // Generate base QR code
    const qrDataUrl = await this.generateQRCodeInternal(url, {
      width: options?.width || 300,
      margin: options?.margin || 4,
      color: {
        dark: options?.darkColor || '#000000',
        light: options?.lightColor || '#FFFFFF',
      },
      errorCorrectionLevel: 'H', // High error correction required for logo overlay
    });

    // Create canvas to composite QR code and logo
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      this.logger.error('Failed to get canvas context');
      return qrDataUrl; // Fallback to QR code without logo
    }

    const width = options?.width || 300;
    canvas.width = width;
    canvas.height = width;

    try {
      // Load QR code image
      const qrImage = await this.loadImage(qrDataUrl);
      ctx.drawImage(qrImage, 0, 0, width, width);

      // Load and draw logo in center
      const logoImage = await this.loadImage(logoUrl);
      const logoSize = width * 0.2; // Logo is 20% of QR code size
      const logoX = (width - logoSize) / 2;
      const logoY = (width - logoSize) / 2;

      // Draw white background for logo
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(logoX - 5, logoY - 5, logoSize + 10, logoSize + 10);

      // Draw logo
      ctx.drawImage(logoImage, logoX, logoY, logoSize, logoSize);

      return canvas.toDataURL('image/png');
    } catch (error) {
      this.logger.error('Failed to add logo to QR code', error);
      return qrDataUrl; // Fallback to QR code without logo
    }
  }

  /**
   * Internal QR code generation
   *
   * Uses qrcode library to generate QR code.
   * In production, install: npm install qrcode @types/qrcode
   */
  private async generateQRCodeInternal(
    url: string,
    options: QRCodeGenerationOptions,
  ): Promise<string> {
    try {
      // Placeholder implementation
      // In production, use qrcode library:
      // import QRCode from 'qrcode';
      // return await QRCode.toDataURL(url, options);

      // Mock implementation for development
      this.logger.warn('Using mock QR code generation - install qrcode library for production');

      return this.generateMockQRCode(url, options);
    } catch (error) {
      this.logger.error('QR code generation failed', error);
      throw new Error(`Failed to generate QR code: ${error}`);
    }
  }

  /**
   * Generate mock QR code (development only)
   */
  private generateMockQRCode(
    url: string,
    options: QRCodeGenerationOptions,
  ): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return '';
    }

    const width = options.width;
    canvas.width = width;
    canvas.height = width;

    // Draw mock QR code pattern
    ctx.fillStyle = options.color.light;
    ctx.fillRect(0, 0, width, width);

    ctx.fillStyle = options.color.dark;
    const cellSize = width / 25;

    // Draw random pattern (not a real QR code)
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 25; j++) {
        if (Math.random() > 0.5) {
          ctx.fillRect(i * cellSize, j * cellSize, cellSize, cellSize);
        }
      }
    }

    // Draw "QR" text in center
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(width / 4, width / 4, width / 2, width / 2);
    ctx.fillStyle = '#000000';
    ctx.font = `${width / 10}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR', width / 2, width / 2);

    return canvas.toDataURL('image/png');
  }

  /**
   * Load image from URL
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Validate URL for QR code generation
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * QR Code Options
 */
export interface QRCodeOptions {
  width?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Internal QR Code Generation Options
 */
interface QRCodeGenerationOptions {
  width: number;
  margin: number;
  color: {
    dark: string;
    light: string;
  };
  errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H';
}
