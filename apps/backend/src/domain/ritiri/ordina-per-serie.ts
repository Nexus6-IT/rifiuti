export interface RitiroOrdinabile {
  /** 'AAAA-MM-GG' */
  dataPrevista: string
  automezzoId: string | null
  ordineGiro: number | null
  /** ISO 8601 o Date: ultimo criterio, a parità di tutto il resto. */
  creatoIl: string | Date
}

function tempo(v: string | Date): number {
  return v instanceof Date ? v.getTime() : Date.parse(v)
}

/**
 * Ordine fisso di generazione, stampa ed emissione (P7 §3.2): data, mezzo, ordine nel giro,
 * creazione. I ritiri senza mezzo vengono dopo quelli con mezzo; senza ordine nel giro, dopo
 * quelli ordinati. Stabile (a parità di chiave resta l'ordine d'ingresso) e non modifica l'input.
 */
export function ordinaPerSerie<T extends RitiroOrdinabile>(ritiri: readonly T[]): T[] {
  return ritiri
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (a.r.dataPrevista !== b.r.dataPrevista) return a.r.dataPrevista < b.r.dataPrevista ? -1 : 1
      if (a.r.automezzoId !== b.r.automezzoId) {
        if (a.r.automezzoId === null) return 1
        if (b.r.automezzoId === null) return -1
        return a.r.automezzoId < b.r.automezzoId ? -1 : 1
      }
      if (a.r.ordineGiro !== b.r.ordineGiro) {
        if (a.r.ordineGiro === null) return 1
        if (b.r.ordineGiro === null) return -1
        return a.r.ordineGiro - b.r.ordineGiro
      }
      const ta = tempo(a.r.creatoIl)
      const tb = tempo(b.r.creatoIl)
      if (ta !== tb) return ta - tb
      return a.i - b.i
    })
    .map(({ r }) => r)
}
