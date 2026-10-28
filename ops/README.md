# ops/ — Procedure operative WasteFlow

## Backup off-site

### Script: `backup-offsite.sh`

Produce un dump gzip del database PostgreSQL, lo **verifica** e solo dopo lo
accetta; poi lo copia su una destinazione remota (rsync+SSH o rclone/S3). Da
eseguire sul VPS come root. Il `.env` è letto con `leggi_env` (libreria
`ops/lib/backup-verifica.sh`) e **mai eseguito**: niente `source` nel cron.

> `scripts/backup.sh` (percorsi `/opt/wasteflow`) **non** è lo script in uso:
> quello in uso è `ops/backup-offsite.sh`.

**Cosa viene verificato prima di accettare un backup:**

1. Il file deve essere un gzip integro e la sua coda deve contenere il marcatore
   finale di `pg_dump` (`-- PostgreSQL database dump complete`): un dump
   troncato può essere un gzip valido, ma senza marcatore viene scartato.
2. Di notte, un **ripristino di prova** in un database temporaneo
   (`wasteflow_verifica_<epoch>_<pid>`, sempre eliminato alla fine) con
   confronto di numero di tabelle, righe di `_prisma_migrations` e righe di
   `waste_movements` rispetto alla sorgente.
3. **Spazio libero** (Decisione 14): prima del dump servono 2 volte la
   dimensione del database nella cartella dei backup; prima del ripristino di
   prova 3 volte in `BACKUP_DATI_DIR` (default `/var/lib/docker`). Fattori
   regolabili con `BACKUP_FATTORE_SPAZIO_DUMP` e
   `BACKUP_FATTORE_SPAZIO_RIPRISTINO`.

**Stati dei file** in `/opt/rifiuti/backups`:

| Suffisso | Significato |
|----------|-------------|
| `.sql.gz.parziale` | dump in corso o interrotto |
| `.sql.gz.scartato` | dump incompleto o ripristino di prova fallito |
| `.sql.gz.non-verificato` | dump completo ma senza spazio per il ripristino di prova (può servire) |
| `.sql.gz` | backup verificato, nome finale |

Gli `.scartato` e `.non-verificato` più vecchi di 7 giorni vengono eliminati
dalla rotazione. Se un backup notturno fallisce parte una **mail a `root`**
(sul VPS inoltrata a Gmail da `/etc/aliases`, invio con `msmtp`); l'indirizzo si
cambia con `BACKUP_ALERT_EMAIL`.

**Modalità** (`BACKUP_MODALITA`):

- `notturno` (default): flusso completo, restore di prova, mail se fallisce,
  copia off-site, rotazione per `BACKUP_RETENTION_DAYS`.
- `predeploy`: dump + controllo di completezza, file `wasteflow_predeploy_*`
  (ne restano 10), nessun restore di prova, nessuna mail e nessuna copia
  off-site. Esce con codice diverso da zero se il dump fallisce: lo segnala il
  job di deploy.

**Configurazione** (variabili d'ambiente oppure righe nel `/opt/rifiuti/.env`):

```bash
# Modalità off-site: rsync | rclone | disabled
# Lasciare "disabled" finché la destinazione off-site non è decisa.
OFFSITE_MODE=disabled

# rsync: destinazione SSH
RSYNC_TARGET="backup@backup-server.example.com:/backups/wasteflow/"
RSYNC_SSH_KEY="/root/.ssh/id_ed25519_backup"

# Rotazione locale (default 30 giorni)
BACKUP_RETENTION_DAYS=30

# Cifratura opzionale con age (https://age-encryption.org/)
ENCRYPT_BACKUP=false
# AGE_RECIPIENT="age1..."   # chiave pubblica age del destinatario
```

Percorsi (sovrascrivibili): `WASTEFLOW_ENV_FILE` (`/opt/rifiuti/.env`),
`WASTEFLOW_COMPOSE_FILE` (`/opt/rifiuti/site/docker-compose.prod.yml`, quello
usato dal deploy), `BACKUP_STAGING_DIR` (`/opt/rifiuti/backups`). Ogni
`docker compose` passa `--env-file`: il compose di produzione ha variabili
obbligatorie interpolate anche da `exec`.

**Esecuzione manuale:**

```bash
bash /opt/rifiuti/site/ops/backup-offsite.sh
```

**Cron suggerito** (ogni notte alle 03:30, senza `source`):

```
# /etc/cron.d/wasteflow-backup
30 3 * * * root bash /opt/rifiuti/site/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
```

### Allarme di freschezza: `controllo-freschezza-backup.sh`

`backup-offsite.sh` manda una mail quando il backup **fallisce**; se invece il
cron non parte (job rimosso, host spento) non scrive nessuno. Questo controllo
guarda l'età dell'ultimo dump verificato (`wasteflow_<DB_NAME>_*.sql.gz` e
`.sql.gz.age`; `predeploy`, `.scartato`, `.non-verificato` e `.parziale` non
contano) e manda una mail **solo ai cambi di stato**: oltre 26 ore
(`BACKUP_FRESCHEZZA_ORE`) arriva `ATTENZIONE backup WasteFlow fermo da <N> ore`
(o `... nessun dump verificato`), al ritorno alla normalità `Backup WasteFlow di
nuovo regolare`. Lo stato sta in `BACKUP_STATO_FILE`
(`/var/lib/wasteflow-backup/freschezza.stato`); esce 0 se OK, 1 se GUASTO.

```
# /etc/cron.d/wasteflow-backup-freschezza
*/30 * * * * root bash /opt/rifiuti/site/ops/controllo-freschezza-backup.sh >> /var/log/wasteflow-backup-freschezza.log 2>&1
```

Comportamenti da sapere: se la mail non parte (msmtp assente o in errore) lo
stato **non** cambia e il giro successivo riprova; se la cartella o il file di
stato non sono scrivibili il controllo scrive `ERRORE` sul log, esce con codice
3 e non manda mail (altrimenti ne partirebbe una ogni 30 minuti): il guasto si
vede nel log. Il log `/var/log/wasteflow-backup-freschezza.log` riceve una riga
ogni 30 minuti: aggiungerlo alla rotazione di logrotate.

L'installazione sul server è un passo del rilascio (con l'approvazione di
Graziano). Prova: `BACKUP_FRESCHEZZA_ORE=0 bash .../controllo-freschezza-backup.sh`
deve mandare una mail; poi si cancella `BACKUP_STATO_FILE` o si lascia girare
con la soglia normale per ricevere il messaggio di ripristino.

**Test degli script:** `bash ops/test/backup-verifica.test.sh` (la parte con
PostgreSQL gira solo se `PG_EXEC` è impostata, ad esempio
`PG_EXEC="docker exec -i <container>"`). Girano in CI (`ci.yml`, job `backend`
e `test-postgres`) e nel gate del deploy (`deploy.yml`, job `quality`).

---

## Ripristino (Disaster Recovery)

### Script: `restore.sh`

Il ripristino **non elimina mai** il database di produzione: verifica il dump, lo
ripristina in un database nuovo e scambia i nomi solo se tutto è andato bene.

```bash
# 1. Scaricare il backup desiderato (rsync / rclone / manuale)
rsync -az backup@backup-server.example.com:/backups/wasteflow/wasteflow_..._20260610.sql.gz \
  /opt/rifiuti/backups/

# 2. Se cifrato con age, decifrare prima:
# age -d -i ~/.age/key.txt dump.sql.gz.age > dump.sql.gz

# 3. Eseguire il ripristino (chiede conferma interattiva). RIPRISTINO_TAG è
#    obbligatoria: il tag dell'immagine del backend che girerà DOPO il ripristino.
#    Le sue migration devono essere un'estensione dello schema del dump: di norma
#    il tag in produzione quando il dump è stato fatto, o uno successivo.
RIPRISTINO_TAG=sha-1a2b3c4 bash /opt/rifiuti/site/ops/restore.sh \
  /opt/rifiuti/backups/wasteflow_wasteflow_prod_20260610_033000.sql.gz
```

`RIPRISTINO_CONFERMATO=YES` salta la conferma (solo per procedure
automatizzate). Nessuna `DB_PASSWORD` richiesta: `DB_NAME` e `DB_USER` si
leggono dal `.env` senza eseguirlo. Si accettano solo file `.sql.gz` verificati o
`.sql` già decifrati e decompressi: mai `.non-verificato`, `.scartato`,
`.parziale` o `.age`.

Il restore, nell'ordine:

1. Rifiuta i formati non ammessi e verifica il dump (marcatore finale di
   `pg_dump`): un dump troncato si ferma qui, con il backend acceso e il database
   intatto
2. Richiede `RIPRISTINO_TAG` e la esporta come `TAG`, la variabile che sceglie
   l'immagine del backend nel compose (`rifiuti-backend:${TAG}`)
3. Controlla lo spazio libero in `BACKUP_DATI_DIR` (default `/var/lib/docker`):
   dimensione del database × `RIPRISTINO_FATTORE_SPAZIO` (default 2). Se il
   database di produzione non esiste (disaster recovery, volume nuovo) la
   dimensione si stima dal dump decompresso
4. Chiede conferma esplicita (`YES`), poi ferma il backend
5. Ripristina il dump in un database nuovo `<DB>_ripristino_<epoch>_<pid>`, in
   una sola transaction (`psql -1 -v ON_ERROR_STOP=1`); se fallisce elimina il
   database temporaneo, **riavvia il backend** com'era ed esce, con il database di
   produzione intatto
6. Controlla il database ripristinato (almeno una tabella in `public`,
   `_prisma_migrations` leggibile); se fallisce, come al punto 5
7. Scambia i nomi: il database di produzione diventa
   `<DB>_prima_del_ripristino_<AAAAMMGG_HHMMSS>_<pid>` e quello ripristinato
   prende il nome `<DB>` (se il database di produzione non esisteva, il
   ripristinato prende solo il nome)
8. Esegue `prisma migrate deploy` con l'immagine `RIPRISTINO_TAG`. Se fallisce
   esce con errore e **il backend resta fermo**: il database ripristinato è in
   uso con lo schema non allineato, e farlo ripartire nasconderebbe il guasto. Il
   messaggio dice come rilanciare migrate e avvio, oppure come tornare al
   database precedente (rinominarlo in `<DB>` a backend fermo)
9. Ricrea il backend con l'immagine `RIPRISTINO_TAG`
   (`up -d --no-deps backend`, non `start`, che riavvierebbe il container con la
   sua immagine di prima), scrive nel log l'immagine effettiva ed esce con errore
   se non corrisponde al tag

In caso di errore l'ultima riga del log dice in che stato è il database di
produzione: `intatto` (backend riavviato), `quello ripristinato, con lo schema
NON allineato; il precedente è <nome>; il backend resta FERMO`, oppure uno stato
da verificare a mano se lo script è stato interrotto durante lo scambio dei nomi.

**Il database precedente non viene eliminato.** Dopo aver verificato
l'applicazione va eliminato a mano con `DROP DATABASE "<nome>"` (il nome è
nell'ultima riga del log); fino ad allora occupa quanto il database di
produzione.

**Prima e dopo il ripristino, tre cose che lo script non fa:**

- **Non sovrapporlo al backup notturno.** Lo scambio dei nomi termina le
  connessioni al database (`pg_terminate_backend`): un `pg_dump` del cron
  `wasteflow-backup` (03:30) in corso viene interrotto e manda una mail di
  fallimento. Evitare la finestra 03:15-04:30, oppure commentare la riga di
  `/etc/cron.d/wasteflow-backup` per la durata del ripristino e rimetterla dopo.
- **Le cache Redis restano quelle di prima.** Permessi (`perm-check:*`), sessioni
  (`session:*`, `session_epoch:*`) e refresh token (`refresh_token:*`) descrivono
  il database sostituito: un utente disattivato o un ruolo tolto dopo la data del
  dump torna valido nel database, ma una sessione aperta dopo quella data resta
  in Redis. Se il dump è vecchio, togliere quelle chiavi (forza un nuovo login per
  tutti), dal container `redis` (`docker compose ... exec redis sh`): `redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'perm-check:*' | xargs -r redis-cli -a "$REDIS_PASSWORD" DEL`,
  e lo stesso per gli altri prefissi. **Mai `FLUSHALL`**: Redis contiene anche
  le code dei job. Altrimenti accettarle sapendo che scadono da sole, ciascuna con
  la propria durata.
- **Il frontend resta sul tag del deploy.** `restore.sh` ricrea solo il backend
  con `RIPRISTINO_TAG`; il frontend continua con l'immagine dell'ultimo deploy
  fino al deploy successivo. Se i due tag differiscono, verificare che il
  frontend funzioni con quel backend, oppure ricrearlo con lo stesso tag
  (`TAG=<RIPRISTINO_TAG> docker compose ... up -d --no-deps frontend`).

Il ripristino di prova notturno già verifica ogni backup su un database
temporaneo; resta utile provare `restore.sh` su un ambiente di staging.

---

## F2-10 controparti (ditte e sedi)

Migration `20261031110000_ditte_sedi_controparti` (Fase 2 pezzo 10): ogni anagrafica di ruolo
(produttori, trasportatori, destinatari) viene collegata a una **ditta** per (azienda, partita IVA)
e a una **sede**; la stessa P.IVA in più ruoli della stessa azienda diventa UNA ditta. Gli id delle
righe di ruolo non cambiano, FIR e contratti non vengono toccati. La migration è transazionale e si
**ferma** (senza modificare nulla) se una P.IVA non è di 11 cifre.

### Censimento PRIMA del merge (lo lancia l'orchestratore sul VPS)

Sola lettura, soli conteggi:

```bash
docker exec -i <container postgres> psql -U <utente> -d <db>
```

```sql
WITH a AS (
  SELECT 'P' r, tenant_id, btrim(partita_iva) p, lower(btrim(ragione_sociale)) n FROM produttori
  UNION ALL SELECT 'T', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM trasportatori
  UNION ALL SELECT 'D', tenant_id, btrim(partita_iva), lower(btrim(ragione_sociale)) FROM destinatari)
SELECT
  (SELECT count(*) FROM a) AS anagrafiche,
  (SELECT count(*) FROM a WHERE p !~ '^[0-9]{11}$') AS piva_non_conformi,
  (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p HAVING count(DISTINCT r) > 1) x) AS ditte_fuse,
  (SELECT count(*) FROM (SELECT 1 FROM a GROUP BY tenant_id, p
     HAVING count(DISTINCT r) > 1 AND count(DISTINCT n) > 1) x) AS ditte_fuse_nome_divergente;
```

- `piva_non_conformi > 0` **blocca il merge**: le righe vanno corrette a mano prima.
- `ditte_fuse_nome_divergente` va nel rapporto finale (la ditta prende la ragione sociale della riga
  aggiornata più di recente; le righe di ruolo conservano la propria).

### Ripristino da migration fallita (P3009)

La migration è transazionale (DDL e DML in un solo script: un `RAISE EXCEPTION` annulla tutto).
Se il deploy si ferma con P3009:

1. controllare che la migration non abbia lasciato nulla: `SELECT to_regclass('public.ditte');` deve
   dare NULL (altrimenti non è stata annullata: fermarsi e chiedere);
2. correggere il dato indicato dal messaggio (i soli conteggi per tabella; i valori si cercano con il
   censimento, restringendo la `WHERE` a `p !~ '^[0-9]{11}$'`);
3. sul VPS, in `/opt/rifiuti/site`, dentro il container backend e COME OWNER (lo stesso modo in cui il
   job di deploy esegue `migrate deploy`, `.gitea/workflows/deploy.yml`):
   ```bash
   cd /opt/rifiuti/site
   COMPOSE="docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml"
   $COMPOSE run --rm backend sh -c 'DATABASE_URL="$DATABASE_URL_MIGRAZIONI" npx prisma migrate resolve --rolled-back 20261031110000_ditte_sedi_controparti'
   ```
   (o il nome della migration fallita; le virgolette singole fanno espandere `DATABASE_URL_MIGRAZIONI`
   dentro il container, non sulla shell del VPS), poi rilanciare il deploy.

### Rollback

Le migration sono additive fino al Task 3b-2 (`20261031110100_anagrafiche_su_ditte`): il codice
precedente continua a funzionare perché le colonne vecchie delle righe di ruolo non cambiano. Dopo
3b-2 il codice vecchio non legge le anagrafiche create dopo il deploy (colonne vecchie NULL):
il rollback del codice richiede il **ripristino del backup notturno** oppure uno script inverso che
ricostruisce le colonne vecchie dalla ditta e dalla sede predefinita
(`UPDATE produttori r SET partita_iva = d.partita_iva, ragione_sociale = d.ragione_sociale, via = s.via, ...
FROM ditte d, sedi_ditte s WHERE d.id = r.ditta_id AND s.id = r.sede_id`, per ciascuna tabella di
ruolo, poi rimettere i NOT NULL e gli indici unici `*_tenant_id_partita_iva_key`), da scrivere e
provare nel Task 3b-2.

---

## Rollback

Se lo smoke test fallisce dopo `migrate` e `up -d`, i container nuovi restano
su. Il workflow di deploy **non** può rilasciare un tag precedente:
`workflow_dispatch` non ha input e lo script fa sempre
`git reset --hard origin/master` e rilascia l'immagine di `github.sha`
(`deploy.yml`: trigger `workflow_dispatch` e passo "Deploy via SSH").

Il rollback reale è quindi `git revert -m 1 <commit di merge>` su `master` e la
pipeline intera (build delle immagini di 30-40 minuti sul runner condiviso, più
il deploy). È possibile solo se le migration del rilascio sono additive (per la
Fase 0 lo sono: il piano C aggiunge una colonna nullable e un indice, ignorati
dal codice vecchio; vedere nel piano C il caso limite di Capodanno).
Vale per lo schema, non per un dato: se un'azienda ha impostato il **progressivo
iniziale** del registro (piano R) e il codice torna indietro **prima** del primo
movimento di quell'anno, il codice vecchio numera da 1 e ignora l'impostazione
senza dirlo. Prima del rollback controllare `registro_progressivi_iniziali`
per l'anno in corso e avvisare le aziende interessate.

Stesso discorso per le **giacenze iniziali** del registro (Fase 2 pezzo 2, tabella
`giacenze_iniziali`): il codice vecchio non le conosce, quindi dopo un rollback le
aperture sono ignorate e gli scarichi che contavano su di loro tornano bloccati
per giacenza insufficiente (o, se erano gia' registrati, il saldo risulta
negativo). Prima del rollback controllare `SELECT tenant_id, count(*) FROM
giacenze_iniziali GROUP BY 1` e avvisare le aziende interessate; la tabella resta
nel database (migration additiva) e riprende a contare al ripristino del codice.

Stesso discorso per **rettifiche e annullamenti** (Fase 2 pezzo 3, colonne
`tipo_annotazione`, `movimento_rettificato_id`, `movimento_originale_id`,
`motivo_annotazione`, `hash_versione` su `waste_movements`): il codice vecchio non
le conosce, quindi dopo un rollback le correzioni conterebbero come movimenti
ordinari (un annullamento sommerebbe la quantita' invece di toglierla, una
rettifica si sommerebbe all'annotazione che corregge) e giacenze, MUD e anomalie
risulterebbero sbagliati. **Prima del rollback** controllare `SELECT tenant_id,
tipo_annotazione, count(*) FROM waste_movements WHERE tipo_annotazione <>
'ORDINARIA' GROUP BY 1, 2`: se non e' vuoto, il rollback del codice non e'
innocuo e va concordato con le aziende interessate. Le colonne restano nel
database (migration additiva) e tornano a contare al ripristino del codice.

Stesso discorso per le **causali del registro** (Fase 2 pezzo 5, tabelle `causali_registro` e
`causali_registro_azienda`, colonna `waste_movements.causale_azienda_id`): il codice vecchio
conosce solo le 11 causali di sempre, quindi dopo un rollback le causali `AZ_...` tornano
`ESCLUSO` nel MUD e non sono piu' registrabili (i movimenti gia' registrati restano, con la causale
come testo). **Prima del rollback** controllare `SELECT tenant_id, count(*) FROM
causali_registro_azienda GROUP BY 1` e `SELECT tenant_id, count(*) FROM waste_movements WHERE
causale_azienda_id IS NOT NULL GROUP BY 1`: se non sono vuote, avvisare le aziende interessate. Le
tabelle e la colonna restano nel database (migration additiva) e tornano a contare al ripristino del
codice; il ripristino a mano dello schema e' nel commento iniziale della migration
`20261030100000_causali_registro`. Dopo ogni `prisma migrate deploy` va rieseguito
`ops/db-ruoli.sh`: la sola lettura di `causali_registro` per i ruoli applicativi sta anche li'.

Il ripristino dal backup `wasteflow_predeploy_*` con `restore.sh` si fa solo se
una migration ha alterato dati, e perde le scritture successive al backup. Si fa
**dopo** il `git revert` e la pipeline, con `RIPRISTINO_TAG` uguale al tag del
rilascio **precedente** (quello in produzione prima del deploy da annullare):
`restore.sh` esegue `prisma migrate deploy` con quell'immagine e ci ricrea il
backend, e con il tag del
rilascio da annullare riapplicherebbe proprio la migration che si voleva togliere.

Aggiungere a `deploy.yml` un input `tag` che salti la build è una decisione
aperta (Decisioni aperte, 9).

- I revert dei piani della Fase 0 vanno **solo in ordine inverso** (A, poi C,
  poi D), perché C importa da D e A da C.
- Per rilasciare di nuovo un piano revertito serve il **revert del revert**, non
  un nuovo merge del branch.
- Dopo un revert di A le chiavi scritte in `MUDReport.reportData`
  (`integrazioni`, `esportazioni`, `annullamenti`, ...) restano e il codice
  vecchio le ignora.

---

## Metriche Prometheus (`/metrics`)

Il backend espone l'endpoint standard Prometheus a:

```
GET http://backend:3000/metrics
```

(NON sotto il prefix `/api/v1` — escluso a livello di app)

### Aggiunta job Prometheus su infra condivisa

Aggiungere al file `/opt/observability/prometheus.yml` sul VPS:

```yaml
scrape_configs:
  # ... job esistenti ...

  - job_name: 'wasteflow-backend'
    static_configs:
      - targets: ['backend:3000'] # rete compose 'wasteflow'
    metrics_path: /metrics
    scrape_interval: 30s
    scrape_timeout: 10s
```

Poi ricaricare Prometheus a caldo (senza restart):

```bash
curl -s -X POST http://127.0.0.1:9091/-/reload
```

Verificare che il target sia UP:

```
http://grafana.ignicraft.com/explore → selezionare datasource prometheus-infra
→ query: up{job="wasteflow-backend"}
```

> **Nota**: affinché Prometheus (container nella rete `monitoring`) raggiunga
> il backend (rete `wasteflow`), il container backend deve essere collegato a
> entrambe le reti. Il `docker-compose.prod.yml` già include
> `networks: [wasteflow, monitoring]` per il servizio backend.

---

## Error tracking (Bugsink)

**Attivo dal 23/10/2026.** Progetto Bugsink `wasteflow` (id 5), UI su
`https://error.ignicraft.com`.

- **Backend**: `SENTRY_DSN` in `/opt/rifiuti/.env`, passata al container da
  `docker-compose.prod.yml` (con `SENTRY_ENVIRONMENT`, default `production`).
  Usa il DSN interno, perche' il backend e' sulla rete `monitoring`:

  ```
  SENTRY_DSN=http://<32hex-senza-trattini>@bugsink:8000/5
  ```

  Dopo una modifica al DSN il container va **ricreato** (`restart` non rilegge
  l'env):

  ```bash
  docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend
  ```

- **Frontend**: il DSN pubblico (`https://<chiave>@error.ignicraft.com/5`) sta
  in `apps/frontend/src/environments/environment.prod.ts` ed entra nel bundle
  alla build; la CSP di `apps/frontend/nginx.conf` ammette
  `https://error.ignicraft.com` in `connect-src`.

La chiave del DSN si legge dal progetto Bugsink (`sentry_key` con i trattini
tolti).

Il progetto su Bugsink si crea con `docker exec bugsink bugsink-manage shell`
(`from projects.models import Project`); la chiave del DSN va scritta senza trattini.

### Cosa viene inviato

- I 5xx dell'API, tranne i 503 delle rotte `/health` (sono il segnale normale di un
  controllo che fallisce; Decisione 4). Tag `correlationId` e `statusCode`, utente (solo
  `id`), `tenantId` e percorso senza query string.
- Gli errori dei job schedulati (`@Cron`), con il tag `job` (il nome del metodo) e, per gli
  errori per tenant dei tre job RENTRI, il tag `tenantId`.
- Prova d'invio: come al passo 7.5 del piano (`docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`), provocare un errore e leggere l'evento in Bugsink.

### Dati personali

Gli eventi non portano corpo, header, cookie né query string della richiesta (né query e fragment delle chiamate HTTP in uscita nei breadcrumb), e l'utente è
ridotto al solo `id` (Decisione 5; `apps/backend/src/core/monitoring/opzioni-sentry.ts`).
Ogni aggiornamento dell'SDK va seguito dalla lettura di un evento vero, come al passo 7.5 del piano `docs/superpowers/plans/2026-10-21-fase0-d-esercizio.md`,
per verificare che le opzioni abbiano ancora l'effetto voluto.

### Limite del guardiano dei job

Il test `segnala-errore-job.spec.ts` verifica che ogni metodo `@Cron` chiami
`segnalaErroreJob`. È un controllo testuale: non vede gli errori inghiottiti da un `catch`
interno (i `catch` per utente di `checkMudDeadlines` restano solo nel log).

### Orari dei job

Sono in UTC, perché il backend non ha `TZ` (Decisione 10): `EVERY_DAY_AT_8AM` sono le 09:00
italiane d'inverno e le 10:00 d'estate.

---

## Invio email (SMTP)

Attivato l'11/09/2026. Casella dedicata al prodotto:
`wasteflowsoftware@gmail.com`.

### Le due trappole, verificate sul campo

**1. La password dell'account NON funziona.** Dal 2022 Google non accetta più
le credenziali normali per l'accesso SMTP dei programmi: risponde
`535 5.7.8 Username and Password not accepted`. Serve una **password per app**,
16 caratteri minuscoli in 4 gruppi, da `myaccount.google.com/apppasswords`.

La voce **non compare** finché la verifica in due passaggi non è attiva
sull'account — Google la nasconde del tutto, non la mostra disabilitata. Se il
pannello dice «L'impostazione che stai cercando non è disponibile», è quello il
motivo, non un problema del browser.

**2. Prima ancora, il compose non passava le variabili al container.** Le
credenziali potevano stare in `/opt/rifiuti/.env` e il backend non le vedeva:
l'invio falliva all'avvio con «Missing credentials for PLAIN» qualunque cosa ci
fosse nel file. Le variabili `SMTP_*`, `EMAIL_FROM` e
`ACCESS_REQUEST_NOTIFY_EMAIL` sono ora dichiarate in `docker-compose.prod.yml`.

### Configurazione

In `/opt/rifiuti/.env` (mode 600, mai versionato):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=wasteflowsoftware@gmail.com
SMTP_PASSWORD=<password per app, 16 caratteri SENZA spazi>
EMAIL_FROM=wasteflowsoftware@gmail.com
ACCESS_REQUEST_NOTIFY_EMAIL=wasteflowsoftware@gmail.com
```

**Porta 465 e non 587**: il provider del VPS blocca la 587 in uscita, e il
codice attiva TLS solo se `SMTP_PORT` vale **esattamente** `'465'`
(`email.service.ts`). **`SMTP_USER` deve coincidere con `EMAIL_FROM`**,
altrimenti Gmail riscrive il mittente e i messaggi finiscono nello spam.

Poi ricreare il backend (non basta `restart`: le variabili si leggono alla
creazione del container):

```bash
cd /opt/rifiuti/site
docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend
```

### Verifica

All'avvio il log deve dire `SMTP server ready to send emails` e **non** deve
contenere `Missing credentials`:

```bash
docker logs rifiuti-backend-1 2>&1 | grep -iE "SMTP|Missing credentials"
```

Ma «pronto» non è «consegnato»: per una prova vera, inviare un messaggio e
controllare che arrivi davvero in casella.
