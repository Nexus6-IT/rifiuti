import { controllaCoerenzaSdi, prezzoTotaleSdi } from './controlli-sdi'
import { calcolaDocumento } from './calcola-documento'
import {
  azzeraContatoreLegami,
  contrattoDi,
  inputDocumentoDi,
  IVA_N1,
  IVA_N4,
  legameDi,
  listinoDi,
} from '../../test-support/calcolo-fatturazione-di-test'

describe('prezzoTotaleSdi', () => {
  it('senza sconti: prezzo × quantita a 8 decimali', () => {
    expect(prezzoTotaleSdi('0.1', '1000', [])).toBe('100.00000000')
  })
  it('sconti a cascata in ordine: 10 · 0.9 · 0.95 · 3 = 25.65', () => {
    expect(prezzoTotaleSdi('10', '3', ['10', '5'])).toBe('25.65000000')
  })
  it('arrotonda a otto decimali, meta per eccesso', () => {
    expect(prezzoTotaleSdi('0.000001', '1.5', [])).toBe('0.00000150')
    expect(prezzoTotaleSdi('0.123456789', '1', [])).toBe('0.12345679')
  })
})

describe('controllaCoerenzaSdi', () => {
  beforeEach(azzeraContatoreLegami)

  const documentoBase = () =>
    calcolaDocumento(
      inputDocumentoDi({
        righeListino: [listinoDi({ id: 'r1', tipo: 'CER' })],
        legami: [
          legameDi({ quantita: '1000', prezzo: '0.1', sconto: '10+5' }),
          legameDi({ quantita: '250', prezzo: '0.2' }),
        ],
      })
    )

  it('documento costruito con le funzioni dei Task 2-4: nessun errore', () => {
    const d = documentoBase()
    expect(d.errori).toEqual([])
    expect(controllaCoerenzaSdi(d)).toEqual([])
  })

  it('PrezzoTotale alterato di 0.02: IMPORTI_NON_COERENTI (00423); di 0.01: tollerato', () => {
    const d = documentoBase()
    const alterato = (delta: string) =>
      controllaCoerenzaSdi({
        ...d,
        righe: d.righe.map((r, k) =>
          k === 0 ? { ...r, prezzoTotale: (Number(r.prezzoTotale) + Number(delta)).toFixed(2) } : r
        ),
      })
    expect(alterato('0.02')).toEqual([
      { codice: 'IMPORTI_NON_COERENTI', dettaglio: 'PrezzoTotale riga 1 (controllo 00423)' },
    ])
    expect(alterato('0.01')).toEqual([])
  })

  it('Imposta alterata di 0.02: 00421', () => {
    const d = documentoBase()
    const e = controllaCoerenzaSdi({
      ...d,
      riepiloghi: d.riepiloghi.map(r => ({
        ...r,
        imposta: (Number(r.imposta) + 0.02).toFixed(2),
      })),
      totaleDocumento: (Number(d.totaleDocumento) + 0.02).toFixed(2),
    })
    expect(e).toHaveLength(1)
    expect(e[0].dettaglio).toContain('00421')
  })

  it('ImponibileImporto oltre 1,00 dalla somma delle righe: 00422; entro 1,00: tollerato', () => {
    const d = documentoBase()
    const con = (delta: number) =>
      controllaCoerenzaSdi({
        ...d,
        riepiloghi: d.riepiloghi.map(r => ({
          ...r,
          imponibile: (Number(r.imponibile) + delta).toFixed(2),
          imposta: r.imposta,
        })),
        totaleDocumento: (Number(d.totaleDocumento) + delta).toFixed(2),
      }).filter(x => x.dettaglio?.includes('00422'))
    expect(con(1.01)).toHaveLength(1)
    expect(con(1.0)).toHaveLength(0)
  })

  it('ImportoTotaleDocumento diverso dalla somma dei riepiloghi', () => {
    const d = documentoBase()
    const e = controllaCoerenzaSdi({ ...d, totaleDocumento: '0.01' })
    expect(e).toHaveLength(1)
    expect(e[0].codice).toBe('IMPORTI_NON_COERENTI')
  })

  it('riga senza il suo riepilogo IVA: errore', () => {
    const d = documentoBase()
    expect(controllaCoerenzaSdi({ ...d, riepiloghi: [], totaleDocumento: '0.00' })).toHaveLength(1)
  })

  it('bollo dovuto e non addebitato: totaleDocumento = Σ (imponibile + imposta), coerente', () => {
    const d = calcolaDocumento(
      inputDocumentoDi({
        righeListino: [listinoDi({ id: 'r1', tipo: 'CER', codiceIva: IVA_N4 })],
        legami: [
          legameDi({
            quantita: '1000',
            prezzo: '0.1',
            codiceIvaId: 'ivaN4',
            aliquotaIva: '0.00',
            naturaIva: 'N4',
          }),
        ],
        contratto: contrattoDi({ bollo: null }),
      })
    )
    expect(d.bolloDovuto).toBe(true)
    expect(d.importoBollo).toBe('2.00')
    expect(d.avvisi.map(a => a.codice)).toContain('BOLLO_NON_ADDEBITATO')
    expect(d.righe.some(r => r.tipoRiga === 'BOLLO')).toBe(false)
    expect(d.totaleDocumento).toBe('100.00')
    expect(controllaCoerenzaSdi(d)).toEqual([])
  })

  it('bollo addebitato: riga N1 nei riepiloghi, contato una volta (102.00, non 104.00)', () => {
    const d = calcolaDocumento(
      inputDocumentoDi({
        righeListino: [listinoDi({ id: 'r1', tipo: 'CER', codiceIva: IVA_N4 })],
        legami: [
          legameDi({
            quantita: '1000',
            prezzo: '0.1',
            codiceIvaId: 'ivaN4',
            aliquotaIva: '0.00',
            naturaIva: 'N4',
          }),
        ],
        contratto: contrattoDi({ bollo: { importo: '2.00', codiceIva: IVA_N1 } }),
      })
    )
    expect(d.errori).toEqual([])
    const bolli = d.righe.filter(r => r.tipoRiga === 'BOLLO')
    expect(bolli).toHaveLength(1)
    expect(bolli[0].prezzoTotale).toBe('2.00')
    expect(d.riepiloghi.find(r => r.natura === 'N1')?.imponibile).toBe('2.00')
    expect(d.riepiloghi.find(r => r.natura === 'N4')?.imponibile).toBe('100.00')
    expect(d.importoBollo).toBe('2.00')
    expect(d.totaleDocumento).toBe('102.00')
    expect(d.totaleDocumento).not.toBe('104.00')
    expect(controllaCoerenzaSdi(d)).toEqual([])
    // Con il bollo contato due volte il controllo lo segnala.
    expect(controllaCoerenzaSdi({ ...d, totaleDocumento: '104.00' })).toHaveLength(1)
  })
})
