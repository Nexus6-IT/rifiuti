# Prompt — Swarm "WasteFlow Production Ready (SaaS self-service)"

> Prompt di orchestrazione per uno swarm di agenti coordinati che porti WasteFlow
> da "pre-commerciale" a **production-ready come SaaS self-service**, chiudendo
> i bloccanti dell'audit `docs/audits/coherence-readiness-2026-06.md`.
> Decisioni del committente (2026-06-29): target **SaaS self-service completo**;
> dipendenze esterne **pronte-ma-non-collegate** (sandbox/mock + config via env,
> attivabili con credenziali reali); **bozze legali IT** (da validare con legale);
> multi-azienda **ri-scopo completo lato server**.

---

## 0. Obiettivo

Rendere WasteFlow vendibile e usabile in regola come SaaS self-service multi-tenant.
Tutto ciò che NON dipende da terzi va completato e **verificato live**; ciò che
dipende da certificati/contratti esterni (RENTRI, firma qualificata, provider
pagamenti reale) va implementato **fino al confine** con sandbox/mock e config
via env, marcato chiaramente "ATTIVARE CON CREDENZIALI".

Definizione di "fatto" per ogni workstream: codice + test (verdi) + typecheck/build,
commit su `develop` (messaggi italiani, **nessuna attribuzione AI**), e — dopo il
deploy batched in coda di fase — **verifica end-to-end live** via Playwright su
https://rifiuti.ignicraft.com.

---

## 1. Contesto condiviso (per OGNI agente)

- **Stack**: monorepo `apps/backend` (NestJS 10 + Prisma 5 + PostgreSQL 16 + Redis,
  DDD/CQRS, multi-tenant RLS via estensione Prisma + `TenantContext` AsyncLocalStorage)
  e `apps/frontend` (Angular 17 standalone + PrimeNG 17, design system "B": slate +
  teal `#0d9488`/`#0f766e`, IBM Plex, griglia 8pt, WCAG 2.1 AA).
- **Auth**: Keycloak SAML, realm `ignicraft`, client `rifiuti`; service account
  `rifiuti-admin` per provisioning. JWT con `sub`/`tenantId`/`role`.
- **Deploy**: push su `develop` (solo build) → merge fast-forward su `master`
  (build+deploy a Contabo `/opt/rifiuti/`, frontend `127.0.0.1:3017`, nginx TLS).
  Pipeline Gitea Actions; immagini taggate `sha-<short>` ⇒ `up -d` ricrea i
  container. Migrazioni Prisma applicate da `prisma migrate deploy` PRIMA dello
  start. **Deploy ~6 min, runner singolo: NIENTE push-storm** → l'orchestratore
  deploya in BATCH a fine fase, non per ogni commit.
- **Convenzioni**: Italian-first (UI/commenti/commit); identificatori codice in
  inglese salvo termini di dominio; ESLint+Prettier; TDD.
- **Stato attuale rilevante**: ciclo di vita FIR già esposto e funzionante live
  (vedi memory `rifiuti-fir-lifecycle` per i gotcha di persistenza/validazione da
  NON re-rompere: mappatura enum stato IT↔EN, `fir_number` nullable, `cer_code`
  VARCHAR(10), whitelist DTO `@IsObject/@ValidateNested`, liste registry in
  envelope paginato).

## 2. Vincoli HARD (non negoziabili, per tutti)

1. **Migrazioni forward-only e additive**; mai modificare una migrazione già
   applicata (crearne una nuova). Verificare con `prisma migrate deploy` in CI.
2. **Sicurezza**: chiavi/segreti mai nei commit/log/PR; chiavi private RENTRI/firma
   **cifrate a riposo**, mai restituite/loggate in chiaro; secret via env (.env mode 600).
3. **Non rompere i test esistenti**; ogni workstream aggiunge i propri.
4. **Isolamento multi-tenant**: nessuna query deve poter leggere dati di un altro
   tenant; aggiungere test anti-leak dove si tocca lo scoping.
5. **Commit**: messaggi in italiano, atomici, **senza** `Co-Authored-By`/attribuzioni AI.
6. **Nessun reboot del VPS** senza conferma; nessuna riscrittura della git history
   senza il passo dedicato e supervisionato (vedi WS-H).
7. Backend: `npx tsc --noEmit` + `npx jest` verdi prima del commit. Frontend:
   `npm run build` ok.

## 2-bis. Ricerca e analisi — OBBLIGATORIO per ogni agente

Prima di implementare, ogni agente DEVE fare analisi documentata con gli strumenti
disponibili — niente "a memoria", soprattutto su normativa e integrazioni:

- **WebSearch / WebFetch** — per fonti normative e ufficiali aggiornate: DM 59/2023
  e dPCM attuativi RENTRI, art.190/193/188-bis D.Lgs 152/2006, modello/tracciato
  **MUD** (Unioncamere/DPCM annuale), regole **conservazione a norma AgID** (10 anni),
  specifiche **firma qualificata/SPID-CIE + marca temporale (TSA)**, GDPR (DPA/privacy/
  ToS), e analisi competitiva (Winwaste/Soger/QuiRifiutiPro/Rifiutoo) per il listino.
  Citare le fonti (URL) nelle note/commit/PR di ogni workstream.
- **Context7** (`resolve-library-id` → `query-docs`) — per la documentazione
  aggiornata delle librerie/framework PRIMA di scrivere codice: NestJS, Prisma
  (migrazioni, relazioni, enum), class-validator/transformer, **Stripe** (checkout,
  webhook, billing, idempotency), **passport-saml**/Auth.js, BullMQ, Angular/PrimeNG.
- **MCP PrimeNG** (`mcp__primeng__*`) — per componenti, prop, accessibilità e token
  di tema lato frontend (coerenza design system "B" + WCAG AA).
- **MCP Playwright** (`mcp__plugin_playwright_playwright__*`) — per la verifica E2E
  live obbligatoria a fine fase.
- **RENTRI**: recuperare e verificare i **path OpenAPI reali** dei servizi formulari
  da rentri.gov.it / portale sviluppatori (non inventare endpoint).

Ogni workstream consegna una breve **nota di analisi** (fonti + decisioni) insieme al
codice. Dove la normativa è ambigua, l'agente segnala l'assunzione fatta.

## 3. Workstream

> Ogni workstream = un agente specializzato (o catena di agenti). Indicati: scopo,
> task, criteri di accettazione (CA), aree/file, dipendenze. Per evitare conflitti,
> gli agenti che toccano le STESSE aree girano in **worktree isolati** e vengono
> integrati dall'orchestratore; quelli con aree disgiunte vanno in parallelo.

### WS-A — Hardening multi-tenant (FONDAZIONALE, da fare per primo)
- **Scopo**: il cambio società deve ri-scopare i dati lato server per utenti
  multi-azienda; impedire qualsiasi leak cross-tenant.
- **Task**: per gli utenti membri di più società, onorare la società attiva via
  header `X-Tenant-ID` **validato** contro l'elenco società dell'utente (oggi
  l'header è ignorato per i non-super-admin → la lista usa il tenant statico del
  JWT). Allineare `TenantContextMiddleware`, le query registry/FIR e
  `req.user.tenantId` all'uso del tenant attivo. Endpoint per elenco società
  dell'utente + cambio società. Frontend: il tenant switcher invia l'header e
  ricarica i dati.
- **CA**: test anti-leak (utente A non vede dati di società non sue; cambio società
  cambia il set restituito); E2E: Mario cambia società → vede anagrafiche diverse.
- **Aree**: `core/middleware/tenant-context.middleware.ts`, `core/context`, registry
  use-cases/repos, frontend tenant switcher/interceptor. **Dipendenze**: nessuna
  (sblocca le altre).

### WS-B — Completezza FIR (campi obbligatori + fix display)
- **Scopo**: completare il FIR ai requisiti di legge (DM 59/2023, art.193 D.Lgs 152/2006).
- **Task**: persistere + esporre + mostrare in form e PDF i campi mancanti: stato
  fisico, caratteristiche di pericolo (HP), numero colli, destinazione R/D
  (recupero/smaltimento), annotazioni Campo 17; gestire la "4ª copia" (ritorno
  destinatario). Migrazione additiva per i campi non persistiti. Fix display
  "Sede legale: undefined" nelle liste anagrafiche (formatter frontend).
- **CA**: creazione FIR con tutti i campi → round-trip corretto in lista/PDF; test
  dominio + E2E. **Aree**: dominio/DTO/persistenza FIR, `pdf.service.ts`, frontend
  `fir-list.component.ts`, registry list components. **Dipendenze**: WS-A (scoping).

### WS-C — Registro cronologico C/S operativo
- **Scopo**: chiudere il bloccante "registro cronologico guscio" (`WasteMovement`
  mai scritto). Art.190 D.Lgs 152/2006.
- **Task**: scrittura movimenti di carico/scarico (collegati a FIR dove pertinente),
  numerazione progressiva, vidimazione/tempi di registrazione, query/lista con
  filtri, export. Backend dominio+API+job; frontend UI registro.
- **CA**: carico→scarico riducono la giacenza; progressivo corretto; anomalia
  "scarico>carico" intercettata (già presente la detection); E2E registro.
  **Aree**: dominio `waste-movement`, API, frontend feature registro.
  **Dipendenze**: WS-A.

### WS-D — RENTRI "pronto-ma-non-collegato"
- **Scopo**: portare l'integrazione RENTRI a "pronta ad attivarsi".
- **Task**: finalizzare il client ModI/AgID, formato xFIR conforme, **path OpenAPI
  formulari verificati** contro le specifiche; configurazione sandbox/`demoapi` via
  env; caricamento certificato lato admin (cifrato a riposo, mai loggato); retry/stato
  sync già presenti. Mock/sandbox testabili senza certificato reale. Marcare nel
  README/admin "ATTIVARE: caricare certificato + iscrizione RENTRI".
- **CA**: sync verso sandbox/mock end-to-end; nessuna chiave in chiaro nei
  log/risposte; test del mapping xFIR. **Aree**: `application/rentri`, infra RENTRI,
  admin credenziali. **Dipendenze**: nessuna forte (coordinare con WS-E sulle firme).

### WS-E — Firma FIR/registro "pronta-ma-non-collegata" + cablaggio endpoint
- **Scopo**: sostituire lo stub firma (ECDSA effimere + timestamp mock) con
  un'architettura attivabile e **cablare il controller firme** (oggi non registrato).
- **Task**: provider firma astratto e configurabile (firma qualificata QES / SPID-CIE
  + TSA reale) con implementazione sandbox/mock di default; registrare gli endpoint
  firma; collegare le firme alle transizioni FIR (oggi firma "applicativa"
  `FIRMA-NON-QUALIFICATA`). Marcare "ATTIVARE: provider QES + TSA".
- **CA**: endpoint firma raggiungibili e testati (sandbox); chiavi mai esposte;
  percorso di verifica firma funzionante. **Aree**: `core/services/signature*`,
  firma controller/module, FIR transitions. **Dipendenze**: coordinare con WS-B/WS-D.

### WS-F — Pagamenti & abbonamento (SaaS) [pronto-ma-non-collegato]
- **Scopo**: apparato commerciale: piani, pagamento, billing, enforcement.
- **Task**: integrazione provider pagamenti (Stripe) in **test mode**/env (chiavi via
  env, niente account reale ora); listino/piani (TRIAL/PROFESSIONAL/ENTERPRISE già
  in `Tenant.subscriptionTier`), checkout, webhook idempotenti, gestione stato
  abbonamento. **Enforcement** (oggi assente): scadenza, `SUSPENDED`, `firLimit`
  mensile, `userLimit` per azienda. Pagina billing in app.
- **CA**: in sandbox un upgrade/downgrade aggiorna piano e limiti; superato il
  limite FIR/utenti → blocco con messaggio chiaro; webhook test verdi. Marcare
  "ATTIVARE: chiavi Stripe live". **Aree**: nuovo modulo billing, `Tenant`/`User`
  limiti, frontend billing. **Dipendenze**: WS-A.

### WS-G — Onboarding self-service (signup)
- **Scopo**: registrazione autonoma di una nuova azienda+admin.
- **Task**: signup pubblico → crea tenant + utente admin, provisioning Keycloak via
  service account `rifiuti-admin` (vedi memory `rifiuti-admin-provisioning`),
  verifica email, attivazione trial. Coerente con WS-F (piano iniziale = TRIAL).
- **CA**: E2E: nuovo signup → login → tenant isolato e operativo. **Aree**: auth/
  onboarding, Keycloak provisioning, frontend signup. **Dipendenze**: WS-A, WS-F.

### WS-H — Sicurezza/GDPR & legali
- **Scopo**: conformità GDPR e apparato legale minimo.
- **Task**: (1) **Bonifica PII dalla git history** (`backup_*.sql` con CF/P.IVA
  committati) — operazione che **riscrive la history** (git filter-repo) e richiede
  force-push coordinato su Gitea origin + mirror GitHub: va eseguita come passo
  **dedicato e supervisionato** dall'orchestratore (NON in parallelo, con conferma).
  (2) Bozze IT di **DPA, Informativa privacy, ToS** (marcate "DA VALIDARE CON
  LEGALE"). (3) Predisposizione conservazione a norma AgID (10 anni) — almeno
  design + hook. **CA**: nessun PII residuo nei file tracciati; documenti presenti;
  `.gitignore` blinda i dump. **Aree**: repo history, `docs/legal/`, backup.
  **Dipendenze**: la bonifica history va schedulata quando il resto è committato
  (ultimo, per non perdere lavoro).

### WS-I — Affidabilità & go-live tecnico
- **Scopo**: rendere il deploy sicuro e osservabile.
- **Task**: CI come **gate** del deploy (lint/test rossi → bloccano `master`); fix
  test/lint attualmente rossi; **monitoring/error tracking** (Bugsink già su infra:
  wiring `SENTRY_DSN` backend+frontend, vedi nota infra globale); esporre `/metrics`
  + job Prometheus; **healthcheck frontend** (container "unhealthy" pur servendo 200);
  fix `GET /notifications/unread-count` → 502; **paginazione** liste; aggiornare
  `passport-saml`; backup off-site + **restore testato** (procedura documentata).
- **CA**: pipeline rossa blocca il deploy; errori applicativi visibili su Bugsink;
  `/metrics` raccolto; frontend healthcheck verde; 502 risolto. **Aree**: workflow
  Gitea, healthcheck Docker/compose, notifiche, infra. **Dipendenze**: nessuna forte
  (ma la "CI gate" va attivata DOPO che i test sono verdi, fine corsa).

### WS-J — Dati di riferimento
- **Scopo**: completare i cataloghi.
- **Task**: importare **ATECO** e **nazioni** (assenti); portare CER **497→catalogo
  ufficiale completo (~842)**; seed riproducibile (idempotente) e versionato.
- **CA**: count attesi; lookup CER completi; seed rieseguibile. **Aree**: reference
  data + seed/migrazioni dati. **Dipendenze**: nessuna (parallelo a tutto).

## 4. Orchestrazione

1. **Fase 0 — Fondazione** (sequenziale): WS-A (multi-tenant). In parallelo, perché
   disgiunto: WS-J (reference data). → deploy batch → E2E: scoping multi-azienda + cataloghi.
2. **Fase 1 — Fan-out compliance/prodotto** (parallelo, worktree isolati): WS-B, WS-C,
   WS-D, WS-E, WS-I. Integrazione a cura dell'orchestratore (risolvere conflitti su
   FIR/firma tra B/D/E). → deploy batch → E2E mirati per workstream.
3. **Fase 2 — SaaS** (parallelo dove possibile): WS-F poi WS-G (G dipende da F). →
   deploy batch → E2E: signup→trial→limiti→billing(sandbox).
4. **Fase 3 — Sicurezza/legale & gate** (sequenziale, supervisionato): bozze legali
   (parallelo), poi **CI gate** (WS-I parte 1) una volta verdi i test, infine
   **bonifica PII git history** (WS-H, con conferma + force-push coordinato).
5. **Fase 4 — Integrazione finale**: E2E completo del percorso vendibile, aggiornare
   `docs/audits/coherence-readiness-2026-06.md` (matrice → verde/giallo con evidenze)
   e le memory; report finale onesto (cosa è reale, cosa è "pronto-ma-non-collegato"
   e cosa serve da Graziano per attivarlo).

Regole di integrazione: deploy in BATCH a fine fase (no push-storm); ogni fase si
chiude solo con E2E live verde; un workstream che non passa la verifica non blocca
gli altri ma viene riportato con evidenza (status, body, screenshot).

## 5. Definition of Done globale
- Percorso vendibile verificato live: signup → azienda isolata → anagrafiche →
  registro C/S → FIR completo (creazione→ciclo→PDF) → MUD export → billing(sandbox)
  → enforcement limiti.
- Isolamento multi-tenant testato anti-leak. CI verde e gate del deploy attivo.
  Monitoring/error tracking attivi. Nessun PII nella history. Documenti legali presenti.
- Test verdi (backend+frontend), build ok, audit + memory aggiornati.

## 6. Da Graziano per "accendere" il pronto-ma-non-collegato (consegna finale)
- RENTRI: certificato + iscrizione (caricabili dall'admin) + conferma path OpenAPI.
- Firma: contratto provider QES/SPID-CIE + TSA → chiavi/endpoint via env.
- Pagamenti: account Stripe live → chiavi live via env.
- Legale: validazione DPA/Privacy/ToS con un legale.
