# Azienda selezionata nei controller — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet
> implementa (Task 1 e 2 in parallelo, file disgiunti), opus rivede.

**Obiettivo:** ogni controller che legge o scrive dati di un'azienda usa
l'azienda **selezionata** della richiesta (`requireRequestTenantId(req)`,
`apps/backend/src/core/context/resolve-request-tenant.ts`), non
`user.tenantId` (azienda primaria del token). Con la RLS accesa il contesto
del database è l'azienda selezionata: un controller che filtra o scrive con
`user.tenantId` dà a consulenti, utenti di gruppo e super admin che hanno
selezionato un'altra azienda risultati vuoti, o tenta di scrivere nell'azienda
sbagliata (respinto dalla RLS con un errore). Per gli utenti di una sola
azienda le due coincidono: nessun cambiamento per loro.

**Stato di partenza (26/10, master `37cb70d`):** 63 occorrenze di
`user.tenantId` in 20 file `*.controller.ts`. Esempio già corretto:
`registro.controller.ts` e `giacenze.controller.ts` (F2-1).

## Vincoli globali

- `requireRequestTenantId(req)` è fail-closed (403 se nessuna azienda è
  selezionata). Dove oggi un endpoint funziona anche senza azienda (es. super
  admin in contesto globale) e deve continuare a farlo, si decide caso per caso
  e si scrive il motivo nel report.
- Restano su `user.tenantId` solo gli usi che parlano davvero dell'azienda
  **primaria** dell'utente (login, rinnovo token, membership, profilo). Ogni
  uso che resta ha un commento `// azienda primaria: <motivo>`.
- Ogni file convertito ha almeno un test di controller: azienda selezionata ≠
  azienda del token → il service riceve la selezionata.
- Nessun cambiamento ai service: solo i controller (salvo service che leggono
  `user.tenantId` da un oggetto utente passato dal controller: si passa il
  tenant risolto).
- Commit `git commit -m … -- <file>`; niente attribuzioni AI.

## Task 1: controller RENTRI

**File:** `apps/backend/src/api/rentri/rentri-scorta.controller.ts`,
`rentri-formulari.controller.ts`, `rentri-unita-locale.controller.ts`,
`rentri-credential.controller.ts`, `rentri-siti.controller.ts`,
`rentri-modalita-legame.controller.ts`, `rentri-diagnostica.controller.ts`,
`rentri-codifiche.controller.ts` e i loro spec.

Per ogni occorrenza: classificare (dati dell'azienda → selezionata; azienda
primaria → resta con commento), convertire, test.

## Task 2: altri controller applicativi

**File:** `apps/backend/src/api/audit/audit.controller.ts`,
`apps/backend/src/application/contracts/contract.controller.ts`,
`apps/backend/src/api/registry/registry.controller.ts`,
`apps/backend/src/application/billing/billing.controller.ts`,
`apps/backend/src/api/fir/fir.controller.ts`,
`apps/backend/src/application/esg/esg.controller.ts`,
`apps/backend/src/application/anomaly/anomaly.controller.ts` e i loro spec.

Stessa procedura del Task 1. Attenzione a `audit.controller.ts`: alcune rotte
possono essere per definizione della piattaforma o del super admin (RLS
pezzo 4: rotta `admin/audit/piattaforma`); non cambiarle senza capirle.

## Task 3: guardia statica

Dopo i Task 1 e 2. Uno spec statico (modello:
`punti-di-sistema.spec.ts`) che legge tutti i `*.controller.ts` e fallisce se
compare `user.tenantId` / `user?.tenantId` fuori da un elenco esplicito di
file autorizzati (auth, dev-auth, membership, user-admin e quelli rimasti dai
Task 1-2), ciascuno con il motivo. Deve fallire su un controller finto con
`user.tenantId` (test della guardia stessa).
