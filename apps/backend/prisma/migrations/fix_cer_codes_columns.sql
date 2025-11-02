-- Fix CER codes table columns to handle longer values
ALTER TABLE cer_codes ALTER COLUMN code TYPE VARCHAR(10);
ALTER TABLE cer_codes ALTER COLUMN description TYPE TEXT;
ALTER TABLE cer_codes ALTER COLUMN category TYPE VARCHAR(255);
ALTER TABLE cer_codes ALTER COLUMN subcategory TYPE VARCHAR(255);
