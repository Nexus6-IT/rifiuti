#!/bin/bash

# WasteFlow - Development Quick Start Script
# Starts all services and initializes the database

set -e

echo "╔════════════════════════════════════════════════════╗"
echo "║  WasteFlow - Development Environment Setup        ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠ .env file not found. Creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created. Please review and update values if needed.${NC}"
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not running. Please start Docker Desktop.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"
echo ""

# Start infrastructure services
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. Starting infrastructure services..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker-compose up -d

echo ""
echo -e "${YELLOW}Waiting for services to be ready...${NC}"

# Wait for PostgreSQL
echo -n "  Waiting for PostgreSQL..."
until docker-compose exec -T postgres pg_isready -U wasteflow > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Wait for Redis
echo -n "  Waiting for Redis..."
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    echo -n "."
    sleep 1
done
echo -e " ${GREEN}✓${NC}"

# Wait for Keycloak
echo -n "  Waiting for Keycloak..."
until curl -s http://localhost:8080/health/ready > /dev/null 2>&1; do
    echo -n "."
    sleep 2
done
echo -e " ${GREEN}✓${NC}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. Setting up backend..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if node_modules exists
if [ ! -d "apps/backend/node_modules" ]; then
    echo "  Installing backend dependencies..."
    cd apps/backend
    npm install
    cd ../..
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

# Generate Prisma Client
echo "  Generating Prisma Client..."
cd apps/backend
npx prisma generate
echo -e "${GREEN}✓ Prisma Client generated${NC}"

# Run migrations
echo "  Running database migrations..."
npx prisma migrate dev --name init
echo -e "${GREEN}✓ Migrations applied${NC}"

# Seed database
echo "  Seeding database..."
if [ -f "prisma/seed.ts" ]; then
    npx prisma db seed || echo -e "${YELLOW}⚠ Seed script not found or failed${NC}"
else
    echo -e "${YELLOW}⚠ No seed script found (prisma/seed.ts)${NC}"
fi

cd ../..

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. Setting up frontend..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if node_modules exists
if [ ! -d "apps/frontend/node_modules" ]; then
    echo "  Installing frontend dependencies..."
    cd apps/frontend
    npm install
    cd ../..
    echo -e "${GREEN}✓ Dependencies installed${NC}"
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  🚀 Setup Complete!                                ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
echo "Services running:"
echo "  🗄️  PostgreSQL:       http://localhost:5432"
echo "  🔴 Redis:             http://localhost:6379"
echo "  🔐 Keycloak:          http://localhost:8080 (admin/admin)"
echo "  📧 MailHog:           http://localhost:8025"
echo "  🔧 pgAdmin:           http://localhost:5050 (admin@wasteflow.local/admin)"
echo ""
echo "To start the application:"
echo "  Backend:  cd apps/backend && npm run start:dev"
echo "  Frontend: cd apps/frontend && npm start"
echo ""
echo "Or use:"
echo "  npm run dev (if configured in root package.json)"
echo ""
echo "To stop infrastructure:"
echo "  docker-compose down"
echo ""
echo "View logs:"
echo "  docker-compose logs -f"
echo ""
