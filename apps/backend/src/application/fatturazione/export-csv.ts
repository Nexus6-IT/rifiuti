// CSV dei documenti di fatturazione (fase 4.4b2, Task 24). Funzioni pure, senza database.
// Schema ripreso da `exportToCsv` di audit (intestazione in prima riga, ogni cella fra virgolette
// con i doppi apici raddoppiati) e differenze volute (S21): separatore `;`, BOM, decimali con la
// virgola, date gg/mm/aaaa. Non scrive mai `emesso_il` (S18): il CSV non rende «emesso».
import type { FotografiaDocumento } from '../../domain/fatturazione/tipi'
import type { DocumentoDettaglio } from './documenti-fattura.service'

/** Un documento con tutto quello che serve agli export (CSV qui, XML_ZIP e adattatori dopo). */
export interface DocumentoPerExport {
  documento: DocumentoDettaglio
  numero: number | null
  anno: number
  registroCodice: string
  fotografia: FotografiaDocumento
}

const BOM = '﻿'
const SEPARATORE = ';'
const A_CAPO = '\r\n'

/** Cella fra virgolette con i doppi apici raddoppiati. `null` e' la cella vuota. */
export function cellaCsv(v: string | null): string {
  return `"${(v ?? '').replace(/"/g, '""')}"`
}

/**
 * Come `cellaCsv`, per i testi scritti dagli utenti (descrizioni, denominazioni): un testo che
 * comincia con `= + - @` o con un tab viene letto da Excel come formula. Si antepone un apice.
 */
export function cellaTestoCsv(v: string | null): string {
  if (v !== null && /^[=+\-@\t\r]/.test(v)) return cellaCsv(`'${v}`)
  return cellaCsv(v)
}

/** "1234.50" → "1234,50": niente separatore delle migliaia. */
export function importoCsv(v: string): string {
  return v.replace('.', ',')
}

/** "2026-11-05" → "05/11/2026". */
export function dataCsv(iso: string): string {
  const [a, m, g] = iso.slice(0, 10).split('-')
  return `${g}/${m}/${a}`
}

const importo = (v: string | null): string =>
  v === null ? cellaCsv(null) : cellaCsv(importoCsv(v))
const data = (v: string | null): string => (v === null ? cellaCsv(null) : cellaCsv(dataCsv(v)))

function componi(intestazione: readonly string[], righe: readonly string[][]): string {
  const linee = [intestazione.map(h => cellaCsv(h)), ...righe].map(r => r.join(SEPARATORE))
  return BOM + linee.join(A_CAPO) + A_CAPO
}

const INTESTAZIONE_TESTATE = [
  'Numero',
  'Anno',
  'Registro IVA',
  'Tipo documento',
  'Stato',
  'Data documento',
  'Cliente',
  'Partita IVA',
  'Codice fiscale',
  'Contratto',
  'Totale imponibile',
  'Totale IVA',
  'Totale documento',
  'Importo bollo',
  'Netto a pagare',
] as const

/** BOM + intestazione + una riga per documento. */
export function testateCsv(documenti: readonly DocumentoPerExport[]): string {
  return componi(
    INTESTAZIONE_TESTATE,
    documenti.map(({ documento: d, anno, registroCodice, fotografia }) => {
      const cess = fotografia?.cessionario
      return [
        cellaCsv(d.numeroTesto),
        cellaCsv(String(anno)),
        cellaCsv(registroCodice),
        cellaCsv(d.tipoDocumento),
        cellaCsv(d.stato),
        data(d.dataDocumento),
        cellaTestoCsv(d.cliente.denominazione),
        cellaCsv(cess?.partitaIva ?? null),
        cellaCsv(cess?.codiceFiscale ?? null),
        cellaTestoCsv(d.contratto.numero),
        importo(d.totaleImponibile),
        importo(d.totaleIva),
        importo(d.totaleDocumento),
        importo(d.importoBollo),
        importo(d.nettoAPagare),
      ]
    })
  )
}

const INTESTAZIONE_RIGHE = [
  'Numero',
  'Data documento',
  'Cliente',
  'Linea',
  'Tipo riga',
  'Descrizione',
  'Data movimento',
  'Codice CER',
  'Numero FIR',
  'Quantità',
  'Unità di misura',
  'Prezzo unitario',
  'Sconto',
  'Importo lordo',
  'Importo sconto',
  'Prezzo totale',
  'Aliquota IVA',
  'Natura IVA',
] as const

/** BOM + intestazione + una riga per linea; numero, data e cliente sono ripetuti su ogni riga. */
export function righeCsv(documenti: readonly DocumentoPerExport[]): string {
  const righe: string[][] = []
  for (const { documento: d } of documenti) {
    for (const r of d.righe) {
      righe.push([
        cellaCsv(d.numeroTesto),
        data(d.dataDocumento),
        cellaTestoCsv(d.cliente.denominazione),
        cellaCsv(String(r.numeroLinea)),
        cellaCsv(r.tipoRiga),
        cellaTestoCsv(r.descrizione),
        data(r.dataMovimento),
        cellaCsv(r.cerCode),
        cellaCsv(r.numeroFir),
        importo(r.quantita),
        cellaCsv(r.unitaMisura),
        importo(r.prezzoUnitario),
        cellaTestoCsv(r.sconto),
        importo(r.importoLordo),
        importo(r.importoSconto),
        importo(r.prezzoTotale),
        importo(r.aliquotaIva),
        cellaCsv(r.naturaIva),
      ])
    }
  }
  return componi(INTESTAZIONE_RIGHE, righe)
}
