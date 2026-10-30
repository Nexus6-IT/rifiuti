# Fase 2 pezzo 6: deposito temporaneo corretto, per registro — piano di implementazione

> **Per chi esegue:** `superpowers:subagent-driven-development`. Sonnet implementa un task
> alla volta, opus rivede ogni task prima del successivo. Ordine STRETTAMENTE SEQUENZIALE
> (un solo worktree, un solo database di test `127.0.0.1:55432`, commit condivisi):
> Task 0 → 1 → 2 → 3 → 4 → 5a-1 → 5a-2 → 5b → 6 → 7a → 7b → 8. Il parallelismo c'è già
> fra questo branch e quello di F2-10 (vedi I1). Motivo del "niente parallelo interno": la
> workstation ha 16 GB e due agenti con jest + tsc + Karma insieme la saturano; i soli task
> con file davvero disgiunti (1, 2, 6) sono anche i più corti, e il guadagno non vale il
> rischio di commit incrociati.
> Piano rivisto da opus il 2026-10-28 (I1-I7 e M1-M13 recepiti).

**Obiettivo.** L'età del deposito temporaneo è quella del **lotto residuo più vecchio**
(FIFO calcolato in lettura, senza persistenza), **per registro** (= per sede, = luogo di
produzione) e per CER; i limiti di legge sono applicati come la norma li scrive (criterio
temporale di **tre mesi di calendario** **oppure** quantitativo, a scelta del produttore; il
quantitativo è **complessivo** del deposito, non per CER); le soglie sono configurabili per
azienda e, facoltativamente, per registro; preavvisi ispirati a WinWaste; **solo avvisi, mai
blocchi**. Le anomalie di giacenza impossibile si calcolano per registro. Nessun movimento
viene riscritto; RENTRI e MUD non cambiano.

**Fonti.**
- Roadmap `C:\Progetti\winwaste\docs\roadmap-fase2-parita-registro.md` §F2-6 (FIFO puro in
  lettura riusato da 4.6, soglie per azienda e sede, `registroId` nel `groupBy` delle
  anomalie, tabella `soglie_deposito_temporaneo` con valori predefiniti attuali, "meno
  allarmi falsi: va comunicato", magazzino fuori ambito) e §3 (regole RLS 1-3, 8; tabella
  F2-6 `tenant_id` NOT NULL).
- `C:\Progetti\winwaste\docs\roadmap-fasi3-4-import-gestori.md` §5, 4.6: l'abbinamento
  "riusa la funzione pura di FIFO calcolato in lettura di F2-6 come proposta"; WinWaste
  ordina G (giacenze iniziali) → P (anno precedente) → C (anno) per data (`giacenze.md`
  §3.1 punto 4, §3.2) e abbina a righe (scarico, carico, quantità).
- WinWaste `C:\Progetti\winwaste\docs\giacenze.md` §2.4 (`C4`: [0] tempo massimo gg, [1]
  carico massimo kg, [3] preavviso giacenza **in kg**, [4] preavviso tempo **in giorni
  d'età**; `[DETTAGLI MAGAZZINI]` per CER) e §5.2 (tutti i limiti in kg, i m³ mai
  controllati; i limiti per CER solo nella pianificazione; **nessun controllo blocca**; i
  limiti di legge non sono codificati, li inserisce l'utente).
- Normativa: art. 185-bis D.Lgs 152/2006 (introdotto dal D.Lgs 116/2020; definizione all'art.
  183 c. 1 lett. bb). Testo verificato su Brocardi (aggiornamento 07/10/2026,
  https://brocardi.it/codice-dell-ambiente/parte-quarta/titolo-i/capo-i/art185bis.html) e
  sulla scheda della CCIAA di Firenze
  (https://www.fi.camcom.gov.it/sites/default/files/uploads/Amministrazione_trasparente/DEPOSITO%20TEMPORANEO%20focus.pdf).
  Comma 2 lett. b): i rifiuti sono raccolti ed avviati a recupero o smaltimento "secondo una
  delle seguenti modalità alternative, a scelta del produttore": "con cadenza almeno
  trimestrale, indipendentemente dalle quantità in deposito"; "quando il quantitativo di
  rifiuti in deposito raggiunga complessivamente i 30 metri cubi di cui al massimo 10 metri
  cubi di rifiuti pericolosi". "In ogni caso, allorché il quantitativo di rifiuti non superi il
  predetto limite all'anno, il deposito temporaneo non può avere durata superiore ad un
  anno". Comma 1: luogo di produzione = "l'intera area in cui si svolge l'attività che ha
  determinato la produzione dei rifiuti" (lett. b modificata dalla L. 182/2025, non tocca i
  limiti). Comma 3: nessuna autorizzazione. Il codice di oggi cita solo "D.Lgs 152/2006"
  (`deposito-temporaneo.config.ts:2`), non l'articolo.
- Piani modello: `2026-10-28-fase2-5-causali.md`, `2026-10-27-fase2-3-rettifica-annullamento.md`.

## Stato di partenza (branch `feat/fase2-6-deposito` = master `4db1b4a`, verificato)

Percorsi relativi a `apps/backend/` salvo indicazione; `fe/` = `apps/frontend/src/app/`.

**Backend.**
- `src/application/giacenze/deposito-temporaneo.config.ts:14-24`: `DepositoTemporaneoConfig
  { maxDurationDays, maxQuantityKg }`, `DEFAULT_DEPOSITO_TEMPORANEO = { 90, 30000 }`,
  costante nel codice; il commento (`:4-12`) dice già che il kg è un "proxy" del limite
  volumetrico. Nessuna tabella, nessuna configurazione per azienda.
- `src/application/giacenze/giacenze.service.ts`:
  - `getGiacenze(tenantId, registroId?)` `:85-204`: somme con `groupBy ['cerCode','type','unit']`
    + `WHERE_VIGENTE` (`:87-91`); **età sbagliata (G6)**: `oldestCarico` = `_min.movementDate`
    di **tutti** i carichi vigenti del CER (`:93-105`), più le date delle aperture se più
    vecchie (`:156-160`). Il commento `:44-48` rimanda esplicitamente "il calcolo esatto del
    deposito" a F2-6. Senza `registroId` somma tutti i registri (`:81-84`), e il minimo è
    anche fra registri.
  - `getDepositoTemporaneoAlerts(tenantId, config = DEFAULT, now, registroId?)` `:264-304`:
    per CER con `giacenzaKg > 0`, `DURATION` se `floor((now - oldest)/giorno) > 90`,
    `QUANTITY` se `giacenzaKg > 30000` **per singolo CER** (la norma dice "complessivamente").
    Solo famiglia di massa (un CER con soli m³ residui non è mai valutato); nessun preavviso;
    nessuna distinzione pericolosi; nessun limite annuale; giorni calcolati in ms UTC (non
    giorno italiano) e 90 giorni fissi invece di tre mesi.
  - `PrismaService` = re-export unico (`src/infrastructure/database/prisma.service.ts:1-6`).
- `src/application/giacenze/giacenze.controller.ts` (44 righe, riverificate): `GET
  /giacenze` `:18-25`, `GET /giacenze/deposito-temporaneo/alerts` `:27-43`, entrambi con
  `GiacenzeQueryDto { registroId?: UUID }` (`giacenze-query.dto.ts:4-13`),
  `requireRequestTenantId(req)`, solo `JwtAuthGuard`; il controller passa `undefined` come
  config (`:37-42`).
- `src/application/giacenze/giacenze.module.ts:12-17`: `imports: [PrismaModule, LoggerModule,
  AuthModule]` (`:13`), **senza `RuoloEffettivoModule`**. `RuoloEffettivoModule` è `@Global`
  (`src/api/me/ruolo-effettivo.module.ts:16-22`) ma il precedente del progetto lo importa
  comunque nel modulo che usa il ruolo effettivo: `src/api/registro/registro.module.ts:41`
  `imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule]` (lo spec del
  modulo, che compila il solo modulo, altrimenti non risolve il servizio).
- **Nessun altro consumatore**: `grep` di `getDepositoTemporaneoAlerts|GiacenzeService|deposito`
  fuori da `application/giacenze` non trova job, notifiche (`application/notifications/*`),
  dashboard (`application/dashboard/*`) né e2e (solo `e2e/SELECTORS-DEBT.md`). Nessun cron
  manda allarmi di deposito.
- Aperture: `src/application/registro/aperture-registro.ts:33-61` `leggiApertureRegistro`
  (con `registroId`, `dataRiferimento` già giorno italiano `YYYY-MM-DD`; nel `select` non
  c'è `id`), `:64-69` `apertureInKg`. Il modello `GiacenzaIniziale` (`@@map("giacenze_iniziali")`)
  ha `id`, `registroId`, `cerCode`, `statoFisico`, `quantita Decimal(10,2)`, `unita`,
  `dataRiferimento @db.Date`.
- Vigenza: `src/domain/waste-movement/vigenza.ts:18-21` `WHERE_VIGENTE` (non annullamento,
  nessuna correzione successiva), `:32-38` `sqlVigente`. La rettifica scrive la data
  corretta (`correggi-movimento.use-case.ts:238` `movementDate: dati.movementDate`),
  l'annullamento copia quella originale (`:365`): la data della testa vigente è la data del lotto.
- Unità: `src/domain/waste-movement/unita-misura-registro.ts:18-31` (`KG`/`T` di massa,
  vuota = KG, ogni altra unità a parte). I carichi manuali sono sempre in kg (piano
  `2026-10-21-fase0-c-integrita-registro-fir.md` decisione 4); m³/litri arrivano da FIR
  ricopiati e dalle aperture (`fe/features/registro/giacenze-iniziali-dialog.component.ts:72-75`
  ammette `M3`).
- Giorno italiano: `src/core/time/anno-italiano.ts:25` `giornoItaliano(istante)`; stessa
  regola SQL in `src/application/registro/giacenza-disponibile.ts:69`.
- CER: `src/domain/waste-movement/cer-registro.ts` `chiaveConfrontoCer`, `cerCanonico`,
  `cerSoloCifre`; "l'asterisco vince" (`giacenze.service.ts:115-126`). Catalogo globale
  `CERCode` (`@@map` `cer_codes`, nessun `tenant_id`) con `code VarChar(10) @unique` e
  `isPericoloso Boolean @map("is_pericoloso")`; il confronto per sole cifre col catalogo è
  già usato da `anomaly-detection.service.ts:92-93` (`cerSoloCifre(c.code)`).
- Anomalie: `src/application/anomaly/anomaly-detection.service.ts:138-203`
  `giacenzeImpossibili(tenantId)`: `groupBy ['cerCode','type','unit']` su **tutto il tenant**
  (`:139-143`) e aperture di tutti i registri (`:167`): un registro a -50 e uno a +100 dello
  stesso CER si compensano e l'anomalia sparisce. `Anomaly` (`:27-34`) non ha `registroId`.
  Unico chiamante: `anomaly.controller.ts:26`.
- Guardia dei lettori di `waste_movements`: `src/application/registro/lettori-movimenti.spec.ts:25-…`
  (`LETTORI`; `giacenze.service.ts` e `anomaly-detection.service.ts` già `vigenti`). Un file
  nuovo che legge i movimenti va aggiunto. Test Postgres dei lettori:
  `src/application/registro/lettori-vigenti.postgres.spec.ts:342-357` (si aspetta
  `oldestCaricoDate = 2026-03-01T10:00:00.000Z` a `:357`: cambierà, D9).
- Test unitari che dipendono dalla semantica di oggi: `giacenze.service.spec.ts:80,109,126,143`
  (alert) e `:281` ("se il carico è più vecchio dell'apertura resta la data del carico").
- Ruoli: `src/api/registro/registro.controller.ts:74` `export const RUOLI_PROGRESSIVO_INIZIALE
  = ['SUPER_ADMIN','ADMIN']` (ADMIN **effettivo** nell'azienda selezionata), controllo con
  `RuoloEffettivoService.ruoloEffettivo(req.user, tenantId)` (`:568-575`), risposta
  `puoImpostare` (`:397-403`). Registri: `src/application/registro/registri.service.ts:208`
  `elenca`, `:276` `risolviInLettura` (accetta anche un registro disattivato dell'azienda,
  altrimenti `RegistroNonTrovatoError`); `RegistroRifiuti.descrizione` sempre valorizzata.
  Audit di riferimento: `giacenze-iniziali.service.ts:557` (`tx.activityLog.create`).
- RLS: `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts:64` `toBe(32)`;
  `README-tenant-transazione.md:120,131` "(32)" (l'elenco di `:131-135` non nomina
  `causali_registro_azienda`: aggiungerlo insieme alla nuova); `TENANT_SCOPED_MODELS` in
  `prisma-rls.extension.ts:47-…` (ultima voce del registro: `CausaleRegistroAzienda`).
  Forma della RLS in migration: `prisma/migrations/20261028100000_giacenze_iniziali/migration.sql`
  sezione 4. Precedente di relazione composta con un solo campo facoltativo:
  `WasteMovement.rettificato` (`fields: [movimentoRettificatoId, registroId, tenantId, type]`,
  relazione `WasteMovement?`). Precedente di indice unico parziale fuori da Prisma:
  `registri_rifiuti_uno_senza_sede_per_tenant` (`20261027100000_registro_per_sede/migration.sql:63`)
  e `causali_registro_azienda_una_aperta` (`20261030100000_causali_registro/migration.sql:190`).
- Ultima migration: `20261030110000_fir_versione`. F2-10 userà `20261031110000_...`.
- `schema.prisma` termina con `CausaleRegistroAzienda` (`:2310-2338`).

**Frontend.**
- `fe/features/giacenze/giacenze.service.ts:37-63`: `getGiacenze()` e
  `getDepositoTemporaneoAlerts()` **senza `registroId`** (quindi alert sommati fra le sedi,
  seguito annotato in STATUS il 26/10), tipi `DepositoTemporaneoAlert { cerCode, giacenzaKg,
  reasons: 'DURATION'|'QUANTITY', durationDays?, oldestCaricoDate? }`.
- `fe/features/giacenze/giacenze.component.ts` (353 righe): nessun selettore di registro,
  nessuna soglia mostrata, card "Alert deposito temporaneo", tabella per CER con "Carico più
  vecchio" resa con `date: 'dd/MM/yyyy'` sul valore ISO; spec `giacenze.component.spec.ts`
  (5 test).
- Registri nel frontend: `fe/features/registro/registro.service.ts:11-19` `RegistroVista`,
  `:191` `listRegistri()`; `fe/features/registro/registro-sede.ts` `etichettaRegistro`,
  `registroPredefinito`. Dialog amministrativo di riferimento:
  `fe/features/registro/giacenze-iniziali-dialog.component.ts` (`puoImpostare` dal backend).

## Normativa: come la si applica e punti dubbi

Il piano NON inventa: dove la norma lascia spazio, sceglie il comportamento più prudente
che resta un **avviso**, e lo scrive nella pagina.

- **N1. Luogo del deposito = registro.** Il deposito è "nel luogo in cui i rifiuti sono
  prodotti"; con F2-1 c'è un registro per sede, quindi si valuta per registro. Il "Registro
  senza sede" è un luogo a sé. **Dubbio:** un'azienda con due registri sulla stessa area
  (oggi impossibile, un registro per sede) andrebbe sommata: non succede.
- **N2. Criterio a scelta del produttore, per registro.** `TEMPORALE` o `QUANTITATIVO`.
  **Dubbio:** se la scelta possa differire per CER nello stesso luogo la norma non lo dice;
  qui si sceglie per registro (non per CER). Finché l'azienda non sceglie: `NON_SCELTO`, che
  controlla entrambi i criteri (comportamento di oggi, prudente) e invita l'ADMIN a scegliere.
- **N3. "Cadenza almeno trimestrale" = tre mesi di calendario** (decisione
  dell'orchestratore): ogni rifiuto esce entro tre mesi dal giorno in cui è entrato, cioè
  la scadenza del lotto residuo più vecchio di ogni CER è `treMesiDopo(giorno)` (stesso giorno
  del terzo mese successivo; se quel giorno non esiste, l'ultimo del mese: 31/05 → 31/08,
  30/11 → 28/02 o 29/02 negli anni bisestili). L'azienda può aggiungere una soglia **più
  severa** in giorni (`giorniMax` 1..92, facoltativa; predefinito nessuna): la scadenza
  effettiva è la prima delle due. **Dubbio:** una lettura alternativa è "un ritiro di tutto
  ogni tre mesi"; se ogni ritiro svuota il deposito le due coincidono, altrimenti la nostra è
  la più severa.
- **N4. Quantitativo "complessivamente", "raggiunga".** Il limite è la somma del deposito
  del luogo (tutti i CER del registro), con un sottolimite per i pericolosi; si avvisa al
  **raggiungimento** (`>=`). Oggi il codice lo applica **per CER** e con `>`
  (`giacenze.service.ts:285`): il pezzo corregge entrambe le cose. **Pericoloso** (I5) =
  asterisco in qualche riga dell'azienda **oppure** `CERCode.isPericoloso` del catalogo; lo
  stesso CER vale uguale in tutte le sedi.
- **N5. Il limite è volumetrico (m³), il registro è in kg.** Vedi D5: soglia in kg come
  **conversione dichiarata dall'azienda**, con avviso esplicito. Nessun peso specifico
  inventato.
- **N6. Limite annuale nel criterio quantitativo.** "Allorché il quantitativo non superi il
  predetto limite all'anno, il deposito non può avere durata superiore ad un anno". Con
  `QUANTITATIVO` si avvisa quando un lotto residuo supera `unAnnoDopo(giorno)` (29/02 →
  28/02). **Dubbio:** la condizione "non superi il limite all'anno" (quantità annua) non si
  verifica: si applica il tetto di un anno sempre, la lettura più prudente. Con `TEMPORALE`
  il limite di un anno è assorbito dai tre mesi.
- **N7. Fuori dalla norma del deposito temporaneo:** i carichi ricevuti da terzi di un
  gestore (R13/D15) sono stoccaggio autorizzato, con i limiti dell'autorizzazione, non deposito
  temporaneo. F2-6 conta la giacenza fisica del registro come oggi (tutti i carichi vigenti);
  la pagina lo dice in una nota. La distinzione per magazzino/autorizzazione è Fase 4 (D12).

## Decisioni (dell'orchestratore e di questo piano, vincolanti)

- **D1. FIFO puro, in dominio, riusabile da 4.6.** File nuovo
  `src/domain/waste-movement/fifo-deposito.ts`, nessuna dipendenza da Prisma, Nest o date
  di sistema. Tipi ed export:
  ```ts
  export type OrigineEventoFifo = 'APERTURA' | 'MOVIMENTO'
  export interface RiferimentoFifo {
    /** id del movimento o della giacenza iniziale: ultimo criterio di spareggio */
    id: string
    numero?: string                     // "N/AAAA" per i movimenti
  }
  export interface EventoFifo {
    tipo: 'CARICO' | 'SCARICO'         // un'APERTURA è sempre CARICO
    giorno: string                      // giorno italiano YYYY-MM-DD
    quantita: number                    // > 0, già nella famiglia dell'insieme (kg per la massa)
    origine: OrigineEventoFifo
    /** anno * 1e7 + progressivo per i movimenti, 0 per le aperture (vedi sotto) */
    ordine: number
    riferimento: RiferimentoFifo
  }
  export interface LottoResiduo {
    giorno: string; quantita: number; residuo: number
    origine: OrigineEventoFifo; riferimento: RiferimentoFifo
  }
  /** Una riga di abbinamento: quanto di un carico ha coperto uno scarico. */
  export interface AbbinamentoFifo {
    scarico: RiferimentoFifo; carico: RiferimentoFifo; quantita: number
  }
  export interface EsitoFifo {
    lotti: LottoResiduo[]               // solo residuo > 0, in ordine FIFO
    residuoTotale: number
    /** scarichi non coperti alla fine: > 0 solo se lo storico è incoerente */
    scoperto: number
    giornoPiuVecchio: string | null     // lotti[0]?.giorno
    /** prodotti durante il consumo, debito compreso; per 4.6, l'API di F2-6 non li espone */
    abbinamenti: AbbinamentoFifo[]
  }
  export function confrontaEventiFifo(a: EventoFifo, b: EventoFifo): number
  export function calcolaFifo(eventi: readonly EventoFifo[]): EsitoFifo
  ```
  Regole:
  - **Ordine** (lo impone la funzione, ordinando una copia; il chiamante può passare in
    qualunque ordine), in `confrontaEventiFifo`: (1) `giorno` crescente; (2) nello stesso
    giorno **prima i carichi, poi gli scarichi**; (3) fra i carichi le aperture prima dei
    movimenti; (4) `ordine` crescente; (5) **`riferimento.id` in ordine lessicografico**
    (ultimo spareggio: l'ordine è totale e deterministico anche con dati duplicati).
    **Commento obbligatorio nel codice, per 4.6 (M13):** "Nello stesso giorno i carichi
    precedono gli scarichi: uno scarico del giorno D può prendere un carico dello stesso
    giorno (WinWaste filtra `dtuk <= data dello scarico`, `giacenze.md` §3.1 punto 2). È una
    scelta di questa funzione, non della norma: 4.6, che abbina davvero, la propone e
    l'utente può correggerla con l'override manuale; se 4.6 introduce l'ora del movimento,
    va aggiunta come criterio fra (1) e (2)." Le aperture si ordinano per `dataRiferimento`
    come gli altri carichi, non "sempre per prime" come la G di WinWaste: in rifiuti
    l'apertura ha una data vera ("giorno dal quale la quantità è in deposito").
  - **`ordine` e il suo prefisso (M3):** `anno * 1e7 + progressivo`. Il prefisso dell'anno
    serve perché il progressivo riparte ogni anno; il valore è confrontabile solo dentro lo
    stesso registro (la numerazione è per registro), che è l'unico ambito in cui si chiama
    `calcolaFifo`. Le aperture hanno `ordine` 0 (le ordina già il criterio 3).
  - **Consumo:** ogni scarico consuma i lotti in ordine dal più vecchio e, per ogni lotto
    toccato, aggiunge un `AbbinamentoFifo`; lo scarico parziale lascia il residuo sul lotto.
    Uno scarico oltre i lotti disponibili diventa **debito** (`scoperto`), tenuto come coda
    di (scarico, quantità mancante): un carico successivo salda prima il debito, dal più
    vecchio, registrando l'abbinamento (scarico in debito, carico, quantità), e solo il resto
    forma un lotto. Invarianti testati:
    - `residuoTotale - scoperto === Σcarichi - Σscarichi`;
    - per ogni carico: `Σ abbinamenti del carico + residuo del suo lotto (0 se esaurito) ===
      quantità del carico`;
    - per ogni scarico: `Σ abbinamenti dello scarico + sua parte ancora scoperta === quantità
      dello scarico`;
    - la somma dei lotti coincide quindi con `giacenzaKg` di `getGiacenze` (prima del
      clamp) se lo scoperto finale è 0.
  - **Aritmetica intera:** si lavora in millesimi (`Math.round(q * 1000)`) e si restituisce
    `/1000`: niente deriva da virgola mobile con migliaia di eventi.
  - Un evento con `quantita <= 0`, `giorno` non `YYYY-MM-DD` o `riferimento.id` vuoto →
    `Error` (programmazione, non utente). Uno SCARICO con origine APERTURA → `Error`.
  - **Unità:** la funzione non conosce le unità. Un helper nello stesso file,
    `famigliaFifo(unit: string): string` (`'KG'` per kg/t/vuota, altrimenti l'unità
    normalizzata da `normalizzaUnitaRegistro`), e `quantitaFifo(q, unit)` (t × 1000) dicono a
    quale insieme appartiene un evento: **un `calcolaFifo` per famiglia**, mai mescolate.
- **D2. Valutazione pura delle soglie.** File nuovo
  `src/domain/waste-movement/deposito-temporaneo.ts` (sostituisce
  `application/giacenze/deposito-temporaneo.config.ts`, che si cancella nel Task 5a-2;
  nessun altro import). Contiene:
  - `export type CriterioDeposito = 'NON_SCELTO' | 'TEMPORALE' | 'QUANTITATIVO'`;
  - `export interface SoglieDeposito { criterio; giorniMax: number | null; kgMaxTotale:
    number; kgMaxPericolosi: number; preavvisoGiorni: number; preavvisoPercentuale: number }`;
  - `export const SOGLIE_PREDEFINITE: SoglieDeposito = { criterio: 'NON_SCELTO', giorniMax:
    null, kgMaxTotale: 30000, kgMaxPericolosi: 10000, preavvisoGiorni: 15,
    preavvisoPercentuale: 80 }` (D6);
  - `export const LIMITI_LEGGE = { giorniMaxConsentiti: 92, preavvisoGiorniMax: 88,
    m3Totale: 30, m3Pericolosi: 10 }` (i m³ solo per i messaggi, D5);
  - `export function validaSoglie(s): string[]` (messaggi italiani; vuoto = valida):
    `giorniMax` null oppure intero 1..92 (93 → "la soglia in giorni può solo anticipare i
    tre mesi di legge: al massimo 92"); `kgMaxTotale` > 0 e ≤ 10.000.000; `kgMaxPericolosi` >
    0 e ≤ `kgMaxTotale`; `preavvisoGiorni` intero 0..88 (meno della durata minima di tre
    mesi, 89 giorni) e, se `giorniMax` non è null, < `giorniMax`; `preavvisoPercentuale`
    intero 0..99 (0 = nessuno); al più 2 decimali sui kg;
  - date di calendario, tutte su stringhe `YYYY-MM-DD` via `Date.UTC` (mai ms locali):
    `giorniTra(daGiorno, aGiorno): number`, `aggiungiGiorni(giorno, n): string`,
    `treMesiDopo(giorno): string` e `unAnnoDopo(giorno): string`, gemelle, con la stessa
    regola di fine mese (giorno inesistente nel mese di arrivo → ultimo giorno di quel mese:
    31/05 → 31/08, 30/11 → 28/02 o 29/02, 31/08 → 30/11, 29/02 + 1 anno → 28/02);
  - `export function scadenzaTemporale(giorno, giorniMax: number | null): string` =
    `giorniMax === null ? treMesiDopo(giorno) : min(treMesiDopo(giorno), aggiungiGiorni(giorno, giorniMax))`
    (minimo lessicografico delle stringhe ISO);
  - `export function valutaDeposito(input: InputValutazione, soglie, oggi: string):
    AvvisoDeposito[]`, con
    ```ts
    interface InputValutazione {
      cer: { cerCode: string; pericoloso: boolean; residuoKg: number;
             giornoPiuVecchio: string | null }   // lotto più vecchio di QUALUNQUE famiglia
    }
    export type TipoAvvisoDeposito =
      'DURATA' | 'DURATA_ANNUALE' | 'QUANTITA_TOTALE' | 'QUANTITA_PERICOLOSI'
    export interface AvvisoDeposito {
      tipo: TipoAvvisoDeposito
      livello: 'PREAVVISO' | 'SUPERATO'
      cerCode: string | null          // null per i due avvisi quantitativi (sono del registro)
      valore: number                  // giorni d'età o kg
      soglia: number                  // giorni fino alla scadenza effettiva, o kg
      unita: 'giorni' | 'kg'
      giornoPiuVecchio: string | null
      scadenza: string | null         // giorno della scadenza (avvisi di durata)
      messaggio: string               // italiano, pronto per la pagina
    }
    ```
    (I3: `famigliaPiuVecchia` non c'è; la famiglia del lotto si vede nei lotti della vista
    D10.) Regole:
    - **Avvisi di durata: nessun avviso solo se `giornoPiuVecchio` è null.** Un CER con
      residuo solo in m³ o litri (`residuoKg` 0) è valutato come gli altri.
    - `DURATA` (criterio `TEMPORALE` o `NON_SCELTO`): `scadenza = scadenzaTemporale(giorno,
      giorniMax)`; `SUPERATO` se `oggi > scadenza`; `PREAVVISO` se `preavvisoGiorni > 0` e
      `oggi >= aggiungiGiorni(scadenza, -preavvisoGiorni)` (rispetto alla scadenza
      **effettiva**). `valore` = `giorniTra(giorno, oggi)`, `soglia` = `giorniTra(giorno,
      scadenza)`. Messaggio es. "CER 15 01 01: il rifiuto più vecchio è in deposito dal
      03/07/2026 (98 giorni); andava avviato entro il 03/10/2026 (tre mesi)." con "(soglia
      dell'azienda di 60 giorni)" quando la scadenza viene da `giorniMax`.
    - `DURATA_ANNUALE` (solo `QUANTITATIVO`): `scadenza = unAnnoDopo(giorno)`, stesse regole
      di superamento e preavviso.
    - `QUANTITA_TOTALE` e `QUANTITA_PERICOLOSI` (criterio `QUANTITATIVO` o `NON_SCELTO`):
      somma dei `residuoKg` del registro (tutti i CER / solo i pericolosi); `SUPERATO` se
      **`>= soglia`** (la norma dice "raggiunga"; la durata resta `>`), `PREAVVISO` se
      `preavvisoPercentuale > 0` e `>= soglia * percentuale / 100`. Il messaggio dice sempre
      che la soglia in kg è la conversione indicata dall'azienda del limite di 30 m³ (10 m³
      pericolosi).
    - Con `NON_SCELTO` ogni avviso porta in coda al messaggio "Criterio non ancora scelto:
      si controllano entrambi." (testo costante esportato).
    - Ordinamento stabile: `SUPERATO` prima di `PREAVVISO`, poi tipo, poi CER.
    - `oggi` è un parametro (`giornoItaliano(new Date())` lo calcola il servizio): la funzione
      resta pura e testabile su date fisse.
- **D3. Tabella `soglie_deposito_temporaneo`** (modello `SogliaDepositoTemporaneo`), enum
  `CriterioDepositoTemporaneo { NON_SCELTO, TEMPORALE, QUANTITATIVO }`
  (`@@map("criterio_deposito_temporaneo")`):
  `id UUID` default `gen_random_uuid()`, `tenant_id UUID NOT NULL`, `registro_id UUID NULL`
  (NULL = soglie dell'azienda), `criterio` NOT NULL, **`giorni_max SMALLINT NULL`**
  (NULL = nessuna soglia aggiuntiva ai tre mesi), `kg_max_totale DECIMAL(12,2) NOT NULL`,
  `kg_max_pericolosi DECIMAL(12,2) NOT NULL`, `preavviso_giorni SMALLINT NOT NULL`,
  `preavviso_percentuale SMALLINT NOT NULL`, `note VARCHAR(500) NULL` (es. "1 m³ ≈ 600 kg
  per i nostri imballaggi"), `impostato_da UUID NOT NULL`, `created_at`, `updated_at`.
  - FK tenant `ON DELETE CASCADE`; FK composta `(registro_id, tenant_id) →
    registri_rifiuti(id, tenant_id)` `ON DELETE CASCADE` (MATCH SIMPLE: le righe
    dell'azienda, con `registro_id` NULL, non sono controllate), map
    `soglie_deposito_temporaneo_registro_fkey`; in Prisma `registro RegistroRifiuti?
    @relation(fields: [registroId, tenantId], references: [id, tenantId], onDelete: Cascade,
    map: ...)` (precedente: `WasteMovement.rettificato`).
  - Unico per i registri **col nome che Prisma genererebbe** (M12):
    `@@unique([tenantId, registroId], map: "soglie_deposito_temporaneo_tenant_id_registro_id_key")`
    e nella migration `CREATE UNIQUE INDEX "soglie_deposito_temporaneo_tenant_id_registro_id_key"`
    (i NULL non collidono); più l'indice unico parziale **solo in SQL**
    `soglie_deposito_temporaneo_una_per_azienda ON (tenant_id) WHERE registro_id IS NULL`
    (precedenti in Stato di partenza; `migrate diff` deve restare vuoto, altrimenti si toglie
    e lo si dice nel rapporto: il servizio con l'advisory lock di D4 basta). `@@unique([id,
    tenantId])` e `@@index([tenantId])` con i nomi predefiniti di Prisma, scritti uguali
    nella migration.
  - CHECK con nomi espliciti `soglie_deposito_temporaneo_*_check` uguali a `validaSoglie`:
    `giorni_max IS NULL OR giorni_max BETWEEN 1 AND 92`, `kg_max_totale > 0`,
    `kg_max_pericolosi > 0 AND kg_max_pericolosi <= kg_max_totale`, `preavviso_giorni BETWEEN
    0 AND 88 AND (giorni_max IS NULL OR preavviso_giorni < giorni_max)`,
    `preavviso_percentuale BETWEEN 0 AND 99`.
  - RLS in fondo alla migration: `ENABLE` + `FORCE`, `isolamento_azienda`, `sola_lettura ...
    TO wasteflow_lettura` (forma di `20261028100000_giacenze_iniziali` sezione 4). Nessun
    GRANT (default privileges; `prisma/sql/ruoli-db.sql` non cambia). Modello in
    `TENANT_SCOPED_MODELS`. Nessun backfill: **nessuna riga = valori predefiniti** (D6).
- **D4. Precedenza e servizio delle soglie.** `SoglieDepositoService`
  (`src/application/giacenze/soglie-deposito.service.ts`):
  - **Precedenza per riga intera, non per campo:** riga del registro → riga dell'azienda →
    `SOGLIE_PREDEFINITE`. Ogni soglia applicata porta `origine: 'REGISTRO' | 'AZIENDA' |
    'PREDEFINITA'`. Motivo: un campo ereditato da un livello e un altro da un altro rende la
    pagina illeggibile e il criterio (scelta del produttore per luogo) non si spezza.
  - `soglieApplicate(tenantId, registroIds[]): Map<registroId, SoglieApplicate>`: **una sola
    `findMany`** (righe dell'azienda e dei registri richiesti insieme), nessuna query per
    registro.
  - `leggiConfigurazione(tenantId)` per la `GET .../soglie` (una `findMany` delle soglie,
    una dei registri).
  - `imposta(tenantId, utenteId, registroId | null, dati)`: `validaSoglie` → 400 coi
    messaggi; con `registroId` verifica che il registro sia dell'azienda (`findFirst {id,
    tenantId}`, anche disattivato) → altrimenti 404 "Registro non trovato."; in transazione con
    `pg_advisory_xact_lock(hashtext('soglie-deposito|' || tenant || '|' || coalesce(registro,'azienda')))`
    upsert manuale (find + update/create: l'upsert Prisma non gestisce il NULL di
    `registro_id` nell'unico); `activityLog.create` nella stessa transazione
    (`DEPOSITO_SOGLIE_IMPOSTATE`, metadata: `registroId`, valori prima e dopo), come
    `giacenze-iniziali.service.ts:557`.
  - `elimina(tenantId, utenteId, registroId | null)` (M8): con `registroId` di un'altra
    azienda (o inesistente) → `RegistroNonTrovatoError` (404); registro dell'azienda senza
    riga, o azienda senza riga → nessuna scrittura e 204; altrimenti cancella la riga (torna
    al livello superiore) con audit `DEPOSITO_SOGLIE_RIMOSSE`.
  - Tutto nel contesto del tenant (`TenantContext.run`, come `registri.service.ts`
    `nelContesto`) se il chiamante non ce l'ha già.
- **D5. Unità del limite quantitativo: kg dichiarati dall'azienda, non m³ con peso
  specifico.** Motivi: (a) i carichi del registro sono sempre in kg (l'interfaccia non fa
  scegliere l'unità), quindi un controllo in m³ richiederebbe un peso specifico per ogni CER
  di ogni azienda; (b) non esiste nel sistema un peso specifico per CER affidabile: le
  integrazioni del MUD (`mud-integrazioni.ts:76-106`) ne raccolgono per anno e solo per
  convertire unità non di massa in kg, e inventarli è vietato; (c) WinWaste fa lo stesso
  (tutti i limiti in kg, `giacenze.md` §5.2). Quindi: `kgMaxTotale`/`kgMaxPericolosi` sono "la
  quantità in kg che **per questa azienda** corrisponde a 30 m³ / 10 m³", campo `note` per
  scrivere la conversione; la pagina e i messaggi lo dicono sempre ("conversione indicata
  dall'azienda; la norma fissa 30 m³, di cui 10 m³ pericolosi"). I predefiniti 30.000 e
  10.000 kg equivalgono a 1.000 kg/m³ (lo stesso fattore implicito che il 30.000 di oggi già
  usava); la pagina lo scrive accanto ai predefiniti. Le famiglie non di massa (m³, litri da
  aperture o FIR) hanno i loro lotti e contano per la **durata** (I3), ma **non** entrano nei
  totali quantitativi: se un registro ne ha, la risposta porta `quantitaParziale: true` e la
  pagina avvisa "il controllo quantitativo considera solo i kg". Totali in m³ e conversione
  con peso specifico per CER: seguiti (M10).
- **D6. Valori predefiniti.** Durata: **tre mesi di calendario** senza soglia aggiuntiva
  (`giorniMax` null; decisione dell'orchestratore, sostituisce i 90 giorni fissi). Quantità:
  30.000 kg come oggi; aggiunti 10.000 kg pericolosi (rapporto 10/30 della norma, stesso
  fattore implicito). Preavvisi: 15 giorni prima della scadenza effettiva e 80% della soglia,
  valori di questo piano, modificabili, con 0 si spengono. Criterio `NON_SCELTO` = entrambi i
  controlli, come oggi.
- **D7. Solo avvisi; preavvisi ispirati a WinWaste ma espressi diversamente (M9).** WinWaste
  ha preavvisi in valori assoluti (`C4[3]` kg di giacenza, `C4[4]` età in giorni, per
  magazzino; `GMAXP`/`TMAXP` per CER) e li controlla solo nella pianificazione. Qui il
  preavviso è un **anticipo in giorni** sulla scadenza effettiva e una **percentuale** della
  soglia in kg, per registro, calcolati alla lettura: restano validi se l'azienda cambia le
  soglie. Nessun controllo del deposito entra nella registrazione, nella rettifica o nei FIR;
  nessun 4xx per una soglia superata; nessun job, nessuna notifica, nessuna mail
  (`ControllaAvvisi` di WinWaste: seguito).
- **D8. Lettore degli eventi.** File nuovo `src/application/giacenze/eventi-deposito.ts`:
  `leggiEventiDeposito(client, tenantId, { registroId? }): Promise<Map<string /* registroId
  */, Map<string /* chiaveConfrontoCer */, GruppoEventi>>>` con `GruppoEventi { cerCode
  (canonico), pericoloso, famiglie: Map<string, EventoFifo[]> }`. Query (M4: una per tipo,
  qualunque sia il numero di registri e di CER, nessun N+1):
  1. **una** `wasteMovement.findMany` con `{ tenantId, ...(registroId), ...WHERE_VIGENTE }`,
     `select` minima (`id, registroId, cerCode, type, unit, quantity, movementDate,
     progressiveYear, progressiveNumber`);
  2. **una** `leggiApertureRegistro` (aggiungere `id` al suo `select` e, facoltativo, ad
     `ApertureRegistroRiga`: gli altri chiamanti non cambiano);
  3. **pericolosità (I5)**, uguale in tutte le sedi: un CER è pericoloso se (a) qualche riga
     **dell'azienda** (movimenti vigenti o no, aperture, di qualunque registro) lo scrive con
     l'asterisco, **oppure** (b) il catalogo `CERCode` lo marca `isPericoloso`. Con
     `registroId` le righe lette in 1-2 non bastano per (a): **una** `wasteMovement.groupBy
     by ['cerCode'] where { tenantId, cerCode: { contains: '*' } }` più **una**
     `giacenzaIniziale.groupBy` uguale (senza `registroId` si ricava dalle righe già lette e
     queste due si saltano). Per (b) **una** sola query sul catalogo per le cifre presenti:
     `$queryRaw` `SELECT regexp_replace(code, '[^0-9]', '', 'g') AS cifre, bool_or(is_pericoloso)
     FROM cer_codes WHERE regexp_replace(code, '[^0-9]', '', 'g') = ANY(${cifre}::text[])
     GROUP BY 1` (tabella globale senza RLS; stessa regola delle cifre di
     `anomaly-detection.service.ts:92-93`). `cerCode` canonico con l'asterisco se pericoloso.
  `giorno` = `giornoItaliano(movementDate)` per i movimenti, `dataRiferimento` per le
  aperture; `ordine` come D1; `riferimento` = `{ id, numero: `${progressiveNumber}/${progressiveYear}` }`
  per i movimenti, `{ id }` per le aperture. Quantità ≤ 0 (storiche) si saltano con un
  `logger.warn` (non nel file puro). Il file va in `LETTORI` di `lettori-movimenti.spec.ts`
  come `'vigenti'` (motivo: "eventi del FIFO del deposito: solo le vigenti; la pericolosità
  guarda l'asterisco su tutte le righe dell'azienda").
- **D9. `getGiacenze` corretto, forma invariata.** `oldestCaricoDate` diventa il
  **giorno del lotto residuo più vecchio** (qualunque famiglia), come `Date` a mezzanotte UTC
  del giorno (come oggi per le aperture, `giacenze.service.ts:158`); `null` se non c'è residuo.
  Senza `registroId`: minimo fra i registri del lotto più vecchio **di ciascun registro**
  (FIFO sempre per registro, mai sui movimenti mescolati). Le somme restano quelle del
  `groupBy` di oggi (nessun cambio di numeri). Il commento `:44-48` si aggiorna. Il test
  `lettori-vigenti.postgres.spec.ts:357` passa a `'2026-03-01T00:00:00.000Z'`, il test
  `giacenze.service.spec.ts:281` cambia significato (riscriverlo: carico vecchio interamente
  scaricato → conta l'apertura).
- **D10. API.** Nel `GiacenzeController` esistente:
  - `GET /giacenze` invariata.
  - `GET /giacenze/deposito-temporaneo?registroId=` → `DepositoTemporaneoVista {
    oggi: string, registri: DepositoRegistro[] }`, uno per registro dell'azienda (attivi e
    disattivati con almeno un evento; con `registroId` solo quello, 404 se non è
    dell'azienda), con `DepositoRegistro { registroId, registroDescrizione, attivo, soglie:
    SoglieApplicate, cer: DepositoCer[], totaleKg, totalePericolosiKg, quantitaParziale,
    scopertoPresente, avvisi: AvvisoDeposito[] }` e `DepositoCer { cerCode, pericoloso,
    residuoKg, giornoPiuVecchio, etaGiorni, scadenza, famiglie: { unita, residuo, scoperto,
    lotti: LottoResiduo[], lottiOmessi }[] }`. I lotti si restituiscono tutti (per un CER
    sono pochi: quelli non ancora scaricati); oltre 50 per famiglia i 50 più vecchi più
    `lottiOmessi: n`. **Gli abbinamenti del FIFO non si espongono** (I4: servono a 4.6).
  - `GET /giacenze/deposito-temporaneo/alerts?registroId=` **resta come API** (M1): elenco
    piatto degli `AvvisoDeposito` con `registroId` e `registroDescrizione` in più, forma
    nuova (niente più `reasons`/`durationDays`), documentata in Swagger e testata nel Task
    5b. Il frontend non la usa (legge la vista sopra); resta per integrazioni e per un
    futuro riquadro in dashboard.
  - `GET /giacenze/deposito-temporaneo/soglie` → `{ puoImpostare, predefinite, azienda:
    SoglieDeposito & {note, aggiornatoIl} | null, registri: { registroId,
    registroDescrizione, attivo, soglie: ... | null }[] }`; per ogni ruolo con accesso.
  - `PUT /giacenze/deposito-temporaneo/soglie` (azienda) e
    `PUT /giacenze/deposito-temporaneo/soglie/registri/:registroId` (`ParseUUIDPipe`), body
    `SoglieDepositoDto`; `DELETE` sulle stesse due rotte (204, o 404 per un registro di
    un'altra azienda, D4). Solo ADMIN effettivo (`RUOLI_PROGRESSIVO_INIZIALE` importata da
    `api/registro/registro.controller.ts`), 403 `{ message: "Solo un amministratore
    dell'azienda può modificare le soglie del deposito temporaneo.", error:
    'DEPOSITO_SOGLIE_RISERVATE_AMMINISTRATORI' }` **prima** del servizio.
  - DTO: `criterio @IsEnum`; `giorniMax` **obbligatorio nel corpo ma annullabile**
    (`@ValidateIf(o => o.giorniMax !== null) @IsInt @Min(1) @Max(92)` più un
    `@IsDefined()`: il campo assente è 400, `null` è "nessuna soglia aggiuntiva"; così un
    PUT non lascia mai il valore precedente per dimenticanza); interi con `@IsInt @Min @Max`,
    kg `@IsNumber({ maxDecimalPlaces: 2 }) @IsPositive`, `note @IsOptional @MaxLength(500)`
    (trim); le relazioni fra campi (pericolosi ≤ totale, preavviso < giorni) le controlla
    `validaSoglie` nel servizio.
- **D11. Anomalie per registro.** `giacenzeImpossibili` raggruppa per `registroId` oltre a
  `cerCode, type, unit` (aperture per `ap.registroId`). `Anomaly` guadagna `registroId?:
  string`. Il messaggio aggiunge la sede **solo se l'azienda ha più di un registro**:
  "Giacenza impossibile per 15 01 01* nel registro «<descrizione>»: scarico (…) supera
  carico (…)" (descrizioni da una `registroRifiuti.findMany({ where: { tenantId }, select: {
  id, descrizione } })`). Con un solo registro il messaggio resta identico a oggi.
- **D12. Frontend.** Pagina giacenze (`fe/features/giacenze`): selettore del registro (solo
  con più registri, predefinito `registroPredefinito`), per ogni registro le soglie applicate
  con la loro origine, gli avvisi con livello e scadenza, il criterio; tabella per CER con età
  corretta ("in deposito dal", "giorni", "da avviare entro"), dettaglio espandibile dei lotti
  residui; nota sui kg convertiti, sulla parzialità e sugli stoccaggi dei gestori (N7).
  **Giorni come stringhe (M5, M6):** ogni `YYYY-MM-DD` si mostra con un helper puro
  `formattaGiorno('2026-03-01') === '01/03/2026'` (taglio della stringa, nessun `Date`,
  nessun fuso); `oldestCaricoDate` (ISO a mezzanotte UTC) con `date: 'dd/MM/yyyy' : 'UTC'`.
  Configurazione per ADMIN effettivo (`puoImpostare` dal backend) in un dialog standalone. Il
  backend resta l'arbitro.
- **D13. Comunicazione ai clienti.** Nessun job. Una voce nel `CHANGELOG.md` (sezione
  "Unreleased", in italiano) e una riga nella scheda `rifiuti` di `C:\Progetti\STATUS.md`
  con il testo da riportare ai clienti (Task 8).

## Vincoli globali

- Commit `git commit -m "…" -- <file…>` con percorsi espliciti, messaggi in italiano,
  **nessuna attribuzione AI** (né `Co-Authored-By` né altro). Niente push.
- Commenti in italiano, termini tecnici non tradotti. Mai id di tenant, chiavi o credenziali
  nei messaggi restituiti all'utente.
- **Database di test di questo worktree: `wasteflow-pg-test` su `127.0.0.1:55432`.** Mai
  `55434` (è di F2-10). In ogni shell:
  ```bash
  export DOCKER_HOST=tcp://localhost:2375
  export DATABASE_URL="postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public"
  export DB_APP_PASSWORD=wasteflow_app_dev DB_SISTEMA_PASSWORD=wasteflow_sistema_dev
  ```
  e prima di ogni suite Postgres
  `[[ "$DATABASE_URL" == *":55432/"* ]] || { echo "DATABASE_URL non punta a 55432: fermo"; exit 1; }`.
- Prisma solo dal pacchetto installato (`npx prisma --version` = 5.22.x).
- Test su Postgres col ruolo **`wasteflow_app`** (`*.postgres.spec.ts`, modello
  `src/application/registro/registro-per-sede.postgres.spec.ts`: `creaPrismaServiceApplicativo()`,
  `TenantContext.run`, `DB_APP_PASSWORD`), lanciati con
  `cd apps/backend && npx jest -c jest.postgres.config.js --runInBand --forceExit <spec>`.
  Dati creati dal proprietario o nel contesto del tenant, pulizia per `tenantId`, mai
  `deleteMany` senza id. Le righe di `cer_codes` non si modificano in modo persistente (un
  test che ne ha bisogno usa un codice del catalogo esistente o una transazione annullata).
- **RAM limitata.** Suite unitaria completa con
  `cd apps/backend && NODE_ENV=test JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --coverage --forceExit --ci -w 2`
  (mai senza `-w`). Lint **solo sui file toccati e senza `--fix`**: `npx eslint <file…>`
  (backend dalla cartella `apps/backend`, frontend dalla root). Niente `npm run lint`
  (applica `--fix` a tutto). Un solo processo pesante alla volta (non lanciare Karma mentre
  gira jest).
- Prima di dichiarare finito un task backend: suite unitaria completa, eslint dei file
  toccati, `npx tsc --noEmit -p tsconfig.json`, le suite Postgres toccate più
  `lettori-vigenti.postgres.spec.ts` e, dal Task 3 in poi, `rls-catalogo.postgres.spec.ts`.
- Task con migration: `npx prisma generate`, `npx prisma validate`, `npx prisma migrate
  deploy` su 55432, `npx prisma migrate diff --from-migrations prisma/migrations
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url
  "postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/shadow_deposito?schema=public"`
  (database creato e poi rimosso con `docker exec wasteflow-pg-test psql -U wasteflow -d
  wasteflow_ci -c "CREATE DATABASE shadow_deposito"` / `"DROP DATABASE shadow_deposito"`):
  nessuna differenza dovuta al pezzo (le note preesistenti presenti anche su master si
  ignorano). Nomi di vincoli e indici ≤ 63 caratteri, uguali in schema e migration.
- Task frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless`,
  `npm run build`, `npx eslint <file toccati>` dalla root.
- Nessun UPDATE né DELETE su `waste_movements`; nessun file toccato in
  `application/registro/**` salvo `aperture-registro.ts` (D8, campo `id` facoltativo) e
  `lettori-movimenti.spec.ts`/`lettori-vigenti.postgres.spec.ts`; nessuno in
  `api/registro/**` (la costante dei ruoli è già `export`, si importa soltanto); nessuno in
  `application/fir/**`, `api/fir/**`, anagrafiche (`produttori`, `trasportatori`,
  `destinatari`), `application/mud/**`, `fe/features/registro/**` (solo import),
  `fe/features/fir/**` (area di F2-10). Se un task scopre di doverne toccare uno, si ferma e
  lo segnala.
- **I1, convivenza con F2-10.** Migration `20261031100000_soglie_deposito_temporaneo` (F2-10
  usa `20261031110000_…`). In `schema.prisma` enum e modello nuovi **in coda al file**, dopo
  `CausaleRegistroAzienda`; su `Tenant` e `RegistroRifiuti` solo la relazione inversa, in
  fondo ai rispettivi campi di relazione. File condivisi a rischio di conflitto:
  `schema.prisma`, `prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS`),
  `rls-catalogo.postgres.spec.ts` (conteggio), `README-tenant-transazione.md`,
  `ops/README.md`. Al merge, il secondo branch che entra fa rebase sull'altro: somma i
  conteggi (32 + 1 di F2-6 + le tabelle di F2-10), `npx prisma generate`, `migrate deploy`
  sul proprio database di test, `migrate diff` vuoto, suite `persistence/` e `registro/`.
  **Migration fuori ordine (M11):** se F2-10 va in produzione per primo, la sua
  `20261031110000` è già applicata quando arriva la nostra `20261031100000`, che ha un
  timestamp precedente. `migrate deploy` la applicherebbe comunque, ma la storia non sarebbe
  più lineare e `migrate dev` in locale la segnalerebbe. Regola: **nel rebase su un master
  che contiene già `20261031110000`, rinominare la cartella in `20261031120000_soglie_deposito_temporaneo`**
  (la migration non è mai stata applicata in produzione, quindi il nome si può cambiare),
  aggiornare i riferimenti in `ops/README.md` e rifare `migrate deploy`/`diff` sul database di
  test (`DELETE FROM _prisma_migrations WHERE migration_name = '20261031100000_soglie_deposito_temporaneo'`
  dopo aver tolto la tabella, oppure database di test ricreato).

## Task 0: ambiente e linea di base

**File:** nessuno (solo verifica).

1. `docker ps` mostra `wasteflow-pg-test` su 55432 (se spento: `docker start
   wasteflow-pg-test`); variabili dei vincoli globali; `cd apps/backend && npm ci` solo se
   `node_modules` manca.
2. `npx prisma migrate deploy` (deve essere già allineato a `20261030110000_fir_versione`),
   `npx prisma generate`.
3. Linea di base: suite unitaria completa (`-w 2`), `rls-catalogo.postgres.spec.ts`,
   `lettori-vigenti.postgres.spec.ts`, `giacenze.service.postgres.spec.ts`. Annotare nel
   rapporto i test già rossi su master (non vanno "aggiustati" in questo pezzo).

## Task 1: FIFO puro

**File:** `src/domain/waste-movement/fifo-deposito.ts` (nuovo),
`src/domain/waste-movement/fifo-deposito.spec.ts` (nuovo).

1. Implementare D1 (tipi, `confrontaEventiFifo`, `calcolaFifo` con abbinamenti e debito,
   `famigliaFifo`, `quantitaFifo`) in TDD. Commento di testa: cosa calcola, l'ordine e
   perché (testo M13 di D1), il prefisso di `ordine` (M3), il debito, il riuso previsto da
   4.6 (`roadmap-fasi3-4-import-gestori.md` §5, 4.6) e che la funzione non persiste nulla.
2. Test (esempi numerici scritti a mano):
   - nessun evento → lotti e abbinamenti vuoti, `giornoPiuVecchio` null, scoperto 0;
   - tre carichi, uno scarico che consuma il primo e metà del secondo → lotti [secondo con
     residuo metà, terzo intero], due abbinamenti (scarico-primo intero, scarico-secondo
     metà), `giornoPiuVecchio` = giorno del secondo;
   - **il caso G6**: carico del 10/01 scaricato tutto il 20/02, carico del 01/03 → età dal
     01/03 (oggi sarebbe dal 10/01);
   - **stesso giorno (M3, sugli abbinamenti):** nessun lotto prima, carico C e scarico S
     entrambi del 05/03 → abbinamento `{ scarico: S, carico: C }` per la quantità di S e
     scoperto 0; passando gli eventi in ordine inverso (S prima di C nell'array) l'esito è
     identico, abbinamenti compresi;
   - apertura e carico nello stesso giorno → lo scarico è abbinato prima all'apertura;
   - apertura con data successiva a un carico → il carico è più vecchio e si consuma prima;
   - debito: scarico 100 senza lotti, poi carico 60, poi carico 80 → abbinamenti (S, C1, 60)
     e (S, C2, 40), lotto C2 residuo 40, scoperto 0; debito mai saldato → `scoperto` > 0,
     lotti vuoti, nessun abbinamento per la parte scoperta;
   - aritmetica: 0,1 + 0,2 kg tre volte e scarico di 0,9 → residuo esattamente 0 (nessun
     lotto con 1e-16);
   - spareggi (I7): due carichi stesso giorno con `ordine` diverso consumati nell'ordine di
     `ordine`; due carichi con stesso giorno e stesso `ordine` consumati nell'ordine
     lessicografico di `riferimento.id`;
   - errori: quantità 0, giorno `2026-3-1`, id vuoto, SCARICO con origine APERTURA;
   - **proprietà con generatore deterministico** (LCG con seme fisso nel test, nessuna
     dipendenza nuova; 500 sequenze casuali di 1-40 eventi su 60 giorni; **ogni movimento
     ha un `ordine` distinto** e un id distinto, le aperture `ordine` 0): gli invarianti di
     D1 (saldo, carico = abbinamenti + residuo, scarico = abbinamenti + scoperto, in
     millesimi), lotti ordinati con `confrontaEventiFifo`, ogni lotto tranne il primo ha
     `residuo === quantita` (FIFO: solo il più vecchio può essere parziale), nessun residuo
     ≤ 0, invarianza alla permutazione dell'input (abbinamenti compresi);
   - `famigliaFifo`: `''`, `'kg'`, `'T'` → `'KG'`; `'m3'` → `'M3'`; `quantitaFifo(1.5,'t')`
     = 1500.
3. Commit: `feat(deposito): FIFO puro dei lotti residui e degli abbinamenti per il deposito temporaneo`.

## Task 2: valutazione pura delle soglie

**Dipende da 1 (solo per il formato del giorno).** **File:**
`src/domain/waste-movement/deposito-temporaneo.ts` (nuovo) + `.spec.ts`.

1. Implementare D2 in TDD (costanti, `validaSoglie`, date di calendario, `scadenzaTemporale`,
   `valutaDeposito`). Commento di testa con il testo della norma citato in "Fonti", N2-N6
   riassunti e il rimando a questo piano per i dubbi.
2. Test:
   - `giorniTra('2026-03-01','2026-03-31')` = 30, attraverso il cambio d'ora (25/10) e fra
     anni; `aggiungiGiorni` con numeri negativi;
   - **`treMesiDopo` a fine mese e bisestile:** `01/02/2026 → 01/05/2026`, `31/05 → 31/08`,
     `31/08 → 30/11`, `30/11/2026 → 28/02/2027`, `30/11/2027 → 29/02/2028`, `31/12 → 31/03`;
     `unAnnoDopo('2028-02-29')` = `'2029-02-28'`, `unAnnoDopo('2026-03-31')` = `'2027-03-31'`;
   - `scadenzaTemporale`: senza `giorniMax` = tre mesi; con `giorniMax` 60 = 60 giorni;
     con `giorniMax` 92 su un trimestre di 89 giorni = i tre mesi (vince il minimo);
   - `validaSoglie`: predefinite valide (`giorniMax` null); `giorniMax` 0, 93, 1.5 →
     messaggio (93 cita "al massimo 92"); pericolosi > totale; preavviso 89; preavviso =
     `giorniMax`; percentuale 100; kg con 3 decimali;
   - `DURATA`: **lotto del 01/02/2026, oggi 02/05/2026 → SUPERATO anche con `giorniMax`
     90** (scadenza 01/05, la prima delle due); oggi 01/05 → solo PREAVVISO; preavviso 15:
     oggi 15/04 → nulla, 16/04 → PREAVVISO; preavviso 0 = mai preavviso; con `giorniMax` 30
     il preavviso si conta dalla scadenza dei 30 giorni; fine mese: lotto del 30/11/2027,
     oggi 29/02/2028 → nulla di superato, 01/03/2028 → SUPERATO;
   - **I3:** "CER con soli 2 m³ residui da 100 giorni (residuoKg 0, `giornoPiuVecchio` di
     100 giorni prima) → DURATA SUPERATO"; CER con `giornoPiuVecchio` null → nessun avviso
     di durata;
   - `QUANTITA_TOTALE` sulla **somma** dei CER (tre CER da 12.000 kg → superato 36.000 >
     30.000, mentre nessun CER da solo supera); **esattamente 30.000 kg → SUPERATO** (M2:
     "raggiunga"); `PREAVVISO` a 24.000 (80%); `QUANTITA_PERICOLOSI` solo coi CER
     pericolosi;
   - criteri: `TEMPORALE` non produce avvisi quantitativi; `QUANTITATIVO` non produce `DURATA`
     ma produce `DURATA_ANNUALE` (lotto del 28/10/2025: al 29/10/2026 superato, al 28/10/2026
     no; preavviso nei 15 giorni prima); `NON_SCELTO` produce entrambi con la frase costante;
   - ordinamento: `SUPERATO` prima di `PREAVVISO`;
   - messaggi: date in formato `dd/MM/yyyy`, quantità con `formattaQuantita`
     (`src/core/format/formatta-quantita.ts`), scadenza nel messaggio di durata, la frase
     sulla conversione dell'azienda in ogni avviso quantitativo.
3. Commit: `feat(deposito): valutazione pura delle soglie del deposito temporaneo (art. 185-bis)`.

## Task 3: modello, migration e RLS

**Dipende da 0.** **File:** `prisma/schema.prisma`,
`prisma/migrations/20261031100000_soglie_deposito_temporaneo/migration.sql` (nuovo),
`src/infrastructure/persistence/prisma-rls.extension.ts` (`TENANT_SCOPED_MODELS` +
commento come le voci vicine), `src/infrastructure/persistence/rls-catalogo.postgres.spec.ts`
(32 → **33**), `README-tenant-transazione.md` (i "(32)" → 33, `causali_registro_azienda` e
`soglie_deposito_temporaneo` nell'elenco delle coperte), `ops/README.md` (rollback),
`src/application/giacenze/soglie-deposito.schema.postgres.spec.ts` (nuovo).

1. Schema (D3, I1): enum e modello in coda; relazioni inverse `soglieDeposito
   SogliaDepositoTemporaneo[]` su `Tenant` e su `RegistroRifiuti`; commento `///` sul
   modello (cosa contiene, nessuna riga = predefinite, `giorniMax` null = solo i tre mesi,
   kg come conversione dell'azienda, indice parziale fuori da Prisma). Nomi di unici e
   indici quelli predefiniti di Prisma (M12), scritti anche come `map`.
2. Migration, nell'ordine: enum; tabella con CHECK; unici e indice (stessi nomi dello
   schema); FK; indice unico parziale; RLS (`ENABLE`, `FORCE`, `isolamento_azienda`,
   `sola_lettura TO wasteflow_lettura`). Commento iniziale: cosa fa, perché (F2-6, art.
   185-bis), che è additiva, ripristino a mano (`DROP TABLE soglie_deposito_temporaneo; DROP
   TYPE criterio_deposito_temporaneo;` e riga da togliere da `_prisma_migrations`), e la
   regola di rinomina di M11.
3. `ops/README.md`, sezione rollback (accanto a quelle di F2-2/F2-3/F2-5): la tabella è
   ignorata dal codice vecchio; prima del rollback `SELECT tenant_id, count(*) FROM
   soglie_deposito_temporaneo GROUP BY 1` e avvisare le aziende che le soglie personalizzate
   torneranno quelle fisse; dopo il rollback la pagina torna all'età "dal primo carico" e ai
   90 giorni fissi.
4. Test Postgres col ruolo `wasteflow_app` (`soglie-deposito.schema.postgres.spec.ts`):
   inserimento nel contesto dell'azienda A riuscito (riga azienda con `giorni_max` NULL e
   riga registro); seconda riga azienda per A → violazione dell'indice parziale; seconda riga
   per lo stesso registro → violazione dell'unico; registro di B con tenant A → violazione FK
   composta; ogni CHECK violato (un caso per vincolo, nome del vincolo nell'errore, compreso
   `preavviso_giorni` 89 con `giorni_max` NULL e 30 con `giorni_max` 30); con il contesto di
   B la riga di A non si vede né si aggiorna; cancellazione del registro (dal proprietario,
   registro senza movimenti) cancella la sua riga; `rls-catalogo` a 33.
5. Verifiche Prisma dei vincoli globali (`validate`, `deploy`, `diff` vuoto) e
   `prisma-rls.extension.spec.ts` verde (il test DMMF pretende il modello nell'elenco).
6. Commit: `feat(deposito): tabella soglie_deposito_temporaneo con RLS`.

## Task 4: servizio delle soglie

**Dipende da 2 e 3.** **File:** `src/application/giacenze/soglie-deposito.service.ts`
(nuovo) + `.spec.ts` + `soglie-deposito.service.postgres.spec.ts`. Il modulo **non** si
tocca qui (lo registra il Task 5b).

1. D4: `soglieApplicate`, `leggiConfigurazione`, `imposta`, `elimina`. Errori di dominio
   (`DomainError` con sottoclasse `SoglieNonValideError { messaggi }`, e
   `RegistroNonTrovatoError` di `registri.service.ts` riusato) che il controller del Task 5b
   traduce in 400/404. Decimal → `Number` all'uscita, `giorniMax` null resta null.
2. Test unitari (Prisma finto): precedenza registro → azienda → predefinite con `origine`
   giusta; riga intera, non per campo (registro con soli giorni diversi non eredita nulla
   dall'azienda); `soglieApplicate` per cinque registri fa **una** `findMany`; `imposta`
   respinge con i messaggi di `validaSoglie` senza scrivere; registro di un'altra azienda →
   `RegistroNonTrovatoError`; audit scritto nella stessa transazione con prima/dopo;
   `elimina` (M8): registro di un'altra azienda → `RegistroNonTrovatoError`, registro
   dell'azienda senza riga → nessuna scrittura né audit, nessun errore.
3. Test Postgres (ruolo app): `imposta` due volte la riga azienda → una riga aggiornata;
   due `imposta` concorrenti sulla stessa riga azienda (`Promise.all`) → una riga, nessun
   errore di unicità (advisory lock); `soglieApplicate` per due registri con e senza riga;
   audit presente; contesto di B non vede le soglie di A.
4. Commit: `feat(deposito): servizio delle soglie per azienda e registro`.

## Task 5a-1: lettore degli eventi e `getGiacenze` col FIFO

**Dipende da 1.** **File:** `src/application/giacenze/eventi-deposito.ts` (nuovo) +
`.spec.ts`, `src/application/registro/aperture-registro.ts` (+ `aperture-registro.spec.ts`:
`id` facoltativo nel risultato), `src/application/giacenze/giacenze.service.ts` (+
`giacenze.service.spec.ts`, `giacenze.service.postgres.spec.ts`),
`src/application/registro/lettori-movimenti.spec.ts` (voce `eventi-deposito.ts`),
`src/application/registro/lettori-vigenti.postgres.spec.ts`.

1. `leggiEventiDeposito` (D8). Test unitari: raggruppamento per registro e chiave CER
   (`'200301'` e `'20 03 01'` insieme), famiglie separate (kg e t insieme in `'KG'`, litri a
   parte), giorno italiano di un movimento delle 23:30 UTC del 31/12 = 1° gennaio, aperture
   come CARICO con `origine: 'APERTURA'` e `riferimento.id`, quantità ≤ 0 saltate;
   **pericolosità (I5):** asterisco solo in una riga di un **altro** registro dell'azienda
   → pericoloso anche nel registro richiesto; CER senza asterisco ma `isPericoloso` nel
   catalogo → pericoloso; nessuno dei due → non pericoloso; stesso CER, stesso esito in
   tutte le sedi; **numero di query fisso (M4):** con tre registri e dieci CER, una
   `findMany` dei movimenti, una lettura delle aperture, una query del catalogo (e i due
   `groupBy` dell'asterisco solo con `registroId`).
2. `getGiacenze` (D9): sostituire `oldestCarico` (`:93-105`) e l'aggiornamento dalle
   aperture (`:156-160`) con il FIFO per registro; somme invariate; commento `:44-48`
   aggiornato.
3. Test unitari (`giacenze.service.spec.ts`): **regressione G6** su `oldestCaricoDate`;
   test `:281` riscritto (D9); un CER interamente scaricato ha `oldestCaricoDate` null;
   senza `registroId` = minimo dei lotti più vecchi dei registri; gli altri test di
   `getGiacenze` invariati nei numeri. Gli alert restano quelli di oggi in questo task.
4. Test Postgres: `lettori-vigenti.postgres.spec.ts:357` → `'2026-03-01T00:00:00.000Z'`;
   nuovi casi nella stessa sezione: scarico annullato non consuma il lotto, carico rettificato
   porta la data della rettifica, catena annullata esclusa; un caso di pericolosità dal
   catalogo con un codice esistente in `cer_codes`.
5. Commit: `feat(giacenze): data del carico più vecchio dal lotto residuo (FIFO per registro)`.

## Task 5a-2: deposito temporaneo e alert

**Dipende da 2, 4, 5a-1.** **File:** `src/application/giacenze/giacenze.service.ts` (+
`giacenze.service.spec.ts`, `giacenze.service.postgres.spec.ts`),
`src/application/giacenze/deposito-temporaneo.config.ts` (**cancellato**).

1. `GiacenzeService`:
   - nuovo `getDepositoTemporaneo(tenantId, { registroId?, oggi? })`: registri
     dell'azienda (**una** `registroRifiuti.findMany { tenantId }` con `descrizione`,
     `attivo`; con `registroId` verifica di appartenenza → `RegistroNonTrovatoError`), eventi
     (5a-1), un `calcolaFifo` per (registro, CER, famiglia), **una** `soglieApplicate` per
     tutti i registri, `valutaDeposito` con `oggi = giornoItaliano(new Date())` se non
     passato; compone `DepositoRegistro` di D10 (`giornoPiuVecchio` del CER = il più
     vecchio fra le famiglie, `scadenza` dall'avviso o da `scadenzaTemporale`, lotti
     limitati a 50 per famiglia con `lottiOmessi`, `quantitaParziale` se un CER ha residuo in
     una famiglia non di massa, `scopertoPresente` se una famiglia ha `scoperto > 0`; gli
     abbinamenti non entrano nella vista). Registri disattivati senza eventi esclusi.
   - `getDepositoTemporaneoAlerts(tenantId, registroId?)`: appiattisce gli avvisi con
     `registroId`/`registroDescrizione`. Il vecchio parametro `config` sparisce;
     `DepositoTemporaneoAlert`/`DepositoTemporaneoAlertReason` si tolgono.
   - Log: un solo `logger.warn` per chiamata con il numero di avvisi `SUPERATO` (tenantId
     solo nel log, come oggi).
2. Test unitari: riscrivere i test degli alert `:80,109,126,143` sulla nuova forma; **G6**
   (carico vecchio scaricato del tutto → nessun avviso di durata, età dal carico successivo);
   somma quantitativa fra CER dello stesso registro e **non** fra registri diversi; soglie
   del registro usate al posto di quelle dell'azienda; CER con soli m³ residui vecchi → DURATA
   (I3) e `quantitaParziale`; numero di query costante con più registri (M4).
3. Test Postgres: **due registri dello stesso CER**, ciascuno col proprio lotto più vecchio
   e le proprie soglie (una riga per il registro A, nessuna per B): avvisi diversi, nessuna
   somma fra i due; contesto di un'altra azienda → nessun registro.
4. Commit: `feat(deposito): deposito temporaneo per registro con soglie, preavvisi e tre mesi di calendario`.

## Task 5b: API e modulo

**Dipende da 5a-2.** **File:** `src/application/giacenze/giacenze.controller.ts` (+
`giacenze.controller.spec.ts` e nuovo `giacenze.controller.http.spec.ts` sul modello di
`src/api/registro/causali-registro.controller.http.spec.ts`),
`src/application/giacenze/soglie-deposito.dto.ts` (nuovo) + `.spec.ts`,
**`src/application/giacenze/giacenze.module.ts`** e **`giacenze.module.spec.ts`**.

1. Modulo (I1): `imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule]`
   (precedente `src/api/registro/registro.module.ts:41`), `SoglieDepositoService` fra i
   provider e gli export. Nello spec del modulo: `moduleRef.get(SoglieDepositoService)` e
   `moduleRef.get(GiacenzeController)` risolti.
2. Rotte di D10, `@ApiOperation` in italiano che citano l'art. 185-bis, i tre mesi di
   calendario e la conversione in kg; la rotta `/alerts` documentata come API stabile non
   usata dal frontend (M1). Ruolo effettivo prima del servizio; `DomainError` → 400 (con
   `messaggi`) / 404. `oggi` non è un parametro dell'API.
3. Test: DTO con la pipe vera (`whitelist`, `forbidNonWhitelisted`): campo sconosciuto 400,
   `giorniMax` assente 400, `giorniMax: null` accettato, `giorniMax` 93 400 dal DTO; un
   preavviso 30 con `giorniMax` 30 passa il DTO ma il servizio risponde 400 col messaggio;
   HTTP: VIEWER e OPERATOR leggono le quattro GET e ricevono 403 su PUT/DELETE con `error`
   `DEPOSITO_SOGLIE_RISERVATE_AMMINISTRATORI`; ADMIN 200/204; `:registroId` non UUID 400;
   registro di un'altra azienda 404 su GET, PUT e DELETE; DELETE su registro dell'azienda
   senza riga 204 (M8); la GET di deposito usa l'azienda selezionata (`X-Tenant-ID`), non
   quella del token (come `anomaly.controller.spec.ts:19`); `/alerts` con e senza
   `registroId` restituisce gli avvisi piatti con `registroDescrizione` (M1).
4. Commit: `feat(deposito): API del deposito temporaneo e delle soglie`.

## Task 6: anomalie per registro

**Dipende da 0** (file disgiunti; si esegue qui per non sovrapporre jest). **File:**
`src/application/anomaly/anomaly-detection.service.ts` (+ `anomaly-detection.service.spec.ts`),
`src/application/registro/lettori-vigenti.postgres.spec.ts` (sezione `AnomalyDetectionService`).

1. D11: `by: ['registroId', 'cerCode', 'type', 'unit']`, chiave della mappa
   `${registroId}|${chiaveConfrontoCer}`, aperture per `ap.registroId`; descrizioni dei
   registri lette (una query) solo se esiste almeno un'anomalia `NEGATIVE_STOCK` e l'azienda
   ha più di un registro.
2. Test: **il caso della roadmap**: stesso CER, registro A carico 100 scarico 150, registro
   B carico 100 → anomalia su A col nome del registro (oggi nascosta: il totale è 200/150);
   con un solo registro il messaggio è identico a oggi (stringa esatta); apertura di A non
   copre lo scarico di B; i test esistenti (`:84-243`) restano verdi aggiungendo `registroId`
   alle righe del mock. Postgres: una catena annullata su A non conta, e A e B si valutano
   separati.
3. Commit: `fix(anomalie): giacenza impossibile valutata per registro`.

## Task 7a: frontend, pagina per registro

**Dipende da 5b.** **File:** `fe/features/giacenze/giacenze.service.ts` (+ nuovo
`giacenze.service.spec.ts`), `fe/features/giacenze/giorno.ts` (nuovo, helper puro) +
`.spec.ts`, `fe/features/giacenze/giacenze.component.ts` (+ `giacenze.component.spec.ts`,
nuovo `giacenze.component.dom.spec.ts`).

1. Servizio: tipi della risposta di D10 (`DepositoTemporaneoVista`, `DepositoRegistro`,
   `DepositoCer`, `LottoResiduo`, `AvvisoDeposito`, `SoglieApplicate`), `getGiacenze(registroId?)`,
   `getDepositoTemporaneo(registroId?)`, `getSoglie()`, `impostaSoglie(registroId | null, dati)`,
   `eliminaSoglie(registroId | null)`; rimuovere `getDepositoTemporaneoAlerts` e i tipi
   `DepositoTemporaneoReason/Alert` (nessun altro uso: verificarlo con `grep`). La rotta
   `/alerts` non si usa (M1).
2. `giorno.ts` (M5, M6): `formattaGiorno(giorno: string): string` (`'2026-03-01'` →
   `'01/03/2026'` col solo taglio della stringa; stringa vuota o formato diverso → `'-'`).
3. Pagina:
   - registri da `RegistroService.listRegistri()` (import da `fe/features/registro`, nessuna
     modifica lì); selettore `p-dropdown` con `etichettaRegistro` **solo con più registri**,
     valore iniziale `registroPredefinito`, oppure "Tutte le sedi" (giacenze sommate, deposito
     mostrato registro per registro); cambio di registro → ricarica giacenze e deposito;
   - per ogni registro: riquadro "Soglie applicate" (criterio in parole: "Temporale: avvio
     entro tre mesi di calendario" con "e comunque entro N giorni" se c'è `giorniMax` /
     "Quantitativo: 30.000 kg complessivi, di cui 10.000 kg pericolosi, e comunque entro un
     anno" / "Criterio non scelto: si controllano entrambi"), origine ("predefinite",
     "dell'azienda", "di questa sede"), nota sulla conversione kg ↔ m³ con il fattore
     implicito dei predefiniti, `note` dell'azienda se presenti;
   - avvisi con livello (`p-tag` `danger` per SUPERATO, `warning` per PREAVVISO) e il
     `messaggio` del backend; card di testata con il numero di superamenti e di preavvisi;
   - tabella per CER: residuo (kg e altre unità), "In deposito dal" e "Da avviare entro"
     (`formattaGiorno`), giorni, pericoloso; riga espandibile coi lotti residui (giorno,
     numero `N/AAAA` o "giacenza iniziale", residuo/quantità, unità);
   - note: `quantitaParziale` ("Il controllo quantitativo considera solo le quantità in kg:
     m³ e litri restano fuori."), `scopertoPresente` ("Ci sono scarichi senza un carico
     corrispondente: vedi Anomalie."), nota fissa N7 per gli stoccaggi dei gestori;
   - la colonna "Carico più vecchio" della tabella giacenze diventa "In deposito dal", resa
     con `date: 'dd/MM/yyyy' : 'UTC'` (M5).
4. Test: `formattaGiorno` (casi normali, 31/12, valori non validi); servizio (URL e
   parametri, `registroId` assente/presente); DOM a click reali: selettore assente con un
   registro e presente con due, cambio sede → nuova richiesta con `registroId`; avviso
   SUPERATO e PREAVVISO resi col livello giusto; lotti espansi; note di parzialità e scoperto
   mostrate solo quando vere; la cella "In deposito dal" mostra `01/03/2026` per
   `giornoPiuVecchio: '2026-03-01'`. I 5 test esistenti adeguati, non cancellati.
5. Commit: `feat(giacenze): pagina del deposito temporaneo per sede con lotti e soglie`.

## Task 7b: frontend, configurazione delle soglie (ADMIN)

**Dipende da 7a.** **File:** `fe/features/giacenze/soglie-deposito-dialog.component.ts`
(nuovo, standalone, + `.spec.ts` e `.dom.spec.ts`), `giacenze.component.ts` (pulsante e
dialog).

1. Pulsante "Soglie" visibile solo con `puoImpostare` della `GET .../soglie`. Dialog: scelta
   del livello ("Tutta l'azienda" o una sede), criterio (`p-selectButton` con una riga di
   spiegazione per opzione, testo della norma breve), soglia aggiuntiva in giorni
   facoltativa (casella "Avvio anticipato rispetto ai tre mesi" che abilita il campo 1-92;
   spenta = `null`), kg totali e pericolosi con la frase "quanti kg corrispondono, per i
   vostri rifiuti, a 30 m³ / 10 m³", preavvisi, note; per una sede "Usa le soglie
   dell'azienda" (= `DELETE` della riga della sede); per l'azienda "Torna ai valori
   predefiniti". **Il corpo del PUT contiene sempre `giorniMax`** (numero o `null`, M7).
   Validazione lato client uguale a `validaSoglie` (stessi limiti, messaggi vicini al campo),
   ma i 400 del backend si mostrano come arrivano. Dopo il salvataggio: ricarica soglie e
   deposito.
2. Accessibilità come `giacenze-iniziali-dialog.component.ts` (label, `aria-describedby`
   degli errori, focus sul primo campo, chiusura con Esc).
3. Test DOM a click reali: pulsante assente senza `puoImpostare`; scegliere `QUANTITATIVO`
   nasconde la soglia in giorni e mostra i kg; salvare per una sede → `PUT .../registri/<id>`
   con il corpo atteso **e `giorniMax: null`** se la casella è spenta; "Usa le soglie
   dell'azienda" → `DELETE`; 400 del backend mostrato; pericolosi > totale bloccato prima
   dell'invio.
4. Commit: `feat(giacenze): configurazione delle soglie del deposito per gli amministratori`.

## Task 8: chiusura, comunicazione e verifica finale

**Dipende da tutti.** **File:** `CHANGELOG.md`, `C:\Progetti\STATUS.md` (solo la scheda
`rifiuti`, voce "da comunicare ai clienti"), nessun codice.

1. `CHANGELOG.md`, nuova sezione `## [Unreleased]` in testa con "### Changed — Deposito
   temporaneo (Fase 2 pezzo 6)" e questo testo (da riusare con i clienti):
   > L'età del deposito temporaneo ora si calcola dal rifiuto più vecchio **ancora in
   > deposito** (ordine di uscita FIFO), sede per sede. Prima si contava dal primo carico di
   > sempre: dopo il primo trimestre quasi ogni CER risultava "oltre i 90 giorni" anche se era
   > stato avviato regolarmente. **Ci saranno meno allarmi, e quelli che restano sono
   > veri.** Il limite temporale è ora di tre mesi di calendario, come dice l'art. 185-bis
   > (prima 90 giorni fissi); l'azienda può fissarne uno più breve. Il limite quantitativo
   > vale per l'intero deposito della sede (tutti i CER insieme), dal momento in cui viene
   > raggiunto, con un limite separato per i pericolosi: chi ha molti CER sotto soglia uno
   > per uno può vedere un avviso nuovo. Ogni azienda (o ogni sede) può scegliere il criterio
   > (temporale o quantitativo) e le soglie; i limiti in kg sono una conversione indicata
   > dall'azienda del limite di legge in m³. Arrivano anche i preavvisi. Sono solo avvisi:
   > nessuna registrazione viene bloccata.
2. STATUS: nella scheda `rifiuti`, quando il pezzo va in produzione (lo fa l'orchestratore
   col deploy), la stessa frase in breve fra i "da comunicare"; questo task prepara solo il
   testo nel rapporto se STATUS non va toccato prima del merge.
3. Verifica finale: suite unitaria completa (`-w 2`), tutte le suite Postgres di
   `application/giacenze/`, `application/anomaly/`, `application/registro/` e
   `infrastructure/persistence/`; `npx eslint "src/**/*.ts"` **senza `--fix`** (unica
   esecuzione globale, a fine pezzo, da sola); `tsc`; Karma, `npm run build`; `prisma
   migrate diff` vuoto.
4. Commit: `docs(deposito): changelog del deposito temporaneo per registro`.

## Ordine

```
T0 → T1 → T2 → T3 → T4 → T5a-1 → T5a-2 → T5b → T6 → T7a → T7b → T8
```

Sequenziale, un agente sonnet per task, revisione opus dopo ognuno. T6 tocca file
disgiunti e potrebbe stare ovunque dopo T0: è messo dopo T5b solo per non far girare due
suite insieme.

## Fuori ambito (seguiti)

- **Abbinamento carichi-scarichi persistito (4.6)**: persistenza, override manuale, residuo
  per carico salvato, import di `RELAZ`; userà `calcolaFifo` e i suoi `abbinamenti` come
  proposta (ed eventualmente l'ora del movimento come criterio d'ordine, D1).
- **Magazzino/posizione** (WinWaste `[MAGAZZINI RIFIUTI]`) e **limiti per CER**
  (`[DETTAGLI MAGAZZINI]`): per i produttori si riconcilia per registro; per i gestori è
  Fase 4 (D12), insieme alla distinzione fra deposito temporaneo e stoccaggio R13/D15 (N7).
- **Controllo in m³ (M10):** totali in m³ delle famiglie volumetriche (m³, litri) confrontati
  con i 30/10 m³ di legge, e conversione dei kg in m³ con un peso specifico per CER
  (eventualmente riusando i pesi specifici delle integrazioni del MUD).
- **Avvisi pianificati** (mail o notifica in campanella, come `ControllaAvvisi` di WinWaste)
  e **avviso alla registrazione** (WinWaste `C4[8]`): F2-6 resta in lettura.
- **Verifica della condizione "quantità annua sotto il limite"** di N6 e della scelta del
  criterio per CER (N2): da decidere con un consulente ambientale prima di renderli più
  fini.
- Snapshot o cache del FIFO per aziende con molti anni di movimenti (oggi una lettura per
  pagina, adeguata ai volumi attuali).
- Dashboard: un riquadro con i superamenti del deposito (può usare la rotta `/alerts`).
