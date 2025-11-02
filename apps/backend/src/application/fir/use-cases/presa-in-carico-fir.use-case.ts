/**
 * Presa In Carico FIR Use Case - Application Layer
 * Business logic per presa in carico FIR da parte del trasportatore
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { PresaInCaricoFIRCommand } from '../commands/presa-in-carico-fir.command'

export class PresaInCaricoFIRUseCase {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(command: PresaInCaricoFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Create firma digitale trasportatore
    const firma: FirmaDigitale = {
      firmatario: command.firmaTrasportatore.firmatario,
      timestamp: new Date(),
      certificato: command.firmaTrasportatore.certificato,
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
}
