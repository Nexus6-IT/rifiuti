# Ricevuta di ritiro con firma su schermo (app campo, P6)

Traccia tecnica per il consulente legale e privacy. Non e' un parere legale.

## Che cos'e' (e che cosa non e')

- Il cliente firma con il dito sullo schermo dell'autista. L'app salva **l'immagine del tratto**, il
  **nome** di chi firma e l'**ora del telefono**. Il server aggiunge i dati del ritiro letti dal
  database (mai dal telefono), genera il **PDF** e ne conserva l'**impronta SHA-256**.
- E' una **firma elettronica semplice**: prova commerciale (contestazioni su colli, orari,
  quantita). **Non** e' una firma elettronica avanzata o qualificata. **Non sostituisce il FIR**:
  la dicitura sta nel PDF, nell'app dell'autista e nella pagina d'ufficio.
- La quantita stampata e' quella **presunta** del ritiro, non una pesata.

## Che cosa viene conservato

| Dato | Dove | Perche |
|--|--|--|
| Immagine della firma (PNG, max 128 KiB) | `ricevute_ritiro.firma_png` (append-only) | prova della firma |
| Nome di chi firma | `ricevute_ritiro.firmatario_nome` | identifica il firmatario sul PDF |
| Ora della firma (orologio del telefono) e ora di ricezione (server) | `firmato_il`, `ricevuto_il` | l'orologio del telefono e indicativo, non e data legale |
| PDF, impronta SHA-256 del PDF, impronta del contenuto firmato, impronta della firma | `pdf`, `pdf_sha256`, `contenuto_sha256`, `firma_sha256` | integrita e verifica: il download ricalcola l'impronta e rifiuta un file alterato |
| Esito dell'invio al cliente e indirizzo **mascherato** (`m***@dominio.it`) | `invii_ricevuta_ritiro` | l'ufficio sa se la copia e partita; l'indirizzo intero **non** si conserva |

Le righe non si modificano ne si cancellano (trigger anche per il proprietario): la cancellazione
a norma GDPR di una singola ricevuta richiede una procedura dedicata, **non ancora prevista**.
Sul telefono la firma e l'eventuale email restano solo finche la ricevuta non e arrivata al server,
poi vengono azzerate.

## Invio al cliente (facoltativo, spento per default)

Si accende con `CAMPO_RICEVUTE_INVIO_EMAIL=true` e usa il servizio posta gia presente
(`EmailService`, variabili SMTP esistenti): nessuna nuova configurazione obbligatoria. Con la
variabile assente, o con il servizio posta in modalita sviluppo, l'app non mostra nemmeno il campo
email. Nel log non finiscono indirizzo, testo ne errori SMTP, solo «Email riservata spedita /
non spedita».

## Punti aperti per il consulente

- Valore probatorio della firma semplice nei rapporti B2B del cliente: va bene la dicitura attuale?
- Informativa al firmatario (oggi l'app lo avvisa dello scopo; manca un testo di informativa
  completo ex art. 13 GDPR da mostrare o consegnare).
- Tempo di conservazione e procedura di cancellazione di una ricevuta (oggi: nessuna scadenza).
- Il nome del firmatario e un dato personale e compare nel PDF e nell'archivio d'ufficio.

## Ritiro cambiato mentre il telefono era offline

Se il ritiro e stato riassegnato, annullato o chiuso prima che la ricevuta arrivasse, il server la
**archivia lo stesso** con `esito = DA_RICONCILIARE` e il motivo (`motivo_conflitto`): la firma di un
ritiro avvenuto davvero non si perde e l'ufficio la riconcilia (segno visibile nell'archivio). La
ricevuta riporta l'autista che ha firmato, non quello oggi sul ritiro, e l'email al cliente non parte.
Restano rifiuti: ritiro di un'altra azienda o inesistente (404), utente non autista (403), tetto di
5 ricevute per ritiro (409). Sul telefono la firma si conserva anche dopo un rifiuto, finche
l'autista non scarta a mano.

La firma PNG si verifica e si **ricodifica lato server** prima del PDF (solo 8 bit RGB/RGBA, non
interlacciato; CRC, zlib con tetto, filtri validi): al PDF arriva solo il PNG rigenerato.
