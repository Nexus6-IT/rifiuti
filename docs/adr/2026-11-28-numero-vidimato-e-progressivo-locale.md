# Numero vidimato dall'ente e progressivo locale del formulario

Data: 2026-11-28. Stato: accettata. Chiude il Task 1 del piano
`docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md`.

## Decisione

Il numero vidimato dall'ente RENTRI **convive** con `numeroProgressivo`, non lo sostituisce.

- `numeroProgressivo` (`FIR-AAAA-NNNNNN`) resta il riferimento interno per tenant e anno, usato da
  registro, PDF, fatture e MUD. Non cambia nessun documento prodotto.
- Il numero dell'ente vive nella scorta (`rentri_numeri_vidimati`, stato `USATO`, `fir_id`). Non si
  scrive in `FIR.rentriNumeroFir`: quel campo significa «legato a RENTRI» e blocca i metodi locali
  (`MetodoLocaleNonConsentitoSuFirLegatoError`), quindi si valorizza solo quando l'ente conferma.
- Nel corpo di creazione il numero entra in `dati_partenza.numero_fir` (`DatiPartenzaModel`, contratto
  `formulari.yaml`): «numero di vidimazione da attribuire al nuovo FIR digitale; se non specificato
  il sistema ne assegna uno».

## Quando si consuma

All'emissione, nella STESSA transaction che assegna il progressivo e salva il FIR, se il FIR e'
soggetto a RENTRI: modulo `rentri` attivo, modalita' AUTOMATICA o IBRIDA, certificato configurato,
FIR non bloccato all'invio (importato), sede principale presente. Sede = principale; blocco =
`codiceBloccoPredefinito` se configurato, altrimenti qualunque blocco della sede.

- Scorta esaurita: l'emissione fallisce con `SCORTA_RENTRI_VUOTA` (400, messaggio che dice cosa fare);
  mai un numero inventato.
- Emissione fallita dopo il consumo (firma, versione, annullamento): rollback, il numero torna
  `DISPONIBILE`.
- Due emissioni simultanee: `FOR UPDATE SKIP LOCKED` in un solo statement, numeri diversi.
- In MANUALE non si consuma: nulla parte da solo e l'ente assegna il numero alla trasmissione manuale.

## Conseguenze e punti aperti

- Un nuovo tentativo di invio ricostruisce lo stesso numero (lookup per `fir_id`), non ne consuma un
  altro. Cio' e' voluto per l'esito incerto (409 dedicato): la creazione e' idempotente sul numero.
- Un FIR annullato in bozza dopo l'emissione non restituisce il numero alla scorta (il numero e'
  gia' legato a un formulario emesso). Un eventuale riuso e' una decisione di prodotto separata.
- Il QR dell'ente nel PDF del formulario non e' collegato qui (piano, fuori da questo pezzo).
