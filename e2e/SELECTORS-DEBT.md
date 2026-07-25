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

## Elenco per area (priorità = valore di business, da audit)

| Area | File componente | `data-testid` mancanti prioritari |
|---|---|---|
| FIR | `apps/frontend/src/app/features/fir/fir-list.component.ts` | `fir-nuovo-button`, `fir-row-{numeroFir}`, `fir-emetti-{numeroFir}`, `fir-presa-in-carico-{numeroFir}`, `fir-conferma-consegna-{numeroFir}`, `fir-annulla-{numeroFir}`, `fir-status-badge-{numeroFir}` |
| FIR — firma | `apps/frontend/src/app/features/fir/signature-dialog/*` | `signature-dialog`, `signature-dialog-confirm-button` |
| FIR — sync RENTRI | `apps/frontend/src/app/features/fir/components/rentri-sync-badge/*`, `rentri-sync-logs/*` | `rentri-sync-badge-{numeroFir}`, `rentri-sync-logs-table` |
| Registro C/S | `apps/frontend/src/app/features/registro/registro.component.ts` | `registro-nuovo-movimento-button`, `registro-row-{id}`, `registro-filtro-periodo`, `registro-filtro-cer` |
| CER | `apps/frontend/src/app/features/cer/cer-search.component.ts` | `cer-search-input`, `cer-row-{code}`, `cer-category-filter` |
| MUD | `apps/frontend/src/app/features/mud/mud.component.ts` | `mud-anno-select`, `mud-genera-button`, `mud-export-download-link` |
| Giacenze | `apps/frontend/src/app/features/giacenze/giacenze.component.ts` | `giacenze-alert-badge`, `giacenze-row-{cer}` |
| Contratti | `apps/frontend/src/app/features/contracts/contracts-list.component.ts` | `contratti-nuovo-button`, `contratti-row-{id}`, `contratti-status-select-{id}` |
| ESG | `apps/frontend/src/app/features/esg/esg.component.ts` | `esg-filtro-periodo`, `esg-report-summary` |
| Anomalie | `apps/frontend/src/app/features/anomaly/anomaly.component.ts` | `anomalie-row-{id}`, `anomalie-status-badge-{id}` |
| Anagrafiche — Produttori | `apps/frontend/src/app/features/registry/produttori-list.component.ts` | `produttori-nuovo-button`, `produttori-row-{id}`, `produttori-modifica-{id}`, `produttori-elimina-{id}` |
| Anagrafiche — Trasportatori | `apps/frontend/src/app/features/registry/trasportatori-list.component.ts` | `trasportatori-nuovo-button`, `trasportatori-row-{id}`, `trasportatori-modifica-{id}`, `trasportatori-elimina-{id}` |
| Anagrafiche — Destinatari | `apps/frontend/src/app/features/registry/destinatari-list.component.ts` | `destinatari-nuovo-button`, `destinatari-row-{id}`, `destinatari-modifica-{id}`, `destinatari-elimina-{id}` |
| Anagrafiche — dialog condiviso | `apps/frontend/src/app/features/registry/anagrafica-form-dialog.component.ts` | `anagrafica-form-dialog`, `anagrafica-form-save-button`, `anagrafica-form-cancel-button` |
| Admin — Tenants | `apps/frontend/src/app/features/admin/tenants/tenant-admin.component.ts` | `admin-tenants-nuovo-button`, `admin-tenants-row-{id}`, `admin-tenants-status-button-{id}` |
| Admin — Utenti | `apps/frontend/src/app/features/admin/users/user-admin.component.ts` | `admin-users-nuovo-button`, `admin-users-row-{id}`, `admin-users-impersona-{id}`, `admin-users-role-select-{id}` |
| RENTRI — Certificato | `apps/frontend/src/app/features/rentri/rentri-credential.component.ts` | `rentri-credential-upload-input`, `rentri-credential-save-button`, `rentri-credential-delete-button` |
| Billing | `apps/frontend/src/app/features/billing/billing-page.component.ts` | `billing-upgrade-button`, `billing-portal-link` |
| Reference data | `apps/frontend/src/app/features/reference-data/reference-data.component.ts` | `reference-data-status-badge`, `reference-data-reseed-button` (azione sensibile — utile anche per verificare che sia effettivamente admin-gated in UI) |
| Layout — navigazione | `apps/frontend/src/app/shared/components/layout.component.ts` | `logout-button`, `tenant-switcher-dropdown`, `tenant-switcher-option-{id}`, `impersonation-banner`, `impersonation-exit-button` — **il layout attivo usa markup inline senza alcun `data-cy`**, a differenza dei componenti "orfani" `header.component.ts`/`tenant-selector.component.ts` che già hanno buoni testid ma non risultano montati: valutare se riusare quei componenti (con i loro testid) invece di duplicare markup |
| Login | `apps/frontend/src/app/features/auth/login.component.ts` | `login-accedi-button` |
| Notifiche | `apps/frontend/src/app/features/notifications/notifications-page/*` | `notification-row-{id}`, `notification-mark-read-{id}`, `notification-mark-all-read-button` |

## Aree già con buona copertura (nessuna azione richiesta)

- `features/permissions/pages/my-permissions/*` (`permission-discovery.component.ts`)
- `features/permissions/pages/permission-denied/*`
- `features/permissions/pages/my-assignments/*`

## Componenti "orfani" da chiarire (non un problema di selettori, ma di wiring)

- `core/layout/header/header.component.ts` e `core/layout/tenant-selector/tenant-selector.component.ts`
  hanno già `data-testid` ricchi ma **non risultano importati/montati** dal
  `LayoutComponent` attivo — verificare con il team se vanno ricollegati
  (in tal caso i testid sono già pronti) o rimossi come dead code.
- `features/verify/verify-signatures/verify-signatures.component.ts` — non
  routato da nessuna parte: se va ricollegato, prevedere testid al momento
  del wiring.
