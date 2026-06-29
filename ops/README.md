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
      - targets: ['backend:3000']   # rete compose 'wasteflow'
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

Dopo aver impostato il DSN, riavviare il backend:
```bash
docker compose -p rifiuti --env-file /opt/rifiuti/.env -f docker-compose.prod.yml restart backend
```
