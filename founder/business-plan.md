# WasteFlow · Business plan

**Verdict: Incomplete**

- ✗ 0 of 20 simulated buyers buy (0%, the bar is 25%).
- No numbers yet. Run /founder-cfo, then compile again.

## The idea

- Cos'è: piattaforma SaaS B2B per la gestione digitale dei rifiuti (FIR, registri di carico/scarico, MUD, sincronizzazione RENTRI) per aziende italiane. (rifiuti/README.md; rifiuti/docs/FEATURES.md §1)
- Per chi: consulenti ambientali che gestiscono più aziende clienti da un unico accesso, indicati come beachhead; aziende produttrici, trasportatrici e destinatarie di rifiuti speciali, in particolare PMI e gruppi multi-sede. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §beachhead; rifiuti/docs/FEATURES.md §1)
- Cosa vende, a che prezzo: abbonamento SaaS per azienda. NON DOCUMENTATO — domanda aperta: nessun listino approvato o pubblicato; i documenti riportano tre proposte in conflitto (vedi brief.md, sezione "Prezzi documentati").
- Dove e come: web app online, nessuna app mobile. Canali di acquisizione: piani scritti (SEO, LinkedIn, associazioni di categoria), esecuzione non documentata. Consegna: accesso via browser; onboarding self-service dichiarato come obiettivo. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md; rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md)
- Budget e vincoli: costo sviluppo cumulato da sessioni AI 3.209,37 USD (rifiuti/COSTS.md); fondatore unico decisore nei documenti; firma FIR tramite firma remota RENTRI già decisa (rifiuti/docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md); tempo e capitale disponibili non documentati.

## Summary

**Verdetto: Incomplete.** Non esiste `numbers.json`: margine per unità, break-even e utile di anno 1 non sono calcolati, e non vengono stimati qui. Il controllo sul panel fallisce: 0 acquisti su 20 (0%, soglia 25%).

### Cosa deve cambiare

Il piano così com'è non è finanziabile. Il board ha già indicato la direzione: **PASSA**, con manutenzione minima, finché tre gruppi o consulenti reali non firmano una lettera d'intenti con prezzo dopo una demo.

1. **Prova di domanda.** Nessun cliente, nessun contratto, nessun pilota. Il panel (simulato) dà 0 acquisti: motivi fiducia (7), abitudine (7), prezzo (4), bisogno (2). Chi governa il gate: `/founder-consumer` sui gruppi reali, poi `/founder-launch`.
2. **Prezzo.** Concorrenti pubblici a 69-430 €/anno per azienda, mediana 125 €. Il pitch corrente propone 1.200 €/anno per gruppo fino a 5 società, e i documenti interni riportano tre listini in conflitto. Il range del panel va da 401,57 € a 1.200,20 €, ma le risposte sono ancorate al prezzo proposto: non sono un listino. Chi lo cambia: `/founder-pricing`.
3. **Risultato promesso.** Il FIR digitale è obbligatorio dal 16/09/2026, e il portale RENTRI è gratuito. Accreditamento RENTRI, firma e conservazione a norma non sono ancora certi. Chi lo cambia: `/founder-ops` e `/founder-offer`.
4. **Gap.** 25 concorrenti analizzati; almeno quattro dichiarano già il multi-azienda o il linguaggio da gruppo. Il gap madre-figlie è candidato, non provato.

### Rischio principale e risposta

Nessuna prova di acquisto, e un incumbent (Zucchetti, con Rifiutoo) che può copiare la funzione in un trimestre. Risposta: nessuno sviluppo nuovo prima del gate, e la demo con tre gruppi o consulenti veri.

### Cosa serve per partire

Cassa necessaria: non calcolata (serve `/founder-cfo`). Primo test: la demo con i tre soggetti reali (`/founder-launch`).

### La cosa da fare questa settimana

Mettere per iscritto il perimetro di manutenzione minima (congelati: pesa, contratti, ESG, mobile, marketplace, white-label) e scegliere i tre gruppi o consulenti da contattare per la demo.

_Il panel è simulato e i numeri sono proiezioni: prima di spendere, confermare con clienti reali e preventivi veri. Non è consulenza finanziaria, legale o fiscale._

## What the board said

### 1. Il voto

**2 FINANZIA SE, 1 PASSA** — punteggio medio **3,7/10**.

| Lente | Punteggio | Voto |
|--|--|--|
| Offerte | 4 | FINANZIA SE |
| Monopolio | 3 | PASSA |
| Prodotto | 4 | FINANZIA SE |

Domanda posta al board: "WasteFlow merita il tempo del fondatore rispetto agli altri cinque progetti?".

### 2. I rischi sollevati da più membri

1. **Nessun utente reale, nessuna prova** (tutte e tre). Al 09/09 risultano 8 tenant e 10 utenti, nessuno in produzione reale, nessun contratto, pilota con importo o lettera d'intenti. Nella value equation la likelihood è a zero.
2. **Commodity in un mercato con incumbent distribuiti** (tutte e tre). WinWaste e Rifiutoo (Zucchetti), QuiRifiutiPro (Buffetti), PrometeoRifiuti e altri hanno già i canali. Sulla conformità WasteFlow è "in gara"; su 4 aree su 8 è sotto il minimo di mercato (scadenze, conservazione a norma, operatività quotidiana, cruscotto).
3. **Il risultato promesso non è ancora consegnabile** (tutte e tre). Accreditamento RENTRI all'interoperabilità ancora "fuori" al 10/09, firma senza valore legale (nessun QTSP), conservazione a norma assente, MUD incerto. Le date d'obbligo (13/02 e 16/09/2026) sono già passate.
4. **Nessun prezzo** (tutte e tre): tre listini in conflitto (49/149/399, 49/149, 49/99/249).
5. **Troppe promesse** (Prodotto, Offerte): FIR digitale, RENTRI, consulenti e gruppi societari, più pesa, contratti, ESG e AI. Il pitch non sta in una frase. Ambiguità tra PA e privati.

### 3. Le condizioni, come checklist

- [ ] Gate a tempo (6-8 settimane, poche ore a settimana): almeno 3 consulenti o gruppi madre-figlie con prevendita o lettera d'intenti con prezzo in euro. Senza, PASSA.
- [ ] Nessuno sviluppo nuovo prima del gate
- [ ] Una frase, un utente: "il consulente che gestisce N aziende tiene in ordine FIR e scadenze di tutte da un solo posto"
- [ ] Pesa, contratti, ESG, mobile, marketplace e white-label congelati per iscritto
- [ ] 3-5 consulenti reali osservati senza aiuto su dati veri, con il tempo del primo FIR misurato
- [ ] Un pilota di 30 giorni in produzione con un risultato misurabile (ore risparmiate, scadenze evitate)
- [ ] Accreditamento RENTRI ottenuto o con data certa; firma valida, oppure dichiarare apertamente che oggi il FIR non ha valore legale
- [ ] Conservazione a norma tramite un servizio esterno
- [ ] Un solo listino approvato e pubblicato (per azienda, senza tetti sui movimenti)
- [ ] Garanzia legata a ciò che il fondatore controlla (onboarding, import), non alla conformità RENTRI
- [ ] Togliere dai materiali ciò che non esiste (mobile, conservazione, MUD se è uno stub)
- [ ] Fonte verificata per "150.000 aziende / 5.000-8.000 consulenti" (`/founder-competitors`)

### 4. Disaccordi

Il Monopolio vota PASSA: la conformità normativa è una commodity che tutti devono implementare, e Zucchetti può copiare la funzione madre-figlie in un trimestre. Offerte e Prodotto vedono un dolore imposto per legge (chi è obbligato non può non comprare) e un beachhead raggiungibile (i consulenti, che portano più aziende con un solo acquisto). Per questo concedono un gate corto. Tutti e tre concordano: fra i sei, è il più avanti tecnicamente e il meno validato.

### 5. La versione più forte che il board vede

Non un "gestionale rifiuti" contro Zucchetti, ma **lo strumento del consulente ambientale multi-azienda**, con i gruppi societari madre-figlie (l'unico spazio "davvero scoperto" nell'audit dell'11/09) come caso d'uso distintivo. Venduto al consulente, che è il canale verso le PMI. La distanza da qui a lì non è codice: sono tre conversazioni con consulenti che pagano. Il board non vede la versione PA.

### 6. Aggiornamento del 16/11/2026, dopo `/founder-competitors`

L'analisi dei concorrenti (`founder/competitors.md`) peggiora le condizioni economiche del voto:

- **Prezzo fuori mercato.** I prezzi pubblici vanno da 79 a 430 €/anno per azienda (mediana 180). Il listino minimo proposto, 49 €/mese (588 €/anno), è già sopra il massimo pubblico. Le cifre sui concorrenti riportate nei documenti interni (Rifiutoo 79-199 €/mese, QuiRifiutiPro 49-149 €/mese, WinWaste 200-500 €/mese) non hanno trovato conferma in nessuna fonte.
- **Il beachhead dei consulenti non è scoperto.** Rifiutoo, GoRENTRI Partner (Namirial), TeamSystem, Prometeo e RifiutiGuru dichiarano già il multi-azienda per consulenti, e il portale RENTRI permette al consulente di operare come incaricato.
- **Il portale RENTRI è gratuito** (registri, FIR, app, formazione): ogni funzione aggiunta dal Ministero restringe il margine.
- **L'urgenza normativa è finita**: l'obbligo del FIR digitale è scattato il 16/09/2026, senza proroghe successive trovate.
- **Unico candidato a un gap: i gruppi societari madre-figlie.** Nessun concorrente lo dichiara nelle fonti pubbliche, ma "non dichiarato" non significa "assente".

Nuove voci per la checklist:

- [ ] Listino riallineato al mercato (79-430 €/anno per azienda), oppure una funzione che giustifichi un prezzo più alto e che un cliente abbia accettato
- [ ] 3 gruppi societari reali intervistati sul problema madre-figlie prima di qualsiasi sviluppo
- [ ] Ricerca approfondita sui concorrenti (WinWaste, Rifiutoo e gli altri accreditati) e panel simulato sull'idea madre-figlie: in corso il 16/11/2026

### 7. Aggiornamento del 16/11/2026: ricerca approfondita e panel madre-figlie

**Ricerca** (`competitors.md`, 25 prodotti): prezzi pubblici 69-430 €/anno per azienda (mediana 125). Non esiste un elenco pubblico di software accreditati RENTRI. Rifiutoo (Zucchetti) ha piani "multi ragione sociale e pannello multi-azienda" e piani per consulenti fino a 100+ registri; WinWaste è un ERP per trasportatori e impianti. Almeno quattro concorrenti usano già un linguaggio da "gruppo/capogruppo": il gap madre-figlie è coperto a parole, non provato. La delega RENTRI copre solo la trasmissione dei dati: il controllo della capogruppo rischia di essere solo una vista.

**Panel** (`panel/`, 20 buyer simulati, pitch madre-figlie a 1.200 €/anno fino a 5 società, accreditamento dato per acquisito): **0 acquisti su 20**. Motivi: fiducia (7), abitudine/status quo (7), prezzo (4), bisogno (2). Temi ricorrenti:
- "La scadenza è passata, ce la caviamo come adesso"; il portale RENTRI gratuito basta.
- Il controllo della capogruppo è reale o solo una vista, visto che ogni società firma e risponde per sé?
- Doppio inserimento: chi ha già il modulo rifiuti nell'ERP non vuole un secondo sistema.
- Il canale passa dal consulente: chi delega non sceglie il software.
- Chi risponde delle sanzioni se la trasmissione fallisce; nessuna referenza.

Fascia di prezzo dalle risposte: 400-1.200 €/anno per il gruppo (punto di minima resistenza intorno a 400 €). Come per ROADS, le risposte sono ancorate al prezzo proposto: non usarle per fissare il listino.

**Lettura del presidente:** con l'urgenza normativa scaduta, un portale pubblico gratuito, concorrenti a 69-125 €/anno con canali consolidati e un gap che i concorrenti già rivendicano, nessuna delle verifiche fatte trova un motivo d'acquisto. Il voto del board va rivisto verso **PASSA**: manutenzione minima, nessun nuovo sviluppo. L'unica condizione per riaprire resta un fatto reale: 3 gruppi o consulenti veri che, dopo una demo, firmano una lettera d'intenti con prezzo.

## The competition

Data: 2026-11-16. Prima mappa estesa con un censimento ampio, WinWaste e Rifiutoo in profondità, voci dei clienti, gruppi madre-figlie e prezzi per consulenti. Solo fonti pubbliche, ogni fatto con link. "non pubblico" = nessun prezzo trovato. "non verificato" = pagina non raggiungibile (molti siti rispondono 403) o dato assente. Dettaglio per riga in `competitors.csv`.

**Limite di metodo (importante):** WebFetch restituisce spesso un riassunto del modello e non il testo grezzo, e i PDF compressi (HRC, Valore24, manuale GoRENTRI, Q&A Aruba) non erano leggibili. I siti di Wolters Kluwer e BetterWaste rispondono 403. WebSearch non indicizza Reddit, gruppi Facebook e LinkedIn: **non ho trovato nessun thread Reddit o forum con testimonianze di utenti**. Dove un dato viene da una sintesi di ricerca e non da una pagina aperta, è indicato.

### 1. Calendario ATTUALE RENTRI e FIR digitale (al 16/11/2026)

Invariato rispetto alla prima edizione. 13/02/2026 non è più la data dell'obbligo FIR: è stata spostata.

| Data | Cosa | Fonte |
|---|---|---|
| 15/06 - 14/08/2025 | Seconda finestra di iscrizione (produttori non pericolosi con più di 10 dipendenti, esclusa l'edilizia) | [rentri.gov.it](https://www.rentri.gov.it/); [guida ANCE](https://lavoripubblici.it/documenti2025/lvpb1/guida-ance-rentri.pdf) |
| 15/12/2025 - 13/02/2026 | Ultimo scaglione di iscrizione (produttori di pericolosi con fino a 10 dipendenti) | [PuntoSicuro](https://www.puntosicuro.it/magazine/view-pdf/rentri-dal-15-dicembre-via-al-terzo-ultimo-scaglione-AR-26011/); [Namirial](https://focus.namirial.com/it/rentri-2026/) (fonti secondarie) |
| 13/02/2026 | Data originaria del FIR digitale; il portale ha avuto un "incidente di servizio" | [InformazioneFiscale](https://www.informazionefiscale.it/rentri-fir-digitale-non-funziona-procedura-emergenza) |
| 27/02/2026 | Legge n. 26: dal 01/03 al 15/09/2026 il FIR può essere digitale o cartaceo | [avviso ufficiale 31/03/2026](https://www.rentri.gov.it/news/fir-chiusura-delle-modalita-operative-di-sicurezza) |
| 14/04/2026 | Cessano le "modalità operative di sicurezza" del FIR digitale | stesso avviso |
| **16/09/2026** | **FIR digitale obbligatorio per tutti gli iscritti** (testo ufficiale) | [avviso ufficiale](https://www.rentri.gov.it/news/fir-chiusura-delle-modalita-operative-di-sicurezza) |
| 30/04 di ogni anno | Contributo annuo per unità locale | [ANCE](https://ance.it/2025/04/rentri-in-scadenza-i-contributi-di-iscrizione/) |
| 03/12/2026 (uso dal 09/12) | Nuovi codici EER per rifiuti di batterie | [rentri.gov.it](https://www.rentri.gov.it/) |
| 13/09/2027 | Rinvio dei dati di geolocalizzazione dei veicoli (D.D. 275 del 12/10/2026) | [rentri.gov.it](https://www.rentri.gov.it/) |

Cose da sapere:
- Dopo il 16/09/2026 non ho trovato proroghe. Un articolo del 17/09/2026 conferma che il periodo transitorio è finito il 16/09 e che le sanzioni per trasmissione mancante partono dal 15/09 ([ItaliaOggi](https://www.italiaoggi.it/diritto-e-fisco/diritto-e-impresa/rifiuti-il-rentri-non-va-ce-un-piano-b-e-le-sanzioni-vanno-a-regime-osrxxz3l), via sintesi). Il D.D. 254 del 09/09/2026 fissa le regole per i malfunzionamenti. Verifica finale a mano sul portale.
- Molti siti di fornitori hanno ancora date incoerenti: GECO2 cita nello stesso testo 15 e 16 settembre ([geco2.it](https://www.geco2.it/)), la home del portale cita ancora il 13/02.
- **Sanzioni:** fonti discordanti (PuntoSicuro 1.000-10.000 euro, fino a 15.000 per pericolosi; TeamSystem altri importi). Non usarle nei materiali senza il testo in Gazzetta Ufficiale.
- **Perimetro:** i produttori di soli non pericolosi con fino a 10 dipendenti non sono obbligati ([Namirial](https://focus.namirial.com/it/rentri-2026/); [ANCE FAQ](https://ance.it/wp-content/uploads/allegati/FAQ_ANCE.pdf)). Per i numeri del brief (150.000 aziende, 5.000-8.000 consulenti) **non ho trovato alcuna fonte**.
- L'urgenza normativa è finita: ora è un mercato di sostituzione.

### 2. Cosa offre gratis il portale RENTRI, e cosa resta da vendere

Invariato, con un'aggiunta. **Gratis:** servizi di supporto (registro cronologico, FIR digitale anche con app, firma, DEMO, formazione) pensati per operatori senza gestionale ([rentri.gov.it](https://www.rentri.gov.it/); [slide Camera di Commercio di Bologna](https://www.bo.camcom.it/sites/default/files/ambiente/20241022%20slide%20registr_fir_servizi_supporto.pdf)). Un incaricato, anche esterno, può operare per conto dell'azienda. **Non gratis:** diritto di segreteria 10 euro e contributo annuo per unità locale (importi discordanti fra fonti camerali e blog; la tabella ufficiale DM 59/2023 allegato III non è stata letta).

**Aggiunta dalle fonti dei fornitori (di parte):** Iter Innovation (rivenditore Rifiutoo) elenca i limiti del portale: SPID a ogni accesso, reportistica scarsa, nessuna conservazione digitale, nessun ritorno dopo la conferma del registro ([Iter](https://www.iterinformatica.it/software-gestionale-rifiuti-o-portale-rentri-cosa-e-meglio/)). Rifiutoo precisa che il registro non si può gestire alternando portale e gestionale: va scelto all'apertura ([Rifiutoo](https://www.rifiutoo.com/rentri/rentri-non-funziona/), via sintesi). Sono posizioni di chi vende software.

**Cosa resta da vendere (deduzione):** scadenze e alert, giacenze, MUD, conservazione AgID, dashboard, molte aziende da un posto, integrazione ERP. Il confine da difendere è "tempo risparmiato su N aziende", non "conformità".

### 3. Censimento: 25 prodotti e servizi

Verificati sulla pagina del produttore (13): Rifiutoo, WinWaste, TeamSystem Waste, TeamSystem Waste 360, GoRENTRI, PrometeoRifiuti, RifiutiGuru, QuiRifiutiPro, Centro Software Cloud RENTRi, EcoGest, GECO2, Ecosolve, SistemaRentri. Gli altri sono letti solo tramite terzi, sintesi o non raggiungibili (colonna Fonte). Tre "prodotti" sono solo nomi citati in guide di parte (Savino Solution, Rifiù, Rentri360). Non conto DOP Software, cieTrade, denxpert, Cro, Wastebits: sono su [Capterra IT](https://www.capterra.it/directory/10045/waste-management/software) ma non ho evidenza che siano prodotti RENTRI italiani.

**Elenco ufficiale di software accreditati/interoperabili:** **non l'ho trovato**. Il portale ha una sezione "servizi per l'interoperabilità" con la documentazione tecnica per gli sviluppatori e un ambiente DEMO, ma nessun elenco pubblico di prodotti certificati; "interoperabile" è un'autodichiarazione. Unica eccezione: Software & Service Campania parla di "un certificato di interoperabilità" per QuiRifiutiPro ([pagina](https://www.softwarecogest.it/)), non verificabile.

| Prodotto | Produttore / canale | Target | Funzioni RENTRI dichiarate | Multi-azienda / consulenti | Gruppi / UL | Prezzo pubblico | Fonte |
|---|---|---|---|---|---|---|---|
| Rifiutoo | Rifiutoo S.r.l. (Bologna, Gruppo Zucchetti); rivenditori Arcode/A3, Iter; Zucchetti Store | produttori, trasportatori, consulenti, associazioni | interoperabilità nativa, registri, xFIR, MUD, conservazione (extra) | Sì: piani Freelance/Advisor/Master | Custom Pro: multi ragione sociale, multi UL, Pannello Multi-azienda | non pubblico (annuale anticipato) | [prezzi](https://www.rifiutoo.com/prezzi/) |
| WinWaste.NET | NICA, Zucchetti Ambiente | trasportatori, impianti, intermediari, recuperatori | via "DH Waste"; registro, FIR dal 13/02/2026 | non descritta | non descritta | non pubblico | [winwaste.net](https://winwaste.net/) |
| TeamSystem Waste | TeamSystem, store | PMI, consulenti su richiesta | registri, FIR con firma, RENTRI | su richiesta | 1 azienda/1 UL nel listino | 180 / 430 EUR + IVA/anno | [prezzi](https://www.teamsystem.com/aziende/ts-waste/prezzi/) |
| TeamSystem Waste 360 | TeamSystem Enterprise | gestori servizio ambientale, impianti, produttori | RENTRI, VIVIFIR, MUD, ARERA | non descritta | "gestione centralizzata", vago | non pubblico | [pagina](https://www.teamsystem.com/aziende/waste-360/) |
| GoRENTRI / Partner | Namirial | micro-imprese; commercialisti, CAF, consorzi | registri (240 mov/anno), firma, conservazione, MUD | Partner: sì, "unica interfaccia", opera in delega | non descritta | GoRENTRI 95 EUR + IVA/anno; Partner non pubblico | [Namirial](https://www.namirial.it/rentri); [InformazioneFiscale](https://www.informazionefiscale.it/RENTRI-Namirial-gestione-rifiuti-studio-professionale) |
| Aruba RENTRI Smart | Aruba | PMI produttrici | registri, FIR, giacenze, scadenze, conservazione | consulente per più aziende: domanda nel Q&A, risposta non letta | UL illimitate | 79 EUR + IVA/anno (promo 1 EUR fino al 31/03/2026) | [Aranzulla](https://www.aranzulla.it/come-funziona-aruba-rentri-smart-1875510.html) |
| PrometeoRifiuti | Informatica EDP (Fossano) | produttori, trasportatori, consulenti, associazioni | registri, formulari, MUD, RENTRI | sì, consulenti tengono i registri dei clienti | non menzionati | da 125 EUR "per utente", periodo ignoto (Capterra) | [sito](https://prometeorifiuti.com/); [Capterra](https://www.capterra.it/software/189319/prometeo-rifiuti) |
| RifiutiGuru | Dylog-Buffetti | molti target incl. consulenti e associazioni | FIR, registro, MUD, RENTRI | sezione consulenti, dettagli assenti | non menzionati | non pubblico | [rifiutiguru.it](https://rifiutiguru.it/) |
| QuiRifiutiPro + Console | Dylog-Buffetti; reseller Software & Service Campania | produttori, trasportatori; Console: consulenti, associazioni, gruppi di aziende | registri, FIR, MUD, giacenze, conservazione | Console con dashboard multi-aziendale | cita "gruppi di aziende", senza dettaglio | Console 350 / 1.150 EUR + IVA (v. §7) | [pagina](https://www.softwarecogest.it/); [QuiRifiutiPro](https://www.quirifiutipro.it/) |
| Centro Software Cloud RENTRi | Centro Software (ERP) | produttori | registri, FIR, giacenze, archiviazione AgID | pacchetti Corporate/Unlimited aggiungono aziende | multi-sito con una dashboard | non pubblico | [pagina](https://www.centrosoftware.com/gestione-rifiuti-rentri/) |
| EcoGest | SEA Sistemi (partner Passepartout) | aziende con Mexal | registri, FIR, RENTRI, MUD, transiti con pese | portale Passweb con profili consulenti | profilo "capogruppo" (poteri non spiegati) | non pubblico | [pagina](https://www.softwarecogest.it/) |
| GECO2 | Green Evolution | piccole e grandi imprese, consulenti | registro e xFIR interoperabili | "un registro per consulenti" | non descritti | non pubblico | [geco2.it](https://www.geco2.it/) |
| Ecosolve | SIA S.r.l. | aziende di ogni dimensione, consulenti | invio e monitoraggio registrazioni, prototipo | non menzionata | non menzionati | non pubblico | [ecosolve.it](https://ecosolve.it/) |
| SistemaRentri | non indicato | produttori, trasportatori, consulenti | iscrizione inclusa | Console 1.200 EUR/anno (da terzi) | non menzionati | pagina prezzi non letta | [sito](https://www.sistemarentri.it/) |
| RENTRI Suite | Quality and Safety (Moncalieri) | consulenti e aziende | registri, FIR, conservazione | sì, per scaglioni | 5 EER per azienda | 69 EUR + IVA/anno | [guida](https://www.qualityandsafety.org/guide/software-rentri-consulenti-ambientali) (autore = venditore) |
| Atlantide / SimpleDo Waste | Wolters Kluwer | enterprise, impianti | interoperabile (dichiarato) | non verificato | non verificato | non pubblico | [pagina](https://www.wolterskluwer.com/it-it/solutions/simpledo/moduli/waste) (403) |
| HRC Gestione Rifiuti | HRC S.r.l. | aziende | interoperabile (da sintesi) | non verificato | non verificato | non pubblico | [PDF](https://hrcsrl.it/wp-content/uploads/2025/02/GESTIONE-RIFIUTI-1.pdf) (illeggibile) |
| Valore24 RENTRI | Gruppo 24 ORE | aziende, consulenti | RENTRI (da sintesi) | "consulenti che affiancano" | non verificato | non pubblico | [brochure](https://minisiti.ilsole24ore.com/250404_Brochure_new/V24_RENTRI_BROCHURE_DIGITALE.pdf) |
| EcoDeskWeb | Ecocerved (camerale) | imprese | MUD e adempimenti | non verificato | non verificato | canone, importo ignoto | [brochure](https://ecodeskweb.ecocerved.it/testi/Brochure-EcoDeskWeb.pdf) |
| BetterWaste | non verificato | non verificato | registro digitale | non verificato | non verificato | "69,90" (valuta e periodo ignoti) | [sito](https://betterwaste.it/) (403) |
| Mar.te RENTRI Base | non verificato | chi ha già un gestionale | solo conservazione | no | no | 20 EUR + IVA/anno | [guida](https://www.qualityandsafety.org/guide/portale-rentri-o-software-gestionale) |
| Savino Solution, Rifiù, Rentri360, Exprivia | solo nomi in guide di parte | non verificato | non verificato | non verificato | non verificato | non verificato | [RentriGuru](https://rentriguru.it/le-5-migliori-soluzioni-software-per-la-gestione-rifiuti-con-il-rentri/); [Exprivia](https://www.exprivia.it/?p=46401) (404) |
| Portale RENTRI (servizi di supporto) | MASE / Albo | tutti | tutte | un'azienda per volta; incaricato esterno ammesso | per UL | gratuito (più contributi) | [rentri.gov.it](https://www.rentri.gov.it/) |
| Consulente "a mano" / Associazioni delegate | — | — | via portale | è il cliente-target | — | non pubblico | [Confindustria TCC](https://confindustriatoscanacentroecosta.it/wp-content/plugins/download-attachments/includes/download.php?id=363036) |

**Ancora non trovati** fra quelli citati nel brief: Datalog, Ecotraccia (ECIPA/CNA), Estarweb, Terranova, Ambiente.it ECOS. **Conteggi clienti dichiarati (tutti claim del fornitore, non verificati):** Rifiutoo "+6.000 aziende e consulenti" ([home](https://www.rifiutoo.com/)); WinWaste "oltre 2500 clienti attivi" ([winwaste.net](https://winwaste.net/)); Prometeo "più di 3.000 clienti" ([sito](https://prometeorifiuti.com/)); GECO2 "500 clienti consolidati" ([geco2.it](https://www.geco2.it/)); RifiutiGuru "5.000+ clienti nell'ultimo mese" ([home](https://rifiutiguru.it/)).

### 4. WinWaste e Rifiutoo in profondità (entrambi Gruppo Zucchetti)

**Sono due prodotti per due pubblici diversi, e Zucchetti lo dice in pagina.**

**WinWaste.NET** è un ERP per chi lavora i rifiuti (NICA, oggi Zucchetti Ambiente, Marigliano NA):
- Moduli: undici, da gestione rifiuti, contabilità, parco automezzi e fatturazione elettronica fino a portale clienti Wingap, magazzino end of waste, manutenzione impianti, conservazione sostitutiva, geolocalizzazione e Rete Raee ([Zucchetti](https://www.zucchetti.it/it/cms/soluzioni/asset-management/gestione-rifiuti/gestione-rifiuti-industriali/winwaste/gestione-rifiuti-industriali-descrizione.html)). Il sito indica sei aree funzionali e la voce RENTRI "Interoperabile" ([winwaste.net](https://winwaste.net/)).
- RENTRI: tramite "DH Waste" (nome non spiegato in alcuna pagina letta); registro digitale e FIR digitali "a partire dal 13.02.2026". **Per i produttori iniziali la pagina Zucchetti rimanda a Rifiutoo su Zucchetti Store.** Quindi WinWaste non compete con WasteFlow per il produttore.
- Target: trasportatori, impianti, intermediari, recuperatori; i consulenti compaiono solo come voce di menu "Consulenti accreditati" senza dettaglio. Multi-azienda: non trattato.
- Canale: rete nazionale con punti vendita, assistenza e distributori (~50 professionisti dichiarati); prezzo solo su richiesta (listino in PDF non raggiungibile). Zucchetti ha anche una rete di partner generica, ma non ho trovato un rivenditore WinWaste con listino pubblico.
- Voci utenti: la scheda iOS "RENTRI" di NICA ha 3 recensioni (v. §6); il produttore risponde che serve WinWaste.NET aggiornato e configurato.

**Rifiutoo** è il prodotto cloud per produttori e consulenti (Rifiutoo S.r.l., Bologna, "Società del Gruppo Zucchetti" per la [home](https://www.rifiutoo.com/); Capterra lo attribuisce a Sfridoo):
- **Prezzi: nessun importo pubblico**, né sul sito né presso i rivenditori che ho letto (Arcode Group/A3 Soluzioni: "Prezzi: non indicati", Iter Innovation). Il numero circolante è il "da 199 EUR" di Capterra, senza periodo. Le FAQ dicono che i pagamenti Essential e Pro sono **annuali anticipati**: i "79-199 EUR/mese" del brief sono quindi incoerenti con il modello dichiarato ([pagina prezzi](https://www.rifiutoo.com/prezzi/)).
- Produttori: Essential Base 70 movimenti/anno (1 ragione sociale, 1 utente, 1 UL, 100 MB), Essential Elite 200 movimenti ("il più richiesto"), Custom Pro oltre 200 con multi ragione sociale, multi utente, multi UL e multi registro. Include cantieri temporanei, giacenze, MUD, scadenze, statistiche, esportazione dati.
- Extra a pagamento: conservazione digitale (non inclusa nella licenza), startup con tecnico e supporto all'iscrizione, consulente ambientale, notifiche email, assistenza telefonica a pacchetti di ore; solo Custom: banca dati Albo Gestori, **Pannello Multi-azienda**, SSO e white-label.
- Consulenti: Freelance (20 registri, 6.000 movimenti/anno, 1 utente), Advisor (50 registri, 17.500 movimenti, 2 utenti, "il più richiesto"), Master (oltre 100 registri, oltre 40.000 movimenti, 3+ utenti, SSO). I limiti sono sui **registri** e sui movimenti dei clienti, non sul numero di aziende. Extra: utenza cliente, conservazione digitale, banca dati Albo, alert via email, assistenza telefonica, SSO ([consulenti](https://www.rifiutoo.com/prezzi/consulenti/)). Prezzi: "Contattaci Ora".
- Canale: acquisto diretto con demo; Essential Base/Elite anche su Zucchetti Store; rivenditori terzi ([Arcode Group](https://arcodegroup.it/software/gestione-rifiuti/), [Iter](https://www.iterinformatica.it/software-gestionale-rifiuti-o-portale-rentri-cosa-e-meglio/)). Attivazione in circa due ore dalla firma dell'offerta.
- Voci utenti: Trustpilot 4.7 su 35 recensioni, nessuna sotto 4 stelle, ma la pagina avverte che l'azienda non invita di recente a recensire ([Trustpilot](https://it.trustpilot.com/review/rifiutoo.com)). **La prima mappa diceva "0 recensioni": vale solo per Capterra e Software Advice.**

### 5. Fascia di prezzo (annua, IVA esclusa, UNA azienda, prezzi pubblici)

Sette prezzi comparabili: RENTRI Suite 69 (fonte di parte), Aruba 79 (dal rinnovo), GoRENTRI 95, Prometeo 125 (periodo ignoto), TeamSystem 180 e 430, Rifiutoo 199 (periodo ignoto). **Minimo 69, mediana 125, massimo 430 EUR/anno** (prima edizione: 79 / 180 / 430). Esclusi: Mar.te 20 (solo conservazione), BetterWaste 69,90 (non verificato). Il prezzo medio effettivo include spesso extra: conservazione da 60 EUR a documento (QuiRifiutiPro), movimenti extra a 12 EUR (TeamSystem), 2,50 EUR a movimento di ricarica FIR (QuiRifiutiPro).

Dodici dei venticinque non pubblicano alcun prezzo. WasteFlow a 49 EUR/mese = 588 EUR/anno sta sopra il massimo pubblico per una azienda singola (430) e circa 5 volte la mediana. Le cifre del brief su concorrenti (Rifiutoo 79-199 EUR/mese, QuiRifiutiPro 49-149 EUR/mese, WinWaste 200-500 EUR/mese) **restano non confermate da alcuna fonte**.

### 6. Mappa di posizionamento (testo)

Assi: prezzo pubblico (basso -> alto) e capacità multi-azienda (una azienda -> molte, gruppi).
- Basso prezzo, una azienda: portale RENTRI (0), RENTRI Suite (69), Aruba (79), GoRENTRI (95), Prometeo/TeamSystem/Rifiutoo entry (125-199).
- Multi-azienda con prezzo pubblico: RENTRI Suite consulenti (50-69 per azienda), QuiRifiutiPro Console (350-1.150, di rivenditore), SistemaRentri Console (1.200 + licenze). Tutto il resto: su richiesta.
- Multi-azienda su richiesta: Rifiutoo (Custom Pro e consulenti), Namirial Partner, TeamSystem, Centro Software, EcoGest.
- Mercato ERP/impianti (non il bersaglio): WinWaste, Waste 360, Atlantide, EcoGest.
- WasteFlow (listino non approvato, 588+ EUR/anno): in alto a destra, senza clienti né prove.

### 7. Prezzi per consulenti: 10, 30, 100 aziende

| Soluzione | 10 aziende | 30 aziende | 100 aziende | Note e fonte |
|---|---|---|---|---|
| RENTRI Suite (Quality and Safety) | 690 EUR/anno | 1.770 EUR | 5.000 EUR | 69/59/50 EUR per azienda per scaglione (1-10 / 11-30 / 31-100), movimenti illimitati, conservazione inclusa, console gratuita; totali **calcolati da me** applicando lo scaglione a tutte le aziende, come dice la pagina. **Listino del produttore stesso, confronto di parte.** [guida](https://www.qualityandsafety.org/guide/software-rentri-consulenti-ambientali) |
| QuiRifiutiPro Console (reseller Software & Service Campania) | non pubblico | non pubblico | non pubblico | Console Small 350 EUR + IVA; Console Small Promo 50 clienti 1.150 EUR + IVA (50 licenze, abbonamento Economy); più 2,50 EUR a movimento FIR e conservazione da 60 EUR a documento. Il costo per 10 o 30 aziende e oltre 50 non è indicato. Promo "50 aziende a 999 EUR + IVA" scaduta il 31/01/2026 ([pagina](https://www.softwarecogest.it/); [ilcentrofb](https://www.ilcentrofb.it/consulenti-ambientali-semplificate-la-gestione-rifiuti-con-quirifiutipro/)) |
| SistemaRentri Console | 1.200 EUR + licenze | idem | idem | 1.200 EUR/anno di console + "licenze aggiuntive per ogni azienda", importo ignoto (da guida di parte) |
| Rifiutoo (Freelance / Advisor / Master) | su richiesta | su richiesta | su richiesta | Freelance fino a 20 registri, Advisor 50, Master oltre 100; limiti per registri, non aziende; "Contattaci Ora" ([consulenti](https://www.rifiutoo.com/prezzi/consulenti/)) |
| GoRENTRI Partner (Namirial) | non pubblico | non pubblico | non pubblico | Il singolo GoRENTRI costa 95 EUR + IVA/anno; non ho trovato il listino Partner |
| TeamSystem Waste | su richiesta | su richiesta | su richiesta | consulenti e associazioni solo su richiesta ([prezzi](https://www.teamsystem.com/aziende/ts-waste/prezzi/)) |
| Aruba, Prometeo, RifiutiGuru, Centro Software, EcoGest, GECO2 | non pubblico | non pubblico | non pubblico | nessun listino per consulenti |

**Ordine di grandezza dei prezzi pubblici:** 50-69 EUR per azienda l'anno (RENTRI Suite), cioè **circa 5-6 EUR/mese per azienda**, e circa 23 EUR per azienda l'anno nella promo Console da 50 licenze (1.150 / 50). WasteFlow nel piano marketing: 0 EUR fino a 5 clienti, poi 19 EUR per cliente (il brief non indica il periodo; ipotizzo mensile): 10 aziende = 95 EUR/mese, 30 = 475, 100 = 1.805 EUR/mese. Se il periodo fosse mensile, a 100 aziende sarebbero 21.660 EUR/anno contro i 5.000 dell'unico listino per scaglioni pubblico, cioè 4-5 volte. Confronto mio, su un listino di parte e su un'ipotesi.

### 8. Le lamentele e le voci dei clienti

**Premessa onesta:** non ho trovato nessun thread Reddit, forum o gruppo con utenti che si lamentano di RENTRI o dei software, né recensioni su Google Play (la scheda non è raggiungibile). Le uniche fonti sono: 3 recensioni App Store dell'app di NICA, la pagina Trustpilot di Rifiutoo, un commento LinkedIn riportato dalla stampa, e dichiarazioni di associazioni (non utenti). **Nessun tema ha testimonianze dirette di utenti in numero sufficiente: tutti i conteggi sono di fonti, non di clienti.**

| # | Tema | Fonti (conteggio) | Citazioni verbatim | Stato |
|---|---|---|---|---|
| 1 | **Portale RENTRI non regge al debutto (13/02/2026)**: autenticazione, timeout, QR code | 5 fonti redazionali/ufficiali: [InformazioneFiscale](https://www.informazionefiscale.it/rentri-fir-digitale-non-funziona-procedura-emergenza), [TrasportoEuropa 16/02/2026](https://www.trasportoeuropa.it/notizie/autotrasporto/flop-del-rentri-digitale-il-giorno-del-debutto/), [Uomini e Trasporti](https://www.uominietrasporti.it/professione/leggi-e-politica/rentri-lxfir-parte-con-lintoppo-sistema-in-crash-e-tanta-voglia-di-rinvio/), [QuotidianoPiù](https://www.quotidianopiu.it/dettaglio/15066968/rentri-obbligo-del-fir-digitale-dal-15-settembre-2026), [ANCE](https://enna.ance.it/2026/02/13/rentri-interrotti-temporaneamente-i-servizi-sul-registro-elettronico/?print=pdf) | "il portale Rentri ha registrato un 'incidente di servizio'" ; "errori di autenticazione" ; "il rischio di errori formali, duplicazioni o disallineamenti è stato uno degli aspetti più segnalati" (redazione, non utenti) | Non sottile (5), ma nessuna testimonianza di utente. Evento di febbraio, poi risolto |
| 2 | **Peso e costo su micro e piccole imprese, richiesta di rinvio** | 3: [La Nazione 14/02/2025](https://www.lanazione.it/massa-carrara/cronaca/arriva-il-rentri-piccole-imprese-9a495d31) (Confartigianato apuana), [Riciclanews 26/01/2026](https://www.riciclanews.it/normative/rentri-al-via-la-configurazione-dei-dispositivi-mobili-ma-cresce-la-preoccupazione_42285.html) (CNA, Confartigianato, Casartigiani, Alleanza cooperative), [Uomini e Trasporti 13/02/2026](https://www.uominietrasporti.it/professione/leggi-e-politica/rentri-lxfir-parte-con-lintoppo-sistema-in-crash-e-tanta-voglia-di-rinvio/) (commento LinkedIn) | "Dovranno affidarsi a professionisti o software per rispettare gli adempimenti, aumentando i costi fissi." ; "sovrapposizione degli obblighi" ; "tempi coerenti con la realtà organizzativa delle micro e piccole aziende" | 3: al limite, voci di associazioni più un utente |
| 3 | **Interoperabilità fra RENTRI e gestionali non garantita** | 3: Confcooperative ([Riciclanews](https://www.riciclanews.it/normative/rentri-al-via-la-configurazione-dei-dispositivi-mobili-ma-cresce-la-preoccupazione_42285.html)), Assintel ([Riciclanews 30/09/2024](https://www.riciclanews.it/normative/rentri-le-software-house-chiedono-modifiche-urgenti-al-dm-59_32480.html)), AssoSoftware (articolo del dg, via sintesi; [comunicato 31/10/2025](https://www.assosoftware.it/comunicati-stampa/registro-cronologico-rifiuti-311025/) è neutro) | "non sarebbe ancora pienamente garantita l'interoperabilità" (Confcooperative, gen 2026). **Controprova:** per Assintel "il sistema funziona e dialoga con i gestionali", il problema è interpretativo (2024) | 3, ma di parte (associazioni di imprese e di software house) e in parte datati |
| 4 | **Onboarding e accesso all'app** | 3 recensioni App Store dell'app RENTRI di NICA ([scheda](https://apps.apple.com/it/app/rentri/id1636284933)), rating 3.0 su 4 voti | "Non si apre su iPhone 13 aggiornato a IOS 26.1" (03/12/2025); "una volta impostate le credenziali non si riesce ad accedere" (01/02/2025); "Non c'è alcuna spiegazione e di come registrarsi e di come poi vi si possa accedere" (06/02/2025) | 3 recensioni su UN solo prodotto (app collegata a WinWaste): al limite, trattarla come sottile |
| 5 | Autisti: dispositivo personale e app non configurata | 2: lettera dei sindacati FNILT/CSE e UGL (via [Uomini e Trasporti](https://www.uominietrasporti.it/professione/leggi-e-politica/rentri-lxfir-parte-con-lintoppo-sistema-in-crash-e-tanta-voglia-di-rinvio/)); analisi [Truck24](https://www.truck24.it/rentri-dal-15-settembre-scattano-le-sanzioni-produttori-trasportatori-e-impianti-devono-coordinarsi-prima-del-ritiro) | "emergono prassi organizzative che prevederebbero l'utilizzo di dispositivi elettronici personali dei lavoratori" | **Sottile** (2) |
| 6 | Registro C/S duplicato del FIR per i trasportatori | 1: Fai Conftrasporto ([TrasportoEuropa 12/11/2025](https://www.trasportoeuropa.it/notizie/autotrasporto/lautotrasporto-discute-sul-registro-rifiuti-del-rentri)) | "Si tratta di una inutile duplicazione ai fini della tracciabilità" | **Sottile** (1) |

**Positivo, da non perdere:** i 5 estratti letti di Trustpilot su Rifiutoo lodano assistenza rapida e semplicità, per esempio "Programma snello e di facile interpretazione, risolve tutte problematiche del RENTRI" (Natalia Scionico, 22/05/2026). Contano come segnale che il campo si vince su **assistenza e semplicità**, non solo sulle funzioni. Nessuna critica ai prodotti concorrenti è stata trovata da fonti indipendenti: per i software la risposta onesta è "recensioni inesistenti o non raggiungibili".

### 9. Gruppi madre-figlie: c'è chi lo dichiara?

**Risposta: sì, in parte e in modo vago. Il gap non è vuoto, ma non è nemmeno coperto in modo documentato.** Nessuno descrive pubblicamente consolidamento fra partite IVA, MUD per più società o controllo della capogruppo con regole chiare. Quattro prodotti usano un lessico vicino:

1. **Rifiutoo Custom Pro**: "multi ragione sociale, multi utente, multi dispositivo, multi unità locale" e un "Pannello Multi-azienda" ([prezzi produttore](https://www.rifiutoo.com/prezzi/produttore-iniziale/)). Il più vicino a un'offerta per gruppi: ma non dice "gruppo", né consolidamento, né se la capogruppo vede le figlie.
2. **QuiRifiutiPro Console**: destinata a "consulenti ambientali, associazioni e gruppi di aziende", con dashboard multi-aziendale ([pagina](https://www.softwarecogest.it/)); il testo non spiega i gruppi.
3. **Centro Software Cloud RENTRi**: chi ha Corporate o Unlimited "può aggiungere altre aziende" e c'è una dashboard multi-sito ([pagina](https://www.centrosoftware.com/gestione-rifiuti-rentri/)).
4. **EcoGest (Passweb)**: "Profili dedicati a unità operative, capogruppo e consulenti" ([pagina](https://www.softwarecogest.it/)); poteri della capogruppo non spiegati.

Più due ambigui: TeamSystem Waste 360 ("gestione centralizzata delle informazioni") e Aruba (UL illimitate, non società). Wolters Kluwer Atlantide non verificabile (403).

**Vincolo normativo che rende il tema meno semplice di come sembra:** ogni società è un operatore autonomo, con iscrizione per unità locale e accesso con SPID/CIE del rappresentante legale; secondo una fonte CNA la delega dell'art. 18 DM 59/2023 riguarda **solo la trasmissione dei dati al RENTRI**, e le credenziali personali non vanno condivise ([CNA](https://www.cna.it/wp-content/uploads/2024/05/1.pdf), [Procedura Iscrizione](https://vg.camcom.it/sites/default/files/2025-11/Procedura_Iscrizione_RENTRI%20nov.%202025.pdf), via sintesi di ricerca; da verificare sul testo del decreto). Un "controllo centrale di gruppo" deve quindi passare dall'incarico/delega per società: vale come funzione software, non come scorciatoia legale. Non ho trovato nei manuali ufficiali un trattamento esplicito dei gruppi.

**Conclusione:** il gap è "madre-figlie fatto bene e dichiarato con dettagli", non "madre-figlie assente". Da validare con 3 gruppi reali e, soprattutto, con una demo "da cliente misterioso" a Rifiutoo Custom Pro e Centro Software. Fino ad allora: ipotesi, non fatto.

### 10. Il gap e la minaccia

1. **Consulenti multi-azienda:** non è scoperto (Rifiutoo, GoRENTRI Partner, TeamSystem, Prometeo, QuiRifiutiPro Console, RENTRI Suite, SistemaRentri Console). **Ha anche un prezzo pubblico a scaglioni a 50-69 EUR/azienda/anno** (RENTRI Suite), il che smonta anche "nessuno pubblica il listino".
2. **Gruppi madre-figlie:** gap candidato, ma oggi coperto a parole da almeno quattro prodotti; il margine sta nella profondità (consolidamento, ruoli capogruppo, MUD per società). Non provato.
3. **Prezzo:** 588 EUR/anno (49 EUR/mese) contro mediana pubblica 125 e massimo 430 per una azienda. Serve una funzione per cui un cliente paghi 3-5 volte di più.
4. **Posizionamento:** il campo premia assistenza e semplicità (Trustpilot Rifiutoo), non il numero di funzioni.
5. Urgenza normativa: finita il 16/09/2026.

**Chi può copiare più in fretta:** **Zucchetti** con Rifiutoo (già "multi ragione sociale" e Pannello Multi-azienda, 6.000 clienti dichiarati, Zucchetti Store e rete di rivenditori; e WinWaste per gli impianti), poi **Namirial** (Partner pensato per portafogli, canale commercialisti), **TeamSystem** (store con listino, Waste 360 per strutture complesse) e **Dylog-Buffetti** (QuiRifiutiPro Console, RifiutiGuru, reseller). Il portale pubblico resta il limite superiore del prezzo per le piccole.

### 11. Obiezioni per il panel (buyer simulati sull'idea madre-figlie)

Ricavate dalle fonti sopra. Ogni obiezione è formulata come la direbbe un buyer.

1. **"Il portale RENTRI è gratuito e un consulente esterno può già operare come incaricato: perché dovrei pagare?"** Fonti: [rentri.gov.it](https://www.rentri.gov.it/), [slide Camera di Commercio di Bologna](https://www.bo.camcom.it/sites/default/files/ambiente/20241022%20slide%20registr_fir_servizi_supporto.pdf).
2. **"Ho un'offerta a 69-95 euro l'anno per azienda; voi 588 per la sola prima azienda. Cosa mi date in più?"** Fonti: [RENTRI Suite](https://www.qualityandsafety.org/guide/software-rentri-consulenti-ambientali), [Namirial](https://www.namirial.it/rentri), [Aruba](https://www.aranzulla.it/come-funziona-aruba-rentri-smart-1875510.html).
3. **"Il mio ERP (Mexal, TeamSystem, Zucchetti) ha già il modulo rifiuti. Non voglio un secondo sistema e il doppio inserimento."** Fonti: [EcoGest](https://www.softwarecogest.it/), [TeamSystem Waste 360](https://www.teamsystem.com/aziende/waste-360/), [Centro Software](https://www.centrosoftware.com/gestione-rifiuti-rentri/); sul doppio inserimento: [Rifiutoo](https://www.rifiutoo.com/rentri/rentri-non-funziona/) (di parte).
4. **"Il portale è andato in crash il 13 febbraio e le associazioni dicono che l'interoperabilità non è garantita. Se il vostro software dipende da RENTRI e si blocca, chi risponde delle sanzioni?"** Fonti: [InformazioneFiscale](https://www.informazionefiscale.it/rentri-fir-digitale-non-funziona-procedura-emergenza), [Riciclanews](https://www.riciclanews.it/normative/rentri-al-via-la-configurazione-dei-dispositivi-mobili-ma-cresce-la-preoccupazione_42285.html).
5. **"Sul gruppo madre-figlie Rifiutoo, Centro Software, QuiRifiutiPro ed EcoGest dicono già di farlo. Perché voi?"** Fonti: [Rifiutoo Custom Pro](https://www.rifiutoo.com/prezzi/produttore-iniziale/), [Centro Software](https://www.centrosoftware.com/gestione-rifiuti-rentri/), [Console](https://www.softwarecogest.it/).
6. **"Ogni società ha il suo rappresentante legale, il suo SPID e la sua iscrizione; la delega copre solo la trasmissione. Il controllo centrale della capogruppo è legalmente reale o solo una vista?"** Fonti: [CNA](https://www.cna.it/wp-content/uploads/2024/05/1.pdf), [procedura di iscrizione](https://vg.camcom.it/sites/default/files/2025-11/Procedura_Iscrizione_RENTRI%20nov.%202025.pdf) (da verificare sul decreto).
7. **"Siete nuovi, senza clienti né referenze, senza conservazione a norma AgID né app mobile. Gli altri dichiarano migliaia di aziende e archiviazione inclusa."** Fonti: [Rifiutoo +6.000](https://www.rifiutoo.com/), [Prometeo +3.000](https://prometeorifiuti.com/), [Centro Software](https://www.centrosoftware.com/gestione-rifiuti-rentri/); app autisti: [Truck24](https://www.truck24.it/rentri-dal-15-settembre-scattano-le-sanzioni-produttori-trasportatori-e-impianti-devono-coordinarsi-prima-del-ritiro).
8. **"Sono una piccola impresa: la costa fissa mi pesa e la scadenza è passata. Mi arrangio col portale o col consulente."** Fonti: [La Nazione](https://www.lanazione.it/massa-carrara/cronaca/arriva-il-rentri-piccole-imprese-9a495d31) ("aumentando i costi fissi"), [Namirial sul perimetro](https://focus.namirial.com/it/rentri-2026/).

### Prossimi passi

- `/founder-consumer`: usare le obiezioni 1-8; per la 5 e la 6 servono prima una demo "cliente misterioso" a Rifiutoo Custom Pro e Centro Software, e una lettura del testo del DM 59/2023 e del manuale deleghe.
- `/founder-pricing`: partire da mediana 125 e massimo 430 EUR/anno per azienda; per consulenti dal listino a scaglioni 50-69 EUR (di parte) e dalla Console 1.150 EUR per 50 licenze.
- Verifica manuale: testo di legge sulle sanzioni, tabella DM 59/2023 allegato III, listini Rifiutoo consulenti/Custom Pro, Namirial Partner, risposta Aruba sul consulente, pagina prezzi di SistemaRentri e RifiutiGuru, DH Waste di WinWaste.

## The buyer panel

**0 buy · 20 pass** (0% buy) out of 20 simulated buyers. Seed 899717, so the same cards can be dealt again.

These are simulated buyers, not customers. Use this to find objections and weak spots, then confirm the big ones with real people before you spend.

### By segment

| group | buyers | buy rate |
| --- | ---: | ---: |
| Gruppo con 2-5 società, un responsabile ambiente part-time (budget annuo per software ambientali in euro) | 8 | 0% |
| Gruppo con 6-20 società o unità locali e ufficio HSE (budget annuo per software ambientali in euro) | 5 | 0%  (thin) |
| Consulente ambientale che segue uno o più gruppi societari (budget annuo per strumenti in euro) | 5 | 0%  (thin) |
| Gruppo di servizi/multiutility locale con impianti e mezzi propri (budget annuo per software ambientali in euro) | 2 | 0%  (thin) |

### By buying behaviour

| group | buyers | buy rate |
| --- | ---: | ---: |
| Vuole tutto nell'ERP | 3 | 0%  (thin) |
| Delega al consulente | 4 | 0%  (thin) |
| Usa già un gestionale rifiuti | 5 | 0%  (thin) |
| Teme le sanzioni | 2 | 0%  (thin) |
| Si appoggia al portale gratuito | 4 | 0%  (thin) |
| Compra sul prezzo | 2 | 0%  (thin) |

### By income

| group | buyers | buy rate |
| --- | ---: | ---: |
| $2,000 to $5,000 | 8 | 0% |
| $5,000 and up | 7 | 0%  (thin) |
| under $2,000 | 5 | 0%  (thin) |

### Why they pass

| reason | buyers | in their words |
| --- | ---: | --- |
| trust | 7 | "Il problema c'e' davvero: il riepilogo dei rifiuti di tutte le società per il bilancio di sostenibilità me lo chiede il direttore ogni anno. Ma non compro un software che mi fa reinserire i dati che ho già nel gestionale: il doppio inserimento è proprio quello che voglio eliminare, e qui mi dite solo che importate i dati dai fogli o dal software che uso oggi." (P001) · "Il problema lo sento: raccolgo i registri di più sedi via email ogni mese e le sanzioni le pago io se qualcosa non torna. Ma sulla pagina non vedo nulla che mi faccia fidare di un software nuovo per i FIR e per RENTRI: nessun cliente di riferimento, nessuna certificazione, nessuna prova che l'import dai miei fogli funzioni. Con 1.200 € l'anno sono circa il 30% del mio budget per strumenti ambientali, e non lo spendo sul 'perché voi' senza una dimostrazione." (P005) |
| habit | 7 | "Il primo pensiero resta che la scadenza e' passata e che ce la caviamo come facciamo adesso. Un software che importa i dati dai miei fogli e mi porta dentro RENTRI mi sembra una migrazione da seguire, non un acquisto da fare in una settimana normale; con il consulente che gia' tiene i registri, cambiare strumento significa rifare il lavoro." (P002) · "Uso gia' un gestionale rifiuti e lo cambio solo se quello vecchio crea problemi seri. Un primo mese gratuito non mi basta: devo importare i dati di tutte le societa' del gruppo e rifare registri e scadenze, e questo lavoro lo pago in tempo, non in euro." (P004) |
| price | 4 | "1.200 euro l'anno sono sopra il mio budget di circa 1.000 euro per il software ambientale, e il primo mese gratuito non cambia il costo annuo. Il consulente mi segue già per i FIR: non vedo perché pagare un software in più per una vista consolidata che devo ancora verificare." (P003) · "Col budget che ho per i software ambientali, 1.200 € l'anno più IVA sono già sopra la cifra che il direttore mi ha dato, e per un riepilogo rifiuti di 5 società cerco il meno caro che fa il minimo indispensabile. Il primo mese gratuito non mi convince: devo comunque imparare un software nuovo e importare i dati prima di sapere se serve." (P010) |
| need | 2 | "Il mio ERP ha già il modulo rifiuti, e io non voglio un secondo sistema da far alimentare a mano dalle sedi ogni mese. Il primo mese gratis mi incuriosisce, ma non vedo perché spostare registri e FIR su un altro programma se quello che ho già copre il lavoro." (P009) · "Il portale RENTRI è gratuito e registri e FIR li faccio già io, con fatica ma senza spendere. La vista di gruppo e il consolidato per il bilancio mi interessano, ma non sento ancora un problema abbastanza grosso da pagare 1.200 € l'anno per risolverlo." (P011) |

### Why they buy

| reason | buyers | in their words |
| --- | ---: | --- |

### What would flip a no

- Se il modulo si collegasse direttamente al TeamSystem, Zucchetti o Mexal che usiamo già, senza reinserire nulla, e se la capogruppo avesse permessi che limitano davvero chi può fare cosa in ciascuna società.
- Una prova gratuita con il mio consulente che importa i dati del mio gruppo e mi mostra che il FIR respinto non si ripete, senza che io debba occuparmi della migrazione.
- Una prova concreta, con i nostri dati importati, che mostri la capogruppo che individua un FIR errato prima della trasmissione, e un prezzo che stia sotto i 1.000 euro l'anno per il gruppo.
- Se il mio gestionale attuale sbaglia FIR o scadenze in modo concreto e WasteFlow, con i miei dati importati, mi dimostra di risolvere quel problema senza rifare tutto il lavoro.
- Un mese gratuito in cui importo davvero i registri di due o tre delle mie sedi e vedo il consolidato tornare con i numeri che ho già, più un riferimento verificabile di un gruppo o di uno studio che lo usa da almeno un anno.
- Un guasto serio del gestionale attuale nelle trasmissioni RENTRI, o una scadenza mancata per colpa sua, con una prova concreta che WasteFlow la evita e che l'import dei dati è assistito.
- Vedere il primo mese gratuito girare sui dati reali di due o tre sedi e risparmiare ore di raccolta email e controllo registri, senza dover rifare nulla a mano.
- Una dimostrazione con i miei dati reali (importazione da Rifiutoo o dai fogli di un gruppo vero) in cui la capogruppo blocca o segnala un FIR incoerente prima della trasmissione, con permessi per sede e firma per società che funzionino davvero.
- Che mi dimostrino, con i dati del mio ERP, che il loro software copre registri e FIR di tutte le società del gruppo meglio del modulo che ho già, e che il costo per 6-20 società resta sotto il mio budget di 4.000 €.
- Un prezzo sotto i 1.000 € l'anno per il gruppo con la stessa importazione dei dati e il riepilogo esportabile per il bilancio di sostenibilità.
- Se il consulente mi dice che il portale non regge più il gruppo (più società, più sedi) e che il riepilogo consolidato mi serve per il bilancio di sostenibilità con i dati già pronti, ne parlo col direttore.
- Se mi mostrano che importano i miei fogli attuali senza rifare tutto a mano e che il riepilogo consolidato per il bilancio di sostenibilità mi evita un lavoro che oggi faccio male o non faccio.

20 buyers gave all four price answers. Run founder-pricing's van_westendorp.py on the answers folder.

## Not done yet

- Pricing: run /founder-pricing
- The offer: run /founder-offer
- The numbers: run /founder-cfo
- Marketing: run /founder-marketing
- Brand: run /founder-brand
- Operations: run /founder-ops
- Launch plan: run /founder-launch

_The panel is simulated buyers and the numbers are projections from your inputs. Confirm demand with real customers and costs with real quotes before you spend. Not financial, legal or tax advice._
