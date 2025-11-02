-- Enable pg_trgm extension for trigram text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('SPID', 'CIE', 'LOCAL');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER', 'CONSULTANT_ADMIN', 'MOBILE_OPERATOR');

-- CreateEnum
CREATE TYPE "FIRStato" AS ENUM ('BOZZA', 'EMESSO', 'IN_TRANSITO', 'CONSEGNATO', 'ANNULLATO');

-- CreateEnum
CREATE TYPE "RegistryType" AS ENUM ('CARICO', 'SCARICO');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fiscalNumber" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'SPID',
    "spidLevel" TEXT,
    "defaultTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fiscalNumber" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "pec" TEXT,
    "via" TEXT,
    "civico" TEXT,
    "address" TEXT,
    "city" TEXT,
    "province" TEXT,
    "cap" TEXT,
    "numeroIscrizione" TEXT,
    "numeroAutorizzazione" TEXT,
    "rentriRegistrationNumber" TEXT,
    "rentriRegisteredAt" TIMESTAMP(3),
    "isProducer" BOOLEAN NOT NULL DEFAULT true,
    "isTransporter" BOOLEAN NOT NULL DEFAULT false,
    "isTreatmentFacility" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tenants" (
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tenants_pkey" PRIMARY KEY ("userId","tenantId")
);

-- CreateTable
CREATE TABLE "cer_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isPericoloso" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cer_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firs" (
    "id" TEXT NOT NULL,
    "numeroProgressivo" TEXT,
    "anno" INTEGER NOT NULL DEFAULT 2025,
    "stato" "FIRStato" NOT NULL DEFAULT 'BOZZA',
    "produttoreId" TEXT NOT NULL,
    "produttoreAddress" TEXT,
    "cerCodeId" TEXT NOT NULL,
    "quantitaDichiarata" DOUBLE PRECISION NOT NULL,
    "unitaMisura" TEXT NOT NULL DEFAULT 'kg',
    "statoFisico" TEXT,
    "caratteristichePericolo" TEXT,
    "trasportatoreId" TEXT NOT NULL,
    "dataPresaCarico" TIMESTAMP(3),
    "targaMezzo" TEXT,
    "numeroColli" INTEGER,
    "destinatarioId" TEXT NOT NULL,
    "dataConsegna" TIMESTAMP(3),
    "pesoEffettivo" DOUBLE PRECISION,
    "operazioneDestino" TEXT,
    "firme" JSONB,
    "allegati" JSONB,
    "statoSincronizzazioneRENTRI" TEXT NOT NULL DEFAULT 'PENDING',
    "erroreRENTRI" TEXT,
    "ultimaSincronizzazione" TIMESTAMP(3),
    "domainEvents" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registry_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "RegistryType" NOT NULL,
    "anno" INTEGER NOT NULL DEFAULT 2025,
    "progressivo" INTEGER NOT NULL,
    "dataMovimento" TIMESTAMP(3) NOT NULL,
    "oraMovimento" TEXT,
    "cerCodeId" TEXT NOT NULL,
    "quantita" DOUBLE PRECISION NOT NULL,
    "unitaMisura" TEXT NOT NULL DEFAULT 'kg',
    "firNumero" TEXT,
    "firData" TIMESTAMP(3),
    "origine" TEXT,
    "destinazione" TEXT,
    "note" TEXT,
    "statoSincronizzazioneRENTRI" TEXT NOT NULL DEFAULT 'PENDING',
    "erroreRENTRI" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registry_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_fiscalNumber_key" ON "users"("fiscalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_fiscalNumber_key" ON "tenants"("fiscalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_rentriRegistrationNumber_key" ON "tenants"("rentriRegistrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "cer_codes_code_key" ON "cer_codes"("code");

-- CreateIndex
CREATE INDEX "cer_codes_code_idx" ON "cer_codes"("code");

-- CreateIndex
CREATE INDEX "cer_codes_description_idx" ON "cer_codes" USING GIN ("description" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "firs_numeroProgressivo_key" ON "firs"("numeroProgressivo");

-- CreateIndex
CREATE INDEX "firs_produttoreId_stato_idx" ON "firs"("produttoreId", "stato");

-- CreateIndex
CREATE INDEX "firs_numeroProgressivo_idx" ON "firs"("numeroProgressivo");

-- CreateIndex
CREATE INDEX "firs_stato_idx" ON "firs"("stato");

-- CreateIndex
CREATE INDEX "registry_entries_tenantId_dataMovimento_idx" ON "registry_entries"("tenantId", "dataMovimento");

-- CreateIndex
CREATE INDEX "registry_entries_cerCodeId_idx" ON "registry_entries"("cerCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "registry_entries_tenantId_anno_progressivo_type_key" ON "registry_entries"("tenantId", "anno", "progressivo", "type");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_timestamp_idx" ON "audit_logs"("tenantId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_timestamp_idx" ON "audit_logs"("userId", "timestamp");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultTenantId_fkey" FOREIGN KEY ("defaultTenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenants" ADD CONSTRAINT "user_tenants_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_produttoreId_fkey" FOREIGN KEY ("produttoreId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_cerCodeId_fkey" FOREIGN KEY ("cerCodeId") REFERENCES "cer_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_trasportatoreId_fkey" FOREIGN KEY ("trasportatoreId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firs" ADD CONSTRAINT "firs_destinatarioId_fkey" FOREIGN KEY ("destinatarioId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_entries" ADD CONSTRAINT "registry_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry_entries" ADD CONSTRAINT "registry_entries_cerCodeId_fkey" FOREIGN KEY ("cerCodeId") REFERENCES "cer_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
