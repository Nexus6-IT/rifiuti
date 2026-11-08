/**
 * PDF di cortesia (Task 28, 4.4c): la definizione e` pura e si verifica senza rendering; il
 * rendering vero (pdfmake) serve solo per la prova di tempo e per l'intestazione del file.
 */
import type { FotografiaDocumento } from '../../domain/fatturazione/tipi'
import type { DocumentoDettaglio, RigaDocumentoVista } from './documenti-fattura.service'
import { definizionePdf, formattaImportoIt, generaPdf, nomeFilePdf } from './pdf-cortesia'

const fotografia: FotografiaDocumento = {
  cedente: {
    denominazione: 'Eco Servizi Srl',
    partitaIva: '01234567890',
    codiceFiscale: '01234567890',
    regimeFiscale: 'RF01',
    sede: { indirizzo: 'Via Roma 1', cap: '00100', comune: 'Roma', provincia: 'RM', nazione: 'IT' },
    rea: null,
    idTrasmittente: '01234567890',
  },
  cessionario: {
    denominazione: 'Cliente Spa',
    nome: null,
    cognome: null,
    partitaIva: '09876543210',
    codiceFiscale: null,
    sede: {
      indirizzo: 'Via Milano 2',
      cap: '20100',
      comune: 'Milano',
      provincia: 'MI',
      nazione: 'IT',
    },
  },
  pagamento: {
    codice: 'BB30',
    descrizione: 'Bonifico 30 gg',
    modalita: 'MP05',
    giorniRate: [30],
    fineMese: false,
  },
  conto: { istituto: 'Banca Prova', iban: 'IT60X0542811101000000123456', bic: null },
  testoFatturazione: ['Pagamento entro la scadenza'],
  cig: null,
  cup: null,
  idDocumento: null,
}

const riga = (n: number, over: Partial<RigaDocumentoVista> = {}): RigaDocumentoVista => ({
  numeroLinea: n,
  tipoRiga: 'MOVIMENTO',
  legameId: null,
  rigaAddebitoId: null,
  centroRicavoCodice: null,
  categoriaCodice: null,
  descrizione: `Smaltimento rifiuti linea ${n}`,
  dataMovimento: '2026-10-15',
  cerCode: '150101',
  numeroFir: 'FIR-1',
  quantita: '1250.5',
  unitaMisura: 'kg',
  prezzoUnitario: '0.10',
  sconto: null,
  importoLordo: '125.05',
  importoSconto: '0.00',
  prezzoTotale: '125.05',
  aliquotaIva: '22.00',
  naturaIva: null,
  ...over,
})

function documento(righe = [riga(1)], over: Partial<DocumentoDettaglio> = {}): DocumentoDettaglio {
  return {
    id: 'x',
    stato: 'DEFINITIVO',
    tipoDocumento: 'TD01',
    numeroTesto: '12/A',
    dataDocumento: '2026-11-05',
    cliente: { id: 'c', denominazione: 'Cliente Spa' },
    contratto: { id: 'k', numero: 'C-1' },
    registro: { id: 'r', codice: 'VEN' },
    totaleImponibile: '1234.50',
    totaleIva: '271.59',
    totaleDocumento: '1506.09',
    errori: [],
    avvisi: [],
    esclusoDaDefinitiva: false,
    emessoIl: null,
    annullabile: false,
    motivoNonAnnullabile: null,
    stornabile: false,
    righe,
    riepiloghi: [
      {
        aliquota: '22.00',
        natura: null,
        imponibile: '1234.50',
        imposta: '271.59',
        esigibilita: 'I',
        riferimentoNormativo: null,
      },
    ],
    rate: [
      {
        ordine: 1,
        modalita: 'MP05',
        dataScadenza: '2026-12-05',
        importo: '1506.09',
        istituto: null,
        iban: null,
        abi: null,
        cab: null,
        bic: null,
      },
    ],
    nettoAPagare: '1506.09',
    bolloDovuto: false,
    importoBollo: null,
    versione: 1,
    documentoOrigineId: null,
    stornoId: null,
    xmlGenerato: false,
    ...over,
  }
}

const testo = (def: unknown) => JSON.stringify(def)

describe('definizionePdf', () => {
  it('definizione con intestazione, cedente, cessionario, righe, riepiloghi, rate, totali', () => {
    const t = testo(definizionePdf(documento(), fotografia, false))
    expect(t).toContain("Copia di cortesia: l'originale è il file XML")
    expect(t).toContain('Eco Servizi Srl')
    expect(t).toContain('01234567890')
    expect(t).toContain('Cliente Spa')
    expect(t).toContain('09876543210')
    expect(t).toContain('Smaltimento rifiuti linea 1')
    expect(t).toContain('150101')
    expect(t).toContain('12/A')
    expect(t).toContain('05/11/2026')
    expect(t).toContain('Riepilogo IVA')
    expect(t).toContain('Scadenze')
    expect(t).toContain('05/12/2026')
    expect(t).toContain('1.506,09')
    expect(t).toContain('IT60X0542811101000000123456')
    expect(t).toContain('Pagamento entro la scadenza')
  })

  it('bozza: filigrana ANTEPRIMA; definitivo: nessuna filigrana', () => {
    const bozza = definizionePdf(documento([riga(1)], { stato: 'BOZZA' }), fotografia, true)
    expect((bozza as any).watermark.text).toBe('ANTEPRIMA')
    expect((definizionePdf(documento(), fotografia, false) as any).watermark).toBeUndefined()
  })

  it('importi "1.234,50"', () => {
    expect(testo(definizionePdf(documento(), fotografia, false))).toContain('1.234,50')
    expect(formattaImportoIt('1234.5')).toBe('1.234,50')
    expect(formattaImportoIt('-1234567.891')).toBe('-1.234.567,891')
    expect(formattaImportoIt('0')).toBe('0,00')
    expect(formattaImportoIt('77.47')).toBe('77,47')
  })

  it('nota di credito: titolo e riferimento al documento di origine non inventati', () => {
    const t = testo(
      definizionePdf(documento([riga(1)], { tipoDocumento: 'TD04' }), fotografia, false)
    )
    expect(t).toContain('Nota di credito')
  })

  it('annullato: filigrana ANNULLATO e prefisso nel nome del file', () => {
    const d = documento([riga(1)], { stato: 'ANNULLATO' })
    expect((definizionePdf(d, fotografia, false) as any).watermark.text).toBe('ANNULLATO')
    expect(nomeFilePdf(d)).toBe('annullato-VEN-12-A-2026.pdf')
  })

  it('TD04: mostra numero e data del documento stornato, solo se noti', () => {
    const d = documento([riga(1)], { tipoDocumento: 'TD04' })
    const t = testo(
      definizionePdf(d, fotografia, false, { numeroTesto: '7/A', dataDocumento: '2026-10-01' })
    )
    expect(t).toContain('Storno della fattura N. 7/A del 01/10/2026')
    expect(testo(definizionePdf(d, fotografia, false))).not.toContain('Storno della fattura')
  })

  it('REA, capitale sociale e riferimento ordine, se nella fotografia', () => {
    const f: FotografiaDocumento = {
      ...fotografia,
      idDocumento: 'ORD-55',
      cedente: {
        ...fotografia.cedente,
        rea: {
          ufficio: 'RM',
          numero: '123456',
          capitaleSociale: '10000.00',
          socioUnico: null,
          statoLiquidazione: 'LN',
        },
      },
    }
    const t = testo(definizionePdf(documento(), f, false))
    expect(t).toContain('REA RM-123456, capitale sociale € 10.000,00')
    expect(t).toContain('Rif. ordine: ORD-55')
  })

  it('bollo e privato senza partita IVA', () => {
    const f: FotografiaDocumento = {
      ...fotografia,
      cessionario: {
        ...fotografia.cessionario,
        denominazione: null,
        nome: 'Mario',
        cognome: 'Rossi',
        partitaIva: null,
        codiceFiscale: 'RSSMRA80A01H501U',
      },
    }
    const t = testo(
      definizionePdf(documento([riga(1)], { bolloDovuto: true, importoBollo: '2.00' }), f, false)
    )
    expect(t).toContain('Mario Rossi')
    expect(t).toContain('RSSMRA80A01H501U')
    expect(t).toContain('Bollo')
  })

  it('300 righe: PDF generato sotto 3 s', async () => {
    const righe = Array.from({ length: 300 }, (_, i) => riga(i + 1))
    const def = definizionePdf(documento(righe), fotografia, false)
    const inizio = Date.now()
    const pdf = await generaPdf(def)
    expect(Date.now() - inizio).toBeLessThan(3000)
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('nomeFilePdf', () => {
  it('registro-numero-anno, senza caratteri pericolosi ne` dati personali', () => {
    expect(nomeFilePdf(documento())).toBe('VEN-12-A-2026.pdf')
    expect(nomeFilePdf(documento([], { numeroTesto: null, stato: 'BOZZA' }))).toBe(
      'anteprima-VEN-2026-11-05.pdf'
    )
    expect(nomeFilePdf(documento([], { registro: { id: 'r', codice: '../x"y' } }))).toBe(
      '-x-y-12-A-2026.pdf'
    )
  })
})
