# Accertamenti sui contratti RENTRI

Accertamenti redatti a mano sulla base dei contratti scaricati in `MANIFEST.md`. Non sono rigenerabili automaticamente dallo script: qui restano solo decisioni e osservazioni verificate manualmente.

## Divergenza: conteggio path `formulari`

Atteso: 29 path in `formulari.yaml`. Rilevato: **65** (verificato con `grep -c '^  /' docs/contracts/rentri/formulari.yaml`, elenco confermato via `grep -n`). La versione del documento (`1.0.20260723-1089`) coincide con quella attesa dal coordinatore, quindi non e' un problema di URL o cache: l'ente espone semplicemente piu' endpoint di quanti previsti. Non e' stato forzato alcun valore: si riporta il dato reale rilevato il 2026-07-25.

## Integrita' dei messaggi

Nessun header di integrita' (`Digest`, `Agid-JWT-Signature`) e' dichiarato negli OpenAPI scaricati. INTEGRITY_REST_01 non e' quindi verificabile da questi contratti: la fake API non lo impone. Da riverificare quando saranno disponibili le credenziali demo.

Nota: `grep -niE "digest|agid-jwt|signature|integrity" docs/contracts/rentri/*.yaml` produce una sola occorrenza, in `formulari.yaml` riga 9425, campo `digest_to_sign` dello schema `EsitoGetHashPerFirmaModel` (dominio: hash da firmare per la firma crittografica del formulario, endpoint di acquisizione firma). Non e' un header di trasporto ma un campo del body applicativo: non contraddice la conclusione sopra.

## API registri

L'API dei registri non e' esposta su `/docs/{api}/v1.0/openapi.json`. Copertura limitata a formulari, anagrafiche, codifiche.

Varianti testate (tutte 404): `registri`, `registro`, `registri-cronologici`, `vidimazione`.
