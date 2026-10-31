# Fase 4 pezzo 1: cliente e contratto lato cliente — piano di implementazione

> **Per chi esegue:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` (consigliato)
> oppure `superpowers:executing-plans`. Un agente sonnet per task, revisione opus fra un task e il
> successivo. Ordine **strettamente sequenziale** (un worktree, un database di test, file condivisi:
> `schema.prisma`, conteggio RLS, `ditte.service.ts`): Task 0 → 1 → … → 15. Passi con checkbox
> (`- [ ]`). Il piano è eseguibile con le raccomandazioni delle domande Q1-Q6: una risposta diversa
> cambia solo i task indicati nella domanda.

**Obiettivo.** Dare al gestore (impianto, trasportatore, intermediario) l'anagrafica **Cliente** e il
**contratto attivo verso il cliente** (`ContrattoCliente`), separato dal contratto passivo del
produttore (`Contract`), con la parità di WinWaste.NET (`WWNET03.Contratti`, `WWNET32.CLIFOR`) sui
dati che servono a fatturare: cliente di fatturazione diverso, condizione di pagamento, esigibilità
IVA (compreso lo split payment), bollo, dati per la PA (codice ufficio, riferimento amministrazione,
CIG, CUP), sospensione totale e dei soli movimenti, annullo con motivo, rinnovo e proroga delle
scadenze, periodi di fatturazione **con effetto** (funzione pura che 4.4 userà). Niente listino,
niente legame coi movimenti, niente valorizzazione.

**Architettura.** Il cliente è un **ruolo su una ditta di F2-10** (tabella `clienti` come
`produttori`/`trasportatori`/`destinatari`: `ditta_id` + `sede_id` predefinita, una riga per ditta) con
i dati fiscali propri del rapporto commerciale. Quattro tabelle nuove per azienda con RLS:
`condizioni_pagamento`, `clienti`, `contratti_cliente`, `periodi_fatturazione_cliente`. Regole pure in
`src/domain/clienti/` e `src/domain/contratti-cliente/` (validazioni fiscali, scadenze delle rate,
stati e transizioni, campi modificabili, periodi); servizi in `src/application/clienti/` e
`src/application/contratti-cliente/`; controller in `src/api/clienti/`. Lock ottimistico con
`versione` e scrittura condizionata come 4.0. Frontend: tre pagine nuove (`/clienti`,
`/clienti/condizioni-pagamento`, `/contratti-clienti`) che riusano i componenti ditta/sedi di F2-10.

**Tech stack.** NestJS 10 + Prisma 5.22 + PostgreSQL 16 (RLS FORCE); Angular + PrimeNG; jest,
Karma, Playwright (solo in CI).

**Spec.** `/home/graziano/Progetti/winwaste/docs/roadmap-fasi3-4-import-gestori.md` §5 (4.1; 4.2-4.4
solo per sapere cosa **non** fare), §4 (3.8), §6, §7 (D5). Come lo fa WinWaste:
`/home/graziano/Progetti/winwaste/docs/contratti.md` §2-§9, `fatturazione.md` §2, §3.2, §4.7, §5,
`contabilita.md` §1 (condizioni di pagamento), `confronto-rifiuti/02-contratti-fatturazione-contabilita.md`
§1.1, §2.1, §5.1, §5.3. Formato e convenzioni: `docs/superpowers/plans/2026-10-31-fase4-0-contratto-modifica-cancellazione.md`
(regole per stato, versione, cancellazione logica, errori) e `2026-10-31-fase4-8a-pese.md` (tabelle
nuove con RLS); F2-10: `2026-10-28-fase2-10-controparti.md`.

---

## Domande per Graziano (Q1-Q6, la più importante per prima)

Ogni domanda ha la raccomandazione (in grassetto) e cosa cambia se la risposta è diversa. Il piano
è scritto con le raccomandazioni.

**Q1. Perimetro dei dati fiscali del contratto.** La roadmap chiede "il minimo che serve a fatturare,
senza provvigioni né ritenute", ma elenca anche la ritenuta fra i dati del contratto: c'è un
conflitto, e WinWaste ha molti più campi (`contratti.md` §3).
- **A (consigliata).** Minimo per fatturare il caso comune e la PA: cliente di fatturazione,
  condizione di pagamento, esigibilità IVA (immediata, differita, split payment), bollo sì/no, codice
  ufficio PA e riferimento amministrazione, CIG, CUP, riferimento del documento PA. **Esclusi**:
  agente e provvigioni, ritenuta d'acconto, spese bancarie, registro IVA (sezionale), testo di
  fatturazione, allegati PDF, soglia massima, incremento ISTAT, categoria e tipo, commessa,
  dichiarazione d'intento, IVA per cassa. Motivo: un gestore di rifiuti è una società e quasi mai
  subisce la ritenuta; agente e provvigioni non servono a emettere la fattura; il resto si aggiunge
  con colonne nuove senza toccare questo modello.
- B. A + ritenuta d'acconto e agente (parità più larga; +1 task: anagrafica agenti e codici ritenuta).
- C. A + registro IVA (sezionale) e spese bancarie (servono solo se 4.4 numera per sezionale).
- Impatto se B o C: colonne in più nel Task 5, regole nel Task 3, campi nei Task 13-14.

**Q2. Condizione di pagamento.** In WinWaste è un'anagrafica (`[CONDIZIONI DI PAGAMENTO]`: fino a 8
rate, modalità, fine mese, giorno valuta; `contabilita.md:22,117,197`), obbligatoria sul cliente
(`CLIFOR.cs:8575`). Oggi in WasteFlow è un'etichetta a 6 codici (`contract-vocabulary.ts:15-22`).
- **A (consigliata).** Anagrafica per azienda `condizioni_pagamento`: codice, descrizione, modalità
  FatturaPA (MP01 contanti, MP02 assegno, MP05 bonifico, MP08 carta, MP12 RiBa, MP19 SEPA Direct
  Debit, MP23 PagoPA), 1-8 rate in giorni dalla data documento, fine mese. Niente giorno valuta né
  mesi esclusi (seguito).
- B. Vocabolario fisso (modalità × scadenza a rata unica), allargando `PAYMENT_TERMS`: niente tabella,
  ma le rate multiple e i codici dei clienti WinWaste (import 3.8) non hanno posto.
- Impatto se B: spariscono la tabella (RLS 48 → 47), il Task 6 e la pagina del Task 12; Task 2 si
  riduce alla validazione del codice.

**Q3. Stati del contratto cliente.** WinWaste non ha una macchina a stati: ha `SOSP` 0/1/2 e l'annullo
con motivo, più i contratti temporanei ("non fatturabili", tabella e numerazione a parte,
`contratti.md` §2, §4, §6).
- **A (consigliata).** `BOZZA` (non fatturabile, sostituisce i temporanei senza tabella a parte),
  `ATTIVO`, `SOSPESO` (`SOSP=1`), `SOSPESO_MOVIMENTI` (`SOSP=2`: movimenti esclusi, addebiti fissi
  sì), `ANNULLATO` (con motivo, definitivo). "Scaduto" non è uno stato: si calcola dalla data di fine.
- B. Come A ma senza `BOZZA` (parità stretta: il contratto nasce attivo; i preventivi restano fuori).
- C. Riusare gli stati di `Contract` (`DRAFT`…`TERMINATED`) aggiungendo la sospensione parziale.
- Impatto se B: tolto lo stato e la regola "elimina solo bozze" (si elimina solo un contratto mai
  usato, cioè sempre fino a 4.3). Se C: Task 3 e 10 riscritti sulle transizioni di 4.0.

**Q4. Privati come clienti.** Oggi F2-10 ammette il privato (solo codice fiscale) **solo come
produttore** (`ditte.service.ts:143-145`, regola D2.5). WinWaste ammette il cliente persona fisica
(`PER = F`, nome e cognome obbligatori, `CLIFOR.cs:8708-8722`; codice SDI `0000000`).
- **A (consigliata).** Il privato è ammesso anche come cliente, con nome e cognome obbligatori
  (servono nella FatturaPA). Si cambia la regola D2.5 in un punto, backend e frontend.
- B. Solo ditte con partita IVA in questa uscita.
- Impatto se B: nessuna modifica alla regola di F2-10 nel Task 5, niente `nome`/`cognome`.

**Q5. Rinnovo.** In WinWaste il "rinnovo annuale automatico" (`RINNOVO`, `Contratti.cs:3262`) non è
un job: è un'operazione massiva a mano (F6 "Aggiorna date fine contratto", `CambiaDataFine.cs:615-636`)
che porta avanti di un anno la fine dei contratti scaduti entro una data, con le opzioni "solo con
rinnovo automatico", "anche sospesi", "solo del cliente".
- **A (consigliata).** Parità: flag sul contratto, azione "Rinnova" sul singolo contratto (+1 anno) e
  azione massiva "Proroga scadenze" con le stesse opzioni di F6.
- B. Solo flag e azione sul singolo contratto (la massiva in un seguito).
- C. Job notturno che rinnova da solo i contratti scaduti con il flag.
- Impatto se B: tolto il Task 11 (metodo e rotta massivi) e il dialog nel Task 14. Se C: un job di
  sistema (RLS di sistema, `punti-di-sistema.spec.ts`) al posto della rotta massiva.

**Q6. IBAN e banca d'appoggio.** WinWaste ha la banca del cliente con IBAN (`CLIFOR.cs:4519,4907`),
le "nostre coordinate bancarie" (`:4541`) e la banca d'appoggio sul contratto (`BAN`).
- **A (consigliata).** In 4.1 solo l'IBAN **del cliente** (serve per RiBa e addebito diretto). L'IBAN
  del gestore su cui il cliente paga è un dato del cedente: entra col profilo di fatturazione
  dell'azienda in 4.4/4.5 (onboarding del cedente), insieme a P.IVA e regime fiscale.
- B. Anagrafica per azienda dei conti correnti del gestore già ora, scelta sul contratto (+1 tabella
  RLS, +1 task).

---

## Stato di partenza (branch `feat/fase4-1-contratto-cliente` = master `dafa30b`, verificato)

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
- Ultima migration: `20261102100000_rentri_esclusione_invio_automatico`. Prefisso di questo pezzo:
  **`20261102200000_`**.
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
- Modello di modulo con dominio, servizi e controller separati: pese (`src/domain/pese/`,
  `src/application/pese/`, `src/api/pese/pese.module.ts`, registrato in `src/app.module.ts:52,162`).
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
- `fe/features/registry/ditta-identificativi.component.ts` (P.IVA/CF con ricerca della ditta,
  `@Input() tipo: TipoAnagrafica`, `ETICHETTA_RUOLO` `:20-24`), `sedi-ditta-dialog.component.ts`
  (`dittaId`, `ragioneSociale`, `puoGestire`, `(modificata)`), `identificativo-fiscale.ts:19,141-146`
  (regola del privato nel frontend), `anagrafica-form-dialog.component.ts:21` (`TipoAnagrafica`),
  `registry.service.ts`, `fe/shared/models/registry.model.ts:128` (`Ditta.ruoli`).
- Menu: `fe/shared/components/layout.component.ts:1278-1294` (`navMain`, voce Contratti con
  `feature: 'contratti'`); rotte `fe/app.routes.ts:144-150`.
- E2E: `e2e/tests/` (cartelle per area, `pulizia/`), eseguiti nel job `e2e` di `.gitea/workflows/ci.yml:421`.

## Normativa e punti dubbi

- **FatturaPA** (tracciato 1.2.x, specifiche tecniche AdE): `CodiceDestinatario` di 7 caratteri per i
  privati e le imprese (`0000000` se il cliente non l'ha comunicato o riceve via PEC), di 6 caratteri
  per la PA (codice univoco ufficio IPA); `PECDestinatario` solo con `0000000`;
  `RiferimentoAmministrazione` ≤ 20 caratteri; per la persona fisica `Nome` e `Cognome` al posto di
  `Denominazione`; `EsigibilitaIVA` I/D/S; `ModalitaPagamento` MP01-MP23; `DatiContratto` /
  `DatiOrdineAcquisto` con `IdDocumento` obbligatorio (≤ 20) e `CodiceCIG` (≤ 15, di fatto 10),
  `CodiceCUP` (≤ 15). Questo pezzo **salva e valida** i dati; il tracciato si produce in 4.4.
- **Split payment** (art. 17-ter DPR 633/1972): esigibilità `S`, per PA e società controllate.
  **IVA a esigibilità differita** (art. 6 c. 5 DPR 633/1972): `D`. Le due cose si escludono (anche
  WinWaste lo vieta, `CLIFOR.cs:8632-8636`): un solo campo a tre valori.
- **Imposta di bollo** su fatture esenti/escluse sopra 77,47 € (DPR 642/1972, tariffa art. 13):
  qui solo il flag "addebita il bollo"; il calcolo è di 4.4.
- **CIG** (L. 136/2010 art. 3; art. 25 DL 66/2014: senza CIG la PA non paga) e **CUP** (L. 3/2003
  art. 11): sul contratto, perché valgono per l'appalto.
- **IBAN** ISO 13616 con controllo mod-97; italiano di 27 caratteri.
- Punti dubbi risolti nelle Decisioni: il campo "split" sta sul cliente in WinWaste e non sul
  contratto (D7); i periodi di WinWaste sono `gg-mm` senza anno e il periodo che attraversa l'anno è
  un errore dell'elaborazione (D10); il rinnovo massivo di WinWaste sbaglia il 29 febbraio (D11).

## Evidenze WinWaste

Sorgenti decompilati con ilspycmd 9.1 nello scratchpad della sessione di analisi (codice di terzi,
non nel progetto): `WWNET03.Contratti.decompiled.cs` (abbreviato `Contratti.cs`),
`WWNET03/CambiaDataFine.cs`, `WWNET32.CLIFOR.decompiled.cs` (`CLIFOR.cs`). **O** = Osservazione (letto
nel codice), **D** = Deduzione, **I** = Ignoto.

| # | Fatto | Fonte | Uso qui |
|---|---|---|---|
| E1 | O. Salvataggio del contratto: descrizione obbligatoria ("Inserire una descrizione per questo contratto"), inizio non successivo alla fine, condizione di pagamento obbligatoria se il campo è abilitato, una sola delle due caselle di sospensione | `Contratti.cs:6593-6622` | D9 (validazione), D8 |
| E2 | O. Record di 27 campi: `CLIFAT`, `PAG`, `BAN`, `AGE`, `SPB`, `BOLLO`, `AN1-3`, `TFAT`, `SOSP` (1 = "Sospendi Contratto", 2 = "Sospendi fatturazione movimenti"), `IVAS`, `PERIODI` (fino a 12 `gg-mm§gg-mm;`), `RINNOVO`, `C1` registro IVA, `C3` extra, `C4` ritenuta | `Contratti.cs:6669-6750`, etichette `:2957`, `:3658` | D5, D8, D10 |
| E3 | O. `C3`: 4-5 soglia, 7-8 codice e riferimento fattura PA (visibili solo se il cliente ha `+` nel codice SDI), 9 stipula, 10 commessa, 11 destinatario/sede, 12-13 validità, 14 codice annullo, 15 codice rinnovo, 17 ISTAT, 19 intento escluso | `Contratti.cs:6714-6748`, `:6298-6313` | D5 (codice ufficio e riferimento PA sul contratto), D6 |
| E4 | O. Un contratto nuovo **eredita dal cliente** pagamento, agente, registro IVA, spese, bollo, IVA sospesa, ritenuta | `Contratti.cs:6315-6336` | D4 |
| E5 | O. Il cliente di fatturazione uguale all'intestatario viene rifiutato e svuotato ("non va indicato"); deve esistere fra i clienti (`inputCf("C", …)`) | `Contratti.cs:5257-5275`; `liber.qform.decompiled.cs:7756` | D9 |
| E6 | O. Periodi con regola 11: solo il codice di frequenza (01 mensile, 02 bimestrale, 03 trimestrale, 04 quadrimestrale, 06 semestrale, 12 annuale); altrimenti l'elenco esplicito | `Contratti.cs:6278-6286`, `:6696-6711` | D10 |
| E7 | O. Effetto dei periodi in fatturazione: il contratto si fattura se la fine di un periodo cade nell'intervallo; errore se l'intervallo attraversa l'anno o se più di un periodo vi termina; 28-02 → 29-02 negli anni bisestili; senza periodi vale l'intervallo digitato | `fatturazione.md` §3.2 p. 5 (`FATAUTOMATICA.cs:9425`) | D10 (`periodoDaFatturare`) |
| E8 | O. Sospensione in fatturazione: `SOSP=1` → "Contratto sospeso", nessuna fattura; `SOSP=2` → movimenti esclusi, addebiti fissi sì | `fatturazione.md` §3.2 (`FATAUTOMATICA.cs:10684-10689`, `:12687`) | D8 |
| E9 | O. Rinnovo: casella "Rinnovo annuale automatico"; F6 `CambiaDataFine` porta la fine all'anno successivo per i contratti con fine ≤ data, opzioni "Solo contratti con rinnovo automatico", "Anche contratti sospesi", per cliente e categoria. La query concatena l'anno nuovo con `substring(dataf,5,4)`: da `20240229` produce `20250229`, data inesistente | `Contratti.cs:3262`; `CambiaDataFine.cs:380,389,430,615-636` | D11 (difetto evitato) |
| E10 | O. Anagrafica cliente: ragione sociale, CAP di 5 cifre, ISO, condizione di pagamento obbligatori; P.IVA e codice SDI obbligatori con regola 01; persona fisica con nome e cognome obbligatori; split e IVA sospesa non insieme | `CLIFOR.cs:8545-8615`, `:8622-8642`, `:8708-8730` | D3, D7 |
| E11 | O. Codice SDI: almeno 6 caratteri (salvo `+`/`NO`); `XXXXXX`/`XXXXXXX` vietati per l'Italia; PEC con `@`; riferimento amministrazione solo con codice SDI; PEC di invio solo con `0000000` | `CLIFOR.cs:9039-9080` | D3 (regole portate) |
| E12 | O. Campi del record cliente: `pag`, `banc` (banca cliente) con IBAN, "Ns.coord.banc.", `VEN` registro IVA, `IVASOSP`, agente, ritenuta, `sdi`, `CECsplit`, `RifAmmin`, `PECft`, nome/cognome | `CLIFOR.cs:9122-9227`, etichette `:4424-5893` | D3, Q6 |
| E13 | O. Avviso (non blocco) se esistono altri clienti con la stessa P.IVA o lo stesso CF | `CLIFOR.cs:9891`, `:9956` | D2: da noi la ditta è unica per identificativo |
| E14 | O. La form del contratto sceglie un cliente esistente ma non lo crea (F1 lista, digitazione validata); l'anagrafica si fa prima | `contratti.md` §9.1-9.2 | D17 (frontend: scelta del cliente, link all'anagrafica) |
| E15 | O. Condizioni di pagamento: tabella con `NR` rate, `MOD`, `SCA`, `FM` fine mese, `IMP` %, `VAL` giorno valuta; "30 giorni = un mese" | `contabilita.md:22,117,197` | D6 |
| E16 | D. `FPCodice`/`FPRifer` (C3 7-8) sono codice ufficio e riferimento amministrazione per contratto, per la PA con più uffici. I. Dove WinWaste salvi CIG e CUP (la fattura XML li gestisce, `fatturazione.md` §5) | `Contratti.cs:6298-6313`, `:6727-6728` | D5 (CIG/CUP sul contratto per la norma, non per evidenza) |
| E17 | O. `ControlloRegole` (01/09/11) sono configurazioni per singolo cliente di Nica | `contratti.md` §5; rapporto 02 §1.1 | Fuori ambito |

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
o creata). Ragione sociale, P.IVA, CF, indirizzi **non** si duplicano sul cliente.

**D3. Dati fiscali del cliente** (colonne di `clienti`, regole pure del Task 1):

| Campo | Tipo | Regola (messaggio esatto) |
|---|---|---|
| `codice` | VarChar(20)?, unico per azienda | codice dell'operatore (es. il `COD` di WinWaste per l'import); 1-20 caratteri `[A-Za-z0-9._-]` → "Il codice cliente può contenere solo lettere, cifre, punto, trattino e trattino basso (massimo 20 caratteri)." |
| `codiceDestinatario` | VarChar(7)? | maiuscolo, 6 o 7 caratteri alfanumerici → "Il codice destinatario SDI deve avere 7 caratteri (6 per la pubblica amministrazione)."; `XXXXXX`/`XXXXXXX` → "Il codice destinatario XXXXXXX vale solo per i clienti esteri." (E11) |
| `pecFatturazione` | VarChar(255)? | forma di e-mail → "La PEC per la fattura elettronica non è valida."; solo con codice vuoto o `0000000` → "La PEC per la fattura elettronica si indica solo con il codice destinatario 0000000 o senza codice." (E11) |
| `riferimentoAmministrazione` | VarChar(20)? | ≤ 20 → "Il riferimento amministrazione non può superare 20 caratteri."; solo con codice destinatario → "Il riferimento amministrazione si indica solo insieme al codice destinatario." (E11) |
| `iban` | VarChar(34)? | normalizzato senza spazi, maiuscolo; mod-97 e lunghezza del paese (IT = 27) → "L'IBAN non è valido." |
| `esigibilitaIva` | enum `IMMEDIATA`/`DIFFERITA`/`SCISSIONE`, default `IMMEDIATA` | — (D7) |
| `addebitaBollo` | Boolean, default false | — |
| `condizionePagamentoId` | Uuid? → `condizioni_pagamento` | condizione attiva dell'azienda → "La condizione di pagamento scelta non esiste o è disattivata." |
| `nome`, `cognome` | VarChar(60)? | obbligatori se la ditta è un privato (Q4 A) → "Per un cliente persona fisica indica nome e cognome."; vietati altrimenti → "Nome e cognome si indicano solo per un cliente persona fisica." (E10) |
| `note` | Text? | — |
| `attivo` | Boolean, default true | D13 |

Il codice destinatario vuoto è ammesso: in fattura 4.4 userà `0000000`. Nessun dato fiscale nei
messaggi (nessun valore ripetuto).

**D4. Predefiniti del cliente, valori effettivi sul contratto.** Come WinWaste (E4): alla creazione
del contratto `condizionePagamentoId`, `esigibilitaIva`, `addebitaBollo`, `codiceDestinatario` e
`riferimentoAmministrazione` assenti nel corpo si **copiano dal cliente**; da lì in poi il contratto
ha i suoi valori (modificare il cliente non cambia i contratti esistenti). 4.4 legge il contratto.
Il codice destinatario sul contratto serve alla PA con più uffici (E3, E16): se il contratto non lo
ha, vale quello del cliente di fatturazione (regola documentata per 4.4, funzione pura
`destinatarioEffettivo` nel Task 3).

**D5. Perimetro (Q1 A).** Sul contratto: numero, descrizione, cliente, cliente di fatturazione,
sede di servizio (facoltativa, E3 pos. 11), data di inizio, fine, stipula, stato, motivo e data di
annullo, condizione di pagamento, esigibilità IVA, bollo, codice destinatario e riferimento
amministrazione propri, `codiceCig` (VarChar(15), 10 caratteri alfanumerici → "Il CIG deve avere 10
caratteri alfanumerici."), `codiceCup` (VarChar(15), 15 alfanumerici → "Il CUP deve avere 15
caratteri alfanumerici."), `idDocumentoPa` (VarChar(20): numero del contratto/ordine della PA,
obbligatorio se c'è CIG o CUP → "Con CIG o CUP indica anche il riferimento del documento della PA
(contratto, convenzione o ordine)."), `rinnovoAutomatico`, `note`, periodi. Esclusi: vedi Q1 A.

**D6. Condizioni di pagamento (Q2 A).** Tabella `condizioni_pagamento`: `codice` VarChar(10) unico
per azienda (1-10, `[A-Za-z0-9._-]`), `descrizione` VarChar(100) obbligatoria, `modalita`
VarChar(4) fra MP01, MP02, MP05, MP08, MP12, MP19, MP23, `giorniRate` `Int[]` (1-8 valori, interi
0-365 strettamente crescenti; `0` ammesso solo come rata unica = "a vista"), `fineMese` Boolean,
`attiva` Boolean, `versione`. Funzione pura `calcolaScadenze(dataDocumento, condizione)`:
giorni multipli di 30 = mesi di calendario ("30 giorni = un mese", E15; 31/01 + 30 → 28/02 o
29/02), altrimenti giorni; con `fineMese` la scadenza va all'ultimo del mese. Date come stringhe
`YYYY-MM-DD` (nessun fuso). La ripartizione degli importi fra le rate è di 4.4. Mai cancellata se
usata (D13).

**D7. Esigibilità IVA a tre valori.** `IMMEDIATA`, `DIFFERITA`, `SCISSIONE` (split payment) sul
cliente come predefinito e sul contratto come valore effettivo. Un campo solo perché sospensione e
split si escludono (E10, `CLIFOR.cs:8632`). In WinWaste lo split sta solo sul cliente e il contratto
ha "IVA sospesa S/N": qui il contratto può fissare anche la scissione, che copre i due casi senza
un secondo campo. Nessun controllo incrociato col tipo di cliente (la PA non è riconoscibile dai dati
che abbiamo).

**D8. Stati e transizioni (Q3 A).**

| Da \ A | ATTIVO | SOSPESO | SOSPESO_MOVIMENTI | ANNULLATO |
|---|---|---|---|---|
| BOZZA | sì (richiede condizione di pagamento) | — | — | — (la bozza si elimina) |
| ATTIVO | — | sì | sì | sì (motivo obbligatorio) |
| SOSPESO | sì | — | sì | sì |
| SOSPESO_MOVIMENTI | sì | sì | — | sì |
| ANNULLATO | — | — | — | — (definitivo) |

Messaggi: transizione non ammessa → 409 `CONTRATTO_CLIENTE_TRANSIZIONE_NON_AMMESSA` "Dallo stato
<etichetta> non si passa a <etichetta>."; bozza senza condizione → 400 "Per attivare il contratto
indica la condizione di pagamento."; annullo senza motivo → 400 "Indica il motivo dell'annullo."
(regola 11 di WinWaste, `contratti.md` §5, resa generale perché senza motivo l'annullo non si
ricostruisce). L'annullo salva `annullatoIl`. Etichette: Bozza, Attivo, Sospeso, Sospeso (solo
movimenti), Annullato. "Scaduto" = `dataFine < oggi` (data locale italiana), calcolato nella vista,
nessuna transizione automatica. La semantica di fatturazione (E8) è documentata nel commento del
modulo per 4.4: `SOSPESO` = nessuna fattura, `SOSPESO_MOVIMENTI` = solo addebiti fissi, `BOZZA` e
`ANNULLATO` = mai.

**D9. Campi modificabili e validazione.** `BOZZA`: tutti. `ATTIVO`, `SOSPESO`, `SOSPESO_MOVIMENTI`:
tutti tranne `numero`, `clienteId`, `dataInizio` (cambiarli fa un altro contratto, come 4.0 D2).
`ANNULLATO`: nessuno → 409 `CONTRATTO_CLIENTE_NON_MODIFICABILE` "Un contratto annullato non si
modifica.". `stato`, `motivoAnnullo`, `annullatoIl` non sono campi della modifica. Validazione
(`validaContrattoCliente`, creazione e modifica, messaggi nell'ordine dei campi): numero non vuoto
≤ 50; descrizione obbligatoria ≤ 255 ("Inserisci una descrizione per questo contratto.", E1); data
di inizio obbligatoria; fine non precedente all'inizio ("La data di fine non può precedere la data
di inizio.", E1); rinnovo automatico solo con data di fine ("Il rinnovo automatico richiede una data
di fine."); cliente di fatturazione uguale al cliente → **normalizzato a null** senza errore (E5);
codice destinatario e riferimento come D3; CIG, CUP, documento PA come D5; periodi come D10.
Controlli che leggono il database (nel servizio, dopo la validazione pura): cliente e cliente di
fatturazione esistenti e **attivi** se cambiati ("Il cliente scelto non esiste o è disattivato." /
"Il cliente di fatturazione scelto non esiste o è disattivato."), sede attiva della ditta del
cliente ("La sede scelta non è una sede attiva del cliente."), condizione attiva (D3). Confronto
dei campi come 4.0 D5 (date per giorno, stringhe col trim, vuoto = null, periodi come elenco
ordinato).

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

**D11. Rinnovo e proroga (Q5 A).** `POST /contratti-clienti/:id/rinnova { versione }`: data di fine
+ 1 anno (29/02 → 28/02), ammesso con data di fine e stato diverso da `BOZZA`/`ANNULLATO`
(409 `CONTRATTO_CLIENTE_NON_RINNOVABILE` "Si rinnovano solo i contratti attivi o sospesi con una
data di fine."). `POST /contratti-clienti/proroga-scadenze { scadutiEntro, soloRinnovoAutomatico =
true, ancheSospesi = false, clienteId? }`: per tutti i contratti non eliminati, attivi (e sospesi se
richiesto), con data di fine ≤ `scadutiEntro`, fine + 1 anno e `versione + 1`, in una transazione;
risponde `{ prorogati: number }` e scrive **una** riga di audit con il conteggio e i filtri (E9, con
la data corretta dove WinWaste sbaglia il 29/02). Scrittura con `tx.$executeRaw` (`data_fine + interval
'1 year'`) dentro la transazione con contesto: la RLS vale anche per il raw, e il `WHERE` ripete
comunque `tenant_id`. Nessun job automatico.

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
  rinnovo, proroga. I periodi restano (cascata solo su cancellazione fisica).
- Cliente: `attivo` (disattiva/riattiva con `PATCH`); un cliente disattivato non si sceglie per
  contratti nuovi o come cliente di fatturazione, i contratti esistenti restano. Cancellazione
  **fisica** solo se nessun contratto (nemmeno eliminato) lo cita: FK `NoAction`, P2003 → 409
  `CLIENTE_CON_CONTRATTI` "Il cliente ha dei contratti: non si elimina. Disattivalo per non usarlo nei
  contratti nuovi." (stessa idea di `cancellacontratti`, `contratti.md` §6). La ditta e le sedi
  restano (sono di F2-10).
- Condizione di pagamento: `attiva`; cancellazione fisica solo se nessun cliente o contratto la
  cita (409 `CONDIZIONE_PAGAMENTO_IN_USO` "La condizione di pagamento è usata da clienti o contratti:
  disattivala invece di eliminarla.").

**D14. Lock ottimistico.** Colonna `versione INTEGER NOT NULL DEFAULT 1` (CHECK ≥ 1) su
`condizioni_pagamento`, `clienti`, `contratti_cliente`. Ogni scrittura (modifica, stato, rinnovo,
proroga, disattivazione, eliminazione) fa `updateMany({ where: { id, tenantId, versione, … } })` con
`versione: { increment: 1 }`; `count === 0` → 409 `<ENTITA>_MODIFICATO_NEL_FRATTEMPO` /
`CONDIZIONE_PAGAMENTO_MODIFICATA_NEL_FRATTEMPO` "… è stato modificato nel frattempo da un'altra
operazione: ricarica per vedere i dati aggiornati e ripeti l'operazione." (testo di 4.0 D9, con il
soggetto). Ordine dei controlli come 4.0 D4: (1) 404; (2) stato che non ammette la modifica; (3)
versione diversa; (4) campi non ammessi; (5) validazione pura; (6) controlli sul database; (7)
scrittura condizionata con audit; P2002 sul numero → 409 `CONTRATTO_CLIENTE_NUMERO_DUPLICATO`
"Esiste già un contratto con questo numero."; P2002 sul codice cliente → 409
`CLIENTE_CODICE_DUPLICATO` "Esiste già un cliente con questo codice."; sul codice condizione → 409
`CONDIZIONE_PAGAMENTO_CODICE_DUPLICATO` "Esiste già una condizione di pagamento con questo codice.".
Un corpo senza differenze non scrive e non lascia audit, ma controlla la versione.

**D15. Integrità nel database.** FK composite con `tenant_id` (un id di un'altra azienda non si
aggancia nemmeno a livello SQL): `clienti` → `ditte (id, tenant_id)` e `sedi_ditte (id, ditta_id,
tenant_id)` `NoAction`; `clienti.condizione_pagamento_id` e `contratti_cliente.condizione_pagamento_id`
→ `condizioni_pagamento (id, tenant_id)` `NoAction`; `contratti_cliente.cliente_id` e
`cliente_fatturazione_id` → `clienti (id, tenant_id)` `NoAction` (due relazioni con nome);
`contratti_cliente.sede_id` → `sedi_ditte (id, tenant_id)` `NoAction` (l'appartenenza alla ditta del
cliente la controlla il servizio: la ditta non è una colonna del contratto); periodi →
`contratti_cliente (id, tenant_id)` `ON DELETE CASCADE`; ogni tabella → `tenants` `ON DELETE CASCADE`.
CHECK: `versione >= 1`, eliminazione coerente (`eliminato_da IS NULL OR eliminato_il IS NOT NULL`),
`cardinality(giorni_rate) BETWEEN 1 AND 8`, `ordine BETWEEN 1 AND 12`, giorni 1-31 e mesi 1-12,
`unique (contratto_id, ordine)`, `stato <> 'ANNULLATO' OR (motivo_annullo IS NOT NULL AND
annullato_il IS NOT NULL)`, `data_fine IS NULL OR data_fine >= data_inizio`. Date dei contratti come
`DATE` (`@db.Date`): niente ore né fusi.

**D16. Audit senza dati personali.** `activity_logs` nella stessa transazione, azioni
`CONDIZIONE_PAGAMENTO_CREATA|MODIFICATA|ELIMINATA`, `CLIENTE_CREATO|MODIFICATO|DISATTIVATO|RIATTIVATO|ELIMINATO`,
`CONTRATTO_CLIENTE_CREATO|MODIFICATO|STATO|RINNOVATO|PROROGATI|ELIMINATO`. Metadata: solo id, numero
del contratto, nomi dei campi cambiati, stati, date e conteggi. **Mai**: ragione sociale o nome di un
privato, codice fiscale, P.IVA, IBAN, PEC, codice destinatario, nome/cognome, note, motivo
dell'annullo (testo libero). Per il contratto `prima`/`dopo` solo per date, stato, flag, esigibilità,
id della condizione. Descrizioni: "Cliente creato", "Contratto <numero> modificato" (il numero è un
dato dell'azienda, non personale). Log applicativi con id, mai valori.

**D17. API, ruoli, azienda.** Ogni rotta: `requireRequestTenantId(req)` e `@Roles(...)` esplicito
(ruolo effettivo dal `RolesGuard`): letture `SUPER_ADMIN, ADMIN, OPERATOR, VIEWER`, scritture
`SUPER_ADMIN, ADMIN, OPERATOR`. `ParseUUIDPipe` sugli id, `DELETE …?versione=` con `ParseIntPipe`
(204). Elenchi paginati lato server (`pagina` ≥ 1, `dimensione` 1-100, default 25) con risposta
`{ elementi, totale }`. Rotte:
- `/condizioni-pagamento`: `GET` (`?incluseDisattivate`), `GET :id`, `POST`, `PATCH :id`, `DELETE :id`.
- `/clienti`: `GET` (`?testo` su ragione sociale/codice/P.IVA, `?soloAttivi`, paginato), `GET :id`,
  `POST` (dati della ditta come le altre anagrafiche + dati fiscali; risposta con `dittaEsistente` e
  `avvisi`), `PATCH :id` (dati fiscali, `sedeId` predefinita, `attivo`; mai gli identificativi: quelli
  si correggono sulla ditta, F2-10), `DELETE :id`.
- `/contratti-clienti`: `GET` (`?stato`, `?clienteId`, `?testo`, `?inScadenzaEntroGiorni`,
  paginato), `GET prossimo-numero` e `POST proroga-scadenze` **prima** di `:id`, `GET :id`, `POST`,
  `PATCH :id`, `PATCH :id/stato { stato, versione, motivo? }`, `POST :id/rinnova { versione }`,
  `DELETE :id`.
Feature flag: si riusa `contratti` (nessuna chiave nuova in `feature-catalog.ts`).

**D18. Ruolo `CLIENTE` in F2-10 (modifica mirata).** `RuoloControparte` diventa `'PRODUTTORE' |
'TRASPORTATORE' | 'DESTINATARIO' | 'CLIENTE'` (`NOME_RUOLO.CLIENTE = 'cliente'`); `ruoliDellaDitta`
legge anche `clienti` (così la sede predefinita di un cliente non si disattiva, e `DittaDto.ruoli`
ha `clienteId`); `NomeRuolo` e `SedeNonValidaPerRuoloError` accettano `'cliente'`; con Q4 A la
regola del privato diventa "produttore o cliente" (`MESSAGGIO_PRIVATO_SOLO_PRODUTTORE` →
"Un privato senza partita IVA può essere solo produttore o cliente.", stesso testo nel frontend
`identificativo-fiscale.ts:19`). Nessun'altra modifica al registry.

**D19. RLS e privilegi.** Quattro tabelle con `tenant_id`, RLS `ENABLE` + `FORCE`,
`isolamento_azienda` e `sola_lettura TO wasteflow_lettura` (forma di
`20261031110000_ditte_sedi_controparti/migration.sql:326-338`); modelli `CondizionePagamento`,
`Cliente`, `ContrattoCliente`, `PeriodoFatturazioneCliente` in `TENANT_SCOPED_MODELS`; catalogo
**44 → 48**. `ruoli-db.sql` invariato: le tabelle ricevono il CRUD predefinito (servono `DELETE` per
clienti, condizioni e periodi; per i contratti la cancellazione è logica come `contracts`).

**D20. Frontend.** Voci di menu in `navMain` dopo "Contratti": "Clienti" (`/clienti`, `pi pi-users`)
e "Contratti clienti" (`/contratti-clienti`, `pi pi-file-edit`), `feature: 'contratti'`; la pagina
delle condizioni (`/clienti/condizioni-pagamento`) si apre da un pulsante della lista clienti. Il
dialog del contratto **sceglie** un cliente esistente (autocomplete su `GET /clienti`), come WinWaste
(E14), con un link "Nuovo cliente" che apre il dialog del cliente in sovrapposizione e, al
salvataggio, riporta il cliente nel campo (comportamento del FIR di WinWaste, `contratti.md` §9.3,
più comodo e senza rischi). Il frontend non replica regole: abilita campi e pulsanti da
`modificabili`, `eliminabile`, `transizioni`, `rinnovabile` della vista.

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
  (le FK verso `tenants` sono a cascata; le FK `NoAction` fra le tabelle nuove si risolvono perché
  Postgres cancella le righe dello stesso tenant nella stessa istruzione — se una FK lo impedisce,
  cancellare prima in ordine periodi → contratti → clienti → condizioni, sempre con `tenantId: { in:
  tenantCreati }`). **Mai** un `deleteMany` con un filtro che può essere `undefined`. Fixture con
  `partitaIvaValida(seme)` e `creaDittaConRuolo`; utente creato dal proprietario.
- **RAM (16 GB): un solo processo pesante alla volta.** jest mirato `npx jest -w 2 <percorsi>`; a fine
  task backend **una volta** `NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npm run
  test:cov` (già `--runInBand`); lint solo dei file toccati senza `--fix` (`npx eslint <file…>`), mai
  `npm run lint`. Karma **una volta** a fine task frontend. Mai Karma e jest insieme.
- Fine task backend: `test:cov`, `npx tsc --noEmit -p tsconfig.json`, eslint globale backend
  `npx eslint "{src,test}/**/*.ts" --max-warnings=-1` da `apps/backend` con **0 errori**, le suite
  Postgres toccate più `rls-catalogo.postgres.spec.ts` (dal Task 5: **48**). Confronto con la linea
  di base del Task 0: nessun fallimento nuovo.
- Task con migration: `npx prisma validate`; `npx prisma migrate deploy` su 55438; dalla root
  `DB_APP_PASSWORD=… DB_SISTEMA_PASSWORD=… PG_EXEC="docker exec -i wasteflow-pg-test-registro" bash ops/db-ruoli.sh`;
  `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/shadow_clienti?schema=public"`
  (database creato e rimosso con `docker exec wasteflow-pg-test-registro psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_clienti"` / `"DROP DATABASE shadow_clienti"`) → **vuoto**
  (o solo le note preesistenti di master: pgcrypto, default di `notifications.expires_at`).
  Migration **additive** e sicure in deploy: `SET LOCAL lock_timeout = '5s';` in testa (le FK
  toccano `ditte`, `sedi_ditte`, `tenants`, tabelle usate dal traffico), solo `CREATE TYPE`,
  `CREATE TABLE`, `CREATE INDEX` su tabelle nuove e vuote, nessun `ALTER` su tabelle esistenti;
  nomi di vincoli e indici ≤ 63 caratteri, uguali in schema e SQL; ripristino a mano nel commento
  iniziale e in `ops/README.md`. Cartella **`20261102200000_clienti_contratti_cliente`**.
- Task frontend: `cd apps/frontend && CHROME_BIN=/home/graziano/.cache/chrome-test/chrome-headless-shell/linux-156.0.8078.80/chrome-headless-shell-linux64/chrome-headless-shell npx ng test --watch=false --browsers=ChromeHeadless`
  (una volta), `npm run build`, dalla root `npx eslint <file toccati> --max-warnings=-1`.
- Aree che questo pezzo **non** tocca: `application/contracts/**`, `domain/contracts/**`,
  `fe/features/contracts/**` (il contratto produttore), `application/fir/**`, `api/fir/**`,
  `application/registro/**`, `api/registro/**`, `application/rentri/**`, `application/pese/**`,
  `core/filters/**`, `prisma/sql/ruoli-db.sql`. Toccati in modo **mirato** (D18): `domain/registry/entities/sede-ditta.ts`,
  `domain/registry/value-objects/identificativo-fiscale.ts`, `domain/registry/repositories/ditta.repository.ts`
  (solo il commento di `RuoloDitta`), `infrastructure/persistence/ditta-prisma.repository.ts`
  (`ruoliDellaDitta`), `application/registry/ditte/ditte.service.ts` (regola del privato, `DittaDto.ruoli`),
  `application/registry/crea-ruolo-su-ditta.ts` (`NomeRuolo`), `core/domain/errors.ts`
  (`SedeNonValidaPerRuoloError`), `fe/features/registry/{anagrafica-form-dialog,ditta-identificativi}.component.ts`
  e `identificativo-fiscale.ts` (tipo `cliente`), `fe/shared/models/registry.model.ts`, menu e rotte.
  Se un task scopre di doverne toccare un'altra, si ferma e lo segnala.
- **Convivenza con altri branch.** File a rischio di conflitto: `schema.prisma` (enum e modelli
  nuovi **in coda**, dopo `AbbinamentoCaricoScarico`; su `Tenant`, `Ditta`, `SedeDitta` solo relazioni
  inverse in fondo ai campi di relazione), `prisma-rls.extension.ts`, `rls-catalogo.postgres.spec.ts`,
  `README-tenant-transazione.md`, `ops/README.md`, `layout.component.ts`, `app.routes.ts`,
  `app.module.ts`. Al rebase: somma dei conteggi RLS, `prisma generate`, `migrate deploy`, `migrate
  diff` vuoto; se master ha una migration con timestamp successivo a `20261102200000`, rinominare la
  nostra con un timestamp successivo (mai applicata in produzione) e aggiornare `ops/README.md`.

## Review focus

Le situazioni più probabili in uso reale, ognuna con il suo test:

1. **Due operatori sullo stesso contratto** (o modifica mentre un collega lo sospende): il secondo
   salvataggio riceve 409, niente si sovrascrive, periodi compresi → Task 10 Postgres `due modifiche
   con la stessa versione: una riesce, l'altra 409 e i periodi sono quelli della prima`.
2. **Un cliente o una sede di un'altra azienda nell'id** (manomissione o bug del frontend): 400/404 dal
   servizio e, se passasse, la FK composita lo respinge → Task 5 `FK composita: cliente di un altro
   tenant respinto` e Task 10 `cliente di B nel contesto di A: 400`.
3. **Periodi che non tornano** (trimestrale scritto a mano con una sovrapposizione, 29/02, periodo
   dicembre-gennaio): errore chiaro, niente salvataggio parziale → Task 3 (`validaPeriodi`,
   `periodoDaFatturare`) e Task 10 (`periodi non validi: 400 e nessuna riga scritta`).
4. **Proroga di fine anno su un contratto con fine 29/02/2024** e su un sospeso escluso dai filtri →
   Task 11 `29/02 diventa 28/02/2025` e `sospesi esclusi senza ancheSospesi`.
5. **Privato come cliente**: CF senza P.IVA accettato con nome e cognome, rifiutato senza; il CF non
   compare in audit, log e messaggi → Task 4 e Task 8 (`audit senza dati personali` legge
   `activity_logs` e cerca CF, IBAN, PEC nel JSON).
6. **Cliente con contratti eliminato per sbaglio**: 409 con l'invito a disattivarlo, ditta e sedi
   intatte → Task 8 Postgres.

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

## Task 1: dominio puro — dati fiscali del cliente

**File:**
- Create: `apps/backend/src/domain/clienti/dati-fiscali-cliente.ts`
- Create: `apps/backend/src/domain/clienti/dati-fiscali-cliente.spec.ts`

**Interfaces (Produces):**
```ts
export type EsigibilitaIva = 'IMMEDIATA' | 'DIFFERITA' | 'SCISSIONE'
export const ESIGIBILITA_IVA: readonly EsigibilitaIva[]
export interface DatiFiscaliCliente {
  codice: string | null; codiceDestinatario: string | null; pecFatturazione: string | null
  riferimentoAmministrazione: string | null; iban: string | null; esigibilitaIva: EsigibilitaIva
  addebitaBollo: boolean; condizionePagamentoId: string | null
  nome: string | null; cognome: string | null; note: string | null
}
export type CampoCliente = keyof DatiFiscaliCliente | 'sedeId' | 'attivo'
export const ETICHETTE_CAMPI_CLIENTE: Readonly<Record<CampoCliente, string>>
export function normalizzaDatiFiscali(grezzo: Partial<Record<keyof DatiFiscaliCliente, unknown>>): DatiFiscaliCliente
export function validaDatiFiscali(d: DatiFiscaliCliente, contesto: { privato: boolean }): string[]
export function normalizzaIban(v: string): string
export function ibanValido(iban: string): boolean
export function tipoDestinatario(codice: string | null): 'PA' | 'IMPRESA' | 'NESSUNO'   // 6 / 7 / vuoto o 0000000
```

- [ ] **Step 1: test che falliscono** (`dati-fiscali-cliente.spec.ts`):
  - `normalizzaDatiFiscali`: stringhe col trim, vuoto → null, codice destinatario e IBAN maiuscoli,
    IBAN senza spazi, `esigibilitaIva` assente → `IMMEDIATA`, `addebitaBollo` assente → false;
  - `codice destinatario di 7 caratteri valido`; `di 6 caratteri valido (PA)`; `di 5 caratteri: messaggio D3`;
    `con un trattino: messaggio D3`; `XXXXXXX: messaggio "vale solo per i clienti esteri"`;
  - `PEC senza chiocciola: messaggio`; `PEC con codice 0000000: valida`; `PEC con codice ABC1234:
    messaggio "si indica solo con il codice destinatario 0000000 o senza codice"`; `PEC senza codice: valida`;
  - `riferimento amministrazione senza codice destinatario: messaggio`; `di 21 caratteri: messaggio`;
  - `IBAN italiano valido (IT60X0542811101000000123456)`; `IBAN con una cifra cambiata: "L'IBAN non è valido."`;
    `IBAN italiano di 26 caratteri: non valido`; `IBAN con spazi e minuscole: normalizzato e valido`;
  - `privato senza nome: "Per un cliente persona fisica indica nome e cognome."`; `non privato con
    cognome: messaggio "solo per un cliente persona fisica"`;
  - `codice cliente con spazio: messaggio`; `codice di 21 caratteri: messaggio`;
  - `più errori: tutti i messaggi nell'ordine dei campi`; `nessun messaggio contiene il valore
    ricevuto` (ciclo sui casi non validi con valori riconoscibili);
  - `tipoDestinatario`: `'UFE1AB'` → PA, `'ABC1234'` → IMPRESA, `'0000000'` e `null` → NESSUNO.
- [ ] **Step 2:** `npx jest -w 2 src/domain/clienti`: FAIL (modulo assente).
- [ ] **Step 3: implementare.** Commento di testa: cosa decide, le regole di D3 con il rimando alle
  evidenze E10-E12 (fonte WinWaste) e alla FatturaPA, perché il valore non compare mai nei messaggi.
  IBAN: tabella delle lunghezze almeno per IT, SM, VA, DE, FR, ES, AT, CH, GB (altre: 15-34),
  mod-97 con aritmetica a blocchi (niente `BigInt` obbligatorio). Nessuna dipendenza da Nest o Prisma.
- [ ] **Step 4:** test PASS; eslint dei due file; `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(clienti): regole pure dei dati fiscali del cliente" -- apps/backend/src/domain/clienti/dati-fiscali-cliente.ts apps/backend/src/domain/clienti/dati-fiscali-cliente.spec.ts`

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
  - `descriviRate`: `[0]` → "a vista"; `[30,60]` + fine mese → "30-60 gg fine mese".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Commento di testa: D6, la regola "30 giorni = un mese" con la fonte
  (E15), il motivo delle date come stringhe. Aritmetica di calendario senza `Date` locale (o con
  `Date.UTC`), clamp all'ultimo giorno del mese.
- [ ] **Step 4:** PASS, eslint, `tsc`.
- [ ] **Step 5: commit**
  `git commit -m "feat(clienti): condizioni di pagamento con rate e calcolo delle scadenze" -- apps/backend/src/domain/clienti/condizione-pagamento.ts apps/backend/src/domain/clienti/condizione-pagamento.spec.ts`

## Task 3: dominio puro — contratto cliente e periodi

**File:**
- Create: `apps/backend/src/domain/contratti-cliente/periodi-fatturazione.ts`
- Create: `apps/backend/src/domain/contratti-cliente/periodi-fatturazione.spec.ts`
- Create: `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts`
- Create: `apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.spec.ts`

**Interfaces (Produces):**
```ts
// periodi-fatturazione.ts
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

// regole-contratto-cliente.ts
export type StatoContrattoCliente = 'BOZZA'|'ATTIVO'|'SOSPESO'|'SOSPESO_MOVIMENTI'|'ANNULLATO'
export const ETICHETTE_STATO: Readonly<Record<StatoContrattoCliente, string>>
export const TRANSIZIONI: Readonly<Record<StatoContrattoCliente, readonly StatoContrattoCliente[]>>
export type CampoContrattoCliente =
  | 'numero'|'descrizione'|'clienteId'|'clienteFatturazioneId'|'sedeId'|'dataInizio'|'dataFine'
  | 'dataStipula'|'condizionePagamentoId'|'esigibilitaIva'|'addebitaBollo'|'codiceDestinatario'
  | 'riferimentoAmministrazione'|'codiceCig'|'codiceCup'|'idDocumentoPa'|'rinnovoAutomatico'|'note'|'periodi'
export interface DatiContrattoCliente { /* un campo per ogni CampoContrattoCliente; date 'YYYY-MM-DD' | null; periodi ordinati */ }
export type ModificaContrattoCliente = { [K in CampoContrattoCliente]?: DatiContrattoCliente[K] | null }
export const ETICHETTE_CAMPI: Readonly<Record<CampoContrattoCliente, string>>
export const CAMPI_MODIFICABILI: Readonly<Record<StatoContrattoCliente, readonly CampoContrattoCliente[]>>
export const CAMPI_FACOLTATIVI: readonly CampoContrattoCliente[]
export function normalizzaContratto(g: …): DatiContrattoCliente
export function validaContrattoCliente(d: DatiContrattoCliente): string[]
export function motivoNonModificabile(s: StatoContrattoCliente): string | null
export function motivoNonEliminabile(s: StatoContrattoCliente): string | null
export function verificaTransizione(da: StatoContrattoCliente, a: StatoContrattoCliente,
  d: { condizionePagamentoId: string | null; motivo?: string | null }): string | null   // null = ammessa
export function rinnovabile(s: StatoContrattoCliente, dataFine: string | null): boolean
export function dataPiuUnAnno(data: string): string          // 2024-02-29 → 2025-02-28
export function scaduto(dataFine: string | null, oggi: string): boolean
export function destinatarioEffettivo(contratto: { codiceDestinatario: string | null; riferimentoAmministrazione: string | null },
  clienteFatturazione: { codiceDestinatario: string | null; riferimentoAmministrazione: string | null }): { codiceDestinatario: string; riferimentoAmministrazione: string | null }
export function pianificaModifica(s: StatoContrattoCliente, attuale: DatiContrattoCliente, m: ModificaContrattoCliente):
  | { esito: 'NESSUNA_MODIFICA' }
  | { esito: 'CAMPI_NON_AMMESSI'; campi: CampoContrattoCliente[]; messaggio: string }
  | { esito: 'NON_VALIDA'; messaggi: string[] }
  | { esito: 'OK'; dopo: DatiContrattoCliente; cambiati: CampoContrattoCliente[] }
```
Etichette dei campi (testo esatto): Numero, Descrizione, Cliente, Cliente di fatturazione, Sede di
servizio, Data di inizio, Data di fine, Data di stipula, Condizione di pagamento, Esigibilità IVA,
Addebita il bollo, Codice destinatario, Riferimento amministrazione, CIG, CUP, Documento della PA,
Rinnovo automatico, Note, Periodi di fatturazione. Messaggi: D8, D9, D10 (testo esatto).

- [ ] **Step 1: test che falliscono** (periodi):
  - `periodiDaFrequenza`: `MENSILE` 12 periodi con 28/02 fine febbraio; `TRIMESTRALE` i 4 di D10;
    `ANNUALE` 01/01-31/12; `BIMESTRALE`, `QUADRIMESTRALE`, `SEMESTRALE` con gli estremi giusti;
  - `validaPeriodi`: elenco vuoto valido; 13 periodi; 31/04 non valido; 29/02 valido; inizio 01/12 fine
    31/01 → messaggio "non attraversano l'anno"; sovrapposti → "I periodi 1 e 2 si sovrappongono.";
    adiacenti (fine 31/03, inizio 01/04) validi; disordinati validi e `ordinaPeriodi` li ordina;
  - `periodoDaFatturare` (E7): nessun periodo → `NESSUN_PERIODO`; trimestrale, intervallo
    `2026-03-01`..`2026-03-31` → `PERIODO 2026-01-01..2026-03-31`; intervallo `2026-02-01`..`2026-02-28`
    → `NESSUNA_SCADENZA`; intervallo `2026-12-15`..`2027-01-15` → `ERRORE` attraversa l'anno;
    mensile, intervallo `2026-01-01`..`2026-03-31` → `ERRORE` più periodi; periodo con fine 28/02 e
    intervallo `2028-02-01`..`2028-02-29` → `PERIODO 2028-..-..` con fine `2028-02-29`; con anno
    non bisestile fine `2026-02-28`;
  - `prossimaFinePeriodo`: trimestrale, oggi `2026-05-10` → `2026-06-30`; oggi `2026-12-31` →
    `2026-12-31`; oggi dopo l'ultima fine → la prima fine dell'anno dopo; nessun periodo → null.
- [ ] **Step 2: test che falliscono** (regole):
  - `TRANSIZIONI` uguale alla tabella di D8; `verificaTransizione`: BOZZA→ATTIVO senza condizione →
    messaggio; con condizione → null; ATTIVO→ANNULLATO senza motivo → "Indica il motivo
    dell'annullo."; con motivo `'  '` → stesso messaggio; ANNULLATO→ATTIVO → "Dallo stato Annullato
    non si passa a Attivo."; BOZZA→SOSPESO → non ammessa;
  - `CAMPI_MODIFICABILI`: BOZZA tutti e 19; i tre stati attivi tutti tranne numero, cliente, data di
    inizio; ANNULLATO nessuno; `motivoNonModificabile('ANNULLATO')` → "Un contratto annullato non si
    modifica."; `motivoNonEliminabile` null solo per BOZZA;
  - `validaContrattoCliente`: valido; descrizione vuota; fine prima dell'inizio; fine uguale
    all'inizio valida; rinnovo senza fine; CIG di 9 caratteri; CUP di 14; CIG senza documento PA;
    CUP con documento valido; codice destinatario di 5 caratteri (regola di D3 riusata da
    `dati-fiscali-cliente.ts`); periodi sovrapposti (messaggi di `validaPeriodi`); più errori nell'ordine;
  - `normalizzaContratto`: cliente di fatturazione uguale al cliente → null (E5); date come
    `YYYY-MM-DD` da `Date` e da stringa ISO; periodi ordinati;
  - `pianificaModifica`: vuota → NESSUNA; stessi valori (date come nuova istanza, periodi in altro
    ordine) → NESSUNA; ATTIVO cambia `dataInizio` e `clienteId` → CAMPI_NON_AMMESSI "In un contratto
    attivo o sospeso non si possono cambiare: Cliente, Data di inizio."; ATTIVO cambia periodi e
    condizione → OK con `cambiati ['condizionePagamentoId','periodi']`; `null` su `dataFine` svuota;
    `null` su `descrizione` → NON_VALIDA "Descrizione è obbligatoria.";
  - `dataPiuUnAnno('2024-02-29')` → `'2025-02-28'`; `('2026-12-31')` → `'2027-12-31'`;
    `rinnovabile`: ATTIVO con fine → true, senza fine → false, BOZZA e ANNULLATO → false;
  - `scaduto`: fine ieri → true, oggi → false, null → false;
  - `destinatarioEffettivo`: contratto con codice → il suo; senza → quello del cliente di
    fatturazione; nessuno → `0000000` e riferimento del cliente.
- [ ] **Step 3:** `npx jest -w 2 src/domain/contratti-cliente`: FAIL.
- [ ] **Step 4: implementare.** Commento di testa di ciascun file: cosa decide, le tabelle di D8/D9,
  la semantica di fatturazione per 4.4 (E7, E8), il rimando a questo piano e a 4.0 (stessa forma di
  `regole-contratto.ts`, codice indipendente). Nessuna dipendenza da Nest o Prisma.
- [ ] **Step 5:** PASS, eslint dei quattro file, `tsc`.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): regole pure di stati, modifica e periodi di fatturazione" -- apps/backend/src/domain/contratti-cliente/periodi-fatturazione.ts apps/backend/src/domain/contratti-cliente/periodi-fatturazione.spec.ts apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.ts apps/backend/src/domain/contratti-cliente/regole-contratto-cliente.spec.ts`

## Task 4: ruolo CLIENTE nelle ditte di F2-10 (modifica mirata)

**File:**
- Modify: `apps/backend/src/domain/registry/entities/sede-ditta.ts` (`RuoloControparte`, `NOME_RUOLO`)
- Modify: `apps/backend/src/domain/registry/value-objects/identificativo-fiscale.ts` (messaggio, Q4 A)
- Modify: `apps/backend/src/application/registry/ditte/ditte.service.ts` (regola del privato `:143-145`, `:174-176`; `DittaDto.ruoli.clienteId`)
- Modify: `apps/backend/src/application/registry/crea-ruolo-su-ditta.ts` (`NomeRuolo`)
- Modify: `apps/backend/src/core/domain/errors.ts` (`SedeNonValidaPerRuoloError`)
- Modify: gli spec esistenti che citano il testo del messaggio del privato (trovarli con
  `grep -rn "può essere solo produttore" apps/backend/src`)
- Create: `apps/backend/src/application/registry/ditte/ruolo-cliente.spec.ts`

Questo task **non** tocca il database: `ruoliDellaDitta` legge i clienti solo dal Task 5 in poi (il
modello non esiste ancora). Qui si prepara il tipo e la regola.

**Interfaces:**
- Produces: `RuoloControparte` con `'CLIENTE'`; `NomeRuolo` con `'cliente'`; `DittaDto.ruoli:
  { produttoreId?; trasportatoreId?; destinatarioId?; clienteId? }`; `ammessoPrivato(ruolo:
  RuoloControparte): boolean` esportato da `identificativo-fiscale.ts` (`PRODUTTORE`, `CLIENTE`).

- [ ] **Step 1: test che falliscono** (`ruolo-cliente.spec.ts`, Prisma finto come gli spec del
  servizio ditte): `risolviPerRuolo con CLIENTE e un privato non lancia`; `con TRASPORTATORE e un
  privato lancia il messaggio nuovo`; `ammessoPrivato: PRODUTTORE e CLIENTE true, gli altri false`;
  `NOME_RUOLO.CLIENTE è "cliente"`; `messaggioRuoloPresente('cliente')` → "Esiste già un cliente per
  questa ditta"; `SedeNonValidaPerRuoloError('cliente')` → "La sede indicata non è una sede attiva del
  cliente scelto".
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare** (D18). La regola del privato usa `ammessoPrivato`. Aggiornare il
  testo negli spec esistenti.
- [ ] **Step 4:** `npx jest -w 2 src/application/registry src/domain/registry`; suite di fine task
  backend (con `registry-ditte.postgres.spec.ts`).
- [ ] **Step 5: commit**
  `git commit -m "feat(ditte): ruolo cliente e privato ammesso come cliente" -- <file del task>`

## Task 5: schema, migration, RLS

**File:**
- Modify: `apps/backend/prisma/schema.prisma` (enum e quattro modelli in coda; relazioni inverse su `Tenant`, `Ditta`, `SedeDitta`)
- Create: `apps/backend/prisma/migrations/20261102200000_clienti_contratti_cliente/migration.sql`
- Modify: `apps/backend/src/infrastructure/persistence/prisma-rls.extension.ts` (4 voci, commento "Clienti e contratti cliente (Fase 4 pezzo 1): dato dell'azienda")
- Modify: `apps/backend/src/infrastructure/persistence/rls-catalogo.postgres.spec.ts` (44 → 48)
- Modify: `apps/backend/src/infrastructure/persistence/README-tenant-transazione.md` ("(44)" → 48, elenco)
- Modify: `apps/backend/src/infrastructure/persistence/ditta-prisma.repository.ts` (`ruoliDellaDitta` legge `cliente`, D18)
- Modify: `ops/README.md` (sezione Rollback, paragrafo in coda prima di "Il ripristino dal backup")
- Create: `apps/backend/src/application/clienti/clienti.schema.postgres.spec.ts`

**Interfaces (Produces):** modelli Prisma
```prisma
enum EsigibilitaIva { IMMEDIATA DIFFERITA SCISSIONE  @@map("esigibilita_iva") }
enum StatoContrattoCliente { BOZZA ATTIVO SOSPESO SOSPESO_MOVIMENTI ANNULLATO  @@map("stato_contratto_cliente") }
model CondizionePagamento        // @@map("condizioni_pagamento"): D6, D13, D14; @@unique([id, tenantId]), ([tenantId, codice])
model Cliente                    // @@map("clienti"): D2, D3; @@unique([id, tenantId]), ([tenantId, dittaId]), ([tenantId, codice])
model ContrattoCliente           // @@map("contratti_cliente"): D5, D8, D12-D15; relazioni "ClienteDelContratto", "ClienteDiFatturazione"
model PeriodoFatturazioneCliente // @@map("periodi_fatturazione_cliente"): D10; @@unique([contrattoId, ordine])
```
Colonne, tipi e nomi: D3, D5, D6, D10, D15 (date del contratto `@db.Date`; `giorniRate Int[]
@map("giorni_rate")`; `versione Int @default(1)`; `createdAt`/`updatedAt` come le altre tabelle).
Nomi dei vincoli: `clienti_ditta_fkey`, `clienti_sede_fkey`, `clienti_condizione_pagamento_fkey`,
`contratti_cliente_cliente_fkey`, `contratti_cliente_cliente_fatturazione_fkey`,
`contratti_cliente_sede_fkey`, `contratti_cliente_condizione_pagamento_fkey`,
`periodi_fatturazione_cliente_contratto_fkey`, CHECK con prefisso della tabella (`…_versione_positiva`,
`…_eliminazione_coerente`, `condizioni_pagamento_rate_ammesse`, `contratti_cliente_annullo_coerente`,
`contratti_cliente_date_coerenti`, `periodi_fatturazione_cliente_valori`). Indici:
`contratti_cliente_tenant_id_stato_idx`, `contratti_cliente_tenant_id_cliente_id_idx`,
`contratti_cliente_tenant_id_cliente_fatturazione_id_idx` (accorciare se > 63: verificare),
`clienti_tenant_id_idx`, `clienti_sede_id_idx`.

- [ ] **Step 1: test che falliscono** (`clienti.schema.postgres.spec.ts`, ruolo app nel contesto,
  proprietario per preparare):
  - `un contratto nuovo nasce in BOZZA, versione 1, rinnovo false`;
  - `due clienti per la stessa ditta: P2002 su clienti_tenant_id_ditta_id_key`;
  - `FK composita: cliente di un altro tenant respinto` (proprietario: `cliente_id` di A con
    `tenant_id` di B, cita `contratti_cliente_cliente_fkey`);
  - `stato ANNULLATO senza motivo respinto` (`contratti_cliente_annullo_coerente`);
  - `fine prima dell'inizio respinta` (`contratti_cliente_date_coerenti`);
  - `condizione con 9 rate respinta` (`condizioni_pagamento_rate_ammesse`);
  - `periodo con ordine 13 respinto`; `due periodi con lo stesso ordine respinti`;
  - `cancellare un contratto (owner) cancella i suoi periodi`;
  - `eliminare un cliente citato da un contratto: errore FK` (P2003, `NoAction`);
  - `nel contesto di B le quattro tabelle di A sono vuote e un insert con tenant di A è respinto` (RLS);
  - `cancellare il tenant cancella condizioni, clienti, contratti e periodi`;
  - `ruoliDellaDitta riporta il cliente con la sua sede` (repository col ruolo app).
- [ ] **Step 2:** lanciarlo (guardia 55438): FAIL.
- [ ] **Step 3: schema.** Modelli ed enum **in coda** dopo `AbbinamentoCaricoScarico`, commento `///`
  su ciascuno (cosa contiene, cosa decide D2/D8/D10, dove sono le regole). Relazioni inverse:
  `Tenant` (`condizioniPagamento`, `clienti`, `contrattiCliente`, `periodiFatturazioneCliente`, dopo
  `contracts`, commento `// Fase 4 pezzo 1`), `Ditta.clienti`, `SedeDitta.clienti` e
  `SedeDitta.contrattiCliente`.
- [ ] **Step 4: migration**, nell'ordine, con commento di testa sul modello di
  `20261031110000_ditte_sedi_controparti` (cosa fa, perché — 4.1 e decisioni —, che è additiva, chi
  la esegue, **ripristino a mano**: `DROP TABLE periodi_fatturazione_cliente, contratti_cliente,
  clienti, condizioni_pagamento; DROP TYPE stato_contratto_cliente, esigibilita_iva;` e `DELETE FROM
  _prisma_migrations WHERE migration_name = '20261102200000_clienti_contratti_cliente';`, ripristino
  da P3009 con `migrate resolve --rolled-back`):
  1. `SET LOCAL lock_timeout = '5s';`
  2. tipi enum;
  3. tabelle `condizioni_pagamento`, `clienti`, `contratti_cliente`, `periodi_fatturazione_cliente`
     con PK, unici, CHECK;
  4. FK (verso `tenants`, `ditte`, `sedi_ditte` e fra le tabelle nuove) con le clausole che Prisma
     genera (verificate col `migrate diff`);
  5. indici;
  6. RLS ENABLE + FORCE + `isolamento_azienda` + `sola_lettura` per le quattro tabelle.
  Nessun `GRANT` (li fa `db-ruoli.sh`), nessun `ALTER` di tabelle esistenti.
- [ ] **Step 5:** `prisma-rls.extension.ts` (4 modelli), catalogo a 48, README con l'elenco
  aggiornato, `ruoliDellaDitta` con `client.cliente.findMany` e `...dei('CLIENTE', clienti)`.
- [ ] **Step 6: `ops/README.md`**: paragrafo "**Clienti e contratti cliente** (Fase 4 pezzo 1,
  tabelle `condizioni_pagamento`, `clienti`, `contratti_cliente`, `periodi_fatturazione_cliente`)":
  rollback del codice **innocuo** (il codice vecchio ignora le tabelle; la sede predefinita di un
  cliente torna disattivabile finché il codice nuovo non rientra); prima di un ripristino dello schema
  `SELECT tenant_id, count(*) FROM clienti GROUP BY 1` e lo stesso per `contratti_cliente`: se non sono
  vuote i dati si perdono, esportarli prima; rimando al commento della migration.
- [ ] **Step 7: verifiche** dei Vincoli globali (generate, validate, deploy + `db-ruoli.sh`,
  `migrate diff` vuoto), spec del Step 1 PASS, `rls-catalogo` a 48, `registry-ditte.postgres.spec.ts`
  verde, suite di fine task backend.
- [ ] **Step 8: commit**
  `git commit -m "feat(clienti): tabelle di condizioni di pagamento, clienti, contratti cliente e periodi con RLS" -- <file del task>`

## Task 6: servizio e API delle condizioni di pagamento

**File:**
- Create: `apps/backend/src/application/clienti/condizioni-pagamento.service.ts`
- Create: `apps/backend/src/application/clienti/condizioni-pagamento.service.spec.ts`
- Create: `apps/backend/src/application/clienti/condizioni-pagamento.service.postgres.spec.ts`
- Create: `apps/backend/src/api/clienti/dto/condizione-pagamento.dto.ts`
- Create: `apps/backend/src/api/clienti/condizioni-pagamento.controller.ts`
- Create: `apps/backend/src/api/clienti/condizioni-pagamento.controller.spec.ts`
- Create: `apps/backend/src/api/clienti/clienti.module.ts` (provider e controller di questo task; i Task 8-11 aggiungono i loro)
- Modify: `apps/backend/src/app.module.ts` (import di `ClientiModule`)

**Interfaces (Produces):**
```ts
export interface CondizioneVista extends DatiCondizionePagamento { id: string; attiva: boolean; versione: number; descrizioneRate: string; eliminabile: boolean }
list(tenantId: string, incluseDisattivate: boolean): Promise<CondizioneVista[]>
getById(tenantId: string, id: string): Promise<CondizioneVista>
crea(tenantId: string, utenteId: string, dati: DatiCondizionePagamento): Promise<CondizioneVista>
modifica(tenantId: string, utenteId: string, id: string, m: Partial<DatiCondizionePagamento> & { attiva?: boolean; versione: number }): Promise<CondizioneVista>
elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
```
`eliminabile` = nessun cliente e nessun contratto la cita (conteggio nella vista). Errori: D13, D14.

- [ ] **Step 1: test unitari che falliscono** (Prisma finto con `$transaction`, `updateMany`,
  `activityLog.create`): crea con dati non validi → 400 `CONDIZIONE_PAGAMENTO_NON_VALIDA` (array);
  crea con P2002 → 409 codice duplicato; modifica con versione diversa → 409 senza `updateMany`;
  `updateMany` count 0 → 409; nessuna modifica → nessuna scrittura; disattivazione → audit
  `CONDIZIONE_PAGAMENTO_MODIFICATA` con `campi ['attiva']`; elimina in uso (P2003) → 409 in uso;
  `list` senza disattivate per default.
- [ ] **Step 2: DTO e controller** (test che falliscono): `class CreaCondizionePagamentoDto`
  (`codice`, `descrizione`, `modalita` `@IsIn`, `giorniRate` `@IsArray @IsInt({each}) @ArrayMinSize(1)
  @ArrayMaxSize(8)`, `fineMese`), `ModificaCondizionePagamentoDto = PartialType(...)` + `attiva?` +
  `versione` `@IsInt @Min(1)`; controller con le rotte di D17, `@Roles` letture/scritture, test dei
  metadata con `Reflector`, `senza azienda determinabile: 403`, utente da `req.user.id`.
- [ ] **Step 3: test Postgres**: `crea, modifica, disattiva: versione 3 e due righe di audit`; `due
  modifiche concorrenti: una 409`; `in uso da un cliente: elimina 409, la riga resta`;
  `nel contesto di B: 404`.
- [ ] **Step 4: implementare**; registrare il modulo.
- [ ] **Step 5:** PASS (unitari, Postgres con guardia), suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): anagrafica delle condizioni di pagamento" -- <file del task>`

## Task 7: servizio dei clienti — creazione e letture

**File:**
- Create: `apps/backend/src/application/clienti/clienti.service.ts`
- Create: `apps/backend/src/application/clienti/clienti.service.spec.ts`
- Create: `apps/backend/src/application/clienti/clienti.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
export interface ClienteVista extends DatiFiscaliCliente {
  id: string; versione: number; attivo: boolean
  ditta: { id: string; ragioneSociale: string; partitaIva: string | null; codiceFiscale: string | null; privato: boolean }
  sedeFatturazione: SedeDto
  condizionePagamento: { id: string; codice: string; descrizione: string } | null
  contratti: number              // contratti non eliminati
  eliminabile: boolean           // nessun contratto, nemmeno eliminato
}
export interface DatiCreazioneCliente extends DatiRisoluzioneRuolo, Partial<DatiFiscaliCliente> { sedeId?: string }
crea(tenantId: string, utenteId: string, d: DatiCreazioneCliente): Promise<{ cliente: ClienteVista; dittaEsistente: boolean; avvisi: string[] }>
list(tenantId: string, f: { testo?: string; soloAttivi?: boolean; pagina: number; dimensione: number }): Promise<{ elementi: ClienteVista[]; totale: number }>
getById(tenantId: string, id: string): Promise<ClienteVista>
attiviPerId(tx, ids: string[]): Promise<Map<string, { id: string; dittaId: string; attivo: boolean; …predefiniti D4 }>>   // per il Task 9
```

- [ ] **Step 1: test unitari che falliscono**: crea chiama `creaRuoloSuDitta` con ruolo `CLIENTE` e
  nome `cliente`; dati fiscali non validi → 400 `CLIENTE_NON_VALIDO` **prima** di aprire la
  transazione; privato senza nome/cognome → 400; condizione disattivata → 400; `sedeId` indicato:
  usato come sede di fatturazione se è attiva della ditta risolta, altrimenti
  `SedeNonValidaPerRuoloError('cliente')`; P2002 su `codice` → 409 `CLIENTE_CODICE_DUPLICATO`;
  ruolo già presente → 400 "Esiste già un cliente per questa ditta"; audit `CLIENTE_CREATO` con
  metadata `{ clienteId, dittaId, dittaEsistente }` e nient'altro.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** `crea` valida i dati fiscali con `privato` calcolato
  dall'identificativo della richiesta (e ricontrolla dopo la risoluzione se la ditta esistente è un
  privato), poi `creaRuoloSuDitta` con `inserisci` che crea la riga `clienti` e l'audit nello stesso
  `tx`. `list`: ricerca `testo` (≥ 2 caratteri) case-insensitive su ragione sociale della ditta,
  `codice`, P.IVA (mai sul CF: è un dato personale e non va in query string), ordinamento per ragione
  sociale, `count` nella stessa transazione. `getById` 404 "Cliente non trovato". Log con id soltanto.
- [ ] **Step 4: test Postgres** (ruolo app): `crea un cliente su una ditta nuova: ditta, sede
  principale e cliente`; `crea un cliente su una ditta già produttore: dittaEsistente true, stessa
  ditta, DittaDto.ruoli con produttoreId e clienteId`; `privato con nome e cognome: creato`;
  `privato senza nome: 400 e nessuna ditta creata` (atomicità); `ricerca per P.IVA e per codice`;
  `paginazione: totale e pagina 2`; `nel contesto di B: lista vuota, getById 404`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): creazione del cliente su ditta e letture" -- <file del task>`

## Task 8: servizio dei clienti — modifica, disattivazione, eliminazione; API dei clienti

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
`sedeId?`), `ModificaClienteDto` (soli dati fiscali, `sedeId`, `attivo`, `versione`; mai
identificativi né indirizzo: `forbidNonWhitelisted` li respinge).

- [ ] **Step 1: test unitari che falliscono** (servizio): versione diversa → 409
  `CLIENTE_MODIFICATO_NEL_FRATTEMPO`; dati non validi → 400; cambio `sedeId` a una sede non attiva
  della ditta → 400; disattivazione → audit `CLIENTE_DISATTIVATO`, riattivazione → `CLIENTE_RIATTIVATO`;
  modifica di IBAN e PEC → audit `CLIENTE_MODIFICATO` con `campi ['iban','pecFatturazione']` e
  **senza** valori; elimina con contratti (P2003) → 409 `CLIENTE_CON_CONTRATTI`; elimina senza →
  `deleteMany` condizionato su `versione`, count 0 → 409; la modifica **non** tocca i contratti (D4).
- [ ] **Step 2: test che falliscono** (DTO e controller): `ModificaClienteDto con partitaIva →
  rifiutato`; `null su iban accettato`; `versione obbligatoria`; `codiceDestinatario di 8 caratteri
  → errore di lunghezza`; rotte di D17 con `@Roles` (metadata), azienda selezionata, utente della
  richiesta, `DELETE ?versione=` numerico, `403 senza azienda`.
- [ ] **Step 3: implementare** (D13, D14, D16).
- [ ] **Step 4: test Postgres**: `modifica concorrente: una 409`; `cliente con un contratto: elimina
  409, ditta e sedi intatte`; `cliente disattivato resta nei contratti esistenti`; `audit senza dati
  personali` (crea un privato con IBAN e PEC, modifica, legge `activity_logs` col proprietario e
  verifica che il JSON di `metadata` e `description` non contenga CF, IBAN, PEC, nome, cognome);
  `la sede predefinita del cliente non si disattiva` (via `DitteService.aggiornaSede`, errore di F2-10).
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(clienti): modifica, disattivazione ed eliminazione del cliente e rotte" -- <file del task>`

## Task 9: servizio dei contratti cliente — creazione, letture, numero

**File:**
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts`
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.spec.ts`
- Create: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
export interface ContrattoClienteVista extends Omit<DatiContrattoCliente, never> {
  id: string; stato: StatoContrattoCliente; versione: number; motivoAnnullo: string | null; annullatoIl: string | null
  cliente: { id: string; ragioneSociale: string; partitaIva: string | null; attivo: boolean }
  clienteFatturazione: { id: string; ragioneSociale: string; partitaIva: string | null } | null
  sede: { id: string; descrizione: string } | null            // "Via X 1, Comune (PR)"
  condizionePagamento: { id: string; codice: string; descrizione: string } | null
  scaduto: boolean; prossimaFinePeriodo: string | null
  modificabili: CampoContrattoCliente[]; transizioni: StatoContrattoCliente[]; eliminabile: boolean; rinnovabile: boolean
}
crea(tenantId: string, utenteId: string, d: Partial<DatiContrattoCliente> & { numero: string; descrizione: string; clienteId: string; dataInizio: string }): Promise<ContrattoClienteVista>
list(tenantId: string, f: { stato?; clienteId?; testo?; inScadenzaEntroGiorni?; pagina; dimensione }): Promise<{ elementi: ContrattoClienteVista[]; totale: number }>
getById(tenantId: string, id: string): Promise<ContrattoClienteVista>
prossimoNumero(tenantId: string): Promise<string>   // CC-<anno>-<NNN>
```

- [ ] **Step 1: test unitari che falliscono**: `crea copia dal cliente condizione, esigibilità,
  bollo, codice destinatario e riferimento se assenti` (D4); `valori del corpo vincono sui
  predefiniti`; `validazione pura prima del database` (400 `CONTRATTO_CLIENTE_NON_VALIDO` array);
  `cliente disattivato → 400`; `cliente di fatturazione inesistente → 400`; `sede di un'altra ditta
  → 400 "La sede scelta non è una sede attiva del cliente."`; `nasce in BOZZA, periodi scritti nella
  stessa transazione con ordine 1..n`; `P2002 sul numero → 409`; `audit CONTRATTO_CLIENTE_CREATO con
  { contrattoId, numero }`; `prossimoNumero conta anche gli eliminati e usa l'anno corrente`;
  `vista: scaduto, prossimaFinePeriodo, modificabili, transizioni, eliminabile, rinnovabile dai
  moduli del Task 3`; `list esclude gli eliminati`; `inScadenzaEntroGiorni filtra fine fra oggi e
  oggi+N`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare.** Lettura dei clienti con `ClientiService.attiviPerId` nella stessa
  transazione; "oggi" dalla data locale `Europe/Rome` in una funzione iniettabile (`OROLOGIO`) per i
  test. Ricerca `testo` su numero, descrizione e ragione sociale del cliente.
- [ ] **Step 4: test Postgres**: `crea con trimestrale: 4 periodi`; `cliente di B nel contesto di A:
  400` (il servizio non lo trova; nessuna riga scritta); `periodi non validi: 400 e nessuna riga
  scritta`; `paginazione e filtri`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): creazione con i predefiniti del cliente e letture" -- <file del task>`

## Task 10: servizio dei contratti cliente — modifica, stato, eliminazione

**File:**
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.spec.ts`
- Modify: `apps/backend/src/application/contratti-cliente/contratti-cliente.service.postgres.spec.ts`

**Interfaces (Produces):**
```ts
modifica(tenantId: string, utenteId: string, id: string, m: ModificaContrattoCliente & { versione: number }): Promise<ContrattoClienteVista>
cambiaStato(tenantId: string, utenteId: string, id: string, a: StatoContrattoCliente, versione: number, motivo?: string | null): Promise<ContrattoClienteVista>
elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void>
```

- [ ] **Step 1: test unitari che falliscono**: ordine dei controlli di D14 (annullato con versione
  sbagliata → "non modificabile", non "modificato nel frattempo"); campi non ammessi in ATTIVO → 409
  `CONTRATTO_CLIENTE_CAMPI_NON_AMMESSI`; nessuna modifica → nessuna scrittura; periodi cambiati →
  `deleteMany` + `createMany` dei periodi **dopo** l'`updateMany` riuscito, nella stessa transazione;
  `updateMany` count 0 → 409 e periodi non toccati; cambio di cliente di fatturazione verso un
  cliente disattivato → 400; `cambiaStato`: transizione non ammessa → 409; BOZZA→ATTIVO senza
  condizione → 400; annullo salva motivo e `annullatoIl`; audit `CONTRATTO_CLIENTE_STATO` con
  `{ da, a }` e **senza** il motivo; `elimina` fuori da BOZZA → 409; elimina con
  `eliminatoIl`/`eliminatoDa` e condizione `stato: 'BOZZA'`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: implementare** (D8, D9, D13, D14, D16).
- [ ] **Step 4: test Postgres**: `due modifiche con la stessa versione: una riesce, l'altra 409 e i
  periodi sono quelli della prima` (`Promise.allSettled`); `modifica letta prima di una sospensione
  riceve 409`; `ATTIVO → SOSPESO_MOVIMENTI → ATTIVO → ANNULLATO: versione 5, motivo salvato`;
  `annullato non si modifica (409) e non cambia stato`; `eliminato: sparisce da list, getById 404,
  modifica 404, cambiaStato 404; la riga resta (lettura owner)`; `nel contesto di B: 404 su tutto`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): modifica con lock ottimistico, stati ed eliminazione" -- <file del task>`

## Task 11: rinnovo e proroga delle scadenze; API dei contratti cliente

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
prorogaScadenze(tenantId: string, utenteId: string, f: { scadutiEntro: string; soloRinnovoAutomatico: boolean; ancheSospesi: boolean; clienteId?: string }): Promise<{ prorogati: number }>
```
DTO: `CreaContrattoClienteDto` (date `@IsISO8601({ strict: true })` giorno, periodi
`@ValidateNested({ each: true }) @ArrayMaxSize(12)` con `PeriodoDto` `@IsInt @Min @Max`, `stato`
**non** ammesso), `ModificaContrattoClienteDto` (`PartialType` di crea + `versione`),
`CambiaStatoContrattoClienteDto` (`stato` `@IsIn`, `versione`, `motivo?` ≤ 255), `RinnovaDto`
(`versione`), `ProrogaScadenzeDto`.

- [ ] **Step 1: test unitari che falliscono**: `rinnova` non rinnovabile → 409
  `CONTRATTO_CLIENTE_NON_RINNOVABILE`; rinnova sposta la fine con `dataPiuUnAnno`, versione +1, audit
  `CONTRATTO_CLIENTE_RINNOVATO` con prima/dopo della data; `prorogaScadenze` esegue **un**
  `$executeRaw` con `tenant_id`, `eliminato_il IS NULL`, stati filtrati, `data_fine <= scadutiEntro`
  e `rinnovo_automatico` se richiesto, e un audit `CONTRATTO_CLIENTE_PROROGATI` con `{ prorogati,
  filtri }`; zero prorogati → nessun audit.
- [ ] **Step 2: test che falliscono** (DTO e controller): `stato nel corpo di crea → rifiutato`;
  `data '2026-02-30' → errore`; `13 periodi → errore`; `prossimo-numero e proroga-scadenze dichiarate
  prima di :id` (ordine dei metodi nella classe, come 4.0); `@Roles` di D17 su ogni metodo
  (metadata); azienda selezionata; `403 senza azienda`.
- [ ] **Step 3: implementare.** SQL della proroga:
  `UPDATE contratti_cliente SET data_fine = (data_fine + interval '1 year')::date, versione = versione + 1, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND eliminato_il IS NULL AND data_fine IS NOT NULL AND data_fine <= ${scadutiEntro}::date AND stato IN (…) [AND rinnovo_automatico] [AND cliente_id = …]`
  (template di `Prisma.sql`, mai concatenazione), in `prisma.$transaction` col contesto azienda.
  Postgres porta il 29/02 al 28/02 da sé.
- [ ] **Step 4: test Postgres**: `proroga: 29/02/2024 diventa 28/02/2025`; `sospesi esclusi senza
  ancheSospesi, inclusi con`; `solo rinnovo automatico per default`; `bozze, annullati ed eliminati
  mai prorogati`; `contratti di B non toccati` (conteggio e lettura owner); `rinnova concorrente con
  una modifica: una 409`.
- [ ] **Step 5:** PASS, suite di fine task backend.
- [ ] **Step 6: commit**
  `git commit -m "feat(contratti-cliente): rinnovo, proroga delle scadenze e rotte" -- <file del task>`

## Task 12: frontend — servizi, ruolo cliente, condizioni di pagamento

**File:**
- Create: `apps/frontend/src/app/features/clienti/clienti.service.ts`
- Create: `apps/frontend/src/app/features/clienti/clienti.service.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/condizioni-pagamento.component.ts`
- Create: `apps/frontend/src/app/features/clienti/condizioni-pagamento.component.spec.ts`
- Modify: `apps/frontend/src/app/features/registry/anagrafica-form-dialog.component.ts` (`TipoAnagrafica` con `'cliente'`)
- Modify: `apps/frontend/src/app/features/registry/ditta-identificativi.component.ts` (`ETICHETTA_RUOLO.cliente`)
- Modify: `apps/frontend/src/app/features/registry/identificativo-fiscale.ts` (privato ammesso per `cliente`, messaggio di D18) e il suo spec
- Modify: `apps/frontend/src/app/shared/models/registry.model.ts` (`ruoli.clienteId`)
- Modify: `apps/frontend/src/app/app.routes.ts` (`clienti/condizioni-pagamento`)

**Interfaces (Produces):** tipi `Cliente`, `CondizionePagamento`, `ContrattoCliente`,
`PeriodoFatturazione`, `StatoContrattoCliente`, `Pagina<T> = { elementi: T[]; totale: number }`;
`ClientiService` con `condizioni.list/get/crea/modifica/elimina`, `clienti.list/get/crea/modifica/elimina`,
`contratti.list/get/prossimoNumero/crea/modifica/cambiaStato/rinnova/proroga/elimina` (rotte di D17).
Etichette in `fe/features/clienti/vocabolario-clienti.ts`: modalità di pagamento, esigibilità
(Immediata, Differita, Split payment), stati (D8), frequenze.

- [ ] **Step 1: test che falliscono.** Servizio (`HttpTestingController`): un test per rotta (metodo,
  URL, corpo, `params` di `DELETE ?versione=` e degli elenchi paginati). `identificativo-fiscale`:
  `privato con tipo cliente: nessun errore`; `con tipo trasportatore: il messaggio nuovo`.
  Componente condizioni: `elenco con codice, descrizione, modalità e rate descritte`;
  `"Nuova condizione" apre il dialog vuoto`; `salva manda giorniRate come numeri ordinati`;
  `409 CONDIZIONE_PAGAMENTO_IN_USO: toast col messaggio e la riga resta`; `Elimina visibile solo se
  eliminabile`; `Disattiva/Riattiva manda attiva e versione`.
- [ ] **Step 2: implementare.** Pagina standalone PrimeNG (tabella + dialog), messaggi da
  `error.error.message` (stringa o array), mai id. Rate inserite come chip numerici.
- [ ] **Step 3:** Karma completo (una volta), `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): servizio frontend, ruolo cliente e pagina delle condizioni di pagamento" -- <file del task>`

## Task 13: frontend — elenco e dialog dei clienti

**File:**
- Create: `apps/frontend/src/app/features/clienti/clienti-list.component.ts`
- Create: `apps/frontend/src/app/features/clienti/clienti-list.component.spec.ts`
- Create: `apps/frontend/src/app/features/clienti/cliente-dialog.component.ts`
- Create: `apps/frontend/src/app/features/clienti/cliente-dialog.component.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (`clienti`)
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (voce "Clienti", D20)

**Interfaces (Produces):** `ClienteDialogComponent` con `@Input() visible`, `@Input() cliente:
Cliente | null` (null = nuovo), `@Output() salvato = new EventEmitter<Cliente>()` (riusato dal dialog
del contratto, Task 14); `ClientiListComponent`.

- [ ] **Step 1: test che falliscono.** Dialog:
  - `nuovo: usa app-ditta-identificativi con tipo "cliente"; ditta trovata → ragione sociale
    bloccata, scelta della sede`;
  - `privato (solo CF): compaiono nome e cognome, obbligatori`;
  - `codice destinatario: la PEC si abilita solo con 0000000 o vuoto`; `riferimento amministrazione
    disabilitato senza codice`;
  - `IBAN con spazi accettato` (la validazione resta al backend; il frontend mostra i messaggi);
  - `condizione di pagamento da un select delle sole attive`;
  - `modifica: identificativi e indirizzo in sola lettura, link "Sedi" che apre app-sedi-ditta-dialog`;
  - `salva in modifica manda solo i campi cambiati più versione`; `nessun cambiamento: nessuna
    chiamata e avviso "Nessuna modifica da salvare"`;
  - `400 CLIENTE_NON_VALIDO: messaggi del backend, dialog aperto`; `409 MODIFICATO_NEL_FRATTEMPO:
    toast ed emette salvato per ricaricare`; `risposta con avvisi (ditta esistente): toast informativo`.
  Lista: `colonne ragione sociale, P.IVA o CF, codice, codice destinatario, condizione, contratti,
  stato attivo`; `ricerca con debounce chiama list con testo e pagina 1`; `paginazione lazy`;
  `Disattiva con conferma manda attivo false e versione`; `Elimina solo se eliminabile, con conferma
  "Eliminare il cliente <ragione sociale>? La ditta e le sedi restano."`; `409 CLIENTE_CON_CONTRATTI:
  toast e ricarica`; `pulsante "Condizioni di pagamento" porta a /clienti/condizioni-pagamento`;
  `apriModifica rilegge il cliente prima di aprire il dialog`.
- [ ] **Step 2: implementare.** Dialog di modifica che rilegge (come 4.0); `ConfirmationService` nei
  `providers`; azioni con `ariaLabel` che cita la ragione sociale; scritture nascoste se il ruolo
  effettivo è VIEWER (`registry-permissions.ts` o il servizio dei permessi usato dalle liste del
  registry).
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(clienti): elenco e dialog dei clienti" -- <file del task>`

## Task 14: frontend — contratti cliente

**File:**
- Create: `apps/frontend/src/app/features/contratti-cliente/contratti-cliente-list.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratti-cliente-list.component.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratto-cliente-dialog.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/contratto-cliente-dialog.component.spec.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/periodi-fatturazione.component.ts`
- Create: `apps/frontend/src/app/features/contratti-cliente/periodi-fatturazione.component.spec.ts`
- Modify: `apps/frontend/src/app/app.routes.ts` (`contratti-clienti`)
- Modify: `apps/frontend/src/app/shared/components/layout.component.ts` (voce "Contratti clienti", D20)

**Interfaces (Produces):** `PeriodiFatturazioneComponent` (`@Input() periodi`, `@Input() disabled`,
`@Output() periodiChange`; pulsanti "Mensile", "Trimestrale", … che generano i periodi come
`periodiDaFrequenza` del backend, tabella modificabile gg/mm, max 12); dialog del contratto con
`@Input() contratto: ContrattoCliente | null`, `@Output() salvato`; lista.

- [ ] **Step 1: test che falliscono.** Periodi: `Trimestrale genera i 4 periodi di D10`; `aggiungi
  e rimuovi riga, al massimo 12`; `disabled blocca tutto`. Dialog:
  - `nuovo: numero proposto da prossimoNumero, stato Bozza`;
  - `scelta del cliente con autocomplete (list con testo, soloAttivi)`; `scelto il cliente, i campi
    condizione, esigibilità, bollo, codice destinatario si precompilano dai suoi valori` (D4, solo
    se l'operatore non li ha toccati);
  - `"Nuovo cliente" apre app-cliente-dialog e il cliente salvato finisce nel campo` (D20);
  - `cliente di fatturazione: stesso autocomplete, escluso il cliente del contratto`;
  - `sede di servizio: select delle sedi attive della ditta del cliente`;
  - `CIG o CUP valorizzati: il documento PA diventa obbligatorio (indicatore), la regola resta al backend`;
  - `contratto attivo: numero, cliente e data di inizio disabilitati` (da `modificabili`);
  - `salva in modifica manda solo i campi cambiati, periodi come elenco intero, più versione`;
  - `409 e 400 come il dialog del cliente`.
  Lista:
  - `colonne numero, cliente, descrizione, stato (tag), inizio, fine con badge "Scaduto",
    prossima fatturazione`; `filtri stato, cliente, testo, "in scadenza entro 30 giorni"`;
  - `azioni di stato dalle transizioni della vista: Attiva, Sospendi, Sospendi solo movimenti,
    Riattiva, Annulla`; `Annulla chiede il motivo (obbligatorio) e manda motivo e versione`;
  - `Rinnova visibile se rinnovabile, con conferma che mostra la nuova data di fine`;
  - `"Proroga scadenze" apre un dialog con data, "solo con rinnovo automatico" (spuntato), "anche
    sospesi", cliente facoltativo; al termine toast "Contratti prorogati: N" e ricarica`;
  - `Elimina solo se eliminabile`; `dopo un 409 la lista si ricarica`.
- [ ] **Step 2: implementare.** Scritture nascoste per VIEWER come nel Task 13. Date come
  `YYYY-MM-DD` verso il backend (niente `toISOString` di una data locale).
- [ ] **Step 3:** Karma completo, `npm run build`, eslint dei file toccati.
- [ ] **Step 4: commit**
  `git commit -m "feat(contratti-cliente): elenco, dialog, periodi di fatturazione e proroga" -- <file del task>`

## Task 15: e2e, chiusura e verifica finale

**File:**
- Create: `e2e/tests/contratti-cliente/contratto-cliente.spec.ts` (modello: uno spec di
  `e2e/tests/registry/`, fixture di `e2e/fixtures/`, regole di pulizia di `e2e/README.md`)

- [ ] **Step 1: spec e2e** (eseguito **solo in CI**, non in locale per la RAM): crea una condizione
  di pagamento, un cliente su ditta nuova, un contratto trimestrale; lo attiva; lo sospende solo nei
  movimenti; lo rinnova; prova a modificare il cliente del contratto attivo (campo disabilitato);
  annulla con motivo; verifica che un utente VIEWER veda l'elenco senza pulsanti di scrittura.
  Selettori per ruolo/etichetta (vedi `e2e/SELECTORS-DEBT.md`). In locale solo
  `npx tsc -p e2e/tsconfig.json --noEmit`.
- [ ] **Step 2:** dalla radice, `git diff --stat dafa30b..HEAD`: solo i file elencati nei Task 1-15
  (nessuna area esclusa toccata, D18 per le mirate).
- [ ] **Step 3:** backend completo: `test:cov`, `tsc`, eslint globale backend 0 errori,
  `npm run test:postgres` intera (guardia 55438) confrontata con la linea di base del Task 0.
- [ ] **Step 4:** frontend: Karma completo, `npm run build`, eslint
  `npx eslint "apps/frontend/src/app/features/{clienti,contratti-cliente,registry}/**/*.ts" --max-warnings=-1`.
- [ ] **Step 5:** `migrate diff` vuoto un'ultima volta; `rls-catalogo` a 48.
- [ ] **Step 6: commit**
  `git commit -m "test(e2e): contratto cliente dalla condizione di pagamento all'annullo" -- e2e/tests/contratti-cliente/contratto-cliente.spec.ts`
- [ ] **Step 7: rapporto** all'orchestratore: commit, test rossi preesistenti, le risposte applicate
  a Q1-Q6, la nota di rollback, la prova manuale consigliata dopo il merge (condizione 30-60 fm,
  cliente privato con CF, contratto PA con codice ufficio e CIG, periodi trimestrali e colonna
  "prossima fatturazione", sospensione solo movimenti, rinnovo di un contratto con fine 29/02,
  proroga massiva, due schede sullo stesso contratto → 409, cliente con contratti non eliminabile).

## Ordine

Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15, uno alla volta. 1, 2 e 3
sono puri e indipendenti dal database ma restano in sequenza (un solo jest acceso). 4 prima di 5
perché il repository del Task 5 usa il tipo `CLIENTE`. 6 prima di 7 (il cliente valida la
condizione). 9-11 hanno bisogno dei clienti (7-8). 12-14 hanno bisogno di tutte le rotte; 14 riusa
il dialog del 13.

## Fuori ambito (seguiti)

- **Listino** (`ELENCHIADDEB`, `ADDEBCON`, famiglie di addebito, prezzi, scaglioni): **4.2**. Il
  contratto cliente non ha prezzi né CER in questo pezzo.
- **Legame movimento → cliente, contratto, riga e "fatturato"** (`MOVIMENTI.CLIE/CONT/GRUPPADD/FOGLIO/NFATT`),
  proposta del contratto in registrazione e nel FIR: **4.3**. Nessuna colonna su `WasteMovement` o
  `FIR`.
- **Valorizzazione, numerazione delle fatture, XML FatturaPA, uso di `periodoDaFatturare`,
  `calcolaScadenze`, `destinatarioEffettivo`, bollo, split**: **4.4**; profilo del cedente con IBAN
  del gestore (Q6): 4.4/4.5; emissione SDI: 4.5.
- **Import di clienti, contratti e listini da WinWaste** (`CLIFOR`, `CONTRATTI`, codici d'origine):
  Fase 3 (3.3 per le anagrafiche, **3.8** per contratti e listini, dopo 4.1-4.3).
- Contratti **fornitori** (`CONTRATTIFOR`) e **temporanei** come tabella a parte con
  `COPIADEFINITIVA` e numerazione `PREV` (la bozza ne copre l'uso, Q3).
- Regole per installazione `ControlloRegole` 01/09/11, numerazione controllata, contratto 500 e
  funzioni NICA (E17).
- Agente, provvigioni, ritenuta d'acconto, spese bancarie, registro IVA, testi di fatturazione,
  allegati PDF, soglia massima, incremento ISTAT e "Modifica automatica prezzi", categoria e tipo di
  contratto, commessa, dichiarazione d'intento, IVA per cassa, giorno valuta e mesi esclusi del
  pagamento, black list, zona (Q1, Q2).
- Job automatico di rinnovo e avvisi di scadenza dei contratti cliente nel `deadline-checker` (Q5).
- Statistiche e stampe dei contratti (`STAMPCONTR`, `StatisticheContratti…`).
- Collegamento del contratto produttore (`Contract`) al contratto cliente: modelli separati (D1).
