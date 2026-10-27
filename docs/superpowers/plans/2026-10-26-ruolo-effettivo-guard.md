# Ruolo e permessi nell'azienda selezionata — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet
> implementa, opus rivede. Task 1 e Task 3 in parallelo (file disgiunti),
> Task 2 dopo il Task 1 (riusa il suo helper).

**Obiettivo:** `RolesGuard` e `PermissionGuard` decidono sul ruolo e sui
permessi che l'utente ha nell'azienda **su cui la richiesta opererà davvero**,
non su quelli dell'azienda primaria del token. Oggi un consulente ADMIN del
proprio studio, associato a un cliente come VIEWER, supera `@Roles('ADMIN')` e
`@RequirePermission(...)` sulle rotte del cliente (ruolo e permessi sono quelli
di casa). In più si elimina `user.userId`, campo che `JwtStrategy` non popola
mai (`req.user` ha `id`).

**Stato di partenza (26/10, master `c555919`).**
- `apps/backend/src/auth/guards/roles.guard.ts`: sincrono, `requiredRoles.includes(user.role)`.
  Usato con `@UseGuards(JwtAuthGuard, RolesGuard)` in 23 file (`grep -rl "@Roles(" apps/backend/src`).
- I guard girano PRIMA del `TenantSwitchInterceptor`
  (`core/interceptors/tenant-switch.interceptor.ts`), che convalida l'header
  `X-Tenant-ID` con `MembershipService.checkAccess` e solo allora imposta
  `req.tenantId`. Il SUPER_ADMIN salta la verifica.
- `RuoloEffettivoService` (`api/me/ruolo-effettivo.service.ts`, modulo
  `RuoloEffettivoModule`, dipende solo da Prisma): `accesso(utente, tenantId)`
  restituisce il ruolo applicativo nell'azienda o `null` se l'utente non ci ha
  accesso; stesse sorgenti di `checkAccess`.
- Alcuni handler controllano già il ruolo effettivo a mano
  (`richiedi-ruolo-effettivo.ts`, `fir.controller.v2.ts`, `mud.controller.ts`,
  `registro.controller.ts`): restano come sono.
- `api/guards/permission.guard.ts`: permessi da `loadPermissionsFromDb(userId, tenantId)`
  con `tenantId` del token; commento "SEGUITO (fuori ambito)" sul consulente.

## Regola unica (vale per Task 1 e 2)

Azienda **candidata** della richiesta:
- header `X-Tenant-ID` presente, UUID valido, diverso da `user.tenantId`,
  utente non SUPER_ADMIN → l'azienda dell'header;
- altrimenti → nessun cambiamento rispetto a oggi (ruolo/permessi del token).

Con un'azienda candidata:
- `accesso(user, candidata)` restituisce un ruolo → si decide su quel ruolo
  (Task 1) / sui permessi dell'azienda candidata (Task 2);
- `accesso` restituisce `null` → si decide come oggi sul token: la richiesta
  verrà respinta dall'interceptor con 403, oppure (rotte
  `@ConsentiSelezioneNonValida`) proseguirà sull'azienda primaria, dove il
  ruolo del token è quello giusto;
- `accesso` lancia (DB irraggiungibile) → `ServiceUnavailableException` con lo
  stesso corpo `VERIFICA_AZIENDA_NON_DISPONIBILE` dell'interceptor
  (fail-closed, mai 500, mai via libera).

Mai id di tenant, chiavi o dati di credenziali nei messaggi d'errore
restituiti all'utente.

## Vincoli globali

- Commit `git commit -m … -- <file>`; niente attribuzioni AI.
- Commenti in italiano, termini tecnici non tradotti.
- Prima di dichiarare finito: suite unitaria COMPLETA del backend come in CI
  (`cd apps/backend && NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`),
  `npm run lint` e `npx tsc --noEmit -p tsconfig.json` (o il tsconfig usato dal
  build). Un guard con dipendenze nuove rompe la DI di ogni modulo che lo usa:
  è il difetto che nella F2-1 ha impedito l'avvio del backend.

## Task 1: RolesGuard sul ruolo effettivo

**File:** `apps/backend/src/auth/guards/roles.guard.ts` (+ spec),
`apps/backend/src/api/me/ruolo-effettivo.module.ts`,
`apps/backend/src/core/context/azienda-da-header.ts` (nuovo, + spec),
`app.module.ts` se serve, gli spec di controller che istanziano `RolesGuard`.

1. Helper puro `aziendaCandidataDaHeader(req): string | null` in
   `core/context/azienda-da-header.ts`: legge `x-tenant-id` (array → primo,
   trim), restituisce l'UUID solo se valido (`isUUID(v, 'all')`), utente non
   SUPER_ADMIN e diverso da `user.tenantId`; altrimenti `null`. Test unitari
   per ogni ramo.
2. `RolesGuard.canActivate` diventa `async`: senza `@Roles` → `true`; senza
   utente → `false`; azienda candidata → regola unica sopra con
   `RuoloEffettivoService.accesso`; altrimenti come oggi.
3. DI: `RuoloEffettivoModule` diventa `@Global()` e viene importato una volta in
   `AppModule` (verificare che non lo sia già), così ogni modulo che usa
   `RolesGuard` lo risolve senza import nuovi. Commento sul perché.
4. Test del guard: consulente ADMIN di casa, associato come VIEWER, header sul
   cliente → `@Roles('ADMIN')` negato; associato come ADMIN → concesso; header
   su azienda senza accesso → decide il ruolo del token; header non UUID →
   ruolo del token; SUPER_ADMIN → invariato, `accesso` mai chiamato; `accesso`
   che lancia → 503 con `VERIFICA_AZIENDA_NON_DISPONIBILE`; nessun header →
   `accesso` mai chiamato.
5. Test di DI: uno spec che compila con `Test.createTestingModule` almeno due
   moduli reali che usano `RolesGuard` (es. il modulo di `registry.controller.ts`
   e quello di `rentri-sync.controller.ts`) con le sole infrastrutture esterne
   (Redis, code BullMQ, HTTP) sostituite, e risolve il guard. Modello:
   `api/registro/registro.module.spec.ts`. Se un `AppModule` completo è
   compilabile negli spec esistenti, preferirlo.
6. Sistemare gli spec dei controller che istanziano `RolesGuard` senza fornire
   `RuoloEffettivoService` (fornire un finto, non sovrascrivere il guard
   dove il test verifica proprio i ruoli).

## Task 2: PermissionGuard sui permessi dell'azienda selezionata

**Dipende dal Task 1** (usa `aziendaCandidataDaHeader`).
**File:** `apps/backend/src/api/guards/permission.guard.ts` (+ spec), servizio
della cache dei permessi se serve una chiave nuova.

1. Con un'azienda candidata e `accesso(...) !== null`, i permessi sono quelli
   che l'utente ha **in quell'azienda**:
   - associazione consulente valida (`associazioneConsulenteValida` in
     `ruolo-effettivo.service.ts`) → permessi del ruolo `role_id`
     dell'associazione (`role_permissions`);
   - altri legami (azienda di proprietà, figlia → madre) → permessi
     dell'azienda primaria, come oggi (il ruolo globale vale lì per
     definizione di `RuoloEffettivoService`);
   - `accesso === null` → come oggi (permessi di casa), vedi regola unica.
   Letture su client di sistema o nel contesto dell'azienda giusta, come già
   fa il guard per il SUPER_ADMIN (con la RLS accesa un ruolo del cliente non
   si vede dal contesto di casa).
2. Cache: la chiave dei permessi del consulente sul cliente deve includere
   l'azienda del cliente e l'utente; mai riusare la voce `(casa, utente)` per il
   cliente né viceversa. Verificare che l'invalidazione esistente (modifica di
   un ruolo / dei suoi permessi / revoca dell'associazione) colpisca anche la
   voce nuova; se non lo fa, TTL breve documentato e riga nel report.
3. Il commento "SEGUITO (fuori ambito)" va sostituito da una descrizione del
   comportamento nuovo. L'azienda dell'audit per i non SUPER_ADMIN: quella su
   cui opera la richiesta (candidata con accesso, altrimenti token).
4. Test: consulente con permessi ampi a casa e associazione con ruolo privo del
   permesso richiesto → negato; associazione con ruolo che lo ha → concesso;
   due richieste consecutive casa/cliente dello stesso utente non si
   contaminano attraverso la cache; utente di gruppo sulla figlia → permessi di
   casa; SUPER_ADMIN invariato.
5. Test su Postgres reale col ruolo `wasteflow_app` (`*.postgres.spec.ts`,
   `-c jest.postgres.config.js`, `DATABASE_URL` del Postgres di test 55432):
   i permessi del ruolo dell'associazione si leggono davvero con la RLS attiva.

## Task 3: via `user.userId`

**File:** tutti gli usi di `user.userId` / `user?.userId` / `.user?.userId`
in `apps/backend/src` fuori dai `*.spec.ts`
(`grep -rnE "user\??\.userId" apps/backend/src --include=*.ts | grep -v spec`),
`core/middleware/tenant-context.middleware.ts` (`UserId`, `CurrentUser`,
`AuthenticatedUser`), nuovo spec statico.

1. Ogni uso diventa `id` (il campo di `CurrentUserPayload`). In particolare:
   - `api/middleware/rate-limit.middleware.ts`: oggi gli utenti autenticati
     sono contati per IP; dopo, per `user:<id>`. Test;
   - `api/task-assignment/task-assignment.controller.ts`: assegnazioni con
     `user.id`; verificare quale `CurrentUser` importa e il tipo usato;
   - `api/middleware/permission-cache.interceptor.ts`: oggi non fa mai nulla
     (userId sempre undefined). Se nessuno lo registra (`grep`), eliminarlo con
     il suo spec; se è registrato, correggerlo e dire nel report cosa cambia;
   - log e filtri (`global-exception.filter`, `permission-exception.filter`,
     `spid-step-up.guard`, `csrf-protection.middleware`, `request-logger`,
     `logging.interceptor`, `structured-logger.service`, `http-exception.filter`).
2. `tenant-context.middleware.ts`: `UserId`, `CurrentUser` e
   `AuthenticatedUser` lì dichiarati leggono `user.userId`/`keycloakId`. Se
   nessuno li importa, rimuoverli; altrimenti correggerli su `id`.
3. Guardia statica `apps/backend/src/api/nessun-user-userid.spec.ts` (modello:
   `controller-tenant-selezionato.spec.ts`): fallisce se in un `.ts` non spec
   di `apps/backend/src` compare `user.userId`, `user?.userId` o
   `user!.userId`. Deve fallire su un sorgente finto che li contiene.
4. Non toccare `roles.guard.ts`, `permission.guard.ts`,
   `ruolo-effettivo.*` (Task 1-2).
