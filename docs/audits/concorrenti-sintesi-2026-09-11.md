# Confronto coi concorrenti — sintesi

**Data**: 2026-09-11. **Origine**: richiesta del committente di verificare se siamo
in linea col mercato e dove possiamo fare meglio.

Sintesi di cinque indagini indipendenti, ciascuna col proprio documento e le
proprie fonti:

- `rentri-blocchi-come-fanno-gli-altri-2026-09-11.md` — vidimazione e blocchi
- `concorrenti-copertura-rentri-2026-09-11.md` — quanta norma implementano
- `concorrenti-posizionamento-2026-09-11.md` — a chi vendono e come
- `attriti-utenti-rentri-2026-09-11.md` — dove gli utenti si bloccano
- `concorrenti-funzioni-oltre-rentri-2026-09-11.md` — tutto il resto del gestionale

**Avvertenza sul metodo, che vale per ogni riga sotto.** «Non trovato» significa
che la documentazione pubblica non lo dice, **non** che manchi. Dove un fornitore
lo dichiara in una brochure ma non lo mostra in un manuale, è annotato come
dichiarato e non verificato. Il mercato è poco documentato: su circa venti nomi
esaminati, solo **sei o sette** hanno materiale operativo pubblico leggibile.

---

## 1. La risposta in tre righe

**Sulla conformità siamo in gara.** Sulle funzioni che un gestionale deve avere
per essere preso in considerazione **siamo sotto il minimo di mercato, su quattro
aree di otto**. E il segmento che nessuno presidia è esattamente quello che
abbiamo già costruito senza saperlo.

---

## 2. Dove siamo sotto il minimo che il mercato dà per scontato

Sono le cose che, se mancano, fanno scartare il prodotto **prima** che si parli
di conformità.

| Area                                          | Il mercato                      | Noi                          |
| --------------------------------------------- | ------------------------------- | ---------------------------- |
| Scadenzario autorizzazioni e Albo, con avviso | dato per scontato da tutti      | il dato c'è, **l'avviso no** |
| Conservazione a norma dei documenti           | quasi tutti, spesso a pagamento | **assente**                  |
| Operatività quotidiana (ritiri, giri, mezzi)  | presente nei prodotti maturi    | **assente**                  |
| Cruscotto e indicatori                        | presente ovunque in forma base  | **assente**                  |

La prima riga è la più fastidiosa: il dato delle scadenze lo **abbiamo già**, e
ci sono perfino due cron dello scadenzario registrati con il corpo vuoto
(vidimazioni e autorizzazioni, rilevati il 01/09 dalla pagina «Stato del
sistema»). Non è una funzione da costruire da zero: è una funzione lasciata a
metà.

---

## 3. Dove reggiamo il confronto, o siamo avanti

- **Consulenti multi-azienda**: siamo al livello dei migliori (permessi granulari
  - associazioni consulente-azienda).
- **Gruppi societari madre-figlie**: **nessun concorrente esaminato lo dichiara**.
  Il più vicino gestisce clienti indipendenti fra loro, non una gerarchia con
  piano e quote ereditati dalla radice e isolamento per singola azienda. È la
  funzione rilasciata ad agosto, e risulta essere l'unico spazio davvero
  scoperto.
- **Isolamento per azienda dimostrato su database reale**: nessuno lo documenta,
  ma è un argomento da verifica tecnica, non da brochure.

**Il contrappeso onesto**: su quel segmento non abbiamo ancora un cliente. In
produzione ci sono 8 aziende dimostrative, 10 utenti, 12 formulari. Il
posizionamento è tecnicamente plausibile e commercialmente non validato.

---

## 4. Dove il mercato è avanti a noi

1. **Firma remota dell'ente integrata nel gestionale**, con codice usa e getta
   sull'app e finestra breve. Da noi i metodi del servizio esistono nel client ma
   il fornitore di firma è un sostituto **senza valore legale**.
2. **Quarta copia** con automazioni e ripieghi espliciti per i diversi ruoli.
3. **Rettifica e annullamento del registro** trattati come funzioni di prima
   classe, con effetti tracciati.
4. **Pesatura e impianti**: un solo fornitore la copre seriamente, ma la copre.

---

## 5. Dove il mercato è fermo — le nostre occasioni

1. **Nessuno avvisa prima.** Tutti i fornitori esaminati scoprono
   l'indisponibilità del numero **al salvataggio del formulario già compilato**.
   Noi controlliamo all'apertura del form. È un vantaggio piccolo da costruire e
   grande da raccontare.
2. **Ciclo di vita completo del formulario digitale** (respingimento, sosta
   tecnica, trasbordo): documentato in dettaglio da **un solo** fornitore.
3. **MUD oltre la comunicazione base**: da due.
4. **Trasmissione dei formulari pericolosi** verificabile dall'utente, non solo
   dichiarata: da uno.
5. **Mobile e campo** con firma, foto e funzionamento senza rete: tutti deboli o
   assenti.
6. **Blocchi disattivati**: nessuno documenta come li tratta.

---

## 6. Due riscontri che cambiano qualcosa subito

### 6.1 Un difetto nostro, trovato dalla ricerca e verificato

Il numero di iscrizione all'Albo che l'ente pretende ha **sei cifre**, con gli
zeri davanti. Un trasportatore che scrive il proprio numero come lo conosce —
`MI/7490` — oggi da noi viene **rifiutato** invece che normalizzato in
`MI/007490` (`mappa-parti.ts`, `PATTERN_NUMERO_ISCRIZIONE_ALBO`). È l'errore che
le guide di settore segnalano come «banale ma bloccante», e lo riproduciamo.

**Da fare**: normalizzare invece di respingere, senza inventare cifre quando il
numero è ambiguo.

### 6.2 Il portale dell'ente è caduto il giorno della scadenza

Il 13/02/2026, data dell'obbligo, il portale RENTRI si è bloccato; ripristino
completo il 14/04/2026. Due mesi.

Questo giustifica a posteriori la decisione presa oggi sulla **scorta di numeri
vidimati in anticipo**: era stata presa per la latenza, e si rivela una difesa
contro un evento realmente accaduto. Suggerisce anche una funzione che nessuno
documenta: una **modalità di continuità** che rilevi l'indisponibilità dell'ente
e guidi il passaggio assistito al cartaceo previsto dalla norma, invece di
mostrare un errore tecnico.

---

## 7. Cosa ne ricavo, in ordine

1. **Chiudere lo scadenzario.** È il divario più grave ed è quasi fatto: il dato
   c'è, mancano gli avvisi, e due cron vuoti aspettano da mesi.
2. **Finire il collegamento dei client RENTRI.** Conformità che l'utente non può
   usare non conta.
3. **Firma remota vera.** È l'unica area dove il mercato ci supera su qualcosa di
   sostanziale, e dipende dall'accreditamento.
4. **Non inseguire il segmento affollato.** Sul produttore singolo ci sono tutti,
   con anni di clienti. Il gruppo societario è scoperto e lo sappiamo già fare.
5. **Conservazione a norma e cruscotto**: necessari per non essere scartati, ma
   dopo i primi tre.

**La conclusione scomoda**: oggi il nostro punto debole non è la conformità, è il
gestionale intorno. Un cliente che ci confronta con un concorrente maturo non ci
scarta per il RENTRI, ci scarta perché non trova lo scadenzario e il cruscotto
che si aspetta di trovare ovunque.
