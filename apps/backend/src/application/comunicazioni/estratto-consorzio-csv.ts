import { cellaCsv, cellaTestoCsv, dataCsv } from '../fatturazione/export-csv'
import type { Consorzio } from '../../domain/comunicazioni/classifica-consorzio'

/**
 * CSV dell'estratto per consorzio e periodo (4.9b, T11): una riga per movimento vigente marcato.
 * Funzioni pure. Stessa forma degli altri CSV dell'applicazione: BOM, separatore `;`, ogni cella
 * fra virgolette, decimali con la virgola, date gg/mm/aaaa. I testi scritti dagli utenti (controparte,
 * descrizione) sono protetti dalle formule di Excel.
 */
export interface RigaEstrattoConsorzio {
  /** `AAAA-MM-GG`. */
  data: string
  /** «n/anno», progressivo nel registro. */
  numero: string
  verso: 'CARICO' | 'SCARICO'
  /** Le sole cifre del CER. */
  cer: string
  pericoloso: boolean
  descrizione: string | null
  /** Quantita' in kg, `null` se l'unita' non e' convertibile. */
  kg: number | null
  quantita: number
  unita: string | null
  controparte: string | null
  indirizzoControparte: string | null
  firNumero: string | null
  origine: 'REGOLA' | 'MANUALE'
}

const BOM = '﻿'
const INTESTAZIONE = [
  'Consorzio',
  'Data',
  'Numero',
  'Anno',
  'Verso',
  'CER',
  'Descrizione',
  'Quantità (kg)',
  'Quantità originale',
  'Unità',
  'Controparte',
  'Indirizzo controparte',
  'FIR',
  'Marcatura',
] as const

/** «160601» -> «16 06 01», con «*» se pericoloso. */
export function cerLeggibile(cifre: string, pericoloso: boolean): string {
  const base =
    cifre.length === 6 ? `${cifre.slice(0, 2)} ${cifre.slice(2, 4)} ${cifre.slice(4)}` : cifre
  return pericoloso ? `${base}*` : base
}

/** «1234.5» -> «1234,5», «null» -> vuoto; fino a tre decimali, senza zeri inutili. */
function decimale(n: number | null): string {
  if (n === null) return ''
  return String(Math.round(n * 1000) / 1000).replace('.', ',')
}

export function estrattoConsorzioCsv(
  consorzio: Consorzio,
  righe: readonly RigaEstrattoConsorzio[]
): string {
  const linee = righe.map(r => {
    // «12/2026» in una cella sola sarebbe letto da Excel come una data: due colonne.
    const [numero, anno] = r.numero.split('/')
    return [
      cellaCsv(consorzio),
      cellaCsv(dataCsv(r.data)),
      cellaCsv(numero),
      cellaCsv(anno),
      cellaCsv(r.verso === 'CARICO' ? 'Carico' : 'Scarico'),
      cellaCsv(cerLeggibile(r.cer, r.pericoloso)),
      cellaTestoCsv(r.descrizione),
      cellaCsv(decimale(r.kg)),
      cellaCsv(decimale(r.quantita)),
      cellaTestoCsv(r.unita),
      cellaTestoCsv(r.controparte),
      cellaTestoCsv(r.indirizzoControparte),
      cellaTestoCsv(r.firNumero),
      cellaCsv(r.origine === 'MANUALE' ? 'Manuale' : 'Regola'),
    ].join(';')
  })
  return BOM + [INTESTAZIONE.map(h => cellaCsv(h)).join(';'), ...linee].join('\r\n') + '\r\n'
}
