# Concorrenti: funzioni oltre la conformità RENTRI

Data: 2026-09-11
Tipo: ricerca desk (sola documentazione pubblica), nessuna modifica al codice.

## Metodologia e limiti

Il RENTRI/FIR è dato per scontato per tutti i fornitori indagati e non è oggetto
di questa ricerca: qui si guarda solo a cosa offrono OLTRE quello, nelle 8 aree
richieste. Per ciascuna casella:

- **COPERTO** — pagina/documento pubblico che descrive la funzione con dettaglio
  verificabile (elenco puntuale, manuale, schermata, dato tecnico preciso).
- **PARZIALE** — accennata, spesso in una riga di brochure, senza dettaglio
  sufficiente a giudicare la profondità reale.
- **NON TROVATO** — nessuna menzione pubblica reperita. **Non significa che la
  funzione manchi**: molti di questi vendor vendono via demo commerciale e
  agenti offline, quindi l'assenza di documentazione pubblica è debole come
  prova negativa. Per un confronto a prova di obiezione servirebbe una demo o
  un contatto diretto.

Ove possibile è distinto il claim da **brochure marketing** (generico, senza
dettagli) dal contenuto **documentato** (manuale, elenco funzioni puntuale,
listino, screenshot).

Tre dei fornitori nell'elenco di partenza si sono rivelati **non pertinenti** e
sono trattati a parte in fondo (Sispi, Ecobox/Sadel/Gedit, Dedagroup).

## Tabella fornitore x area

| Area                            | Ecotraccia          | Estarweb             | Zucchetti Ambiente (WinWaste.NET + DH Waste)                              | Rifiutoo                                                  | EcoDeskWeb / Ecocerved                   | TeamSystem Waste                                                  | Aliante                             |
| ------------------------------- | ------------------- | -------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 1. Anagrafiche e autorizzazioni | PARZIALE            | PARZIALE             | **COPERTO** (doc.)                                                        | **COPERTO** (marketing dettagliato)                       | **COPERTO** (doc.)                       | PARZIALE (marketing)                                              | NON TROVATO                         |
| 2. Operatività quotidiana       | NON TROVATO         | PARZIALE (marketing) | **COPERTO** (doc.)                                                        | PARZIALE                                                  | NON TROVATO                              | PARZIALE (marketing)                                              | NON TROVATO                         |
| 3. Mobile e campo               | NON TROVATO         | PARZIALE             | PARZIALE (claim non dettagliato, RentrinCloud appena lanciata 2026-09-09) | PARZIALE (firma delegata all'app RENTRI, non app propria) | NON TROVATO                              | NON TROVATO                                                       | NON TROVATO                         |
| 4. Pesatura e impianti          | NON TROVATO         | NON TROVATO          | **COPERTO** (doc., bilance/lotti/EoW dettagliati)                         | NON TROVATO                                               | PARZIALE (solo campo "peso in ingresso") | NON TROVATO                                                       | NON TROVATO                         |
| 5. Amministrazione              | NON TROVATO         | COPERTO (marketing)  | **COPERTO** (doc., fatturazione automatica da movimenti)                  | NON TROVATO                                               | NON TROVATO                              | PARZIALE (marketing)                                              | NON TROVATO                         |
| 6. Analisi e controllo          | NON TROVATO         | PARZIALE             | COPERTO ma senza dashboard/KPI moderni (solo statistiche/export)          | PARZIALE (marketing)                                      | PARZIALE (marketing)                     | PARZIALE (marketing)                                              | PARZIALE (marketing, solo "visure") |
| 7. Documentale                  | PARZIALE            | **COPERTO**          | PARZIALE (via DH Waste, prodotto separato)                                | **COPERTO**                                               | PARZIALE                                 | **COPERTO** (add-on Digital Archive)                              | PARZIALE                            |
| 8. Consulenti / multi-azienda   | COPERTO (marketing) | NON TROVATO          | **COPERTO** (doc., portale WinGAP)                                        | **COPERTO** (doc., piani Freelance/Advisor/Master)        | PARZIALE (marketing)                     | NON TROVATO (anzi: indizio contrario, listino limita a 1 azienda) | NON TROVATO                         |

Fonti principali per casella (URL + punto preciso) sono nei rapporti dei sotto-incarichi;
le più rilevanti, per non perderle:

- **Zucchetti Ambiente / WinWaste.NET** — manuale utente ufficiale ~290 pagine:
  `https://winwaste.net/wp-content/uploads/2024/09/Manuale_WinWaste.Net_-1-1-1.pdf`
  (scadenze autorizzazioni p.57, Albo Gestori p.59, pianificazione ritiri
  p.118-127, pesatura p.52-53, fatturazione p.133); listino
  `https://winwaste.net/wp-content/uploads/2026/06/LISTINO-PREZZI-ZUCCHETTI-AMBIENTE.pdf`;
  portale consulenti WinGAP `https://winwaste.net/wp-content/uploads/2024/09/MANUALE_WINGAP-1-3-1.pdf`.
  Prodotto **on-premise Windows client/server** con chiave hardware, non SaaS.
- **Rifiutoo** — `https://www.rifiutoo.com/consulenti-ambientali/` (multi-cliente,
  dashboard multi-company) e `https://www.rifiutoo.com/prezzi/` (piani
  Freelance/Advisor/Master per numero di registri).
- **EcoDeskWeb/Ecocerved** — `https://ecodeskweb.ecocerved.it/HELP/anagrafe_fornitori.htm`
  (campi Albo Gestori con date di scadenza, controllo di coerenza in fase FIR).
- **TeamSystem** — `https://www.teamsystem.com/aziende/ts-waste/prezzi/` (limite
  "1 azienda, 1 unità locale" sui piani standard) + Digital Archive come add-on
  trasversale, non nativo.
- **Estarweb** — `https://estarweb.it/` (solo landing marketing) +
  `https://portale.estarweb.it/estar_graph/images/rentri/manuale_xfir_estarweb.pdf`
  (documentato ma solo xFIR).
- **Ecotraccia** — prodotto ECIPA/CNA, compliance a basso costo per PMI, nessuna
  pagina funzionalità/moduli pubblica.
- **Aliante** — prodotto reale ma distribuito solo da rivenditori
  (`retesam.it`, `ariannambiente.it`), due pagine brevi, nessun manuale.

## Cosa è dato per scontato dal mercato

Tre funzioni compaiono, con qualche dettaglio, in quasi tutti i fornitori con
documentazione pubblica utile:

1. **Scadenzario autorizzazioni/Albo Gestori con avviso** (area 1). Presente
   almeno in forma parziale in 5 vendor su 7 esaminati (Ecotraccia, Estarweb,
   Zucchetti, Rifiutoo, EcoDeskWeb), spesso descritto con dettaglio ("notifica
   scadenza autorizzazioni con preavviso di N giorni", controllo Albo in fase
   di formulario). Chi non ce l'ha o non lo documenta rischia di essere
   scartato a prescindere dalla conformità RENTRI.
2. **Conservazione a norma dei documenti/FIR** (area 7), spesso come add-on
   dedicato (Digital Archive di TeamSystem, DH Waste di Zucchetti,
   conservazione AgID di Rifiutoo, conservazione integrata di Estarweb). È
   trattata come requisito quasi automatico, non come differenziatore.
3. **Reportistica/esportazione dati di base** (area 6, livello "statistiche ed
   export Excel/PDF", non dashboard KPI vera e propria). Quasi tutti i vendor
   la citano, anche se in forma generica da brochure.

## Dove nessuno arriva

Due aree restano scoperte o mal documentate da praticamente tutti:

1. **Mobile e campo reale** (area 3): nessuna fonte pubblica, per nessuno dei
   sette fornitori pertinenti, documenta insieme firma su dispositivo + foto +
   funzionamento offline per un'app autisti. Chi ha qualcosa delega la firma
   all'app istituzionale RENTRI (Ecotraccia, Rifiutoo) oppure ha appena
   lanciato un prodotto acerbo (RentrinCloud di Zucchetti, 9 settembre 2026,
   due giorni prima di questa ricerca) senza descriverne le capacità offline.
   È il punto debole più uniforme del mercato.
2. **Pesatura e impianti** (area 4): solo Zucchetti/WinWaste.NET la documenta
   seriamente (doppia bilancia, tara, peso non modificabile, lotti End of
   Waste). Tutti gli altri sono NON TROVATO o limitati a un campo "peso in
   ingresso" nel formulario, senza integrazione hardware né gestione lotti.

## Fornitori risultati non pertinenti (esclusi dalla tabella)

- **Sispi** — Sistema Palermo Innovazione, società ICT in-house del Comune di
  Palermo. Nessun prodotto di gestione rifiuti; l'unico contenuto attinente è
  un comunicato su telecamere anti-abbandono (videosorveglianza smart-city).
- **Ecobox, Sadel, Gedit** — non sono fornitori di software gestionale rifiuti:
  rispettivamente un nome commerciale di servizi di raccolta toner in
  contenitori fisici, un'azienda di sistemi informativi ferroviari (Gruppo
  Almaviva), un gestore di discariche bresciano. Tutte e 8 le aree sono
  "NON TROVATO" per assenza del soggetto, non per carenza di documentazione.
- **Dedagroup** — esiste, ma la sua offerta rifiuti è rivolta ai Comuni sul
  lato tributario/TARI (Civilia Next, GIS GeoNext), non al segmento
  produttori/trasportatori/impianti con FIR in cui operiamo. Confronto non
  applicabile: mercato diverso.

Nomi emersi di rimbalzo nelle ricerche, non ancora indagati, potenzialmente
utili per un giro successivo: Ambiente.it/ECOS, DATALOG, PrometeoRifiuti,
Centro Software, AgonWeb, GE.RI.log, EcoGreen, Blumatica, Software 2000,
Sintesi, MAES, IES, I-Tech, Omicron Sistemi, Ekovision, SolFieco, GreenCUBE.

## Il nostro stato

Basato su `apps/backend/prisma/schema.prisma`, `CLAUDE.md` e i memory di
progetto (`docs/audits/`, `rifiuti-admin-provisioning`, `rifiuti-p4-rbac-granulare`).
Nessun abbellimento: dove siamo scoperti lo diciamo.

1. **Anagrafiche e autorizzazioni — PARZIALE.** Esistono modelli dedicati
   (`Produttore`, `Trasportatore`, `Destinatario`, `AutorizzazioneImpianto`
   con campo `dataScadenza`). Manca però l'avviso automatico: l'enum
   `NotificationType` copre `FIR_DEADLINE_APPROACHING`, `RENTRI_SYNC_*`,
   `MUD_DEADLINE_APPROACHING`, `SUBSCRIPTION_EXPIRING`, `SIGNATURE_REQUIRED`,
   `SYSTEM_ERROR` — **nessun tipo per scadenza autorizzazione/iscrizione
   Albo**. Il dato c'è, l'alert no: siamo sotto al livello minimo di mercato
   individuato sopra (scadenzario "che avvisa", non solo che registra).
2. **Operatività quotidiana — NON COPERTO.** Nessun modello per pianificazione
   ritiri, giri di raccolta, mezzi, autisti o contenitori/attrezzature presso
   il cliente. Questa è un'area interamente assente dal prodotto attuale.
3. **Mobile e campo — NON COPERTO.** Nessuna evidenza di un'app mobile per
   autisti, firma su dispositivo, acquisizione foto o funzionamento offline.
   Coerente col fatto che è anche il punto debole del mercato, ma qui non
   siamo nemmeno al livello "delego all'app RENTRI" dei concorrenti più
   deboli.
4. **Pesatura e impianti — NON COPERTO.** Esiste solo il campo `effectiveWeight`
   su `FIR` e i modelli `AutorizzazioneImpianto`/`AutorizzazioneImpiantoDiscarica`
   per l'anagrafica impianto. Nessuna integrazione con bilance, nessuna
   gestione lotti/accettazione dedicata. Anche qui siamo allineati al resto
   del mercato (area scoperta quasi da tutti), tranne che dal leader
   (Zucchetti/WinWaste.NET).
5. **Amministrazione — PARZIALE.** Il modello `Contract` è sorprendentemente
   ricco (8 `PricingModel`: FLAT_RATE, PAY_PER_LIFT, PAY_BY_WEIGHT,
   PAY_BY_VOLUME, ZONE_BASED, TIERED_VOLUME, MINIMUM_GUARANTEE, HYBRID;
   termini di pagamento, auto-rinnovo, preavviso). Manca però tutto il resto
   della catena: nessun modello `Invoice`/fattura, nessun listino separato dal
   contratto, nessuna contabilità di magazzino rifiuti. È un buon punto di
   partenza dati ma non un modulo amministrativo funzionante.
6. **Analisi e controllo — NON COPERTO/PARZIALE.** Non esiste un modello
   dashboard/KPI dedicato. `ActivityLog` e `Notification` servono l'audit, non
   la reportistica direzionale; `MUDReport` è un report di conformità
   normativa (MUD), non un cruscotto di costi per cliente/CER. Siamo sotto
   anche al livello minimo di mercato ("statistiche/export di base").
7. **Documentale — NON COPERTO, gap dichiarato.** `CLAUDE.md` di progetto lo
   dice esplicitamente: _"Nessuno storage a oggetti: S3Service e il job
   pdf-generation sono stati rimossi il 2026-09-09 perché inerti. I PDF si
   generano al momento della richiesta e si scrivono nella risposta HTTP,
   senza coda e senza cache."_ Nessuna archiviazione, nessuna conservazione a
   norma, nessuna ricerca documenti. Questa è l'area dove il divario dal
   mercato è più netto: conservazione a norma è una delle tre funzioni date
   per scontate, e noi non ce l'abbiamo nemmeno come add-on.
8. **Consulenti — COPERTO, punto di forza reale.** `ConsultantTenantAssociation`
   esiste nello schema insieme a un sistema RBAC granulare (ruoli, permessi,
   policy ABAC, `TemporaryPermissionGrant`, audit dei cambi ruolo) già in
   esercizio secondo il memory di progetto (P4 RBAC granulare). Su quest'area
   siamo a livello dei migliori del mercato (Zucchetti/WinGAP, Rifiutoo), che
   la trattano entrambi come funzione documentata e dedicata.
