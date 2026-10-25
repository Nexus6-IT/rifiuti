import { Injectable } from '@nestjs/common'
import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { PermissionAuditLog } from '../../domain/identity-access/permission-audit-log.entity'

export interface RigaAuditPiattaforma {
  id: string
  userId: string
  actionAttempted: string
  resourceType: string
  decision: string
  timestamp: Date
  /** Hash ricalcolato sui campi salvati uguale a quello registrato. */
  hashValido: boolean
}

/**
 * Lettura dell'audit dell'azienda tecnica "piattaforma" (azioni del super admin senza azienda
 * scelta). Solo SUPER_ADMIN: la rotta e' protetta dal ruolo, qui non c'e' alcun id preso dalla
 * richiesta, l'azienda e' sempre la costante. Client di sistema perche' il contesto della
 * richiesta e' un'altra azienda (o nessuna) e la RLS nasconderebbe le righe.
 */
@Injectable()
export class AuditPiattaformaService {
  constructor(private readonly sistema: PrismaSistemaService) {}

  async leggi(opzioni: { pagina?: number; perPagina?: number } = {}) {
    const perPagina = Math.min(Math.max(opzioni.perPagina ?? 50, 1), 200)
    const pagina = Math.max(opzioni.pagina ?? 1, 1)
    // Client di sistema: audit della piattaforma, legato al ruolo super admin della rotta.
    const [righe, totale] = await Promise.all([
      this.sistema.permissionAuditLog.findMany({
        where: { tenantId: AZIENDA_PIATTAFORMA_ID },
        orderBy: { timestamp: 'desc' },
        skip: (pagina - 1) * perPagina,
        take: perPagina,
      }),
      this.sistema.permissionAuditLog.count({ where: { tenantId: AZIENDA_PIATTAFORMA_ID } }),
    ])
    const logs: RigaAuditPiattaforma[] = righe.map(r => ({
      id: r.id,
      userId: r.userId,
      actionAttempted: r.actionAttempted,
      resourceType: r.resourceType,
      decision: r.decision,
      timestamp: r.timestamp,
      hashValido: PermissionAuditLog.fromPersistence({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        spidFiscalCode: r.spidFiscalCode,
        actionAttempted: r.actionAttempted,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        decision: r.decision,
        timestamp: r.timestamp,
        sessionId: r.sessionId,
        previousHash: r.previousEntryHash,
        hash: r.currentHash,
      }).isHashValid(),
    }))
    return { logs, totale, pagina, perPagina }
  }
}
