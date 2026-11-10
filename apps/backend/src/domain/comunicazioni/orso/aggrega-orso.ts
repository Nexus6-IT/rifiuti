import { convertiInKg } from '../../waste-movement/unita-misura-registro'
import { chiaveConfrontoCer } from '../../waste-movement/cer-registro'
import type {
  AggregatoOrso,
  AvvisoOrso,
  CodiceAvvisoOrso,
  MeseOrso,
  MovimentoOrso,
  RifiutoProdottoOrso,
  RifiutoRicevutoOrso,
} from './aggregato'

const MAX_DESCRIZIONE = 100

export interface ParametriOrso {
  anno: number
  /** provincia dell'impianto (sigla): i carichi da altre province sono «Extra» */
  provinciaImpianto: string
}

/** kg arrotondati al grammo → grammi interi (niente somme in virgola mobile). */
function grammi(m: MovimentoOrso): number | null {
  const base = convertiInKg(m.quantita, m.unita)
  const kg = base !== null ? base : m.kgPerUnita !== null ? m.quantita * m.kgPerUnita : null
  if (kg === null || !Number.isFinite(kg)) return null
  return Math.round(kg * 1000)
}

/** Grammi → tonnellate come stringa decimale (fino a 6 decimali, senza zeri finali). */
export function grammiInTonnellate(g: number): string {
  const intero = Math.trunc(g / 1_000_000)
  const resto = String(g % 1_000_000)
    .padStart(6, '0')
    .replace(/0+$/, '')
  return resto === '' ? String(intero) : `${intero}.${resto}`
}

function descrizionePulita(d: string | null): string {
  return (d ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIZIONE)
}

function sigla(p: string | null): string | null {
  const s = (p ?? '').trim().toUpperCase()
  return s === '' ? null : s
}

interface GruppoRicevuto {
  cer: string
  descrizione: string
  tot: number
  extra: number
  operazioni: Set<string>
  conFir: number
  movimenti: number
}

/**
 * Aggregatore O.R.SO. normale (P9 §3.1): per mese e CER+descrizione somma i carichi ricevuti da
 * terzi (Tot ed Extra) e gli scarichi (Out Tot) in tonnellate. Pura: nessun accesso al database.
 * `f` = 1 se almeno un movimento del nodo è andato con FIR.
 */
export function aggregaOrso(movimenti: readonly MovimentoOrso[], p: ParametriOrso): AggregatoOrso {
  const provImpianto = sigla(p.provinciaImpianto)
  const ricevuti = new Map<string, GruppoRicevuto & { mese: number }>()
  const prodotti = new Map<
    string,
    { mese: number; cer: string; descrizione: string; tot: number }
  >()
  const avvisiMap = new Map<string, AvvisoOrso>()

  const avviso = (codice: CodiceAvvisoOrso, bloccante: boolean, m: MovimentoOrso, cer: string) => {
    const chiave = `${codice}|${m.mese}|${cer}`
    const a = avvisiMap.get(chiave) ?? { codice, bloccante, mese: m.mese, cer, movimentoIds: [] }
    if (m.id !== '' && !a.movimentoIds.includes(m.id)) a.movimentoIds.push(m.id)
    avvisiMap.set(chiave, a)
  }

  for (const m of movimenti) {
    const ricevuto = m.verso === 'CARICO' && m.ruoloMud === 'RICEVUTO_DA_TERZI'
    const prodotto = m.verso === 'SCARICO' && m.ruoloMud !== 'ESCLUSO'
    if (!ricevuto && !prodotto) continue
    if (!Number.isInteger(m.mese) || m.mese < 1 || m.mese > 12) continue

    const cer = chiaveConfrontoCer(m.cer)
    const descrizione = descrizionePulita(m.descrizione)
    const g = grammi(m)
    if (g === null) {
      avviso('QUANTITA_NON_CONVERTIBILE', true, m, cer)
      continue
    }
    const chiave = `${m.mese}|${cer}|${descrizione}`

    if (ricevuto) {
      const gr =
        ricevuti.get(chiave) ??
        ({
          mese: m.mese,
          cer,
          descrizione,
          tot: 0,
          extra: 0,
          operazioni: new Set<string>(),
          conFir: 0,
          movimenti: 0,
        } as GruppoRicevuto & { mese: number })
      gr.tot += g
      gr.movimenti += 1
      if (m.conFir) gr.conFir += 1
      const op = (m.operazione ?? '').trim().toUpperCase()
      if (op === '') avviso('OPERAZIONE_MANCANTE', false, m, cer)
      else gr.operazioni.add(op)
      const prov = sigla(m.provinciaConferitore)
      if (prov === null || provImpianto === null) {
        avviso('PROVINCIA_CONFERITORE_MANCANTE', true, m, cer)
      } else if (prov !== provImpianto) {
        gr.extra += g
      }
      ricevuti.set(chiave, gr)
    } else {
      const gr = prodotti.get(chiave) ?? { mese: m.mese, cer, descrizione, tot: 0 }
      gr.tot += g
      prodotti.set(chiave, gr)
      avviso('TRATTATO_INTERNAMENTE_DEFAULT', false, m, cer)
    }
  }

  const perMese = new Map<number, MeseOrso>()
  const mese = (n: number): MeseOrso => {
    const e = perMese.get(n) ?? { mese: n, ricevuti: [], prodotti: [] }
    perMese.set(n, e)
    return e
  }
  const ordina = (
    a: { cer: string; descrizione: string },
    b: { cer: string; descrizione: string }
  ) => a.cer.localeCompare(b.cer) || a.descrizione.localeCompare(b.descrizione)

  for (const g of ricevuti.values()) {
    const r: RifiutoRicevutoOrso = {
      cer: g.cer,
      descrizione: g.descrizione,
      operazioni: [...g.operazioni].sort(),
      totale: grammiInTonnellate(g.tot),
      extra: grammiInTonnellate(g.extra),
      f: g.conFir > 0 ? 1 : 0,
    }
    mese(g.mese).ricevuti.push(r)
  }
  for (const g of prodotti.values()) {
    const r: RifiutoProdottoOrso = {
      cer: g.cer,
      descrizione: g.descrizione,
      totale: grammiInTonnellate(g.tot),
      trattatoInternamente: '0',
    }
    mese(g.mese).prodotti.push(r)
  }

  const mesi = [...perMese.values()].sort((a, b) => a.mese - b.mese)
  for (const x of mesi) {
    x.ricevuti.sort(ordina)
    x.prodotti.sort(ordina)
  }
  const avvisi = [...avvisiMap.values()]
    .map(a => ({ ...a, movimentoIds: [...a.movimentoIds].sort() }))
    .sort(
      (a, b) => a.mese - b.mese || a.cer.localeCompare(b.cer) || a.codice.localeCompare(b.codice)
    )

  return { anno: p.anno, mesi, avvisi, bloccato: avvisi.some(a => a.bloccante) }
}
