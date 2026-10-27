/**
 * Conferma Consegna FIR Use Case - Application Layer
 * Business logic per conferma consegna FIR da parte del destinatario
 *
 * Task 4 (pipeline P3): la firma del destinatario è una firma crittografica
 * reale prodotta dal sottosistema di firma digitale, non più una costante.
 * Fail-closed: se la firma non può essere prodotta la transizione non
 * avviene — il FIR resta IN_TRANSITO.
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { ConfermaConsegnaFIRCommand } from '../commands/conferma-consegna-fir.command'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'

export class ConfermaConsegnaFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cryptoFirRepository: CryptoFIRRepository,
    private readonly signatureService: DigitalSignatureService
  ) {}

  async execute(command: ConfermaConsegnaFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Firma crittografica del destinatario, PRIMA di applicare la
    //    transizione: se fallisce lo use-case esce qui, il FIR resta
    //    IN_TRANSITO (fail-closed) — nessuna consegna senza firma valida.
    let firma: FirmaDigitale
    try {
      firma = await this.firmaDestinatario(command)
    } catch (error) {
      return Result.fail<FIR>(`Firma destinatario non riuscita: ${error.message}`)
    }

    // 3. Execute domain method (business logic)
    try {
      fir.confermaConsegna(command.pesoEffettivo, firma)
    } catch (error) {
      return Result.fail<FIR>(`Failed to confirm delivery of FIR: ${error.message}`)
    }

    // 4. Persist changes
    // Scrittura condizionata alla versione letta: un'altra operazione concorrente => 409.
    await this.firRepository.save(fir, { verificaVersione: true })

    // 5. Publish domain events (TODO: event bus integration)
    // await this.eventBus.publishAll(fir.domainEvents)
    // fir.clearDomainEvents()

    return Result.ok<FIR>(fir)
  }

  /**
   * Produce la firma crittografica del destinatario invocando il
   * sottosistema di firma digitale sul documento canonico dello stesso FIR.
   */
  private async firmaDestinatario(command: ConfermaConsegnaFIRCommand): Promise<FirmaDigitale> {
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
