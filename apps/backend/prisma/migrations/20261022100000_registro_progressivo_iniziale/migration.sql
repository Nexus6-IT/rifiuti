-- Progressivo iniziale del registro per azienda e anno (decisione C-W-02).
-- Additiva: una tabella nuova, nessuna colonna o riga esistente toccata. Chi arriva da
-- un altro programma a meta' anno imposta qui il primo numero, che il primo movimento
-- dell'anno prende al posto di 1.
CREATE TABLE "registro_progressivi_iniziali" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "anno" INTEGER NOT NULL,
    "primo_progressivo" INTEGER NOT NULL,
    "motivo" VARCHAR(500) NOT NULL,
    "impostato_da" UUID NOT NULL,
    "impostato_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_progressivi_iniziali_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "registro_progressivi_iniziali_primo_progressivo_check" CHECK ("primo_progressivo" >= 1)
);

-- Un solo progressivo iniziale per azienda e anno.
CREATE UNIQUE INDEX "registro_progressivi_iniziali_tenant_id_anno_key" ON "registro_progressivi_iniziali"("tenant_id", "anno");

ALTER TABLE "registro_progressivi_iniziali" ADD CONSTRAINT "registro_progressivi_iniziali_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
