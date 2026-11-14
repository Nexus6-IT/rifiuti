/**
 * Costanti del tracciato CONOU (oli minerali usati), formato `Movi.txt` di WinWaste 2023.
 * Ogni inferenza ha un nome, un commento `// INFERENZA (WinWaste, 14/11)` e un test che la nomina
 * (`costanti.spec.ts`): all'arrivo di un file reale si cambia in un punto solo.
 */
import type { CodificaTracciato } from '../tracciato-comunicazione'

/** Versione del tracciato: il suffisso `ww` dice che viene da WinWaste (D7). */
export const VERSIONE_CONOU = 'Movi2023-ww1'

/** Lunghezza di ogni riga, escluso il terminatore (24 campi scritti, la riserva e' omessa). */
export const LUNGHEZZA_RIGA_CONOU = 299

// INFERENZA (WinWaste, 14/11): `PrintLine` VB6 scrive nella code page ANSI di sistema.
export const CODIFICA_CONOU: CodificaTracciato = 'windows-1252'

// INFERENZA (WinWaste, 14/11): `PrintLine` termina la riga con CRLF.
export const FINE_RIGA_CONOU = '\r\n'

// INFERENZA (WinWaste, 14/11): `ComuCou_Load:1672`, nome proposto dal programma.
export const NOME_FILE_CONOU = 'Movi.txt'

// INFERENZA (WinWaste, 14/11): il vecchio tracciato fermava a 8499; il 2023 non ha limite nel codice.
// Quattro cifre (percentuale x 100): 99,99 %.
export const PERCENTUALE_OLIO_MASSIMA = 9999

// INFERENZA (WinWaste, 14/11): `tipaz = 'P'` (privato) scrive `0000` al posto dell'ATECO.
export const ATECO_PRIVATO_CONOU = '0000'

export const CONTENT_TYPE_CONOU = 'text/plain; charset=windows-1252'
