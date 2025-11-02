# WasteFlow - Contesto di Sviluppo

> Ultimo aggiornamento: 2025-11-02
> Questo file contiene informazioni essenziali per riprendere lo sviluppo in qualsiasi momento

---

## 📋 Indice Rapido

- [Stato Servizi](#stato-servizi)
- [Configurazione Porte](#configurazione-porte)
- [Comandi Essenziali](#comandi-essenziali)
- [Stack Tecnologico](#stack-tecnologico)
- [Note di Sessione](#note-di-sessione)

---

## 🟢 Stato Servizi

### Servizi Docker Configurati

| Servizio | Container | Porta | Stato Default | Health Check |
|----------|-----------|-------|---------------|--------------|
| PostgreSQL 16 | wasteflow-postgres | 5433 → 5432 | Deve essere avviato | ✅ pg_isready |
| Redis 7 | wasteflow-redis | 6379 | Deve essere avviato | ✅ redis-cli ping |
| Keycloak 23 | wasteflow-keycloak | 8080 | Deve essere avviato | ✅ /health/ready |
| MailHog | wasteflow-mailhog | 1025 (SMTP), 8025 (UI) | Deve essere avviato | ✅ wget :8025 |
| RENTRI Mock | wasteflow-rentri-mock | 3001 → 3000 | Deve essere avviato | ✅ /health |
| PgAdmin | wasteflow-pgadmin | 5050 → 80 | Opzionale | - |

### Servizi Applicativi

| Servizio | Tecnologia | Porta | Comando Avvio | Path |
|----------|-----------|-------|---------------|------|
| Backend API | NestJS 10.3 | 3000 | `npm run start:dev` | `apps/backend` |
| Frontend | Angular 17 | 4200 | `npm start` | `apps/frontend` |

---

## 🔌 Configurazione Porte

### Porte in Uso

```
APPLICAZIONE:
  3000  - Backend NestJS (API REST + WebSocket)
  4200  - Frontend Angular (Dev Server)

DATABASE & CACHE:
  5433  - PostgreSQL (mappato da 5432 interno)
  6379  - Redis

AUTENTICAZIONE:
  8080  - Keycloak (SPID/CIE + OAuth2)

EMAIL & STORAGE:
  1025  - MailHog SMTP
  8025  - MailHog Web UI
  4566  - LocalStack S3 (DISABILITATO)

MONITORING & TOOLS:
  5050  - PgAdmin
  3001  - RENTRI Mock API
```

### Conflitti Porta Noti

- **Porta 3001**: Usata sia da RENTRI Mock (Docker) che potenzialmente da backend in modalità debug
- **Porta 4566**: LocalStack attualmente disabilitato (problemi volume su Windows)

---

## ⚡ Comandi Essenziali

### 🚀 Avvio Completo (Primo Setup)

```bash
# 1. Avvia servizi Docker
docker-compose up -d

# 2. Setup Backend
cd apps/backend
npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed

# 3. Setup Frontend
cd ../frontend
npm install

# 4. Avvia Backend (Terminal 1)
cd ../backend
npm run start:dev

# 5. Avvia Frontend (Terminal 2)
cd ../frontend
npm start
```

### 🔄 Avvio Giornaliero

```bash
# 1. Avvia Docker (se non già avviato)
docker-compose up -d

# 2. Terminal 1 - Backend
cd apps/backend && npm run start:dev

# 3. Terminal 2 - Frontend
cd apps/frontend && npm start
```

### 🛑 Chiusura Servizi

```bash
# Ferma processi Node.js
# Windows: Ctrl+C nei terminali oppure
netstat -ano | findstr ":3000 :4200"
taskkill //F //PID [PID_NUMBER]

# Ferma Docker (opzionale, può restare attivo)
docker-compose down
```

### 🔨 Comandi di Sviluppo

```bash
# Root del progetto
npm run backend:dev          # Avvia backend
npm run backend:test         # Test backend
npm run backend:test:watch   # Test in watch mode
npm run lint                 # Lint tutto il progetto
npm run format               # Format codice

# Backend (apps/backend)
npm run start:dev            # Dev mode con watch
npm run start:debug          # Debug mode
npm test                     # Tutti i test
npm run test:watch           # Test in watch mode
npm run test:cov             # Coverage report
npx prisma studio            # UI database
npx prisma migrate dev       # Crea migration
npx prisma db seed           # Seed database

# Frontend (apps/frontend)
npm start                    # Dev server (porta 4200)
npm run build                # Build produzione
npm test                     # Test Karma/Jasmine
```

### 🐳 Docker Management

```bash
# Stato servizi
docker-compose ps

# Logs
docker-compose logs -f                    # Tutti i servizi
docker-compose logs -f postgres           # Solo PostgreSQL
docker-compose logs -f keycloak          # Solo Keycloak

# Restart servizi
docker-compose restart                    # Tutti
docker-compose restart postgres          # Solo PostgreSQL

# Reset completo
docker-compose down -v                   # Rimuove anche volumi
docker-compose up -d                     # Riavvia tutto

# Script automatici
RESTART_SERVICES.bat                     # Windows: restart Docker
QUICK_FIX.bat                            # Windows: reset completo
```

---

## 🛠️ Stack Tecnologico

### Backend

```yaml
Runtime: Node.js 20 LTS
Framework: NestJS 10.3
Database ORM: Prisma 5.8
Database: PostgreSQL 16
Cache: Redis 7 (ioredis)
Authentication:
  - Passport.js (JWT, SAML)
  - passport-saml (SPID/CIE)
  - Keycloak integration
Background Jobs: BullMQ 5.1
Real-time: Socket.IO
PDF Generation: PDFMake
Email: Nodemailer + MailHog (dev)
Storage: AWS S3 SDK (LocalStack per dev - disabilitato)
Logging: Winston + Pino
Monitoring: Prometheus + prom-client
Testing: Jest 29 + Supertest
Architecture: DDD + CQRS + Event Sourcing
```

### Frontend

```yaml
Framework: Angular 17 (standalone components)
UI Library: PrimeNG 17 + PrimeFlex 4
State Management: NgRx 17 (Store, Effects, Signals)
Charts: Chart.js 4.4
PDF Export: jsPDF + jsPDF-autotable
Excel Export: xlsx
Real-time: Socket.IO Client
HTTP: Angular HttpClient + @nestjs/axios
Date Utils: date-fns
Testing: Karma + Jasmine
```

### Infrastruttura

```yaml
Containerization: Docker + Docker Compose
Database UI: PgAdmin 4
Email Testing: MailHog
Identity Provider: Keycloak 23 (dev mode)
RENTRI Integration: Mock API (custom)
Network: Bridge network (wasteflow-network)
```

---

## 📝 Note di Sessione

### Sessione: 2025-11-02 - Chiusura Servizi

**Operazioni eseguite:**
- ✅ Identificati processi Node.js attivi su porte 3000, 3001, 4200
- ✅ Terminati 4 processi:
  - PID 43956 (Backend su porta 3000)
  - PID 13324 (Servizio su porta 3001)
  - PID 19672 (Servizio su porta 3001)
  - PID 23520 (Frontend Angular su porta 4200)
- ✅ Verificata liberazione delle porte
- ✅ Creato file di contesto DEV_CONTEXT.md

**Stato corrente:**
- Servizi Node.js: **FERMI**
- Porte 3000, 3001, 4200: **LIBERE**
- Docker: pgadmin in restarting (noto), altri servizi probabilmente fermi

**Prossimi passi consigliati:**
1. Verificare stato Docker: `docker-compose ps`
2. Se necessario, riavviare servizi Docker: `docker-compose up -d`
3. Avviare backend e frontend come da [Comandi Essenziali](#comandi-essenziali)

---

## 🔧 Configurazione Ambiente

### Variabili d'Ambiente Backend (apps/backend/.env)

```env
# Database
DATABASE_URL=postgresql://wasteflow:wasteflow123@localhost:5433/wasteflow_dev?schema=public

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Keycloak
KEYCLOAK_URL=http://localhost:8080
KEYCLOAK_REALM=wasteflow
KEYCLOAK_CLIENT_ID=wasteflow-backend

# RENTRI (Mock)
RENTRI_API_URL=http://localhost:3001
RENTRI_API_KEY=demo-key
RENTRI_ENABLE_MOCK=true

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=8h

# Email (MailHog)
SMTP_HOST=localhost
SMTP_PORT=1025
EMAIL_FROM=noreply@wasteflow.it

# AWS S3 (LocalStack - DISABILITATO)
AWS_REGION=eu-south-1
AWS_ENDPOINT=http://localhost:4566

# Application
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
CORS_ORIGIN=http://localhost:4200
FRONTEND_URL=http://localhost:4200

# Monitoring
PROMETHEUS_ENABLED=true
PROMETHEUS_PATH=/metrics
```

### Credenziali di Accesso

| Servizio | URL | Username | Password |
|----------|-----|----------|----------|
| Keycloak Admin | http://localhost:8080 | admin | admin |
| PgAdmin | http://localhost:5050 | admin@wasteflow.local | admin |
| PostgreSQL | localhost:5433 | wasteflow | wasteflow123 |
| Database Principale | - | wasteflow_dev | - |
| Database Keycloak | - | keycloak | - |

---

## 📂 Struttura Progetto

```
C:/Progetti/rifiuti/
├── apps/
│   ├── backend/              # NestJS API
│   │   ├── src/
│   │   │   ├── domain/      # Entità DDD + logica business
│   │   │   ├── application/ # Use cases (CQRS commands/queries)
│   │   │   ├── infrastructure/ # Repositories, API esterni
│   │   │   ├── api/         # REST controllers
│   │   │   └── main.ts      # Entry point
│   │   ├── prisma/          # Schema + migrations
│   │   ├── test/            # E2E tests
│   │   └── package.json
│   └── frontend/            # Angular 17
│       ├── src/
│       │   └── app/
│       │       ├── core/    # Auth, tenant context, guards
│       │       ├── features/ # Dashboard, FIR, admin, notifications
│       │       ├── shared/  # Componenti riutilizzabili
│       │       └── app.component.ts
│       └── package.json
├── docker/
│   └── postgres/
│       └── init-databases.sql  # Setup database multi-db
├── tools/
│   └── rentri-mock/         # Mock API RENTRI
├── specs/                   # Specifiche features
├── docs/                    # Documentazione
├── docker-compose.yml       # Configurazione Docker
├── package.json             # Workspace root
├── CLAUDE.md                # Linee guida sviluppo
├── COME_AVVIARE.md          # Guida avvio rapido
└── DEV_CONTEXT.md          # Questo file
```

---

## 🐛 Problemi Noti e Soluzioni

### Problema: Porta già in uso

**Sintomo:**
```
Error: listen EADDRINUSE: address already in use :::3000
```

**Soluzione:**
```bash
# Windows
netstat -ano | findstr ":3000"
taskkill //F //PID [PID_NUMBER]

# Oppure usa lo script
QUICK_FIX.bat
```

### Problema: Keycloak non si avvia

**Sintomo:**
```
FATAL: database "keycloak" does not exist
```

**Soluzione:**
```bash
docker-compose down -v
docker-compose up -d
```

### Problema: Prisma Client non generato

**Sintomo:**
```
Error: @prisma/client did not initialize yet
```

**Soluzione:**
```bash
cd apps/backend
npx prisma generate
```

### Problema: PostgreSQL non raggiungibile

**Soluzione:**
```bash
# Verifica container attivo
docker-compose ps postgres

# Se non attivo
docker-compose up -d postgres

# Test connessione
docker-compose exec postgres psql -U wasteflow -d wasteflow_dev -c "\l"
```

---

## 📚 Documentazione di Riferimento

### File Importanti

- `README.md` - Overview generale progetto
- `CLAUDE.md` - Linee guida sviluppo (auto-generato)
- `COME_AVVIARE.md` - Guida avvio dettagliata
- `START_HERE.md` - Panoramica architettura
- `LOCAL_SETUP.md` - Setup locale dettagliato
- `IMPLEMENTATION_SUMMARY.md` - Architettura e decisioni tecniche

### API Documentation

- Swagger UI: http://localhost:3000/api (quando backend è attivo)
- Prometheus Metrics: http://localhost:3000/metrics

### Testing

- Backend test coverage: `npm run test:cov` in `apps/backend`
- Frontend test: `npm test` in `apps/frontend`
- E2E test: `npm run test:e2e` in `apps/backend`

---

## 💡 Best Practices

### Prima di Iniziare a Sviluppare

1. ✅ Verifica Docker attivo: `docker-compose ps`
2. ✅ Verifica servizi healthy (postgres, redis, keycloak)
3. ✅ Genera Prisma Client: `npx prisma generate`
4. ✅ Esegui migrations: `npx prisma migrate dev`
5. ✅ Avvia backend in modalità watch
6. ✅ Avvia frontend in dev mode

### Durante lo Sviluppo

- 🧪 Usa TDD: scrivi test prima del codice
- 📝 Segui pattern DDD per logica business
- 🔄 Usa CQRS per separare commands/queries
- 🎯 Standalone components per Angular (no modules)
- 📊 Controlla coverage: target 100% per domain logic

### Fine Giornata

- 💾 Commit codice: segui conventional commits
- 🧹 Pulisci branch feature
- 📄 Aggiorna DEV_CONTEXT.md se necessario
- 🐳 (Opzionale) Ferma Docker per liberare risorse

---

## 🔄 Changelog Sessioni

### 2025-11-02

**Azioni:**
- Chiusura di tutti i processi Node.js attivi (backend NestJS + frontend Angular)
- Creazione file DEV_CONTEXT.md per conservare contesto sviluppo
- Documentazione completa configurazione, porte e comandi

**Stato finale:**
- Tutti i servizi Node.js fermati
- Porte 3000, 3001, 4200 libere
- Docker parzialmente attivo (solo Portainer e PgAdmin)

---

## 📞 Quick Reference

### Verificare Cosa Sta Girando

```bash
# Processi Node.js e porte
netstat -ano | findstr ":3000 :4200 :3001"

# Container Docker
docker-compose ps

# Salute servizi
docker-compose ps --format "table {{.Name}}\t{{.Status}}"
```

### Kill All Dev Processes

```bash
# Trova PIDs
netstat -ano | findstr ":3000 :4200 :3001"

# Kill (sostituisci [PID] con numero effettivo)
taskkill //F //PID [PID]

# Oppure
QUICK_FIX.bat
```

### One-Liner Restart Completo

```bash
docker-compose down -v && docker-compose up -d && cd apps/backend && npx prisma migrate dev && npm run start:dev
```

---

**File mantenuto manualmente. Aggiornare dopo operazioni significative!**

---

Ultima revisione: 2025-11-02 | Prossima revisione suggerita: quando si riprende lo sviluppo
