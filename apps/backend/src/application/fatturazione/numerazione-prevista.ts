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

/** Contatore attuale di un registro (anno della data documento) e suffisso della serie. */
export interface NumerazioneCorrente {
  ultimoNumero: number
  suffisso: string | null
}

/**
 * Numerazione prevista alla lettura. Il riepilogo salvato al calcolo dell'anteprima non sa degli
 * esclusi (`escludi` non lo riscrive) ne' di un contatore cambiato dopo (numero di partenza
 * modificato, un'altra elaborazione resa definitiva): `quanti` si ricalcola con i candidati reali
 * della definitiva (bozze non escluse e senza errori), per registro, e `da`/`a` partono dal
 * contatore attuale (`corrente`), con il suffisso della serie, come fa la definitiva. Se per un
 * registro `corrente` manca si ripiega sul `da` salvato. Un registro senza candidati sparisce.
 */
export function numerazioneAllaLettura(
  salvata: readonly VoceSalvata[],
  candidatiPerRegistro: ReadonlyMap<string, number>,
  corrente: ReadonlyMap<string, NumerazioneCorrente> = new Map()
): VoceNumerazionePrevista[] {
  const risultato: VoceNumerazionePrevista[] = []
  for (const v of salvata) {
    const quanti = candidatiPerRegistro.get(v.registroIvaId) ?? 0
    if (quanti <= 0) continue
    const c = corrente.get(v.registroIvaId)
    if (c !== undefined) {
      risultato.push({
        ...v,
        quanti,
        da: numeroTesto(c.ultimoNumero + 1, c.suffisso),
        a: numeroTesto(c.ultimoNumero + quanti, c.suffisso),
      })
      continue
    }
    const da = cifreIniziali(v.da)
    if (da === null) continue
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
