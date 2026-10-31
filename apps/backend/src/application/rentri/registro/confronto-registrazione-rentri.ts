/**
 * Confronto PURO fra l'annotazione locale tradotta e la registrazione letta da RENTRI (D11).
 *
 * Serve a decidere se un numero (anno, progressivo) trovato su RENTRI e' proprio la nostra
 * annotazione incerta. Prudente: ogni dato mancante o diverso vale "non uguale"; mai un si per
 * mancanza di informazioni. Confronta numero, codice EER, quantita e unita, causale; per un
 * annullamento solo il numero (il corpo non ha rifiuto).
 */
import type { MovimentoDettaglioModel } from '../../../infrastructure/rentri/rentri-registri.client'

const FORMATO_IDENTIFICATIVO_MOVIMENTO = /^M[0-9A-Z]{19}$/
const TOLLERANZA_QUANTITA = 1e-4

type Oggetto = Record<string, unknown>
const oggetto = (v: unknown): Oggetto | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Oggetto) : null

function numeroDi(v: unknown): { anno: number; progressivo: number } | null {
  const o = oggetto(v)
  if (!o || !Number.isInteger(o.anno) || !Number.isInteger(o.progressivo)) return null
  return { anno: o.anno as number, progressivo: o.progressivo as number }
}

export function confrontaConRentri(
  corpo: Oggetto,
  tipo: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO',
  dettaglio: MovimentoDettaglioModel
): { uguale: boolean; identificativo: string | null } {
  const riferimentiRentri = oggetto(dettaglio.riferimenti)
  const numeroRentri = numeroDi(riferimentiRentri?.numero_registrazione)
  const nonUguale = { uguale: false, identificativo: null }

  const riferimentiLocali = oggetto(corpo.riferimenti)
  const numeroLocale = numeroDi(
    tipo === 'ANNULLAMENTO' ? corpo.numero_registrazione : riferimentiLocali?.numero_registrazione
  )
  if (
    !numeroRentri ||
    !numeroLocale ||
    numeroRentri.anno !== numeroLocale.anno ||
    numeroRentri.progressivo !== numeroLocale.progressivo
  ) {
    return nonUguale
  }

  if (tipo !== 'ANNULLAMENTO') {
    if (
      !riferimentiLocali ||
      riferimentiLocali.causale_operazione !== riferimentiRentri?.causale_operazione
    ) {
      return nonUguale
    }
    const rifiutoLocale = oggetto(corpo.rifiuto)
    const rifiutoRentri = oggetto(dettaglio.rifiuto)
    if (!rifiutoLocale || !rifiutoRentri) return nonUguale
    if (rifiutoLocale.codice_eer !== rifiutoRentri.codice_eer) return nonUguale
    const qLocale = oggetto(rifiutoLocale.quantita)
    const qRentri = oggetto(rifiutoRentri.quantita)
    if (
      !qLocale ||
      !qRentri ||
      typeof qLocale.valore !== 'number' ||
      typeof qRentri.valore !== 'number' ||
      qLocale.unita_misura !== qRentri.unita_misura ||
      Math.abs(qLocale.valore - qRentri.valore) > TOLLERANZA_QUANTITA
    ) {
      return nonUguale
    }
  }

  const id = oggetto(riferimentiRentri?.numero_registrazione)?.identificativo
  return {
    uguale: true,
    identificativo: typeof id === 'string' && FORMATO_IDENTIFICATIVO_MOVIMENTO.test(id) ? id : null,
  }
}
