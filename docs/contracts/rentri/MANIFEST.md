# Contratti ufficiali RENTRI

Scaricati da `https://demoapi.rentri.gov.it/docs`. NON modificare a mano: rieseguire lo script.

| API | URL | Versione | SHA-256 | Scaricato il |
|-----|-----|----------|---------|--------------|
| formulari | https://demoapi.rentri.gov.it/docs/formulari/v1.0/openapi.json | 1.0.20260723-1089 | `6413c3c12e129d1c8a43c76969bdc3f351e63557694d2fc84b55723eb8771dbf` | 2026-07-25 |
| anagrafiche | https://demoapi.rentri.gov.it/docs/anagrafiche/v1.0/openapi.json | 1.0.20260723-1036 | `ba3699074914c4577ba1089f582e0d2fcc7d778d02956de23adedc90a40e409b` | 2026-07-25 |
| codifiche | https://demoapi.rentri.gov.it/docs/codifiche/v1.0/openapi.json | 1.0.20260707-976 | `14490a88577ab1167847a1e80d1244a4ede18cbfae8decb3f844830e921b4884` | 2026-07-25 |

## Divergenza: conteggio path `formulari`

Atteso: 29 path in `formulari.yaml`. Rilevato: **65** (verificato con `grep -c '^  /' docs/contracts/rentri/formulari.yaml`, elenco confermato via `grep -n`). La versione del documento (`1.0.20260723-1089`) coincide con quella attesa dal coordinatore, quindi non e' un problema di URL o cache: l'ente espone semplicemente piu' endpoint di quanti previsti. Non e' stato forzato alcun valore: si riporta il dato reale rilevato il 2026-07-25.

## Integrita' dei messaggi

Nessun header di integrita' (`Digest`, `Agid-JWT-Signature`) e' dichiarato negli OpenAPI scaricati. INTEGRITY_REST_01 non e' quindi verificabile da questi contratti: la fake API non lo impone. Da riverificare quando saranno disponibili le credenziali demo.

Nota: `grep -niE "digest|agid-jwt|signature|integrity" docs/contracts/rentri/*.yaml` produce una sola occorrenza, in `formulari.yaml` riga 9425, campo `digest_to_sign` dello schema `EsitoGetHashPerFirmaModel` (dominio: hash da firmare per la firma crittografica del formulario, endpoint di acquisizione firma). Non e' un header di trasporto ma un campo del body applicativo: non contraddice la conclusione sopra.

## API registri

L'API dei registri non e' esposta su `/docs/{api}/v1.0/openapi.json`. Copertura limitata a formulari, anagrafiche, codifiche.

Varianti testate (tutte 404): `registri`, `registro`, `registri-cronologici`, `vidimazione`.
