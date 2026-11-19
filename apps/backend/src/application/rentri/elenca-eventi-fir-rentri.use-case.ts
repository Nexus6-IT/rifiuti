import { Injectable } from '@nestjs/common'
import { IFIRRepository } from '../../domain/fir/repositories/fir-repository.interface'
import { DomainException } from '../../domain/shared/domain-exception'
import { EventoFirRentri, IEventiFirRentriRepository } from './eventi-fir-rentri.port'

/**
 * Storico delle operazioni del viaggio di un FIR (FIR in viaggio, P2). Sola lettura, nessuna chiamata
 * all'ente. Il FIR deve esistere ed essere dell'azienda: un id di un'altra azienda e' un 404 per la RLS e
 * un `UNAUTHORIZED` per il controllo esplicito, mai l'elenco altrui.
 */
@Injectable()
export class ElencaEventiFirRentriUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly eventi: IEventiFirRentriRepository
  ) {}

  async execute(firId: string, tenantId: string): Promise<EventoFirRentri[]> {
    const fir = await this.firRepository.findById(firId)
    if (!fir) {
      throw DomainException.notFound('FIR', firId)
    }
    if (fir.tenantId !== tenantId) {
      throw new DomainException('Unauthorized access to FIR', 'UNAUTHORIZED')
    }
    return this.eventi.elenca(tenantId, firId)
  }
}
