# WasteFlow — Analisi Dettagliata, Competitor, Gap & Piano (Giugno 2026)

> Documento prodotto il 2026-06-05 tramite swarm ruflo `swarm-1780648028091-uxxqsr`
> (agenti: code-analyzer / analyst / planner) + audit reale del codice sorgente e
> ricerca di mercato aggiornata. Sostituisce, dove in conflitto, le affermazioni
> "production-ready" della documentazione precedente, che sono risultate aspirazionali.

---

## 0. TL;DR (executive summary)

1. **Stato reale del prodotto**: WasteFlow **NON è production-ready**. È un **MVP parziale (~50%)** con architettura solida ma con integrazioni chiave **mockate o incomplete**. La dichiarazione "239/239 task completati" è di documentazione, non di codice.
2. **Cambio di contesto di mercato**: la finestra strategica su cui era costruita tutta la documentazione ("obbligo RENTRI imminente, ondata di nuovi clienti") **si è chiusa**. L'ultima scadenza di iscrizione (13/02/2026) è passata. Il **prossimo e unico forcing-function rilevante è il 16 settembre 2026: FIR digitale obbligatorio** (~3 mesi da oggi).
3. **Tensione critica**: WasteFlow è un **entrante tardivo** con RENTRI **mock-only**. Non può vincere la "scramble" di compliance: la deadline di iscrizione è passata, gli incumbent hanno già la base obbligata, e la certificazione RENTRI reale non è pronta.
4. **Raccomandazione**: smettere di rincorrere la deadline come narrativa di vendita. Concentrarsi su **(a) finire un prodotto reale e certificato RENTRI**, **(b) un beachhead sui consulenti ambientali** (alto leverage, switching cost), **(c) 2-3 differenziatori dove gli incumbent sono deboli** (AI, mobile/app autisti, pricing trasparente). Il marketplace e l'economia circolare sono fase 3, non fase 1.
5. **Prima ancora di tutto**: allineare la documentazione alla realtà, rimuovere i red flag (file spurî, backup nel codice), aggiungere CI/CD e chiudere gli 8 gap tecnici bloccanti.

---

## 1. Analisi del progetto (stato reale, basato sul codice)

### 1.1 Cos'è
SaaS B2B per la gestione digitale dei rifiuti per aziende italiane obbligate RENTRI. Monorepo:
- `apps/backend` — NestJS 10 + Prisma 5 + PostgreSQL 16 + Redis/BullMQ. ~335 file `.ts`, ~50k righe.
- `apps/frontend` — Angular 17 standalone + PrimeNG 17 + Signals. ~96 file `.ts`, ~26k righe.
- `apps/mobile` — **NON esiste** (promesso in doc).

### 1.2 Architettura (punto di forza reale)
- Clean Architecture / DDD ben applicata: Domain → Application (CQRS) → Infrastructure → API.
- Schema Prisma reale e ricco: **866 righe, 29 model** (Tenant, User, FIR, Produttore/Trasportatore/Destinatario, RBAC Role/Permission, AbacPolicy, PermissionAuditLog con chaining crittografico, Notification…). 4 migrazioni SQL.
- Firme digitali ECDSA-P256 **reali** (crypto nativo Node, non placeholder).
- Frontend che chiama **API reali** (HttpClient → backend), non dati mock.
- Build: backend e frontend **compilano** entrambi (frontend con warning su bundle/CommonJS).

### 1.3 Cosa è mock / incompleto / assente (verdetto per area)

| Area | Stato reale | Evidenza |
|---|---|---|
| Integrazione RENTRI | 🔴 **MOCK-ONLY** | Client reale ma punta a `localhost:3001` (`tools/rentri-mock`), storage in-memory. Nessuna chiamata alle API governative reali. |
| Multi-tenant | 🔴 **ROTTO** | `getContextTenantId()` fa fallback al *primo* tenant invece di estrarre dal JWT → rischio data-leak cross-tenant. |
| Permission Guard (RBAC) | 🔴 **INCOMPLETO** | Cache-only; fallback a DB "TODO Phase 3" non implementato. |
| MUD generator | 🟠 **STUB** | Recovery/disposal hardcoded a zero (manca campo `destinationType` nello schema). Compliance a rischio. |
| Firme ECDSA | 🟢 reale | crypto Node P-256; **manca** però timestamp RFC 3161 reale. |
| Auth SPID/CIE | 🟠 dev-only | passport-saml/Keycloak configurati ma Keycloak `start-dev`, `admin:admin`, no TLS. |
| Repository Prisma | 🟠 parziali | query reali ma ~78 TODO su mapping domain↔DB. |
| Email / Notifiche / PDF / BullMQ | 🟢 reali | nodemailer, pdfmake, code BullMQ funzionanti (config SMTP da fare in prod). |
| IAM/ABAC design | 🟢 modellato | entità complete; engine presente ma non completamente cablato. |
| Test | 🔴 **bassi** | backend 48 spec / 335 file (~14%), frontend **2 spec / 96 file (~2%)**. Coverage "80%" dichiarata = **falsa**. |
| CI/CD | 🔴 **ASSENTE** | nessun workflow `.github`/`.gitea`. |
| IaC / Terraform | 🔴 assente | solo docker-compose dev. |
| App mobile | 🔴 assente | — |

### 1.3.1 Red flag di igiene del codice
- File spurî `nul` (artefatti Windows) e `apps/frontend/src/app/nul` — da rimuovere.
- `pdf.service.ts.backup`, `pdf.service-fix.txt` nel sorgente — band-aid non rifiniti.
- ~114 TODO/FIXME nel backend.
- `apps/backend/prisma/fix-function.sql` non tracciato.

### 1.4 Verdetto di maturità
**MVP parziale in early development (~50%).** Non scheletro (il codice è reale e ben strutturato), ma lontano dal production-ready. **Stima per arrivare in produzione reale e certificata: 3-6 mesi** di lavoro focalizzato.

---

## 2. Analisi competitiva (aggiornata a Giugno 2026)

### 2.1 Cambio di scenario rispetto alla doc di Ottobre 2025
La doc `documentazione/02_analisi_competitiva.md` resta valida nelle strutture, ma la **premessa temporale è scaduta**:

- **13/02/2026** — ultima scadenza di iscrizione (produttori di pericolosi ≤10 dipendenti): **passata**. La platea obbligata è ora interamente "dentro".
- **13/02 → 15/09/2026** — periodo transitorio a **doppio binario** (FIR cartaceo *o* digitale); sanzioni differite.
- **16/09/2026** — **FIR digitale obbligatorio** per gran parte degli operatori iscritti (con alcune eccezioni per non pericolosi in edilizia/commercio/servizi/sanità). **Questo è il vero evento di mercato dei prossimi 3 mesi.**
- Vidimazione registri e FIR ora **solo digitale via RENTRI** (non più CCIAA).

**Implicazione**: il claim di vendita "adeguati alla scadenza RENTRI" è ormai bruciato per l'iscrizione; resta valido — ma stretto — solo per la transizione al **FIR digitale entro il 16/09/2026**. Per coglierlo servirebbe RENTRI reale e certificato *adesso*, cosa che WasteFlow non ha.

### 2.2 Quadro competitor (sintesi 2026)

| Competitor | Posizionamento | Nota 2026 |
|---|---|---|
| **WinWaste** (NICA / Zucchetti) | Leader enterprise, 2.500+ clienti, filiera completa | Brand fortissimo, ecosistema Zucchetti/Digital HUB. UX tradizionale, no mobile-first, pricing opaco. |
| **Rifiutoo** (Sfridoo) | Challenger cloud per produttori iniziali + consulenti, 2.000+ clienti | **Ora nello Zucchetti Store** e integrato in ecosistema Magia Srl → **consolidamento con Zucchetti**. Pricing a *movimenti* (Essential 70/200 mov/anno, Custom Pro), pagamento annuale anticipato, entry tier mono-azienda/utente/device. È il rivale più vicino al target "micro-PMI semplice". |
| **Ambiente.it / ECOS** (Terranova) | Leader utility/TARI, 12M+ utenti TARI | Enterprise, overkill per micro. |
| **TeamSystem TS Waste** | Modulo rifiuti nell'ecosistema TeamSystem | Forza distributiva + cross-sell su base ERP esistente. |
| **QuiRifiutiPro** (Buffetti) | PMI/professionisti, pricing pubblico | Semplice, brand familiare, funzioni base. |
| **PrometeoRifiuti** (Informatica EDP) | Filiera, semplice, cloud/on-prem | Brand debole, UX datata. |
| **RifiutiGuru, Ecosolve, Savino, Centro Software** | Long tail cloud RENTRI | Pricing aggressivo, funzioni base. |

### 2.3 Gap di mercato ancora aperti (dove gli incumbent sono deboli)
Questi restano veri nel 2026 e sono le uniche leve di differenziazione credibili:
1. **AI / automazione** — pressoché assente in tutti. (Suggerimento CER da descrizione, auto-compilazione, anomaly detection, chatbot normativo RAG.)
2. **Mobile-first / app autisti offline** — nessuno ha un'app nativa completa per la firma FIR in campo.
3. **Pricing trasparente** — solo Rifiutoo/QuiRifiutiPro pubblicano; gli enterprise no.
4. **Marketplace B2B** (matching produttore↔trasportatore↔impianto) — inesistente.
5. **Economia circolare / ESG reporting** — quasi assente (solo enterprise, parziale).
6. **IoT (bilance/sensori)** — non nativo in nessuno.

### 2.4 Minacce specifiche per WasteFlow
- **Consolidamento**: Rifiutoo+Zucchetti riduce lo spazio "challenger semplice".
- **Distribuzione**: TeamSystem/Zucchetti hanno reti commerciali e basi ERP; WasteFlow parte da zero.
- **Commoditizzazione**: rischio di essere "solo un'altra interfaccia RENTRI".
- **Tempistica**: per il FIR-digitale-16/09 è già tardi per costruire certificazione + acquisire clienti.

---

## 3. Gap Analysis consolidata

### 3.1 Gap tecnici bloccanti (dal codice) — ordine di priorità
1. **RENTRI reale**: sostituire il mock con il client verso le **API RENTRI ufficiali** (ambiente di test/interoperabilità del portale `rentri.gov.it`), gestione token/firma, e avviare il **processo di accreditamento/interoperabilità**.
2. **Isolamento multi-tenant**: estrazione tenant dal JWT + enforcement RLS verificato. (Sicurezza/GDPR — bloccante assoluto.)
3. **Permission Guard completo**: query DB su ruoli/permessi, non solo cache.
4. **MUD reale**: aggiungere `destinationType`/recupero-smaltimento allo schema e implementare l'aggregazione vera.
5. **Test**: portare backend a coverage reale ≥70% sui path critici, frontend a una base minima (auth, FIR, dashboard) + smoke e2e.
6. **CI/CD**: pipeline lint+test+build+security-scan (Gitea Actions, coerente con l'infra esistente).
7. **Hardening prod**: Keycloak production (no `start-dev`, TLS, secret reali), timestamp RFC 3161, SMTP/S3 reali.
8. **Igiene**: rimuovere file spurî/backup, ridurre i 114 TODO, allineare la documentazione.

### 3.2 Gap di prodotto (vs mercato)
- Nessuna feature AI realmente attiva (sono tutte "pianificate").
- Nessuna app mobile (il modulo task-assignment autisti è solo frontend web).
- Marketplace, IoT, ESG, ERP: tutti "pianificati".

### 3.3 Gap di go-to-market
- Narrativa di vendita basata su una deadline ormai passata.
- Nessun canale di distribuzione né partnership (consulenti, associazioni di categoria).
- Posizionamento ambiguo (vedi §4): B2B micro-PMI self-service **vs** piattaforma PA modulare.

### 3.4 Decisione strategica — RISOLTA (2026-06-05)
**WasteFlow è un SaaS B2B per aziende.** Decisione confermata dal product owner:
- **NON** è un modulo per i Comuni/PA (potrà esser loro utile in futuro, ma non è l'oggetto né il buyer).
- È esplicitamente progettato anche per **consulenti / figure professionali che operano su più società** (studi ambientali, RSPP/HSE, commercialisti del settore): questo è un **pilastro di prodotto di prima classe**, non solo un canale go-to-market.

**Conseguenza tecnica critica**: la capacità "un professionista gestisce N società da un unico accesso" poggia interamente su **multi-tenant + isolamento dati + tenant-switching**. Nel codice attuale esistono già le entità giuste (`ConsultantTenantAssociation`, tenant selector nell'header, dashboard aggregata "tutti i clienti"), **ma il meccanismo di contesto tenant è rotto** (fallback al primo tenant invece di estrazione dal JWT — vedi §3.1 punto 2). Quindi **la feature che è il tuo differenziatore è oggi anche la più insicura**: un consulente potrebbe leggere/scrivere sui dati della società sbagliata. → **Sale a priorità tecnica massima** (Fase 1, prima di onboardare qualunque consulente reale).

Requisiti specifici "consulente multi-società" da garantire:
- Switch di società sicuro e tracciato (audit di ogni cambio contesto).
- Isolamento RLS verificato con test che dimostrano il non-leak tra società dello stesso consulente.
- Dashboard aggregata cross-società **senza** mai mescolare i dati in scrittura.
- Permessi per-società (un consulente può avere ruoli diversi su clienti diversi).
- Onboarding rapido di una nuova società nel portafoglio del consulente.

---

## 4. Piano dettagliato

Orizzonte realistico, con la consapevolezza che **non si arriva al 16/09/2026 con un prodotto certificato + clienti**. Il 16/09 va trattato come milestone di credibilità tecnica (FIR digitale che funziona davvero), non come campagna di vendita.

### FASE 0 — Verità & stabilizzazione (Settimane 1-3)
**Obiettivo: un repository onesto, pulito, con quality gate.**
- [ ] Allineare README/FEATURES/doc allo stato reale (Alpha/MVP). Rimuovere claim "production-ready/239 task/80% coverage".
- [ ] Rimuovere file spurî (`nul`, `*.backup`, `*-fix.txt`), tracciare/eliminare `fix-function.sql`.
- [ ] CI/CD Gitea Actions: `lint → test → build → audit` su ogni push (coerente con l'infra Gitea/runner già documentata).
- [ ] Test di sicurezza tenant: scrivere il test che dimostra l'isolamento (oggi fallirebbe) → red.
- [ ] Inventario TODO: classificare i 114 in "bloccante / importante / cosmetico".
**Deliverable**: branch `develop` verde in CI, doc veritiera, backlog tecnico priorizzato.

### FASE 1 — Core reale & production-ready (Mesi 1-3)
**Obiettivo: il prodotto fa davvero ciò che promette per il flusso base.**
- [ ] **RENTRI reale (priorità #1)**: client verso ambiente di test RENTRI ufficiale; gestione autenticazione/firma; mappatura xFIR completa; avvio iter di **interoperabilità/accreditamento**. Mantenere il mock solo per i test automatici.
- [ ] **Multi-tenant**: tenant dal JWT + middleware + verifica RLS + test di non-leak verde.
- [ ] **Permission guard** completo (DB + cache + invalidazione).
- [ ] **MUD reale**: schema + aggregazione recupero/smaltimento + export PDF/Excel verificati.
- [ ] **Hardening**: Keycloak prod (TLS, secret), timestamp RFC 3161, SMTP/S3 reali, rate-limit/CSRF verificati.
- [ ] **Test**: backend ≥70% sui path critici (FIR state machine, IAM, RENTRI sync, MUD); frontend smoke su auth/FIR/dashboard; 1-2 e2e golden-path.
- [ ] **Deploy** su VPS Contabo come stack `/opt/wasteflow/` (porta `127.0.0.1:30XX` libera, vhost nginx, certbot) — coerente con il pattern degli altri stack.
**Deliverable**: MVP funzionante e deployato in staging, FIR digitale end-to-end contro l'ambiente RENTRI di test.

### FASE 2 — Differenziazione (Mesi 3-6)
**Obiettivo: 2-3 motivi reali per scegliere WasteFlow invece di Rifiutoo/WinWaste.**
- [ ] **AI CER Assistant**: da descrizione rifiuto → codice CER suggerito (LLM + retrieval sul catalogo 842 CER già presente). Quick win ad alto impatto percepito.
- [ ] **Compliance calendar intelligente**: scadenze personalizzate per azienda + alert proattivi (registri, MUD, autorizzazioni trasportatori).
- [ ] **App autisti PWA mobile-first** (offline-capable): firma FIR in campo, GPS proximity, sync. Sfrutta il modulo task-assignment già impostato. PWA prima di nativa (costo/beneficio).
- [ ] **Pricing trasparente pubblico** (vantaggio vs incumbent): listino online, free tier, attivazione self-service.
- [ ] **Chatbot normativo RAG** sui decreti ambientali (D.Lgs 152/2006, D.M. 59/2023).
**Deliverable**: prodotto differenziato + sito con pricing pubblico + onboarding self-service.

### FASE 3 — Scala & ecosistema (Mesi 6-12)
- [ ] **Marketplace B2B** (preventivi trasportatori/impianti, rating) — network effect.
- [ ] **Integrazioni ERP** (Fatture in Cloud, TeamSystem) — riduce doppio lavoro, lock-in.
- [ ] **ESG / carbon footprint** + economia circolare (matching scarti).
- [ ] **IoT** (bilance/sensori) opzionale.
- [ ] Valutare opzione **(B) modulo PA** se emerge domanda dai Comuni.
**Deliverable**: piattaforma con moat (network + dati + integrazioni).

### 4.1 Go-to-market consigliato (realistico)
- **Beachhead = consulenti / professionisti multi-società** (5-8k in Italia): un consulente porta 20-50 aziende, switching cost alto, diventano promotori. La capacità multi-società (un accesso → N clienti) è il **core del prodotto** e il vantaggio nativo per questo segmento — gli incumbent enterprise non la offrono in modo semplice/economico, e Rifiutoo la copre solo nei tier alti "Custom Pro".
- **Posizionamento per il consulente**: "Gestisci tutti i tuoi clienti rifiuti da un'unica piattaforma, con isolamento garantito per società e una dashboard che ti dà la visione d'insieme." Questa è anche la leva di pricing: piano-consulente con costo per società gestita, non per singola licenza.
- **Tattica**: free tier per consulenti con pochi clienti, onboarding white-glove, content/SEO ("FIR digitale obbligatorio dal 16 settembre 2026: come adeguarsi"), webinar con associazioni di categoria.
- **Espansione**: dalle aziende-clienti dei consulenti → micro-PMI self-service.
- **Non** competere frontalmente sugli enterprise/utility (WinWaste/ECOS): perdente in partenza.

### 4.2 Pricing (ipotesi da validare)
- Allineato/inferiore a Rifiutoo ma con **pagamento mensile** (Rifiutoo è solo annuale anticipato = punto debole sfruttabile).
- Free tier reale per consulenti (acquisizione) e micro-imprese (trial).
- Differenziatori AI/mobile come upsell sui tier alti.

---

## 5. Rischi principali e mitigazioni

| Rischio | Impatto | Mitigazione |
|---|---|---|
| Accreditamento RENTRI lungo/complesso | Alto | Avviare l'iter **subito** in Fase 1; non dipendere dal mock. |
| Entrata tardiva, base già acquisita dagli incumbent | Alto | Non rincorrere; puntare su consulenti + differenziatori AI/mobile. |
| Risorse limitate (team piccolo) | Alto | Tagliare la roadmap: niente marketplace/IoT prima di un core reale. |
| Data-leak multi-tenant in produzione | Critico | Bloccante di Fase 1; test di isolamento prima di qualunque cliente. |
| Doc aspirazionale che inganna decisioni | Medio | Fase 0: allineamento alla realtà. |

---

## 6. Prossime azioni immediate (questa settimana)
1. Decidere il posizionamento §3.4 (A / B / C).
2. Avviare la richiesta di accesso all'**ambiente di test RENTRI** (sblocca tutta la Fase 1).
3. Pulizia repo + CI/CD (Fase 0).
4. Scrivere il test di isolamento multi-tenant (deve fallire oggi → guida il fix).
5. Allineare la documentazione.

---

### Appendice — Fonti di mercato (giugno 2026)
- RENTRI ufficiale — https://www.rentri.gov.it/
- Scadenze/obblighi 2026 — https://www.vi.camcom.it/it/servizi/ambiente/rentri-novita-2026.html
- FIR digitale obbligo dal 14/04 e transitorio al 15/09/2026 — https://biblus.acca.it/notizie/fir-digitale-verso-lobbligo-cosa-cambia-davvero-dal-14-aprile-2026/
- FIR digitale ordinario dal 14/04/2026 — https://ifin.it/news-in-evidenza/rentri-fine-dellemergenza-dal-14-aprile-2026-torna-lobbligo-del-fir-digitale-ordinario/
- Rifiutoo prezzi/posizionamento — https://www.rifiutoo.com/prezzi/produttore-iniziale/
- Rifiutoo nell'ecosistema Magia/Zucchetti — https://www.magia3.it/news/rifiutoo-entra-nell-ecosistema-magia-srl-gestione-digitale-dei-rifiuti-e-piena-conformita-al-rentri
