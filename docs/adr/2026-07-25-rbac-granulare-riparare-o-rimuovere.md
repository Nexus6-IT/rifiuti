# ADR — Sottosistema RBAC granulare: riparare o rimuovere

**Data:** 2026-07-25 · **Stato:** deciso (riparare) · **Contesto:** pipeline P4 del programma production-ready

## Il problema

Il sottosistema di permessi granulari (`@RequirePermission` / `PermissionGuard`) **non è mai entrato in esercizio**. In `apps/backend/src/api/permissions/permissions.module.ts` è registrato **un solo controller su sei**; gli altri cinque sono esclusi con un commento che attribuisce l'esclusione a un bug di injection CQRS che romperebbe il bootstrap.

L'autorizzazione reale dell'applicazione passa quindi solo dai ruoli grossolani `@Roles` (SUPER_ADMIN / ADMIN / OPERATOR / VIEWER).

## Cosa è stato accertato

| Fatto | Misura |
|---|---|
| File del sottosistema (backend, esclusi i test) | 39 |
| Righe di codice | ~5.940 |
| Controller scritti / registrati | 6 / **1** |
| Tabelle Prisma dedicate | 11 |
| Pagine frontend **instradate** sotto `/permissions` | 8 (gestione ruoli, costruttore ruoli custom, i miei permessi, audit trail, dashboard consulente, deleghe mie e da approvare) |
| Specifica di prodotto | `specs/002-roles-permissions-system` + `specs/market-analysis-roles-permissions.md` |

**Il fatto decisivo:** il frontend **chiama già** endpoint che non esistono — `temp-permission.store.ts` interroga `/api/v1/temp-permissions/me` e `/api/v1/temp-permissions/{id}`, `audit-api.service.ts` chiama `/permissions/export`. Sono serviti dai controller orfani, quindi rispondono **404**.

Lo stato attuale non è «una funzionalità non ancora attivata»: è **un'interfaccia viva sopra un backend morto**. Un utente che naviga in quell'area incontra errori.

## Opzioni considerate

**A — Rimuovere.** Cancellare i 39 file backend, le 8 pagine frontend e (eventualmente) le 11 tabelle, consolidando l'autorizzazione sui ruoli grossolani.
*A favore:* elimina ~6.000 righe di codice morto e una fonte permanente di confusione su cosa il prodotto sappia fare davvero.
*Contro:* butta via un investimento consistente e una capacità di prodotto **specificata con analisi di mercato**; lascia WasteFlow senza permessi granulari, che per una piattaforma multi-tenant venduta alla PA sono una richiesta ricorrente (deleghe temporanee, consulenti su più aziende, audit trail dei permessi).

**B — Riparare.** Diagnosticare il difetto di wiring, registrare i cinque controller, far funzionare le pagine già costruite.
*A favore:* il codice esiste ed è scritto; il frontend esiste ed è instradato; chiude la contraddizione fra interfaccia e sostanza; la funzionalità era voluta.
*Contro:* la dimensione della riparazione **non è nota a priori** — il commento nel codice parla di un bug di injection CQRS, e un sondaggio diretto non è riuscito a isolarlo perché il modulo apre connessioni Redis/Bull e si blocca in un contesto di test.

**C — Nascondere l'interfaccia e rimandare.** Lasciare il backend com'è e togliere le rotte frontend.
*A favore:* costo minimo, elimina subito l'errore visibile all'utente.
*Contro:* non decide nulla; il codice morto resta e la decisione si ripresenta identica più avanti.

## Decisione

**B — riparare**, con un vincolo di costo esplicito.

Il ragionamento: lo stato peggiore possibile è quello attuale, in cui l'interfaccia promette ciò che il backend non mantiene. Fra le due uscite da questo stato, la rimozione distrugge una capacità di prodotto voluta e documentata mentre il codice per averla è già scritto quasi per intero: la riparazione è la scelta che conserva valore, **se** il difetto è di wiring come il commento sostiene.

**Il vincolo:** la riparazione procede finché resta un problema di *cablaggio*. Se la diagnosi rivela che i controller non funzionano per ragioni sostanziali — casi d'uso incompleti, modello dati incoerente, logica mai finita — allora l'ipotesi «basta collegarli» è falsa, il lavoro si ferma e si torna a decidere fra A e C con il costo reale alla mano. Non si trasforma una riparazione in una riscrittura senza tornare a discuterne.

**In ogni caso, e per primo:** l'interfaccia non deve mentire. Se al termine i controller non sono in esercizio, le rotte frontend corrispondenti vanno disattivate.

## Conseguenze

- Se la riparazione riesce: WasteFlow acquisisce i permessi granulari già progettati, e le otto pagine esistenti cominciano a funzionare.
- Se fallisce: si sarà comunque prodotta una diagnosi documentata del perché quel sottosistema non è utilizzabile — che oggi non esiste — e la scelta fra rimuovere e rimandare si farà su dati anziché su un commento nel codice.
- Il rischio da sorvegliare: attivare `PermissionGuard` su endpoint oggi protetti dai soli ruoli potrebbe **cambiare chi può fare cosa**. Ogni attivazione va verificata contro il comportamento atteso, non data per scontata.
