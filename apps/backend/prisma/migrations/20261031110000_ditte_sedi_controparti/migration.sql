-- Fase 2 pezzo 10 (F2-10), Task 1: ditte e sedi delle controparti, con migrazione delle anagrafiche
-- esistenti (D5 e D16 del piano `2026-10-28-fase2-10-controparti`).
--
-- Cosa fa, in quest'ordine (un solo script, transazionale: un RAISE EXCEPTION annulla tutto):
--   1. crea `ditte` (identita' fiscale: partita IVA e/o codice fiscale, ragione sociale) con i
--      CHECK di forma (il checksum NON sta nel database: lo applica l'applicazione quando un
--      identificativo viene impostato) e `sedi_ditte` (indirizzo, contatti, principale, attiva),
--      con l'indice unico parziale `sedi_ditte_una_principale` (al piu' una principale per ditta);
--   2. aggiunge `ditta_id` e `sede_id` (NULL per ora) a `produttori`, `trasportatori`,
--      `destinatari`: le righe di ruolo restano con GLI STESSI id (legame di FIR e contratti, che
--      non hanno chiavi esterne verso le anagrafiche) e le colonne di oggi non cambiano;
--   3. crea la funzione idempotente `f210_collega_anagrafiche()` e la chiama. Lavora SOLO sulle
--      righe di ruolo con `ditta_id` NULL: raggruppa per (azienda, partita IVA) e riusa ditta e
--      sede esistenti, crea quelle mancanti. La stessa P.IVA in piu' ruoli della stessa azienda
--      diventa UNA ditta con piu' ruoli (mai fra aziende diverse). La rilancia la migration
--      `20261031110100_anagrafiche_su_ditte` (Task 3b-2) per completare le righe create dal
--      backend vecchio fra questa migration e l'avvio del nuovo, e poi la elimina;
--   4. chiavi esterne composte (la sede e' della stessa ditta e dello stesso tenant, imposto dal
--      database), unici (tenant_id, ditta_id) per ruolo, indici su `sede_id`;
--   5. RLS ENABLE + FORCE e le policy `isolamento_azienda` e `sola_lettura` in FONDO, dopo il
--      backfill (stessa forma di `20261027100000_registro_per_sede`).
--
-- Precondizione fail-closed: una partita IVA (dopo btrim) che non sia di 11 cifre ferma la
-- migration con i SOLI conteggi per tabella (mai i valori). Il censimento che la verifica prima del
-- merge sta in `ops/README.md` (voce "F2-10 controparti").
--
-- Ruolo che esegue la migration: con FORCE ROW LEVEL SECURITY il proprietario NON e' esente, solo
-- un superuser o un ruolo con BYPASSRLS. In produzione e nel database di test il ruolo e'
-- `wasteflow` (rolsuper = true, rolbypassrls = true): il backfill vede tutte le righe. Nessun
-- GRANT qui: `wasteflow_app` e `wasteflow_sistema` li ricevono dai default privileges di
-- `ops/db-ruoli.sh` (prisma/sql/ruoli-db.sql).
--
-- Ripristino a mano (la migration e' additiva): DROP FUNCTION f210_collega_anagrafiche();
-- per ciascuna tabella di ruolo DROP delle FK (`<tabella>_ditta_fkey`, `<tabella>_sede_fkey`),
-- degli indici (`<tabella>_tenant_id_ditta_id_key`, `<tabella>_sede_id_idx`) e delle colonne
-- `ditta_id`/`sede_id`; poi DROP TABLE sedi_ditte; DROP TABLE ditte.
-- Ripristino da migration fallita (P3009): la migration e' transazionale, quindi si controlla che
-- `SELECT to_regclass('public.ditte')` sia NULL, si corregge il dato e si lancia
-- `npx prisma migrate resolve --rolled-back 20261031110000_ditte_sedi_controparti`, poi si rilancia
-- il deploy (vedi `ops/README.md`).

-- 1. Tabelle ---------------------------------------------------------------------------------

CREATE TABLE "ditte" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "ragione_sociale" VARCHAR(255) NOT NULL,
  "partita_iva" VARCHAR(11),
  "codice_fiscale" VARCHAR(16),
  CONSTRAINT "ditte_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ditte_identificativo_presente" CHECK ("partita_iva" IS NOT NULL OR "codice_fiscale" IS NOT NULL),
  CONSTRAINT "ditte_partita_iva_forma" CHECK ("partita_iva" IS NULL OR "partita_iva" ~ '^[0-9]{11}$'),
  CONSTRAINT "ditte_codice_fiscale_forma" CHECK ("codice_fiscale" IS NULL OR "codice_fiscale" ~ '^([A-Z0-9]{16}|[0-9]{11})$'),
  CONSTRAINT "ditte_ragione_sociale_non_vuota" CHECK (btrim("ragione_sociale") <> '')
);

CREATE TABLE "sedi_ditte" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "ditta_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "denominazione" VARCHAR(255),
  "via" VARCHAR(255) NOT NULL,
  "civico" VARCHAR(20) NOT NULL,
  "cap" VARCHAR(5) NOT NULL,
  "comune" VARCHAR(100) NOT NULL,
  "provincia" VARCHAR(2) NOT NULL,
  "referente" VARCHAR(255),
  "email" VARCHAR(255),
  "telefono" VARCHAR(20),
  "pec" VARCHAR(255),
  "principale" BOOLEAN NOT NULL DEFAULT false,
  "attiva" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "sedi_ditte_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sedi_ditte_principale_attiva" CHECK (NOT "principale" OR "attiva")
);

CREATE UNIQUE INDEX "ditte_id_tenant_id_key" ON "ditte"("id", "tenant_id");
CREATE UNIQUE INDEX "ditte_tenant_id_partita_iva_key" ON "ditte"("tenant_id", "partita_iva");
CREATE UNIQUE INDEX "ditte_tenant_id_codice_fiscale_key" ON "ditte"("tenant_id", "codice_fiscale");
CREATE INDEX "ditte_tenant_id_idx" ON "ditte"("tenant_id");

CREATE UNIQUE INDEX "sedi_ditte_id_tenant_id_key" ON "sedi_ditte"("id", "tenant_id");
CREATE UNIQUE INDEX "sedi_ditte_id_ditta_id_tenant_id_key" ON "sedi_ditte"("id", "ditta_id", "tenant_id");
CREATE INDEX "sedi_ditte_tenant_id_idx" ON "sedi_ditte"("tenant_id");
CREATE INDEX "sedi_ditte_ditta_id_idx" ON "sedi_ditte"("ditta_id");
-- Al piu' una sede principale per ditta ("almeno una" la garantisce l'applicazione). Solo SQL:
-- Prisma non esprime gli indici parziali (come `registri_rifiuti_uno_senza_sede_per_tenant`).
CREATE UNIQUE INDEX "sedi_ditte_una_principale" ON "sedi_ditte"("ditta_id") WHERE "principale";

ALTER TABLE "ditte" ADD CONSTRAINT "ditte_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sedi_ditte" ADD CONSTRAINT "sedi_ditte_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sedi_ditte" ADD CONSTRAINT "sedi_ditte_ditta_fkey"
  FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Colonne sulle righe di ruolo (NULL fino al backfill) -------------------------------------

ALTER TABLE "produttori" ADD COLUMN "ditta_id" UUID, ADD COLUMN "sede_id" UUID;
ALTER TABLE "trasportatori" ADD COLUMN "ditta_id" UUID, ADD COLUMN "sede_id" UUID;
ALTER TABLE "destinatari" ADD COLUMN "ditta_id" UUID, ADD COLUMN "sede_id" UUID;

-- 3. Backfill idempotente ---------------------------------------------------------------------

CREATE FUNCTION f210_collega_anagrafiche() RETURNS void
LANGUAGE plpgsql
AS $f210$
DECLARE
  v_np int;
  v_nt int;
  v_nd int;
  v_righe int;
  v_ditte_nuove int;
  v_sedi_nuove int;
  v_ditte_toccate int;
BEGIN
  -- Tabella di lavoro esplicita (niente ON COMMIT DROP: la funzione puo' essere chiamata piu'
  -- volte nella stessa transazione) e rimossa in fondo.
  DROP TABLE IF EXISTS _f210_anagrafiche;
  CREATE TEMP TABLE _f210_anagrafiche AS
    SELECT 'P'::text AS ruolo, 1 AS priorita, id, tenant_id, btrim(partita_iva) AS piva,
           ragione_sociale, via, civico, cap, comune, provincia, email, telefono, pec,
           created_at, updated_at
      FROM produttori WHERE ditta_id IS NULL
    UNION ALL
    SELECT 'D', 2, id, tenant_id, btrim(partita_iva),
           ragione_sociale, via, civico, cap, comune, provincia, email, telefono, pec,
           created_at, updated_at
      FROM destinatari WHERE ditta_id IS NULL
    UNION ALL
    SELECT 'T', 3, id, tenant_id, btrim(partita_iva),
           ragione_sociale, via, civico, cap, comune, provincia, email, telefono, pec,
           created_at, updated_at
      FROM trasportatori WHERE ditta_id IS NULL;

  -- D5.1: precondizione fail-closed, SOLO conteggi (mai i valori).
  SELECT count(*) FILTER (WHERE ruolo = 'P'), count(*) FILTER (WHERE ruolo = 'T'),
         count(*) FILTER (WHERE ruolo = 'D')
    INTO v_np, v_nt, v_nd
    FROM _f210_anagrafiche WHERE piva !~ '^[0-9]{11}$';
  IF v_np + v_nt + v_nd > 0 THEN
    RAISE EXCEPTION 'F2-10: partite IVA non di 11 cifre (produttori: %, trasportatori: %, destinatari: %). Correggere i dati a mano e rilanciare; i valori non sono riportati.',
      v_np, v_nt, v_nd;
  END IF;

  ALTER TABLE _f210_anagrafiche
    ADD COLUMN chiave text,
    ADD COLUMN ditta_id uuid,
    ADD COLUMN ditta_esistente boolean,
    ADD COLUMN scelta boolean;

  -- D5.4: chiave d'indirizzo = lower + spazi compressi di via, civico, comune, piu' btrim(cap) e
  -- upper(btrim(provincia)).
  UPDATE _f210_anagrafiche SET chiave =
    lower(regexp_replace(btrim(via), '\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(btrim(civico), '\s+', ' ', 'g')) || '|' ||
    lower(regexp_replace(btrim(comune), '\s+', ' ', 'g')) || '|' ||
    btrim(cap) || '|' || upper(btrim(provincia));

  UPDATE _f210_anagrafiche a SET ditta_esistente = EXISTS (
    SELECT 1 FROM ditte d WHERE d.tenant_id = a.tenant_id AND d.partita_iva = a.piva);

  -- D5.3: la riga "scelta" di ogni (azienda, P.IVA) e' la piu' recente (a parita': produttore,
  -- destinatario, trasportatore, poi id).
  UPDATE _f210_anagrafiche a SET scelta = (a.id = s.id)
    FROM (
      SELECT DISTINCT ON (tenant_id, piva) tenant_id, piva, id
        FROM _f210_anagrafiche
       ORDER BY tenant_id, piva, updated_at DESC, priorita, id
    ) s
   WHERE s.tenant_id = a.tenant_id AND s.piva = a.piva;

  -- Ditte mancanti: ragione sociale della riga scelta, created_at = minimo, updated_at = massimo.
  INSERT INTO ditte (tenant_id, created_at, updated_at, ragione_sociale, partita_iva)
  SELECT g.tenant_id, g.created_min, g.updated_max,
         CASE WHEN btrim(g.ragione_sociale) = '' THEN 'Ditta senza ragione sociale' ELSE g.ragione_sociale END,
         g.piva
    FROM (
      SELECT DISTINCT ON (a.tenant_id, a.piva)
             a.tenant_id, a.piva, a.ragione_sociale,
             min(a.created_at) OVER w AS created_min,
             max(a.updated_at) OVER w AS updated_max
        FROM _f210_anagrafiche a
       WHERE NOT a.ditta_esistente
      WINDOW w AS (PARTITION BY a.tenant_id, a.piva)
       ORDER BY a.tenant_id, a.piva, a.updated_at DESC, a.priorita, a.id
    ) g;
  GET DIAGNOSTICS v_ditte_nuove = ROW_COUNT;

  UPDATE _f210_anagrafiche a SET ditta_id = d.id
    FROM ditte d WHERE d.tenant_id = a.tenant_id AND d.partita_iva = a.piva;

  -- Sedi mancanti: una per (ditta, indirizzo distinto); contatti della riga piu' recente con quel
  -- indirizzo; principale solo se la ditta e' nuova e la sede e' quella della riga scelta.
  INSERT INTO sedi_ditte (tenant_id, ditta_id, created_at, updated_at, via, civico, cap, comune,
                          provincia, email, telefono, pec, principale)
  SELECT x.tenant_id, x.ditta_id, x.created_min, x.updated_max, x.via, x.civico, x.cap, x.comune,
         x.provincia, x.email, x.telefono, x.pec, x.principale
    FROM (
      SELECT DISTINCT ON (a.ditta_id, a.chiave)
             a.tenant_id, a.ditta_id, a.via, a.civico, a.cap, a.comune, a.provincia,
             a.email, a.telefono, a.pec,
             min(a.created_at) OVER w AS created_min,
             max(a.updated_at) OVER w AS updated_max,
             (NOT a.ditta_esistente AND bool_or(a.scelta) OVER w) AS principale
        FROM _f210_anagrafiche a
       WHERE NOT EXISTS (
         SELECT 1 FROM sedi_ditte s
          WHERE s.tenant_id = a.tenant_id AND s.ditta_id = a.ditta_id AND s.attiva
            AND lower(regexp_replace(btrim(s.via), '\s+', ' ', 'g')) || '|' ||
                lower(regexp_replace(btrim(s.civico), '\s+', ' ', 'g')) || '|' ||
                lower(regexp_replace(btrim(s.comune), '\s+', ' ', 'g')) || '|' ||
                btrim(s.cap) || '|' || upper(btrim(s.provincia)) = a.chiave)
      WINDOW w AS (PARTITION BY a.ditta_id, a.chiave)
       ORDER BY a.ditta_id, a.chiave, a.updated_at DESC, a.priorita, a.id
    ) x;
  GET DIAGNOSTICS v_sedi_nuove = ROW_COUNT;

  -- D5.5: ogni riga di ruolo riceve ditta e la sede del PROPRIO indirizzo.
  UPDATE produttori r SET ditta_id = a.ditta_id, sede_id = s.id
    FROM _f210_anagrafiche a
    CROSS JOIN LATERAL (
      SELECT sd.id FROM sedi_ditte sd
       WHERE sd.tenant_id = a.tenant_id AND sd.ditta_id = a.ditta_id AND sd.attiva
         AND lower(regexp_replace(btrim(sd.via), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.civico), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.comune), '\s+', ' ', 'g')) || '|' ||
             btrim(sd.cap) || '|' || upper(btrim(sd.provincia)) = a.chiave
       ORDER BY sd.attiva DESC, sd.principale DESC, sd.created_at, sd.id LIMIT 1
    ) s
   WHERE a.ruolo = 'P' AND r.id = a.id;
  UPDATE destinatari r SET ditta_id = a.ditta_id, sede_id = s.id
    FROM _f210_anagrafiche a
    CROSS JOIN LATERAL (
      SELECT sd.id FROM sedi_ditte sd
       WHERE sd.tenant_id = a.tenant_id AND sd.ditta_id = a.ditta_id AND sd.attiva
         AND lower(regexp_replace(btrim(sd.via), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.civico), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.comune), '\s+', ' ', 'g')) || '|' ||
             btrim(sd.cap) || '|' || upper(btrim(sd.provincia)) = a.chiave
       ORDER BY sd.attiva DESC, sd.principale DESC, sd.created_at, sd.id LIMIT 1
    ) s
   WHERE a.ruolo = 'D' AND r.id = a.id;
  UPDATE trasportatori r SET ditta_id = a.ditta_id, sede_id = s.id
    FROM _f210_anagrafiche a
    CROSS JOIN LATERAL (
      SELECT sd.id FROM sedi_ditte sd
       WHERE sd.tenant_id = a.tenant_id AND sd.ditta_id = a.ditta_id AND sd.attiva
         AND lower(regexp_replace(btrim(sd.via), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.civico), '\s+', ' ', 'g')) || '|' ||
             lower(regexp_replace(btrim(sd.comune), '\s+', ' ', 'g')) || '|' ||
             btrim(sd.cap) || '|' || upper(btrim(sd.provincia)) = a.chiave
       ORDER BY sd.attiva DESC, sd.principale DESC, sd.created_at, sd.id LIMIT 1
    ) s
   WHERE a.ruolo = 'T' AND r.id = a.id;

  -- D5.5: controlli finali (RAISE EXCEPTION, nessun valore).
  SELECT (SELECT count(*) FROM produttori WHERE ditta_id IS NULL OR sede_id IS NULL)
       + (SELECT count(*) FROM trasportatori WHERE ditta_id IS NULL OR sede_id IS NULL)
       + (SELECT count(*) FROM destinatari WHERE ditta_id IS NULL OR sede_id IS NULL)
    INTO v_righe;
  IF v_righe > 0 THEN
    RAISE EXCEPTION 'F2-10: % righe di ruolo restano senza ditta o senza sede', v_righe;
  END IF;

  SELECT count(*) INTO v_righe FROM (
    SELECT d.id
      FROM ditte d
     WHERE d.id IN (SELECT ditta_id FROM _f210_anagrafiche)
       AND (SELECT count(*) FROM sedi_ditte s WHERE s.ditta_id = d.id AND s.principale) <> 1
  ) x;
  IF v_righe > 0 THEN
    RAISE EXCEPTION 'F2-10: % ditte non hanno esattamente una sede principale', v_righe;
  END IF;

  -- D5.6: NOTICE informativi con i soli conteggi (i test non li leggono).
  SELECT count(*) INTO v_righe FROM _f210_anagrafiche;
  SELECT count(DISTINCT ditta_id) INTO v_ditte_toccate FROM _f210_anagrafiche;
  RAISE NOTICE 'F2-10: % anagrafiche collegate a % ditte (% nuove), % sedi create',
    v_righe, v_ditte_toccate, v_ditte_nuove, v_sedi_nuove;
  RAISE NOTICE 'F2-10: % ditte con piu ruoli in questa esecuzione', (
    SELECT count(*) FROM (
      SELECT ditta_id FROM _f210_anagrafiche GROUP BY ditta_id HAVING count(DISTINCT ruolo) > 1
    ) m);

  DROP TABLE _f210_anagrafiche;
END;
$f210$;

-- La funzione gira con i privilegi di chi la chiama e tocca tutte le aziende: nessuno, a parte il
-- proprietario, deve poterla eseguire (EXECUTE e' concesso a PUBLIC di default).
REVOKE EXECUTE ON FUNCTION f210_collega_anagrafiche() FROM PUBLIC;

SELECT f210_collega_anagrafiche();

-- 4. Chiavi esterne composte, unici e indici (DOPO il backfill) -------------------------------
-- La riga di ruolo punta alla ditta (stesso tenant) e alla sede (della STESSA ditta e dello
-- stesso tenant). NO ACTION: una ditta o una sede con ruoli collegati non si cancella.

ALTER TABLE "produttori" ADD CONSTRAINT "produttori_ditta_fkey"
  FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "produttori" ADD CONSTRAINT "produttori_sede_fkey"
  FOREIGN KEY ("sede_id", "ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "ditta_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "trasportatori" ADD CONSTRAINT "trasportatori_ditta_fkey"
  FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "trasportatori" ADD CONSTRAINT "trasportatori_sede_fkey"
  FOREIGN KEY ("sede_id", "ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "ditta_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "destinatari" ADD CONSTRAINT "destinatari_ditta_fkey"
  FOREIGN KEY ("ditta_id", "tenant_id") REFERENCES "ditte"("id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "destinatari" ADD CONSTRAINT "destinatari_sede_fkey"
  FOREIGN KEY ("sede_id", "ditta_id", "tenant_id") REFERENCES "sedi_ditte"("id", "ditta_id", "tenant_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "produttori_tenant_id_ditta_id_key" ON "produttori"("tenant_id", "ditta_id");
CREATE UNIQUE INDEX "trasportatori_tenant_id_ditta_id_key" ON "trasportatori"("tenant_id", "ditta_id");
CREATE UNIQUE INDEX "destinatari_tenant_id_ditta_id_key" ON "destinatari"("tenant_id", "ditta_id");
CREATE INDEX "produttori_sede_id_idx" ON "produttori"("sede_id");
CREATE INDEX "trasportatori_sede_id_idx" ON "trasportatori"("sede_id");
CREATE INDEX "destinatari_sede_id_idx" ON "destinatari"("sede_id");

-- 5. RLS, in fondo (D11) ----------------------------------------------------------------------

ALTER TABLE "ditte" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ditte" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "ditte"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "ditte" FOR SELECT TO wasteflow_lettura USING (true);

ALTER TABLE "sedi_ditte" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sedi_ditte" FORCE ROW LEVEL SECURITY;
CREATE POLICY isolamento_azienda ON "sedi_ditte"
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY sola_lettura ON "sedi_ditte" FOR SELECT TO wasteflow_lettura USING (true);
