-- Migration: 20260629200000_add_signer_fields_to_fir_signatures
--
-- Aggiunge campi auto-descrittivi alla tabella fir_signatures per consentire:
--  1. Verifica firme senza join a users (documento legale = auto-descritto)
--  2. Conservazione del codice fiscale del firmatario nel record firma
--     (invariante legale anche se l'utente viene eliminato o il CF cambia)
--  3. Chiave pubblica per verifica crittografica offline/pubblica
--
-- Campi nullable: backward-compatibili con firme esistenti (se presenti).
-- Nuove firme create tramite POST /fir/:id/sign popoleranno tutti e tre i campi.
--
-- Normativa: DM 59/2023 + art. 188-bis D.Lgs. 152/2006 (immutabilità FIR),
--            CAD art. 20 (documento informatico), AgID conservazione 10 anni.

ALTER TABLE "fir_signatures"
  ADD COLUMN IF NOT EXISTS "signer_fiscal_code" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "signer_name"        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "public_key"          TEXT;

-- Indice su codice fiscale per ricerche audit
CREATE INDEX IF NOT EXISTS "fir_signatures_signer_fiscal_code_idx"
  ON "fir_signatures" ("signer_fiscal_code");
