# Golden CONOU sintetico

`conou-sintetico.txt` NON e' prodotto dal serializzatore: e' scritto da uno script indipendente
(valori campo per campo, lunghezze del documento WinWaste `comunicazioni-conou.md` §4, riempimento a
destra di spazi, Windows-1252, CRLF). `conou-campi.json` riporta (campo, offset 1-based, lunghezza)
copiati dallo stesso documento. Se serializzatore e documento divergono, uno dei tre test fallisce.

Tre righe: entrata (E), uscita (U), scarico interno con quantita' negativa (-300) e ragione sociale
con `à` (byte 0xE0 in Windows-1252).

Valori: vedi la tabella `righe` nello script sotto; ogni riga e' lunga 299 caratteri.

```python
L = [16,5,11,60,40,7,2,40,8,9,10,8,6,10,4,8,16,8,6,4,8,11,1,1]
# righe = lista di 24 valori per riga, nell'ordine del documento
# out += "".join(v.ljust(n) for v, n in zip(riga, L)).encode("cp1252") + b"\r\n"
```
