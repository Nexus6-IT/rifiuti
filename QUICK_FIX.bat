@echo off
REM Quick Fix per Keycloak Database Issue
REM Ferma tutto, rimuove volumi, e riavvia con database puliti

echo ╔════════════════════════════════════════════════════╗
echo ║  WasteFlow - Quick Fix Keycloak Database          ║
echo ╚════════════════════════════════════════════════════╝
echo.

echo ⚠️  ATTENZIONE: Questa operazione cancellerà tutti i dati!
echo.
echo Cosa farà questo script:
echo   1. Fermerà tutti i container Docker
echo   2. Rimuoverà tutti i volumi (database incluso)
echo   3. Riavvierà tutto con database puliti
echo.
echo I database saranno ricreati automaticamente da zero.
echo.
set /p CONFIRM="Continuare? (s/n): "

if /i not "%CONFIRM%"=="s" (
    echo Operazione annullata.
    exit /b 0
)

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 1. Fermando tutti i container...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose down

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 2. Rimuovendo volumi (database)...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose down -v

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 3. Riavviando con database puliti...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose up -d

echo.
echo Attendere che i servizi siano pronti...
timeout /t 5 /nobreak >nul

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 4. Verificando database creati...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM Wait for PostgreSQL to be ready
:wait_postgres
docker-compose exec -T postgres pg_isready -U wasteflow >nul 2>&1
if errorlevel 1 (
    echo   Attendere PostgreSQL...
    timeout /t 2 /nobreak >nul
    goto wait_postgres
)

echo   ✓ PostgreSQL pronto
echo.
echo   Database disponibili:
docker-compose exec -T postgres psql -U wasteflow -d wasteflow_dev -c "\l" | findstr "wasteflow_dev keycloak"

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 5. Verificando Keycloak...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

echo   Attendere Keycloak (30-60 secondi)...
:wait_keycloak
curl -s http://localhost:8080/health/ready >nul 2>&1
if errorlevel 1 (
    timeout /t 3 /nobreak >nul
    goto wait_keycloak
)

echo   ✓ Keycloak pronto
echo.

echo ╔════════════════════════════════════════════════════╗
echo ║  ✅ Fix Completato!                                ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo Servizi disponibili:
echo   🗄️  PostgreSQL:       http://localhost:5432
echo   🔐 Keycloak:          http://localhost:8080 (admin/admin)
echo   📧 MailHog:           http://localhost:8025
echo   🔧 pgAdmin:           http://localhost:5050
echo.
echo Prossimi passi:
echo   1. cd apps\backend
echo   2. npm install
echo   3. npx prisma generate
echo   4. npx prisma migrate dev
echo.
echo Oppure esegui: scripts\dev-start.bat
echo.

pause
