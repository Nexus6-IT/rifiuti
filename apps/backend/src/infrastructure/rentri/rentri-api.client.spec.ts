import { RENTRIApiClient } from './rentri-api.client';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosResponse } from 'axios';

/**
 * Integration tests for RENTRI API Client
 *
 * Tests HTTP communication with RENTRI API (mock server).
 * Verifies xFIR format conversion and error handling.
 */
describe('RENTRIApiClient', () => {
  let client: RENTRIApiClient;
  let mockHttpService: any;
  let mockConfigService: any;
  let mockLogger: any;
  let mockMetrics: any;

  beforeEach(() => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'RENTRI_API_URL') return 'http://localhost:3001';
        if (key === 'RENTRI_API_KEY') return 'demo-key';
        if (key === 'RENTRI_ENABLE_MOCK') return 'true';
        return null;
      }),
    };

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    mockMetrics = {
      rentriApiRequestDuration: {
        observe: jest.fn(),
      },
      rentriApiErrors: {
        inc: jest.fn(),
      },
    };

    // Directly instantiate the client with mocks
    client = new RENTRIApiClient(
      mockHttpService,
      mockConfigService,
      mockLogger,
      mockMetrics,
    );
  });

  describe('submitFIR', () => {
    it('should submit FIR successfully and return protocol number', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00042',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      const mockResponse: AxiosResponse = {
        data: {
          success: true,
          rentriId: 'RENTRI-2025-123456',
          protocolNumber: 'PROT-1705583400000',
          receivedAt: '2025-01-18T10:30:00Z',
        },
        status: 201,
        statusText: 'Created',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await client.submitFIR(mockFIR);

      expect(result.success).toBe(true);
      expect(result.protocolNumber).toBe('PROT-1705583400000');
      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:3001/api/v1/fir/submit',
        (expect as any).objectContaining({
          firId: 'fir-123',
          // xFIR format fields
          numeroFormulario: 'FIR-2025-00042',
          produttore: (expect as any).objectContaining({
            partitaIva: '12345678901',
          }),
          trasportatore: (expect as any).objectContaining({
            partitaIva: '98765432109',
          }),
          destinatario: (expect as any).objectContaining({
            partitaIva: '11223344556',
          }),
          rifiuto: (expect as any).objectContaining({
            codiceEER: '150102',
            quantita: 100,
          }),
        }),
        (expect as any).objectContaining({
          headers: (expect as any).objectContaining({
            'X-API-Key': 'demo-key',
          }),
        }),
      );
    });

    it('should handle RENTRI validation errors', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00099',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: 'INVALID', // Invalid CER code
        wasteDescription: 'Test',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      // Mock a 400 error response
      mockHttpService.post.mockReturnValue(
        throwError(() => ({
          response: {
            status: 400,
            data: {
              errors: [
                {
                  code: 'E001',
                  field: 'rifiuto.codiceEER',
                  message: 'Codice CER non valido',
                },
              ],
            },
          },
        })),
      );

      const result = await client.submitFIR(mockFIR as any);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBe(1);
      expect(result.errors![0].code).toBe('E001');
      expect(result.errors![0].field).toBe('rifiuto.codiceEER');
    });

    it('should handle RENTRI service unavailable (503)', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00098',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      mockHttpService.post.mockReturnValue(
        throwError(() => ({
          response: {
            status: 503,
            data: {
              error: 'SERVICE_UNAVAILABLE',
              message: 'RENTRI service temporarily unavailable',
              retryAfter: 300,
            },
          },
        })),
      );

      await expect(client.submitFIR(mockFIR as any)).rejects.toThrow(
        'RENTRI service temporarily unavailable',
      );
    });

    it('should handle network timeout', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00043',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      mockHttpService.post.mockReturnValue(
        throwError(() => ({
          code: 'ECONNABORTED',
          message: 'timeout of 30000ms exceeded',
        })),
      );

      await expect(client.submitFIR(mockFIR as any)).rejects.toThrow('timeout');
    });
  });

  describe('xFIR Format Conversion', () => {
    it('should convert FIR to xFIR format correctly', () => {
      const fir = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00042',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Producer 1, Milano',
        producerContact: 'producer@example.com',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        carrierContact: 'carrier@example.com',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Receiver 1, Roma',
        receiverContact: 'receiver@example.com',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100.5,
        unit: 'KG',
        transportDate: new Date('2025-01-18T08:00:00Z'),
        estimatedArrivalDate: new Date('2025-01-18T14:00:00Z'),
        transportNotes: 'Handle with care',
      };

      const xFIR = client['convertToXFIRFormat'](fir);

      expect(xFIR).toEqual({
        firId: 'fir-123',
        numeroFormulario: 'FIR-2025-00042',
        dataEmissione: (expect as any).any(String),
        produttore: {
          partitaIva: '12345678901',
          ragioneSociale: 'Producer SRL',
          indirizzo: 'Via Producer 1, Milano',
          contatto: 'producer@example.com',
        },
        trasportatore: {
          partitaIva: '98765432109',
          ragioneSociale: 'Carrier SRL',
          targaVeicolo: 'AB123CD',
          contatto: 'carrier@example.com',
        },
        destinatario: {
          partitaIva: '11223344556',
          ragioneSociale: 'Receiver SRL',
          indirizzo: 'Via Receiver 1, Roma',
          contatto: 'receiver@example.com',
        },
        rifiuto: {
          codiceEER: '150102',
          descrizione: 'Plastic packaging',
          categoria: 'NON PERICOLOSO',
          quantita: 100.5,
          unita: 'KG',
        },
        trasporto: {
          dataPartenza: (expect as any).any(String),
          dataArrivoPrevista: (expect as any).any(String),
          note: 'Handle with care',
        },
        firmeDigitali: (expect as any).any(Array),
      });
    });

    it('should handle optional fields correctly', () => {
      const minimalFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00042',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Producer 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Receiver 1',
        cerCode: '150102',
        wasteDescription: 'Plastic',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date(),
      };

      const xFIR = client['convertToXFIRFormat'](minimalFIR);

      expect(xFIR.produttore.contatto).toBeUndefined();
      expect(xFIR.trasporto.note).toBeUndefined();
    });
  });

  describe('validateFIR', () => {
    it('should validate FIR before submission', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00044',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 100,
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      const mockResponse: AxiosResponse = {
        data: {
          valid: true,
          errors: [],
          warnings: [],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await client.validateFIR(mockFIR as any);

      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should return validation warnings', async () => {
      const mockFIR = {
        id: 'fir-123',
        firNumber: 'FIR-2025-00045',
        producerPartitaIva: '12345678901',
        producerName: 'Producer SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Plastic packaging',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 15000, // Very high quantity
        unit: 'KG',
        transportDate: new Date('2025-01-18'),
      };

      const mockResponse: AxiosResponse = {
        data: {
          valid: true,
          errors: [],
          warnings: ['Quantità elevata - verificare correttezza'],
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.post.mockReturnValue(of(mockResponse));

      const result = await client.validateFIR(mockFIR as any);

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBe(1);
    });
  });

  describe('getFIRStatus', () => {
    it('should retrieve FIR status from RENTRI', async () => {
      const firId = 'fir-123';

      const mockResponse: AxiosResponse = {
        data: {
          success: true,
          data: {
            firId,
            rentriId: 'RENTRI-2025-123456',
            protocolNumber: 'PROT-123',
            status: 'ACCEPTED',
            submittedAt: '2025-01-18T10:30:00Z',
          },
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      };

      mockHttpService.get.mockReturnValue(of(mockResponse));

      const result = await client.getFIRStatus(firId);

      expect(result.firId).toBe(firId);
      expect(result.status).toBe('ACCEPTED');
      expect(mockHttpService.get).toHaveBeenCalledWith(`http://localhost:3001/api/v1/fir/${firId}`, (expect as any).any(Object));
    });

    it('should handle FIR not found in RENTRI', async () => {
      const firId = 'nonexistent-fir';

      mockHttpService.get.mockReturnValue(
        throwError(() => ({
          response: {
            status: 404,
            data: {
              success: false,
              error: 'FIR non trovato in RENTRI',
            },
          },
        })),
      );

      await expect(client.getFIRStatus(firId)).rejects.toThrow('FIR non trovato') as any;
    });
  });
});
