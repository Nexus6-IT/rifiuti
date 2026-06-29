# WasteFlow — Controllo di coerenza & readiness commerciale (2026-06-28)

Assessment read-only eseguito come swarm di 4 agenti (normativa, funzionale e2e su app live,
tecnico/sicurezza/GDPR, commerciale/competitivo) + verifica diretta. Onestà: distingue ciò che
è realmente funzionante da stub/mock/"pronto a connettersi".

## Verdetto
- **Vendibile oggi come SaaS?** ❌ No — prodotto **pre-commerciale**.
- **Usabile per operare "in regola"?** ❌ No sugli adempimenti core (registro, RENTRI, firma).
- **Base di valore reale?** ✅ Sì (architettura, MUD, IAM, ESG) → time-to-market accorciabile.

## Matrice di coerenza (sintesi)
| Area | Stato | Evidenza | Impatto |
|---|---|---|---|
| Registro cronologico C/S | ⚫ guscio | `WasteMovement` mai scritto | 🔴 uso |
| RENTRI interop | 🟡 pronto/non connesso | auth ModI ok; xFIR custom, path OpenAPI da confermare, no certificato/iscrizione reale | 🔴 |
| Firma digitale FIR/registro | ⚫ stub | ECDSA effimere + timestamp mock; controller firme non registrato | 🔴 |
| Ciclo vita FIR (emetti/consegna) | ✅ FIX 2026-06-29 | `FIRControllerV2` cablato + creazione FIR riparata (vedi sotto); ciclo BOZZA→EMESSO→IN_TRANSITO→CONSEGNATO(+ANNULLATO) verificato live | (era 🔴 uso) |
| Isolamento multi-tenant (RLS) | ✅ FIX 2026-06-28 | era inerte (middleware non registrato); ora middleware decodifica JWT + registrato | (era 🔴 GDPR) |
| Catalogo CER | ✅ FIX 2026-06-28 | repository era stub + lista 404; ora implementato + 497 codici seedati | (era 🔴 uso) |
| MUD V6.04/24 | ✅ base | tracciato a record fissi corretto (verificato export reale) | 🟡 manca validazione ufficiale |
| Dati riferimento | 🟡 | CER 497/~842, ISTAT comuni/province ok, ATECO/nazioni assenti | 🟡 |
| Deploy/CI | 🟡 | deploy ok ma slegato dai test (CI lint/test rossi) | 🟡 |
| Backup | 🟡 | cron giornaliero ok, no off-site, restore non testato | 🟡 |
| Monitoring/error tracking | ⚫ | `/metrics` non esposto, nessun Sentry/alert | 🟡 |
| Pagamenti/abbonamento | 🔴 | nessun pagamento; `subscriptionEnd`/`SUSPENDED`/`firLimit` non applicati | 🔴 vendita |
| Legale (DPA/Privacy/ToS) | ⚫ | assenti | 🔴 vendita |
| Onboarding self-service | 🔴 | no signup; provisioning manuale Keycloak + certificato | 🟡 (ok white-glove) |
| IAM (RBAC/ABAC, multi-azienda, impersonate) | ✅ maturo | differenziatore | ✅ AVANTI |
| ESG/CO₂ + anomaly detection | ✅ | dal dato RENTRI | ✅ AVANTI |
| PII nel repo | 🔴 | `backup_*.sql` con CF/P.IVA committati in git | 🔴 da bonificare |

## Bloccanti residui (prima della vendita)
1. **Registro cronologico operativo** (scrittura carico/scarico, progressivo, vidimazione, tempi).
2. **RENTRI reale**: certificato+iscrizione, formato xFIR conforme, path OpenAPI verificati, test su demoapi.
3. **Firma a norma** (qualificata/SPID-CIE + TSA reale) e cablare gli endpoint firma.
4. **Apparato commerciale**: DPA + informativa privacy + ToS; listino + metodo d'incasso.
5. **Bonifica PII** dalla history git.
6. ~~Esporre FIRControllerV2 (ciclo vita FIR)~~ ✅ FATTO 2026-06-29 (vedi sotto). Restano i **campi FIR obbligatori** da completare in form/persistenza: HP/colli/stato fisico/campo 17/4ª copia.

## Importanti (subito dopo)
ATECO/nazioni; CER 497→842 ufficiale; CI come gate del deploy; backup off-site + restore testato;
monitoring/error tracking; conservazione AgID 10 anni; enforcement firLimit/scadenza/sospensione
abbonamento; healthcheck frontend (container "unhealthy" pur servendo 200); paginazione liste; aggiornare passport-saml.

## Già SOLIDO (riduce time-to-compliance)
Auth Keycloak/JWT, export MUD V6.04/24 reale, reference-data ISTAT (107 province, 7904 comuni),
admin tenant/utenti/quote/impersonate, RBAC/ABAC con audit hash-chained, cifratura certificati RENTRI.

## Fix applicati in questa sessione (2026-06-28)
- **#1 Isolamento tenant**: `TenantContextMiddleware` ora decodifica il Bearer JWT (i middleware girano prima dei guard, `req.user` non disponibile) ed è registrato in `AppModule.configure` → RLS attiva + scrittura anagrafiche/FIR sbloccata. Verificato: POST produttore → 201.
- **#2 Catalogo CER**: `CERPrismaRepository` era interamente stub; implementato sul modello `CERCode` + `findPaginated` + endpoint root `GET /api/v1/cer`; tabella `cer_codes` popolata (497). Verificato: lista → 200/497.

## Fix applicati in questa sessione (2026-06-29) — Ciclo di vita FIR esposto e funzionante
Il ciclo di vita FIR è stato esposto e l'intera catena di creazione (mai
funzionante contro il DB reale) riparata. Verificato live BOZZA→EMESSO→
IN_TRANSITO→CONSEGNATO (+ANNULLATO), progressivo `FIR-2026-000001` assegnato
all'emissione, peso effettivo accettato, stato CONSEGNATO terminale.
- **Cablaggio**: `FIRControllerV2` (create/list/get + emetti/presa-in-carico/conferma-consegna) al posto del controller base; aggiunto endpoint+use-case **annulla** (mancante). La firma resta dato applicativo (firmatario/certificato): la firma qualificata a norma resta blocco separato.
- **Persistenza FIR** (bug pre-esistenti che impedivano qualunque creazione):
  1. enum stato dominio italiano vs Prisma `FIRStatus` inglese → mappatura bidirezionale nel repository;
  2. relazioni obbligatorie `tenant`/`producerUser` richieste in forma `connect`;
  3. `fir_number` obbligatorio ma assegnato solo all'emissione → reso **nullable** (migrazione);
  4. `cer_code` `VARCHAR(6)` ma codice canonico spaziato fino a 9 char → allargato a `VARCHAR(10)` (migrazione);
  5. normalizzazione codice CER (accetta "200301" e "20 03 01").
- **Validazione DTO** (con `whitelist`+`forbidNonWhitelisted`): `CreateFIRDto.rifiuto` veniva strippato → aggiunti `@ValidateNested/@Type`; i DTO di transizione non avevano decoratori (campi firma/motivo rifiutati) → `FirmaDto` + `@IsObject/@ValidateNested/@Type`, `@IsNumber` su pesoEffettivo, `@IsString` su motivo.
- **Anagrafiche**: liste `GET /registry/{produttori,trasportatori,destinatari}` restituivano array nudo → envelope paginato `{items,...}` atteso dal frontend (sbloccava i dropdown del FIR).

### Residui minori noti (post-ciclo FIR, non bloccanti)
- Lista anagrafiche: colonna "Sede legale" mostra "undefined" (bug di formatting solo display; dato persistito correttamente).
- `GET /api/v1/notifications/unread-count` → 502 intermittente (endpoint notifiche, slegato dal FIR).
- Multi-azienda: il cambio società non ri-scopa le anagrafiche (la lista filtra per tenant statico del JWT, non per la società attiva). NON è un leak cross-utente (resta filtrato per tenant), ma il cambio società non ha effetto server-side: richiede una decisione di design auth/multi-tenant.

## Target realistico oggi
Singolo **consulente ambientale pilota seguito a mano** (white-glove, fattura offline). Micro-azienda
self-service, PMI e PA: non oggi.

## Roadmap minima al primo cliente pagante
1. Compliance core: registro operativo + RENTRI live/certificato + firma conforme + ciclo FIR esposto.
2. Sicurezza/GDPR: isolamento tenant (✅ fatto) testato anti-leak; DPA+privacy+ToS; bonifica PII git.
3. Go-live tecnico: CI come gate; backup off-site+restore; monitoring/alert.
4. Commerciale: listino + incasso; enforcement scadenza/limiti.

> Fonti normative e di mercato citate nei report dei singoli agenti (DM 59/2023, art.190/193 D.Lgs 152/2006,
> rentri.gov.it, Unioncamere; competitor Winwaste/Soger/QuiRifiutiPro/Rifiutoo). Concorda con
> `docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md`.
