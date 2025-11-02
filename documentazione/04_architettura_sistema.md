# ARCHITETTURA SISTEMA GESTIONE RIFIUTI DIGITALE

**Versione:** 1.0
**Data:** 13 Ottobre 2025
**Approccio:** Pragmatic Architecture - MVP-first, Scale-ready
**Contesto:** Startup, team 5-7 dev, budget limitato, time-to-market 3.5 mesi

---

## EXECUTIVE SUMMARY

**Decisione Architetturale Principale:** Monolite Modulare con preparazione a Microservizi

**Motivazione:** Bilanciamento tra velocity di sviluppo (MVP 3.5 mesi) e preparazione a scala (10x crescita). Evita over-engineering prematuro mantenendo opzionalità future.

**Stack Core:**
- Backend: Node.js + NestJS (TypeScript)
- Frontend Web: React + Next.js 14 (App Router)
- Mobile: React Native (iOS/Android da singola codebase)
- Database: PostgreSQL (primario) + Redis (cache)
- Cloud: AWS (consigliato per maturità servizi)

**Trade-off Chiave Accettati:**
- Monolite modulare vs Microservizi: Velocity ora, migrazione graduale poi
- PostgreSQL vs NoSQL ibrido: Consistency > Performance estrema (ACID critico per compliance)
- React Native vs Native: Time-to-market > Performance nativa
- AWS vs Multi-cloud: Lock-in accettabile per servizi gestiti premium

---

## 1. ARCHITETTURA AD ALTO LIVELLO

### 1.1 Pattern Architetturale: Monolite Modulare

**SCELTA: Monolite Modulare (Modular Monolith) con Domain-Driven Design**

#### Motivazione della Scelta

**PRO:**
- Time-to-market velocissimo: singolo deployment, no overhead orchestrazione
- Team piccolo (5-7 dev): complessità gestibile, no microservizi coordinator
- Transazioni ACID native: FIR + Registro + RENTRI sync in singola transazione
- Debugging semplificato: stack trace completo, no distributed tracing inizialmente
- Costi infrastruttura bassi: singola istanza applicativa + DB vs cluster K8s
- Refactoring sicuro: IDE supporta rename/move cross-module

**CONTRO:**
- Scaling granulare limitato: se modulo Analytics heavy, scala tutto il monolite
- Deploy monolitico: rollback coinvolge tutta l'app (mitigato con feature flags)
- Rischio accoppiamento: richiede disciplina boundaries tra moduli

**ALTERNATIVA CONSIDERATA: Microservizi**
- Rigettata per MVP: overhead operativo (service mesh, API gateway, monitoring distribuito) sproporzionato
- Costi team: +2 dev per gestione infrastruttura K8s
- Time-to-market: +40% per setup iniziale e coordinamento
- Quando riconsiderare: >10.000 utenti attivi, team >15 dev, esigenze scaling eterogenee

#### Strategia di Migrazione Futura

Moduli progettati come **Bounded Contexts autonomi**:
- Comunicazione via interfacce (no dipendenze dirette implementazioni)
- Event bus interno (in-memory per MVP, RabbitMQ poi)
- Ogni modulo ha proprio schema DB (logical separation, stesso PostgreSQL)

**Exit strategy a Microservizi:**
1. Estrarre moduli ad alto carico (es. Analytics, RENTRI Sync) quando necessario
2. Event bus in-memory → Message broker esterno (già preparato)
3. Shared DB → Database per servizio (già schema separati)

---

### 1.2 Diagramma C4 Level 1 - System Context

```mermaid
C4Context
    title System Context - Piattaforma Gestione Rifiuti

    Person(user_produttore, "Produttore Rifiuti", "PMI, artigiani")
    Person(user_consulente, "Consulente Ambientale", "Gestisce 20-50 clienti")
    Person(user_trasportatore, "Trasportatore", "Autisti con smartphone")
    Person(user_impianto, "Gestore Impianto", "Recupero/Smaltimento")

    System(waste_system, "WasteFlow", "Piattaforma SaaS gestione rifiuti digitale: FIR, Registri, Compliance")

    System_Ext(rentri, "RENTRI", "Registro Nazionale Tracciabilità Rifiuti (MASE)")
    System_Ext(spid, "SPID/CIE", "Identità Digitale")
    System_Ext(firma_digitale, "InfoCert/Aruba", "Servizi Firma Digitale Remota")
    System_Ext(pec, "PEC Provider", "Posta Elettronica Certificata")
    System_Ext(erp, "ERP Aziendali", "Zucchetti, TeamSystem, SAP")
    System_Ext(payment, "Stripe", "Pagamenti e Billing")
    System_Ext(analytics, "Mixpanel", "Product Analytics")

    Rel(user_produttore, waste_system, "Emette FIR, registra rifiuti", "HTTPS")
    Rel(user_consulente, waste_system, "Gestisce multi-cliente", "HTTPS")
    Rel(user_trasportatore, waste_system, "App mobile, firma FIR campo", "HTTPS/REST")
    Rel(user_impianto, waste_system, "Registra carichi, integra bilance", "HTTPS/API")

    Rel(waste_system, rentri, "Sincronizza registri, FIR", "REST API + OAuth2")
    Rel(waste_system, spid, "Autentica utenti", "SAML 2.0")
    Rel(waste_system, firma_digitale, "Firma remota FIR", "REST API")
    Rel(waste_system, pec, "Invio notifiche certificate", "SMTP/REST")
    Rel(waste_system, erp, "Import/Export dati", "REST API/CSV")
    Rel(waste_system, payment, "Gestione abbonamenti", "Webhook")
    Rel(waste_system, analytics, "Eventi utente", "SDK")

    UpdateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="2")
```

---

### 1.3 Diagramma C4 Level 2 - Container Diagram

```mermaid
C4Container
    title Container Diagram - WasteFlow Architecture

    Person(user, "Utenti", "Produttori, Consulenti, Trasportatori")

    Container_Boundary(frontend, "Frontend Layer") {
        Container(web_app, "Web Application", "Next.js 14, React", "SPA responsive per desktop/tablet")
        Container(mobile_app, "Mobile App", "React Native", "iOS/Android nativa per operatori campo")
        Container(landing, "Landing/Marketing", "Next.js Static", "SEO-optimized")
    }

    Container_Boundary(backend, "Backend Layer") {
        Container(api_gateway, "API Gateway", "Kong/AWS API Gateway", "Rate limiting, auth, routing")
        Container(app_server, "Application Server", "NestJS (Node.js)", "Business logic, moduli DDD")
        Container(worker, "Background Workers", "BullMQ", "Jobs asincroni: RENTRI sync, email, PDF")
    }

    Container_Boundary(data, "Data Layer") {
        ContainerDb(postgres, "PostgreSQL", "Database relazionale", "Dati transazionali, audit log")
        ContainerDb(redis, "Redis", "Cache + Queue", "Session, cache query, job queue")
        ContainerDb(s3, "S3 Storage", "Object Storage", "PDF, allegati, backup")
    }

    Container_Boundary(external, "External Services") {
        System_Ext(rentri_api, "RENTRI API")
        System_Ext(auth_provider, "SPID/CIE")
        System_Ext(sign_service, "Firma Digitale")
    }

    Rel(user, web_app, "HTTPS")
    Rel(user, mobile_app, "REST API")
    Rel(web_app, api_gateway, "JSON/REST")
    Rel(mobile_app, api_gateway, "JSON/REST")
    Rel(api_gateway, app_server, "Internal")
    Rel(app_server, postgres, "SQL", "Prisma ORM")
    Rel(app_server, redis, "Commands")
    Rel(app_server, s3, "SDK")
    Rel(app_server, worker, "Enqueue jobs")
    Rel(worker, postgres, "Read/Write")
    Rel(worker, rentri_api, "HTTPS")
    Rel(app_server, auth_provider, "SAML/OAuth")
    Rel(app_server, sign_service, "REST API")

    UpdateLayoutConfig($c4ShapeInRow="2")
```

---

## 2. DECOMPOSIZIONE DOMINI (Domain-Driven Design)

### 2.1 Bounded Contexts Principali

```mermaid
graph TB
    subgraph Core Domain
        FIR[FIR Management]
        REG[Registry Management]
        CER[Waste Catalog CER]
    end

    subgraph Supporting Domain
        COMP[Compliance & Reporting]
        ANA[Anagraphics]
        RENTRI[RENTRI Integration]
    end

    subgraph Generic Domain
        AUTH[Authentication & IAM]
        NOTIF[Notifications]
        BILLING[Billing & Subscriptions]
    end

    FIR -->|usa| CER
    FIR -->|aggiorna| REG
    REG -->|sincronizza| RENTRI
    FIR -->|sincronizza| RENTRI
    COMP -->|legge| REG
    COMP -->|legge| FIR
    FIR -->|valida con| ANA
    REG -->|valida con| ANA

    AUTH -->|protegge| FIR
    AUTH -->|protegge| REG
    NOTIF -->|notifica| FIR
    NOTIF -->|notifica| COMP

    style FIR fill:#ff6b6b
    style REG fill:#ff6b6b
    style CER fill:#ff6b6b
```

### 2.2 Core Domain: FIR Management

**Responsabilità:** Gestione completa ciclo di vita Formulario Identificazione Rifiuti

**Aggregates:**

**1. FIR (Aggregate Root)**
```typescript
class FIR {
  id: UUID
  numeroProgressivo: string
  anno: number
  stato: FIRStato // BOZZA | IN_TRANSITO | CONSEGNATO | ANNULLATO

  // Entities
  produttore: FIRProduttore
  rifiuto: FIRRifiuto
  trasporto: FIRTrasporto
  destinatario: FIRDestinazione

  // Value Objects
  firme: FirmeDigitali
  allegati: Allegato[]

  // Domain Events
  events: DomainEvent[]

  // Business Methods
  emetti(): void
  presaInCarico(data: Date, firma: FirmaDigitale): void
  confermaConsegna(peso: number, firma: FirmaDigitale): void
  annulla(motivo: string): void
  validaCompletezza(): ValidationResult
}
```

**Value Objects:**
- `FIRRifiuto`: { cer: CER, quantita: Quantita, statoFisico, caratteristichePericolo }
- `FirmeDigitali`: { produttore, trasportatore, destinatario } (immutabile)
- `Quantita`: { valore: number, unitaMisura: 'kg' | 'litri' }

**Domain Events:**
- `FIREmessoEvent`: Notifica RENTRI, invia email trasportatore
- `FIRPresaInCaricoEvent`: Aggiorna registro produttore (scarico)
- `FIRConsegnatoEvent`: Aggiorna registro destinatario (carico), chiude ciclo

**Invarianti:**
- Un FIR in stato CONSEGNATO non può essere modificato
- Firma produttore deve precedere presa in carico
- Peso consegnato deve essere entro ±10% peso dichiarato (warning se fuori)
- CER deve essere autorizzato per destinatario

---

### 2.3 Core Domain: Registry Management

**Responsabilità:** Registri Carico/Scarico cronologici conformi normativa

**Aggregates:**

**1. RegistroCarico (Aggregate Root)**
```typescript
class RegistroCarico {
  id: UUID
  aziendaId: UUID
  anno: number
  movimenti: MovimentoCarico[]

  registraCarico(movimento: MovimentoCarico): void {
    // Validazione tempistiche (2gg impianti, 10gg produttori)
    // Aggiornamento giacenze per CER
    // Event: MovimentoCaricoRegistratoEvent
  }

  calcolaGiacenza(cer: CER, dataAlleData: Date): number
  verificaCoerenzaConFIR(fir: FIR): ValidationResult
  esportaPerPeriodo(start: Date, end: Date): RegistroExport
}
```

**Entities:**
- `MovimentoCarico`: data, ora, firRiferimento, cer, quantita, provenienza, note
- `MovimentoScarico`: data, ora, firRiferimento, cer, quantita, destinazione, note

**Business Rules:**
- Giacenza CER non può mai essere negativa (hard constraint)
- Registrazione carico impianto max 2 giorni lavorativi da ricezione
- Registrazione scarico produttore max 10 giorni lavorativi da conferimento
- Ogni movimento deve avere FIR di riferimento (traceability)

---

### 2.4 Supporting Domain: RENTRI Integration

**Responsabilità:** Sincronizzazione bidirezionale con RENTRI, gestione errori, retry

**Aggregates:**

**1. RENTRISyncJob (Aggregate Root)**
```typescript
class RENTRISyncJob {
  id: UUID
  tipo: 'FIR' | 'REGISTRO_CARICO' | 'REGISTRO_SCARICO'
  entitaId: UUID
  stato: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED' | 'RETRY'
  tentativiRimasti: number
  errore?: RENTRIError

  esegui(): Promise<void>
  retry(): void
  segnaFallito(errore: RENTRIError): void
}
```

**Services:**
- `RENTRIApiClient`: wrapper API RENTRI con autenticazione OAuth2, rate limiting
- `RENTRISyncOrchestrator`: coordina invii batch, gestisce backoff esponenziale
- `RENTRIWebhookHandler`: riceve notifiche RENTRI (se disponibile)

**Integration Pattern:** Event-Driven Asynchronous
- Domain event (es. `FIREmessoEvent`) → Enqueue `RENTRISyncJob`
- Background worker processa job con retry policy (3 tentativi, backoff 1min/5min/30min)
- Fallimento permanente → Alert admin + notifica utente

---

### 2.5 Context Map - Relazioni tra Domini

```mermaid
graph LR
    FIR[FIR Management<br/>CORE]
    REG[Registry<br/>CORE]
    CER[Waste Catalog<br/>CORE]
    RENTRI[RENTRI Integration<br/>SUPPORT]
    ANA[Anagraphics<br/>SUPPORT]
    COMP[Compliance<br/>SUPPORT]
    AUTH[Auth/IAM<br/>GENERIC]

    FIR -->|Conformist| CER
    FIR -->|Partnership| REG
    REG -->|Customer-Supplier| RENTRI
    FIR -->|Customer-Supplier| RENTRI
    FIR -->|ACL| ANA
    REG -->|ACL| ANA
    COMP -->|Open Host Service| FIR
    COMP -->|Open Host Service| REG
    AUTH -->|Shared Kernel| FIR
    AUTH -->|Shared Kernel| REG

    style FIR fill:#ff6b6b,stroke:#c92a2a
    style REG fill:#ff6b6b,stroke:#c92a2a
    style CER fill:#ff6b6b,stroke:#c92a2a
```

**Legenda Relazioni:**
- **Partnership**: FIR ↔ Registry collaborano strettamente, condividono eventi
- **Customer-Supplier**: Registry/FIR forniscono dati a RENTRI (downstream)
- **Conformist**: FIR consuma CER catalog senza influenzarne il modello
- **ACL (Anti-Corruption Layer)**: FIR/Registry traducono modello Anagrafiche
- **Open Host Service**: Compliance espone API per interrogare FIR/Registry
- **Shared Kernel**: Auth condiviso (User, Tenant models)

---

## 3. STACK TECNOLOGICO DETTAGLIATO

### 3.1 Backend

**SCELTA: Node.js 20 LTS + NestJS (TypeScript)**

#### Motivazione

**PRO:**
- **Velocity**: TypeScript end-to-end (frontend/backend/mobile), unico linguaggio per team
- **Ecosistema maturo**: npm packages per qualsiasi esigenza (PDF, XML, crypto)
- **Performance adeguata**: Single-threaded event loop sufficiente per I/O-bound (DB, API)
- **Team availability**: Pool sviluppatori Node.js ampio e costi contenuti
- **NestJS specifico**: DDD-friendly (modules, dependency injection), scalabile, TypeScript-first

**CONTRO:**
- CPU-intensive tasks lenti: mitigato con worker threads o microservizio dedicato (es. generazione PDF pesanti)
- Memory leaks: mitigato con monitoring (Clinic.js) e buone pratiche
- TypeScript overhead: +10% tempo compilazione, accettabile per type-safety

**ALTERNATIVE CONSIDERATE:**

| Criterio | Node.js + NestJS | Python + FastAPI | Go + Gin | Java + Spring |
|----------|------------------|------------------|----------|---------------|
| Velocity MVP | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| Performance | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Ecosystem | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Type Safety | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Team Cost | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **TOTALE** | **22/25** | **18/25** | **18/25** | **17/25** |

**Decisione:** Node.js vince per velocity + ecosystem + team cost. Performance è sufficiente (non Netflix-scale MVP).

---

### 3.2 Frontend Web

**SCELTA: React 18 + Next.js 14 (App Router) + TypeScript + TailwindCSS**

#### Motivazione

**PRO:**
- **Next.js 14 App Router**: Server Components per performance, SEO ottimizzato (landing pages)
- **React dominance**: Largest ecosystem, facile assumere dev, learning curve bassa
- **TypeScript safety**: Shared types con backend (monorepo NX/Turborepo)
- **TailwindCSS**: Rapid UI development, design system consistente, bundle size ottimizzato
- **Vercel deploy**: Zero-config deploy, edge functions per geolocation

**CONTRO:**
- Next.js learning curve: App Router diverso da Pages Router (mitigato con training)
- React bundle size: ~40KB gzipped, accettabile con code splitting

**ALTERNATIVE CONSIDERATE:**

**Vue.js 3 + Nuxt 3**: Ottimo, ma pool dev più piccolo, meno librerie ecosistema
**Svelte + SvelteKit**: Bundle minimo, ma immaturità ecosistema, rischio skill shortage
**Angular**: Over-engineered per startup, vendor lock-in Google

**Decisione:** Next.js vince per bilanciamento velocity, performance, hiring.

---

### 3.3 Mobile

**SCELTA: React Native + Expo (Managed Workflow)**

#### Motivazione

**PRO:**
- **Code sharing**: 80% codice condiviso iOS/Android, 50% con web (logic layer)
- **Time-to-market**: Single codebase vs 2 team nativi
- **Expo ecosystem**: OTA updates, notifications, build service, dev experience eccellente
- **JavaScript Bridge**: Accesso API native (fotocamera, GPS, firma touch) via plugins
- **Cost**: 1 team React Native vs 2 team iOS+Android (~60% saving)

**CONTRO:**
- Performance non-nativa: ~10% slower, accettabile per app form-based (non gaming)
- Expo limitazioni: alcune funzionalità native richiedono eject (es. integrazione hardware custom)
- Bridge overhead: Animazioni complesse possono lag (mitigato con Reanimated)

**ALTERNATIVE CONSIDERATE:**

**Native iOS (Swift) + Android (Kotlin)**: Performance max, ma costo x2, time x2
**Flutter**: Ottima performance, ma Dart nuovo linguaggio per team, meno share con web
**Ionic/Capacitor**: WebView-based, UX non nativa percepibile

**Decisione:** React Native vince per time-to-market e cost. Performance sufficiente per use case form-based.

**Quando riconsiderare Native:** Se app diventa core business e performance critica (es. scanning real-time 60fps)

---

### 3.4 Database

**SCELTA: PostgreSQL 16 (Primary) + Redis 7 (Cache/Queue)**

#### Motivazione PostgreSQL

**PRO:**
- **ACID compliance**: Transazioni critiche per compliance (FIR + Registro update atomico)
- **JSON support**: Campi flessibili (es. caratteristiche rifiuto) senza schema rigido
- **Full-text search**: Ricerca CER descrizioni senza Elasticsearch inizialmente
- **Maturità**: 30+ anni, rock-solid, community enorme
- **Row-Level Security**: Multi-tenancy con isolamento DB-level (tenant_id filter automatico)
- **PostGIS**: Geolocation per matching trasportatori vicini (future feature)

**CONTRO:**
- Scaling write-heavy: Sharding manuale complesso (ma necessario solo >100K aziende)
- No schemaless: Migrazioni richieste per schema changes (mitigato con Prisma Migrate)

**ALTERNATIVE CONSIDERATE:**

| Criterio | PostgreSQL | MongoDB | MySQL | CockroachDB |
|----------|------------|---------|-------|-------------|
| ACID Compliance | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| JSON Support | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Full-Text Search | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Ecosystem | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Managed Service | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Cost | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **TOTALE** | **26/30** | **23/30** | **23/30** | **22/30** |

**Decisione:** PostgreSQL vince per ACID + JSON hybrid + maturità.

#### Redis - Cache & Queue

**Utilizzo:**
- **Session store**: JWT refresh tokens, user sessions
- **Cache layer**: Query frequenti (CER catalog, anagrafiche), TTL 5-60 min
- **Job queue**: BullMQ per background workers (RENTRI sync, email, PDF generation)
- **Rate limiting**: Sliding window per API pubbliche

---

### 3.5 Caching Strategy

**Livelli di Cache:**

```mermaid
graph TD
    CDN[CDN - CloudFlare<br/>Static Assets]
    APIG[API Gateway Cache<br/>Kong/AWS<br/>GET endpoints]
    REDIS[Redis Application Cache<br/>Query results]
    PGCACHE[PostgreSQL Query Cache<br/>Internal]

    CDN -->|Miss| APIG
    APIG -->|Miss| REDIS
    REDIS -->|Miss| PGCACHE
    PGCACHE -->|Miss| DB[Database]
```

**Politiche di Cache:**

| Dato | TTL | Invalidazione | Note |
|------|-----|---------------|------|
| CER Catalog | 7 giorni | Deploy update normativo | Raramente cambia |
| Anagrafiche azienda | 1 ora | Update manuale utente | Moderatamente stabile |
| Lista FIR utente | 5 min | Write-through su create/update | Frequente lettura |
| Dashboard KPI | 15 min | Background refresh job | Heavy query |
| User profile | 30 min | Logout/Update profilo | Read-heavy |

**Cache Warming:** Job notturno pre-carica CER catalog e anagrafiche top 1000 aziende attive.

---

### 3.6 Message Broker

**SCELTA MVP: BullMQ (Redis-based)**

**Motivazione:**
- Redis già presente, no infra aggiuntiva
- Sufficiente per <10K jobs/day
- UI monitoring inclusa (Bull Board)
- Retry policies built-in

**SCELTA SCALE: RabbitMQ o AWS SQS/SNS**

**Trigger migrazione:**
- >50K jobs/day
- Necessità pub/sub complesso
- Garantie delivery strict (at-least-once)

---

### 3.7 API Gateway

**SCELTA MVP: Kong Gateway (OSS) o AWS API Gateway**

#### Funzionalità Richieste:
- Rate limiting per tenant (100 req/min free tier, 500 pro, 2000 enterprise)
- Authentication JWT validation
- Request/Response logging
- CORS handling
- API versioning (v1, v2 path-based)

**Trade-off:**

| Caratteristica | Kong (self-hosted) | AWS API Gateway |
|----------------|---------------------|-----------------|
| Cost | Infra EC2 (~100€/mese) | Pay-per-request (0.0035$/1K) |
| Control | Pieno controllo | Managed, meno flessibilità |
| Performance | <10ms overhead | ~20-50ms overhead |
| Ops burden | Monitoring/scaling manuale | Zero ops |

**Decisione MVP:** AWS API Gateway per zero-ops, costi bassi iniziali (<1M req/mese)
**Decisione Scale:** Migrare a Kong self-hosted quando >10M req/mese per cost optimization

---

### 3.8 Firma Digitale

**SCELTA: Integrazione InfoCert RemoteSign o Aruba ArubaSign**

**Motivazione:**
- SPID-integrated: Utente autentica con SPID, firma senza token fisico
- API REST: Integrazione semplice, SDK Node.js disponibile
- Compliance eIDAS: Firma legalmente valida in EU
- Costo: €0.20-0.50 per firma (accettabile, ricaricabile in pricing utente)

**Flusso Integrazione:**
```mermaid
sequenceDiagram
    actor User
    participant App
    participant Backend
    participant InfoCert
    participant SPID

    User->>App: Click "Firma FIR"
    App->>Backend: POST /fir/{id}/sign
    Backend->>InfoCert: CreateSignRequest(document, user)
    InfoCert->>SPID: RequestAuth(user)
    SPID-->>User: Push notification mobile
    User->>SPID: Conferma con PIN
    SPID-->>InfoCert: AuthToken
    InfoCert->>InfoCert: Apply digital signature
    InfoCert-->>Backend: SignedDocument + Certificate
    Backend->>Backend: Store signed PDF
    Backend-->>App: Success
    App-->>User: "FIR firmato correttamente"
```

**Alternativa considerata:** Firma locale con smart card (rigettata per friction utente)

---

## 4. INTEGRAZIONI ESTERNE

### 4.1 RENTRI API - Dettagli Tecnici

**Endpoint:** `https://api.rentri.gov.it` (prod), `https://demoapi.rentri.gov.it` (demo)

**Autenticazione:** OAuth 2.0 Client Credentials Flow
```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&scope=rentri.registri.write rentri.fir.write
```

**Rate Limiting:** 100 req/min per client (confermato documentazione)

**Operazioni Principali:**

```typescript
interface RENTRIClient {
  // FIR
  creaFIR(fir: FIRPayload): Promise<RENTRIResponse>
  aggiornaStatoFIR(firId: string, stato: FIRStato): Promise<void>

  // Registri
  inviaMovimentiRegistro(movimenti: Movimento[]): Promise<RENTRIResponse>

  // Vidimazione
  vidimaRegistro(registroId: string, anno: number): Promise<VidimazioneResponse>

  // Query
  verificaFIR(numeroFIR: string): Promise<FIRStato>
}
```

**Gestione Errori:**
- **HTTP 429 (Rate Limit)**: Backoff esponenziale 1min → 5min → 30min
- **HTTP 503 (Service Unavailable)**: Queue job per retry dopo 1h
- **HTTP 400 (Validation Error)**: Alert admin, no retry automatico, blocca invio
- **HTTP 401 (Auth Expired)**: Refresh token automatico

**Resilienza:**
```typescript
// Graceful degradation
class RENTRISyncService {
  async syncFIR(fir: FIR): Promise<void> {
    try {
      await rentriClient.creaFIR(fir)
      fir.statoSincronizzazione = 'SINCRONIZZATO'
    } catch (error) {
      if (error.isRecoverable) {
        // Enqueue retry job
        await syncQueue.add('retry-fir', { firId: fir.id }, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60000 }
        })
        fir.statoSincronizzazione = 'IN_ATTESA_RETRY'
      } else {
        // Fallimento permanente
        fir.statoSincronizzazione = 'ERRORE_PERMANENTE'
        await notifyAdmin(error)
      }
    }
    await repository.save(fir)
  }
}
```

---

### 4.2 SPID/CIE Autenticazione

**Protocollo:** SAML 2.0

**Identity Provider Aggregator:** SPID Hub o AgID Identity Provider

**Flusso:**
```mermaid
sequenceDiagram
    actor User
    participant App
    participant Backend
    participant SPID_IDP
    participant SPID_Provider

    User->>App: Click "Accedi con SPID"
    App->>Backend: GET /auth/spid/login
    Backend->>Backend: Generate SAML AuthnRequest
    Backend-->>App: Redirect URL to SPID Hub
    App->>SPID_IDP: SAML AuthnRequest
    User->>SPID_IDP: Seleziona provider (Poste, Aruba, etc)
    SPID_IDP->>SPID_Provider: Forward auth request
    User->>SPID_Provider: Login (user/pass/OTP)
    SPID_Provider-->>SPID_IDP: SAML Response (assertions)
    SPID_IDP-->>App: Redirect to callback
    App->>Backend: POST /auth/spid/callback (SAML Response)
    Backend->>Backend: Validate signature, extract claims
    Backend->>Backend: Create/Update user, generate JWT
    Backend-->>App: JWT access + refresh token
    App->>App: Store tokens, redirect dashboard
```

**Libreria:** `passport-saml` (Node.js) con configurazione multi-IDP

**Attributi Estratti:**
- `fiscalNumber` (Codice Fiscale)
- `name`, `familyName`
- `email` (se disponibile)
- `spidCode` (livello autenticazione)

---

### 4.3 Integrazione ERP

**Pattern:** Adapter Pattern con connettori specifici

**ERP Target MVP:**
1. **Fatture in Cloud** (top choice PMI): REST API, webhook
2. **TeamSystem**: SOAP/REST, export CSV
3. **Zucchetti**: Digital Hub API (se cliente ha già WinWaste)

**Funzionalità:**
- **Export**: FIR → Riga fattura automatica (per trasportatori)
- **Import**: Prodotti/Materiali → Mappatura CER suggerita
- **Sync**: Anagrafiche fornitori → Trasportatori/Impianti

**Architettura:**
```typescript
interface ERPAdapter {
  connect(credentials: ERPCredentials): Promise<void>
  exportFIR(fir: FIR): Promise<InvoiceReference>
  importProducts(): Promise<Product[]>
  syncContacts(): Promise<Contact[]>
}

class FattureInCloudAdapter implements ERPAdapter { }
class TeamSystemAdapter implements ERPAdapter { }
class ZucchettiAdapter implements ERPAdapter { }
```

---

## 5. SICUREZZA E COMPLIANCE

### 5.1 Autenticazione e Autorizzazione

**Pattern:** RBAC (Role-Based Access Control) + Multi-Tenancy

**Ruoli Principali:**

| Ruolo | Permessi | Use Case |
|-------|----------|----------|
| **ADMIN** | Full access tenant | Titolare azienda |
| **OPERATOR** | Create FIR, visualizza registri | Operatori ufficio |
| **VIEWER** | Read-only | Commercialisti, auditor |
| **CONSULTANT_ADMIN** | Gestisce multi-tenant clienti | Consulente ambientale |
| **MOBILE_OPERATOR** | Solo app mobile, firma FIR | Autisti trasportatori |

**Implementazione:**
```typescript
// Prisma schema
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  role      Role
  tenants   UserTenant[]
}

model Tenant {
  id        String   @id @default(uuid())
  name      String
  users     UserTenant[]
  firs      FIR[]
  registri  Registro[]
}

model UserTenant {
  userId    String
  tenantId  String
  role      Role

  @@id([userId, tenantId])
}
```

**Row-Level Security (PostgreSQL):**
```sql
-- Automatic tenant isolation
CREATE POLICY tenant_isolation ON fir
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

-- Application sets context per request
SET app.current_tenant = '123e4567-e89b-12d3-a456-426614174000';
```

**JWT Claims:**
```json
{
  "sub": "user-uuid",
  "email": "marco@officina.it",
  "fiscalNumber": "FRRMRC80A01H501U",
  "tenantId": "tenant-uuid",
  "role": "ADMIN",
  "permissions": ["fir:create", "fir:read", "registry:write"],
  "iat": 1697197200,
  "exp": 1697203200
}
```

**SPID SAML Implementation (Custom Auth - MVP):**

```typescript
// NestJS Auth Module Configuration
import { Module } from '@nestjs/common'
import { PassportModule } from '@nestjs/passport'
import { JwtModule } from '@nestjs/jwt'
import { SPIDStrategy } from './strategies/spid.strategy'
import { JwtStrategy } from './strategies/jwt.strategy'

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: {
        expiresIn: '1h',  // Access token
        issuer: 'wasteflow.it',
        audience: 'wasteflow-api'
      }
    })
  ],
  providers: [SPIDStrategy, JwtStrategy, AuthService],
  controllers: [AuthController]
})
export class AuthModule {}

// SPID SAML Strategy
import { Strategy } from 'passport-saml'
import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'

@Injectable()
export class SPIDStrategy extends PassportStrategy(Strategy, 'spid') {
  constructor() {
    super({
      // Service Provider (SP) config
      callbackUrl: 'https://app.wasteflow.it/auth/spid/callback',
      entryPoint: 'https://demo.spid.gov.it/samlsso',  // SPID Hub
      issuer: 'wasteflow.it',

      // Certificati per firma richieste SAML
      privateCert: process.env.SPID_PRIVATE_KEY,
      cert: process.env.SPID_PUBLIC_CERT,

      // Identity Provider (IdP) config
      identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',

      // Attributi richiesti a SPID
      attributeConsumingServiceIndex: '1',
      authnContext: 'https://www.spid.gov.it/SpidL2',  // Livello sicurezza

      // Validazione risposta
      acceptedClockSkewMs: -1,
      disableRequestedAuthnContext: false
    })
  }

  async validate(profile: any): Promise<any> {
    // Estrazione attributi SPID
    const {
      fiscalNumber,    // Codice Fiscale (obbligatorio)
      name,            // Nome
      familyName,      // Cognome
      email,           // Email (opzionale)
      mobilePhone,     // Cellulare (opzionale)
      spidCode         // Livello autenticazione
    } = profile

    // Cerca o crea utente nel database
    return {
      fiscalNumber,
      name,
      familyName,
      email: email || `${fiscalNumber}@noemail.wasteflow.it`,
      spidLevel: spidCode
    }
  }
}

// Auth Controller
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Step 1: Redirect a SPID Hub
  @Get('spid/login')
  @UseGuards(AuthGuard('spid'))
  spidLogin() {
    // Passport redirect automatico a SPID
  }

  // Step 2: Callback da SPID con assertion
  @Post('spid/callback')
  @UseGuards(AuthGuard('spid'))
  async spidCallback(@Req() req, @Res() res) {
    const spidUser = req.user

    // Trova o crea utente
    const user = await this.authService.findOrCreateUser(spidUser)

    // Se primo accesso, richiedi selezione tenant
    if (!user.defaultTenantId) {
      return res.redirect('/onboarding/select-tenant')
    }

    // Genera JWT tokens
    const tokens = await this.authService.generateTokens(user)

    // Redirect con tokens (o set cookie HttpOnly)
    return res.redirect(`/dashboard?token=${tokens.accessToken}`)
  }

  // Refresh token endpoint
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken)
  }
}

// Auth Service
@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService
  ) {}

  async findOrCreateUser(spidUser: SPIDUser): Promise<User> {
    let user = await this.prisma.user.findUnique({
      where: { fiscalNumber: spidUser.fiscalNumber }
    })

    if (!user) {
      // Primo accesso: crea utente
      user = await this.prisma.user.create({
        data: {
          fiscalNumber: spidUser.fiscalNumber,
          email: spidUser.email,
          firstName: spidUser.name,
          lastName: spidUser.familyName,
          authProvider: 'SPID',
          spidLevel: spidUser.spidLevel
        }
      })
    }

    return user
  }

  async generateTokens(user: User, tenantId?: string): Promise<Tokens> {
    const tenant = tenantId || user.defaultTenantId

    // Fetch user role in tenant
    const userTenant = await this.prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId: tenant } }
    })

    if (!userTenant) {
      throw new UnauthorizedException('User not authorized for this tenant')
    }

    // Generate JWT claims
    const payload = {
      sub: user.id,
      email: user.email,
      fiscalNumber: user.fiscalNumber,
      tenantId: tenant,
      role: userTenant.role,
      permissions: this.getPermissions(userTenant.role)
    }

    // Access token (1h)
    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' })

    // Refresh token (7 giorni, stored in Redis)
    const refreshToken = this.jwtService.sign(
      { sub: user.id, type: 'refresh' },
      { expiresIn: '7d' }
    )

    // Store refresh token in Redis con TTL
    await this.redis.setex(
      `refresh:${user.id}:${refreshToken}`,
      7 * 24 * 60 * 60,  // 7 giorni
      JSON.stringify({ userId: user.id, tenantId: tenant })
    )

    return { accessToken, refreshToken }
  }

  private getPermissions(role: Role): string[] {
    const permissionsMap = {
      ADMIN: ['fir:*', 'registry:*', 'user:*', 'tenant:*'],
      OPERATOR: ['fir:create', 'fir:read', 'fir:update', 'registry:read', 'registry:write'],
      VIEWER: ['fir:read', 'registry:read'],
      CONSULTANT_ADMIN: ['fir:*', 'registry:*', 'tenant:read', 'tenant:switch'],
      MOBILE_OPERATOR: ['fir:read', 'fir:sign', 'fir:update-status']
    }
    return permissionsMap[role] || []
  }

  async refreshTokens(refreshToken: string): Promise<Tokens> {
    try {
      // Validate refresh token
      const payload = this.jwtService.verify(refreshToken)

      // Check if token exists in Redis (not revoked)
      const stored = await this.redis.get(`refresh:${payload.sub}:${refreshToken}`)
      if (!stored) {
        throw new UnauthorizedException('Invalid refresh token')
      }

      const { userId, tenantId } = JSON.parse(stored)
      const user = await this.prisma.user.findUnique({ where: { id: userId } })

      // Generate new tokens
      return this.generateTokens(user, tenantId)
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token')
    }
  }
}

// JWT Guard for protected routes
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context)
  }
}

// JWT Strategy for token validation
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET,
      issuer: 'wasteflow.it',
      audience: 'wasteflow-api'
    })
  }

  async validate(payload: any) {
    // Set tenant context for PostgreSQL RLS
    await this.prisma.$executeRawUnsafe(
      `SET app.current_tenant = '${payload.tenantId}'`
    )

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      permissions: payload.permissions
    }
  }
}

// Permission-based Guard
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.get<string[]>(
      'permissions',
      context.getHandler()
    )

    if (!requiredPermissions) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user

    return requiredPermissions.some(permission =>
      this.hasPermission(user.permissions, permission)
    )
  }

  private hasPermission(userPermissions: string[], required: string): boolean {
    return userPermissions.some(perm => {
      if (perm === required) return true
      if (perm.endsWith(':*')) {
        const prefix = perm.split(':')[0]
        return required.startsWith(prefix)
      }
      return false
    })
  }
}

// Usage in controllers
@Controller('fir')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FIRController {
  @Post()
  @Permissions('fir:create')
  async createFIR(@Body() dto: CreateFIRDto, @Req() req) {
    const { userId, tenantId } = req.user
    return this.firService.create(dto, userId, tenantId)
  }

  @Get(':id')
  @Permissions('fir:read')
  async getFIR(@Param('id') id: string) {
    // PostgreSQL RLS automaticamente filtra per tenantId
    return this.firService.findOne(id)
  }
}
```

**SPID Metadata Configuration:**

```xml
<!-- metadata/sp-metadata.xml - Service Provider Metadata -->
<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="wasteflow.it">
  <md:SPSSODescriptor
      AuthnRequestsSigned="true"
      WantAssertionsSigned="true"
      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">

    <!-- Signature verification certificate -->
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data>
          <ds:X509Certificate>
            <!-- Certificate PEM -->
          </ds:X509Certificate>
        </ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>

    <!-- Single Logout Service (optional) -->
    <md:SingleLogoutService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://app.wasteflow.it/auth/spid/logout"/>

    <!-- Assertion Consumer Service -->
    <md:AssertionConsumerService
        Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
        Location="https://app.wasteflow.it/auth/spid/callback"
        index="0"
        isDefault="true"/>

    <!-- Requested attributes -->
    <md:AttributeConsumingService index="1">
      <md:ServiceName xml:lang="it">WasteFlow</md:ServiceName>
      <md:RequestedAttribute Name="fiscalNumber" isRequired="true"/>
      <md:RequestedAttribute Name="name" isRequired="true"/>
      <md:RequestedAttribute Name="familyName" isRequired="true"/>
      <md:RequestedAttribute Name="email" isRequired="false"/>
      <md:RequestedAttribute Name="mobilePhone" isRequired="false"/>
    </md:AttributeConsumingService>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
```

**Environment Variables (.env):**
```bash
# SPID Configuration
SPID_ENTRY_POINT=https://demo.spid.gov.it/samlsso
SPID_CALLBACK_URL=https://app.wasteflow.it/auth/spid/callback
SPID_ISSUER=wasteflow.it
SPID_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
SPID_PUBLIC_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
SPID_AUTHN_CONTEXT=https://www.spid.gov.it/SpidL2

# JWT Configuration
JWT_SECRET=your-strong-secret-256-bits
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
JWT_ISSUER=wasteflow.it
JWT_AUDIENCE=wasteflow-api

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/wasteflow

# Redis
REDIS_URL=redis://localhost:6379
```

**Multi-Tenant Context Switch:**

```typescript
// Endpoint per switch tenant (Consultant use case)
@Post('tenant/switch')
@UseGuards(JwtAuthGuard)
async switchTenant(
  @Body() dto: SwitchTenantDto,
  @Req() req
): Promise<Tokens> {
  const { userId } = req.user
  const { tenantId } = dto

  // Verify user has access to target tenant
  const userTenant = await this.prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } }
  })

  if (!userTenant) {
    throw new ForbiddenException('User not authorized for this tenant')
  }

  // Generate new tokens with new tenantId
  const user = await this.prisma.user.findUnique({ where: { id: userId } })
  return this.authService.generateTokens(user, tenantId)
}
```

**Security Best Practices Implemented:**
- SAML assertions signed and encrypted
- JWT tokens short-lived (1h access, 7d refresh)
- Refresh tokens stored in Redis con revocation capability
- PostgreSQL RLS per tenant isolation automatico
- HTTPS obbligatorio (TLS 1.3)
- CSRF protection con SameSite cookies
- Rate limiting su auth endpoints (10 req/min per IP)

---

### 5.2 Crittografia

**Data in Transit:**
- TLS 1.3 obbligatorio per tutte le comunicazioni
- Certificate pinning mobile app
- HSTS header (Strict-Transport-Security: max-age=31536000)

**Data at Rest:**
- PostgreSQL: Transparent Data Encryption (TDE) via AWS RDS encryption
- S3: Server-Side Encryption (SSE-S3) AES-256
- Backup: Encrypted con AWS KMS customer-managed keys

**Sensitive Fields (Application-Level Encryption):**
```typescript
// Campi sensibili (es. note private) encrypted prima di salvare
class EncryptionService {
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`
  }

  decrypt(ciphertext: string): string { /* ... */ }
}
```

**Master Key Management:** AWS Secrets Manager con rotation automatica ogni 90 giorni

---

### 5.3 Audit Log Immutabile

**Requisito:** Tracciabilità completa azioni per compliance (ispezioni, audit legali)

**Pattern:** Write-Once-Read-Many (WORM) con append-only log

**Schema:**
```typescript
model AuditLog {
  id          String   @id @default(uuid())
  timestamp   DateTime @default(now())
  userId      String
  tenantId    String
  action      String   // 'FIR_CREATED', 'REGISTRY_UPDATED', 'USER_DELETED'
  entityType  String   // 'FIR', 'Registro', 'User'
  entityId    String
  changes     Json     // Before/After snapshot
  ipAddress   String
  userAgent   String

  @@index([tenantId, timestamp])
  @@index([entityType, entityId])
}
```

**Protezione Immutabilità:**
- DB-level: Revoke DELETE/UPDATE permissions su audit_log table per app user
- PostgreSQL trigger: Blocca modifiche su audit_log
- Backup incremental ogni 6 ore su S3 Glacier (immutabile per 7 anni)

**Query Audit:**
```typescript
// Ricostruisci storico FIR
async getAuditTrail(firId: string): Promise<AuditEntry[]> {
  return prisma.auditLog.findMany({
    where: { entityType: 'FIR', entityId: firId },
    orderBy: { timestamp: 'asc' }
  })
}
```

---

### 5.4 Backup e Disaster Recovery

**RTO (Recovery Time Objective):** 4 ore
**RPO (Recovery Point Objective):** 1 ora

**Strategia:**

| Tipo | Frequenza | Retention | Storage | Costo Stimato |
|------|-----------|-----------|---------|---------------|
| **Snapshot DB** | Ogni 6 ore | 7 giorni | S3 Standard | 50€/mese |
| **Backup completo** | Giornaliero (3:00 AM) | 90 giorni | S3 Glacier | 30€/mese |
| **WAL continuous archiving** | Real-time | 7 giorni | S3 Standard | 20€/mese |
| **Replica cross-region** | Async streaming | - | RDS replica | 200€/mese |

**Totale:** ~300€/mese per resilienza production-grade

**Test DR:** Simulazione failover mensile su ambiente staging

**Procedura Restore:**
1. Identifica ultimo snapshot valido (max 6h RPO)
2. Launch RDS instance da snapshot (15 min)
3. Restore WAL logs per point-in-time recovery (30 min)
4. Update DNS record per redirect traffic (5 min)
5. Smoke test applicazione (15 min)

**Totale RTO:** ~1 ora (sotto obiettivo 4h)

---

### 5.5 GDPR Compliance

**Principi Implementati:**

**1. Data Minimization:**
- Raccolta solo dati necessari per compliance normativa
- No tracking analytics invasivo (Mixpanel privacy-mode)

**2. Right to Access (Art. 15):**
```typescript
// Endpoint: GET /gdpr/export
async exportUserData(userId: string): Promise<GDPRExport> {
  return {
    personalInfo: await getUser(userId),
    firs: await getFIRsByUser(userId),
    auditLogs: await getAuditLogs(userId),
    // ... tutti i dati utente
  }
}
```

**3. Right to Erasure (Art. 17):**
- **Soft delete**: User.deletedAt flag, dati mascherati
- **Retention compliance**: Dati rifiuti conservati 3 anni per legge (NO delete)
- **Anonimizzazione**: Dopo 3 anni, PII rimossi, dati aggregati conservati

**4. Consent Management:**
```typescript
model UserConsent {
  userId        String
  consentType   String  // 'PRIVACY_POLICY', 'MARKETING', 'ANALYTICS'
  granted       Boolean
  grantedAt     DateTime
  ipAddress     String
}
```

**5. Data Breach Notification:**
- Alert automatico admin se rilevata anomalia (login da nuova geo, 1000+ req/min)
- Procedura notifica Garante Privacy entro 72h (playbook documentato)

**DPO (Data Protection Officer):** Consulente esterno (costo ~3K€/anno, obbligatorio >250 dipendenti o trattamento dati sensibili su larga scala)

---

## 6. SCALABILITÀ E PERFORMANCE

### 6.1 Architettura Scalabile

```mermaid
graph TB
    subgraph "Edge Layer"
        CF[CloudFlare CDN<br/>Static Assets]
        APIGW[AWS API Gateway<br/>Rate Limiting]
    end

    subgraph "Application Layer - Auto Scaling"
        ALB[Application Load Balancer]
        APP1[App Server 1<br/>ECS Fargate]
        APP2[App Server 2<br/>ECS Fargate]
        APP3[App Server N<br/>ECS Fargate]
    end

    subgraph "Data Layer"
        REDIS[(Redis ElastiCache<br/>Cluster Mode)]
        RDS_MASTER[(RDS PostgreSQL<br/>Primary)]
        RDS_REPLICA[(RDS Read Replica<br/>1-5 replicas)]
    end

    subgraph "Async Processing"
        SQS[AWS SQS<br/>Job Queue]
        WORKER1[Worker 1]
        WORKER2[Worker N]
    end

    CF --> APIGW
    APIGW --> ALB
    ALB --> APP1
    ALB --> APP2
    ALB --> APP3
    APP1 --> REDIS
    APP1 --> RDS_MASTER
    APP1 --> RDS_REPLICA
    APP2 --> REDIS
    APP2 --> RDS_MASTER
    APP2 --> RDS_REPLICA
    APP1 -.-> SQS
    SQS --> WORKER1
    SQS --> WORKER2
    WORKER1 --> RDS_MASTER
```

**Auto-Scaling Policy:**
```yaml
# ECS Service Auto Scaling
TargetTrackingScaling:
  TargetValue: 70  # CPU utilization
  ScaleOutCooldown: 60s
  ScaleInCooldown: 300s
  MinCapacity: 2
  MaxCapacity: 20

# RDS Read Replica Auto Scaling
ReadReplicaScaling:
  TargetValue: 75  # CPU utilization
  MinReplicas: 1
  MaxReplicas: 5
```

**Scaling Trigger Points:**
- 100 → 1.000 utenti: +2 app instances, +1 read replica
- 1.000 → 10.000 utenti: +10 app instances, +3 read replicas, Redis cluster
- 10.000+ utenti: Valutare sharding DB per tenant

---

### 6.2 Performance Optimization

**Target Metriche:**
- **Response Time P95:** <2s (98% richieste)
- **Response Time P99:** <5s
- **TTFB (Time to First Byte):** <500ms
- **Lighthouse Score:** >90

**Ottimizzazioni Implementate:**

**1. Database Query Optimization:**
```typescript
// BAD: N+1 queries
const firs = await prisma.fir.findMany({ where: { tenantId } })
for (const fir of firs) {
  fir.produttore = await prisma.azienda.findUnique({ where: { id: fir.produttoreId }})
}

// GOOD: Single query with eager loading
const firs = await prisma.fir.findMany({
  where: { tenantId },
  include: { produttore: true, trasportatore: true, destinatario: true }
})
```

**2. Database Indexing Strategy:**
```sql
-- Hot path queries
CREATE INDEX idx_fir_tenant_date ON fir(tenant_id, created_at DESC);
CREATE INDEX idx_registry_tenant_cer ON registry(tenant_id, cer_code);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);

-- Partial index per query comuni
CREATE INDEX idx_fir_pending ON fir(tenant_id) WHERE stato = 'BOZZA';
```

**3. Redis Caching:**
```typescript
// Cache-aside pattern
async getFIR(id: string): Promise<FIR> {
  const cached = await redis.get(`fir:${id}`)
  if (cached) return JSON.parse(cached)

  const fir = await prisma.fir.findUnique({ where: { id }, include: { ... } })
  await redis.setex(`fir:${id}`, 300, JSON.stringify(fir))  // TTL 5 min
  return fir
}

// Cache invalidation
async updateFIR(id: string, data: UpdateFIRDto): Promise<FIR> {
  const updated = await prisma.fir.update({ where: { id }, data })
  await redis.del(`fir:${id}`)  // Invalidate cache
  return updated
}
```

**4. API Response Compression:**
```typescript
// NestJS compression middleware
app.use(compression({ threshold: 1024 }))  // Compress responses >1KB
```

**5. Frontend Performance:**
```typescript
// Next.js optimizations
export const dynamic = 'force-dynamic'  // SSR for SEO pages
export const revalidate = 3600  // ISR: rebuild every 1h

// Code splitting
const HeavyChart = dynamic(() => import('./HeavyChart'), { ssr: false })

// Image optimization
<Image src="/logo.png" width={200} height={100} priority />
```

---

### 6.3 Database Sharding (Future)

**Trigger:** >100K tenant attivi

**Sharding Strategy:** Tenant-based sharding (ogni shard ha subset tenant)

```typescript
// Shard routing logic
function getShardForTenant(tenantId: string): DatabaseConnection {
  const shardNumber = hashTenantId(tenantId) % NUM_SHARDS
  return shardConnections[shardNumber]
}

// Application code agnostic
const db = getShardForTenant(currentTenant)
const firs = await db.fir.findMany({ where: { tenantId: currentTenant }})
```

**Challenges:**
- Cross-shard queries (es. analytics globali): Aggregation layer separato
- Shard rebalancing: Tenant migration complesso

**Alternativa valutata:** Citus (PostgreSQL extension) per transparent sharding

---

## 7. DEPLOYMENT E INFRASTRUTTURA

### 7.1 Cloud Provider: AWS

**Motivazione:**
- Maturità servizi managed (RDS, ECS, S3, SQS)
- Compliance certifications (ISO 27001, SOC 2)
- Costi competitivi per startup (credits available)
- Region Milano disponibile (latency EU)

**Servizi AWS Utilizzati:**

| Servizio | Utilizzo | Costo Mensile Stimato (MVP) |
|----------|----------|----------------------------|
| ECS Fargate | App servers (2 instances) | 150€ |
| RDS PostgreSQL | DB (db.t4g.medium) | 180€ |
| ElastiCache Redis | Cache (cache.t4g.small) | 40€ |
| S3 | Storage PDF/backup | 20€ |
| CloudFront | CDN | 30€ |
| API Gateway | API management | 50€ |
| Route 53 | DNS | 5€ |
| CloudWatch | Monitoring | 30€ |
| Secrets Manager | Credentials | 10€ |
| **TOTALE** | | **~515€/mese** |

**Scaling Cost (10.000 utenti):** ~2.500€/mese

---

### 7.2 Containerizzazione

**Docker Multi-Stage Build:**

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

**Docker Compose (Local Dev):**
```yaml
version: '3.8'
services:
  app:
    build: .
    ports: [3000:3000]
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/wasteflow
      REDIS_URL: redis://redis:6379
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: wasteflow
      POSTGRES_PASSWORD: password
    volumes: [postgres_data:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
```

**ECS Task Definition:**
```json
{
  "family": "wasteflow-app",
  "containerDefinitions": [{
    "name": "app",
    "image": "123456789.dkr.ecr.eu-south-1.amazonaws.com/wasteflow:latest",
    "memory": 1024,
    "cpu": 512,
    "essential": true,
    "environment": [
      { "name": "NODE_ENV", "value": "production" }
    ],
    "secrets": [
      { "name": "DATABASE_URL", "valueFrom": "arn:aws:secretsmanager:..." }
    ],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/wasteflow",
        "awslogs-region": "eu-south-1"
      }
    }
  }]
}
```

---

### 7.3 CI/CD Pipeline

**Tool:** GitHub Actions (gratuito per repo privati, ottima integrazione)

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run test
      - run: npm run test:e2e

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: aws-actions/configure-aws-credentials@v2
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
      - run: |
          docker build -t wasteflow:${{ github.sha }} .
          docker tag wasteflow:${{ github.sha }} $ECR_REGISTRY/wasteflow:latest
          docker push $ECR_REGISTRY/wasteflow:latest

  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/amazon-ecs-deploy-task-definition@v1
        with:
          task-definition: task-definition.json
          service: wasteflow-service
          cluster: production
          wait-for-service-stability: true

  smoke-test:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -f https://api.wasteflow.it/health || exit 1
          curl -f https://app.wasteflow.it || exit 1
```

**Deployment Strategy:** Blue-Green con ECS
- Deploy nuovo task definition (green)
- Health check nuovo tasks (2 min)
- Switch traffic su ALB
- Terminate old tasks (blue)
- Rollback automatico se health check fail

**Frequency:** 5-10 deploy/settimana in MVP, daily in growth phase

---

### 7.4 Monitoring e Observability

**Stack:** Datadog (all-in-one) o CloudWatch + Sentry

**Metriche Monitorate:**

**Infrastructure:**
- CPU/Memory utilization (ECS tasks, RDS)
- Network throughput
- Disk I/O (RDS)
- Cache hit ratio (Redis)

**Application:**
- Request rate, latency (P50, P95, P99)
- Error rate (4xx, 5xx)
- Database query duration
- External API latency (RENTRI, SPID)

**Business:**
- Numero FIR creati/giorno
- Signup conversion rate
- RENTRI sync success rate
- User activation rate (first FIR <7 days)

**Alerting Rules:**
```yaml
alerts:
  - name: High Error Rate
    condition: error_rate > 5%
    duration: 5min
    severity: critical
    notify: [pagerduty, slack]

  - name: Slow API Response
    condition: p95_latency > 3s
    duration: 10min
    severity: warning
    notify: [slack]

  - name: RENTRI Sync Failing
    condition: rentri_sync_error_rate > 10%
    duration: 15min
    severity: critical
    notify: [pagerduty, email]

  - name: Database Connection Pool Exhausted
    condition: db_pool_available < 5
    duration: 2min
    severity: critical
    notify: [pagerduty]
```

**Distributed Tracing:** OpenTelemetry + Jaeger (post-MVP, quando >5 microservizi)

---

### 7.5 Infrastructure as Code

**Tool:** Terraform (de-facto standard, multi-cloud)

**Structure:**
```
terraform/
├── modules/
│   ├── ecs/
│   ├── rds/
│   ├── vpc/
│   └── elasticache/
├── environments/
│   ├── dev/
│   │   └── main.tf
│   ├── staging/
│   │   └── main.tf
│   └── production/
│       └── main.tf
└── global/
    └── route53.tf
```

**Example Module (ECS):**
```hcl
module "ecs_cluster" {
  source = "./modules/ecs"

  cluster_name = "wasteflow-${var.environment}"
  vpc_id       = module.vpc.vpc_id
  subnets      = module.vpc.private_subnets

  app_image    = "wasteflow:latest"
  app_count    = var.environment == "production" ? 2 : 1

  environment_variables = {
    NODE_ENV     = var.environment
    LOG_LEVEL    = var.log_level
  }

  secrets = {
    DATABASE_URL = aws_secretsmanager_secret.db_url.arn
    RENTRI_KEY   = aws_secretsmanager_secret.rentri_key.arn
  }
}
```

**Workflow:**
```bash
# Dev environment
cd terraform/environments/dev
terraform init
terraform plan
terraform apply

# Production (require approval)
cd terraform/environments/production
terraform plan -out=plan.tfplan
# Manual review + approval
terraform apply plan.tfplan
```

---

## 8. GESTIONE OFFLINE MOBILE

### 8.1 Strategia Sync/Conflict Resolution

**Approccio:** Optimistic UI + Eventual Consistency

**Pattern:** Offline-First Architecture

```typescript
// Local storage: SQLite (React Native)
class OfflineStorageService {
  async saveFIRDraft(fir: FIRDraft): Promise<void> {
    await db.firs.add({
      ...fir,
      syncStatus: 'PENDING',
      localId: uuid(),
      createdAtLocal: new Date()
    })
  }

  async getPendingSync(): Promise<FIRDraft[]> {
    return db.firs.where('syncStatus').equals('PENDING').toArray()
  }
}

// Sync service
class SyncService {
  async syncAll(): Promise<void> {
    const pending = await offlineStorage.getPendingSync()

    for (const draft of pending) {
      try {
        // Upload to server
        const serverFIR = await api.createFIR(draft)

        // Update local record
        await db.firs.update(draft.localId, {
          id: serverFIR.id,  // Server-assigned ID
          syncStatus: 'SYNCED',
          syncedAt: new Date()
        })
      } catch (error) {
        // Retry later
        await db.firs.update(draft.localId, {
          syncStatus: 'ERROR',
          lastError: error.message
        })
      }
    }
  }
}
```

**Conflict Resolution:**

**Scenario:** Utente modifica FIR offline, nel frattempo altro utente modifica online

**Strategia:** Last-Write-Wins con Version Vector

```typescript
interface FIR {
  id: string
  version: number  // Incrementato ad ogni update
  updatedAt: Date
  updatedBy: string
}

async function handleConflict(local: FIR, remote: FIR): Promise<FIR> {
  if (local.version === remote.version) {
    // No conflict, merge OK
    return local
  }

  if (local.updatedAt > remote.updatedAt) {
    // Local wins (unlikely se offline a lungo)
    return await api.updateFIR(local.id, local, { version: remote.version })
  } else {
    // Remote wins, show alert to user
    await showConflictDialog({
      message: "Il FIR è stato modificato da un altro utente. Vuoi sovrascrivere?",
      localVersion: local,
      remoteVersion: remote
    })
  }
}
```

**Per FIR critici (firma digitale):** Conflict impossibile (once signed, immutable)

---

### 8.2 Storage Locale

**Tecnologia:** Expo SQLite (Structured) + AsyncStorage (Key-Value)

**Schema Locale:**
```sql
CREATE TABLE firs (
  local_id TEXT PRIMARY KEY,
  server_id TEXT,
  tenant_id TEXT NOT NULL,
  sync_status TEXT NOT NULL,  -- 'PENDING', 'SYNCED', 'ERROR'
  data JSON NOT NULL,
  created_at_local INTEGER NOT NULL,
  synced_at INTEGER
);

CREATE INDEX idx_sync_pending ON firs(sync_status) WHERE sync_status = 'PENDING';
```

**Dimensionamento:**
- Max 500 FIR in cache locale (autisti raramente superano 50/giorno)
- Cleanup automatico FIR >30 giorni e SYNCED
- Warning se storage >50MB

---

### 8.3 Queue Operazioni

**Pattern:** Command Queue + Idempotency

```typescript
interface QueuedOperation {
  id: string
  type: 'CREATE_FIR' | 'UPDATE_FIR' | 'SIGN_FIR'
  payload: any
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'FAILED'
  attempts: number
  createdAt: Date
}

class OperationQueue {
  async enqueue(operation: QueuedOperation): Promise<void> {
    await db.operations.add(operation)
    this.processQueue()  // Trigger immediate processing if online
  }

  async processQueue(): Promise<void> {
    if (!navigator.onLine) return

    const pending = await db.operations
      .where('status').equals('PENDING')
      .sortBy('createdAt')

    for (const op of pending) {
      await this.executeOperation(op)
    }
  }

  private async executeOperation(op: QueuedOperation): Promise<void> {
    try {
      await db.operations.update(op.id, { status: 'IN_PROGRESS' })

      // Idempotency: use deterministic ID
      const result = await api[op.type]({
        ...op.payload,
        idempotencyKey: op.id
      })

      await db.operations.update(op.id, {
        status: 'SUCCESS',
        completedAt: new Date()
      })
    } catch (error) {
      await db.operations.update(op.id, {
        status: op.attempts >= 3 ? 'FAILED' : 'PENDING',
        attempts: op.attempts + 1
      })
    }
  }
}
```

**Idempotency Server-Side:**
```typescript
@Post('/fir')
async createFIR(
  @Body() dto: CreateFIRDto,
  @Headers('idempotency-key') idempotencyKey: string
): Promise<FIR> {
  // Check if already processed
  const existing = await redis.get(`idempotency:${idempotencyKey}`)
  if (existing) return JSON.parse(existing)

  const fir = await this.firService.create(dto)

  // Cache result for 24h
  await redis.setex(`idempotency:${idempotencyKey}`, 86400, JSON.stringify(fir))

  return fir
}
```

---

## 9. DECISIONI ARCHITETTURALI (ADR)

### ADR-001: Monolite Modulare vs Microservizi

**Status:** Accepted
**Date:** 2025-10-13
**Deciders:** CTO, Lead Architect

**Context:**
Sistema greenfield, team 5-7 dev, time-to-market 3.5 mesi, scala target 10x in 18 mesi.

**Decision:**
Adottiamo Monolite Modulare con Domain-Driven Design, preparato per estrazione microservizi futura.

**Consequences:**
- **Positive:** Velocity sviluppo +40%, complessità ops -60%, costi infra -70% vs microservizi
- **Negative:** Scaling granulare limitato, risk accoppiamento se disciplina bassa
- **Mitigation:** Bounded contexts strict, event bus interno, code review architetturale

---

### ADR-002: PostgreSQL vs MongoDB

**Status:** Accepted
**Date:** 2025-10-13

**Context:**
Necessità ACID per compliance, dati strutturati (FIR, Registri), query relazionali complesse.

**Decision:**
PostgreSQL come database primario, con JSON fields per flessibilità.

**Consequences:**
- **Positive:** ACID guarantee, transazioni multi-tabella, maturità, JSON support hybrid
- **Negative:** Sharding manuale complesso (ma necessario solo >100K tenant)
- **Alternative Rejected:** MongoDB (ACID debole), CockroachDB (costo/complessità prematura)

---

### ADR-003: React Native vs Native iOS/Android

**Status:** Accepted
**Date:** 2025-10-13

**Context:**
App mobile critical per autisti, budget limitato, team con skills React.

**Decision:**
React Native con Expo per MVP, riconsiderare Native se performance diventa blocker.

**Consequences:**
- **Positive:** Time-to-market -50%, costo team -60%, code sharing 80%
- **Negative:** Performance -10% vs native, alcune funzionalità native richiedono bridge
- **Review Trigger:** Se UX mobile score <70 o performance complaint rate >5%

---

### ADR-004: Custom Auth MVP vs Keycloak Enterprise IAM

**Status:** Accepted
**Date:** 2025-10-13
**Deciders:** CTO, Lead Architect, Product Manager

**Context:**
Sistema richiede autenticazione SPID/CIE (SAML 2.0), gestione ruoli RBAC, multi-tenancy con isolamento tenant. Due opzioni valutate:
1. **Custom Auth:** SPID SAML diretto + JWT custom + RBAC application-level
2. **Keycloak:** Identity broker SPID → Keycloak → JWT, RBAC gestito in Keycloak

**Decision:**
**Phase 1 (Sprint 0-7, Mesi 1-4): Custom Authentication**
- SPID SAML 2.0 direct integration con `passport-saml`
- JWT custom con claims: `{ sub, email, tenantId, role, permissions }`
- RBAC 5 ruoli: ADMIN, OPERATOR, VIEWER, CONSULTANT_ADMIN, MOBILE_OPERATOR
- Multi-tenancy: UserTenant junction table + PostgreSQL RLS

**Phase 2 (Sprint 10-14, Mesi 5-7): Migration to Keycloak**
- Keycloak come identity broker SPID
- Groups-based multi-tenancy: `/tenant-123/ADMIN`
- Custom attributes per tenant_ids array
- Effort migrazione: 5 settimane (1 sprint setup Keycloak, 2 sprints migrazione auth, 1 sprint testing, 1 sprint cleanup)

**Consequences:**

**Positive (Custom Auth MVP):**
- Time-to-market: -3 settimane vs Keycloak immediate (team conosce NestJS + Passport)
- Costi infra: -350€/mese (no Keycloak cluster, no database dedicato)
- Complessità ops: minima (no gestione Keycloak updates, themes, realm config)
- Control totale: debugging semplificato, no black box

**Negative (Custom Auth MVP):**
- No MFA built-in: implementazione custom se richiesto (2-3 settimane effort)
- No Admin Console: management ruoli via API/dashboard custom
- No SSO cross-app: se aggiungiamo altre app in futuro, serve integrazione custom
- Audit log auth: custom implementation vs Keycloak built-in

**Mitigation Strategy:**
- **Architecture for migration:** Auth service isolato con interfaccia `IAuthService`
- **Feature flags:** Environment variable `AUTH_PROVIDER: 'custom' | 'keycloak'`
- **JWT standard claims:** Compatibili con Keycloak token structure
- **Database schema prepared:** User.externalId per mapping futuro Keycloak userId

**Migration Triggers (Phase 2):**
- User base >1.000 (admin console diventa necessario)
- Richieste MFA da clienti enterprise (>5 requests)
- Necessità SSO cross-app (es. analytics dashboard separato)
- Security audit raccomanda IAM enterprise (compliance ISO 27001)
- Budget infra aumenta a >3.000€/mese (costo Keycloak accettabile)

**Cost Analysis:**

| Componente | Custom Auth | Keycloak | Delta |
|------------|-------------|----------|-------|
| Infra (DB, Redis, Compute) | Incluso nel monolite | +150€ (RDS t4g.small) | +150€ |
| Keycloak cluster (2 istanze) | - | +200€ (ECS Fargate) | +200€ |
| Development (MVP) | 2 settimane | 5 settimane | -3 settimane |
| Maintenance (anno 1) | 1 settimana | 0 settimane | +1 settimana |
| **Totale Costo MVP** | **Baseline** | **+350€/mese + 3 settimane delay** | - |

**Decision Rationale:**
Per MVP con budget limitato, team piccolo e time-to-market critico, Custom Auth è scelta pragmatica. Keycloak differito a Phase 2 quando scala e complessità giustificano investimento enterprise IAM.

**Alternative Rejected:**
- **Auth0/Okta SaaS:** Costo proibitivo (€600-1500/mese), lock-in vendor, SPID integration non nativa
- **Keycloak immediate:** Over-engineering per MVP, delay inaccettabile, complessità ops prematura

**Review Date:** Mese 6 (post-MVP), valutare trigger migrazione Keycloak

---

## 10. ROADMAP TECNICA

### Phase 1: MVP Foundation (Mesi 1-3.5)

**Sprint 1-2: Core Infrastructure**
- Setup AWS account, VPC, RDS, Redis
- CI/CD pipeline GitHub Actions
- Monorepo NX setup (backend + frontend + mobile)
- Authentication SPID stub (mock per dev)

**Sprint 3-6: Core Domains**
- FIR Management module (create, sign, track)
- Registry module (carico/scarico)
- CER Catalog import e search
- Anagraphics module

**Sprint 7-8: RENTRI Integration**
- RENTRI API client development
- Async sync job queue
- Retry policies e error handling
- Integration testing ambiente demo RENTRI

**Sprint 9: MVP Polish**
- Performance optimization
- Security audit
- Beta testing con 20 utenti
- Bug fixing critical

**Deliverable:** MVP funzionante con FIR digitali + Registri + RENTRI sync

---

### Phase 2: Mobile & Automation (Mesi 4-8)

**Sprint 10-12: Mobile App**
- React Native app iOS/Android
- Offline-first architecture
- Firma digitale mobile
- QR code scanning

**Sprint 13-14: Automation**
- AI-powered CER suggestion (OpenAI GPT-4)
- Auto-compilazione registri da FIR
- Calendario scadenze intelligente
- Notifiche proattive

**Sprint 15-16: Reporting**
- Dashboard analytics
- MUD pre-compilation
- Export avanzati
- Multi-tenant admin panel

**Deliverable:** App mobile production-ready + features automazione

---

### Phase 3: Scale & Advanced Features (Mesi 9-18)

**Sprint 17-20: Marketplace**
- Trasportatori listing
- Sistema preventivi
- Rating/reviews
- Transazioni integrate

**Sprint 21-24: Enterprise Features**
- Multi-site dashboard (Sara persona)
- ESG reporting carbon footprint
- Advanced analytics e benchmark
- ERP integrations (Zucchetti, TeamSystem)

**Sprint 25-28: Scalability**
- Database read replicas
- Redis cluster mode
- CDN optimization
- Performance tuning per 10K users

**Deliverable:** Platform pronta per 10.000+ utenti, revenue diversification via marketplace

---

## 11. COSTI E SIZING

### Costi Infrastruttura per Fase

| Fase | Users | Infra AWS | SaaS (Datadog, etc) | Totale/Mese |
|------|-------|-----------|---------------------|-------------|
| **MVP** | 100 | 500€ | 200€ | 700€ |
| **Growth** | 1.000 | 1.200€ | 400€ | 1.600€ |
| **Scale** | 10.000 | 2.500€ | 800€ | 3.300€ |

### Team Sizing

**MVP (Mesi 1-4):**
- 2 Backend Developers (NestJS, RENTRI)
- 2 Frontend Developers (React, Next.js)
- 1 Mobile Developer (React Native)
- 1 DevOps Engineer (part-time, 50%)
- 1 Product Manager

**Totale:** 5.5 FTE

**Growth (Mesi 5-12):**
- +1 Backend Dev
- +1 Frontend Dev
- +1 Mobile Dev (full-time su iOS/Android split)
- DevOps full-time

**Totale:** 8 FTE

---

## CONCLUSIONE

**Architettura Scelta:** Monolite Modulare cloud-native, pragmatico per MVP, preparato per scala.

**Punti di Forza:**
- Time-to-market aggressivo (3.5 mesi)
- Costi contenuti (700€/mese infra MVP)
- Stack moderno e attraente per hiring (TypeScript, React, AWS)
- Scalabilità 10x senza refactoring architetturale
- Compliance RENTRI nativa

**Rischi Mitigati:**
- Over-engineering: Evitato con approccio monolite, no K8s prematuro
- Vendor lock-in AWS: Accettato per velocity, mitigabile con Terraform multi-cloud
- Performance mobile: React Native sufficiente per MVP, exit strategy a Native documentata
- RENTRI downtime: Graceful degradation con queue e retry automatico

**Prossimi Step:**
1. Validation architecture review con team tecnico (workshop 2 giorni)
2. Setup AWS account e ambiente dev (Sprint 0)
3. Spike RENTRI API demo environment (2 giorni)
4. Recruitment 2 backend dev + 1 DevOps
5. Kickoff Sprint 1: Infrastructure setup

**Success Metrics Architettura:**
- Deploy frequency: >1/giorno (dopo stabilizzazione)
- Lead time commit→production: <2 ore
- MTTR (Mean Time to Repair): <1 ora
- Infrastructure cost per user: <0.50€/mese (economie di scala)

---

**Documento Preparato da:** System Architect
**Versione:** 1.0 - Architettura Iniziale
**Prossima Revisione:** Post-MVP (Mese 4) per valutazione performance reali e decisioni scaling

