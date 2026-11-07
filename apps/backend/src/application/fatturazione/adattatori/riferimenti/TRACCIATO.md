# Tracciato TeamSystem a record fissi (adattatore `TEAMSYSTEM`)

Tracciato ricostruito dall'analisi in sola lettura dell'export TeamSystem di WinWaste.NET. **Non verificato su un'installazione reale** (decisione 15): prima del rilascio serve una prova d'import su un TeamSystem di un cliente.

## Il file

- Due record per documento, nell'ordine: record 1 (tipo `0`, testata, IVA, ricavi) e record 2 (tipo `1`, scadenze, CIG e CUP).
- Ogni record e lungo 7001 caratteri (costante `LUNGHEZZA_RECORD`; la specifica ufficiale potrebbe dire 7000), seguito da CR LF.
- Codifica Windows-1252 senza BOM. L'adattatore normalizza il testo in ASCII, cosi nessun carattere occupa piu di un byte e le colonne non si spostano.
- Nome del file: sigla dell'azienda (primi 4 caratteri della denominazione del cedente, `TFRAW` se vuota) + `GGMM` della prima e dell'ultima data dei documenti, senza estensione.

## Regole di composizione dei campi

- **AN**: si tronca alla lunghezza e si riempie a destra con spazi.
- **NU**: solo cifre, riempite a sinistra con zeri. Un valore piu lungo del campo e un errore (nessun troncamento silenzioso).
- **Importi con segno**: centesimi interi; il segno (`+` o `-`) e l'**ultimo carattere** del campo, le cifre occupano le posizioni precedenti. `-12345` in 12 posizioni diventa `00000012345-`.
- **Totali con 3 decimali** (`EC_TOT_DOC_VAL`, `EC_TOT_IVA_VAL`): parte intera su 13 cifre e parte decimale su 3, senza separatore.
- **Date**: GGMMAAAA.
- Un campo non valorizzato resta al riempimento del suo tipo.

## Segno e nota di credito (TD04)

- Il TD04 usa la causale `002` («NOTA CREDITO EM»), la fattura `001`. Gli importi di imponibile, imposta e ricavi hanno il segno dell'importo del documento (positivi in una nota di credito normale); il totale fattura e sempre positivo.
- Le rate di una nota di credito hanno sempre segno `-`, quelle di una fattura `+`.
- Limiti: 8 riepiloghi IVA, 8 conti di ricavo, 12 rate per documento; oltre, l'export risponde con un errore.

## Record 1 (tipo 0)

| Pos. | Lung. | Campo                      | Tipo | Occorrenze    | Contenuto                                                                                              |
| ---- | ----- | -------------------------- | ---- | ------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | 5     | `TRF_DITTA`                | NU   | 1             | codice ditta, costante `CODICE_DITTA` (non configurabile)                                              |
| 6    | 1     | `TRF_VERSIONE`             | NU   | 1             | costante `3`                                                                                           |
| 7    | 1     | `TRF_TARC`                 | NU   | 1             | costante `0` (tipo record: testata)                                                                    |
| 8    | 5     | `TRF_COD_CLIFOR`           | NU   | 1             | mappatura `CLIENTE` (codice del cliente nel gestionale, 5 cifre)                                       |
| 13   | 32    | `TRF_RASO`                 | AN   | 1             | denominazione del cessionario; persona fisica: `cognome nome`                                          |
| 45   | 30    | `TRF_IND`                  | AN   | 1             | indirizzo della sede del cessionario                                                                   |
| 75   | 5     | `TRF_CAP`                  | NU   | 1             | CAP (solo cifre)                                                                                       |
| 80   | 25    | `TRF_CITTA`                | AN   | 1             | comune                                                                                                 |
| 105  | 2     | `TRF_PROV`                 | AN   | 1             | provincia                                                                                              |
| 107  | 16    | `TRF_COFI`                 | AN   | 1             | codice fiscale del cessionario                                                                         |
| 123  | 11    | `TRF_PIVA`                 | NU   | 1             | partita IVA del cessionario (solo cifre; zeri se assente)                                              |
| 134  | 1     | `TRF_PF`                   | AN   | 1             | `S` se persona fisica (nome e cognome), altrimenti `N`                                                 |
| 135  | 2     | `TRF_DIVIDE`               | NU   | 1             | non valorizzato: zeri                                                                                  |
| 137  | 4     | `TRF_PAESE`                | NU   | 1             | non valorizzato: zeri                                                                                  |
| 141  | 12    | `TRF_PIVA_ESTERO`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 153  | 20    | `TRF_COFI_ESTERO`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 173  | 1     | `TRF_SESSO`                | AN   | 1             | costante `*`                                                                                           |
| 174  | 8     | `TRF_DTNAS`                | NU   | 1             | non valorizzato: zeri                                                                                  |
| 182  | 25    | `TRF_COMNA`                | AN   | 1             | non valorizzato: spazi                                                                                 |
| 207  | 2     | `TRF_PRVNA`                | AN   | 1             | non valorizzato: spazi                                                                                 |
| 209  | 4     | `TRF_PREF`                 | AN   | 1             | non valorizzato: spazi                                                                                 |
| 213  | 20    | `TRF_NTELE_NUM`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 233  | 4     | `TRF_FAX_PREF`             | AN   | 1             | non valorizzato: spazi                                                                                 |
| 237  | 9     | `TRF_FAX_NUM`              | AN   | 1             | non valorizzato: spazi                                                                                 |
| 246  | 7     | `TRF_CFCONTO`              | NU   | 1             | non valorizzato: zeri                                                                                  |
| 253  | 4     | `TRF_CFCODPAG`             | NU   | 1             | mappatura `PAGAMENTO` (condizione di pagamento del gestionale, 4 cifre)                                |
| 257  | 5     | `TRF_CFBANCA`              | NU   | 1             | ABI della prima rata (zeri se assente)                                                                 |
| 262  | 5     | `TRF_CFAGENZIA`            | NU   | 1             | CAB della prima rata (zeri se assente)                                                                 |
| 267  | 1     | `TRF_CFINTERM`             | NU   | 1             | non valorizzato: zeri                                                                                  |
| 268  | 3     | `TRF_CAUSALE`              | NU   | 1             | `001` fattura (TD01, TD24), `002` nota di credito (TD04)                                               |
| 271  | 15    | `TRF_CAU_DES`              | AN   | 1             | `FATTURA VENDITA` oppure `NOTA CREDITO EM`                                                             |
| 286  | 18    | `TRF_CAU_AGG`              | AN   | 1             | non valorizzato: spazi                                                                                 |
| 304  | 34    | `TRF_CAU_AGG_1`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 338  | 34    | `TRF_CAU_AGG_2`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 372  | 8     | `TRF_DATA_REGISTRAZIONE`   | NU   | 1             | data del documento, GGMMAAAA (WasteFlow non ha una data di registrazione separata)                     |
| 380  | 8     | `TRF_DATA_DOC`             | NU   | 1             | data del documento, GGMMAAAA                                                                           |
| 388  | 8     | `TRF_NUM_DOC_FOR`          | NU   | 1             | non valorizzato: zeri                                                                                  |
| 396  | 5     | `TRF_NDOC`                 | NU   | 1             | numero del documento, 5 cifre                                                                          |
| 401  | 2     | `TRF_SERIE`                | NU   | 1             | mappatura `REGISTRO` (serie del gestionale, 2 cifre)                                                   |
| 403  | 6     | `TRF_EC_PARTITA`           | NU   | 1             | non valorizzato: zeri                                                                                  |
| 409  | 4     | `TRF_EC_PARTITA_ANNO`      | NU   | 1             | non valorizzato: zeri                                                                                  |
| 413  | 3     | `TRF_EC_COD_VAL`           | NU   | 1             | non valorizzato: zeri                                                                                  |
| 416  | 13    | `TRF_EC_CAMBIO`            | NU   | 1             | non valorizzato: zeri (7 cifre intere + 6 decimali)                                                    |
| 429  | 8     | `TRF_EC_DATA_CAMBIO`       | NU   | 1             | non valorizzato: zeri                                                                                  |
| 437  | 16    | `TRF_EC_TOT_DOC_VAL`       | NU   | 1             | totale del documento: 13 cifre intere e 3 decimali, senza separatore (`1234.56` diventa `…1234560`)    |
| 453  | 16    | `TRF_EC_TOT_IVA_VAL`       | NU   | 1             | totale IVA, stesso formato                                                                             |
| 469  | 6     | `TRF_PLAFOND`              | NU   | 1             | non valorizzato: zeri                                                                                  |
| 475  | 12    | `TRF_IMPONIB`              | NU   | x8, passo 31  | imponibile di ogni riepilogo IVA, in centesimi, segno come ultimo carattere; slot vuoto `00000000000+` |
| 487  | 3     | `TRF_ALIQ`                 | NU   | x8, passo 31  | mappatura `CODICE_IVA` (3 cifre); slot vuoto `000`                                                     |
| 490  | 3     | `TRF_ALIQ_AGRICOLA`        | NU   | x8, passo 31  | non valorizzato: zeri                                                                                  |
| 493  | 2     | `TRF_IVA11`                | NU   | x8, passo 31  | non valorizzato: zeri                                                                                  |
| 495  | 11    | `TRF_IMPOSTA`              | NU   | x8, passo 31  | imposta di ogni riepilogo IVA, in centesimi, segno finale; slot vuoto `0000000000+`                    |
| 723  | 12    | `TRF_TOT_FATT`             | NU   | 1             | totale documento in centesimi, sempre positivo (anche per la nota di credito)                          |
| 735  | 7     | `TRF_CONTO_RIC`            | NU   | x8, passo 19  | mappatura `CONTO_RICAVI` (7 cifre), un conto per slot; slot vuoto `0000000`                            |
| 742  | 12    | `TRF_IMP_RIC`              | NU   | x8, passo 19  | somma dei prezzi totali delle righe del conto, in centesimi, segno finale; slot vuoto `00000000000+`   |
| 887  | 3     | `TRF_CAU_PAGAM`            | NU   | 1             | non valorizzato: zeri                                                                                  |
| 890  | 15    | `TRF_CAU_DES_PAGAM`        | AN   | 1             | non valorizzato: spazi                                                                                 |
| 905  | 34    | `TRF_CAU_AGG_1_PAGAM`      | AN   | 1             | non valorizzato: spazi                                                                                 |
| 939  | 34    | `TRF_CAU_AGG_2_PAGAM`      | AN   | 1             | non valorizzato: spazi                                                                                 |
| 973  | 7     | `TRF_CONTO`                | NU   | x80, passo 64 | non valorizzato: zeri                                                                                  |
| 980  | 1     | `TRF_DA`                   | AN   | x80, passo 64 | non valorizzato: spazi                                                                                 |
| 981  | 12    | `TRF_IMPORTO`              | NU   | x80, passo 64 | sempre `00000000000+` (80 slot)                                                                        |
| 993  | 18    | `TRF_CAU_AGGIUNT`          | AN   | x80, passo 64 | non valorizzato: spazi                                                                                 |
| 1011 | 6     | `TRF_EC_PARTITA_PAG`       | NU   | x80, passo 64 | non valorizzato: zeri                                                                                  |
| 1017 | 4     | `TRF_EC_PARTITA_ANNO_PAG`  | NU   | x80, passo 64 | non valorizzato: zeri                                                                                  |
| 1021 | 16    | `TRF_EC_IMP_VAL`           | NU   | x80, passo 64 | sempre `000000000000000+` (80 slot)                                                                    |
| 6093 | 1     | `TRF_RIFER_TAB`            | AN   | x10, passo 19 | non valorizzato: spazi                                                                                 |
| 6094 | 2     | `TRF_IND_RIGA`             | NU   | x10, passo 19 | non valorizzato: zeri                                                                                  |
| 6096 | 8     | `TRF_DT_INI`               | NU   | x10, passo 19 | non valorizzato: zeri                                                                                  |
| 6104 | 8     | `TRF_DT_FIN`               | NU   | x10, passo 19 | non valorizzato: zeri                                                                                  |
| 6283 | 6     | `TRF_DOC6`                 | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6289 | 1     | `TRF_AN_OMONIMI`           | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6290 | 1     | `TRF_AN_TIPO_SOGG`         | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6291 | 2     | `TRF_EC_PARTITA_SEZ_PAG`   | NU   | x80, passo 2  | non valorizzato: zeri                                                                                  |
| 6451 | 7     | `TRF_NUM_DOC_PAG_PROF`     | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6458 | 8     | `TRF_DATA_DOC_PAG_PROF`    | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6466 | 12    | `TRF_RIT_ACC`              | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6478 | 12    | `TRF_RIT_PREV`             | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6490 | 12    | `TRF_RIT_1`                | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6502 | 12    | `TRF_RIT_2`                | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6514 | 12    | `TRF_RIT_3`                | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6526 | 12    | `TRF_RIT_4`                | NU   | 1             | sempre `00000000000+`                                                                                  |
| 6538 | 2     | `TRF_UNITA_RICAVI`         | NU   | x8, passo 2   | non valorizzato: zeri                                                                                  |
| 6554 | 2     | `TRF_UNITA_PAGAM`          | NU   | x80, passo 2  | non valorizzato: zeri                                                                                  |
| 6714 | 4     | `TRF_FAX_PREF_1`           | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6718 | 20    | `TRF_FAX_NUM_1`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6738 | 1     | `TRF_SOLO_CLIFOR`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6739 | 1     | `TRF_80_SEGUENTE`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6740 | 7     | `TRF_CONTO_RIT_ACC`        | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6747 | 7     | `TRF_CONTO_RIT_PREV`       | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6754 | 7     | `TRF_CONTO_RIT_1`          | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6761 | 7     | `TRF_CONTO_RIT_2`          | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6768 | 7     | `TRF_CONTO_RIT_3`          | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6775 | 7     | `TRF_CONTO_RIT_4`          | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6782 | 1     | `TRF_DIFFERIMENTO_IVA`     | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6783 | 1     | `TRF_STORICO`              | AN   | 1             | costante `N`                                                                                           |
| 6784 | 8     | `TRF_STORICO_DATA`         | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6792 | 3     | `TRF_CAUS_ORI`             | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6795 | 1     | `TRF_PREV_TIPOMOV`         | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6796 | 1     | `TRF_PREV_RATRIS`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6797 | 8     | `TRF_PREV_DTCOMP_INI`      | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6805 | 8     | `TRF_PREV_DTCOMP_FIN`      | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6813 | 1     | `TRF_PREV_FLAG_CONT`       | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6814 | 20    | `TRF_RIFERIMENTO`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6834 | 2     | `TRF_CAUS_PREST_ANA`       | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6836 | 1     | `TRF_EC_TIPO_PAGA`         | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6837 | 7     | `TRF_CONTO_IVA_VEN_ACQ`    | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6844 | 11    | `TRF_PIVA_VECCHIA`         | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6855 | 12    | `TRF_PIVA_ESTERO_VECCHIA`  | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6867 | 32    | `TRF_RISERVATO`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6899 | 8     | `TRF_DATA_IVA_AGVIAGGI`    | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6907 | 1     | `TRF_DATI_AGG_ANA_REC4`    | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6908 | 6     | `TRF_RIF_IVA_NOTE_CRED`    | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6914 | 1     | `TRF_RIF_IVA_ANNO_PREC`    | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6915 | 2     | `TRF_NATURA_GIURIDICA`     | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6917 | 1     | `TRF_STAMPA_ELENCO`        | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6918 | 3     | `TRF_PERC_FORF`            | NU   | x8, passo 3   | non valorizzato: zeri                                                                                  |
| 6942 | 1     | `TRF_SOLO_MOV_IVA`         | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6943 | 16    | `TRF_COFI_VECCHIO`         | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6959 | 1     | `TRF_USA_PIVA_VECCHIA`     | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6960 | 1     | `TRF_USA_PIVA_EST_VECCHIA` | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6961 | 1     | `TRF_USA_COFI_VECCHIO`     | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6962 | 1     | `TRF_ESIGIBILITA_IVA`      | NU   | 1             | `1` se un riepilogo ha esigibilita differita, `4` se scissione dei pagamenti, altrimenti `0`           |
| 6963 | 1     | `TRF_TIPO_MOV_RISCONTI`    | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6964 | 1     | `TRF_AGGIORNA_EC`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6965 | 1     | `TRF_BLACKLIST_ANAG`       | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6966 | 1     | `TRF_BLACKLIST_IVA`        | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6967 | 6     | `TRF_BLACKLIST_IVA_ANA`    | NU   | 1             | non valorizzato: zeri                                                                                  |
| 6973 | 20    | `TRF_CONTEA_ESTERO`        | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6993 | 1     | `TRF_ART21_ANAG`           | AN   | 1             | `S` se scissione dei pagamenti                                                                         |
| 6994 | 1     | `TRF_ART21_IVA`            | AN   | 1             | `S` se scissione dei pagamenti                                                                         |
| 6995 | 1     | `TRF_RIF_FATTURA`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6996 | 1     | `TRF_RISERVATO_B`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6997 | 1     | `TRF_MASTRO_CF`            | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6998 | 1     | `TRF_MOV_PRIVATO`          | AN   | 1             | non valorizzato: spazi                                                                                 |
| 6999 | 1     | `TRF_SPESE_MEDICHE`        | AN   | 1             | non valorizzato: spazi                                                                                 |
| 7000 | 2     | `FILLER2`                  | AN   | 1             | non valorizzato: spazi                                                                                 |

## Record 2 (tipo 1)

| Pos. | Lung. | Campo                     | Tipo | Occorrenze    | Contenuto                                                                                          |
| ---- | ----- | ------------------------- | ---- | ------------- | -------------------------------------------------------------------------------------------------- |
| 1    | 5     | `TRF1_DITTA`              | NU   | 1             | codice ditta                                                                                       |
| 6    | 1     | `TRF1_VERSIONE`           | NU   | 1             | costante `3`                                                                                       |
| 7    | 1     | `TRF1_TARC`               | NU   | 1             | costante `1` (tipo record: scadenze)                                                               |
| 8    | 5     | `TRF_NUM_AUTOFATT`        | NU   | 1             | non valorizzato: zeri                                                                              |
| 13   | 2     | `TRF_SERIE_AUTOFATT`      | NU   | 1             | non valorizzato: zeri                                                                              |
| 15   | 3     | `TRF_COD_VAL`             | AN   | 1             | non valorizzato: spazi                                                                             |
| 18   | 14    | `TRF_TOTVAL`              | NU   | 1             | non valorizzato: zeri (10 cifre intere + 4 decimali)                                               |
| 32   | 8     | `TRF_NOMENCLATURA`        | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 40   | 12    | `TRF_IMP_LIRE`            | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 52   | 12    | `TRF_IMP_VAL`             | NU   | x20, passo 85 | non valorizzato: zeri (10 cifre intere + 2 decimali)                                               |
| 64   | 1     | `TRF_NATURA`              | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 65   | 12    | `TRF_MASSA`               | NU   | x20, passo 85 | non valorizzato: zeri (10 cifre intere + 2 decimali)                                               |
| 77   | 12    | `TRF_UN_SUPPL`            | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 89   | 12    | `TRF_VAL_STAT`            | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 101  | 1     | `TRF_REGIME`              | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 102  | 1     | `TRF_TRASPORTO`           | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 103  | 3     | `TRF_PAESE_PROV`          | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 106  | 3     | `TRF_PAESE_ORIG`          | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 109  | 3     | `TRF_PAESE_DEST`          | NU   | x20, passo 85 | non valorizzato: zeri                                                                              |
| 112  | 2     | `TRF_PROV_DEST`           | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 114  | 2     | `TRF_PROV_ORIG`           | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 116  | 1     | `TRF_SEGNO_RET`           | AN   | x20, passo 85 | non valorizzato: spazi                                                                             |
| 1732 | 1     | `TRF_INTRA_TIPO`          | AN   | 1             | non valorizzato: spazi                                                                             |
| 1733 | 6     | `TRF_MESE_ANNO_RIF`       | NU   | 1             | non valorizzato: zeri                                                                              |
| 1739 | 173   | `SPAZIO_1`                | AN   | 1             | non valorizzato: spazi                                                                             |
| 1912 | 1     | `TRF_RITA_TIPO`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 1913 | 11    | `TRF_RITA_IMPON`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1924 | 4     | `TRF_RITA_ALIQ`           | NU   | 1             | non valorizzato: zeri (2 cifre intere + 2 decimali)                                                |
| 1928 | 10    | `TRF_RITA_IMPRA`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1938 | 11    | `TRF_RITA_PRONS`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1949 | 6     | `TRF_RITA_MESE`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 1955 | 2     | `TRF_RITA_CAUSA`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1957 | 4     | `TRF_RITA_TRIBU`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1961 | 8     | `TRF_RITA_DTVERS`         | NU   | 1             | non valorizzato: zeri                                                                              |
| 1969 | 11    | `TRF_RITA_IMPAG`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 1980 | 1     | `TRF_RITA_TPAG`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 1981 | 4     | `TRF_RITA_SERIE`          | AN   | 1             | non valorizzato: spazi                                                                             |
| 1985 | 12    | `TRF_RITA_QUIETANZA`      | AN   | 1             | non valorizzato: spazi                                                                             |
| 1997 | 12    | `TRF_RITA_NUM_BOLL`       | AN   | 1             | non valorizzato: spazi                                                                             |
| 2009 | 5     | `TRF_RITA_ABI`            | NU   | 1             | non valorizzato: zeri                                                                              |
| 2014 | 5     | `TRF_RITA_CAB`            | NU   | 1             | non valorizzato: zeri                                                                              |
| 2019 | 4     | `TRF_RITA_AACOMP`         | NU   | 1             | non valorizzato: zeri                                                                              |
| 2023 | 11    | `TRF_RITA_CRED`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 2034 | 1     | `TRF_RITA_SOGG`           | AN   | 1             | non valorizzato: spazi                                                                             |
| 2035 | 11    | `TRF_RITA_BASEIMP`        | NU   | 1             | non valorizzato: zeri                                                                              |
| 2046 | 11    | `TRF_RITA_FRANCHIGIA`     | NU   | 1             | non valorizzato: zeri                                                                              |
| 2057 | 11    | `TRF_RITA_CTO_PERC`       | NU   | 1             | non valorizzato: zeri                                                                              |
| 2068 | 11    | `TRF_RITA_CTO_DITT`       | NU   | 1             | non valorizzato: zeri                                                                              |
| 2079 | 11    | `FILLER`                  | AN   | 1             | non valorizzato: spazi                                                                             |
| 2090 | 8     | `TRF_RITA_DATA`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 2098 | 11    | `TRF_RITA_TOTDOC`         | NU   | 1             | non valorizzato: zeri                                                                              |
| 2109 | 11    | `TRF_RITA_IMPVERS`        | NU   | 1             | non valorizzato: zeri                                                                              |
| 2120 | 8     | `TRF_RITA_DATA_I`         | NU   | 1             | non valorizzato: zeri                                                                              |
| 2128 | 8     | `TRF_RITA_DATA_F`         | NU   | 1             | non valorizzato: zeri                                                                              |
| 2136 | 2     | `TRF_EMENS_ATT`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 2138 | 2     | `TRF_EMENS_RAP`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 2140 | 3     | `TRF_EMENS_ASS`           | NU   | 1             | non valorizzato: zeri                                                                              |
| 2143 | 195   | `FILLER_2`                | AN   | 1             | non valorizzato: spazi                                                                             |
| 2338 | 3     | `TRF_POR_CODPAG`          | NU   | 1             | mappatura `PAGAMENTO`, 3 cifre                                                                     |
| 2341 | 5     | `TRF_POR_BANCA`           | NU   | 1             | ABI della prima rata                                                                               |
| 2346 | 5     | `TRF_POR_AGENZIA`         | NU   | 1             | CAB della prima rata                                                                               |
| 2351 | 30    | `TRF_POR_DESAGENZIA`      | AN   | 1             | istituto della prima rata                                                                          |
| 2381 | 2     | `TRF_POR_TOT_RATE`        | NU   | 1             | numero di rate (al massimo 12)                                                                     |
| 2383 | 12    | `TRF_POR_TOTDOC`          | NU   | 1             | somma delle rate in centesimi; segno `-` per la nota di credito, `+` altrimenti                    |
| 2395 | 2     | `TRF_POR_NUM_RATA`        | NU   | x12, passo 67 | progressivo della rata, da 01                                                                      |
| 2397 | 8     | `TRF_POR_DATASCAD`        | NU   | x12, passo 67 | scadenza, GGMMAAAA                                                                                 |
| 2405 | 1     | `TRF_POR_TIPOEFF`         | NU   | x12, passo 67 | `2` ricevuta bancaria (MP12), `3` altre modalita, zero se manca                                    |
| 2406 | 12    | `TRF_POR_IMPORTO_EFF`     | NU   | x12, passo 67 | importo della rata in centesimi; segno `-` per la nota di credito, `+` altrimenti; slot vuoto zeri |
| 2418 | 15    | `TRF_POR_IMPORTO_EFFVAL`  | NU   | x12, passo 67 | non valorizzato: zeri (12 cifre intere + 3 decimali)                                               |
| 2433 | 12    | `TRF_POR_IMPORTO_BOLLI`   | NU   | x12, passo 67 | non valorizzato: zeri                                                                              |
| 2445 | 15    | `TRF_POR_IMPORTO_BOLIVAL` | NU   | x12, passo 67 | non valorizzato: zeri (12 cifre intere + 3 decimali)                                               |
| 2460 | 1     | `TRF_POR_FLAG`            | AN   | x12, passo 67 | non valorizzato: spazi                                                                             |
| 2461 | 1     | `TRF_POR_TIPO_RD`         | AN   | x12, passo 67 | non valorizzato: spazi                                                                             |
| 3199 | 4     | `TRF_POR_CODAGE`          | NU   | 1             | non valorizzato: zeri                                                                              |
| 3203 | 1     | `TRF_POR_EFFETTO_SOSP`    | AN   | x12, passo 1  | non valorizzato: spazi                                                                             |
| 3215 | 15    | `TRF_POR_CIG`             | AN   | 1             | CIG del documento                                                                                  |
| 3230 | 15    | `TRF_POR_CUP`             | AN   | 1             | CUP del documento                                                                                  |
| 3245 | 294   | `SPAZIO_2`                | AN   | 1             | non valorizzato: spazi                                                                             |
| 3539 | 3     | `TRF_COD_VAL_IV`          | AN   | x20, passo 19 | non valorizzato: spazi                                                                             |
| 3542 | 16    | `TRF_IMP_VALUTA_IV`       | AN   | x20, passo 19 | non valorizzato: spazi (14 cifre intere + 2 decimali)                                              |
| 3919 | 6     | `TRF_CODICE_SERVIZIO`     | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 3925 | 3     | `TRF_STATO_PAGAMENTO`     | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3928 | 12    | `TRF_SERV_IMP_EURO`       | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3940 | 12    | `TRF_SERV_IMP_VAL`        | NU   | x20, passo 98 | non valorizzato: zeri (10 cifre intere + 2 decimali)                                               |
| 3952 | 8     | `TRF_DATA_DOC_ORIG`       | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3960 | 1     | `TRF_MOD_EROGAZIONE`      | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 3961 | 1     | `TRF_MOD_INCASSO`         | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 3962 | 6     | `TRF_PROT_REG`            | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3968 | 6     | `TRF_PROG_REG`            | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3974 | 6     | `TRF_COD_SEZ_DOG_RET`     | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3980 | 2     | `TRF_ANNO_REG_RET`        | NU   | x20, passo 98 | non valorizzato: zeri                                                                              |
| 3982 | 15    | `TRF_NUM_DOC_ORIG`        | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 3997 | 1     | `TRF_SERV_SEGNO_RET`      | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 3998 | 3     | `TRF_SERV_COD_VAL_IV`     | AN   | x20, passo 98 | non valorizzato: spazi                                                                             |
| 4001 | 16    | `TRF_SERV_IMP_VALUTA_IV`  | AN   | x20, passo 98 | non valorizzato: spazi (14 cifre intere + 2 decimali)                                              |
| 5879 | 1     | `TRF_INTRA_TIPO_SERVIZIO` | AN   | 1             | non valorizzato: spazi                                                                             |
| 5880 | 6     | `TRF_SERV_MESE_ANNO_RIF`  | NU   | 1             | non valorizzato: zeri                                                                              |
| 5886 | 8     | `SPAZIO_3`                | AN   | 1             | non valorizzato: spazi                                                                             |
| 5894 | 15    | `SPAZIO_4`                | AN   | 1             | registro e numero del documento (campo «spazio» del tracciato, che l export originale usa cosi)    |
| 5909 | 1091  | `SPAZIO_5`                | AN   | 1             | non valorizzato: spazi                                                                             |
| 7000 | 2     | `FILLER_3`                | AN   | 1             | non valorizzato: spazi                                                                             |
