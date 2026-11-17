/**
 * Costanti del tracciato O.R.R. Campania (4.9f). Ricavato dalla classe `Campania` di WinWaste
 * (`docs/comunicazioni-orr-campania.md`): nessuna specifica ufficiale e nessun file reale.
 * Ogni valore marcato INFERENZA va ri-verificato all'arrivo di un file accettato dall'ORGR.
 */

/** Versione del tracciato: il suffisso `ww` dice che viene da WinWaste, non da una specifica (D7). */
export const VERSIONE_ORR = 'xrec718-ww1'
export const LUNGHEZZA_RECORD_ORR = 718

// INFERENZA (WinWaste, 14/11): `FilePut`/`PrintLine` VB6 scrivono in ANSI di sistema (Windows-1252).
export const CODIFICA_ORR = 'windows-1252' as const
// INFERENZA (WinWaste, 14/11): `F1CRLF` = `\r\n` in coda a ogni record (718 byte compresi i 2 del terminatore).
export const FINE_RIGA_ORR = '\r\n'
// INFERENZA (WinWaste, 14/11): `b2 = netto x 1000`; se `netto` e' in kg il valore e' in grammi, non verificato.
export const MOLTIPLICATORE_QUANTITA_ORR = 1000

/** Mesi a due lettere del nome file, da gennaio a dicembre (`Campania:nomefile`). */
export const MESI_ORR = [
  'GE',
  'FE',
  'MR',
  'AP',
  'MG',
  'GI',
  'LU',
  'AG',
  'SE',
  'OT',
  'NO',
  'DI',
] as const

/** Attivita' del dichiarante, nell'ordine di WinWaste (`T`, `STO`, `SMA`, `REC`, `FRA`, `ROT`, `AUT`). */
export const ATTIVITA_ORR = ['TRA', 'STO', 'SMA', 'REC', 'FRA', 'ROT', 'AUT'] as const
export type AttivitaOrr = (typeof ATTIVITA_ORR)[number]

/** Lettera dell'attivita' nel nome file (`atti(j,0)` di WinWaste). */
export const LETTERA_ATTIVITA_ORR: Readonly<Record<AttivitaOrr, string>> = {
  TRA: 'T',
  STO: 'S',
  SMA: 'D',
  REC: 'R',
  FRA: 'F',
  ROT: 'M',
  AUT: 'A',
}

/** Province della Campania: sigla -> codice ISTAT a 3 cifre. */
export const PROVINCE_CAMPANIA: Readonly<Record<string, string>> = {
  CE: '061',
  BN: '062',
  NA: '063',
  AV: '064',
  SA: '065',
}
