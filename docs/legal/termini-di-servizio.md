# Termini di Servizio — WasteFlow

**v0.1 — BOZZA — DA VALIDARE CON UN LEGALE PRIMA DELLA PUBBLICAZIONE**

_Ultima revisione: [DATA VERSIONE] — In vigore dalla stessa data_

---

> **Nota legale**: questo documento è una bozza redatta a scopo illustrativo.
> Non costituisce consulenza legale. Prima di pubblicarlo e renderlo vincolante
> per gli utenti, farlo revisionare da un professionista legale qualificato.

---

## 1. Parti e accettazione

**1.1** Il presente documento ("Termini") disciplina il rapporto contrattuale tra:

- **Fornitore**: [RAGIONE SOCIALE FORNITORE], con sede legale in [INDIRIZZO SEDE LEGALE], P.IVA [P.IVA FORNITORE], email [EMAIL FORNITORE] ("WasteFlow" o "Fornitore"); e
- **Cliente**: la persona giuridica (impresa, ente o professionista) che si registra al servizio e accetta i presenti Termini per sé e per gli utenti che autorizza ad accedere ("Cliente").

**1.2** I presenti Termini costituiscono un contratto vincolante tra le Parti ai sensi degli artt. 1321 e seguenti del Codice Civile italiano. Il Cliente dichiara di agire nell'esercizio della propria attività professionale o imprenditoriale. **I presenti Termini non si applicano a consumatori ai sensi del D.Lgs 206/2005.**

**1.3** Completando la registrazione o utilizzando il Servizio, il Cliente — tramite il proprio rappresentante legale o soggetto autorizzato — accetta integralmente i presenti Termini e le Policy allegate. Se il rappresentante non dispone dell'autorità per vincolare il Cliente, non deve procedere con la registrazione.

**1.4** Le clausole che limitano la responsabilità del Fornitore o prevedono decadenze o fori esclusivi (artt. 1341–1342 c.c.) sono specificamente evidenziate in **grassetto** e si intendono espressamente approvate con l'accettazione dei presenti Termini.

---

## 2. Oggetto del servizio

**2.1** WasteFlow è una piattaforma SaaS (Software as a Service) in cloud per la gestione digitale dei rifiuti speciali, che comprende: compilazione e archiviazione di Formulari di Identificazione Rifiuti (FIR) in formato digitale (xFIR), tenuta del registro cronologico di carico e scarico ai sensi dell'art. 190 D.Lgs 152/2006, gestione delle anagrafiche (produttori, trasportatori, destinatari), export MUD, dashboard e reportistica, integrazione con la piattaforma RENTRI del Ministero dell'Ambiente (quando attivata con credenziali reali).

**2.2** Il Servizio è erogato in modalità multi-tenant: i dati di ciascun Cliente sono logicamente isolati da quelli degli altri Clienti. Il Fornitore adotta misure tecniche di isolamento (Row-Level Security su database PostgreSQL, identificatori tenant separati) descritte nella documentazione tecnica.

**2.3** Il Servizio include funzionalità di autentica mediante SPID/CIE tramite l'Identity Provider [RAGIONE SOCIALE FORNITORE] integrato con Keycloak (realm `ignicraft`). L'accesso tramite SPID/CIE è soggetto alle regole dell'Agenzia per l'Italia Digitale (AgID).

**2.4** Il Fornitore si riserva di modificare, sospendere o interrompere funzionalità non core del Servizio, previo avviso al Cliente con ragionevole anticipo, senza che ciò configuri inadempimento contrattuale.

---

## 3. Registrazione, account e utenti

**3.1** Per utilizzare il Servizio, il Cliente deve completare la registrazione su [URL piattaforma], fornendo dati veritieri, completi e aggiornati (ragione sociale, P.IVA, dati del responsabile account). Registrazioni fraudolente o incomplete possono comportare la sospensione immediata dell'account.

**3.2** A ogni Cliente è associato un **account aziendale (tenant)** con un utente amministratore ("Admin"). L'Admin può creare ulteriori utenti interni nei limiti del piano sottoscritto.

**3.3** Il Cliente è responsabile della riservatezza delle credenziali di accesso e di qualsiasi attività svolta sotto il proprio account. Il Fornitore non è responsabile per danni derivanti da accesso non autorizzato causato da negligenza del Cliente nella custodia delle credenziali.

**3.4** Il Cliente garantisce che gli utenti autorizzati ad accedere al Servizio abbiano i poteri e le autorizzazioni necessarie, ivi incluse quelle relative al trattamento dei dati presenti nel sistema.

**3.5** Il Cliente si impegna a non cedere, condividere o consentire l'accesso all'account a soggetti terzi non autorizzati.

---

## 4. Piani e pagamenti

**4.1** Il Servizio è disponibile nei seguenti piani:

| Piano | Descrizione | Prezzo |
|-------|-------------|--------|
| **TRIAL** | Periodo di prova gratuito di [PERIODO TRIAL] giorni; limiti FIR mensili e utenti ridotti; nessun metodo di pagamento richiesto | Gratuito |
| **PROFESSIONAL** | Uso professionale per PMI; limiti FIR e utenti elevati; accesso a tutte le funzionalità core | [LISTINO PREZZI] / mese |
| **ENTERPRISE** | Per grandi organizzazioni o gruppi; nessun limite FIR/utenti; SLA dedicato; supporto prioritario | Su preventivo |

I dettagli aggiornati dei piani (limiti, funzionalità, prezzi) sono disponibili nella pagina di abbonamento in-app e sul sito web del Fornitore.

**4.2** Al termine del piano TRIAL, il Servizio viene sospeso salvo upgade a un piano a pagamento. Il Cliente riceverà notifica con anticipo di [X] giorni prima della scadenza del trial.

**4.3** I pagamenti per i piani a pagamento sono processati tramite il provider di pagamento [NOME PROVIDER — es. Stripe]. Il Cliente accetta i termini del provider di pagamento. Il Fornitore non conserva i dati delle carte di credito.

**4.4** I prezzi si intendono IVA esclusa, salvo diversa indicazione. L'IVA applicabile è quella vigente in Italia al momento della fatturazione.

**4.5** I piani sono rinnovati automaticamente al termine del periodo di fatturazione, salvo disdetta comunicata per iscritto con almeno [X] giorni di anticipo rispetto alla data di rinnovo. **Il Cliente rinuncia espressamente al diritto di rimborso per i periodi già fatturati, salvo diverso accordo scritto tra le Parti o inadempimento del Fornitore (clausola ex art. 1341 c.c.).**

**4.6** In caso di mancato pagamento, il Fornitore si riserva il diritto di sospendere l'accesso al Servizio previo avviso. In caso di ritardo superiore a [X] giorni, il Fornitore può risolvere il contratto ai sensi dell'art. 1456 c.c.

---

## 5. Obblighi del Cliente

**5.1** Il Cliente si impegna a utilizzare il Servizio esclusivamente per scopi leciti e conformi alla normativa vigente, ivi incluse le norme ambientali (D.Lgs 152/2006 e s.m.i.) e le disposizioni RENTRI (DM 59/2023).

**5.2** Il Cliente è il **titolare del trattamento** ai sensi del GDPR per i dati personali immessi nel Servizio (dati di produttori, trasportatori, destinatari, dipendenti, ecc.) ed è responsabile della loro correttezza, liceità e aggiornamento. Il Fornitore tratta tali dati in qualità di **responsabile del trattamento** ai sensi dell'art. 28 GDPR, nei termini dell'allegato DPA.

**5.3** Il Cliente è l'unico responsabile della correttezza e completezza dei dati ambientali inseriti (codici CER, quantitativi, destinatari, caratteristiche rifiuti, ecc.). Il Fornitore non verifica la conformità normativa dei dati inseriti dal Cliente.

**5.4** Il Cliente si impegna a non:
  - tentare di accedere ai dati di altri tenant o clienti;
  - effettuare reverse engineering, decompilare o disassemblare il software;
  - utilizzare il Servizio per attività illegali, fraudolente o lesive di diritti di terzi;
  - inviare automaticamente richieste (scraping, bot) in misura tale da compromettere le prestazioni del Servizio;
  - rivendere, sublicenziare o trasferire a terzi l'accesso al Servizio senza autorizzazione scritta del Fornitore.

**5.5** Il Cliente è responsabile della conservazione a norma dei documenti digitali (registri, FIR) ai sensi del CAD (D.Lgs 82/2005) e delle Linee Guida AgID. Il Servizio mette a disposizione funzionalità di export e archivio; la conservazione legale presso un conservatore accreditato AgID è responsabilità del Cliente.

---

## 6. Disponibilità e livelli di servizio (SLA)

**6.1 Il Servizio è erogato "come disponibile" (best-effort). Il Fornitore non garantisce una disponibilità minima del Servizio (uptime) né tempi di risposta specifici, salvo diverso accordo scritto tra le Parti per i piani ENTERPRISE (clausola ex art. 1341 c.c.).**

**6.2** Il Fornitore si impegna a garantire manutenzioni programmate al di fuori degli orari di picco e a comunicarle con ragionevole anticipo tramite email o notifica in-app.

**6.3** Il Fornitore non è responsabile di interruzioni del Servizio causate da forza maggiore, guasti di infrastruttura di terzi (provider hosting, rete internet), attacchi informatici o eventi al di fuori del proprio controllo.

**6.4** Il Fornitore implementa backup periodici dei dati. In caso di perdita di dati imputabile al Fornitore, il Fornitore si impegna al ripristino dell'ultimo backup disponibile. **Il Fornitore non risponde per la perdita di dati causata da errori del Cliente o da eventi non imputabili al Fornitore (clausola ex art. 1341 c.c.).**

---

## 7. Proprietà intellettuale

**7.1** Il Servizio, il software sottostante, il design, i marchi, i loghi e la documentazione sono di proprietà esclusiva del Fornitore o dei suoi licenziatari. I presenti Termini non trasferiscono al Cliente alcun diritto di proprietà intellettuale.

**7.2** Il Fornitore concede al Cliente una licenza non esclusiva, non trasferibile, revocabile e limitata per la durata del contratto, per accedere e utilizzare il Servizio esclusivamente per le proprie finalità aziendali interne.

**7.3** I **dati inseriti dal Cliente** nel Servizio rimangono di proprietà esclusiva del Cliente. Il Fornitore non rivendica diritti su tali dati, li tratta esclusivamente per erogare il Servizio e non li utilizza per finalità proprie, salvo in forma anonima e aggregata per il miglioramento del Servizio (dati statistici di utilizzo, privi di identificativi personali).

**7.4** Il Cliente garantisce che i dati e i contenuti immessi nel Servizio non violano diritti di terzi e mantiene il Fornitore indenne da eventuali pretese in merito.

---

## 8. Limitazione di responsabilità

**8.1 Il Fornitore non è responsabile per danni indiretti, consequenziali, incidentali, punitivi o per perdita di profitto, perdita di dati, interruzione dell'attività o danni reputazionali, anche se avvertito della possibilità di tali danni (clausola ex art. 1341 c.c.).**

**8.2 Nei limiti consentiti dalla legge, la responsabilità complessiva del Fornitore per qualsiasi rivendicazione derivante dai presenti Termini o dall'utilizzo del Servizio non supera il corrispettivo effettivamente pagato dal Cliente nei 12 (dodici) mesi precedenti all'evento che ha dato origine alla rivendicazione, o EUR 500,00 qualora il Cliente sia in piano TRIAL (clausola ex art. 1341 c.c.).**

**8.3** Le limitazioni di cui ai punti 8.1 e 8.2 non si applicano in caso di dolo o colpa grave del Fornitore, né per danni alla persona.

**8.4** Il Cliente è l'unico responsabile nei confronti delle autorità ambientali e fiscali per la correttezza degli adempimenti normativi (registri rifiuti, FIR, MUD, RENTRI). WasteFlow è uno strumento di gestione digitale: non sostituisce la responsabilità del produttore/detentore di rifiuti ai sensi del D.Lgs 152/2006.

---

## 9. Sospensione e risoluzione

**9.1** Il Cliente può recedere dal contratto in qualsiasi momento, disattivando il proprio account dalle impostazioni in-app o comunicando la disdetta per iscritto al Fornitore. Il recesso ha effetto al termine del periodo di fatturazione corrente.

**9.2** Il Fornitore può sospendere o risolvere il contratto, con effetto immediato e senza preavviso, in caso di:
  - violazione materiale dei presenti Termini da parte del Cliente;
  - mancato pagamento del corrispettivo, decorso il periodo di grazia;
  - utilizzo del Servizio per attività illegali;
  - su ordine di autorità giudiziaria o amministrativa competente.

**9.3** In caso di sospensione, il Cliente perde temporaneamente l'accesso al Servizio ma i dati vengono conservati per [X] giorni, al termine dei quali possono essere eliminati.

**9.4 Dopo la risoluzione del contratto, il Fornitore conserverà i dati del Cliente per un periodo di [X] giorni, durante i quali il Cliente può richiedere l'export dei propri dati. Trascorso tale termine, i dati saranno eliminati in modo sicuro. Il Fornitore non è responsabile per la perdita di dati conseguente alla mancata richiesta di export entro i termini (clausola ex art. 1341 c.c.).**

---

## 10. Riservatezza

**10.1** Ciascuna Parte si impegna a mantenere riservate le informazioni confidenziali dell'altra Parte ricevute in connessione al Servizio e a non divulgarle a terzi senza previo consenso scritto, salvo che siano necessarie per l'esecuzione del contratto o richieste da autorità competenti.

**10.2** L'obbligo di riservatezza permane per 3 (tre) anni dalla cessazione del rapporto contrattuale.

---

## 11. Privacy e protezione dei dati

**11.1** Il trattamento dei dati personali degli utenti del Servizio (dati di account) è disciplinato dall'**Informativa Privacy** disponibile su [URL INFORMATIVA], che il Cliente e i propri utenti sono invitati a leggere.

**11.2** Il trattamento dei dati personali che il Cliente carica nel Servizio (dati di terzi: produttori, trasportatori, destinatari, dipendenti) è disciplinato dal **Data Processing Agreement (DPA)** disponibile su [URL DPA], che il Cliente accetta contestualmente ai presenti Termini.

---

## 12. Modifiche ai termini

**12.1** Il Fornitore si riserva il diritto di modificare i presenti Termini in qualsiasi momento. Le modifiche saranno comunicate al Cliente via email o tramite notifica in-app con almeno 30 (trenta) giorni di anticipo.

**12.2** Se il Cliente non accetta le modifiche, può recedere dal contratto prima della data di entrata in vigore delle stesse, senza penali per le somme non ancora fatturate. Il proseguimento dell'utilizzo del Servizio dopo la data di entrata in vigore delle modifiche costituisce accettazione delle stesse.

---

## 13. Disposizioni generali

**13.1 Legge applicabile**: I presenti Termini sono disciplinati dalla legge italiana.

**13.2 Foro competente**: **Per qualsiasi controversia derivante dai presenti Termini o dall'utilizzo del Servizio, è esclusivamente competente il Tribunale di [FORO COMPETENTE], con espressa esclusione di qualsiasi altro foro (clausola ex art. 1341 c.c.).**

**13.3 Nullità parziale**: Se una o più disposizioni dei presenti Termini risultano nulle o inefficaci, le restanti disposizioni mantengono piena validità ed efficacia.

**13.4 Intero accordo**: I presenti Termini, unitamente all'Informativa Privacy e al DPA, costituiscono l'intero accordo tra le Parti relativamente all'oggetto del contratto e sostituiscono qualsiasi precedente accordo o comunicazione.

**13.5 Rinuncia**: La mancata applicazione di qualsiasi disposizione dei presenti Termini da parte del Fornitore non costituisce rinuncia al diritto di applicarla in futuro.

---

*Versione 0.1 — BOZZA — DA VALIDARE CON UN LEGALE*

*Riferimenti normativi principali: artt. 1321, 1341, 1342, 1456 Cod. Civ.; D.Lgs 206/2005 (Codice del Consumo — escluso); D.Lgs 152/2006 (T.U. Ambiente); DM 59/2023 (RENTRI); D.Lgs 82/2005 (CAD); Reg. UE 2016/679 (GDPR).*
