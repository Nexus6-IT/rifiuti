import { Injectable } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
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
  featureTolte: unknown
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
  featureTolte: unknown
  aziendeLimit: number | null
  ragioneSociale: string
}

/** Stati dell'abbonamento in cui un'azienda opera: i job periodici saltano le altre. */
export const STATI_ABBONAMENTO_OPERATIVI: SubscriptionStatus[] = ['ACTIVE', 'TRIAL']

/**
 * Condizione (da usare come `{ OR: ... }` in un `where` su `Tenant`) che dice: l'abbonamento del
 * GRUPPO e' operativo. Lo stato che conta e' quello della radice: una radice lo ha in tabella, una
 * figlia ha una colonna propria ma NON autorevole (vedi `ContrattoGruppoService`), quindi per le
 * figlie si guarda la madre. Una sola query con join, come `caricaContrattiAziende`.
 */
export const ABBONAMENTO_OPERATIVO_DEL_GRUPPO: Prisma.TenantWhereInput[] = [
  { parentTenantId: null, subscriptionStatus: { in: STATI_ABBONAMENTO_OPERATIVI } },
  { madre: { subscriptionStatus: { in: STATI_ABBONAMENTO_OPERATIVI } } },
]

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

  /**
   * Contratto effettivo di piu' aziende (radici o figlie) in UNA sola query, per id: la madre
   * e' in join, come in `caricaContratto`. Serve ai job che scorrono molte aziende senza N+1.
   * Le aziende non trovate non compaiono nella mappa (chi chiama le tratta come senza contratto).
   */
  async caricaContrattiAziende(
    tenantIds: readonly string[]
  ): Promise<Map<string, ContrattoEffettivo>> {
    if (tenantIds.length === 0) return new Map()
    const righe = await this.prisma.tenant.findMany({
      where: { id: { in: [...tenantIds] } },
      select: {
        ...ContrattoGruppoService.CAMPI_CONTRATTO,
        madre: { select: ContrattoGruppoService.CAMPI_CONTRATTO },
      },
    })
    return new Map(righe.map(r => [r.id, this.toContrattoEffettivo(r.madre ?? r)]))
  }

  /**
   * Contratti di piu' radici in una sola query, per id (nessun N+1 negli elenchi).
   * Le radici non trovate non compaiono nella mappa.
   */
  async caricaContrattiRadici(
    radiciIds: readonly string[]
  ): Promise<Map<string, ContrattoEffettivo>> {
    if (radiciIds.length === 0) return new Map()
    const righe = await this.prisma.tenant.findMany({
      where: { id: { in: [...radiciIds] } },
      select: ContrattoGruppoService.CAMPI_CONTRATTO,
    })
    return new Map(righe.map(r => [r.id, this.toContrattoEffettivo(r)]))
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
    featureTolte: true,
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
      featureTolte: radice.featureTolte,
      aziendeLimit: radice.aziendeLimit,
      ragioneSociale: radice.ragioneSociale,
    }
  }
}
