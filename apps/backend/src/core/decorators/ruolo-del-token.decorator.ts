import { SetMetadata } from '@nestjs/common'

export const RUOLO_DEL_TOKEN = 'ruoloDelToken'

/**
 * Rotte che operano sull'ACCOUNT di casa dell'utente (`currentUser.id` / `currentUser.tenantId`:
 * anagrafica delle proprie aziende, gestione degli utenti del proprio account) e non
 * sull'azienda selezionata con `X-Tenant-ID`.
 *
 * `RolesGuard` e `PermissionGuard` normalmente decidono sul ruolo/permessi dell'utente
 * nell'azienda selezionata. Per queste rotte sarebbe sbagliato in entrambi i sensi: un
 * consulente VIEWER di casa ma ADMIN presso un cliente supererebbe `@Roles('ADMIN')` e
 * potrebbe creare aziende sul proprio account (escalation), mentre un ADMIN di casa con
 * selezionato un cliente dove e' VIEWER verrebbe respinto (regressione).
 *
 * Con questo decoratore (su metodo o classe) i guard ignorano l'azienda candidata e decidono
 * sul ruolo/permessi del token, come prima dell'introduzione del ruolo effettivo.
 */
export const RuoloDelToken = () => SetMetadata(RUOLO_DEL_TOKEN, true)
