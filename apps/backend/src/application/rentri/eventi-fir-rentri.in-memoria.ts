import { randomUUID } from 'crypto'
import {
  EventoFirRentri,
  IEventiFirRentriRepository,
  NuovoEventoFirRentri,
} from './eventi-fir-rentri.port'

/** Implementazione in memoria per i test unitari. */
export class EventiFirRentriInMemoria extends IEventiFirRentriRepository {
  readonly righe: EventoFirRentri[] = []

  async registra(evento: NuovoEventoFirRentri): Promise<EventoFirRentri> {
    const riga: EventoFirRentri = { ...evento, id: randomUUID(), createdAt: new Date() }
    this.righe.push(riga)
    return riga
  }

  async elenca(tenantId: string, firId: string, limite = 200): Promise<EventoFirRentri[]> {
    return this.righe
      .filter(r => r.tenantId === tenantId && r.firId === firId)
      .slice()
      .reverse()
      .slice(0, limite)
  }
}
