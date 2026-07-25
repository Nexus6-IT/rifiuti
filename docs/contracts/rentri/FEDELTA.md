# Fedeltà della fake API rispetto ai contratti ufficiali

**Auditor:** agente indipendente (Task 10) · **Data:** 2026-07-25 · **Contratti:** `formulari.yaml` v`1.0.20260723-1089` (SHA-256 `6413c3c1…71dbf`, cfr. `MANIFEST.md`)

Questo documento è redatto da un agente diverso da chi ha implementato la fake (Task 2-9).
Il criterio non è «la fake funziona», ma **«dove la fake è più permissiva del vero»**.
Tutte le affermazioni sono state verificate eseguendo l'implementazione, non solo leggendola:
i riscontri sono riportati nell'appendice «Riscontri sperimentali».

---

## 1. Superficie realmente esposta dalla fake

Estratta da `tools/rentri-fake/src/` (Fastify), prefisso `/formulari/v1.0`:

| Rotta registrata | Corrispondenza nel contratto |
|---|---|
| `GET /formulari/v1.0/` | `/` GET (Elenco formulari) |
| `GET /formulari/v1.0/:identificativo` | `/{numero_fir}` GET (Dettaglio FIR) |
| `GET /formulari/v1.0/:identificativo/status` | `/{transazione_id}/status` GET |
| `GET /formulari/v1.0/:identificativo/result` | `/{transazione_id}/result` GET |
| `POST /formulari/v1.0/:identificativo/trasmissione` | **nessuna** — rotta inesistente nel contratto |
| `GET/POST /token` → 404 esplicito | fuori contratto, **deliberato e corretto** |
| `GET /__salute`, `POST /__controllo/*` | apparato di prova, fuori contratto, riconoscibile |

I validatori xFIR (`src/xfir/validatore-asice.ts`, `validatore-xades.ts`) esistono come libreria
ma **non sono agganciati ad alcuna rotta HTTP**: `/xfir/valida`, `/{numero_fir}/xfir` e
`/copia-digitale/caricamento/{numero_fir}` non sono raggiungibili.

---

## 2. Tabella di fedeltà — 65 path ufficiali

Legenda «Direzione»: **P** = più permissiva del contratto (la fake accetta ciò che RENTRI
rifiuterebbe, o insegna al client un contratto che l'ente non ha) · **R** = più restrittiva
(falso allarme) · **L** = lacuna nota (rotta assente).

| Path ufficiale | Metodi | Implementato | Schema conforme | Codici d'errore allineati | Divergenza |
|---|---|---|---|---|---|
| `/` | GET | sì | no | no | **P** — nessun parametro di query è letto né richiesto: il contratto impone `num_iscr_sito` **oppure** `identificativo_soggetto` (400 in loro assenza) e definisce 11 filtri più gli header `Paging-Page`/`Paging-PageSize`. La fake risponde 200 a una richiesta nuda e non emette gli header `Paging-*`. Il corpo è `{numero_fir, stato, produttore}` contro `FormularioItemResult` (23+ proprietà). Mancano 400/403/429/423. |
| `/` | POST | **no** | — | — | **L+P** — la creazione asincrona ufficiale del FIR (202 + `TransazioneModel` + header `Location`) non esiste nella fake: `POST /formulari/v1.0/` risponde 404 del router. È sostituita di fatto dalla rotta inventata `/{id}/trasmissione` (vedi §3.1). |
| `/{numero_fir}` | GET | parziale | no | no | **P** — il `pattern` del path (`^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$`) non è applicato: `NON-UN-FIR-VALIDO!!` è accettato come chiave di ricerca e produce 404, dove RENTRI produrrebbe 400. Corpo `{numero_fir, stato, produttore}` contro `DettaglioFormulario`. 404 presente ma con corpo `{titolo}` invece di `ProblemDetails`; 400/403/429/423 assenti. |
| `/{numero_fir}` | PUT | no | — | — | **L** |
| `/{numero_fir}/accettazione` | POST | no | — | — | **L** |
| `/{numero_fir}/acquisizione-firma` | POST | no | — | — | **L** — rilevante per P3: è l'endpoint che restituisce `EsitoGetHashPerFirmaModel.digest_to_sign`, unico punto di contatto con la firma crittografica presente nel contratto. |
| `/{numero_fir}/acquisizione-visibilita/{num_iscr_sito}` | POST | no | — | — | **L** |
| `/{numero_fir}/acquisizione/{num_iscr_sito}` | POST | no | — | — | **L** |
| `/{numero_fir}/allegato` | POST | no | — | — | **L** |
| `/{numero_fir}/allegato/{allegato_id}` | GET, DELETE | no | — | — | **L** |
| `/{numero_fir}/annotazione` | POST | no | — | — | **L** |
| `/{numero_fir}/annulla` | POST | no | — | — | **L** |
| `/{numero_fir}/annulla-fir` | POST | no | — | — | **L** |
| `/{numero_fir}/azioni` | GET | no | — | — | **L** |
| `/{numero_fir}/destinatario` | POST | no | — | — | **L** |
| `/{numero_fir}/hash` | POST | no | — | — | **L** — secondo endpoint legato alla firma, assente. |
| `/{numero_fir}/invia-a-dispositivo` | POST | no | — | — | **L** |
| `/{numero_fir}/note-annullamento` | POST | no | — | — | **L** |
| `/{numero_fir}/pdf` | GET | no | — | — | **L** |
| `/{numero_fir}/quantita` | POST | no | — | — | **L** |
| `/{numero_fir}/reset` | POST | no | — | — | **L** |
| `/{numero_fir}/respingi` | POST | no | — | — | **L** |
| `/{numero_fir}/rilascio-visibilita/{num_iscr_sito}` | POST | no | — | — | **L** |
| `/{numero_fir}/rollback-firma` | POST | no | — | — | **L** |
| `/{numero_fir}/sosta-tecnica` | POST | no | — | — | **L** |
| `/{numero_fir}/stato` | GET | no | — | — | **L** |
| `/{numero_fir}/trasbordo-parziale` | POST | no | — | — | **L** |
| `/{numero_fir}/trasbordo-totale` | POST | no | — | — | **L** |
| `/{numero_fir}/trasporto` | POST | no | — | — | **L** |
| `/{numero_fir}/xfir` | GET, POST | no | — | — | **L** — il validatore xFIR esiste in libreria ma non è esposto qui. |
| `/{transazione_id}/result` | GET | parziale | no | **no** | **P** — il contratto prescrive **400** «Richiesta non ancora elaborata» (`application/problem+json`); la fake risponde **409** con `{titolo, dettaglio}`. Il corpo di successo è `{transazione_id, risultato}` contro `EsitoFormularioModel` (`esito`, `tipo`, `transazione_id`, `validazione[]`, `errore`, `tempo_elaborazione`): **manca il flag `errore` e l'array `validazione`**, cioè proprio i campi con cui il client deve distinguere un esito negativo. `transazione_id` è `TRX-000001`, non un `uuid` come da schema. |
| `/{transazione_id}/status` | GET | parziale | **no** | **no** | **P — la più grave sul piano protocollare.** Il contratto definisce due esiti: **200 = non ancora elaborata** (nessun corpo) e **303 con header `Location`** verso il `/result` quando è pronta. La fake risponde sempre **200 con `{transazione_id, stato}`**, campo `stato` che nel contratto **non esiste**, e non emette mai `Location` né 303. Un client scritto contro questa fake fa polling su un campo inventato e non implementa il salto a 303: passa i test e fallisce in produzione. |
| `/copia-cartacea/{transazione_id}/result` | GET | no | — | — | **L** |
| `/copia-cartacea/{transazione_id}/status` | GET | no | — | — | **L** |
| `/copia-cartacea/caricamento/{num_iscr_sito}` | POST, GET | no | — | — | **L** |
| `/copia-cartacea/caricamento/{num_iscr_sito}/{identificativo}` | GET, DELETE | no | — | — | **L** |
| `/copia-cartacea/caricamento/{num_iscr_sito}/{identificativo}/documento` | GET | no | — | — | **L** |
| `/copia-cartacea/conferma/{identificativo_soggetto}` | GET, PUT | no | — | — | **L** |
| `/copia-cartacea/conferma/{identificativo_soggetto}/{identificativo}` | GET | no | — | — | **L** |
| `/copia-cartacea/conferma/{identificativo_soggetto}/{identificativo}/documento` | GET | no | — | — | **L** |
| `/copia-digitale/{transazione_id}/result` | GET | no | — | — | **L** |
| `/copia-digitale/{transazione_id}/status` | GET | no | — | — | **L** |
| `/copia-digitale/caricamento/{numero_fir}` | POST | no | — | — | **L** — è l'unico caricamento di copia digitale legato al FIR; il validatore ASiC-E non è raggiungibile da qui. |
| `/copia-digitale/caricamento/{num_iscr_sito}` | GET | no | — | — | **L** |
| `/copia-digitale/caricamento/{num_iscr_sito}/{identificativo}` | GET, DELETE | no | — | — | **L** |
| `/copia-digitale/caricamento/{num_iscr_sito}/{identificativo}/documento` | GET | no | — | — | **L** |
| `/copia-digitale/conferma/{identificativo_soggetto}` | GET | no | — | — | **L** |
| `/copia-digitale/conferma/{identificativo_soggetto}/{identificativo}` | GET | no | — | — | **L** |
| `/copia-digitale/conferma/{identificativo_soggetto}/{identificativo}/documento` | GET | no | — | — | **L** |
| `/copia-digitale/conferma/{num_iscr_sito}/{identificativo}` | PUT | no | — | — | **L** |
| `/count` | GET | **no, ma mascherato** | no | no | **P** — la rotta non è implementata, però `GET /formulari/v1.0/count` viene catturata dal segmento generico `/:identificativo` e risponde **404 «Formulario non trovato»**. Il client riceve un errore di dominio plausibile invece di un 404 di rotta: la mancanza è invisibile in fase di sviluppo. |
| `/status` | GET | **no, ma mascherato** | no | no | **P** — stesso meccanismo di `/count`: `GET /formulari/v1.0/status` finisce nel gestore del dettaglio FIR e risponde 404 «Formulario non trovato». Un client che interroghi lo stato del servizio riceve una risposta ingannevole. |
| `/trasmissioni/{num_iscr_sito}` | GET, POST | no | — | — | **L** |
| `/trasmissioni/{num_iscr_sito}/{identificativo}` | GET | no | — | — | **L** |
| `/trasmissioni/{num_iscr_sito}/{identificativo}/annulla` | POST | no | — | — | **L** |
| `/trasmissioni/{num_iscr_sito}/{numero_fir}/estrai` | POST | no | — | — | **L** |
| `/trasmissioni/{transazione_id}/result` | GET | no | — | — | **L** |
| `/trasmissioni/{transazione_id}/status` | GET | no | — | — | **L** |
| `/trasmissioni/operatore/{num_iscr_sito}` | GET, POST | no | — | — | **L** |
| `/trasmissioni/operatore/{num_iscr_sito}/{identificativo}` | GET | no | — | — | **L** |
| `/trasmissioni/operatore/{num_iscr_sito}/{identificativo}/annulla` | DELETE | no | — | — | **L** — nota: qui il contratto usa DELETE, mentre l'omologo `/trasmissioni/{num_iscr_sito}/{identificativo}/annulla` usa POST. Asimmetria reale dell'ente, da non normalizzare quando si implementerà. |
| `/trasmissioni/operatore/{num_iscr_sito}/{numero_fir}/estrai` | POST | no | — | — | **L** |
| `/trasmissioni/soggetto-delegato/{num_iscr_sito}` | GET, POST | no | — | — | **L** |
| `/trasmissioni/soggetto-delegato/{num_iscr_sito}/{identificativo}` | GET | no | — | — | **L** |
| `/trasmissioni/soggetto-delegato/{num_iscr_sito}/{identificativo}/annulla` | DELETE | no | — | — | **L** |
| `/trasmissioni/soggetto-delegato/{num_iscr_sito}/{numero_fir}/estrai` | POST | no | — | — | **L** |
| `/xfir/valida` | POST | **no** | — | — | **L, ma qualificante** — è la validazione dell'xFIR **dell'ente**. La fake possiede un proprio validatore ASiC-E/XAdES ma non lo espone: l'oracolo di P3 non è raggiungibile via HTTP, e la validazione locale non è confrontabile con quella ufficiale. |

**Copertura numerica:** 4 path su 65 implementati (2 pienamente riconoscibili come tali,
2 con protocollo divergente), più **1 rotta inventata** non presente nel contratto,
2 path ufficiali **mascherati** da una rotta generica.

---

## 3. Divergenze in direzione permissiva

Sono le sole che invalidano il valore probatorio della fake: la pipeline che dichiara
«conforme» ciò che la fake accetta propagherebbe ciascuna di queste come difetto del client.

### 3.1 `POST /{numero_fir}/trasmissione` — rotta che non esiste in RENTRI

La fake espone `POST /formulari/v1.0/:identificativo/trasmissione` (202, `{transazione_id}`).
Nessuno dei 65 path ufficiali ha questa forma. La creazione asincrona di un FIR è `POST /`
(202 + `TransazioneModel` + header **`Location`**); le trasmissioni dati vivono sotto
`/trasmissioni/{num_iscr_sito}` e varianti `operatore`/`soggetto-delegato`.

È esattamente il difetto per cui questo audit esiste: l'integrazione attuale fu scritta contro
un'API immaginata, e la fake che dovrebbe correggerla **contiene a sua volta un endpoint
immaginato**. Un client che la usi come oracolo riceverebbe 404 dall'ente al primo invio reale.
La fake inoltre non restituisce l'header `Location` che il contratto prescrive sulla 202, quindi
il client non impara a seguirlo.

### 3.2 Il ciclo asincrono è modellato sul pattern sbagliato

| | Contratto ufficiale | Fake | Effetto |
|---|---|---|---|
| `GET /{transazione_id}/status`, non pronto | **200**, nessun corpo | 200 `{stato:"in_elaborazione"}` | il client impara a leggere un campo inesistente |
| `GET /{transazione_id}/status`, pronto | **303** + header `Location` | 200 `{stato:"completata"}` | il client non implementa mai il redirect: in produzione non trova l'esito |
| `GET /{transazione_id}/result`, non pronto | **400** + `ProblemDetails` | **409** + `{titolo,dettaglio}` | il client gestisce 409 e va in errore non gestito su 400 |
| `transazione_id` | `format: uuid` | `TRX-000001` | un client che validi/normalizzi l'id passa qui e fallisce in produzione |
| corpo di `/result` | `EsitoFormularioModel` con `errore: boolean` e `validazione: EsitoMessaggioModel[]` | `{transazione_id, risultato}` | **il client non impara a leggere l'esito negativo**: una transazione «completata con errori» è indistinguibile da un successo |

Questa è la divergenza a maggiore impatto su P2, perché il ciclo NONBLOCK_PULL è precisamente
ciò che P2 deve riscrivere: la fake ne insegna una versione che l'ente non implementa.

### 3.3 `/count` e `/status` mascherati dal segmento generico

Verificato: `GET /formulari/v1.0/status` e `GET /formulari/v1.0/count` non cadono in un 404 di
rotta, ma nel gestore del dettaglio FIR, che risponde `404 {"titolo":"Formulario non trovato"}`.
Due path ufficiali risultano quindi «esistenti ma vuoti» invece che assenti: una lacuna che si
traveste da comportamento di dominio è peggiore di una lacuna dichiarata.

### 3.4 Autenticazione — direct trust senza alcun ancoraggio di fiducia

Il rilievo del coordinatore è confermato ed è più esteso del previsto. Riscontri diretti su
`verificaJwt`:

| Caso | Esito nella fake | Cosa farebbe RENTRI |
|---|---|---|
| certificato **autofirmato da chiunque**, CN arbitrario, `sub` inventato | **accettato** | rifiuto: il certificato deve essere emesso dalla CA RENTRI e riferibile a un operatore accreditato, e il `sub` deve corrispondere a un soggetto iscritto |
| certificato **scaduto da 300 giorni** | **accettato** | rifiuto (`importX509` di `jose` non verifica `notBefore`/`notAfter`, e nulla lo fa a valle) |
| token **senza `exp`, `iat`, `jti`, `iss`** | **accettato**, e non scade mai | rifiuto: ModI ID_AUTH_REST_02 impone `iss`, `aud`, `iat`, `exp` (finestra breve) e `jti` anti-replay |
| `alg: none` | respinto — ma dal messaggio d'errore di `jose`, non da un controllo | rifiuto esplicito |
| `alg: PS256` (≠ RS256 atteso) | **accettato** | l'algoritmo va vincolato |

**Peso sul valore probatorio:** massimo. La fake dimostra soltanto che il client sa *comporre*
un JWT con un `x5c`; non dimostra nulla su ciò che il RENTRI verifica davvero — provenienza del
certificato, validità temporale, accreditamento del soggetto, non-rigiocabilità. In `direct
trust` l'unico controllo che conta è **da chi** viene il certificato, ed è precisamente quello
assente. Un client con un certificato di test autofirmato, un token perpetuo e nessun `jti`
supererebbe l'intera suite: P3 (firma) partirebbe da un oracolo che non distingue una credenziale
accreditata da una fabbricata sul momento.

### 3.5 Validazione xFIR — la copertura si può soddisfare a vuoto

Riscontri diretti su `validaAsicE`:

- **riferimento pendente**: container con `xml=[a.xml]` e firma che copre `[a.xml, fantasma.xml]`
  → **valido**. `verificaCopertura` controlla solo l'inclusione `xmlPresenti ⊆ riferimenti`, mai
  il verso opposto. Una firma che dichiara di coprire un file assente dal container è, per
  qualunque validatore ASiC-E conforme (ETSI EN 319 162), **invalida**: il `Reference` non è
  risolvibile e il digest non è verificabile.
- **copertura vacua**: container con **zero** XML e una sola firma che non copre nulla →
  **valido**. Un xFIR privo del documento firmato viene accettato.
- **digest mai verificato**: `estraiRiferimenti` legge solo gli attributi `URI`; il
  `DigestValue` (nei test è la stringa `x`) non è confrontato con il contenuto, e la firma
  crittografica non è verificata affatto. La fake accetta quindi un container in cui **nessun
  byte è realmente firmato**.
- il `mimetype` è controllato nel contenuto ma non nei vincoli ASiC-E di posizione
  (primo elemento dell'archivio, non compresso).

Sommando 3.4 e 3.5: per P3 la fake attesta «firma valida» in casi in cui non esiste né una
identità verificata né una firma verificata.

### 3.6 Formato degli errori e codici mai emessi

Il contratto usa `application/problem+json` con `ProblemDetails` (`type`, `title`, `status`,
`detail`, `instance`). La fake risponde `application/json` con `{titolo, dettaglio}` — chiavi
italiane che **non esistono in nessuno schema del contratto**. Un client che sappia leggere gli
errori della fake non sa leggere quelli dell'ente.

Codici dichiarati su ogni operazione e **mai emessi** dalla fake: **403** (operazione non
consentita — l'intera dimensione autorizzativa, incarichi e visibilità per unità locale, è
assente), **429** con header `Retry-After` (>100 richieste in 5 s), **423** (ban del chiamante
per eccesso di richieste non valide), **400** di validazione. La fake emette invece **401**, che
il contratto non documenta su alcuna operazione. Il canale `/__controllo/guasto` consente di
iniettare uno stato arbitrario, ma è una simulazione pilotata dal test, non un comportamento che
il client debba scoprire: non sostituisce l'aderenza.

### 3.7 Nessun controllo di integrità, e nessun disclaimer nel codice

`ACCERTAMENTI.md` documenta correttamente che gli OpenAPI scaricati non dichiarano `Digest` né
`Agid-JWT-Signature`, e che INTEGRITY_REST_01 non è quindi verificabile da questi contratti. La
scelta di non imporlo è difendibile; è però un'ipotesi non provata, e la fake non ne lascia
traccia a runtime. Da riverificare con le credenziali demo.

### 3.8 `audience` non derivabile dal contratto

La fake attende `aud = rentrigov.demo.api` (`RENTRI_AUDIENCE`). Il contratto riporta
`x-api-id: rentrigov.formulari` e `server: https://demoapi.rentri.gov.it/formulari/v1.0`; il
valore atteso dall'ente non è desumibile da qui. Se l'audience reale differisse, i client
validati contro la fake fallirebbero l'autenticazione al primo contatto — e il difetto sarebbe
attribuito all'ente, non alla fake.

---

## 4. Divergenze in direzione restrittiva

Producono falsi allarmi: meno gravi, ma vanno corrette perché fanno perdere fiducia nell'oracolo.

1. **`/result` risponde 409 anziché 400** mentre l'elaborazione è in corso (già in §3.2): un
   client corretto, che gestisce il 400 previsto dal contratto, viene segnalato come difettoso.
2. **401 su credenziale mancante o non valida** dove il contratto documenta 403: un client che
   ramifichi sul 403 dell'ente appare non conforme alla fake.
3. **Elenco formulari sempre vuoto**: `Archivio` nasce vuoto e nessuna rotta popola i formulari
   (`salvaFormulario` non è invocata da alcun gestore). Il solo modo per ottenere un formulario
   è… non esiste. Ogni scenario di lettura è quindi verificabile solo nel ramo «assente».
4. **Il canale `/__controllo/guasto` consuma un'occorrenza anche su richieste che non arrivano
   ai gestori** (l'hook `onRequest` è globale): il conteggio `volte` può essere speso da traffico
   collaterale, rendendo i test intermittenti sotto concorrenza.

---

## 5. Verdetto

**Copertura:** **4 path su 65** implementati — di cui 2 con protocollo divergente — più 1 rotta
inventata e 2 path ufficiali mascherati da una rotta generica.

**Idoneità come oracolo: NON IDONEA** per le pipeline P2 (riscrittura integrazione RENTRI) e P3
(firma).

Il giudizio **non** dipende dal numero di endpoint mancanti: un sottoinsieme dichiarato è una
scelta legittima. Dipende dal fatto che **ciò che c'è mente su tre punti che sono esattamente
l'oggetto di P2 e P3**:

- il ciclo asincrono (200/303+`Location` → 400 sul result) è modellato su un protocollo diverso
  da quello dell'ente, e P2 deve riscrivere proprio quello;
- l'endpoint su cui la fake fa transitare l'invio non esiste nel contratto: si ripeterebbe,
  validato, lo stesso errore che ha reso non conforme l'integrazione attuale;
- l'autenticazione e la validazione xFIR accettano credenziali fabbricate e firme che non
  firmano nulla: P3 partirebbe da un oracolo che non sa dire di no.

Una fake permissiva su questi punti non è neutra: **certifica**. Il rischio non è che le pipeline
falliscano, è che riescano.

### 5.1 Correzioni necessarie prima dell'avvio di P2

Bloccanti, in ordine di priorità:

1. **Rimuovere `POST /{numero_fir}/trasmissione`** e sostituirla con `POST /` (Crea FIR):
   202, corpo `TransazioneModel` con `transazione_id` in **formato uuid**, header **`Location`**
   verso `/{transazione_id}/status`.
2. **Riportare `/status` al contratto**: 200 senza corpo mentre è in elaborazione, **303 con
   header `Location`** quando l'esito è disponibile. Eliminare il campo `stato`, che non esiste.
3. **Riportare `/result` al contratto**: **400** (non 409) se non ancora elaborata, con
   `application/problem+json`; corpo di successo aderente a `EsitoFormularioModel`, con almeno
   `errore: boolean` e `validazione: []`, così che il client sia costretto a gestire l'esito
   negativo.
4. **Adottare `ProblemDetails`** (`type`/`title`/`status`/`detail`/`instance`) e
   `application/problem+json` su tutti gli errori; abbandonare `{titolo, dettaglio}`.
5. **Applicare i vincoli dichiarati nel contratto**: `pattern` di `numero_fir` (→ 400, non 404);
   obbligo di `num_iscr_sito` **oppure** `identificativo_soggetto` su `GET /` (→ 400); header
   `Paging-*` in risposta.
6. **Registrare `/count` e `/status` esplicitamente**, anche solo come 501 riconoscibile, per
   togliere il mascheramento del segmento generico. In generale: ogni path non implementato deve
   rispondere in modo distinguibile da un errore di dominio.
7. **Rendere popolabile l'archivio** (via canale `__controllo`), altrimenti nessuno scenario di
   lettura positiva è verificabile.
8. **Emettere 403/429/423** almeno negli scenari pilotabili dal canale di controllo, e allineare
   il codice usato per la credenziale non valida a quanto documentato.

### 5.2 Correzioni necessarie prima dell'avvio di P3

1. **Verificare la catena del certificato in `x5c`**: emesso da una CA attesa (nella fake, una CA
   di prova esplicita e fissa) e **non scaduto**. Un certificato autofirmato al volo deve essere
   respinto: è la premessa dell'intero valore probatorio in direct trust.
2. **Vincolare l'algoritmo** con `algorithms: ['RS256']` in `jwtVerify`, così che il rifiuto di
   `alg: none` sia un controllo e non un effetto collaterale del parsing, e `PS256` non passi.
3. **Esigere e verificare le claim ModI**: `iss`, `aud`, `iat`, `exp` (finestra breve, es. 5
   minuti) e `jti` con rifiuto del riutilizzo. Un token perpetuo deve essere respinto.
4. **Legare il `sub`/`iss` a un elenco di soggetti accreditati** noto alla fake: oggi qualunque
   stringa è un operatore valido.
5. **Correggere la regola di copertura xFIR nei due versi**: nessun `Reference` deve puntare a un
   file assente dal container (riferimento pendente → invalido) e un container senza XML firmati
   deve essere invalido.
6. **Verificare almeno il `DigestValue`** rispetto al contenuto referenziato, e la firma
   crittografica rispetto al certificato del firmatario. Senza questo, «xFIR valido» non
   significa nulla.
7. **Esporre `POST /xfir/valida`** (e `/{numero_fir}/xfir`) come rotte HTTP: è l'endpoint di
   validazione **dell'ente**, ed è ciò che P3 deve poter interrogare. Finché resta libreria
   interna, la validazione dell'xFIR non è confrontabile con quella ufficiale.

### 5.3 Cosa la fake fa già bene, e va conservato

- **`/token` risponde 404 con motivazione esplicita.** È la correzione più importante già
  presente: rende impossibile riprodurre l'errore OAuth2 dell'integrazione attuale.
- **L'apparato di prova ha un prefisso riconoscibile** (`__controllo`, `__salute`) che non può
  essere scambiato per un endpoint reale.
- **La transazione non si completa da sola**: costringe il client a implementare davvero il
  polling, invece di ottenere l'esito al primo colpo.
- **Le decisioni sono documentate nel codice** con il riferimento al contratto, e
  `ACCERTAMENTI.md` registra onestamente ciò che i contratti *non* dicono (integrità, API
  registri) invece di inventarlo.

---

## Appendice — Riscontri sperimentali

Ottenuti eseguendo `creaApp()`, `verificaJwt()` e `validaAsicE()` con `ts-node` su
`tools/rentri-fake` (nessuna modifica al codice sorgente della fake; script di sonda eliminato
dopo l'esecuzione).

```
certificato autofirmato sconosciuto  -> { valido: true, soggetto: 'SOGGETTO-INVENTATO' }
token senza exp/iat/jti/iss          -> { valido: true, soggetto: 'S' }   (HTTP 200)
certificato scaduto da 300 giorni    -> { valido: true, soggetto: 'S' }
alg = none                           -> respinto (messaggio di jose, non controllo dedicato)
alg = PS256                          -> { valido: true, soggetto: 'S' }
xFIR: xml=[a.xml], firma copre [a.xml, fantasma.xml] -> valido
xFIR: xml=[], firma copre []                          -> valido
GET /formulari/v1.0/            (senza query)  -> 200 [] , nessun header Paging-*
GET /formulari/v1.0/NON-UN-FIR-VALIDO!!        -> 404 {"titolo":"Formulario non trovato"}
GET /formulari/v1.0/status                     -> 404 {"titolo":"Formulario non trovato"}
GET /formulari/v1.0/count                      -> 404 {"titolo":"Formulario non trovato"}
POST /formulari/v1.0/               (Crea FIR ufficiale) -> 404 di rotta
POST /formulari/v1.0/XXXX1Y/trasmissione -> 202 {"transazione_id":"TRX-000001"}, nessun Location
GET  .../TRX-000001/status  (in corso)   -> 200 {"stato":"in_elaborazione"}, nessun Location
GET  .../TRX-000001/result  (in corso)   -> 409 application/json
GET  .../TRX-000001/status  (completa)   -> 200 {"stato":"completata"}, nessun 303, nessun Location
GET  .../TRX-000001/result  (completa)   -> 200 {"transazione_id","risultato"}  (no errore/validazione)
POST /formulari/v1.0/xfir/valida         -> 404 di rotta
GET  /formulari/v1.0/ senza Authorization -> 401 application/json {"titolo","dettaglio"}
```

---

## 6. Secondo giro di audit

**Auditor:** secondo agente indipendente (non ha implementato la fake, non ha partecipato al primo
giro) · **Data:** 2026-07-25 · **Oggetto:** verificare se il verdetto **NON IDONEA** di §5 può
essere ribaltato dopo il giro correttivo (commit `16c940c`…`3cd0d75`).

Criterio invariato: non «la fake funziona», ma **«dove la fake è più permissiva del contratto»**.
Ogni riga della tabella è stata verificata contro `formulari.yaml` e contro il comportamento reale
del servizio (`creaApp()` + `app.inject()`, script di sonda eliminato dopo l'uso), non contro i
test né contro i messaggi di commit.

### 6.1 Esito dei 15 punti bloccanti

#### §5.1 — pipeline P2 (riscrittura integrazione RENTRI)

| # | Correzione richiesta | Esito | Evidenza |
|---|---|---|---|
| 1 | Rimuovere `POST /{numero_fir}/trasmissione`, sostituirla con `POST /` (202, `transazione_id` uuid, `Location`) | **chiuso** | `POST /formulari/v1.0/TSTB12345XY/trasmissione` → **404 di rotta**; `POST /formulari/v1.0/` → **202**, `transazione_id` uuid, `Location: /formulari/v1.0/{id}/status`. Conforme a `formulari.yaml` righe 187-265. |
| 2 | `/status`: 200 senza corpo, **303 + `Location`** a esito pronto, nessun campo `stato` | **chiuso** | in elaborazione → `200`, corpo vuoto, nessun `Location`; dopo `__controllo/completa-transazione` → `303` + `Location: …/result`. Conforme a righe 2847-2897. |
| 3 | `/result`: **400** `problem+json` se non elaborata; corpo con `errore` e `validazione` | **chiuso** | in corso → `400 application/problem+json`; completata → `200 {transazione_id, esito, tipo, validazione, errore, tempo_elaborazione}`. Conforme a righe 2801-2846 e a `EsitoFormularioModel`. |
| 4 | `ProblemDetails` + `application/problem+json` su **tutti** gli errori | **parziale** | Vero per tutti gli errori di dominio. **Non** per quelli generati da Fastify: `404` di rotta → `{"message":…,"error":"Not Found","statusCode":404}`; JSON malformato → `400 {"statusCode":400,"error":"Bad Request",…}`; corpo oltre il limite → `413 {"code":"FST_ERR_CTP_BODY_TOO_LARGE"}` — tutti `application/json`. `GET/POST /token` risponde tuttora `{titolo, dettaglio}`, le chiavi italiane che il punto 4 chiedeva di abbandonare (qui è fuori contratto, ma è l'unico residuo). |
| 5 | Applicare i vincoli: `pattern` di `numero_fir` (→400), `num_iscr_sito` **o** `identificativo_soggetto` (→400), header `Paging-*` | **parziale** | Pattern applicato (`NON-UN-FIR-VALIDO!!` → **400**, non più 404); obbligo dei due parametri applicato; header `Paging-*` emessi **ma cosmetici**: con `Paging-Page: 2`, `Paging-PageSize: 2` su 5 formulari la fake dichiara `Paging-PageCount: 3` e **restituisce tutti e 5 gli elementi**. Gli altri filtri di query dichiarati dal contratto (`numero_fir`, `stato`, date…) non sono letti: `?numero_fir=INESISTENTE` restituisce comunque l'elenco intero. |
| 6 | Registrare `/count` e `/status` esplicitamente, non mascherati dal segmento generico | **chiuso** | entrambi → **501** `problem+json` con `title: "Non implementato nella fake"`, distinguibile da un 404 di dominio. |
| 7 | Rendere popolabile l'archivio | **chiuso** | `POST /__controllo/formulario` popola; `GET /{numero_fir}` restituisce **200** con il formulario. Lo scenario di lettura positiva è ora verificabile. |
| 8 | Emettere 403/429/423, allineare il codice della credenziale non valida | **chiuso (nella lettera)** | credenziale assente/non valida → **403** `problem+json` (mai più 401); 429 iniettabile **con `Retry-After`**; 423 iniettabile. Riserva: il 403 copre solo l'autenticazione — la dimensione **autorizzativa** (incarichi, visibilità per unità locale) resta inesistente, e 429/423 esistono solo se iniettati. |

#### §5.2 — pipeline P3 (firma)

| # | Correzione richiesta | Esito | Evidenza |
|---|---|---|---|
| 1 | Verificare la catena dell'`x5c` verso una CA di prova fissa, e la scadenza | **chiuso** | `src/auth/ca-test.ts` introduce una CA di prova memoizzata; `verificaCatenaCertificato` rifiuta l'autofirmato, il certificato di **altra CA** (caso distinto, corretto) e quello scaduto da 300 giorni — tutti casi che §3.4 documentava come accettati. |
| 2 | Vincolare l'algoritmo a RS256 | **chiuso** | `jwtVerify(..., algorithms: ['RS256'])`: `alg: none` e `PS256` rifiutati per controllo, non per effetto del parsing. |
| 3 | Claim ModI (`iss`,`aud`,`iat`,`exp`, finestra breve) e `jti` anti-replay | **chiuso** | `requiredClaims: ['sub','iss','iat','exp','jti']`, finestra massima 300 s, registro `jti` condiviso via `Archivio`. Verificato **via HTTP**: stesso token su due richieste → `200` poi `403`. |
| 4 | Legare **`sub`/`iss`** a un elenco di soggetti accreditati | **parziale** | Solo `sub` è confrontato con `soggetti-accreditati.ts`. `iss` è **richiesto ma mai verificato**: un token con `iss: "chiunque-mai-visto"` e `sub: "operatore-test"` è accettato (`{valido:true}`). In ModI l'`iss` è l'identità del fruitore ed è la chiave su cui l'ente applica il ban 423: resta una stringa libera. |
| 5 | Copertura xFIR nei due versi (riferimento pendente, copertura vacua) | **chiuso** | `verificaCopertura` rifiuta i `Reference` verso file assenti e i container privi di XML; entrambi i casi di §3.5 sono ora invalidi. |
| 6 | Verificare `DigestValue` e la firma crittografica | **parziale** | Digest e `SignatureValue` sono ora verificati davvero (casi negativi riprodotti). Restano tre buchi: (a) la firma è calcolata sui **byte grezzi** della sottostringa `<ds:SignedInfo>` — limite dichiarato, ma implica che qualunque differenza di serializzazione XML rispetto a un firmatario reale produca un falso negativo, e che la fake non sia confrontabile con un validatore ETSI; (b) **nessuna ancora di fiducia per il firmatario**: un certificato autofirmato a 1024 bit generato al momento produce `{valido:true}` — è lo stesso difetto di §3.4, spostato dal livello di autenticazione a quello della firma, cioè esattamente l'oggetto di P3; (c) `CanonicalizationMethod`/`SignatureMethod`/`DigestMethod` non sono né richiesti né letti: SHA-256 è assunto, e un `SignedInfo` che non li dichiara affatto (come quello prodotto dall'aiuto di test) è accettato. |
| 7 | Esporre `POST /xfir/valida` e `/{numero_fir}/xfir` | **chiuso** | entrambe registrate: 202 + `TransazioneModel` uuid + `Location`; 400 `problem+json` su corpo non conforme a `ValidaXfirModel`/`UploadXfirModel`; esito consultabile via `/result` con `errore`/`validazione`. Restano fuori: `GET /{numero_fir}/xfir` (Download xFIR, **404 di rotta**) e la coerenza fra `numero_fir` del path e contenuto del container, richiesta dal contratto. |

**Conteggio: 11 punti chiusi su 15, 4 parziali, 0 non chiusi.** Nessuno dei 15 è risultato «solo
dichiarato»: ogni correzione ha un riscontro comportamentale, non solo un test verde.

### 6.2 Regressioni introdotte dal giro correttivo

1. **La suite di prova è diventata non deterministica.** L'anti-replay ha imposto un token fresco
   per ogni richiesta HTTP, e `tokenValido()` genera **una nuova coppia RSA a 2048 bit di
   `node-forge` (JS puro, sincrono) ad ogni chiamata**. `jest.setTimeout(30000)` è stato aggiunto
   a `jwt-verifier.test.ts` e `xfir.test.ts`, ma **non** a `transazioni.test.ts`,
   `controllo.test.ts`, `formulari.test.ts`, `rotte-xfir.test.ts`, che pure creano 2-3 token per
   test. Prima esecuzione di `npx jest --runInBand`: **3 fallimenti su 62** (`transazioni.test.ts`,
   «Exceeded timeout of 5000 ms»); esecuzione successiva: 62/62 verdi. Un oracolo la cui suite
   passa o fallisce secondo il carico della macchina non può essere usato come gate: il verde non
   è prova. Correzione minima: `jest.setTimeout` uniforme e riuso di un certificato per suite,
   variando solo il `jti`.
2. **Il principio «la transazione non si completa da sola» (§5.3) è stato eroso.** Le rotte xFIR
   completano la transazione **dentro la richiesta stessa**: il primo `GET …/status` risponde
   subito `303`, e il ramo «200 senza corpo, non ancora pronto» non è mai esercitato su quel
   percorso. La scelta è documentata nel codice e argomentata, ma il risultato è che un client che
   **non** implementi l'attesa supera comunque le prove sull'unico percorso che P3 userà davvero.
3. Nessuna regressione riscontrata nelle asserzioni dei test preesistenti: gli aggiornamenti per
   l'anti-replay (`controllo`, `formulari`, `transazioni`) si limitano a rigenerare le
   intestazioni ad ogni `inject()`; nessuna asserzione è stata rilassata, indebolita o rimossa, e
   i casi negativi aggiunti sono genuini (certificato di altra CA distinto dall'autofirmato,
   `SignatureValue` alterato di un solo byte senza toccare i digest).

### 6.3 Nuove divergenze permissive scoperte in questo giro

| # | Divergenza | Peso |
|---|---|---|
| N1 | **`POST /` accetta qualunque corpo.** `{}`, `{pippo:1}`, **nessun corpo**, perfino `Content-Type: text/plain` → **202**. Il contratto dichiara `requestBody: required: true` con `NuovoFormularioModel` e un **400** «modello dati non valido». Poiché inoltre la transazione non si completa da sola, **la fake non valida mai il FIR inviato**: l'intero percorso di scrittura di P2 è privo di oracolo. Il ramo 400 di validazione del modello non è raggiungibile su nessuna rotta di creazione. | **alto (P2)** |
| N2 | **Nessuna ancora di fiducia per il firmatario xFIR** (v. §6.1 P3-6b). «xFIR valido» significa oggi «internamente coerente», non «firmato da un certificato riferibile a un firmatario riconosciuto». | **alto (P3)** |
| N3 | **Il limite dimensionale è sbagliato in entrambi i sensi.** Il contratto ammette xFIR fino a **3 MB**; la fake non lo applica, ma eredita il `bodyLimit` di default di Fastify (**1 MB**): un `xfir` da 1,4 MB → **413** `FST_ERR_CTP_BODY_TOO_LARGE` in `application/json`. È insieme **più restrittiva** (rifiuta a 1 MB ciò che l'ente accetta fino a 3 MB) e **non conforme** nel formato d'errore. Un xFIR realistico è facilmente sopra il megabyte: è un falso allarme che colpirà P3 al primo container vero. | **medio-alto (P3)** |
| N4 | **`Paging-*` dichiara una paginazione che non esiste** (v. §6.1 P2-5). Header presenti ma non onorati: peggiore di header assenti, perché un client che li implementi correttamente vede dati coerenti solo per caso. | **medio (P2)** |
| N5 | **`iss` mai verificato** (v. §6.1 P3-4). | **medio** |
| N6 | **`codice_blocco` non validato**: il contratto lo vincola a `^[BCDFGHJKLMNPQRSTVWXYZ]{4,6}$`; `?codice_blocco=AEIOU123` → 202. Analogamente `X-ReplyTo` è accettato e ignorato, mentre nel contratto la sua presenza **sopprime** l'header `Location` sulla 202: un client che lo usi impara qui un comportamento che l'ente non ha. | basso-medio |
| N7 | **`transazione_id` non validato come uuid** in `/status` e `/result` (il contratto lo dichiara `format: uuid`, con 400 documentato): `GET /pippo/status` → 404 di dominio invece di 400 di validazione. È lo stesso errore di categoria che §5.1 punto 5 aveva corretto su `numero_fir`, rimasto sulle rotte di transazione. | basso |
| N8 | **§4.4 non corretto**: l'hook `onRequest` è ancora globale e consuma il guasto anche su richieste che non arrivano ad alcun gestore. Verificato: con `volte: 1`, una `GET /rotta/inesistente` si prende il 503 e la successiva richiesta di dominio risponde 200. I test di guasto restano fragili sotto concorrenza. | basso |

### 6.4 Cosa §5.3 chiedeva di conservare — verifica

| Elemento da conservare | Stato |
|---|---|
| `/token` risponde 404 con motivazione esplicita | **conservato** (corpo tuttora `{titolo, dettaglio}`, unico residuo delle chiavi italiane) |
| Prefisso riconoscibile dell'apparato di prova (`__controllo`, `__salute`) | **conservato**, ed esteso con `__controllo/formulario` — coerente |
| La transazione non si completa da sola | **conservato per `POST /`, perso per le rotte xFIR** (v. §6.2 punto 2) |
| Decisioni documentate nel codice con riferimento al contratto; `ACCERTAMENTI.md` onesto su ciò che i contratti non dicono | **conservato e migliorato**: ogni correzione cita riga e componente di `formulari.yaml`, e i limiti (C14N, 3 MB) sono dichiarati nel codice invece che taciuti |

### 6.5 Verdetto aggiornato

**IDONEA CON RISERVE** per P2 e P3.

Il verdetto **si ribalta** perché le tre ragioni che rendevano la fake disqualificante non
sussistono più, e non per dichiarazione ma per riscontro:

- il ciclo asincrono è ora quello dell'ente (202+`Location` → 200/303+`Location` → 400 sul
  `/result` non pronto → `EsitoFormularioModel` con `errore` e `validazione`);
- l'endpoint immaginato è stato rimosso e sostituito dal `POST /` del contratto;
- **la fake ora sa dire di no**: rifiuta certificati autofirmati, di altra CA, scaduti; rifiuta
  `alg` diversi da RS256, token senza claim ModI, finestre lunghe, `jti` rigiocati, soggetti non
  accreditati; rifiuta xFIR con riferimenti pendenti, copertura vacua, digest non corrispondente,
  firma crittografica alterata.

Restano però riserve che ne limitano il valore probatorio:

1. **Il payload non è mai validato** (N1): `POST /` accetta qualunque cosa e nessuna rotta produce
   il 400 «modello dati non valido».
2. **La firma xFIR non ha ancora di fiducia** (N2) e non è canonicalizzata C14N: la fake certifica
   coerenza interna, non validità della firma.
3. **Il limite di 1 MB ereditato da Fastify** (N3) rifiuterà container realistici con un errore
   fuori contratto.
4. **Paginazione e filtri di `GET /` sono finti** (N4); `iss`, `codice_blocco`, `X-ReplyTo`,
   `transazione_id` non sono validati (N5-N7).
5. **La suite non è deterministica** (§6.2 punto 1): finché non lo è, «test verdi» non è una prova
   utilizzabile come gate di P2/P3.

**Attività non validabili con questo oracolo — P2:** costruzione e validazione del
`NuovoFormularioModel` e di ogni altro modello di scrittura (nessun 400 di modello esiste);
paginazione e filtri dell'elenco formulari; qualunque logica autorizzativa (incarichi, visibilità
per unità locale: il 403 della fake è solo autenticazione); comportamento reale sotto 429/423
(esiste solo se iniettato); tutte le operazioni non implementate — in particolare
`PUT /{numero_fir}`, `/accettazione`, `/trasporto`, `/annulla`, l'intero albero `/trasmissioni/*`
e `/copia-cartacea|digitale/*`.

**Attività non validabili con questo oracolo — P3:** conformità della firma a XAdES/ETSI EN 319
132 (C14N, algoritmi dichiarati, proprietà firmate qualificate); riferibilità del firmatario a un
certificato di firma qualificata; `POST /{numero_fir}/acquisizione-firma` e `/{numero_fir}/hash`
(i due endpoint del contratto che espongono `digest_to_sign`, tuttora assenti), `/rollback-firma`;
`GET /{numero_fir}/xfir` (download); il vincolo dei 3 MB e il comportamento con container di
dimensione realistica; la coerenza fra `numero_fir` del path e contenuto dell'xFIR.

Con queste riserve esplicitate, la fake può essere adottata come oracolo di P2 e P3 **per il
protocollo e per l'autenticazione**, non per la validazione dei modelli dati né per il valore
giuridico della firma. Le riserve 1, 3 e 5 sono a basso costo di chiusura e andrebbero chiuse
prima che P2 e P3 comincino a produrre codice contro questo oracolo.
