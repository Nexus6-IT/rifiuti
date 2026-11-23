# XSD del registro RENTRI: origine e impronte

Copiati il 2026-11-20 senza altre modifiche che il fine riga (originali CRLF, in git LF) da
`winwaste/docs/rentri/xsd/` (copia locale del 2026-10-21 degli schemi che WinWaste spedisce come
risorse `002_RENTRI-*-1.0.DLL`). **Non sono stati riconfrontati con la fonte RENTRI**: nessun
download da Internet. Riconfrontarli con quelli pubblicati sul portale RENTRI prima della produzione.
La riscrittura dello `schemaLocation` di xmldsig sul file locale avviene in memoria in
`valida-xml-registro.ts` (il file su disco resta quello originale, cosi' il `sha256` si riconfronta).

Il `sha256` dei quattro `rentri-*` e' calcolato sul contenuto con fine riga LF (`tr -d '\r'`).
Sugli originali CRLF (WinWaste) erano: common `def8de09...487c`, enum `e150451c...6c51`,
movimenti `2ac4882c...ac0`, registri `f2b061bb...2193d` (abbreviati, solo per riconoscerli).

| File | Versione (dal commento nel file) | sha256 |
|------|----------------------------------|--------|
| `rentri-common-1.0.xsd` | 1.0.1 (11/09/2024, CodiceFiscale) | `2cbfdaee62928b3b09d83508f1c9ecd1750d9374406de4940806b9098461063c` |
| `rentri-enum-1.0.xsd` | 1.0.2 (09/01/2025) | `0bcecee799c0eb0e2e2a4d7a70cafabaf07dcec377b79a22df84bc923cef8bfc` |
| `rentri-movimenti-1.0.xsd` | 1.0.3 (13/12/2024) | `210760de42bd9edd46dd71a9bef276cd5cbea1daf2f6297dbfd8b26a50978283` |
| `rentri-registri-1.0.xsd` | 1.0.1 (13/12/2024, Signature unbounded) | `c3ac8461738d1d3da284e3bf4c9436d4bd501acd782e31cc3e6b416a609a7807` |
| `xmldsig-core-schema.xsd` | W3C REC 2002-02-12 (identico a `fatturapa/xsd/`) | `35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c` |

Note:
- `Indirizzo` di `Produttore` e' di tipo astratto `IndirizzoBase`: l'istanza deve dichiarare
  `xsi:type="mov:IndirizzoItaliano"` (o `IndirizzoEstero`).
- Aggiornando un file, rifare il `sha256` qui e nella spec `valida-xml-registro.spec.ts`.
