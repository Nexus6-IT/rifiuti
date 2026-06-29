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
 * Formato dati: xFIR secondo le specifiche tecniche D.M. 59/2023 (Decreto
 * Ministeriale, allegato tecnico RENTRI). Il corpo della richiesta segue la
 * struttura xFIR: `produttore`, `trasportatore`, `destinatario`, `rifiuto`,
 * `trasporto`, `firmeDigitali`.
 *
 * Servizio API RENTRI confermato: `vidimazione-formulari` v1.0.
 * Documentazione ufficiale: https://demoapi.rentri.gov.it/docs?api=vidimazione-formulari&v=v1.0
 *                           https://api.rentri.gov.it/docs
 *
 * ATTIVARE: caricare certificato + completare iscrizione RENTRI (area operatori)
 * e verificare i path OpenAPI di seguito su Swagger ufficiale prima del go-live.
 *
 * I path del servizio sono isolati nelle costanti FORMULARI_* per facilitare
 * la correzione una volta confermati sull'OpenAPI ufficiale RENTRI.
 */
@Injectable()
export class RENTRIApiClient {
  private readonly timeout = 30000; // 30s

  // =========================================================================
  // Path del servizio `vidimazione-formulari` v1.0 — DA CONFERMARE sull'OpenAPI
  // ufficiale disponibile su https://demoapi.rentri.gov.it (Swagger UI).
  //
  // Fonte: documentazione RENTRI, incontri tecnici SH (2025-10-22).
  //   POST  <base>/vidimazione-formulari/v1.0/formulari          → vidima/crea FIR
  //   GET   <base>/vidimazione-formulari/v1.0/formulari/{id}     → stato FIR
  //   PUT   <base>/vidimazione-formulari/v1.0/formulari/{id}     → modifica FIR
  //   POST  <base>/vidimazione-formulari/v1.0/formulari/{id}/annulla-fir → annulla
  // =========================================================================
  private static readonly FORMULARI_BASE = '/vidimazione-formulari/v1.0'; // DA CONFERMARE
  private static readonly PATH_SUBMIT = `${RENTRIApiClient.FORMULARI_BASE}/formulari`; // DA CONFERMARE
  private static readonly PATH_VALIDATE = `${RENTRIApiClient.FORMULARI_BASE}/formulari/validazione`; // DA CONFERMARE (potrebbe non esistere)
  private static readonly PATH_STATUS = (id: string) =>
    `${RENTRIApiClient.FORMULARI_BASE}/formulari/${id}`; // DA CONFERMARE

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
   * Converte il FIR interno nel formato xFIR (standard RENTRI — D.M. 59/2023).
   *
   * Supporta DUE strutture di input in modo trasparente:
   *
   * 1. **Aggregate FIR** (`aggregates/fir.aggregate.ts`) — restituito dal
   *    repository Prisma. Le anagrafiche sono snapshot annidati (`ParteFIR`):
   *    `fir.produttore.partitaIva`, `fir.rifiuto.cerCode`,
   *    `fir.rifiuto.quantita.valore` (value object `Quantita`), ecc.
   *
   * 2. **Flat DTO** (usato nei test unitari, shape legacy): proprietà piatte
   *    `fir.producerPartitaIva`, `fir.cerCode`, `fir.quantity`, ecc.
   *
   * La risoluzione usa `??` (nullish coalescing): la forma aggregate ha
   * precedenza, il flat DTO serve da fallback per retrocompatibilità.
   *
   * I nomi dei campi nel payload xFIR sono in italiano, coerenti con le
   * specifiche tecniche RENTRI (D.M. 59/2023) e con la struttura dell'API
   * `vidimazione-formulari`. DA CONFERMARE sull'OpenAPI ufficiale prima del go-live.
   */
  private convertToXFIRFormat(fir: any): XFIRPayload {
    // Snapshot anagrafici (FIR aggregate) — null se non popolati.
    const snapshotProduttore = fir.produttore ?? null;
    const snapshotTrasportatore = fir.trasportatore ?? null;
    const snapshotDestinatario = fir.destinatario ?? null;
    // Waste info (FIR aggregate ha `rifiuto: FIRRifiuto` con `quantita: Quantita`).
    const rifiutoAgg = fir.rifiuto ?? null;
    // Value object Quantita: { valore: number, unitaMisura: string }
    const quantitaVo = rifiutoAgg?.quantita ?? null;

    return {
      firId: fir.id,
      // FIR aggregate: `numeroProgressivo` (assegnato all'emissione); flat DTO: `firNumber`
      numeroFormulario: fir.numeroProgressivo ?? fir.firNumber,
      dataEmissione: new Date().toISOString(),

      // Produttore — snapshot ParteFIR (aggregate) con fallback flat DTO
      produttore: {
        partitaIva: snapshotProduttore?.partitaIva ?? fir.producerPartitaIva,
        ragioneSociale: snapshotProduttore?.ragioneSociale ?? fir.producerName,
        indirizzo: snapshotProduttore?.indirizzo ?? fir.producerAddress,
        contatto: snapshotProduttore?.contatto ?? fir.producerContact,
      },

      // Trasportatore — snapshot ParteFIR (aggregate) con fallback flat DTO
      trasportatore: {
        partitaIva: snapshotTrasportatore?.partitaIva ?? fir.carrierPartitaIva,
        ragioneSociale: snapshotTrasportatore?.ragioneSociale ?? fir.carrierName,
        // `targaVeicolo` è nel snapshot trasportatore o nei dati di trasporto
        targaVeicolo: snapshotTrasportatore?.targaVeicolo ?? fir.carrierVehiclePlate,
        contatto: snapshotTrasportatore?.contatto ?? fir.carrierContact,
      },

      // Destinatario — snapshot ParteFIR (aggregate) con fallback flat DTO
      destinatario: {
        partitaIva: snapshotDestinatario?.partitaIva ?? fir.receiverPartitaIva,
        ragioneSociale: snapshotDestinatario?.ragioneSociale ?? fir.receiverName,
        indirizzo: snapshotDestinatario?.indirizzo ?? fir.receiverAddress,
        contatto: snapshotDestinatario?.contatto ?? fir.receiverContact,
      },

      // Rifiuto — FIRRifiuto (aggregate) con fallback flat DTO
      rifiuto: {
        codiceEER: rifiutoAgg?.cerCode ?? fir.cerCode,
        descrizione: rifiutoAgg?.descrizione ?? fir.wasteDescription,
        categoria: rifiutoAgg?.categoria ?? fir.wasteCategory,
        // Quantita value object ha `.valore` (numero) e `.unitaMisura` (enum)
        quantita: quantitaVo?.valore ?? fir.quantity,
        unita: quantitaVo?.unitaMisura ?? fir.unit,
        // Campi aggiuntivi DM 59/2023 (presenti solo nell'aggregate)
        statoFisico: rifiutoAgg?.statoFisico,
        caratteristichePericolo: rifiutoAgg?.caratteristichePericolo,
        numeroColli: rifiutoAgg?.numeroColli,
        codiceOperazione: rifiutoAgg?.codiceOperazione,
      },

      // Trasporto — date dell'aggregate (dataPresaCarico/dataConsegna) o flat DTO
      trasporto: {
        // dataPresaCarico = data partenza (aggregato); transportDate = flat DTO
        dataPartenza: (fir.dataPresaCarico ?? fir.transportDate)?.toISOString?.()
          ?? fir.dataPresaCarico ?? fir.transportDate,
        dataArrivoPrevista: fir.estimatedArrivalDate?.toISOString?.() ?? fir.estimatedArrivalDate,
        // dataConsegna = data arrivo effettiva (aggregato); undefined se non ancora consegnato
        dataArrivo: fir.dataConsegna?.toISOString?.(),
        // Campo 17 FIR (annotazioni) o transportNotes del flat DTO
        note: fir.annotazioni ?? fir.transportNotes,
      },

      // Firme digitali — FirmeDigitali (aggregate) o array piatto (flat DTO)
      firmeDigitali: this.buildFirmeDigitali(fir),
    };
  }

  /**
   * Costruisce l'array `firmeDigitali` per xFIR supportando entrambe le forme:
   * - **Aggregate**: `fir.firme: { produttore?, trasportatore?, destinatario? }`
   *   dove ciascuna è una `FirmaDigitale { firmatario, timestamp, certificato }`.
   * - **Flat DTO**: `fir.signatures: any[]` (array con shape legacy).
   */
  private buildFirmeDigitali(fir: any): any[] {
    // FIR aggregate: `fir.firme` è sempre un oggetto (anche vuoto `{}`)
    if (fir.firme && typeof fir.firme === 'object') {
      const firme = fir.firme as { produttore?: any; trasportatore?: any; destinatario?: any };
      const result: any[] = [];
      const roles: Array<['PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO', any]> = [
        ['PRODUTTORE', firme.produttore],
        ['TRASPORTATORE', firme.trasportatore],
        ['DESTINATARIO', firme.destinatario],
      ];
      for (const [ruolo, fd] of roles) {
        if (!fd) continue;
        result.push({
          ruolo,
          dataFirma: fd.timestamp?.toISOString?.() ?? fd.timestamp,
          firmatario: fd.firmatario,
          hashCertificato: fd.certificato,
        });
      }
      return result;
    }
    // Flat DTO legacy (test)
    return this.convertSignatures(fir.signatures || []);
  }

  /**
   * Converte un array di firme flat DTO in formato xFIR (retrocompatibilità test).
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
 * Payload xFIR nel formato del servizio `vidimazione-formulari` RENTRI.
 * DA CONFERMARE la struttura esatta sull'OpenAPI ufficiale prima del go-live.
 */
export interface XFIRPayload {
  firId: string;
  /** Numero formulario (FIR-ANNO-NNNNNN). */
  numeroFormulario: string | null;
  /** Data e ora di emissione del documento (ISO 8601). */
  dataEmissione: string;
  produttore: {
    partitaIva?: string;
    ragioneSociale?: string;
    indirizzo?: string;
    contatto?: string;
  };
  trasportatore: {
    partitaIva?: string;
    ragioneSociale?: string;
    targaVeicolo?: string;
    contatto?: string;
  };
  destinatario: {
    partitaIva?: string;
    ragioneSociale?: string;
    indirizzo?: string;
    contatto?: string;
  };
  rifiuto: {
    codiceEER?: string;
    descrizione?: string;
    categoria?: string;
    quantita?: number;
    unita?: string;
    statoFisico?: string;
    caratteristichePericolo?: string;
    numeroColli?: number;
    codiceOperazione?: string;
  };
  trasporto: {
    dataPartenza?: string;
    dataArrivoPrevista?: string;
    /** Data arrivo effettiva — valorizzata dopo la consegna. */
    dataArrivo?: string;
    note?: string;
  };
  firmeDigitali: any[];
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
