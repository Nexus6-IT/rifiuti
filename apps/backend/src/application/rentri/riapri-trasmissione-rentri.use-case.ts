import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { DomainError } from '../../core/domain/errors'
import { DomainException } from '../../domain/shared/domain-exception'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'

/**
 * Riapre una trasmissione RENTRI ferma per verifica manuale (trasmissione
 * incerta, esito senza numero_fir): è la conferma esplicita di un
 * amministratore, data dopo aver controllato il portale.
 *
 * Si consuma qui, in modo sincrono nella richiesta HTTP, e NON nel job: il job
 * accodato subito dopo è un job normale, senza flag. Se la conferma viaggiasse
 * nel `data` del job, ogni retry di BullMQ la rileggerebbe e potrebbe riaprire
 * (e rifare una POST) senza che nessuno l'abbia chiesto di nuovo.
 *
 * Un FIR di un'altra azienda è NOT_FOUND come uno inesistente: l'esistenza non
 * si rivela fuori dal tenant.
 */
@Injectable()
export class RiapriTrasmissioneRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('RiapriTrasmissioneRentriUseCase')
  }

  async execute(firId: string, tenantId: string): Promise<void> {
    const fir = await this.firRepository.findById(firId)
    if (!fir || fir.tenantId !== tenantId) {
      throw DomainException.notFound('FIR', firId)
    }

    try {
      fir.riapriTrasmissioneDopoVerifica()
    } catch (e) {
      if (e instanceof DomainError || e instanceof DomainException) {
        throw new DomainException(e.message, 'RIAPERTURA_RENTRI_NON_CONSENTITA')
      }
      throw e
    }
    await this.firRepository.save(fir)

    this.logger.info('Trasmissione RENTRI riaperta dopo verifica manuale', { firId, tenantId })
  }
}
