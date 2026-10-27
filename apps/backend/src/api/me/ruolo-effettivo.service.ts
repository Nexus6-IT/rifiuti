import { Injectable } from '@nestjs/common'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'

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
 * Accesso a un'azienda con la sua origine: `roleId` e' il ruolo (`roles.id`) dell'associazione
 * consulente da cui deriva l'accesso, `null` se l'accesso viene da altro (azienda primaria,
 * di proprieta', SUPER_ADMIN): li' valgono i permessi del ruolo globale dell'utente.
 */
export type AccessoAzienda = { ruolo: RuoloApplicativo; roleId: string | null }

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
 * Solo letture vincolate all'id dell'utente autenticato (o agli id che ne derivano); mai dati di
 * dominio: un metodo nuovo qui eredita BYPASSRLS (client di sistema).
 *
 * Servizio leggero (solo Prisma) e separato da `MembershipService`, che dipende da
 * `AuthModule` e quindi da Redis: i moduli che ne hanno bisogno importano
 * `RuoloEffettivoModule`, non `MeModule`.
 */
@Injectable()
export class RuoloEffettivoService {
  // Client di sistema: legge aziende e associazioni consulente diverse da quella del contesto
  // (azienda di destinazione, madre) e, al refresh, senza alcun contesto.
  constructor(private readonly sistema: PrismaSistemaService) {}

  /**
   * Risoluzione nello stesso ordine di `MembershipService.checkAccess`:
   *   1. SUPER_ADMIN → SUPER_ADMIN, in qualunque azienda;
   *   2. tenant primario → ruolo globale;
   *   3. tenant di proprietà → ruolo globale;
   *   4. associazione consulente valida → ruolo dell'associazione (`ADMIN`, `OPERATOR`;
   *      ogni altro nome — `CONSULTANT`, `COMPLIANCE_OFFICER`, ruoli personalizzati — `VIEWER`);
   *   5. figlia: ruolo sull'azienda madre (un solo passo, la gerarchia è a un livello);
   *   6. altrimenti VIEWER (fail-closed: il `TenantSwitchInterceptor` risponde già 403
   *      `AZIENDA_SELEZIONATA_NON_ACCESSIBILE` a un header non autorizzato, quindi qui non si
   *      dovrebbe arrivare).
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
    return (await this.accessoConOrigine(utente, tenantId))?.ruolo ?? null
  }

  /**
   * Come `accesso`, ma dice anche da quale associazione consulente deriva l'accesso
   * (`roleId`): serve a chi deve valutare i PERMESSI dell'utente nell'azienda selezionata
   * (`PermissionGuard`), che stanno nel ruolo dell'associazione e non nel ruolo globale.
   * Stessa risoluzione, stesso ordine di `accesso`: le due non possono divergere.
   */
  async accessoConOrigine(utente: UtenteRuolo, tenantId: string): Promise<AccessoAzienda | null> {
    if (utente.role === 'SUPER_ADMIN') return { ruolo: 'SUPER_ADMIN', roleId: null }
    return this.risolvi(utente, tenantId, true)
  }

  /**
   * Permessi (`resource:action:scope`) di un ruolo, letti col client di sistema.
   *
   * Serve a `PermissionGuard` per il ruolo di un'associazione consulente: quel ruolo puo'
   * appartenere al cliente o allo studio, e con la RLS accesa dal contesto di una sola delle
   * due aziende l'altro non si vede. Il `roleId` arriva sempre da `accessoConOrigine`, cioe'
   * da un'associazione valida dell'utente autenticato: non e' mai un id scelto dal chiamante.
   */
  async permessiDelRuolo(roleId: string): Promise<string[]> {
    const righe = await this.sistema.rolePermission.findMany({
      where: { roleId },
      select: { permission: { select: { resource: true, action: true, scope: true } } },
    })
    return righe.map(r => `${r.permission.resource}:${r.permission.action}:${r.permission.scope}`)
  }

  private async risolvi(
    utente: UtenteRuolo,
    tenantId: string,
    risaliAllaMadre: boolean
  ): Promise<AccessoAzienda | null> {
    if (utente.tenantId && utente.tenantId === tenantId) {
      return { ruolo: comeRuoloApplicativo(utente.role), roleId: null }
    }

    // Client di sistema: azienda di destinazione, senza contesto al refresh.
    const posseduto = await this.sistema.tenant.findFirst({
      where: { id: tenantId, ownerUserId: utente.id },
      select: { id: true },
    })
    if (posseduto) return { ruolo: comeRuoloApplicativo(utente.role), roleId: null }

    // Client di sistema: associazione verso un'azienda che non è quella del contesto.
    const associazione = await this.sistema.consultantTenantAssociation.findFirst({
      where: associazioneConsulenteValida(utente.id, tenantId),
      select: { roleId: true, role: { select: { name: true } } },
    })
    if (associazione) {
      const nome = associazione.role?.name
      return {
        ruolo: nome === 'ADMIN' || nome === 'OPERATOR' ? nome : 'VIEWER',
        roleId: associazione.roleId ?? null,
      }
    }

    if (!risaliAllaMadre) return null
    // Client di sistema: azienda madre, diversa da quella del contesto.
    const tenant = await this.sistema.tenant.findUnique({
      where: { id: tenantId },
      select: { parentTenantId: true },
    })
    if (!tenant?.parentTenantId) return null
    return this.risolvi(utente, tenant.parentTenantId, false)
  }
}
