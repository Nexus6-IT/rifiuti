# Runbook SDI: pilota e operatività

Emissione delle fatture allo SDI tramite provider (piano 4.5, pezzo 4.5f). Questo documento serve a chi
accende, tiene d'occhio e spegne l'invio per le aziende pilota. Non descrive il provider reale: l'adattatore
(4.5e T2) e la sandbox (4.5e T3) dipendono dalla scelta del provider. Finché non esistono, l'unico provider
selezionabile è `fake` (solo collaudo, rifiutato con `NODE_ENV=production`).

**Regola:** l'accensione di `definitive_attive` e di `invio_attivo` in produzione si fa solo su decisione di
Graziano. Qui sotto c'è il COME, non il QUANDO.

## 1. Le quattro leve, dalla più larga alla più stretta

| Leva                | Dove                                                | Default                                   | Cosa blocca                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDI_INVII_ATTIVI`  | variabile d'ambiente del backend                    | spento (vale solo il testo esatto `true`) | Tutti gli invii di tutte le aziende. L'accodamento risponde 409 `INVII_SDI_SOSPESI`, il job non prenota né invia. Resta attiva la riconciliazione degli invii incerti (solo lettura presso il provider). |
| Modulo `sdi`        | piano commerciale dell'azienda                      | assente                                   | Rotte, job e sonda ignorano l'azienda.                                                                                                                                                                   |
| `invio_attivo`      | `PUT /sdi/configurazione/invio-attivo` (ADMIN)      | spento                                    | Gli invii di quella sola azienda. Si può accendere solo dopo una verifica riuscita.                                                                                                                      |
| `definitive_attive` | `PUT /impostazioni-fatturazione/definitive` (ADMIN) | false                                     | Le fatture DEFINITIVE dell'azienda: senza definitive non esistono documenti emessi da inviare.                                                                                                           |

## 2. Accendere una nuova azienda pilota

Precondizioni fuori dal software: contratto con il provider, partita IVA configurata presso il provider,
autorizzazione scritta del cliente (passi di onboarding `CONTRATTO_PROVIDER`, `PARTITA_IVA_CONFIGURATA`,
`CREDENZIALI_INSERITE`, `WEBHOOK_CONFIGURATO`, `PROVA_SANDBOX_SUPERATA`, `AUTORIZZAZIONE_DEL_CLIENTE`:
li spunta a mano l'amministratore da `/sdi/configurazione`, con data e utente).

1. Abilitare il modulo `sdi` per l'azienda (piano commerciale).
2. `PUT /sdi/configurazione`: provider, ambiente `SANDBOX`, credenziali, id configurazione presso il provider,
   `segretoWebhook`. La prima volta la risposta contiene `webhookToken` in chiaro, **una volta sola**: copiarlo.
   URL del webhook da dare al provider: `https://<host>/api/v1/sdi/webhook/<provider>/<webhookToken>`.
3. `POST /sdi/configurazione/verifica`: prova le credenziali e la P.IVA senza inviare nulla.
4. Un giro in `SANDBOX` con fatture di prova (spunta `PROVA_SANDBOX_SUPERATA`).
5. Passare l'ambiente a `PRODUZIONE` (`PUT /sdi/configurazione`): questo azzera la verifica e spegne
   `invio_attivo`. Rifare la verifica.
6. `PUT /sdi/configurazione/invio-attivo` con `attivo: true` (esige la verifica del punto 5).
7. `PUT /impostazioni-fatturazione/definitive` con `attive: true`.
8. Con `SDI_INVII_ATTIVI=true` sul backend l'azienda parte; con la variabile assente non parte nessuno.

## 3. Interruttore d'emergenza

Dalla più rapida alla più mirata:

- **Tutto fermo:** togliere `SDI_INVII_ATTIVI` (o impostarla a qualunque valore diverso da `true`) e
  riavviare il backend. Si legge a ogni chiamata, ma la variabile d'ambiente cambia solo con un riavvio.
  Effetto: nessun invio nuovo. Le trasmissioni già `INVIATA` continuano a ricevere ricevute (webhook e
  polling non inviano nulla).
- **Una sola azienda:** `PUT /sdi/configurazione/invio-attivo` con `attivo: false`.
- **Nessun nuovo documento emesso:** `PUT /impostazioni-fatturazione/definitive` con `attive: false`.

Dopo un arresto le trasmissioni `DA_INVIARE` restano in coda e ripartono alla riaccensione. Non c'è un
comando per cancellare un invio già consegnato al provider: la cancellazione presso il provider prima della
trasmissione allo SDI dipende dal provider (rischio R6 del piano, fuori perimetro).

## 4. Cosa guardare ogni giorno durante il pilota

- **Stato del sistema** (SUPER_ADMIN): la voce «Trasmissioni SDI ferme da oltre un'ora» è in errore se
  c'è almeno una trasmissione `INCERTA` o `IN_INVIO` ferma da più di un'ora, su tutte le aziende. Il
  dettaglio riporta solo i conteggi.
- **Avvisi in-app agli ADMIN dell'azienda** (sonda, ogni 10 minuti, uno per trasmissione e per stato: una INCERTA avvisata e poi scartata riceve anche l'avviso di scarto):
  - «Invio allo SDI incerto»: `INCERTA` da oltre un'ora;
  - «Fattura scartata dallo SDI»: `SCARTATA`, con i codici dello scarto;
  - «Invio allo SDI non riuscito»: `ERRORE_INVIO` (rete di sicurezza dell'avviso immediato).
    Non si avvisano i documenti annullati né quelli con una trasmissione più recente. Un problema ancora aperto
    dopo 30 giorni (scadenza delle notifiche) riceve un secondo avviso: è voluto.
- **Bugsink** (`error.ignicraft.com`): i job `eseguiSonda`, `eseguiRiconciliazione` e gli altri job SDI
  segnalano lì gli errori, con il tag `tenantId`.
- **Webhook:** risposte 404 in aumento sulla rotta `/sdi/webhook/...` significano token errato o
  rigenerato senza aggiornare il provider; 401 significano firma o timestamp errati (segreto sbagliato,
  orologio fuori di oltre 5 minuti).

## 5. Che fare con ciascuno stato

### `INCERTA` (esito dell'invio ignoto)

Il processo è caduto a metà invio, oppure il provider non ha risposto dopo aver ricevuto i byte. Il job
riconcilia da solo: dopo 2 minuti chiede al provider (`cerca` per chiave e nome file). Trovata: diventa
`INVIATA`. Non trovata: torna `DA_INVIARE` con attesa crescente (1, 5, 15, 60, 240 minuti), fino a 5
tentativi, poi `ERRORE_INVIO`.

Resta `INCERTA` oltre un'ora solo se il provider non risponde alla ricerca. Quindi:

1. Controllare che il provider sia raggiungibile (stato pubblico del provider, `verifica` della configurazione).
2. **Non rinviare a mano e non annullare il documento** finché lo stato è `INCERTA`: l'invio potrebbe
   essere partito, e un secondo invio produrrebbe una fattura doppia presso lo SDI (scarto 00404/00002
   nel migliore dei casi).
3. Se il provider è tornato e la trasmissione non si sblocca entro due minuti (il job d'invio gira ogni minuto), cercare nel
   pannello del provider un invio con il nome file riportato nell'avviso. Trovato: aspettare le ricevute.
   Non trovato dopo la sua conferma scritta: la trasmissione tornerà `DA_INVIARE` da sola al giro dopo.

### `ERRORE_INVIO`

Errore permanente (rifiuto del provider, P.IVA non configurata) o tentativi esauriti. Il documento NON è
stato inviato. Leggere codice e messaggio nella cronologia SDI del documento, correggere la causa (per
esempio la configurazione della P.IVA presso il provider) e usare «Riprova»
(`POST /documenti-fattura/{id}/invio-sdi/riprova`), che crea una nuova trasmissione.

### `SCARTATA`

Lo SDI ha rifiutato il file (notifica NS). L'avviso riporta i codici. Dal documento si usa «Annulla e
rifattura» (motivo precompilato): l'annullo di un emesso è ammesso solo con una trasmissione `SCARTATA` e
nessuna viva. Se il codice indica un duplicato (00404, 00002) il documento è probabilmente già stato
inviato: l'azione di annullo viene bloccata con l'avviso `PROBABILMENTE_GIA_INVIATA`; verificare prima nel
cassetto fiscale. La prassi sulla numerazione dopo uno scarto (stesso numero entro 5 giorni, oppure nuovo
numero con riferimento) va concordata con il commercialista dell'azienda (rischio R4).

### `INVIATA` senza ricevute

Se il webhook è andato perso il polling di ripiego interroga il provider dopo 2 ore (ogni 15 minuti) e
porta lo stato a `CONSEGNATA`. Nel frattempo la pagina dei documenti non si aggiorna da sola a `INVIATA`:
va ricaricata.

## 6. Rotazione dei segreti

### Token del webhook (per azienda)

1. `POST /sdi/configurazione/token` con la `versione` corrente. La risposta ha il nuovo `webhookToken`, una
   volta sola. Il vecchio smette di funzionare **subito**.
2. Aggiornare subito l'URL del webhook presso il provider.
3. Nel frattempo gli eventi arrivano a una rotta che risponde 404: il provider li ritenterà (Invoicetronic
   fino a 7 volte in 24 ore). Quelli persi si recuperano comunque con il polling di ripiego.
4. Verificare con una ricevuta di prova (sandbox) o aspettando la prima ricevuta reale; controllare l'assenza
   di 404 sulla rotta.

### Segreto della firma del webhook (per azienda)

`PUT /sdi/configurazione` con il nuovo `segretoWebhook` e la `versione` corrente; aggiornare lo stesso
valore presso il provider nello stesso momento. Non azzera la verifica né spegne l'invio. Tra le due modifiche
i webhook ricevono 401 e vengono ritentati dal provider.

### `SDI_CREDENTIAL_ENC_KEY` (chiave di cifratura, globale)

La chiave cifra a riposo le credenziali del provider e il segreto del webhook di TUTTE le aziende
(AES-256-GCM, chiave derivata con SHA-256; il testo cifrato non porta un numero di versione della chiave).
Conseguenza: **cambiare la chiave rende illeggibili tutti i segreti già salvati**. Oggi non esiste uno
strumento che ri-cifra i dati esistenti.

Procedura attuale (lunga, da fare solo se la chiave è compromessa):

1. Spegnere gli invii: togliere `SDI_INVII_ATTIVI` e riavviare.
2. Annotare, per ogni azienda con configurazione, provider, ambiente e id configurazione; recuperare
   credenziali e segreto del webhook dalla fonte originale (provider o cassaforte), non dal database.
3. Impostare la nuova `SDI_CREDENTIAL_ENC_KEY` (valore casuale lungo, mai nel repository) e riavviare.
4. Per ogni azienda: `PUT /sdi/configurazione` con credenziali e `segretoWebhook`, poi `verifica`, poi
   `invio-attivo` (il cambio di credenziali spegne l'invio e azzera la verifica).
5. Rimettere `SDI_INVII_ATTIVI=true`.

Finché le aziende pilota sono 2-3 la procedura è praticabile; con più aziende conviene costruire prima la
ri-cifratura con chiave versionata (decisione aperta, non ancora presa).

## 7. Collaudo senza provider reale

`tools/sdi-fake` è un server HTTP che simula il provider (invio, lettura, configurazione P.IVA, webhook
firmato con lo stesso schema HMAC del backend). L'esito dipende dall'ultima cifra della P.IVA o del codice
fiscale del cessionario: 1 NS (scarto 00305), 2 MC, 3 invio incerto con file arrivato, 4 errore transitorio,
5 rifiutato, 6 invio incerto con file perso, 7 RC + NE EC01, 8 RC + NE EC02, le altre RC. Avvio locale:
`docker compose up sdi-fake` (porta 4020) oppure `node tools/sdi-fake/src/server.js`. Mai in produzione.
