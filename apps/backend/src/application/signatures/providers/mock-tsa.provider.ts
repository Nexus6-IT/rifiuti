/**
 * Mock TSA Provider — MARCA TEMPORALE MOCK (default)
 *
 * Implementazione di default di ITsaProvider per l'ambiente sandbox.
 * Genera un token JSON che simula la struttura RFC 3161 senza
 * essere una vera marca temporale accreditata.
 *
 * Il token prodotto NON è una marca temporale qualificata: non ha valore
 * probatorio per la conservazione a norma AgID (10 anni).
 *
 * ATTIVARE la marca temporale qualificata:
 *  Impostare TSA_PROVIDER=rfc3161 + TSA_URL nell'env.
 *  Fonti: https://www.agid.gov.it/sites/default/files/repository_files/register_manuale_v1.0.pdf
 */

import { Injectable } from '@nestjs/common'
import {
  ITsaProvider,
  TsaTokenResult,
  TsaProviderType,
} from './signature-provider.interface'
import { LoggerService } from '../../../core/logger/logger.service'

@Injectable()
export class MockTsaProvider implements ITsaProvider {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(MockTsaProvider.name)
  }

  async generateToken(documentHash: string): Promise<TsaTokenResult> {
    const timestamp = new Date().toISOString()

    // Struttura ispirata a RFC 3161 TimeStampToken — NON è un token reale
    const tokenData = {
      version: 1,
      policy: '1.2.3.4.1', // OID policy fittizio (sandbox)
      messageImprint: {
        hashAlgorithm: 'sha256',
        hashedMessage: documentHash,
      },
      serialNumber: Date.now(),
      genTime: timestamp,
      accuracy: { seconds: 1 },
      tsa: 'CN=WasteFlow MOCK-TSA,O=WasteFlow-Sandbox,C=IT',
      _note: 'MOCK — NON è una marca temporale qualificata RFC 3161. ' +
             'ATTIVARE: TSA_PROVIDER=rfc3161 + TSA_URL con QTSP AgID.',
    }

    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64')

    this.logger.debug(`[MOCK-TSA] Token generato al ${timestamp} (NON qualificato)`)

    return {
      token,
      providerType: 'MOCK' as TsaProviderType,
      isQualified: false,
    }
  }

  getProviderType(): TsaProviderType {
    return 'MOCK'
  }

  isQualified(): boolean {
    return false
  }
}
