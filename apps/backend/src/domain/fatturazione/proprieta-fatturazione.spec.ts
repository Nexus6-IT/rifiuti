import { Prisma } from '@prisma/client'
import { importoRiga } from '../listino/importi-riga'
import { creaGeneratore } from '../../test-support/generatore-casuale'
import {
  azzeraContatoreLegami,
  contrattoDi,
  inputDocumentoDi,
  IVA_N1,
  legameDi,
  listinoDi,
} from '../../test-support/calcolo-fatturazione-di-test'
import { calcolaDocumento } from './calcola-documento'
import { TOLLERANZE_SDI } from './costanti-fiscali'
import { prezzoTotaleSdi } from './controlli-sdi'

const CASI = 20000
const SEME = 20261105

/** q: 0.001-99999.999 (3 decimali); p: 0.000001-9999.999999 (6); da 0 a 3 sconti fino a 99.99. */
function casoRiga(g: ReturnType<typeof creaGeneratore>) {
  const quantita = g.decimale(1, 99999999, 3)
  const prezzo = g.decimale(1, 9999999999, 6)
  const sconti = Array.from({ length: g.intero(0, 3) }, () => g.decimale(1, 9999, 2))
  return { quantita, prezzo, sconti, sconto: sconti.length === 0 ? null : sconti.join('+') }
}

describe('proprieta del calcolo (seme fisso)', () => {
  it(`${CASI} casi: |netto - prezzoTotaleSdi| <= 0.01`, () => {
    const g = creaGeneratore(SEME)
    let peggiore = new Prisma.Decimal(0)
    for (let k = 0; k < CASI; k++) {
      const c = casoRiga(g)
      const netto = importoRiga(c.quantita, c.prezzo, c.sconto).netto
      const sdi = prezzoTotaleSdi(c.prezzo, c.quantita, c.sconti)
      const diff = new Prisma.Decimal(netto).minus(sdi).abs()
      if (diff.greaterThan(TOLLERANZE_SDI.prezzoTotale)) {
        throw new Error(
          `Fuori tolleranza: q=${c.quantita} p=${c.prezzo} sconti=${c.sconti.join('+')} netto=${netto} sdi=${sdi}`
        )
      }
      if (diff.greaterThan(peggiore)) peggiore = diff
    }
    expect(peggiore.lessThanOrEqualTo(TOLLERANZE_SDI.prezzoTotale)).toBe(true)
  })

  it(`${CASI} documenti: Σ rate = netto a pagare, Σ righe = Σ imponibili, nessun errore di importi`, () => {
    const g = creaGeneratore(SEME + 1)
    const nature = [
      { aliquota: '22.00', natura: null, id: 'iva22' },
      { aliquota: '10.00', natura: null, id: 'iva10' },
      { aliquota: '0.00', natura: 'N4', id: 'ivaN4' },
    ] as const
    for (let k = 0; k < CASI; k++) {
      azzeraContatoreLegami()
      const legami = Array.from({ length: g.intero(1, 3) }, () => {
        const c = casoRiga(g)
        const n = g.scegli(nature)
        return legameDi({
          quantita: c.quantita,
          prezzo: c.prezzo,
          sconto: c.sconto,
          codiceIvaId: n.id,
          aliquotaIva: n.aliquota,
          naturaIva: n.natura,
        })
      })
      const esigibilita = g.scegli(['I', 'D', 'S'] as const)
      const giorniRate = g.scegli([[30], [0], [30, 60], [30, 60, 90], [0, 30, 60, 90, 120]])
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [listinoDi({ id: 'r1', tipo: 'CER' })],
          legami,
          contratto: contrattoDi({
            esigibilita,
            condizione: { modalita: 'MP08', giorniRate, fineMese: g.intero(0, 1) === 1 },
            bollo: { importo: '2.00', codiceIva: IVA_N1 },
          }),
        })
      )
      const ctx = `caso ${k}: ${JSON.stringify(legami.map(l => [l.quantita, l.prezzo, l.sconto]))}`
      expect({ ctx, errori: d.errori.map(e => e.codice) }).toEqual({ ctx, errori: [] })
      const sommaRate = d.rate.reduce((s, r) => s.plus(r.importo), new Prisma.Decimal(0))
      expect({ ctx, v: sommaRate.toFixed(2) }).toEqual({ ctx, v: d.nettoAPagare })
      const sommaRighe = d.righe.reduce((s, r) => s.plus(r.prezzoTotale), new Prisma.Decimal(0))
      const sommaImponibili = d.riepiloghi.reduce(
        (s, r) => s.plus(r.imponibile),
        new Prisma.Decimal(0)
      )
      expect({ ctx, v: sommaRighe.toFixed(2) }).toEqual({ ctx, v: sommaImponibili.toFixed(2) })
    }
  })
})
