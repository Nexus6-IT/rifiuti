import { improntaVariazione } from '../listino/variazione-prezzi'

/**
 * Impronta di un'elaborazione di fatturazione (scansione P19): cambia se cambia una versione di
 * legame, contratto, elenco, riga di listino o codice IVA, o un parametro; non cambia con l'ordine.
 * Nessun `createHash` qui: si riusa `improntaVariazione`. Il tipo davanti all'id tiene distinti
 * gli oggetti di tabelle diverse con lo stesso id.
 */
type Voce = { id: string; versione: number }

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
}): string {
  const con = (tipo: string, voci: readonly Voce[]): Voce[] =>
    voci.map(v => ({ id: `${tipo}:${v.id}`, versione: v.versione }))
  return improntaVariazione([
    ...con('legame', i.legami),
    ...con('contratto', i.contratti),
    ...con('elenco', i.elenchi),
    ...con('riga', i.righeAddebito),
    ...con('iva', i.codiciIva),
    { id: `parametri:${jsonOrdinato(i.parametri)}`, versione: 0 },
  ])
}
