import { DomainException } from '../../domain/shared/domain-exception'

/**
 * Ruoli abilitati alle scritture RENTRI verso l'ente pubblico — stessa lista
 * di `RENTRISyncController` (R0 Task 4): un'acquisizione/rilascio di
 * visibilità è una scrittura verso un ente pubblico a nome dell'azienda
 * (un adempimento, non una semplice lettura), quindi un VIEWER non deve
 * poterla avviare.
 *
 * Condivisa da `AcquisisciFormularioRENTRIUseCase` e
 * `RilasciaFormularioRENTRIUseCase` (R2 Task 4): entrambi orchestrano use
 * case applicativi invocati direttamente (non solo da un controller REST
 * protetto da `@Roles`), quindi il controllo va ripetuto qui — difesa in
 * profondità, non solo un guard HTTP che un futuro chiamante potrebbe
 * aggirare (job, script, altro controller).
 */
export const RUOLI_SCRITTURA_RENTRI = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const

export type RuoloScritturaRentri = (typeof RUOLI_SCRITTURA_RENTRI)[number]

/**
 * Verifica che `ruolo` sia abilitato alle scritture RENTRI. Fail-closed:
 * un ruolo assente/sconosciuto è trattato come non abilitato, mai come
 * "consentito per default".
 */
export function assertRuoloScritturaRentri(ruolo: string | undefined | null): void {
  if (!ruolo || !(RUOLI_SCRITTURA_RENTRI as readonly string[]).includes(ruolo)) {
    throw new DomainException(
      "Ruolo non abilitato alle scritture RENTRI verso l'ente: servono i permessi " +
        `${RUOLI_SCRITTURA_RENTRI.join('/')} (VIEWER escluso)`,
      'UNAUTHORIZED'
    )
  }
}
