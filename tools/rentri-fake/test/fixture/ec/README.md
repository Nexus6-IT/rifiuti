# Fixture EC di prova

Dati di prova, **non segreti**: chiavi, certificati e `.p12` servono solo ai test e non proteggono nulla. Rigenerare con lo script:

    bash tools/rentri-fake/scripts/genera-fixture-ec.sh

- `ca-prova.{key,crt}`: CA di prova RSA 2048 autofirmata.
- `operatore-test-ec.{key,crt,p12}`: EC P-256 (`prime256v1`), CN `operatore-test-ec`, passphrase `prova-ec`.
- `operatore-test-ec-senza-password.p12`: stesso certificato, senza password.
- `operatore-test-ec384.{key,crt,p12}`: EC P-384, per i test di rifiuto, passphrase `prova-ec`.
