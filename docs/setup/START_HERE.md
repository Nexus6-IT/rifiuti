# 🚀 WasteFlow - Start Here!

Benvenuto in **WasteFlow**, la piattaforma SaaS per la gestione digitale dei rifiuti conforme alla normativa italiana.

---

## ⚡ Quick Start (2 minuti)

### Windows
```cmd
scripts\dev-start.bat
```

### Linux/Mac
```bash
chmod +x scripts/dev-start.sh
./scripts/dev-start.sh
```

Poi apri:
- **Frontend:** http://localhost:4200
- **Backend API:** http://localhost:3000/api

---

## 📚 Documentazione

| Documento | Descrizione |
|-----------|-------------|
| **[LOCAL_SETUP.md](LOCAL_SETUP.md)** | 📖 Guida completa setup locale |
| **[IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)** | 🏗️ Architettura e design |
| **[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)** | 🚀 Deploy in produzione |
| **[COMPLETAMENTO_IMPLEMENTAZIONE.md](COMPLETAMENTO_IMPLEMENTAZIONE.md)** | ✅ Task completati (13/13) |

---

## 🛠️ Prerequisiti

- Node.js 20+ ([Download](https://nodejs.org/))
- Docker Desktop ([Download](https://www.docker.com/products/docker-desktop))

---

## 🌐 Servizi Locali

Una volta avviato, avrai accesso a:

| Servizio | URL | Credenziali |
|----------|-----|-------------|
| Frontend | http://localhost:4200 | - |
| Backend API | http://localhost:3000 | - |
| Swagger Docs | http://localhost:3000/api | - |
| Keycloak | http://localhost:8080 | admin / admin |
| MailHog (Email) | http://localhost:8025 | - |
| pgAdmin | http://localhost:5050 | admin@wasteflow.local / admin |
| RENTRI Mock | http://localhost:3001 | - |

---

## 📦 Cosa Include

### Backend (NestJS + Prisma)
- ✅ API REST con Swagger documentation
- ✅ Autenticazione SPID/CIE (via Keycloak)
- ✅ Firma digitale FIR (ECDSA-SHA256)
- ✅ Sincronizzazione RENTRI (mock in dev)
- ✅ Notifiche email (MailHog in dev)
- ✅ PDF export (FIR, MUD)
- ✅ Dashboard analytics
- ✅ Backup automatici
- ✅ Health monitoring

### Frontend (Angular 17)
- ✅ UI moderna con PrimeNG
- ✅ Dashboard analytics con Chart.js
- ✅ Gestione FIR completa
- ✅ Sistema notifiche real-time
- ✅ Multi-tenant support
- ✅ Responsive design

### Infrastructure
- ✅ Docker Compose per sviluppo
- ✅ PostgreSQL 16 + Prisma ORM
- ✅ Redis per caching
- ✅ Keycloak per autenticazione
- ✅ MailHog per test email
- ✅ LocalStack per S3 mock
- ✅ RENTRI API mock

---

## 🎯 Funzionalità Principali

### 1. Gestione FIR (Formulario Identificazione Rifiuti)
- Creazione guidata FIR
- Workflow firma digitale a 3 step
- Tracciamento stato in tempo reale
- Export PDF con QR code

### 2. Firma Digitale
- Autenticazione SPID Level 2+
- Algoritmo ECDSA-SHA256
- Timestamp RFC 3161
- Immutabilità documenti

### 3. RENTRI Sync
- Sincronizzazione automatica
- Retry logic con exponential backoff
- Validazione pre-invio
- Dashboard stato sync

### 4. Analytics
- Metriche produzione rifiuti
- Compliance score
- Trends e predizioni
- Export CSV/PDF

### 5. MUD (Modello Unico Dichiarazione)
- Generazione report annuali
- Aggregazione per codice CER
- Calcolo tasso riciclaggio
- Export PDF conforme

---

## 🔐 Conformità Normativa

WasteFlow è conforme a:
- **D.M. 59/2023** - Registro elettronico nazionale (RENTRI)
- **D.Lgs. 152/2006** - Codice dell'ambiente
- **SPID Level 2+** - Autenticazione forte
- **eIDAS** - Firma digitale europea
- **GDPR** - Privacy e protezione dati

---

## 📖 Tutorial Primo Utilizzo

### 1. Avvia l'ambiente
```bash
scripts\dev-start.bat  # Windows
./scripts/dev-start.sh # Linux/Mac
```

### 2. Accedi all'applicazione
- Apri http://localhost:4200
- Login con utente di test

### 3. Crea il tuo primo FIR
1. Dashboard → **Nuovo FIR**
2. Compila dati produttore, rifiuto, trasportatore
3. Firma come produttore (SPID mock)
4. Traccia il workflow di firma completo

### 4. Visualizza Analytics
- Dashboard → Visualizza metriche
- Export CSV/PDF reports

### 5. Testa le notifiche
- MailHog UI: http://localhost:8025
- Vedi email di firma richiesta

---

## 🐛 Problemi Comuni

### Port già in uso
```bash
# Cambia porta in docker-compose.yml o termina processo esistente
netstat -ano | findstr :5432  # Windows
lsof -i :5432                  # Linux/Mac
```

### Database non raggiungibile
```bash
# Verifica che PostgreSQL sia running
docker-compose ps postgres

# Restart se necessario
docker-compose restart postgres
```

### Prisma Client non generato
```bash
cd apps/backend
npx prisma generate
```

---

## 🚀 Deployment Produzione

Quando sei pronto per il deploy:

1. Leggi **[PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md)**
2. Configura certificati SSL (Let's Encrypt)
3. Configura provider SPID reali (Aruba, InfoCert, etc.)
4. Setup server SMTP (SendGrid/AWS SES)
5. Configura storage S3/Azure Blob
6. Deploy con `docker-compose.prod.yml`

---

## 📊 Status Implementazione

**Completato al 100%!** ✅

- ✅ **261/261 tasks** completati
- ✅ **13/13 fasi** implementate
- ✅ **Backend completo** (NestJS + Prisma)
- ✅ **Frontend completo** (Angular 17)
- ✅ **Infrastructure ready** (Docker + Nginx)
- ✅ **Production-ready** (SSL, monitoring, backups)

Vedi dettagli in [COMPLETAMENTO_IMPLEMENTAZIONE.md](COMPLETAMENTO_IMPLEMENTAZIONE.md)

---

## 🤝 Contribuire

1. Fork il repository
2. Crea feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Apri Pull Request

---

## 📞 Supporto

- **Issues:** [GitHub Issues](https://github.com/yourusername/wasteflow/issues)
- **Discussions:** [GitHub Discussions](https://github.com/yourusername/wasteflow/discussions)
- **Email:** support@wasteflow.it

---

## 📄 Licenza

Questo progetto è rilasciato sotto licenza MIT. Vedi [LICENSE](LICENSE) per dettagli.

---

## 🙏 Ringraziamenti

Costruito con:
- [NestJS](https://nestjs.com/) - Framework backend
- [Prisma](https://www.prisma.io/) - ORM
- [Angular](https://angular.io/) - Framework frontend
- [PrimeNG](https://primeng.org/) - UI Components
- [Keycloak](https://www.keycloak.org/) - Authentication
- [Docker](https://www.docker.com/) - Containerization

---

**Made with ❤️ for Italian Waste Management Compliance**

🚀 **Ready to start? Run `scripts/dev-start.bat` now!**
