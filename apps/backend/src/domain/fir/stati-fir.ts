/**
 * Stati del FIR rilevanti per il collegamento con il registro: modulo puro e unico,
 * senza dipendenze da Prisma né da Nest. Lo usano il registro (collegamento di un
 * movimento a un FIR) e la ricopia; nessun altro codice tiene un elenco proprio.
 */

/** Stati in cui il formulario è stato emesso (ha valore di documento di trasporto). */
export const STATI_FIR_EMESSI = [
  'AWAITING_CARRIER',
  'AWAITING_RECEIVER',
  'COMPLETED',
  'SYNCED_TO_RENTRI',
] as const

/** Bozze: `AWAITING_PRODUCER` è una bozza (`DB_TO_STATO` lo mappa su `BOZZA`). */
export const STATI_FIR_IN_BOZZA = ['DRAFT', 'AWAITING_PRODUCER'] as const

export const STATO_FIR_ANNULLATO = 'CANCELLED'
export const STATO_RENTRI_ANNULLATO = 'Annullato'

export interface FirPerStato {
  id: string
  status: string | null | undefined
  firNumber: string | null
  rentriNumeroFir?: string | null
  rentriStatoFormulario?: string | null
}

export type CollegabilitaFir =
  | { collegabile: true; base: 'EMESSO' | 'NUMERO_RENTRI' }
  | { collegabile: false; motivo: 'ANNULLATO' | 'BOZZA' | 'STATO_SCONOSCIUTO' }

const èUnoDi = (elenco: readonly string[], valore: string | null | undefined): boolean =>
  valore != null && elenco.includes(valore)

/** Annullato in locale oppure all'ente (stato formulario RENTRI `Annullato`). */
export function firAnnullato(f: FirPerStato): boolean {
  return f.status === STATO_FIR_ANNULLATO || f.rentriStatoFormulario === STATO_RENTRI_ANNULLATO
}

/**
 * Un movimento del registro si collega solo a un FIR emesso, oppure a una bozza
 * locale che ha già un numero RENTRI (acquisito o agganciato), e mai a un annullato.
 */
export function collegabilitaFir(f: FirPerStato): CollegabilitaFir {
  const noto =
    èUnoDi(STATI_FIR_EMESSI, f.status) ||
    èUnoDi(STATI_FIR_IN_BOZZA, f.status) ||
    f.status === STATO_FIR_ANNULLATO
  if (!noto) return { collegabile: false, motivo: 'STATO_SCONOSCIUTO' }
  if (firAnnullato(f)) return { collegabile: false, motivo: 'ANNULLATO' }
  if (èUnoDi(STATI_FIR_EMESSI, f.status)) return { collegabile: true, base: 'EMESSO' }
  if (f.rentriNumeroFir?.trim()) return { collegabile: true, base: 'NUMERO_RENTRI' }
  return { collegabile: false, motivo: 'BOZZA' }
}

/** Il numero che l'utente vede sul documento: RENTRI, poi riferimento interno, poi id abbreviato. */
export function etichettaFir(f: Pick<FirPerStato, 'id' | 'firNumber' | 'rentriNumeroFir'>): string {
  return f.rentriNumeroFir?.trim() || f.firNumber || `id ${f.id.slice(0, 8)}`
}
