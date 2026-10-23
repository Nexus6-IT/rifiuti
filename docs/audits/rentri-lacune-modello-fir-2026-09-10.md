# Lacune fra il modello dati FIR e il contratto RENTRI (formulari) — 2026-09-10

**Oggetto**: censimento campo-per-campo fra `NuovoFormularioModel` (contratto
ufficiale `docs/contracts/rentri/formulari.yaml`) e il modello dati interno
(`apps/backend/prisma/schema.prisma`, modelli `FIR`, `Produttore`,
`Trasportatore`, `Destinatario`, `RentriUnitaLocale`, `RentriCredential`).

**Metodo**: ogni riga verificata sul file citato. L'indice di partenza è
`tools/rentri-fake/src/dominio/schema-nuovo-formulario.ts` (copia verbatim
della chiusura di `$ref` di `NuovoFormularioModel`, 35 definizioni); ogni
proprietà è stata poi riconfermata sul contratto (`docs/contracts/rentri/formulari.yaml`,
righe 9907 e seguenti per `NuovoFormularioModel`, e le righe indicate caso per
caso per le definizioni annidate).

## Premessa: lo stato della trasmissione, non solo del modello dati

Il compito di questo documento è il modello dati, non l'integrazione. Ma un
fatto di codice condiziona la lettura di ogni riga della tabella e va detto
prima: il corpo che oggi verrebbe spedito a RENTRI in creazione di un
formulario non è costruito dai campi del FIR.

`apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts:394-400`:

```ts
private convertFIRToPayload(fir: FIR): any {
  return {
    firId: fir.id,
    firNumber: fir.numeroProgressivo,
    // ... other fields
  }
}
```

Questo metodo è chiamato alla riga 112 dello stesso file, immediatamente prima
di `this.rentriApiClient.creaFormulario(...)` — è il percorso vivo della
sincronizzazione, non codice morto. Il parametro che riceve
(`NuovoFormularioPayload`) è tipizzato `Record<string, unknown>`
(`apps/backend/src/infrastructure/rentri/rentri-api.client.ts:1694`, commento
alla riga 1690: *"La mappatura completa dei campi xFIR → NuovoFormularioModel
non è oggetto di questo task ... il payload viaggia così com'è passato dal
chiamante"*).

Esistono però due moduli di mappatura PURI, con la traduzione fail-closed
richiesta dal contratto, che **non sono importati da nessun punto del codice
di produzione** (verificato con una ricerca dell'import path su tutto
`apps/backend/src`: zero occorrenze fuori dai rispettivi file di test):

- `apps/backend/src/application/rentri/mappatura/mappa-rifiuto.ts` — traduce
  `DatiRifiutoModel` (stato fisico, codice EER, provenienza, descrizione);
- `apps/backend/src/application/rentri/mappatura/mappa-parti.ts` — traduce
  produttore/destinatario/trasportatore, con una porta `RisolutoreComune` (non
  implementata in nessun punto del codice, solo in `mappa-parti.spec.ts`) per
  risolvere comune+provincia nel `comune_id` ISTAT richiesto dal contratto.

La tabella sotto valuta la **disponibilità del dato** nel modello interno
(quello che questo censimento deve accertare), non se un percorso di codice lo
usi oggi per trasmettere. Dove un mapper già scritto (ma non cablato) copre il
campo, lo indico esplicitamente.

---

## 1. Tabella campo per campo

Legenda esito: **COPERTO** (dato presente e direttamente utilizzabile) ·
**DA TRADURRE** (dato presente ma in forma non conforme) · **ASSENTE** (nessun
dato interno corrispondente).

| Campo RENTRI (percorso) | Obbligatorietà | Campo interno | Esito | Nota |
|---|---|---|---|---|
| `num_iscr_sito` (root) | sempre | `RentriUnitaLocale.numIscrSito` (schema.prisma:1809) | DA TRADURRE | Il dato esiste per tenant (una o più unità locali), ma nessun campo su `FIR` lo referenzia: quale unità locale del tenant vidima QUESTO FIR non è modellato — va scelta a runtime (sede principale? quella del produttore aggangiato?), non è uno snapshot persistito. |
| `dati_partenza.rifiuto.codice_eer` | sempre | `FIR.cerCode` VarChar(10) (schema.prisma:297) | DA TRADURRE | Formato interno canonico `"NN NN NN"` con eventuale `*` finale per i pericolosi (commento riga 296; conferma in `domain/shared/cer-code.vo.ts:7,39` e `cer.controller.ts:150,168`). Il mapper non cablato `mappa-rifiuto.ts:186` passa `cerCode` **invariato** come `codice_eer`, senza togliere spazi/asterisco — anche se venisse cablato oggi trasmetterebbe un valore con spazi (e fino a 9 caratteri con l'asterisco, oltre il `maxLength: 8` del contratto, formulari.yaml:7900). |
| `dati_partenza.rifiuto.provenienza` | sempre | *(nessuno)* | ASSENTE | `mappa-rifiuto.ts:156-158,167-169` lo dichiara esplicitamente: "il FIR interno non la registra, va sempre fornita esplicitamente dal chiamante". Nessuna colonna `FIR` distingue rifiuto Urbano da Speciale. |
| `dati_partenza.rifiuto.stato_fisico` | sempre | `FIR.wastePhysicalState` VarChar(50) nullable (schema.prisma:311) | DA TRADURRE | A livello DTO è vincolato all'enum `StatoFisicoRifiuto` (`api/fir/dtos/create-fir.dto.ts:26-33`: Solido/Liquido/Fangoso/Gassoso/Polvere/Misto — **italiano, 6 valori**), il contratto RENTRI accetta solo 5 codici (`SP/S/FP/L/VS`, formulari.yaml:10160-10167). Il mapper non cablato `mappa-rifiuto.ts:86-106` traduce 4 dei 6 valori interni osservati; **Gassoso e Misto non hanno alcun codice RENTRI corrispondente** (commento righe 82-84) e falliscono fail-closed. |
| `dati_partenza.rifiuto.descrizione` | condizionale (EER `.99`) | `FIR.wasteDescription` VarChar(500) (schema.prisma:298) | COPERTO | `mappa-rifiuto.ts:173-183` implementa già la condizione (obbligatoria se il codice EER finisce per `99`) e fallisce fail-closed se manca. |
| `dati_partenza.rifiuto.caratteristiche_pericolo` | condizionale (rifiuto pericoloso) | `FIR.wasteHazardClasses` Text nullable, CSV (schema.prisma:314) | DA TRADURRE | Formato interno osservato `"HP4,HP14"` (esempio DTO `api/fir/dtos/create-fir.dto.ts:73`; stessa forma nei test, es. `fir.aggregate.signable-document.spec.ts:44`) — non zero-paddato. Il contratto vuole un **array** di stringhe enum a due cifre `HP01`..`HP15` (formulari.yaml:6167-6184). Nessun codice di produzione esegue oggi lo split-CSV + zero-padding + validazione enum. |
| `dati_partenza.rifiuto.quantita.valore` | condizionale (se `quantita` presente) | `FIR.quantity` Decimal(10,2) (schema.prisma:300) | COPERTO | Tipo compatibile (`number`, contratto: double 0..9999999999.9999). |
| `dati_partenza.rifiuto.quantita.unita_misura` | condizionale (se `quantita` presente) | `FIR.unit` VarChar(10) default `"KG"` (schema.prisma:301) | DA TRADURRE | Contratto: solo `"kg"` o `"l"` minuscolo (formulari.yaml, enum `UnitaMisura`). Il default in colonna è `"KG"` maiuscolo. Esiste anche un VO di dominio separato `UnitaMisura` (`domain/fir/value-objects/quantita.ts:8-12`) con valori `'kg' \| 'litri' \| 't'` (tonnellate) — `'litri'` non è `'l'`, e **`'t'` (tonnellate) non ha alcun equivalente nel contratto**: non è chiaro se le due enumerazioni (colonna `FIR.unit` e VO `Quantita`) siano la stessa cosa nel codice vivo. |
| `dati_partenza.destinatario` (una delle due varianti) | sempre | — | — | Vedi le due righe seguenti. |
| `dati_partenza.destinatario` variante `DatiDestinatarioFormularioModel`: `codice_fiscale`, `denominazione`, `indirizzo` | sempre (se variante "anagrafica completa") | `Destinatario.partitaIVA` VarChar(11), `Destinatario.ragioneSociale` VarChar(255), indirizzo (via/civico/cap/comune/provincia) (schema.prisma:1128-1155) | DA TRADURRE | `mappa-parti.ts:197-210` implementa la traduzione; usa `partitaIVA` come `codice_fiscale` (nota esplicita alle righe 165-169 e 189-195: scelta accettata come limite, non garantita per soggetti esteri). Nessun campo `Destinatario.codiceFiscale` distinto esiste. |
| `dati_partenza.destinatario` variante `DatiDestinatarioFormularioSitoModel`: `num_iscr_sito` | sempre (se variante "sito RENTRI") | *(nessuno)* | ASSENTE | `Destinatario` non ha alcun campo `numIscrSito`: la variante "il destinatario è un'unità locale RENTRI" non è rappresentabile, solo la variante anagrafica completa lo è. |
| `dati_partenza.destinatario.indirizzo.indirizzo` | sempre (se variante completa) | `Destinatario.via` VarChar(255) (schema.prisma:1139) | COPERTO | — |
| `dati_partenza.destinatario.indirizzo.citta` (`ComuneModel.comune_id`, variante italiana) | sempre (se variante completa, comune italiano) | `Destinatario.comune` VarChar(100) + `Destinatario.provincia` VarChar(2) (schema.prisma:1142-1143) | DA TRADURRE | Il nome comune (testo libero) va risolto nel codice ISTAT a 6 cifre `comune_id`. `mappa-parti.ts:50-52,134-160` modella la risoluzione dietro una porta `RisolutoreComune` **non implementata** in produzione (nessuna classe la implementa, solo il doppio di test in `mappa-parti.spec.ts:10-16`). Esiste una cache `RentriComune` (schema.prisma:1015-1044, codici ISTAT sincronizzati dall'ente) ma nessun codice collega `Destinatario.comune`/`provincia` a quella tabella. |
| `dati_partenza.destinatario.indirizzo.citta` (`CittaEsteraModel`, variante estera) | sempre (se variante completa, città estera) | *(nessuno)* | ASSENTE | `Destinatario` non ha un campo nazione: il modello assume implicitamente indirizzo italiano. Un destinatario estero non è rappresentabile nel formato richiesto da RENTRI. |
| `dati_partenza.destinatario.autorizzazione` / `dati_partenza.destinatario.attivita` | condizionale ("sempre necessario tranne quando l'unità locale del destinatario coincide con quella del produttore ed il rifiuto è stato prodotto fuori dall'unità locale", formulari.yaml, descrizione `DatiDestinatarioFormularioBaseModel.autorizzazione`/`attivita`) | `Destinatario.numeroAutorizzazione` VarChar(50) (schema.prisma:1136) per `autorizzazione`; `FIR.wasteOperationCode` VarChar(10) nullable (schema.prisma:318) per `attivita` | `attivita`: DA TRADURRE · `autorizzazione`: ASSENTE | `wasteOperationCode` è testo libero non validato a livello DTO (`@IsString()`, `api/fir/dtos/create-fir.dto.ts:101-103`) ma con valori osservati nella forma già compatibile con l'enum (`"R13"`, `"D13"`, v. `crea-fir-da-dettaglio-rentri.use-case.ts:305-307` e test) — nessuna validazione enum lo impedisce da rifiutare valori fuori formato. Per `autorizzazione` il contratto vuole un oggetto `AutorizzazioneModel {numero, tipo}` con `tipo` da un enum chiuso di 9 valori (formulari.yaml, `TipiAutorizzazione`); `Destinatario.numeroAutorizzazione` è solo un numero libero, senza tipo — `mappa-parti.ts:186-195` lo dichiara esplicitamente non mappato ("mapparlo su uno di quei due campi sarebbe una traduzione inventata"). |
| `dati_partenza.trasportatori` (array, `minItems: 1`) | sempre | `FIR.carrier*` (inline, schema.prisma:282-287) + `FIRTransporter[]` (tratte aggiuntive, schema.prisma:585-611) | — | Il FIR interno modella UN trasportatore principale inline più N tratte aggiuntive in tabella figlia; il contratto vuole un array di trasportatori. Struttura compatibile in linea di principio (vedi righe sotto per i singoli campi). |
| `dati_partenza.trasportatori[].tipo_trasporto` (`DatiTrasportatoreFormularioBaseModel`, sempre richiesto in entrambe le varianti) | sempre | `FIRTransporter.tipoTratta` enum `TERRESTRE\|FERROVIARIA\|MARITTIMA` (schema.prisma:573-579,591) — solo per le tratte aggiuntive | DA TRADURRE (tratte aggiuntive) · ASSENTE (trasportatore principale inline) | Il trasportatore principale su `FIR` non ha alcun campo tipo-trasporto esplicito (solo `carrierVehiclePlate`, che presuppone implicitamente il trasporto terrestre, mai dichiarato come tale). Per le tratte aggiuntive l'enum interno è in italiano e al femminile (`FERROVIARIA`, `MARITTIMA`) contro l'enum del contratto in italiano ma diversa forma (`Ferroviario`, `Marittimo`, formulari.yaml `TipoTrasporto`) — richiede mappatura di stringa, non solo di case. |
| `dati_partenza.trasportatori[].codice_fiscale`, `denominazione` (variante completa) | sempre (se variante completa) | `Trasportatore.partitaIVA`, `Trasportatore.ragioneSociale` (schema.prisma:1105-1106) o, per le tratte aggiuntive, snapshot `FIRTransporter.partitaIva`/`denominazione` (schema.prisma:598-599) | DA TRADURRE | Stessa scelta di `codice_fiscale = partita IVA` di produttore/destinatario (`mappa-parti.ts:223-256`); qui però `FIRTransporter` ha **anche** un campo `codiceFiscale` VarChar(16) distinto (schema.prisma:600), non presente sul modello anagrafico `Trasportatore` — incoerenza fra la tratta principale (senza codice fiscale proprio) e le tratte aggiuntive (con un campo dedicato, mai popolato secondo la ricerca svolta: nessun assegnamento a `codiceFiscale` trovato fuori dallo snapshot stesso). |
| `dati_partenza.trasportatori[].num_iscr_sito` (variante sito) | sempre (se variante sito) | *(nessuno)* | ASSENTE | Né `Trasportatore` né `FIRTransporter` hanno un campo `numIscrSito`. |
| `dati_partenza.trasportatori[].numero_iscrizione_albo` | opzionale (nullable in entrambe le varianti) | `Trasportatore.numeroIscrizione` VarChar(50) (schema.prisma:1107); `FIRTransporter.numeroIscrizioneAlbo` VarChar(50) (schema.prisma:601) | DA TRADURRE | Il contratto vincola il formato con un pattern `^[A-Za-z]{2}/[0-9]{6}$` (formulari.yaml, `numero_iscrizione_albo`, es. su `DatiTrasportatoreFormularioBaseModel`). Il campo interno è testo libero VarChar(50), non validato a questo formato in nessun punto trovato (il mapper non cablato `mappa-parti.ts:20,244-253` sì lo valida, ma non è mai chiamato). |
| `dati_partenza.produttore` (una delle due varianti) | *non in `required` di `DatiPartenzaModel`* (nullable), ma nella pratica sempre presente salvo il caso `trasbordo_parziale_origine` | — | — | Il contratto lo rende opzionale solo per il caso esplicito di trasbordo parziale ("Se il dato viene valorizzato [`trasbordo_parziale_origine`], la proprietà 'produttore' non deve essere valorizzata", formulari.yaml). Riportato qui perché nella pratica operativa è sempre necessario. |
| `dati_partenza.produttore` variante completa: `codice_fiscale`, `denominazione`, `indirizzo` | condizionale (come sopra) | `Produttore.partitaIVA`, `Produttore.ragioneSociale`, indirizzo (schema.prisma:1071-1097) — oppure snapshot `FIR.producerPartitaIva`/`producerName`/`producerAddress` (schema.prisma:277-279, stringa unica non strutturata) | DA TRADURRE | `mappa-parti.ts:171-184` copre la variante da registro `Produttore` (via/civico/cap/comune/provincia strutturati). Lo snapshot su `FIR` invece salva `producerAddress` come **stringa libera unica** VarChar(500) (schema.prisma:279), non scomponibile in via/civico/cap/comune/provincia senza parsing — se la trasmissione dovesse partire dallo snapshot del FIR (non dal registro `Produttore` vivo) l'indirizzo andrebbe ricostruito da un campo che non lo permette. |
| `dati_partenza.produttore` variante sito: `num_iscr_sito` | condizionale (come sopra) | *(nessuno)* | ASSENTE | `Produttore` non ha un campo `numIscrSito`. |
| `dati_partenza.produttore.autorizzazione` | opzionale/nullable | *(nessuno)* | ASSENTE | Nessun campo `Produttore` rappresenta un'autorizzazione (numero+tipo). |
| `dati_partenza.produttore.detentore` | opzionale/nullable | *(nessuno)* | ASSENTE | Nessun flag "detentore del rifiuto" sul modello. |
| `dati_partenza.produttore.numero_iscrizione_albo` | opzionale/nullable | *(nessuno)* | ASSENTE | `Produttore` non ha un campo iscrizione Albo. |
| `dati_partenza.trasbordo_parziale_origine.numero_fir_origine`, `.causale` | condizionale (se il formulario nasce da un trasbordo parziale) | *(nessuno)* | ASSENTE | Nessun concetto di "trasbordo parziale di origine" nel modello `FIR` (né una colonna, né una tabella figlia). |
| `dati_partenza.trasbordo_parziale_origine.produttore_originario.codice_fiscale`, `.denominazione` | condizionale (come sopra) | *(nessuno)* | ASSENTE | Stesso motivo. |
| `dati_partenza.annotazioni` (Campo 17 FIR) | opzionale | `FIR.wasteNotes` Text nullable (schema.prisma:320, commento: "Campo 17: annotazioni libere") | COPERTO | Da non confondere con `FIR.transportNotes` (schema.prisma:337), che corrisponde semmai a `DatiTrasportoBaseModel.annotazioni` (v. riga sotto), un campo diverso del contratto. |
| `dati_trasporto_partenza` (root, `oneOf` terrestre/marittimo/ferroviario) | opzionale/nullable | — | — | Vedi righe seguenti per singola variante. |
| `dati_trasporto_partenza` (Terrestre).`data_ora_inizio_trasporto` (da `DatiTrasportoBaseModel`, sempre richiesto in tutte le varianti) | sempre (se `dati_trasporto_partenza` presente) | `FIR.transportDate` DateTime (schema.prisma:334) | DA TRADURRE | Tipo compatibile concettualmente; il contratto vuole ISO 8601 UTC esplicito — nessuna conversione di formato osservata nel codice di produzione (il mapper del trasporto non esiste, a differenza di rifiuto/parti). |
| `dati_trasporto_partenza` (Terrestre).`conducente.nome`, `.cognome` | sempre (se variante Terrestre) | *(nessuno)* | ASSENTE | Nessun campo nome/cognome del conducente in nessun modello (`FIR`, `FIRTransporter`, `Trasportatore`): ricerca mirata (`conducente`, `autista`, `driver*`) senza risultati pertinenti nello schema. |
| `dati_trasporto_partenza` (Terrestre).`targa_automezzo` | condizionale (necessario se non c'è targa rimorchio) | `FIR.carrierVehiclePlate` VarChar(20) (schema.prisma:286, obbligatoria in schema anche quando RENTRI la considera condizionale) | COPERTO | — |
| `dati_trasporto_partenza` (Terrestre).`targa_rimorchio` | opzionale | *(nessuno)* | ASSENTE | Nessun campo targa rimorchio. |
| `dati_trasporto_partenza` (Marittimo).`nave` | sempre (se variante Marittimo) | *(nessuno)* | ASSENTE | — |
| `dati_trasporto_partenza` (Ferroviario).`treno` | sempre (se variante Ferroviario) | *(nessuno)* | ASSENTE | `FIRTransporter.mezzo` VarChar(100) (schema.prisma:604) è generico ("targa, numero treno o nome nave" per il commento) ma esiste solo per le tratte aggiuntive, non per il trasporto di partenza del FIR (`dati_trasporto_partenza` è per definizione la prima tratta). |
| `dati_partenza.rifiuto.analisi_classificazione.tipo`, `.numero` | condizionale (se `analisi_classificazione` presente) | *(nessuno)* | ASSENTE | Nessuna tabella/colonna per analisi/classificazione del rifiuto. |
| `dati_partenza.rifiuto.dati_adr` | condizionale (deve essere assente se `trasporto_adr` non è `true`; se presente, nessun sotto-campo è a sua volta obbligatorio) | *(nessuno)* | ASSENTE | Nessun campo ADR (numero ONU, classe, note) in nessun modello. |
| `dati_partenza.rifiuto.trasporto_adr` | opzionale | *(nessuno)* | ASSENTE | Nessun flag trasporto ADR. |
| `dati_partenza.rifiuto.verificato_in_partenza` | opzionale | *(nessuno)* | ASSENTE | Nessun flag corrispondente. |
| `dati_partenza.rifiuto.rinfusa` | opzionale | *(nessuno)* | ASSENTE | Nessun flag rinfusa. |
| `dati_partenza.rifiuto.numero_colli` | condizionale (deve essere valorizzato se `rinfusa` non è `true`) | `FIR.wastePackageCount` Int nullable (schema.prisma:316) | DA TRADURRE | Tipo: il contratto lo vuole `string` (nota esplicita in `rentri-api.client.ts:1752`: "Nonostante il nome, il contratto lo tipizza `string`"), il campo interno è `Int`. |
| `dati_partenza.intermediari[].codice_fiscale`, `.denominazione` | condizionale (se `intermediari` presente, per ogni elemento) | *(nessuno)* | ASSENTE | Nessun modello `Intermediario` nello schema (confermato: solo `Produttore`/`Trasportatore`/`Destinatario` fra le anagrafiche di registro). |
| `numero_fir` (root di `DatiPartenzaModel`, opzionale) | opzionale | `FIR.firNumber` VarChar(50) (schema.prisma:262) | DA TRADURRE | Formato interno osservato: `"FIR-2025-001234"` (`fir.aggregate.spec.ts:103`). Il pattern del contratto è `^([BCDFGHJKLMNPQRSTVWXYZ]{4,6})[ \t-/_]*([0-9]+)[ \t-/_]*([BCDFGHJKLMNPQRSTVWXYZ]{1,2})$` (solo consonanti maiuscole + cifre): `"FIR"` contiene la vocale `I`, quindi il valore interno **non rispetta mai** il pattern. |

---

## 2. Lacune che richiedono una modifica del modello dati

Per ciascuna: cosa aggiungere e se serve anche un intervento UI (qualcuno deve
inserire il dato — non è calcolabile da dati già presenti).

- **`provenienza` (Urbano/Speciale) del rifiuto.** Aggiungere colonna enum
  (`U`/`S`) su `FIR` (o sulla tabella rifiuto se mai estratta). UI: sì — nessun
  altro campo la implica (un rifiuto con codice EER del capitolo 20 è di
  regola urbano, ma il contratto non consente di dedurlo automaticamente e il
  mapper esistente lo richiede esplicito).
- **Conducente (nome, cognome) del trasporto terrestre.** Aggiungere due
  colonne (o una tabella `FIRAutista`) collegate al FIR o a `FIRTransporter`.
  UI: sì — dato mai raccolto oggi in nessun form.

  > **Correzione in revisione (2026-09-10).** La prima stesura presentava questa
  > lacuna come bloccante per il trasporto terrestre. Non lo è per la creazione
  > del formulario: verificato sul contratto che `dati_trasporto_partenza` è
  > `nullable: true` e NON compare nel `required` di `NuovoFormularioModel` (i
  > soli obbligatori sono `dati_partenza` e `num_iscr_sito`). Il conducente
  > diventa obbligatorio solo *dentro* `DatiTrasportoTerrestreModel`, cioè
  > quando si dichiarano i dati di trasporto — alla creazione oppure con
  > l'operazione `Trasporto` in un momento successivo. Si può quindi creare un
  > formulario conforme senza conoscere il conducente. La lacuna resta reale,
  > ma è **differibile** e non blocca il primo invio.
- **Targa rimorchio, nave, treno per `dati_trasporto_partenza`.** Il campo
  generico `FIRTransporter.mezzo` esiste solo per le tratte aggiuntive; la
  prima tratta (`dati_trasporto_partenza`) non ha alcun contenitore. Aggiungere
  colonne dedicate (o riusare `mezzo` anche per la tratta di partenza, con un
  campo `tipoTratta` esplicito anche lì). UI: sì.
- **Codice ISO nazione su `Produttore`/`Trasportatore`/`Destinatario` (e
  relativo comune/città estera).** Oggi i tre registri assumono indirizzo
  italiano. Aggiungere `nazioneId` nullable + rendere `comune`/`provincia`
  condizionalmente opzionali quando la nazione non è `IT`. UI: sì — un
  produttore/destinatario/trasportatore estero non è oggi inseribile con dati
  utilizzabili da RENTRI.
- **`numIscrSito` su `Produttore`/`Trasportatore`/`Destinatario`.** Per
  rappresentare la variante "sito RENTRI" (quando la controparte è essa
  stessa un'unità locale RENTRI nota). Aggiungere colonna nullable + validarla
  col pattern del contratto. UI: sì, come campo opzionale in anagrafica.
  Alternativa: se il caso d'uso reale è raro, resta accettabile omettere questa
  variante e usare sempre quella anagrafica completa — ma è una scelta da
  esplicitare, non un'omissione silenziosa.
- **Autorizzazione strutturata del destinatario** (`numero` + `tipo` enum a 9
  valori) invece del `numeroAutorizzazione` testo libero attuale. Serve
  probabilmente una tabella `DestinatarioAutorizzazione` (visto che un
  destinatario può avere più autorizzazioni per attività diverse) o, come
  minimo, un secondo campo `tipoAutorizzazione` enum su `Destinatario`. UI: sì
  — oggi l'operatore inserisce solo un numero libero, mai un tipo.
- **Numero iscrizione Albo con formato validato** (`AA/123456`) su
  `Trasportatore`/`FIRTransporter`. Non serve una nuova colonna, ma un vincolo
  di formato (constraint DB o validazione applicativa) mancante oggi. UI:
  eventualmente un messaggio di validazione se il formato inserito non è
  quello dell'Albo.
- **Trasbordo parziale di origine** (`numero_fir_origine`, `causale`,
  `produttore_originario`). Concetto interamente assente: se il prodotto deve
  gestire i FIR nati da trasbordo parziale, serve una tabella dedicata
  collegata a `FIR`. UI: sì, flusso interamente nuovo.
- **Intermediari.** Nessun modello `Intermediario`. Se il prodotto vuole
  gestire la figura, serve un nuovo registro (sul modello di
  `Produttore`/`Trasportatore`/`Destinatario`) + relazione N:M con `FIR`. UI:
  sì.
- **ADR** (`trasporto_adr` flag, `dati_adr.numero_onu/classe/note`). Nessun
  campo. Aggiungere colonne su `FIR` (o tabella figlia se il rifiuto può avere
  più codici ONU — da chiarire col contratto). UI: sì.
- **`verificato_in_partenza`, `rinfusa`.** Due flag booleani mancanti su `FIR`.
  UI: sì (due checkbox nel form del rifiuto).
- **Analisi/classificazione del rifiuto** (`tipo` enum Analisi/Classificazione
  + `numero` + `data`). Nessun campo. Aggiungere tabella o colonne dedicate.
  UI: sì.
- **`detentore` e autorizzazione/iscrizione Albo del produttore.** Assenti su
  `Produttore`. UI: sì se il prodotto vuole coprire il caso (produttore che
  non coincide col detentore).
- **Unità locale RENTRI del FIR.** `RentriUnitaLocale` esiste per tenant, ma
  nessun campo su `FIR` registra QUALE unità locale del tenant vidima quel
  FIR specifico. Aggiungere `FIR.rentriUnitaLocaleId` (FK nullable verso
  `RentriUnitaLocale`). UI: probabilmente sì (scelta esplicita se il tenant ha
  più sedi, altrimenti default sulla sede `principale`).

---

## 3. Valori da codificare

Campi dove il dato interno esiste ma è in una forma diversa da quella
richiesta dal contratto. Valori osservati nel repository (citati con
grep) e codice contratto di destinazione.

| Campo | Valori interni osservati | Dove osservati | Codice/formato RENTRI richiesto |
|---|---|---|---|
| Stato fisico | `Solido`, `Liquido`, `Fangoso`, `Gassoso`, `Polvere`, `Misto` (enum DTO) | `api/fir/dtos/create-fir.dto.ts:27-32` | `SP`, `S`, `FP`, `L`, `VS` (`StatiFisici`, formulari.yaml:10160-10167). **`Gassoso` e `Misto` non hanno alcun codice corrispondente** — nessuna mappatura possibile senza una decisione di prodotto. |
| Stato fisico (forme aggiuntive già mappate nel modulo non cablato) | `SOLIDO_POLVERULENTO`, `IN_POLVERE_O_PULVERULENTO`, `SOLIDO_NON_POLVERULENTO`, `FANGOSO_PALABILE`, `VISCHIOSO_SCIROPPOSO`, `VISCOSO_SCIROPPOSO` | `application/rentri/mappatura/mappa-rifiuto.ts:86-106` (tabella `TABELLA_STATI_FISICI`) | Stesso enum a 5 valori sopra. |
| Caratteristiche di pericolo | CSV non zero-paddato, es. `"HP4,HP14"`, `"HP6"` | `api/fir/dtos/create-fir.dto.ts:73`; `fir.aggregate.signable-document.spec.ts:44,125` | Array di stringhe `HP01`..`HP15` a due cifre (`CaratteristichePericolo`, formulari.yaml:6167-6184). Serve: split su virgola, zero-padding, validazione contro l'enum chiuso. |
| Codice EER | Formato canonico `"NN NN NN"`, con `*` finale per i pericolosi | `domain/shared/cer-code.vo.ts:7,39`; `cer.controller.ts:150,168`; commento `schema.prisma:296` | Stringa `maxLength: 8` senza formato dichiarato esplicitamente (formulari.yaml:7899-7902) — in pratica va tolto ogni spazio e l'asterisco, restando con le sole 6 cifre. |
| Unità di misura | `FIR.unit` colonna: default `"KG"` (libero); VO `UnitaMisura` separato: `'kg' \| 'litri' \| 't'` | `schema.prisma:301`; `domain/fir/value-objects/quantita.ts:8-12` | `"kg"` o `"l"` minuscolo (`UnitaMisura`, formulari.yaml). `'t'` (tonnellate) non ha equivalente: richiederebbe conversione del valore (×1000) verso kg, non solo del codice unità. |
| Codice operazione destinatario (`attivita`) | Testo libero non validato, valori osservati `"R13"`, `"D13"`, `"D15"` | `api/fir/dtos/create-fir.dto.ts:98-103`; `crea-fir-da-dettaglio-rentri.use-case.spec.ts:122` | Enum chiuso `OperazioniRecuperoSmaltimento` (28 valori R1-R13/D1-D15, formulari.yaml). I valori osservati sono già nel formato giusto, ma nulla impedisce un valore fuori enum in scrittura oggi. |
| Numero iscrizione Albo | Testo libero VarChar(50), nessun vincolo di formato applicato in produzione | `schema.prisma:1107` (`Trasportatore.numeroIscrizione`), `1136` (`Destinatario.numeroAutorizzazione`, concetto diverso ma stessa criticità di formato libero) | Pattern `^[A-Za-z]{2}/[0-9]{6}$` (es. `AB/123456`), già implementato solo nel mapper non cablato `mappa-parti.ts:20,244-253`. |
| Codice fiscale delle parti | Non esiste: si usa `partitaIVA` (11 cifre) come sostituto | `mappa-parti.ts:165-169,189-195,235-236` (commento esplicito) | Il contratto valida `codice_fiscale` con regole diverse per persona fisica (16 caratteri) o partita IVA (11 cifre) — funziona nella maggioranza dei casi italiani B2B ma non è garantito (`descrizione` di `DatiProduttoreFormularioModel.codice_fiscale`, formulari.yaml). |
| Numero FIR locale | `"FIR-2025-001234"` (progressivo interno) | `fir.aggregate.spec.ts:103,117,330` | Pattern vidimazione cartacea `^[BCDFGHJKLMNPQRSTVWXYZ]{4,6}[0-9]+[BCDFGHJKLMNPQRSTVWXYZ]{1,2}$` (solo consonanti). Il progressivo interno non è mai conforme (contiene vocali). |
| Numero di colli | Intero (`Int?`) | `schema.prisma:316` | Stringa (`numero_colli`, `rentri-api.client.ts:1752`). |

---

## 4. Domande aperte per il committente

1. **Provenienza del rifiuto (Urbano/Speciale).** Il sistema oggi non registra
   questo dato in nessuna forma. Va chiesto esplicitamente all'operatore ad
   ogni FIR, oppure va dedotto da una regola di business (es. dal tenant, dal
   tipo di produttore, dal codice EER)? Se dedotto, con quale regola?

2. **FIR con stato fisico "Gassoso" o "Misto": si possono trasmettere a
   RENTRI?** Il contratto non prevede questi due codici. Un FIR marcato così
   nel form interno può mai raggiungere lo stato "da trasmettere", o questi
   due valori vanno tolti dall'enum utilizzabile quando il tenant ha RENTRI
   attivo?

3. **Numero FIR: lo assegniamo noi o lo lascia assegnare a RENTRI?** Il campo
   `numero_fir` in `dati_partenza` è opzionale nel contratto ("qualora non
   venga specificato, il sistema ne assegnerà uno automaticamente"). Il nostro
   progressivo interno non rispetta comunque il formato richiesto. Si decide
   di non inviarlo mai (RENTRI assegna) o si introduce un secondo numero,
   conforme al pattern, gestito in parallelo al progressivo interno?

4. **Quantità in tonnellate: si convertono in kg, o si vieta l'unità
   "tonnellate" per i FIR destinati a RENTRI?** Il contratto non ammette
   tonnellate; convertire il valore (×1000) cambia la precisione dichiarata
   (2 decimali su una colonna Decimal(10,2)) e potrebbe non corrispondere a
   ciò che il produttore ha effettivamente dichiarato in kg.

5. **Indirizzi esteri: il prodotto deve supportare produttori, destinatari o
   trasportatori non italiani?** Se sì, serve aggiungere il concetto di
   nazione alle tre anagrafiche (oggi implicitamente solo italiane). Se no, va
   esplicitato come vincolo di prodotto (validazione che rifiuta soggetti
   esteri), non lasciato come limite implicito del modello dati.

6. **Autorizzazione del destinatario: si struttura (numero + tipo enum), o si
   rinuncia a trasmetterla e si accetta che RENTRI la richieda comunque nei
   casi in cui è obbligatoria?** Oggi non è mai obbligatoria a livello di
   FIR interno; se un tenant emette FIR per cui RENTRI la richiede
   (destinatario diverso dall'unità locale del produttore), la trasmissione
   fallirebbe fail-closed finché non si struttura il dato.

7. **Il modello "unità locale RENTRI del produttore/destinatario/
   trasportatore" (variante `num_iscr_sito` al posto dell'anagrafica
   completa) serve al prodotto, o si accetta di usare sempre e solo la
   variante anagrafica completa?** Cambia se vale la pena aggiungere
   `numIscrSito` alle tre anagrafiche di registro.

8. **Trasbordo parziale e intermediari: rientrano nel perimetro del
   prodotto?** Sono assenti al 100% (nessuna colonna, nessuna tabella,
   nessuna UI). Se sì, sono due sviluppi strutturali separati, non
   estensioni incrementali di campi esistenti.

9. **ADR: il prodotto gestisce rifiuti soggetti a trasporto ADR?** Se sì, va
   deciso se registrare i dati ADR (numero ONU, classe, note) per rifiuto o
   per trasporto (il contratto li lega al rifiuto, non alla tratta) prima di
   disegnare lo schema.

10. **Il conducente per il trasporto terrestre: si registra come dato di
    anagrafica del trasportatore (un elenco di conducenti abituali) o come
    dato ad hoc inserito ad ogni FIR?** Cambia significativamente
    l'esperienza utente e il tipo di tabella da introdurre.
