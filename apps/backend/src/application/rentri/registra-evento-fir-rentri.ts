import { LoggerService } from '../../core/logger/logger.service'
import { IEventiFirRentriRepository, NuovoEventoFirRentri } from './eventi-fir-rentri.port'

/**
 * Scrive un evento nello storico del viaggio SENZA mai mascherare l'esito dell'operazione: lo storico e'
 * un'aggiunta di tracciabilita', e un suo errore (database, vincolo) si registra nel log e si ingoia.
 */
export async function registraEventoFirRentri(
  eventi: IEventiFirRentriRepository,
  logger: LoggerService,
  evento: NuovoEventoFirRentri
): Promise<void> {
  try {
    await eventi.registra(evento)
  } catch (errore) {
    logger.error('Scrittura dello storico RENTRI non riuscita', errore as Error, {
      firId: evento.firId,
      tenantId: evento.tenantId,
      operazione: evento.operazione,
      esito: evento.esito,
    })
  }
}
