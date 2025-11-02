@echo off
REM WasteFlow - Development Quick Start Script (Windows)
REM Starts all services and initializes the database

echo ╔════════════════════════════════════════════════════╗
echo ║  WasteFlow - Development Environment Setup         ║
echo ╚════════════════════════════════════════════════════╝
echo.

REM Check if .env exists
if not exist .env (
    echo ⚠ .env file not found. Creating from .env.example...
    copy .env.example .env
    echo ✓ .env file created. Please review and update values if needed.
)

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo ✗ Docker is not running. Please start Docker Desktop.
    exit /b 1
)

echo ✓ Docker is running
echo.

REM Check if postgres volume exists (first run needs clean start)
docker volume inspect wasteflow_postgres_data >nul 2>&1
if errorlevel 1 (
    echo   First run detected - will create fresh databases
    set FIRST_RUN=1
) else (
    echo   Existing data detected - will reuse databases
    set FIRST_RUN=0
)

REM Start infrastructure services
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 1. Starting infrastructure services...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM Clean start if first run
if %FIRST_RUN%==1 (
    echo   Cleaning old containers and volumes...
    docker-compose down -v >nul 2>&1
)

docker-compose up -d

echo.
echo Waiting for services to be ready...

REM Wait for PostgreSQL
echo   Waiting for PostgreSQL...
:wait_postgres
docker-compose exec -T postgres pg_isready -U wasteflow >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_postgres
)
echo   ✓ PostgreSQL ready

REM Wait for Redis
echo   Waiting for Redis...
:wait_redis
docker-compose exec -T redis redis-cli ping >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto wait_redis
)
echo   ✓ Redis ready

REM Wait for Keycloak
echo   Waiting for Keycloak (this may take 30-60 seconds)...
:wait_keycloak
curl -s http://localhost:8080/health/ready >nul 2>&1
if errorlevel 1 (
    timeout /t 2 /nobreak >nul
    goto wait_keycloak
)
echo   ✓ Keycloak ready

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 2. Setting up backend...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM Check if node_modules exists
if not exist apps\backend\node_modules (
    echo   Installing backend dependencies...
    cd apps\backend
    call npm install
    cd ..\..
    echo   ✓ Dependencies installed
) else (
    echo   ✓ Dependencies already installed
)

REM Generate Prisma Client
echo   Generating Prisma Client...
cd apps\backend
call npx prisma generate
echo   ✓ Prisma Client generated

REM Run migrations
echo   Running database migrations...
call npx prisma migrate dev --name init
echo   ✓ Migrations applied

REM Seed database
echo   Seeding database...
if exist prisma\seed.ts (
    call npx prisma db seed
) else (
    echo   ⚠ No seed script found (prisma/seed.ts)
)

cd ..\..

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 3. Setting up frontend...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM Check if node_modules exists
if not exist apps\frontend\node_modules (
    echo   Installing frontend dependencies...
    cd apps\frontend
    call npm install
    cd ..\..
    echo   ✓ Dependencies installed
) else (
    echo   ✓ Dependencies already installed
)

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  🚀 Setup Complete!                                ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo Services running:
echo   🗄️  PostgreSQL:       http://localhost:5432
echo   🔴 Redis:             http://localhost:6379
echo   🔐 Keycloak:          http://localhost:8080 (admin/admin)
echo   📧 MailHog:           http://localhost:8025
echo   🔧 pgAdmin:           http://localhost:5050 (admin@wasteflow.local/admin)
echo.
echo To start the application:
echo   Backend:  cd apps\backend ^&^& npm run start:dev
echo   Frontend: cd apps\frontend ^&^& npm start
echo.
echo To stop infrastructure:
echo   docker-compose down
echo.
echo View logs:
echo   docker-compose logs -f
echo.

pause
