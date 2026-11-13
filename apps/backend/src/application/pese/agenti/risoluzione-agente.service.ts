import { Injectable } from '@nestjs/common'
import { PrismaSistemaService } from '../../../infrastructure/persistence/prisma-sistema.service'

export type StatoAgenteRisolto = 'IN_ATTESA' | 'ATTIVO' | 'REVOCATO'

export interface AgenteRisolto {
  id: string
  tenantId: string
  stato: StatoAgenteRisolto
}

/**
 * Risoluzione dell'azienda dal token (o dal codice) di un agente di pesa (roadmap §9 punto 8).
 *
 * Prima della lettura l'azienda e' IGNOTA: una `findUnique` per hash col client di sistema
 * (`wasteflow_sistema`, BYPASSRLS) e nient'altro. Poi tutto il lavoro gira nel contesto
 * dell'azienda trovata, col ruolo applicativo e la RLS. Questo e' l'UNICO punto delle pese che usa
 * il client di sistema: non aggiungere altre query qui.
 * Riceve solo hash SHA-256 (mai il token o il codice in chiaro).
 */
@Injectable()
export class RisoluzioneAgenteService {
  constructor(private readonly sistema: PrismaSistemaService) {}

  /** Agente con quel `token_sha256`, o null. Un agente REVOCATO mantiene il token: si riconosce per il 403. */
  async daToken(tokenSha256: string): Promise<AgenteRisolto | null> {
    return this.sistema.agentePesa.findUnique({
      where: { tokenSha256 },
      select: { id: true, tenantId: true, stato: true },
    })
  }

  /** Agente con quel `codice_sha256` (abbinamento). La scadenza la verifica lo scambio condizionato. */
  async daCodice(codiceSha256: string): Promise<AgenteRisolto | null> {
    return this.sistema.agentePesa.findUnique({
      where: { codiceSha256 },
      select: { id: true, tenantId: true, stato: true },
    })
  }
}
