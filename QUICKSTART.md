# 🚀 QuickStart Guide - WasteFlow

## Setup in 5 minuti

### 1. Prerequisites Check

```bash
node --version   # Must be >= 20.0.0
npm --version    # Must be >= 10.0.0
psql --version   # Must be >= 16.0
```

Se mancano, installa:
- Node.js: https://nodejs.org/
- PostgreSQL: https://www.postgresql.org/download/

### 2. Clone & Install

```bash
git clone <repository-url>
cd rifiuti
npm install
cd apps/backend && npm install
```

### 3. Database Setup

```bash
# Create database
createdb wasteflow_dev

# Configure environment
cd apps/backend
cp .env.example .env

# Edit .env with your database URL:
# DATABASE_URL="postgresql://postgres:password@localhost:5432/wasteflow_dev?schema=public"

# Generate Prisma Client & Run migrations
npm run prisma:generate
npm run prisma:migrate
```

### 4. Run Application

```bash
# Terminal 1: Backend (port 3000)
cd apps/backend
npm run start:dev

# Terminal 2: Run tests (TDD watch mode)
npm run test:watch
```

### 5. Verify Setup

```bash
# Health check
curl http://localhost:3000/health

# Response:
# {"status":"ok","timestamp":"2025-10-13T...","service":"wasteflow-backend"}

# Swagger API Docs
open http://localhost:3000/api/docs
```

## 🧪 Run Tests

```bash
# All tests
npm test

# Watch mode (for TDD)
npm run test:watch

# Coverage report
npm run test:cov

# Should see:
# ✓ Email Value Object (8 tests)
# ✓ User Entity (11 tests)
# ✓ Quantita Value Object (9 tests)
# ✓ FIR Aggregate (25+ tests)
# ✓ Health Controller (2 tests)
#
# Test Suites: 6 passed, 6 total
# Tests:       55+ passed, 55+ total
# Coverage:    82%+ lines, 78%+ branches
```

## 📝 Next Steps

1. **Explore Domain Models**:
   - `src/domain/auth/entities/user.entity.ts` - User aggregate
   - `src/domain/fir/aggregates/fir.aggregate.ts` - FIR aggregate
   - Read tests (`.spec.ts`) to understand business rules

2. **Read Documentation**:
   - `README.md` - Full documentation
   - `documentazione/` - Analisi, requisiti, architettura

3. **Start Developing** (TDD workflow):
   ```bash
   # 1. Write failing test
   npm run test:watch

   # 2. Implement minimum code to pass
   # 3. Refactor
   # 4. Commit with tests
   git commit -m "feat: implement feature X with TDD"
   ```

4. **Contribute**:
   - Read `README.md` Contributing section
   - Follow TDD mandatory approach
   - Coverage must stay >= 80%

## 🐛 Troubleshooting

### Database connection error

```bash
# Check PostgreSQL is running
pg_isready

# Check database exists
psql -l | grep wasteflow

# Recreate if needed
dropdb wasteflow_dev
createdb wasteflow_dev
npm run prisma:migrate
```

### Prisma Client not found

```bash
cd apps/backend
npm run prisma:generate
```

### Port 3000 already in use

```bash
# Change port in .env
PORT=3001

# Or kill existing process
lsof -ti:3000 | xargs kill
```

## 📚 Resources

- **Full README**: [README.md](./README.md)
- **Architecture**: [documentazione/04_architettura_sistema.md](./documentazione/04_architettura_sistema.md)
- **Implementation Plan**: [documentazione/05_piano_implementazione.md](./documentazione/05_piano_implementazione.md)
- **API Docs**: http://localhost:3000/api/docs

---

**Happy Coding with TDD! 🧪✨**
