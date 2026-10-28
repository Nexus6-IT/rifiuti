import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { JwtTokensService } from '../../auth/services/jwt-tokens.service'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { associazioneConsulenteValida } from './ruolo-effettivo.service'

/**
 * Gestione multi-azienda dell'utente autenticato: elenco delle aziende
 * accessibili (tenant primario + possedute + associazioni attive + figlie
 * delle aziende accessibili) e switch con ri-emissione del JWT sul tenant
 * scelto.
 */
@Injectable()
export class MembershipService {
  constructor(
    private readonly prisma: PrismaService,
    // Client di sistema: elenco e verifica di accesso girano prima di conoscere l'azienda di destinazione.
    private readonly sistema: PrismaSistemaService,
    private readonly jwtTokens: JwtTokensService
  ) {}

  /**
   * Filtro di un'associazione consulente VALIDA (attiva e non scaduta): definito una sola
   * volta in `ruolo-effettivo.service.ts`, così accesso e ruolo effettivo concordano.
   */
  private static associazioneValida(consultantUserId: string, tenantId?: string) {
    return associazioneConsulenteValida(consultantUserId, tenantId)
  }

  /**
   * Identità anagrafica della società attiva (tenant effettivo della richiesta).
   *
   * Serve al frontend (registro C/S) per determinare, dato un FIR, se il
   * movimento è un CARICO (la società è il DESTINATARIO del FIR) o uno SCARICO
   * (la società è il PRODUTTORE), confrontando la partita IVA / ragione sociale
   * della società con lo snapshot delle parti del FIR.
   *
   * `tenantId` deve essere il tenant EFFETTIVO della richiesta (`req.tenantId`,
   * eventualmente sovrascritto dal `TenantSwitchInterceptor`), non il tenant
   * primario del JWT: così riflette la società selezionata nel tenant switcher.
   */
  async getActiveCompany(tenantId: string | null | undefined) {
    if (!tenantId) return null
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, ragioneSociale: true, partitaIva: true },
    })
    if (!tenant) return null
    return {
      id: tenant.id,
      ragioneSociale: tenant.ragioneSociale,
      partitaIva: tenant.partitaIva,
    }
  }

  /** Tenant a cui l'utente ha accesso. */
  async listTenants(user: CurrentUserPayload) {
    const ids = new Set<string>()
    if (user.tenantId) ids.add(user.tenantId)

    // Client di sistema: le aziende possedute o associate non sono quella del contesto.
    const owned = await this.sistema.tenant.findMany({
      where: { ownerUserId: user.id },
      select: { id: true },
    })
    owned.forEach(t => ids.add(t.id))

    // Client di sistema: associazioni consulente-azienda, senza azienda nota.
    const assoc = await this.sistema.consultantTenantAssociation.findMany({
      where: MembershipService.associazioneValida(user.id),
      select: { tenantId: true },
    })
    assoc.forEach(a => ids.add(a.tenantId))

    if (ids.size === 0) {
      return { tenants: [], currentTenantId: user.tenantId ?? null }
    }

    // Le figlie delle aziende accessibili sono a loro volta accessibili
    // (discesa gerarchica, v. checkAccess).
    // Client di sistema: aziende figlie di quelle accessibili, diverse da quella del contesto.
    const figlie = await this.sistema.tenant.findMany({
      where: { parentTenantId: { in: Array.from(ids) } },
      select: { id: true },
    })
    figlie.forEach(f => ids.add(f.id))

    // Client di sistema: anagrafica delle aziende accessibili.
    const tenants = await this.sistema.tenant.findMany({
      where: { id: { in: Array.from(ids) } },
      select: { id: true, ragioneSociale: true, parentTenantId: true },
      orderBy: { ragioneSociale: 'asc' },
    })
    return { tenants, currentTenantId: user.tenantId ?? null }
  }

  /**
   * Verifica se l'utente ha accesso al tenant indicato (senza emettere un nuovo
   * JWT). Usato dal `TenantSwitchInterceptor` per validare l'header `X-Tenant-ID`.
   *
   * Quattro sorgenti di membership controllate nell'ordine:
   *   1. Tenant primario del JWT (sempre consentito, nessuna query extra).
   *   2. Tenant di cui l'utente è owner (`Tenant.ownerUserId`).
   *   3. Associazioni consulente attive (`ConsultantTenantAssociation`).
   *   4. Discesa gerarchica: abilitazione all'azienda MADRE del target.
   *
   * Fail-closed: qualunque errore interno è propagato al chiamante. Il
   * `TenantSwitchInterceptor` risponde allora 503 `VERIFICA_AZIENDA_NON_DISPONIBILE`
   * (la selezione si conserva e la richiesta si può ripetere): non ricade mai sul
   * tenant primario, che metterebbe la scrittura in un'altra azienda.
   */
  async checkAccess(
    userId: string,
    targetTenantId: string,
    primaryTenantId: string
  ): Promise<boolean> {
    // 1. Tenant primario (già nel JWT): accesso sempre garantito.
    if (primaryTenantId && primaryTenantId === targetTenantId) {
      return true
    }

    // 2. Tenant di proprietà dell'utente.
    // Client di sistema: la verifica precede il cambio azienda, il contesto è ancora quello di partenza.
    const owned = await this.sistema.tenant.findFirst({
      where: { id: targetTenantId, ownerUserId: userId },
      select: { id: true },
    })
    if (owned) return true

    // 3. Associazione consulente attiva e non scaduta.
    // Client di sistema: associazione verso l'azienda di destinazione.
    const assoc = await this.sistema.consultantTenantAssociation.findFirst({
      where: MembershipService.associazioneValida(userId, targetTenantId),
      select: { id: true },
    })
    if (assoc) return true

    // 4. Discesa gerarchica: chi e' abilitato all'azienda MADRE accede alle
    //    figlie coi poteri del proprio ruolo. E' l'unico punto in cui la
    //    gerarchia concede qualcosa, e vale in una sola direzione: essere
    //    abilitati a una figlia non da' accesso ne' alla madre ne' alle sorelle.
    // Client di sistema: azienda di destinazione e madre, non quelle del contesto.
    const target = await this.sistema.tenant.findUnique({
      where: { id: targetTenantId },
      select: { parentTenantId: true },
    })
    if (!target?.parentTenantId) return false

    // Ricorsione di UN solo passo: la gerarchia e' a un livello.
    return this.checkAccess(userId, target.parentTenantId, primaryTenantId)
  }

  /** Verifica l'accesso e ri-emette il JWT con il tenant target. */
  async switchTenant(user: CurrentUserPayload, targetTenantId: string) {
    const isSuperAdmin = user.role === 'SUPER_ADMIN'
    if (!isSuperAdmin) {
      // Stessa definizione di "questo utente puo' accedere a questa azienda"
      // usata dal TenantSwitchInterceptor per l'header X-Tenant-ID: delegare
      // a checkAccess evita che le due strade divergano di nuovo (es. la
      // discesa gerarchica madre->figlie, aggiunta li' e dimenticata qui).
      const allowed = await this.checkAccess(user.id, targetTenantId, user.tenantId)
      if (!allowed) {
        throw new ForbiddenException('Nessun accesso a questa azienda')
      }
    }

    // Client di sistema: esistenza dell'azienda di destinazione.
    const tenant = await this.sistema.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true },
    })
    if (!tenant) throw new NotFoundException('Azienda non trovata')

    // Client di sistema: l'utente appartiene all'azienda primaria, il contesto può essere un'altra.
    const dbUser = await this.sistema.user.findUnique({
      where: { id: user.id },
      select: { email: true, fiscalCode: true, role: true },
    })
    if (!dbUser) throw new NotFoundException('Utente non trovato')

    const tokens = this.jwtTokens.generateTokenPair({
      id: user.id,
      email: dbUser.email,
      fiscalCode: dbUser.fiscalCode ?? undefined,
      tenantId: targetTenantId,
      role: dbUser.role,
    })
    return { ...tokens, tenantId: targetTenantId }
  }
}
