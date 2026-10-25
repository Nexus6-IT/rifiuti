-- Azienda tecnica "piattaforma" (RLS pezzo 4).
--
-- Le righe di `permission_audit_logs` sono per azienda (catena di hash per azienda), quindi le
-- azioni del super admin compiute SENZA un'azienda selezionata non avevano dove finire e
-- l'audit le saltava. Questa riga e' l'azienda a cui vengono attribuite: id fisso, costante
-- applicativa AZIENDA_PIATTAFORMA_ID (core/context/azienda-piattaforma.ts).
--
-- Non e' un cliente e deve restare invisibile a ogni vista applicativa. Valori neutri:
--  * subscription_status = SUSPENDED: fuori da ogni scansione ACTIVE/TRIAL (cron delle
--    scadenze, RENTRI, MUD) e mai "attiva" per la fatturazione; subscription_tier = TRIAL
--    (nessun piano a pagamento), nessun customer/subscription Stripe;
--  * fir_limit_per_month = 0 e user_limit_total = 0: valori neutri, NON applicati dal server (non
--    impediscono da soli di creare FIR o utenti: lo impediscono lo stato SUSPENDED e
--    assertNonPiattaforma nel codice applicativo);
--  * mud_non_dovuto = true: niente promemoria ne' scadenze MUD;
--  * rentri_modalita_legame = MANUALE: nessuna trasmissione automatica;
--  * partita_iva '00000000000': supera il controllo del check digit, quindi NON e' invalida, e'
--    solo non assegnata a nessun cliente; nessun owner, nessuna madre.
-- Il filtro applicativo (escludiPiattaforma) resta la difesa principale; lo stato SUSPENDED
-- e' una seconda cintura. Idempotente: ON CONFLICT DO NOTHING.
-- `tenants` non ha RLS, quindi l'inserimento non richiede un contesto azienda.

INSERT INTO "tenants" (
  "id",
  "partita_iva",
  "ragione_sociale",
  "subscription_tier",
  "subscription_status",
  "fir_limit_per_month",
  "user_limit_total",
  "mud_non_dovuto",
  "mud_non_dovuto_motivo",
  "mud_non_dovuto_il",
  "rentri_modalita_legame",
  "updated_at"
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000000',
  'Piattaforma (tecnica)',
  'TRIAL',
  'SUSPENDED',
  0,
  0,
  true,
  'Azienda tecnica: non e'' un cliente',
  now(),
  'MANUALE',
  now()
)
ON CONFLICT ("id") DO NOTHING;
