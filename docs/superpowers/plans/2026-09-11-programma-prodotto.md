# Programma di prodotto — ordine di lavoro e ragioni

> Questo NON è un piano eseguibile: è il documento che ordina i piani e dice
> perché in quest'ordine. Ogni voce con un piano proprio rimanda al file; le
> altre vanno pianificate prima di essere eseguite, non improvvisate.

**Origine**: confronto coi concorrenti del 2026-09-11
(`docs/audits/concorrenti-sintesi-2026-09-11.md`) e decisione del committente:
priorità a cruscotto e scadenzario, automatizzare dove possibile per ridurre il
lavoro all'utente.

---

## 1. Il principio che ordina tutto

Dal confronto: **il nostro punto debole non è la conformità, è il gestionale
intorno.** Un cliente non ci scarta per il RENTRI, ci scarta perché non trova
lo scadenzario e il cruscotto che si aspetta ovunque.

Quindi l'ordine non è «prima le cose difficili» ma **prima le cose che fanno
scartare il prodotto**.

Secondo criterio, dal committente: **ogni funzione deve togliere lavoro
all'utente, non aggiungerne.** Una schermata che mostra un dato che l'utente
doveva già sapere non vale niente; un avviso che arriva prima che il problema
diventi un danno sì.

---

## 2. Ordine di lavoro

| #   | Cosa                                             | Perché adesso                                                                                                                          | Piano                                 |
| --- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | **Scadenzario con avvisi**                       | Divario più grave, ed è **quasi fatto**: due cron registrati col corpo vuoto aspettano da mesi. Dato per scontato da tutto il mercato. | `2026-09-11-scadenzario.md`           |
| 2   | **Cruscotto**                                    | Seconda cosa che tutti hanno e noi no. Si appoggia ai dati dello scadenzario, quindi viene dopo.                                       | `2026-09-11-cruscotto.md`             |
| 3   | **Collegare i client RENTRI**                    | Conformità che l'utente non può usare non conta. La vidimazione è già fatta (R6); restano registro, copie, trasmissioni, xFIR.         | da pianificare                        |
| 4   | **Firma remota vera**                            | Unica area dove il mercato ci supera su qualcosa di sostanziale. **Dipende dall'accreditamento**, che non dipende da noi.              | da pianificare, dopo l'accreditamento |
| 5   | **Conservazione a norma**                        | Necessaria per non essere scartati, ma è un servizio esterno: prima una decisione contrattuale, poi il codice.                         | decisione, poi piano                  |
| 6   | **Operatività quotidiana** (ritiri, giri, mezzi) | Grande, e ci porta su un segmento affollato dove siamo deboli. Dopo le altre.                                                          | da pianificare                        |

**Fuori ordine, da fare quando capita**: la normalizzazione del numero Albo
(difetto noto, `mappa-parti.ts`) è mezz'ora ed è dentro il piano 1 come
sotto-attività, perché è lo stesso tipo di lavoro: togliere all'utente un
errore che non dovrebbe vedere.

---

## 3. Cosa NON facciamo, e perché

- **Non inseguiamo il produttore singolo.** È il segmento affollato: tutti
  vendono lo stesso messaggio e hanno anni di clienti. Il gruppo societario
  madre-figlie è scoperto da tutti i concorrenti esaminati e lo sappiamo già
  fare.
- **Non costruiamo mobile/campo adesso.** Il mercato è debole lì, ma è un
  prodotto a sé e non ci fa scartare oggi.
- **Non ricostruiamo il QR** né la creazione dei blocchi: il primo lo produce
  l'ente, la seconda non ha API. Già accertato.

---

## 4. Dove miglioriamo i concorrenti, concretamente

Ciascuna di queste è documentata nel confronto come cosa che nessuno fa, o fa
male. Vanno dentro i piani, non lasciate come buoni propositi.

1. **Avvisare prima, non dopo.** Tutti i fornitori esaminati scoprono
   l'indisponibilità del numero al salvataggio del formulario già compilato.
   Noi controlliamo all'apertura (già fatto in R6). Lo stesso principio va
   applicato allo scadenzario: un'autorizzazione scaduta va segnalata **quando
   si sceglie quel destinatario**, non quando l'ente rifiuta la trasmissione.
2. **Normalizzare invece di rifiutare.** Il numero Albo a sei cifre è l'esempio
   noto. Regola generale: se sappiamo cosa intendeva l'utente, correggiamo e
   glielo diciamo; rifiutiamo solo quando è davvero ambiguo.
3. **Modalità di continuità.** Il portale dell'ente è caduto il giorno della
   scadenza obbligatoria e ci è rimasto due mesi. Nessuno documenta una
   gestione di quel caso. Noi abbiamo già la scorta di numeri vidimati; il
   passo successivo è rilevare l'indisponibilità e guidare il passaggio
   assistito al cartaceo previsto dalla norma.
4. **Non far sparire le cose.** I blocchi disattivati si mostrano attenuati,
   non si nascondono (già fatto in R6). Stesso principio per le autorizzazioni
   scadute e i documenti archiviati.

---

## 5. Automazione — il criterio

Il committente chiede di automatizzare per ridurre il lavoro all'utente. Il
criterio che applichiamo nei piani:

**Automatizzare quando il sistema sa la risposta meglio dell'utente.** Il
rifornimento della scorta, la normalizzazione di un formato, il calcolo di una
scadenza dalla data di rilascio: il sistema lo sa.

**Non automatizzare quando la risposta cambia il significato di un dato
trasmesso a un ente pubblico.** La provenienza del rifiuto, lo stato fisico, il
blocco su cui vidimare quando ce n'è più d'uno: lì si chiede, o si usa un
valore configurato una volta e dichiarato.

Ogni automazione deve essere **visibile e reversibile**: l'utente deve poter
vedere che il sistema ha deciso per lui, e poter cambiare la decisione.
