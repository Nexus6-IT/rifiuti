# Audit contratti RENTRI — registro cronologico digitale (2026-09-10)

**Metodo**: solo ricognizione documentale. Nessun codice applicativo toccato. Ogni affermazione qui sotto è verificata leggendo un file scaricato in questa sessione o un documento già presente nel repository — mai dedotta o ricordata.

**Connettività**: `https://demoapi.rentri.gov.it` è raggiungibile dalla macchina di lavoro (verificato con `curl` diretto, `HTTP 200` su `formulari/v1.0/openapi.json`). Nessun blocco di rete.

## 1. Nomi di API provati

Endpoint testato: `GET https://demoapi.rentri.gov.it/docs/<nome>/v1.0/openapi.json`.

| Nome | Esito | Note |
|------|-------|------|
| `formulari` | 200 (già noto) | contratto già in repo |
| `anagrafiche` | 200 (già noto) | contratto già in repo |
| `codifiche` | 200 (già noto) | contratto già in repo |
| `registri` | 404 | già provato in `ACCERTAMENTI.md` (2026-07-25) |
| `registro` | 404 | provato oggi |
| `registri-cronologici` | 404 | già provato in `ACCERTAMENTI.md` |
| `vidimazione` | 404 | già provato in `ACCERTAMENTI.md` |
| `vidimazioni` | 404 | provato oggi |
| `registro-cronologico` | 404 | provato oggi |
| `registro-carico-scarico` | 404 | provato oggi |
| `registri-di-carico-e-scarico` | 404 | provato oggi |
| `e-registri` | 404 | provato oggi |
| `eregi` | 404 | provato oggi |
| `produttori` / `trasportatori` / `intermediari` / `gestori` | 404 | provato oggi, ipotesi per esclusione |
| `credentials` / `boarding` / `firma-remota` / `firma` | 404 | provato oggi (questi sono path interni a `ca-rentri`, non nomi di API) |
| **`ca-rentri`** | **200** | esiste, non era mai stato provato prima (i tentativi precedenti coprivano solo varianti di "registro"/"vidimazione") |
| **`dati-registri`** | **200** | esiste — è il servizio del registro cronologico |

`ca-rentri` era già citato come nome di gruppo API nell'ADR `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md` (fonte: PDF degli incontri RENTRI per Software House), ma quell'ADR annotava esplicitamente "Nessun OpenAPI pubblico per `ca-rentri`". Non è più vero: il documento OpenAPI esiste ed è stato scaricato oggi.

## 2. File scaricati

Aggiunti a `docs/contracts/rentri/`, stesso formato degli altri tre (YAML servito con estensione `.json`), con l'header `curl` standard dello script. Digest e versione anche in `MANIFEST.md` (rigenerato, righe di `formulari`/`anagrafiche`/`codifiche` lasciate **invariate** al loro valore del 2026-07-25 — questi tre file NON sono stati toccati, come da vincolo):

| File | Titolo OpenAPI | `x-api-id` | Versione | SHA-256 | Scaricato il |
|------|-----------------|------------|----------|---------|--------------|
| `ca-rentri.yaml` | ca-rentri — "Servizio RENTRI CA" | `rentrigov.sign` | `1.0.20260831-1084` | `526562dbea8581adaf2c5cc2f10b5211fd77b836ed6385e66b698a9fdcc552ba` | 2026-09-10 |
| `dati-registri.yaml` | dati-registri — "Servizio dati registri RENTRI" | `rentrigov.movimenti` | `1.0.20260909-1089` | `b60cd40eb0a34ffe22e6d0c4e220f895705abbebdec627cc617c2d1dd641d1ba` | 2026-09-10 |

`tools/rentri-fake/scripts/scarica-contratti.sh` è stato aggiornato: `API_DISPONIBILI` ora è `("formulari" "anagrafiche" "codifiche" "ca-rentri" "dati-registri")`. Una riesecuzione futura dello script riscaricherà anche i tre contratti esistenti (comportamento di progetto, invariato) — in questa sessione i tre file esistenti sono stati ripristinati alla versione committata dopo la generazione del manifest, per non introdurre modifiche non richieste.

## 3. Quali servizi RENTRI esistono, quali contratti abbiamo, cosa manca

**Servizi con OpenAPI pubblicato e scaricato (5/5 noti a oggi):** `formulari`, `anagrafiche`, `codifiche`, `ca-rentri`, `dati-registri`.

**Non esiste (verificato, non solo assunto) un servizio API per l'apertura/vidimazione del registro.** In `dati-registri.yaml` non compare alcun path né schema con "apertura" o "vidimazione" nel nome. L'unico riferimento a "vidimazione" nell'intero servizio è nello schema `EsitoValidaRegistroModel` (uso descrittivo: codici di errore `firmaVidimazioneRegistroNonValidaDettaglio` — riguardano l'esito della *validazione strutturale* di un XML già firmato, non un'operazione di apertura/vidimazione tramite API). Non ci sono evidenze — né in questo contratto né altrove nel repository — di un endpoint che apra o vidimi un registro; l'ipotesi più coerente con quanto letto è che l'apertura/vidimazione avvenga sul portale RENTRI come atto preliminare (analogo al boarding umano richiesto da `ca-rentri` per le credenziali di firma), non tramite API dati-registri. Questo resta un'ipotesi, non un fatto verificato: nessuna fonte letta oggi lo conferma esplicitamente.

**Ancora mancante/non pubblico**: nessun endpoint documentato per creare o elencare i registri stessi (solo per operare su un `identificativo_registro` già esistente, pattern `^R[0-9A-Z]{10}$`).

## 4. Indice di `dati-registri.yaml` per il registro cronologico

`x-api-id: rentrigov.movimenti`, server demo `https://demoapi.rentri.gov.it/dati-registri/v1.0`.

### Path, raggruppati per area

**Stato/servizio**
- `GET /status` — stato del servizio
- `GET /{identificativo_registro}/last-transazione-id` — ultimo riferimento transazione
- `GET /{transazione_id}/status`, `GET /{transazione_id}/result` — polling asincrono di una transazione di scrittura

**Area Operatore** (`/operatore/{identificativo_registro}/...`)
- `GET`/`POST /movimenti` — lettura filtrata (con paging via header `Paging-Page`/`Paging-PageSize`) e scrittura registrazioni (array `MovimentoModel` | `AnnullamentoMovimentoModel`, max 1000 elementi, risposta `202` asincrona con `TransazioneModel`, oppure callback su `X-ReplyTo`)
- `GET /movimenti/count` — conteggio con gli stessi filtri
- `GET /movimento/{anno}/{progressivo}`, `GET /movimento/{identificativo_movimento}` — lettura puntuale
- `POST /valida` — validazione strutturale di un file XML/ZIP del registro (`ValidaRegistroRequest`: `file_content` Base64, max 10 MB, `nome_file`, `mime`)
- `GET /transazioni/movimenti/{num_iscr_sito}` (+ `/{identificativo_transazione}`, + `/request`) — storico transazioni per unità locale

**Area Soggetto delegato** (`/soggetto-delegato/...`) — stessi endpoint dell'Operatore, replicati per chi opera per conto terzi (parametro aggiuntivo `num_iscr_ass`, numero iscrizione dell'associazione/delegato)

### Modelli principali (`components/schemas`)

- `MovimentoModel` — la registrazione: richiede `riferimenti` (`DatiRiferimentiModel`); poi, secondo `causale_operazione`, uno tra `rifiuto`/`materiali`/`integrazione_fir`/`esito`; più `produttore`, `trasportatore`, `destinatario`, `intermediari[]` (array — il singolo `intermediario` è deprecato).
- `DatiRiferimentiModel` — **la catena dei riferimenti**: `numero_registrazione` (anno+progressivo), `data_ora_registrazione`, `causale_operazione` (enum: `DT, NP, T*, RE, I, aT, M, TR, T*aT`), `numero_registrazione_rettifica` (per le rettifiche, riferimento alla registrazione originale), `riferimento_operazione[]` (array di riferimenti a registrazioni associate, identificate per anno+progressivo o per identificativo RENTRI — può referenziare anche registrazioni non ancora trasmesse).
- `AnnullamentoMovimentoModel` — annullamento di una registrazione esistente.
- `TransazioneModel` / `InfoTransazioneModel` / `StatoTransazione` / `TipoTransazione` — ciclo di vita della scrittura asincrona (accettata → in elaborazione → esito).
- `EsitoMovimentiModel` / `EsitoMovimentiDataModel` / `EsitoMessaggioModel` — payload della callback di fine elaborazione e degli esiti per singola registrazione.
- `EsitoValidaRegistroModel` / `EsitoValidaRegistroDataModel` — esito della validazione strutturale via `/valida`, con dettaglio errori di firma (`identificativo_firma`, `ca_firma`, `firma_non_etsi`) e un catalogo di codici di errore sulla firma (`CertificatoScaduto`, `CertificatoRevocato`, `FirmaCertificatoNonValida`, `FileNonFirmatoConSHA256`, ecc.) — questa è l'unica traccia di verifica firma nel contratto: il servizio **valida** una firma già apposta, non la produce.
- `ValidaRegistroRequest` — upload Base64 del file XML/ZIP del registro cronologico (max 10 MB) per validazione strutturale.
- Anagrafiche di dominio riusate da `formulari`: `DatiProduttoreModel`, `DatiTrasportatoreModel`, `DatiDestinatarioModel`, `DatiIntermediarioModel`, `DatiRifiutoModel`, `DatiMaterialiModel`, `ComuneModel`, `IndirizzoModel`.

### Differenze principali rispetto al contratto `formulari`

1. **Non è un servizio di firma**: chi scrive un movimento non firma nulla tramite `dati-registri`; l'unico oggetto relativo alla firma è di sola *validazione* di un file già firmato (`/valida`, `EsitoValidaRegistroModel`), con codici di errore che presuppongono XMLDSig/ETSI (`firma_non_etsi`, `CertificatoScaduto`, ecc.) — coerente con l'obiettivo del progetto (registro firmato XMLDSig) ma la produzione della firma non è coperta qui: per firmare va usato `ca-rentri` (`/signatures/sign-hash`) come già fatto per i formulari.
2. **Scrittura sempre asincrona**: ogni `POST /movimenti` risponde `202` con un `TransazioneModel` e un identificativo da interrogare (`GET /{transazione_id}/status|result`) oppure una callback su `X-ReplyTo`; `formulari` non ha questo pattern per le operazioni equivalenti (verificare, non assunto per omissione — controllo puntuale non rifatto qui).
3. **Catena dei riferimenti esplicita nel modello dati**: `DatiRiferimentiModel.riferimento_operazione[]` e `numero_registrazione_rettifica` sono il meccanismo con cui una registrazione referenzia le precedenti (carico→scarico, rettifiche) — è il pezzo che nel problema è descritto come "catena dei riferimenti precedenti".
4. **Due ruoli paralleli**: ogni endpoint di scrittura/lettura esiste sia sotto `/operatore/` sia sotto `/soggetto-delegato/` (con `num_iscr_ass` in più) — un raddoppio di superficie che `formulari` non ha nella stessa forma.
5. **Nessun endpoint di apertura/vidimazione**: a differenza di quanto ipotizzabile dal nome "registro", non c'è un `POST` che crei o vidimi un `identificativo_registro`; il contratto assume il registro già esistente (path `{identificativo_registro}` sempre in ingresso, mai restituito da una `POST` di creazione).

## 5. Cosa resta fuori da questa ricognizione

- Il contratto `ca-rentri.yaml` (nodo di firma/credenziali, `x-api-id: rentrigov.sign`) è stato scaricato ma non è oggetto di analisi approfondita in questo documento: è già in parte descritto in `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`. I suoi path (`/credentials*`, `/signatures/sign-hash`, `/devices*`, `/ca/{num_seriale_ca_cert}` + `/crl`) sono elencati nello YAML per chi implementerà la firma XMLDSig del registro.
- Non è stata condotta ricerca sulla documentazione "eventi"/PDF di formazione RENTRI oltre a quanto già presente nell'ADR citato: questa ricognizione si è limitata a interrogare l'endpoint OpenAPI e a leggere i documenti già nel repository.
- Nessuna richiesta è stata fatta al supporto RENTRI: la verifica è puramente tramite gli endpoint pubblici demo.
