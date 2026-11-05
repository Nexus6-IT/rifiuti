import * as ivaBollo from './iva-bollo'
import { calcolaDocumento } from './calcola-documento'
import {
  azzeraContatoreLegami,
  contrattoDi,
  inputDocumentoDi,
  IVA_22,
  IVA_N1,
  IVA_N4,
  legameDi,
  listinoDi,
} from '../../test-support/calcolo-fatturazione-di-test'

const cer = (p = {}) => listinoDi({ id: 'r1', tipo: 'CER', prezzo: '0.1', ...p })
const codici = (d: { errori: { codice: string }[] }) => d.errori.map(e => e.codice)
const avvisi = (d: { avvisi: { codice: string }[] }) => d.avvisi.map(e => e.codice)
const somma = (valori: string[]) =>
  valori.reduce((s, v) => s + Math.round(Number(v) * 100), 0) / 100
const legameN4 = (p = {}) =>
  legameDi({ codiceIvaId: 'ivaN4', aliquotaIva: '0.00', naturaIva: 'N4', ...p })

describe('calcolaDocumento', () => {
  beforeEach(azzeraContatoreLegami)

  it('documento semplice: 1000 kg a 0,10 + IVA 22%', () => {
    const d = calcolaDocumento(inputDocumentoDi({ righeListino: [cer()], legami: [legameDi()] }))
    expect(d.errori).toEqual([])
    expect(d.tipoDocumento).toBe('TD24')
    expect(d.formatoTrasmissione).toBe('FPR12')
    expect(d.totaleImponibile).toBe('100.00')
    expect(d.totaleIva).toBe('22.00')
    expect(d.totaleDocumento).toBe('122.00')
    expect(d.nettoAPagare).toBe('122.00')
    expect(d.condizioniPagamento).toBe('TP02')
    expect(d.rate).toHaveLength(1)
    expect(d.rate[0].importo).toBe('122.00')
    expect(d.bolloDovuto).toBe(false)
    expect(d.importoBollo).toBeNull()
  })

  describe('bollo', () => {
    const conBollo = (
      bollo: { importo: string; codiceIva: typeof IVA_N1 | null } | null,
      q = '1000'
    ) =>
      inputDocumentoDi({
        righeListino: [cer({ codiceIva: IVA_N4 })],
        legami: [legameN4({ quantita: q })],
        contratto: contrattoDi({ bollo }),
      })

    it('valutaBollo riceve i riepiloghi senza la riga BOLLO', () => {
      const spia = jest.spyOn(ivaBollo, 'valutaBollo')
      try {
        const d = calcolaDocumento(conBollo({ importo: '2.00', codiceIva: IVA_N1 }))
        expect(spia).toHaveBeenCalledTimes(1)
        const ricevuti = spia.mock.calls[0][0]
        expect(ricevuti.map(r => r.natura)).toEqual(['N4'])
        expect(ricevuti[0].imponibile).toBe('100.00')
        // ...ma il documento finale ha la riga e il riepilogo N1
        expect(d.righe.some(r => r.tipoRiga === 'BOLLO')).toBe(true)
        expect(d.riepiloghi.map(r => r.natura)).toEqual(['N4', 'N1'])
      } finally {
        spia.mockRestore()
      }
    })

    it('bollo addebitato su N4 100.00: riga BOLLO 2.00 in N1, importoBollo 2.00, totale 102.00 (una volta)', () => {
      const d = calcolaDocumento(conBollo({ importo: '2.00', codiceIva: IVA_N1 }))
      expect(d.errori).toEqual([])
      expect(d.righe.filter(r => r.tipoRiga === 'BOLLO')).toHaveLength(1)
      expect(d.righe[d.righe.length - 1].tipoRiga).toBe('BOLLO')
      expect(d.riepiloghi.find(r => r.natura === 'N1')?.imponibile).toBe('2.00')
      expect(d.importoBollo).toBe('2.00')
      expect(d.bolloDovuto).toBe(true)
      expect(d.totaleImponibile).toBe('102.00')
      expect(d.totaleDocumento).toBe('102.00')
      expect(d.nettoAPagare).toBe('102.00')
      expect(d.rate[0].importo).toBe('102.00')
    })

    it('al limite: 77.47 non e dovuto, 77.48 si', () => {
      expect(calcolaDocumento(conBollo(null, '774.7')).bolloDovuto).toBe(false)
      expect(calcolaDocumento(conBollo(null, '774.8')).bolloDovuto).toBe(true)
    })

    it('bollo dovuto e non addebitato: BOLLO_NON_ADDEBITATO, importoBollo 2.00, totale senza bollo', () => {
      const d = calcolaDocumento(conBollo(null))
      expect(avvisi(d)).toContain('BOLLO_NON_ADDEBITATO')
      expect(d.importoBollo).toBe('2.00')
      expect(d.totaleDocumento).toBe('100.00')
    })
  })

  describe('split payment e rate', () => {
    it('esigibilita S: netto a pagare = totale - imposta, rate sul netto', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer()],
          legami: [legameDi()],
          contratto: contrattoDi({
            esigibilita: 'S',
            condizione: { modalita: 'MP08', giorniRate: [30, 60], fineMese: false },
          }),
        })
      )
      expect(d.errori).toEqual([])
      expect(d.totaleDocumento).toBe('122.00')
      expect(d.totaleIva).toBe('22.00')
      expect(d.nettoAPagare).toBe('100.00')
      expect(d.riepiloghi[0].esigibilita).toBe('S')
      expect(d.condizioniPagamento).toBe('TP01')
      expect(d.rate.map(r => r.importo)).toEqual(['50.00', '50.00'])
      expect(somma(d.rate.map(r => r.importo))).toBe(100)
    })

    it('rate non divisibili: il resto va sull ultima', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer()],
          legami: [legameDi()],
          contratto: contrattoDi({
            condizione: { modalita: 'MP08', giorniRate: [30, 60, 90], fineMese: false },
          }),
        })
      )
      expect(d.rate.map(r => r.importo)).toEqual(['40.66', '40.66', '40.68'])
    })

    it('spesa di incasso: importo × numero rate, una riga, nei totali', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer()],
          legami: [legameDi()],
          contratto: contrattoDi({
            condizione: { modalita: 'MP08', giorniRate: [30, 60], fineMese: false },
            speseIncasso: { descrizione: 'Spese incasso', importo: '1.50', codiceIva: IVA_22 },
          }),
        })
      )
      expect(d.errori).toEqual([])
      const s = d.righe.filter(r => r.tipoRiga === 'SPESA_INCASSO')
      expect(s).toHaveLength(1)
      expect(s[0].prezzoTotale).toBe('3.00')
      expect(d.totaleImponibile).toBe('103.00')
      expect(d.totaleDocumento).toBe('125.66')
      expect(somma(d.rate.map(r => r.importo))).toBe(125.66)
    })
  })

  describe('listino e famiglie', () => {
    it('riga TS nel listino di un allegato, mai citata dai legami: FAMIGLIA_NON_CALCOLATA «TS riga n»', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [
            cer(),
            listinoDi({ id: 'a1', tipo: 'TT', prezzo: '0.02', daAllegato: true, elencoId: 'E2' }),
            listinoDi({ id: 'a2', tipo: 'TS', daAllegato: true, elencoId: 'E2' }),
          ],
          legami: [legameDi()],
        })
      )
      expect(d.errori).toEqual([{ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: 'TS riga 3' }])
    })

    it.each(['NM', '$A'])('riga %s nel listino: FAMIGLIA_NON_CALCOLATA', tipo => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), listinoDi({ id: 'x', tipo })],
          legami: [legameDi()],
        })
      )
      expect(d.errori).toEqual([{ codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: `${tipo} riga 2` }])
    })

    it('prezzo speciale con regola non calcolata citata dai legami: un solo errore, con la posizione nel listino', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [
            cer({ id: 'altra' }),
            cer({ id: 'sp', prezzoSpeciale: true, applicaA: 'GIORNO' }),
          ],
          legami: [legameDi({ rigaAddebitoId: 'sp', prezzoSpeciale: true })],
        })
      )
      expect(d.errori.filter(e => e.codice === 'FAMIGLIA_NON_CALCOLATA')).toEqual([
        { codice: 'FAMIGLIA_NON_CALCOLATA', dettaglio: 'CER riga 2' },
      ])
    })

    it('legame a prezzo speciale su una riga di listino a prezzo singolo: errore, il legame non sparisce', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer()],
          legami: [legameDi(), legameDi({ quantita: '500', prezzoSpeciale: true })],
        })
      )
      expect(d.errori.map(e => e.codice)).toContain('FAMIGLIA_NON_CALCOLATA')
      expect(d.righe).toHaveLength(1)
    })

    it('allegato con sola riga TT a 0.02 e legami del principale per 1500 KG: QUANTITA_MOVIMENTI 30.00, nessun errore', () => {
      const tt = listinoDi({
        id: 'tt',
        tipo: 'TT',
        prezzo: '0.02',
        daAllegato: true,
        elencoId: 'E2',
      })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), tt],
          righeQuantita: [tt],
          legami: [legameDi({ quantitaMovimento: '1500', quantita: '1500' })],
        })
      )
      expect(d.errori).toEqual([])
      const q = d.righe.filter(r => r.tipoRiga === 'QUANTITA_MOVIMENTI')
      expect(q).toHaveLength(1)
      expect(q[0].prezzoTotale).toBe('30.00')
      expect(d.tipoDocumento).toBe('TD24')
    })

    it('errore di una riga fissa: «riga n» e la posizione nel listino, non nell array delle fisse', () => {
      const f = listinoDi({ id: 'f', tipo: 'F', prezzo: null })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), listinoDi({ id: 'altra', tipo: 'CER' }), f],
          righeFisse: [f],
          legami: [legameDi()],
        })
      )
      expect(d.errori).toEqual([{ codice: 'RIGA_LEGAME_INCOMPLETA', dettaglio: 'F riga 3' }])
    })

    it('M<cat>: il minimo usa il codice a 3 cifre della categoria', () => {
      const v = listinoDi({
        id: 'v',
        tipo: 'V',
        categoriaId: '5b0b3f6e-0000-4000-8000-000000000001',
        categoriaCodice: '001',
      })
      const altra = listinoDi({
        id: 'v2',
        tipo: 'V',
        categoriaId: '5b0b3f6e-0000-4000-8000-000000000002',
        categoriaCodice: '002',
      })
      const m = listinoDi({ id: 'm', tipo: 'M001', prezzo: '500.00' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [v, altra, m],
          minimi: [m],
          legami: [legameDi({ rigaAddebitoId: 'v', tipo: 'V' })],
        })
      )
      expect(d.errori).toEqual([])
      const minimo = d.righe.find(r => r.tipoRiga === 'MINIMO')
      expect(minimo?.prezzoTotale).toBe('400.00')
      expect(d.totaleImponibile).toBe('500.00')
    })
  })

  describe('stato del contratto', () => {
    it('SOSPESO: CONTRATTO_SOSPESO, nessuna riga', () => {
      const f = listinoDi({ id: 'f', tipo: 'F', prezzo: '50.00' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), f],
          righeFisse: [f],
          legami: [legameDi()],
          contratto: contrattoDi({ stato: 'SOSPESO' }),
        })
      )
      expect(d.righe).toEqual([])
      expect(d.errori).toEqual([{ codice: 'CONTRATTO_SOSPESO' }])
    })

    it('ANNULLATO e BOZZA non arrivano al calcolo: eccezione di invariante', () => {
      for (const stato of ['ANNULLATO', 'BOZZA'] as const) {
        expect(() =>
          calcolaDocumento(
            inputDocumentoDi({ legami: [legameDi()], contratto: contrattoDi({ stato }) })
          )
        ).toThrow(stato)
      }
    })

    it('SOSPESO_MOVIMENTI: solo fisse (anche con TT), avviso MOVIMENTI_SOSPESI', () => {
      const f = listinoDi({ id: 'f', tipo: 'F', prezzo: '50.00' })
      const tt = listinoDi({ id: 'tt', tipo: 'TT', prezzo: '0.02' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), f, tt],
          righeFisse: [f],
          righeQuantita: [tt],
          legami: [legameDi()],
          contratto: contrattoDi({ stato: 'SOSPESO_MOVIMENTI' }),
        })
      )
      expect(d.errori).toEqual([])
      expect(d.righe.map(r => r.tipoRiga)).toEqual(['FISSO'])
      expect(avvisi(d)).toEqual(['MOVIMENTI_SOSPESI'])
      expect(d.tipoDocumento).toBe('TD01')
    })

    it('SOSPESO_MOVIMENTI con MW nel listino: nessun MINIMO fatturato (spec §6.4)', () => {
      const mw = listinoDi({ id: 'mw', tipo: 'MW', prezzo: '50.00' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), mw],
          minimi: [mw],
          legami: [legameDi()],
          contratto: contrattoDi({ stato: 'SOSPESO_MOVIMENTI' }),
        })
      )
      expect(d.righe).toEqual([])
      expect(d.righe.some(r => r.tipoRiga === 'MINIMO')).toBe(false)
      expect(d.totaleDocumento).toBe('0.00')
    })

    it('SOSPESO_MOVIMENTI con riga TT: nessuna riga TT', () => {
      const tt = listinoDi({ id: 'tt', tipo: 'TT', prezzo: '0.02' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer(), tt],
          righeQuantita: [tt],
          legami: [legameDi()],
          contratto: contrattoDi({ stato: 'SOSPESO_MOVIMENTI' }),
        })
      )
      expect(d.righe.some(r => r.tipoRiga === 'QUANTITA_MOVIMENTI')).toBe(false)
    })
  })

  describe('errori di contratto e cliente', () => {
    const con = (c: Parameters<typeof contrattoDi>[0]) =>
      calcolaDocumento(
        inputDocumentoDi({ righeListino: [cer()], legami: [legameDi()], contratto: contrattoDi(c) })
      )

    it('ritenuta 4%: RITENUTA_NON_GESTITA; 0: nessun errore', () => {
      expect(codici(con({ ritenutaPercentuale: '4.00' }))).toEqual(['RITENUTA_NON_GESTITA'])
      expect(codici(con({ ritenutaPercentuale: '0' }))).toEqual([])
    })
    it('senza registro IVA, condizione, dati fiscali o sede', () => {
      const d = con({
        registroIvaId: null,
        condizione: null,
        clienteCompleto: { datiFiscali: false, sede: false },
      })
      expect(codici(d)).toEqual([
        'SENZA_CONDIZIONE_PAGAMENTO',
        'SENZA_REGISTRO_IVA',
        'CLIENTE_SENZA_DATI_FISCALI',
        'SEDE_CLIENTE_INCOMPLETA',
      ])
      expect(d.rate).toEqual([])
      expect(d.condizioniPagamento).toBeNull()
    })
    it('codice destinatario di 6 caratteri: FPA12 e avviso FPA_DA_FIRMARE', () => {
      const d = con({ codiceDestinatario: 'UFABCD' })
      expect(d.formatoTrasmissione).toBe('FPA12')
      expect(avvisi(d)).toEqual(['FPA_DA_FIRMARE'])
      expect(d.errori).toEqual([])
    })
    it('FPA12 con CIG e senza idDocumento: DATI_PA_INCOMPLETI; con idDocumento: ok', () => {
      expect(codici(con({ codiceDestinatario: 'UFABCD', cig: 'Z123' }))).toEqual([
        'DATI_PA_INCOMPLETI',
      ])
      expect(codici(con({ codiceDestinatario: 'UFABCD', cup: 'J12' }))).toEqual([
        'DATI_PA_INCOMPLETI',
      ])
      expect(
        codici(con({ codiceDestinatario: 'UFABCD', cig: 'Z123', idDocumento: 'ODA1' }))
      ).toEqual([])
      // un privato con CIG non e un caso PA
      expect(codici(con({ cig: 'Z123' }))).toEqual([])
    })
    it('"0000000" senza PEC: DESTINATARIO_ASSENTE; con PEC no', () => {
      expect(avvisi(con({ codiceDestinatario: '0000000' }))).toEqual(['DESTINATARIO_ASSENTE'])
      expect(avvisi(con({ codiceDestinatario: null }))).toEqual(['DESTINATARIO_ASSENTE'])
      expect(avvisi(con({ codiceDestinatario: '0000000', pec: 'a@pec.it' }))).toEqual([])
    })
    it('MP01 con split: PAGAMENTO_NON_AMMESSO', () => {
      const d = con({
        esigibilita: 'S',
        condizione: { modalita: 'MP01', giorniRate: [0], fineMese: false },
      })
      expect(codici(d)).toEqual(['PAGAMENTO_NON_AMMESSO'])
    })
  })

  describe('avvisi del chiamante e tipo documento', () => {
    const base = () => inputDocumentoDi({ righeListino: [cer()], legami: [legameDi()] })
    it('legamiDaCollegareEsclusi 3: avviso con dettaglio "3"', () => {
      const d = calcolaDocumento({ ...base(), legamiDaCollegareEsclusi: 3 })
      expect(d.avvisi).toEqual([{ codice: 'MOVIMENTI_DA_COLLEGARE_ESCLUSI', dettaglio: '3' }])
    })
    it('arretrati 2: ARRETRATI_PRESENTI', () => {
      const d = calcolaDocumento({ ...base(), arretrati: 2 })
      expect(d.avvisi).toEqual([{ codice: 'ARRETRATI_PRESENTI', dettaglio: '2' }])
    })
    it('arretrati ricavati dalle righe fisse (scadenza anteriore al periodo), un solo avviso', () => {
      const f = listinoDi({
        id: 'f',
        tipo: 'F',
        prezzo: '10.00',
        scadenze: [{ ordine: 1, giorno: 15, mese: 6, anno: null }],
      })
      const i = inputDocumentoDi({
        righeListino: [cer(), f],
        righeFisse: [f],
        legami: [legameDi()],
      })
      expect(calcolaDocumento(i).avvisi).toEqual([{ codice: 'ARRETRATI_PRESENTI', dettaglio: '1' }])
      expect(calcolaDocumento({ ...i, arretrati: 4 }).avvisi).toEqual([
        { codice: 'ARRETRATI_PRESENTI', dettaglio: '4' },
      ])
    })
    it('TD24 con data oltre il 15: DATA_OLTRE_TERMINE_DIFFERITA; entro il 15 no', () => {
      expect(avvisi(calcolaDocumento({ ...base(), dataDocumento: '2026-12-16' }))).toEqual([
        'DATA_OLTRE_TERMINE_DIFFERITA',
      ])
      expect(avvisi(calcolaDocumento({ ...base(), dataDocumento: '2026-12-15' }))).toEqual([])
    })
    it('solo canoni: TD01, nessun avviso di data', () => {
      const f = listinoDi({ id: 'f', tipo: 'F', prezzo: '50.00' })
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [f],
          righeFisse: [f],
          dataDocumento: '2027-02-20',
        })
      )
      expect(d.tipoDocumento).toBe('TD01')
      expect(avvisi(d)).toEqual([])
      expect(d.errori).toEqual([])
    })
    it('totale 0: TOTALE_NON_POSITIVO', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          righeListino: [cer()],
          legami: [legameDi({ prezzo: '0' })],
        })
      )
      expect(codici(d)).toEqual(['TOTALE_NON_POSITIVO'])
    })
    it('nessuna riga: TOTALE_NON_POSITIVO, nessuna spesa ne bollo', () => {
      const d = calcolaDocumento(
        inputDocumentoDi({
          contratto: contrattoDi({
            speseIncasso: { descrizione: 's', importo: '1.00', codiceIva: IVA_22 },
          }),
        })
      )
      expect(d.righe).toEqual([])
      expect(codici(d)).toEqual(['TOTALE_NON_POSITIVO'])
    })
    it('giorno inesistente (2026-02-30): eccezione', () => {
      expect(() => calcolaDocumento({ ...base(), dataDocumento: '2026-02-30' })).toThrow(
        'AAAA-MM-GG'
      )
      expect(() =>
        calcolaDocumento({ ...base(), periodo: { dal: '2026-11-01', al: '2026-11-31' } })
      ).toThrow('AAAA-MM-GG')
    })
    it('data con ora o non valida: errore subito', () => {
      expect(() => calcolaDocumento({ ...base(), dataDocumento: '2026-12-05T10:00:00Z' })).toThrow(
        'AAAA-MM-GG'
      )
      expect(() =>
        calcolaDocumento(
          inputDocumentoDi({
            righeListino: [cer()],
            legami: [legameDi({ dataMovimento: '2026-11-02T00:00:00.000Z' })],
          })
        )
      ).toThrow('AAAA-MM-GG')
    })
  })

  it('numeri di linea consecutivi da 1 (movimenti, fisse, spese e bollo)', () => {
    const f = listinoDi({ id: 'f', tipo: 'F', prezzo: '50.00', codiceIva: IVA_N4 })
    const d = calcolaDocumento(
      inputDocumentoDi({
        righeListino: [cer({ codiceIva: IVA_N4 }), f],
        righeFisse: [f],
        legami: [legameN4(), legameN4()],
        contratto: contrattoDi({
          bollo: { importo: '2.00', codiceIva: IVA_N1 },
          speseIncasso: { descrizione: 'Spese incasso', importo: '1.00', codiceIva: IVA_22 },
        }),
      })
    )
    expect(d.errori).toEqual([])
    expect(d.righe.map(r => r.numeroLinea)).toEqual([1, 2, 3, 4, 5])
    expect(d.righe.map(r => r.tipoRiga)).toEqual([
      'MOVIMENTO',
      'MOVIMENTO',
      'FISSO',
      'SPESA_INCASSO',
      'BOLLO',
    ])
  })

  it('deterministico: due chiamate sullo stesso input danno JSON identico', () => {
    const f = listinoDi({ id: 'f', tipo: 'F', prezzo: '50.00' })
    const i = inputDocumentoDi({
      righeListino: [cer(), f],
      righeFisse: [f],
      legami: [legameDi({ sconto: '10+5' }), legameDi()],
    })
    expect(JSON.stringify(calcolaDocumento(i))).toBe(JSON.stringify(calcolaDocumento(i)))
  })
})
