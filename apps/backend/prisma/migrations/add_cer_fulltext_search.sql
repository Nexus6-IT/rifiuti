-- Enable pg_trgm extension for trigram-based full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index on CER description for fast full-text search
CREATE INDEX IF NOT EXISTS "cer_codes_description_gin_idx"
ON "cer_codes"
USING GIN (description gin_trgm_ops);

-- This index will significantly improve search performance on CER descriptions
-- Example query that will use this index:
-- SELECT * FROM cer_codes WHERE description ILIKE '%olio%';
