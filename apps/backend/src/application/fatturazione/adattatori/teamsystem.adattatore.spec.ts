import { BadRequestException } from '@nestjs/common'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FotografiaDocumento } from '../../../domain/fatturazione/tipi'
import type { DocumentoDettaglio, RataVista } from '../documenti-fattura.service'
import type { DocumentoPerExport } from '../export-csv'
import { chiaveMappatura } from './adattatore-export-contabile'
import { campoFisso, TeamSystemAdattatore } from './teamsystem.adattatore'

const RIFERIMENTO = join(__dirname, 'riferimenti', 'teamsystem-due-documenti.txt')

const rigaDoc = (
  n: number,
  tipoRiga: string,
  prezzoTotale: string,
  aliquotaIva: string,
  naturaIva: string | null = null
) => ({
  numeroLinea: n,
  tipoRiga,
  legameId: null,
  rigaAddebitoId: null,
  descrizione: 'riga',
  dataMovimento: null,
  cerCode: null,
  numeroFir: null,
  quantita: null,
  unitaMisura: null,
  prezzoUnitario: prezzoTotale,
  sconto: null,
  importoLordo: prezzoTotale,
  importoSconto: '0.00',
  prezzoTotale,
  aliquotaIva,
  naturaIva,
})

const rata = (
  ordine: number,
  modalita: string,
  dataScadenza: string,
  importo: string,
  extra: Partial<RataVista> = {}
): RataVista => ({
  ordine,
  modalita,
  dataScadenza,
  importo,
  istituto: null,
  iban: null,
  abi: null,
  cab: null,
  bic: null,
  ...extra,
})

interface Opzioni {
  tipo?: string
  numero?: number
  data?: string
  clienteId?: string
  denominazione?: string
  nome?: string | null
  cognome?: string | null
  partitaIva?: string | null
  codiceFiscale?: string | null
  pagamento?: string | null
  cig?: string | null
  cup?: string | null
  righe: ReturnType<typeof rigaDoc>[]
  riepiloghi: {
    aliquota: string
    natura: string | null
    imponibile: string
    imposta: string
    esigibilita?: 'I' | 'D' | 'S'
  }[]
  rate: RataVista[]
  totale: string
  totaleIva: string
  sede?: { indirizzo: string; cap: string; comune: string; provincia: string | null }
}

function documento(o: Opzioni): DocumentoPerExport {
  const d = {
    id: 'd1',
    stato: 'DEFINITIVO',
    tipoDocumento: o.tipo ?? 'TD01',
    numeroTesto: String(o.numero ?? 12),
    dataDocumento: o.data ?? '2026-11-05',
    cliente: { id: o.clienteId ?? 'c1', denominazione: o.denominazione ?? 'Cliente' },
    contratto: { id: 'k1', numero: 'C-1' },
    registro: { id: 'r1', codice: 'VEN' },
    totaleImponibile: '0.00',
    totaleIva: o.totaleIva,
    totaleDocumento: o.totale,
    righe: o.righe,
    riepiloghi: o.riepiloghi.map(r => ({
      esigibilita: 'I',
      riferimentoNormativo: null,
      ...r,
    })),
    rate: o.rate,
  } as unknown as DocumentoDettaglio
  return {
    documento: d,
    numero: o.numero ?? 12,
    anno: 2026,
    registroCodice: 'VEN',
    fotografia: {
      cedente: { denominazione: 'Eco Servizi Srl' },
      cessionario: {
        denominazione: o.nome ? null : (o.denominazione ?? 'Cliente'),
        nome: o.nome ?? null,
        cognome: o.cognome ?? null,
        partitaIva: o.partitaIva === undefined ? '01234567890' : o.partitaIva,
        codiceFiscale: o.codiceFiscale === undefined ? '01234567890' : o.codiceFiscale,
        sede: {
          nazione: 'IT',
          ...(o.sede ?? {
            indirizzo: 'Via Roma 12',
            cap: '20121',
            comune: 'Milano',
            provincia: 'MI',
          }),
        },
      },
      pagamento:
        o.pagamento === null
          ? null
          : {
              codice: o.pagamento ?? 'RIBA30',
              descrizione: 'Ri.Ba. 30 giorni',
              modalita: 'MP12',
              giorniRate: [30],
              fineMese: false,
            },
      conto: null,
      testoFatturazione: [],
      cig: o.cig === undefined ? null : o.cig,
      cup: o.cup === undefined ? null : o.cup,
      idDocumento: null,
    } as unknown as FotografiaDocumento,
  }
}

const docA = (): DocumentoPerExport =>
  documento({
    denominazione: 'Bianchi Rifiuti S.r.l.',
    cig: 'ABC1234567',
    cup: 'J12B34567890123',
    righe: [
      rigaDoc(1, 'MOVIMENTO', '100.00', '22.00'),
      rigaDoc(2, 'FISSO', '50.00', '22.00'),
      rigaDoc(3, 'MOVIMENTO', '30.00', '10.00'),
    ],
    riepiloghi: [
      { aliquota: '22.00', natura: null, imponibile: '150.00', imposta: '33.00' },
      { aliquota: '10.00', natura: null, imponibile: '30.00', imposta: '3.00' },
    ],
    rate: [
      rata(1, 'MP12', '2026-12-05', '108.00', {
        istituto: 'Banca Esempio',
        abi: '03069',
        cab: '09400',
      }),
      rata(2, 'MP12', '2027-01-05', '108.00', {
        istituto: 'Banca Esempio',
        abi: '03069',
        cab: '09400',
      }),
    ],
    totale: '216.00',
    totaleIva: '36.00',
  })

const docB = (): DocumentoPerExport =>
  documento({
    tipo: 'TD04',
    numero: 3,
    data: '2026-11-06',
    clienteId: 'c2',
    nome: 'Mario',
    cognome: 'Verdi',
    partitaIva: null,
    codiceFiscale: 'VRDMRA80A01H501Z',
    pagamento: 'BONIFICO',
    sede: { indirizzo: 'Via Appia 3', cap: '00100', comune: 'Roma', provincia: 'RM' },
    righe: [rigaDoc(1, 'MOVIMENTO', '40.00', '22.00')],
    riepiloghi: [{ aliquota: '22.00', natura: null, imponibile: '40.00', imposta: '8.80' }],
    rate: [rata(1, 'MP05', '2026-12-06', '48.80')],
    totale: '48.80',
    totaleIva: '8.80',
  })

const MAPPE = new Map<string, string>([
  [chiaveMappatura('REGISTRO', 'VEN'), '01'],
  [chiaveMappatura('CODICE_IVA', '22.00'), '022'],
  [chiaveMappatura('CODICE_IVA', '10.00'), '010'],
  [chiaveMappatura('CODICE_IVA', '0.00/N4'), '004'],
  [chiaveMappatura('CONTO_RICAVI', 'MOVIMENTO'), '5100001'],
  [chiaveMappatura('CONTO_RICAVI', 'FISSO'), '5100002'],
  [chiaveMappatura('CLIENTE', 'c1'), '00123'],
  [chiaveMappatura('CLIENTE', 'c2'), '00456'],
  [chiaveMappatura('PAGAMENTO', 'RIBA30'), '12'],
  [chiaveMappatura('PAGAMENTO', 'BONIFICO'), '7'],
])

const testo = (a: TeamSystemAdattatore, docs: DocumentoPerExport[], m = MAPPE): string => {
  const [file] = a.genera(docs, m)
  return file.contenuto.toString('latin1')
}

describe('campoFisso', () => {
  it('allinea a sinistra e riempie a destra', () => {
    expect(campoFisso('ABC', 5, 'S', ' ')).toBe('ABC  ')
  })
  it('allinea a destra e riempie a sinistra con zeri', () => {
    expect(campoFisso('12', 5, 'D', '0')).toBe('00012')
  })
  it('un valore piu lungo viene troncato', () => {
    expect(campoFisso('ABCDEFG', 5, 'S', ' ')).toBe('ABCDE')
    expect(campoFisso('1234567', 5, 'D', '0')).toBe('12345')
  })
})

describe('TeamSystemAdattatore', () => {
  const a = new TeamSystemAdattatore()

  it("e un adattatore a file, non verificato su un'installazione reale", () => {
    expect(a.codice).toBe('TEAMSYSTEM')
    expect(a.modalita).toBe('FILE')
    expect(a.verificato).toBe(false)
  })

  it('il file di due documenti (2 aliquote e una nota di credito) e uguale byte per byte al riferimento scritto a mano', () => {
    const atteso = readFileSync(RIFERIMENTO)
    const [file] = a.genera([docA(), docB()], MAPPE)
    expect(file.contenuto.length).toBe(atteso.length)
    expect(file.contenuto.equals(atteso)).toBe(true)
  })

  it('ogni riga ha la lunghezza del record e termina con CR LF', () => {
    const t = testo(a, [docA(), docB()])
    const righe = t.split('\r\n')
    expect(righe.pop()).toBe('')
    expect(righe).toHaveLength(4)
    for (const r of righe) expect(r).toHaveLength(7001)
    expect(righe[0].charAt(6)).toBe('0')
    expect(righe[1].charAt(6)).toBe('1')
  })

  it('TD04: causale 002, importi positivi, rate con segno meno', () => {
    const righe = testo(a, [docB()]).split('\r\n')
    expect(righe[0].slice(267, 270)).toBe('002')
    expect(righe[0].slice(270, 285)).toBe('NOTA CREDITO EM')
    expect(righe[0].slice(474, 486)).toBe('00000004000+')
    expect(righe[1].slice(2382, 2394)).toBe('00000004880-')
    expect(righe[1].slice(2405, 2417)).toBe('00000004880-')
  })

  it('TD01: causale 001 e rate con segno piu', () => {
    const righe = testo(a, [docA()]).split('\r\n')
    expect(righe[0].slice(267, 270)).toBe('001')
    expect(righe[1].slice(2405, 2417)).toBe('00000010800+')
  })

  it('un importo negativo di una riga esce con il segno meno in coda', () => {
    const d = docA()
    d.documento.righe[2] = rigaDoc(3, 'MOVIMENTO', '-30.00', '10.00') as never
    d.documento.riepiloghi[1] = {
      ...d.documento.riepiloghi[1],
      imponibile: '-30.00',
      imposta: '-3.00',
    }
    const r = testo(a, [d]).split('\r\n')[0]
    expect(r.slice(474 + 31, 474 + 31 + 12)).toBe('00000003000-')
    expect(r.slice(494 + 31, 494 + 31 + 11)).toBe('0000000300-')
  })

  it('mappature richieste: codici IVA, conti ricavi, cliente, pagamento e registro', () => {
    const chiavi = a.mappatureRichieste([docA(), docB()]).map(m => `${m.tipo}:${m.chiaveWasteflow}`)
    expect([...chiavi].sort()).toEqual(
      [
        'CLIENTE:c1',
        'CLIENTE:c2',
        'CODICE_IVA:10.00',
        'CODICE_IVA:22.00',
        'CONTO_RICAVI:FISSO',
        'CONTO_RICAVI:MOVIMENTO',
        'PAGAMENTO:BONIFICO',
        'PAGAMENTO:RIBA30',
        'REGISTRO:VEN',
      ].sort()
    )
    const etichette = a.mappatureRichieste([docA()]).map(m => m.etichetta)
    expect(etichette).toContain('IVA 22%')
    expect(etichette).toContain('Bianchi Rifiuti S.r.l.')
    expect(etichette.every(e => !/\bc1\b/.test(e))).toBe(true)
  })

  it("un'aliquota zero con natura ha la chiave aliquota/natura", () => {
    const d = documento({
      righe: [rigaDoc(1, 'FISSO', '10.00', '0.00', 'N4')],
      riepiloghi: [{ aliquota: '0.00', natura: 'N4', imponibile: '10.00', imposta: '0.00' }],
      rate: [],
      totale: '10.00',
      totaleIva: '0.00',
    })
    const iva = a.mappatureRichieste([d]).find(m => m.tipo === 'CODICE_IVA')
    expect(iva?.chiaveWasteflow).toBe('0.00/N4')
    expect(iva?.etichetta).toBe('IVA esente N4')
    const r = testo(a, [d], MAPPE).split('\r\n')[0]
    expect(r.slice(486, 489)).toBe('004')
  })

  it('i caratteri fuori ASCII sono normalizzati e il file resta ASCII', () => {
    const d = docA()
    d.fotografia.cessionario.denominazione = 'Società “Ambiente” è – Çà'
    d.fotografia.cessionario.sede.indirizzo = 'Via Dante\tAlighieri\n5 €'
    const [file] = a.genera([d], MAPPE)
    for (const byte of file.contenuto) expect(byte).toBeLessThan(128)
    const righe = file.contenuto.toString('latin1').split('\r\n')
    expect(righe[0]).toHaveLength(7001)
    expect(righe[0].slice(12, 44).trimEnd()).toBe('Societa "Ambiente" e - Ca')
    expect(righe[0].slice(44, 74).trimEnd()).toBe('Via Dante Alighieri 5 E')
  })

  it('un solo file, con nome e tipo di contenuto', () => {
    const files = a.genera([docA(), docB()], MAPPE)
    expect(files).toHaveLength(1)
    expect(files[0].nome).toBe('ECOS0511' + '0611')
    expect(files[0].contentType).toBe('text/plain; charset=windows-1252')
  })

  it('piu di 8 riepiloghi IVA: errore chiaro', () => {
    const d = docA()
    d.documento.riepiloghi = Array.from({ length: 9 }, (_, i) => ({
      aliquota: String(i + 1) + '.00',
      natura: null,
      imponibile: '1.00',
      imposta: '0.10',
      esigibilita: 'I' as const,
      riferimentoNormativo: null,
    }))
    const m = new Map(MAPPE)
    for (let i = 1; i <= 9; i++) m.set(chiaveMappatura('CODICE_IVA', `${i}.00`), '001')
    expect(() => a.genera([d], m)).toThrow(/riepiloghi IVA/)
  })

  it('un codice di mappatura non numerico o troppo lungo per il campo: errore chiaro', () => {
    const m = new Map(MAPPE)
    m.set(chiaveMappatura('CLIENTE', 'c1'), 'ABC')
    expect(() => a.genera([docA()], m)).toThrow(/cliente/i)
    const m2 = new Map(MAPPE)
    m2.set(chiaveMappatura('PAGAMENTO', 'RIBA30'), '1234')
    expect(() => a.genera([docA()], m2)).toThrow(/pagamento/i)
  })

  it("una mappatura mancante: errore (l'export la blocca prima con 409)", () => {
    const m = new Map(MAPPE)
    m.delete(chiaveMappatura('REGISTRO', 'VEN'))
    expect(() => a.genera([docA()], m)).toThrow(/registro/i)
  })

  it('senza denominazione del cedente il nome file usa TFRAW', () => {
    const d = docA()
    d.fotografia.cedente.denominazione = '  --  '
    expect(a.genera([d], MAPPE)[0].nome).toBe('TFRAW05110511')
  })

  it('un cliente estero: errore con codice di dominio, nessuna cifra sbagliata', () => {
    const d = docA()
    ;(d.fotografia.cessionario.sede as { nazione: string }).nazione = 'DE'
    expect.assertions(2)
    try {
      a.genera([d], MAPPE)
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        error: 'EXPORT_TEAMSYSTEM_NAZIONE_NON_SUPPORTATA',
      })
      expect(e).toBeInstanceOf(BadRequestException)
    }
  })

  it('mezzo centesimo: arrotondato per eccesso sul valore assoluto; sotto mezzo, segno positivo', () => {
    const d = docA()
    d.documento.riepiloghi[0] = {
      ...d.documento.riepiloghi[0],
      imponibile: '0.005',
      imposta: '-0.005',
    }
    d.documento.riepiloghi[1] = {
      ...d.documento.riepiloghi[1],
      imponibile: '-0.004',
      imposta: '0.004',
    }
    const r = testo(a, [d]).split('\r\n')[0]
    expect(r.slice(474, 486)).toBe('00000000001+')
    expect(r.slice(494, 505)).toBe('0000000001-')
    expect(r.slice(474 + 31, 486 + 31)).toBe('00000000000+')
    expect(r.slice(494 + 31, 505 + 31)).toBe('0000000000+')
  })

  it('un importo oltre la larghezza del campo: errore chiaro', () => {
    const d = docA()
    d.documento.riepiloghi[0] = { ...d.documento.riepiloghi[0], imponibile: '1000000000.00' }
    expect(() => a.genera([d], MAPPE)).toThrow(/troppo grande/)
    const ok = docA()
    ok.documento.riepiloghi[0] = { ...ok.documento.riepiloghi[0], imponibile: '999999999.99' }
    expect(testo(a, [ok]).slice(474, 486)).toBe('99999999999+')
  })

  it('piu di 12 rate: errore chiaro, 12 vanno bene', () => {
    const rate = (n: number) =>
      Array.from({ length: n }, (_, i) => rata(i + 1, 'MP05', '2026-12-05', '1.00'))
    const d = docA()
    d.documento.rate = rate(13)
    expect(() => a.genera([d], MAPPE)).toThrow(/12 rate/)
    d.documento.rate = rate(12)
    expect(testo(a, [d]).split('\r\n')[1].slice(2380, 2382)).toBe('12')
  })

  it('piu di 8 conti di ricavo: errore chiaro, 8 vanno bene', () => {
    const m = new Map(MAPPE)
    const righe = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        m.set(chiaveMappatura('CONTO_RICAVI', `T${i}`), String(5200000 + i))
        return rigaDoc(i + 1, `T${i}`, '1.00', '22.00')
      })
    const d = docA()
    d.documento.righe = righe(9) as never
    expect(() => a.genera([d], m)).toThrow(/8 conti di ricavo/)
    d.documento.righe = righe(8) as never
    expect(testo(a, [d], m)).toHaveLength(2 * (7001 + 2))
  })
})
