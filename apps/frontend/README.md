# WasteFlow Frontend

Applicazione Angular 17+ con PrimeNG per la gestione digitale dei Formulari Identificazione Rifiuti (FIR).

## Setup

### Prerequisiti
- Node.js >= 20.0.0
- npm >= 10.0.0
- Backend WasteFlow in esecuzione su `localhost:3000`

### Installazione

```bash
# Dalla root del monorepo
npm install

# Le dipendenze del frontend sono gestite via npm workspaces
# Non serve installare separatamente in apps/frontend
```

### Avvio Sviluppo

```bash
# Dalla directory frontend
cd apps/frontend
npm start

# L'applicazione sarà disponibile su http://localhost:4200
# Il proxy inoltrerà le richieste /api/* al backend su :3000
```

### Build Produzione

```bash
cd apps/frontend
npm run build

# Output in dist/frontend
# Configurare environment.prod.ts con l'URL API di produzione
```

### Test

```bash
# Unit tests
npm test

# Unit tests con coverage
npm run test:coverage

# Tests in watch mode
npm run test:watch
```

## Struttura (✓ Implementata)

```
src/
├── app/
│   ├── core/
│   │   ├── services/
│   │   │   ├── auth.service.ts          # JWT + SPID mock
│   │   │   ├── api.service.ts           # HTTP client base
│   │   │   └── toast.service.ts         # Notifiche PrimeNG
│   │   ├── guards/
│   │   │   └── auth.guard.ts            # Route protection
│   │   └── interceptors/
│   │       └── auth.interceptor.ts      # JWT injection
│   ├── features/
│   │   ├── dashboard/
│   │   │   └── dashboard.component.ts   # Dashboard home
│   │   ├── fir/
│   │   │   ├── fir-list.component.ts    # Tabella FIR (p-table)
│   │   │   ├── fir-create.component.ts  # Form crea FIR (p-dialog)
│   │   │   └── fir.service.ts           # API FIR
│   │   ├── registry/
│   │   │   ├── produttori-list.component.ts
│   │   │   ├── trasportatori-list.component.ts
│   │   │   ├── destinatari-list.component.ts
│   │   │   └── registry.service.ts      # API Registry
│   │   └── cer/
│   │       ├── cer-search.component.ts  # Ricerca CER (p-autoComplete)
│   │       └── cer.service.ts           # API CER
│   ├── shared/
│   │   ├── components/
│   │   │   ├── layout.component.ts      # Layout con sidebar (p-menubar + p-sidebar)
│   │   │   └── loading.component.ts     # Spinner (p-progressSpinner)
│   │   └── models/
│   │       ├── fir.model.ts
│   │       ├── registry.model.ts
│   │       └── user.model.ts
│   ├── app.component.ts
│   ├── app.config.ts                    # Standalone app config
│   └── app.routes.ts                    # Routing lazy-loaded
├── assets/
├── environments/
│   ├── environment.ts
│   └── environment.prod.ts
├── styles.scss                          # PrimeNG theme + custom
└── main.ts
```

## PrimeNG Components Utilizzati

- **p-menubar** - Navigation bar superiore
- **p-sidebar** - Menu laterale responsive
- **p-table** - Tabelle dati con pagination/sorting/filtering
- **p-dialog** - Modali per create/edit forms
- **p-button** - Pulsanti styled
- **p-inputText** - Input form
- **p-dropdown** - Select con ricerca
- **p-autoComplete** - Ricerca CER codes
- **p-calendar** - Date picker
- **p-toast** - Notifiche success/error
- **p-progressSpinner** - Loading states
- **p-card** - Card containers per dashboard
- **p-badge** - Badges per stati FIR

## Stato Implementazione

✅ **Completato:**
1. ✓ Core structure (guards, interceptors, services)
2. ✓ Authentication system con mock SPID login
3. ✓ Layout component con PrimeNG menubar e sidebar
4. ✓ Dashboard con statistiche e chart
5. ✓ FIR list component con p-table e CRUD completo
6. ✓ Registry components (Produttori, Trasportatori, Destinatari)
7. ✓ Form dialogs con validazione
8. ✓ Routing lazy-loaded
9. ✓ Toast notifications
10. ✓ Confirmation dialogs
11. ✓ CER search component con p-autoComplete
12. ✓ Export functionality (PDF/Excel) con jsPDF e XLSX
13. ✓ Loading interceptor con spinner globale
14. ✓ Error handler service per gestione errori globale
15. ✓ Environment configuration (dev/prod)
16. ✓ Unit tests per Auth e FIR services
17. ✓ Dependencies fixed (RxJS, Chart.js, date-fns)

## Funzionalità Principali

### Gestione FIR
- Creazione, modifica, eliminazione FIR
- Workflow completo: BOZZA → EMESSO → IN_TRANSITO → CONSEGNATO
- Filtri per stato
- Esportazione in PDF e Excel
- Tabella paginata con azioni inline

### Catalogo CER
- Ricerca codici CER con autocomplete
- Visualizzazione tabella completa con filtri
- Filtro per categoria e rifiuti pericolosi
- Modalità compact per uso nei form

### Anagrafiche
- CRUD completo per Produttori, Trasportatori, Destinatari
- Validazione indirizzi italiani (CAP, Provincia)
- Gestione P.IVA, PEC, numeri autorizzazione

### Export & Reports
- Esportazione liste FIR in PDF con intestazioni
- Esportazione dettaglio FIR singolo in PDF
- Esportazione Excel con tutte le colonne
- Formattazione date italiane

### UX Features
- Loading spinner globale automatico
- Error handling con messaggi user-friendly
- Toast notifications per feedback
- Confirmation dialogs per azioni critiche
- Layout responsive con sidebar

## Prossimi Passi (Opzionali)

1. Implementare SPID authentication flow completo (escluso da questa implementazione)
2. Aggiungere E2E tests con Cypress/Playwright
3. Implementare ricerca full-text avanzata
4. Aggiungere grafici avanzati (trend, analisi)
5. Implementare real-time updates con WebSocket
6. Aggiungere internazionalizzazione (i18n)
7. Implementare PWA features (offline mode)
8. Aggiungere dashboard personalizzabili
9. Implementare notifiche push
10. Aggiungere export schedulati automatici

## API Integration

Il frontend chiama le API backend tramite proxy:
- `/api/auth/*` - Authentication
- `/api/fir/*` - FIR Management
- `/api/registry/*` - Produttori/Trasportatori/Destinatari
- `/api/cer/*` - CER Catalog

Configurazione proxy in `proxy.conf.json` redirige `/api` a `http://localhost:3000`

## Note

- Utilizzare **standalone components** (Angular 17+)
- Lazy loading dei moduli features
- RxJS per state management (o signal-based state)
- Form reattivi con validation
- PrimeNG theme: Lara Light Blue
