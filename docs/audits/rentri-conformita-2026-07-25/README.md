# Audit di conformità RENTRI + MUD — WasteFlow

**Data**: 25 luglio 2026 · **Branch**: `develop` · **Metodo**: ricognizione normativa su fonti ufficiali + lettura del codice sorgente, con verifica incrociata.

Ogni riga della tabella di conformità nasce dall'incrocio fra un requisito documentato su fonte ufficiale e un'evidenza `file:riga` nel repository. Dove la fonte ufficiale non conferma un requisito, la riga è marcata **NON VERIFICATO** e non viene usata come base di giudizio.

---

## 1. Sintesi esecutiva

**Stato complessivo: NON CONFORME. Il software non è oggi in grado di operare contro RENTRI in produzione.**

Tre fatti dominano tutto il resto:

1. **Il modello di autenticazione implementato non esiste in RENTRI.** Il codice esegue un OAuth2 `client_credentials` verso un endpoint `/token` (`rentri-auth.service.ts:53-67`, `rentri-config.ts:71`). RENTRI **non espone alcun token endpoint**: il pattern AgID ID_AUTH_REST_02 in direct trust prevede un **JWT self-issued**, firmato localmente e passato direttamente come `Authorization: Bearer` a ogni richiesta. La prima chiamata reale fallirebbe con un 404 sul `/token`. È un errore architetturale, non un dettaglio di configurazione.

2. **Nessuna firma con valore legale è attiva né attivabile.** I provider di firma qualificata e di marca temporale RFC 3161 sono stub che lanciano eccezione (`qes-signature.provider.ts:45`, `rfc3161-tsa.provider.ts:51`); i default sono `sandbox` + `mock` e nessun file di deploy imposta `SIGNATURE_PROVIDER`/`TSA_PROVIDER`. Peggio: il ciclo di vita FIR effettivamente usato dall'applicazione (BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO) firma con **una stringa costante scelta dal client** (`fir.service.ts:61`: `certificato: 'FIRMA-NON-QUALIFICATA'`) che **non viene nemmeno persistita** (`fir-prisma.repository.ts:318`).

3. **L'intero oggetto del RENTRI dal 13/02/2026 — il FIR digitale xFIR — è assente.** Non esiste nel repository alcuna traccia di container ASiC-E, XAdES, XMLDSig, CBOR/COSE_Sign1, né del registro cronologico digitale vidimato. Il codice implementa un modello di FIR JSON proprietario ("xFIR" nel senso di un payload inventato, `rentri-api.client.ts:289-362`) che il codice stesso annota come «DA CONFERMARE sull'OpenAPI ufficiale».

In termini di copertura: **su 35 funzionalità RENTRI documentate, 2 sono conformi, 6 parziali, 27 assenti o non funzionanti.**

Va detto anche il rovescio: il sottosistema crittografico di base (JWS con `x5c`, digest RFC 3230, PKCS#12→PEM, AES-256-GCM per le chiavi a riposo, isolamento per tenant) è scritto bene ed è riutilizzabile quasi integralmente. Il problema non è la qualità del codice esistente, è che è stato costruito contro un'API immaginata anziché contro quella documentata.

---

## 2. Fonti ufficiali utilizzate

| Ambito                  | Fonte                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Regolamento RENTRI      | DM 4 aprile 2023 n. 59 — [Normattiva](https://www.normattiva.it/atto/caricaDettaglioAtto?atto.dataPubblicazioneGazzetta=2023-05-31&atto.codiceRedazionale=23G00065), GU n. 126 del 31/05/2023                                                                                                                                                                                                           |
| Base legale             | art. 188-bis D.Lgs. 152/2006 (l'art. 188-ter è **abrogato** dal D.Lgs. 116/2020)                                                                                                                                                                                                                                                                                                                        |
| Modalità operative      | DD n. 143 del 6/11/2023; DD n. 251 del 19/12/2023; DD n. 254 del 12/12/2024; DD n. 25 del 5/2/2026                                                                                                                                                                                                                                                                                                      |
| Specifiche tecniche API | OpenAPI 3.0.4 ufficiali scaricate da `https://demoapi.rentri.gov.it/docs/{api}/v1.0` per i 6 servizi `anagrafiche`, `ca-rentri`, `codifiche`, `dati-registri`, `formulari`, `vidimazione-formulari`                                                                                                                                                                                                     |
| Guide tecniche          | [Struttura del FIR digitale](https://demoapi.rentri.gov.it/docs?page=guida-tecnica-struttura-fir-digitale) · [Struttura del Registro cronologico](https://demoapi.rentri.gov.it/docs?page=registro-digitale) · [Autenticazione e integrità](https://demoapi.rentri.gov.it/docs?page=accesso-auth) · [Controlli di validazione xFIR](https://demoapi.rentri.gov.it/docs?page=controlli-validazione-xfir) |
| Pattern di sicurezza    | [Linee guida AgID interoperabilità, Allegato 2 — Pattern di sicurezza](https://www.agid.gov.it/sites/agid/files/2024-07/Linee_guida_interoperabilit%C3%A0PA_All2_Pattern_sicurezza.pdf)                                                                                                                                                                                                                 |
| MUD 2025                | DPCM 29 gennaio 2025, GU Serie Generale n. 49 del 28/02/2025 — [MASE](https://www.mase.gov.it/portale/-/mud-modello-unico-di-dichiarazione-ambientale-per-l-anno-2025); tracciato ver. 6.04/24                                                                                                                                                                                                          |
| MUD 2026                | DPCM 30 gennaio 2026, GU Serie Generale n. 53 del 05/03/2026 — [MASE](https://www.mase.gov.it/portale/-/mud-modello-unico-di-dichiarazione-ambientale-per-l-anno-2026); tracciato ver. 6.04/25                                                                                                                                                                                                          |

### Riferimenti smentiti

Tre riferimenti circolanti si sono rivelati inesistenti e **non vanno usati** in documentazione o commit:

- **«DM 6 novembre 2023 n. 4»** — non esiste. L'atto del 6/11/2023 è il **Decreto Direttoriale n. 143**.
- **«DM 8 aprile 2024»** — nessun riscontro su rentri.gov.it, MASE o GU.
- **«art. 188-ter D.Lgs. 152/2006»** — abrogato dal D.Lgs. 116/2020.
- **«DPCM 3 luglio 2024» per il MUD 2025** — non esiste; il 3 luglio è la _scadenza_ del MUD 2026.
- **FIR cartaceo «in quattro copie»** — il DM 59/2023 art. 6 c.4 prevede il cartaceo in **duplice copia** con restituzione della copia completata. La «quarta copia» apparteneva al previgente DM 145/1998.
- **Codici a barre lineari (1D)** — RENTRI prevede **solo** QR code ISO/IEC 18004:2015 livello H.

---

## 3. Tabella di conformità — le 35 funzionalità RENTRI

Legenda esito: ✅ **conforme** · 🟡 **parziale** (esiste ma non utilizzabile così com'è) · ❌ **assente** · 💀 **codice morto** (implementato ma non raggiungibile: nessun modulo Nest lo registra)

| #                                                     | Funzionalità RENTRI                                                                                                                        | Obbligo                                       | Esito | Evidenza / motivo                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AUTENTICAZIONE E INTEROPERABILITÀ**                 |
| 1                                                     | **ID_AUTH_REST_02** — JWT self-issued come Bearer, `x5c`, `aud` costante `rentrigov.api`                                                   | Obbligatoria su ogni endpoint                 | ❌    | Implementato OAuth2 `client_credentials` verso `${baseUrl}/token` (`rentri-auth.service.ts:53-67`, `rentri-config.ts:71`). **Endpoint inesistente in RENTRI.** `tokenAudience` default `${baseUrl}/token` e `signatureAudience` default `baseUrl` (`rentri-config.ts:73-74`) invece delle costanti `rentrigov.demo.api`/`rentrigov.api` |
| 2                                                     | Firma JWS del JWT (RS256/ES256, header `alg`+`typ`+`x5c`)                                                                                  | Obbligatoria                                  | ✅    | `rentri-jws.util.ts:15-54`. Crittograficamente corretto e testato (`rentri-signature.service.spec.ts`)                                                                                                                                                                                                                                  |
| 3                                                     | **INTEGRITY_REST_01** — `Agid-JWT-Signature` + `Digest` + `signed_headers` su POST/PUT                                                     | Obbligatoria                                  | 🟡    | Struttura corretta (`rentri-signature.service.ts:53-74`): `digest` + `content-type` in `signed_headers`, `Digest: SHA-256=` RFC 3230. Ma `aud` errato (vedi #1) e `content-encoding` non gestito. Applicato solo alle POST in modalità live (`rentri-api.client.ts:232-239`)                                                            |
| 4                                                     | `x5c` con catena completa                                                                                                                  | Prassi ModI                                   | 🟡    | `parsePkcs12` estrae **un solo** certBag (`rentri-pkcs12.util.ts:65-69`) → `x5c` con solo il foglia                                                                                                                                                                                                                                     |
| 5                                                     | Validazione certificato (scadenza, coerenza chiave, catena, CRL/OCSP)                                                                      | Necessaria                                    | ❌    | Nessun controllo né all'upload (`rentri-credential.controller.ts:67-106`) né all'uso                                                                                                                                                                                                                                                    |
| 6                                                     | Asincronia **NONBLOCK_PULL/PUSH_REST** — `202` + `transazione_id`, `303`→`/result`, `X-ReplyTo`                                            | Obbligatoria su tutti gli endpoint ASYNC      | ❌    | Il client tratta ogni chiamata come sincrona (`rentri-api.client.ts:73-218`). Nessuna gestione di `202`, `transazione_id`, `303`, callback                                                                                                                                                                                              |
| 7                                                     | Gestione `429` (rate limit), `423` (ban), `503` `sys.maintenance`                                                                          | Raccomandata                                  | 🟡    | Solo `503` con `retryAfter` (`rentri-api.client.ts:106-173`); `429`/`423` non gestiti                                                                                                                                                                                                                                                   |
| 8                                                     | Errori **RFC 7807** + `model_state`                                                                                                        | Necessaria                                    | ❌    | Parsing errori generico, nessuna lettura di `model_state`                                                                                                                                                                                                                                                                               |
| 9                                                     | Endpoint `/status` e gestione enum (breaking change al 31/08/2026)                                                                         | Raccomandata                                  | ❌    | Non chiamato                                                                                                                                                                                                                                                                                                                            |
| **ANAGRAFICHE E ISCRIZIONE**                          |
| 10                                                    | Iscrizione operatore / unità locali                                                                                                        | Obbligatoria (art. 12 DM 59/2023)             | ❌    | Solo da portale, non via API — ma il software non modella affatto `num_iscr`, `num_iscr_sito`, unità locali                                                                                                                                                                                                                             |
| 11                                                    | Consultazione anagrafica operatori / UL / autorizzazioni Albo (9 GET `anagrafiche` v1.0)                                                   | Facoltativa                                   | ❌    | Nessuna chiamata                                                                                                                                                                                                                                                                                                                        |
| 12                                                    | Accreditamento all'interoperabilità (rappresentante + incaricati)                                                                          | Obbligatoria per usare le API                 | ❌    | Non modellato                                                                                                                                                                                                                                                                                                                           |
| **REGISTRO CRONOLOGICO**                              |
| 13                                                    | Apertura/modifica/chiusura registro + vidimazione virtuale (`POST /anagrafiche/v1.0/operatore/registri`, `GET .../xml`)                    | Obbligatoria per iscritti                     | ❌    | Nessuna traccia                                                                                                                                                                                                                                                                                                                         |
| 14                                                    | Registro cronologico digitale conforme XSD RENTRI (`rentri-registri-1.0`, `rentri-movimenti-1.0`)                                          | Obbligatoria dall'iscrizione                  | ❌    | Esiste un modello Prisma locale (`schema.prisma:1181-1203`) con hash SHA-256 interno, **senza alcun legame con RENTRI**                                                                                                                                                                                                                 |
| 15                                                    | Nodo `eREGI` firmato XAdES da RENTRI + catena `RiferimentiPrecedenti` (digest concatenati)                                                 | Obbligatoria                                  | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 16                                                    | Firma XMLDSig enveloped sull'export del registro                                                                                           | Obbligatoria (immodificabilità)               | ❌    | Assente. Nessun XMLDSig in tutto il repo                                                                                                                                                                                                                                                                                                |
| 17                                                    | Trasmissione registrazioni (`POST /dati-registri/v1.0/operatore/{reg}/movimenti`, max 1000, atomica)                                       | Obbligatoria — fine mese successivo (art. 15) | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 18                                                    | Rettifica / annullamento registrazioni                                                                                                     | Obbligatoria se ricorre                       | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 19                                                    | Validazione registro locale (`POST .../valida`)                                                                                            | Raccomandata                                  | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 20                                                    | Conservazione a norma (CAdES `.p7m` raccomandato; RENTRI **non** è conservatore)                                                           | Obbligatoria per legge                        | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| **FORMULARIO — VIDIMAZIONE E CARTACEO**               |
| 21                                                    | Vidimazione virtuale FIR a blocchi (`POST /vidimazione-formulari/v1.0/{codice_blocco}`, 1 FIR per chiamata, asincrona)                     | Obbligatoria per emettere un FIR              | 🟡    | Il path è indovinato correttamente (`rentri-api.client.ts:50`) ma con semantica sbagliata: usato come «submit FIR» sincrono anziché come vidimazione asincrona a blocchi. Nessun concetto di `codice_blocco`. Il codice stesso annota «DA CONFERMARE» (`:40-53`)                                                                        |
| 22                                                    | Numerazione univoca FIR (formato `VVVVC 000276 SH`)                                                                                        | Obbligatoria                                  | ❌    | Numerazione interna proprietaria                                                                                                                                                                                                                                                                                                        |
| 23                                                    | QR code ISO/IEC 18004:2015 liv. H — payload CBOR firmato COSE_Sign1, codifica Base45                                                       | Obbligatoria sul documento stampato           | ❌    | Esiste un `qrcode.service.ts` generico, **mai collegato al PDF** (`pdf.controller.ts:54` non passa `qrCodeDataUrl`). Nessun CBOR, nessun COSE_Sign1, nessun Base45                                                                                                                                                                      |
| 24                                                    | Vidimazione a piè di pagina del PDF (3 parti obbligatorie)                                                                                 | Obbligatoria                                  | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 25                                                    | Verifica FIR online (`GET /verifica/{numero_fir}`) e offline (via `GET /certificati/{id}`)                                                 | Facoltativa                                   | ❌    | Esiste un endpoint di verifica **proprietario e pubblico senza guard** (`signatures.controller.ts:150`), non collegato a RENTRI                                                                                                                                                                                                         |
| 26                                                    | Annullamento vidimazione FIR (`PUT /{blocco}/{prog}/annulla`, solo pre-trasporto)                                                          | Facoltativa                                   | ❌    | Solo citato in un commento (`rentri-api.client.ts:46-47`), nessun metodo                                                                                                                                                                                                                                                                |
| 27                                                    | FIR cartaceo — restituzione copia (`formulari/v1.0/copia-cartacea/*`)                                                                      | Obbligatoria; alternativa fino al 15/09/2026  | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| **FIR DIGITALE (xFIR) — obbligatorio dal 13/02/2026** |
| 28                                                    | Container **ASiC-E** `.xfir` (mimetype primo file non compresso, `META-INF/manifest.xml`)                                                  | Obbligatoria                                  | ❌    | Assente. Il codice usa un payload JSON proprietario (`rentri-api.client.ts:289-362`)                                                                                                                                                                                                                                                    |
| 29                                                    | Ciclo di vita F1 Partenza / F2 Trasporto / F3 Accettazione + eventi E1–E6 (sosta tecnica, trasbordi, annotazioni, destinatario successivo) | Obbligatoria                                  | ❌    | Il lifecycle interno BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO non è mappabile: mancano sosta tecnica, trasbordi, destinatari successivi, respingimento parziale, intermodale                                                                                                                                                                 |
| 30                                                    | Firma **XAdES Baseline-B detached** con **regola di copertura** (ogni firma copre tutti gli XML già presenti)                              | Obbligatoria                                  | ❌    | Nessun XAdES nel repo. La firma applicativa è ECDSA raw su un JSON di 8 campi (`fir.aggregate.ts:152-167`)                                                                                                                                                                                                                              |
| 31                                                    | Ciclo di firma via API: `POST /{fir}/hash` → firma locale → `POST /{fir}/acquisizione-firma` (+ rollback)                                  | Obbligatoria                                  | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 32                                                    | Certificati ammessi per la firma xFIR: qualificati eIDAS / CIE-TS-CNS / firma remota CA RENTRI                                             | Obbligatoria                                  | ❌    | Nessuno dei tre. **Attenzione**: il `.p12` «Interoperabilità» che il software gestisce **non è valido per firmare i FIR** — è l'errore più segnalato dalle FAQ ufficiali                                                                                                                                                                |
| 33                                                    | Firma remota CA RENTRI (CSC, 2FA PIN+OTP, SHA-256/ECDSA, `ca-rentri` v1.0)                                                                 | Alternativa facoltativa                       | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 34                                                    | Validazione xFIR (`POST /formulari/v1.0/xfir/valida`, 4 categorie, ~30 controlli)                                                          | Obbligatoria alla restituzione copia          | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |
| 35                                                    | Trasmissione dati FIR pericolosi (`POST .../estrai` → `POST /trasmissioni/operatore/{ul}`) — **sanzioni dal 15/09/2026**                   | Obbligatoria                                  | 💀    | Esiste uno strato di sync (`rentri-sync.controller.ts`, `rentri-sync.queue.ts`, `sync-fir-to-rentri.use-case.ts`) **non registrato in alcun modulo Nest**; il repository dei log è uno stub che ritorna `[]` (`rentri-sync-log.repository.ts:63-134`); l'use case chiama metodi inesistenti sull'aggregato FIR                          |
| **TABELLE E SUPPORTO**                                |
| 36                                                    | Tabelle di codifica (`codifiche` v1.0, 25 GET: EER, ISTAT, ADR, causali, errori)                                                           | Necessaria per validare                       | ❌    | Il progetto ha tabelle di riferimento proprie, non sincronizzate con RENTRI                                                                                                                                                                                                                                                             |
| 37                                                    | Gestione indisponibilità servizi (DD 25/2026, `trasformato_in_cartaceo`)                                                                   | Obbligatoria quando dichiarata                | ❌    | Assente                                                                                                                                                                                                                                                                                                                                 |

**Conteggio: 2 conformi ✅ · 5 parziali 🟡 · 29 assenti ❌ · 1 codice morto 💀**

---

## 4. Analisi approfondita della firma digitale

Nel software coesistono **quattro sottosistemi di firma, non integrati fra loro**. Solo il primo ha valore tecnico.

### Flusso A — Firma verso RENTRI (ModI)

`rentri-jws.util.ts` + `rentri-signature.service.ts` + `rentri-pkcs12.util.ts` + `rentri-crypto.util.ts`.
**Qualità crittografica buona**: JWS con `x5c`, digest RFC 3230, AES-256-GCM con IV casuale per operazione e authTag verificato, isolamento per tenant, nessun segreto nei log, nessun `alg:none`, nessun MD5/SHA-1, nessun ECB. Difetti: `aud` sbagliato, catena `x5c` incompleta, nessuna validazione del certificato, key derivation `SHA-256(secret)` senza KDF né salt (`rentri-crypto.util.ts:17-23`), master key unica per tutti i tenant iniettata come env var.

### Flusso B — Firma crittografica del FIR (`POST /fir/:id/sign`)

Firma ECDSA P-256 SHA-256 **reale**, ma con **chiave effimera generata e scartata a ogni firma, senza certificato** (`sandbox-signature.provider.ts:38-42`). Marca temporale da una TSA fittizia (`mock-tsa.provider.ts`). I provider a norma sono stub che lanciano:

```
qes-signature.provider.ts:45   throw new Error('[QES] Provider QES non ancora implementato')
rfc3161-tsa.provider.ts:51     throw new Error(...)
```

Difetti aggiuntivi, tutti confermati:

- **Il documento firmato non è il FIR**: `toSignableDocument()` copre 8 campi su ~25 (`fir.aggregate.ts:152-167`). Restano fuori dalla firma destinatario, trasportatore, date, peso effettivo, classi HP, colli, codice operazione R/D, annotazioni. Sono modificabili dopo la firma senza invalidarla.
- **La firma si autoinvalida all'emissione**: il documento firmato include `firNumber`, assegnato solo all'emissione, e `status` non è ripristinato in `reconstitute` (`fir.aggregate.ts:37-41`). La verifica ricalcola un hash divergente e marca `isValid:false`.
- **Nessuna autorizzazione di ruolo**: `ApplySignatureUseCase` non verifica che l'utente sia il produttore, il trasportatore o il destinatario (`apply-signature.use-case.ts:80-107`). Qualsiasi `OPERATOR` del tenant può apporre tutte e tre le firme — è la distruzione del senso stesso del FIR.
- **I controlli SPID sono neutralizzati per default**: `SpidLevelGuard` simula Level 2 se manca il claim salvo `SPID_STRICT_LEVEL_CHECK=true` (`spid-level.guard.ts:57-68`), variabile mai impostata; `authenticatedAt ?? new Date()` (`signatures.controller.ts:107`) rende il vincolo «autenticazione < 15 minuti» un no-op permanente.
- **Firme silenziosamente scartate**: se il CF del firmatario non corrisponde a uno `User` del tenant, il repository logga un warning e **non persiste nulla** (`signature-fir.repository.ts:100-108`), mentre il controller risponde `success: true`.
- **Endpoint di verifica pubblico che espone dati personali cross-tenant**: `GET /fir/:id/verify` senza guard, con `findByIdPublic` che bypassa RLS, restituisce `signerFiscalCode` e `signerName` in chiaro di qualsiasi tenant. **Problema GDPR.**

### Flusso C — Il lifecycle realmente usato dall'applicazione

È il flusso che governa BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO, e **non contiene alcuna firma**:

```
apps/frontend/.../fir.service.ts:61
    return { firmatario, certificato: 'FIRMA-NON-QUALIFICATA' }

apps/backend/.../fir-prisma.repository.ts:318
    _firme: {}, // Would come from signatures relation
```

Il backend accetta la stringa come non vuota e la usa per autorizzare la transizione di stato. Chiunque possa chiamare l'endpoint «firma» per produttore, trasportatore e destinatario con `{"firmatario":"x","certificato":"y"}`. E poiché `toPersistence` non mappa alcun campo firma, **le firme evaporano al reload**: non esiste prova di chi ha firmato cosa.

### Flusso D — PDF

Non firmato, non sigillato, senza hash, senza QR (`pdf.controller.ts:54`). L'endpoint di download non filtra per tenant (`pdf.controller.ts:39-48`): qualsiasi utente autenticato scarica il FIR di qualsiasi tenant conoscendone l'id.

### Difetti di sicurezza in ordine di gravità

| #   | Gravità    | Difetto                                                                                          | Evidenza                                                            |
| --- | ---------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| 1   | 🔴 Critica | Firma del lifecycle = stringa costante scelta dal client, mai persistita                         | `fir.service.ts:61`, `fir-prisma.repository.ts:318`                 |
| 2   | 🔴 Critica | Nessuna firma legalmente valida attiva né attivabile (provider QES/TSA = stub)                   | `qes-signature.provider.ts:45`, `rfc3161-tsa.provider.ts:51`        |
| 3   | 🔴 Critica | Nessuna autorizzazione di ruolo-parte sulla firma                                                | `apply-signature.use-case.ts:80-107`                                |
| 4   | 🔴 Critica | Endpoint verifica pubblico espone CF e nomi cross-tenant (GDPR)                                  | `signatures.controller.ts:150`, `signature-fir.repository.ts:59-66` |
| 5   | 🟠 Alta    | Download PDF FIR senza filtro tenant                                                             | `pdf.controller.ts:39-48`                                           |
| 6   | 🟠 Alta    | Il documento firmato copre 8 campi su ~25                                                        | `fir.aggregate.ts:152-167`                                          |
| 7   | 🟠 Alta    | La firma si autoinvalida all'emissione (verifica inaffidabile in entrambe le direzioni)          | `fir.aggregate.ts:37-41`, `verify-signatures.use-case.ts:104-108`   |
| 8   | 🟠 Alta    | Controlli SPID e freschezza auth neutralizzati per default                                       | `spid-level.guard.ts:57-68`, `signatures.controller.ts:106-107`     |
| 9   | 🟠 Alta    | Firme silenziosamente scartate con risposta `success: true`                                      | `signature-fir.repository.ts:100-108`                               |
| 10  | 🟠 Alta    | Nessuna validazione del certificato RENTRI (scadenza, catena, revoca)                            | `rentri-credential.controller.ts:67-106`                            |
| 11  | 🟡 Media   | Key derivation `SHA-256(secret)` senza KDF né salt                                               | `rentri-crypto.util.ts:17-23`                                       |
| 12  | 🟡 Media   | Master key unica per tutti i tenant, in env var                                                  | `docker-compose.prod.yml:78`                                        |
| 13  | 🟡 Media   | `Digest` calcolato su `JSON.stringify(body)` ma ad axios è passato l'oggetto (riserializzazione) | `rentri-api.client.ts:226, 246`                                     |
| 14  | 🟡 Media   | `DigitalSignature.verify()` è una verifica finta (ritorna `true` se la firma è non vuota)        | `digital-signature.vo.ts:190-204`                                   |
| 15  | 🟡 Media   | Audit trail «immutabile per convenzione»: nessun hash-chain, nessun vincolo DB                   | `signature-audit.handler.ts:57-75`                                  |
| 16  | 🟡 Media   | CF firmatario con fallback inventato `'SANDBOX000A00A000A'` o UUID Keycloak                      | `signatures.controller.ts:115`                                      |

### Nota di configurazione produttiva

`docker-compose.prod.yml:77-78` passa **solo** `RENTRI_CREDENTIAL_ENC_KEY`: né `RENTRI_MODE`, né URL, né certificati. Il backend in produzione gira quindi in modalità **mock** puntando a `http://localhost:3001`. Inoltre `.env.example` di root definisce `RENTRI_TIMEOUT` e `RENTRI_MOCK_MODE`, **variabili che il codice non legge mai**.

---

## 5. Scadenze normative — posizione attuale

| Data       | Obbligo                                                                                                                                                 | Stato del software               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 13/02/2025 | Iscrizione 1ª fascia + registro digitale                                                                                                                | ❌ registro digitale assente     |
| 14/08/2025 | Iscrizione 2ª fascia (10–50 dipendenti)                                                                                                                 | ❌                               |
| 13/02/2026 | **FIR digitale xFIR obbligatorio** (art. 7 c.8 DM 59/2023)                                                                                              | ❌ xFIR assente                  |
| 15/09/2026 | **Fine del doppio binario cartaceo** (art. 13 D.L. 200/2025 conv. L. 26/2026) e **decorrenza sanzioni** sulla trasmissione dati FIR (art. 258 c.10-bis) | ❌                               |
| 31/08/2026 | Adeguamento obbligatorio al valore `planned` dell'enum `/status`                                                                                        | ❌ `/status` non chiamato        |
| 04/08/2026 | JWT utilizzabile entro 2 ore da `iat`/`nbf`                                                                                                             | 🟡 TTL attuale 300s: compatibile |

**Restano meno di due mesi al 15/09/2026**, data oltre la quale il FIR cartaceo non è più un'alternativa e scattano le sanzioni ex art. 258 c.10 (€ 1.000–3.000 per i pericolosi).

---

## 6. MUD — stato e correzione di premessa

**Il MUD 2025 è già implementato.** Il tracciato `6.04/24` (`mud-tracciato-v604-2024.ts:51-53`) è quello approvato dal **DPCM 29 gennaio 2025** per la dichiarazione 2025 sui dati 2024; il campo `year = 2024` è l'anno _dei dati_. Il PDF in `docs/` è il tracciato ufficiale corrispondente, byte-identico al download da mudtelematico.it.

### Cosa funziona

Record `XX`, `AA`, `AB`, `BA`, `BB` (varianti DR e TE); formattazione ASCII ISO 646 con accenti → vocale+apice, CRLF, separatore `;` finale su ogni campo, numerici zero-padded, quantità `0000000,000`; version registry estendibile per anno (`mud-version.registry.ts:14-39`); suite di test che verifica le lunghezze record esatte del tracciato.

Copre il profilo **«produttore iniziale di rifiuti speciali, unità locale singola, conferimento a terzi in Italia»**.

### Gap del MUD 2025 (tracciato 6.04/24)

| #   | Requisito                                                                                   | Esito                    | Evidenza / cosa manca                                                                                                               |
| --- | ------------------------------------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Campi ISTAT provincia/comune come `num 3`                                                   | 🔴 **BUG di conformità** | `mud-tracciato-v604-2024.ts:155-156, 162-163` usano `mudAlfa` (space-pad) su campi definiti numerici → file potenzialmente scartato |
| 2   | Validazione formale pre-invio                                                               | ❌                       | Nessun validatore                                                                                                                   |
| 3   | RBAC sull'export                                                                            | ❌                       | `mud.controller.ts:14-15`: solo `JwtAuthGuard`, nessun permesso                                                                     |
| 4   | UI per l'anagrafica MUD del tenant (REA, addetti, legale rappresentante, ATECO, civico)     | ❌                       | Campi presenti in DB e nei DTO admin, **nessun form frontend**                                                                      |
| 5   | Sede legale distinta dall'unità locale                                                      | ❌                       | Forzata uguale (`:162-168`)                                                                                                         |
| 6   | Mesi di attività, «annulla e sostituisce»                                                   | ❌                       | Hardcoded 12 e 0 (`:172-174`)                                                                                                       |
| 7   | Giacenze al 31/12, ricevuto da terzi, prodotto fuori UL, moduli RT                          | ❌                       | Tutti a zero (`:221-235`)                                                                                                           |
| 8   | Flag origine urbana, pile e accumulatori, codice Reg. CEE 1013/2006, quantità estero        | ❌                       | Tutti a zero (`:330-344`)                                                                                                           |
| 9   | Schede MG (`BD`/`BE`), SA-AUT (`AU`), SA-RIC (`AR`), INT (`DA`/`DB`), RE (`BC`), MAT (`MA`) | ❌                       | Nessuna. Blocca ogni tenant che sia gestore o intermediario                                                                         |
| 10  | RAEE (`RA`–`RF`), VFU (`VC`–`VH`), Imballaggi (`IA`–`IF`)                                   | ❌                       | Nessuna                                                                                                                             |
| 11  | Multi-unità locale + vincolo «tutte nella stessa provincia»                                 | ❌                       | UL hardcoded a `1` (`:150, 184, 209, 316`)                                                                                          |
| 12  | Comunicazione Rifiuti Semplificata                                                          | ❌                       | Canale PEC, non implementato                                                                                                        |
| 13  | Validazione con l'applicazione ufficiale di mudtelematico.it                                | ❌                       | **Mai eseguita** — dichiarato nel codice stesso (`:47-48`)                                                                          |
| 14  | Tracciato **6.04/25** (MUD 2026, DPCM 30/1/2026, scadenza 3/7/2026)                         | ❌                       | Registry contiene solo il 2024 (`mud-version.registry.ts:15-18`)                                                                    |

### Delta 6.04/24 → 6.04/25 (verificato sui due PDF ufficiali)

**Le lunghezze record sono identiche.** Cambiano solo: costante release `"6.04/24"`→`"6.04/25"`; tabella ISTAT **ATECO 2025** (6 cifre) al posto di ATECO 2007-agg.2022; 3 nuovi tipi di autorizzazione in `AU` (`[7]` bonifiche art. 242 c.7, `[8]` ordinanze art. 191, `[9]` art. 110 c.3); 3 stati fisici rinominati in `BA`/`DA` («In polvere o polverulento», «Solido», «Fangoso»); «Aggregati riciclati» → «Aggregati recuperati» in `MA`. Il costo reale dell'aggiornamento è la **tabella ATECO 2025**, non il tracciato.

### MUD ↔ RENTRI

Cercando «RENTRI» nel testo integrale degli Allegati 1 e 4 del DPCM 30/1/2026: **zero occorrenze**. Il MUD resta un adempimento **autonomo e obbligatorio** anche per gli iscritti al RENTRI, e non si presenta tramite RENTRI. L'affermazione diffusa che «dal 2027 il RENTRI fornirà un MUD precompilato» **non è verificata su alcuna fonte ufficiale** e non va usata come requisito. (L'art. 19 DM 59/2023 prevede l'interconnessione con il Catasto e la banca dati MUD, ma è un obbligo a carico del MASE, non del gestionale.)

---

## 7. Raccomandazioni, in ordine di priorità

**P0 — Sicurezza, indipendente da RENTRI (giorni)**

1. Chiudere l'endpoint pubblico `GET /fir/:id/verify` o rimuovere CF e nomi dalla risposta.
2. Aggiungere il filtro tenant al download PDF.
3. Aggiungere l'autorizzazione di ruolo-parte alla firma.
4. Rendere bloccante il fallimento di persistenza firma (oggi `success: true` silenzioso).
5. Impostare esplicitamente `SPID_STRICT_LEVEL_CHECK` e i provider di firma nei file di deploy, oppure invertire i default in modo che l'assenza di configurazione fallisca invece di degradare.

**P1 — Decidere la strategia RENTRI (settimane)**
Il lavoro necessario per la conformità xFIR non è un adeguamento: è la costruzione di un sottosistema nuovo (ASiC-E, XAdES con regola di copertura, CBOR/COSE_Sign1, ciclo hash/acquisizione-firma, asincronia PULL/PUSH, registro cronologico XSD). Prima di scriverne una riga:

1. Riscrivere l'autenticazione secondo ID_AUTH_REST_02 (JWT self-issued come Bearer, `aud` costante). È il prerequisito di qualunque chiamata reale ed è un intervento contenuto sul codice esistente, che è già quasi tutto riutilizzabile.
2. Ottenere le credenziali dell'ambiente **demo** (`demooperatori.rentri.gov.it`, accesso SPID/CIE/CNS) e i due certificati distinti.
3. Sostituire i path indovinati con quelli degli OpenAPI ufficiali.
4. Rimuovere o completare il codice morto dello strato sync: oggi produce falsa fiducia (test verdi su metodi inesistenti, dashboard analytics che conta uno stato mai scritto).

**P2 — MUD**

1. Correggere il bug ISTAT `mudAlfa`→`mudNum` e generare un file di prova da passare al **validatore ufficiale** di mudtelematico.it. È l'intervento a costo più basso e valore più alto: un file che non supera il controllo dei separatori viene scartato integralmente.
2. Validatore pre-invio + RBAC + form anagrafica tenant.
3. Aggiungere il tracciato 6.04/25 (estraendo una base comune `MudTracciatoV604Base`) e la tabella ATECO 2025.

---

## 8. Interventi eseguiti in questa sessione (25/07/2026)

Tutte le modifiche sono su `develop`, con typecheck pulito e **812 test verdi su 91 suite**.

### P0 — sicurezza (chiusi)

| Difetto                                               | Intervento                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #4 Verifica pubblica espone CF e nomi cross-tenant    | `GET /fir/:id/verify` ora restituisce una risposta **anonima** (ruolo, data, validità, hash — nessun dato personale). Aggiunto `GET /fir/:id/verify/dettaglio`, autenticato e tenant-scoped, per il dettaglio completo. Il use-case rifiuta la disclosure senza `tenantId` e risponde NOT_FOUND (non FORBIDDEN) su FIR di altri tenant. Spec: `verify-signatures.privacy.spec.ts` |
| #5 Download PDF FIR senza filtro tenant               | `pdf.controller.ts` usa `findFirst({ id, tenantId })` con il tenant dell'utente autenticato; FIR altrui → 404                                                                                                                                                                                                                                                                     |
| #3 Nessuna autorizzazione di ruolo-parte sulla firma  | Nuovo `FIRPartyResolver` + controllo in `ApplySignatureUseCase`: ogni ruolo può essere firmato **solo** dalla parte designata sul FIR. Il rifiuto precede la generazione della firma. Spec: `apply-signature.authorization.spec.ts`                                                                                                                                               |
| #9 Firme scartate silenziosamente con `success: true` | `SignatureFIRRepository.save()` lancia `SIGNER_NOT_PROVISIONED` invece di ritornare senza persistere                                                                                                                                                                                                                                                                              |

**Restano aperti** i P0 di natura non tecnica: i provider QES/TSA sono ancora stub (serve un contratto QTSP) e il lifecycle V2 continua a "firmare" con una stringa costante — quest'ultimo è un intervento di riprogettazione, non un fix.

### MUD

- **Estratta `MudTracciatoV604Base`**, base comune alla famiglia 6.04; `MudTracciatoV604_2024` si riduce a versione + anno.
- **Corretto il bug di conformità ISTAT**: i campi provincia/comune, tipizzati `num 3` dal tracciato, erano emessi spazio-paddati (`mudAlfa`). Ora usano `mudIstat`, zero-paddato. Un campo numerico riempito di spazi fa scartare il file in acquisizione. _(Correzione obbligata: il codice diventava la base condivisa anche del 6.04/25.)_
- **Aggiunto il tracciato 6.04/25** (`MudTracciatoV604_2025`), registrato per l'anno dati 2025, con i tre nuovi tipi di autorizzazione 7/8/9 nel record AU. Il 6.04/24 li riporta a 0 = ND, così un dato inserito per il 2025 non produce un file 2024 non valido.
- **Implementati 7 nuovi tipi di record**, con layout campo per campo estratto dal PDF ufficiale: `BC` (modulo RE), `BD`+`BE` (moduli MG, smaltimento e recupero), `AU` (SA-AUT), `AR` (SA-RIC), `DA` (INT), `DB` (moduli UO/UD). Aggiunto anche il modulo `BB` tipo **RT** (ricevuto da terzi), con i flag origine urbana / pile e accumulatori / ricevuto da privati.
- La scheda `BA` non ha più campi azzerati per costruzione: ricevuto da terzi, prodotto fuori UL, trasportato dal dichiarante, giacenze al 31/12 e i conteggi dei moduli RT/RE/TE/DR sono derivati dagli allegati effettivi.
- **Nuovo modello dati `AutorizzazioneImpianto`** (+ `AutorizzazioneImpiantoDiscarica`), migration `20260725120000_add_mud_autorizzazioni_impianto`, registrato nell'estensione RLS e collegato all'export. Mappa 1:1 la scheda SA-AUT ed è il prerequisito documentato di SA-RIC e MG.
- **Risolta la query N+1** sulla risoluzione dei comuni dei destinatari.
- **Nuova suite di conformità** `mud-tracciato-v604.conformita.spec.ts` (26 test) che verifica, per **entrambe** le annualità: lunghezza esatta di ognuno dei 12 tipi di record contro il tracciato ufficiale, costante di release, coerenza dei 30 contatori della testata XX con i record emessi, separatore finale e CRLF, precedenza fra record correlati, campi ISTAT numerici e assenza di caratteri fuori dall'ASCII ISO 646.

### Cosa manca al MUD, dopo questi interventi

Il **livello tracciato** è completo per le schede implementate: la generazione produce record della lunghezza esatta prevista. Manca il **livello dati** per tre di esse:

- `MG` (BD/BE) e `SA-RIC` (AR) richiedono di modellare le operazioni R/D effettivamente svolte sull'impianto — dominio "gestore" che l'applicazione oggi non ha (modella il produttore).
- `INT` (DA/DB) richiede il dominio dell'intermediazione senza detenzione.
- `RE` (BC) richiede i siti di produzione esterni all'unità locale.

Finché quei dati non esistono, le liste restano vuote e i record non vengono emessi — comportamento corretto secondo il tracciato, ma il profilo gestore/intermediario non è ancora dichiarabile.

Restano inoltre aperti dal §6: validatore pre-invio, RBAC sull'export (`mud.controller.ts` ha solo `JwtAuthGuard`), UI per l'anagrafica MUD del tenant e per le autorizzazioni, multi-unità locale, tabella ATECO 2025, e soprattutto **la validazione di un file reale con l'applicazione ufficiale di mudtelematico.it** — mai eseguita, ed è il controllo che conta più di ogni test interno.

---

## 9. P2 — Riscrittura dell'integrazione RENTRI (25/07/2026): stato dopo la verifica contro l'oracolo

Cinque task hanno riscritto l'integrazione RENTRI descritta come non conforme al §3 e nel Flusso A del §4. A differenza della sessione dell'8, qui ogni affermazione di conformità è stata **verificata eseguendo il codice contro un oracolo**: `tools/rentri-fake`, un servizio Fastify che implementa realmente il protocollo del contratto ufficiale (`formulari.yaml`) — JWT self-issued verificato con una CA di prova reale, registro anti-replay del `jti`, ciclo NONBLOCK_PULL genuino (`200` in elaborazione → `303` + `Location` → `/result`) — non un doppio che restituisce risposte precotte. Il giudizio di fedeltà indipendente di questo oracolo è in `docs/contracts/rentri/FEDELTA.md` §6 (verdetto: **IDONEA CON RISERVE** per P2): le righe seguenti citano esplicitamente quelle riserve dove rilevanti, invece di ripeterle in altre parole.

**Commit**: `32922ec` (autenticazione ID_AUTH_REST_02), `12b39de` (path/verbi del contratto), `87c0878` (polling NONBLOCK_PULL), `a9598d9` (resilienza 403/429/423/5xx), e il commit di questa sessione (test end-to-end + rimozione del mock legacy).

### 9.1 Stato aggiornato delle voci della tabella §3

| #   | Funzionalità                                                         | Esito §3 (25/07, ore iniziali)            | Esito ora                                                                              | Evidenza / verificato contro l'oracolo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | ID_AUTH_REST_02 — JWT self-issued Bearer, `x5c`, `aud` costante      | ❌ (OAuth2 verso `/token` inesistente)    | ✅ **conforme**                                                                        | Riscritto in `rentri-auth.service.ts`: JWT self-issued firmato ad ogni chiamata, nessuna cache, nessuna chiamata a `/token` (grep sull'intero `apps/backend/src`: zero occorrenze). Verificato contro l'oracolo: **403** con un certificato non emesso dalla CA di prova, **200/202** con un certificato emesso da quella CA (`rentri-auth.service.spec.ts`, `rentri-api.client.oracolo.spec.ts`)                                                                                                                                                                        |
| 3   | INTEGRITY_REST_01 — `Agid-JWT-Signature` + `Digest`                  | 🟡 (aud errato, vedi #1)                  | 🟡 **parziale, invariato nel resto**                                                   | L'`aud` del JWT di autenticazione ora è la costante corretta (`rentrigov.demo.api`/configurabile), coerente col fix di #1. Restano invariati i difetti già rilevati: `x5c` con un solo certBag (#4), nessuna validazione del certificato (#5). La fake non verifica affatto la firma di integrità (non è nel suo perimetro), quindi questo aspetto **non è verificabile con l'oracolo**                                                                                                                                                                                  |
| 6   | Asincronia NONBLOCK_PULL — `202` + `transazione_id`, `303`→`/result` | ❌ (client sincrono)                      | ✅ **conforme (solo PULL)**                                                            | `creaFormulario`/`attendiEsito` implementano il ciclo completo. Verificato end-to-end contro l'oracolo, **guidato dal client stesso** (non passo-passo): crea → osserva un `200` reale "in elaborazione" mentre la transazione si completa in background → ottiene da solo il `303` → legge l'esito da `/result` (`rentri-api.client.polling-reale.oracolo.spec.ts`, nuovo in questa sessione). **NONBLOCK_PUSH e `X-ReplyTo` non sono implementati** (fuori scope di P2; la fake stessa non li onora — v. FEDELTA.md N6)                                                |
| 7   | Gestione `429`/`423`/`503`                                           | 🟡 (solo 503)                             | ✅ **conforme per il comportamento del client**                                        | `403` non ritentato (fallimento definitivo, `RentriApiError.retryable=false`); `429` con `Retry-After` e `423`/5xx con backoff ritentati fino a successo o esaurimento tentativi. Verificato contro l'oracolo con guasti iniettati via `/__controllo/guasto`: 429×2 → ritenta e riesce: 503×1 → ritenta e riesce; 403 → **una sola chiamata HTTP** (nessun ritentativo) (`rentri-api.client.resilienza.oracolo.spec.ts`). **Riserva**: il comportamento reale di RENTRI sotto 429/423 non iniettati resta non verificabile (FEDELTA.md §6.5, «esiste solo se iniettato») |
| 8   | Errori RFC 7807 + `model_state`                                      | ❌                                        | 🟡 **parziale**                                                                        | `RentriApiError` estrae `title`/`detail` da `ProblemDetails` (`estraiProblemDetails`, `rentri-api.client.ts`) e li logga come unici campi del corpo di errore. Il campo `model_state` (dettaglio di validazione per campo) **non è letto**: nessuna rotta della fake lo emette (FEDELTA.md N1), quindi il gap non è verificabile con questo oracolo                                                                                                                                                                                                                      |
| 9   | Endpoint `/status` e gestione enum                                   | ❌ (non chiamato)                         | 🟡 **`/status` della transazione ora chiamato; l'enum del servizio resta fuori scope** | Il polling chiama realmente `GET /{transazione_id}/status` (verificato contro l'oracolo, voce #6). L'endpoint di **stato del servizio** e l'enum `planned` (scadenza 31/08/2026, voce distinta nel §5) non sono stati toccati da P2                                                                                                                                                                                                                                                                                                                                      |
| 21  | Vidimazione virtuale FIR a blocchi                                   | 🟡 (path indovinato, semantica sbagliata) | 🟡 **path del contratto corretto; concetto di blocco non modellato**                   | Le costanti `DA CONFERMARE` verso il servizio `vidimazione-formulari` (mai esistito) sono state cancellate; la creazione usa ora `POST /formulari/v1.0/` (radice del servizio `formulari`, contratto ufficiale), verificata contro l'oracolo (202 + `transazione_id` uuid + `Location`). Il parametro `codice_blocco` non è modellato dal client (non richiesto dal payload attuale, `NuovoFormularioPayload = Record<string, unknown>`)                                                                                                                                 |

**Nessuna altra voce della tabella §3 è stata toccata da P2.** Le voci 2, 10-20, 22-37 restano nello stato descritto al §3 (non riverificate in questa sessione).

### 9.2 Cosa NON è stato — e non poteva essere — validato da questa riscrittura

Per esplicito vincolo di P2 (e per fedeltà alle riserve di `docs/contracts/rentri/FEDELTA.md` §6.5), quanto segue **non è stato dichiarato conforme** perché l'oracolo non è in grado di giudicarlo:

- **Modelli dati di scrittura**: `POST /formulari/v1.0/` nella fake accetta qualunque corpo (`{}`, nessun corpo, `Content-Type` errato → comunque 202) — non esiste un 400 «modello dati non valido» da nessuna parte. La mappatura campo-per-campo del FIR interno verso `NuovoFormularioModel` del contratto ufficiale **resta uno stub deliberato** (`NuovoFormularioPayload = Record<string, unknown>` in `rentri-api.client.ts`; il vecchio `convertToXFIRFormat`, che produceva un formato "xFIR flat" mai allineato al contratto, è stato rimosso insieme al mock legacy che lo usava — v. §9.3). Questo lavoro di mappatura resta interamente da fare e da verificare contro l'ambiente demo reale.
- **Autorizzazione per incarichi e visibilità**: il `403` della fake copre solo l'autenticazione (certificato/JWT non valido). Non esiste alcuna nozione di incarico, unità locale o visibilità cross-operatore nell'oracolo, quindi nessuna logica di autorizzazione applicativa di questo tipo può essere verificata con questo strumento.
- **Conformità XAdES/ETSI della firma**: riguarda P3 (non P2), ma resta un prerequisito citato dal brief. La fake certifica coerenza interna di una firma XML (digest, riferimenti), non conformità a ETSI EN 319 132, e non ha un'ancora di fiducia per il firmatario xFIR.
- **Tutto il resto già elencato in FEDELTA.md §6.5** come non validabile con questo oracolo per P2: paginazione/filtri dell'elenco formulari, comportamento reale di RENTRI sotto 429/423 non iniettati, e ogni operazione su rotte non implementate dalla fake (`PUT /{numero_fir}`, `/accettazione`, `/trasporto`, `/annulla`, l'intero albero `/trasmissioni/*` e `/copia-cartacea|digitale/*`).

Queste attività restano verificabili solo contro l'ambiente demo reale di RENTRI, quando saranno disponibili le credenziali di accreditamento.

### 9.3 Rimozione del vecchio meccanismo mock

Il repository conteneva due sistemi paralleli e incoerenti fra loro:

- il vecchio mock `tools/rentri-mock` (porta 3001, autenticazione `X-API-Key`, mai collegato a CI/docker-compose, mai referenziato fuori da se stesso e dai metodi legacy del client);
- l'oracolo attuale `tools/rentri-fake` (porta 4010, autenticazione JWT reale, unico servizio effettivamente cablato in `docker-compose.yml`).

**Decisione: rimossi entrambi `tools/rentri-mock` e i tre metodi legacy del client (`submitFIR`, `validateFIR`, `getFIRStatus`) che funzionavano solo in quella modalità.** Motivazione:

1. Nessun chiamante in produzione: `sync-fir-to-rentri.use-case.ts` chiama solo `creaFormulario`/`attendiEsito`; i tre metodi legacy erano raggiungibili solo dai loro stessi test.
2. Nessun collegamento infrastrutturale: `tools/rentri-mock` non compariva in `docker-compose.yml`, in nessun workflow CI, né in `.env.example` in modo coerente con `tools/rentri-fake`.
3. Fonte di confusione attiva: la documentazione (`.env.example`, `rentri-config.ts`, `rentri.module.ts`) descriveva ancora `RENTRI_MODE=mock` come comportamento di default, mentre l'unico ambiente realmente testato (l'oracolo) usa tutt'altro protocollo — un futuro sviluppatore che leggesse quei commenti sarebbe stato indotto in errore sul comportamento reale del client.

Interventi:

- `RentriConfig` non ha più i campi `mode`/`mockApiKey`; il client parla **sempre** ID_AUTH_REST_02 (Bearer self-issued + firma di integrità).
- `loadRentriConfig` non legge più `RENTRI_MODE`/`RENTRI_ENABLE_MOCK`/`RENTRI_API_KEY`; il default di `baseUrl` è l'ambiente demo ufficiale.
- Rimossi `submitFIR`, `validateFIR`, `getFIRStatus`, `convertToXFIRFormat` e le interfacce associate (`XFIRPayload`, `RENTRISubmitResponse`, `RENTRIValidationResponse`, `RENTRIFIRStatus`) dal client, e i relativi test.
- Aggiornati `apps/backend/.env.example`, `.env.example` di root e la documentazione operativa (`docs/setup/LOCAL_SETUP.md`, `docs/DEPLOYMENT_GUIDE.md`, `docs/deployment/PRODUCTION_DEPLOYMENT.md`) per riflettere l'unico ambiente reale + l'oracolo di test.
- `tools/rentri-mock/` cancellata.

### 9.4 Suite di test

Prima di P2 Task 5: **94 suite / 851 test verdi**. Dopo l'aggiunta del test end-to-end guidato dal client (§9.1, voce #6) e la rimozione dei test dei tre metodi legacy + della conversione xFIR legacy (dead code non più raggiungibile): **95 suite / 837 test verdi**. La diminuzione del numero di test è interamente spiegata dalla rimozione di test che coprivano codice morto rimosso in questa stessa sessione, non da una perdita di copertura funzionale: nessun test di comportamento reale (autenticazione, path del contratto, ciclo NONBLOCK_PULL, resilienza) è stato toccato o indebolito.

---

_Documento prodotto da un'analisi multi-agente coordinata: ricognizione normativa su fonti ufficiali, inventario del codice, audit specialistico della firma digitale, analisi MUD. I reperti critici sono stati riverificati direttamente sul sorgente. §9 aggiunta il 25/07/2026 a chiusura della pipeline P2 (riscrittura dell'integrazione RENTRI), con verifica diretta contro l'oracolo `tools/rentri-fake`._
