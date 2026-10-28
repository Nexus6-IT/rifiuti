# Confutazione del codice — Piano A (MUD), Task 1–5

Perimetro: `git diff 23c5a17..085b15a` (il codice di aggregazione è identico anche a HEAD `f6ac73b`; dove `f6ac73b` cambia qualcosa lo dico). Non ripeto i punti già decisi in `progress.md`, `preflight.md` (A1–A17) e `task-N-review.md`: niente conferma per codice invece che per hash (limite accettato nella Decisione 19), niente `GIACENZE_NON_CALCOLATE` che blocca i non amministratori (corretto in `f6ac73b`), niente test mancante sulla coppia mista pre/post piano C.

Prove: le suite MUD girano verdi (`src/application/mud` + `src/api/mud`: 11 suite, 169 test). Gli scenari A-C-01, A-C-02, A-C-03, A-C-04 e A-C-07 li ho riprodotti con spec di scratch fuori dal worktree, che importano il codice reale (`MudAggregazioneService`, `MudExportService`, `MudVersionRegistry` e il tracciato v6.04 veri, Prisma finto). L'output è riportato sotto ogni rilievo.

Riepilogo: **0 Critiche, 6 Importanti, 8 Minori.**

---

## Importanti

### A-C-01 — Il bloccante sul comune del dichiarante si aggira con la provincia vuota: il record AA esce con ISTAT `000;000`
- **Severità:** Importante
- **Dove:** `aggregazione/mud-aggregazione.service.ts:201-203` e `:416-418` contro `export/mud-export.service.ts:117-120` (in 085b15a `:117-121`)
- **Affermazione:** il controllo e il file risolvono il comune in due modi diversi.
  - L'aggregazione cerca il comune se c'è `tenant.city`, anche senza provincia (`findComuneByName(city, province ?? undefined)`).
  - L'export lo cerca solo se ci sono **sia** `city` **sia** `province`.
  - Con la provincia nulla, che è il caso dei tenant creati dal signup self-service (il commento a `mud-export.service.ts:115-116` lo dice), il controllo trova il comune e non emette `DICHIARANTE_SENZA_COMUNE_ISTAT`. Il file però scrive `000` come provincia e come comune, sia per l'unità locale sia per la sede legale.
- **Scenario:** tenant con `city: 'Roma'` e `province: null`. Il riepilogo non mostra bloccanti, l'ADMIN conferma l'unico avviso e scarica. Il record AA dichiara il comune `000/000`: proprio il caso che il bloccante doveva impedire. In più, la ricerca per solo nome su comuni omonimi (per esempio Samone TO/TN, Calliano AT/TN) restituisce il primo che trova. Il controllo passa anche quando il comune è ambiguo.
- **Evidenza:** spec di scratch con aggregazione ed export reali. I controlli erano `[ 'GIACENZE_NON_CALCOLATE' ]`, e il record AA:
  `AA;2024;12345678903     ;000000000000001;38.11.;000000000;00000;PROD SRL …;000;000;VIA X …;000;000;VIA X …`
- **Correzione proposta:** una sola risoluzione del comune.
  - `aggrega` restituisce `comuneDichiarante` (oppure il codice) in `MudAggregato`, e l'export lo usa invece di rifare la query.
  - La regola del bloccante diventa "manca la provincia, oppure il comune non si trova con quella provincia". Il messaggio chiede di inserirla.
  - Test: tenant con `province: null` → `DICHIARANTE_SENZA_COMUNE_ISTAT` presente e 422.

### A-C-02 — Un ATECO scritto con i punti passa il controllo e il file lo tronca (`38.11.`)
- **Severità:** Importante
- **Dove:** `aggregazione/mud-aggregazione.service.ts:419`. Il campo esce da `export/versions/mud-tracciato-v604-base.ts` `recordAA`: `mudAlfa(a.atecoCode ?? '', 6)`.
- **Affermazione:** `DICHIARANTE_SENZA_ATECO` controlla solo che il campo non sia vuoto.
  - Il tracciato chiede "Codice ISTAT attività svolta (**senza punti e lettere** allineato a sinistra) alfa 6", con codici a 6 cifre (PDF, righe 1366 e 842-843 del testo estratto).
  - `atecoCode` si salva così come viene digitato: `update-tenant.dto.ts` ha solo `@Length(1, 10)`, e `tenant.service.ts:271` e `:442` non chiamano `normalizeAteco`.
- **Scenario:** l'amministratore scrive l'ATECO nella forma ISTAT abituale `38.11.00`. Nessun bloccante scatta, e il file contiene `38.11.`: un codice inesistente che il validatore ufficiale rifiuta o decodifica male. È un dato del dichiarante correggibile nell'applicazione, quindi per la Decisione 2 dovrebbe bloccare. La fixture di default della spec di aggregazione usa proprio `atecoCode: '38.11.00'` (`mud-aggregazione.service.spec.ts`, `beforeEach`): la suite resta verde su un dato che produce un file sbagliato.
- **Evidenza:** stessa spec di A-C-01. Il record AA contiene `;38.11.;`.
- **Correzione proposta:** nell'export, `normalizeAteco(a.atecoCode)` (quello di `reference-data.service.ts:137`) prima di `mudAlfa`. Nel catalogo, il controllo diventa bloccante anche quando il valore normalizzato non è di 6 cifre, con un testo dedicato (per esempio "Codice ATECO dell'azienda non valido: servono 6 cifre…"). Test: `'38.11.00'` deve dare `;381100;`, e `'38.11'` deve dare il bloccante.

### A-C-03 — I doppi si cercano prima della classificazione e senza guardare la causale: il conferimento vero può sparire, mentre l'avviso dice "contata una volta sola"
- **Severità:** Importante
- **Dove:** `aggregazione/mud-aggregazione.service.ts:237-258` (passo 0), poi `:276-285`. `stessiDatiRicopia` (`registro/ricopia-fir.ts:26-32`) confronta CER, quantità, unità e data, non la causale.
- **Affermazione:** il passo 0 sceglie come originale il primo movimento del gruppo `firId|type`, prima di sapere se verrà contato. Un doppio storico con causale diversa viene quindi scartato anche quando è proprio lui il movimento conteggiabile.
- **Scenario:** dati storici (pre piano C), con il registro immutabile e nessuna rettifica possibile.
  - Il movimento n. 1 è uno SCARICO `ALTRO_SCARICO` sul FIR X, 100 kg, del 01/03. È un errore di causale.
  - Il movimento n. 2 è lo SCARICO `CONFERIMENTO_TRASPORTATORE` sullo stesso FIR, 100 kg, del 05/03. È la registrazione corretta.
  - Il n. 2 diventa "doppio" del n. 1, e il n. 1 è escluso per causale. Risultato: zero righe, il conferimento manca dal MUD.
  - L'avviso `FIR_DOPPIO_IDENTICO` dice "nel MUD la quantità è contata una volta sola", mentre è contata zero volte.
- **Evidenza (scratch):**
  `RIGHE []`
  `FIR_DOPPIO_IDENTICO … "nel MUD la quantità è contata una volta sola." movimenti: [{numero 1, incluso:false},{numero 2, incluso:false}]`
  `RIEP Il file dichiara 200 kg in meno del registro …`
  A11 ha previsto `incluso:false` sull'originale escluso dopo, ma non il caso in cui il doppio sarebbe stato contato.
- **Correzione proposta:** cercare i doppi solo fra i movimenti che superano la classificazione e la collegabilità, cioè dopo i passi 1 e 2, in un ciclo a due fasi. In alternativa, aggiungere a `stessiDatiRicopia` (solo nella chiamata del MUD) anche l'uguaglianza del ruolo (`classificaMovimento`). Test: la coppia `ALTRO_SCARICO` + `CONFERIMENTO_TRASPORTATORE` sullo stesso FIR deve dare 100 kg dichiarati, un solo `CAUSALE_ESCLUSA` e nessun `FIR_DOPPIO_IDENTICO`.

### A-C-04 — Uno scarico senza destinatario fa uscire un BA incoerente (consegnato a terzi < recupero + smaltimento), e il riepilogo dice "stesse quantità del registro"
- **Severità:** Importante (il comportamento è voluto dal piano, test 19 del Task 4; il rilievo riguarda il piano)
- **Dove:** `aggregazione/mud-aggregazione.service.ts:348-352` e `:493-495`. Il campo esce da `mud-tracciato-v604-base.ts` `recordBA`: "consegnato a terzi" = `sommaQuantita(r.dr)`, mentre "complessiva avviata a recupero/smaltimento" = `r.recuperoKg` e `r.smaltimentoKg`.
- **Affermazione:** per `DESTINATARIO_NON_INDICATO` il messaggio dice "La quantità è nel MUD". In realtà la quantità entra in recupero o smaltimento ma **non** nel campo "Rifiuto consegnato a terzi per recu./smal.", che è la somma dei DR. Il BA dichiara quindi due totali diversi per lo stesso conferimento. `riepilogaAvvisi` non vede la differenza, perché il movimento è `incluso: true`.
- **Scenario:** due scarichi da 100 kg, uno con `counterpartName: 'Eco Srl'` e uno senza. Il BA risulta così:
  - consegnato a terzi = 100;
  - avviata a recupero = 200;
  - riepilogo: "Il file dichiara le stesse quantità del registro: gli avvisi sono informativi."

  Dopo `f6ac73b` questo avviso conta come "informativo", quindi lo conferma anche un VIEWER: nessun amministratore vede il buco.
- **Evidenza (scratch):**
  `RIGHE [{"cerCode":"170405",…,"recuperoKg":200,…,"dr":[{"codiceFiscale":"","ragioneSociale":"Eco Srl","quantitaKg":100}]}]`
  `RIEP Il file dichiara le stesse quantità del registro: gli avvisi sono informativi.`
- **Correzione proposta (da decidere):** due strade.
  - **(a)** `DESTINATARIO_NON_INDICATO` diventa un dato da integrare, come il CF. Per esempio una voce "destinatario del movimento n. X" nelle integrazioni, oppure un bloccante con il rimedio "registrare… / integrare".
  - **(b)** Si accetta l'incoerenza, ma il catalogo dice il vero ("la quantità è nel totale avviato a recupero/smaltimento ma non fra le quantità consegnate a terzi"). In più, `riepilogaAvvisi` e `avvisiCambianoQuantita` contano quei kg come quantità che cambia, quindi la conferma resta riservata agli amministratori.

  In entrambi i casi serve un test che fissi l'uguaglianza BA "consegnato a terzi" = Σ DR, e il rapporto con recupero + smaltimento che il piano sceglie.

### A-C-05 — Doppi e FIR scaricati più volte a cavallo d'anno non si vedono: la stessa quantità può essere dichiarata in due MUD
- **Severità:** Importante
- **Dove:** `aggregazione/mud-aggregazione.service.ts:132-133` (solo movimenti della finestra), `:237-258` (doppi) e `:389-393` (`FIR_SCARICATO_PIU_VOLTE`)
- **Affermazione:** il codice stesso dice che "la ricopia prendeva la data di oggi" prima del piano C (`:247`). Un doppio storico può quindi cadere nell'anno dopo l'originale. La ricerca dei doppi e quella dei FIR scaricati più volte guardano però solo i movimenti dell'anno. Per `FIR_NON_REGISTRATO` il codice cerca invece gli scarichi "registrati in qualunque anno" (`:188-195`): quindi sa che l'anno di registrazione può essere diverso da quello del trasporto.
- **Scenario:** il FIR X ha il trasporto il 30/12/2025.
  - Il movimento n. 812/2025 del 30/12/2025 è contato nel MUD 2025, che viene presentato.
  - Il 03/01/2026 l'utente lo ricopia di nuovo (pre piano C), e nasce il movimento n. 4/2026 con la data del giorno.
  - Il MUD 2026 conta i 100 kg una seconda volta, senza nessun avviso: il movimento non ha doppi nella finestra, il FIR è collegabile e c'è un solo scarico nel 2026.
  - Lo stesso succede con due scarichi a dati diversi dello stesso FIR in due anni (`FIR_SCARICATO_PIU_VOLTE` assente).
- **Evidenza:** lettura del codice. La query `wasteMovement.findMany` ha solo `movementDate: { gte: inizio, lt: fine }`, e i gruppi del passo 0 e `avviatiPerFir` si costruiscono solo su quei movimenti.
- **Correzione proposta:** una query in più, `wasteMovement.findMany({ where: { tenantId, firId: { in: firIdsAnno }, movementDate: { lt: inizio } } })`. Un movimento dell'anno che ha un gemello negli anni precedenti (stessi dati senza data per i pre-C, oppure lo stesso FIR e tipo) dà un avviso che esclude o segnala, per esempio `FIR_GIA_SCARICATO_ANNO_PRECEDENTE` con `incluso` da decidere. È un nuovo codice nel catalogo, quindi va deciso nel piano. Test: originale nel 2025 e doppio pre-C nel 2026 → MUD 2026 con avviso.

### A-C-06 — Chi può confermare dipende dal ruolo globale dell'utente, non dal suo ruolo nell'azienda su cui sta lavorando
- **Severità:** Importante
- **Dove:** `api/mud/mud.controller.ts` (`{ id: req.user.id, role: req.user.role }`) e `export/mud-export.service.ts:96`
- **Affermazione:** `req.user.role` è lo `UserRole` globale letto da `JwtStrategy`. Il tenant effettivo arriva invece da `X-Tenant-ID`, validato da `MembershipService.checkAccess`, che accetta anche le associazioni consulente. `ConsultantTenantAssociation` ha un suo `roleId` per azienda (`schema.prisma:1508-1522`), e il controllo lo ignora.
- **Scenario:** un consulente è `ADMIN` del proprio studio (tenant A) ed è associato all'azienda cliente B con un ruolo di sola consultazione. Seleziona B e, in quanto `ADMIN`, conferma gli avvisi che tolgono kg dal MUD di B: l'atto "con il peso giuridico maggiore" (Decisione 19), fatto da chi in B non ha quel potere. Vale anche per la discesa gerarchica madre → figlie, anche se lì il commento in `membership.service.ts:137-140` lo dichiara voluto.
- **Evidenza:** lettura di `jwt.strategy.ts` (il ruolo viene dalla riga `user`), `tenant-switch.interceptor.ts:63-95` e `membership.service.ts:113-135`. È lo stesso schema di `RolesGuard` in tutta l'applicazione. Qui però la regola è nuova e mirata.
- **Correzione proposta:** il servizio riceve il ruolo **effettivo** sul tenant della richiesta. Una via: un helper `ruoloEffettivo(req)` che, se il tenant è diverso dal primario e non ne è proprietario, legge il ruolo dell'associazione. In alternativa, la conferma si riserva al ruolo globale solo quando il tenant è il primario o è di proprietà dell'utente. Se la scelta è accettare il modello globale, va scritta nella Decisione 19.

---

## Minori

### A-C-07 — Un TE senza codice fiscale esce con 16 spazi, senza nessun controllo
- **Dove:** `aggregazione/mud-aggregazione.service.ts:511-518`
- **Affermazione:** `chiaveTe = carrierId || carrierPartitaIva` e `codiceFiscale: carrierPartitaIva || ''`. `fir-prisma.repository.ts:678` salva `carrierPartitaIva: trasportatore?.partitaIva || ''`. Per i TE il tracciato valorizza "solo CF e ragione sociale" (nota al record BB): un CF vuoto rende il modulo invalido. Per il DR c'è un bloccante con integrazione, per il TE niente.
- **Evidenza (scratch):** FIR con `carrierId: 'car-1'` e `carrierPartitaIva: ''` → `TE [{"codiceFiscale":"","ragioneSociale":"Tra"}]`, con i soli controlli `DESTINATARIO_SENZA_ISTAT, GIACENZE_NON_CALCOLATE`.
- **Correzione:** caricare l'anagrafica del trasportatore come per i destinatari, oppure aggiungere `TRASPORTATORE_SENZA_CF` (bloccante con integrazione, come `DESTINATARIO_SENZA_CF`). Il codice è nuovo, quindi va deciso nel piano.

### A-C-08 — `integrazioniUsate` della traccia può non essere quella con cui è stato calcolato il file
- **Dove:** `export/mud-export.service.ts:179` (`leggiIntegrazioni(p)` letto sotto il lock), contro `aggregazione/mud-aggregazione.service.ts:211-215` (integrazioni lette prima, fuori dal lock e dalla transaction)
- **Scenario:** l'export A calcola i kg con il peso specifico 1,0. Intanto il PUT delle integrazioni (Task 10) salva 1,5. A scrive la traccia con `integrazioniUsate` = 1,5 e un `hashAggregato` calcolato con 1,0. La traccia, che è la prova del rilievo G3-D-06, si contraddice.
- **Correzione:** `MudAggregato` restituisce le `integrazioni` lette, e la traccia salva quelle. La segnatura del Task 8 deve fare lo stesso.

### A-C-09 — Quantità fuori formato o record di lunghezza errata: `Error` generico, cioè un 500 senza rimedio
- **Dove:** `export/mud-format.util.ts:101-103` e `versions/mud-tracciato-v604-base.ts` `generate()` (il controllo della lunghezza)
- **Scenario:** uno scarico registrato con unità `T` e quantità `12000000` (i kg scritti nel campo delle tonnellate) è ammesso da `numeric(10,2)`. `mudQtyUm` lancia `Error`, e il filtro globale risponde 500 "Internal server error". Il registro è immutabile, quindi il MUD di quell'anno non si genera mai più, e l'utente non sa perché.
- **Correzione:** intercettare l'errore nell'export e restituire una 422 con il CER e la quantità. Meglio ancora, un controllo nell'aggregazione che indichi il movimento.

### A-C-10 — Se tutti i movimenti sono esclusi, il file esce con zero schede RIF e senza nessun bloccante
- **Dove:** `aggregazione/mud-aggregazione.service.ts:397-404`. `NESSUN_MOVIMENTO` scatta solo con `movimenti.length === 0`.
- **Scenario:** un registro dell'anno con soli carichi `INGRESSO_ESTERNO` (`PROFILO_NON_SUPPORTATO`), oppure con soli scarichi su FIR annullati. Le righe sono `[]`, mancano sia `GIACENZE` sia `NESSUN_MOVIMENTO`, e dopo la conferma esce un MUD "vuoto" (AB con `000000` schede RIF).
- **Correzione:** con `righeFinali.length === 0` emettere comunque `NESSUN_MOVIMENTO` (bloccante), oppure un codice dedicato. Va deciso.

### A-C-11 — Un CER senza 6 cifre (righe storiche) produce un BA con il CER troncato o vuoto
- **Dove:** `aggregazione/mud-aggregazione.service.ts:311`, poi `chiaveSchedaRif` → `mudAlfa(normalizeCer(r.cerCode), 6)`
- **Affermazione:** oggi la registrazione valida il CER sul catalogo (`registra-movimento.use-case.ts:105-113`), ma il DTO accetta qualunque stringa fino a 10 caratteri, e le righe storiche possono essere precedenti a quel controllo. Un codice di 7 o più cifre viene troncato a 6, e può fondersi nel file con un CER vero. Uno senza cifre diventa sei spazi.
- **Correzione:** un avviso o un bloccante "CER non valido" sulle righe con `cerSoloCifre(c).length !== 6`, ed esclusione della riga.

### A-C-12 — `hashAggregato` non copre il dichiarante né le schede AU
- **Dove:** `aggregazione/mud-regole.ts:97-112`
- **Affermazione:** il Task 8 userà l'hash per "il controllo dei dati cambiati dopo la presentazione". Una correzione di ATECO, comune, indirizzo o autorizzazioni dopo la presentazione cambia il file (AA/AU) ma non l'hash. È quindi invisibile.
- **Correzione:** dichiararlo come limite nel piano, oppure aggiungere all'input dell'hash l'anagrafica usata nel record AA e le autorizzazioni.

### A-C-13 — Il codice fiscale di DR e TE non viene mai validato nel formato
- **Dove:** `aggregazione/mud-integrazioni.ts:187-192` (accetta qualunque stringa non vuota), e i CF presi da FIR e anagrafica (`mud-aggregazione.service.ts:478` e `:515`)
- **Scenario:** un JSON delle integrazioni con `codiceFiscale: "N/D"` (scritto a mano o da una versione precedente), oppure un FIR con `receiverPartitaIva: '00000000000'`. `DESTINATARIO_SENZA_CF` non scatta, e il file contiene un CF che il validatore rifiuta. Il Task 10 valida solo in scrittura.
- **Correzione:** `leggiIntegrazioni` scarta i CF che non passano `codiceFiscaleSoggettoValido` (Task 10) o il controllo della P.IVA. Per i CF da FIR, un avviso.

### A-C-14 — (fuori perimetro, `f6ac73b`) `OPERAZIONE_NON_INDICATA` e `OPERAZIONE_DEDOTTA_DAL_FIR` contano come "informativi", ma spostano kg fra recupero e smaltimento
- **Dove:** `export/mud-export.service.ts` (`avvisiCambianoQuantita` in HEAD)
- **Affermazione:** questi movimenti sono `incluso: true` con 0 kg esclusi o aggiunti. Un VIEWER può quindi confermare la scelta "smaltimento" per kg che il registro non qualifica: è una scelta sul contenuto della dichiarazione (BA recupero/smaltimento, e il totale che vedrà il PDF).
- **Correzione:** decidere se la ripartizione R/D conta come "cambia le quantità". Se sì, aggiungere i due codici all'elenco che richiede l'amministratore.

---

## Cosa ho verificato e regge

- **Isolamento dei tenant.** Ogni query di `aggrega` porta `tenantId` (movimenti, FIR collegati, FIR dell'anno con la firma del trasportatore, scarichi dei FIR, tenant, unità locali, `mUDReport`, destinatari). Un `firId` che punta al FIR di un altro tenant finisce in `FIR_NON_TROVATO` e il DR arriva dal registro: niente fuga di dati. Lo stesso vale per `caricaAutorizzazioni` e `aggiornaReportData` (`tenantId_year`).
- **Finestra dell'anno.** `limitiAnnoMud` usa i limiti `[31/12 23:00Z, 31/12 23:00Z)`, giusti perché a cavallo d'anno l'Italia è sempre in UTC+1. Il risultato è coerente con `annoSolareItaliano` e funziona sia con colonne `DateTime` sia con date a mezzanotte UTC.
- **Ordine dell'export.** Prima il 404 sull'anno non supportato, poi il tenant, l'aggregazione, la 422 sui bloccanti, il 403 e la 422 sugli avvisi, infine il file e la traccia. Il ricalcolo lato server è vero: i codici confermati si confrontano con quelli ricalcolati, e la traccia salva quelli ricalcolati, non la lista del client. Un codice sconosciuto nella query non ha effetto.
- **Lock di `aggiornaReportData`.**
  - È un advisory lock `xact` preso prima della lettura, con la chiave parametrizzata nel template tagged.
  - Le chiavi del JSON restano intatte (`{...p}`), e una forma inattesa vale come `{}`.
  - Il revisore del Task 5 ha dimostrato su Postgres che senza lock gli aggiornamenti si perdono. `f6ac73b` aggiunge il caso con il record già presente.
  - Fuori da `mud-report-data.ts`, l'unica scrittura di `mUDReport` è la `create` del deadline-checker, che spetta al Task 7.
- **Formato quantità.** `mudQtyUm` passa a tonnellate da 9.999.999,9995 kg in su, e arrotonda prima al kg e poi alla tonnellata con 3 decimali. `mudQty` gestisce il riporto dei decimali (`dec >= 1000`). Ogni campo ha la sua unità di misura, come vuole il tracciato (ricontrollato sul PDF, BA righe 2004-2094). Il controllo delle lunghezze dei 12 tipi di record corrisponde alle "Lunghezza totale record" del PDF.
- **Unità e peso specifico.** Le unità non di massa senza peso specifico sono bloccanti e non finiscono nel file. Con il peso specifico, il kg è arrotondato al grammo per movimento, e la somma coincide con quella del messaggio `CONVERTITO_CON_PESO_SPECIFICO`. La chiave è sempre `chiavePesoSpecifico` (CER sulle cifre e unità normalizzata).
- **Collegabilità del FIR prima dell'unità (Decisione 23).** Nessun bloccante su un movimento escluso perché il FIR è annullato o in bozza.
- **DR.** La fusione per CF avviene dopo le integrazioni, il rappresentante è quello con FIR, l'arrotondamento viene dopo la somma. Due ragioni sociali che differiscono solo per gli spazi finiscono nello stesso DR attraverso la fusione per CF. Il conteggio dei DR nel BA deriva dagli allegati emessi.
- **Hash.** `hashAggregato` non dipende dall'ordine (righe, dr, te, rt, re e mg ordinati, numeri a 3 decimali). Il generatore non modifica `aggregato.righe` prima dell'hash.
- **Riepilogo.** `kgInMeno` deduplica per `anno/numero`, che è univoco per tenant (`@@unique([tenantId, progressiveYear, progressiveNumber])`). Un movimento escluso da due avvisi non viene contato due volte.
- **Errori HTTP.** La 422 e il 403 passano per il filtro globale con `error` e `details`. Il parametro `avvisiConfermati` ripetuto è gestito in `f6ac73b`.
