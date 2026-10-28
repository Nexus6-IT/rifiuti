# Confutazione dopo l'esecuzione (D, C, A Task 1-5) — esito

Data: 2026-10-22. Un giro, due agenti per piano: uno sul codice, uno sul documento e sulla fedeltà a WinWaste.
Rapporti: `D-codice.md`, `D-documento-winwaste.md`, `C-codice.md`, `C-documento-winwaste.md`, `A-codice.md`, `A-documento-winwaste.md` (questa cartella).

| Rapporto | Critiche | Importanti | Altre |
|---|---|---|---|
| D codice | 1 | 6 | 11 |
| D documento/WinWaste | 0 | 6 | 4 |
| C codice | 0 | 3 | 7 |
| C documento/WinWaste | 0 | 3 | 8 |
| A codice | 0 | 6 | 8 |
| A documento/WinWaste | 1 | 12 | 5 |

Verificati di persona dal controller: D-C-01 (restore.sh: DROP prima di ogni verifica, psql senza `ON_ERROR_STOP`, `migrate deploy` con errore ignorato), D-C-04 (fattore 10^12 per la dimensione del DB oltre il limite dell'aritmetica di bash), A-W-01/A-C-02 (placeholder `es. 38.11.00` nella maschera azienda, `mudAlfa(...,6)` tronca a `38.11.`), A-C-06 (`ConsultantTenantAssociation.roleId` esiste, il MUD usa solo `req.user.role`).

## 1. Correzioni al codice già scritto (ondate dedicate, una per piano, prima di riprendere il Task 6 di A)

**Piano D**
- D-C-01 + D-W-01 + D-C-02 + D-C-03 (Critica): `ops/restore.sh` — verificare il dump (marcatore finale / `verifica_completezza_dump`) **prima** del DROP; `psql -v ON_ERROR_STOP=1` e controllo dell'esito della pipe (`set -o pipefail`); `trap` che riavvia il backend su ogni uscita; `migrate deploy` con l'immagine del tag da cui si ripristina e uscita non zero se fallisce; niente "Ripristino completato" su errore.
- D-C-04: overflow del fattore di spazio in `backup-offsite.sh`/test (confronto senza moltiplicazione a 64 bit).
- D-C-05: i job RENTRI rilanciano dopo `segnalaErroreJob`, così l'audit di un rilancio manuale non dice "completato" su un errore.
- D-C-07 + D-W-08: `beforeSend` ripulisce anche il messaggio e i valori dell'eccezione (P2010, `RentriApiError.detail`).
- D-W-05: `pdf.service.ts` formatta date e ore in Europe/Rome (ora della firma, giorno dopo mezzanotte).
- D-C-06 + D-W-03: controllo di freschezza del backup (mail se l'ultimo dump verificato ha più di 26 h), come `fastselling-salute`.

**Piano C**
- C-C-01: l'anomalia "Giacenza impossibile" valuta le unità non di massa come la giacenza (per unità, mai contro i kg) e il test del caso `3 M3` cambia di segno.
- C-C-02: scarico in kg di un CER caricato solo in unità non di massa: niente blocco sul saldo di massa a zero, avviso; il messaggio non suggerisce più un "Altro carico".
- C-C-03: nel `FOR UPDATE` di `salvaCon` non si sovrascrive neppure uno `status = CANCELLED` persistito (sync RENTRI lunga).

**Piano A (Task 1-5)**
- A-W-01 + A-C-02 (Critica): ATECO normalizzato alle sole cifre; bloccante se non sono 6.
- A-C-01: stessa risoluzione del comune ISTAT in aggregazione ed export; bloccante se il codice non è completo.
- A-C-03: i doppi si cercano dopo la classificazione, fra movimenti con lo stesso ruolo.
- A-C-05: la ricerca dei doppi e dei FIR scaricati più volte guarda anche fuori dalla finestra dell'anno.
- A-C-06: il ruolo che conta per la conferma è quello dell'utente **nell'azienda selezionata** (per un consulente quello di `ConsultantTenantAssociation`). Da verificare se lo stesso schema si ripete negli altri endpoint (follow-up di sicurezza a parte).
- A-W-06: `GIACENZE_NON_CALCOLATE` quantificato con il saldo del registro al 31/12 (kg), quindi conta come avviso che cambia le quantità.
- A-W-07 + A-C-04: uno scarico senza destinatario è trattato come uno con destinatario senza CF (bloccante correggibile), così il BA non si contraddice.
- A-W-08: TE con CF vuoto controllato; avviso quando manca il TE.
- A-W-11: stato fisico preso da `WasteMovement.wastePhysicalState`.
- A-C-14: `OPERAZIONE_NON_INDICATA` e `OPERAZIONE_DEDOTTA_DAL_FIR` contano come avvisi che cambiano le quantità (spostano kg fra recupero e smaltimento).

## 2. Modifiche ai Task 6-10 di A prima di eseguirli
- A-W-02: con `fileTracciato: false` la segnatura non richiede l'aggregazione senza bloccanti.
- A-W-03: la segnatura si lega a un'esportazione precisa (hash dell'esportazione inviata, non ricalcolato).
- A-W-04: "Annulla e sostituisce" e data della comunicazione sostituita valorizzati quando esiste una presentazione precedente.
- A-W-05: destinatario estero: nazione al posto del CF nelle integrazioni.
- A-W-09: promemoria senza "Completamento 0%" né sezioni inesistenti, link a una rotta vera, anno di presentazione nel titolo.
- A-W-12: testo del catalogo su RE corretto (modulo del produttore), avviso che i rifiuti prodotti fuori dall'unità locale non sono distinti.
- A-W-13: il CF della propria azienda come destinatario si accetta con conferma esplicita.

## 3. Decisioni per Graziano
- C-W-01 peso a destino; C-W-02 numerazione per chi arriva da WinWaste a metà anno; C-W-03 più movimenti dallo stesso FIR; A-W-10 stato "MUD non dovuto". Poste con AskUserQuestion il 2026-10-22.
- D-W-04 conservazione dei backup oltre 30 giorni (copia dell'anno chiuso) e D-W-06 backup di Keycloak: da decidere insieme al piano infrastruttura, follow-up.

## 4. Follow-up nella PR
Tutte le obiezioni medie e minori non elencate sopra, con il loro id, restano nella sezione "Fuori ambito" della PR.

## Decisioni di Graziano (2026-10-22)
- **C-W-01 peso a destino:** dipende dal verso, come RENTRI e WinWaste. Lo SCARICO del produttore riporta la quantità di partenza e il peso verificato a destino resta sul FIR come esito. Il CARICO del destinatario riporta il peso a destino.
- **C-W-02 numerazione:** progressivo iniziale configurabile per azienda e anno, impostato una sola volta e tracciato nel log.
- **C-W-03 più movimenti dallo stesso FIR:** "vedi cosa fa WinWaste e adegua". Ricostruzione in corso (`C-W-03-winwaste.md`).
- **A-W-10 MUD non dovuto:** flag per azienda, come il flag MUD S/N di WinWaste. Lo imposta un amministratore; per quell'azienda non partono promemoria né scadenze.
- **C-W-03, applicazione** (sulla base di `C-W-03-winwaste.md`). WinWaste produce più movimenti dello stesso verso da un FIR solo per i gestori: le quote dei produttori percentuali e gli spurghi multiluogo. Sui doppioni dà solo un avviso. In Fase 0 si adegua lo schema e non si costruiscono ancora i flussi dei gestori:
  - colonna `ricopia_chiave`, default `''`, aggiunta al vincolo unico;
  - per i produttori il comportamento resta invariato;
  - il MUD deduplica dentro la stessa chiave.
