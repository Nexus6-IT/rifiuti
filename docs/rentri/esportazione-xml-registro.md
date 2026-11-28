# Esportazione XML firmata del registro RENTRI (eREGI E6-E7)

Guida operativa. Piano: `docs/superpowers/plans/2026-11-18-registro-eregi.md` (pezzi E4-E7).
Contratti e fedeltà della fake: `docs/contracts/rentri/FEDELTA.md` §10.

## Che cosa produce

Per ogni registro collegato a RENTRI, WasteFlow genera file XML `reg:Registro` con le annotazioni del
registro, li **firma** (XMLDSig, certificato RENTRI dell'azienda) e li fa **validare** da RENTRI
(`POST .../valida`). I file formano una **catena**: ogni file cita nella firma l'eREGI del registro
(primo `Reference`) e il digest dei file precedenti, e riparte dall'ultimo numero esportato.

Nome del file scaricato (come WinWaste): `REN<identificativo>_<da>_<a>_<aaaammgg>.SignedR.xml`.

Limiti per file (decisione del 21/11): **un solo anno** e al massimo **1000 annotazioni**. Il cambio
d'anno e i registri grandi producono più file consecutivi nella catena. Il primo progressivo di un
anno è il primo numero esistente (non forzato a 1: da confermare sul demo).

## Dal pannello del registro (pagina Registro, scheda RENTRI)

La sezione **Esportazioni XML del registro** compare per i registri collegati a RENTRI.

| Azione | Chi | Effetto |
|---|---|---|
| Genera esportazione | chi può trasmettere (ADMIN, OPERATOR) | genera e firma il file dal numero successivo all'ultimo esportato, poi avvia la validazione |
| Scarica XML | tutti i ruoli | scarica il file firmato salvato (non lo rigenera) |
| Riprova la validazione | chi può trasmettere | per file `GENERATA`, `IN_VALIDAZIONE`, `VALIDAZIONE_NON_DISPONIBILE` |
| Sostituisci da qui | solo ADMIN | per un file `RIFIUTATA`: la segna e le successive come `SOSTITUITA` |

Stati: `GENERATA` (firmato, validazione non ancora partita), `IN_VALIDAZIONE`, `VALIDATA`,
`VALIDATA_CON_AVVISI` (solo avvertimenti), `RIFIUTATA` (RENTRI ha segnalato errori nel file),
`VALIDAZIONE_NON_DISPONIBILE` (errore **tecnico**, mai un rifiuto: si riprova), `SOSTITUITA`.
Un file si chiama «validato» solo con `VALIDATA`/`VALIDATA_CON_AVVISI`.

Con l'interruttore degli invii spento (`RENTRI_REGISTRO_INVII_ATTIVI=false`) il file nasce ma resta
`GENERATA`: la validazione parte alla riaccensione (il job o «Riprova la validazione»).

### Se RENTRI rifiuta un file

Le esportazioni successive restano **ferme** (citerebbero il file rifiutato). Un amministratore guarda
i messaggi dell'esito (codice, tipo, campo; mai dati dell'azienda), corregge la causa nel registro
con una rettifica e preme **Sostituisci da qui**: il file rifiutato e i successivi restano in elenco
come `SOSTITUITA` (mai cancellati, nel log c'è chi ha sostituito) e il prossimo «Genera esportazione»
li rifà dall'ultimo file valido. Se la rifiutata non è la prima rifiutata della catena si sostituisce
dalla prima.

### Errori che il pannello mostra così come arrivano

- **409** registro non collegato o con la chiusura in corso; file rifiutato in catena; catena non
  coerente. In particolare: *«ci sono annotazioni precedenti non incluse in nessuna esportazione»* =
  un'annotazione con numero o anno già esportato è stata registrata dopo l'esportazione (per esempio
  un import WinWaste di un anno già esportato). **Non si ripara dal pannello**: serve l'assistenza.
- **422** certificato RENTRI mancante, o annotazioni che non producono un XML valido (nessun file salvato).
- **502** l'eREGI scaricato da RENTRI non è utilizzabile.

Un'annotazione che il programma non sa tradurre ferma l'intervallo: il file contiene le annotazioni
fino a quella (esclusa) e la notifica dice il numero e il motivo; senza annotazioni traducibili non
nasce nessun file.

Registro **chiuso** su RENTRI: l'esportazione si può ancora generare a mano (esportazione finale); il
job automatico non lo tocca.

## Job mensile automatico (E7): SPENTO

`RentriRegistroEsportazioneJob` (`apps/backend/src/infrastructure/jobs/rentri-registro-esportazione.job.ts`),
una volta al giorno alle 05:00.

**Interruttore**: `RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE`. **Spento di predefinito**: solo il testo
esatto `true` lo accende (`TRUE`, `1`, `si`, spazi restano spento). Il compose di produzione lo
imposta a `false`. In più il job non gira se gli invii del registro sono sospesi. «Genera
esportazione» dal pannello non dipende da questo interruttore. Il pannello dice se il job è acceso.

> **NON accenderlo in produzione** finché non è stata fatta la prova sull'ambiente demo RENTRI
> (piano Q6, rischi R1-R3): significato di `Ref` nella catena dei digest, canonicalizzazione (C14N)
> dell'eREGI incorporato, semantica di `Autore`/`IdentificativoTemporale`, risposta di
> `/operatore/registri`. La fake è coerente con la nostra ipotesi, ma non è RENTRI.

Cosa fa, per ogni azienda col modulo `rentri` e il certificato:

1. **Rivalida** i file senza esito (`GENERATA` con la validazione, gli altri con la rivalidazione).
2. Per ogni registro collegato, non chiuso e non in chiusura, **genera il file dei mesi già chiusi**:
   le annotazioni con data di annotazione anteriore all'inizio (00:00 a Roma) del più basso fra il
   **mese corrente** e il **mese della più vecchia annotazione non ancora confermata da RENTRI**
   (riga da trasmettere, rifiutata, non trasmissibile, incerta, in invio o in attesa dell'esito;
   senza riga se l'invio automatico la adotterà). Gli importati da riconciliare non pesano.

Prudenze: **un solo file per registro e per giro**, e solo se l'ultimo file vivo è `VALIDATA` o
`VALIDATA_CON_AVVISI` (o non ce ne sono): non si impilano anelli senza esito. Un file `RIFIUTATA`
ferma il registro e il job lo scrive nel log (livello warn, solo id tecnici) senza altro. Nessuna
chiusura del registro dal job. Niente doppioni (cursore sul progressivo e vincolo del database).
Un arretrato di molti mesi si smaltisce in un file al giorno. I log non contengono XML, digest, motivi
con dati delle annotazioni.

### Accenderlo (solo dopo la prova demo)

1. Verificare sul demo la catena di almeno 3 file (vedi FEDELTA §10).
2. In `/opt/rifiuti/.env` aggiungere `RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE=true`.
3. `docker compose --env-file /opt/rifiuti/.env -f docker-compose.prod.yml up -d backend`.
4. Il mattino dopo (05:00) controllare nel log del backend «Giro di esportazione del registro RENTRI
   completato» e che `aziendeInErrore` sia 0; `SELECT stato, count(*) FROM
   esportazioni_registro_rentri GROUP BY 1`.

Spegnerlo: togliere la riga (o metterla a `false`) e riavviare il backend; i file già generati restano.
