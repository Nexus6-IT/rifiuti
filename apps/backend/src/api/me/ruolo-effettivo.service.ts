import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'

/** Ruoli con cui l'applicazione decide che cosa un utente può fare in un'azienda. */
export type RuoloApplicativo = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'VIEWER'

const RUOLI_APPLICATIVI: readonly string[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER']

/** Un ruolo fuori dall'elenco applicativo (es. `DRIVER`) vale `VIEWER`. */
function comeRuoloApplicativo(ruolo: string | null | undefined): RuoloApplicativo {
  return RUOLI_APPLICATIVI.includes(ruolo ?? '') ? (ruolo as RuoloApplicativo) : 'VIEWER'
}

/**
 * Filtro di un'associazione consulente VALIDA: attiva **e non scaduta**.
 *
 * `isActive` da solo non basta: il dominio
 * (`ConsultantTenantAssociation.isActiveAndNotExpired()`) considera scaduta =
 * inattiva, ma la disattivazione non viene scritta a DB allo scadere. Senza il
 * vincolo su `expiresAt` un consulente conserverebbe l'accesso all'azienda del
 * cliente oltre la fine dell'incarico.
 *
 * Unica definizione, condivisa da `MembershipService` (accesso) e da
 * `RuoloEffettivoService` (ruolo): le due traversate devono concordare.
 */
export function associazioneConsulenteValida(consultantUserId: string, tenantId?: string) {
  return {
    consultantUserId,
    ...(tenantId ? { tenantId } : {}),
    isActive: true,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  }
}

type UtenteRuolo = { id: string; role: string; tenantId?: string | null }

/**
 * Ruolo dell'utente nell'azienda SELEZIONATA (A-C-06).
 *
 * Il ruolo del token (`User.role`) è il ruolo nell'azienda primaria dell'utente: un
 * consulente ADMIN del proprio studio, associato a un cliente come CONSULTANT, nell'azienda
 * del cliente non è un amministratore. Le decisioni riservate (conferma degli avvisi del
 * MUD, registrazione dei movimenti, progressivo iniziale) si prendono su questo ruolo.
 *
 * Si usa nei controller, non in un guard: `RolesGuard` gira prima del
 * `TenantSwitchInterceptor` globale e non vede l'azienda selezionata.
 *
 * Servizio leggero (solo Prisma) e separato da `MembershipService`, che dipende da
 * `AuthModule` e quindi da Redis: i moduli che ne hanno bisogno importano
 * `RuoloEffettivoModule`, non `MeModule`.
 */
@Injectable()
export class RuoloEffettivoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Risoluzione nello stesso ordine di `MembershipService.checkAccess`:
   *   1. SUPER_ADMIN → SUPER_ADMIN, in qualunque azienda;
   *   2. tenant primario → ruolo globale;
   *   3. tenant di proprietà → ruolo globale;
   *   4. associazione consulente valida → ruolo dell'associazione (`ADMIN`, `OPERATOR`;
   *      ogni altro nome — `CONSULTANT`, `COMPLIANCE_OFFICER`, ruoli personalizzati — `VIEWER`);
   *   5. figlia: ruolo sull'azienda madre (un solo passo, la gerarchia è a un livello);
   *   6. altrimenti VIEWER (fail-closed: il `TenantSwitchInterceptor` scarta già un header
   *      non autorizzato, quindi qui non si dovrebbe arrivare).
   */
  async ruoloEffettivo(utente: UtenteRuolo, tenantId: string): Promise<RuoloApplicativo> {
    return (await this.accesso(utente, tenantId)) ?? 'VIEWER'
  }

  /**
   * Come `ruoloEffettivo`, ma `null` se l'utente non ha alcun legame con l'azienda (stesse
   * sorgenti di `MembershipService.checkAccess`). Serve dove "nessun accesso" va distinto da
   * "accesso in sola consultazione", per esempio al refresh di un token emesso dallo switch.
   */
  async accesso(utente: UtenteRuolo, tenantId: string): Promise<RuoloApplicativo | null> {
    if (utente.role === 'SUPER_ADMIN') return 'SUPER_ADMIN'
    return this.risolvi(utente, tenantId, true)
  }

  private async risolvi(
    utente: UtenteRuolo,
    tenantId: string,
    risaliAllaMadre: boolean
  ): Promise<RuoloApplicativo | null> {
    if (utente.tenantId && utente.tenantId === tenantId) {
      return comeRuoloApplicativo(utente.role)
    }

    const posseduto = await this.prisma.tenant.findFirst({
      where: { id: tenantId, ownerUserId: utente.id },
      select: { id: true },
    })
    if (posseduto) return comeRuoloApplicativo(utente.role)

    const associazione = await this.prisma.consultantTenantAssociation.findFirst({
      where: associazioneConsulenteValida(utente.id, tenantId),
      select: { role: { select: { name: true } } },
    })
    if (associazione) {
      const nome = associazione.role?.name
      return nome === 'ADMIN' || nome === 'OPERATOR' ? nome : 'VIEWER'
    }

    if (!risaliAllaMadre) return null
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { parentTenantId: true },
    })
    if (!tenant?.parentTenantId) return null
    return this.risolvi(utente, tenant.parentTenantId, false)
  }
}
