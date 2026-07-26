-- R2 Task 3: vincolo di unicità (tenantId, rentriNumeroFir) su "firs".
--
-- Sostituisce l'indice non-unico esistente con un vincolo di unicità: due FIR
-- locali dello stesso tenant non possono più puntare allo stesso numero_fir
-- RENTRI (in PostgreSQL un indice unique tratta i NULL come distinti fra
-- loro, quindi i FIR non ancora legati, rentriNumeroFir = null, non
-- collidono mai).
--
-- Verificato prima di applicare (2026-07-26): nessun duplicato esistente su
-- (tenant_id, rentri_numero_fir) nell'ambiente disponibile per questo task
-- (vedi report — DB di test dedicato, privo di dati reali). Da rieseguire la
-- stessa query di controllo contro il database di produzione prima del
-- deploy, dove esistono dati reali che questo ambiente non ha.
--
-- NOTA: `prisma migrate diff` ha prodotto qui anche modifiche estranee a
-- questo task (drop di indici legacy su tenants, ALTER COLUMN su
-- notifications/autorizzazioni_impianto/waste_movements, rename di indice su
-- waste_movements): drift preesistente tra il database di sviluppo e lo
-- schema versionato, non causato da questa modifica. Rimosso da questo file
-- e segnalato nel report, non applicato qui.

-- DropIndex
DROP INDEX "firs_tenant_id_rentri_numero_fir_idx";

-- CreateIndex
CREATE UNIQUE INDEX "firs_tenant_id_rentri_numero_fir_key" ON "firs"("tenant_id", "rentri_numero_fir");
