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

Il ripristino di prova notturno già verifica ogni backup su un database
temporaneo; resta utile provare `restore.sh` su un ambiente di staging.

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

Impostare la variabile `SENTRY_DSN` in `/opt/rifiuti/.env` con il DSN del
progetto creato su Bugsink (`http://bugsink:8000`). Formato:

```
SENTRY_DSN=http://<32hex-senza-trattini>@bugsink:8000/<project_id>
```

Ottenere il DSN: pannello Bugsink → Projects → [progetto wasteflow] →
SDK Setup → DSN. Strippare i trattini dall'UUID.

La variabile arriva al container perché è elencata nel compose di produzione (prima
non c'era, come le variabili SMTP). Dopo averla impostata va **ricreato** il backend:
`restart` non rilegge l'ambiente, serve `up -d`.

```bash
docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend
```

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
