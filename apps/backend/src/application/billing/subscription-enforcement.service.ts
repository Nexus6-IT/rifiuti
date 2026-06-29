/**
 * SubscriptionEnforcementService
 *
 * Applica i limiti di piano per ogni tenant:
 *  - firLimitPerMonth: blocco creazione FIR oltre il limite mensile.
 *  - userLimitTotal: blocco creazione utenti oltre la quota (già in UserAdminService;
 *    qui esposto come metodo condiviso).
 *  - subscriptionStatus SUSPENDED: blocco operazioni di scrittura (FIR, anagrafiche).
 *  - subscriptionEnd scaduto: tratta il tenant come EXPIRED.
 */

import { Injectable, ForbiddenException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

@Injectable()
export class SubscriptionEnforcementService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifica che il tenant non sia SUSPENDED o EXPIRED.
   * Da chiamare prima di qualsiasi operazione di scrittura significativa
   * (creazione FIR, anagrafiche, movimenti registro).
   *
   * @throws ForbiddenException con messaggio localizzato in italiano.
   */
  async assertNotSuspended(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        subscriptionStatus: true,
        subscriptionEnd: true,
        ragioneSociale: true,
      },
    });

    if (!tenant) return; // Tenant non trovato: lascia che altri meccanismi gestiscano (es. RLS)

    // Scadenza: se subscriptionEnd è nel passato, il tenant è scaduto.
    if (
      tenant.subscriptionEnd &&
      tenant.subscriptionEnd < new Date() &&
      tenant.subscriptionStatus === SubscriptionStatus.ACTIVE
    ) {
      throw new ForbiddenException(
        "L'abbonamento è scaduto. Rinnova il piano per continuare a operare.",
      );
    }

    if (tenant.subscriptionStatus === SubscriptionStatus.SUSPENDED) {
      throw new ForbiddenException(
        "L'account è sospeso (pagamento non ricevuto o non autorizzato). " +
          'Contatta il supporto o accedi alla pagina Abbonamento per ripristinare il servizio.',
      );
    }

    if (tenant.subscriptionStatus === SubscriptionStatus.EXPIRED) {
      throw new ForbiddenException(
        "L'abbonamento è scaduto. Accedi alla pagina Abbonamento per rinnovare il piano.",
      );
    }
  }

  /**
   * Verifica il limite mensile FIR prima della creazione.
   * Conta i FIR creati nel mese solare corrente (non cancellati).
   *
   * @throws ForbiddenException se il limite è raggiunto, con messaggio chiaro.
   */
  async assertFirLimitNotReached(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { firLimitPerMonth: true, subscriptionTier: true },
    });

    if (!tenant) return;

    // Limite 0 = illimitato (convenzione interna, ENTERPRISE).
    if (tenant.firLimitPerMonth === 0) return;

    // Inizio e fine del mese solare corrente.
    const now = new Date();
    const meseInizio = new Date(now.getFullYear(), now.getMonth(), 1);
    const meseFine = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const count = await this.prisma.fIR.count({
      where: {
        tenantId,
        createdAt: { gte: meseInizio, lt: meseFine },
        // Non contare i FIR annullati (status CANCELLED) nel limite mensile.
        status: { not: 'CANCELLED' },
      },
    });

    if (count >= tenant.firLimitPerMonth) {
      throw new ForbiddenException(
        `Limite mensile FIR raggiunto (${count}/${tenant.firLimitPerMonth}). ` +
          "Aggiorna il piano per creare più formulari o attendi il prossimo mese.",
      );
    }
  }

  /**
   * Verifica il limite totale utenti prima della creazione.
   * I SUPER_ADMIN e gli ADMIN non contano nel limite (solo OPERATOR/VIEWER).
   *
   * Nota: la stessa logica è applicata in UserAdminService; questo metodo
   * è pensato per riuso e test unitari.
   *
   * @throws ForbiddenException se il limite è raggiunto.
   */
  async assertUserLimitNotReached(tenantId: string, newRole: string): Promise<void> {
    // ADMIN non conta nel limite per design del sistema.
    if (newRole === 'ADMIN' || newRole === 'SUPER_ADMIN') return;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { userLimitTotal: true },
    });

    if (!tenant) return;

    // Limite 0 = illimitato (convenzione interna, ENTERPRISE).
    if (tenant.userLimitTotal === 0) return;

    const nonAdminCount = await this.prisma.user.count({
      where: {
        tenantId,
        role: { notIn: ['ADMIN', 'SUPER_ADMIN'] },
      },
    });

    if (nonAdminCount >= tenant.userLimitTotal) {
      throw new ForbiddenException(
        `Limite utenti del piano raggiunto (${nonAdminCount}/${tenant.userLimitTotal}). ` +
          "Aggiorna il piano per aggiungere più utenti.",
      );
    }
  }
}
