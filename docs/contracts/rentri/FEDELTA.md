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
