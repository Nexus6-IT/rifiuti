# Confutazione in esecuzione, piano A (MUD): documento e fedeltà a WinWaste

Data: 2026-10-22. Oggetto: `docs/superpowers/plans/2026-10-21-fase0-a-mud.md` (Task 1-5 eseguiti fino a `085b15a`, Task 6-10 da eseguire). Riferimenti: `winwaste/docs/mud.md`, `confronto-con-rifiuti.md`, `confronto-rifiuti/03-adempimenti-integrazioni.md`, tracciato `docs/20250129_TracciatiRecord_MUD_V604-24-rev01.pdf` (estratto con `pdftotext -layout` e convertito in UTF-8, righe citate come `TR:n` di quell'estratto: possono differire di poche righe da quelle della Decisione 3, ottenute senza `-layout`), codice del worktree in sola lettura. Esclusi i punti già accolti o decisi nei giri 1-3 e in `decisioni-per-graziano.md`, salvo prove nuove (indicate come tali).

Severità: **Critica** = il file presentato contiene un dato sbagliato senza che nessuno lo dica; **Importante** = dichiarazione incompleta o incoerente, blocco senza rimedio, o traccia che non dimostra ciò che promette; **Minore** = usabilità o chiarezza.

## Rilievi

### A-W-01 — Critica — ATECO scritto col punto troncato in silenzio nel record AA

- **Dove:** Decisione 17, catalogo del Task 3 (`DICHIARANTE_SENZA_ATECO`), Task 4 (`mud-aggregazione.service.ts:419`), export (`mud-tracciato-v604-base.ts:330`).
- **Affermazione del piano:** l'anagrafica del dichiarante blocca solo se l'ATECO manca; per il resto il file è conforme.
- **Conseguenza:** la maschera dell'azienda propone come esempio `38.11.00` (`tenant-admin.component.ts:406`, `placeholder="es. 38.11.00"`), il DTO accetta 1-10 caratteri (`update-tenant.dto.ts:44`), e l'export scrive `mudAlfa(atecoCode, 6)`, che taglia a 6 caratteri: nel file finisce `38.11.`. Chi ha seguito l'esempio della maschera presenta ogni anno un MUD con un codice di attività inesistente, e il controllo del piano lo considera valido. Il tracciato vuole il codice ISTAT a 6 cifre della tabella "Ateco 2007 – aggiornamento 2022" (`TR:94`, `TR:842`). WinWaste ferma l'elaborazione su un ATECO non valido (`mud.md` §6, `erroateco`).
- **Evidenza:** lo spec del Task 4 usa proprio `atecoCode: '38.11.00'` come anagrafica "buona" (`mud-aggregazione.service.spec.ts:86`, `:747`); `toMudAscii` non toglie i punti (`mud-format.util.ts:33-42`).
- **Correzione proposta (ondata finale, prima del merge):** normalizzare l'ATECO togliendo punti e spazi in un solo punto, usato da aggregazione ed export; nuovo bloccante correggibile `DICHIARANTE_ATECO_NON_VALIDO` se dopo la normalizzazione non sono 6 cifre, con il messaggio di `DOVE_CORREGGERE_AZIENDA`; test di conformità che con `38.11.00` il record AA contiene `381100`. La validazione contro la tabella dell'anno resta il follow-up già deciso.

### A-W-02 — Importante — Non si può segnare come presentata una dichiarazione fatta altrove se l'aggregazione di oggi ha bloccanti

- **Dove:** Task 8, regole di `segnaPresentato` (422 `MUD_NON_GENERABILE`, poi 422 `MUD_AVVISI_DA_CONFERMARE`); Decisioni 15 e 22.
- **Affermazione del piano:** la Decisione 22 permette di segnare un anno "il cui file non è uscito da questa versione" con `fileTracciato: false`.
- **Conseguenza:** proprio i casi della Decisione 22 non passano. Il cliente che usava solo i FIR (DG-31) ha presentato il MUD 2025 col codice vecchio, ma oggi il registro 2025 è vuoto: `REGISTRO_VUOTO_CON_FIR` è bloccante e la segnatura risponde 422. Lo stesso per chi presenta con il software Unioncamere o con il consulente perché qui mancano RT/RE/MG o la ripartizione per sede, se l'aggregazione ha un CF o un peso specifico mancante. Il MUD resta `DRAFT` per sempre e il cruscotto lo dà da fare. In più gli si chiede di confermare "il file dichiara X kg in meno del registro" per un file che non ha generato: una conferma priva di senso, che però resta salvata come prova.
- **Evidenza:** piano righe 1188-1190; `fileTracciato` vale `false` esattamente quando `esportazioni` è vuoto (riga 1190), cioè quando il file non è uscito da qui.
- **Correzione proposta (piano, Task 8 prima dell'esecuzione):** se `fileTracciato` sarebbe `false`, la segnatura salta il 422 sui bloccanti e la conferma degli avvisi, e salva i controlli del momento come fotografia (`controlliAllaPresentazione`) con la dicitura della Decisione 22. Test: anno con `REGISTRO_VUOTO_CON_FIR` e senza esportazioni si segna; anno con esportazioni e bloccanti no.

### A-W-03 — Importante — L'hash salvato alla segnatura non è quello del file presentato

- **Dove:** Task 8 (`hash = hashAggregato(aggregato.righe)` ricalcolato alla segnatura; `fileTracciato = esportazioni.length > 0`); Decisione 11.
- **Affermazione del piano:** l'hash salvato permette di sapere se i dati sono cambiati "dopo la presentazione".
- **Conseguenza:** il dichiarante scarica il file a maggio (hash h1), firma e invia; poi annulla un FIR o salva un'integrazione (hash h2) e solo dopo segna "presentato". La traccia salva h2, `datiModificatiDopoPresentazione` è `false`, e `fileTracciato: true` fa credere che il file inviato corrisponda ai dati salvati. È proprio la divergenza che la Decisione 11 vuole mostrare. Ogni esportazione salva già il suo `hashAggregato` (`mud-export.service.ts:217`), quindi il collegamento costa poco.
- **Correzione proposta (piano, Task 8):** la segnatura si lega a un'esportazione (l'ultima, o quella scelta dall'utente nel dialogo del Task 9); l'hash di riferimento è quello di quell'esportazione; `fileTracciato` è vero solo se esiste quell'esportazione. Se l'hash attuale è diverso, la segnatura riesce ma lo stato parte già con `datiModificatiDopoPresentazione: true` e il dialogo lo dice prima della conferma. Test: esportazione h1, dati cambiati, segnatura → `true`.

### A-W-04 — Importante — La dichiarazione correttiva esce come seconda dichiarazione, non come sostitutiva

- **Dove:** Task 8 e 9 (`Dati modificati dopo la presentazione: verificare se serve una nuova dichiarazione.`); export (`mud-tracciato-v604-base.ts:352-353`).
- **Affermazione del piano:** dopo la presentazione la pagina segnala i dati cambiati e indica una nuova dichiarazione.
- **Conseguenza:** il record AA ha i campi "Annulla e sostituisce (NO = 0, SI = 1)" e "Data della comunicazione sostituita" (`TR:1458` e seguenti), ma l'export li scrive sempre `0` e `00000000`. Chi segue l'invito della pagina e rigenera il file presenta una seconda dichiarazione per la stessa unità locale e lo stesso anno, cioè le quantità dichiarate due volte, il rischio che la Decisione 13 evita per le sedi. Il piano ha già il dato che serve: `submittedAt` della presentazione.
- **Correzione proposta (piano, Task 8 più una riga nell'export):** se il `MUDReport` dell'anno è `SUBMITTED`, l'export mette "Annulla e sostituisce" a `1` con la data `submittedAt` (`AAAAMMGG`, giorno italiano), e il dialogo di conferma lo dice ("il file sostituisce la dichiarazione del gg/mm/aaaa"); il testo del tag del Task 9 diventa "…genera la dichiarazione sostitutiva". Test di conformità sul record AA. Da far confermare a un consulente se la sostitutiva vada usata anche dopo la scadenza.

### A-W-05 — Importante — Il destinatario estero blocca il file per sempre (prova nuova: regressione di G1-D-26)

- **Dove:** Decisione 3, Task 10 (`VoceCfDestinatarioDto`, `codiceFiscaleSoggettoValido`).
- **Affermazione del piano:** blocca solo ciò che l'utente può correggere nell'applicazione; il CF del destinatario si completa nelle integrazioni.
- **Conseguenza:** G1-D-26 era stato chiuso perché "un destinatario senza CF ora è un AVVISO, quindi un destinatario estero non blocca più" (`giro-1-esito.md:83`). G2-D-03 ha poi reso di nuovo bloccante `DESTINATARIO_SENZA_CF`, e nessuno ha ripreso il caso estero. Nel Task 10 il DTO accetta solo 11 cifre o 16 caratteri e il servizio verifica la cifra di controllo italiana: per un impianto tedesco o austriaco non c'è nulla da inserire, e il MUD di quel produttore non si genera più. Il tracciato prevede proprio "Nome della nazione (solo se trattasi di paese Estero)" e il codice del Reg. 1013/2006 nel DR (`TR:2283`, `TR:2302-2343`).
- **Correzione proposta (piano, Task 10):** una voce di integrazione "destinatario estero" con il nome della nazione (20 caratteri) al posto del CF; l'aggregazione la applica e il controllo diventa l'avviso `DESTINATARIO_ESTERO` (il codice Reg. 1013/2006 e le quantità per operazione restano follow-up). Test: un DR estero non blocca. **Inferenza (media)** che il portale accetti il CF vuoto con la nazione valorizzata: da includere nella prova di formato della Verifica finale.

### A-W-06 — Importante — Le giacenze al 31/12 sono nascoste e il riepilogo dice il falso

- **Dove:** catalogo `giacenzeNonCalcolate` (avviso senza kg, quindi "informativo", chiuso di default: Decisione 19), `riepilogaAvvisi` (`mud-controlli.ts:392`), Task 6 e 9; DG-27.
- **Affermazione del piano:** gli avvisi che riducono il dichiarato vengono prima e restano aperti; quelli informativi sono chiusi.
- **Conseguenza:** (a) l'omissione più pesante del file (tutti i rifiuti in deposito a fine anno, che il BA chiede divisi fra recupero e smaltimento, `TR:2067-2076`) finisce fra gli informativi, chiusa; e se è l'unico avviso la frase di testa è "Il file dichiara le stesse quantità del registro: gli avvisi sono informativi", falsa per chiunque abbia rifiuti in deposito. (b) `GIACENZE_NON_CALCOLATE` compare in **ogni** MUD con almeno una riga (`mud-aggregazione.service.ts:397`), quindi non esiste un export "senza avvisi": la regola DG-27 ("senza avvisi resta scaricabile da tutti") non si applica mai, e nessun `OPERATOR` scarica più un MUD (prova nuova su DG-27: la conseguenza descritta è più stretta di quella reale). WinWaste calcola la giacenza (`mud.md` §4.3-4.4).
- **Correzione proposta (piano, Task 6 e 9; una funzione nell'ondata finale):** senza toccare DG-32 (il campo resta a zero), quantificare l'avviso con il saldo del registro al 31/12 per CER (carichi meno scarichi in kg fino a fine anno, con il modulo unità del piano C), "secondo il registro, X kg in deposito al 31/12 non dichiarati". Con kg > 0 l'avviso conta fra quelli che riducono il dichiarato ed è aperto; la frase "stesse quantità" compare solo con saldo zero. Correggere la descrizione di DG-27 o decidere se l'avviso delle giacenze, da solo, debba richiedere un amministratore.

### A-W-07 — Importante — Scarico senza alcun destinatario: avviso informativo, mentre un nome senza CF blocca

- **Dove:** catalogo `DESTINATARIO_NON_INDICATO` (AVVISO, `incluso: true`, nessun kg escluso) contro `DESTINATARIO_SENZA_CF` (BLOCCANTE); Decisioni 2 e 3.
- **Affermazione del piano:** il DR è obbligatorio, quindi un DR senza CF blocca.
- **Conseguenza:** chi non ha scritto nulla nel registro ottiene il file; chi ha scritto il nome del destinatario è bloccato finché non trova il CF. Il file che esce ha nel BA "consegnato a terzi" (somma dei DR, `base.ts:494`) minore di recupero più smaltimento (che contano anche lo scarico senza DR): una scheda RIF incoerente, e l'avviso è fra gli informativi chiusi di default, sotto la frase "stesse quantità".
- **Correzione proposta (piano, Task 9; testo nell'ondata finale):** contare i kg senza modulo DR nel riepilogo (`kgSenzaDr`), aprire quell'avviso e dirlo nella frase di testa ("X kg conferiti senza modulo DR"). In alternativa (decisione per Graziano) un'integrazione "destinatario del movimento n." che renda anche questo un bloccante correggibile, come il CF.

### A-W-08 — Importante — Moduli TE: trasporto in proprio dichiarato come terzo, CF vuoto senza controllo, TE assente sugli scarichi senza FIR

- **Dove:** Task 4 (`aggiungiDestinatario`, `mud-aggregazione.service.ts:516-524`); catalogo `SCARICO_SENZA_FIR`; Decisione 3; follow-up "CF del trasportatore (TE) nelle integrazioni".
- **Affermazione del piano:** il TE viene dal FIR collegato; il CF del soggetto è obbligatorio nel record BB (Decisione 3), che vale per RT/DR/TE (`TR:2238-2239`).
- **Conseguenza:** (a) con il trasporto in proprio (art. 212 c. 8, citato dalla Decisione 3) il FIR ha il produttore come trasportatore e il file allega un modulo TE "rifiuti trasportati da terzi" con il CF del dichiarante stesso; (b) un trasportatore senza partita IVA sul FIR esce con CF vuoto, senza bloccante né avviso, contro la regola della Decisione 3; (c) uno scarico senza FIR non produce nessun TE e l'avviso `SCARICO_SENZA_FIR` parla solo del DR. WinWaste ricava i trasportatori dai movimenti (`Select tras,smal,sum(kgnum)`, `mud.md` §4.3), quindi anche senza formulario.
- **Correzione proposta (ondata finale + piano Task 10):** escludere dal TE il trasportatore con il CF del dichiarante (la valorizzazione di "rifiuto trasportato dal dichiarante" per un produttore va chiesta a un consulente, **inferenza media**); avviso `TRASPORTATORE_SENZA_CF` ora, con l'integrazione del CF del TE anticipata dal follow-up al Task 10 (stessa voce dei destinatari); aggiungere al testo di `SCARICO_SENZA_FIR` "e manca il modulo TE del trasportatore".

### A-W-09 — Importante — Il promemoria parla di "Completamento 0%" e di sezioni inesistenti, e il link non porta da nessuna parte

- **Dove:** Task 7 (riscrive la scadenza in `deadline-checker.service.ts` ma lascia il corpo del messaggio).
- **Affermazione del piano:** "i promemoria si fermano alla scadenza vera".
- **Conseguenza:** il promemoria che il Task 7 fa ripartire dice "Completamento: 0%" ed elenca come mancanti "Dati azienda, Rappresentante legale, Rifiuti ricevuti, Rifiuti trasportati, Certificati analitici", calcolati su chiavi di `reportData` (`companyInfo`, `certificates`…) che nessuno scrive (`deadline-checker.service.ts:894-955`). Il produttore riceve una lista di cose da fare che non esistono e nessuna delle vere (bloccanti e avvisi). Il link `/mud/${mudReport.id}` (`:141`, `:174`) non ha una rotta (`app.routes.ts:111` conosce solo `mud`). Il titolo "Promemoria Scadenza MUD 2025" usa l'anno dei dati, mentre il Task 9 introduce "2025 (MUD 2026)".
- **Correzione proposta (piano, Task 7):** togliere percentuale e lista; messaggio con la data, "MUD {anno+1} (dati {anno})" e, se possibile, il numero di bloccanti e avvisi dell'aggregazione (o soltanto l'invito ad aprire la pagina); link `/mud?anno={anno}`, letto dal Task 9 in `ngOnInit`. Test sul testo e sul link.

### A-W-10 — Importante (decisione per Graziano) — Nessuno stato "non dovuto": promemoria a chi non è obbligato

- **Dove:** Task 7 (promemoria a tutti i tenant `ACTIVE`/`TRIAL`), Task 8 (solo `SUBMITTED`).
- **Affermazione del piano:** il promemoria si ferma solo con la segnatura della presentazione.
- **Conseguenza:** non tutti i produttori devono presentare il MUD (art. 189 c. 3: per i rifiuti non pericolosi solo i produttori di cui all'art. 184 c. 3 lett. c, d, g con più di dieci dipendenti; i non pericolosi da costruzione e demolizione, lett. b, non sono obbligati; **inferenza alta**, da far confermare a un consulente). Chi non è obbligato riceve ogni anno i promemoria e vede il MUD "da fare", senza un modo per chiuderlo. WinWaste ha il flag "MUD S/N" per unità locale e soggetto (`mud.md` §4.7). Il tenant ha già `numeroAddetti` (`mud-export.service.ts:158`). Inoltre la Comunicazione rifiuti semplificata si presenta via PEC e non col file telematico (`TR:56-57`), e WinWaste lo dice all'utente (`mud.md` §6): il piano non lo nomina.
- **Correzione proposta:** decisione per Graziano. Predefinito suggerito: nel Task 8 un'azione "Segna come non dovuto" (status `ARCHIVED` con motivo, stessa traccia e stessi ruoli della segnatura), saltata dal Task 7; una riga fissa nella pagina sulla Comunicazione semplificata.

### A-W-11 — Importante — Stato fisico sempre "solido non polverulento", anche per i liquidi convertiti col peso specifico (prova nuova)

- **Dove:** Fuori ambito "Stato fisico per scheda RIF (A12): cambia la chiave di raggruppamento"; Decisione 6.
- **Affermazione del piano:** rinvio perché serve una chiave CER + stato fisico.
- **Prova nuova:** lo stato fisico sta sul movimento del registro, la fonte che il piano già legge (`WasteMovement.wastePhysicalState`, `schema.prisma`, "Solido/Liquido/Fangoso/…"), non solo sul FIR come diceva A12. E il piano stesso introduce il peso specifico proprio per spurghi, acque ed emulsioni (20 03 04, 16 10 02, 13 05 07*), che usciranno dichiarati "solido non polverulento".
- **Conseguenza:** per ogni rifiuto liquido o fangoso il BA dichiara uno stato fisico sbagliato, senza avviso.
- **Correzione proposta (ondata finale, costo piccolo):** se tutti i movimenti inclusi di un CER hanno lo stesso stato, usarlo (mappa nel codice verso i 7 flag del tracciato, `TR:1979-2000`); altrimenti il predefinito di oggi con l'avviso `STATO_FISICO_NON_UNIVOCO`. La divisione in più schede RIF resta follow-up.

### A-W-12 — Importante — "Prodotto fuori dall'unità locale" (modulo RE) attribuito in silenzio all'unità locale; il catalogo attribuisce RE agli impianti

- **Dove:** Decisione 13 e catalogo `profiloNonSupportato` ("i moduli RT, RE e MG che un impianto o un intermediario deve compilare"); Fuori ambito.
- **Affermazione del piano:** RE è un modulo dei gestori.
- **Conseguenza:** RE è il modulo del **produttore** per i rifiuti prodotti fuori dall'unità locale (cantieri, manutenzioni): il BA ha "Rifiuto prodotto fuori dell'unità locale" con il numero di moduli RE (`TR:2031-2041`). WinWaste lo calcola dai movimenti con comune e attività (`comu <> '' and tipa <> 'X'`, `mud.md` §4.3). Il piano mette tutto in "prodotto nell'unità locale" senza dirlo, e l'unico testo che nomina RE manda fuori strada. Riguarda edilizia, impiantistica e manutentori, cioè proprio l'esempio del Review Focus (17 04 05).
- **Correzione proposta:** testo del catalogo corretto ("RT e MG che un impianto o un intermediario deve compilare"; RE citato a parte); follow-up esplicito "prodotto fuori unità locale (RE)" con il campo sul movimento, e nella nota di migrazione (Fase 3) l'obbligo di conservare `comu`/`tipa` dei movimenti WinWaste. Un avviso automatico non è possibile senza il dato: basta una riga fissa nella pagina MUD.

### A-W-13 — Importante — Il CF della propria azienda rifiutato anche quando il destinatario è un proprio impianto

- **Dove:** Task 10, regola "Il codice … è quello della vostra azienda" (rilievo G3-D-07).
- **Conseguenza:** un'azienda che conferisce a un proprio impianto in un'altra unità locale ha legittimamente come destinatario il proprio CF. Se quel destinatario è scritto a mano nel registro, `DESTINATARIO_SENZA_CF` è bloccante e l'unico valore giusto è rifiutato: il MUD di quell'anno non si genera più (contro la Decisione 2). Lo stesso CF arrivato dal FIR invece passa senza controllo.
- **Correzione proposta (piano, Task 10):** trasformare il rifiuto in una conferma esplicita della voce (`confermaPropriaAzienda`, come `confermaFuoriIntervallo`), salvata e riportata nel log. Test con e senza conferma.

### A-W-14 — Minore — Numero di addetti a zero scritto in silenzio nel record AA

- **Dove:** export (`base.ts:332`, `mudNum(a.numeroAddetti ?? 0, 5)`); catalogo del Task 3.
- **Conseguenza:** con `numeroAddetti` vuoto il file dichiara 0 addetti nell'unità locale (campo del record AA, `TR:1374`), un dato che serve anche a capire l'obbligo (A-W-10).
- **Correzione proposta (ondata finale):** avviso `DICHIARANTE_SENZA_ADDETTI` con il punto in cui si corregge.

### A-W-15 — Minore — Il PDF di riepilogo può essere archiviato come se fosse il MUD

- **Dove:** Task 6 (`buildMUDContent`).
- **Conseguenza:** chi viene da WinWaste è abituato a stampare e archiviare i moduli del MUD (stampa e PDF dei modelli, `mud.md` §1.2, §5 punto 4). Il PDF del piano è un riepilogo per CER senza DR, TE e anagrafica.
- **Correzione proposta (piano, Task 6):** in testa al PDF "Riepilogo interno: non è il modello MUD. La dichiarazione è il file telematico firmato e inviato su mudtelematico.it", con un test.

### A-W-16 — Minore — Scadenze del registro senza fonte; promemoria verso un anno che l'export non supporta

- **Dove:** Task 7, Decisione 12.
- **Conseguenza:** le date 28/06/2025 e 03/07/2026 non hanno la fonte (Gazzetta Ufficiale del DPCM) nel codice: non sono verificabili e la prossima andrà ricostruita da capo. Con il ripiego al 30 aprile per un anno senza tracciato il promemoria manda l'utente a una pagina il cui export risponde 404 "anno non supportato" (lo stesso problema di `bloccamud` in WinWaste, `mud.md` §2.1).
- **Correzione proposta (piano, Task 7):** campo `fonteScadenza` (riferimento al DPCM) accanto a `scadenzaPresentazione`; con `fonte: 'ORDINARIA'` il promemoria aggiunge "il tracciato dell'anno non è ancora disponibile nell'applicazione".

### A-W-17 — Minore — La segnatura non conserva gli estremi della ricevuta

- **Dove:** Task 8 (`SegnaPresentatoDto`); raccomandazione 6 del rapporto 03 ("segnarlo come presentato con la ricevuta caricata").
- **Conseguenza:** l'upload della ricevuta è un follow-up deciso, ma senza neanche il numero di protocollo la traccia non collega la segnatura a un invio reale.
- **Correzione proposta (piano, Task 8):** campo facoltativo `protocolloRicevuta` (testo, max 50) nel DTO, in `reportData` e nel log `MUD_PRESENTATO`.

### A-W-18 — Minore — `OPERAZIONE_NON_INDICATA` e `OPERAZIONE_DEDOTTA_DAL_FIR` spostano kg fra recupero e smaltimento ma restano "informativi"

- **Dove:** `riepilogaAvvisi` (Task 3), dialogo del Task 9.
- **Conseguenza:** i kg sono nel file, ma nei campi sbagliati del BA e dei DR; il riepilogo li chiude di default e può dire "stesse quantità del registro".
- **Correzione proposta (Task 9 e ondata finale):** contare `kgClassificatiSmaltimento` e mostrarli nella voce, aperta se > 0.

## Cosa regge

- **Fonte = registro, data del movimento, anno italiano** (Decisioni 1 e 8): è la regola giusta e corregge il difetto 4 di WinWaste (`mud.md` §8.4, nessun filtro su `dtuk`).
- **Causali mappate nel codice** e non dal testo (Decisione 4): evita il difetto 8 di WinWaste (cali e rettifiche riconosciuti dalla descrizione).
- **Nessuna correzione dei dati sorgente**: il controllo non modifica i movimenti, al contrario di `RICOSISTATFUORIUL` di WinWaste (`mud.md` §8.3); le integrazioni stanno nel `reportData` dell'anno.
- **Unità e soglia delle tonnellate** (Task 1, Decisioni 6-7): conformi al tracciato (kg o t accanto a ogni quantità), formato indipendente dalla cultura (difetto 2 di WinWaste evitato), controllo di lunghezza in `generate()` come le eccezioni di `Esportazione`.
- **Stati del FIR, doppi storici, conferma quantitativa con traccia** (Decisioni 14, 19, 20): più rigorosi di WinWaste, che non filtra annullati e bozze (`mud.md` §8.5).
- **Scadenza come dato del tracciato** (Task 7): toglie l'equivalente dell'anno scritto nel codice (`mud.md` §8.6), con ripiego che non lascia i clienti senza promemoria.
- **Segnatura con storico e annullamento che conserva la traccia** (Task 8): risolve il marcatore incoerente `(FIle)`/`(File)` di WinWaste (§8.10), a patto di legarla al file esportato (A-W-03).
- **Etichetta "Anno dei dati (MUD anno+1)"** (Task 9): coincide con `Labmud = "MUD " + (anno+1)` di WinWaste.
- **Controllo del CF con carattere di controllo e della partita IVA** (Task 10): allinea il piano a `okfisc`/`okpiva` di WinWaste, con le eccezioni di A-W-05 e A-W-13.

## Conteggi

- Critica: 1 (A-W-01)
- Importante: 12 (A-W-02 … A-W-13)
- Minore: 5 (A-W-14 … A-W-18)
