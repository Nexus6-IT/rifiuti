# Fase 4 pezzo 4: valorizzazione per periodo ed export — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo; ondate come nella sezione "Ondate". Passi con checkbox (`- [ ]`). Tre pezzi in
> sequenza (4.4a → 4.4b → 4.4c), ciascuno con la propria PR, rilasciabile da solo. Nessun task del
> pezzo N+1 parte prima del merge del pezzo N, salvo il Task 14 (modelli del frontend), che fissa i
> nomi per il backend della 4.4b. La 4.4d (Zucchetti) è solo un segnaposto.

**Goal.** Dai legami `CONFERMATO` della 4.3 produrre fatture numerate senza buchi per registro IVA e
anno, immutabili, valide contro l'XSD FatturaPA, esportabili in CSV, XML e TeamSystem, con annullo
dell'ultimo numero, nota di credito di storno e lista degli scostamenti.

**Architecture.** Calcolo in dominio puro (`src/domain/fatturazione/`), senza database. Il servizio
legge, chiama il calcolo e scrive (`src/application/fatturazione/`). Anteprima e definitiva sono job
BullMQ per tenant nella coda `fatturazione`. La definitiva è **una** transazione che numera, marca i
legami `FATTURATO` e scrive i marcatori. Bozze e definitivi stanno nella stessa tabella. Un trigger
rende immutabili i documenti non in bozza. API nel modulo `src/api/fatturazione/`.

**Tech Stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE) + BullMQ 5; `xmllint-wasm`
(dipendenza nuova, Task 16) per l'XSD; `pdfmake` 0.2 (già presente) per il PDF; Angular 17 +
PrimeNG 17.18; jest, Karma, Playwright (solo in CI).

**Spec.** `docs/superpowers/specs/2026-11-05-fase4-4-valorizzazione-export-design.md`. Le decisioni
1-12 del §19 sono vincolanti; le scelte S1-S21 valgono come accettate. Modello di formato:
`docs/superpowers/plans/2026-11-03-fase4-3-legame-movimento.md`. Lezioni: `.superpowers/sdd/2026-11-03-fase4-3/progress.md`,
`4-3c-report.md`, `review-finale-4-3b.md`. Percorsi relativi a `apps/backend/` salvo
`fe/` = `apps/frontend/src/app/` ed `e2e/` alla radice.

**Scelte di piano** (P1-P5, da confermare in revisione, nessuna cambia la spec):
- **P1.** `numerazioni_fattura` ha in più `data_partenza date null`. Il `PUT` del numero di partenza
  la scrive insieme a `ultima_data`. Serve al §5.5 passo 5: dopo l'annullo dell'unico definitivo di
  WasteFlow, `ultima_data` torna a `data_partenza`. Senza la colonna quel valore si perde.
- **P2.** Rate: quota = `netto / n` troncata al centesimo (`ROUND_DOWN`), resto sull'ultima rata. Così
  la regola «il resto sull'ultima» (§6.11) dà sempre un resto ≥ 0.
- **P3.** Test basato su proprietà con un generatore con seme fisso in `src/test-support/` (nessuna
  dipendenza nuova come `fast-check`).
- **P4.** I tracciati TeamSystem (`cTeamSystemRec1/2`) **non** sono in `contabilita.md` campo per
  campo: il §8 cita solo i nomi. Il Task 30 li ricostruisce prima dall'installer WinWaste con
  l'agente REA (memoria `feedback-rea-feature-agente-parallelo`) in
  `winwaste/docs/export-teamsystem-tracciato.md`.
- **P5.** Il Task 14 (modelli e servizio HTTP del frontend) apre la 4.4b. I nomi dei suoi tipi sono
  il contratto dei DTO del backend: lezione della 4.3, Task 25.
- **P6.** Lo storno copia le righe dell'origine con i loro tipi: l'XML del TD04 ha le stesse linee.
  Il tipo riga `STORNO` resta nell'enum per le note libere (fuori dalla prima uscita) e nella 4.4 non
  si scrive.
- **P7.** Codici HTTP che la spec non nomina e il piano aggiunge: 409 `NESSUN_DOCUMENTO_DEFINIBILE`,
  `DOPPIA_FATTURAZIONE` (violazione dell'unico dei marcatori, §4.7), `PARTENZA_NON_MODIFICABILE`,
  `SUFFISSO_NON_MODIFICABILE` (§4.10), `SCOSTAMENTO_NON_APERTO`; 400 `PERIODO_NON_VALIDO`,
  `DATA_FUTURA`, `CONFERMA_EMISSIONE_RICHIESTA`, `ADATTATORE_SCONOSCIUTO`. Tetto di 5000 documenti per
  export (400 `TROPPI_DOCUMENTI`).

## Global Constraints

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano, **nessuna
  attribuzione AI** (né `Co-Authored-By` né `Claude-Session`; la regola di Graziano prevale su ogni
  suggerimento dell'ambiente). Niente push dai task.
- Commenti e testi in italiano; termini tecnici non tradotti (branch, commit, deploy, test, build,
  database, backup, container, log, worker, queue, job, cache, rollback, merge, migration, RLS,
  tenant, lock, trigger, savepoint). Messaggi all'utente senza id né dati personali.
- Azienda sempre da `requireRequestTenantId(req)`; `@Roles` esplicito su **ogni** rotta;
  `controller-tenant-selezionato.spec.ts` e `nessun-user-userid.spec.ts` verdi. Ruoli:
  `RUOLI_LETTURA`, `RUOLI_SCRITTURA`, `RUOLI_AMMINISTRATORI` da `src/api/legami-movimento/ruoli.ts`,
  riesportati in `src/api/fatturazione/ruoli.ts`. Tabella dei permessi: spec §12.
- **Nessuna colonna, nessun UPDATE/INSERT/DELETE su `waste_movements`.** `guardia-registro.spec.ts`
  si estende a `src/application/fatturazione/**` (Task 17).
- La 4.4 **non prende mai** il lock del registro, il lock consultivo per radice o
  `impostazioni_fatturazione FOR UPDATE` (S5). Ordine dei lock (spec §8), mai invertito:
  `elaborazione FOR UPDATE → numerazioni FOR UPDATE per registro_iva_id → contratti FOR SHARE per id
  → elenchi FOR SHARE per id → righe di listino FOR SHARE per id (bloccaListinoInCondivisione) →
  testate e righe dei legami FOR UPDATE per id (bloccaRigheLegame) → marcatori INSERT/DELETE →
  documenti in BOZZA FOR UPDATE`. Annullo e storno: `numerazioni → documento DEFINITIVO → testate e
  righe dei legami → marcatori DELETE`. `contatori_file_fatturapa FOR UPDATE` da solo, in una
  transazione che non prende altro.
- Importi con `Prisma.Decimal` o stringhe decimali, mai `number`. Nell'API stringhe col punto.
  `importoRiga`, `scontoCascata`, `arrotonda2` (`src/domain/listino/importi-riga.ts:83,72,23`),
  `applicaScaglioni`, `validaPrezzoSpeciale` (`prezzo-speciale.ts:288,173`), `scadenzeNelPeriodo`,
  `periodoCompetenza` (`scadenze-fisse.ts:257,229`), `periodoDaFatturare`
  (`periodi-fatturazione.ts:148`), `destinatarioEffettivo`, `contoCorrenteEffettivo`
  (`regole-contratto-cliente.ts:619,642`), `improntaVariazione` (`variazione-prezzi.ts:180`) si
  riusano, non si riscrivono.
- **Liste di id (lezione 4.3b I1 e seguiti B I1):** `joinLineari(tx)` + `JOIN unnest($1::uuid[])`
  solo per una lista data. `= ANY($1::uuid[])` per letture mirate. Nessuna query che legge l'intero
  tenant gira dopo `joinLineari`. `SET LOCAL enable_nestloop` va ripristinato (`current_setting`
  letto prima) appena finita la query a lista. Vietati i cicli di UPDATE singoli: si usa
  `UPDATE … FROM unnest(...)`.
- Scritture interattive: `impostaTimeoutLock(tx)` per prima, `OPZIONI_TRANSAZIONE_SCRITTURA`.
  55P03, P2028 e 40P01 diventano 409 `OPERAZIONE_CONCORRENTE` (`traduciErrorePrisma`). Definitiva:
  `lock_timeout` 5 s, `timeout` della transazione 120 s, `statement_timeout` 60 s
  (`OPZIONI_TRANSAZIONE_DEFINITIVA`, Task 19).
- **Query paginate:** ogni DTO di lista ha `@Max(100)` su `dimensione` (come `ElencoClientiQueryDto`).
  Il frontend non chiede mai più di 100 (lezione 4.3c I6: dimensione 200 → 400 silenzioso). Le
  ricerche di clienti e contratti nei filtri sono lato server, con dimensione 25.
- **Campi numerici modificabili in UI:** virgola decimale, punto vietato con «Usa la virgola per i
  decimali», niente separatore delle migliaia, direttiva `appNumeroIt`
  (`fe/shared/directives/numero-it.directive.ts`) e `leggiNumero`, `formatNumero`,
  `validatoreNumero` (`fe/shared/utils/numero-modificabile.ts`). Numeri in sola lettura con `it-IT`.
  Mai parser nuovi.
- **Date in UI:** `p-calendar` con `[maxDate]` riceve la **fine del giorno** ricalcolata a ogni
  apertura del dialog, mai un `new Date()` del costruttore: PrimeNG confronta l'istante e svuota il
  valore (lezione dei seguiti C della 4.3).
- Pagine nuove con la classe `pagina-lavoro`, tema «Foglio salvia».
- **Nomi dei DTO:** i tipi di `fe/features/fatturazione/fatturazione.model.ts` (Task 14) sono il
  contratto. Il backend li segue nei DTO di risposta e di richiesta. Un nome diverso si cambia nel
  modello del frontend con un commit separato, citato nel rapporto del task.
- Database di test: `wasteflow-pg-test-registro` su `127.0.0.1:55438` (in CI `55432`, `wasteflow_ci`:
  le guardie di porta accettano le due); test Postgres col ruolo `wasteflow_app`; **pulizia solo per
  id esatti** (`pulisciTenantDiTest` di `src/test-support/legami-di-test.ts`, id raccolti in
  `tenantCreati`). Vietato cancellare per nome, per prefisso o per ora di creazione. Le fixture di
  volume si puliscono a blocchi e reggono un `afterAll` interrotto. **Un solo processo pesante alla
  volta**: `flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-05-fase4-4/pesante.lock <cmd>`.
- Barriere nei test di concorrenza: `pg_stat_activity` con `application_name` del processo e
  `wait_event_type = 'Lock'` (modello `elenchi-addebiti.service.postgres.spec.ts:18-20,613-626`),
  mai `sleep`. Piano generico: `ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`,
  ripristinato in `finally` (modello `variazioni-prezzi.service.postgres.spec.ts:761-778`).
- e2e Playwright su un'**azienda di test propria** (`creaAziendaDiTest`, `tokenAzienda`,
  `accediUiComeAzienda` di `e2e/utils/azienda-di-test.ts`; decisione 23 della 4.3), mai su
  «Azienda Test SRL». Retry sul 429 già in `e2e/utils/api-client.ts`.
- Fine task backend: `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run test:cov`
  (una volta), `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings=-1`
  da `apps/backend` con 0 errori, suite Postgres toccate più `rls-catalogo.postgres.spec.ts` (**67**
  prima del Task 6, **76** dopo, **77** dopo il Task 29). Task frontend: Karma una volta
  (`cd apps/frontend && CHROME_BIN=… npx ng test --watch=false --browsers=ChromeHeadless`),
  `npm run build`, eslint dalla radice sui file toccati. Mai Karma e jest insieme.
- Migration: `20261105100000_fatturazione_modello` (4.4a) e `20261106100000_fatturazione_mappature`
  (4.4c). L'ultima su master è `20261104100000_legami_avvisi_e_causali`. `SET LOCAL lock_timeout = '5s';`
  in testa; additive (tabelle e colonne nuove, unici, FK e CHECK `NOT VALID` + `VALIDATE`).
  Eccezioni dichiarate: i trigger del §4.12 e gli indici unici parziali (clausola solo in SQL).
  Nessun `DROP`. Nomi ≤ 63 caratteri, uguali in schema e SQL. Ogni migration: `prisma validate`,
  `migrate deploy` su 55438, `ops/db-ruoli.sh`, `migrate diff` vuoto, rollback in `ops/README.md`.
- Audit in `activity_log` per avvio, definitiva, annullo, storno, presa d'atto, export, numero di
  partenza, cedente, emissione, mappature: solo id, numeri e importi.
- Valori della spec da non reinterpretare:
  - stati elaborazione `IN_CODA, IN_CORSO, ANTEPRIMA_PRONTA, IN_DEFINITIVA, DEFINITIVA, FALLITA, SCARTATA`;
    stati documento `BOZZA, DEFINITIVO, ANNULLATO`; tipi `TD01, TD04, TD24`; raggruppamento
    `PER_CONTRATTO, PER_ELENCO`;
  - tipi riga `MOVIMENTO, FASCIA_SPECIALE, FISSO, MINIMO, SPESA_INCASSO, BOLLO, STORNO`; marcatori
    `SCADENZA_FISSO, PERIODO_CANONE, CONGUAGLIO, ACCONTO_FATTURATO, ACCONTO_DETRATTO`;
    `chiave_competenza` `AAAA-MM-GG` o `AAAA-MM-GG/AAAA-MM-GG`;
  - errori generali `CEDENTE_INCOMPLETO, DATA_ANTERIORE_ULTIMA_FATTURA, DATA_FUTURA, LEGAMI_SENZA_CONTRATTO`;
  - errori del documento `CONTRATTO_SOSPESO, SENZA_REGISTRO_IVA, CLIENTE_SENZA_DATI_FISCALI,
    SEDE_CLIENTE_INCOMPLETA, DATI_PA_INCOMPLETI, SENZA_CONDIZIONE_PAGAMENTO, PAGAMENTO_SENZA_BANCA,
    PAGAMENTO_NON_AMMESSO, SPESA_SENZA_CODICE_IVA, RIGA_LEGAME_INCOMPLETA, FAMIGLIA_NON_CALCOLATA,
    PREZZO_SPECIALE_NON_VALIDO, UM_NON_UNIVOCA, CANONE_PERIODO_SOVRAPPOSTO, NATURA_NON_AMMESSA,
    IMPORTI_NON_COERENTI, TOTALE_NON_POSITIVO, RITENUTA_NON_GESTITA` (18);
  - avvisi `MOVIMENTI_DA_COLLEGARE_ESCLUSI, MOVIMENTI_SOSPESI, ARRETRATI_PRESENTI, BOLLO_NON_ADDEBITATO,
    DESTINATARIO_ASSENTE, FPA_DA_FIRMARE, DATA_OLTRE_TERMINE_DIFFERITA` (7);
  - errori HTTP `ANTEPRIMA_SUPERATA, ELABORAZIONE_GIA_IN_DEFINITIVA, ELABORAZIONE_IN_CORSO,
    TROPPI_DOCUMENTI, ANNULLO_NON_AMMESSO, STORNO_GIA_PRESENTE, XML_NON_VALIDO, MAPPATURE_MANCANTI,
    VERSIONE_SUPERATA, OPERAZIONE_CONCORRENTE` nella forma `{ error, message, details? }` (dettagli
    numerici in `details`, mai al primo livello);
  - tetto della definitiva 500 documenti (400 `TROPPI_DOCUMENTI`); `motivo` di annullo e storno e
    `nota` della presa d'atto da 1 a 200 caratteri dopo trim; bollo dovuto oltre `77.47`, importo
    `2.00`; nature soggette a bollo `N1, N2.1, N2.2, N3.5, N3.6, N4`; nature vietate `N2, N3, N6`;
    arretrati dei fissi al più 12 mesi; pulizia delle bozze dopo 7 giorni (`SCARTATA`, `FALLITA`) e
    30 (`ANTEPRIMA_PRONTA`); tentativi del job: `anteprima` 2, `definitiva` 1;
  - XML: `FPR12` con codice destinatario di 7 caratteri, `FPA12` con 6; `PECDestinatario` solo con
    `0000000`; `Causale` a blocchi di 200; `RiferimentoNormativo` ≤ 100; `progressivo_file` base 36
    su 5 caratteri; nome file `IT<partita IVA>_<progressivo_file>.xml`;
  - CSV: ZIP con `testate.csv` e `righe.csv`, UTF-8 con BOM, `;`, decimali con la virgola, date
    `gg/mm/aaaa`, ogni cella fra virgolette con i doppi apici raddoppiati.

- **Interruttore delle definitive (decisione 13 della spec):** colonna additiva `definitive_attive boolean NOT NULL DEFAULT false` sulla tabella delle impostazioni di fatturazione dell'azienda, nella migration della 4.4a (Task con la migration). La definitiva (Task 19) risponde 409 `DEFINITIVE_NON_ATTIVE` se è falsa, senza toccare numerazione né legami (test). Anteprime e CSV non dipendono dall'interruttore. Rotta ADMIN per accenderla e interruttore nella UI delle impostazioni nella 4.4c, con l'avviso del gate (commercialista, decisione 14). Nessuno la accende in produzione prima del rilascio della 4.4c.
- **TeamSystem non verificato (decisione 15):** l'export TeamSystem mostra in UI e nel rapporto «tracciato non verificato su un'installazione reale».

## Review Focus

I cinque casi che la spec implica e che nessun test della spec copre. Ciascuno ha il suo test nel
task indicato.

1. **Doppio download XML in parallelo** (due amministratori, stesso documento non ancora generato):
   un solo `progressivo_file` consumato, stessi byte e stesso `xml_sha256` alle due risposte, un solo
   audit di emissione → Task 23.
2. **Definitiva senza documenti da numerare** (tutti esclusi, o tutti con errori): 409
   `NESSUN_DOCUMENTO_DEFINIBILE`, nessun numero consumato, l'elaborazione resta `ANTEPRIMA_PRONTA` →
   Task 19.
3. **Data documento vicino alla mezzanotte e a cavallo d'anno:** «oggi» alle 00:30 ora italiana
   (23:30 UTC del giorno prima) non è `DATA_FUTURA`; una data del 2 gennaio numera l'anno nuovo da
   `numero_partenza + 1`, anche se il registro ha definitivi a dicembre → Task 18 (data) e Task 8
   (anno).
4. **Contratto allegato con registro IVA, condizione di pagamento o esigibilità diversi dal
   principale:** il documento usa i valori del principale, le righe dell'allegato confluiscono, e il
   documento ha un solo riepilogo per aliquota → Task 17.
5. **Storno con data documento anteriore all'`ultima_data` del registro o futura:** 409
   `DATA_ANTERIORE_ULTIMA_FATTURA` o 400 `DATA_FUTURA`, nulla scritto, legami invariati → Task 20.

## Mappa dei file

Nuovi (backend):
- `src/domain/fatturazione/{codici,tipi,costanti-fiscali,righe-movimento,righe-fisse,minimi,iva-bollo,pagamento,tipo-documento,controlli-sdi,calcola-documento,impronta,scostamento}.ts` (+ spec);
- `src/domain/fatturazione/xml/{normalizza-testo,serializza-fattura}.ts` (+ spec);
- `src/infrastructure/fatturapa/{valida-xsd.ts,xsd/}`;
- `src/application/fatturazione/{cedente.service,numerazione,numerazioni.service,suffisso-registro,lock-fatturazione,selezione-fatturazione,elaborazioni.service,anteprima,definitiva,annullo-storno.service,scostamenti.service,manutenzione-fatturazione,xml-documento.service,export-csv,export.service,pdf-cortesia}.ts` (+ spec);
- `src/application/fatturazione/adattatori/{adattatore-export-contabile,registro-adattatori,mappature.service,teamsystem.adattatore}.ts`;
- `src/infrastructure/queue/jobs/fatturazione.job.ts`;
- `src/api/fatturazione/{fatturazione.module,ruoli,cedente.controller,numerazioni.controller,elaborazioni.controller,documenti-fattura.controller,scostamenti.controller,export-contabile.controller}.ts` + `dto/`;
- `src/test-support/{fatturazione-di-test,generatore-casuale}.ts`.

Nuovi (frontend): `fe/features/fatturazione/*`. Modificati: nei singoli task.

## Task 0: ambiente e linea di base

**File:** nessuno (verifica). Backend/Postgres.

- [ ] **Step 1: ambiente.** Worktree da `origin/master` (`8e991f87` o successivo), container
  `wasteflow-pg-test-registro` acceso, `rls-catalogo` a 67, cartella
  `.superpowers/sdd/2026-11-05-fase4-4/` con `pesante.lock` e `progress.md`, `npx prisma --version`
  → 5.22.x. Aziende di volume rimaste dalla 4.3 nel DB locale: elencarle per id nel rapporto, non
  cancellarle senza l'elenco degli id.
- [ ] **Step 2: linea di base** sotto `flock`: `test:cov`, `tsc`, `rls-catalogo.postgres.spec.ts` (67),
  le suite Postgres di `src/application/legami-movimento/`, `elenchi-addebiti`, `righe-addebito`,
  `codici-iva`, `spese-accessorie`, `registri-iva`. Test già rossi in `base-4-4.md` della cartella.

---

# Pezzo 4.4a — modello, numerazione, cedente e motore di calcolo

Rilascio senza cambiare il comportamento: nessun documento si crea ancora.

## Task 1: codici, tipi e costanti fiscali (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/codici.ts`, `tipi.ts`, `costanti-fiscali.ts`, `codici.spec.ts`, `costanti-fiscali.spec.ts`

**Interfaces:**
- Produces:
```ts
// codici.ts — insiemi chiusi con i valori dei Global Constraints
export const STATI_ELABORAZIONE, STATI_DOCUMENTO, TIPI_DOCUMENTO, RAGGRUPPAMENTI, TIPI_RIGA_DOCUMENTO, TIPI_MARCATORE: readonly [...] as const
export const ERRORI_GENERALI, ERRORI_DOCUMENTO, AVVISI_DOCUMENTO: readonly [...] as const
export type StatoElaborazione, StatoDocumento, TipoDocumento, TipoRigaDocumento, TipoMarcatore, ErroreGenerale, ErroreDocumento, AvvisoDocumento
export const MESSAGGI_ERRORE: Readonly<Record<ErroreGenerale | ErroreDocumento, string>>
export const MESSAGGI_AVVISO: Readonly<Record<AvvisoDocumento, string>>
export interface Segnalazione<C extends string> { codice: C; dettaglio?: string }   // dettaglio senza id né dati personali
export function validaTestoBreve(testo: unknown): { ok: true; valore: string } | { ok: false; errore: string }  // 1-200 dopo trim
export const TETTO_DOCUMENTI_DEFINITIVA = 500
// costanti-fiscali.ts
export const SOGLIA_BOLLO = '77.47'
export const NATURE_SOGGETTE_BOLLO: readonly string[]       // N1, N2.1, N2.2, N3.5, N3.6, N4 — fonte DPR 642/1972, tariffa art. 13
export function importoBolloAl(data: string): string          // '2.00' dal 2013-01-01; data precedente → errore
export const NATURE_NON_AMMESSE: readonly string[]            // N2, N3, N6
export const FAMIGLIE_CALCOLATE: readonly string[]            // tipi riga: CER, V, F, MW, MF, M<cat>; applicaA: DOCUMENTO, PERIODO
export function famigliaCalcolata(r: { tipo: string; prezzoSpeciale: boolean; applicaA: string | null; condizione: number | null; condizioniRiferite: string | null }): boolean
export const TOLLERANZE_SDI = { prezzoTotale: '0.01', imposta: '0.01', imponibile: '1.00' } as const  // da verificare sulle specifiche SDI vigenti (controlli 00421-00423) e citare nel commento
// tipi.ts — ingressi e uscite del calcolo, tutti gli importi come stringhe
export interface RigaLegameDaFatturare { legameId: string; rigaLegameId: string; legameVersione: number; movimentoVigenteId: string; dataMovimento: string; cerCode: string; numeroFir: string | null; rigaAddebitoId: string; tipo: string; descrizione: string | null; unitaMisura: string; quantita: string | null; prezzo: string | null; prezzoSpeciale: boolean; sconto: string | null; codiceIvaId: string; aliquotaIva: string; naturaIva: string | null }
export interface RigaListinoDaFatturare { id: string; versione: number; tipo: string; descrizione: string | null; categoriaId: string | null; unitaMisura: string; prezzo: string | null; quantitaFissa: string | null; sconto: string | null; prezzoSpeciale: boolean; applicaA: string | null; condizione: number | null; condizioniRiferite: string | null; scaglioni: Scaglione[]; scadenze: Scadenza[]; periodoScadenze: string | null; minimoFatturabile: string | null; minimoPerCategoria: boolean; codiceIva: CodiceIvaDaFatturare }
export interface CodiceIvaDaFatturare { id: string; versione: number; aliquota: string; natura: string | null; descrizione: string }
export interface RigaDocumentoCalcolata { numeroLinea: number; tipoRiga: TipoRigaDocumento; legameId: string | null; rigaLegameId: string | null; rigaAddebitoId: string | null; descrizione: string; dataMovimento: string | null; cerCode: string | null; numeroFir: string | null; quantita: string | null; unitaMisura: string | null; prezzoUnitario: string; sconto: string | null; importoLordo: string; importoSconto: string; prezzoTotale: string; codiceIvaId: string; aliquotaIva: string; naturaIva: string | null; marcatore?: { tipo: TipoMarcatore; chiaveCompetenza: string } }
export interface RiepilogoIvaCalcolato { aliquota: string; natura: string | null; imponibile: string; imposta: string; esigibilita: 'I' | 'D' | 'S'; riferimentoNormativo: string | null }
export interface RataCalcolata { ordine: number; modalita: string; dataScadenza: string; importo: string; istituto: string | null; iban: string | null; abi: string | null; cab: string | null; bic: string | null }
```

- [ ] **Step 1: test.** `insiemi chiusi: 7 stati di elaborazione, 3 di documento, 3 tipi, 7 tipi riga, 5 marcatori, 4 errori generali, 18 errori del documento, 7 avvisi`; `ogni codice ha un messaggio non vuoto, senza id`; `validaTestoBreve("  x ")` → `"x"`; `""` e `"   "` → errore; 200 caratteri ok, 201 errore; `importoBolloAl('2026-11-05') = '2.00'`; `NATURE_SOGGETTE_BOLLO` uguale alla lista dei Global Constraints (guardia: ampliarla è un cambio esplicito); `famigliaCalcolata` vero per `CER`, `V`, `F`, `MW`, `MF`, `M001`, prezzo speciale `DOCUMENTO` e `PERIODO`; falso per `TS`, `T001`, `NM`, `NR`, `$A`, `$D`, `$R`, `PROGRESSIVO_DA_DATA`, `CONGUAGLIO_365`, `GIORNO`, una riga con `condizione` o `condizioniRiferite` valorizzate (guardia sull'insieme, spec §6.6).
- [ ] **Step 2: run** `npx jest -w 2 src/domain/fatturazione/codici.spec.ts src/domain/fatturazione/costanti-fiscali.spec.ts` → FAIL.
- [ ] **Step 3: implementa** i tre file; messaggi brevi in italiano (es. `FAMIGLIA_NON_CALCOLATA`: «Il contratto ha un addebito che WasteFlow non calcola ancora: il documento non si emette.»).
- [ ] **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): codici, tipi e costanti fiscali (dominio)`.

## Task 2: righe dai legami e prezzo speciale (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/righe-movimento.ts`, `righe-movimento.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`RigaLegameDaFatturare`, `RigaListinoDaFatturare`, `famigliaCalcolata`); `importoRiga`, `applicaScaglioni`, `validaPrezzoSpeciale`.
- Produces:
```ts
export type EsitoRighe = { righe: Omit<RigaDocumentoCalcolata, 'numeroLinea'>[]; errori: Segnalazione<ErroreDocumento>[] }
export function righeDaLegami(legami: readonly RigaLegameDaFatturare[], listino: ReadonlyMap<string, RigaListinoDaFatturare>): EsitoRighe
export function descrizioneRigaMovimento(r: { descrizione: string | null; cerCode: string; dataMovimento: string; numeroFir: string | null }): string  // «<descrizione> CER <cer> del gg/mm/aaaa FIR <numero>»
```
Ordine delle righe d'uscita: data del movimento, poi `legameId`, poi `rigaLegameId`. Una riga
`FASCIA_SPECIALE` del prezzo a periodo segue l'ultima riga `MOVIMENTO` della sua riga di listino.

- [ ] **Step 1: test.** `prezzo singolo: quantità 1234.567 × 0.123456 con sconto 10+5: lordo arrotondato prima dello sconto, poi lo sconto, come importoRiga`; `descrizione: «Imballaggi CER 150101 del 03/11/2026 FIR ABC123»`; `senza FIR: niente «FIR»`; `riga CONFERMATO con quantita null o prezzo null a prezzo singolo: RIGA_LEGAME_INCOMPLETA`; `prezzo speciale DOCUMENTO: applicaScaglioni sulla quantità del singolo legame, una riga FASCIA_SPECIALE per fascia raggiunta`; `prezzo speciale PERIODO: tabella A/D di fatturazione.md §4.5 sulla somma delle quantità dei legami del documento con la stessa riga di listino → importi 470.00 e 300.00`; `PERIODO con due UM diverse per la stessa riga di listino: UM_NON_UNIVOCA, nessuna riga`; `scaglioni non validi (validaPrezzoSpeciale): PREZZO_SPECIALE_NON_VALIDO`; `riga di listino di famiglia non calcolata (TS, NM, $A, GIORNO): FAMIGLIA_NON_CALCOLATA con dettaglio «<tipo> riga <n>»` (mai id), nessuna riga per quella famiglia; `una famiglia non calcolata non impedisce il calcolo delle altre righe (l'errore blocca il documento, non il calcolo)`; `ordine deterministico: stesso insieme in ordine diverso → stesse righe nello stesso ordine`.
- [ ] **Step 2: run** `npx jest -w 2 src/domain/fatturazione/righe-movimento.spec.ts` → FAIL.
- [ ] **Step 3: implementa** `righeDaLegami` e `descrizioneRigaMovimento`; nessuna riscrittura degli importi: `importoRiga` per il prezzo singolo, `applicaScaglioni` per le fasce.
- [ ] **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): righe dai legami e prezzo speciale (dominio)`.

## Task 3: addebiti fissi, canoni e minimi (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/righe-fisse.ts`, `minimi.ts` (+ spec)

**Interfaces:**
- Consumes: Task 1; `scadenzeNelPeriodo`, `periodoCompetenza`.
- Produces:
```ts
export interface MarcatoreEsistente { rigaAddebitoId: string; tipo: TipoMarcatore; chiaveCompetenza: string }
export function righeFisse(i: { righe: readonly RigaListinoDaFatturare[]; periodo: { dal: string; al: string }; contratto: { dataInizio: string; dataFine: string | null }; marcatori: readonly MarcatoreEsistente[] }): EsitoRighe
export function applicaMinimi(righe: readonly Omit<RigaDocumentoCalcolata, 'numeroLinea'>[], minimi: readonly RigaListinoDaFatturare[], listino: ReadonlyMap<string, RigaListinoDaFatturare>): EsitoRighe   // restituisce solo le righe aggiunte (tipo MINIMO)
```
Regole di spec §6.4 e §6.5:
- `F` con scadenze: una riga per scadenza nel periodo e nelle date del contratto senza marcatore
  `SCADENZA_FISSO` con chiave `AAAA-MM-GG`; arretrati fino a `max(dataInizio, dal − 12 mesi)`;
  descrizione con `periodoCompetenza`.
- `F` senza scadenze: una riga per il periodo con marcatore `PERIODO_CANONE` `dal/al`. Se un
  marcatore esistente ha la stessa chiave, nessuna riga. Se un marcatore della stessa riga si
  sovrappone in parte: `CANONE_PERIODO_SOVRAPPOSTO`.
- `quantita_fissa` null = 1, `0` = nessuna riga.
- Minimo di riga: netto < `minimo_fatturabile` → riga «Differenza per minimo fatturabile». Con
  `minimo_per_categoria` il confronto va sulla somma delle righe della stessa categoria.
  `MW` = documento, `MF` = righe CER, `M<cat>` = righe di quella categoria; si aggiunge la differenza.

- [ ] **Step 1: test.** `F trimestrale con scadenze 31/03, 30/06: periodo 01/04-30/06 → una riga del 30/06 con marcatore SCADENZA_FISSO "AAAA-06-30"`; `scadenza del 31/12 dell'anno prima senza marcatore: fatturata come arretrato`; `scadenza di 13 mesi prima: non fatturata`; `scadenza prima di dataInizio del contratto: non fatturata`; `scadenza con marcatore esistente: nessuna riga`; `F senza scadenze, periodo 01/10-31/10: riga con marcatore PERIODO_CANONE "AAAA-10-01/AAAA-10-31"`; `stesso periodo già marcato: nessuna riga`; `marcatore 15/10-14/11 esistente e periodo 01/10-31/10: CANONE_PERIODO_SOVRAPPOSTO`; `quantita_fissa null: quantità 1; "0": nessuna riga`; `minimo di riga 50.00 su netto 30.00: riga MINIMO 20.00`; `minimo per categoria: confronto sulla somma della categoria`; `MW 100.00 su imponibile 80.00: riga MINIMO 20.00; su 120.00: nessuna riga`; `MF solo sulle righe CER`; `M001 solo sulle righe della categoria 001`; `codice IVA della riga MINIMO = quello della riga di listino del minimo`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa.** **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): addebiti fissi, canoni e minimi (dominio)`.

## Task 4: IVA, bollo, spese di incasso, split, rate e tipo documento (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/iva-bollo.ts`, `pagamento.ts`, `tipo-documento.ts` (+ spec)

**Interfaces:**
- Consumes: Task 1; `arrotonda2`; `normalizzaIban`, `ibanValido` (`src/domain/clienti/iban.ts`).
- Produces:
```ts
export function riepiloghiIva(righe: readonly RigaDocumentoCalcolata[], esigibilita: 'I' | 'D' | 'S', codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>): { riepiloghi: RiepilogoIvaCalcolato[]; errori: Segnalazione<ErroreDocumento>[] }
export function valutaBollo(riepiloghi: readonly RiepilogoIvaCalcolato[], dataDocumento: string, spesaBollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null): { dovuto: boolean; importo: string | null; rigaBollo: Omit<RigaDocumentoCalcolata, 'numeroLinea'> | null; errori: Segnalazione<ErroreDocumento>[]; avvisi: Segnalazione<AvvisoDocumento>[] }
export function rigaSpeseIncasso(spesa: { descrizione: string; importo: string; codiceIva: CodiceIvaDaFatturare | null } | null, numeroRate: number): { riga: Omit<RigaDocumentoCalcolata, 'numeroLinea'> | null; errori: Segnalazione<ErroreDocumento>[] }
export function calcolaRate(i: { netto: string; dataDocumento: string; condizione: { modalita: string; giorniRate: readonly number[]; fineMese: boolean }; esigibilita: 'I' | 'D' | 'S'; banca: { istituto: string | null; iban: string | null; bic: string | null } | null }): { condizioniPagamento: 'TP01' | 'TP02'; rate: RataCalcolata[]; errori: Segnalazione<ErroreDocumento>[] }
export function abiCabDaIban(iban: string): { abi: string; cab: string } | null    // solo IBAN IT valido: ABI = caratteri 6-10, CAB = 11-15
export function tipoDocumento(righe: readonly { tipoRiga: TipoRigaDocumento }[]): 'TD01' | 'TD24'   // TD24 con almeno una riga MOVIMENTO o FASCIA_SPECIALE (S19)
export function oltreTermineDifferita(dataDocumento: string, periodoAl: string): boolean   // data > 15 del mese dopo periodoAl
```
Algoritmi (spec §6.7-§6.11, P2):
```text
imposta(aliquota, natura)  = arrotonda2(Σ prezzo_totale × aliquota / 100)       // sul totale per coppia, non per riga
bollo dovuto              ⇔ Σ imponibili con natura ∈ NATURE_SOGGETTE_BOLLO > SOGLIA_BOLLO
spesa di incasso          = importo × numero delle rate; importo 0 → nessuna riga
netto_a_pagare            = totale_documento − (esigibilita = 'S' ? Σ imposta : 0)
rata i < n                = netto / n con ROUND_DOWN al centesimo; rata n = netto − Σ rate precedenti
data rata                 = dataDocumento + giorni; con fineMese → ultimo giorno di quel mese
```

- [ ] **Step 1: test.** *IVA:* `tre righe al 22% da 10.005, 10.005, 10.005 → imposta su 30.02 (arrotonda2 sul totale), non la somma delle imposte di riga`; `riga N2.2 a zero e riga 22%: due riepiloghi`; `natura N2, N3 o N6: NATURA_NON_AMMESSA`; `riferimentoNormativo = descrizione del codice IVA troncata a 100`; `esigibilità S sul riepilogo`. *Bollo:* `imponibile N4 77.47: non dovuto; 77.48: dovuto 2.00`; `dovuto senza spesa: avviso BOLLO_NON_ADDEBITATO, nessuna riga`; `dovuto con spesa e codice IVA N1: riga BOLLO`; `spesa di bollo con codice IVA non N1: errore` (`SPESA_SENZA_CODICE_IVA` se manca, `NATURA_NON_AMMESSA` se non N1); `solo imponibile al 22%: non dovuto`. *Spese:* `spesa 2.50 con 3 rate: riga 7.50`; `spesa senza codice IVA: SPESA_SENZA_CODICE_IVA`. *Rate:* `100.00 in 3 rate: 33.33, 33.33, 33.34`; `200.00 in 3: 66.66, 66.66, 66.68`; `una rata: TP02; più rate: TP01`; `30 giorni fine mese dal 15/01: 28/02 (29/02 negli anni bisestili)`; `MP05 senza IBAN: PAGAMENTO_SENZA_BANCA`; `MP12 usa la banca del cliente`; `MP01 con esigibilità S o D: PAGAMENTO_NON_AMMESSO`; `split: la somma delle rate è il netto senza IVA`; `abiCabDaIban("IT60X0542811101000000123456") = { abi: "05428", cab: "11101" }`; `IBAN estero: null`. *Tipo:* `solo FISSO: TD01`; `FISSO e MOVIMENTO: TD24`; `oltreTermineDifferita("2026-11-16","2026-10-31") vero, "2026-11-15" falso`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa.** **Step 4: run** → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): IVA, bollo, spese, rate e tipo documento (dominio)`.

## Task 5: controlli SDI, calcolo del documento e impronta (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/controlli-sdi.ts`, `calcola-documento.ts`, `impronta.ts` (+ spec), `src/test-support/generatore-casuale.ts`

**Interfaces:**
- Consumes: Task 1-4.
- Produces:
```ts
export function prezzoTotaleSdi(prezzoUnitario: string, quantita: string, sconti: readonly string[]): string   // formula SDI, 8 decimali
export function controllaCoerenzaSdi(d: { righe: readonly RigaDocumentoCalcolata[]; riepiloghi: readonly RiepilogoIvaCalcolato[]; totaleDocumento: string; importoBollo: string | null }): Segnalazione<ErroreDocumento>[]   // [] oppure IMPORTI_NON_COERENTI con dettaglio del controllo
export interface InputDocumento { raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; contratto: ContrattoDaFatturare; periodo: { dal: string; al: string }; dataDocumento: string; legami: RigaLegameDaFatturare[]; listino: ReadonlyMap<string, RigaListinoDaFatturare>; righeFisse: RigaListinoDaFatturare[]; minimi: RigaListinoDaFatturare[]; marcatori: MarcatoreEsistente[]; codiciIva: ReadonlyMap<string, CodiceIvaDaFatturare>; legamiDaCollegareEsclusi: number; arretrati: number }
export interface ContrattoDaFatturare { id: string; versione: number; stato: string; dataInizio: string; dataFine: string | null; esigibilita: 'I' | 'D' | 'S'; ritenutaPercentuale: string | null; condizione: { modalita: string; giorniRate: number[]; fineMese: boolean } | null; banca: { istituto: string | null; iban: string | null; bic: string | null } | null; speseIncasso: { descrizione: string; importo: string; codiceIva: CodiceIvaDaFatturare | null } | null; bollo: { importo: string; codiceIva: CodiceIvaDaFatturare | null } | null; registroIvaId: string | null; codiceDestinatario: string | null; pec: string | null; cig: string | null; cup: string | null; idDocumento: string | null; clienteCompleto: { datiFiscali: boolean; sede: boolean } }
export interface DocumentoCalcolato { tipoDocumento: 'TD01' | 'TD24'; formatoTrasmissione: 'FPR12' | 'FPA12'; righe: RigaDocumentoCalcolata[]; riepiloghi: RiepilogoIvaCalcolato[]; rate: RataCalcolata[]; condizioniPagamento: 'TP01' | 'TP02' | null; totaleImponibile: string; totaleIva: string; totaleDocumento: string; nettoAPagare: string; bolloDovuto: boolean; importoBollo: string | null; errori: Segnalazione<ErroreDocumento>[]; avvisi: Segnalazione<AvvisoDocumento>[] }
export function calcolaDocumento(i: InputDocumento): DocumentoCalcolato
export function improntaElaborazione(i: { parametri: unknown; legami: readonly { id: string; versione: number }[]; contratti: readonly { id: string; versione: number }[]; elenchi: readonly { id: string; versione: number }[]; righeAddebito: readonly { id: string; versione: number }[]; codiciIva: readonly { id: string; versione: number }[] }): string   // sha256 esadecimale, 64 caratteri
```
Ordine in `calcolaDocumento`: righe movimento → fisse → minimi → spese di incasso → bollo → numeri di
linea 1..n → riepiloghi → totali → rate → errori di contratto (`CONTRATTO_SOSPESO`,
`SENZA_REGISTRO_IVA`, `SENZA_CONDIZIONE_PAGAMENTO`, `CLIENTE_SENZA_DATI_FISCALI`,
`SEDE_CLIENTE_INCOMPLETA`, `DATI_PA_INCOMPLETI`, `RITENUTA_NON_GESTITA` con `ritenutaPercentuale > 0`)
→ `TOTALE_NON_POSITIVO` → `controllaCoerenzaSdi` → avvisi. `SOSPESO_MOVIMENTI` (lo stato arriva in
`contratto.stato`): righe movimento vuote e avviso `MOVIMENTI_SOSPESI`.

Algoritmo dello sconto a cascata contro la tolleranza SDI (spec §6.12, §17.4):
```text
nostro netto  = importoRiga(q, p, sconto).netto       // lordo = arrotonda2(q·p); sconto = arrotonda2(lordo − lordo·Π(1−sᵢ/100))
formula SDI   = p · Π(1 − sᵢ/100) · q                 // ScontoMaggiorazione SC con Percentuale sᵢ, in ordine
coerente      ⇔ |nostro netto − formula SDI| ≤ TOLLERANZE_SDI.prezzoTotale
ImponibileImporto ⇔ |imponibile − Σ PrezzoTotale| ≤ TOLLERANZE_SDI.imponibile
Imposta       ⇔ |imposta − imponibile·aliquota/100| ≤ TOLLERANZE_SDI.imposta
ImportoTotaleDocumento = Σ (imponibile + imposta) + importo bollo addebitato
```
Il test basato su proprietà gira su 20.000 casi con seme fisso: `q` da 0.001 a 99999.999 (3
decimali), `p` da 0.000001 a 9999.999999 (6 decimali), da 0 a 3 sconti fino a 99.99. **Se trova un
caso fuori tolleranza, il task si ferma e lo segnala con i valori del caso**: la rappresentazione si
sceglie in revisione (§17.4), non nel task.

Impronta: righe `tipo:id:versione` (`tipo` ∈ `legame, contratto, elenco, riga, iva`) ordinate, unite da
`\n`, poi `\nparametri:` + JSON con chiavi ordinate; sha256. Come `improntaVariazione`.

- [ ] **Step 1: test.** `controllaCoerenzaSdi: documento costruito con le funzioni dei Task 2-4 → []`; `PrezzoTotale alterato di 0.02 → IMPORTI_NON_COERENTI`; `totale documento senza bollo addebitato → coerente; con riga BOLLO il totale la include`; **proprietà** `20.000 casi: |netto − prezzoTotaleSdi| ≤ 0.01` e `Σ rate = netto_a_pagare` e `Σ righe = Σ imponibili`; `calcolaDocumento: contratto SOSPESO → CONTRATTO_SOSPESO, nessuna riga`; `SOSPESO_MOVIMENTI → solo fisse, avviso MOVIMENTI_SOSPESI`; `ritenuta 4%: RITENUTA_NON_GESTITA`; `codice destinatario di 6 caratteri: FPA12 e avviso FPA_DA_FIRMARE`; `FPA12 con CIG e senza idDocumento: DATI_PA_INCOMPLETI`; `"0000000" senza PEC: avviso DESTINATARIO_ASSENTE`; `legamiDaCollegareEsclusi 3: avviso MOVIMENTI_DA_COLLEGARE_ESCLUSI con dettaglio "3"`; `arretrati 2: ARRETRATI_PRESENTI`; `TD24 con data oltre il 15: DATA_OLTRE_TERMINE_DIFFERITA`; `totale 0: TOTALE_NON_POSITIVO`; `numeri di linea consecutivi da 1`; `deterministico: due chiamate sullo stesso input → JSON identico`; `improntaElaborazione: ordine degli id diverso → stessa impronta; una versione cambiata → impronta diversa; parametri con chiavi in ordine diverso → stessa impronta`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa** (generatore con seme fisso, P3). **Step 4: run** → PASS, la proprietà sotto 10 s.
- [ ] **Step 5: commit** `feat(fatturazione): controlli SDI, calcolo del documento e impronta (dominio)`.

## Task 6: schema, migration, trigger e RLS (Postgres, migration pesante)

**Files:**
- Modify: `prisma/schema.prisma` (enum `StatoElaborazioneFatturazione` `@@map("stato_elaborazione_fatturazione")`, `StatoDocumentoFattura`, `RaggruppamentoFatturazione`, `TipoRigaDocumentoFattura`, `TipoMarcatoreAddebito`; 9 modelli in coda dopo `ImpostazioneFatturazione`; colonne additive; relazioni inverse su `Tenant`, `Cliente`, `ContrattoCliente`, `ElencoAddebiti`, `RigaAddebito`, `CodiceIva`, `RegistroIva`, `SpesaAccessoria`, `LegameMovimento`, `RigaLegameMovimento`)
- Create: `prisma/migrations/20261105100000_fatturazione_modello/migration.sql`
- Modify: `src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS` + 9), `rls-catalogo.postgres.spec.ts` (67 → 76), `README-tenant-transazione.md`, `ops/README.md` (rilascio e rollback)
- Create: `src/test-support/fatturazione-di-test.ts`
- Test: `src/application/fatturazione/fatturazione.schema.postgres.spec.ts`

**Interfaces:**
- Produces (tabelle, colonne e vincoli di spec §4.2-§4.13 più P1):
  - `cedente_fatturazione` (unico `tenant_id`; `regime_fiscale` CHECK `^RF(0[1-9]|1[0-9]|20)$`; `socio_unico` `SU`/`SM`/null; `stato_liquidazione` default `LN`);
  - `numerazioni_fattura` (PK `(tenant_id, registro_iva_id, anno)`, `ultimo_numero`, `ultima_data`, `numero_partenza`, **`data_partenza`** (P1), `versione`; CHECK `ultimo_numero ≥ numero_partenza ≥ 0`);
  - `elaborazioni_fatturazione` (indice `(tenant_id, stato, created_at)`; unico parziale `elaborazioni_fatturazione_una_attiva` `(tenant_id) WHERE stato IN ('IN_CORSO','IN_DEFINITIVA')`);
  - `documenti_fattura` (unico parziale `documenti_fattura_numero_definitivo` `(tenant_id, registro_iva_id, anno, numero) WHERE stato = 'DEFINITIVO'`; unico parziale `documenti_fattura_un_storno` `(tenant_id, documento_origine_id) WHERE tipo_documento = 'TD04' AND stato <> 'ANNULLATO'`; unico `(tenant_id, progressivo_file)`; i 5 CHECK del §4.3; `errori <@ ARRAY[…18]`, `avvisi <@ ARRAY[…7]`; indici del §4.3);
  - `righe_documento_fattura` (FK `(documento_id, tenant_id)` CASCADE; unico `(documento_id, numero_linea)`; FK NoAction a legame, riga del legame, riga di listino, codice IVA);
  - `riepiloghi_iva_documento` (unico `(documento_id, aliquota, natura)` `NULLS NOT DISTINCT`), `rate_documento_fattura` (unico `(documento_id, ordine)`);
  - `marcatori_addebiti_fatturati` (unico `(tenant_id, riga_addebito_id, tipo, chiave_competenza)`; CHECK della forma della chiave);
  - `contatori_file_fatturapa` (PK `tenant_id`, `ultimo int NOT NULL DEFAULT 0`);
  - colonne: `legami_movimento.documento_id` (FK NoAction) + `scostamento_gestito_il`, `scostamento_gestito_da`, `scostamento_nota varchar(200)`; CHECK `(stato = 'FATTURATO') = (documento_id IS NOT NULL)` e `scostamento_gestito_il IS NOT NULL ⇒ scostamento_dopo_fattura` (`NOT VALID` + `VALIDATE`); `spese_accessorie.codice_iva_id` (FK NoAction); `registri_iva.suffisso_numero varchar(10)`;
  - trigger `documenti_fattura_immutabile` e `figlie_documento_immutabili` (`BEFORE UPDATE OR DELETE`) con le regole del §4.12; rollback con `DROP TRIGGER` e `DROP FUNCTION` in `ops/README.md`.
- Fixture:
```ts
export async function creaScenarioFatturazione(owner: PrismaClient, tenantId: string, opz?: { legami?: number; registri?: number; conFissi?: boolean; prezzoSpeciale?: 'DOCUMENTO' | 'PERIODO'; dataMovimento?: string }): Promise<{ contrattoId: string; clienteId: string; elencoId: string; registroIvaId: string; legamiIds: string[]; rigaAddebitoIds: string[]; codiceIvaId: string }>
export async function creaDocumentoDiTest(owner: PrismaClient, tenantId: string, opz: { stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'; registroIvaId: string; anno: number; numero?: number; dataDocumento?: string; legamiIds?: string[]; elaborazioneId?: string }): Promise<{ documentoId: string }>
export async function creaCedenteDiTest(owner: PrismaClient, tenantId: string): Promise<void>
```
(inserimenti col proprietario nel rispetto dei CHECK; `creaDocumentoDiTest` con `DEFINITIVO` marca
i legami `FATTURATO` con `documento_id`.)

- [ ] **Step 1: test che falliscono** (ruolo `wasteflow_app`): `documento BOZZA con numero: respinto`; `DEFINITIVO senza numero: respinto`; `DEFINITIVO con errori non vuoti: respinto`; `ANNULLATO senza motivo: respinto`; `TD04 senza documento_origine_id: respinto`; `emesso_il su BOZZA: respinto`; `due DEFINITIVO con lo stesso (registro, anno, numero): 23505`; `un ANNULLATO e un DEFINITIVO con lo stesso numero: ammesso` (decisione 3); `errore fuori dall'insieme: respinto`; `due TD04 non annullati sullo stesso documento: 23505`; *trigger:* `UPDATE del totale di un DEFINITIVO: respinto`; `UPDATE di stato DEFINITIVO → ANNULLATO con motivo: ammesso`; `ANNULLATO → DEFINITIVO: respinto`; `emesso_il null → valore: ammesso; valore → altro valore: respinto`; `xml e progressivo_file da null a valore: ammesso una volta; seconda scrittura: respinta`; `DELETE di un DEFINITIVO: respinto`; `DELETE di una BOZZA con righe: ammesso (cascata)`; `UPDATE e DELETE di righe, riepiloghi e rate di un DEFINITIVO: respinti`; *legami:* `FATTURATO senza documento_id: respinto`; `CONFERMATO con documento_id: respinto`; `scostamento_gestito_il senza scostamento_dopo_fattura: respinto`; `IMPORTATO_FATTURATO senza documento: ammesso`; *altro:* `secondo cedente per lo stesso tenant: 23505`; `marcatore duplicato: 23505`; `chiave_competenza "2026-13-01": respinta`; `delete di riga_addebito citata da una riga di documento o da un marcatore: 23503`; `delete di codice IVA citato: 23503`; `seconda elaborazione IN_CORSO per lo stesso tenant: 23505; una IN_CORSO e due ANTEPRIMA_PRONTA: ammesse`; RLS: `senza tenant 0 righe, altro tenant 0 righe` per le 9 tabelle; `nessuna colonna nuova su waste_movements` (confronto con `information_schema`).
- [ ] **Step 2: run** `flock … npx jest -c jest.postgres.config.js --runInBand --forceExit src/application/fatturazione/fatturazione.schema.postgres.spec.ts` → FAIL.
- [ ] **Step 3: schema + migration.** Ordine nel file: enum → colonne additive → tabelle → unici e FK → CHECK `NOT VALID` + `VALIDATE` → indici (parziali solo in SQL) → funzioni e trigger → `ENABLE` + `FORCE ROW LEVEL SECURITY` + le due policy standard per ciascuna delle 9 tabelle (copiare da `20261103200000_legami_movimento`) → `GRANT` come `ops/db-ruoli.sh`. Il trigger confronta `OLD` e `NEW` colonna per colonna con un elenco esplicito delle colonne permesse (§4.12), non con `row_to_json`.
- [ ] **Step 4: verifiche migration.** `npx prisma validate`; `npx prisma generate`; `migrate deploy` su 55438; `db-ruoli.sh`; `migrate diff … --shadow-database-url …` → vuoto; test di migrazione su un DB temporaneo con legami `CONFERMATO` e `FATTURATO` della 4.3 (il `VALIDATE` del CHECK su `documento_id` passa solo senza `FATTURATO`: in produzione non ce ne sono, lo si verifica con una query prima del deploy, scritta in `ops/README.md`).
- [ ] **Step 5: run** la suite + `rls-catalogo.postgres.spec.ts` (76) → PASS; `tsc`. Fine task backend.
- [ ] **Step 6: commit** `feat(fatturazione): tabelle dei documenti, numerazione, marcatori e cedente con RLS e trigger di immutabilità`.

## Task 7: dati del cedente (servizio e API, Postgres)

**Files:**
- Create: `src/application/fatturazione/cedente.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`), `src/api/fatturazione/{fatturazione.module,ruoli,cedente.controller}.ts`, `dto/cedente.dto.ts`, `cedente.controller.spec.ts`
- Modify: `src/app.module.ts` (una riga: `FatturazioneModule`)

**Interfaces:**
- Produces:
```ts
export interface CedenteVista { regimeFiscale: string | null; reaUfficio: string | null; capitaleSociale: string | null; socioUnico: 'SU' | 'SM' | null; statoLiquidazione: 'LN' | 'LS'; registroIvaPredefinitoId: string | null; idTrasmittenteCodice: string | null; versione: number; daTenant: { ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null; indirizzo: string | null; cap: string | null; comune: string | null; provincia: string | null; numeroRea: string | null }; completo: boolean; mancanti: string[] }
// GET /cedente-fatturazione  RUOLI_LETTURA → CedenteVista (senza riga: valori null, versione 0)
// PUT /cedente-fatturazione  RUOLI_AMMINISTRATORI body { regimeFiscale, reaUfficio?, capitaleSociale?, socioUnico?, statoLiquidazione, registroIvaPredefinitoId?, idTrasmittenteCodice?, versione } → CedenteVista; 409 VERSIONE_SUPERATA
export class CedenteService { leggi(tenantId: string): Promise<CedenteVista>; leggiInTx(tx: Prisma.TransactionClient, tenantId: string): Promise<CedenteVista>; imposta(tenantId: string, utenteId: string, dati: DatiCedente): Promise<CedenteVista> }
```
`completo` = regime fiscale presente e, dal tenant, partita IVA, ragione sociale e indirizzo
completo (§4.9). `mancanti` = etichette italiane dei campi assenti.

- [ ] **Step 1: test (unit + Postgres).** `GET senza riga: completo false, mancanti con «Regime fiscale»`; `PUT prima volta (versione 0): 200, versione 1`; `regime "RF21" o "XX": 400`; `capitaleSociale "1000,50" o numero JSON: 400; "1000.50": 200`; `socioUnico con statoLiquidazione mancante: default LN`; `registro predefinito di un altro tenant: 404`; `tenant senza indirizzo: completo false con «Indirizzo della sede»`; `versione vecchia: 409 VERSIONE_SUPERATA`; `OPERATOR e VIEWER su PUT: 403; VIEWER su GET: 200`; `audit con valori prima e dopo, senza dati personali`; `RLS: altro tenant non vede la riga`; `due PUT concorrenti con la stessa versione: uno 200 e uno 409`.
- [ ] **Step 2: run** → FAIL. **Step 3: implementa** (lock ottimistico come `ImpostazioniFatturazioneService`; modulo registrato in `app.module.ts`). **Step 4: run** → PASS; controller-tenant-selezionato e nessun-user-userid verdi. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): dati del cedente (servizio e API)`.

## Task 8: numerazione sotto lock e numero di partenza (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/numerazione.ts`, `numerazioni.service.ts` (+ `.spec.ts`, `.postgres.spec.ts`), `src/api/fatturazione/numerazioni.controller.ts`, `dto/numerazione.dto.ts` (+ spec)
- Modify: `src/api/fatturazione/fatturazione.module.ts`

**Interfaces:**
- Produces:
```ts
export interface RichiestaNumeri { registroIvaId: string; anno: number; quanti: number; dataDocumento: string }
export interface NumeriRiservati { registroIvaId: string; anno: number; da: number; a: number; suffisso: string | null }
export async function bloccaNumerazioni(tx: Prisma.TransactionClient, tenantId: string, coppie: readonly { registroIvaId: string; anno: number }[]): Promise<Map<string, { ultimoNumero: number; ultimaData: string | null; numeroPartenza: number; dataPartenza: string | null }>>   // chiave `${registroIvaId}:${anno}`
export async function riservaNumeri(tx: Prisma.TransactionClient, tenantId: string, r: readonly RichiestaNumeri[]): Promise<NumeriRiservati[]>   // 409 DATA_ANTERIORE_ULTIMA_FATTURA
export async function rilasciaUltimo(tx: Prisma.TransactionClient, tenantId: string, c: { registroIvaId: string; anno: number; numero: number; documentoId: string }): Promise<void>   // 409 ANNULLO_NON_AMMESSO se numero ≠ ultimo_numero
export function numeroTesto(numero: number, suffisso: string | null): string   // 15 + "/A" → "15/A"
export class NumerazioniService { elenco(tenantId: string, anno: number): Promise<NumerazioneVista[]>; impostaPartenza(tenantId: string, utenteId: string, registroIvaId: string, anno: number, dati: { numeroPartenza: number; dataPartenza: string | null; versione: number }): Promise<NumerazioneVista> }
export interface NumerazioneVista { registroIvaId: string; codiceRegistro: string; anno: number; ultimoNumero: number; ultimaData: string | null; numeroPartenza: number; dataPartenza: string | null; partenzaModificabile: boolean; versione: number }
// GET /numerazioni-fattura?anno=   RUOLI_LETTURA (un elemento per registro attivo, anche senza riga)
// PUT /numerazioni-fattura/:registroIvaId/:anno   RUOLI_AMMINISTRATORI → 409 PARTENZA_NON_MODIFICABILE se esiste un DEFINITIVO o un ANNULLATO della coppia
```
Algoritmo della riserva (spec §4.6, §5.4 passo 2):
```text
1. INSERT INTO numerazioni_fattura (tenant, registro, anno) SELECT … FROM unnest(...) ON CONFLICT DO NOTHING
2. SELECT … FOR UPDATE delle coppie, ORDER BY registro_iva_id, anno     // una query, = ANY
3. per ogni richiesta: se ultima_data non nulla e dataDocumento < ultima_data → 409 DATA_ANTERIORE_ULTIMA_FATTURA
   da = ultimo_numero + 1; a = ultimo_numero + quanti
4. UPDATE … FROM unnest(...) SET ultimo_numero = a, ultima_data = dataDocumento, versione = versione + 1
```
`rilasciaUltimo`: coppia `FOR UPDATE`; `numero = ultimo_numero` altrimenti 409; `ultimo_numero − 1`;
`ultima_data` := `max(data_documento)` dei `DEFINITIVO` della coppia con numero < quello rilasciato,
altrimenti `data_partenza` (P1).

- [ ] **Step 1: test (Postgres, `application_name` = `fatt-t8-${pid}`).** `prima riserva: 1..3`; `con numero_partenza 120: 121..`; `numeroTesto(15, "/A") = "15/A"`; `data anteriore a ultima_data: 409, ultimo_numero invariato`; `due registri nella stessa riserva: lock in ordine di registro_iva_id`; **`due transazioni sulla stessa coppia: la seconda aspetta (barriera wait_event_type = 'Lock') e riceve i numeri dopo quelli della prima`**; **`8 riserve in parallelo su 8 tenant: nessuna attesa reciproca`**; **`20 riserve in parallelo sulla stessa coppia (Promise.all, 1-5 numeri ciascuna): numeri unici, consecutivi, ultimo_numero = somma`**; `rollback della transazione dopo la riserva: ultimo_numero invariato`; `rilasciaUltimo dell'ultimo: ultimo_numero − 1 e ultima_data del precedente`; `rilasciaUltimo dell'unico definitivo dopo una partenza: ultima_data = data_partenza`; `rilasciaUltimo di un numero intermedio: 409 ANNULLO_NON_AMMESSO`; `anno nuovo (Review Focus 3): riserva al 02/01 su un registro con definitivi a dicembre → 1 (o numero_partenza + 1 dell'anno nuovo)`; *partenza:* `PUT senza definitivi: 200, ultimo_numero = numero_partenza`; `PUT con un DEFINITIVO o un ANNULLATO nella coppia: 409 PARTENZA_NON_MODIFICABILE`; `numeroPartenza negativo o non intero: 400`; `OPERATOR: 403`; `GET elenca anche i registri senza riga con ultimoNumero 0`; `audit del numero di partenza`.
- [ ] **Step 2: run** (sotto `flock`) → FAIL. **Step 3: implementa.** **Step 4: run** → PASS. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): numerazione senza buchi sotto lock e numero di partenza`.

## Task 9: colonne additive nei servizi esistenti e «in uso» (Postgres)

**Files:**
- Modify: `src/application/clienti/spese-accessorie.service.ts` e DTO (`codiceIvaId?: string | null`), `src/application/clienti/registri-iva.service.ts` e DTO (`suffissoNumero?: string | null`), `src/api/clienti/spese-accessorie.controller.ts`, `registri-iva.controller.ts`, `src/application/listino/uso-listino.ts` (sorgenti `righeDocumento` e `marcatori`), `src/application/listino/codici-iva.service.ts` (`eliminabile`)
- Create: `src/application/fatturazione/suffisso-registro.ts`
- Test: le suite Postgres e controller di spese accessorie, registri IVA, codici IVA, righe di listino; `uso-listino.spec.ts`

**Interfaces:**
- Produces: `SpesaAccessoriaVista.codiceIvaId: string | null`; `RegistroIvaVista.suffissoNumero: string | null` e `suffissoModificabile: boolean`; 409 `SUFFISSO_NON_MODIFICABILE` se il registro ha un `DEFINITIVO` nell'anno della data italiana corrente; `ColonneReferentiListino.righeDocumento` e `.marcatori`; `suffissoValido(s: string | null): boolean` (1-10 caratteri `[A-Za-z0-9/-]`, accettati dall'XSD in `Numero`).

- [ ] **Step 1: test.** `spesa con codice IVA di un altro tenant: 404`; `spesa senza codice IVA: 200 come prima`; `codice IVA della spesa disattivato: la spesa resta`; `suffisso "/A": 200; "/A B" o 11 caratteri: 400`; `suffisso con un DEFINITIVO nell'anno: 409 SUFFISSO_NON_MODIFICABILE; con definitivi solo dell'anno prima: 200`; `riga di listino citata da una riga di documento: eliminabile false, delete 409 RIGA_ADDEBITO_IN_USO`; `citata da un marcatore: idem`; `codice IVA citato da una spesa o da una riga di documento: CODICE_IVA_IN_USO`; `contaUsiListino con 1000 id: una query per colonna`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (suite toccate + `rls-catalogo` 76). Nessuna regressione su clienti e listino. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): codice IVA delle spese, suffisso del registro e listino in uso dai documenti`.

## Task 10: frontend — schede «Dati del cedente» e «Numerazione»

**Files:**
- Create: `fe/features/fatturazione/impostazioni/cedente-scheda.component.ts` (+ spec), `numerazione-scheda.component.ts` (+ spec), `fe/features/fatturazione/impostazioni/impostazioni-fatturazione-4-4.service.ts` (+ spec), `impostazioni.model.ts`
- Modify: `fe/features/legami/impostazioni-fatturazione.component.ts` (tre schede: «Fatturazione da», «Dati del cedente», «Numerazione»; spec estesa)

**Interfaces:**
- Consumes: Task 7 (`CedenteVista`), Task 8 (`NumerazioneVista`, `PARTENZA_NON_MODIFICABILE`).
- Produces: `ImpostazioniFatturazione44Service.leggiCedente()`, `.salvaCedente(dati)`, `.numerazioni(anno)`, `.impostaPartenza(registroIvaId, anno, dati)`.

- [ ] **Step 1: test.** `cedente: dati del tenant in sola lettura, regime fiscale da elenco RF01-RF20`; `capitale sociale con appNumeroIt: "1000,50" inviato "1000.50"; "1000.50" → «Usa la virgola per i decimali»`; `cedente incompleto: riquadro con i campi mancanti`; `numerazione: tabella per registro con ultimo numero, ultima data, partenza; «Numero di partenza» solo se partenzaModificabile`; `nessuna partenza impostata e nessun definitivo: avviso «La numerazione partirà da 1»`; `data di partenza: maxDate = fine del giorno ricalcolata all'apertura`; `VIEWER e OPERATOR: campi disabilitati`; `409 VERSIONE_SUPERATA e PARTENZA_NON_MODIFICABILE: messaggio e ricarica`.
- [ ] **Step 2-4:** Karma mirato FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): schede cedente e numerazione nelle impostazioni`.

## Task 11: frontend — codice IVA delle spese e suffisso del registro

**Files:**
- Modify: `fe/features/clienti/tabelle/registro-iva-dialog.component.ts` e il dialog delle spese accessorie nella stessa cartella (+ spec), i rispettivi modelli e servizi

**Interfaces:** Consumes Task 9 (`codiceIvaId`, `suffissoNumero`, `suffissoModificabile`, `SUFFISSO_NON_MODIFICABILE`).

- [ ] **Step 1: test.** `spesa: menu codice IVA (solo attivi), salvato nel corpo; vuoto → null`; `bollo senza codice IVA N1: suggerimento «Per addebitare il bollo serve un codice IVA con natura N1»`; `registro: suffisso modificabile solo se suffissoModificabile, con tooltip del motivo`; `409 SUFFISSO_NON_MODIFICABILE: messaggio del backend`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): codice IVA delle spese e suffisso del registro`.

## Task 12: verifica e chiusura 4.4a (e2e API leggero, Postgres)

**Files:**
- Create: `e2e/tests/fatturazione/impostazioni-fatturazione-4-4.spec.ts`
- Modify: `ops/README.md` (rilascio e rollback 4.4a, query di controllo dei `FATTURATO` prima del deploy)

- [ ] **Step 1: test e2e** (azienda propria): `ADMIN imposta il cedente; OPERATOR 403`; `GET numerazioni dell'anno: registri con ultimo numero 0`; `ADMIN imposta il numero di partenza 120`; `spesa con codice IVA`; `nessuna rotta di elaborazione esiste ancora (POST /elaborazioni-fatturazione → 404)`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres dei Task 6-9, `rls-catalogo` 76, Karma una volta, `migrate diff` vuoto. Confronto con la linea di base del Task 0.
- [ ] **Step 3: commit** `test(fatturazione): e2e delle impostazioni e chiusura 4.4a`.

## Task 13: revisione dell'intero branch — 4.4a

**File:** nessuno (revisione opus su `git diff master...HEAD`).

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`). Controlli espliciti: RLS ENABLE+FORCE nella stessa migration, 9 modelli in `TENANT_SCOPED_MODELS`, conteggio 76; trigger col solo elenco esplicito di colonne permesse; nessun `DROP`; il `VALIDATE` sul CHECK di `documento_id` sicuro in produzione; nessuna colonna su `waste_movements`; `@Roles` su ogni rotta; il dominio non importa Prisma client né servizi; proprietà dello sconto verde su 20.000 casi; pulizia dei test per id; Global Constraints. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `.superpowers/sdd/2026-11-05-fase4-4/4-4a-report.md`; PR 4.4a, merge, deploy con `migrate deploy`.

---

# Pezzo 4.4b — elaborazione, documenti ed export di backend

Da master dopo il merge della 4.4a. **Prima del Task 19:** Graziano conferma col commercialista la
decisione 8 (TD24 e misti) e le nature del bollo (§17.5). Se la revisione del piano trova il pezzo
troppo grande, si divide al Task 23: 4.4b1 = Task 14-22 (con 25 ridotto), 4.4b2 = Task 23-27.

## Task 14: frontend — modelli e servizio HTTP della fatturazione (contratto dei nomi)

**Files:**
- Create: `fe/features/fatturazione/fatturazione.model.ts`, `fatturazione.service.ts` (+ spec), `vocabolario-fatturazione.ts` (+ spec), `permessi-fatturazione.ts` (+ spec)

**Interfaces:**
- Produces (nomi vincolanti per i DTO del backend, P5):
```ts
export interface NuovaElaborazione { periodoDal: string; periodoAl: string; dataDocumento: string; raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione }
export interface FiltriElaborazione { clienteIds?: string[]; contrattoIds?: string[]; categoriaIds?: string[]; tipiAddebito?: string[]; registroIvaIds?: string[] }
export interface ElaborazioneRiga { id: string; stato: StatoElaborazione; createdAt: string; periodoDal: string; periodoAl: string; dataDocumento: string; documenti: number; totale: string; errori: number; avvisi: number }
export interface ElaborazioneDettaglio extends ElaborazioneRiga { raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione; impronta: string | null; versione: number; erroriGenerali: SegnalazioneVista[]; erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]; numerazionePrevista: { registroIvaId: string; codiceRegistro: string; da: string; a: string }[]; totaliPerRegistro: { registroIvaId: string; imponibile: string; iva: string; totale: string }[]; errore: { codice: string; differenze?: { nuovi: number; cambiati: number; fatturatiDaAltri: number } } | null }
export interface DocumentoRiga { id: string; stato: StatoDocumento; tipoDocumento: string; numeroTesto: string | null; dataDocumento: string; cliente: { id: string; denominazione: string }; contratto: { id: string; numero: string }; registro: { id: string; codice: string }; totaleImponibile: string; totaleIva: string; totaleDocumento: string; errori: SegnalazioneVista[]; avvisi: SegnalazioneVista[]; esclusoDaDefinitiva: boolean; emessoIl: string | null; annullabile: boolean; motivoNonAnnullabile: string | null; stornabile: boolean }
export interface DocumentoDettaglio extends DocumentoRiga { righe: RigaDocumentoVista[]; riepiloghi: RiepilogoIvaVista[]; rate: RataVista[]; nettoAPagare: string; bolloDovuto: boolean; importoBollo: string | null; versione: number; documentoOrigineId: string | null; stornoId: string | null; xmlGenerato: boolean }
export interface ScostamentoRiga { legameId: string; documento: { id: string; numeroTesto: string; dataDocumento: string }; tipoCorrezione: 'RETTIFICA' | 'ANNULLO' | 'CAMBIO_CER' | 'CAMBIO_CAUSALE'; quantitaFatturata: string | null; importoFatturato: string; quantitaAttuale: string | null; importoAttuale: string | null; soloQuantita: boolean }
export interface Pagina<T> { elementi: T[]; totale: number; pagina: number; dimensione: number }
// SegnalazioneVista { codice: string; messaggio: string; dettaglio?: string }; RigaDocumentoVista, RiepilogoIvaVista, RataVista con i campi delle tabelle §4.4-§4.5 in camelCase
```
`FatturazioneService`: un metodo per rotta del §11 tranne mappature e credenziali (`avvia`, `lista`,
`dettaglio`, `documentiElaborazione`, `ricalcola`, `scarta`, `escludi`, `riammetti`, `definitiva`,
`documenti`, `documento`, `annulla`, `storno`, `segnaEmesso`, `scaricaXml`, `pdf`, `esporta`,
`scostamenti`, `presaAtto`). `dimensione` di default 50, mai oltre 100. `permessiFatturazione(ruolo)`:
`{ vede, prepara, rendeDefinitiva, scaricaXml, imposta }` secondo spec §12.

- [ ] **Step 1: test.** un test per metodo con `HttpTestingController` (URL, metodo, corpo con importi come stringhe col punto, `confermaEmissione: true` su `scaricaXml` ed `esporta` non CSV, `responseType: 'blob'` per XML, PDF ed export); `dimensione 200 richiesta: il servizio manda 100`; vocabolario: `ogni stato, errore e avviso ha etichetta e severità`; permessi: `VIEWER vede soltanto; OPERATOR prepara; ADMIN e SUPER_ADMIN tutto`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS.
- [ ] **Step 5: commit** `feat(fatturazione): modelli, servizio e vocabolario frontend`.

## Task 15: normalizzatore dei testi e serializzatore XML FatturaPA (dominio, backend puro)

**Files:**
- Create: `src/domain/fatturazione/xml/normalizza-testo.ts`, `serializza-fattura.ts` (+ spec)

**Interfaces:**
- Produces:
```ts
export function normalizzaTesto(s: string, lunghezzaMassima: number): string   // traslittera in Latin di base + Latin-1, poi tronca; '€' → 'EUR', virgolette tipografiche → '"', lineette → '-', spazi multipli → uno
export interface DatiFatturaXml { trasmissione: { idPaese: 'IT'; idCodice: string; progressivoInvio: string; formato: 'FPR12' | 'FPA12'; codiceDestinatario: string; pecDestinatario: string | null }; cedente: FotografiaDocumento['cedente']; cessionario: FotografiaDocumento['cessionario']; generali: { tipoDocumento: string; data: string; numero: string; bollo: { importo: string } | null; importoTotale: string; causale: string[] }; contratto: { idDocumento: string | null; cig: string | null; cup: string | null } | null; fattureCollegate: { idDocumento: string; data: string } | null; linee: RigaDocumentoCalcolata[]; riepiloghi: RiepilogoIvaCalcolato[]; pagamento: { condizioni: 'TP01' | 'TP02'; rate: RataCalcolata[] } | null }
// FotografiaDocumento: Task 17; DocumentoPerXml = testata salvata + righe, riepiloghi, rate + fotografia
export function serializzaFattura(d: DatiFatturaXml): string   // UTF-8, ordine delle sequenze dell'XSD, nessuno spazio non significativo, importi col punto
export function datiFatturaDaDocumento(doc: DocumentoPerXml, progressivoFile: string): DatiFatturaXml   // dalla fotografia e dalle righe salvate
```
Lunghezze dell'XSD in una tabella costante con il nome del campo (es. `Denominazione` 80,
`Descrizione` 1000, `Causale` 200 per blocco). `ScontoMaggiorazione` `SC` con `Percentuale` per ogni
termine della cascata, nell'ordine. Il numero del FIR in `AltriDatiGestionali` con `TipoDato` `FIR`.

- [ ] **Step 1: test.** `normalizzaTesto("Società “Rossi” – 10 €", 80) = 'Società "Rossi" - 10 EUR'` (`à` è Latin-1 e resta); `"Łódź"` → `"Lodz"`; `testo di 90 caratteri con limite 80: 80`; `emoji e caratteri CJK: tolti`; `serializzaFattura deterministico: stessi dati → stessa stringa byte per byte`; `ordine degli elementi di DatiGeneraliDocumento come l'XSD`; `PECDestinatario solo con "0000000"`; `causale di 450 caratteri: 3 blocchi`; `sconto "10+5": due ScontoMaggiorazione SC 10.00 e 5.00`; `persona fisica: Nome e Cognome, nessuna Denominazione`; `TD04: DatiFattureCollegate con numero e data dell'origine`; `bollo: DatiBollo con BolloVirtuale SI e ImportoBollo 2.00`; `split: EsigibilitaIVA S nel riepilogo`; `caratteri speciali XML (&, <) escapati`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): normalizzatore e serializzatore XML FatturaPA (dominio)`.

## Task 16: validazione XSD con `xmllint-wasm` (backend, senza Postgres)

**Files:**
- Create: `src/infrastructure/fatturapa/valida-xsd.ts` (+ spec), `src/infrastructure/fatturapa/xsd/Schema_del_file_xml_FatturaPA_v1.2.x.xsd`, `xsd/xmldsig-core-schema.xsd`, `xsd/VERSIONI.md` (fonte, data, `sha256`), `src/infrastructure/fatturapa/esempi/` (XML dei test)
- Modify: `apps/backend/package.json` (`xmllint-wasm` a versione esatta), `nest-cli.json` o build per copiare `xsd/` nel `dist`

**Interfaces:**
- Consumes: Task 15.
- Produces:
```ts
export interface EsitoValidazioneXsd { valido: boolean; errori: string[] }   // errori dell'XSD senza contenuto dei campi
export async function validaFatturaPA(xml: string): Promise<EsitoValidazioneXsd>   // nessun accesso alla rete; schemaLocation di xmldsig riscritto sul file locale
```
**Step 0 (porta).** Prova che `xmllint-wasm` valida l'XSD FatturaPA con l'import di `xmldsig`. Se non
funziona, il task si ferma e segnala l'alternativa (`libxmljs2` o `xmllint` nel container) prima di
procedere (§17.3).

- [ ] **Step 1: test.** `sha256 dei due XSD uguale a VERSIONI.md`; `nessuna richiesta di rete durante la validazione` (rete finta che fallisce); validi: `FPR12 TD24`, `FPA12 con CIG, CUP e IdDocumento`, `TD04 con DatiFattureCollegate`, `split payment`, `bollo`, `cessionario persona fisica`, `300 righe`, `testi normalizzati da caratteri fuori Latin-1`; controprove: `manca CodiceDestinatario`, `Numero vuoto`, `ImportoTotaleDocumento con la virgola`, `Natura "N2"`, `elemento fuori ordine` → `valido: false` con messaggi; `messaggi d'errore senza i valori dei campi`; in CI, se `xmllint` di sistema è presente, gli stessi file danno lo stesso esito (test saltato senza).
- [ ] **Step 2-4:** FAIL → implementa → PASS; `npm run build` copia `xsd/` nel `dist`. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): validazione XSD FatturaPA senza rete`.

## Task 17: selezione e letture dell'elaborazione, guardia sul registro (Postgres pesante: volume)

**Files:**
- Create: `src/application/fatturazione/selezione-fatturazione.ts` (+ `.postgres.spec.ts`), `lock-fatturazione.ts`
- Modify: `src/application/legami-movimento/guardia-registro.spec.ts` (estesa a `src/application/fatturazione/**`), `src/test-support/fatturazione-di-test.ts` (`creaScenarioVolume`)

**Interfaces:**
- Consumes: `sqlCandidati` (`lista-legami.service.ts:224`), `sqlGiornoMovimento`, `periodoDaFatturare`, `destinatarioEffettivo`, `contoCorrenteEffettivo`, `bloccaListinoInCondivisione`, `bloccaRigheLegame`, `joinLineari`; Task 5 (`InputDocumento`).
- Produces:
```ts
export interface ParametriElaborazione { periodoDal: string; periodoAl: string; dataDocumento: string; raggruppamento: 'PER_CONTRATTO' | 'PER_ELENCO'; includiArretrati: boolean; filtri: FiltriElaborazione }
export interface DocumentoSelezionato { chiave: string; contrattoId: string; elencoId: string | null; clienteId: string; clienteFatturazioneId: string; registroIvaId: string | null; periodo: { dal: string; al: string }; input: InputDocumento; fotografia: FotografiaDocumento }
export interface SelezioneElaborazione { documenti: DocumentoSelezionato[]; erroriGenerali: Segnalazione<ErroreGenerale>[]; erroriPeriodo: { motivo: string; quanti: number; contrattoId: string | null }[]; versioni: Parameters<typeof improntaElaborazione>[0] }
export async function selezionaElaborazione(tx: Prisma.TransactionClient, tenantId: string, p: ParametriElaborazione): Promise<SelezioneElaborazione>   // sola lettura, nessun lock
export interface FotografiaDocumento { cedente: { denominazione: string; partitaIva: string; codiceFiscale: string | null; regimeFiscale: string; sede: { indirizzo: string; cap: string; comune: string; provincia: string | null; nazione: 'IT' }; rea: { ufficio: string; numero: string; capitaleSociale: string | null; socioUnico: 'SU' | 'SM' | null; statoLiquidazione: 'LN' | 'LS' } | null; idTrasmittente: string }; cessionario: { denominazione: string | null; nome: string | null; cognome: string | null; partitaIva: string | null; codiceFiscale: string | null; sede: { indirizzo: string; cap: string; comune: string; provincia: string | null; nazione: 'IT' } }; pagamento: { codice: string; descrizione: string; modalita: string; giorniRate: number[]; fineMese: boolean } | null; conto: { istituto: string | null; iban: string | null; bic: string | null } | null; testoFatturazione: string[]; cig: string | null; cup: string | null; idDocumento: string | null }
// lock-fatturazione.ts
export async function bloccaElaborazione(tx: Prisma.TransactionClient, tenantId: string, elaborazioneId: string): Promise<{ stato: StatoElaborazione; versione: number }>
export async function bloccaPerDefinitiva(tx: Prisma.TransactionClient, tenantId: string, s: { contrattoIds: string[]; elencoIds: string[]; rigaIds: string[]; legameIds: string[] }): Promise<void>   // contratti SHARE → elenchi SHARE → righe SHARE → legami e righe FOR UPDATE, tutti per id
```
Regole (spec §5.2): stati del contratto come D8 della 4.1; periodo effettivo da `periodoDaFatturare`;
allegati nel documento del principale con i valori del principale (Review Focus 4); legami
`CONFERMATO`, `fatturato_il IS NULL`, `movimento_vigente_id` = testa; `IMPORTATO_FATTURATO` mai;
arretrati solo con `includiArretrati`, altrimenti contati in `ARRETRATI_PRESENTI`; errori del periodo
dal frammento `sqlCandidati`, senza duplicarlo; registro: contratto → cliente → predefinito del
cedente, disattivato = `SENZA_REGISTRO_IVA`. Letture: una query per insieme (contratti, legami e
righe, listino, codici IVA, marcatori, clienti) con `= ANY($ids)`; nessuna query per documento.
`CEDENTE_INCOMPLETO`, `DATA_ANTERIORE_ULTIMA_FATTURA` (contro `ultima_data` letta senza lock) e
`LEGAMI_SENZA_CONTRATTO` negli errori generali.

- [ ] **Step 1: test (Postgres).** `contratto ATTIVO con 3 legami CONFERMATO nel periodo: un documento con 3 righe`; `legame già fatturato, ESCLUSO o IMPORTATO_FATTURATO: non selezionato`; `legame DA_RIALLINEARE (vigente ≠ testa): negli errori del periodo, non nel documento`; `legame PROPOSTO con contratto: avviso sul documento; senza contratto: LEGAMI_SENZA_CONTRATTO`; `SOSPESO: documento con CONTRATTO_SOSPESO`; `BOZZA e ANNULLATO: nessun documento`; `contratto con periodi mensili e intervallo 01/10-15/10: nessun documento (nessuna fine nell'intervallo)`; `intervallo 01/10-31/10: periodo effettivo del contratto`; `PER_ELENCO: un documento per elenco`; **`allegato con registro, condizione ed esigibilità diversi dal principale: un documento coi valori del principale e le righe dei due`** (Review Focus 4); `arretrati spenti: ARRETRATI_PRESENTI con il conteggio; accesi: legami precedenti inclusi fino a «fatturazione da»`; `registro IVA disattivato: SENZA_REGISTRO_IVA`; `cedente senza indirizzo: CEDENTE_INCOMPLETO`; `data documento prima di ultima_data: DATA_ANTERIORE_ULTIMA_FATTURA`; `filtri per cliente, contratto, categoria, registro`; `cliente di fatturazione diverso dal cliente del contratto: cessionario = cliente di fatturazione`; **volume:** `10.000 legami su 500 contratti: selezione sotto 5 s, numero di query costante (contato), piano generico forzato sotto 5 s`; `bloccaPerDefinitiva: un FOR UPDATE del listino tiene in attesa la selezione bloccante (barriera) e nessun deadlock con 20 coppie parallele listino/definitiva`; *guardia:* `nessun file di application/fatturazione scrive su waste_movements né prende pg_advisory_xact_lock o impostazioni_fatturazione FOR UPDATE`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`; fixture di volume a blocchi e pulizia per id). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): selezione dell'elaborazione, lock e guardia sul registro`.

## Task 18: elaborazione, coda e job di anteprima (Postgres)

**Files:**
- Create: `src/application/fatturazione/elaborazioni.service.ts`, `anteprima.ts` (+ spec, `.postgres.spec.ts`), `src/infrastructure/queue/jobs/fatturazione.job.ts` (+ spec, `.contesto.spec.ts`)
- Modify: `src/api/fatturazione/fatturazione.module.ts` (coda `fatturazione`, processor, servizi)

**Interfaces:**
- Consumes: Task 5, 7, 17.
- Produces:
```ts
export const CODA_FATTURAZIONE = 'fatturazione'
export interface JobFatturazione { tenantId: string; elaborazioneId: string; tipo: 'anteprima' | 'definitiva' }
export class ElaborazioniService {
  avvia(tenantId: string, utenteId: string, p: ParametriElaborazione): Promise<{ id: string }>   // 202; 400 DATA_FUTURA, PERIODO_NON_VALIDO; 409 ELABORAZIONE_IN_CORSO
  lista(tenantId: string, q: { pagina: number; dimensione: number; stato?: StatoElaborazione }): Promise<Pagina<ElaborazioneRiga>>
  dettaglio(tenantId: string, id: string): Promise<ElaborazioneDettaglio>
  documenti(tenantId: string, id: string, q: { pagina: number; dimensione: number; conErrori?: boolean }): Promise<Pagina<DocumentoRiga>>
  ricalcola(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
  scarta(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
  escludi(tenantId: string, id: string, documentoId: string, escluso: boolean): Promise<DocumentoRiga>
  chiediDefinitiva(tenantId: string, utenteId: string, id: string, b: { impronta: string; versione: number }): Promise<void>   // 202; usato dal Task 19
}
export async function eseguiAnteprima(prisma: PrismaService, tenantId: string, elaborazioneId: string): Promise<void>
```
Controlli dell'avvio (§5.1): `periodoDal ≤ periodoAl`, stesso anno solare; `dataDocumento ≥ periodoAl`
e non futura **sul giorno italiano** (`Europe/Rome`, Review Focus 3); cedente completo; nessuna
elaborazione `IN_CORSO` o `IN_DEFINITIVA` (indice unico: 23505 → 409 `ELABORAZIONE_IN_CORSO`). Il
job: `TenantContext.run({ tenantId })`; senza `tenantId` `UnrecoverableError` senza toccare il
database; `attempts: 2` per `anteprima`; `REPEATABLE READ` per la selezione; poi una transazione che
cancella le bozze dell'elaborazione e inserisce documenti, righe, riepiloghi e rate con
`createMany`, scrive `impronta` e `riepilogo` e passa a `ANTEPRIMA_PRONTA`. Errore: `FALLITA`,
`errore_tecnico` (≤ 200, senza dati personali), `segnalaErroreJob`.

- [ ] **Step 1: test (unit + Postgres).** `avvio valido: 202, IN_CODA, job accodato con tenantId ed elaborazioneId`; `periodo a cavallo d'anno: 400`; `dataDocumento < periodoAl: 400`; **`dataDocumento = oggi alle 00:30 ora italiana (23:30 UTC di ieri): accettata; domani: 400 DATA_FUTURA`** (orologio finto); `seconda elaborazione mentre una è IN_CORSO: 409 ELABORAZIONE_IN_CORSO`; `cedente incompleto: 400 con CEDENTE_INCOMPLETO`; `anteprima: bozze con righe, riepiloghi, rate, errori, avvisi; impronta di 64 caratteri; legami invariati (stato, versione, fatturato_il)`; `numerazione prevista «da 15/A a 42/A» senza toccare numerazioni_fattura`; `ricalcola: le bozze precedenti spariscono, nessun duplicato`; **`job anteprima che fallisce a metà e viene ritentato: un solo insieme di bozze`**; `scarta: SCARTATA, bozze cancellate`; `escludi e riammetti: escluso_da_definitiva; su un DEFINITIVO 409`; `ricalcola o scarta su IN_DEFINITIVA: 409`; *contesto:* `job senza tenantId: UnrecoverableError, nessuna query`; `job con il tenant di un'altra azienda: non vede l'elaborazione (RLS), FALLITA non scritta su un altro tenant`; `lista e documenti: dimensione 101 rifiutata dal DTO (Task 25), qui il servizio accetta fino a 100`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): elaborazione, coda e job di anteprima`.

## Task 19: definitiva in una transazione (Postgres pesante: concorrenza e volume)

**Files:**
- Create: `src/application/fatturazione/definitiva.ts` (+ `.postgres.spec.ts`)
- Modify: `fatturazione.job.ts` (ramo `definitiva`, `attempts: 1`), `elaborazioni.service.ts` (`chiediDefinitiva`)

**Interfaces:**
- Consumes: Task 5, 8 (`riservaNumeri`), 17 (`bloccaElaborazione`, `bloccaPerDefinitiva`, `selezionaElaborazione`), 18.
- Produces:
```ts
export const OPZIONI_TRANSAZIONE_DEFINITIVA = { timeout: 120_000, maxWait: 10_000 } as const
export type EsitoDefinitiva = { esito: 'DEFINITIVA'; documenti: number; numeri: NumeriRiservati[] } | { esito: 'ANTEPRIMA_SUPERATA'; differenze: { nuovi: number; cambiati: number; fatturatiDaAltri: number } }
export async function eseguiDefinitiva(prisma: PrismaService, tenantId: string, elaborazioneId: string, utenteId: string): Promise<EsitoDefinitiva>
```
Passi (spec §5.4), una transazione:
```text
lock_timeout 5s; statement_timeout 60s
1. bloccaElaborazione: ANTEPRIMA_PRONTA e stessa versione → IN_DEFINITIVA (altrimenti 409 ELABORAZIONE_GIA_IN_DEFINITIVA)
2. documenti candidati = bozze non escluse e senza errori; 0 → 409 NESSUN_DOCUMENTO_DEFINIBILE; > 500 → 400 TROPPI_DOCUMENTI
3. riservaNumeri per (registro, anno di dataDocumento)          // numerazioni FOR UPDATE prima dei contratti
4. bloccaPerDefinitiva sugli id delle bozze candidate
5. selezionaElaborazione sotto lock + improntaElaborazione ≠ impronta → rollback; seconda transazione breve: ANTEPRIMA_PRONTA + errore ANTEPRIMA_SUPERATA con differenze
6. calcolaDocumento per ogni candidato; importi ≠ bozza → rollback, errore interno, segnalaErroreJob
7. ordine: registro, ragione sociale del cliente di fatturazione, id del cliente, numero del contratto, codice dell'elenco; numeri da..a in quell'ordine
8. UPDATE documenti FROM unnest (stato, numero, numero_testo, fotografia, definito_*); UPDATE righe FROM unnest (movimento_fatturato_id);
   UPDATE legami FROM unnest (FATTURATO, fatturato_il, documento_id, riferimento_fattura «<numero_testo> del gg/mm/aaaa», versione+1);
   INSERT marcatori (23505 → 409 DOPPIA_FATTURAZIONE, rollback totale)
9. elaborazione DEFINITIVA, definita_*; audit: una riga per documento (id, numero, totale) e una per l'elaborazione
```

- [ ] **Step 1: test (Postgres, `application_name` = `fatt-t19-${pid}`).** `definitiva: numeri consecutivi per registro nell'ordine del passo 7, legami FATTURATO con documento_id e riferimento_fattura, marcatori scritti, elaborazione DEFINITIVA`; `documenti con errori o esclusi: restano BOZZA`; **`tutti esclusi o con errori: 409 NESSUN_DOCUMENTO_DEFINIBILE, numerazioni invariate, ANTEPRIMA_PRONTA`** (Review Focus 2); `501 documenti: 400 TROPPI_DOCUMENTI`; `impronta diversa (un legame confermato dopo l'anteprima): ANTEPRIMA_SUPERATA con nuovi 1, bozze intatte, nessun numero`; **atomicità:** `guasto iniettato dopo riservaNumeri e prima del commit: nessun numero consumato, nessun legame FATTURATO, nessun marcatore, ANTEPRIMA_PRONTA`; **doppio clic:** `due chiediDefinitiva con la stessa versione: un 202 e un 409 ELABORAZIONE_GIA_IN_DEFINITIVA; due job: uno solo arriva a DEFINITIVA`; **concorrenza:** `8 definitive in parallelo su 8 tenant: nessuna attesa reciproca (sessioni in Lock = 0)`; `due elaborazioni pronte dello stesso tenant sugli stessi legami, definitive una dopo l'altra: la seconda ANTEPRIMA_SUPERATA con fatturatiDaAltri; su legami diversi dello stesso registro: numeri successivi, mai doppioni`; *con la 4.3:* `conferma concorrente di un legame della definitiva: 409 OPERAZIONE_CONCORRENTE dopo 5 s oppure FATTURATO dopo il commit`; `rettifica di un movimento nella definitiva: la rettifica riesce sempre; il legame finisce con scostamento oppure DA_RIALLINEARE`; `«Aggiorna prezzi» dopo il commit: salta i FATTURATO`; `modifica del listino durante la definitiva: aspetta il commit (barriera), poi l'anteprima aperta ha impronta superata`; `registrazione di un movimento nuovo durante la definitiva: non aspetta oltre 2 s`; **marcatori:** `due elaborazioni sullo stesso periodo di un canone: la seconda non lo fattura`; `marcatore già presente scritto fra anteprima e definitiva: 409 DOPPIA_FATTURAZIONE, rollback`; **invariante:** dopo ogni prova `numeri dei DEFINITIVO = numero_partenza+1 .. ultimo_numero` per ogni coppia; **volume:** `10.000 legami e 500 documenti: definitiva entro 120 s, misure nel rapporto; piano generico sulle query unnest`; *RLS:* `job col tenant sbagliato non vede né scrive nulla`.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): definitiva atomica con numerazione, legami fatturati e marcatori`.

## Task 20: annullo e nota di credito di storno (Postgres pesante: concorrenza)

**Files:**
- Create: `src/application/fatturazione/annullo-storno.service.ts` (+ spec, `.postgres.spec.ts`)

**Interfaces:**
- Consumes: Task 8 (`bloccaNumerazioni`, `riservaNumeri`, `rilasciaUltimo`), Task 6 (trigger).
- Produces:
```ts
export class AnnulloStornoService {
  annulla(tenantId: string, utenteId: string, documentoId: string, b: { motivo: string; versione: number }): Promise<DocumentoDettaglio>   // 409 ANNULLO_NON_AMMESSO { details: { motivo: 'NON_ULTIMO' | 'EMESSO' | 'NON_DEFINITIVO' } }
  storna(tenantId: string, utenteId: string, documentoId: string, b: { motivo: string; dataDocumento: string; rifatturabile: boolean; versione: number }): Promise<DocumentoDettaglio>   // il TD04 creato; 409 STORNO_GIA_PRESENTE
  annullabilita(d: { stato: StatoDocumento; emessoIl: Date | null; numero: number | null; ultimoNumero: number }): { annullabile: boolean; motivo: string | null }   // pura, usata dalle viste
}
export async function ripristinaLegamiDelDocumento(tx: Prisma.TransactionClient, tenantId: string, documentoId: string): Promise<number>   // §5.5 passo 7, UPDATE … FROM righe del documento
```
Annullo (§5.5): numerazione → documento → legami (`FOR UPDATE` per id) → `ANNULLATO` →
`rilasciaUltimo` → marcatori del documento cancellati → `ripristinaLegamiDelDocumento`
(`CONFERMATO`, `fatturato_il`, `documento_id`, `riferimento_fattura` nulli,
`scostamento_dopo_fattura` falso, `scostamento_gestito_*` nulli, `movimento_vigente_id :=
movimento_fatturato_id`) → audit. Storno (§5.6): numerazione → origine → legami; `dataDocumento`
non futura sul giorno italiano e ≥ `ultima_data`; TD04 `DEFINITIVO` con numero successivo, stesse
righe coi tipi dell'origine (P6), stessi riepiloghi e rate;
`documento_origine_id`; con `rifatturabile` ripristino come l'annullo, altrimenti legami `FATTURATO`
e scostamenti segnati gestiti con nota «storno documento <numero_testo>» (S20).

- [ ] **Step 1: test (Postgres).** `annullo dell'ultimo non emesso: ANNULLATO, ultimo_numero − 1, legami CONFERMATO con movimento_vigente_id = movimento fatturato, marcatori tolti`; `annullo di un numero intermedio: 409 NON_ULTIMO con messaggio «usa la nota di credito di storno»`; `annullo di un emesso: 409 EMESSO`; `motivo vuoto o 201 caratteri: 400`; `annullo con scostamento: legame CONFERMATO, poi la lista della 4.3 lo mostra DA_RIALLINEARE e «Riallinea» lo porta alla testa`; `numero annullato riusato dalla definitiva successiva`; `storno: TD04 col numero successivo, importi positivi, stesse righe, DatiFattureCollegate; origine resta DEFINITIVO`; `storno rifatturabile: legami CONFERMATO e marcatori tolti; non rifatturabile: legami FATTURATO, scostamento gestito con nota`; `secondo storno: 409 STORNO_GIA_PRESENTE`; **`storno con data prima di ultima_data: 409 DATA_ANTERIORE_ULTIMA_FATTURA; con data di domani: 400 DATA_FUTURA; nulla scritto, legami invariati`** (Review Focus 5); `storno di un BOZZA o di un TD04: 409`; **concorrenza:** `annullo contro definitiva sullo stesso registro: si serializzano sulla numerazione (barriera), nessun doppione, invariante valida`; `storno contro definitiva: idem`; `due annulli dello stesso documento: un 200 e un 409`; `VERSIONE_SUPERATA`; audit senza dati personali.
- [ ] **Step 2-4:** FAIL → implementa → PASS (sotto `flock`). Fine task backend.
- [ ] **Step 5: commit** `feat(fatturazione): annullo dell'ultimo numero e nota di credito di storno`.

## Task 21: scostamenti e presa d'atto (Postgres)

**Files:**
- Create: `src/domain/fatturazione/scostamento.ts` (+ spec), `src/application/fatturazione/scostamenti.service.ts` (+ `.postgres.spec.ts`)

**Interfaces:**
- Produces:
```ts
export function valoreAttualeScostamento(i: { fatturato: { quantita: string | null; prezzoTotale: string; prezzoUnitario: string; sconto: string | null; tipoRiga: TipoRigaDocumento }; testa: { quantita: string | null; annullato: boolean } }): { quantitaAttuale: string | null; importoAttuale: string | null; soloQuantita: boolean }
export class ScostamentiService {
  lista(tenantId: string, q: { pagina: number; dimensione: number; clienteId?: string }): Promise<Pagina<ScostamentoRiga>>
  presaAtto(tenantId: string, utenteId: string, legameId: string, b: { nota: string; versione: number }): Promise<void>   // 409 SCOSTAMENTO_NON_APERTO
}
```
Lista: legami `FATTURATO` con `scostamento_dopo_fattura` e `scostamento_gestito_il IS NULL`; letture
per pagina con `= ANY(ids)`, non per tenant dopo `joinLineari`. Tipo di correzione dalla testa
della catena. Riga a prezzo speciale: `soloQuantita`, importo null.

- [ ] **Step 1: test.** `rettifica da 1000 a 1200 kg a 0.10: fatturato 100.00, attuale 120.00`; `annullo del movimento: attuale 0.00, tipo ANNULLO`; `riga FASCIA_SPECIALE: soloQuantita, importo null`; `lista: solo gli scostamenti non gestiti, ordinati per data del documento`; `presa d'atto con nota: sparisce dalla lista, colonne gestito_* scritte, audit`; `nota vuota o 201 caratteri: 400`; `presa d'atto su un legame senza scostamento: 409`; `VIEWER e OPERATOR: 403 (Task 25)`; `200.000 movimenti nel tenant: pagina sotto 1 s con EXPLAIN senza Seq Scan sui movimenti`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): lista degli scostamenti e presa d'atto`.

## Task 22: pulizia delle bozze, job orfani e sonda della numerazione (Postgres)

**Files:**
- Create: `src/application/fatturazione/manutenzione-fatturazione.ts` (+ `.postgres.spec.ts`), `src/infrastructure/jobs/fatturazione-manutenzione.job.ts` (+ spec)
- Modify: `src/application/admin/system-health/evidenze-db.service.ts` (sonda), `fatturazione.module.ts`

**Interfaces:**
- Produces:
```ts
export async function pulisciBozzeTenant(tx: Prisma.TransactionClient, tenantId: string, ora: Date): Promise<number>   // SCARTATA/FALLITA > 7 giorni, ANTEPRIMA_PRONTA > 30
export async function recuperaOrfaniTenant(tx: Prisma.TransactionClient, tenantId: string, jobAttivi: ReadonlySet<string>): Promise<number>   // IN_DEFINITIVA o IN_CORSO senza job attivo → ANTEPRIMA_PRONTA (o FALLITA se mai pronta) con avviso
// system-health: violazioniNumerazione(): Promise<{ tenantId: string; violazioni: number }[]>   funzione SQL del ruolo di sistema, solo conteggi
```
Cron giornaliero: tenant da `PrismaSistemaService` con `escludiPiattaforma`, come
`RentriRiconciliazioneJob` (`rentri-riconciliazione.job.ts:44`); una transazione per tenant nel suo
contesto; un errore su un tenant non ferma gli altri; mai un `DELETE` fra tenant. Gli orfani si
controllano anche all'avvio del modulo.

- [ ] **Step 1: test.** `bozze di una SCARTATA di 8 giorni: cancellate; di 6: restano`; `ANTEPRIMA_PRONTA di 31 giorni: bozze cancellate, elaborazione SCARTATA`; `DEFINITIVO mai toccato`; `due tenant: errore iniettato sul primo, il secondo pulito`; `IN_DEFINITIVA senza job: ANTEPRIMA_PRONTA con avviso`; `IN_DEFINITIVA con job attivo: invariata`; `sonda: un buco iniettato col proprietario (numero 3 mancante) → 1 violazione per quel tenant, nessun dato oltre al conteggio`; `il ruolo applicativo non può chiamare la funzione della sonda`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): pulizia delle bozze, job orfani e sonda della numerazione`.

## Task 23: XML del documento, progressivo del file ed emissione (Postgres)

**Files:**
- Create: `src/application/fatturazione/xml-documento.service.ts` (+ spec, `.postgres.spec.ts`)

**Interfaces:**
- Consumes: Task 15, 16; `contatori_file_fatturapa`.
- Produces:
```ts
export function progressivoBase36(n: number): string   // 1 → "00001", 36 → "00010"; > 36^5 − 1 → errore
export class XmlDocumentoService {
  xml(tenantId: string, utenteId: string, documentoId: string, b: { confermaEmissione?: boolean }): Promise<{ nomeFile: string; contenuto: Buffer; sha256: string }>   // 400 CONFERMA_EMISSIONE_RICHIESTA se non emesso e senza conferma; 422 XML_NON_VALIDO
  zip(tenantId: string, utenteId: string, documentoIds: string[], b: { confermaEmissione: boolean }): Promise<Buffer>
  segnaEmesso(tenantId: string, utenteId: string, documentoId: string, versione: number): Promise<DocumentoDettaglio>
}
```
Prima richiesta (§7.2): transazione A solo su `contatori_file_fatturapa FOR UPDATE` → nuovo
progressivo; transazione B: documento `FOR UPDATE`; se `xml` già presente restituisce i byte salvati
(il progressivo della A resta inutilizzato: è un nome di file, non un numero fiscale); altrimenti
genera, valida, salva `xml`, `xml_sha256`, `xml_generato_il`, `progressivo_file` ed `emesso_il` se
nullo. Validazione fallita: nulla salvato, 422 con i messaggi dell'XSD, log senza dati personali.
Solo `DEFINITIVO` o `ANNULLATO` (l'annullato non diventa emesso). Nome `IT<partita IVA>_<progressivo>.xml`.

- [ ] **Step 1: test.** `progressivoBase36(1) = "00001"`, `(35) = "0000Z"`, `(36) = "00010"`; `prima richiesta con conferma: XML valido, emesso_il scritto, audit di emissione`; `senza conferma su un non emesso: 400`; `seconda richiesta: stessi byte e stesso sha256, nessun progressivo nuovo`; **`due richieste parallele sullo stesso documento: stessi byte, un solo progressivo salvato, un solo audit di emissione`** (Review Focus 1); `XML che non passa l'XSD (dato corrotto col proprietario): 422, nulla salvato`; `BOZZA: 409`; `cliente modificato dopo la definitiva: l'XML usa la fotografia`; `zip di 3 documenti: 3 file con i nomi giusti, tutti emessi`; `«Segna come emesso»: emesso_il, poi annullo 409 EMESSO`; `contatore di un tenant non bloccato da un altro tenant`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): XML del documento, progressivo del file ed emissione`.

## Task 24: export CSV (Postgres)

**Files:**
- Create: `src/application/fatturazione/export-csv.ts` (+ spec), `export.service.ts` (+ `.postgres.spec.ts`)

**Interfaces:**
- Produces:
```ts
export function cellaCsv(v: string | null): string            // "…" con i doppi apici raddoppiati
export function importoCsv(v: string): string                 // "1234.50" → "1234,50", niente migliaia
export function dataCsv(iso: string): string                  // "2026-11-05" → "05/11/2026"
export function testateCsv(d: readonly DocumentoPerExport[]): string; export function righeCsv(d: readonly DocumentoPerExport[]): string   // BOM + intestazione + righe, separatore ";", "\r\n"
export interface SelezioneExport { registroIvaId?: string; anno?: number; numeroDa?: number; numeroA?: number; dataDa?: string; dataA?: string; clienteId?: string; documentoIds?: string[]; elaborazioneId?: string }
export class ExportService { esporta(tenantId: string, utenteId: string, b: { formato: string; selezione: SelezioneExport; confermaEmissione?: boolean }): Promise<{ nomeFile: string; contentType: string; contenuto: Buffer }> }   // CSV → zip, XML_ZIP → Task 23, adattatori → Task 29-30
```
Allineamento a `exportToCsv` (`permission-audit-log.repository.ts:512`) e
`audit.controller.ts:161-172`, con le differenze di S21. Le bozze solo con `elaborazioneId` e nome
che contiene `ANTEPRIMA`. Il CSV non scrive `emesso_il` (S18). Tetto: 5000 documenti per export
(scelta di piano, 400 `TROPPI_DOCUMENTI` oltre).

- [ ] **Step 1: test.** `cellaCsv('a"b') = '"a""b"'`; `importoCsv("1234.50") = "1234,50"`; `testate.csv comincia con il BOM e ha l'intestazione in prima riga`; `righe.csv ripete numero, data e cliente`; `ANNULLATO esportato con lo stato`; `CSV di bozze: nome con ANTEPRIMA`; `CSV non cambia emesso_il`; `selezione per registro, anno, intervallo di numeri e di date, cliente`; `audit dell'export con formato e conteggio`; `formato sconosciuto: 400`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): export CSV dei documenti`.

## Task 25: API della fatturazione (controller, DTO, ruoli) — backend, senza Postgres

**Files:**
- Create: `src/api/fatturazione/{elaborazioni.controller,documenti-fattura.controller,scostamenti.controller}.ts`, `dto/{nuova-elaborazione,lista-elaborazioni,definitiva,escludi,lista-documenti,annulla,storno,emissione,export,lista-scostamenti,presa-atto}.dto.ts`, spec `*.controller.spec.ts`, `fatturazione.controller.http.spec.ts`
- Modify: `fatturazione.module.ts`

**Interfaces:** rotte e ruoli di spec §11-§12 tranne mappature, invio e credenziali. Corpi e risposte
coi nomi del Task 14. `POST /legami-movimento/:id/presa-atto-scostamento` sta in
`scostamenti.controller.ts`. Download con `StreamableFile`, `Content-Type` e `Content-Disposition:
attachment`.

- [ ] **Step 1: test.** `ogni rotta ha @Roles esplicito` (riflessione sui tre controller più cedente e numerazioni); matrice §12: `VIEWER 200 su GET, PDF e export CSV; 403 su xml, export XML_ZIP, avvia, definitiva, annulla, storno, emesso, presa d'atto`; `OPERATOR 200 su avvia, ricalcola, scarta, escludi; 403 su definitiva, annulla, storno, emesso, xml, presa d'atto`; `ADMIN e SUPER_ADMIN: 200`; `POST xml senza confermaEmissione: 400`; `export CSV con confermaEmissione: ignorata, nessuna emissione`; `dimensione 101: 400; pagina 0: 400`; `id non UUID: 400`; `date "05/11/2026": 400 (solo AAAA-MM-GG)`; `filtri con più di 200 id: 400`; `motivo oltre 200: 400`; `tenant dal request, mai dal corpo`; `errori con error, message e details numerici`; `controller-tenant-selezionato.spec.ts e nessun-user-userid.spec.ts verdi`; `nomi dei campi delle risposte uguali ai tipi di fatturazione.model.ts` (confronto delle chiavi su una risposta di esempio per tipo).
- [ ] **Step 2-4:** FAIL → implementa → PASS (HTTP spec con servizi finti). **Step 5: commit** `feat(fatturazione): API delle elaborazioni, dei documenti e degli scostamenti`.

## Task 26: e2e 4.4b via API (Playwright, Postgres)

**Files:**
- Create: `e2e/tests/fatturazione/fatturazione-api.spec.ts`, `e2e/utils/fatturazione-api.ts`

- [ ] **Step 1: scenario** (azienda propria in `beforeAll`: cedente completo, registro IVA, cliente con P.IVA valida, contratto ATTIVO, elenco con riga CER a 0.10 e una riga F con scadenza nel periodo, `fatturazione_da` oggi-60, movimenti `INGRESSO_ESTERNO` registrati via API con legame confermato; pulizia per id): `elaborazione completa: avvio 202, attesa ANTEPRIMA_PRONTA, documento con righe MOVIMENTO e FISSO`; `definitiva: numeri 1..n, legami FATTURATO`; `XML con conferma: valido (validazione lato test con il servizio del Task 16), documento emesso`; `annullo dell'ultimo non emesso: ANNULLATO, numero rilasciato`; `rettifica di un movimento fatturato → scostamento in lista → storno rifatturabile → riallineamento → nuova elaborazione e definitiva`; `ANTEPRIMA_SUPERATA: un movimento confermato dopo l'anteprima`; `VIEWER 403 su avvio e xml, OPERATOR 403 su definitiva`; `export CSV`.
- [ ] **Step 2: verifica completa** sotto `flock`: `test:cov`, `tsc`, eslint, suite Postgres dei Task 17-24 + `rls-catalogo` (76) + suite dei legami; Karma una volta (Task 14); confronto con la linea di base.
- [ ] **Step 3: commit** `test(fatturazione): e2e API e chiusura 4.4b`.

## Task 27: revisione dell'intero branch — 4.4b

**File:** nessuno.

- [ ] **Step 1:** revisore opus fresco (`typescript-nestjs-reviewer`). Controlli espliciti: ordine dei lock identico in definitiva, annullo, storno e XML (grep di `FOR UPDATE`/`FOR SHARE` nel modulo); nessun lock del registro, di radice o di `impostazioni_fatturazione FOR UPDATE`; nessuna query per tenant dopo `joinLineari`, `enable_nestloop` ripristinato; nessun ciclo di UPDATE singoli; una sola transazione nella definitiva; job nel contesto dell'azienda con `UnrecoverableError` senza tenant; trigger mai aggirato; XML mai salvato senza XSD; `@Max(100)` su ogni lista; audit senza dati personali; i cinque punti di Review Focus col loro test; DTO coi nomi del Task 14. Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-4b-report.md`; PR 4.4b, merge, deploy (nessuna migration nuova). Nota in `ops/README.md`: nessuna azienda avvia una definitiva prima della 4.4c in produzione (come la decisione 22 della 4.3), da confermare con Graziano.

---

# Pezzo 4.4c — interfaccia, PDF e adattatore TeamSystem

Da master dopo il merge della 4.4b. **Prima del Task 30:** Graziano indica l'installazione TeamSystem
reale di un cliente per la prova d'import (§17.10).

## Task 28: PDF di cortesia (backend)

**Files:**
- Create: `src/application/fatturazione/pdf-cortesia.ts` (+ spec)
- Modify: `src/api/fatturazione/documenti-fattura.controller.ts` (`GET /documenti-fattura/:id/pdf`, `RUOLI_LETTURA`), `fatturazione.module.ts`

**Interfaces:**
- Produces: `export function definizionePdf(doc: DocumentoDettaglio, fotografia: FotografiaDocumento, bozza: boolean): TDocumentDefinitions` (pura, testabile senza rendering); `export async function generaPdf(def: TDocumentDefinitions): Promise<Buffer>`. Dati salvati, mai l'XML. Intestazione fissa «Copia di cortesia: l'originale è il file XML»; filigrana «ANTEPRIMA» sulle bozze. Importi `it-IT`.

- [ ] **Step 1: test.** `definizione con intestazione, cedente, cessionario, righe, riepiloghi, rate, totali`; `bozza: filigrana ANTEPRIMA`; `importi "1.234,50"`; `300 righe: PDF generato sotto 3 s`; `GET pdf non cambia emesso_il`; `VIEWER: 200`; `PDF di un altro tenant: 404`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): copia di cortesia in PDF`.

## Task 29: interfaccia degli adattatori e mappature (Postgres, migration pesante)

**Files:**
- Create: `src/application/fatturazione/adattatori/{adattatore-export-contabile,registro-adattatori,mappature.service}.ts` (+ spec, `.postgres.spec.ts`), `src/api/fatturazione/export-contabile.controller.ts`, `dto/mappature.dto.ts`, `prisma/migrations/20261106100000_fatturazione_mappature/migration.sql`
- Modify: `prisma/schema.prisma` (`MappaturaExportContabile`), `prisma-rls.extension.ts`, `rls-catalogo` (76 → 77), `README-tenant-transazione.md`, `ops/README.md`, `export.service.ts` (formato = codice dell'adattatore), `fatturazione.module.ts`

**Interfaces:**
- Produces (spec §7.3, interfaccia completa già per la 4.4d):
```ts
export type TipoMappatura = 'CODICE_IVA' | 'CONTO_RICAVI' | 'CLIENTE' | 'PAGAMENTO' | 'REGISTRO'
export interface ChiaveMancante { tipo: TipoMappatura; chiaveWasteflow: string; etichetta: string }
export interface FileGenerato { nome: string; contentType: string; contenuto: Buffer }
export interface EsitoInvio { documentoId: string; ok: boolean; riferimento?: string; errore?: string }
export interface AdattatoreExportContabile {
  readonly codice: string; readonly nome: string; readonly modalita: 'FILE' | 'API'
  mappatureRichieste(documenti: readonly DocumentoPerExport[]): { tipo: TipoMappatura; chiaveWasteflow: string; etichetta: string }[]
  genera?(documenti: readonly DocumentoPerExport[], mappature: ReadonlyMap<string, string>): FileGenerato[]
  invia?(documenti: readonly DocumentoPerExport[], mappature: ReadonlyMap<string, string>, credenziali: unknown): Promise<EsitoInvio[]>
}
export const ADATTATORI_EXPORT = Symbol('ADATTATORI_EXPORT')   // provider multi del modulo
export class RegistroAdattatori { tutti(): AdattatoreExportContabile[]; trova(codice: string): AdattatoreExportContabile }   // 400 ADATTATORE_SCONOSCIUTO
export class MappatureService { lista(tenantId: string, adattatore: string): Promise<MappaturaVista[]>; imposta(tenantId: string, utenteId: string, adattatore: string, voci: { tipo: TipoMappatura; chiaveWasteflow: string; valore: string | null }[]): Promise<MappaturaVista[]>; mancanti(tenantId: string, adattatore: string, documenti: readonly DocumentoPerExport[]): Promise<ChiaveMancante[]> }
// GET/PUT /export-contabile/:adattatore/mappature   RUOLI_AMMINISTRATORI
```
Tabella `mappature_export_contabile`: `tenant_id`, `adattatore varchar(30)`, `tipo`,
`chiave_wasteflow varchar(100)`, `valore varchar(50)`, `versione`, `modificato_da`; unico
`(tenant_id, adattatore, tipo, chiave_wasteflow)`; RLS ENABLE+FORCE. Export via adattatore:
mappature mancanti → 409 `MAPPATURE_MANCANTI` con l'elenco in `details`, nessun file; riuscito →
documenti emessi come l'XML (decisione 12).

- [ ] **Step 1: test.** schema e RLS come nel Task 6 (`rls-catalogo` 77); `registro con un adattatore finto: trova, sconosciuto 400`; `imposta e lista`; `valore null cancella la voce`; `mancanti: elenca solo le chiavi dei documenti scelti`; `export con mappature mancanti: 409 MAPPATURE_MANCANTI, nessun emesso_il`; `export riuscito con adattatore finto FILE: documenti emessi, audit`; `OPERATOR 403 sulle mappature`; `PUT con 501 voci: 400`.
- [ ] **Step 2-4:** FAIL → implementa → migration con le verifiche del Task 6 → PASS. **Step 5: commit** `feat(fatturazione): interfaccia degli adattatori e mappature per tenant`.

## Task 30: adattatore TeamSystem (backend)

**Files:**
- Create: `winwaste/docs/export-teamsystem-tracciato.md` (Step 0, P4), `src/application/fatturazione/adattatori/teamsystem.adattatore.ts` (+ spec), `adattatori/riferimenti/teamsystem-*.txt` (file attesi scritti a mano dal tracciato)
- Modify: `fatturazione.module.ts` (provider dell'adattatore)

**Interfaces:**
- Consumes: Task 29.
- Produces: `TeamSystemAdattatore implements AdattatoreExportContabile` con `codice = 'TEAMSYSTEM'`, `modalita = 'FILE'`; `campoFisso(valore: string, lunghezza: number, allineamento: 'S' | 'D', riempimento: ' ' | '0'): string` puro; un file di testo a record fissi con testata e righe secondo `cTeamSystemRec1/2` (`TIPRIGA 1` imponibili per conto, `2`, `3`, `K` IVA, scadenze, CIG/CUP).

- [ ] **Step 0: tracciato.** Ricostruzione dei record `cTeamSystemRec1/2` (posizione, lunghezza, tipo, allineamento di ogni campo `TRF_*`) da `WWNET31.FrmExportTeamSystem :995-1423` con l'agente REA, in `winwaste/docs/export-teamsystem-tracciato.md`. Senza tracciato completo il task si ferma.
- [ ] **Step 1: test.** `campoFisso("ABC", 5, "S", " ") = "ABC  "`; `("12", 5, "D", "0") = "00012"`; `valore più lungo: troncato`; `file di un documento con 2 aliquote uguale byte per byte al riferimento scritto a mano`; `TD04: segno o causale come da tracciato`; `ogni riga della lunghezza del record`; `mappature richieste: codici IVA, conti ricavi per categoria, cliente, pagamento`; `caratteri fuori ASCII normalizzati`.
- [ ] **Step 2-4:** FAIL → implementa → PASS. **Step 5: commit** `feat(fatturazione): adattatore TeamSystem a record fissi`.

## Task 31: frontend — menu, elaborazioni e «Nuova elaborazione»

**Files:**
- Create: `fe/features/fatturazione/fatturazione.routes.ts`, `elaborazioni/elaborazioni-lista.component.ts` (+ spec, `.dom.spec.ts`), `elaborazioni/nuova-elaborazione-dialog.component.ts` (+ spec)
- Modify: `fe/app.routes.ts` (`fatturazione`, `loadChildren`), `fe/shared/components/layout.component.ts` (menu «Fatturazione» accanto a «Da collegare»)

**Interfaces:** Consumes Task 14. Rotte figlie: `elaborazioni`, `elaborazioni/:id`, `documenti`,
`documenti/:id`, `scostamenti`, `export-contabile/:adattatore` (ognuna aggiunta dal suo task).

- [ ] **Step 1: test.** `tabella con data, periodo, stato (badge da vocabolario), documenti, totale it-IT, errori`; `paginazione con dimensione ≤ 100`; `«Nuova elaborazione» solo per OPERATOR, ADMIN, SUPER_ADMIN`; `dialog: periodo, data documento con maxDate = fine del giorno ricalcolata all'apertura, raggruppamento, arretrati, filtri cliente e contratto con ricerca lato server (dimensione 25)`; `periodo a cavallo d'anno: errore nel dialog`; `409 ELABORAZIONE_IN_CORSO: messaggio`; `dopo l'avvio: navigazione al dettaglio`.
- [ ] **Step 2-4:** FAIL → implementa → Karma una volta + build + eslint → PASS. **Step 5: commit** `feat(fatturazione): menu, lista delle elaborazioni e nuova elaborazione`.

## Task 32: frontend — anteprima e definitiva

**Files:**
- Create: `fe/features/fatturazione/elaborazioni/anteprima.component.ts` (+ spec, `.dom.spec.ts`), `documento-anteprima-dialog.component.ts` (+ spec), `conferma-definitiva-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`

**Interfaces:** Consumes Task 14. Schede «Documenti», «Errori del periodo», «Numerazione prevista»;
barra «Ricalcola», «Scarta», «Rendi definitiva»; aggiornamento periodico ogni 3 s finché lo stato è
`IN_CODA`, `IN_CORSO` o `IN_DEFINITIVA`, fermato alla distruzione.

- [ ] **Step 1: test.** `documenti con imponibile, IVA, totale, errori e avvisi; esclusione e riammissione per riga`; `dialog del documento con righe, riepilogo IVA, rate e link al PDF`; `errori del periodo raggruppati per motivo con link a /legami/da-collegare filtrata per periodo e contratto`; `numerazione prevista «da 15/A a 42/A»`; `conferma: «Verranno emessi N documenti, numeri da X a Y del registro R, data gg/mm/aaaa»; Rendi definitiva solo ADMIN`; `ANTEPRIMA_SUPERATA: messaggio con le differenze e «Ricalcola»`; `polling fermato a ANTEPRIMA_PRONTA e alla chiusura della pagina`; `FALLITA: messaggio senza dettagli tecnici`; `VIEWER: nessuna azione`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): anteprima e definitiva`.

## Task 33: frontend — documenti, export e azioni

**Files:**
- Create: `fe/features/fatturazione/documenti/documenti-lista.component.ts` (+ spec, `.dom.spec.ts`), `documento-dettaglio.component.ts` (+ spec), `annulla-dialog.component.ts`, `storno-dialog.component.ts`, `conferma-emissione-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`

**Interfaces:** Consumes Task 14. Conferma della decisione 12: «La fattura diventerà emessa e non si
potrà più annullare.»

- [ ] **Step 1: test.** `filtri registro, anno, stato, cliente (ricerca lato server), date`; `selezione multipla; export CSV per tutti, XML e TeamSystem solo ADMIN con conferma`; `409 MAPPATURE_MANCANTI: elenco delle chiavi e link alla pagina delle mappature`; `dettaglio: «Scarica XML» solo ADMIN con conferma; già emesso senza conferma`; `«Annulla» disattivato con tooltip del motivo (motivoNonAnnullabile)`; `storno: motivo, data con maxDate = fine del giorno, «rifatturabile»`; `motivo vuoto: pulsante disabilitato`; `«Segna come emesso» con conferma`; `PDF scaricato per tutti`; `422 XML_NON_VALIDO: messaggio senza dati`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): documenti, export e azioni sul documento`.

## Task 34: frontend — scostamenti e riquadro del legame

**Files:**
- Create: `fe/features/fatturazione/scostamenti/scostamenti.component.ts` (+ spec), `presa-atto-dialog.component.ts` (+ spec)
- Modify: `fatturazione.routes.ts`, `fe/features/legami/riquadro-legame.component.ts` (+ spec)

- [ ] **Step 1: test.** `lista con documento, quantità e importo fatturati e attuali (it-IT), tipo di correzione`; `riga a prezzo speciale: solo la differenza di quantità`; `«Presa d'atto» con nota obbligatoria (1-200), solo ADMIN`; `«Storna e rifattura» apre lo storno con rifatturabile acceso`; `riquadro del legame FATTURATO: link al documento; con scostamento: «Vai agli scostamenti»`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): scostamenti e link dal riquadro del legame`.

## Task 35: frontend — pagina «Export contabile»

**Files:**
- Create: `fe/features/fatturazione/export-contabile/mappature.component.ts` (+ spec), tipi `MappaturaVista` e `ChiaveMancante` in `fatturazione.model.ts`
- Modify: `fatturazione.routes.ts`, `fatturazione.service.ts` (`mappature`, `salvaMappature`)

- [ ] **Step 1: test.** `una sezione per tipo di mappatura, con chiave WasteFlow, etichetta e valore modificabile`; `elenco delle mancanti in cima`; `solo ADMIN e SUPER_ADMIN`; `salvataggio di più voci in un PUT`; `valore vuoto → null`; `409 VERSIONE_SUPERATA: ricarica`.
- [ ] **Step 2-4:** come sopra. **Step 5: commit** `feat(fatturazione): pagina delle mappature dell'export contabile`.

## Task 36: e2e 4.4c (Playwright, UI)

**Files:**
- Create: `e2e/tests/fatturazione/fatturazione-ui.spec.ts`, `e2e/pages/fatturazione.page.ts`

- [ ] **Step 1: scenari** (azienda propria, dati via API come nel Task 26): nuova elaborazione dal dialog; anteprima con errori del periodo e link a «Da collegare»; esclusione di un documento; definitiva con conferma; lista documenti; export CSV e XML (conferma di emissione); PDF; scostamento con presa d'atto; numero di partenza; cedente incompleto che blocca l'avvio; `OPERATOR` senza «Rendi definitiva». Selettori `data-testid`, attese da `e2e/utils/attese`; 3 giri consecutivi verdi con `--workers=1`.
- [ ] **Step 2: verifica completa:** Karma una volta, `npm run build`, eslint dei file toccati; backend `test:cov`, suite Postgres dei Task 28-30, `rls-catalogo` 77.
- [ ] **Step 3: commit** `test(fatturazione): e2e dell'interfaccia di fatturazione`.

## Task 37: revisione dell'intero branch — 4.4c

**File:** nessuno.

- [ ] **Step 1:** revisori in parallelo: `typescript-nestjs-reviewer` (Angular standalone, unsubscribe e polling, tipi, adattatori e migration) e `ux-ui-mobile-specialist` (screenshot a 360 px e desktop di elaborazioni, anteprima, documenti, conferme; focus nei dialog, contrasto dei badge). Controlli espliciti: nessun campo numerico modificabile senza `appNumeroIt`; `maxDate` come fine del giorno; nessuna lista con dimensione oltre 100; ruoli coerenti col backend; nessuna stringa con id o dati personali; prova d'import TeamSystem fatta (§17.10). Correzioni nello stesso branch.
- [ ] **Step 2:** rapporto `4-4c-report.md`; PR 4.4c, merge, deploy. Aggiornare `STATUS.md` e `COSTS.md`.

---

# Pezzo 4.4d — Zucchetti (segnaposto)

Parte quando sono noti prodotto (Ad Hoc Revolution o Infinity) e ambiente di prova: si scrive allora
il suo piano (credenziali cifrate, adattatore `API`, e2e con un finto server).

---

## Ondate

Regola: **al massimo un task Postgres pesante per ondata** (migration, concorrenza con barriere o
volume, marcati **PG pesante**). I processi pesanti di tutti i task passano dal `flock`: in ondata si
scrive il codice in parallelo (un worktree per task:
`git worktree add ../rifiuti-wt-44-<task> -b wt/44-<task> <HEAD>`, `node_modules` copiati con
`cp -a --reflink=auto`, `prisma generate` solo nei worktree backend) e si serializzano le
esecuzioni. Integrazione a fine ondata con `git cherry-pick` backend → frontend, poi revisione opus.
Mai Karma e jest insieme.

**File condivisi:** `schema.prisma`, `prisma-rls.extension.ts`, `rls-catalogo…`,
`README-tenant-transazione.md` → solo Task 6 e 29; `ops/README.md` → 6, 12, 27, 29; `app.module.ts`
→ solo 7; `fatturazione.module.ts` → 7, 8, 18, 19, 22, 25, 28, 29, 30 (mai due nella stessa
ondata); `fatturazione-di-test.ts` → 6, 17; `fatturazione.job.ts` → 18, 19; `elaborazioni.service.ts`
→ 18, 19; `export.service.ts` → 24, 29; `documenti-fattura.controller.ts` → 25, 28;
`guardia-registro.spec.ts` → solo 17; `fe/features/legami/impostazioni-fatturazione.component.ts` →
solo 10; `fatturazione.model.ts` e `fatturazione.service.ts` → 14, 35; `fatturazione.routes.ts` →
31, 32, 33, 34, 35 (una riga ciascuno, conflitti risolti dall'orchestratore tenendo tutte le righe);
`app.routes.ts` e `layout.component.ts` → solo 31; `riquadro-legame.component.ts` → solo 34.

| Pezzo | Ondata | Task in parallelo | Tipo | Perché insieme |
|---|---|---|---|---|
| 4.4a | 0 | **0** | PG (verifica) | linea di base |
| 4.4a | 1 | **1** ∥ **10** | backend puro ∥ frontend | 10 si scrive dalle interfacce dei Task 7-8 |
| 4.4a | 2 | **2** ∥ **3** ∥ **4** ∥ **6** | puro ×3 ∥ **PG pesante** (migration) | domini in file propri; la migration copia gli insiemi del Task 1 |
| 4.4a | 3 | **5** ∥ **7** ∥ **11** | puro ∥ PG ∥ frontend | 5 dopo 2-4; 7 dopo 6; 11 dalle interfacce del 9 |
| 4.4a | 4 | **8** | **PG pesante** (concorrenza) | numerazione |
| 4.4a | 5 | **9** | PG | colonne additive, dopo il 6 |
| 4.4a | 6 | **12** | e2e + PG | tutto integrato |
| 4.4a | 7 | **13** | revisione | |
| 4.4b | 1 | **14** ∥ **15** | frontend ∥ puro | 14 fissa i nomi (P5) |
| 4.4b | 2 | **16** ∥ **17** | backend ∥ **PG pesante** (volume) | 16 dopo 15 |
| 4.4b | 3 | **18** ∥ **24** | PG ∥ PG | 24 usa `creaDocumentoDiTest` |
| 4.4b | 4 | **19** | **PG pesante** (concorrenza, volume) | definitiva |
| 4.4b | 5 | **20** ∥ **23** | **PG pesante** (concorrenza) ∥ PG | 23 non tocca numerazioni |
| 4.4b | 6 | **21** ∥ **22** | PG ∥ PG | file propri; 22 modifica il modulo, 21 no |
| 4.4b | 7 | **25** | backend (servizi finti) | dopo tutte le firme |
| 4.4b | 8 | **26** | e2e + PG | integrato |
| 4.4b | 9 | **27** | revisione | |
| 4.4c | 1 | **29** ∥ **31** | **PG pesante** (migration) ∥ frontend | |
| 4.4c | 2 | **28** ∥ **32** ∥ **35** | backend ∥ frontend ×2 | 35 dalle interfacce del 29 |
| 4.4c | 3 | **30** ∥ **33** ∥ **34** | backend ∥ frontend ×2 | 30 dopo il tracciato (Step 0) |
| 4.4c | 4 | **36** | e2e | |
| 4.4c | 5 | **37** | revisione | |

Conteggio: **4.4a 13 task** (1-13), **4.4b 14 task** (14-27), **4.4c 10 task** (28-37), più il
Task 0; 4.4d segnaposto. Task Postgres pesanti: 6, 8, 17, 19, 20, 29.

## Copertura della spec

§1-§2 → tutti; anti-obiettivi: numerazione senza buchi 8, 19, 20, 22; legame `FATTURATO` ⇔ documento
6 (CHECK), 19, 20; doppia fatturazione 3, 6, 19; immutabilità 6; registro mai bloccato 17 (guardia),
19; XML mai non valido 16, 23; niente `number` 1-5; niente query fra tenant 18, 22. §3.1 → 17, 19, 20.
S1 → 6, 18; S2 → 5, 18, 19; S3 → 19; S4 → 6; S5 → 17, 19; S6 → 20; S7 → 6, 7; S8 → 18; S9 → 8, 10;
S10 → 2; S11 → 15, 16; S12 → 29; S13 → 17; S14 → 5; S15 → 4; S16 → 4; S17 → 5, 17; S18 → 24;
S19 → 4; S20 → 20; S21 → 24. §4 → 6, 9 (P1 in 6, 8). §5.1-§5.3 → 17, 18; §5.4 → 19; §5.5-§5.6 →
20; §5.7 → 21, 34. §6 → 1-5. §7.1 → 24; §7.2 → 15, 16, 23; §7.3 → 29, 30; §7.4 → 28. §8 → 17, 19,
20, 23. §9 → 18, 22. §10 → Global Constraints. §11-§12 → 7, 8, 25, 28, 29. §13 → 10, 11, 31-35.
§14 → 17, 18, 19, 20, 22, 23. §15 → test dei task, e2e 26 e 36. §16 → pezzi. §17: 1 → 6, 29; 2-3 →
16; 4 → 5; 5 → domanda a Graziano (gate prima del Task 19); 6 → 24; 7 → 17; 8 → 19; 9 → 14, 25;
10 → 30 e gate della 4.4c; 11 → nessun task (non si usa). Decisioni del §19: 1 → 20, 21, 34; 2 → 1-3;
3 → 8, 20; 4 → 23, 33; 5 → 17; 6 → 3, 19; 7 → 18; 8 → 4 (gate); 9 → 29, 30; 10 → 28; 11 → 29,
segnaposto 4.4d; 12 → 23, 25, 33.

## Self-review (eseguita)

- **Spec coverage:** ogni sezione ha un task (tabella sopra). Senza task: §17.11
  (`ricevute_split`, non usato per scelta della spec); la tabella `credenziali_export_contabile` e le
  rotte di invio e credenziali sono della 4.4d.
- **Type consistency:** `Segnalazione` (1) in 2-5, 17; `RigaDocumentoCalcolata` (1) in 2-5, 15;
  `InputDocumento` e `ContrattoDaFatturare` (5) costruiti dal 17; `improntaElaborazione` (5) in 18-19
  con `SelezioneElaborazione.versioni` (17); `riservaNumeri` e `rilasciaUltimo` (8) in 19-20;
  `NumeriRiservati` (8) in `EsitoDefinitiva` (19); `ParametriElaborazione` (17) = `NuovaElaborazione`
  (14); `DocumentoRiga`, `DocumentoDettaglio`, `ScostamentoRiga`, `Pagina` (14) nelle risposte di
  18, 20, 21, 25; `DocumentoPerExport` (24) in 29-30; `FotografiaDocumento` (17) in 15, 23, 28.
- **Proportion:** piano circa come la spec; codice solo per firme e per gli algoritmi non
  determinati (riserva dei numeri, rate, sconto a cascata contro la tolleranza SDI, impronta, passi
  della definitiva).
