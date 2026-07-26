import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'

/**
 * Conferma Legame RENTRI — Use Case
 *
 * Chiude il ciclo aperto dalla modalità IBRIDA (v.
 * `TrasmettiFIRSecondoModalitaUseCase` + `FIR.proporreLegameRENTRI`): una
 * trasmissione partita da sola ha ottenuto un numero ufficiale, ma il FIR non
 * è ancora "legato" finché un utente non lo conferma esplicitamente. Senza
 * questo use case la modalità IBRIDA sarebbe un aggancio che sembra esserci
 * (la trasmissione parte, il numero arriva) ma non si conclude mai — lo
 * stesso difetto che questo task doveva evitare.
 */
@Injectable()
export class ConfermaLegameRENTRIUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('ConfermaLegameRENTRIUseCase')
  }

  async execute(
    firId: string,
    tenantId: string,
    correlationId?: string
  ): Promise<ConfermaLegameRENTRIResult> {
    const fir = await this.firRepository.findById(firId)

    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }

    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }

    if (!fir.rentriNumeroFirProposto) {
      throw DomainException.businessRuleViolation(
        'NO_PENDING_RENTRI_LINK',
        'Nessun legame RENTRI in attesa di conferma per questo FIR'
      )
    }

    fir.confermaLegameRENTRI(correlationId)
    await this.firRepository.save(fir)

    this.logger.info('Legame RENTRI confermato esplicitamente dall’utente', {
      firId,
      tenantId,
      numeroFir: fir.rentriNumeroFir,
    })

    return { numeroFir: fir.rentriNumeroFir as string }
  }
}

export interface ConfermaLegameRENTRIResult {
  numeroFir: string
}
