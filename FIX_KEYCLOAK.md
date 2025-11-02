# 🔧 Fix Keycloak Database Issue

## Problema

Keycloak non si avvia con l'errore:
```
ERROR: FATAL: database "keycloak" does not exist
```

## Causa

PostgreSQL crea solo il database `wasteflow_dev`, ma Keycloak ha bisogno di un database separato chiamato `keycloak`.

## Soluzione

Ho creato uno script SQL di inizializzazione che crea automaticamente il database keycloak.

### File Creati

1. **`docker/postgres/init-databases.sql`** - Script SQL di init per PostgreSQL
2. **`docker-compose.yml`** - Aggiornato per montare lo script SQL
3. **`RESTART_SERVICES.bat`** - Script rapido per riavviare tutto

---

## 🚀 Come Risolvere

### Opzione 1: Reset Completo (Consigliato)

**⚠️ ATTENZIONE: Questa operazione cancellerà tutti i dati esistenti!**

```bash
# Ferma tutti i container
docker-compose down

# Rimuovi i volumi (include i database)
docker-compose down -v

# Riavvia tutto (lo script di init creerà entrambi i database)
docker-compose up -d
```

### Opzione 2: Creazione Manuale Database

Se vuoi mantenere i dati esistenti:

```bash
# Connettiti a PostgreSQL
docker-compose exec postgres psql -U wasteflow -d wasteflow_dev

# Crea il database keycloak
CREATE DATABASE keycloak;
GRANT ALL PRIVILEGES ON DATABASE keycloak TO wasteflow;

# Esci
\q

# Riavvia Keycloak
docker-compose restart keycloak
```

### Opzione 3: Script Automatico (Più Semplice)

**Windows:**
```cmd
RESTART_SERVICES.bat
```

**Linux/Mac:**
```bash
docker-compose down -v && docker-compose up -d
```

---

## ✅ Verifica Funzionamento

Dopo aver eseguito la soluzione, verifica che tutto funzioni:

### 1. Check Database Creati

```bash
docker-compose exec postgres psql -U wasteflow -d wasteflow_dev -c "\l"
```

Dovresti vedere:
```
                                                List of databases
     Name      |   Owner   | Encoding |  Collate   |   Ctype    | ICU Locale | Locale Provider |   Access privileges
---------------+-----------+----------+------------+------------+------------+-----------------+-----------------------
 keycloak      | wasteflow | UTF8     | en_US.utf8 | en_US.utf8 |            | libc            | =Tc/wasteflow        +
               |           |          |            |            |            |                 | wasteflow=CTc/wasteflow
 wasteflow_dev | wasteflow | UTF8     | en_US.utf8 | en_US.utf8 |            | libc            | =Tc/wasteflow        +
               |           |          |            |            |            |                 | wasteflow=CTc/wasteflow
```

### 2. Check Keycloak Status

```bash
# Visualizza logs Keycloak
docker-compose logs keycloak | tail -20

# Dovresti vedere:
# "Started server in (development) mode"
```

### 3. Check Keycloak Web UI

Apri browser: http://localhost:8080

Dovresti vedere la pagina di login Keycloak.

Login:
- **Username:** admin
- **Password:** admin

---

## 📋 Comandi Utili

### Visualizza Logs in Real-Time

```bash
# Tutti i servizi
docker-compose logs -f

# Solo Keycloak
docker-compose logs -f keycloak

# Solo PostgreSQL
docker-compose logs -f postgres
```

### Check Health di Tutti i Servizi

```bash
docker-compose ps
```

Dovresti vedere tutti i servizi con status **Up** e **healthy**:

```
NAME                      STATUS              PORTS
wasteflow-postgres        Up (healthy)        0.0.0.0:5432->5432/tcp
wasteflow-keycloak        Up (healthy)        0.0.0.0:8080->8080/tcp
wasteflow-redis           Up (healthy)        0.0.0.0:6379->6379/tcp
wasteflow-mailhog         Up (healthy)        0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp
```

### Riavvio Singolo Servizio

```bash
# Solo Keycloak
docker-compose restart keycloak

# Solo PostgreSQL
docker-compose restart postgres
```

---

## 🐛 Troubleshooting

### Keycloak continua a fallire

```bash
# Rebuild immagine Keycloak
docker-compose build keycloak

# Riavvia
docker-compose up -d keycloak
```

### Script SQL non viene eseguito

Lo script `/docker-entrypoint-initdb.d/01-init-databases.sql` viene eseguito **SOLO** se il volume PostgreSQL è vuoto (prima volta).

Per forzare l'esecuzione:

```bash
# Rimuovi volume PostgreSQL
docker-compose down -v

# Riavvia (script SQL verrà eseguito)
docker-compose up -d
```

### Errore line endings (risolto)

Versione precedente usava bash script che aveva problemi con line endings Windows (CRLF).

**Soluzione:** Ora usa SQL puro che non ha questo problema.

### Database già esiste

Se vedi errore "database already exists":

```bash
# È normale se hai già creato il database manualmente
# Puoi ignorare l'errore o rimuovere il volume e ricreare
docker-compose down -v
docker-compose up -d
```

---

## 📚 Files Modificati

1. **`docker-compose.yml`**
   - Cambiato `POSTGRES_DB: wasteflow` → `POSTGRES_DB: wasteflow_dev`
   - Aggiunto mount dello script SQL init
   - Script montato in `/docker-entrypoint-initdb.d/01-init-databases.sql`

2. **`docker/postgres/init-databases.sql`** (usato)
   - Script SQL che crea database `keycloak`
   - Compatibile con Windows/Linux (nessun problema line endings)
   - Eseguito automaticamente al primo avvio PostgreSQL

3. **`docker/postgres/init-databases.sh`** (deprecato)
   - Versione bash con problemi line endings
   - Non più utilizzato

---

## 🎯 Prossimi Passi

Dopo aver risolto, puoi continuare con:

1. **Setup Backend:**
   ```bash
   cd apps/backend
   npm install
   npx prisma generate
   npx prisma migrate dev
   ```

2. **Setup Frontend:**
   ```bash
   cd apps/frontend
   npm install
   npm start
   ```

3. **Configura Keycloak:**
   - Apri http://localhost:8080
   - Login con admin/admin
   - Crea realm "wasteflow"
   - Configura client per backend

---

## 💡 Note

- Lo script di init viene eseguito **solo alla prima creazione** del volume PostgreSQL
- Se modifichi lo script, devi rimuovere il volume con `docker-compose down -v`
- In produzione, i database vengono creati manualmente o via migrations

---

**Problema risolto? Esegui `docker-compose down -v && docker-compose up -d` ora!** 🚀
