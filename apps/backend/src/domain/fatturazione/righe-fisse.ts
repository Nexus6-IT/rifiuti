import { Prisma } from '@prisma/client'
import { formatta, giorniDelMese } from '../contratti-cliente/periodi-fatturazione'
import { importoRiga, prezzoCalcolato } from '../listino/importi-riga'
import {
  periodoCompetenza,
  scadenzeNelPeriodo,
  type PeriodoScadenze,
} from '../listino/scadenze-fisse'
import type { AvvisoDocumento, ErroreDocumento, Segnalazione, TipoMarcatore } from './codici'
import { testoPeriodo, type EsitoRighe, type RigaSenzaLinea } from './esito-righe'
import type { RigaListinoDaFatturare } from './tipi'

export interface MarcatoreEsistente {
  rigaAddebitoId: string
  tipo: TipoMarcatore
  chiaveCompetenza: string
}

const MESI_ARRETRATI = 12

/** `data` meno 12 mesi (il 29/02 scivola al 28/02). */
function menoDodiciMesi(data: string): string {
  const anno = Number(data.slice(0, 4)) - MESI_ARRETRATI / 12
  const mese = Number(data.slice(5, 7))
  const giorno = Math.min(Number(data.slice(8, 10)), giorniDelMese(mese, anno))
  return formatta(anno, mese, giorno)
}

function riga(
  r: RigaListinoDaFatturare,
  prezzo: string,
  quantita: string,
  descrizione: string,
  marcatore: { tipo: TipoMarcatore; chiaveCompetenza: string }
): RigaSenzaLinea {
  const imp = importoRiga(quantita, prezzo, r.sconto)
  return {
    tipoRiga: 'FISSO',
    legameId: null,
    rigaLegameId: null,
    rigaAddebitoId: r.id,
    descrizione,
    dataMovimento: null,
    cerCode: null,
    numeroFir: null,
    quantita,
    unitaMisura: r.unitaMisura,
    prezzoUnitario: prezzoCalcolato(prezzo),
    sconto: r.sconto,
    importoLordo: imp.lordo,
    importoSconto: imp.sconto,
    prezzoTotale: imp.netto,
    codiceIvaId: r.codiceIva.id,
    aliquotaIva: r.codiceIva.aliquota,
    naturaIva: r.codiceIva.natura,
    marcatore,
  }
}

function incompleta(
  r: RigaListinoDaFatturare,
  numeroRiga: (id: string) => number
): Segnalazione<ErroreDocumento> {
  return { codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: `F riga ${numeroRiga(r.id)}` }
}

/** Intervalli 'AAAA-MM-GG/AAAA-MM-GG' che si sovrappongono (estremi inclusi). */
function sovrapposti(chiave: string, p: { dal: string; al: string }): boolean {
  const [a, b] = chiave.split('/')
  return b !== undefined && a <= p.al && b >= p.dal
}

/**
 * Addebiti fissi `F` e canoni (spec §6.4). Le righe che non sono `F` sono ignorate. «riga n» nei
 * dettagli = posizione da 1 nel listino del documento, passata da `calcolaDocumento` con
 * `numeroRiga` (obbligatorio). Una `F` senza prezzo dà RIGA_LEGAME_INCOMPLETA solo se nel periodo
 * produrrebbe una riga (decisione 21): una scadenza non ancora fatturata, o il canone del periodo.
 */
export function righeFisse(i: {
  righe: readonly RigaListinoDaFatturare[]
  periodo: { dal: string; al: string }
  contratto: { dataInizio: string; dataFine: string | null }
  marcatori: readonly MarcatoreEsistente[]
  /** Posizione da 1 della riga nel listino del documento: il «riga n» dei dettagli. */
  numeroRiga: (id: string) => number
}): EsitoRighe {
  const righe: RigaSenzaLinea[] = []
  const errori: Segnalazione<ErroreDocumento>[] = []
  const avvisi: Segnalazione<AvvisoDocumento>[] = []
  const { dal, al } = i.periodo

  for (const r of i.righe) {
    if (r.tipo !== 'F') continue
    const quantita = r.quantitaFissa ?? '1'
    if (new Prisma.Decimal(quantita).isZero()) continue
    // Etichetta propria («Canone»): quella di `etichettaTipo('F')` è un testo da listino.
    const base = r.descrizione ?? 'Canone'
    const proprio = i.marcatori.filter(m => m.rigaAddebitoId === r.id)

    if (r.scadenze.length > 0) {
      const dalArretrati = menoDodiciMesi(dal)
      const trovate = scadenzeNelPeriodo(r.scadenze, dalArretrati, al, i.contratto)
      for (const { scadenza, data } of trovate) {
        const giaFatta = proprio.some(
          m => m.tipo === 'SCADENZA_FISSO' && m.chiaveCompetenza === data
        )
        if (giaFatta) continue
        // Decisione 21: una `F` senza prezzo blocca solo se in questo periodo produrrebbe una riga.
        if (r.prezzo === null) {
          errori.push(incompleta(r, i.numeroRiga))
          break
        }
        const comp =
          r.periodoScadenze === null
            ? null
            : periodoCompetenza(
                scadenza,
                r.periodoScadenze as PeriodoScadenze,
                Number(data.slice(0, 4))
              )
        const descrizione = comp === null ? base : `${base} ${testoPeriodo(comp)}`
        righe.push(
          riga(r, r.prezzo, quantita, descrizione, {
            tipo: 'SCADENZA_FISSO',
            chiaveCompetenza: data,
          })
        )
        if (data < dal && !avvisi.some(a => a.codice === 'ARRETRATI_PRESENTI')) {
          avvisi.push({ codice: 'ARRETRATI_PRESENTI' })
        }
      }
      continue
    }

    // Contratto non attivo nel periodo: nessun canone (canone intero se inizia o finisce dentro).
    if (i.contratto.dataInizio > al) continue
    if (i.contratto.dataFine !== null && i.contratto.dataFine < dal) continue
    const chiave = `${dal}/${al}`
    const canoni = proprio.filter(m => m.tipo === 'PERIODO_CANONE')
    if (canoni.some(m => m.chiaveCompetenza === chiave)) continue
    if (canoni.some(m => sovrapposti(m.chiaveCompetenza, i.periodo))) {
      errori.push({ codice: 'CANONE_PERIODO_SOVRAPPOSTO', dettaglio: base })
      continue
    }
    if (r.prezzo === null) {
      errori.push(incompleta(r, i.numeroRiga))
      continue
    }
    righe.push(
      riga(r, r.prezzo, quantita, `${base} ${testoPeriodo(i.periodo)}`, {
        tipo: 'PERIODO_CANONE',
        chiaveCompetenza: chiave,
      })
    )
  }
  return { righe, errori, avvisi }
}
