import { Prisma } from '@prisma/client'
import { etichettaTipo } from '../listino/tipi-addebito'
import { importoRiga, prezzoCalcolato, quantitaDaMovimento } from '../listino/importi-riga'
import { normalizzaUnitaRegistro } from '../waste-movement/unita-misura-registro'
import type { ErroreDocumento, Segnalazione } from './codici'
import { testoPeriodo, type EsitoRighe, type RigaSenzaLinea } from './esito-righe'
import { giornoFestivo } from './festivi'
import type { RigaLegameDaFatturare, RigaListinoDaFatturare } from './tipi'

/**
 * Righe `TT` e `TF` a prezzo singolo (decisione 17): peso dei movimenti in kg (una volta per
 * legame). Ogni altra riga in ingresso è ignorata (la segnala il Task 5).
 * Nei dettagli degli errori «riga n» è la posizione a partire da 1 della riga nell'array `righe`
 * in ingresso (stessa convenzione di `righeDaLegami`, nell'ordine del chiamante). Una riga senza
 * prezzo dà RIGA_LEGAME_INCOMPLETA.
 */
export function righeQuantitaMovimenti(i: {
  righe: readonly RigaListinoDaFatturare[]
  legami: readonly RigaLegameDaFatturare[]
  periodo: { dal: string; al: string }
  /** Numero della riga nei dettagli degli errori (default: posizione da 1 nell'array `righe`). */
  numeroRiga?: (id: string) => number
}): EsitoRighe {
  const righe: RigaSenzaLinea[] = []
  const errori: Segnalazione<ErroreDocumento>[] = []

  // Un legame può avere più righe: il movimento conta una sola volta.
  const perLegame = new Map<string, RigaLegameDaFatturare>()
  for (const l of i.legami) if (!perLegame.has(l.legameId)) perLegame.set(l.legameId, l)
  const legami = [...perLegame.values()]

  i.righe.forEach((r, indice) => {
    if ((r.tipo !== 'TT' && r.tipo !== 'TF') || r.prezzoSpeciale) return
    // L'allegato non ha movimenti propri: confluisce nel documento del principale (decisione 5).
    let scelti = r.daAllegato ? legami : legami.filter(l => l.elencoId === r.elencoId)
    if (r.tipo === 'TF') scelti = scelti.filter(l => giornoFestivo(l.dataMovimento))

    let base = new Prisma.Decimal(0)
    for (const l of scelti) {
      const fattore = normalizzaUnitaRegistro(l.unitaMovimento).fattoreKg
      if (fattore === null) {
        errori.push({
          codice: 'UM_NON_UNIVOCA',
          dettaglio: `${r.tipo} riga ${i.numeroRiga?.(r.id) ?? indice + 1}`,
        })
        return
      }
      base = base.plus(new Prisma.Decimal(l.quantitaMovimento).times(fattore))
    }
    if (base.isZero()) return

    const quantita = quantitaDaMovimento('PESO_NETTO', r.unitaMisura, { netto: base.toFixed() })
    if (quantita === null) return
    if (r.prezzo === null) {
      errori.push({
        codice: 'RIGA_LEGAME_INCOMPLETA',
        dettaglio: `${r.tipo} riga ${i.numeroRiga?.(r.id) ?? indice + 1}`,
      })
      return
    }
    const prezzo = r.prezzo
    const imp = importoRiga(quantita, prezzo, r.sconto)
    righe.push({
      tipoRiga: 'QUANTITA_MOVIMENTI',
      legameId: null,
      rigaLegameId: null,
      rigaAddebitoId: r.id,
      descrizione: `${r.descrizione ?? etichettaTipo(r.tipo)} ${testoPeriodo(i.periodo)}`,
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
    })
  })
  return { righe, errori, avvisi: [] }
}
