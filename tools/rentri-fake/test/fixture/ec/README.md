# Fixture EC di prova

Dati di prova, **non segreti**: chiavi, certificati e `.p12` servono solo ai test e non proteggono nulla. Rigenerare con lo script:

    bash tools/rentri-fake/scripts/genera-fixture-ec.sh

- `ca-prova.{key,crt}`: CA di prova RSA 2048 autofirmata.
- `operatore-test-ec.{key,crt,p12}`: EC P-256 (`prime256v1`), CN `operatore-test-ec`, passphrase `prova-ec`.
- `operatore-test-ec-senza-password.p12`: stesso certificato, senza password.
- `operatore-test-ec384.{key,crt,p12}`: EC P-384, per i test di rifiuto, passphrase `prova-ec`.
- `operatore-test-ec-openssl3.p12`: stesso certificato EC P-256, con i default di OpenSSL 3 (PBES2/PBKDF2/AES-256-CBC, MAC SHA-256), passphrase `prova-ec`.
- `operatore-test-ec-keybag-in-chiaro.p12` (passphrase `prova-ec`, con MAC) e `operatore-test-ec-keybag-in-chiaro-senza-mac.p12` (senza password, senza MAC): chiave e certificati non cifrati (`-keypbe NONE -certpbe NONE`).

## Attenzione: la chiave della CA di prova e' pubblica

`ca-prova.key` e' nel repository, quindi chiunque puo' emettere certificati firmati dalla CA di prova. Il finto RENTRI si fida di questa CA quando trova la fixture: un finto avviato dal repository (`npm start`, ts-node, CI con working-directory `tools/rentri-fake`) accetta certificati che chiunque puo' produrre. Il finto non e' un confine di sicurezza; solo l'immagine Docker ne e' esente, perche' non copia `test/`.
