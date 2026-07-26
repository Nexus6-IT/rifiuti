# ADR — La firma del FIR usa la firma remota RENTRI

**Data:** 2026-07-26
**Stato:** Accettata (decisione del committente)
**Contesto normativo:** eIDAS (Reg. UE 910/2014), D.M. 59/2023 art. 7 c. 3, DPCM 22/2/2013

## La domanda

Si può dare all'amministratore dell'azienda cliente la facoltà di caricare un
proprio certificato (contratto QTSP) da usare per firmare i formulari?

## Il vincolo che decide

**Una firma è qualificata solo se la chiave privata resta sotto controllo
esclusivo del firmatario** (eIDAS art. 3 p. 12 e Allegato II).

Se il cliente carica un `.p12` sul nostro server e noi firmiamo per suo conto,
quel controllo non esiste più: la chiave è accessibile a chi amministra il
server e a chiunque lo comprometta. La firma resta valida come operazione
crittografica ma **decade da qualificata**, e su un documento che vale in caso
di contestazione una firma non qualificata è peggio di nessuna firma, perché
dà una falsa sicurezza a chi la vede.

Aggravante specifica di questo progetto: oggi le credenziali RENTRI sono
cifrate a riposo con **un unico segreto applicativo condiviso**
(`RENTRI_CREDENTIAL_ENC_KEY`, variabile d'ambiente, nessun KMS, nessuna chiave
per tenant). Custodire anche le chiavi di firma di tutti i clienti dietro quel
singolo segreto sarebbe un bersaglio sproporzionato.

## Cosa dice il contratto RENTRI (verificato)

- RENTRI **non firma nulla**: `POST /{numero_fir}/hash` restituisce il
  `digest_to_sign`, la firma la calcola il chiamante con la chiave privata,
  e la si rimanda con `POST /{numero_fir}/acquisizione-firma`.
- Il contratto **non usa mai** le parole «qualificata», «avanzata» o
  «sigillo» (grep negativo su tutti e tre gli YAML). L'unico vincolo esplicito
  è il rinvio all'**art. 7 c. 3 del D.M. 59/2023**: se il certificato è
  intestato a una persona giuridica «deve riferirsi al soggetto firmatario».
  Coerentemente l'ente estrae dal certificato il **codice fiscale della persona
  fisica** (`identificativo_firmatario`), non quello aziendale.
- Esiste una terza via: `POST /{numero_fir}/invia-a-dispositivo`, che prende un
  `credentials_id` creato tramite le «API Firma remota RENTRI». In questa via
  **la chiave non passa mai da noi**.

## Decisione

1. **Si usa la firma remota RENTRI** (`invia-a-dispositivo` + `credentials_id`).
   È nativa dell'ente, non richiede all'azienda di procurarsi un contratto QTSP,
   e soprattutto non ci rende custodi di chiavi altrui.
2. **L'integrazione con un QTSP terzo via API CSC** (Cloud Signature
   Consortium — Aruba, InfoCert, Namirial) resta **opzionale, per sviluppi
   futuri**: serve all'azienda che ha già un proprio contratto e vuole usarlo.
3. **L'upload di una chiave privata per la firma non si fa.** Né ora né come
   scorciatoia temporanea.

Ciò che l'amministratore del tenant configura è quindi **una credenziale di
firma remota**, non un certificato con chiave: molto vicino a quanto chiesto,
senza spostare la custodia.

## Perché non il token USB come via principale

Il browser non dialoga con un token USB: servirebbe un software installato su
ogni postazione, con driver PKCS#11 e permessi IT del cliente. La via storica
(applet Java) è rimossa dai browser da anni. Per un SaaS multi-tenant con
utenti eterogenei non è percorribile come modalità primaria. Resta possibile
come ripiego manuale (scarica, firma in locale, ricarica) per il cliente che ha
già quel flusso.

## Cosa NON è stato verificato, e va chiarito prima di costruire

Questi due punti sono lacune reali, non dettagli: determinano cosa si
implementa.

1. **Il testo autentico del D.M. 59/2023 art. 7 c. 3.** I PDF ufficiali
   (Gazzetta Ufficiale, MASE, RENTRI) sono scansioni non estraibili. È la norma
   che stabilisce se serva un certificato di persona fisica e se un sigillo
   aziendale sia ammesso. Da leggere da fonte autentica.
2. **Le «API Firma remota RENTRI».** Il contratto le cita per nome ma **senza
   URL, versione o documento**, e non c'è alcun endpoint qui per creare o
   interrogare un `credentials_id`. Inoltre `invia-a-dispositivo` risponde 200
   senza corpo: **nessun id di transazione, nessun webhook**, quindi il
   contratto non dice come sapere se l'utente ha poi autorizzato sul
   dispositivo. Da chiedere all'ente.

Una fonte di settore (wastezero.it) elenca tre tipologie ammesse — firma
qualificata, firma avanzata CIE/CNS, certificato di firma remota RENTRI con OTP
su app — coerenti con questa decisione, **ma è una fonte secondaria**: vale come
indizio convergente, non come accertamento.

## Conseguenze sul lavoro già pianificato

- **R3 Task 3** («orchestrazione scrittura + firma») va riscritto: presuppone
  di riusare il meccanismo di firma interno di P3. Con questa decisione il
  compito diventa orchestrare `invia-a-dispositivo` e attendere l'esito, non
  calcolare una firma.
- Il provider `qes` (`qes-signature.provider.ts`) resta uno **stub che lancia
  sempre eccezione**. Con questa decisione non è più la strada principale: va
  o rimosso o marcato esplicitamente come ramo futuro (opzione 2), mai lasciato
  a suggerire una capacità che non c'è.
- La firma del ciclo di vita interno (provider sandbox, chiave effimera,
  `FIRMA-NON-QUALIFICATA`) **non acquista valore legale** per effetto di questa
  decisione: resta una firma applicativa interna. La decisione riguarda la
  firma del formulario verso l'ente.
