# Fase 4 pezzo 1: cliente e contratto lato cliente — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo. Ordine **strettamente sequenziale** (un worktree, un database di test, file condivisi:
> `schema.prisma`, conteggio RLS, `ditte.service.ts`, `clienti.module.ts`): Task 0 → 1 → … → 28.
> Passi con checkbox (`- [ ]`). Le domande Q1-Q6 della prima stesura hanno avuto risposta il 31/10
> (sezione "Decisioni di Graziano del 31/10"): il piano è scritto con quelle risposte.

**Obiettivo.** Dare al gestore (impianto, trasportatore, intermediario) l'anagrafica **Cliente** e il
**contratto attivo verso il cliente** (`ContrattoCliente`), separato dal contratto passivo del
produttore (`Contract`), con **tutti i dati commerciali e fiscali del contratto di WinWaste.NET**
(`WWNET03.Contratti`, `WWREM.ScriviContratti`, `WWNET32.CLIFOR`): cliente di fatturazione,
condizione di pagamento, conto corrente di accredito del gestore, agente, spese di incasso, bollo,
registro IVA sezionale, esigibilità IVA (compreso lo split payment), ritenuta d'acconto, testo di
fatturazione, categoria e tipo, dati per la PA (codice ufficio, riferimento amministrazione, CIG, CUP,
documento PA), soglia massima, validità, commessa, annotazioni, contratto allegato, due allegati
PDF, sospensione totale e dei soli movimenti, annullo con motivo codificato, rinnovo e proroga delle
scadenze, periodi di fatturazione **con effetto** (funzione pura che 4.4 userà). Con le anagrafiche
che questi campi richiedono. Niente listino, niente legame coi movimenti, niente valorizzazione.

**Architettura.** Il cliente e l'agente sono **ruoli su una ditta di F2-10** (tabelle `clienti` e
`agenti` come `produttori`/`trasportatori`/`destinatari`: `ditta_id` + `sede_id` predefinita, una
riga per ditta). Undici tabelle nuove per azienda con RLS, in due migration: le **tabelle di
fatturazione** (`condizioni_pagamento`, `conti_correnti`, `spese_accessorie`, `registri_iva`,
`testi_fatturazione`, `codifiche_contratto`) e i **soggetti e contratti** (`agenti`, `clienti`,
`contratti_cliente`, `periodi_fatturazione_cliente`, `allegati_contratto_cliente`). Regole pure in
`src/domain/clienti/` e `src/domain/contratti-cliente/`; servizi in `src/application/clienti/` e
`src/application/contratti-cliente/`, con un helper comune per lock ottimistico e traduzione degli
errori Prisma; controller in `src/api/clienti/`. Lock ottimistico con `versione` e scrittura
condizionata come 4.0. Frontend: pagine `/clienti`, `/clienti/agenti`, `/clienti/tabelle` (una
scheda per tabella di fatturazione) e `/contratti-clienti`; ogni scelta di un'anagrafica nei dialog
del cliente e del contratto ha il pulsante "Nuovo …" in linea, con lo stesso schema del form del
contratto produttore appena rilasciato.

**Tech stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE); Angular + PrimeNG; jest,
Karma, Playwright (solo in CI).

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §5 (4.1; 4.2-4.4
solo per sapere cosa **non** fare), §4 (3.8), §6, §7 (D5). Come lo fa WinWaste:
`/home/graziano/Progetti/winwaste/docs/contratti.md` §2-§9, `fatturazione.md` §2, §3.2, §4.7, §5,
`contabilita.md` §1-§2 (condizioni di pagamento, registri, banche),
`confronto-rifiuti/02-contratti-fatturazione-contabilita.md` §1.1, §2.1, §5.1, §5.3. Formato e
convenzioni: `docs/superpowers/plans/2026-10-31-fase4-0-contratto-modifica-cancellazione.md`
(regole per stato, versione, cancellazione logica, errori) e `2026-10-31-fase4-8a-pese.md` (tabelle
nuove con RLS, allegati in `BYTEA`); F2-10: `2026-10-28-fase2-10-controparti.md`.

**Stima.** 29 task (Task 0-28) contro i 16 della prima stesura: 19 backend (6 di dominio puro, 2 di
schema, 11 di servizi e rotte), 8 frontend, 1 di e2e e chiusura. Circa 11 tabelle, 37 campi sul
contratto, ~150 file nuovi o modificati. Ordine di grandezza: il doppio della prima stesura
(roadmap: taglia G → G+), 12-15 giornate di esecuzione sequenziale con revisione fra i task.

---

## Decisioni di Graziano del 31/10

| # | Domanda | Risposta | Dove agisce |
|---|---|---|---|
| Q1 | Perimetro dei dati del contratto | **Tutto come WinWaste**: ogni colonna del contratto (27 di `ScriviContratti` più le posizioni di `C3`) diventa un campo o un'esclusione motivata (solo se puramente tecnica o di 4.2-4.5, con il pezzo che la ospiterà). Anagrafiche minime per i campi che le richiedono: agenti (ruolo su ditta, come il fornitore `CODAG` di WinWaste), categorie e tipi di contratto (creati in linea come con F4), registri IVA sezionali, testi di fatturazione, più spese di incasso/bollo e motivi di annullo che WinWaste valida su tabella | D5 (mappa dei campi), D21-D29, Task 3-6, 8-19, 21-27 |
| Q2 | Condizione di pagamento | **Anagrafica per azienda** (raccomandazione): codice, descrizione, modalità FatturaPA, 1-8 rate, fine mese | D6, Task 2, 10, 21 |
| Q3 | Stati del contratto | **Bozza, Attivo, Sospeso, Sospeso solo movimenti, Annullato**; Scaduto calcolato (raccomandazione) | D8, Task 6, 17, 27 |
| Q4 | Privati come clienti | **Sì, nome e cognome obbligatori** (raccomandazione) | D3, D18, Task 1, 7, 14 |
| Q5 | Rinnovo | **Come WinWaste**: flag, "Rinnova" sul singolo (+1 anno), proroga massiva come F6 (raccomandazione) | D11, Task 18, 27 |
| Q6 | IBAN e banca d'appoggio | **Anagrafica dei conti correnti del gestore** (IBAN, banca), scelta sul contratto e sul cliente (+1 tabella RLS). **Non** la raccomandazione della prima stesura | D21, Task 3, 11, 21 |

Nota sul Q1. Nella richiesta `C2` era indicato come "flag degli allegati PDF". Il codice dice altro
(E26, E27): `C2` è il **contratto principale** a cui il contratto è allegato, mentre i PDF sono due
file associati al contratto fuori dal record. Si portano **entrambi** (D28, D29).

Seconda tornata (31/10, dopo la revisione del piano):

| # | Domanda | Risposta | Dove agisce |
|---|---|---|---|
| Q7 | Consegna | **Due PR.** **4.1a** tabelle di fatturazione: Task 0-5, 8, 10-12, la parte "tabelle" del Task 20 (modelli, vocabolari e `TabelleFatturazioneService` delle sei tabelle, `AggiuntaInLinea`), 21-22, e2e e chiusura ridotti del Task 28. **4.1b** agenti, clienti, contratti: Task 6, 7, 9, 13-19, il resto del 20, 23-27, 28. Migration `20261102200000_` nella 4.1a (RLS 44 → 50), `20261102200100_` nella 4.1b (50 → 55). La 4.1b parte da master dopo il merge della 4.1a | Ordine, Task 20, 28 |
| Q8 | Codice rinnovo `O` | **Non portato**: solo `S`/`N`; i contratti importati con `O` diventano `S` (3.8) | D27, Task 6, 9, 18 |

### Addendum 4.1b (01/11)

Base: master `dba59f5` (PR #40, 4.1a in produzione), branch `feat/fase4-1b-clienti-contratti`,
worktree `rifiuti-wt-rentri-registro`. I ruling R1-R17 della 4.1a restano validi; i ruling R18-R34
stanno in `.superpowers/sdd/2026-11-01-fase4-1-contratto-cliente/preflight-4.1b.md` e, dove
divergono, **prevalgono sul testo dei task**. Questo addendum prevale sulla sezione "Ordine".

**Task della 4.1b (18):** 6, 7 (con la parte `features/registry` del Task 20), 9, 13, 14, **12b**
(nuovo: il resto di R5), 15, 16, 17, 18, 19, 20 (resto), 23, 24, 25, 26, 27, 28 (completo).

**Il codice della 4.1a da cui si parte (nomi reali, non quelli immaginati dal piano).**
- Helper `application/clienti/anagrafica-versionata.ts`: `DescrizioneEntita { prefisso, soggetto,
  femminile }`, `VincoliNoti`, `RileggiVincolo`, `confrontaVersione`, `scriviCondizionato`,
  `traduciErrorePrisma(err, entita, vincoli, rileggi?)` **async**, da chiamare nella `.catch` FUORI
  dalla `$transaction` (R13). Con la RLS un P2002 arriva con `meta.target` null.
- Sei servizi (`condizioni-pagamento`, `conti-correnti`, `spese-accessorie`, `registri-iva`,
  `testi-fatturazione`, `codifiche-contratto`): ognuno ha una `async function contaUsi(_tenantId,
  _id)` di modulo che restituisce 0, chiamata **per riga** da `comeVista` (`eliminabile`). Campi
  `attiva` su condizioni, spese, codifiche; `attivo` su conti, registri, testi.
- `nelContestoTenant` si importa da `application/pese/nel-contesto-tenant` (area esclusa: non si
  sposta, R27).
- `api/clienti/clienti.module.ts`: `imports: [PrismaModule, AuthModule, RuoloEffettivoModule]`, sei
  controller e sei servizi; già registrato in `app.module.ts` (non si tocca).
- `RegistryModule` (`api/registry/registry.module.ts`) **non esporta** `DitteService` (R19).
- Fixture `test-support/fatturazione-di-test.ts`: `creaTabelleFatturazione(owner, tenantId)` →
  `{ condizioneId, contoId, speseId, bolloId, registroId, registroSplitId, testoId, categoriaId,
  tipoId, motivoId }`. `creaDittaConRuolo(client, tenantId, ruolo, dati)` in
  `anagrafiche-di-test.ts` accetta solo `PRODUTTORE | TRASPORTATORE | DESTINATARIO`.
- Dominio: `domain/clienti/{codice-tabella, decimali, iban, dati-fiscali-cliente, condizione-pagamento,
  conto-corrente, spesa-accessoria, registro-iva, testo-fatturazione, codifica-contratto}.ts`;
  `domain/contratti-cliente/periodi-fatturazione.ts`. `normalizzaDecimale`/`decimaleValido` stanno in
  `decimali.ts` (R1), non nel Task 3; `validaCodiceDestinatario`, `validaRitenuta`,
  `tipoDestinatario`, `ESIGIBILITA_IVA` in `dati-fiscali-cliente.ts`.
- Migration `20261102200000_anagrafiche_fatturazione_cliente`: FK verso `tenants` chiamate
  **`<tabella>_tenant_id_fkey`** (R17). Le FK composite esistenti di F2-10 si chiamano
  `<tabella>_<riferimento>_fkey` (`produttori_ditta_fkey`, `produttori_sede_fkey`): la 4.1b segue
  entrambe le convenzioni.
- Frontend: tutto sotto `features/clienti/`: `clienti.model.ts`, `vocabolario-clienti.ts`
  (`ETICHETTE_*`, `OPZIONI_*`, `CONCORDANZA_GENERE`), `tabelle-fatturazione.service.ts` (`Tabella`,
  `TabellaCodifiche` esportati, R15), `aggiunta-in-linea.ts` (nessun consumatore finora); i dialog
  delle tabelle stanno in **`features/clienti/tabelle/`** con `@Input() visible`, `elemento`,
  `@Output() salvato`, `visibleChange`; `spesa-accessoria-dialog` ha `@Input() tipo?: TipoSpesa`,
  `codifica-dialog` ha `@Input() genere` e `@Input() rapida`; `tabelle/tabella-comune.ts` ha
  `messaggioErrore`, `permessoScrittura`, `chiediConferma`. Rotta piatta `clienti/tabelle`; voce di
  menu temporanea "Tabelle di fatturazione" in `layout.component.ts:1287-1293` (R8).
- e2e: `e2e/tests/tabelle-fatturazione/tabelle-fatturazione.spec.ts` (va con `page.goto`, non dal
  menu; cerca l'heading di livello 1 "Tabelle di fatturazione").

**Correzioni per task** (rispetto al testo originale; il resto del task vale com'è).

- **Task 6.** Riusa `normalizzaDecimale` da `domain/clienti/decimali.ts` (non "Task 3"),
  `validaCodiceDestinatario` e `validaRitenuta` da `dati-fiscali-cliente.ts`, `validaPeriodi` da
  `domain/contratti-cliente/periodi-fatturazione.ts`. Chiude i due minor di dominio rinviati dalla
  4.1a (R26): in `periodi-fatturazione.ts` la sovrapposizione si verifica nell'anno bisestile (fine
  28/02 vale 29/02, quindi 01/01-28/02 + 29/02-31/03 → "I periodi 1 e 2 si sovrappongono."); in
  `dati-fiscali-cliente.ts` il riferimento amministrazione con codice `0000000` è rifiutato col
  messaggio di D3. File in più: quei due moduli e i loro spec; commit con i sei file.
- **Task 7.** Prende anche la parte `features/registry` del Task 20 (R7): due commit, prima backend
  poi frontend (jest e Karma mai insieme). Backend: `NOME_RUOLO` di `sede-ditta.ts` e
  `SedeNonValidaPerRuoloError` con l'articolo giusto ("dell'agente", "del cliente": oggi il modello
  è `del ${nome}`, R20). Frontend: **non** si allarga `TipoAnagrafica` (lo importano
  `features/contracts` e `features/fir`, aree escluse, e `anagrafica-form-dialog` tratta ogni tipo
  diverso da produttore/trasportatore come destinatario): si aggiunge `TipoRuoloDitta =
  TipoAnagrafica | 'cliente' | 'agente'` in `identificativo-fiscale.ts`, usato da
  `ditta-identificativi.component.ts` (`ETICHETTA_RUOLO`) e dalla regola del privato (R21);
  `anagrafica-form-dialog.component.ts` non si tocca. `registry.model.ts`: `ruoli.clienteId?`,
  `ruoli.agenteId?`. Il messaggio del privato sta solo in `identificativo-fiscale.ts` (BE e FE):
  il `grep` del piano non trova spec da aggiornare. Usa Postgres (`registry-ditte.postgres.spec.ts`,
  `rls-catalogo` a 50).
- **Task 9.** Timestamp `20261102200100` > `20261102200000`, l'ultima migration di master
  (verificato su tutti i branch il 01/11: nessuna successiva); ricontrollare al rebase finale e, se
  master ne riceve una successiva, rinominare **solo** la nostra (la `…200000_` è in produzione).
  FK verso `tenants` `<tabella>_tenant_id_fkey` `ON DELETE CASCADE`; composite `NoAction` (mai
  `RESTRICT`: con `NoAction` la cancellazione a cascata del tenant passa perché il controllo è a
  fine statement) coi nomi del piano (`clienti_condizione_pagamento_fkey`, …). `rls-catalogo`
  50 → **55**, `README-tenant-transazione.md` ai tre punti che oggi dicono 50 (righe 120, 131, 144
  della 4.1a), `TENANT_SCOPED_MODELS` +5. Il commento di ripristino della migration rimanda al
  paragrafo T8 già in `ops/README.md`. La spec dello schema crea le righe minime col proprietario e
  può usare `creaTabelleFatturazione` (esiste già: il testo "fixture non ancora disponibile" è
  superato).
- **Task 13.** Primo passo, prima degli agenti (R18, R19):
  `DescrizioneEntita` riceve `inUso?: { codice: string; messaggio: string }` (sovrascrive il 409 del
  P2003; servono `AGENTE_IN_USO` e `CLIENTE_CON_CONTRATTI` coi testi esatti di D13) e il messaggio
  di ripiego si accorda al genere ("disattivala invece di eliminarla" per le femminili, minor M1 della
  4.1a); test unitari dei due rami. `RegistryModule` aggiunge `exports: [DitteService]` e
  `ClientiModule` importa `RegistryModule` (`registry.module.ts` entra nell'elenco dei file mirati di
  D18). Il P2002 sotto RLS (R22): `VINCOLI` con `agenti_tenant_id_codice_key` e
  `agenti_tenant_id_ditta_id_key` più un `rileggi` fuori transazione; se il vincolo è quello della
  ditta si lancia `RuoloGiaPresenteError('agente')` (400), perché `eViolazioneRuoloPerDitta` con
  `target` null restituisce false. Test Postgres in più: `due crea concorrenti sulla stessa ditta:
  una 400 col messaggio del ruolo presente`.
- **Task 14.** File in più: `src/test-support/anagrafiche-di-test.ts` (`creaDittaConRuolo` accetta
  `CLIENTE` e `AGENTE`; per questi due ruoli niente `ragioneSocialeStorica` né numero di documento,
  campi come il modello Prisma del Task 9) e un test della fixture. `controllaRiferimenti` legge
  agenti, spese, registri, conti e condizioni con **una query raw per tabella `… WHERE tenant_id = …
  AND id = ANY(…) FOR SHARE`** (R24): blocca la disattivazione o il cambio di tipo concorrenti fino al
  commit, così il cliente non nasce con una spesa diventata del tipo sbagliato. Non dipende dal
  Task 13: legge `agenti` direttamente (il Postgres crea l'agente con `creaDittaConRuolo`). P2002 come
  R22 (`clienti_tenant_id_codice_key` → 409 `CLIENTE_CODICE_DUPLICATO`, ditta → 400).
  `ClienteVista.contratti` conta i contratti **non eliminati**; `eliminabile` conta **tutte** le
  righe che lo citano, eliminate comprese (R25).
- **Task 12b (nuovo, dopo il 14): uso reale delle tabelle di fatturazione** (resto di R5).
  File: i sei `*.service.ts` della 4.1a, i loro `*.service.spec.ts`, i tre `*.postgres.spec.ts`
  esistenti (condizioni, conti, spese) più `tabelle-fatturazione.service.postgres.spec.ts` per
  registri, testi e codifiche. `contaUsi` diventa **batch**: `contaUsi(client, tenantId, ids:
  string[]): Promise<Map<string, number>>`, un `groupBy` per colonna referente, **una** chiamata per
  `list` e una per `getById`, eliminati compresi (la FK li vede). Colonne: condizioni →
  `clienti.condizione_pagamento_id` + `contratti_cliente.condizione_pagamento_id`; conti →
  `conto_corrente_id` (due tabelle); spese → `spese_incasso_id` e `bollo_id` (due tabelle); registri
  → `registro_iva_id` (due tabelle); testi → `contratti_cliente.testo_fatturazione_id`; codifiche →
  `contratti_cliente.categoria_id`, `tipo_id`, `motivo_annullo_id`. Blocchi nel servizio, nella
  transazione, **dopo** `SELECT … FOR UPDATE` della riga e prima della scrittura (R24): cambio di
  `tipo` di una spesa usata → 409 `SPESA_ACCESSORIA_IN_USO` "La spesa è usata da clienti o
  contratti: non se ne cambia il tipo."; registro usato che diventa `ricevuteSplit` → 409 col testo
  del Task 12. Test unitari (una sola query di conteggio per `list`, i due blocchi) e Postgres
  `in uso da un cliente: elimina 409, la riga resta, eliminabile false` per condizioni, conti, spese,
  registri (cliente col proprietario via `creaDittaConRuolo(…,'CLIENTE')`), `in uso da un
  contratto` per testi e codifiche (contratto inserito col proprietario), `il messaggio di una
  femminile dice "disattivala"`, `cambio di tipo della spesa usata: 409`, `registro usato che
  diventa ricevute split: 409`. Commit `feat(clienti): uso reale delle tabelle di fatturazione da
  clienti e contratti`.
- **Task 15.** `elimina` passa `inUso` di R18 (`CLIENTE_CON_CONTRATTI`, testo di D13). DTO
  `ritenutaPercentuale` stringa col punto `^\d{1,2}(\.\d{1,2})?$` (come R2). Il Postgres `cliente con
  un contratto` comprende il caso del contratto **eliminato** (409 anche così, R25). Modifica di un
  riferimento: `controllaRiferimenti` di R24.
- **Task 16.** Controlli sui riferimenti con `controllaRiferimenti` (R24) e lettura del cliente con
  `FOR SHARE` (un cliente disattivato in parallelo non riceve un contratto nuovo). La vista implementa
  **esattamente** l'interfaccia del piano: il frontend è scritto in parallelo su quella (R29); ogni
  scostamento va nel rapporto del task.
- **Task 17.** Come il 16 per i riferimenti cambiati. Nessun'altra correzione.
- **Task 18.** Rotte con prefisso `contratti-clienti` (D11). Il controller non contiene le rotte
  degli allegati (R28).
- **Task 19.** Controller **proprio** `api/clienti/allegati-contratto-cliente.controller.ts` (+ spec)
  con le quattro rotte `contratti-clienti/:id/allegati…`, invece di modificare quello del Task 18
  (R28): dipende dal Task 14 (fixture del cliente) e non dal 18. Il servizio verifica il contratto
  (non eliminato, dell'azienda) con una lettura sua, senza `ContrattiClienteService`.
- **Task 20 (resto).** File: `clienti.model.ts` (aggiunge `Cliente`, `Agente`, `ContrattoCliente`,
  `AllegatoContratto`, `PeriodoFatturazione`, `StatoContrattoCliente`, `EsigibilitaIva`, `Pagina<T>`,
  copiati dalle interfacce `…Vista` dei Task 13-19 **del piano**, R29), `vocabolario-clienti.ts`
  (esigibilità, stati, frequenze, unità, codici di rinnovo), `clienti.service.ts` + spec (`agenti`,
  `clienti`, `contratti`, `allegati`), `aggiunta-in-linea.ts` + spec (JSDoc "non blocca la creazione
  con campo bloccato", test `apri create azzera elemento` e `ripiego su ev.target`: minor T20a), e
  l'helper di elenco in `tabelle/tabella-comune.ts` con i sei componenti di scheda che lo adottano
  (minor T22, R34). Le modifiche a `features/registry` e `registry.model.ts` sono nel Task 7.
- **Task 23.** Rotta piatta `clienti/agenti` (come `clienti/tabelle`). Lista con l'helper di R34.
- **Task 24.** Sostituisce la voce temporanea "Tabelle di fatturazione" con "Clienti" (D20) e toglie
  il commento "Voce temporanea"; la pagina delle tabelle resta raggiungibile dal pulsante della lista
  e dall'URL, con lo stesso heading (lo usa l'e2e della 4.1a). Dialog in linea: i dialog di
  `features/clienti/tabelle/` (spese con `[tipo]="'INCASSO'"` e `[tipo]="'BOLLO'"`) e
  `AgenteDialogComponent`, tutti con `AggiuntaInLinea` (R33). Test in più per ogni sub-dialog: `Esc
  chiude solo il sub-dialog` (`bloccaChiusuraEsterna`) e `il focus torna al pulsante "Nuovo …"`.
- **Task 25.** Categoria e tipo con `app-codifica-dialog [genere] [rapida]="true"`; un 409
  `CODIFICA_CONTRATTO_CODICE_DUPLICATO` in modalità rapida (terzo operatore simultaneo, minor T12)
  mostra "Un collega ha appena usato lo stesso codice: riprova." e lascia il sub-dialog aperto (R33).
  Stessi test di focus ed Esc del Task 24 per ogni sub-dialog.
- **Task 26.** Riga del codice di rinnovo corretta nel testo del task (R12: "S spunta, N toglie").
- **Task 27.** Rotta `contratti-clienti` e voce "Contratti clienti" dopo "Clienti". Annullo: il
  "Nuovo motivo" rapido è `app-codifica-dialog [genere]="'MOTIVO_ANNULLO'" [rapida]="true"`.
- **Task 28 (completo).** La parte e2e delle tabelle è già fatta (4.1a,
  `tabelle-fatturazione.spec.ts`, che non si tocca): lo spec nuovo
  `contratti-cliente/contratto-cliente.spec.ts` fa lo scenario dello Step 1 com'è scritto (condizione e
  registro dalla pagina delle tabelle, il resto in linea), con codici casuali e pulizia propria come R10. Step 2: `git diff --stat dba59f5..HEAD` (non `dafa30b`). Step 5:
  `rls-catalogo` a 55. In più (I1 della 4.1a, R31): prima della PR `ci.yml` via `workflow_dispatch`
  sul branch, e merge solo con `test-postgres` ed `e2e` (passata 2) verdi; contratto d'interfaccia
  frontend/backend controllato (R29). Rapporto: rollback della **sola** seconda migration.

### Parallelismo 4.1b

**Chi usa Postgres** (suite `*.postgres.spec.ts` o `rls-catalogo` a fine task): 7, 9 (migration),
12b, 13, 14, 15, 16, 17, 18, 19, 28. **Non lo usano:** 6 (dominio puro) e i frontend 20, 23-27.
Con un solo database (55438) e la regola della RAM (un solo processo pesante, mai jest e Karma
insieme) la catena backend resta **sequenziale**; il guadagno è far correre la catena frontend
accanto, un task frontend per ondata, sempre con **al massimo un task Postgres per ondata**.

**File condivisi e chi li tocca:** `schema.prisma`, `prisma-rls.extension.ts`,
`rls-catalogo.postgres.spec.ts`, `README-tenant-transazione.md`, `ditta-prisma.repository.ts` → solo
9; `ops/README.md` → solo 9; `anagrafica-versionata.ts`, `registry.module.ts` → solo 13;
`anagrafiche-di-test.ts` → solo 14; `clienti.module.ts` → 13, 15, 18, 19 (tutti backend, in
sequenza); i sei servizi della 4.1a → solo 12b; `ditte.service.ts`, `sede-ditta.ts`, `errors.ts`,
`features/registry/*`, `registry.model.ts` → solo 7; `clienti.model.ts`, `vocabolario-clienti.ts`,
`tabella-comune.ts` → solo 20 (i task frontend successivi li **leggono**; se uno deve cambiarli, il
cambio si fa nel suo worktree e il task successivo parte dopo l'integrazione); `app.routes.ts` → 23,
24, 27; `layout.component.ts` → 24, 27; `contratto-cliente-dialog.component.ts` → 25, 26;
`app.module.ts`: nessuno. Backend e frontend non condividono file.

| Ondata | Task in parallelo | Perché insieme | Rischio |
|---|---|---|---|
| 1 | **6** ∥ **7** (PG) | dominio nuovo contro registry: nessun file in comune; 6 non usa il database | basso: 7 cambia `RuoloControparte` e 6 non lo importa |
| 2 | **9** (PG, migration) ∥ **20** | 9 dipende da 7 (tipi); 20 dipende da 6 (stati e campi da copiare nei tipi FE) | medio: i tipi FE sono scritti sulle interfacce del piano, non sul codice (R29) |
| 3 | **13** (PG) ∥ **23** | 13 dopo 9; 23 dopo 20 (servizio `agenti`) | basso |
| 4 | **14** (PG) ∥ **24** | 14 dopo 9 (non serve il 13); 24 dopo 23 (dialog agente in linea) | medio: 24 è il task frontend più grande |
| 5 | **15** (PG) ∥ **25** | 15 dopo 13 (R18) e 14; 25 dopo 24 (dialog cliente in linea) | medio: 25 implementa un'interfaccia di contratto non ancora scritta (16) |
| 6 | **12b** (PG) ∥ **26** | 12b dopo 13 (messaggio accordato) e 14 (fixture CLIENTE); 26 dopo 25 | basso |
| 7 | **16** (PG) ∥ **27** | 16 dopo 6 e 14; 27 dopo 25 (non tocca i file del 26) | medio: come l'ondata 5 |
| 8 | **17** (PG) | dopo 16 (stesso servizio) | — |
| 9 | **18** (PG) | dopo 17 (stesso servizio, controller nuovo, modulo) | — |
| 10 | **19** (PG) | dopo 14 (con R28 non serve il 18); messo qui perché è l'unico Postgres libero | — |
| 11 | **28** | tutto integrato; controllo del contratto d'interfaccia (R29) | — |

**Regole operative** (R30):
- Ogni task parallelo in un worktree suo (`git worktree add ../rifiuti-wt-41b-<task> -b
  wt/41b-<task> <HEAD del branch dopo l'ondata precedente>`), con i `node_modules` copiati per
  reflink (`cp -a --reflink=auto` dei tre `node_modules`): mai un `node_modules` condiviso, perché
  `prisma generate` scrive il client dentro `node_modules`. Il worktree frontend non lancia
  `prisma generate`.
- Ogni processo pesante (jest, `test:cov`, suite Postgres, Karma, `ng build`, `migrate deploy`) passa
  da un lock: `flock /home/graziano/Progetti/rifiuti-wt-rentri-registro/.superpowers/sdd/2026-11-01-fase4-1-contratto-cliente/pesante.lock <comando>`.
  Così il task frontend non lancia Karma mentre il backend fa girare jest.
- Il database 55438 è uno solo: la migration del Task 9 si applica **una volta** (ondata 2) e da lì
  tutti i worktree lavorano sullo schema a 55 tabelle; mai `migrate reset`. I test isolano i dati per
  `tenantId` creato e ripulito per id (Vincoli globali), quindi un worktree frontend che non ha il
  Task 9 non è disturbato.
- Integrazione a fine ondata, nel worktree principale: `git cherry-pick` dei commit di ogni worktree
  nell'ordine backend → frontend, poi revisione opus dell'ondata, poi l'ondata successiva parte dal
  nuovo HEAD. Conflitti attesi: nessuno (le coppie non condividono file); `clienti.module.ts` è
  toccato solo da task backend di ondate diverse.
- **Variante più veloce (non consigliata ora):** un secondo database nello stesso container
  (`CREATE DATABASE wasteflow_ci_b`, `migrate deploy`, `db-ruoli.sh`; la guardia `:55438/` resta
  vera) permetterebbe 13 ∥ 14 e 15 ∥ 16, con le esecuzioni comunque in fila sul lock della RAM.
  Guadagno piccolo (la scrittura del codice si sovrappone, i test no) contro due schemi da tenere
  allineati.

---

## Stato di partenza (branch `feat/fase4-1-contratto-cliente` = `dafa30b` + questo piano, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Modello e database.**
- `prisma/schema.prisma:1762-1812` `model Contract` dopo 4.0 (con `versione`, `eliminatoIl`,
  `eliminatoDa`, relazione `tenant`). Resta il contratto **passivo** del produttore (4.0 D13): questo
  pezzo **non lo tocca**.
- `prisma/schema.prisma:2445-2502` `Ditta` e `SedeDitta` (F2-10): `ditte` con `@@unique([id,
  tenantId])`, `(tenantId, partitaIva)`, `(tenantId, codiceFiscale)`; `sedi_ditte` con `@@unique([id,
  tenantId])` e `([id, dittaId, tenantId])`. Ruoli: `Produttore` `:1242-1275`, `Trasportatore`
  `:1277-1319`, `Destinatario` `:1321-1372`, ognuno con `dittaId`, `sedeId` (sede predefinita),
  relazioni composite `NoAction` (`produttori_ditta_fkey`, `produttori_sede_fkey`) e
  `@@unique([tenantId, dittaId])`. Relazioni inverse di `Tenant` `:100-117` (ultima `contracts`).
- Precedente di relazione composita facoltativa: `strumenti_pesa_registro_fkey` (`schema.prisma:2613`).
  Precedente di allegato in database: `model AllegatoPesa` (`schema.prisma:2765-2783`, `BYTEA`,
  `sha256`, `@@unique([id, tenantId])`).
- Ultima migration: `20261102100000_rentri_esclusione_invio_automatico`. Migration di questo pezzo:
  **`20261102200000_anagrafiche_fatturazione_cliente`** (Task 8) e
  **`20261102200100_clienti_agenti_contratti_cliente`** (Task 9).
- RLS: `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64` `toBe(44)`;
  `README-tenant-transazione.md:120,143` "(44)"; `TENANT_SCOPED_MODELS` in
  `src/infrastructure/persistence/prisma-rls.extension.ts:47-99`. Forma delle policy:
  `prisma/migrations/20261031110000_ditte_sedi_controparti/migration.sql:326-338`.
- Privilegi: `prisma/sql/ruoli-db.sql:49-52` (elenchi `v_sola_lettura`, `v_solo_inserimento`,
  `v_senza_cancellazione`); le tabelle non elencate ricevono CRUD (`:117-120`). Questo pezzo **non**
  aggiunge elenchi (D19).
- `ActivityLog` (`schema.prisma:903-927`) per l'audit nella stessa transazione.

**Backend.**
- F2-10: `src/application/registry/ditte/ditte.service.ts` (`risolviPerRuolo` `:133-233`, regola del
  privato `:143-145` e `:174-176`, `DittaDto.ruoli` `:83-92`, `dto()` `:460-481`);
  `src/application/registry/crea-ruolo-su-ditta.ts` (`creaRuoloSuDitta` `:108-126`,
  `RuoloGiaPresenteError`, `NomeRuolo` `:34`, `eViolazioneRuoloPerDitta` `:75-81`, `messaggioSicuro`);
  `src/domain/registry/entities/sede-ditta.ts:10-16` (`RuoloControparte`, `NOME_RUOLO`), `:173`
  (`disattiva(ruoliPredefinita)`); `src/infrastructure/persistence/ditta-prisma.repository.ts:131-148`
  (`ruoliDellaDitta`); `src/core/domain/errors.ts:269-343` (errori di ditta e sede,
  `SedeNonValidaPerRuoloError` `:338`); `src/domain/registry/value-objects/identificativo-fiscale.ts:29`
  (`MESSAGGIO_PRIVATO_SOLO_PRODUTTORE`); `src/api/registry/ditte.controller.ts` (rotte ditte/sedi,
  `SCRITTURA` `:33`).
- 4.0: `src/domain/contracts/regole-contratto.ts` (modello di regole pure: `CAMPI_MODIFICABILI`,
  `pianificaModifica`, `normalizzaDati`, `validaDatiContratto`), `src/application/contracts/contract.service.ts`
  (vista con `modificabili`/`eliminabile`, `updateMany` condizionato su `versione`, audit),
  `contract.controller.ts` (`comeData`, `ParseUUIDPipe`, `DELETE ?versione=`), DTO
  `dto/modifica-contratto.dto.ts`.
- Pese (4.8a): modello di modulo con dominio, servizi e controller separati (`src/domain/pese/`,
  `src/application/pese/`, `src/api/pese/pese.module.ts`, registrato in `src/app.module.ts:52,162`);
  allegati: `src/domain/pese/allegato-pesa.ts` (`DIMENSIONE_MASSIMA_ALLEGATO` 4 MiB `:3`,
  `riconosciTipoFile` dai magic bytes `:14`) e `src/api/pese/allegato-upload.ts` (multer in memoria,
  errori italiani). Questo pezzo li **importa** senza modificarli.
- Ruoli: `RolesGuard` sul ruolo **effettivo** nell'azienda selezionata (`src/auth/guards/roles.guard.ts:1-75`);
  azienda da `requireRequestTenantId(req)` (`src/core/context/resolve-request-tenant`); controlli
  statici `src/api/controller-tenant-selezionato.spec.ts` e `src/api/nessun-user-userid.spec.ts`.
- Feature: `src/application/admin/feature-catalog.ts:23,42,65` (`contratti`, piano PROFESSIONAL).
- Test di supporto: `src/test-support/anagrafiche-di-test.ts` (`partitaIvaValida`, `creaDittaConRuolo`,
  `CF_PERSONA_VALIDO`); modello di spec Postgres col ruolo app:
  `src/application/contracts/contract.service.postgres.spec.ts` (4.0).

**Frontend.**
- `fe/features/contracts/` (lista e dialog del contratto produttore, 4.0): modello di pagina, dialog
  di modifica, gestione del 409.
- **Aggiunta in linea dal form del contratto** (commit `dc37c95`, `210c49f`):
  `fe/features/contracts/contract-create-dialog.component.ts` — selettore + `p-button` `pi pi-plus`
  "Nuovo …" (e `pi pi-pencil` "Modifica … selezionato") visibili se `puoGestire()` e campo non
  bloccato (`:153-180`); sub-dialog in sovrapposizione (`:412-420`); `apriAnagrafica` che ricorda il
  pulsante d'origine, `onAnagraficaVisibleChange` che gli rende il focus dopo la chiusura,
  `onAnagraficaSaved` che ricarica l'elenco e seleziona il record salvato solo se il campo non è
  bloccato (`:563-614`); `onVisibleChange` che **ignora la chiusura del dialog esterno** finché il
  sub-dialog è aperto (Esc di PrimeNG chiude tutti i dialog, `:616-623`). Questo pezzo riusa lo
  schema per **ogni** scelta di anagrafica (D20).
- `fe/features/registry/ditta-identificativi.component.ts` (P.IVA/CF con ricerca della ditta,
  `@Input() tipo: TipoAnagrafica`, `ETICHETTA_RUOLO` `:21-24`), `sedi-ditta-dialog.component.ts`
  (`dittaId`, `ragioneSociale`, `puoGestire`, `(modificata)`), `identificativo-fiscale.ts:19,141-146`
  (regola del privato nel frontend), `anagrafica-form-dialog.component.ts:21` (`TipoAnagrafica`),
  `registry-permissions.ts:29` (`puoGestireAnagrafiche`), `registry.service.ts`,
  `fe/shared/models/registry.model.ts:128` (`Ditta.ruoli`).
- Menu: `fe/shared/components/layout.component.ts:1278-1294` (`navMain`, voce Contratti con
  `feature: 'contratti'`); rotte `fe/app.routes.ts:144-150`.
- E2E: `e2e/tests/` (cartelle per area, `pulizia/`), eseguiti nel job `e2e` di `.gitea/workflows/ci.yml:421`.

## Normativa e punti dubbi

- **FatturaPA** (tracciato 1.2.x, specifiche tecniche AdE): `CodiceDestinatario` di 7 caratteri per i
  privati e le imprese (`0000000` se il cliente non l'ha comunicato o riceve via PEC), di 6 caratteri
  per la PA (codice univoco ufficio IPA); `PECDestinatario` solo con `0000000`;
  `RiferimentoAmministrazione` ≤ 20 caratteri; per la persona fisica `Nome` e `Cognome` al posto di
  `Denominazione`; `EsigibilitaIVA` I/D/S; `ModalitaPagamento` MP01-MP23; `DettaglioPagamento` con
  `IstitutoFinanziario` (≤ 80), `IBAN`, `BIC` (8 o 11); `DatiRitenuta` (tipo, importo, aliquota,
  causale); `DatiBollo` (`BolloVirtuale`, `ImportoBollo`); `DatiContratto` / `DatiOrdineAcquisto` con
  `IdDocumento` obbligatorio (≤ 20) e `CodiceCIG` (≤ 15, di fatto 10), `CodiceCUP` (≤ 15). Questo
  pezzo **salva e valida** i dati; il tracciato si produce in 4.4.
- **Split payment** (art. 17-ter DPR 633/1972): esigibilità `S`, per PA e società controllate.
  **IVA a esigibilità differita** (art. 6 c. 5 DPR 633/1972): `D`. Le due cose si escludono (anche
  WinWaste lo vieta, `CLIFOR.cs:8632-8636`): un solo campo a tre valori.
- **Imposta di bollo** su fatture esenti/escluse sopra 77,47 € (DPR 642/1972, tariffa art. 13): qui
  il contratto sceglie la **spesa di bollo** da addebitare (come WinWaste, E18); il calcolo è di 4.4.
- **Ritenuta d'acconto** (art. 25 DPR 600/1973): qui solo la percentuale sul contratto e sul
  cliente; tipo e causale (`TipoRitenuta`, `CausalePagamento`) e la contropartita "ritenute subite"
  arrivano con 4.4 insieme al calcolo.
- **Registri IVA sezionali** (artt. 23-24 DPR 633/1972; numerazione per serie): qui l'anagrafica dei
  registri vendite e la scelta sul contratto; protocollo e numerazione sono di 4.4/4.5.
- **CIG** (L. 136/2010 art. 3; art. 25 DL 66/2014: senza CIG la PA non paga) e **CUP** (L. 3/2003
  art. 11): sul contratto, perché valgono per l'appalto.
- **IBAN** ISO 13616 con controllo mod-97; italiano di 27 caratteri. **BIC** ISO 9362.
- Punti dubbi risolti nelle Decisioni: il campo "split" sta sul cliente in WinWaste e non sul
  contratto (D7); i periodi di WinWaste sono `gg-mm` senza anno e il periodo che attraversa l'anno è
  un errore dell'elaborazione (D10); il rinnovo massivo di WinWaste sbaglia il 29 febbraio (D11);
  `C2` non è un flag di allegati PDF (D28); i campi di `C3` 9-17 sono modificabili in WinWaste solo con
  la regola 11 (D27).

## Evidenze WinWaste

Sorgenti decompilati con ilspycmd 9.1 nello scratchpad della sessione di analisi (codice di terzi,
non nel progetto): `WWNET03.Contratti.decompiled.cs` (abbreviato `Contratti.cs`), gli altri tipi di
`WWNET03` (`CambiaDataFine.cs`, `CTRAllegato.cs`, `IMPOSTAP.cs`, `TestiFat.cs`, `Soglia.cs`),
`WWNET32.CLIFOR.decompiled.cs` (`CLIFOR.cs`), `liber.qform.decompiled.cs` (`qform.cs`). **O** =
Osservazione (letto nel codice), **D** = Deduzione, **I** = Ignoto.

| # | Fatto | Fonte | Uso qui |
|---|---|---|---|
| E1 | O. Salvataggio del contratto: descrizione obbligatoria ("Inserire una descrizione per questo contratto"), inizio non successivo alla fine, condizione di pagamento, registro IVA e "IVA sospesa" obbligatori se il campo è abilitato (lo è sempre per i clienti), una sola delle due caselle di sospensione | `Contratti.cs:6593-6622` | D8 (attivazione), D9 |
| E2 | O. Record di 27 campi: `CLIFAT`, `PAG`, `BAN`, `AGE`, `SPB`, `BOLLO`, `AN1-3`, `TFAT`, `SOSP` (1 = "Sospendi Contratto", 2 = "Sospendi fatturazione movimenti"), `IVAS`, `PERIODI` (fino a 12 `gg-mm§gg-mm;`), `RINNOVO`, `C1` registro IVA, `C2` contratto principale, `C3` extra, `C4` ritenuta | `Contratti.cs:6669-6750`, etichette `:2957`, `:3658`; `contratti.md` §3 | D5 |
| E3 | O. `C3`: 4-5 soglia, 6 IVA esclusa, 7-8 codice e riferimento fattura PA (visibili solo se il cliente ha `+` nel codice SDI), 9 stipula, 10 commessa, 11 destinatario/sede, 12-13 validità, 14 codice annullo, 15 codice rinnovo, 16 altro, 17 ISTAT, 18 `\D\` NICA, 19 intento escluso | `Contratti.cs:6714-6748`, `:6298-6313` | D5, D27 |
| E4 | O. Un contratto nuovo **eredita dal cliente** pagamento (`[25]`), agente (`[34]`), registro IVA (`[21]`), spese (`[57]`), bollo (`[60]`), IVA sospesa (`[23]`), ritenuta (`[64]`); **non** la banca d'appoggio | `Contratti.cs:6315-6336` | D4 |
| E5 | O. Il cliente di fatturazione uguale all'intestatario viene rifiutato e svuotato ("non va indicato"); deve esistere fra i clienti (`inputCf("C", …)`) | `Contratti.cs:5257-5275`; `qform.cs:7756` | D9 |
| E6 | O. Periodi con regola 11: solo il codice di frequenza (01 mensile, 02 bimestrale, 03 trimestrale, 04 quadrimestrale, 06 semestrale, 12 annuale); altrimenti l'elenco esplicito | `Contratti.cs:6278-6286`, `:6696-6711` | D10 |
| E7 | O. Effetto dei periodi in fatturazione: il contratto si fattura se la fine di un periodo cade nell'intervallo; errore se l'intervallo attraversa l'anno o se più di un periodo vi termina; 28-02 → 29-02 negli anni bisestili; senza periodi vale l'intervallo digitato | `fatturazione.md` §3.2 p. 5 (`FATAUTOMATICA.cs:9425`) | D10 (`periodoDaFatturare`) |
| E8 | O. Sospensione in fatturazione: `SOSP=1` → "Contratto sospeso", nessuna fattura; `SOSP=2` → movimenti esclusi, addebiti fissi sì | `fatturazione.md` §3.2 (`FATAUTOMATICA.cs:10684-10689`, `:12687`) | D8 |
| E9 | O. Rinnovo: casella "Rinnovo annuale automatico"; F6 `CambiaDataFine` porta la fine all'anno successivo per i contratti con fine ≤ data, opzioni "Solo contratti con rinnovo automatico", "Anche contratti sospesi", per cliente e categoria. La query concatena l'anno nuovo con `substring(dataf,5,4)`: da `20240229` produce `20250229`, data inesistente | `Contratti.cs:3262`; `CambiaDataFine.cs:380,389,430,615-636` | D11 (difetto evitato) |
| E10 | O. Anagrafica cliente: ragione sociale, CAP di 5 cifre, ISO, condizione di pagamento obbligatori; P.IVA e codice SDI obbligatori con regola 01; persona fisica con nome e cognome obbligatori; split e IVA sospesa non insieme | `CLIFOR.cs:8545-8615`, `:8622-8642`, `:8708-8730` | D3, D7 |
| E11 | O. Codice SDI: almeno 6 caratteri (salvo `+`/`NO`); `XXXXXX`/`XXXXXXX` vietati per l'Italia; PEC con `@`; riferimento amministrazione solo con codice SDI; PEC di invio solo con `0000000` | `CLIFOR.cs:9039-9080`; contratto `Contratti.cs:5327-5332` | D3 (regole portate) |
| E12 | O. Campi del record cliente: `pag`, `banc` (banca cliente) con IBAN, `bana` "Ns.coord.banc.", `VEN` registro IVA, `IVASOSP`, agente, ritenuta, `sdi`, `CECsplit`, `RifAmmin`, `PECft`, nome/cognome | `CLIFOR.cs:9122-9227`, etichette `:4424-5893` | D3, D21 |
| E13 | O. Avviso (non blocco) se esistono altri clienti con la stessa P.IVA o lo stesso CF | `CLIFOR.cs:9891`, `:9956` | D2: da noi la ditta è unica per identificativo |
| E14 | O. La form del contratto sceglie un cliente esistente ma non lo crea (F1 lista, digitazione validata); apre invece in modale le anagrafiche "minori": F8 sulla condizione apre `CONDIZPAGAM`, F8 altrove `TestiFat`, F4 su categoria e tipo crea il codice in linea | `contratti.md` §9.1-9.2 (Oss. 3, 6, 7) | D20 (qui l'aggiunta in linea vale per tutto, come il FIR di WinWaste §9.3) |
| E15 | O. Condizioni di pagamento: tabella con `NR` rate, `MOD`, `SCA`, `FM` fine mese, `IMP` %, `VAL` giorno valuta; "30 giorni = un mese" | `contabilita.md:22,117,197` | D6 |
| E16 | D. `FPCodice`/`FPRifer` (C3 7-8) sono codice ufficio e riferimento amministrazione per contratto, per la PA con più uffici. I. Dove WinWaste salvi CIG e CUP (la fattura XML li gestisce, `fatturazione.md` §5) | `Contratti.cs:6298-6313`, `:6727-6728` | D5 (CIG/CUP sul contratto per la norma, non per evidenza) |
| E17 | O. `ControlloRegole` (01/09/11) sono configurazioni per singolo cliente di Nica | `contratti.md` §5; rapporto 02 §1.1 | Fuori ambito |
| E18 | O. `SPB` e `BOLLO` sono **codici della tabella `[SPESE]`**: tipo `S` (spese bancarie, campo "Spese bancarie", 2 caratteri) e tipo `E` (campo "Bollo Iva", 2 caratteri); scelti con F1 e validati ("Codice non trovato in tabella"); in fatturazione spese e bollo vengono da `[spese]` con aliquota e contropartita | `Contratti.cs:2933-2940`, `:3233-3248`, `:5052-5068`, `:5350-5366`; `fatturazione.md` §4.7 | D23 |
| E19 | O. `C1` registro IVA: codice di `[REGISTRI CONTABILI]` con `PRECOD='V'` (vendite, codice 01-99), 2 caratteri, validato ("Registro iva non inserito in tabella registri Iva vendita"), obbligatorio, e **non** può essere il registro delle ricevute split payment | `Contratti.cs:3301-3316`, `:5070-5077`, `:5170-5173`, `:6608-6630`; `contabilita.md` §2 | D24, D8 |
| E20 | O. `BAN` "Banca di appoggio": codice di 4 caratteri della tabella `[BANCHE]`, validato ("Banca non presente nel database"); la stessa tabella serve per "Banca cliente" e "Ns.coord.banc." nel cliente; il contratto nuovo **non** la eredita | `Contratti.cs:3117-3124`, `:5333-5349`, `:6315-6336`; `CLIFOR.cs:4519`, `:4541`, `:7413-7446` | D21 |
| E21 | O. `AGE` agente: codice di 6 caratteri scelto fra i **fornitori** (`inputCf("F", …)`), ereditato dal cliente | `Contratti.cs:3170-3185`, `:5283`, `:6323`; `CLIFOR.cs:4729`; `contratti.md` §9.2 Oss. 3 | D22 |
| E22 | O. Provvigioni: il pulsante "Provvigioni" del contratto apre `IMPOSTAP`, che **imposta `PROVV`/`TPROV` su tutte le righe `ADDEBCON`** del contratto ("In TUTTI gli addebiti del presente contratto…"); non è una colonna del contratto | `IMPOSTAP.cs:335`, `:446`; `Contratti.cs:7018-7027`; `fatturazione.md` §4.7 | D5 (escluso, va in 4.2) |
| E23 | O. `C4` ritenuta: "Rit. Acc. %", 5 caratteri; maggiore di 0 ("Non è possibile specificare percentuale 0.") e non oltre 30 ("…maggiore di 30."); richiede la contropartita "ritenute subite" configurata; ereditata dal cliente, che ha anche codice e causale di ritenuta | `Contratti.cs:3391-3406`, `:5368-5383`, `:6335`; `CLIFOR.cs:5893-5916`, `:7488-7532` | D27, D3 |
| E24 | O. `TFAT` testo di fatturazione: codice di 3 caratteri di `[TESTI DI FATTURAZIONE]`, con titolo (60) e 16 righe di 60; F1 lista, F8 apre l'anagrafica; il contratto mostra le righe | `TestiFat.cs:944-1181`; `Contratti.cs:3026`, `:3593`, `:5089-5094`, `:5386-5404`, `:6863-6888` | D25 |
| E25 | O. `CODCAT`/`CODTIP`: codice di 3 cifre (001-999) + descrizione (40); F4 propone il primo codice libero ("Non e' possibile inserire un codice maggiore di 999") e la descrizione digitata **si scrive** in tabella | `Contratti.cs:2867-2918`, `:5098-5121`, `:5179-5245` | D26 |
| E26 | O. `C2` contratto allegato: il codice del **contratto principale** dello stesso cliente (lista dei contratti con `c2 < '0'`, cioè non allegati a loro volta); un contratto che ha già allegati non si allega ("ha gia' esso un contratto allegato"); un contratto con addebiti di tipo diverso da `T` non si allega; in fatturazione gli allegati diventano fatture aggiuntive o confluiscono nel principale | `Contratti.cs:4865-4940`, `:6715`; `CTRAllegato.cs:122-190`; `fatturazione.md` §2 (`C2`), §3.2 p. 8 | D28 |
| E27 | O. Allegati PDF: due file per contratto (`nomepdf`, `nomepdf2`, nella cartella `wwnet.box`), con "Allega file pdf", "Rimuovi alleg.", "Apri" | `Contratti.cs:3467-3504`, `:5031-5032`, `:7900-7925` | D29 |
| E28 | O. `C3` 4-6: "Data inizio controllo soglia" (data), "Soglia max Euro" (16), casella "Iva esclusa" sulla stessa riga; F8 sul soggetto apre "Controllo soglia massima". D. "Iva esclusa" qualifica la soglia (posizione nella form) | `Contratti.cs:3510-3582`, `:6720-6727`; `contratti.md` §9.2 Oss. 1 | D27 |
| E29 | O. `C3` 9-17: stipula (10), commessa (12, anagrafica delle commesse ECOER nei `listini` `G%`), destinatario (3, `[DESTINATARI]` del cliente), "Valido per" numero (3) e unità (1, ammessi `A`, `M`, `G`, `S`, etichetta "A/S/M/G"), "Annullato per" codice (3) e descrizione (60, codifiche di tipo `M`, scrivibili in linea), "Rinnovo automatico (S/N/O)" (`S` e `O` spuntano la casella del rinnovo), "Incr. ISTAT S/N". Abilitati **solo con la regola 11** (fascia 550-650 della form). D. In `A/S/M/G` la `S` sta fra anni e mesi: semestri. I. Il significato di `O` | `Contratti.cs:3700-3935`, `:4629-4669`, `:5407-5447`, `:8851-8900`; `qform.cs:14346`, `:14406-14414`, `:14496-14530` | D27 |
| E30 | O. `C3` 16 `ALTRO` (3 caratteri) non è mai reso visibile né ha un'etichetta: è solo riletto e riscritto; `C3` 18 `\D\` "Da aggiornare" solo NICA; `C3` 19 "A questo contratto non si applica eventuale dichiarazione di intento", visibile solo se il cliente ha una dichiarazione d'intento | `Contratti.cs:3966-3977`, `:6509`, `:6736`, `:6513-6535`, `:4169`, `:6274-6277` | D5 (16 e 18 esclusi), D27 (19) |
| E31 | O. Colonne tecniche del record: `CC` sempre vuoto da questa form, `VER` per la concorrenza, `ID` utente, `IDT` e `Blok` vuoti alla scrittura | `contratti.md` §3 (`WWREM.ScriviContratti`), §4 | D5 (esclusi o resi con `versione` e audit) |
| E32 | O. `AN1`-`AN3`: "Annotazione 1-3", 45 caratteri ciascuna | `Contratti.cs:3050-3106` | D27 |

---

## Decisioni (vincolanti)

**D1. Due modelli (roadmap D5).** `ContrattoCliente` è un modello nuovo; `Contract` non cambia
(niente ruolo attivo/passivo, niente campi di 4.1). Motivo: vocabolario, stati e regole diversi, e
forzare `Contract` è il "bloccante" del rapporto 02 §5.1. Si riusano solo le convenzioni di 4.0
(versione, cancellazione logica, vista con `modificabili`, errori con codice).

**D2. Il cliente è un ruolo su una ditta di F2-10.** Tabella `clienti` con `ditta_id`, `sede_id`
(sede di fatturazione predefinita: l'indirizzo che va in fattura), `@@unique([tenantId, dittaId])`
(una riga cliente per ditta), FK composite verso `ditte` e `sedi_ditte` come gli altri ruoli. Motivi:
(a) la roadmap lo chiede ("il cliente è una ditta con sedi"); (b) un'azienda che è produttore nel
registro e cliente in fattura è la stessa ditta (identità fiscale unica, F2-10 D2), mentre WinWaste
tiene CLIFOR e anagrafiche dei soggetti separate e avvisa soltanto dei doppioni (E13); (c) l'import
3.8 trova il cliente per P.IVA/CF con la stessa ricerca della ditta; (d) le sedi (indirizzo, PEC,
contatti) ci sono già, con la regola "una sede predefinita di un ruolo non si disattiva". La
creazione passa da `creaRuoloSuDitta` (stessa transazione, lock sugli identificativi, ditta trovata
o creata). Ragione sociale, P.IVA, CF, indirizzi **non** si duplicano sul cliente. Lo stesso vale per
l'agente (D22).

**D3. Dati fiscali del cliente** (colonne di `clienti`, regole pure del Task 1). Sono anche i
**predefiniti** del contratto (D4).

| Campo | Tipo | Regola (messaggio esatto) |
|---|---|---|
| `codice` | VarChar(20)?, unico per azienda | codice dell'operatore (es. il `COD` di WinWaste per l'import); 1-20 caratteri `[A-Za-z0-9._-]` → "Il codice cliente può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 20 caratteri)." |
| `codiceDestinatario` | VarChar(7)? | maiuscolo, 6 o 7 caratteri alfanumerici → "Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione)."; `XXXXXX`/`XXXXXXX` → "Il codice destinatario XXXXXXX vale solo per i clienti esteri." (E11) |
| `pecFatturazione` | VarChar(255)? | forma di e-mail → "La PEC per la fattura elettronica non è valida."; solo con codice vuoto o `0000000` → "La PEC per la fattura elettronica si indica solo con il codice destinatario 0000000 o senza codice." (E11) |
| `riferimentoAmministrazione` | VarChar(20)? | ≤ 20 → "Il riferimento amministrazione non può superare 20 caratteri."; solo con codice destinatario → "Il riferimento amministrazione si indica solo insieme al codice destinatario." (E11) |
| `iban` | VarChar(34)? | IBAN **del cliente** (banca cliente, E12: RiBa e addebito diretto). Normalizzato senza spazi, maiuscolo; mod-97 e lunghezza del paese (IT = 27) → "L'IBAN non è valido." |
| `contoCorrenteId` | Uuid? → `conti_correnti` | "Ns. coordinate bancarie" (E12, E20): conto del gestore su cui il cliente paga. Conto attivo dell'azienda → "Il conto corrente scelto non esiste o è disattivato." |
| `condizionePagamentoId` | Uuid? → `condizioni_pagamento` | condizione attiva → "La condizione di pagamento scelta non esiste o è disattivata." |
| `esigibilitaIva` | enum `IMMEDIATA`/`DIFFERITA`/`SCISSIONE`, default `IMMEDIATA` | — (D7) |
| `registroIvaId` | Uuid? → `registri_iva` | registro attivo e non delle ricevute split → messaggi di D24 (E19) |
| `speseIncassoId` | Uuid? → `spese_accessorie` | spesa attiva di tipo `INCASSO` → "La spesa di incasso scelta non esiste, è disattivata o non è una spesa di incasso." (E18) |
| `bolloId` | Uuid? → `spese_accessorie` | spesa attiva di tipo `BOLLO` → "La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo." (E18). Null = bollo non addebitato |
| `agenteId` | Uuid? → `agenti` | agente attivo → "L'agente scelto non esiste o è disattivato." (E21) |
| `ritenutaPercentuale` | Decimal(5,2)? | > 0 e ≤ 30 → "La percentuale di ritenuta deve essere maggiore di 0 e non superiore a 30." (E23). In API stringa decimale `^\d{1,2}(\.\d{1,2})?$` |
| `nome`, `cognome` | VarChar(60)? | obbligatori se la ditta è un privato (Q4) → "Per un cliente persona fisica indica nome e cognome."; vietati altrimenti → "Nome e cognome si indicano solo per un cliente persona fisica." (E10) |
| `note` | Text? | — |
| `attivo` | Boolean, default true | D13 |

Il codice destinatario vuoto è ammesso: in fattura 4.4 userà `0000000`. Nessun dato fiscale nei
messaggi (nessun valore ripetuto). Importi e percentuali viaggiano come **stringhe decimali**, mai
come `number` JS (rapporto 02 §8 p. 5).

**D4. Predefiniti del cliente, valori effettivi sul contratto.** Come WinWaste (E4): alla creazione
del contratto `condizionePagamentoId`, `agenteId`, `registroIvaId`, `speseIncassoId`, `bolloId`,
`esigibilitaIva`, `ritenutaPercentuale`, `codiceDestinatario` e `riferimentoAmministrazione` assenti
nel corpo si **copiano dal cliente**; da lì in poi il contratto ha i suoi valori (modificare il
cliente non cambia i contratti esistenti). 4.4 legge il contratto. Due eccezioni con **valore
effettivo calcolato** invece della copia (funzioni pure del Task 6, usate da 4.4):
- `destinatarioEffettivo`: codice destinatario e riferimento del contratto (PA con più uffici, E3,
  E16) o, se assenti, quelli del cliente di fatturazione; nessuno → `0000000`.
- `contoCorrenteEffettivo`: il conto del contratto o, se assente, quello del cliente. WinWaste non
  copia la banca d'appoggio dal cliente (E20): così un cambio di conto sul cliente vale per tutti i
  contratti che non ne hanno uno proprio, che è il caso comune (si cambia banca, non contratto).

**D5. Perimetro (Q1): mappa completa dei campi WinWaste.** Ogni colonna di `[CONTRATTI]`
(`WWREM.ScriviContratti`, E2, E31) e ogni posizione di `C3` (E3) ha un posto o un'esclusione motivata.

| WinWaste | Contenuto | WasteFlow (`contratti_cliente` salvo indicazione) | Fonte |
|---|---|---|---|
| 1 `PRECOD` | cliente | `cliente_id` → `clienti` | E2 |
| 2 `COD` | progressivo per cliente (≤ 999) | **escluso**: chiave del modello WinWaste `PRECOD+COD`; il numero è `numero` (D12), la chiave d'origine va nello staging di 3.8 | `contratti.md` §3 |
| 3 `DES` | descrizione (45) | `descrizione` (≤ 255) | E1 |
| 4 `NUM` | numero (12) | `numero` (≤ 50, D12) | E2 |
| 5-6 `DATAI`, `DATAF` | inizio, fine | `data_inizio`, `data_fine` (`DATE`) | E1 |
| 7 `CODCAT` | categoria | `categoria_id` → `codifiche_contratto` (`CATEGORIA`) | E25, D26 |
| 8 `CODTIP` | tipo | `tipo_id` → `codifiche_contratto` (`TIPO`) | E25, D26 |
| 9 `CLIFAT` | cliente di fatturazione | `cliente_fatturazione_id` → `clienti` | E5 |
| 10 `PAG` | condizione di pagamento | `condizione_pagamento_id` → `condizioni_pagamento` | D6 |
| 11 `BAN` | banca d'appoggio | `conto_corrente_id` → `conti_correnti` (Q6) | E20, D21 |
| 12 `CC` | — | **escluso**: sempre vuoto da questa form (tecnico) | E31 |
| 13 `AGE` | agente | `agente_id` → `agenti` | E21, D22 |
| 14 `SPB` | spese bancarie | `spese_incasso_id` → `spese_accessorie` (`INCASSO`) | E18, D23 |
| 15 `BOLLO` | bollo su esenzione | `bollo_id` → `spese_accessorie` (`BOLLO`) | E18, D23 |
| 16-18 `AN1`-`AN3` | annotazioni (45) | `annotazioni` (`VarChar(45)[]`, al massimo 3) | E32 |
| 19 `TFAT` | testo di fatturazione | `testo_fatturazione_id` → `testi_fatturazione` | E24, D25 |
| 20 `SOSP` | 0/1/2 | `stato` (`SOSPESO`, `SOSPESO_MOVIMENTI`) | E8, D8 |
| 21 `IVAS` | IVA sospesa S/N | `esigibilita_iva` (D7) | E10 |
| 22 `PERIODI` | fino a 12 periodi | `periodi_fatturazione_cliente` | E6, E7, D10 |
| 23 `RINNOVO` | rinnovo automatico | `rinnovo_automatico` | E9, D11 |
| 24 `C1` | registro IVA vendite | `registro_iva_id` → `registri_iva` | E19, D24 |
| 25 `C2` | contratto principale | `contratto_principale_id` → `contratti_cliente` | E26, D28 |
| 26 `C3` | campi extra | righe sotto | E3 |
| 27 `C4` | ritenuta % | `ritenuta_percentuale` (`Decimal(5,2)`) | E23 |
| `VER` | versione | `versione` (D14) | E31 |
| `ID` | utente che scrive | `activity_logs` (D16) | E31 |
| `IDT`, `Blok` | — | **esclusi**: vuoti alla scrittura (tecnici) | E31 |
| `C3` 0-3 | — | **escluse**: posizioni mai scritte dalla form | `Contratti.cs:6716-6748` |
| `C3` 4-6 | soglia | `soglia_dal` (`DATE`), `soglia_importo` (`Decimal(12,2)`), `soglia_iva_esclusa` | E28, D27 |
| `C3` 7-8 | codice e riferimento PA | `codice_destinatario`, `riferimento_amministrazione` | E3, E16 |
| `C3` 9 | stipula | `data_stipula` | E29 |
| `C3` 10 | commessa | `commessa` (`VarChar(12)`, testo: l'anagrafica delle commesse è ECOER, D27) | E29 |
| `C3` 11 | destinatario/sede | `sede_id` → `sedi_ditte` | E29 |
| `C3` 12-13 | validità | `validita_quantita` (1-999), `validita_unita` (`A`/`S`/`M`/`G`) | E29, D27 |
| `C3` 14 | codice annullo | `motivo_annullo_id` → `codifiche_contratto` (`MOTIVO_ANNULLO`) + `motivo_annullo` (testo) | E29, D8, D26 |
| `C3` 15 | codice rinnovo | `codice_rinnovo` (`S`/`N`; `O` non portato, Q8) | E29, D27 |
| `C3` 16 | `ALTRO` | **escluso**: mai visibile né etichettato nella form, quindi nessun operatore lo compila; il valore d'origine, se c'è, resta nello staging di 3.8 | E30 |
| `C3` 17 | incremento ISTAT | `incremento_istat` | E29, D27 |
| `C3` 18 | `\D\` | **escluso**: funzione NICA per singola installazione (E17) | E30 |
| `C3` 19 | intento escluso | `escludi_dichiarazione_intento` | E30, D27 |
| file `wwnet.box` | due PDF | `allegati_contratto_cliente` (posizione 1 e 2) | E27, D29 |
| `ADDEBCON.PROVV/TPROV` | provvigioni (dal pulsante del contratto) | **escluso da 4.1**: sono colonne delle righe di addebito → **4.2** (listino), con l'azione "imposta la provvigione su tutte le righe" | E22 |
| — | CIG, CUP, documento PA | `codice_cig`, `codice_cup`, `id_documento_pa` (D27: per la norma) | E16 |

Campi del cliente WinWaste lasciati a 4.4 perché servono solo al calcolo o al tracciato: codice e
causale di ritenuta (`codriten`, tabella `RITENUTE`), "Ritenuta 0,5 %", dichiarazione d'intento,
IVA per cassa, contropartite (`CLIFOR.cs:5202`, `:5444`, `:5642`, `:5893-5916`). Zona, categoria del
cliente e black list restano fuori (non sono dati del contratto né della fattura).

**D6. Condizioni di pagamento (Q2).** Tabella `condizioni_pagamento`: `codice` VarChar(10) unico
per azienda (1-10, `[A-Za-z0-9._-]`), `descrizione` VarChar(100) obbligatoria, `modalita`
VarChar(4) fra MP01, MP02, MP05, MP08, MP12, MP19, MP23, `giorniRate` `Int[]` (1-8 valori, interi
0-365 strettamente crescenti; `0` ammesso solo come rata unica = "a vista"), `fineMese` Boolean,
`attiva` Boolean, `versione`. Funzione pura `calcolaScadenze(dataDocumento, condizione)`:
giorni multipli di 30 = mesi di calendario ("30 giorni = un mese", E15; 31/01 + 30 → 28/02 o
29/02), altrimenti giorni; con `fineMese` la scadenza va all'ultimo del mese. Date come stringhe
`YYYY-MM-DD` (nessun fuso). La ripartizione degli importi fra le rate è di 4.4. Mai cancellata se
usata (D13). Giorno valuta e mesi esclusi: seguito (fuori ambito).

**D7. Esigibilità IVA a tre valori.** `IMMEDIATA`, `DIFFERITA`, `SCISSIONE` (split payment) sul
cliente come predefinito e sul contratto come valore effettivo. Un campo solo perché sospensione e
split si escludono (E10, `CLIFOR.cs:8632`). In WinWaste lo split sta solo sul cliente e il contratto
ha "IVA sospesa S/N": qui il contratto può fissare anche la scissione, che copre i due casi senza
un secondo campo. Nessun controllo incrociato col tipo di cliente (la PA non è riconoscibile dai dati
che abbiamo).

**D8. Stati e transizioni (Q3).**

| Da \ A | ATTIVO | SOSPESO | SOSPESO_MOVIMENTI | ANNULLATO |
|---|---|---|---|---|
| BOZZA | sì (richiede condizione di pagamento e registro IVA) | — | — | — (la bozza si elimina) |
| ATTIVO | — | sì | sì | sì (motivo obbligatorio) |
| SOSPESO | sì | — | sì | sì |
| SOSPESO_MOVIMENTI | sì | sì | — | sì |
| ANNULLATO | — | — | — | — (definitivo) |

Messaggi: transizione non ammessa → 409 `CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA` "Dallo stato
<etichetta> non si passa a <etichetta>."; bozza senza condizione → 400 "Per attivare il contratto
indica la condizione di pagamento."; bozza senza registro IVA → 400 "Per attivare il contratto indica
il registro IVA." (E1, E19: in WinWaste sono obbligatori al salvataggio; qui lo sono per uscire dalla
bozza, così il contratto si può preparare prima di aver configurato i registri). Annullo:
`PATCH :id/stato { stato: 'ANNULLATO', versione, motivoAnnulloId?, motivo? }`; almeno uno dei due →
400 "Indica il motivo dell'annullo." (regola 11 di WinWaste, `contratti.md` §5, resa generale perché
senza motivo l'annullo non si ricostruisce); con il solo codice il testo `motivo_annullo` prende la
descrizione della codifica (E29: codice e descrizione insieme); codifica non attiva o di altro genere
→ 400 "Il motivo di annullo scelto non esiste o è disattivato.". L'annullo salva `annullatoIl`.
Etichette: Bozza, Attivo, Sospeso, Sospeso (solo movimenti), Annullato. "Scaduto" = `dataFine < oggi`
(data locale italiana), calcolato nella vista, nessuna transizione automatica. La semantica di
fatturazione (E8) è documentata nel commento del modulo per 4.4: `SOSPESO` = nessuna fattura,
`SOSPESO_MOVIMENTI` = solo addebiti fissi, `BOZZA` e `ANNULLATO` = mai.

**D9. Campi modificabili e validazione.** `BOZZA`: tutti i 37 campi di `CampoContrattoCliente`
(Task 6). `ATTIVO`, `SOSPESO`, `SOSPESO_MOVIMENTI`: tutti tranne `numero`, `clienteId`, `dataInizio`
(cambiarli fa un altro contratto, come 4.0 D2). `ANNULLATO`: nessuno → 409
`CONTRATTO_CLIENTE_NON_MODIFICABILE` "Un contratto annullato non si modifica.". `stato`,
`motivoAnnulloId`, `motivoAnnullo`, `annullatoIl` non sono campi della modifica. Validazione
(`validaContrattoCliente`, creazione e modifica, messaggi nell'ordine dei campi): numero non vuoto
≤ 50; descrizione obbligatoria ≤ 255 ("Inserisci una descrizione per questo contratto.", E1); data
di inizio obbligatoria; fine non precedente all'inizio ("La data di fine non può precedere la data
di inizio.", E1); rinnovo automatico solo con data di fine ("Il rinnovo automatico richiede una data
di fine."); cliente di fatturazione uguale al cliente → **normalizzato a null** senza errore (E5);
codice destinatario e riferimento come D3; ritenuta come D3; campi di D27; periodi come D10.
Controlli che leggono il database (nel servizio, dopo la validazione pura, solo per i riferimenti
cambiati): cliente e cliente di fatturazione esistenti e **attivi** ("Il cliente scelto non esiste o
è disattivato." / "Il cliente di fatturazione scelto non esiste o è disattivato."), sede attiva della
ditta del cliente ("La sede scelta non è una sede attiva del cliente."), condizione, conto corrente,
agente, spese, bollo, registro IVA (D3, D24), testo di fatturazione ("Il testo di fatturazione
scelto non esiste o è disattivato."), categoria e tipo ("La categoria scelta non esiste o è
disattivata." / "Il tipo di contratto scelto non esiste o è disattivato."), contratto principale
(D28). Confronto dei campi come 4.0 D5 (date per giorno, stringhe col trim, vuoto = null, decimali
per valore, periodi e annotazioni come elenchi).

**D10. Periodi di fatturazione con effetto.** Tabella figlia `periodi_fatturazione_cliente`
(`contratto_id`, `ordine` 1-12, `giornoInizio`, `meseInizio`, `giornoFine`, `meseFine`), sostituita
**in blocco** a ogni scrittura dei periodi, nella stessa transazione condizionata del contratto.
Regole pure (`periodi-fatturazione.ts`): al massimo 12 ("Al massimo 12 periodi di fatturazione.");
giorno e mese validi in un anno bisestile (29/02 ammesso; "Periodo <n>: data non valida.");
inizio non successivo alla fine **nello stesso anno** ("Periodo <n>: l'inizio non può seguire la
fine (i periodi non attraversano l'anno)."); periodi non sovrapposti ("I periodi <n> e <m> si
sovrappongono."); salvati ordinati per inizio. `periodiDaFrequenza(MENSILE|BIMESTRALE|TRIMESTRALE|
QUADRIMESTRALE|SEMESTRALE|ANNUALE)` genera l'elenco (E6: es. trimestrale = 01/01-31/03, 01/04-30/06,
01/07-30/09, 01/10-31/12). Nessun periodo = il contratto si fattura a ogni elaborazione (E7).
**Effetto:** `periodoDaFatturare(periodi, dal, al)` porta la regola di `periodofisso` (E7) e restituisce
`NESSUN_PERIODO` (vale l'intervallo richiesto), `PERIODO { dal, al }` (il periodo dell'anno
dell'intervallo, fine 28/02 → 29/02 negli anni bisestili), `NESSUNA_SCADENZA` (nessuna fine cade
nell'intervallo: il contratto non si fattura) o `ERRORE` ("L'intervallo di fatturazione non può
attraversare l'anno." / "Nell'intervallo terminano più periodi del contratto: restringi le date.");
`prossimaFinePeriodo(periodi, oggi)` alimenta la colonna "Prossima fatturazione" della lista. Oggi
nessuno chiama `periodoDaFatturare` fuori dai test: è il contratto con 4.4, scritto qui perché il
dato senza la sua regola tornerebbe un'etichetta.

**D11. Rinnovo e proroga (Q5).** `POST /contratti-clienti/:id/rinnova { versione }`: data di fine
+ 1 anno (29/02 → 28/02), ammesso con data di fine e stato diverso da `BOZZA`/`ANNULLATO`
(409 `CONTRATTO_CLIENTE_NON_RINNOVABILE` "Si rinnovano solo i contratti attivi o sospesi con una
data di fine."). `POST /contratti-clienti/proroga-scadenze { scadutiEntro, soloRinnovoAutomatico =
true, ancheSospesi = false, clienteId?, categoriaId? }`: per tutti i contratti non eliminati, attivi
(e sospesi se richiesto), con data di fine ≤ `scadutiEntro`, fine + 1 anno e `versione + 1`, in una
transazione; risponde `{ prorogati: number }` e scrive **una** riga di audit con il conteggio e i
filtri (E9: WinWaste filtra anche per categoria; con la data corretta dove WinWaste sbaglia il
29/02). Scrittura con `tx.$executeRaw` (`data_fine + interval '1 year'`) dentro la transazione con
contesto: la RLS vale anche per il raw, e il `WHERE` ripete comunque `tenant_id`. Nessun job
automatico. `codiceRinnovo` non cambia l'operazione: conta `rinnovoAutomatico` (D27).

**D12. Numero.** Unico per azienda (`contratti_cliente_tenant_id_numero_key`), libero, ≤ 50; il
dialog propone `CC-<anno>-<NNN>` da `GET /contratti-clienti/prossimo-numero` (stesso schema di
`Contract.nextContractNumber`, contando anche gli eliminati). Il numero di un contratto eliminato
resta riservato (come 4.0 D3). Il progressivo per cliente "fino a 999" e la numerazione controllata
(regola 09) di WinWaste non si portano: sono vincoli del suo modello a chiave `PRECOD+COD`. Per
l'import 3.8 la chiave d'origine si gestirà nello staging.

**D13. Cancellazione e disattivazione.**
- Contratto: cancellazione **logica** (`eliminatoIl`, `eliminatoDa`) solo in `BOZZA`
  (409 `CONTRATTO_CLIENTE_NON_ELIMINABILE` "Si eliminano solo i contratti in bozza: per chiudere
  questo contratto annullalo."). Un eliminato sparisce da elenco, dettaglio (404), modifica, stato,
  rinnovo, proroga, allegati, scelta come contratto principale. Periodi e allegati restano (cascata
  solo su cancellazione fisica). Una bozza con contratti allegati non si elimina (409
  `CONTRATTO_CLIENTE_CON_ALLEGATI` "Il contratto ha dei contratti allegati: staccali prima di
  eliminarlo.").
- Cliente e agente: `attivo` (disattiva/riattiva con `PATCH`); un soggetto disattivato non si
  sceglie per contratti o clienti nuovi, quelli esistenti restano. Cancellazione **fisica** solo se
  nessuna riga lo cita: FK `NoAction`, P2003 → 409 `CLIENTE_CON_CONTRATTI` "Il cliente ha dei
  contratti: non si elimina. Disattivalo per non usarlo nei contratti nuovi." (stessa idea di
  `cancellacontratti`, `contratti.md` §6) e `AGENTE_IN_USO` "L'agente è indicato su clienti o
  contratti: disattivalo invece di eliminarlo.". La ditta e le sedi restano (sono di F2-10).
- Tabelle di fatturazione (condizioni, conti correnti, spese, registri IVA, testi, codifiche):
  `attiva`; cancellazione fisica solo se nessun cliente o contratto la cita, P2003 → 409
  `<ENTITA>_IN_USO` "<Soggetto> è usato da clienti o contratti: disattivalo invece di eliminarlo."
  (soggetti: "La condizione di pagamento", "Il conto corrente", "La spesa", "Il registro IVA", "Il
  testo di fatturazione", "La codifica"; accordo di genere nel participio).
- Allegato PDF: cancellazione fisica (WinWaste "Rimuovi alleg.", E27), anche a contratto annullato.

**D14. Lock ottimistico.** Colonna `versione INTEGER NOT NULL DEFAULT 1` (CHECK ≥ 1) su
`condizioni_pagamento`, `conti_correnti`, `spese_accessorie`, `registri_iva`, `testi_fatturazione`,
`codifiche_contratto`, `agenti`, `clienti`, `contratti_cliente` (9 tabelle; non su periodi e allegati,
che si scrivono attraverso il contratto o si sostituiscono). Ogni scrittura (modifica, stato,
rinnovo, proroga, disattivazione, eliminazione) fa `updateMany`/`deleteMany({ where: { id, tenantId,
versione, … } })` con `versione: { increment: 1 }`; `count === 0` → 409
`<ENTITA>_MODIFICATO_NEL_FRATTEMPO` (o `_MODIFICATA_` per i nomi femminili) "… è stato modificato nel
frattempo da un'altra operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione."
(testo di 4.0 D9, con il soggetto). Ordine dei controlli come 4.0 D4: (1) 404; (2) stato che non
ammette la modifica; (3) versione diversa; (4) campi non ammessi; (5) validazione pura; (6) controlli
sul database; (7) scrittura condizionata con audit. P2002 → 409 con codice per vincolo:
`CONTRATTO_CLIENTE_NUMERO_DUPLICATO` "Esiste già un contratto con questo numero.",
`CLIENTE_CODICE_DUPLICATO` "Esiste già un cliente con questo codice.", `AGENTE_CODICE_DUPLICATO`
"Esiste già un agente con questo codice.", `<ENTITA>_CODICE_DUPLICATO` "Esiste già <un/una> <entità>
con questo codice." per le tabelle di fatturazione, `CONTO_CORRENTE_IBAN_DUPLICATO` "Esiste già un
conto corrente con questo IBAN.", `ALLEGATO_POSIZIONE_OCCUPATA` "In questa posizione c'è già un
allegato: rimuovilo prima di caricarne un altro.". Un corpo senza differenze non scrive e non lascia
audit, ma controlla la versione. La traduzione per nome di vincolo sta in **un** helper
(`src/application/clienti/anagrafica-versionata.ts`, Task 10), usato da tutti i servizi del pezzo.

**D15. Integrità nel database.** FK composite con `tenant_id` (un id di un'altra azienda non si
aggancia nemmeno a livello SQL), tutte `NoAction` salvo indicazione:
`clienti` e `agenti` → `ditte (id, tenant_id)` e `sedi_ditte (id, ditta_id, tenant_id)`;
`clienti` → `condizioni_pagamento`, `conti_correnti`, `registri_iva`, `agenti`, `spese_accessorie`
(due relazioni con nome: incasso e bollo), sempre `(id, tenant_id)`; `contratti_cliente` → `clienti`
(due relazioni: cliente e cliente di fatturazione), `sedi_ditte (id, tenant_id)` (l'appartenenza alla
ditta del cliente la controlla il servizio), `condizioni_pagamento`, `conti_correnti`, `agenti`,
`spese_accessorie` (due), `registri_iva`, `testi_fatturazione`, `codifiche_contratto` (tre relazioni:
categoria, tipo, motivo di annullo; il **genere** lo controlla il servizio), `contratti_cliente`
(principale, autoreferenziale); `periodi_fatturazione_cliente` e `allegati_contratto_cliente` →
`contratti_cliente (id, tenant_id)` `ON DELETE CASCADE`; ogni tabella → `tenants` `ON DELETE CASCADE`.
CHECK: `versione >= 1`; eliminazione coerente (`eliminato_da IS NULL OR eliminato_il IS NOT NULL`);
`cardinality(giorni_rate) BETWEEN 1 AND 8`; `ordine BETWEEN 1 AND 12`, giorni 1-31 e mesi 1-12,
`unique (contratto_id, ordine)`; `stato <> 'ANNULLATO' OR (motivo_annullo IS NOT NULL AND
annullato_il IS NOT NULL)`; `data_fine IS NULL OR data_fine >= data_inizio`;
`contratto_principale_id IS NULL OR contratto_principale_id <> id`; `ritenuta_percentuale IS NULL OR
(ritenuta_percentuale > 0 AND ritenuta_percentuale <= 30)` (su clienti e contratti); `soglia_importo
IS NULL OR soglia_importo > 0`; `soglia_dal IS NULL OR soglia_importo IS NOT NULL`;
`(validita_quantita IS NULL) = (validita_unita IS NULL)` e `validita_quantita BETWEEN 1 AND 999`;
`validita_unita IN ('A','S','M','G')`; `codice_rinnovo IN ('S','N')`;
`cardinality(annotazioni) <= 3` (e `testi_fatturazione`: `cardinality(righe) BETWEEN 1 AND 16`);
`spese_accessorie.importo >= 0`; `registri_iva.codice ~ '^[0-9]{2}$'`; allegati: `posizione IN (1,2)`,
`mime_type = 'application/pdf'`, `dimensione_byte BETWEEN 1 AND 4194304`, `unique (contratto_id,
posizione)`. Date dei contratti come `DATE` (`@db.Date`): niente ore né fusi.

**D16. Audit senza dati personali.** `activity_logs` nella stessa transazione. Azioni:
`CONDIZIONE_PAGAMENTO_*`, `CONTO_CORRENTE_*`, `SPESA_ACCESSORIA_*`, `REGISTRO_IVA_*`,
`TESTO_FATTURAZIONE_*`, `CODIFICA_CONTRATTO_*` (`CREATA|CREATO`, `MODIFICATA|MODIFICATO`,
`ELIMINATA|ELIMINATO`), `AGENTE_CREATO|MODIFICATO|DISATTIVATO|RIATTIVATO|ELIMINATO`,
`CLIENTE_CREATO|MODIFICATO|DISATTIVATO|RIATTIVATO|ELIMINATO`,
`CONTRATTO_CLIENTE_CREATO|MODIFICATO|STATO|RINNOVATO|PROROGATI|ELIMINATO`,
`ALLEGATO_CONTRATTO_CLIENTE_CARICATO|RIMOSSO`. Metadata: solo id, numero del contratto, codici delle
tabelle di fatturazione, nomi dei campi cambiati, stati, date, posizione e dimensione dell'allegato,
conteggi. **Mai**: ragione sociale o nome di un privato, codice fiscale, P.IVA, IBAN e BIC (anche del
gestore), PEC, codice destinatario, nome/cognome, note, annotazioni, righe dei testi, motivo
dell'annullo (testo libero), nome del file allegato, commessa. Per il contratto `prima`/`dopo` solo
per date, stato, flag, esigibilità, percentuali e id dei riferimenti. Descrizioni: "Cliente creato",
"Contratto <numero> modificato" (il numero è un dato dell'azienda, non personale). Log applicativi
con id, mai valori.

**D17. API, ruoli, azienda.** Ogni rotta: `requireRequestTenantId(req)` e `@Roles(...)` esplicito
(ruolo effettivo dal `RolesGuard`): letture `SUPER_ADMIN, ADMIN, OPERATOR, VIEWER`, scritture
`SUPER_ADMIN, ADMIN, OPERATOR`. `ParseUUIDPipe` sugli id, `DELETE …?versione=` con `ParseIntPipe`
(204). Elenchi di clienti, agenti e contratti paginati lato server (`pagina` ≥ 1, `dimensione`
1-100, default 25) con risposta `{ elementi, totale }`; le tabelle di fatturazione (decine di righe)
rispondono con l'elenco intero. Rotte:
- `/condizioni-pagamento`, `/conti-correnti`, `/registri-iva`, `/testi-fatturazione`: `GET`
  (`?incluseDisattivate`), `GET :id`, `POST`, `PATCH :id`, `DELETE :id`.
- `/spese-accessorie`: come sopra con `?tipo=INCASSO|BOLLO`.
- `/codifiche-contratto`: come sopra con `?genere=CATEGORIA|TIPO|MOTIVO_ANNULLO` (obbligatorio sul
  `GET` elenco), più `GET prossimo-codice?genere=` **prima** di `:id`; `POST { genere, descrizione,
  codice? }` (codice omesso = primo libero, D26).
- `/agenti`: `GET` (`?testo`, `?soloAttivi`, paginato), `GET :id`, `POST` (dati della ditta come le
  altre anagrafiche + `codice?`, `note?`, `sedeId?`; risposta con `dittaEsistente` e `avvisi`),
  `PATCH :id` (`codice`, `note`, `sedeId`, `attivo`), `DELETE :id`.
- `/clienti`: `GET` (`?testo` su ragione sociale/codice/P.IVA, `?soloAttivi`, paginato), `GET :id`,
  `POST` (dati della ditta + dati fiscali; risposta con `dittaEsistente` e `avvisi`), `PATCH :id`
  (dati fiscali, `sedeId` predefinita, `attivo`; mai gli identificativi: quelli si correggono sulla
  ditta, F2-10), `DELETE :id`.
- `/contratti-clienti`: `GET` (`?stato`, `?clienteId`, `?categoriaId`, `?tipoId`, `?testo`,
  `?inScadenzaEntroGiorni`, paginato), `GET prossimo-numero` e `POST proroga-scadenze` **prima** di
  `:id`, `GET :id`, `POST`, `PATCH :id`, `PATCH :id/stato { stato, versione, motivoAnnulloId?,
  motivo? }`, `POST :id/rinnova { versione }`, `DELETE :id`;
  `GET :id/allegati` (metadati), `POST :id/allegati` (multipart: file `allegato`, campo `posizione`),
  `GET :id/allegati/:allegatoId/contenuto` (PDF, `Content-Disposition: attachment`),
  `DELETE :id/allegati/:allegatoId`.
Feature flag: si riusa `contratti` (nessuna chiave nuova in `feature-catalog.ts`).

**D18. Ruoli `CLIENTE` e `AGENTE` in F2-10 (modifica mirata).** `RuoloControparte` diventa
`'PRODUTTORE' | 'TRASPORTATORE' | 'DESTINATARIO' | 'CLIENTE' | 'AGENTE'` (`NOME_RUOLO.CLIENTE =
'cliente'`, `NOME_RUOLO.AGENTE = 'agente'`); `ruoliDellaDitta` legge anche `clienti` e `agenti` (così la
sede predefinita non si disattiva, e `DittaDto.ruoli` ha `clienteId` e `agenteId`); `NomeRuolo` e
`SedeNonValidaPerRuoloError` accettano `'cliente'` e `'agente'`; con Q4 la regola del privato diventa
"produttore o cliente" (`MESSAGGIO_PRIVATO_SOLO_PRODUTTORE` → "Un privato senza partita IVA può
essere solo produttore o cliente.", stesso testo nel frontend `identificativo-fiscale.ts:19`).
L'agente privato senza P.IVA **non** è ammesso: in WinWaste è un fornitore (E21), che fattura le
provvigioni. Nessun'altra modifica al registry.

**D19. RLS e privilegi.** Undici tabelle con `tenant_id`, RLS `ENABLE` + `FORCE`,
`isolamento_azienda` e `sola_lettura TO wasteflow_lettura` (forma di
`20261031110000_ditte_sedi_controparti/migration.sql:326-338`); modelli in `TENANT_SCOPED_MODELS`.
Catalogo **44 → 50** dopo il Task 8 (`CondizionePagamento`, `ContoCorrente`, `SpesaAccessoria`,
`RegistroIva`, `TestoFatturazione`, `CodificaContratto`) e **50 → 55** dopo il Task 9 (`Agente`,
`Cliente`, `ContrattoCliente`, `PeriodoFatturazioneCliente`, `AllegatoContrattoCliente`).
`ruoli-db.sql` invariato: le tabelle ricevono il CRUD predefinito (servono `DELETE` per tabelle di
fatturazione, soggetti, periodi e allegati; per i contratti la cancellazione è logica come
`contracts`).

**D20. Frontend.** Voci di menu in `navMain` dopo "Contratti": "Clienti" (`/clienti`, `pi pi-users`)
e "Contratti clienti" (`/contratti-clienti`, `pi pi-file-edit`), `feature: 'contratti'`. Dalla lista
clienti due pulsanti: "Agenti" (`/clienti/agenti`) e "Tabelle di fatturazione" (`/clienti/tabelle`,
`p-tabView` con le schede Condizioni di pagamento, Conti correnti, Spese e bollo, Registri IVA, Testi
di fatturazione, Categorie e tipi, Motivi di annullo). **Aggiunta in linea ovunque**: ogni campo che
sceglie un'anagrafica nel dialog del cliente e in quello del contratto ha accanto "Nuovo …" (e
"Modifica … selezionato" dove ha senso), con lo schema di `contract-create-dialog.component.ts`
(Stato di partenza): sub-dialog in sovrapposizione, focus restituito al pulsante, record salvato
selezionato solo se il campo non è bloccato, Esc del sub-dialog che non chiude il dialog esterno.
Lo schema è scritto **una volta** in `fe/features/clienti/aggiunta-in-linea.ts` (Task 20) e usato da
tutti i dialog. Per categoria, tipo e motivo di annullo basta la descrizione (codice proposto, come F4
di WinWaste, E25). Il contratto sceglie il cliente esistente con un autocomplete e, con "Nuovo
cliente", lo crea in sovrapposizione (più comodo di WinWaste, E14, e senza rischi). Il frontend non
replica regole: abilita campi e pulsanti da `modificabili`, `eliminabile`, `transizioni`,
`rinnovabile` della vista.

**D21. Conti correnti del gestore (Q6).** Tabella `conti_correnti`: `codice` VarChar(10) unico per
azienda (1-10, `[A-Za-z0-9._-]`; il `COD` di 4 caratteri di `[BANCHE]` per l'import), `descrizione`
VarChar(100) obbligatoria, `banca` VarChar(80) obbligatoria (`IstitutoFinanziario` della FatturaPA,
≤ 80), `iban` VarChar(34) obbligatorio e valido (D3, unico per azienda), `bic` VarChar(11)? (8 o 11,
`^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$` → "Il BIC non è valido."), `attivo`, `versione`. Scelto sul
cliente (`contoCorrenteId`, "Ns. coordinate bancarie") e sul contratto (`contoCorrenteId`, "Banca
d'appoggio"); valore effettivo con `contoCorrenteEffettivo` (D4). ABI e CAB si ricavano dall'IBAN
italiano in 4.4, non si salvano.

**D22. Agenti.** Ruolo su ditta (D2, D18): tabella `agenti` con `ditta_id`, `sede_id`, `codice`
VarChar(20)? unico per azienda (stessa regola del codice cliente, testo "Il codice agente …"),
`note`, `attivo`, `versione`, `@@unique([tenantId, dittaId])`. Scelto sul cliente (predefinito) e sul
contratto (E21). Le provvigioni sono di 4.2 (E22); il loro calcolo e la tabella delle provvigioni
maturate di 4.4.

**D23. Spese accessorie (spese di incasso e bollo).** Una tabella `spese_accessorie` per i due tipi
della tabella `[SPESE]` di WinWaste (E18): `tipo` enum `INCASSO` (`S`, "spese bancarie") | `BOLLO`
(`E`, "bollo su esenzione"), `codice` VarChar(10) unico per `(tenant, tipo)`, `descrizione`
VarChar(100) obbligatoria, `importo` Decimal(10,2) ≥ 0 obbligatorio ("L'importo deve essere un numero
non negativo con al massimo due decimali."; in API stringa `^\d{1,8}(\.\d{1,2})?$`), `attiva`,
`versione`. Aliquota IVA, natura e contropartita arrivano con 4.4, che ha la tabella IVA e il piano
dei conti. Il cliente e il contratto scelgono `speseIncassoId` (tipo `INCASSO`) e `bolloId` (tipo
`BOLLO`); il servizio controlla il tipo (D3).

**D24. Registri IVA sezionali.** Tabella `registri_iva` (solo vendite: è l'unico tipo che serve al
contratto, E19): `codice` VarChar(2) `^[0-9]{2}$` 01-99 unico per azienda ("Il codice del registro IVA
è di due cifre, da 01 a 99."), `descrizione` VarChar(60) obbligatoria, `ricevuteSplit` Boolean
default false (il registro delle ricevute split payment, che WinWaste prende dalla configurazione),
`attivo`, `versione`. Sul cliente e sul contratto si sceglie un registro attivo con `ricevuteSplit =
false` ("Il registro IVA scelto non esiste o è disattivato." / "Il registro delle ricevute split
payment non si usa per le fatture del contratto.", E19). Protocollo, serie e numerazione delle
fatture: 4.4/4.5.

**D25. Testi di fatturazione.** Tabella `testi_fatturazione` (E24): `codice` VarChar(3) `[A-Za-z0-9]{1,3}`
unico per azienda, `titolo` VarChar(60) obbligatorio, `righe` `VarChar(60)[]` 1-16 ("Il testo di
fatturazione ha da 1 a 16 righe di al massimo 60 caratteri."; righe vuote in coda tolte), `attivo`,
`versione`. La stampa in fattura è di 4.4; il dialog del contratto mostra le righe del testo scelto.

**D26. Codifiche del contratto (categorie, tipi, motivi di annullo).** Una tabella
`codifiche_contratto` per tre elenchi di codice e descrizione che WinWaste tiene in tabelle di
categorie per tipo (E25, E29): `genere` enum `CATEGORIA` | `TIPO` | `MOTIVO_ANNULLO`, `codice`
VarChar(3) `[A-Za-z0-9]{1,3}` unico per `(tenant, genere)`, `descrizione` VarChar(60) obbligatoria
(WinWaste: 40 per categoria e tipo, 60 per il motivo), `attiva`, `versione`. **Creazione in linea**
come F4: `POST` senza `codice` → il servizio assegna il primo codice numerico libero `001`-`999` del
genere (funzione pura `primoCodiceLibero(usati)`; oltre → 400 "Non si possono creare più di 999
codici per questo elenco."), con un nuovo tentativo su P2002 (due operatori nello stesso istante).
Categoria e tipo filtrano elenco e proroga (D11, D17) e in 4.4 l'elaborazione delle fatture.

**D27. Campi aggiuntivi del contratto** (regole pure del Task 6, messaggi esatti):

| Campo | Tipo | Regola |
|---|---|---|
| `ritenutaPercentuale` | Decimal(5,2)? | come D3 (E23). La contropartita "ritenute subite" la verifica 4.4 al calcolo |
| `sogliaDal` | Date? | solo con soglia → "La data di inizio controllo soglia richiede la soglia massima." |
| `sogliaImporto` | Decimal(12,2)? | > 0 → "La soglia massima deve essere un importo positivo con al massimo due decimali." Il controllo sul fatturato (F8 "Controllo soglia massima", E28) è di 4.4 |
| `sogliaIvaEsclusa` | Boolean, default false | senza soglia → normalizzato a false |
| `commessa` | VarChar(12)? | `[A-Za-z0-9._/-]{1,12}` → "La commessa può contenere al massimo 12 caratteri fra lettere, cifre, punto, barra, trattino e trattino basso." Testo libero: l'anagrafica delle commesse di WinWaste è una personalizzazione ECOER nei `listini` `G%` (E29) |
| `validitaQuantita`, `validitaUnita` | Int?, VarChar(1)? | entrambi o nessuno → "Indica sia la durata sia l'unità della validità."; 1-999 → "La durata della validità va da 1 a 999."; unità `A` Anni, `S` Semestri, `M` Mesi, `G` Giorni (E29). Informativo: non calcola la data di fine |
| `codiceRinnovo` | VarChar(1)? | `S`, `N` (E29; `O` non portato, Q8); `S` → `rinnovoAutomatico = true`, `N` → `false` (`Contratti.cs:5423-5433`). Etichette: Sì, No |
| `incrementoIstat` | Boolean, default false | l'aggiornamento dei prezzi ISTAT (F12, `frmaggprezziistat`) è di 4.2 |
| `escludiDichiarazioneIntento` | Boolean, default false | la dichiarazione d'intento del cliente e la sua applicazione sono di 4.4 (E30) |
| `annotazioni` | VarChar(45)[] | al massimo 3, ciascuna ≤ 45 → "Al massimo 3 annotazioni di 45 caratteri ciascuna." (E32); vuote tolte |
| `codiceCig` | VarChar(15)? | 10 caratteri alfanumerici → "Il CIG deve avere 10 caratteri alfanumerici." |
| `codiceCup` | VarChar(15)? | 15 alfanumerici → "Il CUP deve avere 15 caratteri alfanumerici." |
| `idDocumentoPa` | VarChar(20)? | numero del contratto/ordine della PA, obbligatorio se c'è CIG o CUP → "Con CIG o CUP indica anche il riferimento del documento della PA (contratto, convenzione o ordine)." |

In WinWaste i campi di `C3` 9-17 si compilano solo con la regola 11 (E29); qui sono sempre
disponibili e **mai obbligatori**: gli obblighi della regola 11 sono configurazione di
un'installazione (E17, fuori ambito).

**D28. Contratto allegato (`C2`).** `contrattoPrincipaleId` (E26): il contratto principale deve
essere **dello stesso cliente**, non eliminato, non annullato, diverso da sé e **non allegato a sua
volta**; un contratto che ha già allegati non si allega. Messaggi: "Un contratto non può essere
allegato a sé stesso." (regola pura); "Il contratto principale deve essere un contratto dello stesso
cliente, non annullato e non allegato a sua volta." e "Questo contratto ha dei contratti allegati:
non può essere allegato a un altro." (servizio, con `SELECT … FOR UPDATE` del principale nella
transazione per evitare che due allegamenti concorrenti creino una catena). Il vincolo "solo addebiti
di tipo T" arriva con gli addebiti in 4.2; l'effetto in fatturazione (fatture aggiuntive o confluite,
`fatturazione.md` §3.2 p. 8) in 4.4. La vista del contratto riporta `contrattoPrincipale { id,
numero }` e `allegati: number`.

**D29. Allegati PDF del contratto.** Tabella `allegati_contratto_cliente` (E27): `contratto_id`,
`posizione` 1|2 (i due file di WinWaste), `nome_file` VarChar(255), `mime_type` sempre
`application/pdf`, `dimensione_byte` ≤ 4 MiB, `sha256`, `contenuto` `BYTEA`, `caricato_da`,
`created_at`; `unique (contratto_id, posizione)`. Stesso modello di conservazione delle pese (4.8a Q3:
nel database, magic bytes verificati con `riconosciTipoFile`, ammesso solo `application/pdf` →
415 "L'allegato del contratto deve essere un PDF."; oltre 4 MiB → 413 "L'allegato supera i 4 MB.").
Si sostituisce rimuovendo e ricaricando (P2002 → `ALLEGATO_POSIZIONE_OCCUPATA`). Caricamento e
rimozione ammessi in ogni stato tranne il contratto eliminato (404), senza toccare la `versione` del
contratto: l'allegato non è un dato del contratto.

**D30. Due migration.** Le undici tabelle stanno in due migration, una per task (Task 8 e Task 9),
per tenere ciascun task di schema piccolo e verificabile: `20261102200000_anagrafiche_fatturazione_cliente`
(sei tabelle che non dipendono da ditte né da clienti) e `20261102200100_clienti_agenti_contratti_cliente`
(cinque tabelle). Ognuna con il suo ripristino a mano e il suo paragrafo in `ops/README.md`; la seconda
dipende dalla prima.

---

## Vincoli globali

- Commit con percorsi espliciti (`git commit -m "…" -- <file…>`), messaggi in italiano,
  **nessuna attribuzione AI** (né `Co-Authored-By` né `Claude-Session` né altro). Niente push.
- Commenti e testi in italiano, termini tecnici non tradotti. Messaggi all'utente in italiano, senza
  id né dati fiscali o personali.
- Azienda sempre da `requireRequestTenantId(req)`; ruolo effettivo dal `RolesGuard` con `@Roles`
  esplicito su **ogni** rotta (D17). `controller-tenant-selezionato.spec.ts` e
  `nessun-user-userid.spec.ts` devono restare verdi con i controller nuovi. La regola della sessione
  unica non riguarda questo pezzo.
- **Database di test di questo worktree: `wasteflow-pg-test-registro` su `127.0.0.1:55438`.** Mai
  le porte degli altri worktree (55432, 55434, 55436, 55440, 55442, 55444). Macchina Linux: **niente
  `DOCKER_HOST`**. In ogni shell:
  ```bash
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di **ogni** suite Postgres
  `[[ "$DATABASE_URL" == *":55438/"* ]] || { echo "DATABASE_URL non punta a 55438: fermo"; exit 1; }`.
- Prisma solo dal pacchetto installato (`npx prisma --version` → 5.22.x); dopo ogni modifica dello
  schema `npx prisma generate`.
- Test Postgres col ruolo **`wasteflow_app`** (modello `src/application/contracts/contract.service.postgres.spec.ts`:
  `urlComeRuolo`, `creaPrismaServiceApplicativo`, `TenantContext.run`, proprietario per preparare),
  lanciati con `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  Pulizia **solo per id esatti creati**: `const tenantCreati: string[] = []` e in `afterAll`
  `if (tenantCreati.length > 0) await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })`
  (le FK verso `tenants` sono a cascata; se una FK `NoAction` fra le tabelle nuove lo impedisce,
  cancellare prima in ordine allegati → periodi → contratti → clienti → agenti → tabelle di
  fatturazione, sempre con `tenantId: { in: tenantCreati }`). **Mai** un `deleteMany` con un filtro
  che può essere `undefined`. Fixture con `partitaIvaValida(seme)` e `creaDittaConRuolo`; utente creato
  dal proprietario. Un modulo di fixture del pezzo, `src/test-support/fatturazione-di-test.ts`
  (Task 10), crea condizione, conto, spese, registro, testo e codifiche minime per un tenant.
- **RAM (16 GB): un solo processo pesante alla volta.** jest mirato `npx jest -w 2 <percorsi>`; a fine
  task backend **una volta** `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run
  test:cov` (già `--runInBand`); lint solo dei file toccati senza `--fix` (`npx eslint <file…>`), mai
  `npm run lint`. Karma **una volta** a fine task frontend. Mai Karma e jest insieme.
- Fine task backend: `test:cov`, `npx tsc --noEmit -p tsconfig.json`, eslint globale backend
  `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da `apps/backend` con **0 errori**, le suite
  Postgres toccate più `rls-catalogo.postgres.spec.ts` (**50** dal Task 8, **55** dal Task 9).
  Confronto con la linea di base del Task 0: nessun fallimento nuovo.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55438; dalla root
  `DB_APP_PASSWORD=… DB_SISTEMA_PASSWORD=… PG_EXEC="docker exec -i wasteflow-pg-test-registro" bash ops/db-ruoli.sh`;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/shadow_clienti?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-registro psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_clienti"` / `"DROP DATABASE shadow_clienti"`) → **vuoto**
  (o solo le note preesistenti di master: pgcrypto, default di `notifications.expires_at`).
  Migration **additive** e sicure in deploy: `SET LOCAL lock_timeout = '5s';` in testa (le FK
  toccano `ditte`, `sedi_ditte`, `tenants`, tabelle usate dal traffico), solo `CREATE TYPE`,
  `CREATE TABLE`, `CREATE INDEX` su tabelle nuove e vuote, nessun `ALTER` su tabelle esistenti,
  nessun indice parziale (Prisma non lo rappresenta e il `migrate diff` non tornerebbe vuoto);
  nomi di vincoli e indici ≤ 63 caratteri, uguali in schema e SQL; ripristino a mano nel commento
  iniziale e in `ops/README.md`. Cartelle **`20261102200000_anagrafiche_fatturazione_cliente`** e
  **`20261102200100_clienti_agenti_contratti_cliente`** (D30).
- Task frontend: `cd apps/frontend && CHROME_BIN=/home/graziano/.cache/chrome-test/chrome-headless-shell/linux-156.0.8078.80/chrome-headless-shell-linux64/chrome-headless-shell npx ng test --watch=false --browsers=ChromeHeadless`
  (una volta), `npm run build`, dalla root `npx eslint <file toccati> --max-warnings=-1`.
- Aree che questo pezzo **non** tocca: `application/contracts/**`, `domain/contracts/**`,
  `fe/features/contracts/**` (il contratto produttore: si **legge** come modello, non si modifica),
  `application/fir/**`, `api/fir/**`, `application/registro/**`, `api/registro/**`,
  `application/rentri/**`, `application/pese/**`, `domain/pese/**` e `api/pese/**` (si **importano**
  `riconosciTipoFile` e `DIMENSIONE_MASSIMA_ALLEGATO`, senza modificarli), `core/filters/**`,
  `prisma/sql/ruoli-db.sql`. Toccati in modo **mirato** (D18): `domain/registry/entities/sede-ditta.ts`,
  `domain/registry/value-objects/identificativo-fiscale.ts`, `domain/registry/repositories/ditta.repository.ts`
  (solo il commento di `RuoloDitta`), `infrastructure/persistence/ditta-prisma.repository.ts`
  (`ruoliDellaDitta`), `application/registry/ditte/ditte.service.ts` (regola del privato, `DittaDto.ruoli`),
  `application/registry/crea-ruolo-su-ditta.ts` (`NomeRuolo`), `core/domain/errors.ts`
  (`SedeNonValidaPerRuoloError`), `fe/features/registry/{anagrafica-form-dialog,ditta-identificativi}.component.ts`
  e `identificativo-fiscale.ts` (tipi `cliente` e `agente`), `fe/shared/models/registry.model.ts`, menu e
  rotte. Se un task scopre di doverne toccare un'altra, si ferma e lo segnala.
- **Convivenza con altri branch.** File a rischio di conflitto: `schema.prisma` (enum e modelli
  nuovi **in coda**, dopo `AbbinamentoCaricoScarico`; su `Tenant`, `Ditta`, `SedeDitta` solo relazioni
  inverse in fondo ai campi di relazione), `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`,
  `README-tenant-transazione.md`, `ops/README.md`, `layout.component.ts`, `app.routes.ts`,
  `app.module.ts`. Al rebase: somma dei conteggi RLS, `prisma generate`, `migrate deploy`, `migrate
  diff` vuoto; se master ha una migration con timestamp successivo a `20261102200000`, rinominare le
  nostre due con timestamp successivi, nello stesso ordine (mai applicate in produzione), e aggiornare
  `ops/README.md`.

## Review focus

Le situazioni più probabili in uso reale, ognuna con il suo test:

1. **Due operatori sullo stesso contratto** (o modifica mentre un collega lo sospende): il secondo
   salvataggio riceve 409, niente si sovrascrive, periodi compresi → Task 17 Postgres `due modifiche
   con la stessa versione: una riesce, l'altra 409 e i periodi sono quelli della prima`.
2. **Un riferimento di un'altra azienda nell'id** (cliente, conto, registro, codifica; manomissione o
   bug del frontend): 400 dal servizio e, se passasse, la FK composita lo respinge → Task 8 e 9 `FK
   composita: … di un altro tenant respinto`, Task 16 `riferimenti di B nel contesto di A: 400`.
3. **Riferimento del genere sbagliato** (una spesa di incasso nel campo bollo, un tipo nel campo
   categoria, il registro delle ricevute split): la FK non lo vede, il servizio sì → Task 14 e 16
   (`bollo con una spesa INCASSO: 400`, `registro ricevute split: 400`, `tipo al posto della
   categoria: 400`).
4. **Periodi che non tornano** (trimestrale scritto a mano con una sovrapposizione, 29/02, periodo
   dicembre-gennaio): errore chiaro, niente salvataggio parziale → Task 5 e Task 16 (`periodi non
   validi: 400 e nessuna riga scritta`).
5. **Catena di contratti allegati** (A allegato a B mentre un collega allega B a C): una delle due
   operazioni fallisce → Task 17 Postgres `allegamenti concorrenti: nessuna catena`.
6. **Proroga di fine anno su un contratto con fine 29/02/2024**, su un sospeso escluso dai filtri e
   per categoria → Task 18 `29/02 diventa 28/02/2025`, `sospesi esclusi senza ancheSospesi`,
   `solo la categoria indicata`.
7. **Privato come cliente**: CF senza P.IVA accettato con nome e cognome, rifiutato senza; il CF non
   compare in audit, log e messaggi → Task 7 e Task 15 (`audit senza dati personali` legge
   `activity_logs` e cerca CF, IBAN, PEC nel JSON); **IBAN del gestore** fuori dall'audit → Task 11.
8. **Due operatori creano in linea una categoria nello stesso istante**: due codici diversi, nessun
   errore → Task 12 Postgres `primo codice libero concorrente`.
9. **Un file che non è un PDF rinominato .pdf**, o di 5 MB → 415/413 e nessuna riga → Task 19.
10. **Cliente con contratti eliminato per sbaglio**: 409 con l'invito a disattivarlo, ditta e sedi
    intatte → Task 15 Postgres.

---

## Task 0: ambiente e linea di base

**File:** nessuno (solo verifica).

- [ ] **Step 1: database di test ricreato da zero.**
  ```bash
  docker rm -f wasteflow-pg-test-registro 2>/dev/null || true
  docker run -d --name wasteflow-pg-test-registro -p 127.0.0.1:55438:5432 \
    -e POSTGRES_USER=wasteflow -e POSTGRES_PASSWORD=wasteflow_ci -e POSTGRES_DB=wasteflow_ci \
    -e POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 postgres:16-alpine
  ```
  Variabili dei Vincoli globali; `npm ci` in `apps/backend` e `apps/frontend` solo se `node_modules`
  manca.
- [ ] **Step 2: schema e ruoli.** Da `apps/backend`: `npx prisma migrate deploy` (ultima
  `20261102100000_rentri_esclusione_invio_automatico`), `npx prisma generate`, dalla root
  `bash ops/db-ruoli.sh` con `PG_EXEC="docker exec -i wasteflow-pg-test-registro"`,
  `npx ts-node prisma/seed.ts` (catalogo CER).
- [ ] **Step 3: linea di base.** `test:cov`, `tsc`, `rls-catalogo.postgres.spec.ts` (44),
  `registry-ditte.postgres.spec.ts`, `contract.service.postgres.spec.ts`. Annotare nel rapporto i test
  già rossi: non si aggiustano in questo pezzo.

## Task 1: dominio puro — dati fiscali del cliente e IBAN

**File:**
- Create: `apps/backend/src/domain/clienti/iban.ts`
- Create: `apps/backend/src/domain/clienti/iban.spec.ts`
- Create: `apps/backend/src/domain/clienti/dati-fiscali-cliente.ts`
- Create: `apps/backend/src/domain/clienti/dati-fiscali-cliente.spec.ts`

**Interfaces (Produces):**
```ts
// iban.ts (usato anche dai conti correnti, Task 3)
export function normalizzaIban(v: string): string
export function ibanValido(iban: string): boolean
export const MESSAGGIO_IBAN_NON_VALIDO = "L'IBAN non è valido."
// decimali.ts è del Task 3; qui la percentuale si valida con una regex locale

// dati-fiscali-cliente.ts
export type EsigibilitaIva = 'IMMEDIATA' | 'DIFFERITA' | 'SCISSIONE'
export const ESIGIBILITA_IVA: readonly EsigibilitaIva[]
export interface DatiFiscaliCliente {
  codice: string | null; codiceDestinatario: string | null; pecFatturazione: string | null
  riferimentoAmministrazione: string | null; iban: string | null; contoCorrenteId: string | null
  condizionePagamentoId: string | null; esigibilitaIva: EsigibilitaIva; registroIvaId: string | null
  speseIncassoId: string | null; bolloId: string | null; agenteId: string | null
  ritenutaPercentuale: string | null          // "4.00"
  nome: string | null; cognome: string | null; note: string | null
}
export type CampoCliente = keyof DatiFiscaliCliente | 'sedeId' | 'attivo'
export const ETICHETTE_CAMPI_CLIENTE: Readonly<Record<CampoCliente, string>>
export function normalizzaDatiFiscali(grezzo: Partial<Record<keyof DatiFiscaliCliente, unknown>>): DatiFiscaliCliente
export function validaDatiFiscali(d: DatiFiscaliCliente, contesto: { privato: boolean }): string[]
export function validaRitenuta(p: string | null): string | null   // riusata dal contratto (Task 6)
export function validaCodiceDestinatario(c: string | null): string | null   // riusata dal contratto
export function tipoDestinatario(codice: string | null): 'PA' | 'IMPRESA' | 'NESSUNO'   // 6 / 7 / vuoto o 0000000
```

- [ ] **Step 1: test che falliscono** (`iban.spec.ts`): `IBAN italiano valido (IT60X0542811101000000123456)`;
  `con una cifra cambiata: non valido`; `italiano di 26 caratteri: non valido`; `con spazi e
  minuscole: normalizzato e valido`; `tedesco di 22 valido`; `paese sconosciuto di 14: non valido`.
- [ ] **Step 2: test che falliscono** (`dati-fiscali-cliente.spec.ts`):
  - `normalizzaDatiFiscali`: stringhe col trim, vuoto → null, codice destinatario e IBAN maiuscoli,
    IBAN senza spazi, `esigibilitaIva` assente → `IMMEDIATA`, ritenuta `"4"` → `"4.00"`, `"4,5"` →
    `"4.50"`;
  - `codice destinatario di 7 caratteri valido`; `di 6 caratteri valido (PA)`; `di 5 caratteri: messaggio D3`;
    `con un trattino: messaggio D3`; `XXXXXXX: messaggio "vale solo per i clienti esteri"`;
  - `PEC senza chiocciola: messaggio`; `PEC con codice 0000000: valida`; `PEC con codice ABC1234:
    messaggio "si indica solo con il codice destinatario 0000000 o senza codice"`; `PEC senza codice: valida`;
  - `riferimento amministrazione senza codice destinatario: messaggio`; `di 21 caratteri: messaggio`;
  - `IBAN non valido: "L'IBAN non è valido."`;
  - `ritenuta 0: messaggio D3`; `30: valida`; `30.01: messaggio`; `"abc": messaggio`;
  - `privato senza nome: "Per un cliente persona fisica indica nome e cognome."`; `non privato con
    cognome: messaggio "solo per un cliente persona fisica"`;
  - `codice cliente con spazio: messaggio`; `codice di 21 caratteri: messaggio`;
  - `più errori: tutti i messaggi nell'ordine dei campi`; `nessun messaggio contiene il valore
    ricevuto` (ciclo sui casi non validi con valori riconoscibili);
  - `tipoDestinatario`: `'UFE1AB'` → PA, `'ABC1234'` → IMPRESA, `'0000000'` e `null` → NESSUNO.
- [ ] **Step 3:** `npx jest -w 2 src/domain/clienti`: FAIL (moduli assenti).
- [ ] **Step 4: implementare.** Commento di testa: cosa decide, le regole di D3 con il rimando alle
  evidenze E10-E12, E23 (fonte WinWaste) e alla FatturaPA, perché il valore non compare mai nei
  messaggi, perché i decimali sono stringhe. IBAN: tabella delle lunghezze almeno per IT, SM, VA, DE,
  FR, ES, AT, CH, GB (altre: 15-34), mod-97 con aritmetica a blocchi (niente `BigInt` obbligatorio).
  I riferimenti (`…Id`) qui si normalizzano soltanto: esistenza, stato e tipo li controlla il servizio.
  Nessuna dipendenza da Nest o Prisma.
- [ ] **Step 5:** test PASS; eslint dei quattro file; `tsc`.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): regole pure dei dati fiscali del cliente e dell'IBAN" -- apps/backend/src/domain/clienti/iban.ts apps/backend/src/domain/clienti/iban.spec.ts apps/backend/src/domain/clienti/dati-fiscali-cliente.ts apps/backend/src/domain/clienti/dati-fiscali-cliente.spec.ts`

## Task 2: dominio puro — condizioni di pagamento e scadenze

**File:**
- Create: `apps/backend/src/domain/clienti/condizione-pagamento.ts`
- Create: `apps/backend/src/domain/clienti/condizione-pagamento.spec.ts`

**Interfaces (Produces):**
```ts
export const MODALITA_PAGAMENTO = ['MP01','MP02','MP05','MP08','MP12','MP19','MP23'] as const
export type ModalitaPagamento = (typeof MODALITA_PAGAMENTO)[number]
export const ETICHETTE_MODALITA: Readonly<Record<ModalitaPagamento, string>>  // Contanti, Assegno, Bonifico, Carta di pagamento, RiBa, SEPA Direct Debit, PagoPA
export interface DatiCondizionePagamento {
  codice: string; descrizione: string; modalita: ModalitaPagamento; giorniRate: number[]; fineMese: boolean
}
export function normalizzaCondizione(g: Partial<Record<keyof DatiCondizionePagamento, unknown>>): DatiCondizionePagamento
export function validaCondizione(d: DatiCondizionePagamento): string[]
export function calcolaScadenze(dataDocumento: string, c: Pick<DatiCondizionePagamento,'giorniRate'|'fineMese'>): string[]  // 'YYYY-MM-DD'
export function descriviRate(c: Pick<DatiCondizionePagamento,'giorniRate'|'fineMese'>): string  // "30-60 gg fine mese", "a vista"
export function validaCodiceTabella(codice: string, max: number, soggetto: string): string | null  // riusata dai Task 3-4
```

- [ ] **Step 1: test che falliscono:**
  - `validaCondizione`: valida; codice vuoto, con spazio, di 11 caratteri; descrizione vuota e di 101;
    modalità `MP99` ("Modalità di pagamento non ammessa."); zero rate ("Indica almeno una rata.");
    9 rate ("Al massimo 8 rate."); giorni non crescenti `[60,30]` ("I giorni delle rate devono essere
    crescenti."); giorni 366; `[0,30]` ("Il pagamento a vista ha una sola rata."); `[0]` valido;
  - `calcolaScadenze`: `2026-01-31` con `[30]` → `['2026-02-28']`; `2028-01-31` con `[30]` →
    `['2028-02-29']`; `2026-01-15` con `[30,60,90]` → `['2026-02-15','2026-03-15','2026-04-15']`;
    `2026-01-15` con `[45]` → `['2026-03-01']` (giorni non multipli di 30); `2026-01-15` con `[30]`
    fine mese → `['2026-02-28']`; `[0]` → stessa data; `[0]` fine mese → `2026-01-31`;
    `2026-12-20` con `[30]` fine mese → `['2027-01-31']`;
  - `descriviRate`: `[0]` → "a vista"; `[30,60]` + fine mese → "30-60 gg fine mese";
  - `validaCodiceTabella('A B', 10, 'Il codice')` → "Il codice può contenere solo lettere, cifre,
    punto, trattino e trattino basso (massimo 10 caratteri).".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Commento di testa: D6, la regola "30 giorni = un mese" con la fonte
  (E15), il motivo delle date come stringhe. Aritmetica di calendario senza `Date` locale (o con
  `Date.UTC`), clamp all'ultimo giorno del mese.
- [ ] **Step 4:** PASS, eslint, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(clienti): condizioni di pagamento con rate e calcolo delle scadenze" -- apps/backend/src/domain/clienti/condizione-pagamento.ts apps/backend/src/domain/clienti/condizione-pagamento.spec.ts`

## Task 3: dominio puro — conti correnti, spese accessorie, registri IVA

**File:**
- Create: `apps/backend/src/domain/clienti/decimali.ts` e `decimali.spec.ts`
- Create: `apps/backend/src/domain/clienti/conto-corrente.ts` e `conto-corrente.spec.ts`
- Create: `apps/backend/src/domain/clienti/spesa-accessoria.ts` e `spesa-accessoria.spec.ts`
- Create: `apps/backend/src/domain/clienti/registro-iva.ts` e `registro-iva.spec.ts`

**Interfaces (Produces):**
```ts
// decimali.ts — importi e percentuali come stringhe a 2 decimali, mai number
export function normalizzaDecimale(v: unknown): string | null        // "4" → "4.00", "4,5" → "4.50", "" → null
export function decimaleValido(v: string, interi: number): boolean   // ^\d{1,interi}(\.\d{1,2})?$
export function confrontaDecimali(a: string, b: string): -1 | 0 | 1
// conto-corrente.ts (D21)
export interface DatiContoCorrente { codice: string; descrizione: string; banca: string; iban: string; bic: string | null }
export function normalizzaContoCorrente(g): DatiContoCorrente
export function validaContoCorrente(d: DatiContoCorrente): string[]
export function bicValido(bic: string): boolean
// spesa-accessoria.ts (D23)
export type TipoSpesa = 'INCASSO' | 'BOLLO'
export const ETICHETTE_TIPO_SPESA: Readonly<Record<TipoSpesa, string>>   // Spese di incasso, Bollo
export interface DatiSpesaAccessoria { tipo: TipoSpesa; codice: string; descrizione: string; importo: string }
export function normalizzaSpesa(g): DatiSpesaAccessoria
export function validaSpesa(d: DatiSpesaAccessoria): string[]
// registro-iva.ts (D24)
export interface DatiRegistroIva { codice: string; descrizione: string; ricevuteSplit: boolean }
export function normalizzaRegistro(g): DatiRegistroIva    // "1" → "01"
export function validaRegistro(d: DatiRegistroIva): string[]
export function motivoRegistroNonUsabile(r: { attivo: boolean; ricevuteSplit: boolean } | null): string | null   // messaggi di D24
```

- [ ] **Step 1: test che falliscono:** decimali (`"4"`, `"4,5"`, `"-1"` non valido, `"1.234"` non
  valido, confronto `"30.00"` = `"30"`); conto (valido; descrizione e banca vuote; banca di 81; IBAN
  non valido col messaggio di Task 1; BIC `UNCRITMM` e `UNCRITMMXXX` validi, `UNCRIT` no; codice con
  spazio); spesa (valida; tipo `ALTRO`; importo `"-1"`, `"1.234"`, `"123456789"` non validi, `"0"`
  valido); registro (valido; `"1"` normalizzato a `"01"`; `"00"`, `"100"`, `"A1"` → "Il codice del
  registro IVA è di due cifre, da 01 a 99."; descrizione di 61; `motivoRegistroNonUsabile`: null,
  disattivato, ricevute split → messaggi di D24, attivo normale → null).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Commento di testa di ciascun file: la decisione (D21, D23, D24), la
  fonte WinWaste (E18-E20), cosa resta a 4.4 (aliquota e contropartita delle spese, protocollo dei
  registri, ABI/CAB).
- [ ] **Step 4:** PASS, eslint degli otto file, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(clienti): regole pure di conti correnti, spese accessorie e registri IVA" -- <gli otto file>`

## Task 4: dominio puro — testi di fatturazione e codifiche del contratto

**File:**
- Create: `apps/backend/src/domain/clienti/testo-fatturazione.ts` e `testo-fatturazione.spec.ts`
- Create: `apps/backend/src/domain/clienti/codifica-contratto.ts` e `codifica-contratto.spec.ts`

**Interfaces (Produces):**
```ts
// testo-fatturazione.ts (D25)
export interface DatiTestoFatturazione { codice: string; titolo: string; righe: string[] }
export function normalizzaTesto(g): DatiTestoFatturazione      // righe col trimEnd, vuote in coda tolte
export function validaTesto(d: DatiTestoFatturazione): string[]
// codifica-contratto.ts (D26)
export type GenereCodifica = 'CATEGORIA' | 'TIPO' | 'MOTIVO_ANNULLO'
export const ETICHETTE_GENERE: Readonly<Record<GenereCodifica, string>>   // Categoria, Tipo di contratto, Motivo di annullo
export interface DatiCodifica { genere: GenereCodifica; codice: string | null; descrizione: string }
export function normalizzaCodifica(g): DatiCodifica
export function validaCodifica(d: DatiCodifica): string[]
export function primoCodiceLibero(usati: readonly string[]): string | null   // '001'..'999', null se esauriti
```

- [ ] **Step 1: test che falliscono:** testo (valido con 1 e 16 righe; 17 righe; riga di 61;
  titolo vuoto; righe vuote in coda tolte, vuote in mezzo conservate; codice `ABCD` e `A-1` non
  validi); codifica (valida; descrizione vuota e di 61; genere sconosciuto; codice `ABCD`; codice
  null valido); `primoCodiceLibero`: `[]` → `'001'`, `['001','002','004']` → `'003'`, codici non
  numerici ignorati (`['A','001']` → `'002'`), `'001'..'999'` usati → null.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Commento di testa con D25/D26 e la fonte (E24, E25, E29: F4 di
  WinWaste, "codice maggiore di 999").
- [ ] **Step 4:** PASS, eslint, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(clienti): regole pure di testi di fatturazione e codifiche del contratto" -- <i quattro file>`

## Task 5: dominio puro — periodi di fatturazione

**File:**
- Create: `apps/backend/src/domain/contratti-cliente/periodi-fatturazione.ts`
- Create: `apps/backend/src/domain/contratti-cliente/periodi-fatturazione.spec.ts`

**Interfaces (Produces):**
```ts
export interface PeriodoFatturazione { giornoInizio: number; meseInizio: number; giornoFine: number; meseFine: number }
export type FrequenzaPredefinita = 'MENSILE'|'BIMESTRALE'|'TRIMESTRALE'|'QUADRIMESTRALE'|'SEMESTRALE'|'ANNUALE'
export function periodiDaFrequenza(f: FrequenzaPredefinita): PeriodoFatturazione[]
export function ordinaPeriodi(p: PeriodoFatturazione[]): PeriodoFatturazione[]
export function validaPeriodi(p: PeriodoFatturazione[]): string[]
export type EsitoPeriodo =
  | { esito: 'NESSUN_PERIODO' } | { esito: 'NESSUNA_SCADENZA' }
  | { esito: 'PERIODO'; dal: string; al: string } | { esito: 'ERRORE'; messaggio: string }
export function periodoDaFatturare(p: PeriodoFatturazione[], dal: string, al: string): EsitoPeriodo
export function prossimaFinePeriodo(p: PeriodoFatturazione[], oggi: string): string | null
```

- [ ] **Step 1: test che falliscono:**
  - `periodiDaFrequenza`: `MENSILE` 12 periodi con 28/02 fine febbraio; `TRIMESTRALE` i 4 di D10;
    `ANNUALE` 01/01-31/12; `BIMESTRALE`, `QUADRIMESTRALE`, `SEMESTRALE` con gli estremi giusti;
  - `validaPeriodi`: elenco vuoto valido; 13 periodi; 31/04 non valido; 29/02 valido; inizio 01/12 fine
    31/01 → messaggio "non attraversano l'anno"; sovrapposti → "I periodi 1 e 2 si sovrappongono.";
    adiacenti (fine 31/03, inizio 01/04) validi; disordinati validi e `ordinaPeriodi` li ordina;
  - `periodoDaFatturare` (E7): nessun periodo → `NESSUN_PERIODO`; trimestrale, intervallo
    `2026-03-01`..`2026-03-31` → `PERIODO 2026-01-01..2026-03-31`; intervallo `2026-02-01`..`2026-02-28`
    → `NESSUNA_SCADENZA`; intervallo `2026-12-15`..`2027-01-15` → `ERRORE` attraversa l'anno;
    mensile, intervallo `2026-01-01`..`2026-03-31` → `ERRORE` più periodi; periodo con fine 28/02 e
    intervallo `2028-02-01`..`2028-02-29` → `PERIODO` con fine `2028-02-29`; con anno non bisestile
    fine `2026-02-28`;
  - `prossimaFinePeriodo`: trimestrale, oggi `2026-05-10` → `2026-06-30`; oggi `2026-12-31` →
    `2026-12-31`; oggi dopo l'ultima fine → la prima fine dell'anno dopo; nessun periodo → null.
- [ ] **Step 2:** `npx jest -w 2 src/domain/contratti-cliente`: FAIL.
- [ ] **Step 3: implementare.** Commento di testa: D10, la semantica per 4.4 (E6, E7), il rimando a
  questo piano. Nessuna dipendenza da Nest o Prisma.
- [ ] **Step 4:** PASS, eslint dei due file, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti-cliente): regole pure dei periodi di fatturazione" -- apps/backend/src/domain/contratti-cliente/periodi-fatturazione.ts apps/backend/src/domain/contratti-cliente/periodi-fatturazione.spec.ts`

## Task 6: dominio puro — regole del contratto cliente

**File:**
- Create: `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts`
- Create: `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.spec.ts`

**Interfaces (Produces):**
```ts
export type StatoContrattoCliente = 'BOZZA'|'ATTIVO'|'SOSPESO'|'SOSPESO_MOVIMENTI'|'ANNULLATO'
export const ETICHETTE_STATO: Readonly<Record<StatoContrattoCliente, string>>
export const TRANSIZIONI: Readonly<Record<StatoContrattoCliente, readonly StatoContrattoCliente[]>>
export type UnitaValidita = 'A'|'S'|'M'|'G'
export const ETICHETTE_UNITA_VALIDITA: Readonly<Record<UnitaValidita, string>>   // Anni, Semestri, Mesi, Giorni
export type CodiceRinnovo = 'S'|'N'
export type CampoContrattoCliente =                      // 37 campi
  | 'numero'|'descrizione'|'clienteId'|'clienteFatturazioneId'|'sedeId'|'categoriaId'|'tipoId'
  | 'dataInizio'|'dataFine'|'dataStipula'|'validitaQuantita'|'validitaUnita'|'contrattoPrincipaleId'
  | 'condizionePagamentoId'|'contoCorrenteId'|'speseIncassoId'|'bolloId'|'registroIvaId'
  | 'esigibilitaIva'|'ritenutaPercentuale'|'agenteId'|'testoFatturazioneId'
  | 'codiceDestinatario'|'riferimentoAmministrazione'|'codiceCig'|'codiceCup'|'idDocumentoPa'
  | 'escludiDichiarazioneIntento'|'sogliaDal'|'sogliaImporto'|'sogliaIvaEsclusa'
  | 'rinnovoAutomatico'|'codiceRinnovo'|'incrementoIstat'|'commessa'|'annotazioni'|'periodi'
export interface DatiContrattoCliente { /* un campo per CampoContrattoCliente; date 'YYYY-MM-DD' | null; decimali stringa; periodi ordinati; annotazioni string[] */ }
export type ModificaContrattoCliente = { [K in CampoContrattoCliente]?: DatiContrattoCliente[K] | null }
export const ETICHETTE_CAMPI: Readonly<Record<CampoContrattoCliente, string>>
export const CAMPI_MODIFICABILI: Readonly<Record<StatoContrattoCliente, readonly CampoContrattoCliente[]>>
export const CAMPI_FACOLTATIVI: readonly CampoContrattoCliente[]
export const CAMPI_EREDITATI_DAL_CLIENTE: readonly CampoContrattoCliente[]   // D4
export function normalizzaContratto(g: …): DatiContrattoCliente
export function validaContrattoCliente(d: DatiContrattoCliente): string[]
export function motivoNonModificabile(s: StatoContrattoCliente): string | null
export function motivoNonEliminabile(s: StatoContrattoCliente): string | null
export function verificaTransizione(da: StatoContrattoCliente, a: StatoContrattoCliente,
  d: { condizionePagamentoId: string | null; registroIvaId: string | null; motivo?: string | null; motivoAnnulloId?: string | null }): string | null   // null = ammessa
export function rinnovabile(s: StatoContrattoCliente, dataFine: string | null): boolean
export function dataPiuUnAnno(data: string): string          // 2024-02-29 → 2025-02-28
export function scaduto(dataFine: string | null, oggi: string): boolean
export function destinatarioEffettivo(contratto: { codiceDestinatario: string | null; riferimentoAmministrazione: string | null },
  clienteFatturazione: { codiceDestinatario: string | null; riferimentoAmministrazione: string | null }): { codiceDestinatario: string; riferimentoAmministrazione: string | null }
export function contoCorrenteEffettivo(contratto: { contoCorrenteId: string | null }, cliente: { contoCorrenteId: string | null }): string | null
export function pianificaModifica(s: StatoContrattoCliente, attuale: DatiContrattoCliente, m: ModificaContrattoCliente):
  | { esito: 'NESSUNA_MODIFICA' }
  | { esito: 'CAMPI_NON_AMMESSI'; campi: CampoContrattoCliente[]; messaggio: string }
  | { esito: 'NON_VALIDA'; messaggi: string[] }
  | { esito: 'OK'; dopo: DatiContrattoCliente; cambiati: CampoContrattoCliente[] }
```
Etichette dei campi (testo esatto, nell'ordine del tipo): Numero, Descrizione, Cliente, Cliente di
fatturazione, Sede di servizio, Categoria, Tipo di contratto, Data di inizio, Data di fine, Data di
stipula, Durata della validità, Unità della validità, Contratto principale, Condizione di pagamento,
Conto corrente di accredito, Spese di incasso, Bollo, Registro IVA, Esigibilità IVA, Ritenuta
d'acconto (%), Agente, Testo di fatturazione, Codice destinatario, Riferimento amministrazione, CIG,
CUP, Documento della PA, Escludi la dichiarazione d'intento, Inizio controllo soglia, Soglia massima,
Soglia IVA esclusa, Rinnovo automatico, Codice rinnovo, Incremento ISTAT, Commessa, Annotazioni,
Periodi di fatturazione. Messaggi: D8, D9, D10, D27, D28 (testo esatto).

- [ ] **Step 1: test che falliscono:**
  - `TRANSIZIONI` uguale alla tabella di D8; `verificaTransizione`: BOZZA→ATTIVO senza condizione →
    messaggio; senza registro → "Per attivare il contratto indica il registro IVA."; con entrambi →
    null; ATTIVO→ANNULLATO senza motivo né codice → "Indica il motivo dell'annullo."; con motivo `'  '`
    → stesso messaggio; con il solo `motivoAnnulloId` → null; ANNULLATO→ATTIVO → "Dallo stato
    Annullato non si passa a Attivo."; BOZZA→SOSPESO → non ammessa;
  - `CAMPI_MODIFICABILI`: BOZZA tutti e 37; i tre stati attivi tutti tranne numero, cliente, data di
    inizio; ANNULLATO nessuno; `motivoNonModificabile('ANNULLATO')` → "Un contratto annullato non si
    modifica."; `motivoNonEliminabile` null solo per BOZZA; `CAMPI_EREDITATI_DAL_CLIENTE` uguale a D4;
  - `validaContrattoCliente`: valido; descrizione vuota; fine prima dell'inizio; fine uguale
    all'inizio valida; rinnovo senza fine; CIG di 9 caratteri; CUP di 14; CIG senza documento PA;
    CUP con documento valido; codice destinatario di 5 caratteri (regola di Task 1 riusata); ritenuta
    31; soglia `"0"`; `sogliaDal` senza soglia; validità con la sola quantità; quantità 1000; unità
    `X`; commessa con uno spazio; 4 annotazioni; annotazione di 46; contratto principale uguale a
    `id` (passato nel contesto) → "Un contratto non può essere allegato a sé stesso."; periodi
    sovrapposti (messaggi di `validaPeriodi`); più errori nell'ordine dei campi;
  - `normalizzaContratto`: cliente di fatturazione uguale al cliente → null (E5); date come
    `YYYY-MM-DD` da `Date` e da stringa ISO; periodi ordinati; `codiceRinnovo 'S'` → `rinnovoAutomatico
    true`, `'N'` → `false`; `sogliaIvaEsclusa true` senza soglia → false; annotazioni vuote tolte;
    decimali normalizzati;
  - `pianificaModifica`: vuota → NESSUNA; stessi valori (date come nuova istanza, periodi in altro
    ordine, `"4"` contro `"4.00"`) → NESSUNA; ATTIVO cambia `dataInizio` e `clienteId` →
    CAMPI_NON_AMMESSI "In un contratto attivo o sospeso non si possono cambiare: Cliente, Data di
    inizio."; ATTIVO cambia periodi, condizione e conto → OK con `cambiati
    ['condizionePagamentoId','contoCorrenteId','periodi']`; `null` su `dataFine` svuota; `null` su
    `descrizione` → NON_VALIDA "Descrizione è obbligatoria.";
  - `dataPiuUnAnno('2024-02-29')` → `'2025-02-28'`; `('2026-12-31')` → `'2027-12-31'`;
    `rinnovabile`: ATTIVO con fine → true, senza fine → false, BOZZA e ANNULLATO → false;
  - `scaduto`: fine ieri → true, oggi → false, null → false;
  - `destinatarioEffettivo`: contratto con codice → il suo; senza → quello del cliente di
    fatturazione; nessuno → `0000000` e riferimento del cliente;
  - `contoCorrenteEffettivo`: del contratto se c'è, altrimenti del cliente, altrimenti null.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Commento di testa: cosa decide, le tabelle di D8/D9, la mappa di D5
  in breve (rimando al piano), la semantica di fatturazione per 4.4 (E7, E8), i valori effettivi di
  D4, il rimando a 4.0 (stessa forma di `regole-contratto.ts`, codice indipendente). Riusa
  `validaCodiceDestinatario`, `validaRitenuta` (Task 1), `normalizzaDecimale` (Task 3),
  `validaPeriodi` (Task 5). Nessuna dipendenza da Nest o Prisma.
- [ ] **Step 4:** PASS, eslint dei due file, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(contratti-cliente): regole pure di stati, campi, modifica e valori effettivi" -- apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.spec.ts`

## Task 7: ruoli CLIENTE e AGENTE nelle ditte di F2-10 (modifica mirata)

**File:**
- Modify: `apps/backend/src/domain/registry/entities/sede-ditta.ts` (`RuoloControparte`, `NOME_RUOLO`)
- Modify: `apps/backend/src/domain/registry/value-objects/identificativo-fiscale.ts` (messaggio, Q4)
- Modify: `apps/backend/src/domain/registry/repositories/ditta.repository.ts` (solo il commento di `RuoloDitta`)
- Modify: `apps/backend/src/application/registry/ditte/ditte.service.ts` (regola del privato `:143-145`, `:174-176`; `DittaDto.ruoli.clienteId`, `agenteId`)
- Modify: `apps/backend/src/application/registry/crea-ruolo-su-ditta.ts` (`NomeRuolo`)
- Modify: `apps/backend/src/core/domain/errors.ts` (`SedeNonValidaPerRuoloError`)
- Modify: gli spec esistenti che citano il testo del messaggio del privato (trovarli con
  `grep -rn "può essere solo produttore" apps/backend/src`)
- Create: `apps/backend/src/application/registry/ditte/ruoli-cliente-agente.spec.ts`

Questo task **non** tocca il database: `ruoliDellaDitta` legge clienti e agenti dal Task 9 in poi (i
modelli non esistono ancora). Qui si preparano i tipi e la regola.

**Interfaces:**
- Produces: `RuoloControparte` con `'CLIENTE'` e `'AGENTE'`; `NomeRuolo` con `'cliente'` e `'agente'`;
  `DittaDto.ruoli: { produttoreId?; trasportatoreId?; destinatarioId?; clienteId?; agenteId? }`;
  `ammessoPrivato(ruolo: RuoloControparte): boolean` esportato da `identificativo-fiscale.ts`
  (`PRODUTTORE`, `CLIENTE`).

- [ ] **Step 1: test che falliscono** (`ruoli-cliente-agente.spec.ts`, Prisma finto come gli spec del
  servizio ditte): `risolviPerRuolo con CLIENTE e un privato non lancia`; `con AGENTE e un privato
  lancia il messaggio nuovo`; `con TRASPORTATORE e un privato lancia il messaggio nuovo`;
  `ammessoPrivato: PRODUTTORE e CLIENTE true, gli altri false`; `NOME_RUOLO.CLIENTE è "cliente"`,
  `NOME_RUOLO.AGENTE è "agente"`; `messaggioRuoloPresente('cliente')` → "Esiste già un cliente per
  questa ditta", `('agente')` → "Esiste già un agente per questa ditta";
  `SedeNonValidaPerRuoloError('cliente')` → "La sede indicata non è una sede attiva del cliente
  scelto" (e `'agente'` → "…dell'agente scelto").
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare** (D18). La regola del privato usa `ammessoPrivato`. Aggiornare il
  testo negli spec esistenti.
- [ ] **Step 4:** `npx jest -w 2 src/application/registry src/domain/registry`; suite di fine task
  backend (con `registry-ditte.postgres.spec.ts`).
- [ ] **Step 5: commit**
  `git commit -m "feat(ditte): ruoli cliente e agente, privato ammesso come cliente" -- <file del task>`

## Task 8: schema A — tabelle di fatturazione, migration, RLS (44 → 50)

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (enum `TipoSpesaAccessoria`, `GenereCodificaContratto` e sei modelli in coda; relazioni inverse su `Tenant`)
- Create: `apps/backend/prisma/migrations/20261102200000_anagrafiche_fatturazione_cliente/migration.sql`
- Modify: `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts` (6 voci, commento "Tabelle di fatturazione (Fase 4 pezzo 1): dato dell'azienda")
- Modify: `apps/backend/src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (44 → 50)
- Modify: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md` ("(44)" → 50, elenco)
- Modify: `ops/README.md` (sezione Rollback, paragrafo in coda prima di "Il ripristino dal backup")
- Create: `apps/backend/src/application/clienti/tabelle-fatturazione.schema.postgres.spec.ts`

**Interfaces (Produces):** modelli Prisma
```prisma
enum TipoSpesaAccessoria { INCASSO BOLLO  @@map("tipo_spesa_accessoria") }
enum GenereCodificaContratto { CATEGORIA TIPO MOTIVO_ANNULLO  @@map("genere_codifica_contratto") }
model CondizionePagamento  // @@map("condizioni_pagamento"): D6;  @@unique([id, tenantId]), ([tenantId, codice])
model ContoCorrente        // @@map("conti_correnti"): D21;       @@unique([id, tenantId]), ([tenantId, codice]), ([tenantId, iban])
model SpesaAccessoria      // @@map("spese_accessorie"): D23;     @@unique([id, tenantId]), ([tenantId, tipo, codice])
model RegistroIva          // @@map("registri_iva"): D24;         @@unique([id, tenantId]), ([tenantId, codice])
model TestoFatturazione    // @@map("testi_fatturazione"): D25;   @@unique([id, tenantId]), ([tenantId, codice]); righe String[] @db.VarChar(60)
model CodificaContratto    // @@map("codifiche_contratto"): D26;  @@unique([id, tenantId]), ([tenantId, genere, codice])
```
Ogni modello: `id` uuid, `tenantId`, colonne di D6/D21-D26, `attiva`/`attivo` Boolean default true,
`versione Int @default(1)`, `createdAt`/`updatedAt` come le altre tabelle. Nomi dei vincoli con il
prefisso della tabella (`…_versione_positiva`, `condizioni_pagamento_rate_ammesse`,
`spese_accessorie_importo_non_negativo`, `registri_iva_codice_due_cifre`,
`testi_fatturazione_righe_ammesse`), FK `<tabella>_tenant_id_fkey` `ON DELETE CASCADE` (R17). Il collegamento a
clienti e contratti arriva dal Task 9.

- [ ] **Step 1: test che falliscono** (ruolo app nel contesto, proprietario per preparare):
  `condizione con 9 rate respinta`; `due condizioni con lo stesso codice: P2002`; `due conti con lo
  stesso IBAN: P2002 su conti_correnti_tenant_id_iban_key`; `stessa spesa con tipo diverso ammessa,
  stesso tipo e codice respinta`; `importo negativo respinto`; `registro con codice "1" respinto`;
  `testo con 17 righe respinto`; `codifica: stesso codice in generi diversi ammesso`; `nel contesto
  di B le sei tabelle di A sono vuote e un insert con tenant di A è respinto` (RLS); `cancellare il
  tenant cancella le sei tabelle`.
- [ ] **Step 2:** lanciarlo (guardia 55438): FAIL.
- [ ] **Step 3: schema.** Enum e modelli **in coda** dopo `AbbinamentoCaricoScarico`, commento `///`
  su ciascuno (cosa contiene, quale decisione, dove sono le regole). Relazioni inverse su `Tenant`
  dopo `contracts`, commento `// Fase 4 pezzo 1`.
- [ ] **Step 4: migration**, nell'ordine, con commento di testa sul modello di
  `20261031110000_ditte_sedi_controparti` (cosa fa, perché — 4.1 e decisioni —, che è additiva, chi
  la esegue, **ripristino a mano**: `DROP TABLE codifiche_contratto, testi_fatturazione, registri_iva,
  spese_accessorie, conti_correnti, condizioni_pagamento; DROP TYPE genere_codifica_contratto,
  tipo_spesa_accessoria;` e `DELETE FROM _prisma_migrations WHERE migration_name =
  '20261102200000_anagrafiche_fatturazione_cliente';`, da fare **dopo** il ripristino della migration
  del Task 9; ripristino da P3009 con `migrate resolve --rolled-back`):
  1. `SET LOCAL lock_timeout = '5s';`
  2. tipi enum;
  3. le sei tabelle con PK, unici, CHECK;
  4. FK verso `tenants` con le clausole che Prisma genera (verificate col `migrate diff`);
  5. indici;
  6. RLS ENABLE + FORCE + `isolamento_azienda` + `sola_lettura` per le sei tabelle.
  Nessun `GRANT` (li fa `db-ruoli.sh`), nessun `ALTER` di tabelle esistenti.
- [ ] **Step 5:** `prisma-rls.extension.ts` (6 modelli), catalogo a 50, README con l'elenco.
- [ ] **Step 6: `ops/README.md`**: paragrafo "**Tabelle di fatturazione** (Fase 4 pezzo 1, prima
  migration)": rollback del codice innocuo (il codice vecchio ignora le tabelle); prima di un
  ripristino dello schema `SELECT tenant_id, count(*) FROM condizioni_pagamento GROUP BY 1` (e per le
  altre cinque): se non sono vuote i dati si perdono, esportarli prima; ordine di ripristino (prima
  la migration del Task 9); rimando al commento della migration.
- [ ] **Step 7: verifiche** dei Vincoli globali (generate, validate, deploy + `db-ruoli.sh`,
  `migrate diff` vuoto), spec del Step 1 PASS, `rls-catalogo` a 50, suite di fine task backend.
- [ ] **Step 8: commit**
  `git commit -m "feat(clienti): tabelle di fatturazione con RLS (condizioni, conti, spese, registri, testi, codifiche)" -- <file del task>`

## Task 9: schema B — agenti, clienti, contratti, periodi, allegati; migration, RLS (50 → 55)

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (enum `EsigibilitaIva`, `StatoContrattoCliente` e cinque modelli in coda; relazioni inverse su `Tenant`, `Ditta`, `SedeDitta` e sui sei modelli del Task 8)
- Create: `apps/backend/prisma/migrations/20261102200100_clienti_agenti_contratti_cliente/migration.sql`
- Modify: `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts` (5 voci)
- Modify: `apps/backend/src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (50 → 55)
- Modify: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md` (50 → 55, elenco)
- Modify: `apps/backend/src/infrastructure/persistence/ditta-prisma.repository.ts` (`ruoliDellaDitta` legge `cliente` e `agente`, D18)
- Modify: `ops/README.md` (secondo paragrafo)
- Create: `apps/backend/src/application/clienti/clienti.schema.postgres.spec.ts`

**Interfaces (Produces):** modelli Prisma
```prisma
enum EsigibilitaIva { IMMEDIATA DIFFERITA SCISSIONE  @@map("esigibilita_iva") }
enum StatoContrattoCliente { BOZZA ATTIVO SOSPESO SOSPESO_MOVIMENTI ANNULLATO  @@map("stato_contratto_cliente") }
model Agente                      // @@map("agenti"): D22; @@unique([id, tenantId]), ([tenantId, dittaId]), ([tenantId, codice])
model Cliente                     // @@map("clienti"): D2, D3; @@unique([id, tenantId]), ([tenantId, dittaId]), ([tenantId, codice])
model ContrattoCliente            // @@map("contratti_cliente"): D5, D8, D12-D15, D27, D28; @@unique([id, tenantId]), ([tenantId, numero])
model PeriodoFatturazioneCliente  // @@map("periodi_fatturazione_cliente"): D10; @@unique([contrattoId, ordine])
model AllegatoContrattoCliente    // @@map("allegati_contratto_cliente"): D29; @@unique([id, tenantId]), ([contrattoId, posizione])
```
Colonne, tipi e nomi: D3, D5, D10, D15, D21-D29 (date del contratto `@db.Date`; decimali
`@db.Decimal(5,2)`/`(12,2)`; `annotazioni String[] @db.VarChar(45)`; `contenuto Bytes`). Relazioni con
nome dove una tabella punta due o tre volte alla stessa: `ClienteDelContratto`/`ClienteDiFatturazione`,
`SpeseIncassoCliente`/`BolloCliente`, `SpeseIncassoContratto`/`BolloContratto`,
`CategoriaContratto`/`TipoContratto`/`MotivoAnnulloContratto`, `ContrattoPrincipale`. Nomi dei vincoli:
`agenti_ditta_fkey`, `agenti_sede_fkey`, `clienti_ditta_fkey`, `clienti_sede_fkey`,
`clienti_<riferimento>_fkey` (condizione_pagamento, conto_corrente, registro_iva, agente,
spese_incasso, bollo), `contratti_cliente_<riferimento>_fkey` (cliente, cliente_fatturazione, sede,
condizione_pagamento, conto_corrente, spese_incasso, bollo, registro_iva, agente, testo_fatturazione,
categoria, tipo, motivo_annullo, contratto_principale), `periodi_fatturazione_cliente_contratto_fkey`,
`allegati_contratto_cliente_contratto_fkey`; CHECK con prefisso della tabella (`…_versione_positiva`,
`…_eliminazione_coerente`, `…_ritenuta_ammessa`, `contratti_cliente_annullo_coerente`,
`contratti_cliente_date_coerenti`, `contratti_cliente_non_allegato_a_se`,
`contratti_cliente_soglia_coerente`, `contratti_cliente_validita_coerente`,
`contratti_cliente_codice_rinnovo_ammesso`, `contratti_cliente_annotazioni_ammesse`,
`periodi_fatturazione_cliente_valori`, `allegati_contratto_cliente_valori`). Indici:
`contratti_cliente_tenant_id_stato_idx`, `contratti_cliente_tenant_id_cliente_id_idx`,
`contratti_cliente_tenant_id_cliente_fatturazione_id_idx`, `contratti_cliente_tenant_id_categoria_id_idx`,
`contratti_cliente_contratto_principale_id_idx`, `clienti_tenant_id_idx`, `clienti_sede_id_idx`,
`agenti_tenant_id_idx` (accorciare se > 63: verificare uno per uno).

- [ ] **Step 1: test che falliscono** (`clienti.schema.postgres.spec.ts`, ruolo app nel contesto,
  proprietario per preparare, fixture `fatturazione-di-test.ts` **non** ancora disponibile: righe
  minime create col proprietario nello spec):
  - `un contratto nuovo nasce in BOZZA, versione 1, rinnovo false, annotazioni vuote`;
  - `due clienti per la stessa ditta: P2002 su clienti_tenant_id_ditta_id_key`; idem per gli agenti;
  - `FK composita: cliente di un altro tenant respinto` (proprietario: `cliente_id` di A con
    `tenant_id` di B, cita `contratti_cliente_cliente_fkey`); `… conto corrente di un altro tenant
    respinto` (`contratti_cliente_conto_corrente_fkey`); `… codifica di un altro tenant respinta`;
  - `stato ANNULLATO senza motivo respinto`; `fine prima dell'inizio respinta`; `contratto allegato a
    sé respinto`; `soglia_dal senza soglia respinta`; `validità con la sola quantità respinta`;
    `codice rinnovo X respinto`; `4 annotazioni respinte`; `ritenuta 31 respinta` (cliente e contratto);
  - `periodo con ordine 13 respinto`; `due periodi con lo stesso ordine respinti`;
  - `allegato in posizione 3 respinto`; `due allegati nella stessa posizione: P2002`; `mime
    image/png respinto`;
  - `cancellare un contratto (owner) cancella periodi e allegati`;
  - `eliminare un cliente citato da un contratto: errore FK` (P2003); `eliminare una spesa citata da
    un cliente: errore FK`;
  - `nel contesto di B le cinque tabelle di A sono vuote e un insert con tenant di A è respinto` (RLS);
  - `cancellare il tenant cancella tutto, tabelle del Task 8 comprese`;
  - `ruoliDellaDitta riporta cliente e agente con la loro sede` (repository col ruolo app).
- [ ] **Step 2:** lanciarlo (guardia 55438): FAIL.
- [ ] **Step 3: schema.** Modelli ed enum in coda dopo quelli del Task 8, commento `///` su
  ciascuno (D2/D8/D10/D22/D28/D29). Relazioni inverse: `Tenant` (cinque, dopo quelle del Task 8),
  `Ditta.clienti`, `Ditta.agenti`, `SedeDitta.clienti`, `SedeDitta.agenti`,
  `SedeDitta.contrattiCliente`, e sui modelli del Task 8 (`clienti`, `contratti…` con i nomi delle
  relazioni).
- [ ] **Step 4: migration**, come il Task 8 (stesso ordine dei passi, stesso commento di testa),
  ripristino a mano: `DROP TABLE allegati_contratto_cliente, periodi_fatturazione_cliente,
  contratti_cliente, clienti, agenti; DROP TYPE stato_contratto_cliente, esigibilita_iva;` e `DELETE
  FROM _prisma_migrations WHERE migration_name = '20261102200100_clienti_agenti_contratti_cliente';`.
- [ ] **Step 5:** `prisma-rls.extension.ts` (5 modelli), catalogo a 55, README con l'elenco,
  `ruoliDellaDitta` con `client.cliente.findMany` / `client.agente.findMany` e `...dei('CLIENTE',
  clienti)`, `...dei('AGENTE', agenti)`.
- [ ] **Step 6: `ops/README.md`**: paragrafo "**Clienti, agenti e contratti cliente** (Fase 4 pezzo 1,
  seconda migration)": rollback del codice innocuo (il codice vecchio ignora le tabelle; la sede
  predefinita di un cliente o di un agente torna disattivabile finché il codice nuovo non rientra);
  prima di un ripristino dello schema i conteggi per tenant di `clienti`, `agenti`,
  `contratti_cliente`, `allegati_contratto_cliente`: se non sono vuote i dati si perdono, esportarli
  prima (gli allegati sono file: `COPY … TO` con `encode(contenuto,'base64')`); rimando al commento
  della migration.
- [ ] **Step 7: verifiche** dei Vincoli globali, spec del Step 1 PASS, `rls-catalogo` a 55,
  `registry-ditte.postgres.spec.ts` verde, suite di fine task backend.
- [ ] **Step 8: commit**
  `git commit -m "feat(clienti): tabelle di agenti, clienti, contratti cliente, periodi e allegati con RLS" -- <file del task>`

## Task 10: helper comune, fixture e condizioni di pagamento (servizio e API)

**File:**
- Create: `apps/backend/src/application/clienti/anagrafica-versionata.ts` e `anagrafica-versionata.spec.ts`
- Create: `apps/backend/src/test-support/fatturazione-di-test.ts`
- Create: `apps/backend/src/application/clienti/condizioni-pagamento.service.ts`, `.service.spec.ts`, `.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/condizione-pagamento.dto.ts`
- Create: `apps/backend/src/api/clienti/condizioni-pagamento.controller.ts` e `.controller.spec.ts`
- Create: `apps/backend/src/api/clienti/clienti.module.ts` (i Task 11-19 aggiungono i loro provider e controller)
- Modify: `apps/backend/src/app.module.ts` (import di `ClientiModule`)

**Interfaces (Produces):**
```ts
// anagrafica-versionata.ts (D13, D14)
export interface DescrizioneEntita { prefisso: string; soggetto: string; femminile: boolean }   // 'CONTO_CORRENTE', 'Il conto corrente', false
export async function scriviCondizionato(op: () => Promise<{ count: number }>, e: DescrizioneEntita): Promise<void>   // count 0 → 409 <PREFISSO>_MODIFICAT{O,A}_NEL_FRATTEMPO
export function traduciErrorePrisma(err: unknown, e: DescrizioneEntita, vincoli: Readonly<Record<string, { codice: string; messaggio: string }>>): never
export function confrontaVersione(attuale: number, ricevuta: number, e: DescrizioneEntita): void
// fatturazione-di-test.ts
export async function creaTabelleFatturazione(owner: PrismaClient, tenantId: string): Promise<{ condizioneId; contoId; speseId; bolloId; registroId; registroSplitId; testoId; categoriaId; tipoId; motivoId }>
// condizioni-pagamento.service.ts
export interface CondizioneVista extends DatiCondizionePagamento { id: string; attiva: boolean; versione: number; descrizioneRate: string; eliminabile: boolean }
list(tenantId: string, incluseDisattivate: boolean): Promise<CondizioneVista[]>
getById(tenantId: string, id: string): Promise<CondizioneVista>
crea(tenantId: string, utenteId: string, dati: DatiCondizionePagamento): Promise<CondizioneVista>
modifica(tenantId: string, utenteId: string, id: string, m: Partial<DatiCondizionePagamento> & { attiva?: boolean; versione: number }): Promise<CondizioneVista>
elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
```
`eliminabile` = nessun cliente e nessun contratto la cita (conteggio nella vista). Errori: D13, D14.

- [ ] **Step 1: test unitari che falliscono** (helper): count 0 → 409 col codice e il soggetto;
  P2002 su un vincolo mappato → 409 col codice del vincolo; P2002 non mappato → rilancia; P2003 →
  409 `<PREFISSO>_IN_USO`; versione diversa → 409. (Servizio, Prisma finto con `$transaction`,
  `updateMany`, `activityLog.create`): crea con dati non validi → 400 `CONDIZIONE_PAGAMENTO_NON_VALIDA`
  (array); crea con P2002 → 409 codice duplicato; modifica con versione diversa → 409 senza
  `updateMany`; `updateMany` count 0 → 409; nessuna modifica → nessuna scrittura; disattivazione →
  audit `CONDIZIONE_PAGAMENTO_MODIFICATA` con `campi ['attiva']`; elimina in uso (P2003) → 409 in
  uso; `list` senza disattivate per default.
- [ ] **Step 2: DTO e controller** (test che falliscono): `CreaCondizionePagamentoDto` (`codice`,
  `descrizione`, `modalita` `@IsIn`, `giorniRate` `@IsArray @IsInt({each}) @ArrayMinSize(1)
  @ArrayMaxSize(8)`, `fineMese`), `ModificaCondizionePagamentoDto = PartialType(...)` + `attiva?` +
  `versione` `@IsInt @Min(1)`; controller con le rotte di D17, `@Roles` letture/scritture, test dei
  metadata con `Reflector`, `senza azienda determinabile: 403`, utente da `req.user.id`.
- [ ] **Step 3: test Postgres**: `crea, modifica, disattiva: versione 3 e due righe di audit`; `due
  modifiche concorrenti: una 409`; `in uso da un cliente: elimina 409, la riga resta` (cliente
  inserito col proprietario); `nel contesto di B: 404`. La fixture `creaTabelleFatturazione` ha un
  suo test nello stesso spec (`crea una riga per tabella nel tenant indicato`).
- [ ] **Step 4: implementare**; registrare il modulo.
- [ ] **Step 5:** PASS (unitari, Postgres con guardia), suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): helper di lock ottimistico e anagrafica delle condizioni di pagamento" -- <file del task>`

## Task 11: conti correnti e spese accessorie (servizi e API)

**File:**
- Create: `apps/backend/src/application/clienti/conti-correnti.service.ts`, `.service.spec.ts`, `.service.postgres.spec.ts`
- Create: `apps/backend/src/application/clienti/spese-accessorie.service.ts`, `.service.spec.ts`, `.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/conto-corrente.dto.ts`, `dto/spesa-accessoria.dto.ts`
- Create: `apps/backend/src/api/clienti/conti-correnti.controller.ts` e `.controller.spec.ts`
- Create: `apps/backend/src/api/clienti/spese-accessorie.controller.ts` e `.controller.spec.ts`
- Modify: `apps/backend/src/api/clienti/clienti.module.ts`

**Interfaces (Produces):** stessa forma del Task 10 (`list`/`getById`/`crea`/`modifica`/`elimina`);
`ContoCorrenteVista extends DatiContoCorrente { id; attivo; versione; ibanMascherato: string;
eliminabile }` (`IT60 **** **** 3456`: l'elenco mostra l'IBAN mascherato, il dettaglio intero);
`SpesaVista extends DatiSpesaAccessoria { id; attiva; versione; eliminabile }`, `list(tenantId, {
tipo?, incluseDisattivate })`. DTO: importo `@IsString @Matches(/^\d{1,8}([.,]\d{1,2})?$/)`, mai
`@IsNumber`; IBAN `@IsString @MaxLength(42)` (con spazi), la validità la decide il dominio.

- [ ] **Step 1: test unitari che falliscono** (per ciascun servizio, come il Task 10) più: conto con
  IBAN duplicato (P2002 su `conti_correnti_tenant_id_iban_key`) → 409
  `CONTO_CORRENTE_IBAN_DUPLICATO`; audit di una modifica dell'IBAN con `campi ['iban']` e **senza**
  valori; spesa: cambiare il `tipo` di una spesa usata come bollo → 409 `SPESA_ACCESSORIA_IN_USO`
  "La spesa è usata da clienti o contratti: non se ne cambia il tipo." (controllo nel servizio prima
  della scrittura); importo `"4,5"` salvato `4.50`.
- [ ] **Step 2: DTO e controller** (test che falliscono): rotte di D17, `?tipo` ammesso solo
  `INCASSO|BOLLO`, `@Roles`, 403 senza azienda.
- [ ] **Step 3: test Postgres**: `conto: crea, modifica, disattiva, elimina`; `IBAN duplicato: 409`;
  `audit di un conto: il JSON non contiene IBAN né BIC`; `spesa usata da un cliente: elimina 409`;
  `nel contesto di B: 404`.
- [ ] **Step 4: implementare** con l'helper del Task 10; registrare nel modulo.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): anagrafiche dei conti correnti del gestore e delle spese di incasso e bollo" -- <file del task>`

## Task 12: registri IVA, testi di fatturazione, codifiche del contratto (servizi e API)

**File:**
- Create: `apps/backend/src/application/clienti/registri-iva.service.ts`, `.service.spec.ts`
- Create: `apps/backend/src/application/clienti/testi-fatturazione.service.ts`, `.service.spec.ts`
- Create: `apps/backend/src/application/clienti/codifiche-contratto.service.ts`, `.service.spec.ts`
- Create: `apps/backend/src/application/clienti/tabelle-fatturazione.service.postgres.spec.ts` (le tre)
- Create: `apps/backend/src/api/clienti/dto/registro-iva.dto.ts`, `dto/testo-fatturazione.dto.ts`, `dto/codifica-contratto.dto.ts`
- Create: `apps/backend/src/api/clienti/registri-iva.controller.ts`, `testi-fatturazione.controller.ts`, `codifiche-contratto.controller.ts` e i tre `.controller.spec.ts`
- Modify: `apps/backend/src/api/clienti/clienti.module.ts`

**Interfaces (Produces):** stessa forma del Task 10; in più `CodificheContrattoService.prossimoCodice(
tenantId, genere): Promise<string>` e `crea(tenantId, utenteId, { genere, descrizione, codice? })`
che, senza codice, legge i codici del genere con `FOR UPDATE` nella transazione, calcola
`primoCodiceLibero` e su P2002 riprova **una** volta; `list(tenantId, { genere, incluseDisattivate })`.
`TestoVista` con `righe`. Registri: `list` con `ricevuteSplit`.

- [ ] **Step 1: test unitari che falliscono**: per ciascuno i casi del Task 10; codifica senza codice
  → `'001'` e poi `'002'`; codici esauriti → 400 di D26; P2002 al primo tentativo → secondo tentativo
  con il codice successivo, al secondo → 409 `CODIFICA_CONTRATTO_CODICE_DUPLICATO`; cambiare il
  `genere` di una codifica → non ammesso (il DTO di modifica non ha `genere`); registro: diventare
  `ricevuteSplit` mentre è usato da clienti o contratti → 409 "Il registro IVA è usato da clienti o
  contratti: non può diventare il registro delle ricevute split payment.".
- [ ] **Step 2: DTO e controller** (test che falliscono): `GET codifiche-contratto` senza `genere` →
  400; `prossimo-codice` dichiarata prima di `:id`; testo con 17 righe → errore del DTO
  (`@ArrayMaxSize(16)`, `@MaxLength(60, { each: true })`); `@Roles`; 403 senza azienda.
- [ ] **Step 3: test Postgres**: `primo codice libero concorrente: due POST in parallelo ottengono
  001 e 002` (`Promise.all`); `registro, testo, codifica: crea, modifica, elimina`; `nel contesto di
  B: 404`.
- [ ] **Step 4: implementare**; registrare nel modulo.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): registri IVA, testi di fatturazione e codifiche del contratto con creazione in linea" -- <file del task>`

## Task 13: agenti (servizio e API)

**File:**
- Create: `apps/backend/src/application/clienti/agenti.service.ts`, `.service.spec.ts`, `.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/agente.dto.ts`
- Create: `apps/backend/src/api/clienti/agenti.controller.ts` e `.controller.spec.ts`
- Modify: `apps/backend/src/api/clienti/clienti.module.ts`

**Interfaces (Produces):**
```ts
export interface AgenteVista { id: string; versione: number; attivo: boolean; codice: string | null; note: string | null
  ditta: { id: string; ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null }
  sede: SedeDto; clienti: number; contratti: number; eliminabile: boolean }
crea(tenantId, utenteId, d: DatiRisoluzioneRuolo & { codice?; note?; sedeId? }): Promise<{ agente: AgenteVista; dittaEsistente: boolean; avvisi: string[] }>
list(tenantId, f: { testo?; soloAttivi?; pagina; dimensione }): Promise<{ elementi: AgenteVista[]; totale: number }>
getById / modifica({ codice?, note?, sedeId?, attivo?, versione }) / elimina(versione)
attiviPerId(tx, ids: string[]): Promise<Map<string, { id: string; attivo: boolean }>>   // per i Task 14 e 16
```

- [ ] **Step 1: test unitari che falliscono**: crea chiama `creaRuoloSuDitta` con ruolo `AGENTE` e
  nome `agente`; privato senza P.IVA → 400 col messaggio di D18; ruolo già presente → 400 "Esiste già
  un agente per questa ditta"; P2002 sul codice → 409 `AGENTE_CODICE_DUPLICATO`; disattiva/riattiva →
  audit `AGENTE_DISATTIVATO`/`RIATTIVATO`; elimina con riferimenti (P2003) → 409 `AGENTE_IN_USO`; audit
  `AGENTE_CREATO` con `{ agenteId, dittaId, dittaEsistente }` e nient'altro.
- [ ] **Step 2: DTO e controller** (test che falliscono): campi ditta come `create-registry.dto.ts`;
  `ModificaAgenteDto` senza identificativi (`forbidNonWhitelisted`); rotte di D17; `@Roles`; 403.
- [ ] **Step 3: test Postgres**: `agente su una ditta già produttore: stessa ditta, ruoli con
  produttoreId e agenteId`; `ricerca e paginazione`; `nel contesto di B: lista vuota, getById 404`;
  `la sede predefinita dell'agente non si disattiva` (via `DitteService.aggiornaSede`).
- [ ] **Step 4: implementare**; registrare nel modulo.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): anagrafica degli agenti come ruolo sulla ditta" -- <file del task>`

## Task 14: servizio dei clienti — creazione e letture

**File:**
- Create: `apps/backend/src/application/clienti/riferimenti-fatturazione.ts` e `.spec.ts`
- Create: `apps/backend/src/application/clienti/clienti.service.ts`
- Create: `apps/backend/src/application/clienti/clienti.service.spec.ts`
- Create: `apps/backend/src/application/clienti/clienti.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
// riferimenti-fatturazione.ts: controllo comune ai clienti (qui) e ai contratti (Task 16-17)
export interface RiferimentiDaControllare { condizionePagamentoId?; contoCorrenteId?; speseIncassoId?; bolloId?;
  registroIvaId?; agenteId?; testoFatturazioneId?; categoriaId?; tipoId?; motivoAnnulloId? }   // solo quelli cambiati e non null
export async function controllaRiferimenti(tx, tenantId: string, r: RiferimentiDaControllare): Promise<string[]>   // messaggi di D3, D9, D24 nell'ordine dei campi
// clienti.service.ts
export interface ClienteVista extends DatiFiscaliCliente {
  id: string; versione: number; attivo: boolean
  ditta: { id: string; ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null; privato: boolean }
  sedeFatturazione: SedeDto
  condizionePagamento, contoCorrente, registroIva, speseIncasso, bollo, agente: { id: string; codice: string | null; descrizione: string } | null
  contratti: number; eliminabile: boolean
}
export interface DatiCreazioneCliente extends DatiRisoluzioneRuolo, Partial<DatiFiscaliCliente> { sedeId?: string }
crea(tenantId: string, utenteId: string, d: DatiCreazioneCliente): Promise<{ cliente: ClienteVista; dittaEsistente: boolean; avvisi: string[] }>
list(tenantId: string, f: { testo?: string; soloAttivi?: boolean; pagina: number; dimensione: number }): Promise<{ elementi: ClienteVista[]; totale: number }>
getById(tenantId: string, id: string): Promise<ClienteVista>
attiviPerId(tx, ids: string[]): Promise<Map<string, { id: string; dittaId: string; attivo: boolean; …campi di CAMPI_EREDITATI_DAL_CLIENTE; contoCorrenteId }>>   // per il Task 16
```
`controllaRiferimenti` legge in **una** query per tabella solo gli id indicati (con `tenantId`),
verifica esistenza, `attiva`/`attivo`, tipo della spesa (incasso/bollo), genere della codifica,
`ricevuteSplit` del registro (`motivoRegistroNonUsabile`).

- [ ] **Step 1: test unitari che falliscono** (`riferimenti-fatturazione.spec.ts`): ogni riferimento
  inesistente o disattivato → il suo messaggio; spesa INCASSO nel bollo → messaggio del bollo;
  codifica TIPO come categoria → messaggio della categoria; registro ricevute split → messaggio di
  D24; più errori nell'ordine; nessun riferimento → nessuna query. (`clienti.service.spec.ts`): crea
  chiama `creaRuoloSuDitta` con ruolo `CLIENTE` e nome `cliente`; dati fiscali non validi → 400
  `CLIENTE_NON_VALIDO` **prima** di aprire la transazione; privato senza nome/cognome → 400;
  riferimenti non validi → 400 con i messaggi di `controllaRiferimenti`; `sedeId` indicato: usato come
  sede di fatturazione se è attiva della ditta risolta, altrimenti
  `SedeNonValidaPerRuoloError('cliente')`; P2002 su `codice` → 409 `CLIENTE_CODICE_DUPLICATO`; ruolo
  già presente → 400 "Esiste già un cliente per questa ditta"; audit `CLIENTE_CREATO` con metadata
  `{ clienteId, dittaId, dittaEsistente }` e nient'altro.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** `crea` valida i dati fiscali con `privato` calcolato
  dall'identificativo della richiesta (e ricontrolla dopo la risoluzione se la ditta esistente è un
  privato), poi `creaRuoloSuDitta` con `inserisci` che controlla i riferimenti, crea la riga `clienti`
  e l'audit nello stesso `tx`. `list`: ricerca `testo` (≥ 2 caratteri) case-insensitive su ragione
  sociale della ditta, `codice`, P.IVA (mai sul CF: è un dato personale e non va in query string),
  ordinamento per ragione sociale, `count` nella stessa transazione. `getById` 404 "Cliente non
  trovato". Log con id soltanto.
- [ ] **Step 4: test Postgres** (ruolo app, fixture `creaTabelleFatturazione`): `crea un cliente su
  una ditta nuova con condizione, conto, registro, spese, bollo e agente`; `su una ditta già
  produttore: dittaEsistente true, stessa ditta, DittaDto.ruoli con produttoreId e clienteId`;
  `privato con nome e cognome: creato`; `privato senza nome: 400 e nessuna ditta creata` (atomicità);
  `bollo con una spesa INCASSO: 400`; `registro ricevute split: 400`; `conto di B nel contesto di A:
  400`; `ricerca per P.IVA e per codice`; `paginazione: totale e pagina 2`; `nel contesto di B: lista
  vuota, getById 404`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): creazione del cliente su ditta con i riferimenti di fatturazione e letture" -- <file del task>`

## Task 15: servizio dei clienti — modifica, disattivazione, eliminazione; API dei clienti

**File:**
- Modify: `apps/backend/src/application/clienti/clienti.service.ts`
- Modify: `apps/backend/src/application/clienti/clienti.service.spec.ts`
- Modify: `apps/backend/src/application/clienti/clienti.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/cliente.dto.ts`
- Create: `apps/backend/src/api/clienti/dto/cliente.dto.spec.ts`
- Create: `apps/backend/src/api/clienti/clienti.controller.ts`
- Create: `apps/backend/src/api/clienti/clienti.controller.spec.ts`
- Modify: `apps/backend/src/api/clienti/clienti.module.ts`

**Interfaces (Produces):**
```ts
modifica(tenantId: string, utenteId: string, id: string, m: { [K in keyof DatiFiscaliCliente]?: DatiFiscaliCliente[K] | null } & { sedeId?: string; attivo?: boolean; versione: number }): Promise<ClienteVista>
elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
```
DTO: `CreaClienteDto` (campi ditta come `create-registry.dto.ts` del registry — ragione sociale,
P.IVA/CF con `almeno-un-identificativo.validator.ts`, indirizzo, contatti — più i dati fiscali e
`sedeId?`; `ritenutaPercentuale` stringa), `ModificaClienteDto` (soli dati fiscali, `sedeId`,
`attivo`, `versione`; mai identificativi né indirizzo: `forbidNonWhitelisted` li respinge).

- [ ] **Step 1: test unitari che falliscono** (servizio): versione diversa → 409
  `CLIENTE_MODIFICATO_NEL_FRATTEMPO`; dati non validi → 400; riferimenti cambiati non validi → 400
  (solo quelli cambiati vengono controllati); cambio `sedeId` a una sede non attiva della ditta →
  400; disattivazione → audit `CLIENTE_DISATTIVATO`, riattivazione → `CLIENTE_RIATTIVATO`; modifica di
  IBAN, PEC e conto → audit `CLIENTE_MODIFICATO` con `campi ['iban','contoCorrenteId','pecFatturazione']`
  e **senza** valori; elimina con contratti (P2003) → 409 `CLIENTE_CON_CONTRATTI`; elimina senza →
  `deleteMany` condizionato su `versione`, count 0 → 409; la modifica **non** tocca i contratti (D4).
- [ ] **Step 2: test che falliscono** (DTO e controller): `ModificaClienteDto con partitaIva →
  rifiutato`; `null su iban accettato`; `versione obbligatoria`; `codiceDestinatario di 8 caratteri
  → errore di lunghezza`; `ritenutaPercentuale numerica → rifiutata (deve essere stringa)`; rotte di
  D17 con `@Roles` (metadata), azienda selezionata, utente della richiesta, `DELETE ?versione=`
  numerico, `403 senza azienda`.
- [ ] **Step 3: implementare** (D13, D14, D16).
- [ ] **Step 4: test Postgres**: `modifica concorrente: una 409`; `cliente con un contratto: elimina
  409, ditta e sedi intatte`; `cliente disattivato resta nei contratti esistenti`; `audit senza dati
  personali` (crea un privato con IBAN e PEC, modifica, legge `activity_logs` col proprietario e
  verifica che il JSON di `metadata` e `description` non contenga CF, IBAN, PEC, nome, cognome);
  `la sede predefinita del cliente non si disattiva` (via `DitteService.aggiornaSede`, errore di F2-10).
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): modifica, disattivazione ed eliminazione del cliente e rotte" -- <file del task>`

## Task 16: servizio dei contratti cliente — creazione, letture, numero

**File:**
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts`
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.spec.ts`
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
type Rif = { id: string; codice: string | null; descrizione: string } | null
export interface ContrattoClienteVista extends DatiContrattoCliente {
  id: string; stato: StatoContrattoCliente; versione: number
  motivoAnnullo: string | null; motivoAnnulloCodifica: Rif; annullatoIl: string | null
  cliente: { id: string; ragioneSociale: string; partitaIva: string | null; attivo: boolean }
  clienteFatturazione: { id: string; ragioneSociale: string; partitaIva: string | null } | null
  sede: { id: string; descrizione: string } | null            // "Via X 1, Comune (PR)"
  categoria, tipo, condizionePagamento, contoCorrente, speseIncasso, bollo, registroIva, agente, testoFatturazione: Rif
  contoCorrenteEffettivo: Rif                                   // D4
  contrattoPrincipale: { id: string; numero: string } | null; allegati: number; allegatiPdf: { posizione: 1 | 2; nomeFile: string }[]
  scaduto: boolean; prossimaFinePeriodo: string | null
  modificabili: CampoContrattoCliente[]; transizioni: StatoContrattoCliente[]; eliminabile: boolean; rinnovabile: boolean
}
crea(tenantId: string, utenteId: string, d: Partial<DatiContrattoCliente> & { numero: string; descrizione: string; clienteId: string; dataInizio: string }): Promise<ContrattoClienteVista>
list(tenantId: string, f: { stato?; clienteId?; categoriaId?; tipoId?; testo?; inScadenzaEntroGiorni?; pagina; dimensione }): Promise<{ elementi: ContrattoClienteVista[]; totale: number }>
getById(tenantId: string, id: string): Promise<ContrattoClienteVista>
prossimoNumero(tenantId: string): Promise<string>   // CC-<anno>-<NNN>
```

- [ ] **Step 1: test unitari che falliscono**: `crea copia dal cliente i campi di
  CAMPI_EREDITATI_DAL_CLIENTE se assenti` (D4, un caso per campo); `non copia il conto corrente`
  (D4: effettivo calcolato nella vista); `valori del corpo vincono sui predefiniti`, `null esplicito
  nel corpo vince sul predefinito`; `validazione pura prima del database` (400
  `CONTRATTO_CLIENTE_NON_VALIDO` array); `cliente disattivato → 400`; `cliente di fatturazione
  inesistente → 400`; `sede di un'altra ditta → 400 "La sede scelta non è una sede attiva del
  cliente."`; `riferimenti non validi → 400 con i messaggi di controllaRiferimenti`; `contratto
  principale di un altro cliente → 400 (D28)`; `principale allegato a sua volta → 400`; `nasce in
  BOZZA, periodi scritti nella stessa transazione con ordine 1..n`; `P2002 sul numero → 409`; `audit
  CONTRATTO_CLIENTE_CREATO con { contrattoId, numero }`; `prossimoNumero conta anche gli eliminati e
  usa l'anno corrente`; `vista: scaduto, prossimaFinePeriodo, modificabili, transizioni, eliminabile,
  rinnovabile, contoCorrenteEffettivo dai moduli del Task 6`; `list esclude gli eliminati`;
  `inScadenzaEntroGiorni filtra fine fra oggi e oggi+N`; `filtro per categoria`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Lettura dei clienti con `ClientiService.attiviPerId` e dei
  riferimenti con `controllaRiferimenti` nella stessa transazione; contratto principale con
  `SELECT … FOR UPDATE` (D28); "oggi" dalla data locale `Europe/Rome` in una funzione iniettabile
  (`OROLOGIO`) per i test. Ricerca `testo` su numero, descrizione, commessa e ragione sociale del
  cliente. Lettura della vista con `include` dei riferimenti in una query; `allegati` e `allegatiPdf`
  con `_count` e `select` (mai `contenuto`).
- [ ] **Step 4: test Postgres** (fixture `creaTabelleFatturazione`): `crea con trimestrale: 4
  periodi`; `crea senza condizione: predefinita dal cliente`; `riferimenti di B nel contesto di A:
  400` (nessuna riga scritta); `periodi non validi: 400 e nessuna riga scritta`; `contratto allegato
  al principale dello stesso cliente: vista con contrattoPrincipale e allegati 1`; `paginazione e
  filtri`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): creazione con i predefiniti del cliente, contratto allegato e letture" -- <file del task>`

## Task 17: servizio dei contratti cliente — modifica, stato, eliminazione

**File:**
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.spec.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
modifica(tenantId: string, utenteId: string, id: string, m: ModificaContrattoCliente & { versione: number }): Promise<ContrattoClienteVista>
cambiaStato(tenantId: string, utenteId: string, id: string, a: StatoContrattoCliente, versione: number,
  annullo?: { motivoAnnulloId?: string | null; motivo?: string | null }): Promise<ContrattoClienteVista>
elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
```

- [ ] **Step 1: test unitari che falliscono**: ordine dei controlli di D14 (annullato con versione
  sbagliata → "non modificabile", non "modificato nel frattempo"); campi non ammessi in ATTIVO → 409
  `CONTRATTO_CLIENTE_CAMPI_NON_AMMESSI`; nessuna modifica → nessuna scrittura; periodi cambiati →
  `deleteMany` + `createMany` dei periodi **dopo** l'`updateMany` riuscito, nella stessa transazione;
  `updateMany` count 0 → 409 e periodi non toccati; cambio di cliente di fatturazione verso un
  cliente disattivato → 400; cambio di bollo verso una spesa INCASSO → 400; solo i riferimenti
  cambiati sono controllati; `contrattoPrincipaleId` verso un contratto che ha questo come principale
  → 400 (D28); un contratto con allegati che riceve un principale → 400; `cambiaStato`: transizione
  non ammessa → 409; BOZZA→ATTIVO senza condizione o senza registro → 400; annullo con il solo codice
  → `motivo_annullo` = descrizione della codifica; con codice disattivato → 400; audit
  `CONTRATTO_CLIENTE_STATO` con `{ da, a, motivoAnnulloId? }` e **senza** il testo del motivo;
  `elimina` fuori da BOZZA → 409; bozza con contratti allegati → 409 `CONTRATTO_CLIENTE_CON_ALLEGATI`;
  elimina con `eliminatoIl`/`eliminatoDa` e condizione `stato: 'BOZZA'`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare** (D8, D9, D13, D14, D16, D28).
- [ ] **Step 4: test Postgres**: `due modifiche con la stessa versione: una riesce, l'altra 409 e i
  periodi sono quelli della prima` (`Promise.allSettled`); `modifica letta prima di una sospensione
  riceve 409`; `ATTIVO → SOSPESO_MOVIMENTI → ATTIVO → ANNULLATO: versione 5, motivo salvato`;
  `annullo col solo codice: testo dalla codifica`; `annullato non si modifica (409) e non cambia
  stato`; `allegamenti concorrenti: nessuna catena` (A→B e B→C in parallelo: una 400, nel database
  nessun contratto che è insieme principale e allegato); `eliminato: sparisce da list, getById 404,
  modifica 404, cambiaStato 404; la riga resta (lettura owner)`; `nel contesto di B: 404 su tutto`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): modifica con lock ottimistico, stati con motivo codificato ed eliminazione" -- <file del task>`

## Task 18: rinnovo e proroga delle scadenze; API dei contratti cliente

**File:**
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.spec.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/contratto-cliente.dto.ts`
- Create: `apps/backend/src/api/clienti/dto/contratto-cliente.dto.spec.ts`
- Create: `apps/backend/src/api/clienti/contratti-cliente.controller.ts`
- Create: `apps/backend/src/api/clienti/contratti-cliente.controller.spec.ts`
- Modify: `apps/backend/src/api/clienti/clienti.module.ts`

**Interfaces (Produces):**
```ts
rinnova(tenantId: string, utenteId: string, id: string, versione: number): Promise<ContrattoClienteVista>
prorogaScadenze(tenantId: string, utenteId: string, f: { scadutiEntro: string; soloRinnovoAutomatico: boolean; ancheSospesi: boolean; clienteId?: string; categoriaId?: string }): Promise<{ prorogati: number }>
```
DTO: `CreaContrattoClienteDto` (date `@IsISO8601({ strict: true })` giorno, periodi
`@ValidateNested({ each: true }) @ArrayMaxSize(12)` con `PeriodoDto` `@IsInt @Min @Max`, decimali
`@IsString @Matches`, `annotazioni` `@ArrayMaxSize(3) @MaxLength(45, { each: true })`, `validitaUnita`
`@IsIn(['A','S','M','G'])`, `codiceRinnovo` `@IsIn(['S','N'])`, `stato` **non** ammesso),
`ModificaContrattoClienteDto` (`PartialType` di crea + `versione`), `CambiaStatoContrattoClienteDto`
(`stato` `@IsIn`, `versione`, `motivoAnnulloId?` `@IsUUID`, `motivo?` ≤ 255), `RinnovaDto`
(`versione`), `ProrogaScadenzeDto` (`categoriaId?`).

- [ ] **Step 1: test unitari che falliscono**: `rinnova` non rinnovabile → 409
  `CONTRATTO_CLIENTE_NON_RINNOVABILE`; rinnova sposta la fine con `dataPiuUnAnno`, versione +1, audit
  `CONTRATTO_CLIENTE_RINNOVATO` con prima/dopo della data; `prorogaScadenze` esegue **un**
  `$executeRaw` con `tenant_id`, `eliminato_il IS NULL`, stati filtrati, `data_fine <= scadutiEntro`,
  `rinnovo_automatico` se richiesto, `cliente_id` e `categoria_id` se indicati, e un audit
  `CONTRATTO_CLIENTE_PROROGATI` con `{ prorogati, filtri }`; zero prorogati → nessun audit.
- [ ] **Step 2: test che falliscono** (DTO e controller): `stato nel corpo di crea → rifiutato`;
  `data '2026-02-30' → errore`; `13 periodi → errore`; `ritenuta numerica → errore`; `4 annotazioni →
  errore`; `prossimo-numero e proroga-scadenze dichiarate prima di :id` (ordine dei metodi nella
  classe, come 4.0); `@Roles` di D17 su ogni metodo (metadata); azienda selezionata; `403 senza
  azienda`.
- [ ] **Step 3: implementare.** SQL della proroga:
  `UPDATE contratti_cliente SET data_fine = (data_fine + interval '1 year')::date, versione = versione + 1, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND eliminato_il IS NULL AND data_fine IS NOT NULL AND data_fine <= ${scadutiEntro}::date AND stato IN (…) [AND rinnovo_automatico] [AND cliente_id = …] [AND categoria_id = …]`
  (template di `Prisma.sql`, mai concatenazione), in `prisma.$transaction` col contesto azienda.
  Postgres porta il 29/02 al 28/02 da sé.
- [ ] **Step 4: test Postgres**: `proroga: 29/02/2024 diventa 28/02/2025`; `sospesi esclusi senza
  ancheSospesi, inclusi con`; `solo rinnovo automatico per default`; `solo la categoria indicata`;
  `bozze, annullati ed eliminati mai prorogati`; `contratti di B non toccati` (conteggio e lettura
  owner); `rinnova concorrente con una modifica: una 409`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): rinnovo, proroga delle scadenze e rotte" -- <file del task>`

## Task 19: allegati PDF del contratto (servizio e rotte)

**File:**
- Create: `apps/backend/src/application/contratti-cliente/allegati-contratto-cliente.service.ts`, `.service.spec.ts`, `.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/allegato-contratto-upload.ts` (interceptor multer: un file `allegato`, il campo `posizione`, limiti come `api/pese/allegato-upload.ts`, errori italiani)
- Modify: `apps/backend/src/api/clienti/contratti-cliente.controller.ts` e `.controller.spec.ts` (quattro rotte di D17)

**Interfaces (Produces):**
```ts
export interface AllegatoContrattoVista { id: string; posizione: 1 | 2; nomeFile: string; dimensioneByte: number; caricatoIl: string }
elenco(tenantId, contrattoId): Promise<AllegatoContrattoVista[]>
carica(tenantId, utenteId, contrattoId, posizione: 1 | 2, file: { originalname; size; buffer }): Promise<AllegatoContrattoVista>
contenuto(tenantId, contrattoId, allegatoId): Promise<{ nomeFile: string; contenuto: Buffer }>
rimuovi(tenantId, utenteId, contrattoId, allegatoId): Promise<void>
```

- [ ] **Step 1: test unitari che falliscono**: contratto eliminato o inesistente → 404; file non PDF
  per i magic bytes (anche con nome `.pdf` e mimetype dichiarato PDF) → 415 di D29; oltre 4 MiB → 413;
  posizione 3 → 400 "La posizione dell'allegato è 1 o 2."; P2002 → 409 `ALLEGATO_POSIZIONE_OCCUPATA`;
  `sha256` calcolato; audit `ALLEGATO_CONTRATTO_CLIENTE_CARICATO` con `{ contrattoId, posizione,
  dimensioneByte }` e **senza** nome del file; `rimuovi` → audit `…_RIMOSSO`; nome file ripulito da
  percorsi (`../x.pdf` → `x.pdf`) e limitato a 255.
- [ ] **Step 2: test che falliscono** (controller): multipart con `posizione` non numerica → 400;
  `GET …/contenuto` risponde `application/pdf` con `Content-Disposition: attachment; filename*=`;
  `@Roles` (scrittura per POST/DELETE, lettura per GET); 403 senza azienda.
- [ ] **Step 3: implementare** importando `riconosciTipoFile` e `DIMENSIONE_MASSIMA_ALLEGATO` da
  `domain/pese/allegato-pesa` (senza modificarli); elenco con `select` senza `contenuto`.
- [ ] **Step 4: test Postgres**: `carica, elenca, scarica (stessi byte), rimuove`; `allegato di un
  contratto annullato: ammesso`; `nel contesto di B: 404`; `due caricamenti nella stessa posizione
  in parallelo: uno 409`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): due allegati PDF per contratto" -- <file del task>`

## Task 20: frontend — servizi, modelli, vocabolari, ruoli cliente e agente, aggiunta in linea

**File:**
- Create: `apps/frontend/src/app/features/clienti/clienti.model.ts` (tipi)
- Create: `apps/frontend/src/app/features/clienti/vocabolario-clienti.ts`
- Create: `apps/frontend/src/app/features/clienti/tabelle-fatturazione.service.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/clienti.service.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/aggiunta-in-linea.ts` e `.spec.ts`
- Modify: `apps/frontend/src/app/features/registry/anagrafica-form-dialog.component.ts` (`TipoAnagrafica` con `'cliente'` e `'agente'`)
- Modify: `apps/frontend/src/app/features/registry/ditta-identificativi.component.ts` (`ETICHETTA_RUOLO.cliente`, `.agente`)
- Modify: `apps/frontend/src/app/features/registry/identificativo-fiscale.ts` (privato ammesso per `cliente`, messaggio di D18) e il suo spec
- Modify: `apps/frontend/src/app/shared/models/registry.model.ts` (`ruoli.clienteId`, `ruoli.agenteId`)

**Interfaces (Produces):** tipi `Cliente`, `Agente`, `CondizionePagamento`, `ContoCorrente`,
`SpesaAccessoria`, `RegistroIva`, `TestoFatturazione`, `CodificaContratto`, `ContrattoCliente`,
`AllegatoContratto`, `PeriodoFatturazione`, `StatoContrattoCliente`, `Pagina<T> = { elementi: T[];
totale: number }`. `TabelleFatturazioneService` con `condizioni`, `conti`, `spese`, `registri`,
`testi`, `codifiche` (`list/get/crea/modifica/elimina`, `codifiche.prossimoCodice`);
`ClientiService` con `agenti`, `clienti`, `contratti` (`…/prossimoNumero/cambiaStato/rinnova/proroga`),
`allegati` (`elenco/carica/scarica/rimuovi`). Etichette in `vocabolario-clienti.ts`: modalità di
pagamento, esigibilità (Immediata, Differita, Split payment), stati (D8), frequenze, tipi di spesa,
generi delle codifiche, unità della validità, codici di rinnovo (D27).
```ts
// aggiunta-in-linea.ts: lo schema di contract-create-dialog.component.ts:563-623 scritto una volta
export class AggiuntaInLinea<T extends string> {
  aperto: T | null; modalita: 'create' | 'edit'; elemento: unknown | null
  apri(chiave: T, modalita: 'create' | 'edit', ev?: unknown, elemento?: unknown): void   // ricorda il pulsante d'origine
  chiudi(): void                                                                          // rende il focus dopo la rimozione dal DOM
  bloccaChiusuraEsterna(visibile: boolean): boolean   // true = ignora la chiusura del dialog esterno (Esc nel sub-dialog)
  salvato<E extends { id: string }>(entita: E, applica: (id: string) => void, campoBloccato: boolean): void
}
```

- [ ] **Step 1: test che falliscono.** Servizi (`HttpTestingController`): un test per rotta (metodo,
  URL, corpo, `params` di `DELETE ?versione=`, di `?tipo`, `?genere` e degli elenchi paginati; upload
  come `FormData` con `allegato` e `posizione`; scarico come `blob`). `identificativo-fiscale`:
  `privato con tipo cliente: nessun errore`; `con tipo agente: il messaggio nuovo`.
  `AggiuntaInLinea`: `apri ricorda il pulsante e chiudi gli rende il focus`; `bloccaChiusuraEsterna
  true solo con un sub-dialog aperto`; `salvato applica l'id solo se il campo non è bloccato`.
- [ ] **Step 2: implementare.** Importi e percentuali come stringhe; date come `YYYY-MM-DD`.
- [ ] **Step 3:** Karma completo (una volta), `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): servizi frontend, vocabolari, ruoli cliente e agente, aggiunta in linea" -- <file del task>`

## Task 21: frontend — tabelle di fatturazione (1): condizioni, conti correnti, spese e bollo

**File:**
- Create: `apps/frontend/src/app/features/clienti/tabelle/tabelle-fatturazione.component.ts` e `.spec.ts` (pagina con `p-tabView`)
- Create: `apps/frontend/src/app/features/clienti/tabelle/condizioni-pagamento.component.ts`, `condizione-pagamento-dialog.component.ts` e gli spec
- Create: `apps/frontend/src/app/features/clienti/tabelle/conti-correnti.component.ts`, `conto-corrente-dialog.component.ts` e gli spec
- Create: `apps/frontend/src/app/features/clienti/tabelle/spese-accessorie.component.ts`, `spesa-accessoria-dialog.component.ts` e gli spec
- Create: `apps/frontend/src/app/features/clienti/tabelle/tabella-comune.ts` (toast degli errori 400/409, conferme, permessi: funzioni condivise dalle schede)
- Modify: `apps/frontend/src/app/app.routes.ts` (`clienti/tabelle`)

**Interfaces (Produces):** ogni dialog `@Input() visible`, `@Input() elemento: X | null` (null =
nuovo), `@Input() tipo?` (spese: tipo fissato quando si apre dal campo bollo o incasso), `@Output()
salvato = new EventEmitter<X>()`, `@Output() visibleChange`; ogni scheda elenca, crea, modifica,
disattiva, elimina. Riusati in linea dai Task 24-26.

- [ ] **Step 1: test che falliscono.** Pagina: `sette schede nell'ordine di D20`; `la scheda scelta
  resta nell'URL (?scheda=)`. Condizioni: `elenco con codice, descrizione, modalità e rate
  descritte`; `"Nuova condizione" apre il dialog vuoto`; `salva manda giorniRate come numeri
  ordinati`; `409 CONDIZIONE_PAGAMENTO_IN_USO: toast col messaggio e la riga resta`; `Elimina visibile
  solo se eliminabile`; `Disattiva/Riattiva manda attiva e versione`. Conti: `IBAN mascherato
  nell'elenco, intero nel dialog`; `409 IBAN duplicato: messaggio nel dialog`. Spese: `filtro per
  tipo`; `dialog aperto con tipo fissato: tipo non modificabile`; `importo mandato come stringa`.
  `VIEWER: nessun pulsante di scrittura` in ogni scheda.
- [ ] **Step 2: implementare.** Pagine standalone PrimeNG (tabella + dialog), messaggi da
  `error.error.message` (stringa o array), mai id. Rate inserite come chip numerici.
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): tabelle di fatturazione, condizioni di pagamento, conti correnti, spese e bollo" -- <file del task>`

## Task 22: frontend — tabelle di fatturazione (2): registri IVA, testi, codifiche

**File:**
- Create: `apps/frontend/src/app/features/clienti/tabelle/registri-iva.component.ts`, `registro-iva-dialog.component.ts` e gli spec
- Create: `apps/frontend/src/app/features/clienti/tabelle/testi-fatturazione.component.ts`, `testo-fatturazione-dialog.component.ts` e gli spec
- Create: `apps/frontend/src/app/features/clienti/tabelle/codifiche-contratto.component.ts` (una scheda per genere, `@Input() genere`), `codifica-dialog.component.ts` e gli spec
- Modify: `apps/frontend/src/app/features/clienti/tabelle/tabelle-fatturazione.component.ts` (le quattro schede)

**Interfaces (Produces):** come il Task 21; `CodificaDialogComponent` con `@Input() genere` e modalità
**rapida** (`@Input() rapida = false`: solo la descrizione, il codice lo propone
`prossimoCodice`, come F4 di WinWaste, E25).

- [ ] **Step 1: test che falliscono.** Registri: `codice di una cifra completato a due`; `badge
  "Ricevute split"`; `409 "non può diventare il registro delle ricevute split": toast`. Testi:
  `fino a 16 righe, contatore dei caratteri a 60`; `anteprima delle righe nell'elenco (titolo e prima
  riga)`. Codifiche: `tre schede (Categorie, Tipi di contratto, Motivi di annullo)`; `"Nuova" propone
  il codice da prossimoCodice`; `modalità rapida: un campo, Invio salva`; `codice lasciato vuoto:
  assegnato dal server e mostrato nel toast`. `VIEWER: nessun pulsante di scrittura`.
- [ ] **Step 2: implementare.**
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): registri IVA, testi di fatturazione, categorie, tipi e motivi di annullo" -- <file del task>`

## Task 23: frontend — agenti

**File:**
- Create: `apps/frontend/src/app/features/clienti/agenti-list.component.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/agente-dialog.component.ts` e `.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (`clienti/agenti`)

**Interfaces (Produces):** `AgenteDialogComponent` (`visible`, `agente | null`, `salvato`), riusato in
linea dai Task 24-25.

- [ ] **Step 1: test che falliscono.** Dialog: `nuovo: app-ditta-identificativi con tipo "agente";
  ditta trovata → ragione sociale bloccata, scelta della sede`; `privato (solo CF): errore di D18`;
  `modifica: identificativi in sola lettura, link "Sedi"`; `salva in modifica manda solo i campi
  cambiati più versione`; `409 e 400 come gli altri dialog`. Lista: `colonne ragione sociale, P.IVA,
  codice, clienti, contratti, attivo`; `ricerca con debounce e paginazione lazy`; `Disattiva con
  conferma`; `Elimina solo se eliminabile`; `409 AGENTE_IN_USO: toast e ricarica`; `VIEWER: nessun
  pulsante di scrittura`.
- [ ] **Step 2: implementare.** Stesso schema del dialog cliente (Task 24) per la parte ditta.
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): elenco e dialog degli agenti" -- <file del task>`

## Task 24: frontend — elenco e dialog dei clienti

**File:**
- Create: `apps/frontend/src/app/features/clienti/clienti-list.component.ts`
- Create: `apps/frontend/src/app/features/clienti/clienti-list.component.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/cliente-dialog.component.ts`
- Create: `apps/frontend/src/app/features/clienti/cliente-dialog.component.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (`clienti`)
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (voce "Clienti", D20)

**Interfaces (Produces):** `ClienteDialogComponent` con `@Input() visible`, `@Input() cliente:
Cliente | null` (null = nuovo), `@Output() salvato = new EventEmitter<Cliente>()` (riusato dal dialog
del contratto, Task 25); `ClientiListComponent`.

- [ ] **Step 1: test che falliscono.** Dialog, sezioni Ditta, Fatturazione elettronica, Pagamento
  (condizione, conto corrente del gestore, IBAN del cliente, spese di incasso, bollo), Fiscale
  (esigibilità, registro IVA, ritenuta, agente), Note:
  - `nuovo: usa app-ditta-identificativi con tipo "cliente"; ditta trovata → ragione sociale
    bloccata, scelta della sede`;
  - `privato (solo CF): compaiono nome e cognome, obbligatori`;
  - `codice destinatario: la PEC si abilita solo con 0000000 o vuoto`; `riferimento amministrazione
    disabilitato senza codice`;
  - `IBAN con spazi accettato` (la validazione resta al backend; il frontend mostra i messaggi);
  - `select delle sole voci attive per condizione, conto, spese (solo INCASSO), bollo (solo BOLLO),
    registro (esclusi i registri ricevute split), agente (autocomplete)`;
  - **aggiunta in linea**: `"Nuova condizione" apre il dialog del Task 21 in sovrapposizione e la
    condizione salvata finisce nel campo`; lo stesso per conto, spese (dialog con tipo `INCASSO`),
    bollo (tipo `BOLLO`), registro (Task 22), agente (Task 23); `Esc nel sub-dialog non chiude il
    dialog del cliente`; `chiuso il sub-dialog, il focus torna al pulsante "Nuova …"`; `VIEWER: nessun
    pulsante "Nuovo …"`;
  - `modifica: identificativi e indirizzo in sola lettura, link "Sedi" che apre app-sedi-ditta-dialog`;
  - `salva in modifica manda solo i campi cambiati più versione`; `nessun cambiamento: nessuna
    chiamata e avviso "Nessuna modifica da salvare"`;
  - `400 CLIENTE_NON_VALIDO: messaggi del backend, dialog aperto`; `409 MODIFICATO_NEL_FRATTEMPO:
    toast ed emette salvato per ricaricare`; `risposta con avvisi (ditta esistente): toast informativo`.
  Lista: `colonne ragione sociale, P.IVA o CF, codice, codice destinatario, condizione, agente,
  contratti, stato attivo`; `ricerca con debounce chiama list con testo e pagina 1`; `paginazione
  lazy`; `Disattiva con conferma manda attivo false e versione`; `Elimina solo se eliminabile, con
  conferma "Eliminare il cliente <ragione sociale>? La ditta e le sedi restano."`; `409
  CLIENTE_CON_CONTRATTI: toast e ricarica`; `pulsanti "Agenti" e "Tabelle di fatturazione" portano
  alle rotte di D20`; `apriModifica rilegge il cliente prima di aprire il dialog`.
- [ ] **Step 2: implementare.** Aggiunta in linea con `AggiuntaInLinea` (Task 20); dialog di modifica
  che rilegge (come 4.0); `ConfirmationService` nei `providers`; azioni con `ariaLabel` che cita la
  ragione sociale; scritture nascoste se il ruolo effettivo è VIEWER (`registry-permissions.ts`).
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): elenco e dialog dei clienti con aggiunta in linea delle tabelle" -- <file del task>`

## Task 25: frontend — dialog del contratto (1): dati generali, pagamento e fatturazione, periodi

**File:**
- Create: `apps/frontend/src/app/features/contratti-cliente/contratto-cliente-dialog.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratto-cliente-dialog.component.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/periodi-fatturazione.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/periodi-fatturazione.component.spec.ts`

**Interfaces (Produces):** `PeriodiFatturazioneComponent` (`@Input() periodi`, `@Input() disabled`,
`@Output() periodiChange`; pulsanti "Mensile", "Trimestrale", … che generano i periodi come
`periodiDaFrequenza` del backend, tabella modificabile gg/mm, max 12); dialog del contratto con
`@Input() contratto: ContrattoCliente | null`, `@Output() salvato`, sezioni in `p-accordion`
(questo task: **Dati generali**, **Pagamento e fatturazione**, **Periodi**; il Task 26 aggiunge le
altre).

- [ ] **Step 1: test che falliscono.** Periodi: `Trimestrale genera i 4 periodi di D10`; `aggiungi
  e rimuovi riga, al massimo 12`; `disabled blocca tutto`. Dialog:
  - Dati generali: `nuovo: numero proposto da prossimoNumero, stato Bozza`; `scelta del cliente con
    autocomplete (list con testo, soloAttivi)`; `"Nuovo cliente" apre app-cliente-dialog e il cliente
    salvato finisce nel campo` (D20); `cliente di fatturazione: stesso autocomplete, escluso il
    cliente del contratto`; `sede di servizio: select delle sedi attive della ditta del cliente`;
    `categoria e tipo: select con "Nuova" in modalità rapida (Task 22) e codice proposto`; `data di
    stipula, validità (durata + unità: entrambe o nessuna, indicatore)`;
  - Pagamento e fatturazione: `scelto il cliente, condizione, agente, registro, spese, bollo,
    esigibilità, ritenuta, codice destinatario e riferimento si precompilano dai suoi valori` (D4,
    solo se l'operatore non li ha toccati); `il conto corrente resta vuoto e mostra "dal cliente:
    <descrizione>" come segnaposto` (D4); `testo di fatturazione: le righe compaiono sotto il campo`;
    `"Nuovo …" in linea per condizione, conto, spese, bollo, registro, agente, testo, con i dialog dei
    Task 21-23`; `Esc nel sub-dialog non chiude il contratto`;
  - `contratto attivo: numero, cliente e data di inizio disabilitati` (da `modificabili`); `nessun
    "Nuovo …" accanto a un campo bloccato`;
  - `salva in modifica manda solo i campi cambiati, periodi come elenco intero, più versione`;
  - `409 e 400 come il dialog del cliente`.
- [ ] **Step 2: implementare.** `AggiuntaInLinea` per tutti i campi; scritture nascoste per VIEWER;
  date come `YYYY-MM-DD` verso il backend (niente `toISOString` di una data locale).
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(contratti-cliente): dialog del contratto, dati generali, pagamento e periodi con aggiunta in linea" -- <file del task>`

## Task 26: frontend — dialog del contratto (2): PA, soglia, rinnovo, commessa, allegati

**File:**
- Modify: `apps/frontend/src/app/features/contratti-cliente/contratto-cliente-dialog.component.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/allegati-contratto.component.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratto-principale-select.component.ts` e `.spec.ts`

**Interfaces (Produces):** sezioni **Pubblica amministrazione** (codice destinatario, riferimento,
CIG, CUP, documento PA, escludi dichiarazione d'intento), **Rinnovo e soglia** (rinnovo automatico,
codice rinnovo, incremento ISTAT, inizio controllo soglia, soglia, IVA esclusa), **Altro** (contratto
principale, commessa, tre annotazioni), **Allegati PDF** (solo per un contratto già salvato).
`AllegatiContrattoComponent` (`@Input() contrattoId`, `@Input() allegati`, `@Input() sola lettura`,
due posizioni con Carica/Apri/Rimuovi); `ContrattoPrincipaleSelectComponent` (contratti dello stesso
cliente, non annullati e non allegati, escluso sé stesso).

- [ ] **Step 1: test che falliscono.**
  - `CIG o CUP valorizzati: il documento PA diventa obbligatorio (indicatore), la regola resta al
    backend`;
  - `codice rinnovo S spunta il rinnovo automatico, N lo toglie` (D27, Q8: `O` non esiste);
    `rinnovo senza data di fine: indicatore`;
  - `IVA esclusa disabilitata senza soglia`; `soglia mandata come stringa`;
  - `annotazioni: tre campi da 45`; `commessa: al massimo 12 caratteri`;
  - `contratto principale: elenca solo i contratti ammessi; svuotabile`; `il contratto con allegati
    non mostra il campo (badge "Ha N contratti allegati")`;
  - allegati: `nuovo contratto: sezione con il messaggio "Salva il contratto per allegare i PDF"`;
    `Carica manda FormData con posizione`; `file non PDF scelto: il messaggio 415 del backend`;
    `Apri scarica il blob`; `Rimuovi con conferma`; `VIEWER: solo Apri`.
- [ ] **Step 2: implementare.**
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(contratti-cliente): dati PA, soglia, rinnovo, contratto principale e allegati PDF nel dialog" -- <file del task>`

## Task 27: frontend — elenco dei contratti, stati, rinnovo, proroga

**File:**
- Create: `apps/frontend/src/app/features/contratti-cliente/contratti-cliente-list.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratti-cliente-list.component.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/annullo-dialog.component.ts` e `.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/proroga-dialog.component.ts` e `.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (`contratti-clienti`)
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (voce "Contratti clienti", D20)

- [ ] **Step 1: test che falliscono.** Lista:
  - `colonne numero, cliente, descrizione, categoria, stato (tag), inizio, fine con badge
    "Scaduto", prossima fatturazione`; `filtri stato, cliente, categoria, tipo, testo, "in scadenza
    entro 30 giorni"`;
  - `azioni di stato dalle transizioni della vista: Attiva, Sospendi, Sospendi solo movimenti,
    Riattiva, Annulla`; `400 all'attivazione (condizione o registro mancanti): toast col messaggio`;
  - `Rinnova visibile se rinnovabile, con conferma che mostra la nuova data di fine`;
  - `Elimina solo se eliminabile`; `dopo un 409 la lista si ricarica`; `VIEWER: nessuna azione di
    scrittura`.
  Annullo: `motivo codificato (select dei motivi attivi con "Nuovo motivo" rapido in linea) o testo,
  almeno uno (indicatore)`; `scelto il codice, il testo si precompila con la descrizione`; `manda
  motivoAnnulloId, motivo e versione`. Proroga: `data, "solo con rinnovo automatico" (spuntato),
  "anche sospesi", cliente e categoria facoltativi; al termine toast "Contratti prorogati: N" e
  ricarica`.
- [ ] **Step 2: implementare.**
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(contratti-cliente): elenco dei contratti, stati, annullo con motivo, rinnovo e proroga" -- <file del task>`

## Task 28: e2e, chiusura e verifica finale

**File:**
- Create: `e2e/tests/contratti-cliente/contratto-cliente.spec.ts` (modello: uno spec di
  `e2e/tests/registry/`, fixture di `e2e/fixtures/`, regole di pulizia di `e2e/README.md`)

- [ ] **Step 1: spec e2e** (eseguito **solo in CI**, non in locale per la RAM): dalle tabelle di
  fatturazione crea una condizione di pagamento e un registro IVA; crea un cliente su ditta nuova e,
  **dal dialog del cliente**, un conto corrente e una spesa di bollo in linea; crea un contratto
  trimestrale con una categoria creata in linea (modalità rapida); prova ad attivarlo senza registro
  (messaggio), lo completa e lo attiva; carica un PDF; lo sospende solo nei movimenti; lo rinnova;
  prova a modificare il cliente del contratto attivo (campo disabilitato); annulla con un motivo
  codificato creato in linea; verifica che un utente VIEWER veda l'elenco senza pulsanti di scrittura
  né "Nuovo …". Selettori per ruolo/etichetta (vedi `e2e/SELECTORS-DEBT.md`). In locale solo
  `npx tsc -p e2e/tsconfig.json --noEmit`.
- [ ] **Step 2:** dalla radice, `git diff --stat dafa30b..HEAD`: solo i file elencati nei Task 1-28
  (nessuna area esclusa toccata, D18 per le mirate).
- [ ] **Step 3:** backend completo: `test:cov`, `tsc`, eslint globale backend 0 errori,
  `npm run test:postgres` intera (guardia 55438) confrontata con la linea di base del Task 0.
- [ ] **Step 4:** frontend: Karma completo, `npm run build`, eslint
  `npx eslint "apps/frontend/src/app/features/{clienti,contratti-cliente,registry}/**/*.ts" --max-warnings=-1`.
- [ ] **Step 5:** `migrate diff` vuoto un'ultima volta; `rls-catalogo` a 55.
- [ ] **Step 6: commit**
  `git commit -m "test(e2e): contratto cliente dalle tabelle di fatturazione all'annullo" -- e2e/tests/contratti-cliente/contratto-cliente.spec.ts`
- [ ] **Step 7: rapporto** all'orchestratore: commit, test rossi preesistenti, la mappa dei campi di
  D5 con eventuali scostamenti, le note di rollback delle due migration, la prova manuale consigliata
  dopo il merge (condizione 30-60 fm, conto corrente e bollo creati dal dialog del cliente, cliente
  privato con CF, contratto PA con codice ufficio e CIG, ritenuta 4%, periodi trimestrali e colonna
  "prossima fatturazione", attivazione negata senza registro, contratto allegato, due PDF, sospensione
  solo movimenti, rinnovo di un contratto con fine 29/02, proroga massiva per categoria, due schede
  sullo stesso contratto → 409, cliente con contratti non eliminabile).

## Ordine

Task 0 → 1 → 2 → … → 28, uno alla volta. 1-6 sono puri e indipendenti dal database ma restano in
sequenza (un solo jest acceso; il 3 usa l'IBAN del 1, il 6 usa 1, 3 e 5). 7 prima di 9 perché il
repository del Task 9 usa i tipi `CLIENTE` e `AGENTE`. 8 prima di 9 (le FK della seconda migration
puntano alle tabelle della prima). 10 prima di 11-19 (helper, fixture e modulo). 11-13 prima di 14
(il cliente controlla conti, spese, registri e agenti). 14-15 prima di 16-19 (i contratti hanno
bisogno dei clienti). 20 prima di 21-27 (servizi e `AggiuntaInLinea`); 21-23 prima di 24 e 25 (i
dialog delle tabelle e dell'agente si aprono in linea); 24 prima di 25 (il contratto riusa il dialog
del cliente); 25 prima di 26 e 27.

## Fuori ambito (seguiti)

- **Listino** (`ELENCHIADDEB`, `ADDEBCON`, famiglie di addebito, prezzi, scaglioni) e **provvigioni**
  sulle righe di addebito (`PROVV`/`TPROV`, con l'azione "imposta la provvigione su tutte le righe",
  E22), "Modifica automatica prezzi" e aggiornamento ISTAT (che userà `incrementoIstat`), vincolo
  "solo addebiti di tipo T" per il contratto allegato: **4.2**. Il contratto cliente non ha prezzi né
  CER in questo pezzo.
- **Legame movimento → cliente, contratto, riga e "fatturato"** (`MOVIMENTI.CLIE/CONT/GRUPPADD/FOGLIO/NFATT`),
  proposta del contratto in registrazione e nel FIR: **4.3**. Nessuna colonna su `WasteMovement` o
  `FIR`.
- **Valorizzazione e fattura**: numerazione per registro sezionale e protocollo, XML FatturaPA,
  uso di `periodoDaFatturare`, `calcolaScadenze`, `destinatarioEffettivo`, `contoCorrenteEffettivo`;
  calcolo di bollo, spese, split, ritenuta (con tipo, causale e contropartita "ritenute subite"),
  provvigioni maturate; aliquota IVA, natura e contropartita delle spese accessorie; controllo della
  soglia massima (F8); dichiarazione d'intento del cliente e sua esclusione; IVA per cassa; fatture
  aggiuntive dei contratti allegati; filtri dell'elaborazione per categoria e tipo: **4.4**; emissione
  SDI: **4.5**.
- **Import di clienti, agenti, contratti e listini da WinWaste** (`CLIFOR`, `CONTRATTI`, `[SPESE]`,
  `[BANCHE]`, `[REGISTRI CONTABILI]`, `[TESTI DI FATTURAZIONE]`, categorie, codici d'origine, `C3`
  16 `ALTRO`): Fase 3 (3.3 per le anagrafiche, **3.8** per contratti e listini, dopo 4.1-4.3).
- Contratti **fornitori** (`CONTRATTIFOR`) e **temporanei** come tabella a parte con
  `COPIADEFINITIVA` e numerazione `PREV` (la bozza ne copre l'uso, Q3).
- Regole per installazione `ControlloRegole` 01/09/11 (obblighi di categoria, agente, stipula,
  validità, rinnovo, ISTAT, commessa; contratto annullato anche sospeso), numerazione controllata,
  contratto 500, funzioni NICA (`\D\`, sconti, Zucchetti) e anagrafica delle commesse ECOER (E17, E29,
  E30).
- Giorno valuta e mesi esclusi del pagamento, zona e categoria del cliente, black list (Q2).
- Job automatico di rinnovo e avvisi di scadenza dei contratti cliente nel `deadline-checker` (Q5).
- Statistiche e stampe dei contratti (`STAMPCONTR`, `StatisticheContratti…`), calendario festivi (F7).
- Collegamento del contratto produttore (`Contract`) al contratto cliente: modelli separati (D1).
- Codice rinnovo `O` di WinWaste: **non portato** (Q8). L'import di 3.8 lo convertirà in `S`.
