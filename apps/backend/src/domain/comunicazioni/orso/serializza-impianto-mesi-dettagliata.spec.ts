import { readFileSync } from 'fs'
import { join } from 'path'
import { validateXML } from 'xmllint-wasm'
import { registroTracciati } from '../registro-tracciati'
import type { ImpiantoMesiDati } from './impianto-mesi'
import {
  serializzaImpiantoMesi,
  TracciatoOrsoImpiantoMesiDettagliata,
  validaImpiantoMesi,
} from './serializza-impianto-mesi'

const XSD = readFileSync(join(__dirname, '__fixtures__', 'ImpiantoMesi.xsd'), 'utf8')
const valida = (xml: string) =>
  validateXML({ xml: [{ fileName: 'f.xml', contents: xml }], schema: [XSD] })

const dettagliato = (): ImpiantoMesiDati => ({
  autore: 'WasteFlow',
  anni: [
    {
      anno: 2026,
      mesi: [
        {
          mese: 3,
          ricevuti: [
            {
              cer: '170904',
              descrizione: 'Rifiuti misti',
              operazioni: ['R13'],
              ingressi: [
                { q: '4.5', f: 1, ts: 'I', s: '123456' },
                { q: '2', f: 0, ts: 'C', s: '015146' },
                { q: '1.25', f: 1, ts: 'Inew', s: '1' },
              ],
            },
          ],
          prodotti: [
            {
              cer: '150106',
              descrizione: 'Imballaggi',
              quantitaTrattataInternamente: '0.5',
              uscite: [
                { q: '3', ts: 'Inew', s: '2' },
                { q: '1', ts: 'I', s: '777' },
              ],
            },
          ],
        },
      ],
    },
  ],
  nuoviImpianti: [
    {
      id: 1,
      ragioneSociale: 'Rossi & Figli S.r.l.',
      formaSocietaria: 'SRL',
      codfisPiva: '01234567890',
      indirizzoSL: {
        tipo: 'Via',
        nome: 'Roma',
        civico: '12',
        cap: '20100',
        provincia: '015',
        comune: '146',
      },
      indirizzoUL: { nome: 'Via Po', civico: '3/B', cap: '24100', provincia: '016', comune: '024' },
    },
    {
      id: 2,
      ragioneSociale: 'Verdi Ambiente',
      codfisPiva: 'VRDMRA70A01F205X',
      indirizzoUL: { provincia: '000', comune: '008' },
    },
  ],
})

describe('serializzazione O.R.SO. dettagliata (NuovoImpianto)', () => {
  it("produce un XML con In per soggetto e due NuovoImpianto, valido contro l'XSD", async () => {
    const xml = serializzaImpiantoMesi(dettagliato())
    const r = await valida(xml)
    expect(r.errors.map(e => e.rawMessage)).toEqual([])
    expect(r.valid).toBe(true)
    expect(xml).toContain('<In q="4.5" f="1" ts="I" s="123456"/>')
    expect(xml).toContain('<In q="2" f="0" ts="C" s="015146"/>')
    expect(xml).toContain('<Out q="3" ts="Inew" s="2"/>')
    expect(xml).toContain(
      '<NuovoImpianto id="1" RagioneSociale="Rossi &amp; Figli S.r.l." FormaSocietaria="SRL" CodfisPIVA="01234567890">'
    )
    expect(xml).toContain(
      '<IndirizzoSL Tipo="Via" Nome="Roma" Civico="12" CAP="20100" Provincia="015" Comune="146"/>'
    )
    expect(xml).toContain('<IndirizzoUL Provincia="000" Comune="008"/>')
  })

  it('i NuovoImpianto vengono dopo gli Anno e in ordine di id', () => {
    const d = dettagliato()
    d.nuoviImpianti = [...(d.nuoviImpianti ?? [])].reverse()
    const xml = serializzaImpiantoMesi(d)
    expect(xml.indexOf('</Anno>')).toBeLessThan(xml.indexOf('<NuovoImpianto'))
    expect(xml.indexOf('NuovoImpianto id="1"')).toBeLessThan(xml.indexOf('NuovoImpianto id="2"'))
  })

  it('senza nuovi impianti non scrive nulla in più (modalità normale invariata)', () => {
    const d = dettagliato()
    d.anni[0].mesi[0].ricevuti[0].ingressi.pop()
    d.anni[0].mesi[0].prodotti[0].uscite.shift()
    d.nuoviImpianti = []
    expect(serializzaImpiantoMesi(d)).not.toContain('NuovoImpianto')
  })

  it('ogni s di un Inew ha il suo NuovoImpianto', () => {
    const d = dettagliato()
    d.nuoviImpianti = d.nuoviImpianti?.slice(0, 1)
    expect(validaImpiantoMesi(d).join('|')).toMatch(/Inew 2.*NuovoImpianto/)
  })

  it('ogni NuovoImpianto è usato da almeno un Inew', () => {
    const d = dettagliato()
    d.anni[0].mesi[0].prodotti[0].uscite = [{ q: '1', ts: 'I', s: '777' }]
    expect(validaImpiantoMesi(d).join('|')).toMatch(/NuovoImpianto 2.*non è usato/)
  })

  it('id duplicati, ragione sociale vuota, codice fiscale corto, ISTAT e CAP malformati sono errori', () => {
    const d = dettagliato()
    const [a, b] = d.nuoviImpianti ?? []
    d.nuoviImpianti = [
      {
        ...a,
        ragioneSociale: '  ',
        codfisPiva: '123',
        indirizzoUL: { provincia: '15', comune: '1460', cap: '2010' },
      },
      { ...b, id: 1 },
    ]
    const e = validaImpiantoMesi(d).join('|')
    expect(e).toMatch(/id duplicato/)
    expect(e).toMatch(/ragione sociale/)
    expect(e).toMatch(/codice fiscale/)
    expect(e).toMatch(/provincia/)
    expect(e).toMatch(/comune/)
    expect(e).toMatch(/CAP/)
  })

  it('il civico oltre 5 caratteri è un errore (limite WinWaste, più stretto dell’XSD)', () => {
    const d = dettagliato()
    if (d.nuoviImpianti) d.nuoviImpianti[0].indirizzoUL.civico = '123456'
    expect(validaImpiantoMesi(d).join('|')).toMatch(/civico/)
  })

  it('un identificativo Out non numerico o di 10 cifre è un errore', () => {
    const d = dettagliato()
    d.anni[0].mesi[0].prodotti[0].uscite[1] = { q: '1', ts: 'I', s: '1234567890' }
    expect(validaImpiantoMesi(d).join('|')).toMatch(/uscita 2.*identificativo/)
  })

  it('il tracciato dettagliato è registrato, ufficiale, con la nota sui soggetti', () => {
    const t = registroTracciati.get('ORSO', 'ImpiantoMesi-1-dettagliata')
    expect(t).toBe(TracciatoOrsoImpiantoMesiDettagliata)
    expect(t.affidabilita).toBe('UFFICIALE')
    expect(t.notaAffidabilita).toMatch(/identificazione dei soggetti ricavata da WinWaste/)
    expect(t.contentType).toBe('application/xml')
  })
})
