# Golden O.R.R. (4.9f D2)

`orr-sintetico.txt` e `orr-campi.json` si generano con `genera-golden.py`, che descrive i valori
campo per campo e **non lancia mai il serializzatore** (D15): cosi' un errore del serializzatore e
uno del documento non si coprono a vicenda.

- Offset e lunghezze (1-based) sono copiati dalla tabella §5 di
  `winwaste/docs/comunicazioni-orr-campania.md`.
- Due record da 718 byte (compreso CRLF) in Windows-1252: un file `T` (trasportatore, con `à`
  in «Società» per provare la codifica) e uno `S` (stoccaggio, senza trasporto: `d1` = 1).
- Il tracciato e' RICAVATO da WinWaste: il golden e' sintetico, non un file accettato dall'ORGR.

Rigenerare: `cd __fixtures__ && python3 genera-golden.py`.
