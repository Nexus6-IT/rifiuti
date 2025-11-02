# Session Notes - WasteFlow Development

> Log operativo delle sessioni di sviluppo
> Per modifiche di prodotto vedere [CHANGELOG.md](./CHANGELOG.md)

---

## Come Usare Questo File

Questo file traccia le **sessioni operative** di sviluppo quotidiane:
- Setup e configurazione ambiente
- Debugging e risoluzione problemi
- Operazioni di manutenzione
- Note rapide e promemoria

Per un registro dettagliato delle **feature e release**, consulta [CHANGELOG.md](./CHANGELOG.md).

---

## 📅 Sessione 2025-11-02

### Tipo: Manutenzione / Setup

**Operazioni Eseguite:**

1. **Chiusura Servizi Attivi**
   - Identificati e terminati processi Node.js attivi su porte di sviluppo
   - PID 43956: Backend NestJS (porta 3000)
   - PID 13324, 19672: Servizi su porta 3001
   - PID 23520: Frontend Angular (porta 4200)
   - Metodo: `netstat` + `taskkill` su Windows

2. **Documentazione Contesto**
   - Creato `DEV_CONTEXT.md` - file di riferimento completo per sviluppo
   - Documentate tutte le porte in uso (3000, 3001, 4200, 5433, 6379, 8080, ecc.)
   - Mappati tutti i servizi Docker (PostgreSQL, Redis, Keycloak, MailHog, RENTRI Mock, PgAdmin)
   - Catalogati comandi essenziali per avvio/stop/debug
   - Documentato stack tecnologico completo

3. **Creato Sistema di Note**
   - Creato `SESSION_NOTES.md` (questo file) per tracciamento sessioni operative

**Stato Finale:**
- ✅ Tutti i processi Node.js fermati
- ✅ Porte 3000, 3001, 4200 libere
- ✅ Documentazione completa creata
- ⚠️ Docker parzialmente attivo (solo Portainer e PgAdmin in restarting)

**Prossime Azioni Consigliate:**
1. Verificare stato servizi Docker: `docker-compose ps`
2. Se necessario riavviare stack completo: `docker-compose up -d`
3. Seguire procedura avvio in [DEV_CONTEXT.md](./DEV_CONTEXT.md#-avvio-completo-primo-setup)

**File Modificati/Creati:**
- ➕ `DEV_CONTEXT.md` - Nuovo file di contesto sviluppo
- ➕ `SESSION_NOTES.md` - Questo file

**Note Tecniche:**
- Windows richiede doppio slash per taskkill: `taskkill //F //PID [num]`
- RENTRI Mock usa porta 3001 (mappato da porta interna 3000)
- LocalStack (S3 mock) attualmente disabilitato in docker-compose.yml

**Problemi Riscontrati:**
- Nessun problema critico
- PgAdmin in stato restarting (comportamento noto)

---

## Template Sessione

```markdown
## 📅 Sessione YYYY-MM-DD

### Tipo: [Feature / Bugfix / Refactor / Setup / Manutenzione]

**Obiettivo:**
[Breve descrizione obiettivo sessione]

**Operazioni Eseguite:**
1. [Prima operazione]
2. [Seconda operazione]
...

**Stato Finale:**
- ✅ [Cosa completato]
- ⚠️ [Cosa in pending]
- ❌ [Cosa fallito/bloccato]

**Prossime Azioni:**
1. [Prima azione]
2. [Seconda azione]

**File Modificati/Creati:**
- ➕ `path/to/new/file.ts`
- ✏️ `path/to/modified/file.ts`
- ❌ `path/to/deleted/file.ts`

**Note Tecniche:**
[Annotazioni tecniche utili, workaround, scoperte]

**Problemi Riscontrati:**
[Problemi incontrati e relative soluzioni]

**Test Eseguiti:**
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] Manual testing

**Metriche:**
- Tempo: XX ore
- Commit: X
- Test coverage: XX%
- Performance: [se applicabile]
```

---

## Quick Reference

### Comandi Frequenti

```bash
# Stato servizi
docker-compose ps
netstat -ano | findstr ":3000 :4200"

# Avvio rapido
docker-compose up -d
cd apps/backend && npm run start:dev
cd apps/frontend && npm start

# Stop servizi
taskkill //F //PID [PID]
docker-compose down

# Logs
docker-compose logs -f [service_name]

# Database
npx prisma studio
npx prisma migrate dev

# Test
npm run test
npm run test:watch
npm run test:cov
```

### Riferimenti Rapidi

- [DEV_CONTEXT.md](./DEV_CONTEXT.md) - Contesto completo sviluppo
- [COME_AVVIARE.md](./COME_AVVIARE.md) - Guida avvio
- [CLAUDE.md](./CLAUDE.md) - Linee guida sviluppo
- [CHANGELOG.md](./CHANGELOG.md) - Changelog prodotto

---

**Ultimo aggiornamento:** 2025-11-02
