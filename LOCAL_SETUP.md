# WasteFlow - Configurazione Sviluppo Locale

Guida completa per avviare WasteFlow in ambiente di sviluppo locale.

## 📋 Prerequisiti

### Software Richiesto

- **Node.js** 20.x o superiore ([Download](https://nodejs.org/))
- **Docker Desktop** ([Download](https://www.docker.com/products/docker-desktop))
- **Git** ([Download](https://git-scm.com/))

### Verifica Installazioni

```bash
node --version   # Dovrebbe essere >= 20.x
npm --version    # Dovrebbe essere >= 10.x
docker --version # Dovrebbe essere >= 24.x
git --version
```

---

## 🚀 Quick Start (Automatico)

### Windows

```cmd
# 1. Clona il repository
git clone https://github.com/yourusername/wasteflow.git
cd wasteflow

# 2. Esegui lo script di setup
scripts\dev-start.bat
```

### Linux/Mac

```bash
# 1. Clona il repository
git clone https://github.com/yourusername/wasteflow.git
cd wasteflow

# 2. Rendi eseguibile lo script
chmod +x scripts/dev-start.sh

# 3. Esegui lo script di setup
./scripts/dev-start.sh
```

Lo script automatico:
- ✅ Crea il file `.env` da `.env.example`
- ✅ Avvia tutti i servizi Docker
- ✅ Installa dipendenze backend e frontend
- ✅ Genera Prisma Client
- ✅ Esegue migrations database
- ✅ Esegue seed (dati iniziali)

---

## 🔧 Setup Manuale (Passo-Passo)

### 1. Clone del Repository

```bash
git clone https://github.com/yourusername/wasteflow.git
cd wasteflow
```

### 2. Configurazione Environment

```bash
# Copia il file di esempio
cp .env.example .env

# Opzionale: modifica i valori (ma i default funzionano!)
nano .env  # o usa il tuo editor preferito
```

### 3. Avvia Servizi Docker

```bash
# Avvia tutti i servizi in background
docker-compose up -d

# Verifica che siano avviati
docker-compose ps
```

Dovresti vedere:

```
NAME                      STATUS   PORTS
wasteflow-postgres        Up       0.0.0.0:5432->5432/tcp
wasteflow-redis           Up       0.0.0.0:6379->6379/tcp
wasteflow-keycloak        Up       0.0.0.0:8080->8080/tcp
wasteflow-mailhog         Up       0.0.0.0:1025->1025/tcp, 0.0.0.0:8025->8025/tcp
wasteflow-localstack      Up       0.0.0.0:4566->4566/tcp
wasteflow-rentri-mock     Up       0.0.0.0:3001->3000/tcp
wasteflow-pgadmin         Up       0.0.0.0:5050->80/tcp
```

### 4. Setup Backend

```bash
cd apps/backend

# Installa dipendenze
npm install

# Genera Prisma Client
npx prisma generate

# Esegui migrations
npx prisma migrate dev --name init

# Seed database (se disponibile)
npx prisma db seed
```

### 5. Setup Frontend

```bash
cd apps/frontend

# Installa dipendenze
npm install
```

### 6. Avvia Applicazione

**Opzione A: Due terminali separati**

Terminal 1 (Backend):
```bash
cd apps/backend
npm run start:dev
```

Terminal 2 (Frontend):
```bash
cd apps/frontend
npm start
```

**Opzione B: Concurrently (se configurato)**

```bash
# Dalla root del progetto
npm run dev
```

---

## 🌐 Servizi Disponibili

Una volta avviati tutti i servizi:

| Servizio | URL | Credenziali |
|----------|-----|-------------|
| **Frontend** | http://localhost:4200 | - |
| **Backend API** | http://localhost:3000 | - |
| **Swagger Docs** | http://localhost:3000/api | - |
| **Keycloak** | http://localhost:8080 | admin / admin |
| **MailHog** | http://localhost:8025 | - |
| **pgAdmin** | http://localhost:5050 | admin@wasteflow.local / admin |
| **RENTRI Mock** | http://localhost:3001 | - |
| **LocalStack S3** | http://localhost:4566 | - |

### Dettagli Servizi

#### 🔐 Keycloak (SPID/CIE Mock)
- **Admin Console:** http://localhost:8080/admin
- **Realm:** `wasteflow`
- Usato per autenticazione SPID/CIE in sviluppo

#### 📧 MailHog (Email Testing)
- **Web UI:** http://localhost:8025
- Cattura tutte le email inviate dall'applicazione
- Nessuna email viene inviata realmente

#### 🗄️ pgAdmin (Database UI)
- **URL:** http://localhost:5050
- Al primo accesso, aggiungi server:
  - **Host:** `postgres` (nome servizio Docker)
  - **Port:** `5432`
  - **Database:** `wasteflow_dev`
  - **Username:** `wasteflow`
  - **Password:** `wasteflow123`

#### 📨 RENTRI Mock API
- **URL:** http://localhost:3001
- Simula API RENTRI per sviluppo
- Endpoints: `/api/fir/submit`, `/api/fir/status`

---

## 🔍 Verifica Installazione

### 1. Check Backend

```bash
# Health check
curl http://localhost:3000/health

# Risposta attesa:
# {"status":"ok","timestamp":"...","uptime":...}
```

### 2. Check Database

```bash
# Connessione diretta con psql
docker-compose exec postgres psql -U wasteflow -d wasteflow_dev

# Lista tabelle
\dt

# Esci
\q
```

### 3. Check Frontend

Apri browser: http://localhost:4200

Dovresti vedere la pagina di login di WasteFlow.

---

## 🛠️ Comandi Utili

### Docker

```bash
# Visualizza logs di tutti i servizi
docker-compose logs -f

# Visualizza logs di un servizio specifico
docker-compose logs -f postgres

# Ferma tutti i servizi
docker-compose down

# Ferma e rimuovi volumi (ATTENZIONE: cancella dati!)
docker-compose down -v

# Riavvia un servizio specifico
docker-compose restart postgres

# Rebuild immagini
docker-compose build
```

### Database

```bash
cd apps/backend

# Apri Prisma Studio (UI per database)
npx prisma studio

# Crea nuova migration
npx prisma migrate dev --name nome_migration

# Reset database (ATTENZIONE: cancella tutti i dati!)
npx prisma migrate reset

# Seed database
npx prisma db seed

# Visualizza stato migrations
npx prisma migrate status
```

### Backend

```bash
cd apps/backend

# Avvia in modalità development (hot reload)
npm run start:dev

# Avvia in modalità debug
npm run start:debug

# Build per produzione
npm run build

# Esegui tests
npm run test

# Test con coverage
npm run test:cov

# Lint
npm run lint
```

### Frontend

```bash
cd apps/frontend

# Avvia dev server
npm start

# Build per produzione
npm run build

# Test
npm run test

# Lint
npm run lint
```

---

## 🐛 Troubleshooting

### Problema: "Port already in use"

**Sintomo:**
```
Error: bind: address already in use
```

**Soluzione:**
```bash
# Trova processo che usa la porta (es. 5432)
# Windows
netstat -ano | findstr :5432

# Linux/Mac
lsof -i :5432

# Termina il processo o cambia porta in docker-compose.yml
```

### Problema: "Keycloak non si avvia"

**Sintomo:**
```
Keycloak exited with code 1
```

**Soluzione:**
```bash
# Keycloak richiede tempo per avviarsi (30-60 secondi)
# Verifica logs
docker-compose logs keycloak

# Se persistente, ricrea container
docker-compose down
docker-compose up -d
```

### Problema: "Cannot connect to database"

**Sintomo:**
```
Error: P1001: Can't reach database server
```

**Soluzione:**
```bash
# Verifica che PostgreSQL sia running
docker-compose ps postgres

# Verifica che sia healthy
docker-compose exec postgres pg_isready -U wasteflow

# Ricrea database
docker-compose down -v
docker-compose up -d
```

### Problema: "Prisma Client not generated"

**Sintomo:**
```
Error: @prisma/client did not initialize yet
```

**Soluzione:**
```bash
cd apps/backend

# Rigenera Prisma Client
npx prisma generate

# Riavvia backend
npm run start:dev
```

### Problema: "npm install fails"

**Sintomo:**
```
npm ERR! code ERESOLVE
```

**Soluzione:**
```bash
# Pulisci cache npm
npm cache clean --force

# Rimuovi node_modules e package-lock
rm -rf node_modules package-lock.json

# Reinstalla
npm install

# Se persiste, usa --legacy-peer-deps
npm install --legacy-peer-deps
```

---

## 📊 Database Seed Data

Il seed script (`apps/backend/prisma/seed.ts`) popola il database con:

- ✅ **Codici CER** completi (catalogo rifiuti)
- ✅ **Utenti di test**
  - Admin: `admin@wasteflow.local` / `admin123`
  - User: `user@wasteflow.local` / `user123`
- ✅ **Tenant di esempio**
- ✅ **FIR di esempio** (bozze e completati)
- ✅ **Anagrafiche** (produttori, trasportatori, destinatari)

Per rigenerare i dati seed:

```bash
cd apps/backend
npx prisma db seed
```

---

## 🔄 Workflow Sviluppo Tipico

1. **Mattina - Avvio ambiente:**
   ```bash
   docker-compose up -d
   cd apps/backend && npm run start:dev
   # Nuovo terminale
   cd apps/frontend && npm start
   ```

2. **Durante sviluppo:**
   - Backend: hot reload automatico (NestJS watch mode)
   - Frontend: hot reload automatico (Angular dev server)
   - Database: usa Prisma Studio per visualizzare dati

3. **Test email:**
   - Apri MailHog: http://localhost:8025
   - Tutte le email appaiono qui

4. **Test API:**
   - Swagger UI: http://localhost:3000/api
   - Oppure usa Postman/Insomnia

5. **Fine giornata:**
   ```bash
   # Ferma solo app (lascia Docker running)
   Ctrl+C nei terminali

   # Oppure ferma tutto
   docker-compose down
   ```

---

## 📝 Prossimi Passi

Dopo aver completato il setup:

1. **Leggi la documentazione API:**
   - http://localhost:3000/api (Swagger)
   - `IMPLEMENTATION_SUMMARY.md` (architettura)

2. **Esplora il codice:**
   - `apps/backend/src` - Backend NestJS
   - `apps/frontend/src` - Frontend Angular

3. **Crea il primo FIR:**
   - Login: http://localhost:4200
   - Dashboard → Crea FIR
   - Segui workflow firma digitale

4. **Configura Keycloak SPID (opzionale):**
   - http://localhost:8080/admin
   - Importa provider SPID di test

---

## 🆘 Supporto

- **Issues:** https://github.com/yourusername/wasteflow/issues
- **Discussions:** https://github.com/yourusername/wasteflow/discussions
- **Email:** support@wasteflow.local

---

**Happy Coding! 🚀**
