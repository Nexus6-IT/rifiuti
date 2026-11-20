# XSD del registro RENTRI: origine e impronte

Copiati il 2026-11-20 senza modifiche (fine riga CRLF compresi) da
`winwaste/docs/rentri/xsd/` (copia locale del 2026-10-21 degli schemi che WinWaste spedisce come
risorse `002_RENTRI-*-1.0.DLL`). **Non sono stati riconfrontati con la fonte RENTRI**: nessun
download da Internet. Riconfrontarli con quelli pubblicati sul portale RENTRI prima della produzione.
La riscrittura dello `schemaLocation` di xmldsig sul file locale avviene in memoria in
`valida-xml-registro.ts` (il file su disco resta quello originale, cosi' il `sha256` si riconfronta).

| File | Versione (dal commento nel file) | sha256 |
|------|----------------------------------|--------|
| `rentri-common-1.0.xsd` | 1.0.1 (11/09/2024, CodiceFiscale) | `def8de099428ac8108d7a5c9abcfddb6a4d02b0eb677d0a35bed85bfb7a9487c` |
| `rentri-enum-1.0.xsd` | 1.0.2 (09/01/2025) | `e150451ccbfcab8192cfdb973ab7de718c79e7403470894718ec431f36336c51` |
| `rentri-movimenti-1.0.xsd` | 1.0.3 (13/12/2024) | `2ac4882c89692244770da29275f60c1b100b0d1d1c04f3bbafafbaef79d7bac0` |
| `rentri-registri-1.0.xsd` | 1.0.1 (13/12/2024, Signature unbounded) | `f2b061bab8b1b83d80a4002d51533ef4b46dde103f6369411fa41228b672193d` |
| `xmldsig-core-schema.xsd` | W3C REC 2002-02-12 (identico a `fatturapa/xsd/`) | `35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c` |

Note:
- `Indirizzo` di `Produttore` e' di tipo astratto `IndirizzoBase`: l'istanza deve dichiarare
  `xsi:type="mov:IndirizzoItaliano"` (o `IndirizzoEstero`).
- Aggiornando un file, rifare il `sha256` qui e nella spec `valida-xml-registro.spec.ts`.
