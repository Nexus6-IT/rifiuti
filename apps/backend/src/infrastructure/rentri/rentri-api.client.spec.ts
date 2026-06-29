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
  let mockConfig: any;
  let mockAuth: any;
  let mockSignature: any;
  let mockLogger: any;
  let mockMetrics: any;

  beforeEach(() => {
    mockHttpService = {
      post: jest.fn(),
      get: jest.fn(),
    };

    // Modalità mock: autenticazione X-API-Key verso il mock locale.
    mockConfig = {
      mode: 'mock',
      baseUrl: 'http://localhost:3001',
      mockApiKey: 'demo-key',
    };

    mockAuth = {
      getAccessToken: jest.fn().mockResolvedValue('test-token'),
      invalidate: jest.fn(),
    };

    mockSignature = {
      buildIntegrityHeaders: jest.fn().mockReturnValue({}),
    };

    mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    mockMetrics = {
      rentriApiRequestDuration: {
        observe: jest.fn(),
      },
      rentriApiErrors: {
        inc: jest.fn(),
      },
    };

    // Directly instantiate the client with mocks (new constructor order)
    client = new RENTRIApiClient(
      mockHttpService,
      mockLogger,
      mockMetrics,
      mockConfig,
      mockAuth,
      mockSignature,
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
        // flat DTO usa `firNumber`, aggregate usa `numeroProgressivo`
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
          // Campi aggiuntivi DM 59/2023: undefined su flat DTO (rifiuto=null)
          statoFisico: undefined,
          caratteristichePericolo: undefined,
          numeroColli: undefined,
          codiceOperazione: undefined,
        },
        trasporto: {
          dataPartenza: (expect as any).any(String),
          dataArrivoPrevista: (expect as any).any(String),
          note: 'Handle with care',
          // dataArrivo undefined su flat DTO (nessun dataConsegna)
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

    /**
     * Test del mapping dall'aggregate FIR reale (con snapshot ParteFIR annidati
     * e value object Quantita), come restituito da FIRPrismaRepository.toDomain().
     */
    it('dovrebbe mappare correttamente il FIR aggregate (snapshot ParteFIR annidati)', () => {
      // Simula la shape dell'aggregate FIR (aggregates/fir.aggregate.ts)
      // con le anagrafiche come snapshot ParteFIR e il rifiuto come FIRRifiuto
      // con value object Quantita ({ valore, unitaMisura }).
      const firAggregate = {
        id: 'agg-fir-001',
        // Aggregate usa `numeroProgressivo`, non `firNumber`
        numeroProgressivo: 'FIR-2026-000001',
        // Snapshot anagrafici — shape ParteFIR
        produttore: {
          registroId: 'prod-reg-123',
          ragioneSociale: 'Azienda Produttrice SRL',
          partitaIva: '01234567890',
          indirizzo: 'Via Roma 1, 20100 Milano',
          contatto: 'produttore@test.it',
        },
        trasportatore: {
          registroId: 'carr-reg-456',
          ragioneSociale: 'Trasporti Rifiuti SpA',
          partitaIva: '09876543210',
          targaVeicolo: 'AB 123 CD',
          contatto: 'carrier@test.it',
        },
        destinatario: {
          registroId: 'recv-reg-789',
          ragioneSociale: 'Impianto Ricevente Srl',
          partitaIva: '11122233344',
          indirizzo: 'Via Verdi 5, 00100 Roma',
        },
        // FIRRifiuto con value object Quantita
        rifiuto: {
          cerCode: '200301',
          quantita: { valore: 250.75, unitaMisura: 'KG' },
          descrizione: 'Rifiuti solidi urbani',
          categoria: 'NON PERICOLOSO',
          statoFisico: 'SOLIDO',
          caratteristichePericolo: undefined,
          numeroColli: 5,
          tipoOperazione: 'RECOVERY',
          codiceOperazione: 'R1',
        },
        // Date dell'aggregate (non del flat DTO)
        dataPresaCarico: new Date('2026-06-15T08:00:00Z'),
        dataConsegna: new Date('2026-06-15T14:30:00Z'),
        annotazioni: 'Rifiuti speciali — trasporto urgente',
        // Firme nell'aggregate come { produttore?, trasportatore?, destinatario? }
        firme: {
          produttore: {
            firmatario: 'Mario Rossi',
            timestamp: new Date('2026-06-15T07:55:00Z'),
            certificato: 'sha256:certproduttore',
          },
          trasportatore: undefined,
          destinatario: undefined,
        },
      };

      const xFIR = client['convertToXFIRFormat'](firAggregate);

      // Identifiers
      expect(xFIR.firId).toBe('agg-fir-001');
      expect(xFIR.numeroFormulario).toBe('FIR-2026-000001'); // da numeroProgressivo

      // Produttore — dal snapshot ParteFIR
      expect(xFIR.produttore.partitaIva).toBe('01234567890');
      expect(xFIR.produttore.ragioneSociale).toBe('Azienda Produttrice SRL');
      expect(xFIR.produttore.indirizzo).toBe('Via Roma 1, 20100 Milano');
      expect(xFIR.produttore.contatto).toBe('produttore@test.it');

      // Trasportatore — dal snapshot ParteFIR
      expect(xFIR.trasportatore.partitaIva).toBe('09876543210');
      expect(xFIR.trasportatore.ragioneSociale).toBe('Trasporti Rifiuti SpA');
      expect(xFIR.trasportatore.targaVeicolo).toBe('AB 123 CD');

      // Destinatario — dal snapshot ParteFIR
      expect(xFIR.destinatario.partitaIva).toBe('11122233344');
      expect(xFIR.destinatario.ragioneSociale).toBe('Impianto Ricevente Srl');

      // Rifiuto — da FIRRifiuto + Quantita value object
      expect(xFIR.rifiuto.codiceEER).toBe('200301');
      expect(xFIR.rifiuto.quantita).toBe(250.75);    // da Quantita.valore
      expect(xFIR.rifiuto.unita).toBe('KG');          // da Quantita.unitaMisura
      expect(xFIR.rifiuto.statoFisico).toBe('SOLIDO');
      expect(xFIR.rifiuto.numeroColli).toBe(5);
      expect(xFIR.rifiuto.codiceOperazione).toBe('R1');

      // Trasporto — da dataPresaCarico (non transportDate)
      expect(xFIR.trasporto.dataPartenza).toBe('2026-06-15T08:00:00.000Z');
      // dataConsegna → dataArrivo
      expect(xFIR.trasporto.dataArrivo).toBe('2026-06-15T14:30:00.000Z');
      // Campo 17 FIR — da annotazioni (non transportNotes)
      expect(xFIR.trasporto.note).toBe('Rifiuti speciali — trasporto urgente');

      // Firme digitali — da fir.firme (aggregate shape), solo la firma produttore
      expect(xFIR.firmeDigitali).toHaveLength(1);
      expect(xFIR.firmeDigitali[0].ruolo).toBe('PRODUTTORE');
      expect(xFIR.firmeDigitali[0].firmatario).toBe('Mario Rossi');
      expect(xFIR.firmeDigitali[0].dataFirma).toBe('2026-06-15T07:55:00.000Z');
    });

    it('non deve esporre la chiave privata RENTRI nel risultato xFIR', () => {
      // Verifica che convertToXFIRFormat non includa MAI dati sensibili
      // anche se per errore vengono passati nell'oggetto FIR.
      const firConDatiSensibili = {
        id: 'fir-sec-001',
        firNumber: 'FIR-2026-000002',
        producerPartitaIva: '12345678901',
        producerName: 'Test SRL',
        producerAddress: 'Via Test 1',
        carrierPartitaIva: '98765432109',
        carrierName: 'Carrier SRL',
        carrierVehiclePlate: 'XY999YZ',
        receiverPartitaIva: '11223344556',
        receiverName: 'Receiver SRL',
        receiverAddress: 'Via Dest 1',
        cerCode: '150102',
        wasteDescription: 'Test',
        wasteCategory: 'NON PERICOLOSO',
        quantity: 10,
        unit: 'KG',
        // Dati sensibili che NON devono apparire nel payload xFIR
        privateKeyPem: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----',
        password: 'secret123',
        apiKey: 'rentri-api-key-segreto',
      };

      const xFIR = client['convertToXFIRFormat'](firConDatiSensibili);
      const xFIRJson = JSON.stringify(xFIR);

      // La chiave privata, password o API key non deve MAI comparire nel payload
      expect(xFIRJson).not.toContain('PRIVATE KEY');
      expect(xFIRJson).not.toContain('secret123');
      expect(xFIRJson).not.toContain('rentri-api-key-segreto');
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
