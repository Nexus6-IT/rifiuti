/** Modello della marcatura per consorzio (4.9b). Backend: `/comunicazioni/consorzi`. */

export type Consorzio = 'CONOU' | 'COBAT' | 'COREPLA'
export type VersoRegola = 'CARICO' | 'SCARICO'

export const CONSORZI: ReadonlyArray<{ value: Consorzio; label: string }> = [
  { value: 'CONOU', label: 'CONOU' },
  { value: 'COBAT', label: 'COBAT' },
  { value: 'COREPLA', label: 'Corepla' },
]

export function etichettaConsorzio(c: Consorzio): string {
  return CONSORZI.find(x => x.value === c)?.label ?? c
}

export interface RegolaConsorzio {
  /** `null` per le regole di sistema, che non si modificano. */
  id: string | null
  consorzio: Consorzio
  verso: VersoRegola | null
  /** Le sole cifre del CER: 2 o 4 (prefisso) oppure 6 (esatto). */
  cer: string
  cerEsatto: boolean
  causaleCodice: string | null
  registroId: string | null
  attiva: boolean
  validaDal: string
  sistema: boolean
  /** Falso per una regola di sistema se l'azienda ha regole proprie per quel consorzio. */
  inVigore: boolean
}

export interface RegoleConsorziRisposta {
  regole: RegolaConsorzio[]
  puoModificare: boolean
}

export interface InputRegolaConsorzio {
  consorzio: Consorzio
  /** In qualunque forma: 2 o 4 cifre = prefisso, 6 cifre = codice esatto. */
  cer: string
  verso: VersoRegola | null
  causaleCodice: string | null
  attiva: boolean
  validaDal?: string
}

export interface Marcatura {
  consorzio: Consorzio
  origine: 'REGOLA' | 'MANUALE'
  regolaId?: string
}

export interface MarcaturaMovimento {
  marcature: Marcatura[]
  /** Consorzi che una regola prenderebbe ma che sono stati esclusi a mano. */
  esclusi: Consorzio[]
}

export interface EtichettaConsorzio {
  consorzio: Consorzio
  testo: string
  manuale: boolean
  escluso: boolean
}

export interface FileScaricato {
  blob: Blob
  nomeFile: string | null
}

/** «13» -> «13 xx xx», «1606» -> «16 06 xx», «160601» -> «16 06 01». */
export function descriviCer(cer: string, esatto: boolean): string {
  if (esatto) return `${cer.slice(0, 2)} ${cer.slice(2, 4)} ${cer.slice(4)}`
  return cer.length === 2 ? `${cer} xx xx` : `${cer.slice(0, 2)} ${cer.slice(2)} xx`
}

export function descriviRegola(r: RegolaConsorzio): string {
  const parti = [`CER ${descriviCer(r.cer, r.cerEsatto)}`]
  parti.push(
    r.verso === 'CARICO'
      ? 'solo carichi'
      : r.verso === 'SCARICO'
        ? 'solo scarichi'
        : 'carichi e scarichi'
  )
  if (r.causaleCodice) parti.push(`causale ${r.causaleCodice}`)
  return parti.join(', ')
}

/** Le etichette da mostrare accanto a un movimento: solo i consorzi a cui appartiene. */
export function etichetteMovimento(m: MarcaturaMovimento | undefined): EtichettaConsorzio[] {
  if (!m) return []
  return m.marcature.map(x => ({
    consorzio: x.consorzio,
    testo:
      x.origine === 'MANUALE'
        ? `${etichettaConsorzio(x.consorzio)} (manuale)`
        : etichettaConsorzio(x.consorzio),
    manuale: x.origine === 'MANUALE',
    escluso: false,
  }))
}
