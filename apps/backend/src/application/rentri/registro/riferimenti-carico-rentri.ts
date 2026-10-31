/**
 * Riferimenti ai carichi degli scarichi (D6, Q9): PROPOSTA del programma, calcolata con il FIFO
 * del deposito (F2-6) sulle annotazioni vigenti del registro piu' le aperture. Pura: nessun
 * accesso al database. Sostituita dall'abbinamento manuale (4.6) quando arrivera'.
 *
 * Un carico-movimento da' il proprio numero di registrazione; un'apertura da' le sue origini
 * (le "relazioni iniziali", nessuna origine = nessun riferimento). Senza doppioni, in ordine
 * (anno, progressivo). kg/t e litri/m3 non si mescolano e il CER si confronta senza asterisco.
 */
import { chiaveConfrontoCer } from '../../../domain/waste-movement/cer-registro'
import {
  calcolaFifo,
  famigliaFifo,
  quantitaFifo,
  type EventoFifo,
} from '../../../domain/waste-movement/fifo-deposito'
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

/**
 * @param eventi vigenti del registro (carichi, scarichi) e aperture, in qualunque ordine
 * @param numeri id del movimento -> suo numero di registrazione
 * @param originiAperture id dell'apertura -> origini (`{ anno, progressivo: protocollo }`)
 * @returns per ogni scarico (chiave = id) i riferimenti ai carichi che lo coprono, anche vuoti
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
    const k = `${chiaveConfrontoCer(e.cerCode)}|${famigliaFifo(e.unit)}`
    const g = gruppi.get(k)
    if (g) g.push(e)
    else gruppi.set(k, [e])
  }

  for (const gruppo of gruppi.values()) {
    const esito = calcolaFifo(
      gruppo.map(e => ({
        tipo: e.tipo,
        giorno: e.giorno,
        quantita: quantitaFifo(e.quantita, e.unit),
        origine: e.origine,
        ordine: e.ordine,
        riferimento: e.riferimento,
      }))
    )
    const visti = new Map<string, Set<string>>()
    for (const ab of esito.abbinamenti) {
      const idCarico = ab.carico.id
      const dati = aperture.has(idCarico)
        ? (originiAperture.get(idCarico) ?? [])
        : numeri.has(idCarico)
          ? [numeri.get(idCarico) as NumeroRegistrazione]
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
