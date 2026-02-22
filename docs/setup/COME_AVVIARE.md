# 🚀 Come Avviare WasteFlow - Guida Rapida

## ✅ Fix Applicato: Script SQL per Database

Il problema del database Keycloak è stato risolto. Ora usa uno **script SQL puro** compatibile con Windows/Linux.

---

## 🎯 Avvio Rapido (3 Passi)

### 1️⃣ Riavvia Servizi Docker

**Esegui questo script:**

```cmd
RESTART_SERVICES.bat
```

**Oppure manualmente:**

```cmd
cd C:\Progetti\rifiuti

docker-compose down -v
docker-compose up -d
```

⏳ **Attendi 30-60 secondi** che tutti i servizi siano pronti.

---

### 2️⃣ Verifica Database Creati

```cmd
docker-compose exec postgres psql -U wasteflow -d wasteflow_dev -c "\l"
```

**Dovresti vedere:**
- ✅ `wasteflow_dev` (database principale)
- ✅ `keycloak` (database autenticazione)

---

### 3️⃣ Verifica Keycloak Funzionante

**Opzione A: Logs**
```cmd
docker-compose logs keycloak | findstr "started"
```

Dovresti vedere: `"Started server in (development) mode"`

**Opzione B: Browser**

Apri: **http://localhost:8080**

Dovresti vedere la pagina di login Keycloak.
- Username: `admin`
- Password: `admin`

---

## ✅ Tutto Funziona? Continua qui!

### 4️⃣ Setup Backend

```cmd
cd apps\backend

npm install
npx prisma generate
npx prisma migrate dev --name init
npx prisma db seed
```

### 5️⃣ Setup Frontend

```cmd
cd apps\frontend

npm install
```

### 6️⃣ Avvia Applicazione

**Terminal 1 (Backend):**
```cmd
cd apps\backend
npm run start:dev
```

**Terminal 2 (Frontend):**
```cmd
cd apps\frontend
npm start
```

---

## 🌐 Servizi Disponibili

| Servizio | URL | Credenziali |
|----------|-----|-------------|
| **Frontend** | http://localhost:4200 | - |
| **Backend API** | http://localhost:3000 | - |
| **Swagger** | http://localhost:3000/api | - |
| **Keycloak** | http://localhost:8080 | admin/admin |
| **MailHog** | http://localhost:8025 | - |
| **pgAdmin** | http://localhost:5050 | admin@wasteflow.local/admin |

---

## 🐛 Problemi?

### Keycloak non si avvia

**Sintomo:**
```
ERROR: FATAL: database "keycloak" does not exist
```

**Soluzione:**
```cmd
RESTART_SERVICES.bat
```

### Container non si fermano

```cmd
docker-compose down --remove-orphans
docker-compose down -v
docker-compose up -d
```

### Vedere tutti i logs

```cmd
docker-compose logs -f
```

Solo Keycloak:
```cmd
docker-compose logs -f keycloak
```

Solo PostgreSQL:
```cmd
docker-compose logs -f postgres
```

---

## 📋 Checklist Completa

- [ ] Docker Desktop avviato e verde
- [ ] Eseguito `RESTART_SERVICES.bat`
- [ ] Database `wasteflow_dev` creato
- [ ] Database `keycloak` creato
- [ ] Keycloak risponde su :8080
- [ ] PostgreSQL risponde su :5432
- [ ] Redis risponde su :6379
- [ ] MailHog accessibile su :8025
- [ ] Backend: `npm install` completato
- [ ] Backend: Prisma Client generato
- [ ] Backend: Migrations eseguite
- [ ] Frontend: `npm install` completato
- [ ] Backend API risponde su :3000/health
- [ ] Frontend visibile su :4200

---

## 🔍 Verifica Status Completo

```cmd
REM Check tutti i container
docker-compose ps

REM Dovresti vedere tutti UP (healthy):
REM - wasteflow-postgres
REM - wasteflow-redis
REM - wasteflow-keycloak
REM - wasteflow-mailhog
REM - wasteflow-pgadmin
```

---

## 📚 Documentazione Completa

- **[START_HERE.md](START_HERE.md)** - Panoramica progetto
- **[LOCAL_SETUP.md](LOCAL_SETUP.md)** - Setup dettagliato
- **[FIX_KEYCLOAK.md](FIX_KEYCLOAK.md)** - Fix database Keycloak
- **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** - Architettura

---

## 💡 Suggerimenti

### Prima volta?

Usa lo script automatico completo:
```cmd
scripts\dev-start.bat
```

Fa tutto automaticamente:
- ✅ Crea `.env`
- ✅ Avvia Docker services
- ✅ Installa dipendenze
- ✅ Genera Prisma Client
- ✅ Esegue migrations
- ✅ Seed database

### Sviluppo quotidiano

**Mattina:**
```cmd
docker-compose up -d
cd apps\backend && npm run start:dev
cd apps\frontend && npm start
```

**Sera:**
```cmd
Ctrl+C nei terminali
docker-compose down  # opzionale
```

### Reset completo

Se qualcosa va storto:
```cmd
QUICK_FIX.bat
```

O manualmente:
```cmd
docker-compose down -v
docker-compose up -d
cd apps\backend && npx prisma migrate dev
```

---

## 🎉 Pronto!

Una volta completati tutti i passi:

1. **Apri browser:** http://localhost:4200
2. **Login** con utente di test (se configurato)
3. **Esplora** dashboard, FIR, analytics
4. **Sviluppa** nuove features!

---

**Problemi? Controlla i logs:**
```cmd
docker-compose logs -f
```

**Happy Coding! 🚀**
