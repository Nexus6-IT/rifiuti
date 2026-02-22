# 🔌 Agent Report: API Surface

**Date:** 2025-11-27
**Agent:** ApiScanner 1.0
**Subject:** Exposed API Endpoints & Controllers

## 🌐 API Overview
The backend exposes a rich set of RESTful endpoints organized by domain.

### 🔐 Authentication & Identity
- **Auth:** Login, SPID/CIE integration.
- **Permissions:** Role-Based Access Control (RBAC).
- **Identity Access:** User management.

### 🚛 Core Business Logic
- **FIR (Formulario Identificazione Rifiuti):**
  - CRUD operations for FIRs.
  - State transitions (Emit, Sign, Transport, Accept).
- **Registry:**
  - Management of Producers, Transporters, Receivers.
- **CER (Catalogo Europeo Rifiuti):**
  - Search and retrieval of waste codes.
- **MUD (Modello Unico Dichiarazione):**
  - Annual reporting generation.

### 🛠️ Infrastructure & Utilities
- **Health:** System health checks (Liveness/Readiness).
- **Monitoring:** Metrics and logs.
- **Notifications:** Email and system alerts.
- **PDF:** Document generation services.
- **Backup:** Database backup management.

### 🔗 Integrations
- **RENTRI:** Synchronization with the National Electronic Register.
- **Signatures:** Digital signature processing.

## 📡 Controller Map (`src/api`)
| Module | Likely Path | Description |
| :--- | :--- | :--- |
| `auth` | `/auth` | Authentication endpoints |
| `fir` | `/fir` | FIR management |
| `registry` | `/registry` | Registry actors |
| `cer` | `/cer` | Waste codes catalog |
| `rentri` | `/rentri` | Sync status and manual triggers |
| `dashboard` | `/dashboard` | Aggregated analytics data |
| `health` | `/health` | Kubernetes probes |

## ⚠️ Observations
- The presence of `rentri` and `signatures` controllers suggests these features are modeled, even if the implementation might be mock/stub (as noted in Audit).
- `openapi.config.ts` indicates Swagger/OpenAPI documentation is available (likely at `/api/docs` when running).
