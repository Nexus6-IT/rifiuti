# Numero vidimato dall'ente e progressivo locale del formulario

Data: 2026-11-28. Stato: accettata. Chiude il Task 1 del piano
`docs/superpowers/plans/2026-09-12-collegamento-scorta-emissione.md`.

## Decisione

Il numero vidimato dall'ente RENTRI **convive** con `numeroProgressivo`, non lo sostituisce.

Fonti: manuale ministeriale RENTRI, Allegato 3 al DD 254 del 12/12/2024, §6 (numero FIR vidimato
virtualmente dall'ente), e il contratto OpenAPI `formulari.yaml` (`DatiPartenzaModel.numero_fir`). Per il
FIR digitale il numero ufficiale e' quello dell'ente; il progressivo locale e' un riferimento interno.

- `numeroProgressivo` (`FIR-AAAA-NNNNNN`) resta il riferimento interno per tenant e anno, usato da
  registro, PDF, fatture e MUD. Per il FIR digitale non cambia nessun documento prodotto.
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
- In MANUALE non si consuma (decisione 28/11): nulla parte da solo e l'ente assegna il numero alla
  trasmissione manuale. Il consumo in MANUALE arrivera' col pezzo PDF/QR.

## Conseguenze e punti aperti

- Un nuovo tentativo di invio ricostruisce lo stesso numero (lookup per `fir_id`), non ne consuma un
  altro. Cio' e' voluto per l'esito incerto (409 dedicato): la creazione e' idempotente sul numero.
- Un FIR annullato dopo l'emissione LASCIA il numero consumato, che non viene mai riusato (decisione 28/11).
- `num_iscr_sito` del corpo di creazione e' quello del numero consumato, non la sede principale al
  momento dell'invio.
- Il QR dell'ente nel PDF del formulario non e' collegato qui (piano, fuori da questo pezzo).
- **FIR cartaceo (futuro).** Un FIR stampato da WasteFlow nel formato vidimato virtualmente deve portare
  sul PDF il numero dell'ente e il suo QR (`qr_code_bytes` in scorta, Base64 -> Base45): la convivenza
  vale solo per il digitale. Sara' il pezzo PDF/QR, insieme al consumo in MANUALE.
- **Numero restituito diverso da quello inviato (decisione Graziano 28/11).** Il contratto attribuisce il
  numero richiesto, quindi non dovrebbe succedere. Se succede: nessun legame, FIR fermo con
  `RENTRI_NUMERO_FIR_DIVERSO` (non ritentabile) e l'avviso «verifica sul portale». L'utente annulla sul
  portale il formulario creato e annulla/rifa' il FIR; il numero vidimato resta consumato. Nessuna
  riapertura (una nuova POST creerebbe un doppione) e nessuna «accettazione» del numero dell'ente.
- Avvisi (fatti): form Nuovo FIR e voce cruscotto usano la stessa regola (`perTenant`): avviso/critico solo
  se l'emissione consuma davvero, e per il cruscotto solo per la sede da cui si consuma.
