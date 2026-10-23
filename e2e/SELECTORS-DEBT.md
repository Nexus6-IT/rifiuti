# Debito di testabilità — `data-testid` da aggiungere al frontend

Fonte: audit `docs/audits/uat-2026-07-25/02-frontend-flows.md` §4
("Testabilità: selettori disponibili / mancanti"). Su 54 componenti
feature, i `data-testid`/`data-cy` sono presenti in sole 6 aree (~10% di
copertura). Questo file elenca, area per area, i `data-testid` da aggiungere
— con file e componente — per rendere i Page Object di `e2e/pages/` robusti
invece di appoggiarsi a testo/ARIA/classi CSS fragili.

**Non è stato modificato alcun file del frontend per produrre questo
elenco o questa suite** (fuori ambito per questo agente): è debito tecnico
da assegnare a chi lavora su `apps/frontend/**`.

## Convenzione suggerita

- Bottoni azione lista: `data-testid="{area}-nuovo-button"` (es. `fir-nuovo-button`).
- Righe tabella: `data-testid="{area}-row-{businessId}"` (usare l'id di
  business — numero FIR, codice CER, id anagrafica — non l'index di riga).
- Bottoni azione per riga: `data-testid="{area}-{azione}-{businessId}"` (es.
  `fir-emetti-{numeroFir}`, coerente con il pattern già usato in
  `my-assignments` — `assignment-{firId}`, `start-pickup-{firId}`).
- Badge di stato: `data-testid="{area}-status-badge"`.
- Dialog di conferma: `data-testid="{area}-confirm-dialog"` +
  `data-testid="{area}-confirm-dialog-confirm-button"` /
  `-cancel-button`.
- Toast successo/errore: `data-testid="toast-success"` / `data-testid="toast-error"`
  (globale, un solo componente toast presumibilmente condiviso).

### ATTENZIONE — collisione dei selettori per prefisso

Lo schema `{area}-{azione}-{businessId}` sopra **collide** con qualunque
altro `data-testid` dell'area che inizi per lo stesso prefisso testuale —
in particolare con `{area}-{azione}-dialog` (e i suoi controlli interni,
es. `{area}-{azione}-input-quantita`, `{area}-{azione}-conferma`). Esempio
reale, trovato e corretto il 2026-09-14 in `rentri-blocchi.component.ts`:
il bottone per riga è `rentri-blocchi-vidima-{codiceBlocco}` e il dialog è
`rentri-blocchi-vidima-dialog` — un selettore scritto per prefisso
(`[data-testid^="rentri-blocchi-vidima-"]`) su tutta la pagina trova
**sempre** anche l'host del dialog, anche a dialog chiuso e con zero righe
in pagina (l'host non sparisce mai dal DOM, v. punto sotto), rompendo un
conteggio o uno `test.skip()` che si aspettava 0.

**Rimedio**: mai un selettore per prefisso su tutta la pagina quando un
`{businessId}` dinamico condivide il prefisso con un nome fisso come
`-dialog`. O si sceglie un prefisso che non sia sottostringa di un altro
testid dell'area (es. `{area}-riga-vidima-{businessId}` invece di
`{area}-vidima-{businessId}` quando esiste anche `{area}-vidima-dialog`),
o — quando il nome non è più modificabile lato frontend — si scopa la
ricerca a un contenitore che il dialog non condivide (es.
`.locator('[data-testid^="…"]')` dentro al `listAttivi`/contenitore delle
righe, mai su `page` intera). Vedi `RentriBlocchiPage.vidimaButtons()` per
l'implementazione di riferimento, commentata con lo stesso ragionamento.

### ATTENZIONE — gli host dei componenti PrimeNG restano nel DOM, e non sono l'elemento nativo

Un `data-testid` (o qualunque attributo) messo direttamente sul tag di un
componente PrimeNG con wrapper (`<p-inputNumber>`, `<p-dropdown>`,
`<p-button>`, `<p-calendar>`, `<p-multiSelect>`, `<p-autoComplete>`, …)
atterra sull'**host custom-element**, non sull'`<input>`/`<button>` nativo
che il componente genera nel proprio template. Due conseguenze concrete,
trovate entrambe in `rentri-blocchi.component.ts` il 2026-09-14:

- **`.fill()`** su un locator che risolve all'host fallisce con "Element is
  not an `<input>`, `<textarea>` … " — `p-inputNumber` non è un campo,
  l'`<input>` vero è annidato dentro e ha un proprio `inputId` separato dal
  `data-testid` dell'host.
- **`toBeDisabled()`** su un locator che risolve all'host **non fallisce
  mai**, nemmeno quando il controllo è davvero disabilitato: Playwright
  ignora `disabled` su un elemento che non è un vero form control, e non lo
  legge dall'host di `p-button` — solo dal `<button>` nativo interno, dove
  PrimeNG lo applica per davvero (`[disabled]="disabled || loading"` nel
  template di `Button`). L'asserzione diventa quindi un'asserzione che non
  può fallire, non una verifica.
- In più, l'`*ngIf`/`*ngFor` del template Angular nasconde o rimuove il
  **contenuto** del componente, ma l'host stesso (quando è un elemento
  dichiarato a sé, come un `<p-dialog>`) può restare nel DOM anche a
  contenuto nascosto — non dare per scontato che "non visibile" significhi
  "assente", né viceversa.

**Rimedio**: quando il `data-testid` è sull'host di un componente PrimeNG
con wrapper, il Page Object non deve esporre quel locator così com'è per
azioni di campo/stato — deve scendere all'elemento nativo interno prima di
restituirlo, tipicamente `.locator('input')` (per `p-inputNumber`,
`p-inputText`) o `.locator('button')` (per `p-button`). Esempio applicato
in `rentri-blocchi.page.ts`:

```ts
// SBAGLIATO — .fill() lancia, toBeDisabled() non fallisce mai:
this.vidimaInputQuantita = page.getByTestId('rentri-blocchi-vidima-input-quantita')
this.vidimaConferma = page.getByTestId('rentri-blocchi-vidima-conferma')

// CORRETTO — scende all'elemento nativo che il componente genera:
this.vidimaInputQuantita = page.getByTestId('rentri-blocchi-vidima-input-quantita').locator('input')
this.vidimaConferma = page.getByTestId('rentri-blocchi-vidima-conferma').locator('button')
```

Per i dropdown (`p-dropdown`, apertura via click, poi scelta nell'overlay
`.p-dropdown-item`) l'apertura NON soffre della stessa trappola di
`.fill()`/`toBeDisabled()`: cliccare l'`<div #container>` interno (dove
PrimeNG mette `(click)="onContainerClick($event)"`, v.
`node_modules/primeng/esm2022/dropdown/dropdown.mjs`) o un suo discendente
apre comunque l'overlay, perché un click su un discendente fa comunque
bubbling fino al listener del container. `selezionaDropdown()` (v.
`e2e/tests/registry/trasportatore-destinatario.spec.ts`) NON clicca l'host
`<p-dropdown>`: clicca `#{inputId}` — lo `<span role="combobox"
[attr.id]="inputId">` interno che PrimeNG genera nel container, un
discendente, non l'elemento con l'handler — e funziona per bubbling, non
perché "l'host va bene". Quando serve leggere/scrivere lo stato di un campo
o di un bottone (`.fill()`, `toBeDisabled()`), invece, il bubbling non
aiuta: lì l'elemento nativo giusto va preso esplicitamente, come nei
rimedi sopra.

## Elenco per area (priorità = valore di business, da audit)

| Area                           | File componente                                                               | `data-testid` mancanti prioritari                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FIR                            | `apps/frontend/src/app/features/fir/fir-list.component.ts`                    | `fir-nuovo-button`, `fir-row-{numeroFir}`, `fir-emetti-{numeroFir}`, `fir-presa-in-carico-{numeroFir}`, `fir-conferma-consegna-{numeroFir}`, `fir-annulla-{numeroFir}`, `fir-status-badge-{numeroFir}`                                                                                                                                                                                                                            |
| FIR — firma                    | `apps/frontend/src/app/features/fir/signature-dialog/*`                       | `signature-dialog`, `signature-dialog-confirm-button`                                                                                                                                                                                                                                                                                                                                                                             |
| Registro C/S                   | `apps/frontend/src/app/features/registro/registro.component.ts`               | `registro-nuovo-movimento-button`, `registro-row-{id}`, `registro-filtro-periodo`, `registro-filtro-cer`                                                                                                                                                                                                                                                                                                                          |
| CER                            | `apps/frontend/src/app/features/cer/cer-search.component.ts`                  | `cer-search-input`, `cer-row-{code}`, `cer-category-filter`                                                                                                                                                                                                                                                                                                                                                                       |
| MUD                            | `apps/frontend/src/app/features/mud/mud.component.ts`                         | `mud-anno-select`, `mud-genera-button`, `mud-export-download-link`                                                                                                                                                                                                                                                                                                                                                                |
| Giacenze                       | `apps/frontend/src/app/features/giacenze/giacenze.component.ts`               | `giacenze-alert-badge`, `giacenze-row-{cer}`                                                                                                                                                                                                                                                                                                                                                                                      |
| Contratti                      | `apps/frontend/src/app/features/contracts/contracts-list.component.ts`        | `contratti-nuovo-button`, `contratti-row-{id}`, `contratti-status-select-{id}`                                                                                                                                                                                                                                                                                                                                                    |
| ESG                            | `apps/frontend/src/app/features/esg/esg.component.ts`                         | `esg-filtro-periodo`, `esg-report-summary`                                                                                                                                                                                                                                                                                                                                                                                        |
| Anomalie                       | `apps/frontend/src/app/features/anomaly/anomaly.component.ts`                 | `anomalie-row-{id}`, `anomalie-status-badge-{id}`                                                                                                                                                                                                                                                                                                                                                                                 |
| Anagrafiche — dialog condiviso | `apps/frontend/src/app/features/registry/anagrafica-form-dialog.component.ts` | `anagrafica-form-dialog`, `anagrafica-form-save-button`, `anagrafica-form-cancel-button` — montato solo nel flusso rapido di "Nuovo FIR", non nelle pagine `/produttori`, `/trasportatori`, `/destinatari` (ciascuna ha un proprio dialog inline separato)                                                                                                                                                                        |
| Admin — Tenants                | `apps/frontend/src/app/features/admin/tenants/tenant-admin.component.ts`      | `admin-tenants-nuovo-button`, `admin-tenants-row-{id}`, `admin-tenants-status-button-{id}`                                                                                                                                                                                                                                                                                                                                        |
| Admin — Utenti                 | `apps/frontend/src/app/features/admin/users/user-admin.component.ts`          | `admin-users-nuovo-button`, `admin-users-row-{id}`, `admin-users-impersona-{id}`, `admin-users-role-select-{id}`                                                                                                                                                                                                                                                                                                                  |
| RENTRI — Certificato           | `apps/frontend/src/app/features/rentri/rentri-credential.component.ts`        | `rentri-credential-upload-input`, `rentri-credential-save-button`, `rentri-credential-delete-button`                                                                                                                                                                                                                                                                                                                              |
| Billing                        | `apps/frontend/src/app/features/billing/billing-page.component.ts`            | `billing-upgrade-button`, `billing-portal-link`                                                                                                                                                                                                                                                                                                                                                                                   |
| Reference data                 | `apps/frontend/src/app/features/reference-data/reference-data.component.ts`   | `reference-data-status-badge`, `reference-data-reseed-button` (azione sensibile — utile anche per verificare che sia effettivamente admin-gated in UI)                                                                                                                                                                                                                                                                            |
| Layout — navigazione           | `apps/frontend/src/app/shared/components/layout.component.ts`                 | `logout-button`, `tenant-switcher-dropdown`, `tenant-switcher-option-{id}`, `impersonation-banner`, `impersonation-exit-button` — **il layout attivo usa markup inline senza alcun `data-cy`**, a differenza dei componenti "orfani" `header.component.ts`/`tenant-selector.component.ts` che già hanno buoni testid ma non risultano montati: valutare se riusare quei componenti (con i loro testid) invece di duplicare markup |
| Login                          | `apps/frontend/src/app/features/auth/login.component.ts`                      | `login-accedi-button`                                                                                                                                                                                                                                                                                                                                                                                                             |
| Notifiche                      | `apps/frontend/src/app/features/notifications/notifications-page/*`           | `notification-row-{id}`, `notification-mark-read-{id}`, `notification-mark-all-read-button`                                                                                                                                                                                                                                                                                                                                       |

## Aree già con buona copertura (nessuna azione richiesta)

- **Anagrafiche — Produttori, Trasportatori, Destinatari (colmato 2026-09-14,
  Task 2 piano UAT/E2E)**: le tre pagine instradate
  (`produttori-list.component.ts`, `trasportatori-list.component.ts`,
  `destinatari-list.component.ts` — ciascuna col proprio dialog inline di
  creazione/modifica, distinto dal componente condiviso
  `anagrafica-form-dialog.component.ts`) espongono `{area}-nuovo-button`,
  `{area}-row-{id}`, `{area}-modifica-{id}`, `{area}-elimina-{id}`,
  `{area}-form-dialog`, `{area}-form-save-button`,
  `{area}-form-cancel-button`, `{area}-confirm-dialog` (`area` =
  `produttori`/`trasportatori`/`destinatari`, `id` = id di business
  dell'anagrafica). Il dialog di conferma eliminazione usa il template
  di default di PrimeNG `ConfirmationService` (non un dialog custom): il
  testid è solo sul contenitore `<p-confirmDialog>`, non sui pulsanti
  accetta/rifiuta interni — aggiungerli richiederebbe un template
  personalizzato, fuori perimetro per un task "solo attributi".
  Nello stesso lavoro è stato chiuso anche un difetto di prodotto trovato
  durante l'analisi: il campo facoltativo della data di scadenza
  (`scadenzaIscrizione`/`scadenzaAutorizzazione`) esisteva nel backend, nel
  cron e nella fascia di attenzione del cruscotto, ma non nei dialog inline
  di trasportatori/destinatari — l'unico punto UI in cui esisteva era il
  dialog condiviso, montato solo nel flusso "Nuovo FIR". Aggiunto con
  `trasportatori-scadenza-iscrizione-input` /
  `destinatari-scadenza-autorizzazione-input`.
- `features/permissions/pages/my-permissions/*` (`permission-discovery.component.ts`)
- `features/permissions/pages/permission-denied/*`
- `features/permissions/pages/my-assignments/*`
- **FIR — sync RENTRI (colmato in R1)**: `rentri-sync-badge/*` espone
  `rentri-sync-badge-{numeroFir}`; `rentri-sync-logs/*` espone
  `rentri-sync-logs-table` (+ `rentri-sync-logs-row-{id}`,
  `rentri-sync-logs-filter-status`, `rentri-sync-logs-refresh`, ecc.); la
  lista FIR (`fir-list.component.ts`) espone `fir-rentri-trasmetti-{id}`,
  `fir-rentri-riprova-{id}`, `fir-rentri-conferma-legame-{id}`. La nuova
  pagina di dettaglio `/fir/:id` (`fir-detail.component.ts`) espone un
  set completo: `fir-detail-page`, `fir-detail-rentri-status`,
  `fir-detail-rentri-numero-ufficiale`, `fir-detail-rentri-numero-proposto`,
  `fir-detail-rentri-origine`, `fir-detail-rentri-messaggio-errore`,
  `fir-detail-rentri-trasmetti`, `fir-detail-rentri-riprova`,
  `fir-detail-rentri-conferma-legame`, `fir-detail-rentri-vedi-certificato`.
- **RENTRI — accettazione/respingimento del carico (colmato in R3 Task 4)**:
  il dettaglio FIR aggiunge `fir-detail-rentri-accetta-carico` (pulsante che
  apre il dialog), `fir-detail-rentri-accettazione-dialog`,
  `fir-detail-rentri-accettazione-completa` / `-parziale` / `-respingi` (le
  tre opzioni), `fir-detail-rentri-accettazione-quantita-input`,
  `fir-detail-rentri-accettazione-causale-select`,
  `fir-detail-rentri-accettazione-motivo-input`,
  `fir-detail-rentri-accettazione-confirm-button` /
  `-cancel-button`.
- **RENTRI — annullamento del formulario, con nota (colmato in R3 Task 5)**:
  il dettaglio FIR aggiunge `fir-detail-rentri-annulla-formulario` (pulsante
  che apre il dialog), `fir-detail-rentri-annulla-dialog`,
  `fir-detail-rentri-annulla-motivo-input`,
  `fir-detail-rentri-annulla-cancel-button`,
  `fir-detail-rentri-annulla-confirm-button`.
- **RENTRI — allegati del formulario (colmato in R3 Task 6)**: il dettaglio
  FIR aggiunge `fir-detail-allegati-upload-input` (input `type="file"`,
  visibile solo per un FIR legato a RENTRI), `fir-detail-allegati-list`
  (contenitore dell'elenco locale) e, per riga, `fir-detail-allegati-row-{id}`
  / `fir-detail-allegati-elimina-{id}` (`{id}` = chiave primaria LOCALE della
  riga `FIRAllegatoRentri`, non l'`allegato_id` dell'ente).
- **RENTRI — stampa PDF e aggiornamento dello stato (colmato in R3 Task 7)**:
  il dettaglio FIR aggiunge `fir-detail-rentri-scarica-pdf` (scarica il PDF
  come `Blob` — il backend fa da tramite dello stream, mai un redirect al
  portale) e `fir-detail-rentri-aggiorna-stato` (azione ESPLICITA, chiama
  `/azioni` e riconcilia; nessun polling automatico).
- **RENTRI — aggancio dei formulari (colmato in R2 Task 8)**: la pagina
  `/rentri/formulari` (`features/rentri/rentri-formulari.component.ts`) espone
  `rentri-formulari-search-input`, `-cerca-button`, `-table`, `-loading`,
  `-empty-state`, `-errore`, `-non-autorizzato`, `-sedi-link`, più i dinamici
  per riga `rentri-formulari-row-{numeroFir}`,
  `rentri-formulari-status-{numeroFir}`,
  `rentri-formulari-aggancia-{numeroFir}`; il dialog espone
  `rentri-formulari-confirm-dialog` (+ `-modalita-nuovo`, `-modalita-esistente`,
  `-fir-locale-select`, `-fir-locali-troncati`, `-confirm-button`,
  `-cancel-button`). Il dettaglio FIR aggiunge
  `fir-detail-rentri-rilascia-legame` e
  `fir-detail-rentri-rilascia-legame-confirm-dialog`.
  NB: questi nomi sono stati SCRITTI qui dopo l'implementazione, non prima —
  il piano di R2 li dava per già presenti in questo file e non lo erano.
  Restano mancanti i testid generali non-RENTRI della riga "FIR" sopra
  (`fir-nuovo-button`, `fir-row-{numeroFir}`, `fir-emetti-{numeroFir}`,
  `fir-presa-in-carico-{numeroFir}`, `fir-conferma-consegna-{numeroFir}`,
  `fir-annulla-{numeroFir}`, `fir-status-badge-{numeroFir}`) — non toccati
  da R1.

- **RENTRI — diagnostica per l'utente (colmato in R5 Task 3)**: la pagina
  `/rentri/diagnostica` (`features/rentri/rentri-diagnostica.component.ts`)
  espone `rentri-diagnostica-certificato-scadenza`,
  `rentri-diagnostica-trasmissioni-recenti`,
  `rentri-diagnostica-formulari-attenzione`,
  `rentri-diagnostica-limitatore-stato` (nomi imposti dal piano
  `docs/superpowers/plans/2026-07-26-r5-robustezza.md`, Task 3 Step 3), più
  `-non-autorizzato`, `-loading`, `-aggiorna-btn`, `-trasmissioni-vuote`,
  `-nessun-formulario-attenzione`, `-limitatore-in-attesa`,
  `-limitatore-normale`, e i dinamici per riga
  `rentri-diagnostica-trasmissione-{id}` e
  `rentri-diagnostica-formulario-attenzione-{firId}`. Solo dati locali: la
  pagina non genera mai una chiamata verso RENTRI al caricamento,
  l'aggiornamento è un pulsante esplicito, mai un timer.

## Componenti "orfani" da chiarire (non un problema di selettori, ma di wiring)

- `core/layout/header/header.component.ts` e `core/layout/tenant-selector/tenant-selector.component.ts`
  hanno già `data-testid` ricchi ma **non risultano importati/montati** dal
  `LayoutComponent` attivo — verificare con il team se vanno ricollegati
  (in tal caso i testid sono già pronti) o rimossi come dead code.
- `features/verify/verify-signatures/verify-signatures.component.ts` — non
  routato da nessuna parte: se va ricollegato, prevedere testid al momento
  del wiring.
