# R4 Task 1 — L'oracolo impara a rispondere «codifiche» e «anagrafiche»

Data: 2026-07-26. Worktree: `C:\Progetti\rifiuti-r4`, branch `feat/rentri/r4-codifiche`.

## Cosa è stato fatto

Estesa la fake `tools/rentri-fake/` con due nuovi servizi, seguendo esattamente le
convenzioni già in uso (`formulari.ts`/`transazioni.ts`): `ProblemDetails` su
`application/problem+json`, autenticazione JWT ID_AUTH_REST_02 con rifiuto
403 (mai 401) su credenziale assente/non valida, guasto iniettabile dal
canale di controllo applicato via hook globale.

### File nuovi

- `src/stato/fixture-codifiche.ts` — cataloghi statici delle 25 tabelle di
  `codifiche.yaml`, con termini di dominio reali (codici EER/CER veri con
  un caso pericoloso `130208*` e uno non pericoloso `150101`, classi ADR,
  stati fisici standard dei formulari italiani, HP del Reg. UE 1357/2014,
  categorie RAEE, enum `Attivita`/`TipiAutorizzazione` presi testualmente
  dal contratto anagrafiche, un caso di fusione comunale reale — San Piero
  a Sieve → Scarperia e San Piero, 2014 — con `attivo=false`, `nuovo-id`,
  `fine-validita` valorizzati).
- `src/stato/fixture-anagrafiche.ts` — un operatore (`num_iscr`, CF, P.IVA),
  un soggetto delegato, due unità locali (sede legale Milano + deposito
  Roma, comuni ISTAT reali), un'autorizzazione di tipo `RecProcSemplificata`.
- `src/routes/codifiche.ts` — 25 rotte `GET` sotto `/codifiche/v1.0`.
- `src/routes/anagrafiche.ts` — 12 rotte `GET` in sola lettura sotto
  `/anagrafiche/v1.0` (Operatore + Soggetto delegato).
- `test/aiuti/token.ts` — helper condiviso `tokenValido()`/`intestazioniAutenticate()`,
  estratto dal pattern duplicato in `formulari.test.ts`/`controllo.test.ts`.
- `test/codifiche.test.ts` (13 test), `test/anagrafiche.test.ts` (15 test).

### File modificati

- `src/stato/archivio.ts` — metodi di accesso alle fixture (nessuna
  scrittura: il servizio `codifiche` non ha alcuna rotta di aggiornamento
  nel contratto).
- `src/app.ts` — registrazione delle due nuove rotte.

## Copertura dei contratti

**`codifiche.yaml`: 25/25 path implementati, 0 non implementati.**
Tutti `GET`, tutti sotto `/lookup/*` + `/status`. `codici-eer` applica i
filtri `pericoloso`/`escludi00` dichiarati dal contratto; `comuni`/`comuni/{provincia_id}`
rispettano la semantica `attivo`/`nuovo-id`/`fine-validita` (con filtro
`attivi`, default true, sul path per provincia).

**`anagrafiche.yaml`: 12/23 path implementati, 11 non implementati per scelta di ambito.**
Implementati (tutti `GET`, sola lettura, tag `Operatore`/`Soggetto delegato`):
`/operatore`, `/operatore/{id}/controllo-iscrizione`,
`/operatore/{id}/controllo-autorizzazione-albo`,
`/operatore/{id}/siti/{comune_id}/controllo-autorizzazioni`,
`/operatore/{num_iscr}/autorizzazione-albo`, `/operatore/{num_iscr}/siti`,
`/operatore/{num_iscr}/siti/{num_iscr_sito}`,
`/operatore/{num_iscr}/siti/{num_iscr_sito}/autorizzazioni`,
`/soggetto-delegato`, `/soggetto-delegato/{num_iscr_ass}/siti`,
`/soggetto-delegato/{num_iscr_ass}/siti/{num_iscr_sito}`, `/status`.

Non implementati (11 path, tutti sotto `/registri`, `/operatore/registri`,
`/soggetto-delegato/registri` — inclusa la variante di sola lettura
`/operatore/{num_iscr}/siti/{num_iscr_sito}/registri` e
`/soggetto-delegato/{num_iscr_ass}/registri`): **fuori ambito per design del
programma**, non solo per il piano R4 — i registri cronologici sono
esplicitamente esclusi (`docs/superpowers/specs/2026-07-26-area-rentri-design.md`
§3.4, API registri non pubblicata), quindi non è stata implementata nemmeno
la sola lettura, coerentemente con l'istruzione di non toccare `/registri`.

## Autenticazione

Verificato che un chiamante senza JWT valido riceve **403** (mai 200, mai
401) su entrambi i nuovi servizi: test espliciti su `codifiche` (`/lookup/codici-eer`,
`/lookup/adr-classi`) e `anagrafiche` (`/operatore/{num_iscr}/siti`). `/status`
di entrambi i servizi non richiede autenticazione, simmetrico a quanto già
fatto per `formulari.yaml` (nessun 403 dichiarato su quel path).

## Guasti iniettati

429 (con `Retry-After`) e 423 verificati su entrambi i servizi tramite il
canale `/__controllo/guasto` esistente — nessuna modifica necessaria
all'hook globale in `app.ts`, che già esclude solo `/__controllo` e
`/__salute`.

## Suite della fake

Prima: 9 suite. Dopo: **11 suite / 88 test, tutti verdi** (`npm test` in
`tools/rentri-fake`, tipizzazione TypeScript pulita, formattato con
prettier del repo). Nessuna regressione sulle 9 suite preesistenti.

## Non fatto in questo task (rimandato ai task successivi del piano)

- Nessun client applicativo (`RentriAnagraficheClient`/`RentriCodificheClient`) —
  è Task 3/4 del piano.
- Nessuna migrazione Prisma, nessun modello dati (`RentriSito`, estensione
  `CERCode`) — Task 2/4/5.
- Nessuna scrittura sui `/registri` — esplicitamente fuori ambito.
