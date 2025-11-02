# Quickstart Guide: Local Development Setup

**Feature**: 001-production-ready-app | **Date**: 2025-10-30

Get the WasteFlow production-ready application running locally in under 15 minutes.

## Prerequisites

- **Node.js 20 LTS** (verify: `node --version`)
- **PostgreSQL 16** (verify: `psql --version`)
- **Redis 7** (optional for local dev, can use Docker)
- **Git** for version control
- **Docker Desktop** (recommended for PostgreSQL + Redis)

## Quick Start (Docker Compose)

```bash
# 1. Clone repository
git clone <repository-url>
cd rifiuti

# 2. Start PostgreSQL + Redis via Docker Compose
docker-compose up -d

# 3. Install dependencies
npm install
cd apps/backend && npm install
cd ../frontend && npm install
cd ../..

# 4. Setup environment variables
cp apps/backend/.env.example apps/backend/.env
# Edit .env: Set DATABASE_URL, REDIS_URL, JWT_SECRET

# 5. Run database migrations
cd apps/backend
npm run prisma:generate
npm run prisma:migrate dev

# 6. Seed database (CER catalog, test tenants, test users)
npm run prisma:seed

# 7. Start backend (dev mode with hot reload)
npm run start:dev
# Backend running at http://localhost:3000

# 8. In new terminal: Start frontend
cd apps/frontend
npm run start
# Frontend running at http://localhost:4200
```

**Done!** Open http://localhost:4200 in browser.

## Manual Setup (No Docker)

### 1. PostgreSQL Setup

```bash
# Create database and user
psql postgres
CREATE DATABASE wasteflow_dev;
CREATE USER wasteflow_user WITH PASSWORD 'dev_password_123';
GRANT ALL PRIVILEGES ON DATABASE wasteflow_dev TO wasteflow_user;
\q
```

### 2. Redis Setup

```bash
# Install Redis (macOS)
brew install redis
brew services start redis

# Install Redis (Windows via WSL or Memurai)
# Download from https://github.com/microsoftarchive/redis/releases
```

### 3. Environment Configuration

Create `apps/backend/.env`:

```env
# Database
DATABASE_URL="postgresql://wasteflow_user:dev_password_123@localhost:5432/wasteflow_dev"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET="your-super-secret-jwt-key-change-me"

# SPID (use test environment)
SPID_ENABLED=false  # Set true when SPID test IdP configured
SPID_CALLBACK_URL="http://localhost:3000/api/v1/auth/spid/callback"

# RENTRI (use sandbox)
RENTRI_API_URL="https://rentri-test.mase.gov.it/api/v1"
RENTRI_CLIENT_ID="your-client-id"  # Request from RENTRI
RENTRI_CLIENT_SECRET="your-client-secret"

# AWS (local development uses local file storage)
AWS_REGION="eu-west-1"
AWS_S3_BUCKET="wasteflow-dev-uploads"
USE_LOCAL_STORAGE=true  # Skip S3 for local dev

# Email (use console logger for local dev)
EMAIL_PROVIDER="console"  # Set "ses" for production

# Logging
LOG_LEVEL="debug"
```

### 4. Database Migrations

```bash
cd apps/backend

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate dev --name init

# Seed database with CER catalog + test data
npm run prisma:seed
```

Expected seed data:
- 900+ CER codes from ISPRA catalog
- 2 test tenants (Acme Industries, Eco Transport)
- 5 test users with roles
- 10 sample FIR documents

### 5. Run Backend

```bash
# Development mode (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

Verify backend:
```bash
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"...","service":"wasteflow-backend"}
```

### 6. Run Frontend

```bash
cd apps/frontend

# Development server
npm run start
# Open http://localhost:4200
```

## Test SPID Authentication (Optional)

To test SPID login locally, use SPID Validator (test IdP):

```bash
# 1. Register your SP metadata at https://validator.spid.gov.it
# 2. Download SPID test IdP metadata
curl https://validator.spid.gov.it/metadata.xml > apps/backend/certs/spid-test-idp-metadata.xml

# 3. Generate SP key pair
cd apps/backend/certs
openssl req -x509 -newkey rsa:2048 -keyout sp-private-key.pem -out sp-public-cert.pem -days 365 -nodes

# 4. Update .env
SPID_ENABLED=true
SPID_IDP_METADATA_PATH="./certs/spid-test-idp-metadata.xml"
SPID_SP_PRIVATE_KEY_PATH="./certs/sp-private-key.pem"
SPID_SP_PUBLIC_CERT_PATH="./certs/sp-public-cert.pem"

# 5. Restart backend and test login at http://localhost:4200/login
```

Test credentials (SPID Validator):
- Username: `validator`
- Password: `validator`
- Fiscal Code: `VLDVLD80A01H501U`

## Test RENTRI Integration (Optional)

Request sandbox credentials from RENTRI:

```bash
# 1. Send PEC email to rentri@pec.mase.gov.it requesting sandbox access
# Subject: "Richiesta accesso sandbox RENTRI - WasteFlow"

# 2. Receive client_id and client_secret

# 3. Update .env
RENTRI_CLIENT_ID="your-sandbox-client-id"
RENTRI_CLIENT_SECRET="your-sandbox-secret"

# 4. Test sync
curl -X POST http://localhost:3000/api/v1/rentri-sync/fir/<fir-id> \
  -H "Authorization: Bearer <your-jwt-token>"
```

## Troubleshooting

### PostgreSQL Connection Error

```bash
# Check PostgreSQL is running
pg_isready

# Check connection string
psql "postgresql://wasteflow_user:dev_password_123@localhost:5432/wasteflow_dev"
```

### Redis Connection Error

```bash
# Check Redis is running
redis-cli ping
# Expected: PONG
```

### Prisma Migration Errors

```bash
# Reset database (⚠ deletes all data)
npm run prisma:migrate reset

# Check migration status
npm run prisma:migrate status
```

### Port Already in Use

```bash
# Backend (port 3000)
lsof -ti:3000 | xargs kill -9

# Frontend (port 4200)
lsof -ti:4200 | xargs kill -9
```

## Next Steps

- **API Documentation**: http://localhost:3000/api/docs (Swagger UI)
- **Create Test FIR**: POST http://localhost:3000/api/v1/fir (see contracts/README.md)
- **Run Tests**: `npm run test` (unit) or `npm run test:e2e` (E2E)
- **Configure SPID**: Follow SPID integration guide
- **Configure RENTRI**: Request sandbox credentials

## Development Workflow

```bash
# Backend TDD workflow
cd apps/backend
npm run test:watch  # Runs tests on file change

# Frontend development
cd apps/frontend
npm run start  # Hot reload on file change

# Run linter
npm run lint

# Format code
npm run format
```

## Production Deployment

See `PRODUCTION_DEPLOYMENT.md` for AWS ECS deployment instructions.