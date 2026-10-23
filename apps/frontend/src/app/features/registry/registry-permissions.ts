/**
 * Chi può creare, modificare o eliminare un'anagrafica (produttore,
 * trasportatore, destinatario).
 *
 * L'elenco rispecchia il backend, che è l'unico punto che decide davvero:
 * `RegistryController` protegge con `@Roles('SUPER_ADMIN', 'ADMIN',
 * 'OPERATOR')` sia le POST di creazione sia le PUT di modifica sia le
 * DELETE, identiche per le tre anagrafiche (vedi
 * `apps/backend/src/api/registry/registry.controller.ts`). Mostrare i
 * pulsanti «Nuovo», «Modifica» o «Elimina» a un VIEWER significa offrirgli
 * un'azione che il server rifiuterà con un 403 dopo che ha già compilato
 * tutto — non è un buco di sicurezza (il server comunque rifiuta), è una
 * promessa che l'interfaccia non può mantenere.
 *
 * Stesso schema di `../fir/fir-permissions.ts` (`puoCreareFir`): si guarda
 * il RUOLO, non i permessi granulari, per lo stesso motivo — gli endpoint
 * operativi sono protetti da `RolesGuard` sul ruolo, il sistema a permessi
 * granulari (`PermissionGuard`) copre oggi solo audit/permessi/assegnazioni.
 *
 * Fail-closed: ruolo assente o sconosciuto ⇒ nessuna azione.
 *
 * Allineamento con il backend verificato da un test dedicato:
 * `apps/backend/src/api/registry/registry.controller.authorization.spec.ts`
 * asserisce l'elenco esatto dei ruoli su ogni `@Roles` di scrittura del
 * `RegistryController`. Se cambi l'elenco qui, cambialo anche là.
 */
const RUOLI_CHE_GESTISCONO_ANAGRAFICHE = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const

export function puoGestireAnagrafiche(role: string | null | undefined): boolean {
  if (!role) return false
  return (RUOLI_CHE_GESTISCONO_ANAGRAFICHE as readonly string[]).includes(role)
}
