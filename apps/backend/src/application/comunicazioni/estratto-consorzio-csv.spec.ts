import {
  cerLeggibile,
  estrattoConsorzioCsv,
  type RigaEstrattoConsorzio,
} from './estratto-consorzio-csv'

const riga = (o: Partial<RigaEstrattoConsorzio> = {}): RigaEstrattoConsorzio => ({
  data: '2026-06-15',
  numero: '12/2026',
  verso: 'CARICO',
  cer: '130205',
  pericoloso: true,
  descrizione: 'Olio motore',
  kg: 1250.5,
  quantita: 1250.5,
  unita: 'KG',
  controparte: 'Officina Rossi',
  indirizzoControparte: 'Via Roma 1, Bergamo (BG)',
  firNumero: 'FIR-77',
  origine: 'REGOLA',
  ...o,
})

describe('estrattoConsorzioCsv', () => {
  it('BOM, intestazione e una riga per movimento, separatore ; e decimali con la virgola', () => {
    const csv = estrattoConsorzioCsv('CONOU', [riga()])
    expect(csv.startsWith('﻿"Consorzio";"Data";"Numero";"Anno";"Verso";"CER"')).toBe(true)
    const linee = csv.split('\r\n')
    expect(linee).toHaveLength(3)
    expect(linee[1]).toBe(
      '"CONOU";"15/06/2026";"12";"2026";"Carico";"13 02 05*";"Olio motore";"1250,5";"1250,5";"KG";"Officina Rossi";"Via Roma 1, Bergamo (BG)";"FIR-77";"Regola"'
    )
    expect(linee[2]).toBe('')
  })

  it('senza righe resta la sola intestazione', () => {
    expect(estrattoConsorzioCsv('COBAT', []).split('\r\n')).toHaveLength(2)
  })

  it('kg non convertibili lasciano la cella vuota, i campi assenti pure', () => {
    const l = estrattoConsorzioCsv('CONOU', [
      riga({ kg: null, firNumero: null, controparte: null, descrizione: null }),
    ]).split('\r\n')[1]
    expect(l).toContain(';"";"1250,5";')
    expect(l).toContain('"";"Regola"')
  })

  it('numero e anno stanno in due colonne: «12/2026» sarebbe letto da Excel come una data', () => {
    const l = estrattoConsorzioCsv('CONOU', [riga({ numero: '7/2025' })]).split('\r\n')[1]
    expect(l).toContain('"7";"2025"')
    expect(l).not.toContain('7/2025')
  })

  it('numero FIR e unità, scritti a mano, sono protetti dalle formule', () => {
    const l = estrattoConsorzioCsv('CONOU', [riga({ firNumero: '=1+1', unita: '@SUM(A1)' })]).split(
      '\r\n'
    )[1]
    expect(l).toContain('"\'=1+1"')
    expect(l).toContain('"\'@SUM(A1)"')
  })

  it('protegge i testi dalle formule di Excel e raddoppia i doppi apici', () => {
    const l = estrattoConsorzioCsv('CONOU', [
      riga({
        controparte: '=HYPERLINK("http://x")',
        descrizione: 'Olio "usato"',
        origine: 'MANUALE',
      }),
    ]).split('\r\n')[1]
    expect(l).toContain('"\'=HYPERLINK(""http://x"")"')
    expect(l).toContain('"Olio ""usato"""')
    expect(l.endsWith('"Manuale"')).toBe(true)
  })

  it('cerLeggibile', () => {
    expect(cerLeggibile('160601', true)).toBe('16 06 01*')
    expect(cerLeggibile('200301', false)).toBe('20 03 01')
  })
})
