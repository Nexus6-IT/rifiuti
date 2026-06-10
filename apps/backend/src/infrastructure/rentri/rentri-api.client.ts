import { Injectable, Inject } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { LoggerService } from '../../core/logger/logger.service';
import { MetricsService } from '../../core/metrics/metrics.service';
import { firstValueFrom } from 'rxjs';
import { RentriConfig, RENTRI_CONFIG } from './rentri-config';
import { RentriAuthService } from './rentri-auth.service';
import { RentriSignatureService } from './rentri-signature.service';

/**
 * RENTRI API Client
 *
 * Comunica con l'API RENTRI in due modalità (vedi {@link RentriConfig}):
 * - `mock` → mock locale (`tools/rentri-mock`), autenticazione con X-API-Key.
 * - `live` → ambiente reale RENTRI (demo/prod) con autenticazione del Modello
 *   di Interoperabilità AgID: access token Bearer (vedi {@link RentriAuthService})
 *   e firma di integrità `Agid-JWT-Signature` su ogni richiesta con body
 *   (vedi {@link RentriSignatureService}).
 *
 * Formato dati: xFIR secondo le specifiche tecniche D.M. 59/2023.
 *
 * NB sui path del servizio `formulari`: la specifica OpenAPI ufficiale è
 * pubblicata su https://api.rentri.gov.it/docs/formulari/v1.0 (demo:
 * https://demoapi.rentri.gov.it). I path qui sotto seguono la convenzione del
 * servizio (`/formulari/v1.0/...`, cfr. `/dati-registri/v1.0`) e sono isolati
 * in costanti: vanno confermati/aggiustati sull'OpenAPI prima del go-live.
 */
@Injectable()
export class RENTRIApiClient {
  private readonly timeout = 30000; // 30s

  // Path del servizio formulari — DA CONFERMARE sull'OpenAPI ufficiale.
  private static readonly FORMULARI_BASE = '/formulari/v1.0';
  private static readonly PATH_SUBMIT = `${RENTRIApiClient.FORMULARI_BASE}/formulari`;
  private static readonly PATH_VALIDATE = `${RENTRIApiClient.FORMULARI_BASE}/formulari/validazione`;
  private static readonly PATH_STATUS = (id: string) =>
    `${RENTRIApiClient.FORMULARI_BASE}/formulari/${id}`;

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    @Inject(RENTRI_CONFIG) private readonly config: RentriConfig,
    private readonly auth: RentriAuthService,
    private readonly signature: RentriSignatureService,
  ) {
    this.logger.setContext('RENTRIApiClient');
  }

  private get isLive(): boolean {
    return this.config.mode === 'live';
  }

  /**
   * Submit FIR to RENTRI
   */
  async submitFIR(fir: any): Promise<RENTRISubmitResponse> {
    const startTime = Date.now();
    const xFIR = this.convertToXFIRFormat(fir);
    const path = this.isLive ? RENTRIApiClient.PATH_SUBMIT : '/api/v1/fir/submit';

    try {
      this.logger.info('Submitting FIR to RENTRI', {
        firId: fir.id,
        firNumber: fir.firNumber,
        mode: this.config.mode,
      });

      const response = await this.post(path, xFIR, '/fir/submit');
      const duration = Date.now() - startTime;

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

      // Expired/invalid token → invalidate cache so the next attempt re-auths
      if (error.response?.status === 401) {
        this.auth.invalidate();
      }

      // Handle service unavailable
      if (error.response?.status === 503) {
        this.metrics.rentriApiErrors.inc({
          endpoint: '/fir/submit',
          error_type: 'SERVICE_UNAVAILABLE',
        });

        const retryAfter = error.response.data?.retryAfter || 300;

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
    const xFIR = this.convertToXFIRFormat(fir);
    const path = this.isLive ? RENTRIApiClient.PATH_VALIDATE : '/api/v1/fir/validate';

    try {
      const response = await this.post(path, xFIR, '/fir/validate');

      return {
        valid: response.data.valid,
        errors: response.data.errors || [],
        warnings: response.data.warnings || [],
      };
    } catch (error: any) {
      if (error.response?.status === 401) {
        this.auth.invalidate();
      }
      this.logger.error('RENTRI validation error', error, { firId: fir.id });
      throw error;
    }
  }

  /**
   * Get FIR status from RENTRI
   */
  async getFIRStatus(firId: string): Promise<RENTRIFIRStatus> {
    const path = this.isLive
      ? RENTRIApiClient.PATH_STATUS(firId)
      : `/api/v1/fir/${firId}`;

    try {
      const response = await this.get(path);
      return response.data.data ?? response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('FIR non trovato in RENTRI');
      }
      if (error.response?.status === 401) {
        this.auth.invalidate();
      }
      throw error;
    }
  }

  /**
   * POST con autenticazione adeguata alla modalità (mock: X-API-Key;
   * live: Bearer + firma di integrità Agid-JWT-Signature sul body).
   */
  private async post(path: string, body: unknown, metricEndpoint: string) {
    const url = `${this.config.baseUrl}${path}`;
    const rawBody = JSON.stringify(body);

    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.isLive) {
      const token = await this.auth.getAccessToken();
      const integrityHeaders = await this.signature.buildIntegrityHeaders(rawBody);
      headers = {
        ...headers,
        Authorization: `Bearer ${token}`,
        ...integrityHeaders,
      };
    } else {
      headers['X-API-Key'] = this.config.mockApiKey;
    }

    try {
      return await firstValueFrom(
        this.httpService.post(url, body, { headers, timeout: this.timeout }),
      );
    } catch (error: any) {
      this.metrics.rentriApiErrors.inc({ endpoint: metricEndpoint, error_type: 'HTTP' });
      throw error;
    }
  }

  /** GET con Bearer (live) o X-API-Key (mock). */
  private async get(path: string) {
    const url = `${this.config.baseUrl}${path}`;
    let headers: Record<string, string> = {};

    if (this.isLive) {
      const token = await this.auth.getAccessToken();
      headers.Authorization = `Bearer ${token}`;
    } else {
      headers['X-API-Key'] = this.config.mockApiKey;
    }

    return firstValueFrom(this.httpService.get(url, { headers, timeout: this.timeout }));
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
        dataPartenza: fir.transportDate?.toISOString?.() ?? fir.transportDate,
        dataArrivoPrevista: fir.estimatedArrivalDate?.toISOString?.() ?? fir.estimatedArrivalDate,
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
      dataFirma: sig.signedAt?.toISOString?.() ?? sig.signedAt,
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
