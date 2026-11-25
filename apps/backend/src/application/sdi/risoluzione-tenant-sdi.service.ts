import { Injectable } from '@nestjs/common'
import type { CodiceProviderSdi } from '../../domain/fatturazione/sdi/codici'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'

export interface TenantSdiRisolto {
  tenantId: string
  provider: CodiceProviderSdi
}

/**
 * Risoluzione dell'azienda dal token del webhook SDI (4.5c, piano §4.5).
 *
 * Prima della lettura l'azienda e' IGNOTA (il provider chiama senza utente): una `findUnique` per
 * hash col client di sistema (`wasteflow_sistema`, BYPASSRLS) e nient'altro. Poi tutto il lavoro
 * gira nel contesto dell'azienda trovata, col ruolo applicativo e la RLS. Questo e' l'UNICO punto
 * del modulo SDI che usa il client di sistema per il webhook: non aggiungere altre query qui.
 * Riceve solo l'hash SHA-256 (mai il token in chiaro).
 */
@Injectable()
export class RisoluzioneTenantSdiService {
  constructor(private readonly sistema: PrismaSistemaService) {}

  /** Azienda e provider della configurazione con quel `webhook_token_sha256`, o null. */
  async daToken(tokenSha256: string): Promise<TenantSdiRisolto | null> {
    const r = await this.sistema.configurazioneSdi.findUnique({
      where: { webhookTokenSha256: tokenSha256 },
      select: { tenantId: true, provider: true },
    })
    return r ? { tenantId: r.tenantId, provider: r.provider as CodiceProviderSdi } : null
  }
}
