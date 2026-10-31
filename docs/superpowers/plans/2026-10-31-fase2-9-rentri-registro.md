# Fase 2 pezzo 9: trasmissione del registro a RENTRI — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL `superpowers:subagent-driven-development` (consigliato) o
> `superpowers:executing-plans`. Sonnet implementa un task alla volta, opus rivede ogni task prima
> del successivo. Ordine **strettamente sequenziale** (un worktree, un database di test, commit
> condivisi): Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. Nessun parallelo
> interno: 16 GB di RAM, e i task dal 6 in poi dipendono dalle interfacce dei precedenti.

**Obiettivo.** Trasmettere a RENTRI (servizio `dati-registri`) le annotazioni del registro di ogni
sede, comprese rettifiche e annullamenti, con uno stato per movimento, un invio manuale e il job di
invio con ripresa che le Fasi 3-4 chiamano "job di invio RENTRI"; **senza mai ritrasmettere ciò che
RENTRI ha già** e senza nessun invio automatico retroattivo.

**Architettura.** Tabella 1:1 `movimenti_trasmissione_rentri` (nessuna colonna mutabile su
`waste_movements`; nessuna riga = "non trasmesso"). La traduzione movimento → `MovimentoModel` /
`AnnullamentoMovimentoModel` è una funzione pura fail-closed; l'invio prenota le righe per registro
sotto advisory lock, salva la `transazione_id` prima del polling e legge sempre `/result`, come la
trasmissione dei FIR (piano B). Il job cron elenca le aziende con la connessione di sistema e lavora
un'azienda alla volta nel suo contesto.

**Tech stack.** NestJS, Prisma 5.22, PostgreSQL 16 con RLS FORCE, `@nestjs/schedule`, fake RENTRI
in-process (`tools/rentri-fake`), Angular + PrimeNG, Playwright.

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fase2-parita-registro.md` §F2-9, §2
(ordine), §3 (RLS, regole 1-3 e 7), §4 (decisione "rettifica su anno trasmesso"), §5; contratto
`docs/contracts/rentri/dati-registri.yaml` (v1.0.20260909-1089); WinWaste
`/home/graziano/Progetti/winwaste/docs/rentri.md` §5 e `rentri/03-aggancio-a-winwaste.md` §3.1, §4.

---

## DA CONFERMARE CON GRAZIANO

Il piano è eseguibile con le raccomandazioni qui sotto. Per ognuna: cosa si fa, impatto se la
risposta è diversa.

- **Q1. Chi è obbligato a trasmettere il registro.** (DM 59/2023: iscrizione al RENTRI per fasce di
  dipendenti e per pericolosi; i produttori di soli non pericolosi sotto soglia non sono obbligati.)
  **Raccomandazione:** l'applicazione **non decide** l'obbligo. La trasmissione si attiva per
  registro quando un ADMIN inserisce l'`identificativo_registro` preso dal portale; la pagina dice in
  una nota che l'obbligo dipende dalla categoria dell'azienda e rimanda al portale. *Impatto se
  diverso:* un controllo d'obbligo per azienda (campo nuovo su `tenants` e avviso) è un seguito che
  non cambia tabelle né flusso di questo pezzo.
- **Q2. Termini di trasmissione.** **Raccomandazione:** nessuna scadenza calcolata in questo pezzo;
  la pagina mostra quante annotazioni sono "da trasmettere" e da quando. *Impatto:* un avviso di
  scadenza è solo frontend + una query, nessun cambio di schema.
- **Q3. La transazione `POST .../movimenti` è tutto-o-niente?** Il contratto non lo dice.
  **Raccomandazione (D9):** fa fede solo `esito.numero_registrazioni`: una riga elencata lì è
  `TRASMESSA` anche se `errore = true`; una riga non elencata diventa `RIFIUTATA` e non riparte da
  sola. *Impatto:* nessuno nei due casi (la regola è giusta per entrambe le semantiche).
- **Q4. RENTRI rifiuta un `numero_registrazione` (anno, progressivo) già presente nel registro?**
  **Raccomandazione:** lo si presume (il numero è nostro, quindi è una chiave naturale), ma **non ci
  si affida**: ogni esito incerto diventa `INCERTA`, bloccata, e si sblocca solo con la verifica
  (D11). *Impatto se no:* nessuno, la difesa non dipende da questo.
- **Q5. Numerazione RENTRI = progressivo locale.** Si trasmette `numero_registrazione = {anno:
  progressiveYear, progressivo: progressiveNumber}`; chi parte a metà anno usa già il progressivo
  iniziale (F2-1, `RegistroProgressivoIniziale`). **Raccomandazione:** prima del primo invio di un
  registro e anno la pagina mostra l'allineamento (registrazioni locali dell'anno vs
  `contaMovimenti` su RENTRI, D13) e va verificato sul portale con un cliente reale. *Impatto se la
  numerazione RENTRI fosse assegnata dall'ente:* cambierebbero D4 e il parsing dell'esito, non lo
  schema (`identificativo_rentri` c'è già).
- **Q6. Codici RENTRI delle causali di sistema.** `INGRESSO_ESTERNO` = `T*` (F2-5 lo ha marcato
  "DA CONFERMARE prima di F2-9": per un produttore un rifiuto proprio prodotto fuori sede sarebbe
  `RE`); `RECUPERO_PARZIALE`, `RICLASSIFICAZIONE`, `ALTRO_CARICO`, `ALTRO_SCARICO` senza codice.
  **Raccomandazione:** catalogo invariato; le causali senza codice rendono la riga
  `NON_TRASMISSIBILE` con il messaggio "Causale senza codice RENTRI: crea una causale aziendale con il
  codice giusto". *Impatto se `INGRESSO_ESTERNO` deve diventare `RE`:* una migration sul catalogo
  globale (F2-5) e la tabella delle parti di D5 (RE non porta il produttore): mezz'ora, fuori da qui.
- **Q7. Una correzione può viaggiare nello stesso lotto del suo predecessore?** **Raccomandazione
  (D8):** no: una rettifica o un annullamento parte solo quando il predecessore è `TRASMESSA` o
  `GIA_SU_RENTRI`; resta `DA_TRASMETTERE` e parte al giro successivo. *Impatto se sì:* si toglie una
  condizione in `selezionaLotto` (Task 5).
- **Q8. Rettifica di un'annotazione già trasmessa: si accoda da sola?** **Raccomandazione (D7):** sì,
  anche in modalità manuale (RENTRI altrimenti tiene un dato che sappiamo sbagliato); la risposta
  della rettifica porta l'avviso. *Impatto se no:* il job non adotta le correzioni (una query in meno).
- **Q9. Riferimenti ai carichi negli scarichi (`riferimento_operazione`).** **Raccomandazione
  (D6):** si compilano col FIFO di F2-6, comprese le origini delle giacenze iniziali (F2-2) come
  "relazioni iniziali"; sono una proposta del programma, come in WinWaste (`relaz`). *Impatto se
  RENTRI non li vuole dai produttori o li vuole solo abbinati a mano:* si spegne la funzione del
  Task 4 (campo facoltativo nel contratto) senza toccare il resto.
- **Q10. Unità diverse da kg.** **Raccomandazione:** t → kg ×1000; litri → `l`; m³ → `l` ×1000
  (conversione di volume pura, nessun peso specifico, come WinWaste per il FIR); ogni altra unità →
  `NON_TRASMISSIBILE`. *Impatto se m³ va rifiutato:* una riga nella tabella di D5.

---

## Stato di partenza (verificato su master `692880e`)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Client RENTRI del registro.**
- `src/infrastructure/rentri/rentri-registri.client.ts` (585 righe): `inviaMovimenti` `:94-112`,
  `elencaMovimenti` `:125-158`, `contaMovimenti` `:161-174`, `dettaglioMovimentoPerAnnoProgressivo`
  `:177-192`, `dettaglioMovimentoPerIdentificativo` `:195-209`, `validaRegistro` `:216-239`,
  `ultimaTransazioneId` `:246-258`, `attendiEsito` `:267-295` (polling `/status` → `/result` sul
  prefisso `/dati-registri/v1.0`, **attende** con `attendiMs`, restituisce `unknown`).
  **Difetto da chiudere:** `post` `:398-455` ritenta fino a 5 volte anche su 5xx e risposta assente
  tramite `gestisciRispostaErroreRentri`: per una POST non idempotente vuol dire rischio di due
  transazioni. Nessun rate limiter. Il FIR invece lo fa giusto: `RENTRIApiClient.creaFormulario`
  (`rentri-api.client.ts:157-175`, `{ creazione: true }`) non ritenta e solleva
  `TrasmissioneRentriIncertaError` (`:1553`); `TransazioneRentriNonTrovataError` `:1574`; rate limiter
  `RentriRateLimiterService.acquisisci(tenantId)` → `permesso.rilascia()` (`:129-138`).
- **Non registrato:** `src/infrastructure/rentri/rentri.module.ts:45-91` (providers ed exports) non lo
  nomina. Nessun chiamante. Oracolo esistente: `rentri-registri.oracolo.spec.ts` (fake in-process,
  canali `/__controllo/dati-registri/registro` e `/completa-transazione`).
- Fake: `tools/rentri-fake/src/routes/dati-registri.ts`, `src/stato/registri.ts:164-203`
  (`completaTransazione`: con `errore:false` applica i movimenti e restituisce
  `numero_registrazioni` con `identificativo`); validatore del contratto
  `tools/rentri-fake/src/dominio/movimento.ts:39` `validaElencoMovimenti`.

**Contratto (`docs/contracts/rentri/dati-registri.yaml`).** `POST /operatore/{identificativo_registro}/movimenti`
(`:474-597`): 1-1000 elementi `oneOf MovimentoModel | AnnullamentoMovimentoModel`, 202 +
`transazione_id`, path `^R[0-9A-Z]{10}$`. `MovimentoModel` `:4279`; `DatiRiferimentiModel` `:3342`
(`numero_registrazione` {anno 1980..2050, progressivo ≥1}, `data_ora_registrazione`,
`causale_operazione` enum `DT NP T* RE I aT M TR T*aT` `:2826`, `numero_registrazione_rettifica`,
`riferimento_operazione[]` anche verso registrazioni non trasmesse, `stoccaggio_istantaneo`);
`AnnullamentoMovimentoModel` `:2770` (`numero_registrazione`, `data_ora_registrazione`,
`numero_registrazione_annullata`, `annotazioni` 1..500); `DatiRifiutoModel` `:3404` (`codice_eer`,
`stato_fisico` SP/S/FP/L/VS, `quantita` {valore, `kg`|`l`} `:4581`, `caratteristiche_pericolo`
HP01..HP15, `destinato_attivita`, `descrizione_eer` per i `.99`); `DatiProduttoreModel` `:3168`
(`indirizzo` obbligatorio); `DatiDestinatarioModel` `:2927` (`denominazione`, `codice_fiscale`,
`num_autorizzazione`); `DatiTrasportatoreModel` `:3494` (`denominazione`, `codice_fiscale`,
`num_iscrizione_albo` `^([A-Za-z]{2})/([0-9]{6})$`); `integrazione_fir` solo per `aT TR T* T*aT`,
`esito` solo per `aT T*aT`; quasi tutti i modelli `additionalProperties: false`. Esito
`EsitoMovimentiModel` `:3633` (`errore`, `validazione[]` con `indice`/`campo`/`tipo`/`codice_messaggio`,
`esito.numero_registrazioni[]` {anno, progressivo, identificativo `^M[0-9A-Z]{19}$`}).

**Registro e movimenti.**
- `prisma/schema.prisma:2098-2121` `RegistroRifiuti`: `identificativoRentri String? VarChar(100)`
  (`:2108`, "non ancora valorizzato: F2-9"), nessun CHECK, **nessuno lo scrive** (grep:
  `identificativoRentri` compare solo in `domain/registry/value-objects/identificativo-fiscale.ts`,
  che è un'altra cosa).
- `prisma/schema.prisma:1833-1943` `WasteMovement`: `progressiveNumber`/`progressiveYear`,
  `registrationDate`, `movementDate`, `causale`, `causaleAziendaId`, `cerCode` "NN NN NN*",
  `quantity Decimal(10,2)`, `unit`, `wastePhysicalState`, `wasteHazardClasses` ("HP4,HP14"),
  `operationCode`, `firId`, `tipoAnnotazione` ORDINARIA/RETTIFICA/ANNULLAMENTO,
  `movimentoRettificatoId` (predecessore), `movimentoOriginaleId`, `motivoAnnotazione`.
  **Esiste già** `@@unique([id, registroId, tenantId, type], map: "waste_movements_id_registro_tenant_type_key")`
  (`:1932`, F2-3); **non** esiste `@@unique([id, tenantId])` (vedi M1).
- Correzioni: numerate come le ordinarie (`application/registro/numerazione-annotazione.ts`,
  stesso lock `<registro>-<anno>`); la rettifica ha `movementDate` corretta, l'annullamento la copia
  (`use-cases/correggi-movimento.use-case.ts`). `correggi-movimento` non sa nulla di RENTRI (grep
  `trasmess|rentri` vuoto).
- Vigenza: `src/domain/waste-movement/vigenza.ts:18-21` `WHERE_VIGENTE`, `:32-38` `sqlVigente`.
  Guardia dei lettori: `src/application/registro/lettori-movimenti.spec.ts` (`LETTORI`).
- Causali: `src/domain/waste-movement/catalogo-causali.ts:170-187`
  `CatalogoCausali.comportamento(verso, codice, giorno, versioneId?) → DefinizioneCausale | null`
  (con `codiceRentri`); caricamento `src/application/registro/causali/catalogo-causali.repository.ts:65`
  `caricaCatalogoCausali(db, tenantId)`. Seed: `prisma/migrations/20261030100000_causali_registro/migration.sql:94-119`.
- Giacenze iniziali: `GiacenzaIniziale.origini Json` = `[{ anno, protocollo, quantita? }]`
  (`schema.prisma:861-884`, commento "relazioni iniziali RENTRI, F2-9");
  `src/application/registro/aperture-registro.ts:35` `leggiApertureRegistro`.
- FIFO di F2-6: `src/domain/waste-movement/fifo-deposito.ts` (`calcolaFifo` `:149` con
  `abbinamenti` {scarico, carico, quantita}, `famigliaFifo` `:211`, `quantitaFifo` `:217`).
- Unità: `src/domain/waste-movement/unita-misura-registro.ts:18` `normalizzaUnitaRegistro`. CER:
  `src/domain/waste-movement/cer-registro.ts:9` `cerSoloCifre`.
- Ruoli: `src/api/registro/registro.controller.ts:74` `RUOLI_PROGRESSIVO_INIZIALE = ['SUPER_ADMIN','ADMIN']`,
  controllo con `this.membership.ruoloEffettivo(req.user, tenantId)` (`:400`, `:573`);
  `src/application/rentri/verifica-ruolo-scrittura-rentri.ts:17` `RUOLI_SCRITTURA_RENTRI`.
  Registri: `src/application/registro/registri.service.ts:276` `risolviInLettura`, `:20`
  `RegistroNonTrovatoError`.
- Elenco movimenti: `src/application/registro/queries/list-movimenti.handler.ts:20`
  `MovimentoListItem`, `:130` `include`.

**Mappatura RENTRI riusabile (FIR).** `src/application/rentri/mappatura/mappa-rifiuto.ts`:
`traduciStatoFisico` `:120` e `codiceEerRichiedeDescrizione` `:147` sono **privati** (fail-closed,
`ValoreNonTraducibilePerRentriError` `:56`); `mappa-parti.ts:187` `mappaProduttore(parte, risolutore)`
(`DatiProduttoreRentri` compatibile con `DatiProduttoreModel` del registro), `:50`
`DatoMancantePerRentriError`, `:35` `normalizzaNumeroIscrizioneAlbo` (privato);
`risolutore-comune-istat.ts:28` `RisolutoreComuneIstat`; `costruisci-payload-rentri.ts:121-140`
lettura delle parti del FIR dalle anagrafiche (`include: { ditta: true, sede: true }`). Il FIR ha
gli snapshot `producerCodiceFiscale`/`carrierCodiceFiscale`/`receiverCodiceFiscale`
(`schema.prisma:291-293`, NULL per i FIR precedenti a `20261031110200`), `producerId`/`carrierId`/
`receiverId`, `firNumber`, `rentriNumeroFir`, `transportDate`, `actualArrivalDate`,
`effectiveWeight`, `provenienza` (URBANO/SPECIALE). `Destinatario.numeroAutorizzazione`
(`schema.prisma:1311`).

**Job e contesto.** Modello di job cross-tenant: `src/infrastructure/jobs/rentri-rifornimento-scorta.job.ts`
(`PrismaSistemaService.tenant.findMany(escludiPiattaforma(...))`, `RentriCredentialResolver.haCredenziale`,
`TenantContext.run`, `segnalaErroreJob`). Stallo FIR: `SOGLIA_STALLO_RENTRI_MS = 15 min`
(`application/rentri/sync-fir-to-rentri.use-case.ts:29`). Modulo applicativo RENTRI:
`application/rentri/rentri-sync.module.ts`, importato in `app.module.ts:123`; `ScheduleModule.forRoot()`
`app.module.ts:76`. Guardia del tenant selezionato dei controller RENTRI:
`src/api/rentri/rentri-azienda-selezionata.controller.spec.ts`.

**RLS.** `rls-catalogo.postgres.spec.ts:64` `toBe(35)`; `README-tenant-transazione.md:120,143`
"(35)"/"35 tabelle"; `TENANT_SCOPED_MODELS` in `prisma-rls.extension.ts` (ultima voce
`SogliaDepositoTemporaneo`). Ultima migration `20261031110200_fir_parti_sede_cf`; `schema.prisma`
termina con `SogliaDepositoTemporaneo`. Forma della RLS: `20261028100000_giacenze_iniziali` sezione 4.

**Frontend.** `fe/features/registro/registro.component.ts` (2401 righe), `registro.service.ts`
(`RegistroVista` `:11`, `Movimento` `:27`, `listRegistri` `:191`); dialog amministrativo di
riferimento `giacenze-iniziali-dialog.component.ts`. E2E RENTRI con la fake:
`e2e/tests/rentri/scorta-blocchi.spec.ts`, `fake-disponibile.spec.ts`.

**WinWaste (da non ripetere).** `rentri.md` §5 e `rentri/03` §4: (1) polling della vidimazione con
`Task.Delay` non atteso; (2) esiti non letti (`303` di `/status` preso per successo); (3) un errore
tecnico nella lettura dell'esito trattato come rifiuto → si azzerano `GUIDTRANS` e flag di invio →
**ritrasmissione**; (4) del FIR si conserva solo una nota testuale; (5) payload completi (registri,
FIR, CF, targhe) copiati a un servizio del fornitore e il registro in chiaro a Zucchetti DigitalHub.

## Decisioni (vincolanti)

- **D1. Tabella `movimenti_trasmissione_rentri`** (modello `MovimentoTrasmissioneRentri`), enum
  `StatoTrasmissioneRentri` (`@@map("stato_trasmissione_rentri")`):
  `DA_TRASMETTERE`, `IN_INVIO` (prenotata, POST in corso), `ATTESA_ESITO` (transazione salvata),
  `TRASMESSA`, `RIFIUTATA` (esito letto, riga non registrata), `NON_TRASMISSIBILE` (traduzione
  fail-closed fallita), `INCERTA` (esito della POST sconosciuto), `GIA_SU_RENTRI` (dichiarata
  presente da altro programma o dal portale). Nessuna riga = **non trasmessa** (D3).
  Enum `OrigineTrasmissioneRentri` (`@@map("origine_trasmissione_rentri")`): `MANUALE`,
  `AUTOMATICA`, `CORREZIONE`, `DICHIARATA`.
  Colonne: `id uuid` default `gen_random_uuid()`; `tenant_id uuid NOT NULL`; `movimento_id`,
  `registro_id uuid NOT NULL`, `tipo waste_movement_type NOT NULL` (copie immutabili per la FK, M1);
  `stato` NOT NULL default `DA_TRASMETTERE`; `origine` NOT NULL; `bloccato_invio boolean NOT NULL
  default false`; `motivo_blocco varchar(500)`; `identificativo_rentri varchar(20)`; `transazione_id
  uuid`; `lotto_id uuid`; `prenotato_il timestamptz(3)`; `trasmesso_il timestamptz(3)`; `tentativi int
  NOT NULL default 0`; `ultimo_errore varchar(1000)`; `messaggi jsonb NOT NULL default '[]'`
  (solo i messaggi di validazione di RENTRI della riga: `{ campo, codice, tipo }`, **mai il corpo
  inviato**); `accodato_da uuid`; `created_at`, `updated_at`.
  Vincoli (nomi espliciti ≤ 63):
  - `movimenti_trasmissione_rentri_movimento_id_key` UNIQUE (`movimento_id`) — l'1:1;
  - `movimenti_trasmissione_rentri_id_tenant_id_key` UNIQUE (`id`, `tenant_id`);
  - indici `movimenti_trasmissione_rentri_tenant_id_idx` (`tenant_id`),
    `movimenti_trasmissione_rentri_registro_stato_idx` (`registro_id`, `stato`),
    `movimenti_trasmissione_rentri_transazione_id_idx` (`transazione_id`);
  - FK `movimenti_trasmissione_rentri_tenant_fkey` → `tenants` ON DELETE CASCADE;
  - FK composta `movimenti_trasmissione_rentri_movimento_fkey` (`movimento_id`, `registro_id`,
    `tenant_id`, `tipo`) → `waste_movements(id, registro_id, tenant_id, type)` ON DELETE NO ACTION;
  - CHECK `..._bloccato_coerente_check`: `stato NOT IN ('TRASMESSA','GIA_SU_RENTRI','INCERTA') OR bloccato_invio`;
  - CHECK `..._coda_sbloccata_check`: `stato <> 'DA_TRASMETTERE' OR NOT bloccato_invio`;
  - CHECK `..._motivo_blocco_check`: `NOT bloccato_invio OR motivo_blocco IS NOT NULL`;
  - CHECK `..._attesa_transazione_check`: `stato <> 'ATTESA_ESITO' OR transazione_id IS NOT NULL`;
  - CHECK `..._identificativo_check`: `identificativo_rentri IS NULL OR identificativo_rentri ~ '^M[0-9A-Z]{19}$'`.
  - **Trigger `movimenti_trasmissione_rentri_immutabile`** (BEFORE UPDATE): se `OLD.stato IN
    ('TRASMESSA','GIA_SU_RENTRI')` allora `NEW.stato`, `NEW.bloccato_invio`, `NEW.movimento_id`
    devono restare uguali e `NEW.identificativo_rentri` può solo passare da NULL a un valore;
    altrimenti `RAISE EXCEPTION ... USING ERRCODE = '23514'`. Sempre: `movimento_id`, `registro_id`,
    `tipo`, `tenant_id` immutabili.
  - **Trigger `movimenti_trasmissione_rentri_no_delete`** (BEFORE DELETE): se `OLD.stato NOT IN
    ('DA_TRASMETTERE','RIFIUTATA','NON_TRASMISSIBILE')` e `pg_trigger_depth() = 1` →
    eccezione. `pg_trigger_depth() > 1` è la cancellazione a cascata di un'azienda (azione RI), che
    deve passare. Commento nella migration che lo spiega.
  - RLS ENABLE + FORCE, `isolamento_azienda`, `sola_lettura TO wasteflow_lettura` (forma di
    `20261028100000_giacenze_iniziali` sez. 4). Nessun GRANT (default privileges).
- **D2. Colonne nuove su `registri_rifiuti`** (stessa migration, `SET LOCAL lock_timeout = '5s'`):
  `invio_rentri_automatico_dal timestamptz(3) NULL` (NULL = solo invio manuale); CHECK
  `registri_rifiuti_identificativo_rentri_check`: `identificativo_rentri IS NULL OR
  identificativo_rentri ~ '^R[0-9A-Z]{10}$'`; UNIQUE `registri_rifiuti_tenant_identificativo_rentri_key`
  (`tenant_id`, `identificativo_rentri`) (per azienda, non globale: un unico globale farebbe
  scoprire l'identificativo di un'altra azienda). La migration prima conta le righe con
  `identificativo_rentri` non NULL (`RAISE NOTICE`; oggi attese 0) e fallisce con messaggio chiaro se
  una non rispetta il formato.
- **D3. Nessun invio retroattivo.** La migration non crea righe. Un movimento senza riga è "non
  trasmesso" e non parte mai da solo. Una riga nasce solo da: (a) **invio manuale** (`MANUALE`);
  (b) **adozione automatica** del job per i movimenti con `created_at >= invio_rentri_automatico_dal`
  del loro registro (`AUTOMATICA`); attivare l'invio automatico imposta la data **a ora**, mai nel
  passato; (c) **correzione** di un'annotazione `TRASMESSA` o `GIA_SU_RENTRI` (`CORREZIONE`, D7);
  (d) **dichiarazione** "già su RENTRI" (`DICHIARATA`, D12). Lo storico si trasmette solo con
  l'azione esplicita "Trasmetti lo storico" (D12), con conferma.
- **D4. Traduzione pura e fail-closed** in `src/application/rentri/registro/mappa-registrazione-rentri.ts`:
  ```ts
  export interface ParteFirRentri { denominazione: string; codiceFiscale: string | null }
  export interface DatiFirPerRegistro {
    numeroFir: string | null                // rentriNumeroFir ?? firNumber
    dataInizioTrasporto: string | null      // ISO
    dataFineTrasporto: string | null        // ISO, actualArrivalDate
    pesoVerificatoDestinoKg: number | null  // effectiveWeight
    provenienza: 'U' | 'S' | null
    produttore: (ParteFirRentri & { indirizzo: IndirizzoRentri | null }) | null
    trasportatore: (ParteFirRentri & { numeroIscrizioneAlbo: string | null }) | null
    destinatario: (ParteFirRentri & { numeroAutorizzazione: string | null }) | null
  }
  export interface NumeroRegistrazione { anno: number; progressivo: number }
  export interface AnnotazionePerRentri {
    movimentoId: string
    tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
    numero: NumeroRegistrazione
    dataRegistrazione: string               // ISO UTC di registrationDate
    verso: 'CARICO' | 'SCARICO'
    codiceRentri: string | null             // da CatalogoCausali.comportamento
    cerCode: string; descrizione: string | null
    quantita: number; unit: string
    statoFisico: string | null; classiPericolo: string | null
    operazione: string | null               // operationCode
    predecessore: NumeroRegistrazione | null // rettificata o annullata
    motivo: string | null                   // motivoAnnotazione
    fir: DatiFirPerRegistro | null
    riferimentiCarico: NumeroRegistrazione[] // Task 4, solo SCARICO
  }
  export type EsitoTraduzione =
    | { ok: true; corpo: Record<string, unknown> }
    | { ok: false; motivi: string[] }       // italiano, senza CF né id
  export function traduciAnnotazione(a: AnnotazionePerRentri): EsitoTraduzione
  export function traduciClassiPericolo(valore: string | null): string[]   // lancia ValoreNonTraducibilePerRentriError
  export function traduciQuantita(q: number, unit: string): { valore: number; unita_misura: 'kg' | 'l' }
  ```
  Regole:
  - `ANNULLAMENTO` → `AnnullamentoMovimentoModel`: `numero_registrazione` = proprio numero,
    `data_ora_registrazione`, `numero_registrazione_annullata` = `predecessore`, `annotazioni` =
    `motivo` (1..500). Nient'altro.
  - `ORDINARIA`/`RETTIFICA` → `MovimentoModel`; nella `RETTIFICA` `riferimenti.numero_registrazione_rettifica`
    = `predecessore` (obbligatorio, altrimenti motivo "rettifica senza annotazione rettificata").
  - `codice_eer` = `cerSoloCifre(cerCode)`; `descrizione_eer` solo se `.99` (obbligatoria) ;
    `stato_fisico` con `traduciStatoFisico` (esportato da `mappa-rifiuto.ts`, Task 3);
    `caratteristiche_pericolo` da `wasteHazardClasses` (token separati da virgola, punto e virgola
    o spazi; `HP` + 1-2 cifre, 1..15 → `HP01`..`HP15`; token sconosciuto → motivo); CER con `*` e
    nessuna HP → motivo "rifiuto pericoloso senza caratteristiche di pericolo";
    `quantita` con `traduciQuantita` (Q10: KG/vuota → kg, T → kg ×1000, L → l, M3 → l ×1000, altro →
    motivo); valori a 4 decimali; `provenienza` dal FIR se c'è, altrimenti omessa;
    `destinato_attivita` = `operazione` normalizzata (`R1`..`R13`, `D1`..`D15`) solo per gli scarichi
    `aT` e `I`; valore fuori elenco → motivo.
  - **Parti per causale** (le altre proprietà si omettono: `additionalProperties: false`):

    | `codiceRentri` | Richiede | Compila |
    |---|---|---|
    | `DT`, `NP`, `RE` | — | `rifiuto` |
    | `I` | — | `rifiuto` (+ `destinato_attivita`) |
    | `T*` | FIR con produttore (CF e indirizzo) | `rifiuto`, `produttore`, `trasportatore` se c'è, `integrazione_fir` |
    | `aT` | FIR con destinatario (CF e `num_autorizzazione`) e trasportatore (CF) | `rifiuto`, `destinatario`, `trasportatore`, `integrazione_fir`, `esito` se il FIR ha peso o data di fine trasporto |
    | `M`, `TR`, `T*aT` | — | sempre motivo "causale RENTRI non supportata da questo programma" |
    | `null` | — | motivo di Q6 |

    `integrazione_fir` = `{ numero_fir (≤20), data_inizio_trasporto }`; `esito` =
    `{ data_fine_trasporto, peso_verificato_destino }` (respingimento fuori ambito);
    trasportatore `num_iscrizione_albo` solo se rispetta `^([A-Za-z]{2})/([0-9]{6})$`, altrimenti
    omesso (è facoltativo); verso incoerente con la causale (es. `aT` su un CARICO) → motivo.
  - `riferimento_operazione` = `riferimentiCarico` se non vuoto (solo SCARICO).
  - Tutti i motivi si raccolgono (non ci si ferma al primo), messaggi italiani senza CF, P.IVA né id.
- **D5. Lettura delle annotazioni** (`lettore-annotazioni-rentri.ts`, Task 6): per un elenco di
  movimenti dello stesso registro costruisce `AnnotazionePerRentri[]` con **tutte** le righe (ogni
  annotazione è una registrazione, anche se non più vigente). FIR letto per id con le stesse tabelle e
  lo stesso `include` di `costruisci-payload-rentri.ts:121-140`; codice fiscale = snapshot del FIR,
  se NULL quello della ditta dell'anagrafica; indirizzo del produttore con `mappaProduttore` e
  `RisolutoreComuneIstat` (`DatoMancantePerRentriError` → motivo). Causale con
  `caricaCatalogoCausali` una volta per lettura e `comportamento(verso, causale,
  giornoItaliano(movementDate), causaleAziendaId)`. Per i riferimenti di carico (D6) legge le
  vigenti del registro (`WHERE_VIGENTE`) e le aperture con `leggiApertureRegistro` (che dà `id`,
  CER, quantità, unità, data) più una `findMany` di `giacenzaIniziale` per `id` e `origini`
  (`ApertureRegistroRiga`, `aperture-registro.ts:5-16`, non ha le origini; il file non si cambia).
  `origini` malformate (non array di `{anno, protocollo}` interi) → nessun riferimento da
  quell'apertura, con un `logger.warn` senza dati.
- **D6. Riferimenti di carico (Q9)**, pura, `riferimenti-carico-rentri.ts`:
  `riferimentiCaricoPerScarichi(eventi: EventoFifo[], numeri: Map<string, NumeroRegistrazione>,
  originiAperture: Map<string, NumeroRegistrazione[]>): Map<string, NumeroRegistrazione[]>` (chiave
  = id dello scarico). Usa `calcolaFifo` per famiglia (`famigliaFifo`) e CER (`chiaveConfrontoCer`)
  sulle **vigenti** del registro più le aperture; un carico-movimento dà il suo numero, un'apertura
  dà le sue `origini` (`{anno, progressivo: protocollo}`; nessuna origine → niente), senza doppioni,
  in ordine (anno, progressivo). Lo scarico non vigente (rettificato) non riceve riferimenti.
- **D7. Correzioni (decisione 2026-10-24 "rettifica su anno trasmesso").** Una correzione di
  un'annotazione `TRASMESSA`/`GIA_SU_RENTRI` è adottata dal job con origine `CORREZIONE` (Q8). La
  risposta di `POST /registro/movimenti/:id/rettifica|annullamento` aggiunge
  `avvisoRentri: string | null`: "L'annotazione corretta era già su RENTRI: la correzione sarà
  trasmessa come rettifica." (oppure "... come annullamento"), `null` negli altri casi. Il use case
  `correggi-movimento` **non si tocca**: l'avviso lo calcola il controller dopo la correzione, con
  una lettura della riga del predecessore.
- **D8. Selezione del lotto** (pura, `selezione-lotto-rentri.ts`):
  `selezionaLotto(candidate: CandidataLotto[], massimo: number): { lotto: string[]; inAttesa: string[] }`
  con `CandidataLotto { movimentoId; numero; predecessoreId: string | null;
  statoPredecessore: StatoTrasmissioneRentri | 'NON_TRASMESSA' | null }`: ordine (anno,
  progressivo); una correzione entra solo se `statoPredecessore ∈ {TRASMESSA, GIA_SU_RENTRI}`,
  altrimenti `inAttesa` (resta `DA_TRASMETTERE`); al più `massimo` (costante `LOTTO_MASSIMO_RENTRI =
  100`, sotto il limite contrattuale di 1000). Le righe `NON_TRASMISSIBILE` non bloccano le
  successive (nessuna regola di contiguità: Q5/Q7 dicono di no).
- **D9. Esito** (puro, `esito-movimenti-rentri.ts`): `applicaEsito(lotto: Array<{ movimentoId;
  numero }>, esito: EsitoMovimentiRentri): EsitoPerRiga[]` con `EsitoPerRiga = { movimentoId;
  stato: 'TRASMESSA' | 'RIFIUTATA'; identificativo: string | null; messaggi: MessaggioRentri[] }`.
  Una riga è `TRASMESSA` se il suo (anno, progressivo) è in `esito.numero_registrazioni` (anche con
  `errore = true`, Q3); altrimenti `RIFIUTATA` con i messaggi il cui `indice` è la sua posizione nel
  lotto, più quelli senza `indice` (validi per tutto il lotto); senza messaggi suoi: "Rifiutata da
  RENTRI insieme alle altre annotazioni dello stesso invio". `errore = false` senza
  `numero_registrazioni` per una riga → `RIFIUTATA` con "RENTRI non ha confermato l'annotazione": mai
  `TRASMESSA` senza conferma (difetto WinWaste 2).
- **D10. Ciclo d'invio** (`TrasmettiLottoRegistroUseCase`, Task 8), stesso schema del FIR (piano B):
  1. **Prenotazione** in transazione nel contesto dell'azienda, sotto
     `pg_advisory_xact_lock(hashtext('rentri-registro|' || registro_id))`: se il registro ha righe
     `IN_INVIO` o `ATTESA_ESITO` → esce (`giaInCorso`); registro senza `identificativo_rentri` →
     esce; legge le `DA_TRASMETTERE` **con `bloccato_invio = false`**, traduce (D5, D4), mette in
     `NON_TRASMISSIBILE` (con i motivi in `ultimo_errore`) quelle che non si traducono, seleziona
     (D8) e porta le scelte in `IN_INVIO` con un `lotto_id` nuovo, `prenotato_il = now()`,
     `tentativi + 1`. L'UPDATE ha sempre `WHERE stato = 'DA_TRASMETTERE' AND bloccato_invio = false`.
  2. **Fuori transazione** ricostruisce i corpi delle righe del lotto (dagli stessi dati), POST con
     `inviaMovimenti` (Task 2). Risposta 202 con `transazione_id` → `ATTESA_ESITO` con
     `transazione_id` **prima** del polling. `TrasmissioneRentriIncertaError` (5xx, nessuna risposta,
     202 senza id) → `INCERTA`, `bloccato_invio`, motivo "Esito dell'invio sconosciuto: verificare
     prima di ritrasmettere". 400/403/404 (`RentriApiError` non ritentabile) → `RIFIUTATA` con
     `ultimo_errore` = titolo del problema (404: "Registro non trovato su RENTRI: controllare
     l'identificativo"). `TenantSenzaCertificatoRentriError` → righe tornano `DA_TRASMETTERE`, il
     registro si salta.
  3. **Polling** con `attendiEsito` (attende davvero, difetto WinWaste 1). Esito → `applicaEsito`
     (D9); `TRASMESSA` imposta `bloccato_invio = true`, `motivo_blocco = 'Trasmessa a RENTRI'`,
     `identificativo_rentri`, `trasmesso_il`. **Errore tecnico nel polling** (tentativi finiti, 5xx,
     403) → la riga **resta `ATTESA_ESITO`** con `ultimo_errore`, mai `DA_TRASMETTERE` (difetto
     WinWaste 3); `TransazioneRentriNonTrovataError` → `INCERTA`.
  4. **Ripresa** (`riprendiAttese`): per ogni `transazione_id` in `ATTESA_ESITO` rilegge l'esito
     (nessuna POST); dopo 7 giorni senza esito si fa un'ultima lettura: esito definitivo → applicato, altrimenti → `INCERTA`. Le `IN_INVIO` con `prenotato_il` più
     vecchio di `SOGLIA_STALLO_RENTRI_MS` e senza `transazione_id` → `INCERTA` (POST forse partita).
- **D11. Verifica di un'annotazione incerta** (`VerificaTrasmissioneRentriUseCase`): solo su
  `INCERTA` o `ATTESA_ESITO`. Con `transazione_id` rilegge prima l'esito (come D10.4). Altrimenti
  `dettaglioMovimentoPerAnnoProgressivo(identificativo_registro, anno, progressivo)`: trovata e
  coincide (`codice_eer`, quantità e unità, `causale_operazione`; per l'annullamento
  `annullato`/numero) → `TRASMESSA` con l'identificativo; trovata e diversa → resta `INCERTA`,
  motivo "Il numero è occupato su RENTRI da un'altra registrazione: controllare il portale" (mai
  sovrascritta); `RentriApiError` 404 → `DA_TRASMETTERE` (sblocca, `bloccato_invio = false`) con
  audit. È l'**unica** via automatica per togliere `bloccato_invio` e vale solo per `INCERTA`.
- **D12. Azioni manuali** (`AccodaTrasmissioneRentriUseCase`):
  - `accoda(tenantId, utenteId, registroId, movimentoIds)` (1..1000 id del registro): crea la riga
    `DA_TRASMETTERE`/`MANUALE` per i movimenti senza riga; riporta a `DA_TRASMETTERE` le
    `RIFIUTATA`/`NON_TRASMISSIBILE`; **salta** tutte le altre (contate in `saltate` con il motivo).
    Accoda anche i predecessori non trasmessi delle correzioni scelte (catena intera, D8 li ordina).
  - `accodaStorico(tenantId, utenteId, registroId, anno)`: come sopra per tutti i movimenti
    dell'anno senza riga; serve `conferma: true` nel corpo.
  - `togliDallaCoda(tenantId, utenteId, movimentoId)`: cancella la riga solo se `DA_TRASMETTERE`
    (`deleteMany({ where: { id, tenantId, stato: 'DA_TRASMETTERE' } })` con id esatto); altrimenti 409.
  - `dichiaraGiaSuRentri(tenantId, utenteId, registroId, anno, daProgressivo, aProgressivo, motivo)`
    (ADMIN): per chi arriva da un altro programma che ha già trasmesso (WinWaste, Fase 3): righe
    `GIA_SU_RENTRI`/`DICHIARATA`, bloccate, `motivo_blocco` = motivo; solo su movimenti senza riga o
    `RIFIUTATA`/`NON_TRASMISSIBILE`; intervallo massimo 10.000.
  - Ogni azione scrive `activityLog` nella stessa transazione (`RENTRI_REGISTRO_ACCODATI`,
    `RENTRI_REGISTRO_TOLTO_DALLA_CODA`, `RENTRI_REGISTRO_DICHIARATI`, `RENTRI_REGISTRO_VERIFICATA`),
    metadata con conteggi e id dei movimenti, mai il corpo.
  - Dopo `accoda`/`accodaStorico` il controller avvia `TrasmettiLottoRegistroUseCase` per quel
    registro senza attendere (`void ... .catch(log + segnalaErroreJob)`), e risponde 202.
- **D13. Impostazioni del registro** (`ImpostazioniRentriRegistroService`): `leggi(tenantId)` per
  ogni registro: `identificativoRentri`, `invioAutomatico` (bool) e `invioAutomaticoDal`, conteggi
  per stato e "non trasmessi" (movimenti senza riga), `haCertificato`; `imposta(tenantId, utenteId,
  registroId, { identificativoRentri, invioAutomatico })` (ADMIN): formato `^R[0-9A-Z]{10}$` (400 con
  messaggio); **cambiare o togliere** l'identificativo con righe del registro in `IN_INVIO`,
  `ATTESA_ESITO`, `INCERTA`, `TRASMESSA` → 409 "Il registro ha già annotazioni trasmesse con questo
  identificativo"; `invioAutomatico` da false a true imposta `invio_rentri_automatico_dal = now()`,
  da true a false lo azzera, true → true non lo tocca; serve l'identificativo per attivarlo.
  `allineamento(tenantId, registroId, anno)`: `{ locali: count movimenti del registro e anno,
  trasmessi: count TRASMESSA+GIA_SU_RENTRI, suRentri: contaMovimenti(identificativo, { anno }) }`
  (una chiamata, solo a richiesta). Audit `RENTRI_REGISTRO_IMPOSTAZIONI` con prima/dopo.
- **D14. Job** `RentriRegistroTrasmissioneJob` (`src/infrastructure/jobs/rentri-registro-trasmissione.job.ts`),
  `@Cron(CronExpression.EVERY_10_MINUTES)`, struttura di `rentri-rifornimento-scorta.job.ts`. Per
  ogni azienda con certificato, nel suo contesto: (1) stalli `IN_INVIO` → `INCERTA`; (2)
  `riprendiAttese`; (3) adozione: movimenti senza riga dei registri con `invio_rentri_automatico_dal`
  e `created_at >= dal` (`AUTOMATICA`), correzioni il cui predecessore ha riga
  `TRASMESSA`/`GIA_SU_RENTRI` (`CORREZIONE`), al più 1000 per giro; (4) un lotto per registro con
  identificativo. Un errore su un registro o un'azienda non ferma gli altri (`segnalaErroreJob`).
  Guardia: un flag in memoria evita due giri sovrapposti nello stesso processo; fra processi basta
  la prenotazione di D10.1.
- **D15. Riservatezza.** Il corpo inviato **non si salva** e **non si logga** (né in `activityLog`,
  né in `RENTRISyncLog`, né nei log: solo id, conteggi, `transazione_id`, stato). Nessun servizio
  terzo: solo RENTRI (difetto WinWaste 5). Messaggi all'utente senza CF, P.IVA, id di tenant.

**Deviazioni dalla roadmap (motivate).**
- **M1.** La roadmap chiede `@@unique([id, tenantId])` su `WasteMovement`. Non serve: la FK composta
  usa l'unico già esistente `waste_movements_id_registro_tenant_type_key` di F2-3, portando
  `registro_id` e `tipo` sulla riga di trasmissione. Vantaggi: **nessun indice nuovo sulla tabella
  calda** `waste_movements` (nessun lock), e il registro della riga coincide per costruzione con
  quello del movimento.
- **M2.** "Le righe dei movimenti già presenti nascono con stato non trasmesso": realizzato come
  **assenza di riga** (D3), quindi la migration non fa backfill (coerente con "Migration dati: solo
  una tabella nuova, vuota").
- **M3.** La giacenza iniziale non è una registrazione RENTRI (non ha numero): non si trasmette come
  `stoccaggio_istantaneo`; le sue `origini` diventano riferimenti di carico (D6, Q9).

## Vincoli globali (per ogni task)

- Commit con percorsi espliciti `git commit -m "…" -- <file…>`, messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né altro). Niente push. Commenti in italiano, termini
  tecnici non tradotti.
- **Database di test di questo worktree: container `wasteflow-pg-test-registro` su
  `127.0.0.1:55438`.** Mai le porte degli altri worktree (55432, 55434, 55436, 55440, 55442,
  55444). Macchina Linux: **niente `DOCKER_HOST`**. In ogni shell:
  ```bash
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di **ogni** suite Postgres
  `[[ "$DATABASE_URL" == *":55438/"* ]] || { echo "DATABASE_URL non punta a 55438: fermo"; exit 1; }`.
- Prisma solo dal pacchetto (`npx prisma --version` → 5.22.x); `npx prisma generate` dopo ogni
  modifica dello schema.
- Test Postgres col ruolo **`wasteflow_app`** (modello `registro-per-sede.postgres.spec.ts`:
  `creaPrismaServiceApplicativo()`, `TenantContext.run`), lanciati con
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  **Pulizia solo per id esatti creati**: `const tenantCreati: string[] = []`, ogni azienda creata vi
  si aggiunge, `afterAll` cancella con `{ id: { in: tenantCreati } }` e **non fa nulla se la lista è
  vuota**. **Mai `deleteMany` con un filtro che può essere `undefined`.** Fixture con P.IVA valide
  (`partitaIvaValida(seme)`, `src/test-support/anagrafiche-di-test.ts:25`) e controparti con
  `creaDittaConRuolo` (`:81`).
- Azienda sempre da `requireRequestTenantId(req)`; ruolo effettivo con
  `this.membership.ruoloEffettivo(req.user, tenantId)` come `registro.controller.ts:400`.
- **RAM:** jest mirato con `npx jest -w 2 <percorsi>`; a fine task backend una volta `npm run
  test:cov` (`NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod`, già `--runInBand`),
  `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da
  `apps/backend` (0 errori), le suite Postgres toccate più `rls-catalogo.postgres.spec.ts` e
  `lettori-vigenti.postgres.spec.ts`. Durante il lavoro lint solo dei file toccati, mai `--fix`.
  Karma **una volta** a fine task frontend. Un solo processo pesante alla volta.
- **Migration:** cartella `20261101100000_trasmissione_registro_rentri` (prefisso `202611011000`,
  assegnato per non collidere con i pezzi in parallelo); additiva; `SET LOCAL lock_timeout = '5s'`
  prima di toccare `registri_rifiuti`; nomi di vincoli e indici ≤ 63 caratteri **uguali in schema e
  SQL** (`map:` espliciti); RLS ENABLE + FORCE + `isolamento_azienda` + `sola_lettura`; modello in
  `TENANT_SCOPED_MODELS`; `rls-catalogo.postgres.spec.ts` **35 → 36** e `README-tenant-transazione.md`
  aggiornato; ripristino scritto in `ops/README.md`. Verifiche: `npx prisma validate`, `migrate deploy`
  su 55438, `migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma
  --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/shadow_f29?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-registro psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_f29"` / `"DROP DATABASE shadow_f29"`) → vuoto (o solo le
  note preesistenti di master: pgcrypto, default di `notifications.expires_at`). In `schema.prisma`
  enum e modello nuovi **in coda**, relazioni inverse in fondo a `Tenant` e `WasteMovement`.
  **Convivenza:** se nel rebase master ha già una migration con timestamp successivo, si rinomina la
  cartella con un timestamp successivo a quella (mai applicata in produzione) e si aggiornano i
  riferimenti; i conteggi RLS si sommano.
- **Aree escluse:** nessun UPDATE né DELETE su `waste_movements`; nessuna modifica a
  `application/registro/use-cases/**`, `application/fir/**`, `api/fir/**`, `application/mud/**`
  (F2-8 sta arrivando), `sync-fir-to-rentri.use-case.ts`, `costruisci-payload-rentri.ts` (si legge,
  non si cambia). Unica eccezione in `mappatura/`: l'`export` di due funzioni private (Task 3). Se un
  task scopre di dover toccare altro, si ferma e lo segnala.
- Messaggi all'utente in italiano, senza id né dati fiscali; mai un CF nei log, nell'audit, nei
  `RAISE`, nelle query string.
- Task frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`, `npm
  run build`, dalla root `npx eslint <file toccati>`. E2E: lint di `e2e/**/*.ts`; esecuzione solo
  nel Task 13.

## Review focus

Cinque condizioni che nessun task "naturale" metterebbe alla prova; ognuna ha il suo test nel task
indicato.

1. **POST con esito incerto (5xx, timeout, 202 senza id)** → la riga diventa `INCERTA` e nessun
   giro, né il job né "Trasmetti", la rimanda (Task 2, Task 8, Task 10).
2. **Errore tecnico nel leggere l'esito** → la riga resta `ATTESA_ESITO` con la transazione; il giro
   successivo rilegge senza POST (Task 8: `"un errore nel polling lascia ATTESA_ESITO e il giro dopo non fa POST"`).
3. **Due giri contemporanei sullo stesso registro** (job + clic) → una sola POST (Task 7:
   `"due prenotazioni concorrenti: una sola ottiene il lotto"`).
4. **Cambio d'identificativo dopo una trasmissione** → 409; con sole righe `RIFIUTATA` è consentito
   (Task 9).
5. **Azienda cancellata con righe `TRASMESSA`** → la cascata passa, la DELETE diretta no (Task 1).

---

## Task 0: ambiente e linea di base

**File:** nessuno.

- [ ] Creare il container se manca (`docker ps -a --filter name=wasteflow-pg-test-registro`):
  ```bash
  docker run -d --name wasteflow-pg-test-registro -p 127.0.0.1:55438:5432 \
    -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci \
    -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine
  ```
  altrimenti `docker start wasteflow-pg-test-registro`.
- [ ] Variabili dei vincoli globali; `cd apps/backend && npm ci` solo se `node_modules` manca;
  `npx prisma migrate deploy` (allineato a `20261031110200_fir_parti_sede_cf`), `npx prisma generate`;
  dalla root `PG_EXEC="docker exec -i wasteflow-pg-test-registro" bash ops/db-ruoli.sh wasteflow_ci`;
  `cd apps/backend && npx ts-node prisma/seed.ts` (catalogo CER).
- [ ] Linea di base: `npm run test:cov`, `rls-catalogo.postgres.spec.ts` (35),
  `lettori-vigenti.postgres.spec.ts`, `rentri-registri.oracolo.spec.ts`. Annotare nel rapporto i test
  già rossi su master (non si aggiustano qui).

## Task 1: schema, migration, RLS e trigger

**Dipende da 0.** **File:** `prisma/schema.prisma`;
`prisma/migrations/20261101100000_trasmissione_registro_rentri/migration.sql` (nuovo);
`src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS` + commento);
`src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (35 → 36);
`src/infrastructure/persistence/README-tenant-transazione.md` ("(35)" → 36 e la tabella nell'elenco);
`ops/README.md` (sezione "F2-9 trasmissione del registro a RENTRI");
`src/application/rentri/registro/trasmissione-rentri.schema.postgres.spec.ts` (nuovo).

**Interfacce prodotte:** modello `MovimentoTrasmissioneRentri`, enum `StatoTrasmissioneRentri`,
`OrigineTrasmissioneRentri`; `RegistroRifiuti.invioRentriAutomaticoDal`; relazioni inverse
`WasteMovement.trasmissioneRentri MovimentoTrasmissioneRentri?` e
`Tenant.trasmissioniRentri MovimentoTrasmissioneRentri[]`.

- [ ] Schema (D1, D2): in Prisma la relazione `movimento WasteMovement @relation(fields: [movimentoId,
  registroId, tenantId, tipo], references: [id, registroId, tenantId, type], onDelete: NoAction,
  onUpdate: NoAction, map: "movimenti_trasmissione_rentri_movimento_fkey")`; tutti gli unici e
  indici con `map:` uguali alla migration; `@db.Timestamptz(3)` per le date; `@@unique([tenantId,
  identificativoRentri], map: "registri_rifiuti_tenant_identificativo_rentri_key")` su
  `RegistroRifiuti`. Commenti `///` (nessuna riga = non trasmesso; il corpo non si salva; trigger
  fuori da Prisma).
- [ ] Migration, in quest'ordine: commento di testa (cosa, perché, additiva, ripristino a mano:
  `DROP TABLE movimenti_trasmissione_rentri; DROP TYPE stato_trasmissione_rentri, origine_trasmissione_rentri;
  ALTER TABLE registri_rifiuti DROP CONSTRAINT ..., DROP COLUMN invio_rentri_automatico_dal;` e
  la riga da togliere da `_prisma_migrations`); enum; `SET LOCAL lock_timeout = '5s'`; controllo e
  NOTICE di D2, CHECK, unico e colonna su `registri_rifiuti`; tabella con CHECK; unici e indici; FK;
  le due funzioni e i due trigger; RLS.
- [ ] `ops/README.md`: rollback del codice innocuo (tabella ignorata); prima del rollback
  `SELECT stato, count(*) FROM movimenti_trasmissione_rentri GROUP BY 1` e avvisare che lo stato
  delle trasmissioni non sarà più visibile; **mai** cancellare righe `TRASMESSA` per "ripartire" (si
  ritrasmetterebbe); il ripristino a mano è solo per un database senza trasmissioni.
- [ ] Test Postgres (ruolo app, `tenantCreati`), nomi:
  - `"inserisce una riga DA_TRASMETTERE nel contesto dell'azienda"`;
  - `"seconda riga per lo stesso movimento: violazione dell'unico 1:1"`;
  - `"registro o tipo diversi da quelli del movimento: violazione della FK composta"`;
  - un test per CHECK (`bloccato_coerente`, `coda_sbloccata`, `motivo_blocco`, `attesa_transazione`,
    `identificativo`), il nome del vincolo nell'errore;
  - `"una riga TRASMESSA non torna DA_TRASMETTERE né si sblocca"` e `"l'identificativo di una TRASMESSA passa solo da NULL a valore"`;
  - `"DELETE diretto di una TRASMESSA rifiutato, di una DA_TRASMETTERE consentito"`;
  - `"cancellare l'azienda (proprietario) cancella anche le righe TRASMESSA"` (Review focus 5);
  - `"identificativo del registro fuori formato rifiutato; uguale in due aziende consentito; doppio nella stessa azienda rifiutato"`;
  - `"con il contesto di B le righe di A non si vedono né si aggiornano"`; `rls-catalogo` a 36.
- [ ] Verifiche Prisma dei vincoli globali; `prisma-rls.extension.spec.ts` verde.
- [ ] Commit: `feat(rentri-registro): tabella movimenti_trasmissione_rentri con RLS e trigger di immutabilità`.

## Task 2: client del registro, invio non idempotente, registrazione nel modulo

**Dipende da 0.** **File:** `src/infrastructure/rentri/rentri-registri.client.ts`;
`src/infrastructure/rentri/rentri-registri.client.spec.ts` (nuovo, HttpService finto);
`src/infrastructure/rentri/rentri-registri.oracolo.spec.ts`; `src/infrastructure/rentri/rentri.module.ts`;
`src/infrastructure/rentri/rentri.module.spec.ts`.

**Interfacce prodotte:**
```ts
inviaMovimenti(identificativoRegistro: string, movimenti: Array<Record<string, unknown>>,
  tenantId: string): Promise<{ transazioneId: string }>
attendiEsitoMovimenti(transazioneId: string, tenantId: string,
  opzioni?: { intervalloMs?: number; maxTentativi?: number }): Promise<EsitoMovimentiRentri>
export interface MessaggioRentri { indice: number | null; campo: string | null;
  tipo: 'Errore' | 'Avvertimento'; codice: string | null }
export interface EsitoMovimentiRentri { errore: boolean; validazione: MessaggioRentri[];
  numeroRegistrazioni: Array<{ anno: number; progressivo: number; identificativo: string | null }> }
```
(Il parametro `opzioni.replyTo` sparisce: nessun chiamante e nessuna callback pubblica.)

- [ ] Test unitari: `"5xx sulla POST: nessun secondo tentativo e TrasmissioneRentriIncertaError HTTP_5XX"`;
  `"nessuna risposta: TrasmissioneRentriIncertaError NESSUNA_RISPOSTA"`; `"202 senza transazione_id:
  RISPOSTA_SENZA_TRANSAZIONE"`; `"429 con Retry-After: ritenta e poi riesce"` (non elaborata,
  ritentare è sicuro); `"400 e 404: RentriApiError non ritentabile"`; `"la POST acquisisce e rilascia
  il permesso del rate limiter anche in errore"`; `"status 404 della transazione:
  TransazioneRentriNonTrovataError"`; `"attendiEsitoMovimenti attende l'intervallo fra due /status"`
  (fake timers: due chiamate a `/status` distanziate da `intervalloMs`, difetto WinWaste 1);
  `"303 senza /result leggibile non è un successo"`.
- [ ] Implementare: `inviaMovimenti` come `creaFormulario` (`rentri-api.client.ts:157-175`):
  rate limiter, nessun ritentativo su 5xx/risposta assente, riuso di
  `TrasmissioneRentriIncertaError`/`TransazioneRentriNonTrovataError` (importati da
  `rentri-api.client.ts`, non duplicati); `attendiEsitoMovimenti` = `attendiEsito` + parsing tipato
  (campi assenti → `[]`/`null`, `errore` assente → `true`, prudente). `attendiEsito` resta per
  `validaRegistro`.
- [ ] Oracolo: `"invio, polling e lettura degli identificativi contro la fake"` (registrazioni con
  `identificativo` `^M[0-9A-Z]{19}$`); `"esito con errore: numeroRegistrazioni vuoto e messaggi con indice"`.
- [ ] `RentriModule`: `RentriRegistriClient` in providers ed exports; `rentri.module.spec.ts` risolve
  il provider.
- [ ] Commit: `feat(rentri-registro): client dati-registri senza ritentativi sulla POST, esito tipato, registrato nel modulo`.

## Task 3: traduzione pura dell'annotazione

**Dipende da 0.** **File:** `src/application/rentri/registro/mappa-registrazione-rentri.ts` (nuovo) +
`.spec.ts`; `src/application/rentri/mappatura/mappa-rifiuto.ts` (solo `export` di
`traduciStatoFisico` e `codiceEerRichiedeDescrizione`, nessun cambio di comportamento).

**Interfacce prodotte:** tutto D4.

- [ ] Test (ogni corpo `ok` passa `validaElencoMovimenti([corpo])` di
  `tools/rentri-fake/src/dominio/movimento.ts`, richiesto con `require` come
  `costruisci-payload-rentri.spec.ts:135`):
  - `"DT: solo riferimenti e rifiuto, codice_eer a 6 cifre"` (`'15 01 01'` → `'150101'`);
  - `"T*: produttore, trasportatore e integrazione_fir dal FIR"`;
  - `"aT: destinatario con num_autorizzazione, trasportatore, integrazione_fir, esito col peso"`;
  - `"aT senza FIR: non trasmissibile, motivo che nomina il FIR"`;
  - `"RETTIFICA porta numero_registrazione_rettifica del predecessore"`;
  - `"ANNULLAMENTO diventa AnnullamentoMovimentoModel con il motivo nelle annotazioni"`;
  - `"causale senza codice RENTRI: messaggio di Q6"`; `"M, TR, T*aT: non supportate"`;
    `"aT su un CARICO: incoerente"`;
  - `"HP4,HP14 → HP04 HP14"`, `"HP 7; hp15"`, `"HP16 e XY: non traducibili"`;
    `"CER pericoloso senza HP: motivo"`;
  - quantità: `"1,5 t → 1500 kg"`, `"200 L → 200 l"`, `"2 M3 → 2000 l"`, `"PZ: non traducibile"`;
  - `"stato fisico Gassoso: non traducibile"` (come il FIR); `"CER .99 senza descrizione: motivo"`;
  - `"operazione R13 su aT diventa destinato_attivita; R99 no"`;
  - `"num_iscrizione_albo fuori formato omesso, non rifiutato"`;
  - `"più problemi: tutti i motivi insieme, nessun codice fiscale nei messaggi"`;
  - `"scarico con riferimentiCarico: riferimento_operazione in ordine"`.
- [ ] Implementare D4 (tabella delle parti come costante, non `switch` sparsi).
- [ ] Commit: `feat(rentri-registro): traduzione pura fail-closed delle annotazioni nel modello RENTRI`.

## Task 4: riferimenti di carico dal FIFO

**Dipende da 3 (`NumeroRegistrazione`).** **File:** `src/application/rentri/registro/riferimenti-carico-rentri.ts`
(nuovo) + `.spec.ts`.

**Interfacce prodotte:** `riferimentiCaricoPerScarichi` (D6).

- [ ] Test: `"scarico che consuma due carichi: due riferimenti in ordine"`; `"scarico coperto da
  un'apertura con due origini: le due origini"`; `"apertura senza origini: nessun riferimento"`;
  `"kg e litri dello stesso CER non si mescolano"`; `"CER con e senza asterisco: stesso insieme"`;
  `"nessun doppione se lo stesso carico copre due parti dello scarico"`; `"scarico scoperto: solo i
  riferimenti della parte coperta"`.
- [ ] Implementare con `calcolaFifo`/`famigliaFifo`/`quantitaFifo` e `chiaveConfrontoCer`; nessun
  accesso al database.
- [ ] Commit: `feat(rentri-registro): riferimenti ai carichi degli scarichi dal FIFO, con le relazioni iniziali`.

## Task 5: selezione del lotto e lettura dell'esito

**Dipende da 2 (`EsitoMovimentiRentri`) e 3.** **File:** `src/application/rentri/registro/selezione-lotto-rentri.ts`,
`esito-movimenti-rentri.ts` (nuovi) + `.spec.ts`.

**Interfacce prodotte:** `selezionaLotto`, `LOTTO_MASSIMO_RENTRI = 100` (D8); `applicaEsito`,
`EsitoPerRiga` (D9).

- [ ] Test `selezionaLotto`: ordine (anno, progressivo) anche fra due anni; `"rettifica col
  predecessore TRASMESSA entra"`; `"rettifica col predecessore nello stesso lotto o DA_TRASMETTERE
  resta in attesa"` (Q7); `"predecessore GIA_SU_RENTRI vale come trasmesso"`; limite a 100.
- [ ] Test `applicaEsito`: `"errore false con tutti i numeri: tutte TRASMESSA con identificativo"`;
  `"errore true con un numero confermato: quella TRASMESSA, le altre RIFIUTATA"` (Q3);
  `"messaggi per indice alla riga giusta, messaggi senza indice a tutte"`; `"errore false senza
  conferma di una riga: RIFIUTATA, mai TRASMESSA"`; `"numero confermato che non è nel lotto: ignorato e segnalato"`.
- [ ] Commit: `feat(rentri-registro): selezione del lotto e lettura dell'esito per annotazione`.

## Task 6: lettore delle annotazioni

**Dipende da 1, 3, 4.** **File:** `src/application/rentri/registro/lettore-annotazioni-rentri.ts`
(nuovo) + `.spec.ts` + `.postgres.spec.ts`; `src/application/registro/lettori-movimenti.spec.ts`
(voce nuova in `LETTORI`, scelta `'tutte'`, motivo "ogni annotazione è una registrazione RENTRI;
i riferimenti di carico usano le vigenti").

**Interfacce prodotte:**
```ts
@Injectable() export class LettoreAnnotazioniRentri {
  leggi(tx: Prisma.TransactionClient, tenantId: string, registroId: string,
        movimentoIds: string[]): Promise<AnnotazionePerRentri[]>
}
```

- [ ] Test unitari (Prisma finto): causale aziendale risolta con la versione; predecessore letto col
  suo numero; FIR con snapshot CF usato prima dell'anagrafica; comune non risolto → il FIR passa
  `produttore: null` e la traduzione lo segnala; movimento di un altro registro nell'elenco → `Error`
  (programmazione).
- [ ] Test Postgres (ruolo app): registro con carico DT, scarico aT con FIR (controparti con
  `creaDittaConRuolo`), rettifica dello scarico; la lettura dà tre annotazioni, tutte traducibili
  (`traduciAnnotazione(...).ok`), riferimenti di carico sulla rettifica e non sull'originale;
  contesto di B → nessuna annotazione.
- [ ] Commit: `feat(rentri-registro): lettura delle annotazioni da trasmettere con FIR, causali e riferimenti`.

## Task 7: repository delle trasmissioni

**Dipende da 1, 5.** **File:** `src/application/rentri/registro/trasmissioni-registro.repository.ts`
(nuovo) + `.postgres.spec.ts`.

**Interfacce prodotte** (tutti i metodi nel contesto del tenant, `tx` dove indicato):
```ts
prenota(tenantId, registroId, prepara: (tx, candidate) => Promise<{ lotto: string[];
  nonTrasmissibili: Array<{ movimentoId: string; motivi: string[] }> }>)
  : Promise<{ esito: 'PRENOTATO'; lottoId: string; movimentoIds: string[] } | { esito: 'GIA_IN_CORSO' | 'NIENTE' | 'SENZA_IDENTIFICATIVO' }>
salvaTransazione(tenantId, lottoId, transazioneId): Promise<void>      // IN_INVIO → ATTESA_ESITO
segnaIncerte(tenantId, lottoId | { transazioneId }, motivo): Promise<number>
segnaRifiutate(tenantId, lottoId, errore: string): Promise<number>
applicaEsiti(tenantId, transazioneId, esiti: EsitoPerRiga[]): Promise<void>
annotaErrorePolling(tenantId, transazioneId, errore): Promise<void>
ripristinaPrenotazione(tenantId, lottoId): Promise<void>               // certificato mancante
stalliInInvio(tenantId, prima: Date): Promise<number>                  // → INCERTA
transazioniInAttesa(tenantId): Promise<Array<{ transazioneId: string; registroId: string; dal: Date }>>
adottaAutomatiche(tenantId, limite): Promise<number>
adottaCorrezioni(tenantId, limite): Promise<number>
```
Ogni UPDATE porta lo stato di partenza nel `WHERE` (`IN_INVIO`, `ATTESA_ESITO`, …): una riga che nel
frattempo ha cambiato stato non si tocca. `prenota` fa D10.1 sotto l'advisory lock.

- [ ] Test Postgres:
  - `"due prenotazioni concorrenti: una sola ottiene il lotto"` (`Promise.all`, Review focus 3);
  - `"registro con una ATTESA_ESITO: GIA_IN_CORSO"`;
  - `"le righe bloccate e quelle TRASMESSA non entrano mai nel lotto"`;
  - `"applicaEsiti: TRASMESSA bloccata con identificativo; RIFIUTATA sbloccata"`;
  - `"stalliInInvio: IN_INVIO vecchia senza transazione diventa INCERTA; con transazione no"`;
  - `"adottaAutomatiche: solo movimenti creati dopo invio_rentri_automatico_dal, registro senza data nessuno"` (D3);
  - `"adottaCorrezioni: rettifica di una TRASMESSA adottata, di una RIFIUTATA no"`;
  - `"nessuna riga di un'altra azienda toccata"`.
- [ ] Commit: `feat(rentri-registro): repository delle trasmissioni con prenotazione per registro`.

## Task 8: ciclo d'invio e ripresa

**Dipende da 2, 5, 6, 7.** **File:** `src/application/rentri/registro/trasmetti-lotto-registro.use-case.ts`
(nuovo) + `.spec.ts` + `trasmetti-lotto-registro.oracolo.postgres.spec.ts` (fake in-process +
Postgres; se il runner Postgres non vede `tools/`, lo spec unitario usa la fake e il Postgres usa il
client finto: dirlo nel rapporto).

**Interfacce prodotte:**
```ts
trasmettiRegistro(tenantId: string, registroId: string): Promise<EsitoGiroRegistro>
riprendiAttese(tenantId: string): Promise<{ riletti: number; incerte: number }>
export interface EsitoGiroRegistro { esito: 'NIENTE' | 'GIA_IN_CORSO' | 'SENZA_IDENTIFICATIVO'
  | 'SENZA_CERTIFICATO' | 'INVIATO' | 'INCERTO' | 'RIFIUTATO'; trasmesse: number; rifiutate: number;
  nonTrasmissibili: number; inAttesa: number /* candidate oltre il lotto */;
  attesaEsito: number /* righe del lotto ancora in ATTESA_ESITO */ }
export const ETA_MASSIMA_ATTESA_ESITO_MS = 7 * 24 * 60 * 60 * 1000
```

- [ ] Test unitari (client finto): ordine delle scritture (`salvaTransazione` **prima** di
  `attendiEsitoMovimenti`); `"TrasmissioneRentriIncertaError: INCERTA e nessuna seconda POST"`;
  `"un errore nel polling lascia ATTESA_ESITO e il giro dopo non fa POST"` (Review focus 2: il
  secondo `trasmettiRegistro` risponde `GIA_IN_CORSO`, `riprendiAttese` rilegge e chiude);
  `"404 della transazione: INCERTA"`; `"400 della POST: RIFIUTATA con il titolo"`; `"senza
  certificato: prenotazione ripristinata"`; `"ATTESA_ESITO oltre 7 giorni: INCERTA"`;
  `"nessun log contiene il corpo"` (spia sul logger: nessun argomento con `codice_eer`);
  `"le righe NON_TRASMISSIBILE ricevono i motivi e non vanno nella POST"`.
- [ ] Test oracolo: invio di tre annotazioni → `TRASMESSA` con gli identificativi della fake; fake che
  completa con `errore: true` → `RIFIUTATA`; **ritrasmissione impossibile**: dopo il successo un
  secondo `trasmettiRegistro` → `NIENTE` e la fake non riceve una seconda POST (conteggio dalle sue
  transazioni con `ultimaTransazioneId`).
- [ ] Commit: `feat(rentri-registro): ciclo d'invio con transazione salvata prima del polling e ripresa degli esiti`.

## Task 9: azioni manuali, verifica e impostazioni del registro

**Dipende da 7, 8.** **File:** `src/application/rentri/registro/accoda-trasmissione-rentri.use-case.ts`,
`verifica-trasmissione-rentri.use-case.ts`, `impostazioni-rentri-registro.service.ts` (nuovi) +
`.spec.ts` + `azioni-rentri-registro.postgres.spec.ts`.

**Interfacce prodotte:** D11, D12, D13, con errori di dominio (`DomainError`):
`TrasmissioneNonModificabileError` (409), `IdentificativoRegistroNonValidoError` (400),
`IdentificativoGiaUsatoError` (409), `RegistroNonTrovatoError` riusato (404).

- [ ] Test (unitari + Postgres):
  - `accoda`: `"movimenti senza riga: DA_TRASMETTERE MANUALE"`; `"RIFIUTATA torna DA_TRASMETTERE"`;
    `"TRASMESSA, GIA_SU_RENTRI, INCERTA, IN_INVIO, ATTESA_ESITO saltate e contate"` (non-trasmissione
    sull'invio manuale); `"movimento di un altro registro o azienda: 404"`; `"accoda i predecessori
    non trasmessi della correzione"`;
  - `accodaStorico`: `"senza conferma: 400"`; `"solo l'anno indicato, solo movimenti senza riga"`;
  - `togliDallaCoda`: `"DA_TRASMETTERE cancellata; TRASMESSA: 409 e riga intatta"`;
  - `dichiaraGiaSuRentri`: `"intervallo: righe GIA_SU_RENTRI bloccate col motivo; TRASMESSA già presente non toccata"`;
  - verifica: `"INCERTA trovata e uguale su RENTRI: TRASMESSA"`; `"trovata diversa: resta INCERTA col
    motivo"`; `"404: torna DA_TRASMETTERE e sbloccata, con audit"`; `"su una TRASMESSA: 409, nessuna chiamata a RENTRI"`;
  - impostazioni: `"formato errato: 400"`; `"cambio con righe TRASMESSA: 409"` e `"con sole RIFIUTATA:
    consentito"` (Review focus 4); `"attivare l'automatico imposta la data a ora, riattivarlo non la
    sposta"`; `"automatico senza identificativo: 400"`; `allineamento` con `contaMovimenti` finto;
  - audit nella stessa transazione per ogni azione.
- [ ] Commit: `feat(rentri-registro): invio manuale, storico, verifica delle incerte e impostazioni del registro`.

## Task 10: job e modulo

**Dipende da 8, 9.** **File:** `src/infrastructure/jobs/rentri-registro-trasmissione.job.ts` (nuovo) +
`.spec.ts`; `src/application/rentri/registro/registro-rentri.module.ts` (nuovo) + `.spec.ts`;
`src/app.module.ts` (import del modulo).

- [ ] Modulo: `imports: [PrismaModule, LoggerModule, MetricsModule, RentriModule, AuthModule,
  RuoloEffettivoModule]`; providers dei Task 6-9 e del job; exports `AccodaTrasmissioneRentriUseCase`,
  `TrasmettiLottoRegistroUseCase` (li useranno le Fasi 3-4). Lo spec compila il modulo (come
  `rentri-sync.module.spec.ts`).
- [ ] Job (D14). Test: `"azienda senza certificato saltata senza segnalazione"`; `"errore su un
  registro: gli altri proseguono"`; `"giro sovrapposto nello stesso processo: il secondo esce"`;
  ordine stalli → ripresa → adozione → invio; **non-trasmissione sul job**: `"righe bloccate, INCERTA,
  TRASMESSA e movimenti senza riga di un registro manuale non producono POST"` (client finto, zero
  chiamate a `inviaMovimenti`); `"piattaforma esclusa"` (`escludiPiattaforma`).
- [ ] Commit: `feat(rentri-registro): job di invio del registro ogni 10 minuti e modulo`.

## Task 11: API

**Dipende da 10.** **File:** `src/api/rentri/rentri-registro.controller.ts` (nuovo) + `.spec.ts`;
`src/api/rentri/dto/rentri-registro.dto.ts` (nuovo); `src/api/rentri/rentri-azienda-selezionata.controller.spec.ts`
(caso nuovo); `src/application/rentri/registro/registro-rentri.module.ts` (controller);
`src/api/registro/registro.controller.ts` (solo `avvisoRentri` nelle risposte di rettifica e
annullamento, D7) + spec; `src/application/registro/queries/list-movimenti.handler.ts` (+ spec):
`MovimentoListItem.trasmissioneRentri: { stato, identificativo, motivo } | null` via `include`.

Rotte (tutte `JwtAuthGuard`, azienda da `requireRequestTenantId`):

| Metodo e percorso | Ruolo | Corpo / risposta |
|---|---|---|
| `GET /rentri/registro/registri` | lettura | D13 `leggi`, con `puoConfigurare` e `puoTrasmettere` |
| `PUT /rentri/registro/registri/:registroId` | ADMIN | `{ identificativoRentri: string \| null, invioAutomatico: boolean }` |
| `GET /rentri/registro/registri/:registroId/allineamento?anno=` | lettura | D13 |
| `POST /rentri/registro/trasmetti` | `RUOLI_SCRITTURA_RENTRI` | `{ registroId, movimentoIds: string[] (1..1000, UUID) }` → 202 `{ accodate, saltate: [{ motivo, numero }] }` |
| `POST /rentri/registro/trasmetti-storico` | ADMIN | `{ registroId, anno, conferma: true }` → 202 |
| `DELETE /rentri/registro/movimenti/:movimentoId/coda` | `RUOLI_SCRITTURA_RENTRI` | 204 / 409 |
| `POST /rentri/registro/movimenti/:movimentoId/verifica` | `RUOLI_SCRITTURA_RENTRI` | stato aggiornato |
| `POST /rentri/registro/dichiara-gia-trasmessi` | ADMIN | `{ registroId, anno, daProgressivo, aProgressivo, motivo (1..500) }` |
| `GET /rentri/registro/movimenti/:movimentoId` | lettura | `{ stato, origine, identificativo, motivoBlocco, ultimoErrore, messaggi, trasmessoIl }` |

- [ ] Test: ruoli (OPERATOR non configura, VIEWER non trasmette: 403); errori di dominio → 400/404/409
  con messaggi senza id; `trasmetti` risponde prima che finisca l'invio e l'avvio asincrono è
  chiamato una volta; azienda selezionata ≠ azienda del token (caso nello spec condiviso);
  `avvisoRentri` valorizzato solo se il predecessore è `TRASMESSA`/`GIA_SU_RENTRI`; elenco movimenti
  con `trasmissioneRentri` null per un movimento senza riga.
- [ ] Commit: `feat(rentri-registro): API di trasmissione, verifica e impostazioni del registro`.

## Task 12: frontend

**Dipende da 11.** **File:** `fe/features/registro/rentri-registro.service.ts` (nuovo) + spec;
`fe/features/registro/rentri-registro-pannello.component.ts` (nuovo) + spec;
`fe/features/registro/rentri-registro-impostazioni-dialog.component.ts` (nuovo) + spec;
`fe/features/registro/stato-rentri.ts` (nuovo, etichette e severità) + spec;
`fe/features/registro/registro.service.ts` (campo `trasmissioneRentri` su `Movimento`, `avvisoRentri`
su `EsitoCorrezioneMovimento`); `fe/features/registro/registro.component.ts` (solo: il pannello sopra
la tabella, la colonna "RENTRI", la selezione multipla per "Trasmetti", il toast di `avvisoRentri`).

- [ ] Pannello per il registro selezionato: identificativo (o "Registro non collegato a RENTRI:
  inserisci l'identificativo preso dal portale" con il bottone per l'ADMIN), modalità
  manuale/automatica dal giorno, conteggi per stato, "Trasmetti selezionati", "Trasmetti lo storico
  dell'anno…" (dialog di conferma che dice quante annotazioni partiranno e che non si possono
  ritirare), "Verifica allineamento" (D13), nota di Q1.
- [ ] Colonna "RENTRI": tag con etichetta italiana (`Da trasmettere`, `In invio`, `In attesa
  dell'esito`, `Trasmessa`, `Rifiutata`, `Non trasmissibile`, `Esito incerto`, `Già su RENTRI`,
  vuoto = `Non trasmessa`), tooltip con motivo o messaggi; azioni per riga: "Verifica" su
  incerta/in attesa, "Togli dalla coda" su da trasmettere, "Trasmetti di nuovo" su
  rifiutata/non trasmissibile. Le righe bloccate non sono selezionabili per "Trasmetti".
- [ ] Dialog impostazioni (ADMIN): identificativo con validazione `^R[0-9A-Z]{10}$`, interruttore
  "Trasmetti automaticamente le nuove annotazioni da oggi" con testo che dice che lo storico non
  parte; "Dichiara già trasmesse" (anno, da, a, motivo).
- [ ] Test Karma: etichette di tutti gli stati; checkbox disabilitata sulle bloccate; dialog storico
  con il numero giusto; 409 dell'impostazione mostrato come messaggio; toast di `avvisoRentri`.
- [ ] Commit: `feat(rentri-registro): pagina del registro con stato RENTRI, invio e impostazioni`.

## Task 13: e2e e chiusura

**Dipende da 12.** **File:** `e2e/tests/rentri/registro-trasmissione.spec.ts` (nuovo);
`ops/README.md` (note di rilascio F2-9).

- [ ] E2E sulla fake (modello `e2e/tests/rentri/scorta-blocchi.spec.ts`): apertura del registro
  sulla fake (`/__controllo/dati-registri/registro`), impostazione dell'identificativo, carico DT,
  "Trasmetti", completamento della transazione dal canale di controllo, attesa del giro (o "Verifica")
  → tag "Trasmessa"; checkbox della riga disabilitata. Si esegue una volta a mano con lo stack di
  test se la RAM lo permette, altrimenti lint e segnalazione nel rapporto.
- [ ] Note di rilascio in `ops/README.md`: nessun invio parte dopo il deploy (nessuna riga); per
  attivarlo serve l'identificativo dal portale; chi arriva da WinWaste deve prima "Dichiarare già
  trasmesse" le annotazioni inviate dall'altro programma; controllo post-deploy `SELECT stato,
  count(*) FROM movimenti_trasmissione_rentri GROUP BY 1` (atteso vuoto) e log del job.
- [ ] Verifica finale: `npm run test:cov`, `tsc`, eslint backend globale 0 errori, `npm run
  test:postgres` intero, Karma, `npm run build` del frontend. Rapporto con le domande Q1-Q10 ancora
  aperte.
- [ ] Commit: `test(rentri-registro): e2e della trasmissione sulla fake e note di rilascio`.

## Ordine

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13. I task 2, 3, 4 hanno file disgiunti ma
restano in serie (vincolo RAM e un solo database).

## Fuori ambito (seguiti)

- Respingimento nell'`esito` (`DatiRespingimentoModel`), materiali (`M`), intermediari (`TR`),
  carico-e-scarico (`T*aT`): gestori, Fase 4.
- Firma e conservazione dell'XML del registro (`validaRegistro`, catena di digest di WinWaste): pezzo
  a sé.
- Variante `/soggetto-delegato/...` (consulente che trasmette per conto dei clienti): Fase 4,
  insieme ai gruppi.
- Callback `X-ReplyTo` (servirebbe un endpoint pubblico).
- Import delle registrazioni da RENTRI (WinWaste `FrmImportRenRegistrazioni`): Fase 3.
- Scadenze di trasmissione (Q2) e controllo dell'obbligo per categoria (Q1).
- Abbinamento manuale carichi-scarichi (4.6): sostituirà la proposta FIFO di D6.
