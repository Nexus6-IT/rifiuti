/**
 * Sandbox Signature Provider — FIRMA NON QUALIFICATA (default)
 *
 * Implementazione di default di ISignatureProvider per l'ambiente di sviluppo
 * e per il profilo "pronto-ma-non-collegato". Usa ECDSA P-256 effimera (Node.js
 * crypto): genera una coppia di chiavi per ogni operazione di firma e scarta
 * immediatamente la chiave privata dopo l'uso. Non è una firma qualificata.
 *
 * SICUREZZA:
 *  - Chiave privata generata in-process, mai restituita né loggata.
 *  - La firma prodotta è valida crittograficamente (ECDSA P-256 SHA-256) ma NON
 *    ha valore legale (chiave effimera senza certificato qualificato).
 *  - Il campo signatureMethod è 'FIRMA-NON-QUALIFICATA' per distinguerla dalla QES.
 *
 * ATTIVARE la firma qualificata:
 *  Impostare SIGNATURE_PROVIDER=qes nell'env + configurare le variabili del
 *  QesSignatureProvider (QTSP AgID: Aruba/InfoCert/Namirial/Poste + SPID/CIE).
 */

import { Injectable } from '@nestjs/common'
import { createHash, generateKeyPairSync, sign, verify } from 'crypto'
import {
  ISignatureProvider,
  SignatureProviderResult,
  SignatureProviderType,
  SignatureMethodProvider,
} from './signature-provider.interface'
import { LoggerService } from '../../../core/logger/logger.service'

@Injectable()
export class SandboxSignatureProvider implements ISignatureProvider {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(SandboxSignatureProvider.name)
  }

  async sign(document: any, userId: string): Promise<SignatureProviderResult> {
    // SICUREZZA: chiave privata generata in-process, effimera, mai esposta
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1', // P-256
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'sec1', format: 'pem' },
    })

    const documentHash = this.hashDocument(document)
    const signatureValue = await this.signHash(documentHash, privateKey)
    const certificateHash = this.hashPublicKey(publicKey)

    // privateKey esce dallo scope e viene raccolta dal GC — mai loggata
    this.logger.debug(
      `[SANDBOX] Firma effimera generata per utente ${userId}: ` +
      `hash=${documentHash.substring(0, 16)}... (FIRMA-NON-QUALIFICATA)`,
    )

    return {
      signatureValue,
      documentHash,
      certificateHash,
      publicKey,
      signatureMethod: 'FIRMA-NON-QUALIFICATA' as SignatureMethodProvider,
      providerType: 'SANDBOX' as SignatureProviderType,
      isQualified: false,
    }
  }

  async verify(documentHash: string, signatureValue: string, publicKey: string): Promise<boolean> {
    try {
      const hashBuffer = Buffer.from(documentHash, 'hex')
      const signatureBuffer = Buffer.from(signatureValue, 'base64')
      return verify('sha256', hashBuffer, { key: publicKey, format: 'pem' }, signatureBuffer)
    } catch {
      return false
    }
  }

  getProviderType(): SignatureProviderType {
    return 'SANDBOX'
  }

  isQualified(): boolean {
    return false
  }

  /** Hash SHA-256 del documento (canonical JSON). */
  hashDocument(document: any): string {
    const canonical =
      typeof document === 'string'
        ? document
        : JSON.stringify(document, Object.keys(document).sort())
    return createHash('sha256').update(canonical, 'utf8').digest('hex')
  }

  private async signHash(documentHash: string, privateKey: string): Promise<string> {
    const hashBuffer = Buffer.from(documentHash, 'hex')
    const signature = sign('sha256', hashBuffer, { key: privateKey, format: 'pem' })
    return signature.toString('base64')
  }

  private hashPublicKey(publicKey: string): string {
    return createHash('sha256').update(publicKey, 'utf8').digest('hex')
  }
}
