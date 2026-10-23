# Confutazione Fase 0, giro 1: esito e correzioni applicate

Data: 2026-10-21. Rapporti di ingresso: `giro-1-codice.md` (G1-C-xx) e `giro-1-dominio.md` (G1-D-xx). Piani corretti nel worktree `C:\Progetti\rifiuti-wt-fase0`, branch `fix/fase0-confronto-winwaste`:

- A: `docs/superpowers/plans/2026-10-21-fase0-a-mud.md`
- C: `docs/superpowers/plans/2026-10-21-fase0-c-integrita-registro-fir.md`
- D: `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`

## Principi di risoluzione (decisi dal revisore capo)

| # | Principio | Dove |
|---|---|---|
| P1 | Nessun blocco su dati che l'utente non può correggere: il MUD blocca solo l'anagrafica del dichiarante, l'anno senza nulla da dichiarare e i casi P6; le anomalie dei movimenti diventano avvisi con l'elenco dei movimenti esclusi o segnalati e delle quantità. Scarico senza FIR incluso (DR dal FIR se c'è, altrimenti `counterpartName`). FIR in bozza/attesa produttore/annullato → movimento escluso con avviso. Prevenzione alla registrazione. | A Decisioni 2, 3; A Task 3, 4, 5, 6, 9; C Task 5 |
| P2 | Un solo modulo di unità (C, `unita-misura-registro.ts`), importato da A. Massa = KG (alias, vuota = KG con avviso) e T (×1000); le altre unità escluse dai totali MUD con avviso, e nel controllo di giacenza saltano il controllo con un warning. `AWAITING_PRODUCER` è bozza ovunque. | C Decisione 4, Task 1, 2, 3, 6; A Decisioni 6, 14, Task 2, 4 |
| P3 | Nessuna migration che fallisce sui dati esistenti: colonna `fir_id_ricopia` valorizzata solo dalle ricopie nuove, indice unico su di essa, query sui doppi storici solo informativa. Giacenza: rifiuto solo se il saldo minimo dalla data in poi scende più in basso e sotto zero; un buco storico non blocca da solo. | C Decisioni 3, 8, Task 3, 4 |
| P4 | Niente `TZ` globale. D crea `core/time/anno-italiano.ts` (`annoSolareItaliano`, `giornoItaliano`, `formattaDataItaliana`), C e A importano. D corregge la "data nel futuro" fra 00:00 e 01:00/02:00. Tolti `TZ` e `tzdata`. Decisione 6 di C riscritta. | D Decisioni 9, 10, Task 5, 7; C Decisione 6, Task 8, 9; A Decisione 8, Task 2 |
| P5 | Ordine di merge D → C → A, un merge per piano, scritto nei Global Constraints dei tre piani con i motivi. | A, C, D Global Constraints |
| P6 | MUD: 30 aprile come ripiego; annullamento con storico (ActivityLog + `reportData.annullamenti`); hash dei dati aggregati alla presentazione e avviso se cambiano; blocco esplicito per `INGRESSO_ESTERNO` e per più unità locali attive. | A Decisioni 11, 12, 13, Task 2, 4, 7, 8, 9 |
| P7 | Il numero FIR di C è il riferimento interno; dipendenza dal piano della scorta come decisione. | C Decisione 7, Task 8, 9 |
| P8 | Correzioni di codice: 422 con `details` e test attraverso il filtro; utente da `req.user.id`; `restore.sh` con `backup-offsite.sh`; test resi davvero rossi; guardia `NaN`; smoke sul DB (`/health/db` → 503); D allineato a `ddac487`; comandi di verifica corretti. | A Task 5, 7; C Task 3, 8, Global Constraints, Verifica finale; D Task 1, 2, 3, 4 |
| P9 | Errori dei job a Bugsink (`segnalaErroreJob`, con test); spazio libero prima di dump e restore di prova, con mail. | D Decisioni 4, 14, Task 2, 3 |
| P10 | Ogni altro finding verificato sul codice: accolto o respinto con motivo; le DECISIONI vanno nella sezione decisioni del piano. | tabella sotto |

## Esito per finding

### Rapporto "codice e fattibilità" (G1-C)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G1-C-01 | ACCOLTO | P1. A Decisioni 2-3: i casi su movimenti registrati sono AVVISI con movimenti esclusi/inclusi e quantità; catalogo riscritto senza promesse di correzione (A Task 3); algoritmo e test (A Task 4); prevenzione alla fonte in C Task 5. Scelta "avviso" invece di rettifiche o override marcata da confermare. |
| G1-C-02 | ACCOLTO | A Task 5: `UnprocessableEntityException({ message, error, details: { controlli } })` e test `la 422 arriva al client con i controlli in details` attraverso `HttpExceptionFilter`; vincolo nei Global Constraints di A. |
| G1-C-03 | ACCOLTO | D Task 2: `request.user?.id ?? request.user?.userId` (anche nel log), fixture `user: { id: 'u-1' }`, test sul log. |
| G1-C-04 | ACCOLTO | D Decisione 8, Task 3 (Interfaces, Step 4b, tre test bash su `restore.sh`), Task 7 passo 7.8b (verifica a secco). La prova di restore su DB temporaneo con `restore.sh` è stata **sostituita** dalla verifica a secco: lo script ferma il backend di produzione e migra il DB dell'app, quindi non si può puntare a un DB temporaneo; la prova vera resta `ripristino_di_prova` notturno. |
| G1-C-05 | ACCOLTO | C Task 8 Step 5: `npm run test:oracolo -- aggancio-formulari` dopo `npm ci` in `tools/rentri-fake`, jest su tutti gli spec con doppi, nota che `tsc` non controlla gli spec; Global Constraints e Verifica finale di C. |
| G1-C-06 | ACCOLTO | P4 + P5: unica sede `core/time/anno-italiano.ts` (D Task 5), C Decisione 6 riscritta e Task 8/9 importano, A Task 2 importa e verifica la coerenza di `limitiAnnoMud`; ordine D → C → A in tutti i piani. |
| G1-C-07 | ACCOLTO | P2: C Task 1 è il modulo condiviso (`convertiInKg` incluso), A non ha più una propria `convertiInKg` (A Task 2, Interfaces di A Task 4); Verifica finale di A controlla che esista una sola definizione. |
| G1-C-08 | ACCOLTO | A Decisione 14, `STATI_FIR_EMESSI` (elenco positivo) in A Task 2 con test di copertura dell'enum, query dei FIR dell'anno in A Task 4 (test 20), `AWAITING_PRODUCER` → `FIR_IN_BOZZA` (test 11). |
| G1-C-09 | ACCOLTO | A Task 7: il test ora ha due tenant (`SUBMITTED` e `DRAFT`), verifica `tenant.findMany` chiamato e una sola notifica per `t2`; è rosso sul codice di oggi. |
| G1-C-10 | ACCOLTO | C Task 3 Step 2: nuovo test `due scarichi concorrenti in anni di registrazione diversi: ne passa uno solo` (31/12/2025 e 02/01/2026), che solo il lock di giacenza serializza; Review Focus 1 di C. |
| G1-C-11 | ACCOLTO | C Task 3: confronto fail-closed con `Number.isFinite`, default esplicito del mock nel `beforeEach`, test `it.each([NaN, undefined, null])`. |
| G1-C-12 | ACCOLTO (superato) | P3: la migration non ha più `RAISE` e non può fallire sui dati esistenti, quindi la procedura `migrate resolve` non serve; la query sui doppi resta come informazione (C Task 4 Step 6). Rollback in `ops/README.md` (D Task 3 Step 8). |
| G1-C-13 | ACCOLTO | D Decisione 13, Task 1 (via i bind mount `./backups` da `backend` e `postgres`, verificato che nessuno li usi, test nel guardiano), Decisione aperta 2 marcata come già fatta in `ddac487`. |
| G1-C-14 | ACCOLTO | P9: D Decisione 4, Task 2 (`segnalaErroreJob` nei 10 handler `@Cron`, test sull'helper e sul job delle scadenze MUD). |
| G1-C-15 | ACCOLTO | A Task 4 test 8: `destinatario.findMany` restituisce `dest-1` con comune e provincia. |
| G1-C-16 | ACCOLTO | C Task 3: `_mockTransazione` restituisce `tx`; il test sull'ordine dei lock è scritto per intero; i test del Task 4 usano il `tx` restituito. |
| G1-C-17 | ACCOLTO | C Decisione 2 e Task 4: confronto su `Math.round(quantity * 100)`, test `il confronto usa la quantità arrotondata a 2 decimali`. |
| G1-C-18 | ACCOLTO | C Task 2 restituisce `vincoloAl`; il messaggio di C Task 3 indica la data del saldo limite; query informativa del saldo minimo per CER (C Task 3 Step 7); P3 nella Decisione 8. |
| G1-C-19 | ACCOLTO | D Decisione 12, Task 4: `/health/db` risponde 503 (test), smoke con `curl -fsS …/api/v1/health/db`; `/health` invariato perché è il contratto dell'healthcheck Docker. |
| G1-C-20 | ACCOLTO | Global Constraints di A e C: i test Karma non sono gate, esecuzione locale esplicita nei task e nella Verifica finale; lint frontend del CI indicato come unico controllo automatico; e2e Playwright come follow-up (A). |
| G1-C-21 | RESPINTO (superato) | Con P4 non si imposta `TZ`, quindi gli orari dei `@Cron` non cambiano. D documenta che restano in UTC (Decisione 10, Task 2 Step 7). |
| G1-C-22 | ACCOLTO | D Task 6 Step 4: conteggio sui servizi con un one-liner `node` (niente `jq`, non garantito sulla workstation). |
| G1-C-23 | ACCOLTO | A Task 5: tipo di ritorno di `exportTelematico` invariato; gli avvisi arrivano dal riepilogo (Task 6) e nella 422. |

### Rapporto "dominio, rischio ed esercizio" (G1-D)

| ID | Esito | Dove è applicato / motivo |
|---|---|---|
| G1-D-01 | ACCOLTO | Come G1-C-01 (P1): A Decisione 2, Task 3-6, 9; C Task 5. Strada (b), avvisi con elenco degli esclusi, marcata da confermare. |
| G1-D-02 | ACCOLTO + DECISIONE | P1: scarico senza FIR incluso, DR da `counterpartName` con avviso (A Decisione 3, Task 4 test 13-14). La migration additiva `destinatarioId` proposta dal finding resta l'alternativa in A Decisione 3 e nei follow-up: il piano A mantiene "niente migration". |
| G1-D-03 | ACCOLTO + DECISIONE | P2: lo scarico non di massa salta il controllo con un warning (C Decisione 4, Task 3), query informativa delle unità distinte (C Task 1 Step 6); il selettore dell'unità sui carichi è un follow-up di C. |
| G1-D-04 | ACCOLTO | P3: migration additiva su `fir_id_ricopia` (C Decisione 3, Task 4), nessun doppio storico da correggere, test che i doppi storici restano ammessi. |
| G1-D-05 | ACCOLTO + DECISIONE | P3: regola "più in basso di prima e sotto zero" (C Decisione 8), test `un buco storico non blocca uno scarico datato dopo carichi che lo coprono`, query del saldo minimo per CER; la data di taglio resta un'alternativa per Graziano. |
| G1-D-06 | ACCOLTO | P6: `PROFILO_NON_SUPPORTATO` bloccante (A Decisione 13, Task 3, Task 4 test 6). |
| G1-D-07 | ACCOLTO | P6: `PIU_UNITA_LOCALI` bloccante su `rentriUnitaLocale.count({ attiva: true }) > 1` (A Decisione 13, Task 4 test 7). |
| G1-D-08 | DECISIONE | A Decisione 16: giacenze a zero con avviso, testo che non promette correzioni sul portale (test in A Task 3); calcolo dallo storico rinviato perché il tracciato vuole la ripartizione recupero/smaltimento, che il registro non conosce. |
| G1-D-09 | ACCOLTO | A Task 3 e 4: `FIR_NON_REGISTRATO` come AVVISO (P1) con l'elenco dei FIR emessi dell'anno senza scarico collegato (test 21). |
| G1-D-10 | ACCOLTO (parte 1) | C Task 5: collegamento rifiutato per FIR `DRAFT`, `AWAITING_PRODUCER`, `CANCELLED`. La parte 2 (avviso all'annullamento di un FIR ricopiato) è un follow-up di C: senza rettifiche non c'è un'azione da proporre. |
| G1-D-11 | ACCOLTO | P6: ripiego al 30 aprile con `warn` (A Decisione 12, Task 7). La mail al SUPER_ADMIN non serve più: con il ripiego i promemoria partono comunque. |
| G1-D-12 | ACCOLTO | P6: annullamento con storico e `ActivityLog`, hash alla segnatura e `datiModificatiDopoPresentazione` nello stato e nell'interfaccia (A Task 8, 9). L'avviso dentro `RegistraMovimentoUseCase` per anni già presentati è coperto dall'hash, non aggiunto. |
| G1-D-13 | DECISIONE | P7: C Decisione 7 (numero legale = vidimato, `FIR-AAAA-NNNNNN` = riferimento interno, `emettiConNumerazione` come transaction in cui si innesterà la scorta), JSDoc e commit di C Task 8/9, riferimento al piano della scorta nella Spec di C. |
| G1-D-14 | ACCOLTO | P4: nessun `TZ` (D Decisione 10), correzione della "data nel futuro" con test in ora solare e legale (D Task 5), elenco dei punti `setDate`/`new Date(y,m,d)` come follow-up (D Decisione aperta 8), orari dei job documentati in UTC. |
| G1-D-15 | ACCOLTO | Come G1-C-14 (P9). |
| G1-D-16 | ACCOLTO | P5: ordine D → C → A nei Global Constraints dei tre piani, con i motivi. |
| G1-D-17 | ACCOLTO | P9: D Decisione 14, Task 3 (`verifica_spazio_libero`, `dimensione_db`, 2× per il dump, 3× per il restore, `.non-verificato`, mail, test). La retention per dimensione non è stata aggiunta: la retention per età più il controllo dello spazio coprono il rischio. |
| G1-D-18 | DECISIONE | A Decisioni 11 e 17: messaggi bloccanti che dicono dove si corregge e a chi chiedere (test in A Task 3); il ruolo del consulente nella segnatura resta aperto (follow-up). |
| G1-D-19 | DECISIONE | A Decisione 15: blocco `REGISTRO_VUOTO_CON_FIR` mantenuto (l'utente può registrare i movimenti), comunicazione ai clienti prima del rilascio, anteprima dai FIR come alternativa. |
| G1-D-20 | ACCOLTO | Come G1-C-07 (P2). |
| G1-D-21 | ACCOLTO | A Task 3: `etichettaFir` preferisce `rentriNumeroFir`, poi `firNumber`, poi l'id; C Task 5 usa la stessa precedenza. |
| G1-D-22 | ACCOLTO | Numeri e date in formato italiano nei messaggi: C Task 3 (`0,4 t`, `05/03/2026`), A Task 3 (`1.234,5 KG`); Global Constraints di A e C. |
| G1-D-23 | ACCOLTO | C Task 4: `messaggioMovimentoRegistrato` nel frontend con il testo "già registrato nel movimento", test Karma locale. |
| G1-D-24 | ACCOLTO | Risolto da P3: l'indice è su `fir_id_ricopia`, che una rettifica della Fase 2 può lasciare a `NULL`; annotato nei follow-up di C. |
| G1-D-25 | ACCOLTO | C Task 6: nota nella PR sul ricalcolo (t ×1000) e sugli alert che possono comparire insieme; alert volumetrici in m³ come follow-up di C. |
| G1-D-26 | ACCOLTO (risolto da P1) | Un destinatario senza CF ora è un AVVISO, quindi un destinatario estero non blocca più; il campo "paese" nel DR è un follow-up di A. |
| G1-D-27 | ACCOLTO | A Task 3 e 4: avviso `ESITO_FIR_RESPINTO` su `rentriStatoFormulario = RespintoAccettatoParzialmente` (test 16); peso a destino resta follow-up. |
| G1-D-28 | ACCOLTO | D Task 7: `timedatectl` nel 7.1, orario del cron scritto in UTC e in ora italiana nel 7.8; corretto il confronto con Gitea, che sta su un'altra macchina. |
| G1-D-29 | ACCOLTO | D Task 7 passo 7.5: messaggi `Invalid signature` per circa 5 minuti come effetto atteso. |
| G1-D-30 | ACCOLTO | D Task 2: `extra.path` senza query string, con test. |
| G1-D-31 | ACCOLTO | D Task 3 Step 8: sezione Rollback in `ops/README.md`; C Global Constraints: la sua migration è compatibile con il tag precedente. A non ha migration. |

## Conteggi

- G1-C: 22 accolti (G1-C-12 superato da P3, contato fra gli accolti), 1 respinto (G1-C-21, superato da P4), 0 decisioni. Totale 23.
- G1-D: 27 accolti (G1-D-02, 03, 05 con una decisione residua; G1-D-10 accolto in parte, il resto è follow-up), 4 decisioni (G1-D-08, 13, 18, 19), 0 respinti. Totale 31.
- Complessivo: 49 accolti, 1 respinto, 4 decisioni su 54 finding.

## Note per il giro 2

- **Regola di giacenza P3.** Applicata alla lettera, "più in basso di prima e sotto zero" coincide con "il nuovo saldo minimo dalla data in poi è negativo": uno scarico datato **prima** di un buco storico viene rifiutato, perché lo approfondisce. Il piano lo dice (C Decisione 8) e indica la data limite nel messaggio; la data di taglio resta l'alternativa se Graziano vuole che lo storico non pesi affatto.
- **DR senza CF.** Il file si genera con il CF vuoto per i destinatari presi dal registro; se il portale lo rifiuta, la vera correzione è la migration `destinatarioId` (alternativa in A Decisione 3).
- **Interazione fra C Task 4 e C Task 5.** Il Task 4 viene prima del controllo di stato del Task 5, quindi i suoi test con `firId` funzionano con lo stub di oggi (`{ id }`); il Task 5 cambia lo stub di default in un FIR emesso, e da lì i test del Task 4 restano verdi. Da ricontrollare se qualcuno inverte l'ordine dei due task.
