# XSD FatturaPA: fonte e impronte

File scaricati il 2026-11-07 dalle fonti ufficiali e copiati senza modifiche. La riscrittura dello
`schemaLocation` di xmldsig sul file locale avviene in memoria in `valida-xsd.ts` (il file su disco
resta quello ufficiale, così il `sha256` si può riconfrontare con la fonte).

| File | Fonte | Versione | sha256 |
|------|-------|----------|--------|
| `Schema_VFPR12_v1.2.3.xsd` | https://www.fatturapa.gov.it/export/documenti/fatturapa/v1.4/Schema_VFPR12_v1.2.3.xsd (pagina «Formato FatturaPA» di fatturapa.gov.it, specifiche tecniche 1.4) | 1.2.3 | `152944f6eef9f5d69ef6e955ee173b32142b00a8c1c5222fc97dfab5910e8a8c` |
| `xmldsig-core-schema.xsd` | https://www.w3.org/TR/2002/REC-xmldsig-core-20020212/xmldsig-core-schema.xsd (W3C, `schemaLocation` dichiarato dall'XSD FatturaPA) | REC 2002-02-12 | `35cf8197da812c85e40d57891b35c94187569ed474a2dac813ce5090dafcd35c` |

Note:
- La versione 1.2.2 (`Schema_del_file_xml_FatturaPA_v1.2.2.xsd`) è ancora pubblicata ma ferma a RF19: la 1.2.3 aggiunge RF20 ed è quella che combacia con `REGIMI_FISCALI`.
- L'XSD accetta ancora le nature generiche `N2`, `N3`, `N6`: a rifiutarle è il controllo di business dello SdI, non lo schema (in dominio: `NATURE_NON_AMMESSE`).
- Aggiornando un file, rifare il `sha256` qui e nella spec `valida-xsd.spec.ts`.
