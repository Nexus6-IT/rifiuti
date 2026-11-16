# WasteFlow — brief per il consiglio di amministrazione simulato

Data del brief: 2026-11-16. Fonti: file del repository `rifiuti` e registri di portfolio. I percorsi tra parentesi sono relativi a `/home/graziano/Progetti/`. Dove due documenti si contraddicono, il conflitto è segnalato nelle sezioni e in "Domande aperte".

## Idea

- Cos'è: piattaforma SaaS B2B per la gestione digitale dei rifiuti (FIR, registri di carico/scarico, MUD, sincronizzazione RENTRI) per aziende italiane. (rifiuti/README.md; rifiuti/docs/FEATURES.md §1)
- Per chi: consulenti ambientali che gestiscono più aziende clienti da un unico accesso, indicati come beachhead; aziende produttrici, trasportatrici e destinatarie di rifiuti speciali, in particolare PMI e gruppi multi-sede. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §beachhead; rifiuti/docs/FEATURES.md §1)
- Cosa vende, a che prezzo: abbonamento SaaS per azienda. NON DOCUMENTATO — domanda aperta: nessun listino approvato o pubblicato (vedi "Prezzi documentati").
- Dove e come: web app online, nessuna app mobile. Canali di acquisizione: piani scritti (SEO, LinkedIn, associazioni di categoria), esecuzione non documentata. Consegna: accesso via browser; onboarding self-service dichiarato come obiettivo. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md; rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md)
- Budget e vincoli: vedi "Il fondatore e le risorse" e "Vincoli e decisioni già prese".

## Il prodotto

- Stack: backend NestJS 10, Prisma 5, PostgreSQL 16, Redis/BullMQ; frontend Angular 17 con PrimeNG. (rifiuti/docs/FEATURES.md §2)
- Funzioni documentate: anagrafiche produttore, trasportatore, destinatario; FIR digitale; registri di carico/scarico; vidimazione; sincronizzazione RENTRI; scadenzario con avvisi; cruscotto; multi-sede e aziende madre-figlie; consulente multi-azienda con cambio azienda; permessi granulari (RBAC). (rifiuti/docs/FEATURES.md; Progetti/STATUS.md, scheda rifiuti)
- Gestione contratti (produttore-trasportatore-smaltitore con modelli di pricing): al 2026-06 solo pianificata; una spec di form è datata 2026-07-27, stato di implementazione non verificato. (rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md; rifiuti/docs/superpowers/specs/2026-07-27-contratti-form-semplificato-design.md)
- Agente locale di pesa per Windows (Go), con sola modalità simulata: descritto come fatto il 14/11. (Progetti/STATUS.md, scheda rifiuti)
- Licenza dichiarata: MIT. (rifiuti/docs/FEATURES.md §1)

## Stato di sviluppo

In produzione, come documentato:
- Release `sha-575efb6` del 14/11, che include la PR #90 (agente di pesa). Nella scheda la stessa attività risulta "non pushata, PR da aprire": conflitto da chiarire. (Progetti/STATUS.md, riga tabella e scheda rifiuti)
- Fatturazione: modello per periodo, numerazione e motore di calcolo in produzione dal 05/11; "definitive" spente per tutte le aziende. (Progetti/STATUS.md, scheda rifiuti, 05/11)
- Programmi di rilascio P1-P5 (sicurezza, integrazione RENTRI P2, firma P3, RBAC P4, qualità P5) rilasciati il 25/07. (Progetti/STATUS.md, scheda rifiuti)
- Scadenzario con avvisi, cruscotto, pagina "Stato del sistema" per SUPER_ADMIN, rilasciati tra settembre e novembre. (Progetti/STATUS.md, scheda rifiuti)

Non completo, come documentato:
- RENTRI: al 2026-06 il client era mock-only verso un ambiente locale. Dal 25/07 il client è riscritto sul contratto ufficiale; il programma R0-R5 risulta con R2 9/9, R4 8/8, R3 2/10, R5 4/6. (rifiuti/README.md; Progetti/STATUS.md, scheda rifiuti)
- Accreditamento all'interoperabilità RENTRI: "resta fuori" al 10/09. Le credenziali reali e il dispositivo di firma dipendono da questo passo. (Progetti/STATUS.md, scheda rifiuti, 10/09)
- Firma: nessun valore legale finché non c'è un contratto QTSP o la firma remota RENTRI; decisione presa per la firma remota. (Progetti/STATUS.md, 25/07 e 26/07; rifiuti/docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md)
- MUD: stub al 2026-06 (recupero e smaltimento a zero); stato successivo non verificato. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §1.3)
- App mobile: assente. I documenti di marketing e funzioni la indicano come inclusa. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §1.3; rifiuti/docs/FEATURES.md §9)
- Conservazione a norma dei documenti (10 anni, AgID): assente; servizio esterno previsto. (rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md; Progetti/STATUS.md, scheda rifiuti)
- Isolamento tra aziende: applicativo, senza row-level security nativa di PostgreSQL; RLS nativa rinviata. (Progetti/STATUS.md, scheda rifiuti, 03/08 e 09/09)
- Test: backend circa 14% e frontend circa 2% di copertura al 2026-06; successivamente la suite dichiara 187 suite e 1773 test verdi. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §1.3; rifiuti/COSTS.md, riga 2026-09-11/12)
- CI/CD: "assente" al 2026-06; le schede di luglio-novembre descrivono pipeline e deploy automatici. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §1.3; Progetti/STATUS.md, scheda rifiuti)
- Stima del documento di giugno per una produzione reale e certificata: 3-6 mesi. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §1.4)

## Clienti e ricavi reali

- Al 09/09, verificato sul database: 8 tenant, 10 utenti, 12 FIR, 6 firme; "nessun utente reale in produzione". Il resto sono tabelle di riferimento da seed. (Progetti/STATUS.md, scheda rifiuti, 09/09)
- Nei file letti non compare alcun contratto firmato, lettera d'intento, pilota con importo o incasso. (ricerca su rifiuti/docs, rifiuti/marketing, Progetti/STATUS.md)
- Un tenant "WasteFlow Test E2E" è stato creato per i test (05/08): non è un cliente. (Progetti/STATUS.md, scheda rifiuti)
- "Pilota D10" è citato come passo necessario per i driver reali dell'agente di pesa; non è descritto. (Progetti/STATUS.md, scheda rifiuti, 14/11)
- Obiettivi del piano marketing 2025, non risultati: 50 clienti paganti nella fase 1, 250 nella fase 2, 1.000 nella fase 3; MRR di 2.500 euro come primo traguardo. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)
- Ricavi documentati: nessuno. Chi paga: non documentato.

## Prezzi documentati

Tre proposte in conflitto, nessuna approvata:
- Piano di marketing 2025: Starter 49, Professional 149, Enterprise 399 euro/mese; consulente 0 euro fino a 5 clienti, poi 19 euro per cliente; add-on MUD 29 euro/anno, PDF con intestazione 19 euro/anno, firma remota 9 euro/mese; trial di 14 giorni. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)
- FEATURES: FREE 0 (10 FIR), PRO 49 (100 FIR), BUSINESS 149 (500 FIR), ENTERPRISE personalizzato; add-on ERP +29/mese, white-label +499/mese, marketplace con commissione 10%. (rifiuti/docs/FEATURES.md §9)
- Documento prodotto di marketing: Starter 49, Pro 99, Enterprise 249 euro/mese. (rifiuti/docs/planning/PRODUCT_STRATEGY_2025.md)
- Giugno 2026: i tier sono "definiti, non pubblici/live"; si propone un prezzo per società senza tetti sui movimenti. (rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md, righe C2-C3)

Prezzi dei concorrenti citati nei documenti (fonti secondarie, da verificare):
- Rifiutoo: 79-199 euro/mese (marketing 2025); "circa 199 euro/anno via terzi, da verificare" (giugno 2026); prezzo a movimenti. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md; rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md)
- QuiRifiutiPro: 49-149 euro/mese; tetti sui formulari. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md; rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md)
- WinWaste: non pubblico, "stimato 200-500 euro/mese" nel documento di marketing. Ambiente.it ECOS: "oltre 500 euro/mese", stima. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)

## Mercato, normativa e concorrenti

- Normativa citata: RENTRI (D.Lgs. 116/2020); FIR digitale (D.M. 59/2023); MUD; sanzioni indicate tra 2.600 e 93.000 euro. (rifiuti/docs/marketing/MARKETING_STRATEGY_2025.md; rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)
- Date citate: ultima scadenza di iscrizione RENTRI 13/02/2026, indicata come passata; FIR digitale obbligatorio dal 16/09/2026 (una scheda cita 15/09 per la sospensione delle sanzioni e il Milleproroghe L. 26/2026). Alla data del brief entrambe sono trascorse. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §2.1; Progetti/STATUS.md, scheda rifiuti, 09/09)
- Dimensione del mercato come dichiarato, senza fonte nel documento: oltre 150.000 aziende obbligate RENTRI, 80.000 micro-PMI; 5.000-8.000 consulenti ambientali. (rifiuti/docs/FEATURES.md §1; rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)
- Perimetro: la scheda lo chiama "SaaS PA"; i documenti di prodotto parlano di aziende private; il documento del portfolio lo indica "da verificare". (Progetti/STATUS.md, scheda rifiuti; ignicraft/docs/strategy/mercato-privato-2026.md riga 39)
- Concorrenti citati: WinWaste (gruppo Zucchetti, "2.500+ clienti" dichiarati, non verificato); Rifiutoo (ora nello Zucchetti Store); QuiRifiutiPro (Buffetti); RifiutiGuru; Ecosolve; Ambiente.it ECOS (utility); PrometeoRifiuti ("oltre 3.000 clienti" dichiarati); Datalog; Ecotraccia (ECIPA/CNA); Estarweb; EcoDeskWeb; Terranova Software ("500 clienti" dichiarati). (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §2.2; rifiuti/docs/audits/concorrenti-posizionamento-2026-09-11.md)
- Conclusione del confronto del 11/09: sulla conformità il prodotto è "in gara"; su quattro aree su otto è sotto il minimo di mercato (scadenze con avviso, conservazione a norma, operatività quotidiana, cruscotto). Unico spazio "davvero scoperto" indicato: gruppi societari madre-figlie. (rifiuti/docs/audits/concorrenti-sintesi-2026-09-11.md)
- Il documento di giugno indica il white space in AI, ESG/CO2 e contratti; sono proposte, non risultati. (rifiuti/docs/planning/COMPETITOR_FEATURE_GAP_ANALYSIS_2026-06.md)

## Il fondatore e le risorse

- Decisore unico nei documenti: il fondatore (le schede parlano di "decisioni" e "PO"). Nessun altro collaboratore umano è documentato. (Progetti/STATUS.md, scheda rifiuti)
- Sviluppo fatto con sessioni di agenti AI, con implementatori e revisori separati; costo cumulato registrato 3.209,37 USD, la sessione più costosa 424,75 USD. (rifiuti/COSTS.md)
- Piano marketing con team di tre persone nei primi sei mesi e budget di 180.000 euro per il primo anno: sono piani, non impegni approvati. (rifiuti/docs/marketing/STRATEGIA_MARKETING_EXECUTIVE.md)
- Infrastruttura: deploy su VPS condiviso con altri stack; registry e CI self-hosted su Gitea, con runner su nodi Proxmox in una LAN domestica. (Progetti/STATUS.md; /home/graziano/.claude/CLAUDE.md, sezioni VPS e Proxmox)
- Tempo disponibile del fondatore e capitale: non documentati.

## Vincoli e decisioni già prese

- Architettura DDD e CQRS, multi-tenant con isolamento applicativo. (rifiuti/CLAUDE.md; rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md)
- Firma FIR con firma remota RENTRI, non con chiavi caricate dal cliente. (rifiuti/docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md)
- Sessione singola per utente su tutte le applicazioni: regola obbligatoria del fondatore. (/home/graziano/.claude/CLAUDE.md, sezione Conventions)
- Autenticazione: passport-saml e Keycloak; SPID/CIE configurati solo in dev al 2026-06. (rifiuti/docs/FEATURES.md §8; rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md)
- Beachhead consulenti con pricing trasparente: raccomandazione del documento di giugno 2026; approvazione non documentata. (rifiuti/docs/planning/ANALISI_E_PIANO_2026-06.md §3)
- Rinvio della RLS nativa e dei cambi trasversali a dopo il 16/09/2026, data già trascorsa. (Progetti/STATUS.md, scheda rifiuti, 09/09)

## Domande aperte

1. Listino: quale dei tre proposti è approvato, e il prezzo è per azienda o per movimento?
2. Clienti: esistono contratti, lettere d'intento, piloti o incassi? Cos'è il "pilota D10"?
3. Gli 8 tenant del database al 09/09 sono clienti, prove o test?
4. Accreditamento RENTRI all'interoperabilità: stato, tempi, costi e data di ottenimento delle credenziali reali.
5. Perimetro: aziende private e consulenti (documenti di prodotto) o PA (intestazione della scheda)?
6. Ambiente: la scheda parla di "produzione" sul VPS; il file globale di configurazione lo descrive come server di sviluppo e test dal 16/09/2026. Quale vale per WasteFlow?
7. Release 14/11: PR #90 è in produzione o non ancora pushata?
8. Fatturazione 4.4: fattura WasteFlow ai propri clienti (canone) o gli utenti dei tenant? A quale listino si riferiscono i test "in attesa del listino"?
9. Stato attuale del MUD, della gestione contratti e della conservazione a norma.
10. Pagamenti: il documento di febbraio dice Stripe "pianificato"; la scheda di agosto cita un checkout Stripe. Quale provider è in uso?
11. Fonte dei numeri di mercato (150.000 aziende, 80.000 micro-PMI, 5.000-8.000 consulenti) e dei conteggi dei concorrenti.
12. Tempo disponibile del fondatore, budget di cassa e fonte di finanziamento.
13. Dopo il 16/09/2026, quale finestra commerciale è indicata nei documenti? Nessun documento più recente la definisce.
14. Mobile: l'app è promessa nei documenti di prodotto e marketing; resta da confermare se è in roadmap.
