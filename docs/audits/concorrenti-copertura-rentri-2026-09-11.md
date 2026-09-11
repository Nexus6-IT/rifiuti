# Copertura RENTRI nei gestionali rifiuti concorrenti — audit 2026-09-11

Ricerca pubblica (manuali PDF, pagine prodotto, changelog, FAQ ufficiali RENTRI). Nessun accesso a demo/prova dei prodotti citati: tutto quanto segue si basa solo su documentazione scaricabile senza autenticazione. Dove un manuale non è stato leggibile come testo (PDF con font non estraibili) o una pagina ha risposto 403, è segnalato esplicitamente.

Per l'area 3 (Vidimazione e blocchi virtuali) esiste già un audit dedicato: `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md`. Qui non è ripetuto — solo segnalati eventuali fornitori non coperti là.

## Legenda

- **COPERTO**: documentazione pubblica descrive concretamente la funzionalità con dettagli operativi (schermate, campi, flusso).
- **PARZIALE**: la funzionalità è menzionata/dichiarata ma senza dettaglio operativo verificabile, o copre solo una parte dell'area.
- **NON TROVATO**: nessuna fonte pubblica trovata che ne parli. Non significa "assente" — significa che non abbiamo trovato prova né a favore né contro.

## Tabella fornitore × area

| Fornitore                     | 1. Registro cronologico | 2. FIR ciclo di vita | 3. Blocchi virtuali (vedi audit dedicato) | 4. xFIR (ASiC-E/XAdES) | 5. Trasmissione FIR pericolosi | 6. Copia cartacea/digitale (4ª copia) | 7. MUD      | 8. Firma    |
| ----------------------------- | ----------------------- | -------------------- | ----------------------------------------- | ---------------------- | ------------------------------ | ------------------------------------- | ----------- | ----------- |
| Ecotraccia                    | COPERTO                 | COPERTO              | COPERTO (vedi audit dedicato)             | COPERTO                | COPERTO                        | COPERTO                               | COPERTO     | COPERTO     |
| Estarweb (ECO-Management)     | COPERTO                 | COPERTO              | COPERTO (vedi audit dedicato)             | COPERTO                | COPERTO                        | COPERTO                               | NON TROVATO | COPERTO     |
| WinWaste (Zucchetti/Nica)     | COPERTO                 | PARZIALE             | COPERTO (vedi audit dedicato)             | NON TROVATO            | PARZIALE                       | NON TROVATO                           | NON TROVATO | COPERTO     |
| EcoDeskWeb/Ecocerved          | PARZIALE                | NON TROVATO          | COPERTO (vedi audit dedicato)             | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | COPERTO     | NON TROVATO |
| TeamSystem Waste              | PARZIALE                | PARZIALE             | NON TROVATO                               | PARZIALE               | PARZIALE                       | PARZIALE                              | PARZIALE    | PARZIALE    |
| Zucchetti DH Waste / Rifiutoo | PARZIALE                | PARZIALE             | NON TROVATO                               | PARZIALE               | PARZIALE                       | NON TROVATO                           | PARZIALE    | NON TROVATO |
| Sispi                         | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Aliante                       | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Ecobox                        | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Rentri.cloud                  | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Dedagroup                     | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Sadel                         | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |
| Gedit                         | NON TROVATO             | NON TROVATO          | NON TROVATO                               | NON TROVATO            | NON TROVATO                    | NON TROVATO                           | NON TROVATO | NON TROVATO |

Fornitori nuovi individuati durante la ricerca non nell'elenco originale: **SistemaRentri** e **Centro Software (Cloud RENTRi)** — comparsi solo in pagine di marketing generiche, senza manuali operativi pubblici raggiungibili nel tempo di questa ricerca: entrambi restano di fatto NON TROVATO per tutte le 8 aree (non tabellati sopra per non appesantire la tabella con righe tutte NON TROVATO).

## Dettaglio per fornitore

### Ecotraccia (Eco Traccia) ed Estarweb (ECO-Management) — stesso motore white-label

Fonti (identiche testualmente tra i due prodotti, cambia solo il nome del brand nel testo):

- `servizi.ecotraccia.it/images/rentri/manuale_rentri_ecotraccia.pdf` (Manuale RENTRI, rev. 0, area demo pubblica)
- `servizi.ecotraccia.it/images/rentri/manuale_xfir_ecotraccia.pdf` (Manuale xFIR, rev. 0, 23/01/2026)
- `servizi.ecotraccia.it/images/manuali/Istruzioni_mud2025_ecotraccia.pdf` (Istruzioni operative MUD 2025)
- `portale.estarweb.it/estar_graph/images/rentri/manuale_xfir_estarweb.pdf` (Manuale xFIR Estarweb, testualmente identico a quello Ecotraccia salvo branding)

Nota: il manuale xFIR di Estarweb esiste identico a quello Ecotraccia; **non è stato trovato un manuale MUD specifico per Estarweb** (solo per Ecotraccia) — per questo la casella MUD di Estarweb è NON TROVATO pur essendo verosimilmente lo stesso motore.

**1. Registro cronologico** — COPERTO. Il Manuale RENTRI (§4) descrive: creazione/associazione registro RENTRI (credenziali applicative, soggetto operativo, sede operativa), generazione registro (§8.1), trasmissione dati al RENTRI con esiti a tre stati — "Errore" (dati non inviati, da correggere e reinviare), "Conclusa" (inviati ma non ancora validati), "Conclusa e Comunicata" (validati dal RENTRI) — e lista transazioni con codice univoco (§5.1–5.3). Copre anche **rettifica** (§8.2.13: possibile solo su registro "Definitivo", la rettifica aggiunge una riga in coda, colore arancione, riassociazione carichi/scarichi se necessaria) e **annullamento** di una registrazione (§8.2.14: motivazione obbligatoria, riga in coda colore rosso, irreversibile dopo un certo punto).

**2. FIR ciclo di vita** — COPERTO. Il manuale xFIR elenca esplicitamente tutti gli stati del ciclo vita come nomi di stato macchina: `InserimentoTrasportoIniziale`, `FirmaTrasportatoreSuccessivo` (trasporto successivo/più tratte), `InserimentoAccettazione`/`FirmaAccettazione`/`RespintoAccettatoParzialmente` (accettazione e respingimento parziale), `FirmaSostaTecnica` (sosta tecnica), `FirmaTrasbordoParziale`/`FirmaTrasbordoTotale` (trasbordo), `FirmaDestinatarioSuccessivo` (secondo destinatario). Annullamento gestito con pulsante "Annulla" (bloccato se già firmato da produttore e trasportatore) — irreversibile.

**4. xFIR (ASiC-E/XAdES)** — COPERTO. Manuale xFIR §2.9: "la richiesta di aggiunta dei dati per completare la creazione del file di firma digitale XAdES nel file xFIR"; §2.6 (allegati): "Il file aggiunto all'xFIR viene inserito all'interno del contenitore ZIP" con limiti dimensione (1 MB per allegato, 3 MB per xFIR risultante, solo PDF). Non usa esplicitamente il termine "ASiC-E" nel testo ma descrive lo stesso contenitore compresso con firma XAdES incorporata.

**5. Trasmissione FIR pericolosi** — COPERTO. Manuale xFIR §2.11: tempistiche esplicite — "2 giorni per impianto/destinatario, 10 giorni per trasportatore, 10 giorni per produttore" — con invio automatizzato agganciato alla stampa definitiva del registro digitale e controllo serale automatico; §2.13 copre anche l'invio dati per conto del produttore da parte del trasportatore (subappalto dell'adempimento).

**6. Copia cartacea/digitale (4ª copia)** — COPERTO. Manuale RENTRI §6.2–6.3: restituzione via consegna diretta, PEC o servizi RENTRI (upload area riservata "Operatori", scaricabile via QR code sulla copia cartacea). Manuale xFIR §2.10: automazione — il destinatario ha 48 ore per l'invio, e il produttore/trasportatore può forzare il recupero manuale se l'automatismo fallisce per indisponibilità API RENTRI; sottolinea che la 4ª copia serve sia per la trasmissione dati pericolosi sia per la conservazione digitale obbligatoria.

**7. MUD** — COPERTO (solo Ecotraccia verificato). Il manuale MUD 2025 copre: Scheda Autorizzazioni (AUT), Scheda Riciclaggio (RIC), Scheda RIFIUTO, Comunicazione Imballaggi, Schede Materiali Secondari (MAT, con nuovo campo "Ammendante" per il 2025), calcolo giacenze, controlli di coerenza su schede RIF/RT/DR/TE per produttore/impianto/trasportatore, e "Unione di due MUD". Copertura delle schede molto ampia — non solo Comunicazione Rifiuti base ma anche RAEE/VFU (§7.7 nella scheda AUT).

**8. Firma** — COPERTO. Manuale xFIR §1: emissione di un **certificato di firma remota RENTRI** dall'Area Operatori del portale RENTRI, download del file `.cer`, caricamento in Ecotraccia/Estarweb; §2.9: associazione della credenziale app RENTRI all'utente del gestionale (una firma per utente); firma con **OTP** ricevuto via notifica sull'app RENTRI, tempo di validazione 60 secondi. Nessuna menzione di firma qualificata su dispositivo locale (smart card/token) come alternativa nel gestionale — solo la firma remota RENTRI via app.

### WinWaste (Zucchetti / Nica Srl Informatica Aziendale)

Fonti: `winwaste.net/wp-content/uploads/2024/09/manuale_interoperabilita_rentri.pdf` (manuale interoperabilità, testo terminale/gestionale desktop stile AS400/character-based), `winwaste.net/vivifir-cose-e-come-funziona/`.

**1. Registro cronologico** — COPERTO. Manuale interoperabilità: configurazione causali di gestione rifiuti abbinate ai registri RENTRI (§5, con opzione "DA SPECIFICARE IN REGISTRAZIONE MOVIMENTO" o "NESSUN REGISTRO"), **consolidamento movimenti** per periodo (§6 — "sigillare" i movimenti, dopo cui non è più possibile aggiungere movimenti con data antecedente), invio movimenti consolidati al RENTRI (§7). Nota operativa esplicita: ogni modifica a un movimento già consolidato genera un nuovo movimento nella data della modifica, da consolidare e inviare di nuovo — quindi niente modifica retroattiva silenziosa.

**8. Firma** — COPERTO. Manuale §3: "Configura Firma RENTRI", con scelta esplicita del tipo di firma — il manuale consiglia per i test la **"firma REMOTA R.E.N.T.Ri., con Client ID e Client Secret rilevati dal portale R.E.N.T.Ri."**. Questo conferma con fonte primaria (testo del manuale, non un riassunto di motore di ricerca) quanto solo indiziato nell'audit sui blocchi virtuali: WinWaste usa credenziali applicative Client ID/Secret per configurare la firma RENTRI.

**2. FIR ciclo di vita / 5. Trasmissione FIR pericolosi** — PARZIALE. La pagina prodotto dichiara interoperabilità completa ma il manuale di interoperabilità letto qui copre solo registro/movimenti, non il dettaglio degli stati del formulario (accettazione, respingimento, sosta tecnica, trasbordo) né il flusso di trasmissione dei pericolosi.

**4. xFIR, 6. copia cartacea/digitale, 7. MUD** — NON TROVATO. Nessuna fonte pubblica raggiunta con dettaglio operativo su questi tre punti per WinWaste.

### EcoDeskWeb / Ecocerved (motore usato da CCIAA/consorzi/molti rivenditori)

Fonte: `ecodeskweb.ecocerved.it/HELP/vivifir-come-si-opera-in-ecodesk.htm`, `ecodeskweb.ecocerved.it/HELP/mud.htm`.

**1. Registro cronologico** — PARZIALE. La pagina Vi.Vi.Fir. parla di "blocco virtuale" e credenziali applicative (ClientId/ClientSecret con validità di 1 anno, da rinnovare prima della scadenza) ma non descrive il flusso di trasmissione/validazione/rettifica/annullamento del registro cronologico stesso — quella parte non è stata trovata in questa pagina specifica (probabile esistenza altrove nell'help, non raggiunta).

**7. MUD** — COPERTO. La pagina MUD 2025 è dettagliata: distingue obblighi per produttori/impianti/trasportatori, gestione RAEE/imballaggi/veicoli fuori uso tramite "proprietà" del registro, **Comunicazione Rifiuti Urbani** per i trasportatori (con export in un file Excel dedicato dato che EcoDeskWeb non la compila direttamente — la presentazione avviene su `mudcomuni.it`, sito esterno), Scheda SA-RIC per bilancio recupero/riciclaggio rifiuti urbani e da imballaggio (novità MUD 2025). Segnala esplicitamente la necessità di un dispositivo di firma digitale per l'invio finale su `mudtelematico.it` (esterno a EcoDesk).

**2. FIR ciclo di vita, 4. xFIR, 5. trasmissione pericolosi, 6. copia cartacea/digitale, 8. firma** — NON TROVATO nella pagina raggiunta (che è specificamente sulla vidimazione Vi.Vi.Fir., non sull'xFIR/ciclo vita formulario). La pagina non menziona nemmeno il termine RENTRI esplicitamente, solo "Vi.Vi.Fir." — segnale che potrebbe essere contenuto non aggiornato al post-13/02/2025, oppure che l'xFIR è documentato in una pagina separata non trovata in questa ricerca.

### TeamSystem Waste

Fonte: `teamsystem.com/store/assets/pdf/TEAMSYSTEM_GUIDA_INFORMATIVA_RENTRI.pdf` (guida di 21 pagine, letta integralmente).

Il documento è per la quasi totalità (§1–8 circa) una **ricognizione normativa generalista su RENTRI** (chi è obbligato, tempistiche, sanzioni, modalità di firma previste dalla norma — CNS, CIE, firma remota RENTRI — descritte come opzioni del sistema RENTRI in generale, non come scelta implementata nel prodotto), seguita da una sezione di marketing con elenco funzionalità ad alto livello, senza screenshot né istruzioni operative:

- "integrazione con ViViFIR per la vidimazione dei Formulari con possibilità di inserire logo" — **PARZIALE** sulla vidimazione (rimanda comunque all'audit blocchi dedicato, dove TeamSystem non risultava già coperto).
- "controllo e scadenzario della riconsegna quarta copia (controlli integrati con RENTRI)" — **PARZIALE** sull'area 6: conferma che il controllo esiste, non descrive come funziona operativamente.
- "gestione registri di carico e scarico (integrati con RENTRI) e MUD in conformità con la normativa vigente" — **PARZIALE** su registro cronologico e MUD: dichiarazione di conformità, nessun dettaglio di schermata o di scheda MUD coperta.
- "lettura di etichette QR Code ViViFIR" via app autista — dato aggiuntivo non richiesto dalle 8 aree ma rilevante: suggerisce un flusso mobile per gli autisti.

**Conclusione TeamSystem**: nessuna delle 8 aree risulta COPERTO da fonte pubblica con dettaglio operativo verificabile — tutto ciò che si trova è dichiarazione di conformità generica in un documento a scopo prevalentemente normativo/commerciale, non un manuale operativo. Una ricerca più mirata su eventuali manuali utente separati (non trovati in questa sessione) potrebbe cambiare il quadro.

### Zucchetti — DH Waste / Rifiutoo (galassia prodotti)

Fonti: `zucchetti.it/.../dhwaste-normativa-rentri.html` (pagina bloccata da un WAF con 403 al momento del fetch — contenuto letto solo tramite riassunto del motore di ricerca, quindi da trattare con cautela), `rifiutoo.com` (pagine prodotto).

**1. Registro cronologico** — PARZIALE. Dichiarazione (via riassunto, non fonte primaria diretta): "gestisce Registro Carico/Scarico, MUD, RENTRI in un clic"; "DH Waste... gestisce Xades signature, rendendo transazioni e registri immutabili e pronti per la conservazione digitale" — afferma la firma XAdES lato registro ma senza dettaglio operativo.

**2. FIR ciclo di vita / 4. xFIR** — PARZIALE. Rifiutoo dichiara "interoperabile con RENTRI: dati dei formulari inviati e ricevuti in automatico" e ha una pagina dedicata "XFIR Formulario digitale e Nuovo Modello di Formulario Rifiuti" (`rifiutoo.com/rentri/formulario-rifiuti-digitale/`) non ancora letta in dettaglio in questa ricerca — segnalo come opportunità di approfondimento, non chiuso qui per limiti di tempo.

**5. Trasmissione FIR pericolosi** — PARZIALE. Un dato specifico emerso (da riassunto): "tutti gli operatori hanno 90 giorni dalla restituzione per scaricare la copia completa tramite interoperabilità o tramite i servizi RENTRI, anche senza registrazione" — questo è però un fatto normativo generale (i 90 giorni sono un termine RENTRI, non una funzionalità di prodotto), va quindi attribuito con cautela.

**3. Blocchi virtuali** — nel documento dedicato ai blocchi, la voce "Zucchetti — DH Waste/Rifiutoo/WinWaste" risultava già PARZIALE (solo conferma generica dell'esistenza della funzionalità, nessun dettaglio di interfaccia). Confermato qui, nessuna new information.

**6. copia cartacea/digitale, 7. MUD, 8. firma** — NON TROVATO/PARZIALE ambiguo: MUD è solo citato nell'elenco "Registro Carico/Scarico, MUD, RENTRI in un clic" senza alcun dettaglio sulle schede coperte → trattato come PARZIALE. Copia cartacea/digitale e firma (oltre alla menzione XAdES generica sopra) non hanno fonti con dettaglio operativo → NON TROVATO.

### Sispi, Aliante, Ecobox, Rentri.cloud, Dedagroup, Sadel, Gedit

Nessuna documentazione pubblica specifica trovata per nessuna delle 8 aree, per nessuno di questi sette fornitori, nel tempo dedicato a questa ricerca. Non è chiaro se non pubblicano documentazione accessibile senza autenticazione, se sono prodotti di nicchia con presenza web minima, o se i nomi commerciali sono leggermente diversi da quelli cercati (es. "Rentri.cloud" non è stato identificato come prodotto con questo nome esatto — solo come termine di ricerca generico che restituisce vari cloud RENTRI di fornitori diversi). Segnalo inoltre due fornitori emersi durante la ricerca e non nell'elenco originale — **SistemaRentri** (`sistemarentri.it`) e **Centro Software / Cloud RENTRi** (`centrosoftware.com`) — con lo stesso esito: solo pagine di marketing raggiunte, nessun manuale operativo pubblico trovato.

## Dove il mercato è fermo

Confrontando le caselle NON TROVATO/PARZIALE sistematiche su tutti i fornitori tranne Ecotraccia/Estarweb (che condividono lo stesso motore):

1. **Documentazione pubblica del ciclo di vita completo del FIR digitale** (accettazione parziale, respingimento con causali NC/IR/Altro, sosta tecnica, trasbordo, secondo destinatario) — solo Ecotraccia/Estarweb la rendono pubblica con questo livello di dettaglio. Tutti gli altri fornitori esaminati (WinWaste, TeamSystem, Zucchetti/Rifiutoo, EcoDeskWeb) restano a dichiarazioni generiche di "interoperabilità" senza mostrare gli stati intermedi. Se questo riflette effettivamente prodotti meno completi (non solo documentazione più scarsa) è un'area dove possiamo differenziarci mostrando in modo esplicito e navigabile tutti gli stati del ciclo FIR — cosa che il nostro dominio (`rifiuti-fir-lifecycle` in memoria di progetto) già tratta internamente.
2. **MUD — copertura delle schede minori** (RAEE, VFU, imballaggi, materiali secondari, riciclaggio SA-RIC). Solo Ecotraccia ed EcoDeskWeb documentano pubblicamente una copertura estesa oltre la Comunicazione Rifiuti base; gli altri fornitori esaminati non pubblicano dettaglio sufficiente per giudicare. Un gestionale che copre bene RAEE/VFU/imballaggi/Comunicazione Rifiuti Urbani (quest'ultima delegata a un sito esterno anche da EcoDeskWeb) è un'area dove il minimo comune trovato è basso.
3. **Trasmissione dei dati FIR pericolosi come funzionalità visibile e verificabile** (non solo dichiarata): solo Ecotraccia/Estarweb documentano tempistiche precise (2/10/10 giorni) e un meccanismo di verifica/controllo automatico con esito visibile all'utente. Gli altri fornitori la citano come requisito soddisfatto ma senza mostrare come l'utente verifica che l'invio sia realmente avvenuto — è esattamente l'adempimento con sanzioni dal 15/09/2026, quindi un'area dove la trasparenza verso l'utente (non solo la conformità tecnica) è un differenziatore commerciale concreto.

## Dove il mercato è avanti

1. **Firma remota RENTRI come flusso integrato nel gestionale, con OTP via app**: sia Ecotraccia/Estarweb (certificato di firma remota + notifica OTP con validità 60 secondi) sia WinWaste (configurazione esplicita "firma REMOTA R.E.N.T.Ri. con Client ID/Client Secret") hanno reso la firma un'operazione a un clic dentro il gestionale, senza uscire verso il portale RENTRI per firmare ogni singolo formulario. Se il nostro prodotto non offre ancora questo grado di integrazione (memoria progetto: `rifiuti-firma-non-legale.md` segnala che oggi il nostro provider QES/TSA è uno stub), è un gap concreto da chiudere prima del 15/09/2026.
2. **Automazione della restituzione/recupero della 4ª copia con fallback esplicito**: Ecotraccia/Estarweb non si limitano a "ricevere" la 4ª copia — gestiscono sia il caso in cui la chiude il destinatario (invio automatico agli altri soggetti entro 48h) sia il caso in cui la chiude produttore/trasportatore (tentativo di recupero automatico dall'AVI, con fallback manuale se le API RENTRI sono indisponibili). È un livello di robustezza operativa (gestione esplicita del caso di errore/indisponibilità) che vale la pena eguagliare.
3. **Rettifica e annullamento del registro cronologico come funzioni di prima classe, non ripieghi**: il manuale RENTRI di Ecotraccia tratta rettifica e annullamento come sezioni dedicate con effetti espliciti sul registro (riga aggiunta in coda, colore identificativo, gestione della riassociazione dei carichi/scarichi collegati) — un modello utile per il nostro registro se non lo trattiamo già con lo stesso livello di dettaglio.
