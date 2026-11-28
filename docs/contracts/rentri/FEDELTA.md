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

---

## 7. Chiusura parziale di N1 — validazione del modello dati di scrittura (2026-09-10)

**Cosa è cambiato.** `POST /formulari/v1.0/` non accetta più qualunque corpo. La rotta valida
ora il primo livello di `NuovoFormularioModel` e risponde **400 `ProblemDetails`** quando:

- manca un campo di `required` (`dati_partenza`, `num_iscr_sito`);
- un campo con `pattern` non lo rispetta (oggi `num_iscr_sito`);
- il corpo porta campi fuori da `properties`, come impone `additionalProperties: false`.

**Perché era urgente.** N1 non era teorico: il backend spediva
`{ firId, firNumber }` — due identificativi interni — e nessun test diventava rosso. La
riserva §6.5 punto 1 lo aveva previsto con esattezza; è rimasta aperta abbastanza a lungo
da produrre il difetto che descriveva.

**Come è stata evitata la deriva.** Le regole non sono scritte a mano nel finto: sono lette da
`src/dominio/schema-nuovo-formulario.ts`, generato da `scripts/genera-schema.js` a partire da
`formulari.yaml`. Il modulo generato è confrontato con il contratto da
`test/schema-allineato-al-contratto.test.ts`, che diventa rosso se qualcuno riscarica i
contratti senza rigenerare lo schema. Lo schema è materializzato nel sorgente perché il
contesto di build dell'immagine è `tools/rentri-fake`, da cui `docs/contracts/` non è
raggiungibile; il test copre proprio quel salto. `js-yaml` resta una dipendenza di sviluppo:
il runtime non legge YAML e l'immagine non ingrassa.

**Cosa resta aperto di N1.** La validazione si ferma al primo livello. **Non** sono ancora
verificati i modelli annidati: `DatiPartenzaModel` (che richiede `destinatario`, `rifiuto` e
almeno un trasportatore), `DatiRifiutoModel` (`codice_eer`, `provenienza`, `stato_fisico`), i
tre modelli di trasporto in `oneOf`, e i `$ref` transitivi sotto di essi. Un corpo con
`dati_partenza: {}` è oggi accettato. Finché quella chiusura non arriva, il finto giudica la
**forma esterna** del modello dati, non la sua completezza: la riserva §6.5 punto 1 va
considerata ridotta, non risolta.

### 7.1 Estensione ai modelli annidati (stessa data)

La validazione non si ferma più al primo livello. Lo script di generazione estrae ora la
**chiusura transitiva** dei `$ref` a partire da `NuovoFormularioModel` — 35 schemi — e il
validatore li applica tutti tramite ajv. Il finto rifiuta quindi anche un `dati_partenza`
incompleto, un trasportatore senza `tipo_trasporto`, un `oneOf` che non risolve, un enum
fuori dai valori ammessi.

**Prova che serviva davvero.** Il corpo «valido» scritto a mano per i test era sbagliato in
due punti: `provenienza`/`stato_fisico` con le parole per esteso invece dei codici (`S`), e
`tipo_trasporto` mancante — obbligatorio, ma ereditato via `allOf` dal modello base, quindi
invisibile leggendo solo la variante «Sito». Nessuno dei due errori era rilevabile senza un
validatore: sono esattamente il tipo di sbaglio che la mappatura del backend farà.

**Guardia anti-deriva estesa.** `test/schema-allineato-al-contratto.test.ts` ora verifica
anche che ogni definizione annidata sia identica a quella del contratto e che non restino
`$ref` pendenti. Verificato per mutazione: alterando un campo nello schema generato il test
diventa rosso.

**Due divergenze permissive residue, dichiarate invece che nascoste.**

1. **Un `pattern` del contratto non è applicato**: `^(?!.*(?i)it).*$` su `nazione_id` di
   `CittaEsteraModel` usa il flag inline `(?i)` della sintassi .NET, che JavaScript non
   compila. Riscriverlo a mano significherebbe reinterpretare il contratto, cioè la cosa che
   questo impianto esiste per evitare: il pattern viene scartato e finisce in
   `PATTERN_NON_APPLICABILI`, esportato apposta per poterlo dichiarare.
2. **I `format` non sono verificati**: quelli del contratto sono di OpenAPI (`int32`,
   `double`, `date-time`) e ajv non li applica senza `ajv-formats`. Dichiarato con
   `validateFormats: false` invece di lasciare che ajv emetta un avviso per ognuno.

Con queste due eccezioni, la riserva N1 di §6.5 punto 1 può considerarsi **chiusa** per il
servizio `formulari`: il percorso di scrittura di P2 ha finalmente un oracolo.

### 7.2 Servizio `ca-rentri`: flag `(?i)` in testa al pattern (2026-10-26)

Il contratto di `ca-rentri` ha un pattern con il flag inline .NET `(?i)` **in testa**:
`(?i)^mobile$` su `AuthObjectData.id`. A differenza di `nazione_id` (§7.1 punto 1, dove il
flag sta in mezzo al pattern e quindi non e' riducibile al flag `i` senza reinterpretare
l'espressione), un `(?i)` iniziale vale per tutto il pattern: equivale esattamente al flag
`i` di JavaScript. Il validatore (`validatore-contratto.ts`) lo traduce in una parola chiave
ajv dedicata (`x-pattern-insensibile`, confronto con `RegExp(resto, 'iu')`): `authorize` con
`auth_data[0].id` = `mobile`/`Mobile`/`MOBILE` passa, qualunque altro valore da' 400. La
traduzione e' limitata al caso «`(?i)` iniziale»: un flag in mezzo al pattern resta in
`PATTERN_NON_APPLICABILI` e dichiarato qui sopra.

## 8. Operazioni del FIR in viaggio (2026-11-18, piano `2026-11-18-rentri-fir-viaggio.md`, P0)

La fake ora espone le rotte `quantita`, `trasporto`, `annotazione`, `sosta-tecnica`,
`trasbordo-totale`, `trasbordo-parziale`, `destinatario`, `reset`, `rollback-firma` (tutte
ASYNC, 202 + `TransazioneModel`) e `invia-a-dispositivo` (sincrona, 200). I corpi sono
validati contro i modelli del contratto, generati con `npm run genera-schema:<nome>` e
guardati da `test/schema-viaggio-allineato-al-contratto.test.ts`.

**Macchina degli stati.** Ricavata dalla sezione «Stati del formulario ammessi» della
descrizione di ogni operazione nel contratto, dove esiste (modifica, quantita', trasporto,
accettazione, annotazione, annullamento, hash, firma, reset, sosta, trasbordi, nuovo
destinatario, note di annullamento). Tre cose non sono nel contratto e sono **dedotte**:
quale tra `DatiQuantita`/`DatiQuantitaUpdate` e `Trasporto`/`TrasportoUpdate` spetta a
ciascuno stato; `Allegato` (senza vincoli di stato); `RollbackFirma` (il contratto elenca
le condizioni, non gli stati: la fake lo propone se ha memorizzato una firma reversibile). Le
**transizioni** fra stati restano un'ipotesi: oggi la fake applica solo quelle di
accettazione, annullamento, `reset` (torna allo stato precedente) e `rollback-firma`
(torna all'attesa di firma, mai per la firma di annullamento).
Cambiamento rispetto a prima: `Accettato` ammette l'annotazione (non e' piu' lista vuota),
`RespintoAccettatoParzialmente` ammette `NuovoDestinatario`, `Accettazione` solo in
`InserimentoAccettazione`, uno stato sconosciuto non propone nulla.

**Divergenze dichiarate.**
- Restrittiva: `POST /trasporto` e' un `oneOf` terrestre/marittimo/ferroviario; la fake
  accetta solo il terrestre (l'unico che WasteFlow invia).
- Restrittiva: la sosta tecnica richiede ripresa successiva alla sospensione (il contratto
  descrive solo due `date-time`).
- Permissiva: `invia-a-dispositivo` non verifica che `credentials_id` esista ne' che sia
  associato all'unita' locale (riga 1583).
- Stato sbagliato: le nuove rotte (non quelle storiche di R3: accettazione, annullamento,
  note, allegati) rispondono **403 «Operazione non consentita»** se lo stato del formulario
  non ammette l'operazione secondo `operazioniPerStato`. Il contratto elenca gli stati
  ammessi ma non definisce un errore dedicato: il 403 e' la scelta dichiarata, da verificare
  sulla demo.
- `RollbackFirma`: il contratto non lo lega a degli stati ma a delle condizioni (ultima
  firma, tranne l'annullamento). La fake lo propone e lo esegue solo se ha memorizzato una
  firma reversibile, oggi quella dell'accettazione. Permissiva: non modella i vincoli dei
  15 minuti, del download xFIR dopo la firma e delle copie gia' restituite (riga 2079).
- `destinatario`: `oneOf` rigoroso, un corpo che soddisfa sia la forma completa sia quella
  col solo sito e' rifiutato (nessuno dei due modelli ha `additionalProperties: false`).
- Permissiva: nessuna delle operazioni controlla il ruolo del soggetto (produttore,
  trasportatore, destinatario) ne' le visibilita'.

**Path di stato dedicati (piano, P0 T3): NON implementato, da rivedere.** Il piano chiede
che i client di copie e trasmissioni interroghino `/copia-digitale/{tid}/status`,
`/copia-cartacea/{tid}/status`, `/trasmissioni/{tid}/status` e che la fake risponda 404 sul
path generico. Il contratto, pero', marca quei tre path come **DEPRECATI** («utilizzare
/{transazioneId}/status», righe 2951, 3681, 5099) e i client usano gia' il canonico
di proposito. Adottarli renderebbe la fake meno fedele e porterebbe i client su endpoint
in dismissione. Resta valido il punto della checklist demo: verificare cosa risponde
l'ente al path generico per una transazione di copia o trasmissione.

### 8.1 Quantita' e trasporto della fase iniziale (2026-11-21, FIR in viaggio, P2)

Le **transizioni** della fase iniziale, ipotesi dedotta dai NOMI degli stati (il contratto non le
documenta; da verificare sulla demo, punto 1 della checklist):
- creazione (`POST /`): con quantita' (`rifiuto.quantita`) e trasporto (`dati_trasporto_partenza`) il
  formulario nasce in `FirmaProduttoreTrasportatoreIniziale`; con la sola quantita' in
  `InserimentoTrasportoIniziale`; con il solo trasporto in `InserimentoQuantita`;
- `quantita` completata: `InserimentoQuantitaTrasportoIniziale` -> `InserimentoTrasportoIniziale`,
  `InserimentoQuantita` -> `FirmaProduttoreTrasportatoreIniziale`;
- `trasporto` completata: `InserimentoQuantitaTrasportoIniziale` -> `InserimentoQuantita`,
  `InserimentoTrasportoIniziale` -> `FirmaProduttoreTrasportatoreIniziale`;
- negli stati di correzione (`DatiQuantitaUpdate`, `TrasportoUpdate`) lo stato non cambia.

Divergenza dichiarata: **senza quantita' ne' trasporto** la creazione resta nello stato storico della fake
(`InserimentoQuantita`), mantenuto per non cambiare le suite esistenti; il nome piu' fedele sarebbe
`InserimentoQuantitaTrasportoIniziale`. Il corpo di creazione e' validato contro `NuovoFormularioModel`, quindi
`rifiuto.quantita`, `numero_colli`, `rinfusa`, `caratteristiche_pericolo` e `dati_trasporto_partenza` sono
giudicati dal contratto. Non modellato: `numero_colli` obbligatorio se non c'e' `rinfusa` (il contratto lo dice
solo in prosa; lo impone il client, `mappaQuantitaRifiuto`) e «`caratteristiche_pericolo` se e solo se l'EER e'
pericoloso».

### 8.2 Firme di partenza (2026-11-22, FIR in viaggio, P3)

`acquisizione-firma` senza operazione in attesa (la firma non segue `accettazione` ne `annulla-fir`) nella fase
iniziale: ipotesi dedotta dai NOMI degli stati (il contratto non documenta la macchina; da verificare sulla demo,
punto 1 della checklist):
- `FirmaProduttoreTrasportatoreIniziale` -> `InserimentoAccettazione` (viaggio);
- `FirmaTrasportatoreIniziale` -> `InserimentoAccettazione`;
- `FirmaProduttore` -> `FirmaTrasportatoreIniziale` (resta la firma del trasportatore);
- il `rollback-firma` successivo riporta allo stato precedente (la fake memorizza `ultimaFirma` senza operazione
  pendente da ripristinare); una firma rifiutata dall'ente (`errore: true`) lascia lo stato invariato.

Da chiedere alla demo: quale firma propone l'ente quando produttore e trasportatore coincidono (nel codice si
sceglie quella combinata se presente in `/azioni`), se `FirmaProduttore` precede davvero `FirmaTrasportatoreIniziale`,
e quale stato segue l'ultima firma di partenza.

### 8.3 Annotazione (2026-11-23, FIR in viaggio, P4)

`annotazione` completata con successo: il formulario passa a `FirmaAnnotazione` e la fake ricorda lo stato di
prima (`pendingOperazione` di tipo `Annotazione`); `acquisizione-firma` completata lo riporta a quello stato
(viaggio, `Accettato` o `RespintoAccettatoParzialmente`: sono gli stati in cui il contratto ammette
l'annotazione); `reset` in `FirmaAnnotazione` annulla l'annotazione non firmata. Ipotesi dedotta dai NOMI degli
stati, da verificare sulla demo. Il corpo e' validato con `DatiAnnotazioneModel` (`annotazione` 1..10.000,
`identificativo_soggetto` obbligatorio); la fake NON verifica che il CF sia uno dei soggetti del formulario
(il contratto dice che deve esserlo): lo garantisce WasteFlow prima dell'invio.

Limiti noti della fake (review-finale P4, M6): controlla lo stato solo al POST (la transizione avviene
all'elaborazione, quindi due POST ravvicinati danno due 202: per questo WasteFlow serializza gli invii con una
prenotazione locale), non esclude il produttore (il contratto, formulari.yaml:1046, ammette l'annotazione solo
al trasportatore o al destinatario che ha in carico il rifiuto: WasteFlow lo controlla prima dell'invio), non
modella «copia gia' restituita con accettazione totale -> non consentita» (r. 1052) e non verifica che la firma
sia del soggetto che ha inserito l'annotazione (r. 6154: WasteFlow firma solo annotazioni proprie, di cui
conosce il testo). Il POST `/annotazione` non si ritenta mai su 5xx/timeout (esito incerto, come la creazione).

Annotazioni nel dettaglio (correzione R1, 2026-11-20): `GET /{numero_fir}` espone `dati_annotazioni`
(`DatiAnnotazioneResultModel`: `annotazione`, `identificativo_soggetto`, `dati_firma`). Un'annotazione accettata
entra con `dati_firma: null`; la firma la valorizza (la fake mette solo `data_firma`), il `reset` toglie quella non
firmata, il `rollback-firma` la riporta a non firmata. WasteFlow ci riconcilia un invio rimasto senza esito
(INCERTA, o INVIATA di un processo morto): propria = non firmata, stesso soggetto, stesso testo (SHA-256). Ipotesi
da verificare sulla demo: che il dettaglio riporti davvero le annotazioni non ancora firmate e il testo
identico a quello inviato (senza normalizzazioni); se non lo facesse, un'annotazione con esito ignoto non
sarebbe mai adottata (fail-closed: si sblocca con il `reset`).

Da chiedere alla demo: se lo stato dopo la firma e' davvero quello di prima, se piu' annotazioni consecutive
sono ammesse (la fake le ammette tutte, una alla volta), se l'ente rifiuta un CF fuori dal formulario con 400 o 403.

### 8.4 Sosta tecnica (2026-11-23, FIR in viaggio, P5)

`sosta-tecnica` completata con successo: il formulario passa a `FirmaSostaTecnica` e la fake ricorda lo stato
di prima (`pendingOperazione` di tipo `SostaTecnica`); `acquisizione-firma` completata lo riporta a quello
stato (gli stati di viaggio `InserimentoAccettazione` e `InserimentoTrasportoSuccessivo`, i soli in cui il
contratto ammette la sosta, `formulari.yaml` `/{numero_fir}/sosta-tecnica`); `reset` in `FirmaSostaTecnica`
annulla la sosta non firmata; `rollback-firma` la riporta a non firmata. Ipotesi dedotta dai NOMI degli stati,
da verificare sulla demo. Il corpo e' validato con `DatiSostaTecnicaModel` (`luogo_stazionamento` 1..1000,
`data_ora_sospensione` e `data_ora_ripresa` date-time) e, oltre al contratto, con ripresa > sospensione.

Soste nel dettaglio (`GET /{numero_fir}`): `dati_soste_tecniche` (`DatiSostaTecnicaResultModel`: luogo, date,
`dati_firma`, `trasportatore_id`). Una sosta accettata entra con `dati_firma: null`; la firma la valorizza (la
fake mette solo `data_firma`); la fake NON valorizza `trasportatore_id`. WasteFlow ci riconcilia un invio rimasto
senza esito (INCERTA, o INVIATA di un processo morto) e ci verifica, prima di ogni authorize, che ci sia UNA sola
sosta non firmata con lo stesso luogo e gli stessi istanti di quella dichiarata da noi (le date si confrontano come
istanti, non come stringhe: l'ente puo' rinormalizzare il formato).

Limiti noti della fake (stessi dell'annotazione, §8.3): controlla lo stato solo al POST (la transizione avviene
all'elaborazione: per questo WasteFlow serializza gli invii con una prenotazione locale), non verifica che la
sosta sia dichiarata dal trasportatore che ha in carico il rifiuto (il contratto dice cosi': WasteFlow controlla
prima dell'invio che il CF del tenant sia di un trasportatore del FIR, principale o aggiuntivo; non puo' sapere
quale dei trasportatori abbia in carico il rifiuto, lo decide l'ente con 403) e non modella «copia gia'
restituita con accettazione totale -> non consentita». Il POST `/sosta-tecnica` non si ritenta mai su
5xx/timeout (esito incerto, come la creazione: la sosta si AGGIUNGE).

Da chiedere alla demo: se lo stato dopo la firma e' davvero quello di prima, se piu' soste consecutive sono
ammesse (la fake le ammette tutte, una alla volta), se il dettaglio riporta le soste non ancora firmate con il
luogo identico a quello inviato, se la firma `AcquisizioneFirmaSostaTecnica` e' sempre del trasportatore che ha
in carico il rifiuto (e quindi se l'utenza con visibilita' su un trasportatore diverso viene rifiutata), come
l'ente tratta le date con frazioni di secondo.

### 8.5 Trasbordo totale (2026-11-23, FIR in viaggio, P6)

`trasbordo-totale` completato con successo: il formulario passa a `FirmaTrasbordoTotale` e la fake ricorda lo
stato di prima (`pendingOperazione` di tipo `TrasbordoTotale`); `acquisizione-firma` completata lo riporta a
quello stato (`InserimentoAccettazione` o `InserimentoTrasportoSuccessivo`, i soli in cui il contratto ammette
l'operazione); `reset` in `FirmaTrasbordoTotale` toglie il trasbordo non firmato; `rollback-firma` lo riporta a
non firmato. Il corpo e' validato con `DatiTrasbordoTotaleModel` (nuovo trasportatore + `presa_in_carico`
terrestre, che include gia' conducente e data di inizio).

Nel dettaglio (`GET /{numero_fir}`): `dati_trasbordo_totale` (`DatiTrasbordoTotaleResultModel`), **UNO solo**,
come nel contratto: entra con `presa_in_carico.dati_firma_trasportatore: null`, la firma lo valorizza. Un
secondo trasbordo totale non si propone in `/azioni` e la POST risponde 403 (ipotesi: il contratto parla di
«eventuale trasbordo totale» al singolare). La fake NON valorizza `trasportatore_id`.

Chi firma: la descrizione dello stato (`FirmaTrasbordoTotale`) dice «firma del trasportatore che prende in carico
il rifiuto con l'operazione di trasbordo totale», cioe' il NUOVO trasportatore, non quello che ha inviato il
trasbordo. La fake non distingue i soggetti (`/azioni` e `authorize` ignorano l'utenza). WasteFlow invece
controlla da se' che il CF dell'azienda sia quello del nuovo trasportatore mostrato dall'ente, prima di ogni
`authorize`. Il confronto usa sia il CF sia la P.IVA del tenant (`identificativiTenant`): al trasbordo WasteFlow
invia `codice_fiscale = P.IVA || CF` dell'anagrafica, e per una ditta individuale il CF del tenant puo' essere quello
personale. Identificativi esteri senza CF ne' P.IVA nel tenant restano fuori (il tenant ha sempre la P.IVA).

Esito incerto: il POST non si ritenta e la tratta locale non nasce. La riconciliazione (invio nuovo, `firma`, o il
pulsante «Verifica con l'ente», `POST .../trasbordo-totale/verifica`) confronta SOLO l'identita' (CF del nuovo
trasportatore, inizio, conducente), firmato o no: la firma e' del nuovo trasportatore e puo' arrivare prima.

Da verificare alla demo (secondo trasbordo): `dati_trasbordo_totale` e' UNO solo. Se il nostro invio incerto e'
stato registrato e firmato e il nuovo trasportatore ne fa a sua volta un altro, la verifica del mittente vede un
trasbordo «diverso»: senza `transazioneId` chiude l'invio come RIFIUTATA (esito `ALTRO_TRASBORDO`, nessuna tratta),
con `transazioneId` resta 409 `TRASBORDO_TOTALE_IN_VERIFICA` perche' lo stato della transazione si legge solo come
«in elaborazione o no». Se la demo conferma che un secondo trasbordo e' ammesso, usare l'esito della transazione.

Limiti noti (stessi dell'annotazione, §8.3, e della sosta, §8.4): lo stato si controlla solo al POST; non si
verifica che l'invio sia del trasportatore che ha in carico il rifiuto; non si modella «copia gia' restituita con
accettazione totale -> non consentita»; il POST `/trasbordo-totale` non si ritenta mai su 5xx/timeout (esito
incerto, il trasbordo AGGIUNGE un trasportatore).

Da chiedere alla demo: se dopo la firma lo stato e' davvero quello di prima o `InserimentoTrasportoSuccessivo`
(il plan ipotizza un `/trasporto` successivo, ma il contratto mette gia' la presa in carico nel POST); chi firma
(solo il nuovo trasportatore o anche chi ha in carico); se un secondo trasbordo totale e' ammesso e cosa
sostituisce; se il dettaglio mostra il trasbordo non ancora firmato con gli stessi dati inviati; come cambia
`/azioni` per il vecchio trasportatore dopo il trasbordo.

## 9. Registri dell'operatore (2026-11-19, piano `2026-11-18-registro-eregi.md`, E1)

Rotte aggiunte a `anagrafiche` (`routes/anagrafiche-registri.ts`, stato in
`stato/registri-operatore.ts`): `GET .../siti/{sito}/registri`, `POST /operatore/registri`,
`GET|PUT|DELETE /operatore/registri/{id}`, `GET .../{id}/xml`. I corpi di POST e PUT sono
validati con gli schemi del contratto (`CreateRegistroRequest`, `UpdateRegistroOperatoreRequest`,
generati con `npm run genera-schema:crea-registro` / `:modifica-registro` e guardati da
`schema-registri-allineato-al-contratto.test.ts`). La guardia rotte <-> contratti
(`rotte-allineate-ai-contratti.test.ts`) copre le nuove rotte senza voci in `SCOSTAMENTI_NOTI`.

**Canali di controllo** (non esistono in RENTRI):
- `POST /__controllo/registri/esito-perso` `{ operazione: apri|modifica|chiudi, tipo: 5xx|timeout,
  stato?, volte? }`: l'operazione viene ESEGUITA e poi il chiamante riceve un 5xx o nessuna
  risposta (connessione chiusa). Diverso da `/__controllo/guasto`, che fallisce prima di elaborare.
  E' lo scenario della POST di apertura non idempotente.
- `POST /__controllo/registri/registro`: crea un registro gia' esistente (come aperto dal portale),
  anche chiuso e con identificativo scelto, senza regole di coerenza.

**Divergenze dichiarate.**
- Permissiva: `attivita` deve contenere almeno UN'attivita' dell'unita' locale (lettura letterale
  del contratto); le altre non sono rifiutate. Non e' verificato lo stato dell'unita' locale
  (Attivo/Sospeso...) ne' l'appartenenza del sito all'operatore autenticato (la fixture ne ha uno).
- Restrittiva: `attivita_rec_smalt` valorizzato senza Recupero/Smaltimento e' rifiutato (400); il
  contratto dice solo «richiesto solamente se». I codici si confrontano con l'unione delle
  autorizzazioni del sito (`attivitaRecuperoSmaltimento`): un sito senza autorizzazioni non ne
  ammette nessuno, a meno di `forza_salvataggio_attivita_rec_smalt` sul PUT. Nella fixture nessuna
  unita' locale ha Recupero/Smaltimento con codici validi: per quegli scenari si usa il canale
  `/__controllo/registri/registro`.
- Restrittiva: PUT e DELETE su un registro gia' chiuso rispondono 400; il contratto non dice cosa
  succede.
- Permissiva: nessun 403 per registri di altri operatori; un solo operatore in fixture.
- Il registro aperto qui NON diventa noto al servizio `dati-registri` (stato separato): per
  trasmettere movimenti va registrato col canale `/__controllo/dati-registri/registro`.
- eREGI (`GET .../xml`): struttura da `rentri-registri-1.0.xsd` (`VidimazioneRegistro`),
  `Id="eREGI-CS-0"`, `ds:Signature` con `Reference URI="#eREGI-CS-0"`. Il `DigestValue` e' lo
  SHA-256 dell'eREGI serializzato senza firma cosi' come scritto, NON della forma C14N; la
  `SignatureValue` e' una vera firma RSA-SHA256 sui byte di `SignedInfo` non canonicalizzati, con la
  chiave della credenziale di test e non quella della CA RENTRI. Il `num_iscr_sito` delle fixture
  (`MI00001234-002`) non rispetta il pattern `NumIscrSito` dell'XSD (`OP...-XX0000`): l'eREGI riporta
  il valore della fixture. Il significato di `Ref`/digest per la catena delle esportazioni resta
  l'ipotesi R1 del piano, da provare sul demo.
- Paginazione dell'elenco registri: applicata davvero (a differenza delle altre rotte `anagrafiche`).

## 10. Firma XMLDSig del registro in `/valida` (2026-11-20, piano `2026-11-18-registro-eregi.md`, E5)

`POST /dati-registri/v1.0/operatore/{registro}/valida` resta NONBLOCK_PULL con esito deciso dal
canale di controllo, ma se il file (XML, o ZIP con un solo XML) e' un `reg:Registro` la fake, al
completamento della transazione, verifica davvero (`dominio/verifica-firma-registro.ts`, libreria
`xml-crypto`) e aggiunge i messaggi all'esito:
- `firmaNonPresente` (Avvertimento) se manca la `ds:Signature` di radice;
- `firmaNonValida` (Errore) se la firma non copre tutto il documento (`Reference URI=""`, enveloped,
  C14N 1.0, SHA-256, RSA o ECDSA P1363) o non si verifica col certificato del `KeyInfo`;
- `catenaDigestNonValida` (Errore) se `Ref[0]` non e' il `DigestValue` del `Reference
  URI="#eREGI-CS-0"` dell'eREGI incorporato.

**Divergenze dichiarate.** Coerenza interna, nessuna catena di fiducia verso una CA. Dei `Ref`
successivi al primo (esportazioni precedenti) non si controlla nulla. Non si ricalcola il digest
dell'eREGI (la fake non lo canonicalizza, v. §9) e non si verifica la sua firma. Un file che non e'
un `reg:Registro` non riceve alcun giudizio.

### 10.1 Catena di 3 esportazioni contro `/valida` (2026-11-21, eREGI E6)

`apps/backend/src/application/rentri/registro/esportazioni-registro-rentri.oracolo.spec.ts` prova, con
l'eREGI scaricato dalla fake, una catena di 3 esportazioni costruite con il codice di produzione
(`costruisciEsportazioneRegistro`): la fake non segnala messaggi su nessuna delle tre. Prove in
negativo: file alterato dopo la firma (`firmaNonValida`), primo `Ref` sbagliato
(`catenaDigestNonValida`), file non firmato (`firmaNonPresente`).

**Divergenza della fake scoperta in E6.** Le unita' locali di fixture (`MI00001234-002`) non rispettano
il pattern `NumIscrSito` dell'XSD (`OP` + 4 cifre + 3 alfanumerici + 6 cifre + `-` + 2 lettere + 4
cifre): l'eREGI che la fake rilascia per quei siti, inserito in un `reg:Registro`, NON passa la
validazione XSD. L'oracolo ne sostituisce il solo valore con uno conforme. Da correggere nelle fixture
quando si potra' rinumerare i siti senza rompere gli altri test. Come in §10, dei `Ref` oltre il primo
la fake non controlla nulla: che le esportazioni successive citino il digest della precedente e' provato
solo da `verificaCatenaEsportazioni` (nostro codice), non da un'implementazione indipendente.

### 10.2 Cosa copre E7 e cosa resta da provare sul demo (2026-11-28, eREGI E7)

E7 aggiunge il pannello, il job mensile (spento di predefinito, `RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE`) e
l'e2e Playwright `e2e/tests/rentri/registro-esportazioni.spec.ts` (trasmissione, esportazione,
validazione della fake, download, rettifica, seconda esportazione con una `Reference` in piu'). **Nessun
comportamento nuovo della fake e nessun nuovo contratto**: il job riusa `/valida` come E6.

Ancora **da provare sul demo RENTRI** prima di accendere il job (guida: `docs/rentri/esportazione-xml-registro.md`):
- R1: significato di `Ref` oltre il primo (digest dell'eREGI, poi `DigestValue` dei file precedenti);
  la fake non controlla nulla oltre il primo `Ref` (§10, §10.1).
- R2: canonicalizzazione dell'eREGI incorporato (prefisso diverso da `reg`).
- R3: `Autore` (nome e cognome dell'utente che ha registrato, oppure `WasteFlow`) e
  `IdentificativoTemporale` (`created_at` dell'annotazione).
- R9: che `/operatore/registri` risponda sul demo (la fake lo espone; `openapi.json` lo dichiara «non esposto»).
- Primo progressivo di un anno = primo numero esistente, non forzato a 1.
