import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../core/logger/logger.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { firstValueFrom } from 'rxjs';

/**
 * RENTRI API Client
 *
 * Handles HTTP communication with RENTRI government API.
 * Converts internal FIR format to xFIR (RENTRI standard format).
 *
 * xFIR Format Specification:
 * - Based on Italian D.M. 59/2023 regulation
 * - JSON format with specific field naming (Italian)
 * - Digital signatures included
 * - Timestamps in ISO 8601 format
 */
@Injectable()
export class RENTRIApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeout: number = 30000; // 30 seconds

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {
    this.baseUrl = this.configService.get<string>('RENTRI_API_URL') || 'http://localhost:3001';
    this.apiKey = this.configService.get<string>('RENTRI_API_KEY') || 'demo-key';
    this.logger.setContext('RENTRIApiClient');
  }

  /**
   * Submit FIR to RENTRI
   */
  async submitFIR(fir: any): Promise<RENTRISubmitResponse> {
    const startTime = Date.now();

    try {
      // Convert to xFIR format
      const xFIR = this.convertToXFIRFormat(fir);

      this.logger.info('Submitting FIR to RENTRI', {
        firId: fir.id,
        firNumber: fir.firNumber,
      });

      // Make API call
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/v1/fir/submit`, xFIR, {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }),
      );

      const duration = Date.now() - startTime;

      // Record metrics
      this.metrics.rentriApiRequestDuration.observe(
        { endpoint: '/fir/submit', status: 'success' },
        duration / 1000,
      );

      this.logger.info('FIR submitted to RENTRI successfully', {
        firId: fir.id,
        rentriId: response.data.rentriId,
        protocolNumber: response.data.protocolNumber,
        duration,
      });

      return {
        success: true,
        protocolNumber: response.data.protocolNumber,
        rentriId: response.data.rentriId,
        receivedAt: response.data.receivedAt,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      // Handle RENTRI validation errors
      if (error.response?.status === 400) {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'VALIDATION_ERROR',
        });

        this.logger.warn('RENTRI validation error', {
          firId: fir.id,
          errors: error.response.data.errors,
        });

        return {
          success: false,
          errors: error.response.data.errors || [],
        };
      }

      // Handle service unavailable
      if (error.response?.status === 503) {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'SERVICE_UNAVAILABLE',
        });

        const retryAfter = error.response.data.retryAfter || 300;

        this.logger.error('RENTRI service unavailable', error, {
          firId: fir.id,
          retryAfter,
        });

        throw new Error(`RENTRI service temporarily unavailable. Retry after ${retryAfter}s`);
      }

      // Handle timeout
      if (error.code === 'ECONNABORTED') {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'TIMEOUT',
        });

        this.logger.error('RENTRI API timeout', error, {
          firId: fir.id,
          timeout: this.timeout,
        });

        throw new Error('RENTRI API timeout');
      }

      // Generic error
      this.metrics.rentriApiErrors.inc({
        endpoint: '/fir/submit',
        error_type: 'UNKNOWN',
      });

      this.logger.error('RENTRI API error', error, {
        firId: fir.id,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Validate FIR before submission
   */
  async validateFIR(fir: any): Promise<RENTRIValidationResponse> {
    try {
      const xFIR = this.convertToXFIRFormat(fir);

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/api/v1/fir/validate`, xFIR, {
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          timeout: this.timeout,
        }),
      );

      return {
        valid: response.data.valid,
        errors: response.data.errors || [],
        warnings: response.data.warnings || [],
      };
    } catch (error: any) {
      this.logger.error('RENTRI validation error', error, { firId: fir.id });
      throw error;
    }
  }

  /**
   * Get FIR status from RENTRI
   */
  async getFIRStatus(firId: string): Promise<RENTRIFIRStatus> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.baseUrl}/api/v1/fir/${firId}`, {
          headers: {
            'X-API-Key': this.apiKey,
          },
          timeout: this.timeout,
        }),
      );

      return response.data.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('FIR non trovato in RENTRI');
      }
      throw error;
    }
  }

  /**
   * Convert internal FIR format to xFIR (RENTRI standard)
   */
  private convertToXFIRFormat(fir: any): any {
    return {
      firId: fir.id,
      numeroFormulario: fir.firNumber,
      dataEmissione: new Date().toISOString(),

      // Producer (Produttore)
      produttore: {
        partitaIva: fir.producerPartitaIva,
        ragioneSociale: fir.producerName,
        indirizzo: fir.producerAddress,
        contatto: fir.producerContact,
      },

      // Carrier (Trasportatore)
      trasportatore: {
        partitaIva: fir.carrierPartitaIva,
        ragioneSociale: fir.carrierName,
        targaVeicolo: fir.carrierVehiclePlate,
        contatto: fir.carrierContact,
      },

      // Receiver (Destinatario)
      destinatario: {
        partitaIva: fir.receiverPartitaIva,
        ragioneSociale: fir.receiverName,
        indirizzo: fir.receiverAddress,
        contatto: fir.receiverContact,
      },

      // Waste (Rifiuto)
      rifiuto: {
        codiceEER: fir.cerCode,
        descrizione: fir.wasteDescription,
        categoria: fir.wasteCategory,
        quantita: fir.quantity,
        unita: fir.unit,
      },

      // Transport (Trasporto)
      trasporto: {
        dataPartenza: fir.transportDate.toISOString(),
        dataArrivoPrevista: fir.estimatedArrivalDate?.toISOString(),
        note: fir.transportNotes,
      },

      // Digital signatures (Firme Digitali)
      firmeDigitali: this.convertSignatures(fir.signatures || []),
    };
  }

  /**
   * Convert signatures to xFIR format
   */
  private convertSignatures(signatures: any[]): any[] {
    return signatures.map(sig => ({
      ruolo: sig.role,
      dataFirma: sig.signedAt.toISOString(),
      metodo: sig.signatureMethod,
      valoreSignatura: sig.signatureValue,
      hashCertificato: sig.certificateHash,
      hashDocumento: sig.documentHash,
      timestampToken: sig.timestampToken,
    }));
  }
}

/**
 * RENTRI API Response Types
 */
export interface RENTRISubmitResponse {
  success: boolean;
  protocolNumber?: string;
  rentriId?: string;
  receivedAt?: string;
  errors?: Array<{ code: string; field: string; message: string }>;
}

export interface RENTRIValidationResponse {
  valid: boolean;
  errors: Array<{ code: string; field: string; message: string }>;
  warnings: string[];
}

export interface RENTRIFIRStatus {
  firId: string;
  rentriId: string;
  protocolNumber: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PROCESSING';
  submittedAt: string;
}
