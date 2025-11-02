-- Create Registry Tables (Produttori, Trasportatori, Destinatari)

-- Produttori
CREATE TABLE IF NOT EXISTS produttori (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  ragione_sociale VARCHAR(255) NOT NULL,
  partita_iva VARCHAR(11) NOT NULL,

  via VARCHAR(255) NOT NULL,
  civico VARCHAR(20) NOT NULL,
  cap VARCHAR(5) NOT NULL,
  comune VARCHAR(100) NOT NULL,
  provincia VARCHAR(2) NOT NULL,

  email VARCHAR(255),
  telefono VARCHAR(20),
  pec VARCHAR(255),

  UNIQUE (tenant_id, partita_iva)
);

CREATE INDEX IF NOT EXISTS produttori_tenant_id_idx ON produttori(tenant_id);

-- Trasportatori
CREATE TABLE IF NOT EXISTS trasportatori (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  ragione_sociale VARCHAR(255) NOT NULL,
  partita_iva VARCHAR(11) NOT NULL,
  numero_iscrizione VARCHAR(50) NOT NULL,

  via VARCHAR(255) NOT NULL,
  civico VARCHAR(20) NOT NULL,
  cap VARCHAR(5) NOT NULL,
  comune VARCHAR(100) NOT NULL,
  provincia VARCHAR(2) NOT NULL,

  email VARCHAR(255),
  telefono VARCHAR(20),
  pec VARCHAR(255),

  UNIQUE (tenant_id, partita_iva)
);

CREATE INDEX IF NOT EXISTS trasportatori_tenant_id_idx ON trasportatori(tenant_id);

-- Destinatari
CREATE TABLE IF NOT EXISTS destinatari (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),

  ragione_sociale VARCHAR(255) NOT NULL,
  partita_iva VARCHAR(11) NOT NULL,
  numero_autorizzazione VARCHAR(50) NOT NULL,

  via VARCHAR(255) NOT NULL,
  civico VARCHAR(20) NOT NULL,
  cap VARCHAR(5) NOT NULL,
  comune VARCHAR(100) NOT NULL,
  provincia VARCHAR(2) NOT NULL,

  email VARCHAR(255),
  telefono VARCHAR(20),
  pec VARCHAR(255),

  UNIQUE (tenant_id, partita_iva)
);

CREATE INDEX IF NOT EXISTS destinatari_tenant_id_idx ON destinatari(tenant_id);
