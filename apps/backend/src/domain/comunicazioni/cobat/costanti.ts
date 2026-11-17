/**
 * Costanti del tracciato COBAT (batterie), formato `Movcob.txt` di WinWaste (struct `cob`).
 * Ogni inferenza ha un nome, un commento `// INFERENZA (WinWaste, 14/11)` e un test che la nomina
 * (`costanti.spec.ts`).
 */
import type { CodificaTracciato } from '../tracciato-comunicazione'

/** Versione del tracciato: il suffisso `ww` dice che viene da WinWaste (D7). */
export const VERSIONE_COBAT = 'Movcob-ww1'

/** Record fisso (struct `cob`). */
export const LUNGHEZZA_RECORD_COBAT = 1409
/** Coda di controllo dopo ogni record: 185 spazi + 32 caratteri + CRLF. */
export const LUNGHEZZA_CODA_COBAT = 219
/** Record completo come scritto nel file. */
export const LUNGHEZZA_RECORD_COMPLETO_COBAT = LUNGHEZZA_RECORD_COBAT + LUNGHEZZA_CODA_COBAT

// INFERENZA (WinWaste, 14/11): I/O binario VB6 (`FilePut`), byte = code page ANSI di sistema.
export const CODIFICA_COBAT: CodificaTracciato = 'windows-1252'

// INFERENZA (WinWaste, 14/11): il CRLF chiude la coda di ogni record; nessun separatore fra record.
export const FINE_RIGA_COBAT = '\r\n'

// INFERENZA (WinWaste, 14/11): `ComuCou_Load:1665`, nome proposto dal programma.
export const NOME_FILE_COBAT = 'Movcob.txt'

// INFERENZA (WinWaste, 14/11): per gli anni > 2009 la coda e' 185 spazi + campagna (2) +
// descrizione (30) + CRLF. Gli anni <= 2009 (coda di 34) sono fuori ambito.
export const SPAZI_CODA_COBAT_DOPO_2009 = 185
export const ANNO_MINIMO_COBAT = 2010

// INFERENZA (WinWaste, 14/11): `progdta` ha 6 cifre; oltre 999999 il progressivo non entra.
export const PROGRESSIVO_COBAT_MASSIMO = 999_999

export const CONTENT_TYPE_COBAT = 'text/plain; charset=windows-1252'
