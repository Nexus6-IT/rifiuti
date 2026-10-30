/**
 * Giorno di calendario `YYYY-MM-DD` scritto `GG/MM/AAAA`, col solo taglio della stringa:
 * nessun `Date`, quindi nessun fuso (M5, M6). Valore vuoto o in altro formato: `-`.
 */
export function formattaGiorno(giorno: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(giorno ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '-'
}
