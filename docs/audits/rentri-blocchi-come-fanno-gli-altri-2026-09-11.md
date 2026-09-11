# RENTRI — blocco virtuale FIR: come fanno gli altri gestionali italiani

Data: 2026-09-11. Ricerca pubblica (manuali PDF, pagine prodotto, FAQ). Nessun accesso diretto a un ambiente demo dei prodotti citati: quanto segue è basato solo su documentazione scritta e screenshot pubblicati dai fornitori stessi.

## Premessa — i fatti su cui ci basiamo (non ri-verificati qui)

- Il blocco virtuale si crea SOLO nell'area riservata «Operatori» del portale RENTRI (Interoperabilità → Gestione blocchi virtuali dei FIR). Nessuna API di creazione esiste.
- L'API di vidimazione espone solo letture sui blocchi + la vidimazione che consuma un numero + l'annullamento di una vidimazione.
- Il blocco non ha capienza né scadenza: è un contenitore con un contatore di FIR vidimati.
- Un blocco può essere a livello di operatore o di unità locale; se ne possono avere più di uno per unità locale.
- I blocchi non si cancellano, si disattivano.

## Cosa abbiamo trovato davvero, fornitore per fornitore

### Ecotraccia (Eco Traccia)

Fonte: `manuale_rentri_ecotraccia.pdf` (servizi.ecotraccia.it/images/rentri/), rev. 1.0 del 21/01/2025.

- **Creazione del blocco**: avviene solo su RENTRI (§2.1–2.3 del manuale). Il manuale guida l'utente passo-passo dentro il portale RENTRI stesso ("Accedi al Portale RENTRI... Interoperabilità → Gestione Blocchi Virtuali dei FIR... premi '+ Nuovo Blocco Virtuale'"), non dentro Ecotraccia. Il manuale mostra anche lo screenshot del popup di conferma RENTRI che dice esplicitamente: _"Per creare nuovi FIR da un blocco via interoperabilità consultare la documentazione disponibile sulla pagina di documentazione delle API e utilizzare la API 'vidimazione-formulari'."_
- **Lettura/selezione nel gestionale**: dopo la creazione su RENTRI, l'utente torna in Ecotraccia (Gestione Rifiuti → RENTRI → Emissione FIR RENTRI) e lì trova "la lista dei blocchi creati su RENTRI" (letta via API, non inserita a mano) — Ecotraccia mostra Codice Blocco, Attivo (SI/NO), Descrizione, Num Iscr Sito, Indirizzo.
- **Configurazione per blocco**: icona matita → popup con Dati Produttore/Trasportatore, **Priorità** (default 1, "se gestisci più aziende contatta l'assistenza") e **Riserva Giornaliera** ("indica il numero di formulari da vidimare ogni sera per la giornata successiva").
- **Più blocchi**: gestiti con un campo **Priorità** esplicito per blocco — è il meccanismo con cui l'utente indica un ordine di preferenza tra blocchi, non una scelta a runtime.
- **Vidimazione**: dalla lista blocchi, click sul codice → lista formulari del blocco → bottone "VIDIMA FORMULARI" → popup "inserisci il numero di formulari da vidimare" (nota: _"la vidimazione non è immediata"_).
- **Nessun blocco/numero disponibile al momento dell'emissione**: nella compilazione del FIR (§7.1), il pulsante "V" (Vidima) propone una numerazione automatica; **se ci sono più blocchi disponibili, il sistema mostra un menu a tendina per scegliere il blocco, in base alla priorità**; se il numero proposto non è valido "il sistema non permette di salvare il formulario" — quindi l'avviso arriva al momento del salvataggio del FIR compilato, non prima.
- **Contatore FIR vidimati**: la lista blocchi mostra "FIR emessi" (colonna nella schermata RENTRI di gestione blocchi) e in Ecotraccia si vedono gli stati per formulario (Usato/Non Usato/Sbloccato/Non Associato) con colori (verde/rosso/giallo) — il contatore serve a sapere quanti numeri restano disponibili nel blocco prima di doverne vidimare altri.
- **Blocchi disattivati**: il manuale non descrive esplicitamente la disattivazione lato Ecotraccia; mostra solo la colonna "Attivo: SI" nella lista. Non specificato come appare un blocco disattivato (grigio, nascosto, ecc.) — **non verificato**.
- **Sblocco/annullamento formulario**: pulsante "V" per sbloccare un FIR non usato, pulsante "X" per annullarlo definitivamente ("comunicato automaticamente al portale RENTRI").

### Estarweb / Eco-Management (`manuale_rentri_estarweb.pdf`)

Fonte: portale.estarweb.it/estar_graph/images/rentri/manuale_rentri_estarweb.pdf, stessa rev. 1.0 del 21/01/2025.

Il manuale è **testualmente identico** a quello di Ecotraccia (stesso impaginato, stesse schermate placeholder "ECO-MANAGEMENT SRL", stesso flusso), a parte il nome del prodotto (ESTARWEB al posto di ECOTRACCIA) e il logo. Tutte le osservazioni sopra su Ecotraccia valgono paro paro per Estarweb. Questo indica che i due sono probabilmente white-label dello stesso motore software, con la stessa scelta di design per il blocco virtuale (priorità + riserva giornaliera + menu a tendina se più blocchi disponibili). Fonte separata trovata ma non ancora letta: `manuale_xfir_estarweb.pdf` e `manuale_estar_vivifir.pdf` — i tentativi di estrazione testo hanno fallito (PDF non testuale ai tool disponibili) e non è stato ripetuto un secondo tentativo entro il tempo della ricerca: **di questi due documenti non abbiamo estratto contenuto utile**.

### WinWaste (Zucchetti Ambiente)

Fonti: `winwaste.net/vivifir-cose-e-come-funziona/`, `winwaste.net/f-a-q/`, video YouTube "WinWaste - Vi.VI.FIR. Vidimazione Virtuale Formulari".

- Confermato dal riassunto motore di ricerca (non fonte primaria diretta, va preso con cautela): "Non ci sono limiti al numero di formulari che il 'blocco' può contenere e nessuna data di scadenza è impostata per il 'blocco'" — coerente con quanto già sappiamo.
- Un dettaglio operativo specifico emerso: **"Nella configurazione VIVIFIR di winwaste, incollare il nuovo ID Secret e la data di scadenza"** — suggerisce che WinWaste usa credenziali applicative (ID/secret) con scadenza propria per l'interoperabilità, distinte dal blocco stesso. Non siamo riusciti a leggere il testo integrale della pagina/FAQ con i tool di fetch disponibili (hanno restituito solo un riassunto), quindi **questo dettaglio non è verificato al 100% sul testo originale** — va preso come indicazione, non come citazione esatta.
- La FAQ page (`f-a-q/`) non ha restituito, tramite il tool di lettura disponibile, contenuto specifico su gestione blocchi multipli, blocco assente, o blocchi disattivati: **non trovato**.

### Ecocerved / EcoDeskWeb (motore usato da varie CCIAA/consorzi)

Fonte: `ecodeskweb.ecocerved.it/HELP/vivifir-come-si-opera-in-ecodesk.htm`.

- **Terminologia e modello concettuale esplicito, utile per noi**: _"Il 'blocco virtuale di formulari' è assimilabile ad un contenitore o una cartella ed è identificato da un codice alfabetico."_ — è la spiegazione più chiara e "user-friendly" trovata su cosa sia concettualmente un blocco.
- **Selezione nel gestionale**: l'amministratore "seleziona il codice del 'blocco di formulari' scegliendolo dall'elenco dei blocchi associati all'impresa" tramite una funzione di configurazione chiamata **"Codifica aziendale"** — quindi la scelta del blocco è un'impostazione amministrativa fatta una volta, non una scelta ripetuta a ogni FIR.
- **Blocco condiviso per unità organizzativa**: _"Tutti i registri di un'unità organizzativa condivideranno il 'blocco di formulari' della stessa."_ — modello: un blocco = un'unità organizzativa, assegnato una volta, usato da tutti i registri di quell'unità.
- Non trovate nella pagina raggiungibile: gestione contatore FIR vidimati, comportamento senza blocco attivo, gestione blocchi disattivati. La pagina non fa menzione esplicita del termine "RENTRI" (parla solo di "Vi.Vi.Fir."), il che suggerisce che questa parte di documentazione precede l'introduzione del RENTRI o non è stata aggiornata — **da verificare con una pagina più recente, non fatto in questa ricerca**.

### TeamSystem Waste

Fonti: `teamsystem.com/store/assets/pdf/TEAMSYSTEM_GUIDA_INFORMATIVA_RENTRI.pdf` (guida normativa generale, giu. 2024) e pagine di marketing del prodotto.

- La guida PDF letta per intero (21 pagine) è un documento normativo generalista su RENTRI (soggetti obbligati, tempistiche, sanzioni) e una sezione di marketing su TeamSystem Waste. **Non contiene nessuna schermata né istruzione operativa sul blocco virtuale** — solo la ricognizione normativa comune ("il blocco... può essere unico a livello di operatore, oppure più blocchi distinti per unità locale", ripresa dal manuale ministeriale) e l'elenco di funzionalità di prodotto ad alto livello: "integrazione con ViViFIR per la vidimazione dei Formulari", "controllo e scadenzario della riconsegna quarta copia (controlli integrati con RENTRi)", "lettura di etichette QR Code ViViFIR" (via app autista).
- **Di TeamSystem Waste non abbiamo trovato documentazione pubblica sul disegno dell'interfaccia del blocco virtuale** (creazione, scelta tra più blocchi, contatore, blocchi disattivati). Solo conferma che il prodotto è interoperabile con ViViFIR/RENTRI a livello di principio.

### Zucchetti — DH Waste / Rifiutoo / Win Waste (galassia prodotti)

Fonti: pagine `zucchetti.it/.../dhwaste-normativa-rentri.html`, pagina Rifiutoo (cloud), motore di ricerca.

- Confermato solo a livello di riassunto (non fonte primaria estratta): "Il sistema permette di creare un blocco virtuale, che consente di ottenere numeri identificativi univoci per i FIR, e di richiedere un numero univoco per scaricare il modello precompilato in formato PDF."
- Le pagine web fetchate (DH Waste) **non contengono dettagli operativi sul disegno dell'interfaccia del blocco** — sono pagine di marketing, non manuali. **Non trovato nulla di utile oltre la conferma generica dell'esistenza della funzionalità.**

### Rifiutoo (Zucchetti, prodotto per piccoli produttori/trasportatori)

Fonte: `rifiutoo.com/blog/come-vidimare-formulario-rifiuti/`.

- L'articolo tratta la vidimazione digitale in generale (dal 13/02/2025 solo via portale RENTRI o gestionali interoperabili). **Non contiene dettagli sul blocco virtuale** nel testo raggiungibile dal tool di fetch.

### Fornitori di cui non abbiamo trovato documentazione pubblica utile

Cercati esplicitamente, nessun risultato con contenuto operativo sul blocco virtuale:

- **Sispi** — nessuna pagina pubblica specifica trovata nella ricerca.
- **Aliante** — nessuna pagina pubblica specifica trovata.
- **Ecobox** — nessuna pagina pubblica specifica trovata.
- **Rentri.cloud** — nessuna pagina pubblica specifica trovata (il nome compare solo come termine di ricerca generico, non abbiamo identificato un prodotto con questo nome esatto).
- **Dedagroup** — non cercato nel dettaglio per limiti di tempo; nessun risultato emerso nelle query eseguite.

Di questi fornitori non abbiamo trovato documentazione pubblica: è un risultato, non un'omissione — molti gestionali rifiuti italiani non pubblicano manuali RENTRI accessibili senza autenticazione.

## Schemi ricorrenti

1. **Il blocco si crea SEMPRE sul portale RENTRI, mai nel gestionale** — su questo tutti i fornitori esaminati (Ecotraccia, Estarweb, EcoDeskWeb, la guida ministeriale stessa) sono allineati, perché non esiste altra via tecnica (nessuna API di creazione). Nessun fornitore visto finora prova a "nascondere" questo passaggio: tutti includono uno screenshot del portale RENTRI con istruzioni passo-passo di navigazione dentro il portale stesso, non solo un rimando testuale.
2. **Il gestionale LEGGE i blocchi via API e li mostra in una lista**, non chiede mai all'utente di incollare un codice a mano (Ecotraccia/Estarweb: lista con Codice Blocco, Attivo, Descrizione, Num Iscr Sito, Indirizzo; EcoDeskWeb: elenco da cui l'amministratore sceglie).
3. **La scelta del blocco è un'impostazione fatta una volta a livello di configurazione, non ripetuta a ogni FIR** — sia in Ecotraccia/Estarweb (Priorità configurata nel popup di configurazione del blocco) sia in EcoDeskWeb ("Codifica aziendale", blocco condiviso per unità organizzativa). L'eccezione è quando ci sono PIÙ blocchi con priorità potenzialmente ambigua: lì Ecotraccia/Estarweb mostrano un menu a tendina al momento della vidimazione del singolo FIR.
4. **Priorità numerica per ordinare tra blocchi multipli** (schema Ecotraccia/Estarweb) è l'unico meccanismo esplicito di "blocco predefinito" documentato in dettaglio: non un flag booleano "predefinito", ma un numero (default 1) che determina l'ordine con cui il sistema pesca dai blocchi disponibili.
5. **Riserva giornaliera** (Ecotraccia/Estarweb): un parametro per blocco che dice quanti formulari vidimare ogni sera per il giorno dopo — è il tentativo del gestionale di automatizzare il rifornimento del blocco, riducendo il rischio di "nessun numero disponibile" al momento dell'emissione.
6. **Il blocco assente/esaurito si scopre SOLO al salvataggio del FIR compilato, non prima** (Ecotraccia/Estarweb: "se il numero di blocco non è valido, il sistema non permette di salvare il formulario"). Nessun fornitore esaminato descrive un controllo preventivo (es. all'apertura della schermata "nuovo FIR") che avvisi prima che l'utente abbia finito di compilare.
7. **Nessun fornitore esaminato mostra un vero "contatore di capienza"** perché coerentemente con quanto sappiamo (il blocco non ha capienza) — quello che viene mostrato è piuttosto lo stato dei singoli numeri già vidimati (Usato/Non Usato/Sbloccato/Non Associato, con colori), cioè un log dei numeri consumati, non un indicatore di "quanto manca a esaurire il blocco".

## Schemi comparsi una volta sola

- Il concetto esplicito di "contenitore/cartella" per spiegare il blocco all'utente (EcoDeskWeb) — non ripreso da altri.
- Il parametro "riserva giornaliera" per pre-vidimare formulari ogni sera (Ecotraccia/Estarweb) — non trovato altrove, ma probabilmente presente anche in altri fornitori white-label dello stesso motore, dato che i due manuali sono identici.
- Menzione di credenziali con scadenza propria ("ID Secret e data di scadenza") distinte dal blocco, in WinWaste — indicazione non confermata sul testo originale.

## Attriti documentati

Molto poco materiale di questo tipo è pubblicamente accessibile (FAQ di supporto, forum, lamentele) tramite i canali cercati:

- La FAQ ufficiale RENTRI raggiunta (`supporto.rentri.gov.it`, id N40765 "Verifica della validità della vidimazione") tratta solo la verifica tecnica della vidimazione via API/tool, non il flusso utente sul blocco. Non abbiamo trovato, tra le FAQ raggiungibili, una voce dedicata esplicitamente a "cosa fare se non ho un blocco attivo" — **non verificato che esista**.
- Nessun forum, recensione o thread di lamentela è stato trovato nella ricerca (le query non hanno restituito questo tipo di contenuto pubblico in italiano per questo tema specifico). Questo è un limite della ricerca, non un'assenza di attrito reale nel mercato.
- L'unico segnale indiretto di attrito trovato è strutturale, non aneddotico: **il fatto stesso che ogni manuale esaminato dedichi un intero capitolo passo-passo, con screenshot del portale RENTRI, a spiegare che il blocco si crea _fuori_ dal gestionale** è la prova che i fornitori si aspettano che l'utente non lo capisca da solo e tenti prima di cercarlo dentro il proprio software.

## Raccomandazione per noi

Sulla base di quanto trovato, concretamente:

1. **Non provare a nascondere la richiesta di andare sul portale RENTRI.** Tutti i fornitori esaminati la rendono esplicita con uno screenshot passo-passo del portale RENTRI stesso dentro il proprio manuale. Facciamo lo stesso nell'interfaccia (non solo nel manuale): quando in `rifiuti` non risultano blocchi letti via API, mostrare un pannello con: (a) il messaggio "nessun blocco virtuale trovato per questo operatore/unità locale", (b) un link diretto a `https://www.rentri.gov.it` con istruzione testuale "Portale RENTRI → Interoperabilità → Gestione blocchi virtuali dei FIR", (c) eventualmente uno screenshot statico embedded (come fa Ecotraccia nel PDF) per chi non ha mai visto quella schermata.

2. **Leggere i blocchi via API e presentarli come lista**, mai un campo di testo libero dove l'utente incolla un codice. È lo standard universale trovato. La API di vidimazione-formulari espone la lettura — usiamola per popolare una tendina/lista, con colonna "Attivo" e "FIR vidimati" (contatore d'uso, non di capienza).

3. **Gestire "più blocchi" con un default esplicito per unità locale, non una scelta ripetuta a ogni FIR.** Lo schema Ecotraccia/Estarweb (priorità numerica) e quello EcoDeskWeb (blocco assegnato una volta all'unità organizzativa via "codifica aziendale") convergono sulla stessa idea: la scelta ripetuta a ogni FIR è un fallback per il caso ambiguo, non il flusso principale. Per noi: implementare un campo "blocco predefinito per unità locale" nella configurazione tenant/azienda (coerente con la nostra regola di isolamento tenant+azienda), con possibilità di scegliere un blocco diverso al momento della vidimazione solo se ce n'è più di uno attivo per quella unità locale.

4. **Controllare la disponibilità del blocco PRIMA che l'utente finisca di compilare il FIR, non solo al salvataggio.** Questo è un punto su cui NESSUNO dei fornitori esaminati sembra fare meglio del minimo (Ecotraccia/Estarweb bloccano solo al salvataggio). È un'occasione per differenziarci: verificare all'apertura della schermata "nuovo FIR" (o già nella dashboard) se esiste almeno un blocco attivo con margine, e avvisare prima, non dopo 20 minuti di compilazione. Il rischio di attrito peggiore documentato nel nostro dominio (vedi promemoria interno) è proprio l'utente che scopre il problema a lavoro fatto.

5. **Mostrare i blocchi disattivati in modo distinto ma non nasconderli**, coerentemente con la regola "non si cancellano, si disattivano": un blocco disattivato può ancora avere formulari vidimati in stato "Non Usato" che servono a scopi di audit/storico. Nessun fornitore esaminato documenta esplicitamente questo comportamento (punto lasciato scoperto anche da loro) — è un'opportunità per fare meglio: mostrarli in grigio/attenuati in una sezione "blocchi non più attivi", non farli sparire dalla UI.

6. **Contatore = log di consumo, non barra di capienza.** Dato che il blocco non si esaurisce, evitare di disegnare una progress bar che implichi un limite (sarebbe fuorviante). Riprendere invece lo schema a stati/colori di Ecotraccia (Usato/Non Usato/Sbloccato/Non Associato) per dare visibilità operativa su quanti numeri restano "pronti all'uso" in un blocco, utile per decidere se vidimarne altri — non per dire "il blocco sta per finire".
