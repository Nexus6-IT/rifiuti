# 🏛️ Agent Report: Architecture Deep Dive

**Date:** 2025-11-27
**Agent:** ArchitectBot 1.0
**Subject:** System Architecture & Module Breakdown

## 🏗️ High-Level Architecture
The system follows a **Monorepo** structure containing a NestJS Backend and an Angular Frontend.

### Directory Structure
```
c:\Progetti\rifiuti\
├── apps\
│   ├── backend\    (NestJS API)
│   └── frontend\   (Angular SPA)
├── docs\           (Documentation)
└── docker\         (Containerization)
```

## 🔙 Backend Architecture (`apps/backend`)
The backend is structured using **Domain-Driven Design (DDD)** principles, separated into three main layers:

### 1. Domain Layer (`src/domain`)
Contains the business logic, entities, and value objects.
- **Modules:** `auth`, `cer`, `events`, `fir`, `identity-access`, `registry`, `rentri`.
- **Key Concept:** This layer is isolated from external frameworks.

### 2. Application Layer (`src/application`)
Orchestrates the domain logic using **CQRS** (Command Query Responsibility Segregation).
- **Commands:** Write operations (e.g., `CreateFIR`, `SignFIR`).
- **Queries:** Read operations (e.g., `GetFIRById`).

### 3. Infrastructure Layer (`src/infrastructure`)
Implements interfaces defined in the domain layer.
- **Persistence:** Prisma ORM.
- **Integrations:** RENTRI API, SPID/CIE (likely stubbed).

### 4. API Layer (`src/api`)
Exposes functionality via REST endpoints.
- **Controllers:** Organized by feature (see API Surface report).
- **Middleware:** Authentication, Logging, Validation.

## 🖥️ Frontend Architecture (`apps/frontend`)
The frontend is a standard Angular 17 application.

### Core Modules (`src/app/core`)
Singleton services and global configurations.
- `auth`, `http`, `interceptors`.

### Feature Modules (`src/app/features`)
Lazy-loaded modules corresponding to business domains.
- **Auth:** Login, Registration.
- **Dashboard:** Analytics and overview.
- **FIR:** Waste Identification Forms management.
- **Registry:** Producers, Transporters, Receivers management.
- **Permissions:** RBAC management.

## 🔄 Data Flow
1. **Client** (Angular) sends Request -> **API Layer** (NestJS Controller).
2. **Controller** executes **Command/Query** (Application Layer).
3. **Command** invokes **Domain Entity** logic.
4. **Infrastructure** persists state to **PostgreSQL**.

## 🧩 Key Design Patterns
- **CQRS:** Clear separation of reads and writes.
- **Repository Pattern:** Abstraction over data access.
- **Dependency Injection:** Heavy use of NestJS DI.
- **Modular Monolith:** Code is co-located but logically separated.
