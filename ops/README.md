# ops/ — Procedure operative WasteFlow

## Backup off-site

### Script: `backup-offsite.sh`

Produce un dump gzip del database PostgreSQL e lo copia su una destinazione
remota (rsync+SSH o rclone/S3). Da eseguire sul VPS come root.

**Configurazione variabili** (aggiungere a `/opt/rifiuti/.env`):

```bash
# Modalità off-site: rsync | rclone | disabled
OFFSITE_MODE=rsync

# rsync: destinazione SSH
RSYNC_TARGET="backup@backup-server.example.com:/backups/wasteflow/"
RSYNC_SSH_KEY="/root/.ssh/id_ed25519_backup"

# Rotazione locale (default 30 giorni)
BACKUP_RETENTION_DAYS=30

# Cifratura opzionale con age (https://age-encryption.org/)
ENCRYPT_BACKUP=false
# AGE_RECIPIENT="age1..."   # chiave pubblica age del destinatario
```

**Esecuzione manuale:**

```bash
source /opt/rifiuti/.env && bash /opt/rifiuti/ops/backup-offsite.sh
```

**Cron suggerito** (ogni notte alle 03:30):

```
# /etc/cron.d/wasteflow-backup
30 3 * * * root source /opt/rifiuti/.env && bash /opt/rifiuti/ops/backup-offsite.sh >> /var/log/wasteflow-backup.log 2>&1
```

---

## Ripristino (Disaster Recovery)

### Script: `restore.sh`

**DISTRUTTIVO**: elimina e ricrea il database, poi ripristina il dump.

```bash
# 1. Scaricare il backup desiderato (rsync / rclone / manuale)
rsync -az backup@backup-server.example.com:/backups/wasteflow/wasteflow_..._20260610.sql.gz \
  /opt/rifiuti/backups/

# 2. Se cifrato con age, decifrare prima:
# age -d -i ~/.age/key.txt dump.sql.gz.age > dump.sql.gz

# 3. Eseguire il ripristino (chiede conferma interattiva):
source /opt/rifiuti/.env && bash /opt/rifiuti/ops/restore.sh \
  /opt/rifiuti/backups/wasteflow_wasteflow_prod_20260610_033000.sql.gz
```

Il restore:

1. Chiede conferma esplicita (`YES`)
2. Ferma il container backend (evita scritture concorrenti)
3. Termina le connessioni attive, droppa e ricrea il DB
4. Ripristina il dump
5. Esegue `prisma migrate deploy` per allineare lo schema
6. Riavvia il backend
7. Suggerisce un health check di verifica

**Testa il restore periodicamente** su un DB di staging per validare l'integrità dei backup.

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
