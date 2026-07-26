# Area RENTRI in WasteFlow — design del programma

**Data:** 2026-07-26 · **Stato:** design, da decomporre in piani eseguibili
**Baseline:** `develop` @ `9fb88c6` · produzione `master` @ `7464963`

---

## 1. L'obiettivo, nelle parole del committente

> «Evitare all'utente di andare sul RENTRI a fare operazioni, automatizzare processi e rendere più semplice la vita all'utente.»

Da qui discende il **criterio di successo**, che non è tecnico: non si misura in endpoint implementati, ma in **quante volte l'utente è ancora costretto ad aprire il portale dell'ente**. Ogni fase scoperta è un punto di attrito da progettare esplicitamente, non una nota a piè di pagina.

Tre principi che ne derivano e che vincolano ogni scelta successiva:

1. **L'area è il posto dove si lavora, non un pannello di sincronizzazione.** L'utente fa la cosa e vede l'esito; non «lancia una sync» e interpreta uno stato tecnico.
2. **L'automazione è silenziosa quando funziona e chiara quando no.** Se un formulario si allinea da solo, l'utente non deve accorgersene. Se serve il suo intervento, deve capire in una riga cosa fare.
3. **Dove il contratto non copre una fase, l'applicativo lo dice.** Nascondere che una cosa va fatta sul portale produce la peggiore delle esperienze: scoprirlo a scadenza.

---

## 2. Stato di partenza, accertato e verificato

Tre analisi indipendenti (2026-07-26), ognuna verificata dal coordinatore contro il codice o il contratto:

### 2.1 Il legame FIR locale ↔ RENTRI oggi **non esiste**

| Verifica | Esito |
|---|---|
| `SyncFIRToRENTRIUseCase` registrato in un modulo | **no**, orfano |
| `RENTRISyncController` (5 endpoint) registrato | **no**, orfano → 404 |
| `markRENTRISynced` / `canSyncToRENTRI` sull'aggregate FIR | **non esistono** |
| Chi scrive `rentriProtocolNumber` | **nessuno**, in tutto il codice |
| Endpoint o schermata per associare a mano un FIR | **non esistono** |
| Percorso inverso (importare un formulario da RENTRI) | **non esiste** |

In più, `rentriProtocolNumber` **non è il numero ufficiale del formulario**: il commento nello use case dichiara che conterrebbe il `transazione_id`, cioè l'identificativo tecnico della singola chiamata REST. Manca un campo per il `numero_fir` assegnato dall'ente.

### 2.2 Il client, però, è già conforme

La pipeline P2 ha reso `RENTRIApiClient` conforme al contratto e lo ha validato contro un oracolo esterno: autenticazione ID_AUTH_REST_02, ciclo asincrono 202/200/303, resilienza (403 non ritentato, 429 con `Retry-After`). Il client **è fornito** da `RentriModule`, che è importato in `app.module`.

**Quindi: WasteFlow sa parlare con RENTRI correttamente, ma non parla con nessuno**, perché nessun percorso dell'applicazione invoca quel client. Il pezzo difficile è fatto; manca collegarlo.

### 2.3 Esiste già interfaccia scritta e mai collegata

- `RENTRISyncBadgeComponent` e `RENTRISyncLogsComponent` esistono ma **non sono importati da alcuna pagina**.
- L'unica parte viva è `/rentri/certificato` (gestione del certificato di interoperabilità per tenant), correttamente cablata.
- **Non esiste una pagina di dettaglio del FIR**: tutto vive nella lista `/fir`, con colonne `Numero | CER | Quantità | Stato | Data | Azioni`.
- I due componenti orfani hanno testi **in inglese** («Syncing 42%», «Retry 3/5»), contro la convenzione italiana del progetto.
- L'area ha **zero `data-testid`**; la convenzione è già pianificata in `e2e/SELECTORS-DEBT.md`.

---

## 3. Cosa il contratto consente davvero

Verificato sui contratti ufficiali versionati in `docs/contracts/rentri/`.

### 3.1 Formulari — `formulari.yaml`, 65 path

**Tutte** le ~30 operazioni del ciclo digitale hanno un endpoint: creazione, modifica, quantità, trasporto, annotazioni, trasbordo parziale e totale, sosta tecnica, cambio destinatario, accettazione e respingimento (anche parziale), firma/hash/rollback firma, annullamento con note, allegati, stampa PDF, stato e azioni disponibili, visibilità.

### 3.2 L'associazione a un formulario esistente **è prevista dall'ente**

Meccanismo in due passi, documentato:

1. `GET /` con filtro **`identificativo_soggetto`** (codice fiscale) → elenca i formulari in cui quel soggetto compare **indipendentemente da chi li ha creati**, restituendo il flag `visibilita_sito_acquisita`.
2. `POST /{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` → aggancia formalmente il formulario alla propria unità locale.

Esistono anche `/{numero_fir}/acquisizione/{num_iscr_sito}` e `/rilascio-visibilita/{num_iscr_sito}`. Non esiste un import automatico dei dati: serve un `GET /{numero_fir}` per il dettaglio.

**La chiave stabile da persistere è il `numero_fir`.**

### 3.3 Le altre API disponibili

| API | Path | Contenuto |
|---|---|---|
| `anagrafiche` | 23 | soggetti, unità locali, iscrizioni |
| `codifiche` | 25 | tabelle di codifica (CER, operazioni, ...) |

### 3.4 Cosa resta fuori, e non per nostra scelta

- **Registri cronologici**: l'API **non è esposta** su `/docs/{api}/v1.0/openapi.json` (accertato in Fase 0, `ACCERTAMENTI.md`). Non è pianificabile finché l'ente non la pubblica o non se ne ottiene la specifica per altra via.
- **Vidimazione del formulario cartaceo** e **iscrizione anagrafica**: restano sul portale.
- **Quarta copia** come oggetto distinto: non esiste nel contratto, c'è solo una stampa PDF generica.

### 3.5 Vincoli operativi da rispettare ovunque

1. **Tutte le scritture sono asincrone**: 202 + `Location` → polling `/status` (200 in corso, **303** pronto) → `/result` (400 se anticipato). Mai sincrone.
2. **Limiti di dimensione**: 5 MB per la copia cartacea, 3 MB per l'xFIR.
3. **Rate limiting reale**: 429 oltre ~100 richieste in 5 secondi con `Retry-After`, e **423 = ban del chiamante** su troppe richieste non valide. Quest'ultimo è il vincolo più insidioso: un'automazione mal tarata non rallenta, viene bandita.

---

## 4. Le decisioni del committente (2026-07-26)

**Ambito:** il percorso completo del FIR digitale **più tutti gli altri cicli disponibili su RENTRI** — quindi anche `anagrafiche` e `codifiche`. I registri cronologici restano fuori per indisponibilità del contratto, non per scelta.

**Modalità di legame:** ogni **azienda** sceglie fra **automatico** e **manuale**, con in più una **modalità ibrida** che prevede la conferma dell'aggancio. È quindi un'impostazione per tenant a tre valori, non un interruttore globale.

---

## 5. Architettura dell'area

### 5.1 Il modello dati

Serve distinguere tre cose che oggi sono confuse in un unico campo:

| Concetto | Oggi | Serve |
|---|---|---|
| Numero interno del formulario | `firNumber` | invariato |
| **Numero ufficiale RENTRI** | *assente* | **nuovo campo**, chiave stabile del legame |
| Identificativo della singola trasmissione | impropriamente in `rentriProtocolNumber` | campo proprio, di natura tecnica e transitoria |

Va inoltre registrato **come** è nato il legame — trasmissione nostra, acquisizione di un formulario altrui, aggancio manuale — perché cambia cosa l'utente può fare dopo, e serve in caso di contestazione.

**Impostazione per tenant**: modalità `automatica` / `ibrida` / `manuale`.

### 5.2 Dove vive l'esperienza

Il principio è che **l'utente non deve andare in un'«area RENTRI» per lavorare**: deve lavorare dove già lavora, e trovare RENTRI lì.

- **Nella lista FIR**: una colonna di stato RENTRI accanto a «Stato», che è esattamente il posto per cui il badge orfano era stato progettato. Da lì le azioni contestuali.
- **Una pagina di dettaglio del FIR**, oggi assente: è il luogo naturale per la cronologia delle trasmissioni, gli errori leggibili e le azioni del ciclo (accettazione, trasbordo, annullamento).
- **Un'area RENTRI dedicata** solo per ciò che non appartiene a un singolo formulario: stato del collegamento con l'ente, certificato, ricerca e aggancio dei formulari altrui, sincronizzazione delle anagrafiche e delle codifiche, diagnostica.

### 5.3 Il comportamento dell'automazione

- **Automatica**: il formulario emesso in WasteFlow viene trasmesso senza intervento; il numero ufficiale torna e compare. L'utente se ne accorge solo se qualcosa non funziona.
- **Ibrida**: la trasmissione parte da sola ma l'aggancio richiede una conferma esplicita dell'utente.
- **Manuale**: nulla parte da solo; l'utente sceglie cosa e quando.

In tutti i casi vale il principio 2: il fallimento dev'essere **leggibile** — non «errore 403», ma «il certificato dell'azienda non è valido per questa operazione: aggiornalo qui».

---

## 6. Decomposizione in fasi

Ogni fase produce software funzionante e verificabile, e avrà il proprio piano eseguibile. L'ordine non è arbitrario: le prime due sbloccano tutto il resto.

| Fase | Contenuto | Perché in questa posizione |
|---|---|---|
| **R0 — Fondamenta del legame** | Modello dati (numero ufficiale, identificativo trasmissione, origine del legame, modalità per tenant); cablaggio DI di use case, coda, job, controller oggi orfani; metodi mancanti sull'aggregate; persistenza dei campi `rentri*` | Senza questo nulla è collegabile. È anche il pezzo che rende finalmente *raggiungibile* il client conforme di P2 |
| **R1 — Trasmissione e stato** | Il FIR emesso in WasteFlow arriva su RENTRI e torna il numero ufficiale; stato visibile nella lista; errori leggibili; le tre modalità per tenant | È il percorso più frequente: da solo elimina la maggior parte delle visite al portale |
| **R2 — Aggancio ai formulari esistenti** | Ricerca per codice fiscale, acquisizione visibilità, import del dettaglio, aggancio manuale come riconciliazione | Risponde alla domanda originale del committente e copre i formulari nati altrove |
| **R3 — Il ciclo completo** | Accettazione e respingimento anche parziale, trasbordo, sosta tecnica, cambio destinatario, annullamento con note, allegati, stampa | Completa la promessa: nessuna operazione del formulario digitale richiede il portale |
| **R4 — Anagrafiche e codifiche** | Sincronizzazione di soggetti e unità locali; codifiche allineate dall'ente invece che da tabelle interne | Riduce l'inserimento manuale e gli errori di codifica |
| **R5 — Robustezza e osservabilità** | Rispetto del rate limiting con particolare cura al 423, diagnostica per l'utente, riconciliazione periodica, allarmi | Un'automazione che si fa bandire dall'ente è peggio di nessuna automazione |

---

## 7. Rischi

| Rischio | Contromisura |
|---|---|
| **Ban del chiamante (423)** per automazione mal tarata | Limitazione lato nostro prima ancora che l'ente la imponga; test dedicati contro l'oracolo con guasti iniettati; nessun ritentativo su errori non transitori |
| L'oracolo non valida i **modelli dati di scrittura** (accetta qualunque corpo) | Le riserve sono già note (`FEDELTA.md`): i modelli vanno verificati contro l'ambiente demo reale prima del go-live. Non dichiarare conforme ciò che l'oracolo non può giudicare |
| Riusare i componenti orfani senza riallinearli | Hanno testi in inglese e nessun `data-testid`: vanno adeguati prima, non «come sono» |
| L'utente non capisce **perché** una cosa non si può fare | Ogni limite del contratto va comunicato nell'interfaccia con la ragione, non con un errore tecnico |
| Il legame sbagliato fra due formulari | L'aggancio manuale è una scrittura sensibile: va tracciata (chi, quando, perché) e reversibile |

---

## 8. Ciò che questo programma **non** ottiene

- **I registri cronologici**, finché l'API non è disponibile.
- **La vidimazione del cartaceo** e **l'iscrizione anagrafica**: restano sul portale, e l'applicativo deve dirlo.
- **La conformità dei modelli dati di scrittura**, verificabile solo contro l'ambiente demo reale con credenziali vere.
- **Il valore legale della firma**, che dipende dal contratto QTSP e non da quest'area.

---

## 9. Prossimo passo

Scrivere il piano eseguibile di **R0**, che è il prerequisito di tutto il resto e il punto in cui il lavoro già fatto in P2 smette di essere irraggiungibile.
