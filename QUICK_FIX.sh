#!/bin/bash

# Quick Fix per Keycloak Database Issue
# Ferma tutto, rimuove volumi, e riavvia con database puliti

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════╗"
echo "║  WasteFlow - Quick Fix Keycloak Database          ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

echo -e "${RED}⚠️  ATTENZIONE: Questa operazione cancellerà tutti i dati!${NC}"
echo ""
echo "Cosa farà questo script:"
echo "  1. Fermerà tutti i container Docker"
echo "  2. Rimuoverà tutti i volumi (database incluso)"
echo "  3. Riavvierà tutto con database puliti"
echo ""
echo "I database saranno ricreati automaticamente da zero."
echo ""
read -p "Continuare? (s/n): " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Ss]$ ]]; then
    echo "Operazione annullata."
    exit 0
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Fermando tutti i container..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose down

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Rimuovendo volumi (database)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose down -v

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Riavviando con database puliti..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose up -d

echo ""
echo "Attendere che i servizi siano pronti..."
sleep 5

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. Verificando database creati..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Wait for PostgreSQL to be ready
echo -n "  Attendere PostgreSQL..."
until docker-compose exec -T postgres pg_isready -U wasteflow > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✓${NC}"

echo ""
echo "  Database disponibili:"
docker-compose exec -T postgres psql -U wasteflow -d wasteflow_dev -c "\l" | grep -E "wasteflow_dev|keycloak"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. Verificando Keycloak..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -n "  Attendere Keycloak (30-60 secondi)..."
until curl -s http://localhost:8080/health/ready > /dev/null 2>&1; do
    echo -n "."
    sleep 3
done
echo -e " ${GREEN}✓${NC}"

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  ✅ Fix Completato!                                ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "Servizi disponibili:"
echo "  🗄️  PostgreSQL:       http://localhost:5432"
echo "  🔐 Keycloak:          http://localhost:8080 (admin/admin)"
echo "  📧 MailHog:           http://localhost:8025"
echo "  🔧 pgAdmin:           http://localhost:5050"
echo ""
echo "Prossimi passi:"
echo "  1. cd apps/backend"
echo "  2. npm install"
echo "  3. npx prisma generate"
echo "  4. npx prisma migrate dev"
echo ""
echo "Oppure esegui: ./scripts/dev-start.sh"
echo ""
