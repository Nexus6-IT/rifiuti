import { cerCanonico } from '../../domain/waste-movement/cer-registro'
import type { MudAggregato } from './aggregazione/mud-aggregazione.service'
import type { MudRifiutoLine } from './export/mud-export.types'

// Totali del MUD (D22): funzione pura condivisa dal riepilogo dell'anno e dalla vista Bilancio.
// Parte dalle dichiarazioni dell'aggregato (una per unità locale) e dà gli stessi numeri che il
// file scrive nei record BA: prodotto, avviato a recupero e a smaltimento, giacenze al 31/12.

export interface SommeMud {
  prodottoKg: number
  recuperoKg: number
  smaltimentoKg: number
  giacenzaRecuperoKg: number
  giacenzaSmaltimentoKg: number
  movimenti: number
}

export interface VoceTotaliMud extends SommeMud {
  /** CER canonico (`17 04 05`), con `*` se pericoloso */
  cerCode: string
  pericoloso: boolean
}

export interface TotaliDichiarazioneMud {
  codice: string
  unitaLocale: { id: string | null; denominazione: string; numIscrSito: string | null }
  perCer: VoceTotaliMud[]
  totali: SommeMud
}

export interface TotaliMud {
  anno: number
  versioneCalcolo: number
  /** somma per CER di tutte le dichiarazioni, in ordine di CER (con una sola dichiarazione, quello delle sue righe) */
  perCer: VoceTotaliMud[]
  dichiarazioni: TotaliDichiarazioneMud[]
  totali: SommeMud
}

const arrotondaGrammo = (n: number): number => Math.round(n * 1000) / 1000

const somme = (): SommeMud => ({
  prodottoKg: 0,
  recuperoKg: 0,
  smaltimentoKg: 0,
  giacenzaRecuperoKg: 0,
  giacenzaSmaltimentoKg: 0,
  movimenti: 0,
})

function aggiungi(a: SommeMud, b: SommeMud): void {
  a.prodottoKg += b.prodottoKg
  a.recuperoKg += b.recuperoKg
  a.smaltimentoKg += b.smaltimentoKg
  a.giacenzaRecuperoKg += b.giacenzaRecuperoKg
  a.giacenzaSmaltimentoKg += b.giacenzaSmaltimentoKg
  a.movimenti += b.movimenti
}

const alGrammo = (s: SommeMud): SommeMud => ({
  prodottoKg: arrotondaGrammo(s.prodottoKg),
  recuperoKg: arrotondaGrammo(s.recuperoKg),
  smaltimentoKg: arrotondaGrammo(s.smaltimentoKg),
  giacenzaRecuperoKg: arrotondaGrammo(s.giacenzaRecuperoKg),
  giacenzaSmaltimentoKg: arrotondaGrammo(s.giacenzaSmaltimentoKg),
  movimenti: s.movimenti,
})

const voceDellaRiga = (riga: MudRifiutoLine, movimenti: number): SommeMud => ({
  prodottoKg: riga.prodottoKg,
  recuperoKg: riga.recuperoKg,
  smaltimentoKg: riga.smaltimentoKg,
  giacenzaRecuperoKg: riga.giacenzaRecuperoKg ?? 0,
  giacenzaSmaltimentoKg: riga.giacenzaSmaltimentoKg ?? 0,
  movimenti,
})

const etichettaCer = (cer6: string, pericoloso: boolean): string =>
  cerCanonico(pericoloso ? `${cer6}*` : cer6)

interface Sorgente {
  codice: string
  unitaLocale: { id: string | null; denominazione: string; numIscrSito: string | null }
  righe: MudRifiutoLine[]
  movimentiPerCer: Record<string, number>
  pericolosiPerCer: Record<string, true>
}

/**
 * Totali dell'aggregato: per dichiarazione e per CER, e in testa la somma di tutte le
 * dichiarazioni. Tutto al grammo. Un aggregato senza dichiarazioni (vecchio o vuoto) vale come
 * una dichiarazione sola fatta delle sue righe.
 */
export function totaliMud(aggregato: MudAggregato): TotaliMud {
  const sorgenti: Sorgente[] =
    (aggregato.dichiarazioni ?? []).length > 0
      ? aggregato.dichiarazioni
      : [
          {
            codice: '000000000000001',
            unitaLocale: { id: null, denominazione: '', numIscrSito: null },
            righe: aggregato.righe,
            movimentiPerCer: aggregato.movimentiPerCer,
            pericolosiPerCer: aggregato.pericolosiPerCer,
          },
        ]

  const testa = new Map<string, { somme: SommeMud; pericoloso: boolean }>()
  const totaleTesta = somme()

  const dichiarazioni = sorgenti.map(d => {
    const totale = somme()
    const perCer = d.righe.map(riga => {
      const s = voceDellaRiga(riga, d.movimentiPerCer[riga.cerCode] ?? 0)
      const pericoloso = d.pericolosiPerCer[riga.cerCode] === true
      aggiungi(totale, s)
      const t = testa.get(riga.cerCode) ?? { somme: somme(), pericoloso: false }
      aggiungi(t.somme, s)
      t.pericoloso = t.pericoloso || pericoloso
      testa.set(riga.cerCode, t)
      return {
        cerCode: etichettaCer(riga.cerCode, pericoloso),
        pericoloso,
        ...alGrammo(s),
      }
    })
    aggiungi(totaleTesta, totale)
    return {
      codice: d.codice,
      unitaLocale: {
        id: d.unitaLocale.id,
        denominazione: d.unitaLocale.denominazione,
        numIscrSito: d.unitaLocale.numIscrSito,
      },
      perCer,
      totali: alGrammo(totale),
    }
  })

  // una sola dichiarazione: l'ordine delle sue righe (già per CER); più sedi: per CER
  const voci = [...testa.entries()]
  if (sorgenti.length > 1) voci.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const perCer = voci.map(([cer6, t]) => ({
    cerCode: etichettaCer(cer6, t.pericoloso),
    pericoloso: t.pericoloso,
    ...alGrammo(t.somme),
  }))

  return {
    anno: aggregato.anno,
    versioneCalcolo: aggregato.versioneCalcolo,
    perCer,
    dichiarazioni,
    totali: alGrammo(totaleTesta),
  }
}
