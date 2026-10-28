# Piano B RENTRI, pezzo 4: certificati di interoperabilità EC (piano di implementazione)

> **Per chi esegue:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (consigliato) o superpowers:executing-plans per eseguire il piano task per task. I passi hanno caselle (`- [ ]`) per il tracciamento.

**Obiettivo:** un'azienda carica il suo certificato di interoperabilità RENTRI, con ogni probabilità ECDSA P-256, e WasteFlow lo usa per tutto:
- JWT di autenticazione;
- firma di integrità `Agid-JWT-Signature`;
- firma XAdES del contenitore ASiC degli xFIR.

Oggi il caricamento si ferma subito: node-forge non legge né la chiave né il certificato EC. L'algoritmo non lo sceglie più l'utente: si ricava dalla chiave.

**Architettura:**
- la lettura del PKCS#12 resta su node-forge solo per aprire il contenitore; chiavi e certificati passano a `crypto` di Node (`createPrivateKey`, `X509Certificate`), che gestisce RSA ed EC;
- la validazione statica del certificato usa `X509Certificate`;
- l'algoritmo JOSE si ricava dal tipo di chiave;
- la firma XAdES usa `crypto.sign` con `ecdsa-sha256` in formato IEEE P1363 per le chiavi EC;
- il simulatore impara ES256 e `ecdsa-sha256`, con un certificato EC di prova emesso da una CA di prova fissa (fixture versionate, generate con uno script openssl).

**Tech Stack:** NestJS backend (Jest), Node `crypto`, node-forge (solo per il contenitore PKCS#12), jose, Fastify fake (`tools/rentri-fake`), openssl solo per lo script delle fixture.

**Spec:**
- `C:\Progetti\winwaste\docs\rentri\04-confronto-con-rifiuti.md`:
  - §2 punto (a);
  - tabella riga 32;
  - riga "Upload `.p12`" (B1, verificato su node-forge 1.3.1: su un `.p12` P-256 `key presente: false, cert presente: false`);
  - riga `alg` (B4: va dedotto dalla chiave).
- `C:\Progetti\winwaste\docs\rentri\01-autenticazione-e-firma.md` righe 40-86 e 144-153: WinWaste sceglie `ES256` quando la chiave è ECC, firma in formato P1363 e firma l'XML con `ecdsa-sha256`.

## Decisioni (predefinite del controller, da riportare a Graziano)

1. **Il simulatore accetta ES256 oltre a RS256** per il JWT self-issued e per `Agid-JWT-Signature`. Oggi `tools/rentri-fake/src/auth/jwt-verifier.ts:44` ammette solo RS256 citando ModI ID_AUTH_REST_02, ma WinWaste in produzione usa ES256 con certificati EC. Il commento del simulatore va corretto: citerà la prova da WinWaste e dirà che la regola AgID va verificata sull'ambiente demo.
2. **L'algoritmo si ricava dalla chiave:** EC P-256 → `ES256`, RSA → `RS256`. Altre curve o altri tipi vengono rifiutati al caricamento con "Tipo di chiave non supportato da RENTRI: <tipo/curva>". Il campo `algorithm` del DTO diventa facoltativo e solo di controllo: se c'è e non coincide, si risponde 400. Il selettore dell'algoritmo sparisce dal frontend, e l'algoritmo ricavato si mostra in sola lettura.
3. **Fixture versionate.** Sono dati di prova, non segreti, e stanno in `tools/rentri-fake/test/fixture/ec/`:
   - una CA di prova RSA (chiave e certificato);
   - un certificato EC P-256 emesso da quella CA;
   - il suo `.p12`, con passphrase `prova-ec`.

   Lo script `tools/rentri-fake/scripts/genera-fixture-ec.sh` le rigenera con openssl. Il simulatore si fida della CA di prova fissa oltre a quella effimera di oggi.
4. **Firma XAdES EC:**
   - SignatureMethod `http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256`;
   - SignatureValue in formato IEEE P1363 (r‖s, 64 byte per P-256), come vuole XMLDSig;
   - per RSA resta `rsa-sha256`.

## Global Constraints

- **Branch e worktree:** `fix/rentri-b4-certificati-ec` nel worktree `C:\Progetti\rifiuti-wt-rentri-b1`, partito da `fix/rentri-b3-ca-rentri-contratto` @ `2bd2b17`. Va in merge dopo i pezzi 1-3. `node_modules` già installati.
- **TDD obbligatorio:** prima il test, **eseguito e visto fallire**, poi il codice.
- **Comandi:**
  - backend: `cd apps/backend && JWT_SECRET=ci-dummy-jwt-secret-not-used-in-prod npx jest --runInBand --forceExit <spec>`;
  - oracolo: `npm run test:oracolo -- <pattern>`;
  - simulatore: `cd tools/rentri-fake && npx jest --runInBand <file>`;
  - frontend: `cd apps/frontend && npx ng test --watch=false --browsers=ChromeHeadless --include=<spec>` e `npx tsc --noEmit -p tsconfig.app.json`;
  - mai la suite intera del backend e mai `ng build`.
- **Sicurezza:** chiavi private, passphrase e certificati reali non si loggano mai. Le fixture di prova sono dichiarate come tali in un `README.md` nella loro cartella.
- **Lingua e commit:** commenti e messaggi in italiano, termini tecnici in inglese; commit senza attribuzione AI; mai `git add -A`.

## Review Focus

1. **Un `.p12` EC P-256 senza password, o con la chiave in un `keyBag` non cifrato:** si legge come il caso cifrato.
2. **Un `.p12` EC con una curva diversa (P-384):** errore chiaro al caricamento, mai un JWT firmato con l'algoritmo sbagliato.
3. **Un `.p12` RSA già caricato prima di questo cambiamento,** cioè chiave e certificato PEM in database con `algorithm` RS256: continua a funzionare senza ricaricarlo.
4. **Passphrase errata su un `.p12` EC:** stesso messaggio generico di oggi, senza dettagli.
5. **La firma ECDSA del JWT e della XAdES è in formato P1363, non DER:** il simulatore la verifica e rifiuta la variante DER.

---

### Task 1: fixture EC e lettura del PKCS#12 con chiavi EC

**Files:**
- Create: `tools/rentri-fake/scripts/genera-fixture-ec.sh` (openssl):
  - CA di prova RSA 2048 autofirmata;
  - chiave EC `prime256v1`;
  - certificato EC emesso dalla CA, validità 10 anni, subject `CN=operatore-test-ec`;
  - `.p12` con passphrase `prova-ec` e una variante senza password;
  - un `.p12` P-384 per il test di rifiuto.
- Create: `tools/rentri-fake/test/fixture/ec/`, con i file generati e un `README.md` ("dati di prova, non segreti; rigenerare con lo script").
- Modify: `apps/backend/src/infrastructure/rentri/rentri-pkcs12.util.ts`.
- Test: `apps/backend/src/infrastructure/rentri/rentri-pkcs12.util.spec.ts`.

**Interfaces:**
- Firma invariata: `parsePkcs12(base64OrBuffer, passphrase): Pkcs12Pem`.
- Il risultato aggiunge `tipoChiave: 'rsa' | 'ec'` e `curva?: string` (es. `'prime256v1'`), ricavati da `crypto.createPrivateKey(...).asymmetricKeyType` e `asymmetricKeyDetails.namedCurve`.
- **Approccio:** node-forge apre il contenitore e verifica il MAC. Per i bag in cui node-forge non converte la chiave o il certificato (`bag.key`/`bag.cert` nulli), si usa l'ASN.1 del bag (`bag.asn1`). Si serializza in DER con `forge.asn1.toDer` e si passa a `crypto.createPrivateKey({ key, format: 'der', type: 'pkcs8' })` e a `new crypto.X509Certificate(der)`. Il PEM si produce con `KeyObject.export({ type: 'pkcs8', format: 'pem' })` e `X509Certificate.toString()`.
  - Se la versione installata di node-forge non conserva `bag.asn1`, lo stesso risultato si ottiene decifrando i `pkcs8ShroudedKeyBag` con `forge.pki.decryptPrivateKeyInfo` e leggendo i `certBag` dall'ASN.1. Va detto nel report quale delle due strade è stata usata.
- Per RSA il risultato resta uguale a oggi; se il PEM cambia solo nel formato (PKCS#1 → PKCS#8), va detto e verificato che il resto del codice lo accetti.

- [ ] **Step 1: genera le fixture** con lo script e committale nello stesso commit del codice.
- [ ] **Step 2: test che falliscono** in `rentri-pkcs12.util.spec.ts`:
  - `'p12 EC P-256 cifrato: chiave e certificato in PEM, tipoChiave ec, curva prime256v1'`;
  - `'p12 EC senza password'`;
  - `'p12 EC con passphrase errata: messaggio generico di oggi'`;
  - `'p12 RSA esistente: invariato'`;
  - `'la chiave EC estratta firma e il certificato la verifica'`: `crypto.sign`/`verify` su un buffer.
- [ ] **Step 3:** esegui. Atteso: FAIL con "PKCS#12 privo di chiave privata" sul caso EC.
- [ ] **Step 4:** implementa.
- [ ] **Step 5:** stessi test, poi `npx tsc --noEmit -p apps/backend` e lo spec del controller delle credenziali. Atteso: PASS.
- [ ] **Step 6: commit** `fix(rentri): il PKCS#12 con chiave EC si legge, con fixture di prova`.

### Task 2: validazione del certificato e algoritmo ricavato dalla chiave

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/certificato/valida-certificato.ts`. Si toglie `forge.pki`; scadenza, catena (autofirmato) e revoca (estensioni CRL `2.5.29.31` e AIA `1.3.6.1.5.5.7.1.1`) passano a `X509Certificate`. Le estensioni si cercano nell'ASN.1 del DER, con `forge.asn1` o una scansione degli OID.
- Create: `apps/backend/src/infrastructure/rentri/certificato/algoritmo-da-chiave.ts`, con `algoritmoDaChiave(privateKeyPem: string): 'RS256' | 'ES256'`. Su tipo o curva non supportati solleva `TipoChiaveNonSupportatoError` con il messaggio della Decisione 2.
- Modify: `apps/backend/src/api/rentri/rentri-credential.controller.ts` (~96-140) e `apps/backend/src/infrastructure/rentri/rentri-credential.service.ts` (~98). L'algoritmo salvato è quello ricavato; un `dto.algorithm` diverso dà 400 "L'algoritmo indicato (<x>) non corrisponde alla chiave del certificato (<y>)". Va aggiornata la descrizione di `algorithm` nel DTO.
- Modify, frontend: `apps/frontend/src/app/features/rentri/rentri-credential.component.ts` (~376) e il template. Il selettore dell'algoritmo si toglie e l'algoritmo ricavato si mostra in sola lettura dopo il caricamento.
- Test:
  - `valida-certificato.spec.ts`;
  - `algoritmo-da-chiave.spec.ts` (nuovo);
  - `rentri-credential.controller.spec.ts`;
  - lo spec del componente frontend, se esiste.

- [ ] **Step 1: test che falliscono.**
  - Validazione: `'certificato EC: scadenza, catena e revoca valutati senza errori'`, con la fixture EC del Task 1.
  - Algoritmo:
    - `'algoritmoDaChiave: EC P-256 → ES256, RSA → RS256, P-384 → TipoChiaveNonSupportatoError'`;
    - `'caricamento p12 EC: algorithm salvato ES256'`;
    - `'caricamento con algorithm RS256 su chiave EC → 400'`;
    - `'caricamento p12 P-384 → 400 con messaggio'`.
  - Frontend: `'il selettore dell'algoritmo non c'è più'`.
- [ ] **Step 2:** esegui. Atteso: FAIL con "OID is not RSA" sulla validazione e algoritmo salvato RS256.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test, `tsc` del backend e del frontend, e lo spec del componente. Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): certificato EC validato e algoritmo ricavato dalla chiave`.

### Task 3: il simulatore accetta ES256 e una prova end-to-end con certificato EC

**Files:**
- Modify: `tools/rentri-fake/src/auth/jwt-verifier.ts` (algoritmi ammessi RS256 ed ES256; commento come da Decisione 1) e `tools/rentri-fake/src/auth/ca-test.ts` o `soggetti-accreditati.ts`, perché il simulatore si fidi anche della CA di prova fissa del Task 1.
- Modify: la verifica di `Agid-JWT-Signature` nel simulatore, se è separata (`grep -rn "Agid-JWT-Signature" tools/rentri-fake/src`).
- Create: `apps/backend/src/infrastructure/rentri/rentri-certificato-ec.oracolo.spec.ts`. Usa la fixture `.p12` EC:
  1. `parsePkcs12`;
  2. `algoritmoDaChiave`;
  3. `RENTRIApiClient` configurato con la chiave e il certificato EC;
  4. una chiamata autenticata con firma di integrità (`creaFormulario` con `corpoFormularioValido()`), accettata dal simulatore con 202.
- Test: `tools/rentri-fake/test/jwt-verifier.test.ts`.

- [ ] **Step 1: test che falliscono.**
  - Simulatore:
    - `'JWT ES256 con x5c EC emesso dalla CA di prova fissa: valido'`;
    - `'JWT ES256 con firma in formato DER invece di P1363: rifiutato'`;
    - `'JWT ES256 con certificato RSA: rifiutato'`, cioè `alg` incoerente con la chiave.
  - Backend: `'creaFormulario con certificato EC: 202 dal simulatore'`.
- [ ] **Step 2:** esegui. Atteso: FAIL, perché il simulatore ammette solo RS256.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui:
  - i test dello Step 1;
  - la suite del simulatore con `--runInBand`;
  - `npm run test:oracolo -- rentri`. Fa eccezione il test `/metrics` con Prometheus reale; il rate limiter richiede Redis su 16399.

  Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): il finto accetta ES256, prova end-to-end con certificato EC`.

### Task 4: firma XAdES dell'ASiC con chiave EC

**Files:**
- Modify: `apps/backend/src/infrastructure/rentri/xfir/costruisci-asice.ts` (righe ~130-200). La firma passa da `forge` a `crypto.sign`: per EC `sha256` con `dsaEncoding: 'ieee-p1363'` e SignatureMethod `ecdsa-sha256`, per RSA `rsa-sha256` come oggi. Si tolgono i riferimenti a "chiave privata RSA" nei commenti e nei tipi.
- Modify: `tools/rentri-fake/src/xfir/validatore-xades.ts`, che accetta `ecdsa-sha256` (P1363) oltre a `rsa-sha256`.
- Test: lo spec di `costruisci-asice` e quello del validatore del simulatore (si trovano con `ls`).

- [ ] **Step 1: test che falliscono.**
  - `'ASiC con chiave EC: SignatureMethod ecdsa-sha256 e firma di 64 byte verificabile'`;
  - `'ASiC con chiave RSA: invariato'`;
  - nel simulatore, `'XAdES ecdsa-sha256 valida accettata; in formato DER rifiutata'`.
- [ ] **Step 2:** esegui. Atteso: FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** esegui i test, la suite del simulatore con `--runInBand` e gli oracoli xFIR (`npm run test:oracolo -- xfir asice`, o i pattern che trovi). Atteso: PASS.
- [ ] **Step 5: commit** `fix(rentri): firma XAdES dell'ASiC con chiave EC`.

## Verifica finale

- [ ] `grep -rn "forge.pki.certificateFromPem\|privateKeyFromPem\|rsa.PrivateKey" apps/backend/src --include=*.ts | grep -v spec`: nessun risultato, oppure solo usi motivati da un commento.
- [ ] Oracoli RENTRI verdi (con le stesse eccezioni ambientali dei pezzi precedenti).
- [ ] Il frontend compila (`tsc`).
