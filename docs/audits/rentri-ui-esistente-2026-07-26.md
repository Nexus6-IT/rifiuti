# Audit — area RENTRI esistente nel frontend WasteFlow

Data: 2026-07-26
Autore: analista flussi utente / UI (sessione Claude)
Scope: sola analisi, nessuna modifica di codice. Obiettivo: fotografare con precisione da cosa parte la progettazione di un'area "operatività RENTRI" (l'idea del committente è operare su RENTRI senza mai aprire il portale dell'ente).

---

## 1. Inventario di ciò che esiste oggi

| Componente | Rotta frontend | API chiamate | Backend esiste? | Funziona? |
|---|---|---|---|---|
| `RentriCredentialComponent` (`apps/frontend/src/app/features/rentri/rentri-credential.component.ts`) | `/rentri/certificato` (registrata in `app.routes.ts:163-167`) | `GET/PUT/DELETE /api/v1/rentri/credential` via `RentriCredentialService` (`rentri-credential.service.ts`) | Sì — `RentriCredentialController` (`apps/backend/src/api/rentri/rentri-credential.controller.ts`, `@Controller('rentri/credential')`, `@Put/@Get/@Delete`), registrato nei `controllers` di `RentriModule` (`apps/backend/src/infrastructure/rentri/rentri.module.ts:27`), a sua volta importato in `app.module.ts:37,116` | **SÌ, funzionante e raggiungibile.** Unico pezzo dell'area RENTRI davvero cablato end-to-end. |
| `RENTRISyncBadgeComponent` (`apps/frontend/src/app/features/fir/components/rentri-sync-badge/rentri-sync-badge.component.ts`) | Nessuna — non instradato, e **non incluso in nessun `imports: []` di altri componenti** (grep su tutto `apps/frontend/src` non trova utilizzi fuori dalla propria cartella) | `GET /api/v1/rentri/sync/status/:jobId` via `RENTRISyncService.getSyncStatus` | Il controller esiste (`RentriSyncController`, `apps/backend/src/api/rentri/rentri-sync.controller.ts`, `@Controller('rentri/sync')`) ma **non è mai registrato in nessun modulo Nest** (non compare in `controllers:` di `RentriModule` né altrove — grep mirato conferma) | **NO.** Componente pronto e ragionevolmente completo (polling, tag colorati, tooltip) ma orfano: nessuna pagina lo monta, e anche se lo montassi le sue chiamate 404 perché il controller non è wired nel modulo. |
| `RENTRISyncLogsComponent` (`.../fir/components/rentri-sync-logs/rentri-sync-logs.component.ts`) | Nessuna — stesso discorso, non incluso da nessuna pagina | `GET /api/v1/rentri/sync/logs` (+ filtri stato/data/paginazione) via `RENTRISyncService.getSyncLogs` | Stesso controller `RentriSyncController`, stesso problema di non registrazione | **NO**, stesso motivo: componente-tabella completo (filtri, paginazione lazy, formattazione durata/errore) ma irraggiungibile sia da rotta sia da API. |
| `RENTRISyncService` (`apps/frontend/src/app/features/fir/services/rentri-sync.service.ts`) | — | `sync/fir/:id` (POST), `sync/batch` (POST), `sync/status/:jobId` (GET), `sync/logs` (GET), `sync/metrics` (GET) | Tutti gli endpoint esistono nel controller (`@Post('fir/:id')`, `@Post('batch')`, `@Get('status/:jobId')`, `@Get('logs')`, `@Get('metrics')`) ma il controller non è nei `controllers` di alcun `@Module` | **NO per tutti i metodi**: il service è completo lato contratto ma ogni chiamata arriverebbe a un endpoint non montato (assenza di routing Nest, non un 401/403 — proprio non esiste la rotta). Conferma il pattern già noto in questo progetto ("interfacce che chiamano endpoint inesistenti"). |
| `SyncFIRToRentriUseCase`, `TriggerBatchSyncUseCase` (`apps/backend/src/application/rentri/*.use-case.ts`) | — | — | Logica applicativa presente e con test (`sync-fir-to-rentri.use-case.spec.ts`) | La logica di dominio esiste ma non è esposta: il controller che dovrebbe chiamarla non è registrato. È un sottosistema completo (use case + controller) scollegato dal grafo DI dell'app, non codice mancante bensì codice "spento". |

**Verifica di wiring backend** (`apps/backend/src/infrastructure/rentri/rentri.module.ts`):
```
controllers: [RentriCredentialController]
```
`RentriSyncController` non compare. Nessun altro modulo lo importa (`grep -rln "RentriSyncController" apps/backend/src` restituisce solo il file del controller stesso). Effetto pratico: tutte le rotte `/api/v1/rentri/sync/*` rispondono 404 in produzione oggi.

**Verifica campo dati**: lo schema Prisma (`apps/backend/prisma/schema.prisma`, righe 283-333) ha già le colonne sul FIR:
```
rentriSyncStatus      RENTRISyncStatus @default(PENDING) @map("rentri_sync_status")
rentriProtocolNumber  String?          @map("rentri_protocol_number")
rentriSyncedAt        DateTime?        @map("rentri_synced_at")
rentriSyncAttempts    Int              @default(0) @map("rentri_sync_attempts")
rentriLastSyncError   String?          @map("rentri_last_sync_error")
rentriNextRetryAt     DateTime?        @map("rentri_next_retry_at")
```
più l'enum `RENTRISyncStatus` e un indice dedicato. Il dato quindi **esiste ed è persistito** — è il canale di esposizione (controller + integrazione UI) a mancare, non il modello dati.

---

## 2. Dove comparirebbe oggi lo stato RENTRI nel flusso FIR — e dove non compare

Il ciclo di vita del FIR (BOZZA → EMESSO → IN_TRANSITO → CONSEGNATO/ANNULLATO) è oggi presentato all'utente in un'unica pagina: `apps/frontend/src/app/features/fir/fir-list.component.ts`, instradata su `/fir`. **Non esiste una pagina di dettaglio FIR separata** (nessun file con "detail" sotto `features/fir`, nessuna rotta `fir/:id`): tutto — creazione, transizioni di stato, firma — avviene da dialog/azioni inline sulla riga della tabella lista.

La tabella ha colonne fisse (righe 142-147 del componente):
```
Numero | CER | Quantità | Stato | Data creazione | Azioni
```
La colonna **"Stato"** mostra solo lo stato di ciclo-vita interno (BOZZA/EMESSO/IN_TRANSITO/CONSEGNATO/ANNULLATO) tramite `p-tag` con `getStatoSeverity()`. **Non c'è alcuna colonna, badge o indicatore relativo allo stato di sincronizzazione RENTRI** in questa vista — né nel markup né nei dati caricati per riga (nessun riferimento a `rentriSyncStatus`/`rentriProtocolNumber`/`syncJobId` in `fir-list.component.ts`, verificato via grep mirato, zero occorrenze).

Questo conferma due cose distinte:
1. Il componente `RENTRISyncBadgeComponent` (badge di stato sync già pronto, con polling e tooltip) è stato costruito pensando esattamente a questo posto — la sua stessa docstring di esempio d'uso lo mostra iniettato con `[rentriSyncStatus]`, `[syncJobId]`, `[protocolNumber]` presi da un oggetto FIR — ma **non è mai stato agganciato** alla tabella reale.
2. Il punto di aggancio naturale, oggi, è **una nuova colonna accanto a "Stato"** nella stessa `fir-list.component.ts` (o, se in futuro verrà introdotta una pagina di dettaglio FIR dedicata, una sezione lì). Non serve inventare un nuovo luogo: la sede è già implicita nella struttura della tabella e nel componente già scritto ma non collegato.

Il piano `e2e/SELECTORS-DEBT.md` (riga 35) documenta già la convenzione di naming attesa per questi selettori — `rentri-sync-badge-{numeroFir}`, `rentri-sync-logs-table` — segno che l'integrazione era prevista ma non completata.

---

## 3. Gestione delle credenziali RENTRI — cosa permette oggi

Pagina `/rentri/certificato` (`RentriCredentialComponent`), unico punto dell'area RENTRI realmente operativo:
- **Chi può accedere**: solo ruoli `ADMIN` o `SUPER_ADMIN` del tenant (`ADMIN_ROLES` in cima al file, verificato via `AuthService.currentUser()?.role`); un non-admin vede solo un messaggio "Accesso riservato agli amministratori" (nessuna chiamata API viene fatta). L'enforcement è dichiarato "lato componente + backend" nel commento della rotta — non verificato in questa sessione se il backend applica davvero un guard equivalente sul controller (fuori scope di questo audit, da controllare prima di riusare il pattern).
- **Cosa può fare un admin**:
  - Vedere lo stato corrente: configurato/non configurato, client ID, ambiente (demo/live) — mai la chiave privata (esplicitamente mai restituita dal backend, per policy di sicurezza dichiarata nel commento del componente e nel servizio).
  - Caricare un nuovo certificato in due modalità: **PKCS#12** (file `.p12`/`.pfx` + passphrase, letto via `FileReader` e convertito in base64 lato client) oppure **PEM** (incolla certificato + chiave privata in due textarea).
  - Scegliere ambiente (Demo/Produzione) e algoritmo di firma (RS256/ES256).
  - Rimuovere il certificato, con dialog di conferma PrimeNG (`p-confirmDialog`) che avverte esplicitamente che le trasmissioni live si fermeranno.
- Non c'è alcuna funzione di "test connessione" o verifica di validità del certificato oltre al salvataggio: l'utente scopre se il certificato è valido solo al primo utilizzo effettivo (fuori da questa pagina).

Questa pagina è l'unico precedente concreto di "operare su RENTRI dall'app": è un buon riferimento di stile (layout `page`/`surface-card`, gestione ruoli, dialog di conferma) ma copre solo la gestione credenziali, non alcuna operatività sui formulari.

---

## 4. Debito di testabilità (`e2e/SELECTORS-DEBT.md`)

Il file censisce le convenzioni di `data-testid` previste ma non ancora implementate. Righe rilevanti:

```
FIR                  | fir-list.component.ts                          | fir-nuovo-button, fir-row-{numeroFir}, fir-emetti-{numeroFir},
                                                                          fir-presa-in-carico-{numeroFir}, fir-conferma-consegna-{numeroFir},
                                                                          fir-annulla-{numeroFir}, fir-status-badge-{numeroFir}
FIR — firma          | signature-dialog/*                             | signature-dialog, signature-dialog-confirm-button
FIR — sync RENTRI    | rentri-sync-badge/*, rentri-sync-logs/*        | rentri-sync-badge-{numeroFir}, rentri-sync-logs-table
RENTRI — Certificato | rentri-credential.component.ts                 | rentri-credential-upload-input, rentri-credential-save-button,
                                                                          rentri-credential-delete-button
```

Verifica diretta sul codice sorgente: **zero occorrenze di `data-testid`** in tutti e quattro i file (`fir-list.component.ts`, `rentri-credential.component.ts`, `rentri-sync-badge.component.ts`, `rentri-sync-logs.component.ts` — grep con conteggio, risultato 0 su tutti). Il documento descrive quindi una convenzione **pianificata ma non ancora applicata** — è un piano di naming, non uno stato di fatto. Per l'area RENTRI/FIR il debito è totale: nessun selettore stabile esiste oggi, i test E2E (se presenti in `e2e/`) devono necessariamente ancorarsi a testo visibile o struttura DOM fragile.

**Implicazione per una nuova area RENTRI**: va costruita con `data-testid` fin dal primo commit, seguendo esattamente lo schema già scritto in `SELECTORS-DEBT.md` (pattern `{area}-{azione}-{chiave-business}`, es. `fir-emetti-{numeroFir}` — mai l'indice di riga) invece di aggiungerlo a posteriori come non è stato fatto qui.

---

## 5. Convenzioni dell'interfaccia da rispettare

Osservate in modo coerente su `fir-list.component.ts` e `rentri-credential.component.ts` (gli unici due componenti "reali" dell'area, uno raggiungibile e uno pronto ma isolato):

1. **Struttura di pagina fissa**: `<div class="page">` → `<header class="page-header">` con `page-header__titles` (h1 `page-title` + p `page-subtitle`) e opzionale `page-actions` a destra → sezioni in `<section class="surface-card">`. Una nuova area RENTRI deve riusare esattamente queste classi, non introdurne di proprie.
2. **Stati di caricamento ed errore standardizzati**: caricamento = `<i class="pi pi-spin pi-spinner">` + testo "Caricamento…"; errore = blocco `class="empty-state"` con icona `pi-exclamation-triangle` colorata `var(--color-danger)`, titolo (`empty-state__title`), frase esplicativa, e pulsante "Riprova" (`pi pi-refresh`, `outlined`). Il pattern è identico in entrambi i file (loading/error signal + template condizionale con `*ngIf`).
3. **Italiano ovunque nel testo utente, identificatori in inglese nel codice**: label, messaggi di errore/successo (via `ToastService`/`MessageService`), tooltip e aria-label sono tutti in italiano ("Impossibile caricare...", "Salva certificato", "Rimuovi certificato del tenant"); nomi di variabili/metodi restano in inglese salvo termini di dominio intraducibili. Il `RENTRISyncBadgeComponent`/`RENTRISyncLogsComponent` **violano già questa convenzione** in alcuni punti (badge con testo inglese "Syncing 42%", "Retry 3/5", "Unknown"; commenti JSDoc interamente in inglese) — segnale utile: se si riusano questi due componenti orfani per la nuova area, vanno prima riallineati in italiano, non riusati as-is.
4. Altri dettagli minori ma sistematici: PrimeNG per ogni elemento interattivo (`p-button`, `p-tag`, `p-dropdown`, `p-table` con `[lazy]="true"` e `onLazyLoad` per le tabelle paginate), `ConfirmationService`/`p-confirmDialog` per ogni azione distruttiva, variabili CSS (`var(--spacing-*)`, `var(--color-*)`, `var(--font-*)`) invece di valori hardcoded, `aria-label`/`aria-describedby` su tutti i controlli di form.

---

## Sintesi per il coordinatore

- L'area RENTRI "visibile e funzionante" oggi si riduce alla sola gestione del certificato (`/rentri/certificato`), riservata ad ADMIN/SUPER_ADMIN.
- Esiste un intero sottosistema di sincronizzazione FIR↔RENTRI (2 componenti UI, 1 service, 1 controller backend con 5 endpoint, 2 use case applicativi, colonne dati già in Prisma) che è **completo ma spento**: il controller backend non è registrato in nessun modulo Nest, quindi ogni chiamata da UI fallirebbe con 404 anche se i componenti venissero instradati.
- Non esiste ancora una pagina di dettaglio FIR: tutto vive nella lista `/fir`.
- Il debito sui `data-testid` è totale per quest'area (zero presenti, solo pianificati in un documento).
