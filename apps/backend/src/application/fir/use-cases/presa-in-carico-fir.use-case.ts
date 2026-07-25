/**
 * Presa In Carico FIR Use Case - Application Layer
 * Business logic per presa in carico FIR da parte del trasportatore
 *
 * Task 4 (pipeline P3): la firma del trasportatore è una firma crittografica
 * reale prodotta dal sottosistema di firma digitale, non più una costante.
 * Fail-closed: se la firma non può essere prodotta la transizione non
 * avviene — il FIR resta EMESSO.
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { PresaInCaricoFIRCommand } from '../commands/presa-in-carico-fir.command'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'

export class PresaInCaricoFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cryptoFirRepository: CryptoFIRRepository,
    private readonly signatureService: DigitalSignatureService
  ) {}

  async execute(command: PresaInCaricoFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Firma crittografica del trasportatore, PRIMA di applicare la
    //    transizione: se fallisce lo use-case esce qui, il FIR resta EMESSO
    //    (fail-closed) — nessuna presa in carico senza firma valida.
    let firma: FirmaDigitale
    try {
      firma = await this.firmaTrasportatore(command)
    } catch (error) {
      return Result.fail<FIR>(`Firma trasportatore non riuscita: ${error.message}`)
    }

    // 3. Execute domain method (business logic)
    try {
      const dataPresaCarico = new Date()
      fir.presaInCarico(dataPresaCarico, firma)
    } catch (error) {
      return Result.fail<FIR>(`Failed to take charge of FIR: ${error.message}`)
    }

    // 4. Persist changes
    await this.firRepository.save(fir)

    // 5. Publish domain events (TODO: event bus integration)
    // await this.eventBus.publishAll(fir.domainEvents)
    // fir.clearDomainEvents()

    return Result.ok<FIR>(fir)
  }

  /**
   * Produce la firma crittografica del trasportatore invocando il
   * sottosistema di firma digitale sul documento canonico dello stesso FIR.
   */
  private async firmaTrasportatore(command: PresaInCaricoFIRCommand): Promise<FirmaDigitale> {
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
