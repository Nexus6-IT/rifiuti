# Divario RENTRI al 2026-09-10 — cosa manca davvero

**Metodo**: incrocio fra la tabella delle 37 funzionalità dell'audit del
25/07/2026 (`rentri-conformita-2026-07-25/README.md` §3) e lo **stato odierno
del codice su `master`**, letto direttamente. Non è una rilettura degli audit:
ogni riga qui sotto è stata verificata sul sorgente oggi. Dove scrivo «assente»
significa che il concetto non compare nel codice di produzione, non che l'audit
di luglio lo dicesse.

**Contesto che governa le priorità**: in produzione non ci sono utenti reali
(8 tenant, 10 utenti, 12 FIR — verificato sul database il 09/09). La scadenza
del **15/09/2026** è quindi una finestra commerciale, non un'esposizione legale
nostra o di clienti.

---

## 1. La risposta in una riga

**L'impianto di trasmissione è stato costruito davvero; quello che ci passa
dentro no.** Autenticazione, asincronia, resilienza, ciclo di firma, allegati,
visibilità, annullamento e riconciliazione sono implementati e cablati. Ma il
corpo che viene spedito a RENTRI quando un FIR si sincronizza è ancora un
segnaposto di due campi.

---

## 2. Il difetto che blocca tutto il resto

`apps/backend/src/application/rentri/sync-fir-to-rentri.use-case.ts:394`

```ts
private convertFIRToPayload(fir: FIR): any {
  return {
    firId: fir.id,
    firNumber: fir.numeroProgressivo,
    // ... other fields
  }
}
```

Questo è **il percorso vivo**, non codice morto. Il metodo è chiamato alla riga
112 subito prima di `creaFormulario`, lo use case è provider del
`RentriSyncModule` (riga 170, esportato alla 466) e quel modulo è importato in
`app.module.ts:121`. Il tipo del parametro conferma che nessuno ha mai riempito
il modello: `export type NuovoFormularioPayload = Record<string, unknown>`
(`rentri-api.client.ts:1694`).

Quindi oggi, contro RENTRI vero, la creazione di un formulario spedirebbe due
identificativi interni — un UUID nostro e un progressivo nostro — dentro una
struttura che il contratto ufficiale non definisce così. Il risultato atteso è
un rifiuto di validazione, non un formulario creato.

**Perché non è stato intercettato prima.** L'oracolo `tools/rentri-fake`
accetta qualunque corpo e risponde comunque 202: l'audit lo dichiarava già come
riserva esplicita (§9.2, «Modelli dati di scrittura»). Tutti i test verdi
sull'oracolo restano validi per ciò che coprono — autenticazione, ciclo
202/303/result, backoff — e non dicono nulla sul contenuto.

---

## 3. Cosa è stato davvero chiuso da luglio a oggi

Verificato sul codice odierno. Sono avanzamenti reali, non dichiarazioni.

| # | Funzionalità | Luglio | Oggi | Evidenza odierna |
|---|---|---|---|---|
| 1 | Autenticazione ID_AUTH_REST_02 | assente | **fatta** | JWT self-issued per chiamata, nessun `/token` |
| 6 | Asincronia NONBLOCK_PULL | assente | **fatta (solo PULL)** | `attendiEsito`, ciclo `/status` → `/result` |
| 7 | Gestione 429/423/503 | parziale | **fatta** | backoff e non-ritentabilità del 403 |
| 22 | Numero FIR ufficiale | assente | **fatta** | `estraiNumeroFirDaEsito` legge `numero_fir` dall'esito, non più il `transazione_id` |
| 26 | Annullamento formulario | assente | **fatta** | `annullaFormulario` + `inviaNoteAnnullamento` |
| 29 | Eventi del ciclo di vita | assente | **parziale** | trasbordo totale/parziale e sosta tecnica esistono come operazioni; le azioni ammesse le dichiara RENTRI via `leggiAzioniDisponibili` |
| 31 | Ciclo di firma via API | assente | **fatta** | `richiediHashPerFirma` → `inviaAcquisizioneFirma` |
| 33 | Firma remota CA RENTRI | assente | **fatta** | `/ca-rentri/v1.0`: certificato, autorizzazione, verifica, `firmaHashRemoto` |
| 36 | Tabelle di codifica | assente | **fatta** | client dedicato `/codifiche/v1.0`, sincronizzazione EER |
| 11 | Anagrafica operatore / siti | assente | **parziale** | client `/anagrafiche/v1.0`, siti dell'operatore |
| 5 | Validazione certificato | assente | **parziale** | scadenza letta da `notAfter`; catena, CRL e OCSP non verificate |
| 35 | Strato di sincronizzazione | codice morto | **cablato** | non più irraggiungibile, ma vedi §2: spedisce il segnaposto |

Aggiungo, fuori tabella, il limitatore di frequenza per azienda, la
riconciliazione periodica, la diagnostica e la gestione allegati: non erano
requisiti numerati ma sono infrastruttura reale.

---

## 4. Cosa resta assente

Verificato oggi: nessuna occorrenza nel codice di produzione.

**Registro cronologico (righe 13-20).** Il servizio `/dati-registri/v1.0` non è
mai chiamato: nel repository esistono solo quattro servizi RENTRI
(`/formulari`, `/codifiche`, `/anagrafiche`, `/ca-rentri`). Mancano apertura e
vidimazione del registro, XSD conformi, nodo `eREGI`, catena dei riferimenti
precedenti, firma XMLDSig sull'export, trasmissione e rettifica delle
registrazioni, conservazione a norma. Il registro locale con hash interno non
ha alcun legame con RENTRI.

**Contenitore xFIR (righe 28, 30, 34).** Nessun ASiC-E, nessun XAdES, nessun
XMLDSig in tutto il repository: le uniche occorrenze di «xFIR» e «ASiC» sono
commenti nel client. La validazione `/xfir/valida` non esiste.

**QR code del documento stampato (riga 23).** Serve CBOR firmato COSE_Sign1 in
Base45. Nel codice non c'è né CBOR né COSE: esiste un generatore di QR
generico, che è un'altra cosa.

**Copia cartacea (riga 27) e vidimazione a piè di pagina (riga 24).** Assenti.

**Trasmissione dati dei FIR pericolosi (riga 35, la riga con le sanzioni dal
15/09).** Attenzione a un falso positivo: cercando «trasmissioni» nel codice si
trovano sei file, ma sono tutti nostra terminologia interna di diagnostica. La
rotta RENTRI `/trasmissioni/operatore/{ul}` non è mai chiamata.

**Accreditamento e unità locali (righe 10, 12).** Non modellati.

**Indisponibilità dei servizi (riga 37).** `trasformato_in_cartaceo` assente.

---

## 5. Lettura per la decisione

**Il 16 settembre non è raggiungibile.** Mancano sei giorni e il divario non è
una rifinitura: è il modello dati di scrittura da costruire e verificare contro
l'ambiente demo reale, più il contenitore xFIR con la firma XAdES, più il
registro cronologico. Nessuno dei tre è lavoro da giorni.

**Ma la distanza è molto minore di quanto dicesse luglio.** A luglio mancava
l'impianto; oggi manca il contenuto che ci passa dentro. È una differenza
sostanziale, perché il contenuto si può costruire incrementalmente contro un
riferimento — mentre l'impianto andava riscritto.

**Il lavoro si può fare tutto in casa, e questo è il punto che conta.** Il
contratto ufficiale è versionato in `docs/contracts/rentri/formulari.yaml` e
definisce `NuovoFormularioModel` per intero: campi obbligatori
(`dati_partenza`, `num_iscr_sito`), espressioni regolari sui formati,
`additionalProperties: false`, e tutta la gerarchia annidata sotto
(`DatiPartenzaModel` con destinatario, rifiuto e almeno un trasportatore
obbligatori, e i modelli di trasporto terrestre, marittimo e ferroviario).

Non serve l'ambiente demo per costruire la mappatura né per verificarla: serve
insegnare al finto RENTRI a validare il corpo contro quello schema. Oggi non lo
fa, e lo dichiara apertamente — `tools/rentri-fake/src/stato/archivio.ts:14`
scrive che «la fake non modella l'intera struttura `dati_partenza`/soggetti del
`NuovoFormularioModel` reale». La rotta di creazione accetta qualunque corpo e
risponde 202 (`src/routes/transazioni.ts:62`). Fra le dipendenze del finto non
c'è alcun validatore di schema.

**Il finto è cresciuto più di quanto il divario lasci pensare.** Ha già un
validatore ASiC-E e uno XAdES, con le librerie per farlo davvero. Quindi anche
il contenitore xFIR, che resta il pezzo più grosso da costruire, ha un oracolo
locale che lo aspetta.

Le credenziali di accreditamento servono per la **conferma finale** contro
l'ambiente reale, non per fare il lavoro. Vale la pena avviare la pratica in
parallelo perché ha tempi non nostri, ma non è ciò che blocca lo sviluppo.

**Un avvertimento dalle FAQ ufficiali**, già segnalato a luglio e ancora valido:
il certificato `.p12` di interoperabilità **non serve a firmare i FIR**. La via
corretta è la firma remota CA RENTRI, che ora è implementata.

---

## 6. Ordine proposto

1. **Insegnare al finto RENTRI a validare il corpo** contro
   `NuovoFormularioModel` e la sua gerarchia. Senza questo passo, qualunque
   mappatura scriveremo continuerà a risultare verde su un oracolo che non
   guarda il contenuto — è lo stesso meccanismo che ha lasciato passare il
   segnaposto di §2 per mesi. È il primo passo perché rende falsificabile tutto
   ciò che viene dopo.
2. **Costruire il modello dati di scrittura**, sostituendo il segnaposto di §2,
   con il finto ormai capace di rifiutarlo.
3. **Contenitore xFIR e firma XAdES**, il pezzo più grosso rimasto sui
   formulari. L'oracolo ha già i due validatori pronti.
4. **Registro cronologico**, cantiere autonomo e altrettanto grande.
5. **QR, copia cartacea, vidimazione a piè di pagina**: rifiniture del documento
   stampato, dopo che il resto regge.

In parallelo e fuori da questa scaletta: **avviare l'accreditamento
all'interoperabilità**. Serve per la conferma finale contro l'ambiente reale e
ha tempi che non dipendono da noi, quindi conviene farlo partire subito — ma
non blocca nessuno dei cinque passi qui sopra.
