import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'

export interface VistaGruppo {
  totalTenants: number
  totalPendingFirs: number
  totalRentriSyncFailures: number
  pendingFirsByClient: Array<{ tenantId: string; tenantName: string; pendingCount: number }>
  upcomingDeadlines: Array<{ tenantId: string; tenantName: string; year: number; status: string }>
  recentActivity: Array<{
    tenantId: string
    tenantName: string
    activityType: string
    activityDate: Date
    description: string
  }>
}

/**
 * Vista d'insieme del gruppo: aggrega le aziende FIGLIE della madre.
 *
 * E' l'unico punto dell'applicazione che legge piu' tenant in una sola
 * richiesta, e lo fa esplicitamente sull'elenco dei figli: non allarga il
 * contesto: per operare su un'azienda bisogna comunque selezionarla.
 *
 * Usa Prisma e non SQL raw: la versione precedente interrogava colonne
 * inesistenti (t.name, m.type, m.deadline_date) e falliva a runtime.
 */
@Injectable()
export class GetAggregatedDashboardHandler {
  constructor(private readonly prisma: PrismaService) {}

  async execute(query: { tenantIdMadre: string }): Promise<VistaGruppo> {
    const figlie = await this.prisma.tenant.findMany({
      where: { parentTenantId: query.tenantIdMadre },
      select: { id: true, ragioneSociale: true },
      orderBy: { ragioneSociale: 'asc' },
    })

    if (figlie.length === 0) {
      return {
        totalTenants: 0,
        totalPendingFirs: 0,
        totalRentriSyncFailures: 0,
        pendingFirsByClient: [],
        upcomingDeadlines: [],
        recentActivity: [],
      }
    }

    const ids = figlie.map(f => f.id)
    const nome = new Map(figlie.map(f => [f.id, f.ragioneSociale]))

    const [perFir, mud, sincroniaFallite, ultimiFir] = await Promise.all([
      this.prisma.fIR.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { in: ids },
          // "Da trasmettere" = FIR non ancora completato: tutti gli stati
          // precedenti a COMPLETED/SYNCED_TO_RENTRI, esclusi quelli annullati
          // (CANCELLED). Il brief originale usava solo ['DRAFT',
          // 'AWAITING_CARRIER']: valori validi dell'enum ma un sottoinsieme
          // incompleto, perche' escludeva AWAITING_PRODUCER e
          // AWAITING_RECEIVER, che sono altrettanto "non trasmesso".
          status: { in: ['DRAFT', 'AWAITING_PRODUCER', 'AWAITING_CARRIER', 'AWAITING_RECEIVER'] },
        },
        _count: { _all: true },
      }),
      this.prisma.mUDReport.findMany({
        where: { tenantId: { in: ids }, status: { not: 'SUBMITTED' } },
        select: { tenantId: true, year: true, status: true },
        orderBy: { year: 'desc' },
        take: 20,
      }),
      // Enum RENTRISyncLogStatus: PENDING | SUCCESS | FAILURE.
      // La vecchia query raw filtrava su 'FAILED', valore che non esiste.
      this.prisma.rENTRISyncLog.count({
        where: { tenantId: { in: ids }, status: 'FAILURE' },
      }),
      this.prisma.fIR.findMany({
        where: { tenantId: { in: ids } },
        select: { tenantId: true, firNumber: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ])

    const pendingFirsByClient = figlie
      .map(f => ({
        tenantId: f.id,
        tenantName: f.ragioneSociale,
        pendingCount: perFir.find(g => g.tenantId === f.id)?._count._all ?? 0,
      }))
      .filter(r => r.pendingCount > 0)

    return {
      totalTenants: figlie.length,
      totalPendingFirs: pendingFirsByClient.reduce((s, r) => s + r.pendingCount, 0),
      totalRentriSyncFailures: sincroniaFallite,
      pendingFirsByClient,
      upcomingDeadlines: mud.map(m => ({
        tenantId: m.tenantId,
        tenantName: nome.get(m.tenantId) ?? m.tenantId,
        year: m.year,
        status: m.status,
      })),
      recentActivity: ultimiFir.map(f => ({
        tenantId: f.tenantId,
        tenantName: nome.get(f.tenantId) ?? f.tenantId,
        activityType: 'FIR_CREATO',
        activityDate: f.createdAt,
        description: `FIR ${f.firNumber}`,
      })),
    }
  }
}
