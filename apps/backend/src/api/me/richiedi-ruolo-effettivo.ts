import { ForbiddenException } from '@nestjs/common'
import { RuoloApplicativo, RuoloEffettivoService } from './ruolo-effettivo.service'

/** Ruoli che possono scrivere (stessi di `@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')`). */
export const RUOLI_SCRITTURA: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

/** Ruoli amministrativi. */
export const RUOLI_AMMINISTRATIVI: readonly RuoloApplicativo[] = ['SUPER_ADMIN', 'ADMIN']

/**
 * `@Roles(...)` guarda il ruolo del TOKEN (azienda di casa): un consulente ADMIN nel proprio
 * studio ma solo CONSULTANT nell'azienda del cliente passerebbe il guard e scriverebbe
 * nell'azienda selezionata. Questo controllo usa il ruolo EFFETTIVO nell'azienda selezionata
 * (stessa forma di `RENTRISyncController.syncFIR`); 403 se non e' tra i ruoli ammessi.
 */
export async function richiediRuoloEffettivo(
  servizio: RuoloEffettivoService,
  utente: { id: string; role: string; tenantId?: string | null },
  tenantId: string,
  ammessi: readonly RuoloApplicativo[] = RUOLI_SCRITTURA
): Promise<RuoloApplicativo> {
  const ruolo = await servizio.ruoloEffettivo(utente, tenantId)
  if (!ammessi.includes(ruolo)) {
    throw new ForbiddenException({
      message: "Il tuo ruolo nell'azienda selezionata non consente questa operazione.",
      error: 'RUOLO_AZIENDA_SELEZIONATA_INSUFFICIENTE',
    })
  }
  return ruolo
}

/**
 * Dove l'autorizzazione e' un `PermissionGuard`, che risolve i permessi nell'azienda di casa
 * del token: se l'azienda selezionata e' un'altra (consulente su un cliente) il guard non dice
 * nulla su di essa. In quel caso serve il ruolo ADMIN effettivo nell'azienda selezionata.
 * Il SUPER_ADMIN e chi opera nella propria azienda di casa restano governati dal guard.
 */
export async function richiediAdminSeAziendaDiversa(
  servizio: RuoloEffettivoService,
  utente: { id: string; role: string; tenantId?: string | null },
  tenantId: string
): Promise<void> {
  if (utente.role === 'SUPER_ADMIN' || utente.tenantId === tenantId) return
  await richiediRuoloEffettivo(servizio, utente, tenantId, RUOLI_AMMINISTRATIVI)
}
