/**
 * Confronto PURO fra l'annotazione locale tradotta e la registrazione letta da RENTRI (D11).
 *
 * Serve a decidere se un numero (anno, progressivo) trovato su RENTRI e' proprio la nostra
 * annotazione incerta. Prudente: ogni dato mancante o diverso vale "non uguale". Ordinaria: numero, EER, quantita, unita, causale.
 * Rettifica/annullamento: numero e `numero_registrazione_rettifica` (la registrazione variata).
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

function rifiutoUguale(corpo: Oggetto, rifiutoRentri: Oggetto): boolean {
  const rifiutoLocale = oggetto(corpo.rifiuto)
  if (!rifiutoLocale || rifiutoLocale.codice_eer !== rifiutoRentri.codice_eer) return false
  const qLocale = oggetto(rifiutoLocale.quantita)
  const qRentri = oggetto(rifiutoRentri.quantita)
  return (
    !!qLocale &&
    !!qRentri &&
    typeof qLocale.valore === 'number' &&
    typeof qRentri.valore === 'number' &&
    qLocale.unita_misura === qRentri.unita_misura &&
    Math.abs(qLocale.valore - qRentri.valore) <= TOLLERANZA_QUANTITA
  )
}

export function confrontaConRentri(
  corpo: Oggetto,
  tipo: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO',
  dettaglio: MovimentoDettaglioModel
): { uguale: boolean; identificativo: string | null; nonConfrontabile?: true } {
  const riferimentiRentri = oggetto(dettaglio.riferimenti)
  const numeroRentri = numeroDi(riferimentiRentri?.numero_registrazione)
  const nonUguale = { uguale: false, identificativo: null }
  // Manca un dato che RENTRI avrebbe dovuto dare: non si sa se sia la stessa registrazione.
  const nonConfrontabile = { uguale: false, identificativo: null, nonConfrontabile: true as const }

  const riferimentiLocali = oggetto(corpo.riferimenti)
  const numeroLocale = numeroDi(
    tipo === 'ANNULLAMENTO' ? corpo.numero_registrazione : riferimentiLocali?.numero_registrazione
  )
  if (!numeroRentri) return nonConfrontabile
  if (
    !numeroLocale ||
    numeroRentri.anno !== numeroLocale.anno ||
    numeroRentri.progressivo !== numeroLocale.progressivo
  ) {
    return nonUguale
  }

  const rifiutoRentri = oggetto(dettaglio.rifiuto)

  if (tipo === 'ANNULLAMENTO' || tipo === 'RETTIFICA') {
    // Contratto (DatiRiferimentiCompletoModel): per rettifiche e annullamenti il dettaglio porta
    // solo il numero della registrazione che ha subito la variazione, in `numero_registrazione_rettifica`.
    // Un campo mancante vale "non uguale".
    const riferitoLocale = numeroDi(
      tipo === 'ANNULLAMENTO'
        ? corpo.numero_registrazione_annullata
        : riferimentiLocali?.numero_registrazione_rettifica
    )
    const riferitoRentri = numeroDi(riferimentiRentri?.numero_registrazione_rettifica)
    if (!riferitoRentri) return nonConfrontabile
    if (
      !riferitoLocale ||
      riferitoLocale.anno !== riferitoRentri.anno ||
      riferitoLocale.progressivo !== riferitoRentri.progressivo
    ) {
      return nonUguale
    }
    // Un annullamento non ha dati del rifiuto: se ci sono, e' un'altra registrazione.
    if (tipo === 'ANNULLAMENTO' && rifiutoRentri) return nonUguale
    // Una rettifica puo' non riportarli; se ci sono devono coincidere.
    if (tipo === 'RETTIFICA' && rifiutoRentri && !rifiutoUguale(corpo, rifiutoRentri)) {
      return nonUguale
    }
  } else {
    if (!rifiutoRentri || typeof riferimentiRentri?.causale_operazione !== 'string') {
      return nonConfrontabile
    }
    if (
      !riferimentiLocali ||
      riferimentiLocali.causale_operazione !== riferimentiRentri.causale_operazione ||
      !rifiutoUguale(corpo, rifiutoRentri)
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
