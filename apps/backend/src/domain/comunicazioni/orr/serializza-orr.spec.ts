import { readFileSync } from 'fs'
import { join } from 'path'
import { codificaCp1252 } from '../fisso/codifica-cp1252'
import { registroTracciati } from '../registro-tracciati'
import {
  CODIFICA_ORR,
  FINE_RIGA_ORR,
  LUNGHEZZA_RECORD_ORR,
  MOLTIPLICATORE_QUANTITA_ORR,
  VERSIONE_ORR,
} from './costanti'
import { LAYOUT_ORR, type DatiFileOrr, type RecordOrr } from './record-orr'
import {
  quantitaOrr,
  serializzaFileOrr,
  serializzaRecordOrr,
  TracciatoOrr,
  validaFileOrr,
} from './serializza-orr'

const FIXTURES = join(__dirname, '__fixtures__')
const golden = readFileSync(join(FIXTURES, 'orr-sintetico.txt'))
const campi: Array<{ campo: string; offset: number; lunghezza: number }> = JSON.parse(
  readFileSync(join(FIXTURES, 'orr-campi.json'), 'utf8')
)

const soggetto = (n: Partial<Record<string, string>> = {}) => ({
  ragioneSociale: 'Rossi Imballaggi S.r.l.',
  codice: '01234567890',
  indirizzoSedeLegale: 'Via Roma, 12',
  capSedeLegale: '80100',
  istatSedeLegale: '063049',
  indirizzoUnitaLocale: 'Via Napoli, 3',
  capUnitaLocale: '80100',
  istatUnitaLocale: '063049',
  ...n,
})

const impianto = {
  ragioneSociale: 'Impianto Società Verde S.r.l.',
  codice: '11223344556',
  indirizzoSedeLegale: 'Corso Umberto, 5',
  capSedeLegale: '80133',
  istatSedeLegale: '063049',
  indirizzoUnitaLocale: 'Z.I. Asi, 8',
  capUnitaLocale: '81025',
  istatUnitaLocale: '061053',
  autorizzazioneData: '2019-06-10',
  autorizzazioneNumero: 'AUT-2019-0042',
  tipoImpianto: 'STO',
}

const REC_T: RecordOrr = {
  movimento: '1/2025',
  movimentoId: 'mov-1',
  anno: 2025,
  mese: 1,
  formulario: 'AB1234567890123',
  dataFormulario: '2025-01-15',
  tipoDichiarante: 'TRA',
  cer: '150110',
  quantitaKg: 1250.5,
  destinazione: 'D15',
  detentore: { ...soggetto(), ateco: '38.21.09', tipo: 'PRO' },
  trasportatore: {
    ...soggetto({
      ragioneSociale: 'Trasporti Veloci S.p.A.',
      codice: '09876543210',
      indirizzoSedeLegale: 'Via Appia, 100',
      capSedeLegale: '81100',
      istatSedeLegale: '061022',
      indirizzoUnitaLocale: 'Via Kennedy, 7',
      capUnitaLocale: '81100',
      istatUnitaLocale: '061022',
    }),
    alboData: '2020-03-15',
    alboNumero: 'NA012345',
    alboClassi: '1 2 4',
  },
  destinatario: impianto,
}

const REC_S: RecordOrr = {
  movimento: '2/2025',
  movimentoId: 'mov-2',
  anno: 2025,
  mese: 1,
  formulario: 'CD9876543210987',
  dataFormulario: '2025-01-20',
  tipoDichiarante: 'STO',
  cer: '200201',
  quantitaKg: 300.25,
  destinazione: 'R13',
  detentore: {
    ragioneSociale: 'Verdi & Figli Costruzioni',
    codice: '05544332211',
    indirizzoSedeLegale: 'Via Toledo, 200',
    capSedeLegale: '80134',
    istatSedeLegale: '063049',
    indirizzoUnitaLocale: 'Via del Mare, 1',
    capUnitaLocale: '80070',
    istatUnitaLocale: '063003',
    ateco: '41.20.00',
    tipo: 'PRO',
  },
  trasportatore: null,
  destinatario: impianto,
}

describe('golden O.R.R. (D15)', () => {
  it('1. il serializzatore produce il golden byte per byte dopo la codifica', () => {
    // Il golden ha un record `TRA` e uno `STO`: si serializzano i record singoli.
    const testoFile = serializzaRecordOrr(REC_T) + serializzaRecordOrr(REC_S)
    const buf = codificaCp1252(testoFile)
    expect(buf.length).toBe(1436)
    expect(buf.equals(golden)).toBe(true)
  })

  it('2. tagliando il golden con gli offset del JSON si ottengono i valori attesi', () => {
    const r1 = golden.subarray(0, LUNGHEZZA_RECORD_ORR)
    const cut = (nome: string, rec: Buffer = r1) => {
      const c = campi.find(x => x.campo === nome)
      if (!c) throw new Error(nome)
      return rec.subarray(c.offset - 1, c.offset - 1 + c.lunghezza).toString('latin1')
    }
    expect(cut('a1')).toBe('2025')
    expect(cut('a3')).toBe('AB1234567890123')
    expect(cut('a4')).toBe('20250115')
    expect(cut('a5')).toBe('TRA')
    expect(cut('b1')).toBe('150110')
    expect(cut('b2')).toBe('00001250500')
    expect(cut('b3')).toBe('   ')
    expect(cut('b4')).toBe('D15')
    expect(cut('c1')).toBe('0')
    expect(cut('c2').trimEnd()).toBe('Rossi Imballaggi S.r.l.')
    expect(cut('c4')).toBe('00000000')
    expect(cut('c12')).toBe('38.21.09')
    expect(cut('c13')).toBe('PRO')
    expect(cut('d1')).toBe('0')
    expect(cut('d12')).toBe('20200315')
    expect(cut('d13').trimEnd()).toBe('NA012345')
    expect(cut('d14').trimEnd()).toBe('1 2 4')
    expect(cut('e1').trimEnd()).toBe('Impianto Società Verde S.r.l.'.replace('à', '\xe0'))
    expect(cut('e11')).toBe('20190610')
    expect(cut('e12').trimEnd()).toBe('AUT-2019-0042')
    expect(cut('e13')).toBe('STO')
    expect(cut('F1')).toBe('\r\n')
    // secondo record: nessun trasporto
    const r2 = golden.subarray(LUNGHEZZA_RECORD_ORR)
    expect(cut('d1', r2)).toBe('1')
    expect(cut('d2', r2).trim()).toBe('')
    expect(cut('d12', r2)).toBe('        ')
    expect(cut('d4', r2)).toBe('00000000')
    expect(cut('a5', r2)).toBe('STO')
    expect(cut('b4', r2)).toBe('R13')
  })

  it('3. la tabella di layout coincide con il JSON copiato dal documento', () => {
    expect(
      LAYOUT_ORR.map(c => ({ campo: c.nome, offset: c.offset + 1, lunghezza: c.lunghezza }))
    ).toEqual(campi)
    expect(LAYOUT_ORR.reduce((s, c) => s + c.lunghezza, 0)).toBe(718)
  })
})

describe('serializzazione O.R.R.', () => {
  it('ogni record e di 718 byte dopo la codifica, anche con testi lunghi e accenti', () => {
    const lungo: RecordOrr = {
      ...REC_T,
      detentore: {
        ...(REC_T.detentore as NonNullable<RecordOrr['detentore']>),
        ragioneSociale: 'Società à ' + 'x'.repeat(80),
        indirizzoSedeLegale: 'Via ' + 'y'.repeat(100),
      },
    }
    expect(validaFileOrr({ attivita: 'TRA', record: [lungo] })).toEqual([])
    const buf = codificaCp1252(serializzaFileOrr({ attivita: 'TRA', record: [lungo, REC_T] }))
    expect(buf.length).toBe(2 * LUNGHEZZA_RECORD_ORR)
    expect(buf.subarray(LUNGHEZZA_RECORD_ORR - 2, LUNGHEZZA_RECORD_ORR).toString('latin1')).toBe(
      '\r\n'
    )
  })

  it('detentore privato: c1 = 1, campi del detentore vuoti, riservati a zeri', () => {
    const r = serializzaRecordOrr({ ...REC_T, detentore: null })
    const f = (n: string) => {
      const c = campi.find(x => x.campo === n)!
      return r.slice(c.offset - 1, c.offset - 1 + c.lunghezza)
    }
    expect(f('c1')).toBe('1')
    expect(f('c2').trim()).toBe('')
    expect(f('c4')).toBe('00000000')
    expect(f('c12').trim()).toBe('')
    expect(f('c13')).toBe('PRO')
  })

  it('un carattere fuori da Windows-1252 e un errore bloccante con movimento e campo', () => {
    const errori = validaFileOrr({
      attivita: 'TRA',
      record: [{ ...REC_T, destinatario: { ...impianto, ragioneSociale: 'Impianto 日本' } }],
    })
    expect(
      errori.some(
        e =>
          e.includes('Movimento 1/2025') &&
          e.includes('destinatario.ragioneSociale') &&
          e.includes('Windows-1252')
      )
    ).toBe(true)
    expect(() =>
      serializzaFileOrr({
        attivita: 'TRA',
        record: [{ ...REC_T, destinatario: { ...impianto, ragioneSociale: '日本' } }],
      })
    ).toThrow()
  })

  it('quantita: kg x 1000 a 11 cifre con zeri, senza errori di virgola mobile', () => {
    expect(MOLTIPLICATORE_QUANTITA_ORR).toBe(1000)
    expect(quantitaOrr(1250.5)).toBe(1250500)
    expect(quantitaOrr(0.001)).toBe(1)
    expect(quantitaOrr(1.005)).toBe(1005)
    expect(quantitaOrr(0.0015)).toBe(2)
  })

  it('quantita oltre 11 cifre o negativa: errore', () => {
    const e1 = validaFileOrr({ attivita: 'TRA', record: [{ ...REC_T, quantitaKg: 100_000_000 }] })
    expect(e1.some(e => e.includes('quantità'))).toBe(true)
    const e2 = validaFileOrr({ attivita: 'TRA', record: [{ ...REC_T, quantitaKg: -1 }] })
    expect(e2.some(e => e.includes('quantità'))).toBe(true)
  })
})

describe('controlli bloccanti (controlladati)', () => {
  const errori = (r: Partial<RecordOrr>, attivita: DatiFileOrr['attivita'] = 'TRA') =>
    validaFileOrr({ attivita, record: [{ ...REC_T, ...r }] })

  it('nessun errore sul record completo', () => {
    expect(validaFileOrr({ attivita: 'TRA', record: [REC_T] })).toEqual([])
    expect(validaFileOrr({ attivita: 'STO', record: [REC_S] })).toEqual([])
  })
  it('file vuoto', () => {
    expect(validaFileOrr({ attivita: 'TRA', record: [] })).toEqual(['Nessun record da comunicare'])
  })
  it('manca il formulario, oppure supera 15 caratteri', () => {
    expect(errori({ formulario: ' ' }).join()).toContain('manca il numero del formulario')
    expect(errori({ formulario: 'X'.repeat(16) }).join()).toContain('oltre 15 caratteri')
  })
  it('autorizzazione del destinatario: numero e data', () => {
    expect(errori({ destinatario: { ...impianto, autorizzazioneNumero: '' } }).join()).toContain(
      "numero dell'autorizzazione"
    )
    expect(errori({ destinatario: { ...impianto, autorizzazioneData: null } }).join()).toContain(
      "data dell'autorizzazione"
    )
  })
  it('iscrizione Albo del trasportatore: numero, data, classi', () => {
    const t = REC_T.trasportatore!
    expect(errori({ trasportatore: { ...t, alboNumero: '' } }).join()).toContain(
      "numero di iscrizione all'Albo"
    )
    expect(errori({ trasportatore: { ...t, alboData: null } }).join()).toContain(
      "data di iscrizione all'Albo"
    )
    expect(errori({ trasportatore: { ...t, alboClassi: '' } }).join()).toContain('classi')
  })
  it('partita IVA/CF, indirizzi, CAP e ISTAT di produttore, trasportatore e destinatario', () => {
    const det = REC_T.detentore!
    expect(errori({ detentore: { ...det, codice: '' } }).join()).toContain('produttore partita IVA')
    expect(errori({ detentore: { ...det, indirizzoSedeLegale: '' } }).join()).toContain(
      'produttore indirizzo della sede legale'
    )
    expect(errori({ detentore: { ...det, capUnitaLocale: '8010' } }).join()).toContain(
      'produttore CAP'
    )
    expect(errori({ detentore: { ...det, istatSedeLegale: '' } }).join()).toContain(
      'produttore codice ISTAT della sede legale'
    )
    expect(errori({ destinatario: { ...impianto, istatUnitaLocale: '' } }).join()).toContain(
      'destinatario codice ISTAT'
    )
    expect(
      errori({ trasportatore: { ...REC_T.trasportatore!, capSedeLegale: 'x' } }).join()
    ).toContain('trasportatore CAP')
  })
  it('ATECO del produttore: NN.NN.NN oppure 00', () => {
    const det = REC_T.detentore!
    expect(errori({ detentore: { ...det, ateco: '' } }).join()).toContain('ATECO')
    expect(errori({ detentore: { ...det, ateco: '382109' } }).join()).toContain('ATECO')
    expect(errori({ detentore: { ...det, ateco: '00' } })).toEqual([])
  })
  it('autodemolitore (AUT): bloccante, i dati di pedana non si gestiscono', () => {
    expect(
      validaFileOrr({ attivita: 'AUT', record: [{ ...REC_S, tipoDichiarante: 'AUT' }] }).join()
    ).toContain('Autodemolitore')
  })
  it('un record con tipo dichiarante diverso dal file e un errore', () => {
    expect(validaFileOrr({ attivita: 'STO', record: [REC_T] }).join()).toContain('tipo dichiarante')
  })
  it('il CER deve avere 6 cifre', () => {
    expect(errori({ cer: '1501' }).join()).toContain('CER')
  })
})

describe('registro e inferenze O.R.R.', () => {
  it('il tracciato e registrato come RICAVATO_WINWASTE, Windows-1252, versione xrec718-ww1', () => {
    expect(VERSIONE_ORR).toBe('xrec718-ww1')
    expect(CODIFICA_ORR).toBe('windows-1252')
    expect(FINE_RIGA_ORR).toBe('\r\n')
    expect(TracciatoOrr.affidabilita).toBe('RICAVATO_WINWASTE')
    expect(TracciatoOrr.notaAffidabilita).toContain('da confermare con un file reale')
    expect(registroTracciati.get('ORR', VERSIONE_ORR)).toBe(TracciatoOrr)
  })
  it('MOLTIPLICATORE_QUANTITA_ORR e un parametro isolato (kg -> g)', () => {
    expect(MOLTIPLICATORE_QUANTITA_ORR).toBe(1000)
  })
})
