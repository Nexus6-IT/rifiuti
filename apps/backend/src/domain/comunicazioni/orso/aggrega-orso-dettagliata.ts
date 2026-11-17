import { chiaveConfrontoCer } from '../../waste-movement/cer-registro'
import { aggregaOrso, descrizionePulita, grammi, grammiInTonnellate } from './aggrega-orso'
import type { ParametriOrso } from './aggrega-orso'
import type {
  AggregatoOrsoDettagliato,
  AvvisoOrso,
  ImpiantoNuovoOrso,
  IngressoSoggettoOrso,
  MeseOrsoDettagliato,
  MovimentoOrso,
  SoggettoOrso,
  UscitaSoggettoOrso,
} from './aggregato'
import type { NuovoImpiantoDati } from './impianto-mesi'

export interface ParametriOrsoDettagliata extends ParametriOrso {
  /**
   * Ultimo mese dichiarabile (1-12, predefinito 12): i nodi dei mesi successivi non entrano e non
   * consumano progressivi `Inew` (così nessun `NuovoImpianto` resta senza riferimenti).
   */
  ultimoMese?: number
}

interface VoceSoggetto {
  soggetto: SoggettoOrso
  g: number
  conFir: boolean
}

/** Rango del tipo per l'ordine stabile dentro un nodo: comuni, poi impianti, poi nuovi impianti. */
const RANGO: Record<SoggettoOrso['tipo'], number> = { C: 0, I: 1, Inew: 2 }

function identita(s: SoggettoOrso): string {
  switch (s.tipo) {
    case 'C':
      return s.istat
    case 'I':
      return s.codice
    case 'Inew':
      return s.chiave
  }
}

const chiaveSoggetto = (s: SoggettoOrso) => `${s.tipo}\u0000${identita(s)}`

function etichetta(s: SoggettoOrso): string {
  switch (s.tipo) {
    case 'C':
      return s.etichetta ?? `Comune ISTAT ${s.istat}`
    case 'I':
      return s.etichetta ?? `Impianto ARPA ${s.codice}`
    case 'Inew':
      return s.impianto.ragioneSociale
  }
}

function inOrdine(voci: Iterable<VoceSoggetto>): VoceSoggetto[] {
  return [...voci].sort(
    (a, b) =>
      RANGO[a.soggetto.tipo] - RANGO[b.soggetto.tipo] ||
      identita(a.soggetto).localeCompare(identita(b.soggetto))
  )
}

/**
 * Aggregatore O.R.SO. modalità dettagliata (4.9e, D12): gli stessi nodi, totali e giacenze della
 * modalità normale (riuso di `aggregaOrso`), con `In` per conferitore e `Out` per destinatario.
 * Pura. Differenze volute dalla normale:
 * - nessun `Extra`: il dettaglio per soggetto lo sostituisce, quindi la provincia del conferitore
 *   non serve e il suo avviso non blocca;
 * - `f` è calcolato per singolo `In` (review 4.9a, M3): 1 se almeno un movimento di quel soggetto
 *   nel nodo ha il FIR;
 * - un movimento senza soggetto è un avviso bloccante `SOGGETTO_NON_IDENTIFICATO` (come l'errore
 *   «NON TROVATO IN ANAGRAFICA» di WinWaste), mai una quota anonima;
 * - un comune in uscita non esiste nell'XSD (`tTipoSoggettoOut`): il chiamante lo trasforma in
 *   `Inew`; se arriva qui non è identificato.
 * I `Inew` hanno un progressivo unico per file, assegnato per prima comparsa nell'ordine dei nodi
 * (mese, CER, descrizione; ricevuti prima dei prodotti) e, dentro il nodo, dei soggetti.
 */
export function aggregaOrsoDettagliata(
  movimenti: readonly MovimentoOrso[],
  p: ParametriOrsoDettagliata
): AggregatoOrsoDettagliato {
  const ultimoMese = p.ultimoMese ?? 12
  const base = aggregaOrso(movimenti, p)

  const ricevuti = new Map<string, Map<string, VoceSoggetto>>()
  const prodotti = new Map<string, Map<string, VoceSoggetto>>()
  const nonIdentificati = new Map<string, AvvisoOrso>()

  for (const m of movimenti) {
    const ricevuto = m.verso === 'CARICO' && m.ruoloMud === 'RICEVUTO_DA_TERZI'
    const prodotto = m.verso === 'SCARICO' && m.ruoloMud !== 'ESCLUSO'
    if (!ricevuto && !prodotto) continue
    if (!Number.isInteger(m.mese) || m.mese < 1 || m.mese > 12) continue
    // I mesi non ancora dichiarabili non entrano nel file e quindi non servono di soggetto.
    if (m.mese > ultimoMese) continue
    const g = grammi(m)
    // g nullo = già un avviso bloccante del normale; g = 0 non si scrive (come WinWaste: q ≠ 0) e
    // non consuma un progressivo `Inew`.
    if (g === null || g === 0) continue

    const cer = chiaveConfrontoCer(m.cer)
    const chiaveNodo = `${m.mese}|${cer}|${descrizionePulita(m.descrizione).toLowerCase()}`
    const s = m.soggetto
    // Il comune esiste solo fra i conferitori.
    if (!s || (prodotto && s.tipo === 'C')) {
      const k = `${m.mese}|${cer}`
      const a = nonIdentificati.get(k) ?? {
        codice: 'SOGGETTO_NON_IDENTIFICATO' as const,
        bloccante: true,
        mese: m.mese,
        cer,
        movimentoIds: [],
      }
      if (m.id !== '' && !a.movimentoIds.includes(m.id)) a.movimentoIds.push(m.id)
      nonIdentificati.set(k, a)
      continue
    }
    const gruppi = ricevuto ? ricevuti : prodotti
    const nodo = gruppi.get(chiaveNodo) ?? new Map<string, VoceSoggetto>()
    const k = chiaveSoggetto(s)
    const voce = nodo.get(k) ?? { soggetto: s, g: 0, conFir: false }
    voce.g += g
    if (m.conFir) voce.conFir = true
    nodo.set(k, voce)
    gruppi.set(chiaveNodo, nodo)
  }

  const progressivi = new Map<string, number>()
  const nuoviImpianti: NuovoImpiantoDati[] = []
  const progressivo = (s: Extract<SoggettoOrso, { tipo: 'Inew' }>): string => {
    let id = progressivi.get(s.chiave)
    if (id === undefined) {
      id = progressivi.size + 1
      progressivi.set(s.chiave, id)
      const impianto: ImpiantoNuovoOrso = s.impianto
      nuoviImpianti.push({ id, ...impianto })
    }
    return String(id)
  }
  const identificativo = (s: SoggettoOrso): string =>
    s.tipo === 'C' ? s.istat : s.tipo === 'I' ? s.codice : progressivo(s)

  const chiaveDi = (mese: number, r: { cer: string; descrizione: string }) =>
    `${mese}|${r.cer}|${r.descrizione.toLowerCase()}`

  const mesi: MeseOrsoDettagliato[] = base.mesi
    .filter(m => m.mese <= ultimoMese)
    .map(m => ({
      mese: m.mese,
      ricevuti: m.ricevuti.map(r => ({
        ...r,
        ingressi: inOrdine(ricevuti.get(chiaveDi(m.mese, r))?.values() ?? []).map(
          (v): IngressoSoggettoOrso => ({
            ts: v.soggetto.tipo,
            s: identificativo(v.soggetto),
            etichetta: etichetta(v.soggetto),
            totale: grammiInTonnellate(v.g),
            f: v.conFir ? 1 : 0,
          })
        ),
      })),
      prodotti: m.prodotti.map(r => ({
        ...r,
        uscite: inOrdine(prodotti.get(chiaveDi(m.mese, r))?.values() ?? []).map(
          (v): UscitaSoggettoOrso => ({
            // `C` non arriva qui (scartato sopra): in uscita solo `I` e `Inew`.
            ts: v.soggetto.tipo === 'I' ? 'I' : 'Inew',
            s: identificativo(v.soggetto),
            etichetta: etichetta(v.soggetto),
            totale: grammiInTonnellate(v.g),
          })
        ),
      })),
    }))

  const avvisi = [
    ...base.avvisi.filter(a => a.codice !== 'PROVINCIA_CONFERITORE_MANCANTE'),
    ...nonIdentificati.values(),
  ]
    .map(a => ({ ...a, movimentoIds: [...a.movimentoIds].sort() }))
    .sort(
      (a, b) => a.mese - b.mese || a.cer.localeCompare(b.cer) || a.codice.localeCompare(b.codice)
    )

  return {
    anno: base.anno,
    mesi,
    avvisi,
    bloccato: avvisi.some(a => a.bloccante),
    nuoviImpianti,
  }
}
