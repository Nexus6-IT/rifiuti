// Conversioni fra `AAAA-MM-GG` e `Date` locale, senza passare da UTC (nessuno spostamento di fuso).

/** `AAAA-MM-GG` → `Date` a mezzanotte locale (senza passare da UTC). */
export function dataLocale(iso: string | null): Date | null {
  const m = iso === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

/** `Date` locale → `AAAA-MM-GG` (mai `toISOString`, che passa da UTC). */
export function isoLocale(d: Date): string {
  const due = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`
}
