/**
 * Chi può creare, modificare, eliminare o cambiare stato a un contratto.
 *
 * Rispecchia il backend: `contract.controller.ts` protegge con
 * `@Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')` la creazione, la modifica, l'eliminazione e il
 * cambio di stato; le letture sono aperte a tutti. Mostrare le azioni a un VIEWER significa
 * offrirgli qualcosa che il server rifiuta con un 403 dopo che ha già compilato tutto.
 * Stesso schema di `../registry/registry-permissions.ts`. Fail-closed: ruolo assente o
 * sconosciuto, nessuna azione.
 */
const RUOLI_CHE_GESTISCONO_CONTRATTI = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const

export function puoGestireContratti(role: string | null | undefined): boolean {
  if (!role) return false
  return (RUOLI_CHE_GESTISCONO_CONTRATTI as readonly string[]).includes(role)
}
