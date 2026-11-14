import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { codificaCp1252 } from '../fisso/codifica-cp1252'
import type { RigaConou } from './riga-conou'
import { LAYOUT_CONOU, TracciatoConou, validaRigaConou } from './serializza-conou'

const golden = readFileSync(join(__dirname, '__fixtures__', 'conou-sintetico.txt'))
const campi: Array<{ campo: string; offset: number; lunghezza: number }> = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'conou-campi.json'), 'utf8')
)

const base: RigaConou = {
  riferimento: '1/2026',
  cfDetentore: '01234567890',
  cap: '24100',
  partitaIva: '01234567890',
  ragioneSociale: 'OFFICINA ROSSI SRL',
  indirizzo: 'VIA ROMA',
  civico: '12',
  provincia: 'BG',
  comune: 'BERGAMO',
  ateco: '45.20.10',
  istat: '003016024',
  codiceDeposito: 'BG001',
  dataRegistrazione: '2026-03-10',
  serie: 'ABC',
  numero: '123',
  anno: '2026',
  dataFormulario: '2026-03-09',
  cfTrasportatore: '09876543210',
  targa: 'AB123CD',
  cer: '130205',
  percentualeX100: 8499,
  protocollo: 17,
  quantitaKg: 1500,
  prodotto: 'A',
  causale: 'E',
}
const righe: RigaConou[] = [
  base,
  {
    ...base,
    riferimento: '2/2026',
    cfDetentore: '10987654321',
    cap: '20100',
    partitaIva: '10987654321',
    ragioneSociale: 'REOIL SPA',
    indirizzo: 'VIA DEI RIGENERATORI',
    civico: '1',
    provincia: 'MI',
    comune: 'MILANO',
    ateco: '19.20.29',
    istat: '003015146',
    dataRegistrazione: '2026-03-12',
    numero: '124',
    dataFormulario: '2026-03-12',
    protocollo: 18,
    quantitaKg: 2000,
    causale: 'U',
  },
  {
    ...base,
    riferimento: '3/2026',
    cfDetentore: '02345678901',
    cap: '25121',
    partitaIva: '02345678901',
    ragioneSociale: 'Officina Bianchi di Città',
    indirizzo: 'PIAZZA DELLA LIBERTA',
    civico: '3/B',
    provincia: 'BS',
    comune: 'BRESCIA',
    istat: '003017029',
    dataRegistrazione: '2026-03-15',
    numero: '125',
    dataFormulario: '2026-03-14',
    cfTrasportatore: '08765432109',
    targa: 'XY987ZT',
    cer: '130206',
    percentualeX100: 6000,
    protocollo: 19,
    quantitaKg: -300,
    causale: 'U',
  },
]

describe('TracciatoConou: golden sintetico (D15)', () => {
  it('1. il serializzatore produce il golden byte per byte dopo la codifica', () => {
    const file = TracciatoConou.serializza({ righe })
    expect(codificaCp1252(file).equals(golden)).toBe(true)
  })

  it('2. tagliando il golden con gli offset del JSON si ottengono i valori attesi', () => {
    const righeGolden = golden.toString('latin1').split('\r\n').filter(Boolean)
    expect(righeGolden).toHaveLength(3)
    for (const r of righeGolden) expect(r).toHaveLength(299)
    const campo = (riga: string, nome: string) => {
      const c = campi.find(x => x.campo === nome)!
      return riga.slice(c.offset - 1, c.offset - 1 + c.lunghezza).trimEnd()
    }
    expect(campo(righeGolden[0], 'cfDetentore')).toBe('01234567890')
    expect(campo(righeGolden[0], 'istat')).toBe('003016024')
    expect(campo(righeGolden[0], 'dataRegistrazione')).toBe('20260310')
    expect(campo(righeGolden[0], 'percentualeX100')).toBe('8499')
    expect(campo(righeGolden[0], 'protocollo')).toBe('17')
    expect(campo(righeGolden[0], 'quantitaKg')).toBe('1500')
    expect(campo(righeGolden[0], 'prodotto')).toBe('A')
    expect(campo(righeGolden[0], 'causale')).toBe('E')
    expect(campo(righeGolden[1], 'causale')).toBe('U')
    expect(campo(righeGolden[2], 'quantitaKg')).toBe('-300')
    expect(campo(righeGolden[2], 'ragioneSociale')).toBe('Officina Bianchi di Città')
    // `à` e' il byte 0xE0 (non UTF-8).
    expect(golden.includes(0xe0)).toBe(true)
    expect(golden.includes(0xc3)).toBe(false)
  })

  it('3. la tabella di layout coincide con il JSON copiato dal documento WinWaste', () => {
    expect(
      LAYOUT_CONOU.map(c => ({ campo: c.nome, offset: c.offset + 1, lunghezza: c.lunghezza }))
    ).toEqual(campi)
  })
})

describe('TracciatoConou: forma del file', () => {
  it('descrive il tracciato (D7)', () => {
    expect(TracciatoConou).toMatchObject({
      consorzio: 'CONOU',
      versione: 'Movi2023-ww1',
      estensione: 'txt',
      contentType: 'text/plain; charset=windows-1252',
      codifica: 'windows-1252',
      affidabilita: 'RICAVATO_WINWASTE',
    })
  })
  it('ogni riga ha 299 caratteri e finisce in CRLF, senza intestazione ne totale', () => {
    const file = TracciatoConou.serializza({ righe })
    const parti = file.split('\r\n')
    expect(parti).toHaveLength(4)
    expect(parti[3]).toBe('')
    for (const p of parti.slice(0, 3)) expect(p).toHaveLength(299)
  })
  it('lunghezza in byte dopo la codifica: 299 per riga + 2 di CRLF', () => {
    expect(codificaCp1252(TracciatoConou.serializza({ righe })).length).toBe(3 * 301)
  })
  it('un testo troppo lungo si tronca alla lunghezza del campo', () => {
    const lunga = { ...base, ragioneSociale: 'X'.repeat(90) }
    const riga = TracciatoConou.serializza({ righe: [lunga] }).split('\r\n')[0]
    expect(riga).toHaveLength(299)
    expect(riga.slice(32, 92)).toBe('X'.repeat(60))
  })
  it('la targa si scrive senza spazi', () => {
    const riga = TracciatoConou.serializza({ righe: [{ ...base, targa: 'AB 123 CD' }] })
    expect(riga.slice(260, 268)).toBe('AB123CD ')
  })
  it('lancia se i dati non sono validi', () => {
    expect(() => TracciatoConou.serializza({ righe: [{ ...base, prodotto: 'Z' }] })).toThrow()
  })
})

describe('validaDati (ComunicazioneCou2023.Controlla)', () => {
  const errori = (r: Partial<RigaConou>) => validaRigaConou({ ...base, ...r })
  it('una riga corretta non ha errori', () => expect(errori({})).toEqual([]))
  it.each([
    [{ cfDetentore: '' }, 'Manca Codice Fiscale Detentore'],
    [{ ateco: '' }, 'Manca Codice ATECO'],
    [{ istat: '016024' }, 'Codice ISTAT Comune errato'],
    [{ istat: '016' }, 'Codice ISTAT Comune errato'],
    [{ codiceDeposito: 'AB' }, 'Codice deposito errato'],
    [{ serie: 'ABCDEFG' }, 'Serie formulario di lunghezza errata'],
    [{ numero: '12345678901' }, 'Numero formulario di lunghezza errata'],
    [{ anno: '26' }, 'Anno formulario errato'],
    [{ protocollo: 0 }, 'Manca protocollo registro'],
    [{ prodotto: 'F' }, 'Codice prodotto errato'],
    [{ causale: 'X' }, 'Causale Conou errata'],
    [{ serie: '' }, 'Manca Serie Formulario'],
    [{ numero: '' }, 'Manca Numero Formulario'],
    [{ cfTrasportatore: '' }, 'Manca Codice Fiscale Trasportatore'],
    [{ targa: '  ' }, 'Manca Targa'],
    [{ percentualeX100: 10000 }, 'Percentuale olio errata'],
    [{ quantitaKg: 0 }, 'Quantita errata'],
  ] as Array<[Partial<RigaConou>, string]>)('%j -> %s', (patch, atteso) => {
    expect(errori(patch).join('|')).toContain(atteso)
  })
  it('per le causali M, D, L trasportatore e formulario non sono obbligatori', () => {
    expect(
      errori({ causale: 'M', serie: '', numero: '', anno: '', cfTrasportatore: '', targa: '' })
    ).toEqual([])
  })
  it('un carattere fuori da Windows-1252 blocca, con il campo (D6)', () => {
    const e = errori({ ragioneSociale: 'Officina 北京' })
    expect(e.join('|')).toContain('ragioneSociale')
    expect(e.join('|')).toContain('non rappresentabile')
  })
  it('nessuna riga: errore', () => {
    expect(TracciatoConou.validaDati({ righe: [] })).toHaveLength(1)
  })
  it('gli errori portano numero di riga e movimento', () => {
    const e = TracciatoConou.validaDati({
      righe: [base, { ...base, riferimento: '9/2026', prodotto: 'Z' }],
    })
    expect(e[0]).toMatch(/^Riga 2 \(9\/2026\)/)
  })
})
