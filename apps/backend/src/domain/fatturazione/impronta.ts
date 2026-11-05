import type { TipoMarcatore } from './codici'
import { improntaVariazione } from '../listino/variazione-prezzi'

/**
 * Impronta di un'elaborazione di fatturazione (scansione P19): cambia se cambia una versione di
 * legame, contratto, elenco, riga di listino o codice IVA, o un parametro; non cambia con l'ordine.
 * Nessun `createHash` qui: si riusa `improntaVariazione`. Il tipo davanti all'id tiene distinti
 * gli oggetti di tabelle diverse con lo stesso id.
 */
export type Voce = { id: string; versione: number }

/** JSON con le chiavi degli oggetti in ordine alfabetico, a ogni livello. */
function jsonOrdinato(valore: unknown): string {
  return JSON.stringify(valore, (_chiave, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const ordinato: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) ordinato[k] = (v as Record<string, unknown>)[k]
      return ordinato
    }
    return v
  })
}

export function improntaElaborazione(i: {
  parametri: unknown
  legami: readonly Voce[]
  contratti: readonly Voce[]
  elenchi: readonly Voce[]
  righeAddebito: readonly Voce[]
  codiciIva: readonly Voce[]
  /** Clienti di fatturazione dei documenti (Q4). */
  clienti: readonly Voce[]
  /** Dati anagrafici di ditta e sede dei clienti (senza `versione`): l'id porta l'hash del contenuto. */
  anagrafiche: readonly Voce[]
  /** Registri IVA scelti dai documenti, con lo stato attivo/disattivo nell'id. */
  registri: readonly Voce[]
  condizioniPagamento: readonly Voce[]
  speseAccessorie: readonly Voce[]
  /** Conti correnti del cedente usati dai documenti. */
  contiCorrenti: readonly Voce[]
  /** Riga del cedente (`null` se manca). I dati di `tenants` restano fuori: vanno nella fotografia. */
  cedente: Voce | null
  /** Marcatori letti per le righe del listino dei documenti: un canone fatturato altrove cambia l'impronta. */
  marcatori: readonly { rigaAddebitoId: string; tipo: TipoMarcatore; chiaveCompetenza: string }[]
}): string {
  const con = (tipo: string, voci: readonly Voce[]): Voce[] =>
    voci.map(v => ({ id: `${tipo}:${v.id}`, versione: v.versione }))
  return improntaVariazione([
    ...con('legame', i.legami),
    ...con('contratto', i.contratti),
    ...con('elenco', i.elenchi),
    ...con('riga', i.righeAddebito),
    ...con('iva', i.codiciIva),
    ...con('cliente', i.clienti),
    ...con('anagrafica', i.anagrafiche),
    ...con('registro', i.registri),
    ...con('condizione', i.condizioniPagamento),
    ...con('spesa', i.speseAccessorie),
    ...con('conto', i.contiCorrenti),
    ...(i.cedente === null ? [] : con('cedente', [i.cedente])),
    ...i.marcatori.map(m => ({
      id: `marcatore:${m.rigaAddebitoId}:${m.tipo}:${m.chiaveCompetenza}`,
      versione: 0,
    })),
    { id: `parametri:${jsonOrdinato(i.parametri)}`, versione: 0 },
  ])
}
