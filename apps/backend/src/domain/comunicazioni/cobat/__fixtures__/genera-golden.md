# Golden COBAT sintetico

`cobat-sintetico.txt` NON e' prodotto dal serializzatore: e' scritto da uno script indipendente che
elenca, campo per campo, i valori dei due record e le lunghezze della struct `cob` di WinWaste
(`ComuCou.cs`, documento `comunicazioni-cobat.md` §5). Campi a sinistra riempiti a destra di spazi,
`quam3`/`quaton` giustificati a destra su 14; coda di 185 spazi + campagna (2) + descrizione (30) +
CRLF; Windows-1252. Ogni record e' 1409 + 219 = 1628 byte, due record = 3256 byte.
`cobat-campi.json` riporta (campo, offset 1-based, lunghezza); lo script verifica che gli inizi dei
blocchi coincidano con quelli del documento (p 179, x 415, t 584, s 820, y 1056, c 1225).

Record 1: carico da terzi, trasportatore esterno (`tipmov 6`, `causa 5`), il trasportatore e' il
soggetto di `codazi` (il destinatario siamo noi); il blocco `t` porta cognome e nome del legale
rappresentante (NERI ANNA), non la descrizione e l'ISTAT dell'unita' locale (difetto di WinWaste
`ComuCou:2388`); il nome contiene `à` (byte 0xE0).
Record 2: scarico (`tipmov 4`, `causa 3`), destinatario esterno; nessun trasportatore ne'
intermediario (blocchi di spazi); campagna `01`.
