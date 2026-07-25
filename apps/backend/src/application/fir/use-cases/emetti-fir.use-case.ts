/**
 * Emetti FIR Use Case - Application Layer
 * Business logic per emissione FIR con numero progressivo e firma
 *
 * Task 4 (pipeline P3): la firma del produttore non è più una costante
 * ('FIRMA-NON-QUALIFICATA') ma una firma crittografica reale, prodotta dal
 * sottosistema di firma digitale (DigitalSignatureService) sul documento
 * canonico del FIR (fir.aggregate.ts — l'aggregate "crittografico", separato
 * dal ciclo di vita qui gestito: si collegano i due, non si fondono).
 *
 * Fail-closed: se la firma non può essere prodotta (es. provider non
 * configurato, vedi Task 1), la transizione di stato NON avviene — il FIR
 * resta in BOZZA. Una transizione senza la firma richiesta è un difetto di
 * conformità, non una degradazione accettabile.
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { EmettiFIRCommand } from '../commands/emetti-fir.command'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'

export class EmettiFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cryptoFirRepository: CryptoFIRRepository,
    private readonly signatureService: DigitalSignatureService
  ) {}

  async execute(command: EmettiFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate (ciclo di vita)
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Firma crittografica del produttore, PRIMA di applicare la transizione:
    //    se fallisce lo use-case esce qui, il FIR resta BOZZA (fail-closed).
    //    Firmato intenzionalmente mentre il FIR è ancora BOZZA (firNumber non
    //    assegnato): il documento canonico esclude firNumber, quindi la firma
    //    resta verificabile dopo l'emissione (vedi toSignableDocument).
    let firma: FirmaDigitale
    try {
      firma = await this.firmaProduttore(command)
    } catch (error) {
      return Result.fail<FIR>(`Firma produttore non riuscita: ${error.message}`)
    }

    // 3. Generate numero progressivo (usa tenantId, non produttoreId)
    const anno = new Date().getFullYear()
    const numeroProgressivo = await this.firRepository.generateNumeroProgressivo(
      fir.tenantId ?? fir.produttoreId,
      anno
    )

    // 4. Execute domain method (business logic)
    try {
      fir.emetti(numeroProgressivo, firma)
    } catch (error) {
      return Result.fail<FIR>(`Failed to emit FIR: ${error.message}`)
    }

    // 5. Persist changes
    await this.firRepository.save(fir)

    // 6. Publish domain events (TODO: event bus integration)
    // await this.eventBus.publishAll(fir.domainEvents)
    // fir.clearDomainEvents()

    return Result.ok<FIR>(fir)
  }

  /**
   * Produce la firma crittografica del produttore invocando il sottosistema
   * di firma digitale sul documento canonico dello stesso FIR (stessa riga
   * fisica, letta tramite l'aggregate crittografico dedicato).
   */
  private async firmaProduttore(command: EmettiFIRCommand): Promise<FirmaDigitale> {
    const cryptoFir = await this.cryptoFirRepository.findById(command.firId)
    if (!cryptoFir) {
      throw new Error(`Documento firmabile non disponibile per FIR ${command.firId}`)
    }

    const document = cryptoFir.toSignableDocument()
    const signatureData = await this.signatureService.createSignature(document, command.userId)

    return {
      firmatario: command.firmatario,
      timestamp: new Date(),
      certificato: signatureData.signatureValue,
      userId: command.userId,
      documentHash: signatureData.documentHash,
      certificateHash: signatureData.certificateHash,
      publicKey: signatureData.publicKey,
      timestampToken: signatureData.timestampToken,
      signatureMethod: signatureData.signatureMethod,
      isQualified: signatureData.isQualified,
    }
  }
}
