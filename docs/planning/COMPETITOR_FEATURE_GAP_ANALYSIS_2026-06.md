# WasteFlow — Analisi Funzionale Competitor, Gap & Piano di Sviluppo (Giugno 2026)

> Prodotto il 2026-06-10 tramite ricerca web multi-agente su fonti ufficiali dei competitor
> + audit della baseline funzionale di WasteFlow (codice + `docs/FEATURES.md`).
> Complementare a [ANALISI_E_PIANO_2026-06.md](./ANALISI_E_PIANO_2026-06.md) (strategia/mercato):
> qui il focus è **funzionalità per funzionalità**.

---

## 0. TL;DR

1. **Le funzionalità di compliance RENTRI sono ormai "table stakes"**: tutti i competitor (da Rifiutoo a WinWaste a QuiRifiutiPro al long-tail) offrono vidimazione xFIR, registri, MUD automatico, conservazione a norma. WasteFlow ha l'**architettura e il client RENTRI reale "pronto a connettersi"**, ma alcuni tasselli di compliance **mancano ancora** (conservazione AgID, download IV copia, giacenze/deposito temporaneo, verifica Albo Gestori, firma xFIR-conforme). **Questi sono i gap bloccanti per essere vendibili.**
2. **Il segmento "consulenti multi-società"** (beachhead scelto) è **già presidiato** da Rifiutoo, QuiRifiutiPro, RifiutiGuru, Ecosolve. WasteFlow ha un vantaggio architetturale non comune (RBAC+ABAC granulare, permessi temporanei, tenant switching), ma deve **rifinire la console consulente** e batterli su **pricing trasparente** e **assenza di cap volumetrici**.
3. **Dove quasi nessuno è arrivato (white space):** **AI** (suggeritore EER, OCR, anomaly detection, assistente normativo RAG) — quasi assente nel mercato italiano; **ESG/CO₂ derivata dal dato RENTRI** — gap netto e miglior rapporto impatto/sforzo; **pricing trasparente self-service** — solo QuiRifiutiPro pubblica i prezzi.
4. **Da NON inseguire:** marketplace di simbiosi (Sfridoo già posizionata, network effect) e IoT/hardware proprietario (capitale + certificazioni) → semmai **integrare via API**, non costruire.
5. **App autista offline + firma xFIR in campo:** dal 13/02/2026 è **requisito**, non differenziatore (ECOS X-FIR, TeamSystem, Sielco la offrono già). WasteFlow ha solo task-assignment web → **gap table-stakes, costoso → fast-follow di qualità**.
6. **Gestione contratti:** **NON è nell'app** (solo spec `CONTRACT_MANAGEMENT_MODULE.md`, nessun codice). I competitor diretti per lo più non ce l'hanno → **differenziatore potenziale da costruire** (G8 nel piano, Fase D), con alto switching cost e ARPU.

---

## 0.1 Stato implementazione WasteFlow (aggiornato 2026-06-13)

Implementati in questo ciclo (backend, con test; moduli cablati in AppModule):
- ✅ **ESG / CO₂ dal dato RENTRI** (D1) — `EsgService`, fattori CO₂ configurabili.
- ✅ **Giacenze + deposito temporaneo** (G4) — nuovo registro `WasteMovement`,
  giacenze per CER + alert limiti (soglie configurabili).
- ✅ **Anomaly detection** (D2, parte AI) — controlli a regole su FIR/movimenti.
- ✅ **Gestione contratti MVP** (G8) — modello, 8 pricing model, workflow stati,
  auto-compilazione FIR; billing/firma/AI/marketplace = Fase 2.
- ✅ **RENTRI certificato per-tenant** + endpoint admin (PKCS#12), cache token
  per-tenant; client ModI "pronto a connettersi".
- ✅ Isolamento tenant (FIR tenantId reale, registri), API audit complete,
  permessi temporanei (#3), audit firma userId reale (#12).

Restano (dipendenze esterne / infra / spec / frontend): RENTRI **live**
(certificato), **conservazione AgID** (conservatore accreditato), **download IV
copia**, **MUD export telematico ufficiale** (serve spec Unioncamere), AI
avanzata (EER suggester/OCR/RAG — serve LLM), **app autista offline**, **console
consulente** e pricing page (frontend), contratti Fase 2, hardening/CI-CD/deploy.

## 1. Panel competitor analizzato

| Competitor | Posizionamento | Deployment | Note ownership |
|---|---|---|---|
| **WinWaste.Net** (NICA) | Leader enterprise filiera completa, 2.500+ clienti, ~400k FIR | On-prem/ibrido (no SaaS multi-tenant puro) | Gruppo **Zucchetti** (2018) |
| **Rifiutoo** (Sfridoo) | Challenger cloud per produttori + consulenti | SaaS cloud | Ingresso nel capitale di **Zucchetti Ambiente** (feb 2026) |
| **TeamSystem Waste / Waste 360** | Verticale dentro grande vendor ERP | SaaS cloud | Ecosistema **TeamSystem** |
| **QuiRifiutiPro** (Buffetti) | Entry-level, self-service, consulenti | SaaS cloud | Canale **Buffetti** |
| **Ambiente.it / ECOS** (Terranova) | Enterprise utility/TARI/igiene urbana + business | Enterprise + app | **DNA / Terranova Software** |
| **Long-tail**: RifiutiGuru, Ecosolve (SIA), Savino, Centro Software, Sielco | Cloud RENTRI per PMI/consulenti | SaaS cloud | indipendenti |

---

## 2. Matrice funzionalità (stato verificato giugno 2026)

Legenda: ✅ presente/maturo · 🟡 parziale/da completare · ❌ assente · ? non verificabile pubblicamente

| Capacità | **WasteFlow (oggi)** | Rifiutoo | WinWaste | TeamSystem | QuiRifiutiPro | ECOS/Terranova | Long-tail |
|---|---|---|---|---|---|---|---|
| RENTRI interop (vidimazione xFIR, trasmissione) | 🟡 client reale, non ancora live/certificato | ✅ | ✅ | ✅ (API) | ✅ | ✅ | ✅ |
| Conservazione a norma AgID (10 anni) | ❌ | ✅ | ✅ | ✅ | ✅ | ? | ✅ (vari) |
| Download/archiviazione IV copia FIR | ❌ | ✅ | ✅ | ? | ? | ✅ | ? |
| Registri C/S + **giacenze/deposito temporaneo** (alert limiti) | 🟡 registri base, no giacenze/deposito | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (vari) |
| MUD automatico | 🟡 aggregazione reale, no export ufficiale completo | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anagrafiche + catalogo CER/EER (842) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Verifica Albo Gestori in tempo reale** | ❌ | ✅ | ✅ | ? | ✅ | ? | ✅ (alcuni) |
| **Console multi-azienda consulenti** (1 accesso → N clienti) | 🟡 architettura sì, UX da rifinire | ✅ | 🟡 multi-azienda, non "console consulenti" | 🟡 non posizionato | ✅ (no limiti) | ❌ (utility) | ✅ (RifiutiGuru, Ecosolve) |
| **RBAC/ABAC granulare + ruoli per-cliente + permessi temporanei** | ✅ (differenziatore) | ? | ? | ? | ? | ? | ? |
| **App autista offline + firma xFIR in campo** | ❌ (solo task-assignment web) | ? (linea trasp. "coming soon") | ✅ (app tablet) | ✅ (app FIR + QR) | ❌ (web responsive) | ✅ (X-FIR matura, offline) | 🟡 (solo Sielco=X-FIR) |
| Firme digitali conformi (xFIR / RFC 3161 / qualificata) | 🟡 ECDSA reale, manca RFC3161 + conformità xFIR | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Dashboard / analytics | ✅ | ✅ | 🟡 (statistiche+export) | 🟡 | 🟡 | ✅ | 🟡 |
| **Gestione contratti + pricing servizi (8 modelli)** | ❌ **solo doc di pianificazione, NON implementato** (`CONTRACT_MANAGEMENT_MODULE.md`) | ❌ | 🟡 (fatturazione) | 🟡 | ❌ | ? | ❌ |
| Integrazioni ERP/contabilità/fatturazione | ❌ (pianificato) | 🟡 (Magia/Zucchetti) | ✅ (Digital HUB Zucchetti) | ✅ (suite TeamSystem) | ❌ | ? | ❌ |
| **AI** (suggeritore EER, OCR, anomaly, RAG normativo) | ❌ (pianificato) | ❌ | ❌ | ❌ | ❌ | 🟡 (AI route opt. su utility) | ❌ |
| **ESG / carbon / circolarità** (da dato RENTRI) | ❌ (pianificato) | ❌ | ❌ | ❌ | ❌ | 🟡 (ESG utility) | ❌ |
| Marketplace B2B / scambio scarti | ❌ | 🟡 (Sfridoo separato) | ❌ | ❌ | ❌ | ❌ | ❌ |
| IoT / pesatura / sensori | ❌ | ❌ | ✅ (pese, telematica) | ? | ❌ | 🟡 | ❌ |
| **Pricing trasparente / self-service** | 🟡 (tier definiti, non pubblici/live) | ❌ (opaco) | ❌ (opaco) | ❌ (opaco) | ✅ (prezzi pubblici) | ❌ | 🟡 (RifiutiGuru semi) |
| Igiene urbana / TARI / ARERA | ❌ (fuori target) | ❌ | 🟡 | ❌ | ❌ | ✅ | ❌ |

---

## 3. Gap Analysis

### 3.A — Gap "table-stakes" (da chiudere per essere vendibili)
Funzionalità che **(quasi) tutti i competitor hanno** e WasteFlow no / parziale. Senza queste non si compete sulla compliance, che è il motivo d'acquisto n°1.

| # | Gap | Stato WasteFlow | Perché è bloccante |
|---|---|---|---|
| G1 | **RENTRI live + accreditamento** | client reale pronto, manca certificato + conferma path OpenAPI | senza connessione reale il prodotto non adempie |
| G2 | **Conservazione a norma AgID (10 anni)** di FIR/registri | assente | requisito legale; tutti i competitor la includono |
| G3 | **Download + archiviazione IV copia FIR** da RENTRI | assente | chiude il ciclo del formulario |
| G4 | **Giacenze + monitoraggio deposito temporaneo** (alert limiti durata/quantità) | registri base, manca calcolo giacenze | feature attesa, previene sanzioni; Rifiutoo/RifiutiGuru/Centro la spingono |
| G5 | **Verifica Albo Gestori Ambientali in tempo reale** (autorizzazioni/scadenze/targhe) | anagrafica statica | riduce errori; standard in Rifiutoo/QuiRifiutiPro/RifiutiGuru |
| G6 | **Firma xFIR conforme** (RFC 3161 timestamp + firma qualificata/remota) | ECDSA reale ma non conforme xFIR/RFC3161 | la firma deve essere legalmente valida per RENTRI |
| G7 | **MUD export ufficiale completo** | aggregazione reale, manca formato telematico ufficiale | dichiarazione obbligatoria |

### 3.B — Gap sul beachhead "consulenti multi-società" (il nostro segmento)
| # | Gap | Stato WasteFlow | Azione |
|---|---|---|---|
| C1 | **Console consulente rifinita** (switch cliente sicuro+tracciato, dashboard aggregata read-only, onboarding rapido nuovo cliente) | architettura presente, UX incompleta | completare la UX (il motore multi-tenant/ABAC c'è già) |
| C2 | **Niente cap volumetrici** (Rifiutoo prezza a movimenti, QuiRifiutiPro mette tetti formulari) | da decidere nel pricing | leva di vendita: prezzo per società, non per movimento |
| C3 | **Pricing pubblico + self-service onboarding** | tier definiti ma non live | quasi nessuno lo fa → acquisizione |

### 3.C — White space / differenziatori (dove quasi nessuno è arrivato)
| # | Opportunità | Maturità mercato | Impatto/Sforzo |
|---|---|---|---|
| D1 | **ESG / CO₂-evitata & % recupero** derivata dal dato RENTRI (report CSRD/VSME) | gap netto (gestionali non lo fanno, ESG tool non partono dal registro) | **ALTO / BASSO-MEDIO** ⭐ |
| D2 | **AI suite**: anomaly detection movimenti → suggeritore EER (human-in-the-loop) → OCR formulari/analisi → assistente normativo RAG | quasi assente in Italia | **ALTO / MEDIO** |
| D3 | **Pricing trasparente + onboarding self-service** | raro nel settore | **ALTO / BASSO** ⭐ |
| D4 | **Integrazioni "neutrali" leggere** (Fatture in Cloud, SdI, export contabilità, connettori bilance via API) | spazio non-captive scoperto | MEDIO / MEDIO |
| **G8** | **Gestione contratti** (anagrafica contratti produttore↔trasportatore↔smaltitore, 8 modelli di pricing, template, workflow approvazione, **auto-compilazione FIR da contratto**, alert scadenze, billing) | competitor diretti per lo più sprovvisti; AMCS/GRIF lo hanno | **MEDIO-ALTO / ALTO** — spec pronta in `CONTRACT_MANAGEMENT_MODULE.md` |

### 3.D — Vantaggi attuali di WasteFlow da valorizzare (non li hanno i competitor)
- **IAM avanzato**: RBAC + ABAC policy engine + permessi temporanei con workflow + tenant switching tracciato → perfetto per consulenti con ruoli diversi su clienti diversi (nessun competitor lo documenta). *(Implementato.)*
- **Architettura cloud-native moderna** (NestJS/Angular, DDD/CQRS) vs WinWaste legacy on-prem → time-to-value, zero-IT, UX.

> **Nota correttiva (2026-06-10):** la **gestione contratti** NON è un vantaggio attuale — è **solo pianificata** (spec dettagliata in `CONTRACT_MANAGEMENT_MODULE.md`, nessun codice/modello DB). I competitor diretti (Rifiutoo, QuiRifiutiPro, long-tail) ne sono per lo più **sprovvisti** → resta un **differenziatore potenziale forte, ma da costruire** (vedi G8 nel piano).

### 3.E — Da NON costruire (deciso)
- **Marketplace simbiosi** (Sfridoo presidia, è problema di network effect non di codice).
- **IoT/hardware proprietario** (capitale, certificazioni metrologiche) → integrare via API a bilance esistenti.
- **TARI / igiene urbana / ARERA** (dominio ECOS, fuori target PMI/consulenti).

---

## 4. Piano di sviluppo (prioritizzato)

Principio: prima **rendere il prodotto vendibile** (compliance table-stakes), poi **vincere il beachhead** (consulenti + pricing), poi **differenziare** (ESG + AI), infine **fast-follow** costosi (app autista) e **integrazioni**.

### FASE A — Compliance vendibile (priorità massima)
Obiettivo: un'azienda/consulente può adempiere RENTRI end-to-end con WasteFlow.
- [ ] **G1 RENTRI live**: ottenere certificato di interoperabilità (area operatori) + confermare path OpenAPI `formulari`/`dati-registri`/`anagrafiche` → attivare modalità `live` (client già pronto). *Dipende da certificato cliente.*
- [ ] **G6 Firma xFIR conforme**: timestamp RFC 3161 reale + firma qualificata/remota (o integrazione firma RENTRI da mobile) sul file xFIR.
- [ ] **G2 Conservazione a norma AgID**: integrazione con conservatore accreditato (FIR + registri, retention decennale).
- [ ] **G3 Download IV copia** FIR da RENTRI + archiviazione.
- [ ] **G7 MUD export ufficiale** nel formato telematico.
- **Deliverable**: ciclo FIR digitale + registro + MUD conforme, verificato su ambiente demo RENTRI.

### FASE B — Beachhead consulenti + go-to-market
Obiettivo: essere la scelta migliore per il consulente multi-società.
- [ ] **G4 Giacenze + deposito temporaneo**: calcolo giacenze real-time per EER + alert limiti durata/quantità.
- [ ] **G5 Verifica Albo Gestori** in tempo reale (autorizzazioni/scadenze/targhe trasportatori).
- [ ] **C1 Console consulente**: switch cliente sicuro+tracciato, dashboard aggregata cross-cliente (read-only), onboarding rapido nuovo cliente, ruoli per-cliente (riusa ABAC esistente).
- [ ] **C3/D3 Pricing pubblico + self-service**: listino online (per società, senza cap), sign-up → attivo in minuti, free tier.
- **Deliverable**: un consulente onboarda N clienti in autonomia, con prezzo prevedibile.

### FASE C — Differenziatori (white space, alto valore)
- [ ] **D1 ESG / CO₂** ⭐: da movimenti RENTRI → % recupero vs smaltimento, t deviate da discarica, CO₂ evitata (fattori ISPRA/EPA), report CSRD/VSME. *Dati già in casa, miglior impatto/sforzo.*
- [ ] **D2 AI — incrementale**:
  1. **Anomaly detection** movimenti (giacenze impossibili, EER incoerente con autorizzazione, quantità fuori range) — sforzo basso, regole+statistica.
  2. **Suggeritore EER** da descrizione (LLM + tassonomia 842 CER + regole "a specchio", human-in-the-loop).
  3. **OCR** formulari/analisi/omologhe → precompilazione.
  4. **Assistente normativo RAG** (D.Lgs 152/2006 + decreti RENTRI), con citazione fonti.
- **Deliverable**: 2-3 motivi concreti per scegliere WasteFlow invece di Rifiutoo/QuiRifiutiPro.

### FASE D — Moduli avanzati, fast-follow & integrazioni
- [ ] **G8 Gestione contratti** (NON presente nell'app — solo pianificato): implementare il modulo dalla spec esistente `CONTRACT_MANAGEMENT_MODULE.md`. Scope minimo (MVP del modulo):
  1. **Modello dati + migration**: `Contract` (parti, tipo, CER coperti, `pricing_model` enum a 8 valori, `pricing_config` JSONB, termini/scadenze/rinnovo, stato/workflow) — tenant-scoped.
  2. **Anagrafica contratti** CRUD + **workflow approvazione** (draft → pending_approval → active → expired/terminated).
  3. **Auto-compilazione FIR da contratto attivo** (riduce time-to-FIR; integra col FIR esistente).
  4. **Alert scadenze** (60/30/7 gg) sul sistema notifiche esistente.
  5. *(Fase 2 del modulo)* billing da volume/peso, firma digitale, analytics costo/kg, AI suggerimento clausole, link a marketplace.
  - *Differenziatore: i competitor diretti non lo offrono; alto switching cost + ARPU. Sforzo alto → pianificare come modulo a sé.*
- [ ] **App autista offline-first** (PWA o nativa): firma xFIR in campo, QR, GPS, foto carico, offline + sync. *Table-stakes dal 2026 ma costoso/rischioso → qualità offline come discriminante.* Riusa il modulo task-assignment esistente.
- [ ] **D4 Integrazioni leggere**: Fatture in Cloud / SdI / export contabilità; connettori bilance via API (no hardware proprietario).
- **Deliverable**: modulo contratti (switching cost + ARPU), copertura logistica trasporti, integrazione amministrativa PMI.

### Sequenza consigliata
`A (vendibilità) → B (beachhead+pricing) → C1 ESG + C2 anomaly/EER (quick win differenzianti) → D8 contratti / app autista / integrazioni`. ESG e pricing trasparente possono partire **in parallelo** alla Fase A (basso rischio, alto posizionamento). La **gestione contratti** è un modulo grande: schedularla quando il core (A+B) è stabile, valutando un anticipo se serve come leva commerciale enterprise/ARPU.

---

## 5. Sintesi a una riga per stakeholder

> I competitor sono pari sulla compliance RENTRI (table-stakes) e opachi sul prezzo; WasteFlow deve **(1) chiudere i gap di compliance** per essere vendibile, **(2) vincere i consulenti** con console rifinita + pricing trasparente senza cap, **(3) differenziarsi** dove il mercato è vuoto — **ESG dal dato RENTRI** e **AI** — evitando marketplace e IoT proprietario.

---

### Appendice — affidabilità delle fonti
Nessun competitor pubblica prezzi in euro (eccetto QuiRifiutiPro; Rifiutoo solo via terzi ~199€/anno da verificare). Dettagli tecnici delle API RENTRI dei competitor non sono pubblici. L'esistenza/profondità di app autista native per alcuni vendor (Rifiutoo, long-tail) non è verificabile pubblicamente. Fonti complete nei report di ricerca per-competitor (giugno 2026).
