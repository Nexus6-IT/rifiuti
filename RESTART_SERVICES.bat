@echo off
REM Quick Restart dopo fix script SQL

echo ╔════════════════════════════════════════════════════╗
echo ║  WasteFlow - Restart Services                     ║
echo ╚════════════════════════════════════════════════════╝
echo.

echo Script SQL aggiornato per compatibilità Windows.
echo.
echo Azioni:
echo   1. Fermare container
echo   2. Rimuovere volumi database
echo   3. Riavviare tutto con script SQL
echo.

cd C:\Progetti\rifiuti

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 1. Fermando container...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose down

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 2. Rimuovendo volumi...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose down -v

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 3. Riavviando (script SQL verrà eseguito)...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose up -d

echo.
echo ⏳ Attendere inizializzazione servizi (30 secondi)...
timeout /t 30 /nobreak >nul

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 4. Verificando database creati...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

docker-compose exec -T postgres psql -U wasteflow -d wasteflow_dev -c "\l"

echo.
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 5. Verificando Keycloak...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docker-compose logs keycloak | findstr "started server"

echo.
echo ╔════════════════════════════════════════════════════╗
echo ║  ✅ Servizi riavviati!                             ║
echo ╚════════════════════════════════════════════════════╝
echo.
echo Verifica manualmente:
echo   - Keycloak: http://localhost:8080 (admin/admin)
echo   - Logs: docker-compose logs -f keycloak
echo.

pause
