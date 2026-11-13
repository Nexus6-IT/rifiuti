# Fase 4 pezzo 8b: agente locale di pesa — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task alla
> volta, opus rivede ogni task prima del successivo. Ordine STRETTAMENTE SEQUENZIALE (un solo
> worktree `rifiuti-wt-agente-pesa`, un solo database di test, commit condivisi): vedi «Ordine» in
> fondo. Motivo: 16 GB di RAM e file condivisi (schema, `ruoli-db.sql`, conteggio RLS, `ci.yml`).
> I task Go (G1-G6) non toccano file condivisi col backend: si possono anticipare o intercalare,
> ma mai in parallelo a un task backend (un solo processo pesante alla volta).

**Obiettivo.** Un agente sul PC della pesa che legge lo strumento, firma ogni lettura stabile con
una chiave sua e la invia al backend in uscita su HTTPS, con una coda locale se la rete cade. Il
backend accetta solo letture firmate da un agente abbinato e non revocato, le conserva immutabili
e le offre all'operatore, che le usa come prima o seconda pesata di un accesso (fonte
`STRUMENTO`). In questo pezzo l'unico driver è `SIMULATA`, marcato come tale dall'agente fino al
documento, e mai accettato su un'azienda che non ha il permesso esplicito. L'interfaccia dei driver
è già pronta per seriale e TCP: i driver reali (D800, DFW06, …) arrivano col cliente pilota.

**Architettura.**
- **Backend.** Due tabelle nuove per azienda con RLS: `agenti_pesa` (anagrafica, abbinamento,
  token in hash, chiave pubblica, ultimo contatto) e `letture_pesa` (casella d'arrivo immutabile
  delle letture firmate). Colonne nuove: `strumenti_pesa.agente_id`, `pesate.lettura_id`,
  `tenants.pese_simulazione_ammessa`; valore nuovo `SIMULATA` in `fonte_pesata`. Rotte
  dell'agente **senza utente** (`/api/v1/agenti-pesa/*`): il token dell'agente risolve l'azienda
  col client di sistema (lookup per hash, roadmap §9 punto 8), poi tutto il lavoro gira nel
  contesto dell'azienda col ruolo applicativo e la RLS. Rotte di gestione con utente
  (`/api/v1/pese/agenti*`, `/api/v1/pese/letture`) nel modulo `pese`.
- **Agente.** `tools/agente-pesa`, Go, eseguibile unico per Windows compilato da Linux
  (`CGO_ENABLED=0`). Pacchetti: `driver` (interfaccia a plugin + registro + trasporti), `coda`
  (file, scrittura atomica), `firma` (Ed25519 + custode della chiave), `invio` (client HTTPS,
  ritrasmissione), `config`, `registro` (log con rotazione), `servizio` (Windows). Nessuna porta in
  ingresso.
- **Frontend.** Scheda «Agenti» nella pagina Pese, assegnazione degli strumenti, scelta di una
  lettura nella nuova pesata e nella seconda pesata, badge «Da strumento» e «Simulata», interruttore
  della simulazione nella pagina aziende (solo SUPER_ADMIN).

**Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE), `@nestjs/throttler` 6.4,
`crypto` di Node (Ed25519 nativo), Angular + PrimeNG; Go (immagine `golang:*-alpine` fissata al
Task 0), dipendenza esterna unica `golang.org/x/sys` (servizio Windows e DPAPI).

**Fonti.**
- Piano 4.8a `docs/superpowers/plans/2026-10-31-fase4-8a-pese.md`: D1-D2 (colonne `fonte`,
  `strumento_id`, `alibi_id`, `ora_strumento`, `ora_ricezione`, `firma_agente` «sempre NULL in
  4.8a, la riempie 4.8b», `chiave_idempotenza`), D3-D5 (trigger, privilegi, impronta), D9
  (idempotenza «e domani la coda dell'agente 4.8b»), «Fuori ambito» (driver, rotte senza utente,
  `firma_agente`, fonti STRUMENTO e FILE, simulatore `SIMULATA`, coda offline).
- Roadmap `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §4.8b
  (eseguibile unico firmato, driver a plugin, HTTPS in uscita, coda locale, solo pesi stabili,
  pesata firmata; nuovo progetto `tools/agente-pesa` più endpoint d'ingresso), §9 punto 8 (riga
  728: «rotte senza utente. Si risolve il tenant da un identificativo (… token dell'agente) con una
  funzione mirata del ruolo di sistema, poi si imposta il contesto e si procede»), §9 punto 10
  (immutabilità anche togliendo UPDATE ai ruoli), D10 (indicatore e cliente pilota da trovare).
- Rapporto `/home/graziano/Progetti/winwaste/docs/confronto-rifiuti/03-adempimenti-integrazioni.md`
  §3.2 (peso acquisito non si modifica; alibi, strumento e ora **dello strumento** su ogni pesata;
  instabile o fuori portata non è un peso), §3.3 (opzione O1: agente locale, driver a plugin,
  HTTPS in uscita, coda locale, firma della pesata con chiave dell'agente; modello con
  `firmaAgente`), §5 riga 192 (simulatore `fonte=SIMULATA`, mai su un tenant di produzione).
- WinWaste `/home/graziano/Progetti/winwaste/docs/pese.md` §2 (37 tipi di bilancia, seriale con
  `PurgeComm` a ogni scrittura, TCP con buffer letto per intero, formati `$MP`/`PID`/`ST,GS`,
  bilancia generica senza checksum) e §8 (difetti 1-15, mappati in «Difetti da non ripetere»).
- Codice reale verificato su `3ab9392d` (sotto, «Stato di partenza»).

## DECISIONI DI GRAZIANO (13/11: Q1-Q8 confermate come raccomandate)

Confermate il 13/11 tutte le raccomandazioni Q1-Q8 (Q1+Q2: permesso su colonna tenant gestita dal SUPER_ADMIN; Q8: modulo `pese`). Precondizione D13 verificata in produzione il 13/11: 0 pesate con fonte STRUMENTO o FILE.

Le domande sono anche in fondo, con la proposta; qui l'impatto.

| # | Domanda | Raccomandazione (applicata dal piano) | Impatto se la risposta è diversa |
|---|---|---|---|
| Q1 | Un accesso con pesate `SIMULATA` può confermare la consegna di un FIR o collegarsi al registro? | **Sì, ma solo finché l'azienda ha la simulazione ammessa**; altrimenti 422 «Accesso con pesate simulate: non si usa nei documenti.» Le aziende con il permesso sono di prova per definizione. | Mai: una condizione in meno nel controllo (Task B7), 422 sempre. |
| Q2 | Dove sta il permesso di simulazione? | Colonna `tenants.pese_simulazione_ammessa` (default `false`), modificabile **solo dal SUPER_ADMIN** dalla pagina aziende, con audit. | Variabile d'ambiente con l'elenco delle aziende (`PESE_SIMULAZIONE_AZIENDE`): niente colonna né interfaccia, solo ops. Mezza giornata in meno. |
| Q3 | Fino a quando una lettura si può usare in un accesso? | **24 ore** dall'ora dell'agente (`ORE_VALIDITA_LETTURA = 24`); oltre: 422, la lettura resta visibile. Avviso oltre 2 ore. | Costante diversa o nessun limite: una riga. |
| Q4 | Versione minima di Windows sul PC della pesa? | **Windows 10 / Server 2016** (Go ≥ 1.21 non supporta Windows 7/8). | Windows 7: Go 1.20 (fuori supporto, senza patch di sicurezza): sconsigliato, servirebbe un altro linguaggio o un PC nuovo. |
| Q5 | Con che account gira il servizio Windows? | **Account virtuale** `NT SERVICE\WasteFlowAgentePesa` (privilegi minimi), con ACL sulla cartella dati impostata da `servizio installa`. | `LocalSystem`: più semplice, più privilegi. Una riga nell'installazione. |
| Q6 | Serve la firma Authenticode dell'eseguibile per il pilota? | **No in 4.8b**: zip con SHA-256 pubblicato nel README e mostrato nella pagina Agenti. Firma con certificato quando c'è il pilota (fuori ambito). | Sì: certificato di code signing (costo annuo) e `osslsigncode` nel job CI. |
| Q7 | Chi apre l'accesso? | **L'operatore**, nell'interfaccia, scegliendo una lettura arrivata dall'agente. L'agente non sa targa, verso né CER. | Apertura automatica dall'agente (con card/targa): pezzo a sé, insieme ai driver reali e alle card. |
| Q8 | L'agente fa parte del modulo `pese` o di un modulo commerciale nuovo? | **Modulo `pese`** (PROFESSIONAL). Etichetta del catalogo da «Pese (inserimento manuale)» a «Pese». | Modulo nuovo `pese-agente` (ENTERPRISE): una voce in `feature-catalog.ts` e i decoratori. |

## Stato di partenza (branch `feat/fase4-8b-agente-pesa` = master `3ab9392d`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Modello delle pese (4.8a, in produzione).**
- `prisma/schema.prisma:2651-2882`: enum `FontePesata { STRUMENTO, FILE, MANUALE, TARA_ANAGRAFICA }`
  (`fonte_pesata`), modelli `StrumentoPesa` (`:2694`, nessun campo agente), `Automezzo`, `AccessoPesa`
  (`:2755`), `Pesata` (`:2795`: `strumentoId`, `strumentoEsterno`, `alibiId`, `pesoKg Decimal(10,2)`,
  `stabile`, `oraStrumento`, `oraRicezione`, `operatoreId`, `chiaveIdempotenza`, `firmaAgente String?`,
  `impronta`; unici `pesate_tenant_id_chiave_idempotenza_key`, `pesate_strumento_id_alibi_id_key`),
  `RettificaPeso`, `AllegatoPesa`, `CollegamentoAccesso`. Lo schema ha 4513 righe.
- Migration `20261101600000_pese_modello_dati` e `20261101600100_pese_cancellazione_e_indici`:
  CHECK `pesate_coerenza_check` (`migration.sql:370-386`): MANUALE ⇒ operatore, motivo, strumento o
  esterno; TARA_ANAGRAFICA ⇒ …; `fonte NOT IN ('STRUMENTO','FILE') OR strumento_id IS NOT NULL`.
  Trigger `pesate_immutabile`, `pesate_controlli` (accesso APERTO, coerenza modo/ordine/fonte, letto
  con `FOR SHARE`), `pese_cancellazione_vietata`, `pese_svuotamento_vietato`.
- Ultima migration: `20261112100000_regole_consorzio_valida_dal_default`. Questo pezzo usa il
  prefisso `202611131000`.
- `prisma/sql/ruoli-db.sql:49-53`: `v_sola_lettura`, `v_solo_inserimento = ['pesate','rettifiche_peso','allegati_pesa']`,
  `v_senza_cancellazione` (accessi, collegamenti, automezzi, strumenti).
- RLS: `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:76` `toBe(82)`; elenco in
  `TENANT_SCOPED_MODELS` (`prisma-rls.extension.ts`) e in `README-tenant-transazione.md`.

**Servizi e API delle pese.**
- `src/application/pese/pesate-scrittura.ts` (287 righe): `leggiOraStrumento` (ISO con offset
  obbligatorio), `verificaCoerenzaFonteModo`, `inserisciPesataManuale(tx, ctx, dati, allegato?)`
  (regole D7, alibi unico per strumento → `AlibiGiaUsatoError`, impronta, `stabile = true`),
  `inserisciPesataTaraAnagrafica`. Il chiamante tiene i lock di `blocchi-accesso.ts`.
- `src/application/pese/accessi-pesa.service.ts` (655 righe): `apri` (`:188`) e `secondaPesata`
  (`:318`) con `bloccaChiaveIdempotenza` + `accessoDellaChiave` (risposta `giaRegistrata: true`),
  `leggiStrumento`, `verificaSedeStrumento`, `chiudi`, `audit`. Tipi in `accessi-pesa.tipi.ts`:
  `AperturaAccessoDati.pesata: PesataManualeDati`, `SecondaPesataDati.pesata: PesataManualeDati`.
- `src/domain/pese/tipi.ts`: `FontePesataDominio = 'STRUMENTO' | 'FILE' | 'MANUALE' | 'TARA_ANAGRAFICA'`.
- `src/domain/pese/impronta-pesata.ts`: `improntaPesata` versione `p1|` + `JSON.stringify` di 16
  campi; **`firmaAgente` non è nell'impronta**.
- `src/domain/pese/netto-accesso.ts:24,30,90-93`: `manuale` e `AVVISO_MANUALE`; nessun concetto di
  simulazione.
- `src/application/pese/nel-contesto-tenant.ts`: apre `TenantContext.run` o rifiuta un contesto di
  un'altra azienda.
- `src/api/pese/pese.controller.ts` (409 righe), `pese.module.ts`, `ruoli-pesa.ts`
  (`RUOLI_OPERATORE_PESA`, `RUOLI_RESPONSABILE_PESA`), `errori-http.ts`.
- Frontend `fe/features/pese/`: `pese.component.ts` (schede), `strumenti-pesa.component.ts`,
  `nuovo-accesso-dialog.component.ts`, `seconda-pesata-dialog.component.ts`,
  `pesata-manuale-form.component.ts`, `pese.service.ts`, `pese-stili.ts`, `pese-formato.ts`, spec DOM.

**Rotte senza utente: precedenti e trappole.**
- `JwtAuthGuard` **non è globale** (`app.module.ts`: l'unico `APP_GUARD` è `ThrottlerGuard`); ogni
  controller lo dichiara. `@Public()` esiste (`auth/decorators/public.decorator.ts`).
- Precedenti senza utente: `POST /api/v1/auth/access-request` (`@Public`, `@Throttle({ medium: { ttl:
  60000, limit: 5 } })`) e il webhook Stripe `POST /api/v1/billing/webhook` (firma HMAC sul
  `rawBody`; `main.ts:25` `rawBody: true`). Nessun precedente di **risoluzione dell'azienda da un
  token**: questo pezzo è il primo (roadmap §9 punto 8).
- `src/api/controller-moduli.spec.ts`: ogni controller sta in `MAPPA_MODULI` (con `JwtAuthGuard`
  obbligatorio, `:496`) o in `BASE` con un motivo (`:235`, il controllo JWT non si applica
  all'area base: `:471`). `pese.controller.ts` è in `MAPPA_MODULI` (`:183`). Il controller
  dell'agente va in **`BASE`**: il modulo `pese` lo verifica il guard dell'agente.
- `ModuloAttivoInterceptor` (`core/interceptors/modulo-attivo.interceptor.ts`) passa sulle rotte
  senza `@RichiedeModulo`; `TenantSwitchInterceptor` passa senza `req.user` (`:91`).
- `src/infrastructure/persistence/punti-di-sistema.spec.ts`: ogni file che usa `PrismaSistemaService`
  è elencato con un motivo (precedente: «verifica pubblica del FIR (azienda ignota)»).
- CSRF: `api/middleware/csrf-protection.middleware.ts` **non è montato** (nessun `consumer.apply`
  né `app.use`, verificato con grep). Se un giorno venisse montato, `/api/v1/agenti-pesa` va in
  `EXEMPT_PATHS` (già c'è `/api/v1/webhooks`).
- Throttler: `ThrottlerModule.forRoot` con `short` (10/s) e `medium` (100/min) in `app.module.ts:91`,
  tracciamento per `req.ip`. `main.ts` **non imposta `trust proxy`**: dietro nginx `req.ip` è
  l'indirizzo del proxy, quindi un limite per IP è in pratica globale (da verificare al Task 0
  sul VPS di sviluppo). Lo storage del throttler è in memoria (un solo processo `backend`).
- `ActivityLog.userId` è nullable (`schema.prisma:972`): l'audit di un evento dell'agente usa
  `userId: null` e l'id dell'agente nei metadata.
- Tenant: nessun campo «produzione/prova» (`schema.prisma:25-65`: `subscriptionTier`,
  `featureFlags`). Rotte admin in `src/api/admin/tenant.controller.ts` (`PATCH :id/status` solo
  SUPER_ADMIN, `:100`).
- Feature `pese` in `src/application/admin/feature-catalog.ts:27,48,71` (PROFESSIONAL).

**CI e strumenti.**
- `.gitea/workflows/ci.yml`: 5 job (`backend`, `frontend`, `test-postgres`, `e2e`, `security`),
  `runs-on: ubuntu-latest`, push su `develop` e `workflow_dispatch`. Il job gira **dentro** un
  container col demone Docker dell'host: un `-v $(pwd):…` si risolve sull'host, dove il checkout
  non c'è (nota in `ci.yml:580-592`). Rimedio già in uso: `docker create` + `docker cp` +
  `docker start`, rimozione in uno step `if: always()`, nome legato a `github.run_id`.
- `.gitea/workflows/deploy.yml`: job `quality` → `build` → `deploy`. L'agente **non** entra
  nell'immagine né nel gate di deploy (non gira in produzione: è un artefatto da distribuire).
- `tools/` contiene `keycloak/` e `rentri-fake/`. `.gitignore` ignora `dist/` e `build/`.
- Workstation: `docker` presente (`/usr/bin/docker`), Go **non** installato, nessuna immagine
  `golang` in locale. Fedora con SELinux: un bind mount richiede `--security-opt label=disable`.

## Difetti di WinWaste da non ripetere (`pese.md §8`)

| # | Difetto WinWaste | Come lo evita 4.8b | Dove |
|---|---|---|---|
| 1 | Peso modificabile dopo l'acquisizione | Lettura e pesata immutabili (trigger + privilegi); la pesata copia la lettura e il trigger `pesate_da_lettura` impone che i valori coincidano | B3 |
| 2 | Peso manuale senza permesso né log | Invariato da 4.8a (fonte MANUALE distinta); la fonte STRUMENTO richiede una lettura firmata | B7 |
| 4 | `DFW06-IP` accetta instabili, sottocarico e sovraccarico | Contratto del driver: ogni campione dichiara `Stato` (`Stabile`, `Instabile`, `Sottocarico`, `Sovraccarico`, `Errore`); solo `Stabile` diventa lettura; il server rifiuta `stabile=false` e il peso oltre la portata; CHECK `stabile = true` su `letture_pesa` | G3, B2, B3 |
| 5 | `DEMO` senza licenza, MP finti come veri | `SIMULATA` richiede `simulazione: true` nella configurazione **e** `simulazioneAmmessa` dal server; ogni lettura porta `simulata: true` firmato; fonte `SIMULATA` fino al documento; alibi con prefisso `SIM-` | G3, B5, B7 |
| 6 | Separatore decimale ambiguo, dipendente dalla cultura | Peso in centesimi interi nell'agente, nel payload stringa fissa `^\d{1,8}\.\d{2}$`; nessun parsing dipendente dalla lingua di Windows | G2, B2 |
| 7 | Lettura TCP che ignora i byte letti, frammenti persi | `LettoreFrame` usa solo `buf[:n]`, ricompone i frammenti, scarta i frame oltre la lunghezza massima | G3 |
| 9 | Errori seriali assorbiti senza log | Ogni errore del driver è registrato con contesto e contato; i contatori viaggiano nel battito | G3, G5 |
| 10 | Nessun controllo d'integrità del messaggio | L'interfaccia del protocollo ha `Valida(frame)` (checksum dove esiste); il frame grezzo viaggia firmato (`grezzo`) | G3 |
| 11 | File di stato su percorsi relativi | Tutti i percorsi sotto `cartellaDati` assoluta; la configurazione rifiuta percorsi relativi | G5 |
| 14 | Ora presa dal PC | `oraStrumento` solo se lo strumento la fornisce (altrimenti null), `oraAgente` separata, scarto dell'orologio del PC misurato a ogni battito e mostrato | G2, B6 |
| 15 | Console di prova raggiungibile in produzione | Il driver `SIMULATA` non parte senza i due consensi; il comando `simula` non esiste nell'eseguibile di produzione (solo nei test) | G3 |

## Decisioni (vincolanti)

- **D1. Tabelle, colonne, enum** (nomi ≤ 63 caratteri, uguali in `schema.prisma` e nella migration;
  ogni tabella nuova con `tenant_id UUID NOT NULL` FK a `tenants` `ON DELETE CASCADE`,
  `@@unique([id, tenantId])`, `@@index([tenantId])`, FK interne composte `NO ACTION` con map esplicito,
  come D1 di 4.8a):

  | Oggetto | Tipo di modifica | Mutabile? |
  |---|---|---|
  | `fonte_pesata` | valore nuovo `SIMULATA` (migration a sé, vedi D11) | — |
  | `stato_agente_pesa` | enum nuovo `{ IN_ATTESA, ATTIVO, REVOCATO }` | — |
  | `agenti_pesa` (`AgentePesa`) | tabella nuova | sì (solo colonne ammesse dal trigger), nessuna DELETE |
  | `letture_pesa` (`LetturaPesa`) | tabella nuova | **mai** |
  | `strumenti_pesa.agente_id` | colonna nuova `UUID NULL`, FK composta → `agenti_pesa(id, tenant_id)` | sì |
  | `pesate.lettura_id` | colonna nuova `UUID NULL`, FK composta → `letture_pesa(id, tenant_id)`, unico | (riga immutabile) |
  | `tenants.pese_simulazione_ammessa` | colonna nuova `BOOLEAN NOT NULL DEFAULT false` | sì, solo SUPER_ADMIN |

- **D2. Colonne delle tabelle nuove.**
  - `agenti_pesa`: `registro_id UUID NULL` (FK composta → `registri_rifiuti(id, tenant_id)`, la
    sede dove sta il PC), `descrizione VARCHAR(255) NOT NULL`, `stato stato_agente_pesa NOT NULL
    DEFAULT 'IN_ATTESA'`, `codice_sha256 VARCHAR(64) NULL` (`@unique`), `codice_scade_il
    TIMESTAMPTZ(3) NULL`, `token_sha256 VARCHAR(64) NULL` (`@unique`), `chiave_pubblica VARCHAR(44)
    NULL` (base64 standard dei 32 byte Ed25519), `impronta_chiave VARCHAR(64) NULL` (SHA-256 esadecimale
    della chiave pubblica, mostrata in UI come `AB12 CD34 …` per il riscontro a vista), `abbinato_il
    TIMESTAMPTZ(3) NULL`, `nome_host VARCHAR(100) NULL`, `versione_agente VARCHAR(30) NULL`,
    `ultimo_contatto_il TIMESTAMPTZ(3) NULL`, `ultimo_ip VARCHAR(45) NULL`, `scarto_orologio_ms
    INTEGER NULL`, `coda_in_attesa INTEGER NULL`, `letture_scartate INTEGER NULL`, `ultima_sequenza
    BIGINT NULL`, `creato_da UUID NOT NULL`, `revocato_da UUID NULL`, `revocato_il TIMESTAMPTZ(3) NULL`,
    `motivo_revoca VARCHAR(500) NULL`, `created_at`, `updated_at`.
    CHECK `agenti_pesa_stato_check`: IN_ATTESA ⇒ `token_sha256`, `chiave_pubblica`, `abbinato_il`
    NULL; ATTIVO ⇒ `token_sha256`, `chiave_pubblica`, `impronta_chiave`, `abbinato_il` NOT NULL e
    `codice_sha256`, `codice_scade_il` NULL; REVOCATO ⇒ `revocato_da`, `revocato_il` NOT NULL e
    `btrim(motivo_revoca) <> ''`, `codice_sha256` NULL; `codice_sha256` e `codice_scade_il` entrambi
    NULL o entrambi NOT NULL; `btrim(descrizione) <> ''`; `token_sha256`, `codice_sha256`,
    `impronta_chiave` `~ '^[0-9a-f]{64}$'` se presenti.
  - `letture_pesa`: `agente_id UUID NOT NULL` (FK composta → `agenti_pesa`), `strumento_id UUID NOT
    NULL` (FK composta → `strumenti_pesa`), `chiave_idempotenza UUID NOT NULL`, `sequenza BIGINT NOT
    NULL`, `peso_kg DECIMAL(10,2) NOT NULL`, `stabile BOOLEAN NOT NULL`, `alibi_id VARCHAR(40) NULL`,
    `ora_strumento TIMESTAMPTZ(3) NULL`, `ora_agente TIMESTAMPTZ(3) NOT NULL`, `ora_ricezione
    TIMESTAMPTZ(3) NOT NULL` (scritta dal servizio), `driver VARCHAR(30) NOT NULL`, `simulata BOOLEAN
    NOT NULL`, `payload TEXT NOT NULL` (i byte firmati, UTF-8, ≤ 2048), `firma VARCHAR(88) NOT NULL`
    (base64 dei 64 byte), `created_at`.
    Unici: `letture_pesa_agente_id_chiave_idempotenza_key`, `letture_pesa_agente_id_sequenza_key`,
    `letture_pesa_strumento_id_alibi_id_key (strumento_id, alibi_id)` (NULL non collidono).
    Indice `letture_pesa_strumento_id_ora_agente_idx (strumento_id, ora_agente DESC)` per l'elenco
    delle letture libere. CHECK `letture_pesa_valori_check`: `stabile = true` (un instabile non è
    un peso e non entra), `peso_kg > 0`, `sequenza >= 1`, `alibi_id IS NULL OR btrim(alibi_id) <> ''`,
    `simulata = (driver = 'SIMULATA')`, `octet_length(payload) BETWEEN 2 AND 2048`, `firma ~
    '^[A-Za-z0-9+/]{86}==$'`.

- **D3. Trigger** (plpgsql, **non** `SECURITY DEFINER`: le SELECT interne passano dalla RLS di chi
  scrive, come in 4.8a D3).
  - `letture_pesa`: `BEFORE UPDATE` → `letture_pesa: riga immutabile`; `BEFORE DELETE` con le
    funzioni esistenti `pese_cancellazione_vietata` (cascata da `tenants` ammessa) e `BEFORE
    TRUNCATE` `pese_svuotamento_vietato`.
  - `agenti_pesa_controlli` `BEFORE UPDATE`: `tenant_id`, `creato_da`, `created_at` immutabili;
    transizioni ammesse solo IN_ATTESA→ATTIVO, IN_ATTESA→REVOCATO, ATTIVO→REVOCATO (da REVOCATO
    nulla cambia, salvo `updated_at`); `token_sha256`, `chiave_pubblica`, `impronta_chiave`,
    `abbinato_il` passano da NULL a valore **una volta**, nella transizione IN_ATTESA→ATTIVO, e poi
    non cambiano più (nemmeno alla revoca: il token revocato resta riconoscibile per rispondere 403);
    `codice_*` si possono cambiare solo in IN_ATTESA (nuovo codice) e diventano NULL all'abbinamento.
  - `pesate_da_lettura` `BEFORE INSERT ON pesate` (quando `lettura_id IS NOT NULL`): legge la lettura
    (RLS); impone `strumento_id = l.strumento_id`, `peso_kg = l.peso_kg`, `stabile = l.stabile`,
    `alibi_id IS NOT DISTINCT FROM l.alibi_id`, `ora_strumento IS NOT DISTINCT FROM l.ora_strumento`,
    `ora_ricezione = l.ora_ricezione`, `firma_agente = l.firma`, `fonte = CASE WHEN l.simulata THEN
    'SIMULATA' ELSE 'STRUMENTO' END`; altrimenti `RAISE EXCEPTION 'pesate: valori diversi dalla
    lettura'`. Così nemmeno il codice applicativo può «aggiustare» un peso arrivato dallo strumento.
  - CHECK nuovo `pesate_lettura_check` (aggiunto, quello di 4.8a non si tocca): `(fonte IN
    ('STRUMENTO','SIMULATA')) = (lettura_id IS NOT NULL)` e, se `lettura_id IS NOT NULL`:
    `firma_agente`, `strumento_id`, `operatore_id` NOT NULL, `motivo_manuale`, `strumento_esterno`,
    `allegato_id` NULL. Conseguenza voluta: `STRUMENTO` senza lettura firmata non si può più
    scrivere (oggi nessuna riga di produzione è `STRUMENTO`: verifica al Task B3).
  - Indice unico `pesate_lettura_id_key (lettura_id)` (NULL non collidono): una lettura diventa al
    più una pesata, anche in accessi diversi, anche annullati.

- **D4. Privilegi.** `ruoli-db.sql`: `letture_pesa` in `v_solo_inserimento`, `agenti_pesa` in
  `v_senza_cancellazione`. La migration ripete le REVOKE in un blocco `DO` solo se i ruoli esistono
  (forma di 4.8a D4). **Mai `FOR SHARE`/`FOR UPDATE` su `letture_pesa`** (richiedono il privilegio
  UPDATE): la concorrenza sull'uso di una lettura si governa con l'advisory lock
  `lettura-pesa|<letturaId>` più l'unico `pesate_lettura_id_key`.

- **D5. Token e codice di abbinamento** (`src/domain/pese/agenti/credenziali-agente.ts`, puro).
  - Codice: 12 caratteri dall'alfabeto Crockford base32 senza `I L O U` (60 bit), mostrato a
    gruppi `XXXX-XXXX-XXXX`, generato con `crypto.randomInt`; `normalizzaCodice` toglie spazi e
    trattini, maiuscole, `O→0`, `I/L→1`; scadenza **15 minuti**; nel DB solo `codice_sha256`.
    Un nuovo codice sostituisce il precedente (solo in IN_ATTESA).
  - Token: prefisso `wfpa_` + 32 byte casuali in base64url (43 caratteri); nel DB solo
    `token_sha256` (SHA-256 basta: 256 bit di entropia, nessun bisogno di bcrypt); mostrato **una
    sola volta**, nella risposta dell'abbinamento, e mai nei log. Ricerca per uguaglianza sull'indice
    unico (nessun confronto carattere per carattere in JavaScript).
  - Nessuna rotazione del token in 4.8b: un PC nuovo o un token perso = revoca + agente nuovo.

- **D6. Payload firmato, versione 1** (`src/domain/pese/agenti/payload-lettura.ts` e
  `tools/agente-pesa/internal/lettura`). **Il server non ricostruisce mai il payload:** l'agente
  invia i byte esatti che ha firmato (base64), il server verifica la firma su quei byte, poi li
  interpreta, e li conserva in `letture_pesa.payload` per poterli riverificare in ogni momento.
  Nessuna canonicalizzazione fra Go e JavaScript (che differirebbero, per esempio, sull'escape di
  `<`, `>`, `&`, U+2028).
  - Byte firmati: `"wasteflow-lettura-pesa-v1\n"` + payload (separazione di dominio: una firma di
    lettura non vale per altro). Firma Ed25519 (RFC 8032) senza hash preliminare.
  - Payload: oggetto JSON UTF-8, chiavi esattamente queste (ordine indicativo, chiavi sconosciute
    → rifiuto):
    ```json
    { "v": 1, "agenteId": "<uuid>", "strumentoId": "<uuid>", "chiaveIdempotenza": "<uuid v4>",
      "sequenza": 41, "pesoKg": "12340.00", "unita": "kg", "stabile": true,
      "alibiId": "SIM-000041", "oraStrumento": "2026-11-13T10:15:02+01:00",
      "oraAgente": "2026-11-13T09:15:03.123Z", "driver": "SIMULATA", "simulata": true,
      "grezzo": "<base64 del frame dello strumento, ≤ 256 byte, o null>" }
    ```
    `pesoKg` stringa `^\d{1,8}\.\d{2}$`; `unita` solo `"kg"` (il driver converte); `alibiId` null o
    1..40 caratteri stampabili; `oraStrumento` null o ISO 8601 **con offset**; `oraAgente` ISO con
    offset; `driver` `^[A-Z0-9_-]{2,30}$`; `simulata` deve valere `driver === 'SIMULATA'`.
  - Verifica in Node: `crypto.verify(null, byteFirmati, chiavePubblica, firma)` con la chiave
    ricostruita da `crypto.createPublicKey({ key: Buffer.concat([PREFISSO_SPKI_ED25519, raw]),
    format: 'der', type: 'spki' })`, `PREFISSO_SPKI_ED25519 = 302a300506032b6570032100`.
  - **Contratto fra linguaggi:** `tools/agente-pesa/testdata/contratto/lettura-v1.json` (seed della
    chiave di prova, chiave pubblica, payload base64, firma base64) è generato dal test Go con
    `-update` e verificato **sia** dal test Go **sia** da `payload-lettura.spec.ts` (Ed25519 è
    deterministico: stesso seed e stesso payload danno la stessa firma). Se uno dei due cambia
    formato, l'altro test fallisce.

- **D7. Regole della lettura in ingresso** (`src/domain/pese/agenti/regole-lettura.ts`, puro:
  `valutaLettura(p: PayloadLettura, ctx: { agenteId; strumento: { id; agenteId; attivo;
  portataMaxKg } | null; simulazioneAmmessa: boolean; ricezione: Date }): EsitoValutazione` con
  `{ esito: 'ACCETTABILE'; avvisi: string[] } | { esito: 'RIFIUTATA'; codice: CodiceRifiuto;
  messaggio: string }`). Codici di rifiuto (stabili, letti dall'agente):
  `FIRMA_NON_VALIDA`, `PAYLOAD_NON_VALIDO`, `AGENTE_DIVERSO`, `STRUMENTO_NON_ASSEGNATO`,
  `STRUMENTO_NON_ATTIVO`, `PESO_INSTABILE`, `PESO_NON_VALIDO` (≤ 0 o > 99.999.999,99),
  `FUORI_PORTATA`, `OROLOGIO_AVANTI` (`oraAgente` o `oraStrumento` oltre `ricezione + 5 min`),
  `SIMULAZIONE_NON_AMMESSA`, `CHIAVE_RIUSATA` (stessa chiave, payload diverso), `ALIBI_GIA_USATO`.
  Avvisi (calcolati in lettura dalle colonne, mai salvati): «Trasmessa in differita (N min dopo la
  pesata)» se `ricezione − oraAgente > 15 min` (coda offline); «Orologio dello strumento sfasato di
  N min rispetto al PC» se `|oraStrumento − oraAgente| > 10 min`; «Lettura simulata: non è un peso
  reale.» se `simulata`.

- **D8. Rotte dell'agente** (`src/api/agenti-pesa/ingresso-agente.controller.ts`, prefisso
  `agenti-pesa`, in `BASE` di `controller-moduli.spec.ts`, `@SkipThrottle()` sul throttler globale
  per IP e limiti propri, D10):
  - `POST /agenti-pesa/abbinamento` (pubblica, `@Public()`): `{ codice, chiavePubblica (base64 32
    byte), nomeHost (≤100), versione (≤30) }` → `201 { agenteId, token, azienda: { ragioneSociale },
    strumenti: [{ id, descrizione, matricola }], simulazioneAmmessa }`. Codice ignoto, scaduto o già
    usato: **sempre la stessa** risposta 401 `{ error: 'CODICE_NON_VALIDO', message: 'Codice di
    abbinamento non valido o scaduto.' }` (nessun indizio su quale dei tre).
  - `GET /agenti-pesa/configurazione` (token): `{ agenteId, azienda, strumenti, simulazioneAmmessa,
    intervalloBattitoS: 60, lottoMassimo: 50, oraServer }`.
  - `POST /agenti-pesa/letture` (token): `{ letture: [{ payload: base64 (≤ 2800 caratteri), firma:
    base64 }] }` (1..50) → `200 { esiti: [{ chiaveIdempotenza | null, esito: 'ACCETTATA' |
    'GIA_RICEVUTA' | 'RIFIUTATA', letturaId?, codice?, messaggio?, avvisi? }] }`, un esito per
    elemento nello stesso ordine. Ogni elemento in una **transazione propria** (un rifiuto non
    annulla gli altri; nessun lotto mezzo scritto da capire).
  - `POST /agenti-pesa/battito` (token): `{ versione, oraAgente, codaInAttesa, lettureScartate,
    ultimaSequenza, strumenti: [{ strumentoId, stato: 'OK' | 'ERRORE' | 'NON_CONFIGURATO',
    ultimoErrore?: string ≤ 200 }] }` → `200 { oraServer, simulazioneAmmessa, revocato: false }`.
    Aggiorna `ultimo_contatto_il`, `ultimo_ip`, `versione_agente`, `scarto_orologio_ms`
    (`oraAgente − ricezione`), `coda_in_attesa`, `letture_scartate`, `ultima_sequenza`; lo stato
    degli strumenti si tiene **in memoria** (mappa per agente, sufficiente con un processo) e si
    mostra in UI; nessuna scrittura se l'ultimo battito è di meno di 20 s.
  - Errori comuni: token assente o ignoto → 401 `TOKEN_NON_VALIDO`; agente IN_ATTESA → 401;
    agente REVOCATO → 403 `AGENTE_REVOCATO` (l'agente smette di inviare e conserva la coda); modulo
    `pese` non attivo → 403 `MODULO_NON_ATTIVO` (in modalità `registra` avviso e passa, come
    l'interceptor); limite superato → 429 con `Retry-After`.

- **D9. Risoluzione dell'azienda** (roadmap §9 punto 8). `AgentePesaGuard`
  (`src/api/agenti-pesa/agente-pesa.guard.ts`): legge `Authorization: Bearer wfpa_…`, calcola lo
  SHA-256, chiama `RisoluzioneAgenteService.daToken(hash)` (`src/application/pese/agenti/risoluzione-agente.service.ts`,
  **unico file nuovo** che usa `PrismaSistemaService`, elencato in `punti-di-sistema.spec.ts` col
  motivo «token o codice dell'agente di pesa: l'azienda è ignota prima della lettura»): una sola
  `findUnique({ where: { tokenSha256 }, select: { id, tenantId, stato } })`. Poi verifica il modulo
  con `ModuliAttiviService.moduliAttivi(tenantId)`, mette `req.agentePesa = { id, tenantId }` e **non**
  tocca `req.tenantId`/`req.user`. Da qui in poi ogni servizio lavora in
  `nelContestoTenant(agente.tenantId, …)` col `PrismaService` normale (ruolo `wasteflow_app`, RLS).
  L'header `X-Tenant-ID` è ignorato (test). `daCodice(hash)` per l'abbinamento, stesso schema; lo
  scambio avviene poi nel contesto dell'azienda con un `updateMany` condizionato (`WHERE id AND
  stato = 'IN_ATTESA' AND codice_sha256 = $ AND codice_scade_il > now()`): conteggio 1 = abbinato,
  0 = 401 (codice usato due volte in parallelo: uno solo vince).

- **D10. Limiti di frequenza.** `ThrottlerAgenteGuard extends ThrottlerGuard` con
  `getTracker(req) = 'agente:' + req.agentePesa.id`, applicato **dopo** `AgentePesaGuard`
  (`@UseGuards(AgentePesaGuard, ThrottlerAgenteGuard)`): `letture` 60/min, `battito` 10/min,
  `configurazione` 10/min. `abbinamento`: `ThrottlerGuard` per IP 10/min **più** un limite globale
  della rotta di 30/min (tracker costante), perché dietro nginx l'IP non è affidabile (Stato di
  partenza). Il codice ha 60 bit e vive 15 minuti: con 30 tentativi al minuto un attacco a forza
  bruta non è praticabile. Limite in memoria: con più processi `backend` va spostato su Redis
  (rischio R6).

- **D11. Migration additive, in due file** (prefisso `202611131000`, `SET LOCAL lock_timeout = '5s'`,
  commento di testa con il ripristino a mano, forma di 4.8a):
  1. `20261113100000_pese_fonte_simulata`: solo `ALTER TYPE "fonte_pesata" ADD VALUE IF NOT EXISTS
     'SIMULATA';` (un valore enum aggiunto non è usabile nella stessa transazione in cui nasce:
     per questo sta da solo).
  2. `20261113100100_pese_agenti`: enum `stato_agente_pesa`; `agenti_pesa`; `letture_pesa`;
     `ALTER TABLE strumenti_pesa ADD COLUMN agente_id` + FK; `ALTER TABLE pesate ADD COLUMN
     lettura_id` + FK + unico + CHECK `pesate_lettura_check`; `ALTER TABLE tenants ADD COLUMN
     pese_simulazione_ammessa BOOLEAN NOT NULL DEFAULT false` (metadata-only in PG 16); funzioni e
     trigger di D3; REVOKE in blocco `DO`; RLS ENABLE + FORCE con `isolamento_azienda` e
     `sola_lettura TO wasteflow_lettura` sulle due tabelle nuove. Conteggio RLS 82 → **84**.
  Ripristino: `DROP TRIGGER pesate_da_lettura`, `ALTER TABLE pesate DROP CONSTRAINT
  pesate_lettura_check, DROP COLUMN lettura_id`, `ALTER TABLE strumenti_pesa DROP COLUMN agente_id`,
  `DROP TABLE letture_pesa, agenti_pesa`, `DROP TYPE stato_agente_pesa`, `ALTER TABLE tenants DROP
  COLUMN pese_simulazione_ammessa`. Il valore `SIMULATA` **non si toglie** da un enum PostgreSQL:
  resta inutilizzato (scritto in `ops/README.md`).

- **D12. Pesata da una lettura** (`inserisciPesataDaLettura(tx, ctx, letturaId)` in
  `pesate-scrittura.ts`). Il chiamante (`apri`, `secondaPesata`) tiene già i lock dell'accesso e
  prende `lettura-pesa|<letturaId>`. Controlli, in ordine, con 404/409/422 in italiano:
  lettura dell'azienda (RLS, altrimenti 404 «Lettura non trovata.»); non già usata (409 «Questa
  lettura è già stata usata in un'altra pesata.»); strumento attivo e della sede del registro
  (`verificaSedeStrumento`, come 4.8a); non più vecchia di `ORE_VALIDITA_LETTURA = 24` ore rispetto
  ad `adesso` (Q3; avviso oltre 2 ore); per la seconda pesata `oraAgente` (e `oraStrumento` se
  entrambe presenti) successive a quelle della prima; coerenza modo/ordine con
  `verificaCoerenzaFonteModo` (STRUMENTO e SIMULATA si comportano come STRUMENTO); una lettura
  `simulata` solo se l'azienda ha ancora la simulazione ammessa (altrimenti 422). La pesata copia
  dalla lettura `strumento_id`, `alibi_id`, `peso_kg`, `stabile`, `ora_strumento`, `ora_ricezione`,
  `firma_agente` = `firma`, `lettura_id`; `fonte` = `SIMULATA` o `STRUMENTO`; `operatore_id` =
  l'utente che la usa; `chiave_idempotenza` = quella della richiesta dell'interfaccia (D9 di 4.8a,
  invariata). Audit `PESA_ACCESSO_APERTO` con `letturaId` nei metadata.
  Tipi: `PesataManualeDati` resta; si aggiunge `PesataDaLetturaDati { letturaId: string }` e
  `AperturaAccessoDati.pesata` / `SecondaPesataDati.pesata` diventano `PesataManualeDati |
  PesataDaLetturaDati` (discriminati da `'letturaId' in pesata`); DTO `PesataDaLetturaDto {
  letturaId: UUID }` con `@ValidateNested` + `@Type` discriminato, payload di oggi invariati
  (compatibilità del frontend durante il rilascio).

- **D13. Impronta versione 2** (`impronta-pesata.ts`). Per `fonte` `STRUMENTO` e `SIMULATA` il
  prefisso è `p2|` e ai 16 campi si aggiungono, in coda, `letturaId` e `firmaAgente`; per le altre
  fonti resta `p1|` invariata (le righe esistenti continuano a risultare integre). La versione si
  deduce dalla fonte, quindi non serve una colonna. Precondizione da verificare in produzione
  prima del rilascio: `SELECT count(*) FROM pesate WHERE fonte IN ('STRUMENTO','FILE')` = 0.
  In lettura una pesata con lettura porta anche `firmaValida`: la firma della lettura riverificata
  con la chiave pubblica dell'agente sui byte di `letture_pesa.payload` (badge «Firma non
  verificata» se falso).

- **D14. Netto e simulazione** (`netto-accesso.ts`). `FontePesataDominio` guadagna `'SIMULATA'`;
  `EsitoNetto` guadagna `simulato: boolean`; costante `AVVISO_SIMULATA = 'Pesata simulata: non è un
  peso reale.'`. Una pesata SIMULATA si calcola come STRUMENTO (non è `manuale`). Collegamenti
  (FIR, movimento) e `pesoPerConsegnaFir` con `netto.simulato` → 422 se l'azienda non ha più la
  simulazione ammessa (Q1).

- **D15. Gestione degli agenti** (`src/api/pese/agenti-pesa.controller.ts`, JWT,
  `@RichiedeModulo('pese')`, voce nuova in `MAPPA_MODULI`; servizio
  `src/application/pese/agenti/agenti-pesa.service.ts`):
  - `GET /pese/agenti` (lettura: chiunque nell'azienda) → `AgenteVista { id, descrizione,
    registro, stato, abbinatoIl, nomeHost, versioneAgente, ultimoContattoIl, inLinea (contatto <
    3 min), scartoOrologioS, codaInAttesa, lettureScartate, improntaChiave (a gruppi di 4), strumenti:
    [{ id, descrizione, stato?, ultimoErrore? }], codiceScadeIl, revocatoIl, motivoRevoca }`, più
    `puoGestire`.
  - `POST /pese/agenti` `{ descrizione, registroId? }` → `201 { agente, codice, scadeIl }` (codice
    mostrato **una volta**); `POST /pese/agenti/:id/codice` → nuovo codice (solo IN_ATTESA, 409
    altrimenti); `POST /pese/agenti/:id/revoca` `{ motivo }` (IN_ATTESA o ATTIVO).
  - `PUT /pese/strumenti/:id/agente` `{ agenteId | null }` (agente della stessa azienda, non
    REVOCATO; 422 altrimenti).
  - `GET /pese/letture?registroId&strumentoId&libere=true&dal` → letture (più recenti prima, 50
    al massimo, default ultime 24 ore e solo non usate) `LetturaVista { id, strumento, pesoKg,
    alibiId, oraStrumento, oraAgente, oraRicezione, simulata, usataIn: { accessoId, numero } | null,
    avvisi, firmaValida }`.
  - Ruoli: gestione (crea, codice, revoca, assegnazione) `RUOLI_RESPONSABILE_PESA` (ADMIN e
    SUPER_ADMIN); elenco letture e uso in un accesso `RUOLI_OPERATORE_PESA` (come 4.8a D10).
  - `PATCH /admin/tenants/:id/pese-simulazione` `{ ammessa: boolean }`, **solo SUPER_ADMIN**
    (`tenant.controller.ts`), audit `PESA_SIMULAZIONE_AMMESSA` / `PESA_SIMULAZIONE_REVOCATA`.

- **D16. Audit** (stessa transazione, `tx.activityLog.create`, mai token, codice o chiave privata nel
  testo o nei metadata): `PESA_AGENTE_CREATO`, `PESA_AGENTE_CODICE_GENERATO`, `PESA_AGENTE_ABBINATO`
  (`userId: null`, metadata `agenteId`, `nomeHost`, `improntaChiave`, `versione`),
  `PESA_AGENTE_REVOCATO`, `PESA_STRUMENTO_AGENTE_ASSEGNATO`, `PESA_AGENTE_FIRMA_NON_VALIDA`
  (`userId: null`; al più una ogni 10 minuti per agente, contatore in memoria, il resto nel log),
  `PESA_SIMULAZIONE_AMMESSA`/`_REVOCATA`. Le letture **non** generano audit una per una: la riga
  immutabile è già la traccia. Log applicativo: id dell'agente e dell'azienda, mai il token.

- **D17. Agente: struttura** (`tools/agente-pesa/`, modulo Go `wasteflow/agente-pesa`):
  ```
  go.mod, go.sum, GO_IMAGE, go-docker.sh, README.md
  cmd/agente-pesa/main.go            comandi: abbina, esegui, stato, servizio, versione
  internal/lettura/                  Lettura, Payload v1, firma dei byte, contratto (testdata)
  internal/firma/                    Ed25519, Custode (file 0600 | DPAPI su Windows)
  internal/driver/                   interfacce, registro dei driver, Campione, filtro stabile
  internal/driver/trasporto/         Trasporto (TCP pronto, seriale: interfaccia + ErrNonDisponibile)
  internal/driver/simulata/          driver SIMULATA
  internal/coda/                     coda su file (in-attesa/, inviate/, scartate/)
  internal/invio/                    client HTTPS: abbinamento, letture, battito, ritrasmissione
  internal/config/                   configurazione JSON + validazione
  internal/registro/                 log JSON (slog) con rotazione per dimensione
  internal/servizio/                 svc Windows (build tag windows) + stub per gli altri OS
  internal/agente/                   ciclo principale: driver → firma → coda → invio, battito
  testdata/contratto/lettura-v1.json
  ```
  - **Interfaccia dei driver** (`internal/driver/driver.go`):
    ```go
    type StatoCampione int // Stabile, Instabile, Sottocarico, Sovraccarico, Errore
    type Campione struct {
        Centesimi    int64      // peso in centesimi di kg, mai float
        Stato        StatoCampione
        AlibiID      string     // vuoto se lo strumento non lo fornisce
        OraStrumento *time.Time // nil se lo strumento non la fornisce
        Grezzo       []byte     // frame originale, ≤ 256 byte
        Definitivo   bool       // true = pesata da registrare (MP, tasto stampa, ...)
    }
    type Driver interface {
        Nome() string                               // "SIMULATA", "D800-MP", ...
        Simulato() bool
        Esegui(ctx context.Context, out chan<- Campione) error // ritorna a ctx chiuso o errore fatale
    }
    type Fabbrica func(p Parametri, t trasporto.Apri) (Driver, error)
    func Registra(nome string, f Fabbrica)       // chiamato da init() di ogni driver
    // trasporto
    type Trasporto interface { io.ReadWriteCloser; SetDeadline(time.Time) error }
    type Apri func(ctx context.Context) (Trasporto, error) // TCP: net.Dialer con timeout; seriale: ErrNonDisponibile in 4.8b
    type Protocollo interface { Richiesta() []byte; Valida(frame []byte) (Campione, error) } // per i driver a domanda/risposta
    type LettoreFrame struct { /* delimitatore o lunghezza fissa, MaxFrame, usa buf[:n] */ }
    ```
    Il nucleo (`internal/agente`) accetta solo `Definitivo && Stato == Stabile`; tutto il resto è
    contato (`instabili`, `fuoriPortata`, `errori`) e registrato a livello `debug`/`warn`.
  - **SIMULATA** (`internal/driver/simulata`): ciclo configurabile (`pesi`: elenco in kg,
    `intervalloS`, `semeCasuale`), per ogni peso emette 3 campioni instabili poi uno stabile
    definitivo con `AlibiID = "SIM-" + progressivo a 6 cifre` (persistito in `cartellaDati/simulata.json`)
    e `OraStrumento = ora del PC`; ogni tanto (`probabilitaSovraccarico`) un `Sovraccarico` che il
    nucleo deve scartare. `Simulato() = true`. Si registra con `Registra("SIMULATA", …)` ma
    `agente.Avvia` lo rifiuta se `config.simulazione != true` **o** se `configurazione` dal server dice
    `simulazioneAmmessa: false` (errore chiaro nel log e in `stato`).
  - **Coda su file** (`internal/coda`): una lettura = un file JSON `in-attesa/<sequenza 12 cifre>-<chiave>.json`
    contenente `{ payloadB64, firmaB64, chiaveIdempotenza, sequenza, creataIl, tentativi }`, scritto
    con file temporaneo + `fsync` + rename (atomico anche su NTFS); all'avvio i `.tmp` rimasti si
    cancellano. Esito ACCETTATA/GIA_RICEVUTA → spostato in `inviate/` (pulizia dopo 30 giorni);
    RIFIUTATA → `scartate/` con `motivo.txt` accanto. Ordine di invio = ordine di sequenza; consegna
    **almeno una volta** (l'idempotenza la rende esattamente una sul server). La firma avviene
    **prima** di mettere in coda: la coda contiene solo letture già firmate. Sequenza persistita in
    `cartellaDati/sequenza` (scritta prima del file della lettura). Limite di sicurezza: oltre
    100.000 file in attesa l'agente smette di accettare letture e lo segnala.
  - **Invio** (`internal/invio`): lotti fino a `lottoMassimo`; ritrasmissione con backoff esponenziale
    e jitter (1 s → 5 min); 429 rispetta `Retry-After`; 401/403 `AGENTE_REVOCATO` o
    `TOKEN_NON_VALIDO` ferma l'invio (stato «revocato», coda conservata, controllo ogni 10 min);
    5xx e rete → ritenta; esito per elemento come D8. Solo `https://` (eccezione unica: `http://127.0.0.1`
    e `http://localhost` per lo sviluppo); certificati verificati con l'archivio del sistema; timeout
    di 30 s; `User-Agent: agente-pesa/<versione>`.
  - **Chiave e token** (`internal/firma`): `abbina` genera la coppia Ed25519, salva la privata e il
    token col `Custode`: su Windows DPAPI a livello di macchina (`windows.CryptProtectData` con
    `CRYPTPROTECT_LOCAL_MACHINE`) in `cartellaDati\credenziali.bin`; altrove file `0600`. Mai nel
    file di configurazione, mai nel log.
  - **Configurazione** `cartellaDati/agente-pesa.json` (default `C:\ProgramData\WasteFlow\AgentePesa`):
    ```json
    { "server": "https://<backend>", "simulazione": false,
      "strumenti": [{ "strumentoId": "<uuid>", "driver": "SIMULATA", "parametri": { "pesi": [24880, 12540], "intervalloS": 30 } }],
      "log": { "livello": "info", "maxMB": 10, "file": 5 } }
    ```
    `server` e gli strumenti assegnati sono scritti da `abbina` (dalla risposta del server); driver e
    parametri li compila il tecnico. Validazione all'avvio: driver registrato, strumento fra quelli
    restituiti da `configurazione`, `SIMULATA` solo con `simulazione: true`, nessun percorso relativo.
  - **Log** (`internal/registro`): `log/slog` JSON in `cartellaDati\log\agente-pesa.log`, rotazione per
    dimensione (`maxMB` × `file`), scritta in proprio (nessuna dipendenza). Un filtro rimuove dai
    valori le stringhe che iniziano con `wfpa_` (test).
  - **Servizio Windows** (`internal/servizio`, `//go:build windows`): `golang.org/x/sys/windows/svc`
    per il ciclo del servizio, `svc/mgr` per `servizio installa|rimuovi|avvia|ferma` (avvio automatico
    ritardato, riavvio in caso di errore dopo 10 s / 60 s / 5 min, account virtuale Q5, `icacls` sulla
    cartella dati), `svc/eventlog` solo per gli errori d'avvio. Su Linux uno stub (`esegui` in primo
    piano) per i test.
  - **Build**: `CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X
    main.versione=<tag>" -o dist/agente-pesa.exe ./cmd/agente-pesa`; anche `linux/amd64` per le
    prove locali. Comandi via `tools/agente-pesa/go-docker.sh <argomenti go>`:
    `docker run --rm --security-opt label=disable -u "$(id -u):$(id -g)" -e HOME=/tmp -e
    GOCACHE=/tmp/gocache -e GOMODCACHE=/tmp/gomod -e CGO_ENABLED=0 -v "$PWD":/src -w /src
    "$(cat GO_IMAGE)" go "$@"` (nessun file di root nel worktree; i moduli si riscaricano: una sola
    dipendenza).

- **D18. CI: job nuovo `agente-pesa`** in `ci.yml` (sesto job, indipendente, `runs-on:
  ubuntu-latest`, `timeout-minutes: 15`). Niente `setup-go`: scarica Go da GitHub e la sua cache
  dipende dal server di cache di GitHub Actions, che su Gitea non c'è (tabella GHA → Gitea delle
  note infra: `actions/cache` e `type=gha` falliscono); servirebbe `cache: false` e il risultato
  sarebbe comunque diverso dall'immagine usata in locale. Si usa lo **stesso** `GO_IMAGE` del
  locale, con lo schema `docker create` + `docker cp` già in uso nel job e2e:
  ```yaml
  agente-pesa:
    name: Agente di pesa (Go: vet, test, build Windows)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      GO_CI_CONTAINER: agente-pesa-ci-${{ github.run_id }}-${{ github.run_attempt }}
    steps:
      - uses: actions/checkout@v4
      - name: Test e build nel container Go
        run: |
          IMG="$(cat tools/agente-pesa/GO_IMAGE)"
          docker rm -f "$GO_CI_CONTAINER" 2>/dev/null || true
          docker create --name "$GO_CI_CONTAINER" --label "neat.ci.job=agente-pesa-${{ github.run_id }}" \
            -e CGO_ENABLED=0 -w /src "$IMG" sh -c '
              set -e
              test -z "$(gofmt -l .)"
              go vet ./...
              GOOS=windows go vet ./...
              go test -count=1 ./...
              GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.versione=${GITHUB_SHA:-ci}" -o dist/agente-pesa.exe ./cmd/agente-pesa
              sha256sum dist/agente-pesa.exe > dist/agente-pesa.exe.sha256'
          docker cp tools/agente-pesa/. "$GO_CI_CONTAINER":/src
          docker start -a "$GO_CI_CONTAINER"
          mkdir -p dist-agente && docker cp "$GO_CI_CONTAINER":/src/dist/. dist-agente/
      - uses: actions/upload-artifact@v3
        with: { name: agente-pesa-windows, path: dist-agente/, retention-days: 14 }
      - name: Rimuovi il container Go (sempre)
        if: always()
        run: docker rm -f "$GO_CI_CONTAINER" 2>/dev/null || true
  ```
  (`upload-artifact@v3`: la v4 non funziona su Gitea, come in ROADS.) Il job non entra in
  `deploy.yml`: non c'è nulla da rilasciare sul VPS.

## Normativa e punti dubbi

- **N1. Software legalmente rilevante.** L'agente legge e trasmette; l'integrità della singola
  pesata la garantisce la **memoria alibi** dell'indicatore omologato (4.8a N2), che l'agente
  riporta senza modificarla. La firma dell'agente prova che il dato non è stato cambiato **dopo**
  la lettura, non che la lettura sia metrologicamente corretta: l'interfaccia non deve dire «pesata
  certificata». Testo fisso: «Letta dallo strumento dall'agente <descrizione>; firma verificata.»
  Se un cliente chiedesse il software come legalmente rilevante (WELMEC 7.2), serve una valutazione
  a parte (fuori ambito, **DA CONFERMARE** con un metrologo, come 4.8a N2).
- **N2. Ora dello strumento.** Si usa quella dell'indicatore se il protocollo la fornisce; altrimenti
  `ora_strumento` resta NULL e vale `ora_agente` come informazione del PC, mai spacciata per ora
  dello strumento (difetto 14).
- **N3. Simulazione.** Una pesata `SIMULATA` non è un peso: badge viola «Simulata» su lettura,
  pesata, accesso, netto e collegamenti, testo `AVVISO_SIMULATA`. Non è mai convertibile in
  `STRUMENTO` (trigger D3).
- **N4. Dati personali.** Il payload non contiene nomi né targhe: solo pesi, ore, identificativi.
  `nome_host` e `ultimo_ip` del PC sono dati tecnici dell'azienda, visibili solo agli ADMIN.

## Vincoli globali

- Prisma dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica dello schema
  `npx prisma generate`.
- Database di test `wasteflow-pg-test-agente` su `127.0.0.1:55445` (porta diversa da 4.8a per non
  urtare un container rimasto): `docker run -d --name wasteflow-pg-test-agente -p 127.0.0.1:55445:5432
  -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci -e
  POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine`.
- Test Postgres col ruolo **`wasteflow_app`** (`creaPrismaServiceApplicativo()`, `TenantContext.run`),
  lanciati con `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`;
  preparazione e pulizia **col proprietario**, solo per id esatti (`tenantCreati`), mai `deleteMany`
  con filtro che può essere `undefined` (stessa regola di 4.8a).
- **RAM:** jest mirato `npx jest -w 2 <percorsi>`; `npm run test:cov` (con `NODE_ENV=test
  JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod`) **una volta** a fine task backend; eslint solo dei
  file toccati, a fine task backend `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` → 0 errori;
  Karma una volta per task frontend; Go solo nel container (`go-docker.sh test ./...`). Un solo
  processo pesante alla volta.
- Fine task backend: `npm run test:cov`, `npx tsc --noEmit -p tsconfig.json`, eslint globale, le suite
  Postgres toccate più `rls-catalogo`, `ruoli-db`, `pese-schema` e `punti-di-sistema`. Fine task Go:
  `go-docker.sh vet ./...`, `GOOS=windows` vet, `go test ./...`, `gofmt -l` vuoto. Confronto con la base
  del Task 0: nessun fallimento nuovo.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55445; `ops/db-ruoli.sh` con
  `PG_EXEC="docker exec -i wasteflow-pg-test-agente"`; `npx prisma migrate diff --from-migrations
  prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url …/shadow_agente`
  → **vuoto** (o solo le note preesistenti di master).
- Aree che questo pezzo **non** tocca: `application/fir/**`, `domain/fir/**`, `application/registro/**`,
  `api/registro/**`, `application/rentri/**`, `fe/features/registro/**`, `fe/features/fir/**`. Toccati
  in modo mirato: `pese/**` (backend e frontend), `api/admin/tenant.controller.ts` e il suo servizio,
  `fe/features/admin/tenants/**`, `prisma/sql/ruoli-db.sql`, `feature-catalog.ts` (solo l'etichetta),
  `controller-moduli.spec.ts`, `punti-di-sistema.spec.ts`, `.gitea/workflows/ci.yml`,
  `.gitea/workflows/deploy.yml` (solo `paths-ignore`). Se un task
  scopre di doverne toccare un altro, si ferma e lo segnala.
- **Convivenza con altri branch.** File a rischio: `schema.prisma` (modelli in coda dopo
  `CollegamentoAccesso`/ultimo modello; su `Tenant`, `StrumentoPesa`, `Pesata`, `RegistroRifiuti`
  solo campi e relazioni inverse in fondo), `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`,
  `README-tenant-transazione.md`, `ruoli-db.sql`, `ops/README.md`, `ci.yml`. Al rebase: somma dei
  conteggi RLS, `prisma generate`, `migrate deploy`, `migrate diff` vuoto; se master ha una migration
  con timestamp successivo a `20261113100100`, rinominare le nostre (mai applicate in produzione).

## Review Focus

1. **Token di un'azienda usato per scrivere in un'altra** (strumento di B nel payload firmato da un
   agente di A, header `X-Tenant-ID` di B): rifiuto `STRUMENTO_NON_ASSEGNATO`, nessuna riga in B →
   test B5 (HTTP) e B3 (FK composta + RLS).
2. **Stessa lettura inviata due volte** (coda ritrasmessa dopo un timeout, due processi agente):
   una sola riga, il secondo esito `GIA_RICEVUTA`; stessa chiave con payload diverso →
   `CHIAVE_RIUSATA` → test B5 (`Promise.all`).
3. **Firma alterata o chiave di un altro agente**: `FIRMA_NON_VALIDA`, nessuna riga, audit una volta
   ogni 10 minuti → test B5.
4. **Stessa lettura usata in due accessi in parallelo**: una sola pesata, l'altra 409 → test B7
   (`Promise.all`) e B3 (unico).
5. **Simulazione su un'azienda senza permesso**: rifiuto all'ingresso, rifiuto all'avvio dell'agente,
   nessuna pesata SIMULATA possibile; permesso tolto dopo → letture vecchie visibili ma non usabili
   e documenti bloccati (Q1) → test B5, B7, G6.
6. **Coda offline**: rete giù per 1 ora con 50 letture, poi ritorno: tutte inviate in ordine, nessun
   duplicato, avviso «in differita» → test G5 e G6.
7. **Interfaccia Go ↔ Node della firma**: il file di contratto verificato da entrambi → test G2 e B2.

---

## Task 0: ambiente e linea di base

**File:** nessuno (solo verifica), salvo `tools/agente-pesa/GO_IMAGE` creato nel Task G1.

- [ ] Container `wasteflow-pg-test-agente` (Vincoli globali); `.env` del backend che punta a 55445
  (`git check-ignore -v apps/backend/.env`).
- [ ] `node_modules` alla radice (altrimenti `npm ci`, `cd apps/backend && npx prisma generate`);
  `npx prisma migrate deploy` (allineato a `20261112100000_regole_consorzio_valida_dal_default`);
  `ops/db-ruoli.sh`; seed.
- [ ] Base: `npm run test:postgres` intera e `npm run test:cov`; annotare nel rapporto i test già
  rossi su master.
- [ ] Immagine Go: scegliere l'ultima `golang:1.N.P-alpine` stabile esistente (`docker pull`), annotare
  tag **e digest** (`docker image inspect --format '{{index .RepoDigests 0}}'`); sarà il contenuto di
  `GO_IMAGE` (`golang:1.N.P-alpine@sha256:…`). Verificare che supporti `GOOS=windows` amd64 e che la
  versione minima di Windows di quella release sia Windows 10 (Q4).
- [ ] Sul VPS di sviluppo (solo lettura, nessuna modifica): con `curl` da fuori verso una rotta
  qualsiasi, guardare nel log del backend che `req.ip` sia l'indirizzo del proxy (conferma di D10).
  Se invece fosse il client reale, annotarlo: il limite per IP dell'abbinamento diventa più efficace,
  nulla cambia nel piano.
- [ ] Produzione (sola lettura, via Graziano o con il suo consenso): `SELECT count(*) FROM pesate
  WHERE fonte IN ('STRUMENTO','FILE')` → atteso 0 (precondizione di D13). Se non è 0: fermarsi.

## Task G1: progetto Go, script e job CI

**Dipende da 0.** **File:** `tools/agente-pesa/go.mod` (`module wasteflow/agente-pesa`, `go 1.N`),
`GO_IMAGE`, `go-docker.sh` (eseguibile), `cmd/agente-pesa/main.go` (solo `versione`),
`cmd/agente-pesa/main_test.go`, `.gitignore` locale (`dist/`), `README.md` (scheletro: build e test),
`.gitea/workflows/ci.yml` (job `agente-pesa` di D18, commento di testa aggiornato: «sei job»),
`.gitea/workflows/deploy.yml` (solo `paths-ignore: 'tools/agente-pesa/**'`: un commit che tocca solo
l'agente non deve ricostruire le immagini né rilasciare; motivo scritto nel commento accanto, come
quello già presente per `docs/**`). Attenzione: quel commento dice che nessun test legge i percorsi
ignorati, e `payload-lettura.spec.ts` legge `tools/agente-pesa/testdata/contratto/`. Aggiornare il
commento: un commit che cambia **solo** il contratto non cambia ciò che gira in produzione, e il
contratto è comunque verificato dal job `agente-pesa` e dal job `backend` di `ci.yml`, che non ignora
`tools/`.

- [ ] Test `TestVersione`: `agente-pesa versione` stampa `agente-pesa <versione> (<GOOS>/<GOARCH>)`.
- [ ] `go-docker.sh test ./...` verde in locale; `go-docker.sh build` con `GOOS=windows` produce
  `dist/agente-pesa.exe` (file creato con l'utente corrente, non root).
- [ ] Job CI: lanciare `workflow_dispatch` sul branch (dopo il push autorizzato da chi coordina) o,
  se il push non è ancora previsto, verificare il comando del job a mano: `docker create … && docker cp
  … && docker start -a` dalla radice del worktree. Annotare tempo e dimensione dell'eseguibile.
- [ ] Commit: `build(agente-pesa): progetto Go, build Windows nel container e job CI`.

## Task G2: lettura, payload v1, firma e contratto

**Dipende da G1.** **File:** `internal/lettura/lettura.go` + `_test.go`, `internal/firma/firma.go` +
`_test.go`, `testdata/contratto/lettura-v1.json`.

**Interfacce prodotte:** `lettura.Nuova(agenteID, strumentoID string, seq int64, c driver.Campione,
oraAgente time.Time, nomeDriver string, simulata bool) (Payload, error)`, `Payload.Bytes() []byte`
(JSON di D6), `firma.Firma(priv ed25519.PrivateKey, payload []byte) []byte` (sui byte con il prefisso
di dominio), `firma.Verifica(pub, payload, sig) bool`, `FormattaCentesimi(int64) string`.

- [ ] Test (prima, rossi): `FormattaCentesimi(1234000)` = `"12340.00"`, `(5)` = `"0.05"`, negativo o
  oltre 9.999.999.999 → errore; payload con tutte le chiavi di D6 e nessun'altra (`json.Decoder` con
  `DisallowUnknownFields` sul risultato); `oraAgente` con offset; `alibiId` vuoto → `null`; `grezzo`
  oltre 256 byte → errore, non troncamento (un frame troppo lungo è un frame sbagliato); firma
  verificabile, un byte cambiato → falsa, prefisso di dominio diverso → falsa; **contratto**: con seed
  `000102…1f` e un payload fisso, `-update` scrive `lettura-v1.json`, senza `-update` lo confronta.
- [ ] Implementare con `crypto/ed25519`, `encoding/json`, nessuna dipendenza.
- [ ] Commit: `feat(agente-pesa): payload firmato v1 e file di contratto con il backend`.

## Task B1: dominio backend, credenziali, payload, regole

**Dipende da G2.** **File:** `src/domain/pese/agenti/credenziali-agente.ts` + spec,
`src/domain/pese/agenti/payload-lettura.ts` + spec, `src/domain/pese/agenti/regole-lettura.ts` + spec,
`src/domain/pese/agenti/stato-agente.ts` + spec.

**Interfacce prodotte:** `generaCodice(): string`, `normalizzaCodice(s): string | null`,
`generaToken(): string`, `hashSegreto(s): string` (SHA-256 hex), `improntaChiave(base64): string`,
`chiavePubblicaDaBase64(s): KeyObject | null`; `leggiPayloadLettura(payloadB64, firmaB64,
chiavePubblica): { ok: true; payload: PayloadLettura; bytes: Buffer } | { ok: false; codice:
'FIRMA_NON_VALIDA' | 'PAYLOAD_NON_VALIDO'; dettaglio }` (verifica **prima** della lettura del JSON);
`valutaLettura` (D7); `ORE_VALIDITA_LETTURA`, `MINUTI_TOLLERANZA_OROLOGIO = 5`,
`MINUTI_DIFFERITA = 15`, `MINUTI_SFASAMENTO = 10`, `AVVISO_LETTURA_SIMULATA`;
`agenteInLinea(ultimoContatto, adesso): boolean` (< 3 min).

- [ ] Test: codice di 12 caratteri dell'alfabeto, `normalizzaCodice('abcd-efgh-jk0o')` → con `O→0`,
  formato sbagliato → null; token `^wfpa_[A-Za-z0-9_-]{43}$`, due token diversi; **contratto**:
  `payload-lettura.spec.ts` legge `tools/agente-pesa/testdata/contratto/lettura-v1.json` (percorso
  relativo alla radice del repo) e la firma risulta valida; payload con chiave in più, `v: 2`,
  `pesoKg: "12340.5"`, `pesoKg: 12340` (numero), `unita: "t"`, `oraAgente` senza offset, `simulata`
  incoerente col driver → `PAYLOAD_NON_VALIDO`; firma di un'altra chiave → `FIRMA_NON_VALIDA`;
  payload oltre 2048 byte → `PAYLOAD_NON_VALIDO` prima di verificare; `valutaLettura`: ogni codice di
  D7 con un caso, portata 60.000 e peso 60.000,01 → `FUORI_PORTATA`, `oraAgente = ricezione + 6 min`
  → `OROLOGIO_AVANTI`, `+4 min` → accettabile; differita 16 min → avviso, 14 → no; simulata senza
  permesso → `SIMULAZIONE_NON_AMMESSA`.
- [ ] `npx jest -w 2 src/domain/pese/agenti` verde.
- [ ] Commit: `feat(pese): credenziali, payload firmato e regole delle letture dell'agente (dominio puro)`.

## Task B2: schema, migration, trigger, privilegi, RLS

**Dipende da B1.** **File:** `prisma/schema.prisma` (enum `FontePesata` + `SIMULATA`, enum
`StatoAgentePesa`, modelli `AgentePesa`, `LetturaPesa`; campi `StrumentoPesa.agenteId`,
`Pesata.letturaId`, `Tenant.peseSimulazioneAmmessa`, relazioni inverse), le due migration di D11,
`prisma/sql/ruoli-db.sql`, `prisma-rls.extension.ts` (2 voci con commento «Pese (Fase 4 pezzo 8b)»),
`rls-catalogo.postgres.spec.ts` (82 → 84), `README-tenant-transazione.md`,
`src/infrastructure/persistence/pese-agenti-schema.postgres.spec.ts` (nuovo),
`src/infrastructure/database/ruoli-db.postgres.spec.ts`, `src/domain/pese/tipi.ts` (`'SIMULATA'`).

- [ ] Commento `///` su ogni modello nuovo: cosa contiene, cosa è immutabile, dove sta la regola.
- [ ] Migration in quest'ordine (dentro `…100100`): lock timeout; enum; `agenti_pesa`; `letture_pesa`;
  colonne nuove con FK; CHECK e unici (compreso `pesate_lettura_id_key` e `pesate_lettura_check`);
  funzioni e trigger D3; REVOKE nel blocco `DO`; RLS.
- [ ] Test `pese-agenti-schema.postgres.spec.ts` (col ruolo applicativo, e dove indicato col ruolo di
  sistema): UPDATE e DELETE su `letture_pesa` rifiutati per `wasteflow_app` **e** `wasteflow_sistema`;
  TRUNCATE rifiutato; lettura con `stabile = false` rifiutata dal CHECK; `simulata` incoerente col
  driver rifiutata; alibi ripetuto sullo stesso strumento rifiutato, su strumenti diversi ammesso;
  pesata con `lettura_id` e peso diverso dalla lettura → `valori diversi dalla lettura`; pesata
  `STRUMENTO` senza `lettura_id` → CHECK; pesata `MANUALE` con `lettura_id` → CHECK; seconda pesata
  con la stessa lettura → unico; `agenti_pesa`: IN_ATTESA→ATTIVO con token e chiave ammesso,
  ATTIVO→IN_ATTESA rifiutato, cambio di `chiave_pubblica` su ATTIVO rifiutato, REVOCATO→ATTIVO
  rifiutato, DELETE rifiutato; isolamento: col contesto dell'azienda B nessuna riga di A visibile,
  INSERT di una lettura di B con `agente_id` di A → FK composta; cancellazione a cascata di un
  `tenant` di prova col proprietario → riesce (le righe spariscono).
- [ ] `ruoli-db.postgres.spec.ts`: privilegi di `letture_pesa` (SELECT, INSERT) e `agenti_pesa`
  (SELECT, INSERT, UPDATE) per entrambi i ruoli, anche dopo una seconda esecuzione di `db-ruoli.sh`.
- [ ] Verifiche di migration (Vincoli globali). `pese-schema.postgres.spec.ts` di 4.8a resta verde.
- [ ] Commit: `feat(pese): tabelle degli agenti e delle letture, fonte SIMULATA, vincoli e RLS`.

## Task B3: risoluzione dell'agente, guard, limiti

**Dipende da B2.** **File:** `src/application/pese/agenti/risoluzione-agente.service.ts` + spec,
`src/api/agenti-pesa/agente-pesa.guard.ts` + spec, `src/api/agenti-pesa/throttler-agente.guard.ts` +
spec, `src/api/agenti-pesa/agente-richiesta.ts` (tipo di `req.agentePesa` e decoratore
`@AgenteCorrente()`), `punti-di-sistema.spec.ts` (voce nuova).

- [ ] Test guard (con servizio finto): senza header → 401 `TOKEN_NON_VALIDO`; `Bearer` con un
  token senza prefisso → 401 senza interrogare il database; token ignoto → 401; IN_ATTESA → 401;
  REVOCATO → 403 `AGENTE_REVOCATO`; modulo `pese` spento → 403 (in `registra`: passa con avviso);
  errore del database nella verifica dei moduli → 503 (come l'interceptor); `req.agentePesa`
  valorizzato, `req.tenantId` e `req.user` intatti; il token non compare nei messaggi di log
  (spia sul `Logger`).
- [ ] Test throttler: tracker `agente:<id>`; due agenti dietro lo stesso IP hanno contatori separati.
- [ ] Commit: `feat(pese): risoluzione dell'azienda dal token dell'agente e limiti per agente`.

## Task B4: abbinamento e configurazione

**Dipende da B3.** **File:** `src/application/pese/agenti/abbinamento-agente.service.ts` + spec +
`.postgres.spec.ts`, `src/api/agenti-pesa/ingresso-agente.controller.ts` (rotte `abbinamento`,
`configurazione`), `src/api/agenti-pesa/dto/*.ts`, `src/api/agenti-pesa/agenti-pesa-ingresso.module.ts`
(importato da `pese.module.ts` o da `app.module.ts`, come i moduli vicini),
`src/api/controller-moduli.spec.ts` (voce in `BASE`: «rotte dell'agente di pesa: senza utente,
autenticate dal token dell'agente; il modulo pese lo verifica AgentePesaGuard»),
`src/api/agenti-pesa/ingresso-agente.http.spec.ts` (nuovo, modello `pese.accessi.http.spec.ts`).

- [ ] Test Postgres: codice valido → ATTIVO, token restituito una volta, `token_sha256` = hash,
  `codice_sha256` NULL, audit `PESA_AGENTE_ABBINATO` con `userId` NULL; **due abbinamenti in
  parallelo con lo stesso codice** → uno 201 e uno 401; codice scaduto (orologio del servizio
  spostato) → 401; agente REVOCATO col suo vecchio codice → 401; chiave pubblica non di 32 byte →
  400; stessa risposta 401 per codice ignoto, scaduto e usato (confronto del corpo).
- [ ] Test HTTP: `abbinamento` senza JWT funziona; `configurazione` col token restituisce solo gli
  strumenti assegnati all'agente; header `X-Tenant-ID` di un'altra azienda ignorato; 11 abbinamenti
  in un minuto dallo stesso IP → 429.
- [ ] Commit: `feat(pese): abbinamento dell'agente con codice monouso e configurazione`.

## Task B5: ingresso delle letture

**Dipende da B4.** **File:** `src/application/pese/agenti/ingresso-letture.service.ts` + spec +
`.postgres.spec.ts`, controller (rotta `letture`), DTO `LottoLettureDto` (`@ArrayMinSize(1)`,
`@ArrayMaxSize(50)`, `payload` `@IsBase64() @MaxLength(2800)`, `firma` `@IsBase64() @Length(88, 88)`),
`ingresso-agente.http.spec.ts`.

**Interfaccia:** `riceviLotto(agente: { id; tenantId }, elementi, ricezione: Date):
Promise<EsitoElemento[]>`.

- [ ] Per elemento: verifica firma con la chiave dell'agente (letta una volta per lotto nel contesto
  dell'azienda) → payload → `agenteId` uguale → strumento (RLS, `agente_id` = agente) →
  `valutaLettura` → idempotenza (`findUnique` per `(agenteId, chiaveIdempotenza)`: stesso `payload`
  → `GIA_RICEVUTA` con `letturaId`; diverso → `CHIAVE_RIUSATA`) → INSERT in una transazione propria;
  `P2002` sull'unico dell'alibi → `ALIBI_GIA_USATO`, sull'unico della chiave → rilettura e
  `GIA_RICEVUTA`. Tempo massimo per lotto: 10 s; oltre, il lotto si interrompe con 503 (mai
  `RIFIUTATA` per un timeout) e l'agente ritrasmette: gli elementi già scritti tornano
  `GIA_RICEVUTA`.
- [ ] Test Postgres: lotto di 3 (valida, firma alterata, instabile) → `ACCETTATA`, `RIFIUTATA
  FIRMA_NON_VALIDA`, `RIFIUTATA PESO_INSTABILE`, una sola riga; stesso lotto due volte →
  `GIA_RICEVUTA`; **stessa lettura in due richieste parallele** → una riga; payload firmato
  dall'agente A con strumento dell'azienda B → `STRUMENTO_NON_ASSEGNATO`, nessuna riga in B;
  simulata con `pese_simulazione_ammessa = false` → `SIMULAZIONE_NON_AMMESSA`; con `true` →
  `ACCETTATA`, `simulata = true`; firma non valida due volte in un minuto → un solo audit
  `PESA_AGENTE_FIRMA_NON_VALIDA`; `ultima_sequenza` non regredisce.
- [ ] Test HTTP: 51 elementi → 400; corpo non JSON → 400; 61 richieste in un minuto dallo stesso
  agente → 429 con `Retry-After`; agente revocato fra due richieste → la seconda 403.
- [ ] Commit: `feat(pese): ingresso delle letture firmate con idempotenza e regole di ricezione`.

## Task B6: battito e stato dell'agente

**Dipende da B5.** **File:** `src/application/pese/agenti/battito-agente.service.ts` + spec,
controller (rotta `battito`), `ingresso-agente.http.spec.ts`.

- [ ] Test: primo battito aggiorna le colonne di D8 e `scarto_orologio_ms` (agente avanti di 90 s →
  90.000); secondo battito dopo 10 s → nessuna scrittura (spia sul client), stato degli strumenti
  aggiornato in memoria; risposta con `oraServer`; agente revocato → 403.
- [ ] Commit: `feat(pese): battito dell'agente, ultimo contatto e scarto dell'orologio`.

## Task B7: gestione degli agenti, letture e pesate da strumento

**Dipende da B6.** **File:** `src/application/pese/agenti/agenti-pesa.service.ts` + spec +
`.postgres.spec.ts`, `src/application/pese/agenti/letture-pesa.service.ts` + spec,
`src/api/pese/agenti-pesa.controller.ts` + `.http.spec.ts`, `src/api/pese/dto/` (DTO nuovi e
`PesataDaLetturaDto`), `pesate-scrittura.ts` (`inserisciPesataDaLettura`), `accessi-pesa.service.ts`
e `accessi-pesa.tipi.ts` (pesata discriminata), `viste-accesso.ts` (fonte, `letturaId`, `firmaValida`,
avvisi), `src/domain/pese/impronta-pesata.ts` + spec (D13), `src/domain/pese/netto-accesso.ts` + spec
(D14), `collegamenti-accesso.service.ts` (blocco Q1), `src/api/admin/tenant.controller.ts` e servizio
(D15, ultima voce), `controller-moduli.spec.ts` (voce di `agenti-pesa.controller.ts` in
`MAPPA_MODULI`), `feature-catalog.ts` (etichetta «Pese», Q8).

- [ ] Test dominio: `improntaPesata` con fonte STRUMENTO usa `p2|` e cambia se cambiano `letturaId`
  o `firmaAgente`; MANUALE invariata (impronta di una riga di prova di 4.8a uguale a prima);
  `calcolaNetto` con una pesata SIMULATA → `simulato: true`, `AVVISO_SIMULATA`, `manuale: false`.
- [ ] Test Postgres: ADMIN crea agente → codice una volta, audit; OPERATOR → 403; nuovo codice su
  ATTIVO → 409; revoca → token respinto alla richiesta successiva (via servizio di risoluzione);
  assegnazione di uno strumento a un agente REVOCATO → 422; elenco letture libere della sede, non
  quelle di un'altra sede né già usate; **apertura di un accesso DOPPIA con una lettura** → pesata
  `STRUMENTO` con firma, alibi e ora della lettura, impronta `p2` integra, `firmaValida: true`;
  seconda pesata con un'altra lettura → accesso CHIUSO, netto `DUE_PESATE`, nessun avviso manuale;
  **stessa lettura in due aperture parallele** → una 201, l'altra 409; lettura di 25 ore prima → 422;
  seconda lettura più vecchia della prima → 422; lettura di uno strumento di un'altra sede → 422;
  lettura simulata con simulazione ammessa → fonte SIMULATA; permesso tolto → uso 422, collegamento
  a un FIR 422; stessa `chiaveIdempotenza` dell'interfaccia due volte → `giaRegistrata` (invariato).
- [ ] Test HTTP: `PATCH /admin/tenants/:id/pese-simulazione` da ADMIN → 403, da SUPER_ADMIN → 200 e
  audit; payload di 4.8a (pesata manuale) ancora accettati senza modifiche.
- [ ] Commit: `feat(pese): gestione degli agenti e pesate dalle letture dello strumento`.

## Task G3: driver, trasporti, SIMULATA

**Dipende da G2.** **File:** `internal/driver/driver.go` + `_test.go`, `internal/driver/registro.go`,
`internal/driver/trasporto/trasporto.go`, `tcp.go` + `_test.go`, `seriale.go` (interfaccia,
`ErrNonDisponibile`), `internal/driver/trasporto/frame.go` + `_test.go` (`LettoreFrame`),
`internal/driver/simulata/simulata.go` + `_test.go`, `internal/driver/esempio_test.go` (driver
«eco» di prova su `net.Pipe`, mostra come si scrive un driver a domanda/risposta: modello per D800).

- [ ] Test `LettoreFrame`: frame spezzato in 3 letture ricomposto; due frame in una lettura separati;
  letture da 0 byte ignorate (difetto 7); frame oltre `MaxFrame` scartato fino al delimitatore
  successivo; timeout senza dati → errore di timeout, nessun frame vuoto.
- [ ] Test TCP: connessione a un `net.Listener` di prova, timeout di connessione, riconnessione
  dopo chiusura del server con backoff.
- [ ] Test registro: nome duplicato → panic all'avvio; driver ignoto → errore leggibile con
  l'elenco dei disponibili.
- [ ] Test SIMULATA (orologio finto, seme fisso): sequenza `[instabile×3, stabile definitivo]` per
  ogni peso; alibi `SIM-000001`, `SIM-000002`, … persistito e ripreso dopo riavvio; `Sovraccarico`
  emesso con la probabilità configurata; `Simulato() == true`.
- [ ] Test del filtro del nucleo (in `internal/driver`, funzione pura `DaRegistrare(c Campione) bool`):
  solo `Definitivo && Stabile`; `Sottocarico`, `Sovraccarico`, `Instabile`, `Errore` → false.
- [ ] Commit: `feat(agente-pesa): interfaccia dei driver a plugin, trasporto TCP e driver SIMULATA`.

## Task G4: coda su file

**Dipende da G2.** **File:** `internal/coda/coda.go` + `_test.go`.

**Interfaccia:** `Apri(dir string) (*Coda, error)`, `Accoda(l Elemento) error`,
`Prossimi(n int) ([]Elemento, error)` (in ordine di sequenza), `Segna(chiave string, esito Esito,
motivo string) error`, `Conta() Conteggi`, `Pulisci(oltre time.Duration) error`,
`ProssimaSequenza() (int64, error)`.

- [ ] Test (su `t.TempDir()`): ordine di sequenza anche con nomi creati fuori ordine; file `.tmp`
  rimasti da un crash cancellati all'apertura e mai restituiti; elemento accettato spostato in
  `inviate/`, rifiutato in `scartate/` con il motivo; riapertura dopo «crash» (coda riaperta da
  un'altra istanza) senza perdite né duplicati; sequenza persistita e mai riusata dopo riapertura;
  limite di 100.000 (con limite ridotto nel test) → `ErrCodaPiena`; `Pulisci` toglie solo gli
  inviati più vecchi di 30 giorni.
- [ ] Commit: `feat(agente-pesa): coda locale su file con scrittura atomica`.

## Task G5: invio, abbinamento, configurazione, log

**Dipende da G3, G4.** **File:** `internal/invio/client.go` + `_test.go`, `internal/config/config.go` +
`_test.go`, `internal/registro/registro.go` + `_test.go`, `internal/firma/custode.go` (+
`custode_windows.go` con DPAPI, `custode_altri.go` file 0600) + `_test.go`.

- [ ] Test client contro `httptest.Server`: abbinamento → token e strumenti; lotto con esiti misti →
  `Segna` coerente; 429 con `Retry-After: 7` → attesa 7 s (orologio finto); 503 → backoff crescente
  con tetto 5 min; rete chiusa → nessuna perdita, ritenta; 403 `AGENTE_REVOCATO` → stato revocato,
  nessun altro invio per 10 min; `http://` verso un host diverso da localhost → errore di
  configurazione; il token non compare mai nel log (log catturato in un buffer).
- [ ] Test config: `SIMULATA` senza `simulazione: true` → errore; percorso relativo → errore;
  strumento non presente nella configurazione del server → errore; driver ignoto → errore.
- [ ] Test log: rotazione a `maxMB` (soglia ridotta nel test) con `file` copie; valori `wfpa_…`
  sostituiti da `[token]`.
- [ ] Test custode (non Windows): scrittura e lettura, permessi `0600`; `GOOS=windows go vet` compila
  `custode_windows.go`.
- [ ] Commit: `feat(agente-pesa): client di invio con ritrasmissione, configurazione e log`.

## Task G6: ciclo principale, comandi, servizio Windows

**Dipende da G5 e B6** (il test d'integrazione usa il contratto delle rotte). **File:**
`internal/agente/agente.go` + `_test.go`, `cmd/agente-pesa/main.go` (comandi `abbina`, `esegui`, `stato`,
`servizio`, `versione`), `internal/servizio/servizio_windows.go`, `servizio_altri.go`,
`README.md` (installazione, configurazione, risoluzione dei problemi, verifica SHA-256).

- [ ] Test `agente` con un server finto che implementa le 4 rotte (e verifica davvero la firma con
  la chiave ricevuta all'abbinamento): `abbina` → `esegui` con SIMULATA (2 pesi, intervallo 10 ms) →
  2 letture accettate, nessuna instabile inviata; server giù per 50 letture poi su → tutte inviate in
  ordine di sequenza, nessun duplicato sul server; simulazione rifiutata dal server
  (`simulazioneAmmessa: false`) → l'agente non avvia il driver e `stato` lo dice; battito ogni
  intervallo con i conteggi della coda; arresto con `ctx` → coda coerente.
- [ ] Servizio Windows: solo compilazione in CI (`GOOS=windows go vet` e build). Prova manuale nel
  Task F4.
- [ ] Commit: `feat(agente-pesa): ciclo principale, comandi e servizio Windows`.

## Task F1: frontend, servizio e scheda Agenti

**Dipende da B7.** **File:** `fe/features/pese/pese.service.ts` + spec (metodi per D15),
`fe/features/pese/agenti-pesa.component.ts` + spec DOM, `fe/features/pese/nuovo-agente-dialog.component.ts`
+ spec DOM, `fe/features/pese/pese.component.ts` (scheda «Agenti»), `fe/features/pese/strumenti-pesa.component.ts`
(colonna e selezione dell'agente), `pese-stili.ts`.

- [ ] Scheda «Agenti»: tabella (descrizione, sede, stato con badge, ultimo contatto relativo, «in
  linea» verde / «non in linea da …» rosso oltre 3 min, versione, coda in attesa, letture scartate,
  scarto dell'orologio se > 60 s, strumenti con stato), azioni per ADMIN (nuovo agente, nuovo codice,
  revoca con `motivo-dialog` esistente).
- [ ] Dialog «Nuovo agente»: dopo il salvataggio mostra il codice a gruppi in carattere monospazio,
  la scadenza con conto alla rovescia, il comando da lanciare (`agente-pesa abbina --server <URL
  del backend> --codice <codice>`), il pulsante «Copia»; avviso «Il codice si vede una volta sola».
  Alla chiusura il codice non resta in memoria.
- [ ] Spec DOM: OPERATOR non vede le azioni; codice mostrato una volta; revoca chiede il motivo.
- [ ] Karma, build, eslint dei file toccati.
- [ ] Commit: `feat(pese): pagina degli agenti di pesa e abbinamento`.

## Task F2: frontend, pesata da strumento

**Dipende da F1.** **File:** `fe/features/pese/letture-strumento.component.ts` + spec DOM (scelta di una
lettura), `nuovo-accesso-dialog.component.ts` e `seconda-pesata-dialog.component.ts` (+ spec DOM),
`accesso-dettaglio.component.ts`, `accessi.component.ts`, `pese-formato.ts`, `pese-stili.ts`.

- [ ] Nei due dialog un selettore «Da strumento | Manuale» (predefinito «Da strumento» se la sede ha
  almeno uno strumento con agente, altrimenti «Manuale»); con «Da strumento» l'elenco delle letture
  libere della sede (aggiornato ogni 5 s finché il dialog è aperto, fermo alla chiusura), riga con
  peso (`formattaQuantita`), alibi, ora dello strumento e del PC, badge «Simulata», «In differita»;
  scelta di una riga e invio di `{ letturaId }`. Nessun campo del peso editabile in questo modo.
- [ ] Badge in dettaglio ed elenco: «Da strumento» (con la descrizione dell'agente e «firma
  verificata» / «firma non verificata»), «Simulata» (viola) accanto a «Manuale» e «Tara dichiarata».
- [ ] Spec DOM: polling fermo alla chiusura; nessuna lettura → messaggio «Nessuna lettura dallo
  strumento nelle ultime 24 ore.» e scelta manuale disponibile; lettura simulata marcata.
- [ ] Commit: `feat(pese): pesata dalle letture dello strumento nell'apertura e nella seconda pesata`.

## Task F3: frontend, permesso di simulazione

**Dipende da B7.** **File:** `fe/features/admin/tenants/tenant-admin.service.ts`,
`tenant-admin.component.ts` + spec.

- [ ] Interruttore «Ammetti pesate simulate (solo aziende di prova)» visibile e attivo solo per il
  SUPER_ADMIN, con conferma; spec: ADMIN non lo vede.
- [ ] Commit: `feat(admin): permesso delle pesate simulate per azienda`.

## Task E1: e2e Playwright

**Dipende da F2, F3.** **File:** `e2e/tests/mud-pese/pese-agente.spec.ts` (cartella delle pese già
esistente; config `e2e/playwright.config.ts`), helper `e2e/utils/agente-finto.ts` (Node: genera la
coppia Ed25519, si abbina col codice letto dalla pagina, invia letture firmate con `fetch`), fixture
d'azienda da `e2e/utils/azienda-di-test.ts`.

- [ ] Scenario: SUPER_ADMIN ammette la simulazione per l'azienda di prova; ADMIN crea un agente e
  legge il codice; l'helper si abbina e invia due letture SIMULATA; l'agente appare «in linea»;
  l'operatore apre un accesso DOPPIA scegliendo la prima lettura, poi la seconda pesata con la
  seconda; netto calcolato, badge «Simulata»; ADMIN revoca l'agente; l'helper riceve 403.
- [ ] Gira nel job `e2e` esistente (nessun job nuovo). Se il tempo del job cresce più di 1 minuto,
  annotarlo nel rapporto.
- [ ] Commit: `test(e2e): agente di pesa simulato dall'abbinamento al netto`.

## Task F4: documentazione, verifica finale, prova reale

**File:** `ops/README.md` (sezione «4.8b agente di pesa»: tabelle, privilegi, trigger, ripristino a
mano, `SIMULATA` non rimovibile dall'enum, cosa succede con un rollback del codice: tabelle ignorate,
agenti che ricevono 404 e accodano), `tools/agente-pesa/README.md` (completo), `CHANGELOG.md`
(«Unreleased», in italiano), `/home/graziano/Progetti/STATUS.md` (scheda rifiuti: 4.8b fatto con solo
SIMULATA, domande Q1-Q8, prossimo passo: driver reali col pilota).

- [ ] Suite complete: `npm run test:postgres`, `npm run test:cov`, tsc, eslint globale backend, Karma,
  build frontend, `go-docker.sh vet/test`, build Windows. Confronto con la base del Task 0.
- [ ] Prova a mano in locale: backend + frontend sul database 55445; agente compilato per Linux
  (`go-docker.sh build -o dist/agente-pesa ./cmd/agente-pesa`) avviato con `esegui` e SIMULATA verso
  `http://127.0.0.1:<porta>`; abbinamento dalla pagina, letture che arrivano, accesso DOPPIA dalle
  letture, rete interrotta (backend fermo 2 minuti) e ripresa con la coda che si svuota. Annotare
  nel rapporto cosa si è visto.
- [ ] Prova su Windows (a cura di Graziano, fuori dal worktree): `agente-pesa.exe abbina`,
  `servizio installa`, `servizio avvia`, riavvio del PC, letture che continuano ad arrivare; controllo
  che `credenziali.bin` non sia leggibile da un utente non amministratore. Esito nel rapporto o come
  seguito se il PC non è disponibile.
- [ ] Commit: `docs(pese): agente di pesa, ripristino e note di rilascio del pezzo 4.8b`.

## Ordine

0 → G1 → G2 → B1 → B2 → B3 → B4 → B5 → B6 → B7 → G3 → G4 → G5 → G6 → F1 → F2 → F3 → E1 → F4,
uno alla volta. G3 e G4 dipendono solo da G2: se serve, si possono spostare prima di B1 (non toccano
file condivisi), mai in parallelo a un task backend.

## Rischi

- **R1. Windows sul PC della pesa** spesso vecchio (Windows 7 nelle installazioni WinWaste): Go
  moderno non lo supporta (Q4). Da chiedere al pilota prima di tutto.
- **R2. Parti solo Windows non provate in CI** (servizio, DPAPI, `icacls`): compilano in CI, si provano
  a mano (Task F4). Tenerle sottili: la logica sta nei pacchetti provati su Linux.
- **R3. Antivirus e SmartScreen** su un `.exe` Go non firmato: falsi positivi frequenti. Q6; in
  alternativa invio del binario al fornitore dell'antivirus del cliente.
- **R4. Orologi**: PC della pesa sfasato o fuso sbagliato. Mitigazione: ora dello strumento separata,
  scarto misurato a ogni battito e mostrato, rifiuto oltre 5 minuti nel futuro; nessuna correzione
  automatica dell'ora.
- **R5. Valore enum aggiunto** (`SIMULATA`): non si toglie con un rollback. Accettato e documentato.
- **R6. Limiti in memoria** (throttler, stato degli strumenti, audit della firma non valida): validi con
  un processo `backend`; con più repliche vanno su Redis (già nello stack). Annotato in `ops/README.md`.
- **R7. Impronta p2 dedotta dalla fonte**: corretta solo se in produzione non esistono pesate
  `STRUMENTO`/`FILE` scritte prima di 4.8b (verifica al Task 0 e prima del rilascio).
- **R8. Supporto sul campo** (roadmap §4.8b): log leggibili, comando `stato`, README con i problemi
  frequenti; senza un pilota il comportamento con indicatori veri resta ipotetico (difetto noto: i
  protocolli di `pese.md §2.4` non sono verificati sui manuali, `unk_f6c4acfa…`).
- **R9. Tempo di runner**: il job Go aggiunge 1-3 minuti per run CI; il job e2e cresce per lo scenario
  nuovo. Se pesa, il job Go può diventare manuale (`workflow_dispatch`) come scelta di Graziano.

## Fuori ambito

- Driver reali: D800/EV2002 (`$MP`), D410, Dini Argeo DFW06 (seriale e TCP), Bilanciai/Tassinari, bilancia
  generica configurabile, Corepla (TCP/XML), `DB-PESA`. Il trasporto seriale (serve una libreria pure Go
  come `go.bug.st/serial`, da valutare col pilota). L'interfaccia e il trasporto TCP sono pronti.
- Fonte `FILE` (import di export di altri software di pesa, opzione O3).
- Apertura automatica dell'accesso dall'agente, card/badge/tag RFID, self box, semafori, stampa dello
  scontrino (Q7).
- Distribuzione e aggiornamento automatico dell'agente, installer MSI, firma Authenticode (Q6),
  download dalla pagina Agenti.
- Rotazione del token e della chiave senza nuovo abbinamento; revoca di singole letture; gestione delle
  lacune di sequenza in interfaccia (la colonna c'è).
- Visualizzazione del peso in tempo reale nel browser (WebSocket): l'agente invia solo letture
  definitive.
- Software legalmente rilevante (WELMEC 7.2) e valutazione metrologica (N1).
- Più processi `backend` con limiti condivisi (R6).

## Domande aperte (con proposta)

1. **Q1 — Pesate simulate nei documenti.** Proposta: ammesse solo finché l'azienda ha il permesso;
   altrimenti 422.
2. **Q2 — Dove sta il permesso di simulazione.** Proposta: colonna su `tenants` gestita dal
   SUPER_ADMIN con audit (visibile, tracciato); alternativa: variabile d'ambiente.
3. **Q3 — Validità di una lettura.** Proposta: 24 ore, avviso oltre 2.
4. **Q4 — Windows minimo.** Proposta: Windows 10 / Server 2016; chiedere subito al primo prospect
   con pesa a ponte che PC ha.
5. **Q5 — Account del servizio.** Proposta: account virtuale `NT SERVICE\WasteFlowAgentePesa`.
6. **Q6 — Firma dell'eseguibile.** Proposta: rimandata al pilota; intanto SHA-256 pubblicato.
7. **Q7 — Chi apre l'accesso.** Proposta: l'operatore, dalla lettura; automatico dopo, con le card.
8. **Q8 — Modulo commerciale.** Proposta: dentro `pese`; rinominare l'etichetta in «Pese».
9. **D10 della roadmap — indicatore e cliente pilota.** Non risolvibile qui: serve per i driver reali.
