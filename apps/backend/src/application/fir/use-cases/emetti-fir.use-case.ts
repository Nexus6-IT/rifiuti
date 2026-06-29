/**
 * Emetti FIR Use Case - Application Layer
 * Business logic per emissione FIR con numero progressivo e firma
 */

import { FIR, FirmaDigitale } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { EmettiFIRCommand } from '../commands/emetti-fir.command'

export class EmettiFIRUseCase {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(command: EmettiFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Generate numero progressivo (usa tenantId, non produttoreId)
    const anno = new Date().getFullYear()
    const numeroProgressivo = await this.firRepository.generateNumeroProgressivo(
      fir.tenantId ?? fir.produttoreId,
      anno
    )

    // 3. Create firma digitale
    const firma: FirmaDigitale = {
      firmatario: command.firmaProduttore.firmatario,
      timestamp: new Date(),
      certificato: command.firmaProduttore.certificato,
    }

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
}
