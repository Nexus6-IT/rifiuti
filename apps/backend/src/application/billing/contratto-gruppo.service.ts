import { Injectable } from '@nestjs/common'
import { SubscriptionStatus, SubscriptionTier, Tenant } from '@prisma/client'
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

  /** Contratto effettivo, o null se il tenant non esiste. */
  async caricaContratto(tenantId: string): Promise<ContrattoEffettivo | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    })
    if (!tenant) return null

    // Se il tenant è radice, usalo direttamente
    if (!tenant.parentTenantId) {
      return this.toContrattoEffettivo(tenant)
    }

    // Altrimenti, leggi la madre
    const radice = await this.prisma.tenant.findUnique({
      where: { id: tenant.parentTenantId },
    })
    if (!radice) return null

    return this.toContrattoEffettivo(radice)
  }

  private toContrattoEffettivo(radice: Tenant): ContrattoEffettivo {
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
