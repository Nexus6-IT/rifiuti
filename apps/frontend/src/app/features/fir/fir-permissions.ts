/**
 * Chi può creare un FIR.
 *
 * L'elenco rispecchia il backend, che è l'unico punto che decide davvero:
 * `FIRControllerV2.create` è protetto da `@Roles('SUPER_ADMIN', 'ADMIN',
 * 'OPERATOR')`. Mostrare il bottone «Nuovo FIR» a un VIEWER significa
 * offrirgli un'azione che il server rifiuterà con un 403 — l'utente scopre
 * di non poter fare una cosa solo dopo averla tentata.
 *
 * NB: qui si guarda il RUOLO, non i permessi granulari. È deliberato: gli
 * endpoint operativi (FIR, registro, anagrafiche) sono protetti da
 * `RolesGuard` sul ruolo, mentre il sistema a permessi (`PermissionGuard`)
 * copre oggi solo audit, permessi e assegnazioni. Gating della UI sui
 * permessi granulari nasconderebbe il bottone anche a chi ha diritto di
 * usarlo, finché gli utenti non avranno assegnazioni di ruolo RBAC.
 *
 * Fail-closed: ruolo assente o sconosciuto ⇒ niente bottone.
 */
const RUOLI_CHE_CREANO_FIR = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const

export function puoCreareFir(role: string | null | undefined): boolean {
  if (!role) return false
  return (RUOLI_CHE_CREANO_FIR as readonly string[]).includes(role)
}
