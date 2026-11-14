import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML } from 'xmllint-wasm'
import { aggregatoDettagliatoInImpiantoMesi } from './adatta-orso'
import { aggregaOrsoDettagliata } from './aggrega-orso-dettagliata'
import type { MovimentoOrso, SoggettoOrso } from './aggregato'
import { serializzaImpiantoMesi } from './serializza-impianto-mesi'

// Golden SINTETICO scritto a mano dal tracciato (XSD ImpiantoMesi + doc WinWaste orso-dettagliata):
// non nasce da un file reale e non è mai stato generato dal serializzatore.
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__', 'orso-dettagliata-sintetico.xml'),
  'utf8'
)
const XSD = readFileSync(join(__dirname, '__fixtures__', 'ImpiantoMesi.xsd'), 'utf8')

const nuovo = (
  chiave: string,
  o: Partial<Extract<SoggettoOrso, { tipo: 'Inew' }>['impianto']>
): SoggettoOrso => ({
  tipo: 'Inew',
  chiave,
  impianto: {
    ragioneSociale: 'x',
    codfisPiva: '01234567890',
    indirizzoUL: { provincia: '015', comune: '146' },
    ...o,
  },
})

function mov(o: Partial<MovimentoOrso>): MovimentoOrso {
  return {
    id: 'm',
    mese: 3,
    verso: 'CARICO',
    ruoloMud: 'RICEVUTO_DA_TERZI',
    cer: '17 04 05',
    descrizione: 'Ferro e acciaio',
    quantita: 1,
    unita: 'KG',
    kgPerUnita: null,
    operazione: 'R13',
    conFir: false,
    provinciaConferitore: 'MI',
    ...o,
  }
}

const MOVIMENTI: MovimentoOrso[] = [
  mov({ id: 'a', quantita: 250, soggetto: { tipo: 'C', istat: '015146' }, conFir: true }),
  mov({ id: 'b', quantita: 1500, soggetto: { tipo: 'I', codice: '100' }, conFir: true }),
  mov({ id: 'c', quantita: 500, soggetto: { tipo: 'I', codice: '100' } }),
  mov({
    id: 'd',
    quantita: 100,
    soggetto: nuovo('s1', {
      ragioneSociale: 'Acciaierie  Nord S.r.l.',
      formaSocietaria: 'SRL',
      indirizzoSL: {
        tipo: 'Via',
        nome: 'Roma',
        civico: '12',
        cap: '20100',
        provincia: '015',
        comune: '146',
      },
      indirizzoUL: { nome: 'Via Po', civico: '3/B', cap: '24100', provincia: '016', comune: '024' },
    }),
  }),
  mov({
    id: 'e',
    verso: 'SCARICO',
    ruoloMud: 'AVVIATO',
    quantita: 800,
    soggetto: { tipo: 'I', codice: '55' },
  }),
  mov({
    id: 'f',
    verso: 'SCARICO',
    ruoloMud: 'AVVIATO',
    quantita: 200,
    soggetto: { tipo: 'I', codice: '55' },
  }),
  mov({
    id: 'g',
    verso: 'SCARICO',
    ruoloMud: 'AVVIATO',
    quantita: 50,
    soggetto: nuovo('s2', {
      ragioneSociale: 'Riciclo Sud',
      codfisPiva: 'VRDMRA70A01F205X',
      indirizzoUL: { provincia: '063', comune: '049' },
    }),
  }),
]

describe('aggregatoDettagliatoInImpiantoMesi + serializzatore: golden sintetico', () => {
  const agg = aggregaOrsoDettagliata(MOVIMENTI, {
    anno: 2026,
    provinciaImpianto: 'MI',
    ultimoMese: 3,
    giacenze: [{ mese: 3, cer: '170405', descrizione: 'Ferro e acciaio', kg: 120 }],
  })
  const dati = aggregatoDettagliatoInImpiantoMesi(agg, 'WasteFlow', 3)

  it('il file coincide con il golden byte per byte', () => {
    expect(agg.bloccato).toBe(false)
    expect(serializzaImpiantoMesi(dati)).toBe(GOLDEN)
  })

  it("il golden è valido contro l'XSD", async () => {
    const r = await validateXML({ xml: [{ fileName: 'g.xml', contents: GOLDEN }], schema: [XSD] })
    expect(r.errors.map(e => e.rawMessage)).toEqual([])
    expect(r.valid).toBe(true)
  })

  it('non scrive Tot ed Extra', () => {
    const xml = serializzaImpiantoMesi(dati)
    expect(xml).not.toMatch(/ts="(Tot|Extra)"/)
  })

  it('un’uscita di quantità zero non entra nel file (l’XSD non la ammette)', () => {
    const a = aggregaOrsoDettagliata(
      [
        mov({
          id: 'z',
          verso: 'SCARICO',
          ruoloMud: 'AVVIATO',
          quantita: 0,
          soggetto: { tipo: 'I', codice: '9' },
        }),
      ],
      { anno: 2026, provinciaImpianto: 'MI' }
    )
    const d = aggregatoDettagliatoInImpiantoMesi(a, undefined, 3)
    expect(d.anni[0].mesi[2].prodotti[0].uscite).toEqual([])
    expect(d.nuoviImpianti).toBeUndefined()
  })
})
