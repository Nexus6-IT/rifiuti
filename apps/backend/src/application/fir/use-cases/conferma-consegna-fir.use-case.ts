/**
 * Conferma Consegna FIR Use Case - Application Layer
 * Business logic per conferma consegna FIR da parte del destinatario
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { ConfermaConsegnaFIRCommand } from '../commands/conferma-consegna-fir.command'

export class ConfermaConsegnaFIRUseCase {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(command: ConfermaConsegnaFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Create firma digitale destinatario
    const firma: FirmaDigitale = {
      firmatario: command.firmaDestinatario.firmatario,
      timestamp: new Date(),
      certificato: command.firmaDestinatario.certificato,
    }

    // 3. Execute domain method (business logic)
    try {
      fir.confermaConsegna(command.pesoEffettivo, firma)
    } catch (error) {
      return Result.fail<FIR>(`Failed to confirm delivery of FIR: ${error.message}`)
    }

    // 4. Persist changes
    await this.firRepository.save(fir)

    // 5. Publish domain events (TODO: event bus integration)
    // await this.eventBus.publishAll(fir.domainEvents)
    // fir.clearDomainEvents()

    return Result.ok<FIR>(fir)
  }
}
