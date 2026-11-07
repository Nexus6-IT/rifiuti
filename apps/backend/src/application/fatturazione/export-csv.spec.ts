import type { FotografiaDocumento } from '../../domain/fatturazione/tipi'
import {
  cellaCsv,
  cellaTestoCsv,
  dataCsv,
  importoCsv,
  righeCsv,
  testateCsv,
  type DocumentoPerExport,
} from './export-csv'
import type { DocumentoDettaglio, RigaDocumentoVista } from './documenti-fattura.service'

const riga = (n: number, extra: Partial<RigaDocumentoVista> = {}): RigaDocumentoVista => ({
  numeroLinea: n,
  tipoRiga: 'MOVIMENTO',
  legameId: null,
  rigaAddebitoId: null,
  descrizione: 'Rifiuti "speciali"; non pericolosi',
  dataMovimento: '2026-03-10',
  cerCode: '20 03 01',
  numeroFir: null,
  quantita: '100.000',
  unitaMisura: 'kg',
  prezzoUnitario: '1.5000',
  sconto: null,
  importoLordo: '150.00',
  importoSconto: '0.00',
  prezzoTotale: '150.00',
  aliquotaIva: '22.00',
  naturaIva: null,
  ...extra,
})

function doc(
  extra: Partial<DocumentoDettaglio> = {},
  righe = [riga(1), riga(2)]
): DocumentoPerExport {
  const documento = {
    id: 'd1',
    stato: 'DEFINITIVO',
    tipoDocumento: 'TD01',
    numeroTesto: '12',
    dataDocumento: '2026-03-15',
    cliente: { id: 'c1', denominazione: 'Rossi & "Figli" SRL' },
    contratto: { id: 'k1', numero: 'C-1' },
    registro: { id: 'r1', codice: '01' },
    totaleImponibile: '300.00',
    totaleIva: '66.00',
    totaleDocumento: '1234.50',
    errori: [],
    avvisi: [],
    esclusoDaDefinitiva: false,
    emessoIl: null,
    annullabile: true,
    motivoNonAnnullabile: null,
    stornabile: true,
    righe,
    riepiloghi: [],
    rate: [],
    nettoAPagare: '1234.50',
    bolloDovuto: false,
    importoBollo: null,
    versione: 1,
    documentoOrigineId: null,
    stornoId: null,
    xmlGenerato: false,
    ...extra,
  } as DocumentoDettaglio
  return {
    documento,
    numero: 12,
    anno: 2026,
    registroCodice: '01',
    fotografia: {
      cessionario: { partitaIva: '01234567890', codiceFiscale: null },
    } as unknown as FotografiaDocumento,
  }
}

describe('celle del CSV', () => {
  it('cellaCsv raddoppia i doppi apici e racchiude la cella', () => {
    expect(cellaCsv('a"b')).toBe('"a""b"')
    expect(cellaCsv(null)).toBe('""')
    expect(cellaCsv('x;y\r\nz')).toBe('"x;y\r\nz"')
  })
  it('importoCsv usa la virgola e nessun separatore delle migliaia', () => {
    expect(importoCsv('1234.50')).toBe('1234,50')
    expect(importoCsv('-0.5')).toBe('-0,5')
    expect(importoCsv('7')).toBe('7')
  })
  it('dataCsv rende gg/mm/aaaa', () => {
    expect(dataCsv('2026-11-05')).toBe('05/11/2026')
  })
  it('cellaTestoCsv neutralizza le formule dei fogli di calcolo', () => {
    expect(cellaTestoCsv('=SOMMA(A1)')).toBe('"\'=SOMMA(A1)"')
    expect(cellaTestoCsv('+39 02')).toBe('"\'+39 02"')
    expect(cellaTestoCsv('@x')).toBe('"\'@x"')
    expect(cellaTestoCsv('Rossi')).toBe('"Rossi"')
    expect(cellaTestoCsv(null)).toBe('""')
  })
})

describe('testate.csv e righe.csv', () => {
  it('testate comincia con il BOM e ha l intestazione in prima riga, righe con \\r\\n', () => {
    const s = testateCsv([doc()])
    expect(s.startsWith('﻿"Numero";')).toBe(true)
    const linee = s.split('\r\n')
    expect(linee).toHaveLength(3) // intestazione, documento, coda vuota
    expect(linee[2]).toBe('')
    expect(linee[0].split(';').length).toBe(linee[1].split(';').length)
  })
  it('testate: importi con la virgola, date gg/mm/aaaa, stato e cliente', () => {
    const [, l] = testateCsv([doc()]).split('\r\n')
    expect(l).toContain('"1234,50"')
    expect(l).toContain('"15/03/2026"')
    expect(l).toContain('"DEFINITIVO"')
    expect(l).toContain('"Rossi & ""Figli"" SRL"')
    expect(l).toContain('"01234567890"')
  })
  it('ANNULLATO esportato con lo stato; bozza senza numero', () => {
    const a = testateCsv([doc({ stato: 'ANNULLATO' })])
    expect(a).toContain('"ANNULLATO"')
    const b = testateCsv([doc({ stato: 'BOZZA', numeroTesto: null })])
    expect(b.split('\r\n')[1].startsWith('"";')).toBe(true)
  })
  it('testate non scrive emesso_il (S18)', () => {
    const s = testateCsv([doc({ emessoIl: '2026-03-16T10:00:00.000Z' })])
    expect(s).not.toContain('2026-03-16')
    expect(s).not.toContain('16/03/2026')
    expect(s.toLowerCase()).not.toContain('emess')
  })
  it('righe ripete numero, data e cliente su ogni linea', () => {
    const linee = righeCsv([doc()]).split('\r\n')
    expect(linee).toHaveLength(4)
    for (const l of [linee[1], linee[2]]) {
      expect(l.startsWith('"12";"15/03/2026";"Rossi & ""Figli"" SRL";')).toBe(true)
    }
    expect(linee[1]).toContain('"Rifiuti ""speciali""; non pericolosi"')
    expect(linee[1]).toContain('"100,000"')
    expect(linee[1]).toContain('"10/03/2026"')
    expect(linee[0].split(';').length).toBe(18)
  })
  it('righe: il numero FIR passa dalla protezione delle formule', () => {
    const l = righeCsv([doc({}, [riga(1, { numeroFir: '=CMD()' })])]).split('\r\n')[1]
    expect(l).toContain('"\'=CMD()"')
  })
  it('righe: documento senza righe produce solo l intestazione', () => {
    expect(righeCsv([doc({}, [])]).split('\r\n')).toHaveLength(2)
  })
})
