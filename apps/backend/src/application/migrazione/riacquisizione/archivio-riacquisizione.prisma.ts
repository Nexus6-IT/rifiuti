/**
 * Letture (SOLO letture) di `migrazione:riacquisisci-fir`: se il numero RENTRI e' gia' un FIR
 * dell'azienda, `numIscrSito` dell'unita' locale della mappa, ruolo dell'utente. Ogni query filtra
 * per azienda anche se il client applicativo ha gia' la RLS.
 */
import { TenantContext } from '../../../core/context/tenant-context'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import type { ArchivioRiacquisizione } from './riacquisisci-fir.service'

export class ArchivioRiacquisizionePrisma implements ArchivioRiacquisizione {
  constructor(private readonly prisma: PrismaService) {}

  async firGiaPresente(tenantId: string, numeroFir: string): Promise<boolean> {
    return await TenantContext.run({ tenantId }, async () => {
      const n = await this.prisma.fIR.count({ where: { tenantId, rentriNumeroFir: numeroFir } })
      return n > 0
    })
  }

  async numIscrSito(tenantId: string, unitaLocaleId: string): Promise<string | null> {
    return await TenantContext.run({ tenantId }, async () => {
      const u = await this.prisma.rentriUnitaLocale.findFirst({
        where: { id: unitaLocaleId, tenantId },
        select: { numIscrSito: true },
      })
      return u?.numIscrSito ?? null
    })
  }

  async ruoloUtente(tenantId: string, userId: string): Promise<string | null> {
    return await TenantContext.run({ tenantId }, async () => {
      const u = await this.prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { role: true },
      })
      return u?.role ?? null
    })
  }
}
