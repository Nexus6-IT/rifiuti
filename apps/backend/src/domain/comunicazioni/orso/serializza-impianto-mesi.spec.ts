import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML } from 'xmllint-wasm'
import { registroTracciati } from '../registro-tracciati'
import { RegistroTracciati } from '../tracciato-comunicazione'
import type { ImpiantoMesiDati } from './impianto-mesi'
import {
  escapeXml,
  serializzaImpiantoMesi,
  TracciatoOrsoImpiantoMesi,
  validaImpiantoMesi,
} from './serializza-impianto-mesi'

const XSD = readFileSync(join(__dirname, '__fixtures__', 'ImpiantoMesi.xsd'), 'utf8')

async function validaControXsd(xml: string) {
  return validateXML({ xml: [{ fileName: 'f.xml', contents: xml }], schema: [XSD] })
}

const completo = (): ImpiantoMesiDati => ({
  autore: 'WasteFlow',
  anni: [
    {
      anno: 2026,
      mesi: [
        {
          mese: 1,
          ricevuti: [
            {
              cer: '170904',
              descrizione: 'Rifiuti misti & "inerti" <test>',
              operazioni: ['R13', 'D15'],
              trattato: '1.5',
              ingressi: [
                { q: '12.345', f: 1, ts: 'C', s: '015146' },
                { q: '1.5', f: 0, ts: 'Tot', s: '0' },
                { q: '0.2', f: 1, ts: 'Extra', s: '0' },
              ],
            },
          ],
          prodotti: [
            {
              cer: '150106',
              descrizione: 'Imballaggi',
              quantitaTrattataInternamente: '0',
              uscite: [{ q: '3.1', ts: 'Tot', s: '0' }],
            },
          ],
        },
        { mese: 2, ricevuti: [], prodotti: [] },
      ],
    },
  ],
})

describe('serializzaImpiantoMesi', () => {
  it("produce un XML valido contro l'XSD ufficiale", async () => {
    const dati = completo()
    dati.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '15146'
    const xml = serializzaImpiantoMesi(dati)
    const r = await validaControXsd(xml)
    expect(r.errors.map(e => e.rawMessage)).toEqual([])
    expect(r.valid).toBe(true)
  })

  it('usa namespace, attributo autore e punto decimale', () => {
    const dati = completo()
    dati.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '15146'
    const xml = serializzaImpiantoMesi(dati)
    expect(xml).toContain(
      '<ImpiantoMesi xmlns="https://orso.arpalombardia.it/schemi/ImpiantoMesi.xsd" autore="WasteFlow">'
    )
    expect(xml).toContain('q="12.345" f="1" ts="C" s="15146"')
    expect(xml).toContain('QuantitaTrattataInternamente="0"')
    expect(xml).toContain('<Trattato>1.5</Trattato>')
  })

  it('omette autore se assente e rende il mese vuoto come nodo senza figli', async () => {
    const xml = serializzaImpiantoMesi({
      anni: [{ anno: 2026, mesi: [{ mese: 3, ricevuti: [], prodotti: [] }] }],
    })
    expect(xml).not.toContain('autore')
    expect(xml).toContain('<Mese value="3"></Mese>')
    expect((await validaControXsd(xml)).valid).toBe(true)
  })

  it('protegge la descrizione con escape (& < > " \')', () => {
    const dati = completo()
    dati.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '1'
    const xml = serializzaImpiantoMesi(dati)
    expect(xml).toContain(
      '<Descrizione>Rifiuti misti &amp; &quot;inerti&quot; &lt;test&gt;</Descrizione>'
    )
  })

  it("l'escape toglie i caratteri di controllo non ammessi da XML 1.0 e tiene gli accenti", () => {
    expect(escapeXml("a\u0000b\u0008c'è")).toBe('abc&apos;è')
  })

  it('mette Operazione prima di Trattato e In per ultimo, come impone la sequenza XSD', () => {
    const dati = completo()
    dati.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '1'
    const xml = serializzaImpiantoMesi(dati)
    const r = xml.slice(xml.indexOf('<RifiutoRicevuto'))
    expect(r.indexOf('<Operazione>')).toBeLessThan(r.indexOf('<Trattato>'))
    expect(r.indexOf('<Trattato>')).toBeLessThan(r.indexOf('<In '))
  })

  it('lancia sui dati non validi invece di produrre un file scorretto', () => {
    const dati = completo()
    dati.anni[0].mesi[0].ricevuti[0].cer = '17090'
    expect(() => serializzaImpiantoMesi(dati)).toThrow(/CER non valido/)
  })
})

describe('controllo di sanità del validatore XSD', () => {
  it('rifiuta un XML che viola lo schema (CER a 5 cifre)', async () => {
    const xml = serializzaImpiantoMesi(completo()).replace('CER="170904"', 'CER="17090"')
    expect((await validaControXsd(xml)).valid).toBe(false)
  })
})

describe('validaImpiantoMesi', () => {
  const base = (): ImpiantoMesiDati => {
    const d = completo()
    d.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '1'
    return d
  }

  it('è vuota per dati corretti', () => {
    expect(validaImpiantoMesi(base())).toEqual([])
  })

  it.each([
    ['anno fuori intervallo', (d: ImpiantoMesiDati) => void (d.anni[0].anno = 1899), /Anno 1899/],
    ['mese 13', (d: ImpiantoMesiDati) => void (d.anni[0].mesi[1].mese = 13), /mese non valido/],
    [
      'mese duplicato',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[1].mese = 1),
      /mese duplicato/,
    ],
    [
      'descrizione oltre 100',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].ricevuti[0].descrizione = 'x'.repeat(101)),
      /descrizione/,
    ],
    [
      'descrizione vuota',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].prodotti[0].descrizione = '  '),
      /descrizione/,
    ],
    [
      'operazione non ammessa',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].ricevuti[0].operazioni = ['R14']),
      /operazione R14/,
    ],
    [
      'quantità con virgola',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].ricevuti[0].ingressi[0].q = '1,5'),
      /quantità non valida/,
    ],
    [
      'uscita a zero',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].prodotti[0].uscite[0].q = '0.000'),
      /zero non ammesso/,
    ],
    [
      'identificativo ingresso oltre 9 cifre',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].ricevuti[0].ingressi[0].s = '1234567890'),
      /identificativo/,
    ],
    [
      'tipo soggetto uscita Extra',
      (d: ImpiantoMesiDati) =>
        void ((d.anni[0].mesi[0].prodotti[0].uscite[0] as { ts: string }).ts = 'Extra'),
      /tipo soggetto/,
    ],
    [
      'trattato negativo',
      (d: ImpiantoMesiDati) => void (d.anni[0].mesi[0].ricevuti[0].trattato = '-1'),
      /trattata/,
    ],
  ])('segnala %s', (_n, muta, atteso) => {
    const d = base()
    muta(d)
    expect(validaImpiantoMesi(d).join('|')).toMatch(atteso)
  })

  it('segnala assenza di anni e anno senza mesi', () => {
    expect(validaImpiantoMesi({ anni: [] })).toContain('Nessun anno presente')
    expect(validaImpiantoMesi({ anni: [{ anno: 2026, mesi: [] }] }).join()).toMatch(/nessun mese/)
  })
})

describe('registro dei tracciati', () => {
  it('espone O.R.SO. ImpiantoMesi-1', () => {
    expect(registroTracciati.get('ORSO', 'ImpiantoMesi-1')).toBe(TracciatoOrsoImpiantoMesi)
    expect(registroTracciati.versioni('ORSO')).toEqual(['ImpiantoMesi-1'])
  })

  it('lancia su tracciato sconosciuto o doppio', () => {
    expect(() => registroTracciati.get('CONOU', 'x')).toThrow(/non disponibile/)
    expect(() =>
      new RegistroTracciati()
        .registra(TracciatoOrsoImpiantoMesi)
        .registra(TracciatoOrsoImpiantoMesi)
    ).toThrow(/già registrato/)
  })
})
