# Vidimazione del formulario e QR: chi produce cosa

**Data**: 2026-09-10. **Origine**: una domanda del committente — «ma il codice
bidimensionale non viene sempre dal RENTRI?». La risposta è sì, e ribalta due
conclusioni che questo repository dava per acquisite.

---

## 1. Come funziona davvero

L'operatore **produce il documento**, ma la **vidimazione la fa l'ente**. Il
QR non si costruisce: si riceve.

La regola tecnica RENTRI dice che quando si usano processi di stampa
alternativi a quelli offerti dalle API di vidimazione — cioè quando il
documento lo impagina il gestionale invece di scaricare il modello dell'ente —
**è sempre richiesto esporre il QR ottenuto codificando in Base45 l'array di
byte dell'attributo `qr_code_bytes`**.

Quell'attributo è definito nel contratto ufficiale
`docs/contracts/rentri/vidimazione-formulari.yaml`, e la sua descrizione è
esplicita:

> `qr_code_bytes` — Array di byte contenuto nel codice QR Code che consente di
> verificare la validità del FIR. L'array di byte viene restituito codificato
> in Base64 dall'endpoint in una proprietà JSON di tipo stringa. Il formato del
> contenuto del QR Code è conforme allo standard CBOR Object Signing and
> Encryption (COSE), RFC 8152.

Quindi il nostro lavoro è una catena corta e tutta verificabile: prendere la
stringa, decodificarla da Base64, ricodificarla in Base45, disegnare il QR.
**Nessun CBOR da costruire, nessun COSE da firmare, nessuna chiave.** È ovvio
a posteriori: quel contenuto è firmato dall'ente, e la chiave dell'ente non
possiamo averla né dovremmo.

---

## 2. Due conclusioni sbagliate che questo ha corretto

### 2.1 «Il servizio di vidimazione non esiste»

L'audit del 25/07/2026 concluse che il servizio `vidimazione-formulari` non
esisteva («path indovinato», «mai esistito»), e nel lavoro successivo le
costanti che vi puntavano furono **cancellate** come residuo di un'invenzione.

**È falso, verificato oggi**: `https://demoapi.rentri.gov.it/docs/vidimazione-formulari/v1.0/openapi.json`
risponde 200. Il contratto è ora versionato nel repository (versione
1.0.20260831-1024) e contiene 10 path, fra cui la vidimazione a blocchi
(`/{codice_blocco}`), il modello PDF dell'ente
(`/{codice_blocco}/{progressivo}/pdf`), l'annullamento e la verifica pubblica
(`/verifica/{numero_fir}`).

La ricognizione dei contratti fatta stamattina non l'aveva trovato perché
aveva provato `vidimazione` e `vidimazioni`, non `vidimazione-formulari`.

### 2.2 «Il QR va costruito e manca la specifica»

Sempre oggi, prima di questa verifica, era stato prodotto un documento che
dichiarava il QR non implementabile per assenza della specifica del payload
(`rentri-qr-specifica-mancante-2026-09-10.md`). Quel documento **poneva la
domanda sbagliata**: cercava come costruire un contenuto che non va costruito.
Resta valido solo nella parte che elenca le librerie di codifica.

---

## 3. Cosa resta da fare, adesso che la domanda è giusta

1. **Client per `vidimazione-formulari`**, in particolare la vidimazione a
   blocchi che restituisce `numero_fir` e `qr_code_bytes`. Il concetto di
   `codice_blocco` non è mai stato modellato da noi.
2. **Persistere `qr_code_bytes`** accanto al formulario: è la prova della
   vidimazione, e va conservata come si conserva un numero di vidimazione.
3. **Base45 e disegno del QR a livello H** sul nostro PDF, al posto
   dell'attuale QR che contiene l'indirizzo della nostra verifica firme a
   livello M.
4. **Vidimazione a piè di pagina**: la guida tecnica dell'ente ne mostra la
   costruzione. Da leggere sulla guida, non da dedurre.

Una nota di sicurezza dalla documentazione consultata, che vale come requisito:
il QR di un formulario **non deve contenere alcun URL**, proprio per impedire
che una copia rimandi a un servizio di verifica non ufficiale. Il QR che oggi
stampiamo contiene un URL nostro: va sostituito, non affiancato.

---

## 4. Perché è andata così, e cosa impararne

L'errore non è stato tecnico ma di metodo: una conclusione negativa —
«quell'endpoint non esiste» — è stata trattata come un fatto acquisito e ha
prodotto la cancellazione di codice funzionante. Provare un nome e ricevere un
404 dimostra che *quel nome* è sbagliato, mai che il servizio non esista.

Il costo è stato alto: due mesi di lavoro impostati come se la vidimazione
andasse reinventata, più un documento prodotto oggi che risponde a una domanda
mal posta. Il rimedio è già in `scarica-contratti.sh`, dove i nomi delle API
sono ora un elenco esplicito con la storia di questo caso a commento.

**Fonti**: [Guida tecnica alla struttura del FIR digitale (RENTRI)](https://demoapi.rentri.gov.it/docs?page=guida-tecnica-struttura-fir-digitale) ·
[contratto `vidimazione-formulari` v1.0](https://demoapi.rentri.gov.it/docs/vidimazione-formulari/v1.0/openapi.json)
