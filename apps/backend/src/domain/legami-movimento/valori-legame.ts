import { cascataValida, MESSAGGIO_CASCATA, normalizzaCascata } from '../listino/importi-riga'
import { MOTIVI_LEGAME, type AvvisoLegame, type MotivoLegame, type StatoLegame } from './codici'
import { puoAggiornarePrezzi } from './stato-legame'

/**
 * Valori delle righe del legame movimento (fase 4.3): motivi che impediscono la conferma,
 * validazione dei valori scritti a mano, avvisi e copia dalla riga di listino. Dominio puro.
 * I limiti seguono le colonne (`quantita` DECIMAL(14,3), `prezzo` DECIMAL(14,6)) e i CHECK
 * del database: il dominio rifiuta prima ciò che il database rifiuterebbe.
 */

export interface RigaLegameValori {
  rigaAddebitoId: string
  origine: 'PRINCIPALE' | 'PROPOSTA' | 'MANUALE'
  prezzoSpeciale: boolean
  prezzo: string | null
  sconto: string | null
  quantita: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | 'MANUALE' | null
  prezzoManuale: boolean
  codiceIvaId: string | null
}

/**
 * Motivi che le righe impediscono alla conferma. Il prezzo mancante conta solo sulle righe a
 * prezzo singolo (lo zero esplicito "0" è un prezzo valido; il prezzo speciale lo calcola la
 * 4.4). La quantità manca su ogni riga che non ne ha una. Senza duplicati, in ordine dei codici.
 */
export function motiviRighe(righe: readonly RigaLegameValori[]): MotivoLegame[] {
  const trovati = new Set<MotivoLegame>()
  for (const r of righe) {
    if (!r.prezzoSpeciale && r.prezzo === null) trovati.add('SENZA_PREZZO')
    if (r.quantita === null) trovati.add('SENZA_QUANTITA')
  }
  return MOTIVI_LEGAME.filter(m => trovati.has(m))
}

type Esito<T> = { ok: true; valore: T } | { ok: false; errore: string }

/** Numero scritto con il punto, senza segno, con interi e decimali limitati dalla colonna. */
function leggiDecimaleConPunto(
  v: unknown,
  interi: number,
  decimali: number,
  etichetta: string
): Esito<string> {
  if (typeof v !== 'string' || v === '') {
    return { ok: false, errore: `${etichetta}: indica un numero.` }
  }
  if (v.includes(',')) {
    // L'API parla con il punto: la virgola è dell'interfaccia, che la converte prima dell'invio.
    return {
      ok: false,
      errore: `${etichetta}: scrivi il numero con il punto decimale (non la virgola).`,
    }
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v)
  if (!m) return { ok: false, errore: `${etichetta}: indica un numero non negativo.` }
  // Gli zeri iniziali non sono cifre intere: si tolgono prima del controllo e dal valore salvato.
  const intero = m[1].replace(/^0+(?=\d)/, '')
  if (intero.length > interi)
    return { ok: false, errore: `${etichetta}: il numero è troppo grande.` }
  if ((m[2] ?? '').length > decimali) {
    return { ok: false, errore: `${etichetta}: al massimo ${decimali} decimali.` }
  }
  return { ok: true, valore: m[2] === undefined ? intero : `${intero}.${m[2]}` }
}

/** Quantità scritta a mano (decisione 17): stringa col punto, maggiore di zero, al massimo 3 decimali. */
export function validaQuantitaManuale(v: unknown): Esito<string> {
  const r = leggiDecimaleConPunto(v, 11, 3, 'Quantità')
  if (!r.ok) return r
  if (/^0+(\.0+)?$/.test(r.valore)) {
    return { ok: false, errore: 'Quantità: deve essere maggiore di zero.' }
  }
  return r
}

/** Prezzo scritto a mano (decisione 16): stringa col punto, zero ammesso, al massimo 6 decimali. Mai un numero JSON. */
export function validaPrezzoManuale(v: unknown): Esito<string> {
  return leggiDecimaleConPunto(v, 8, 6, 'Prezzo')
}

/** Sconto scritto a mano: `null` (o vuoto) = nessuno sconto, altrimenti una cascata valida, normalizzata. */
export function validaScontoManuale(v: unknown): Esito<string | null> {
  if (v === null || v === undefined) return { ok: true, valore: null }
  if (typeof v !== 'string') return { ok: false, errore: MESSAGGIO_CASCATA }
  const formula = normalizzaCascata(v)
  if (formula === null) return { ok: true, valore: null }
  if (!cascataValida(formula)) return { ok: false, errore: MESSAGGIO_CASCATA }
  return { ok: true, valore: formula }
}

/**
 * Allinea l'avviso `PREZZO_MANUALE` alle righe: presente se almeno una riga ha il prezzo
 * scritto a mano, assente altrimenti. Gli altri avvisi restano, nell'ordine in cui erano.
 */
export function avvisiDaRighe(
  avvisiAttuali: readonly AvvisoLegame[],
  righe: readonly Pick<RigaLegameValori, 'prezzoManuale'>[]
): AvvisoLegame[] {
  const altri = avvisiAttuali.filter(a => a !== 'PREZZO_MANUALE')
  return righe.some(r => r.prezzoManuale) ? [...altri, 'PREZZO_MANUALE'] : altri
}

/** Prezzo e sconto si scrivono a mano finché il legame non è fatturato, e solo su righe a prezzo singolo. */
export function puoModificarePrezzoRiga(i: {
  stato: StatoLegame
  prezzoSpeciale: boolean
}): boolean {
  return puoAggiornarePrezzi(i.stato) && !i.prezzoSpeciale
}

/**
 * Valori da congelare copiandoli dalla riga di listino. Su una riga a prezzo speciale non si
 * copia né prezzo né sconto (li calcola la 4.4), l'IVA sì. Una copia dal listino non è mai manuale.
 */
export function copiaValoriDaRiga(r: {
  prezzo: string | null
  prezzoSpeciale: boolean
  sconto: string | null
  codiceIva: { id: string; aliquota: string; natura: string | null }
}): {
  prezzo: string | null
  sconto: string | null
  prezzoManuale: false
  codiceIvaId: string
  aliquotaIva: string
  naturaIva: string | null
} {
  return {
    prezzo: r.prezzoSpeciale ? null : r.prezzo,
    sconto: r.prezzoSpeciale ? null : r.sconto,
    prezzoManuale: false,
    codiceIvaId: r.codiceIva.id,
    aliquotaIva: r.codiceIva.aliquota,
    naturaIva: r.codiceIva.natura,
  }
}
