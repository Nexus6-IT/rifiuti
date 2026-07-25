/**
 * Apply Signature Use Case
 *
 * Orchestrates the digital signature workflow for FIR:
 * 1. Valida autenticazione e livello SPID
 * 2. Carica il FIR aggregate (con firme già presenti)
 * 3. Genera la firma crittografica via DigitalSignatureService (provider configurabile)
 * 4. Applica la firma all'aggregate (regole di business: ordine, unicità per ruolo)
 * 5. Persiste la firma in fir_signatures
 * 6. Emette eventi dominio per audit trail
 *
 * Business Rules:
 * - SPID Level 2+ obbligatorio (verificato dal SpidLevelGuard prima del controller)
 * - Autenticazione recente (<15 minuti) per la firma
 * - Ordine firma: Produttore → Trasportatore → Destinatario
 * - Ogni ruolo può firmare una sola volta
 * - FIR diventa immutabile dopo le tre firme
 *
 * FIRMA NON QUALIFICATA (sandbox, default):
 *  La firma prodotta è ECDSA P-256 effimera, senza valore legale a norma DM 59/2023.
 *  ATTIVARE: SIGNATURE_PROVIDER=qes con credenziali QTSP AgID per firma qualificata.
 */

import { Injectable, Inject } from '@nestjs/common'
import { DomainException } from '../../domain/shared/domain-exception'
import { FIRRepository, FIR_REPOSITORY } from '../../domain/fir/fir.repository'
import {
  DigitalSignature,
  SignatureRole,
  SignatureMethod,
} from '../../domain/fir/digital-signature.vo'
import { DigitalSignatureService } from './digital-signature.service'
import { LoggerService } from '../../core/logger/logger.service'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { FIRPartyResolver } from '../../infrastructure/signatures/fir-party.resolver'

@Injectable()
export class ApplySignatureUseCase {
  constructor(
    @Inject(FIR_REPOSITORY)
    private readonly firRepository: FIRRepository,
    private readonly signatureService: DigitalSignatureService,
    private readonly logger: LoggerService,
    private readonly eventEmitter: EventEmitter2,
    private readonly partyResolver: FIRPartyResolver
  ) {
    this.logger.setContext(ApplySignatureUseCase.name)
  }

  /**
   * Applica la firma digitale al FIR.
   *
   * @param params.userId - UUID utente dal JWT (per persistenza in fir_signatures)
   * @param params.spidLevel - Livello SPID dall'autenticazione
   * @param params.authenticatedAt - Timestamp autenticazione (freschezza <15 min)
   */
  async execute(params: {
    firId: string
    tenantId: string
    userId: string
    role: SignatureRole
    signerFiscalCode: string
    signerName: string
    spidLevel: number
    authenticatedAt: Date
  }): Promise<{
    success: boolean
    signature: {
      role: SignatureRole
      signerFiscalCode: string
      signerName: string
      signedAt: Date
      signatureMethod: string
      isQualified: boolean
    }
    firStatus: string
    isCompleted: boolean
  }> {
    this.logger.info(`Firma ${params.role} su FIR ${params.firId} da ${params.signerFiscalCode}`)

    // 1. Valida livello SPID (doppia verifica dopo guard)
    if (params.spidLevel < 2) {
      throw DomainException.businessRuleViolation(
        'INSUFFICIENT_SPID_LEVEL',
        'SPID Level 2 o superiore obbligatorio per la firma FIR (DM 59/2023). ' +
          'SANDBOX: livello simulato se claim assente nel JWT.'
      )
    }

    // 2. Valida freschezza autenticazione (15 min per operazioni firma)
    const authAgeMinutes = (Date.now() - params.authenticatedAt.getTime()) / 1000 / 60
    if (authAgeMinutes > 15) {
      throw DomainException.businessRuleViolation(
        'AUTHENTICATION_EXPIRED',
        'Autenticazione scaduta. Effettuare nuovamente il login per firmare ' +
          '(autenticazione SPID/CIE deve essere < 15 minuti).'
      )
    }

    // 3. Carica FIR (con firme già presenti)
    const fir = await this.firRepository.findById(params.firId)
    if (!fir) {
      throw DomainException.notFound('FIR', params.firId)
    }

    // 4. Verifica isolamento tenant
    if (fir.getTenantId && fir.getTenantId() !== params.tenantId) {
      throw DomainException.notFound('FIR', params.firId)
    }

    // 4-bis. Autorizzazione di ruolo-parte: chi firma DEVE essere la parte che
    //        quel ruolo designa sul FIR. Senza questo controllo un qualsiasi
    //        operatore del tenant potrebbe apporre tutte e tre le firme,
    //        vanificando la separazione dei ruoli del formulario (DM 59/2023).
    const parties = await this.partyResolver.findParties(params.firId)
    if (!parties) {
      throw DomainException.notFound('FIR', params.firId)
    }
    const expectedUserId = FIRPartyResolver.expectedUserIdFor(parties, params.role)
    if (!expectedUserId) {
      throw DomainException.businessRuleViolation(
        'ROLE_NOT_ASSIGNED',
        `Il ruolo ${params.role} non è ancora assegnato su questo FIR: ` +
          'designare la parte prima di firmare.'
      )
    }
    if (expectedUserId !== params.userId) {
      this.logger.warn(
        `Tentativo di firma ${params.role} su FIR ${params.firId} da utente ${params.userId} ` +
          `non designato per quel ruolo (atteso ${expectedUserId})`
      )
      throw DomainException.businessRuleViolation(
        'SIGNER_NOT_AUTHORIZED_FOR_ROLE',
        `Non sei la parte designata come ${params.role} su questo FIR: ` +
          'ogni ruolo può essere firmato solo dalla parte corrispondente.'
      )
    }

    // 5. Genera firma crittografica via provider configurato
    //    Il provider gestisce internamente la chiave privata (mai esposta)
    const firDocument = fir.toSignableDocument()
    const signatureData = await this.signatureService.createSignature(firDocument, params.userId)

    // 6. Crea il Value Object DigitalSignature
    //    Il DigitalSignature VO accetta solo l'algoritmo crittografico
    //    ('ECDSA-SHA256'/'RSA-SHA256'). Il provider sandbox etichetta invece il
    //    metodo come 'FIRMA-NON-QUALIFICATA' (label di qualificazione, non
    //    algoritmo): normalizziamo all'algoritmo effettivo così il VO non rigetta
    //    la firma. La non-qualificazione resta tracciata da isQualified=false.
    const signature = DigitalSignature.create({
      signerFiscalCode: params.signerFiscalCode,
      signerName: params.signerName,
      role: params.role,
      signatureValue: signatureData.signatureValue,
      signatureMethod: this.toDomainSignatureMethod(signatureData.signatureMethod),
      certificateHash: signatureData.certificateHash,
      documentHash: signatureData.documentHash,
      publicKey: signatureData.publicKey,
      timestampToken: signatureData.timestampToken,
    })

    // 7. Applica la firma all'aggregate (business rules: ordine, unicità)
    fir.applySignature(signature, params.signerFiscalCode, params.spidLevel)

    // 8. Persiste la firma
    await this.firRepository.save(fir)

    // 9. Emette eventi dominio per audit
    const events = fir.getDomainEvents()
    for (const event of events) {
      this.eventEmitter.emit(event.eventType, event)
    }
    fir.clearDomainEvents()

    this.logger.info(
      `Firma ${params.role} applicata su FIR ${params.firId}. ` +
        `Provider: ${signatureData.providerType}. Qualificata: ${signatureData.isQualified}. ` +
        `Nuovo stato: ${fir.getStatus()}`
    )

    return {
      success: true,
      signature: {
        role: params.role,
        signerFiscalCode: params.signerFiscalCode,
        signerName: params.signerName,
        signedAt: signature.getSignedAt(),
        signatureMethod: signature.getSignatureMethod(),
        isQualified: signatureData.isQualified,
      },
      firStatus: fir.getStatus(),
      isCompleted: fir.isImmutable(),
    }
  }

  /**
   * Normalizza il metodo firma restituito dal provider all'algoritmo
   * crittografico accettato dal DigitalSignature VO. Il sandbox restituisce
   * 'FIRMA-NON-QUALIFICATA' (label di qualificazione): il suo algoritmo effettivo
   * è ECDSA-SHA256, quindi è il default di fallback.
   */
  private toDomainSignatureMethod(providerMethod: string): SignatureMethod {
    if (providerMethod === 'ECDSA-SHA256' || providerMethod === 'RSA-SHA256') {
      return providerMethod
    }
    return 'ECDSA-SHA256'
  }
}
