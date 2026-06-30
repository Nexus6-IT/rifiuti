/**
 * Digital Signature Service
 *
 * Orchestratore della firma digitale FIR. Delega al provider configurato via env:
 *  - SIGNATURE_PROVIDER=sandbox (default): ECDSA P-256 effimera, NON qualificata.
 *  - SIGNATURE_PROVIDER=qes: firma qualificata QES/SPID-CIE (stub, ATTIVARE con credenziali).
 *
 *  - TSA_PROVIDER=mock (default): marca temporale mock, NON qualificata.
 *  - TSA_PROVIDER=rfc3161: TSA accreditata AgID RFC 3161 (stub, ATTIVARE con credenziali).
 *
 * Il servizio mantiene i metodi legacy (hashDocument, sign, verify, generateKeyPair, ecc.)
 * che restano funzionanti per retrocompatibilità con test e codice esistente.
 * Il metodo principale per la firma è createSignature(document, userId).
 *
 * SICUREZZA: chiavi private mai restituite in output, mai loggate in chiaro.
 *
 * Normativa: DM 59/2023, art. 188-bis D.Lgs. 152/2006, Reg. UE 910/2014 (eIDAS),
 *            AgID Linee Guida conservazione doc. informatici (10 anni).
 */

import { Injectable, Optional, Inject } from '@nestjs/common'
import { createHash, generateKeyPairSync, sign, verify } from 'crypto'
import { LoggerService } from '../../core/logger/logger.service'
import {
  ISignatureProvider,
  ITsaProvider,
  SIGNATURE_PROVIDER,
  TSA_PROVIDER,
  SignatureProviderResult,
} from './providers/signature-provider.interface'

export interface SignatureResult {
  signatureValue: string
  documentHash: string
  certificateHash: string
  timestampToken: string
  publicKey: string
  signatureMethod: string
  /** false = sandbox/non qualificata; true = QES a norma */
  isQualified: boolean
  providerType: string
  tsaProviderType: string
}

@Injectable()
export class DigitalSignatureService {
  constructor(
    private readonly logger: LoggerService,
    @Optional() @Inject(SIGNATURE_PROVIDER) private readonly signatureProvider?: ISignatureProvider,
    @Optional() @Inject(TSA_PROVIDER) private readonly tsaProvider?: ITsaProvider
  ) {
    this.logger.setContext(DigitalSignatureService.name)
  }

  /**
   * Crea la firma completa per il documento, usando il provider configurato.
   * Questo è il metodo principale per la firma in produzione.
   *
   * @param document - Documento FIR da firmare (oggetto o stringa JSON canonica)
   * @param userId - ID utente richiedente (per tracciabilità)
   */
  async createSignature(document: any, userId: string): Promise<SignatureResult> {
    this.logger.info(
      `[createSignature] provider=${this.signatureProvider?.getProviderType() ?? 'INTERNAL_FALLBACK'} ` +
        `tsa=${this.tsaProvider?.getProviderType() ?? 'INTERNAL_MOCK'} userId=${userId}`
    )

    let sigResult: SignatureProviderResult

    if (this.signatureProvider) {
      // Modalità provider: sandbox o QES
      sigResult = await this.signatureProvider.sign(document, userId)
    } else {
      // Fallback interno (retrocompatibilità con test che non iniettano il provider)
      sigResult = await this.internalSign(document)
    }

    // Marca temporale
    let timestampToken: string
    let tsaType = 'INTERNAL_MOCK'
    let tsaQualified = false

    if (this.tsaProvider) {
      const tsaResult = await this.tsaProvider.generateToken(sigResult.documentHash)
      timestampToken = tsaResult.token
      tsaType = tsaResult.providerType
      tsaQualified = tsaResult.isQualified
    } else {
      timestampToken = await this.internalGenerateTimestampToken(sigResult.documentHash)
    }

    if (!sigResult.isQualified || !tsaQualified) {
      this.logger.warn(
        '[firma] Firma NON qualificata (sandbox/mock). Per la valenza legale ' +
          'ai sensi del DM 59/2023: ATTIVARE SIGNATURE_PROVIDER=qes + TSA_PROVIDER=rfc3161 ' +
          'con credenziali QTSP AgID.'
      )
    }

    return {
      signatureValue: sigResult.signatureValue,
      documentHash: sigResult.documentHash,
      certificateHash: sigResult.certificateHash,
      timestampToken,
      publicKey: sigResult.publicKey,
      signatureMethod: sigResult.signatureMethod,
      isQualified: sigResult.isQualified && tsaQualified,
      providerType: sigResult.providerType,
      tsaProviderType: tsaType,
    }
  }

  /**
   * Genera coppia di chiavi ECDSA P-256.
   * Retrocompatibilità — usato nei test.
   * SICUREZZA: la chiave privata NON deve mai essere loggata.
   */
  async generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
    this.logger.debug('[generateKeyPair] Generazione coppia ECDSA P-256')
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'sec1', format: 'pem' },
    })
    return { privateKey: privateKey as string, publicKey: publicKey as string }
  }

  /**
   * Hash SHA-256 del documento (JSON canonico).
   * Retrocompatibilità — usato anche dal VerifySignaturesUseCase.
   */
  hashDocument(document: any): string {
    const canonical =
      typeof document === 'string'
        ? document
        : JSON.stringify(document, Object.keys(document).sort())
    return createHash('sha256').update(canonical, 'utf8').digest('hex')
  }

  /**
   * Firma ECDSA-SHA256 con chiave privata esplicita.
   * Retrocompatibilità — usato nei test legacy.
   * SICUREZZA: non loggare mai il privateKey.
   */
  async sign(documentHash: string, privateKey: string): Promise<string> {
    this.logger.debug('[sign] Firma ECDSA-SHA256 hash documento')
    try {
      const hashBuffer = Buffer.from(documentHash, 'hex')
      const signature = sign('sha256', hashBuffer, { key: privateKey, format: 'pem' })
      return signature.toString('base64')
    } catch (error) {
      this.logger.error('[sign] Firma fallita', error)
      throw new Error(`Firma fallita: ${error.message}`)
    }
  }

  /**
   * Verifica firma ECDSA.
   * Retrocompatibilità + usato da VerifySignaturesUseCase.
   */
  async verify(documentHash: string, signatureBase64: string, publicKey: string): Promise<boolean> {
    this.logger.debug('[verify] Verifica firma')
    // Delega al provider se disponibile
    if (this.signatureProvider) {
      return this.signatureProvider.verify(documentHash, signatureBase64, publicKey)
    }
    // Fallback interno
    return this.internalVerify(documentHash, signatureBase64, publicKey)
  }

  /** Hash SHA-256 della chiave pubblica (per certificate hash). */
  generateCertificateHash(publicKey: string): string {
    const hash = createHash('sha256').update(publicKey, 'utf8').digest('hex')
    this.logger.debug(`[certHash] ${hash.substring(0, 16)}...`)
    return hash
  }

  /**
   * Genera token marca temporale (mock interno).
   * Retrocompatibilità — usato nei test.
   * ATTIVARE: TSA_PROVIDER=rfc3161 per marca temporale qualificata.
   */
  async generateTimestampToken(documentHash: string): Promise<string> {
    if (this.tsaProvider) {
      const result = await this.tsaProvider.generateToken(documentHash)
      return result.token
    }
    return this.internalGenerateTimestampToken(documentHash)
  }

  // ===== Metodi privati (fallback interno) =====

  private async internalSign(document: any): Promise<SignatureProviderResult> {
    const { privateKey, publicKey } = await this.generateKeyPair()
    const documentHash = this.hashDocument(document)
    const signatureValue = await this.sign(documentHash, privateKey)
    const certificateHash = this.generateCertificateHash(publicKey)
    return {
      signatureValue,
      documentHash,
      certificateHash,
      publicKey,
      signatureMethod: 'ECDSA-SHA256',
      providerType: 'SANDBOX',
      isQualified: false,
    }
  }

  private async internalVerify(
    documentHash: string,
    signatureBase64: string,
    publicKey: string
  ): Promise<boolean> {
    try {
      const hashBuffer = Buffer.from(documentHash, 'hex')
      const signatureBuffer = Buffer.from(signatureBase64, 'base64')
      return verify('sha256', hashBuffer, { key: publicKey, format: 'pem' }, signatureBuffer)
    } catch {
      return false
    }
  }

  private async internalGenerateTimestampToken(documentHash: string): Promise<string> {
    const tokenData = {
      version: 1,
      policy: '1.2.3.4.1',
      messageImprint: { hashAlgorithm: 'sha256', hashedMessage: documentHash },
      serialNumber: Date.now(),
      genTime: new Date().toISOString(),
      accuracy: { seconds: 1 },
      tsa: 'CN=WasteFlow MOCK-TSA,O=WasteFlow-Sandbox,C=IT',
      _note: 'MOCK — ATTIVARE: TSA_PROVIDER=rfc3161',
    }
    return Buffer.from(JSON.stringify(tokenData)).toString('base64')
  }
}
