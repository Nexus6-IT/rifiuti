/**
 * Riferimenti ai carichi degli scarichi (D6, Q9): PROPOSTA del programma, calcolata con il FIFO
 * del deposito (F2-6) sulle annotazioni vigenti del registro piu' le aperture. Pura: nessun
 * accesso al database. Sostituita dall'abbinamento manuale (4.6) quando arrivera'.
 *
 * Un carico-movimento da' il proprio numero di registrazione; un'apertura da' le sue origini
 * (le "relazioni iniziali", nessuna origine = nessun riferimento). Senza doppioni, in ordine
 * (anno, progressivo). Le famiglie sono due, come la traduzione verso RENTRI (`traduciQuantita`):
 * massa (kg e t, t x1000) e volume (l e m3, m3 x1000 in litri, stesso arrotondamento a 4 decimali);
 * massa e volume non si mescolano. Il CER si confronta senza asterisco.
 *
 * Solo carichi che PRECEDONO lo scarico nell'ordine del FIFO: se uno scarico e' scoperto, il FIFO
 * lo salda con un carico successivo (debito), ma un riferimento a un carico posteriore non ha
 * senso e non si emette.
 */
import { chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import {
  calcolaFifo,
  confrontaEventiFifo,
  famigliaFifo,
  quantitaFifo,
  type EventoFifo,
} from '../../../domain/waste-movement/fifo-deposito'
import { normalizzaUnitaRegistro } from '../../../domain/waste-movement/unita-misura-registro'
import type { NumeroRegistrazione } from './mappa-registrazione-rentri'

/**
 * Evento del registro con CER e unita' grezzi: la quantita' e' quella dell'annotazione, la
 * conversione nella scala della famiglia (t -> kg) la fa questa funzione.
 * `riferimento.id` e' l'id del movimento o della giacenza iniziale (apertura).
 */
export interface EventoPerRiferimenti extends EventoFifo {
  cerCode: string
  unit: string
}

const chiave = (n: NumeroRegistrazione) => `${n.anno}/${n.progressivo}`

/** Famiglia e quantita' nella sua scala: massa in kg, volume in litri (m3 x1000, 4 decimali). */
function famigliaEQuantita(q: number, unit: string): { famiglia: string; quantita: number } {
  const u = normalizzaUnitaRegistro(unit).unita
  if (u === 'L') return { famiglia: 'VOLUME', quantita: q }
  if (u === 'M3') return { famiglia: 'VOLUME', quantita: Math.round(q * 1000 * 1e4) / 1e4 }
  return { famiglia: famigliaFifo(unit), quantita: quantitaFifo(q, unit) }
}

/**
 * @param eventi vigenti del registro (carichi, scarichi) e aperture, in qualunque ordine
 * @param numeri id del movimento -> suo numero di registrazione
 * @param originiAperture id dell'apertura -> origini (`{ anno, progressivo: protocollo }`)
 * @returns per ogni scarico (chiave = id) i riferimenti ai carichi che lo coprono, anche vuoti
 * @throws se un evento ha quantita' <= 0,001 (o non finita): `calcolaFifo` la rifiuta. Il chiamante
 *   (Task 6) deve filtrare o gestire questi eventi prima di chiamare la funzione.
 */
export function riferimentiCaricoPerScarichi(
  eventi: readonly EventoPerRiferimenti[],
  numeri: ReadonlyMap<string, NumeroRegistrazione>,
  originiAperture: ReadonlyMap<string, readonly NumeroRegistrazione[]>
): Map<string, NumeroRegistrazione[]> {
  const risultato = new Map<string, NumeroRegistrazione[]>()
  const gruppi = new Map<string, EventoPerRiferimenti[]>()
  const aperture = new Set<string>()

  for (const e of eventi) {
    if (e.tipo === 'SCARICO') risultato.set(e.riferimento.id, [])
    if (e.origine === 'APERTURA') aperture.add(e.riferimento.id)
    const k = `${chiaveConfrontoCer(e.cerCode)}|${famigliaEQuantita(e.quantita, e.unit).famiglia}`
    const g = gruppi.get(k)
    if (g) g.push(e)
    else gruppi.set(k, [e])
  }

  for (const gruppo of gruppi.values()) {
    const eventiFifo: EventoFifo[] = gruppo.map(e => ({
      tipo: e.tipo,
      giorno: e.giorno,
      quantita: famigliaEQuantita(e.quantita, e.unit).quantita,
      origine: e.origine,
      ordine: e.ordine,
      riferimento: e.riferimento,
    }))
    const perId = new Map(eventiFifo.map(e => [e.riferimento.id, e]))
    const esito = calcolaFifo(eventiFifo)
    const visti = new Map<string, Set<string>>()
    for (const ab of esito.abbinamenti) {
      const idCarico = ab.carico.id
      const carico = perId.get(idCarico)
      const scaricoEv = perId.get(ab.scarico.id)
      // Solo carichi che precedono lo scarico nell'ordine del FIFO (no debiti saldati dopo).
      if (!carico || !scaricoEv || confrontaEventiFifo(carico, scaricoEv) >= 0) continue
      const numero = numeri.get(idCarico)
      const dati = aperture.has(idCarico)
        ? (originiAperture.get(idCarico) ?? [])
        : numero
          ? [numero]
          : []
      const lista = risultato.get(ab.scarico.id) as NumeroRegistrazione[]
      const gia = visti.get(ab.scarico.id) ?? new Set<string>()
      visti.set(ab.scarico.id, gia)
      for (const d of dati) {
        if (gia.has(chiave(d))) continue
        gia.add(chiave(d))
        lista.push({ anno: d.anno, progressivo: d.progressivo })
      }
    }
  }

  for (const lista of risultato.values()) {
    lista.sort((a, b) => a.anno - b.anno || a.progressivo - b.progressivo)
  }
  return risultato
}
