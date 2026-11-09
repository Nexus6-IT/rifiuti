import { Injectable } from '@nestjs/common'
import { SubscriptionTier } from '@prisma/client'
import { effectiveFeatures, type FeatureKey } from './feature-catalog'
import { ContrattoGruppoService } from '../billing/contratto-gruppo.service'

/** Piano e moduli di un'azienda, dal contratto della radice del gruppo. */
export interface PianoAzienda {
  moduli: FeatureKey[]
  tier: SubscriptionTier
  userLimitTotal: number
}

/**
 * ModuliAttiviService — UNICA fonte dei moduli attivi di un'azienda.
 *
 * Moduli = piano + `featureFlags` - `featureTolte`, letti dal contratto della RADICE
 * (una figlia ha i moduli della madre). Lo usano `GET /me/features` (cio' che il frontend
 * mostra) e `ModuloAttivoInterceptor` (cio' che il backend consente): le due viste non
 * possono divergere. Nessuna cache: un cambio di piano vale dalla richiesta successiva.
 * Un errore del database si propaga: la decisione (503) spetta a chi chiama.
 */
@Injectable()
export class ModuliAttiviService {
  constructor(private readonly contratto: ContrattoGruppoService) {}

  /** Moduli, piano e limite utenti; null se l'azienda non esiste. */
  async pianoAzienda(tenantId: string): Promise<PianoAzienda | null> {
    const contratto = await this.contratto.caricaContratto(tenantId)
    if (!contratto) return null
    return {
      moduli: effectiveFeatures(contratto),
      tier: contratto.subscriptionTier,
      userLimitTotal: contratto.userLimitTotal,
    }
  }

  /** Moduli attivi; azienda assente: nessuno (fail-closed). */
  async moduliAttivi(tenantId: string): Promise<FeatureKey[]> {
    return (await this.pianoAzienda(tenantId))?.moduli ?? []
  }

  /**
   * Fra `tenantIds`, quelle con `modulo` attivo: UNA sola query per tutto l'elenco (nessun N+1),
   * per i job che scorrono molte aziende. Una figlia vale per i moduli della madre; un'azienda
   * inesistente e' esclusa (fail-closed); un errore del database si propaga.
   */
  async tenantConModulo(tenantIds: readonly string[], modulo: FeatureKey): Promise<Set<string>> {
    const contratti = await this.contratto.caricaContrattiAziende(tenantIds)
    const attive = new Set<string>()
    for (const [id, contratto] of contratti) {
      if (effectiveFeatures(contratto).includes(modulo)) attive.add(id)
    }
    return attive
  }
}
