# QR normato RENTRI (riga #23) — specifica mancante, 2026-09-10

## Incarico e perché questo documento invece del codice

Incarico: collegare al PDF del formulario un QR ISO/IEC 18004:2015 livello H
il cui contenuto è un payload CBOR firmato COSE_Sign1, codificato in Base45.
Prima di scrivere una riga di CBOR/COSE/Base45 è stato verificato se nel
repository esiste una fonte che descriva la struttura di quel payload
(campi, ordine, intestazione COSE, chiave di firma). **Non esiste.** Un QR
costruito indovinando il formato finirebbe su un documento diretto a un ente
pubblico: è peggio di nessun QR. Di conseguenza questo task produce solo
questo documento — nessun file sotto
`apps/backend/src/infrastructure/rentri/qr/` — per non inventare un formato.

## Cosa chiede il requisito, e da dove lo sappiamo

- `docs/audits/rentri-conformita-2026-07-25/README.md:49` — "RENTRI prevede
  **solo** QR code ISO/IEC 18004:2015 livello H" (esclude i codici lineari
  1D).
- `docs/audits/rentri-conformita-2026-07-25/README.md:85` (riga #23 della
  tabella delle 37 funzionalità) — "QR code ISO/IEC 18004:2015 liv. H —
  payload CBOR firmato COSE_Sign1, codifica Base45 | Obbligatoria sul
  documento stampato | ❌ | Esiste un `qrcode.service.ts` generico, mai
  collegato al PDF (`pdf.controller.ts:54` non passa `qrCodeDataUrl`).
  Nessun CBOR, nessun COSE_Sign1, nessun Base45".
- `docs/audits/rentri-conformita-2026-07-25/README.md:370` — nella sessione
  P3 il QR è stato effettivamente collegato al PDF, ma dichiarato
  esplicitamente non conforme: "il QR incapsula un URL in chiaro, non un
  payload firmato COSE. È un QR di verifica applicativa ..., non l'xFIR QR
  normato da RENTRI".
- `docs/audits/rentri-conformita-2026-07-25/README.md:382` — ribadito nelle
  conclusioni: "Il QR non è l'xFIR QR normato da RENTRI ... Chi scansiona il
  QR ottiene la verifica di questa applicazione, non l'attestazione ufficiale
  RENTRI."
- `docs/audits/rentri-divario-2026-09-10.md:102-104` — "QR code del documento
  stampato (riga 23). Serve CBOR firmato COSE_Sign1 in Base45. Nel codice non
  c'è né CBOR né COSE: esiste un generatore di QR generico, che è un'altra
  cosa."
- `docs/audits/rentri-divario-2026-09-10.md:175` — nell'ordine di lavoro
  proposto, "QR, copia cartacea, vidimazione a piè di pagina" sono
  esplicitamente rimandate a "dopo che il resto regge" (registro cronologico
  e contenitore xFIR vengono prima).

Nessuna di queste fonti — né alcun'altra trovata in `docs/adr/`,
`docs/contracts/rentri/` o altrove sotto `docs/` — descrive la **struttura**
del payload. Sanno solo dire *che cosa* serve (ISO/IEC 18004 liv. H, CBOR,
COSE_Sign1, Base45), non *come* costruirlo.

## Stato reale del codice, verificato in questa sessione

- Non esiste alcun file `qrcode.service.ts` nel repository (probabilmente
  rinominato/rimosso durante la sessione P3); la generazione del QR oggi vive
  dentro `apps/backend/src/api/pdf/pdf.controller.ts`.
- Riga 14: `import * as QRCode from 'qrcode'`.
- Righe 68-76: costruisce `verificationUrl` (l'URL pubblico
  `GET /fir/:id/verify-url`), genera `qrCodeDataUrl` con
  `QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: 'M', ... })` e lo
  passa a `this.pdfService.generateFIRPDF(fir, qrCodeDataUrl)`.
- Questo QR è quindi: livello di correzione errore **M** (non H), contenuto
  **un URL in chiaro** (non un payload CBOR/COSE), nessuna firma COSE,
  nessuna codifica Base45. È un meccanismo di verifica applicativa proprio di
  WasteFlow, utile ma distinto dal QR normato RENTRI. Non risulta collegato
  ad alcun `qrcode.service.ts` perché quel file non esiste più — l'audit di
  luglio lo descriveva prima che il collegamento al PDF venisse fatto in P3.
- Nessuna occorrenza di `cbor`, `cose`, o `base45` (case-insensitive) in
  tutto il repository, a parte questo documento e le righe di audit citate
  sopra.
- Nessuna dipendenza CBOR/COSE/Base45 in `apps/backend/package.json`.

## Cosa manca esattamente per poter implementare, senza inventare

1. **Struttura del payload applicativo** (i campi del FIR che finiscono nel
   QR, in quale ordine, con quali tipi/etichette CBOR — interi o stringhe
   come chiavi di mappa, formati data, encoding dei codici EER/CER). Non
   basta sapere che è "CBOR": serve lo schema dei campi, analogo a come
   `NuovoFormularioModel` è versionato in `docs/contracts/rentri/formulari.yaml`
   per la creazione del formulario. Oggi non esiste un file equivalente per
   il QR.
2. **Intestazione e struttura COSE_Sign1** — quali `protected header
   parameters` sono richiesti (tipicamente almeno `alg`, es. ES256 vs altro),
   se è previsto un `kid` che referenzi il certificato del vidimante, se il
   payload è detached o embedded, se serve un `content type` CBOR tag
   (`18` per COSE_Sign1 secondo RFC 9052 generico — ma questo è lo standard
   COSE, non conferma quale profilo specifico usi RENTRI).
3. **Algoritmo e chiave di firma** — con quale credenziale si firma il QR: è
   la stessa chiave/certificato della firma remota CA RENTRI (vedi
   `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`, il flusso di
   boarding che produce un QR+PIN per il *boarding del certificato*, cosa
   diversa e non riusabile direttamente per firmare il QR del documento
   stampato), o una chiave distinta dedicata alla stampa? Nessuna fonte nel
   repository lo dice.
4. **Versione della regola tecnica** — le regole tecniche RENTRI hanno
   revisioni (si veda il pattern di versionamento già usato per il MUD,
   `docs/audits` cita 6.04/24 e 6.04/25). Non sappiamo quale versione della
   regola tecnica sul QR stampato sia in vigore al 2026-09-10, né se esiste
   un allegato tecnico specifico (spesso questi dettagli vivono in un
   "Allegato tecnico" o "Specifiche tecniche" pubblicati a parte
   dall'OpenAPI, come già osservato per il registro cronologico XSD in
   `docs/audits/rentri-divario-2026-09-10.md:93-97`).
5. **Conferma su Base45**: la codifica Base45 è normalmente usata (vedi EU
   DCC — green pass — RFC 9285) per comprimere payload COSE/CBOR firmati in
   un QR alfanumerico. È plausibile che RENTRI segua lo stesso schema
   generale del certificato digitale COVID EU, ma questa è un'ipotesi, non
   una fonte: nessun documento nel repository lo conferma per RENTRI.

## Dove andrebbe cercata la fonte ufficiale

- Le OpenAPI ufficiali scaricate (`docs/contracts/rentri/*.yaml`, servizi
  `formulari`, `vidimazione-formulari`, ecc. — vedi
  `docs/audits/rentri-conformita-2026-07-25/README.md:34`) sono state
  verificate: non contengono uno schema per il payload del QR stampato (il
  requisito è "una regola tecnica, non un endpoint", come indicato
  nell'incarico). Vanno ricontrollate ad ogni aggiornamento dell'OpenAPI, ma
  oggi non bastano.
- La **regola tecnica RENTRI** (decreto/allegato tecnico del Ministero
  dell'Ambiente o di RENTRI stesso) che disciplina la vidimazione e la
  stampa del FIR digitale — probabilmente lo stesso corpus normativo citato
  per il registro cronologico (XSD, nodo `eREGI`) — è il luogo più probabile
  dove la struttura del payload QR è definita formalmente. Non è presente
  nel repository.
- Il sito istituzionale RENTRI (`https://www.rentri.gov.it`) e l'area
  documentale del portale demo (`https://demoapi.rentri.gov.it/docs/...`),
  oltre alle FAQ ufficiali già usate altrove nel progetto (vedi
  `docs/audits/rentri-divario-2026-09-10.md`, sezione sul certificato `.p12`
  di interoperabilità) sono i canali da cui recuperare eventuali "Specifiche
  tecniche per la vidimazione digitale" o "Manuale operatore" con il dettaglio
  del QR.
- In assenza di documentazione RENTRI-specifica, un contatto diretto con
  RENTRI/il gestore del servizio (help desk RENTRI, o il canale usato per
  l'accreditamento all'interoperabilità già in corso secondo
  `docs/audits/rentri-divario-2026-09-10.md` §5) è la via più affidabile per
  ottenere la specifica esatta, dato che non risulta pubblicata insieme
  all'OpenAPI.

## Librerie candidate per Node/TypeScript (da valutare quando la specifica sarà nota)

- **CBOR**
  - `cbor` (npm, hildjj/node-cbor) — libreria matura, ampiamente usata,
    supporta encode/decode e tag CBOR; buona prima scelta se serve solo
    codifica/decodifica generica.
  - `cbor-x` — fork orientato alle performance di `cbor`, API compatibile in
    larga parte; da preferire se il volume di generazione QR diventa un
    collo di bottiglia (qui non è il caso, un FIR alla volta).
- **COSE**
  - `cose-js` (npm) — implementazione COSE (RFC 8152/9052) in JS, supporta
    `Sign1`; poco mantenuta di recente, da verificare compatibilità con la
    versione Node del progetto (20 LTS) prima di adottarla.
  - Nessuna libreria COSE "ufficiale" o dominante nell'ecosistema Node al
    2026: qualunque scelta va accompagnata da test di interoperabilità
    contro un verificatore di riferimento (es. lo stesso RENTRI o un
    validatore EU DCC, se il profilo è quello) — cosa che oggi non possiamo
    fare perché il profilo non è noto.
- **Base45**
  - `base45` (npm) — implementazione minimale di RFC 9285, usata anche da
    progetti EU DCC; piccola e diretta, buona scelta una volta nota la
    necessità reale del formato.
  - In alternativa è banale da implementare in poche righe (alfabeto fisso a
    45 caratteri), quindi non è la parte critica: la parte critica è sapere
    *cosa* codificare, non *come* codificarlo in Base45.

Nessuna di queste dipendenze è stata aggiunta al progetto in questa sessione.

## Cosa NON è cambiato in questa sessione

- `apps/backend/src/api/pdf/pdf.controller.ts` non è stato toccato: il QR
  applicativo (URL di verifica, livello M, libreria `qrcode`) resta
  invariato e continua a non essere il QR normato RENTRI.
- Nessun file nuovo sotto `apps/backend/src/infrastructure/rentri/qr/`.
- Nessuna dipendenza CBOR/COSE/Base45 aggiunta a `package.json`.

## Conclusione

Caso B: la specifica non è nel repository ed è incompleta anche cercando
fuori (nessun riferimento diretto a un documento tecnico scaricabile). Il
requisito è enunciato correttamente in tre punti dell'audit (§"Cosa chiede il
requisito" sopra), ma nessuno dei tre — né alcun ADR, né i contratti OpenAPI
versionati — specifica come costruire il payload. Implementare adesso
significherebbe indovinare il formato di un documento che va al RENTRI: la
mezza misura onesta è documentare il divario, non riempirlo con un'ipotesi.
