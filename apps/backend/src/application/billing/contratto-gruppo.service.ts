import { Injectable } from '@nestjs/common'
import { SubscriptionStatus, SubscriptionTier } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

/**
 * Contratto effettivo di un'azienda: sempre quello della radice del gruppo.
 */
export interface ContrattoEffettivo {
  tenantIdRadice: string
  subscriptionTier: SubscriptionTier
  subscriptionStatus: SubscriptionStatus
  subscriptionEnd: Date | null
  firLimitPerMonth: number
  userLimitTotal: number
  featureFlags: unknown
  aziendeLimit: number | null
  ragioneSociale: string
}

/** Riga letta dal database con i soli campi del contratto. */
interface RigaContratto {
  id: string
  subscriptionTier: SubscriptionTier
  subscriptionStatus: SubscriptionStatus
  subscriptionEnd: Date | null
  firLimitPerMonth: number
  userLimitTotal: number
  featureFlags: unknown
  aziendeLimit: number | null
  ragioneSociale: string
}

/**
 * ContrattoGruppoService — UNICO punto da cui si legge il contratto.
 *
 * Piano, stato abbonamento, limiti, feature e identificativi Stripe vivono
 * solo sull'azienda madre: una figlia li ha in tabella (la migrazione e'
 * additiva) ma NON sono autorevoli. Chi li legge direttamente da una figlia
 * ottiene valori che nessuno mantiene aggiornati.
 *
 * La gerarchia e' a un solo livello, quindi la risalita e' un singolo salto:
 * nessuna ricorsione, nessuna query ricorsiva.
 */
@Injectable()
export class ContrattoGruppoService {
  constructor(private readonly prisma: PrismaService) {}

  /** Id della radice del gruppo: il tenant stesso se e' gia' radice. */
  async risolviRadice(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, parentTenantId: true },
    })
    if (!tenant) return tenantId
    return tenant.parentTenantId ?? tenant.id
  }

  /**
   * Contratto effettivo, o null se il tenant non esiste.
   *
   * Una sola query: i soli campi del contratto, con la madre gia' in join.
   * E' un percorso caldo (ogni creazione di FIR passa da assertNotSuspended +
   * assertFirLimitNotReached): leggere la riga intera, e per giunta due volte
   * per le figlie, costava quattro select complete per FIR.
   */
  async caricaContratto(tenantId: string): Promise<ContrattoEffettivo | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        ...ContrattoGruppoService.CAMPI_CONTRATTO,
        madre: { select: ContrattoGruppoService.CAMPI_CONTRATTO },
      },
    })
    if (!tenant) return null

    // Il contratto e' quello della madre; se madre non c'e', il tenant e' radice.
    return this.toContrattoEffettivo(tenant.madre ?? tenant)
  }

  /** Colonne che compongono il contratto: nient'altro va letto. */
  private static readonly CAMPI_CONTRATTO = {
    id: true,
    subscriptionTier: true,
    subscriptionStatus: true,
    subscriptionEnd: true,
    firLimitPerMonth: true,
    userLimitTotal: true,
    featureFlags: true,
    aziendeLimit: true,
    ragioneSociale: true,
  } as const

  private toContrattoEffettivo(radice: RigaContratto): ContrattoEffettivo {
    return {
      tenantIdRadice: radice.id,
      subscriptionTier: radice.subscriptionTier,
      subscriptionStatus: radice.subscriptionStatus,
      subscriptionEnd: radice.subscriptionEnd,
      firLimitPerMonth: radice.firLimitPerMonth,
      userLimitTotal: radice.userLimitTotal,
      featureFlags: radice.featureFlags,
      aziendeLimit: radice.aziendeLimit,
      ragioneSociale: radice.ragioneSociale,
    }
  }
}
