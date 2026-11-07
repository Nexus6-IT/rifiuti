import { numeroTesto } from './numerazione'
import type { RiepilogoElaborazione } from './anteprima'

type VoceSalvata = RiepilogoElaborazione['numerazionePrevista'][number]

/** Voce della numerazione prevista restituita dal dettaglio: come quella salvata, più `quanti`. */
export interface VoceNumerazionePrevista extends VoceSalvata {
  /** Documenti che la definitiva numererebbe in questo registro. */
  quanti: number
}

/** Cifre in testa a un numero di documento (`15/A` → 15); `null` se non ci sono. */
function cifreIniziali(testo: string): { numero: number; resto: string } | null {
  const m = /^(\d+)(.*)$/.exec(testo)
  return m ? { numero: Number(m[1]), resto: m[2] } : null
}

/**
 * Numerazione prevista alla lettura. Il riepilogo salvato al calcolo dell'anteprima non sa degli
 * esclusi (`escludi` non lo riscrive): `da` e il suffisso restano quelli salvati, `quanti` e `a`
 * si ricalcolano con i candidati reali della definitiva (bozze non escluse e senza errori), per
 * registro. Un registro senza candidati sparisce.
 */
export function numerazioneAllaLettura(
  salvata: readonly VoceSalvata[],
  candidatiPerRegistro: ReadonlyMap<string, number>
): VoceNumerazionePrevista[] {
  const risultato: VoceNumerazionePrevista[] = []
  for (const v of salvata) {
    const quanti = candidatiPerRegistro.get(v.registroIvaId) ?? 0
    const da = cifreIniziali(v.da)
    if (quanti <= 0 || da === null) continue
    risultato.push({ ...v, quanti, a: numeroTesto(da.numero + quanti - 1, da.resto || null) })
  }
  return risultato
}

/** Per le elaborazioni senza più bozze (definitive, scartate): `quanti` ricavato dai numeri salvati. */
export function conQuantiSalvati(salvata: readonly VoceSalvata[]): VoceNumerazionePrevista[] {
  return salvata.map(v => {
    const da = cifreIniziali(v.da)
    const a = cifreIniziali(v.a)
    return { ...v, quanti: da && a ? a.numero - da.numero + 1 : 0 }
  })
}
