import { PropostaRiga, RigaAddebito } from './listino.model'
import { CAMPI_PARTE_2, RigaForm, tipoPerMenu } from './riga-modulo'

const errore = (errori: unknown, message: unknown = ['x']) => ({
  status: 400,
  error: { error: 'RIGA_ADDEBITO_NON_VALIDA', message, errori },
})

const riga = (over: Partial<RigaAddebito> = {}): RigaAddebito =>
  ({
    id: 'r1',
    elencoId: 'e1',
    tipo: 'CER',
    etichettaTipo: 'Riga CER',
    famiglia: 'CER',
    cerCode: '20 03 01',
    addebito: null,
    riferimento: 'R1',
    descrizione: 'Rifiuti urbani misti',
    tipoQuantita: 'PESO_NETTO',
    quantitaFissa: null,
    unitaMisura: 'KG',
    prezzo: '0.120000',
    prezzoSpeciale: false,
    sconto: '12.5+5',
    codiceIva: { id: 'i1', codice: '22', descrizione: 'Ordinaria' },
    provvigione: '5',
    tipoProvvigione: 'SCONTATO',
    tipologiaRifiuto: 'URBANO',
    statoFisico: '3',
    operazione: 'R13',
    categoria: { id: 'cat', codice: '001', descrizione: 'Urbani' },
    centroRicavo: null,
    applicaA: null,
    scaglioni: [],
    condizione: 2,
    condizioniRiferite: null,
    minimoFatturabile: '15.00',
    minimoPerCategoria: false,
    riferimentoGiorno: null,
    riferimentoMese: null,
    periodoScadenze: null,
    periodoExtraDal: null,
    periodoExtraAl: null,
    scadenze: [],
    stimaAnnuaKg: '1200.50',
    cerProposta: [],
    addebitiProposti: ['00012'],
    appunti: 'ritiro il lunedì',
    notaUsoInterno: null,
    versione: 4,
    ...over,
  }) as RigaAddebito

const vuota = (): PropostaRiga => ({
  descrizione: null,
  unitaMisura: null,
  codiceIva: null,
  tipo: null,
  categoria: null,
  centroRicavo: null,
  prezzo: null,
  sconto: null,
  provvigione: null,
  tipoProvvigione: null,
  tipologiaRifiuto: null,
})

describe('RigaForm', () => {
  let rf: RigaForm
  beforeEach(() => (rf = new RigaForm()))

  const imposta = (tipo: string, cifre = '') => {
    rf.form.controls.tipo.setValue(tipo)
    rf.form.controls.tipoCifre.setValue(cifre)
    rf.adatta()
  }

  describe('famiglia e campi abilitati', () => {
    it('senza tipo non c’è famiglia e nessun campo vale', () => {
      expect(rf.famiglia()).toBeNull()
      expect(rf.abilitato('prezzo')).toBeFalse()
    })

    it('T??? vale solo con le tre cifre', () => {
      imposta('T???', '12')
      expect(rf.famiglia()).toBeNull()
      imposta('T???', '123')
      expect(rf.tipoEffettivo()).toBe('T123')
      expect(rf.famiglia()).toBe('QUANTITA_MOVIMENTI')
    })

    it('CER: CER, tipo quantità, dati del rifiuto, addebiti proposti; niente quantità fissa', () => {
      imposta('CER')
      for (const c of [
        'cerCode',
        'tipoQuantita',
        'statoFisico',
        'operazione',
        'addebitiProposti',
      ] as const) {
        expect(rf.abilitato(c)).withContext(c).toBeTrue()
      }
      for (const c of ['addebitoId', 'quantitaFissa', 'cerProposta', 'scadenze'] as const) {
        expect(rf.abilitato(c)).withContext(c).toBeFalse()
      }
    })

    it('F: quantità fissa e nessun tipo quantità; V: tipo quantità e CER proposti', () => {
      imposta('F')
      expect(rf.abilitato('quantitaFissa')).toBeTrue()
      expect(rf.abilitato('tipoQuantita')).toBeFalse()
      imposta('V')
      expect(rf.abilitato('tipoQuantita')).toBeTrue()
      expect(rf.abilitato('quantitaFissa')).toBeFalse()
      expect(rf.abilitato('cerProposta')).toBeTrue()
    })

    it('lo sconto non c’è per M e $', () => {
      for (const t of ['MF', '$A', '$D']) {
        imposta(t)
        expect(rf.abilitato('sconto')).withContext(t).toBeFalse()
      }
      imposta('V')
      expect(rf.abilitato('sconto')).toBeTrue()
    })

    it('la provvigione non c’è per $D e $R, c’è per $A', () => {
      imposta('$D')
      expect(rf.abilitato('provvigione')).toBeFalse()
      imposta('$R')
      expect(rf.abilitato('provvigione')).toBeFalse()
      imposta('$A')
      expect(rf.abilitato('provvigione')).toBeTrue()
    })
  })

  describe('prezzo speciale spento (I1)', () => {
    const fasce = [
      {
        ordine: 1,
        finoA: '100',
        prezzo: '0.10',
        sconto: null,
        provvigione: null,
        tipoCalcolo: 'A' as const,
      },
    ]
    it('il corpo manda fasce vuote e dati collegati a null, il modulo li conserva', () => {
      rf.riempi(
        riga({
          prezzoSpeciale: true,
          prezzo: null,
          sconto: null,
          provvigione: null,
          minimoFatturabile: null,
          scaglioni: fasce,
          applicaA: 'CONGUAGLIO_365',
          condizioniRiferite: '1',
          riferimentoGiorno: 5,
          riferimentoMese: 3,
        })
      )
      expect(rf.dati().scaglioni?.length).toBe(1)
      expect(rf.dati().applicaA).toBe('CONGUAGLIO_365')
      rf.form.controls.prezzoSpeciale.setValue(false)
      rf.adatta()
      const d = rf.dati()
      expect(d.scaglioni).toEqual([])
      expect(d.applicaA).toBeNull()
      expect(d.condizioniRiferite).toBeNull()
      expect(d.riferimentoGiorno).toBeNull()
      expect(d.riferimentoMese).toBeNull()
      rf.form.controls.prezzoSpeciale.setValue(true)
      rf.adatta()
      expect(rf.dati().scaglioni?.length).toBe(1)
      expect(rf.dati().riferimentoMese).toBe(3)
    })

    it('con il prezzo speciale acceso sconto, provvigione e condizione non valgono (m1)', () => {
      rf.riempi(riga())
      rf.form.controls.prezzoSpeciale.setValue(true)
      rf.adatta()
      for (const c of ['sconto', 'provvigione', 'condizione'] as const) {
        expect(rf.abilitato(c)).withContext(c).toBeFalse()
        expect(rf.dati()[c]).withContext(c).toBeNull()
      }
    })

    it('le fasce letto dalla vista sono copiate solo con i campi del DTO (m5)', () => {
      rf.riempi(riga({ prezzoSpeciale: true, scaglioni: [{ ...fasce[0], id: 'x' } as never] }))
      expect(Object.keys(rf.form.controls.scaglioni.value[0]).sort()).toEqual([
        'finoA',
        'ordine',
        'prezzo',
        'provvigione',
        'sconto',
        'tipoCalcolo',
      ])
    })

    it('$D e $R non hanno nemmeno il tipo provvigione (m2)', () => {
      imposta('$D')
      expect(rf.abilitato('tipoProvvigione')).toBeFalse()
      imposta('$A')
      expect(rf.abilitato('tipoProvvigione')).toBeTrue()
    })
  })

  describe('adatta', () => {
    it('cambiando tipo i campi fuori famiglia si svuotano', () => {
      rf.riempi(riga())
      expect(rf.form.controls.cerCode.value).toBe('20 03 01')
      imposta('F')
      const v = rf.form.getRawValue()
      expect(v.cerCode).toBe('')
      expect(v.tipoQuantita).toBe('')
      expect(v.statoFisico).toBe('')
      expect(v.stimaAnnuaKg).toBe('')
      expect(v.addebitiProposti).toEqual([])
      expect(v.prezzo).toBe('0,12')
    })

    it('con il tipo incompleto non toglie nulla', () => {
      rf.riempi(riga())
      imposta('T???', '')
      expect(rf.form.controls.cerCode.value).toBe('20 03 01')
    })

    it('con il prezzo speciale il minimo si svuota e si disabilita, il flag per categoria resta', () => {
      rf.riempi(riga({ minimoPerCategoria: true }))
      expect(rf.form.controls.minimoFatturabile.value).toBe('15,00')
      rf.form.controls.prezzoSpeciale.setValue(true)
      rf.adatta()
      expect(rf.form.controls.minimoFatturabile.value).toBe('')
      expect(rf.form.controls.minimoFatturabile.disabled).toBeTrue()
      expect(rf.abilitato('minimoPerCategoria')).toBeTrue()
      expect(rf.form.controls.minimoPerCategoria.value).toBeTrue()
      rf.form.controls.prezzoSpeciale.setValue(false)
      rf.adatta()
      expect(rf.form.controls.minimoFatturabile.enabled).toBeTrue()
    })

    it('in sola lettura il modulo è disabilitato', () => {
      rf.riempi(riga())
      rf.impostaSolaLettura(true)
      expect(rf.form.disabled).toBeTrue()
      rf.impostaSolaLettura(false)
      expect(rf.form.enabled).toBeTrue()
    })
  })

  describe('lettura e corpo della richiesta', () => {
    it('riempi: numeri con la virgola, cascata con la virgola, T123 come T??? + 123', () => {
      rf.riempi(riga({ tipo: 'T123', cerCode: null, tipoQuantita: null, tipologiaRifiuto: null }))
      const v = rf.form.getRawValue()
      expect(v.tipo).toBe('T???')
      expect(v.tipoCifre).toBe('123')
      expect(v.sconto).toBe('12,5+5')
      expect(tipoPerMenu('M007')).toEqual({ tipo: 'M???', cifre: '007' })
      expect(tipoPerMenu('V')).toEqual({ tipo: 'V', cifre: '' })
    })

    it('dati: virgola → punto, vuoti a null, interi, unità maiuscola, tipo composto', () => {
      rf.riempi(riga())
      rf.form.patchValue({ prezzo: '0,125', unitaMisura: 'kg', condizione: '3', riferimento: ' ' })
      const d = rf.dati()
      expect(d.prezzo).toBe('0.125')
      expect(d.sconto).toBe('12.5+5')
      expect(d.unitaMisura).toBe('KG')
      expect(d.condizione).toBe(3)
      expect(d.riferimento).toBeNull()
      expect(d.cerCode).toBe('20 03 01')
      expect(d.minimoFatturabile).toBe('15.00')
      expect(d.addebitiProposti).toEqual(['00012'])
      expect(d.addebitoId).toBeNull()
    })

    it('dati: i campi fuori famiglia viaggiano vuoti', () => {
      rf.riempi(riga())
      imposta('F')
      const d = rf.dati()
      expect(d.tipo).toBe('F')
      expect(d.cerCode).toBeNull()
      expect(d.tipoQuantita).toBeNull()
      expect(d.addebitiProposti).toEqual([])
      expect(d.cerProposta).toEqual([])
      expect(d.scaglioni).toEqual([])
      expect(d.prezzoSpeciale).toBeFalse()
    })

    it('dati: T??? + cifre diventa T123', () => {
      imposta('T???', '123')
      expect(rf.dati().tipo).toBe('T123')
    })
  })

  describe('valori proposti', () => {
    const proposta = (): PropostaRiga => ({
      ...vuota(),
      descrizione: 'Trasporto',
      unitaMisura: 'KG',
      codiceIva: { id: 'i9', codice: '10', descrizione: 'Ridotta' },
      categoria: { id: 'c9', codice: '009', descrizione: 'Cat' },
      prezzo: '0.080000',
      sconto: '10.5',
      provvigione: '3',
      tipoProvvigione: 'LORDO',
      tipologiaRifiuto: 'SPECIALE',
    })

    it('riempie solo i campi vuoti', () => {
      imposta('CER')
      rf.form.patchValue({ descrizione: 'Mia descrizione', prezzo: '0,5' })
      rf.applicaProposta(proposta())
      const v = rf.form.getRawValue()
      expect(v.descrizione).toBe('Mia descrizione')
      expect(v.prezzo).toBe('0,5')
      expect(v.unitaMisura).toBe('KG')
      expect(v.codiceIvaId).toBe('i9')
      expect(v.categoriaId).toBe('c9')
      expect(v.sconto).toBe('10,5')
      expect(v.tipologiaRifiuto).toBe('SPECIALE')
    })

    it('non riempie i campi fuori famiglia', () => {
      imposta('MF')
      rf.applicaProposta(proposta())
      expect(rf.form.controls.sconto.value).toBe('')
      expect(rf.form.controls.tipologiaRifiuto.value).toBe('')
      expect(rf.form.controls.descrizione.value).toBe('Trasporto')
    })

    it('restituisce i riferimenti da aggiungere alle liste di scelta', () => {
      imposta('CER')
      const r = rf.applicaProposta(proposta())
      expect(r.IVA?.id).toBe('i9')
      expect(r.CENTRO_RICAVO).toBeNull()
    })
  })

  describe('errori del backend (R36)', () => {
    it('ogni messaggio va sotto il suo campo, quelli senza campo in testa', () => {
      rf.impostaErrori(
        errore([
          { campo: 'prezzo', messaggio: 'Indica il prezzo, anche zero.' },
          { campo: 'prezzo', messaggio: 'Altro.' },
          { campo: 'codiceIvaId', messaggio: 'Indica il codice IVA.' },
          { campo: null, messaggio: 'Regola fra più campi.' },
        ]),
        'ripiego'
      )
      expect(rf.erroriDi('prezzo')).toEqual(['Indica il prezzo, anche zero.', 'Altro.'])
      expect(rf.erroriDi('codiceIvaId')).toEqual(['Indica il codice IVA.'])
      expect(rf.generali()).toEqual(['Regola fra più campi.'])
    })

    it('un campo che il dialog non disegna va in testa con la sua etichetta', () => {
      rf.mostrati.delete('scaglioni')
      rf.impostaErrori(errore([{ campo: 'scaglioni', messaggio: 'Servono le fasce.' }]), 'ripiego')
      expect(rf.erroriDi('scaglioni')).toEqual([])
      expect(rf.generali()).toEqual(['Fasce del prezzo speciale: Servono le fasce.'])
    })

    it('i campi disegnati dal Task 28 (fasce e scadenze) hanno l’errore sotto il campo', () => {
      for (const c of CAMPI_PARTE_2) expect(rf.mostrati.has(c)).withContext(c).toBeTrue()
      rf.form.patchValue({ tipo: 'CER', prezzoSpeciale: true })
      rf.impostaErrori(errore([{ campo: 'scaglioni', messaggio: 'Servono le fasce.' }]), 'ripiego')
      expect(rf.erroriDi('scaglioni')).toEqual(['Servono le fasce.'])
      expect(rf.generali()).toEqual([])
    })

    it('R60: gli errori per campo possono stare in `details.errori`', () => {
      rf.impostaErrori(
        {
          status: 400,
          error: {
            error: 'X',
            message: 'm',
            details: { errori: [{ campo: 'prezzo', messaggio: 'Da details.' }] },
          },
        },
        'ripiego'
      )
      expect(rf.erroriDi('prezzo')).toEqual(['Da details.'])
    })

    it('senza `errori` vale il messaggio del backend, poi il ripiego', () => {
      rf.impostaErrori({ status: 404, error: { message: 'Riga non trovata.' } }, 'ripiego')
      expect(rf.generali()).toEqual(['Riga non trovata.'])
      rf.impostaErrori({ status: 500 }, 'ripiego')
      expect(rf.generali()).toEqual(['ripiego'])
    })

    it('pulisciErrori toglie tutto', () => {
      rf.impostaErrori(errore([{ campo: 'prezzo', messaggio: 'm' }]), 'r')
      rf.pulisciErrori()
      expect(rf.erroriDi('prezzo')).toEqual([])
      expect(rf.generali()).toEqual([])
    })
  })

  describe('virgola decimale obbligatoria (C1)', () => {
    it('1000 riletto resta 1000 e parte come "1000", mai "1" né "1.000"', () => {
      rf.riempi(riga({ prezzo: '1000.00', stimaAnnuaKg: '5000.00' }))
      expect(rf.form.controls.prezzo.value).toBe('1000')
      expect(rf.form.controls.stimaAnnuaKg.value).toBe('5000')
      const d = rf.dati()
      expect(d.prezzo).toBe('1000')
      expect(rf.haErroriLocali()).toBeFalse()
    })

    it('il minimo fatturabile si legge con due decimali, senza migliaia, e riparte uguale', () => {
      rf.riempi(riga({ minimoFatturabile: '1000.00' }))
      expect(rf.form.controls.minimoFatturabile.value).toBe('1000,00')
      expect(rf.dati().minimoFatturabile).toBe('1000.00')
    })

    it('1234,5 parte come 1234.5', () => {
      rf.riempi(riga())
      rf.form.controls.prezzo.setValue('1234,5')
      expect(rf.dati().prezzo).toBe('1234.5')
      expect(rf.erroriDi('prezzo')).toEqual([])
    })

    it('«1.000» è rifiutato col messaggio e il modulo non si può salvare', () => {
      rf.riempi(riga())
      rf.form.controls.prezzo.setValue('1.000')
      expect(rf.erroriDi('prezzo')).toEqual(['Usa la virgola per i decimali'])
      expect(rf.haErroriLocali()).toBeTrue()
      expect(rf.dati().prezzo).toBeNull()
    })

    it('un punto è vietato anche nello sconto a cascata e nella quantità fissa', () => {
      rf.riempi(riga())
      rf.form.controls.sconto.setValue('10+5.5')
      expect(rf.erroriDi('sconto')).toEqual(['Usa la virgola per i decimali'])
      rf.form.controls.sconto.setValue('10+5,5')
      expect(rf.dati().sconto).toBe('10+5.5')
      expect(rf.erroriDi('sconto')).toEqual([])
    })

    it('«1a» è rifiutato (anche negli interi, niente parseInt permissivo)', () => {
      rf.riempi(riga({ prezzoSpeciale: true, applicaA: 'CONGUAGLIO_365' }))
      rf.form.controls.riferimentoGiorno.setValue('1a')
      expect(rf.erroriDi('riferimentoGiorno')).toEqual(['Numero non valido'])
      expect(rf.haErroriLocali()).toBeTrue()
      rf.form.controls.prezzo.setValue('1a')
      rf.form.controls.prezzoSpeciale.setValue(false)
      rf.form.controls.riferimentoGiorno.setValue('15')
      expect(rf.erroriDi('prezzo')).toEqual(['Numero non valido'])
    })

    it('un campo che non parte (prezzo speciale spento) non blocca il salvataggio', () => {
      rf.riempi(riga({ prezzoSpeciale: true, applicaA: 'CONGUAGLIO_365' }))
      rf.form.controls.riferimentoGiorno.setValue('1a')
      rf.form.controls.prezzoSpeciale.setValue(false)
      expect(rf.haErroriLocali()).toBeFalse()
    })

    it('il prezzo proposto dall’archivio non ha le migliaia', () => {
      rf.form.controls.tipo.setValue('CER')
      rf.applicaProposta({
        descrizione: null,
        unitaMisura: null,
        codiceIva: null,
        tipo: null,
        categoria: null,
        centroRicavo: null,
        prezzo: '1000.000000',
        sconto: null,
        provvigione: null,
        tipoProvvigione: null,
        tipologiaRifiuto: null,
      })
      expect(rf.form.controls.prezzo.value).toBe('1000')
    })
  })

  describe('riferimento svuotato e campi nascosti (I3)', () => {
    it('cambiando «si applica a» giorno e mese non partono, ma restano nel modulo', () => {
      rf.riempi(
        riga({
          prezzoSpeciale: true,
          applicaA: 'PROGRESSIVO_DA_DATA',
          riferimentoGiorno: 5,
          riferimentoMese: 3,
        })
      )
      expect(rf.dati().riferimentoGiorno).toBe(5)
      rf.form.controls.applicaA.setValue('DOCUMENTO')
      expect(rf.dati().riferimentoGiorno).toBeNull()
      expect(rf.dati().riferimentoMese).toBeNull()
      expect(rf.form.controls.riferimentoGiorno.value).toBe('5')
      rf.form.controls.applicaA.setValue('CONGUAGLIO_365')
      expect(rf.dati().riferimentoMese).toBe(3)
    })

    it('un errore del backend su un campo nascosto va in testa con la sua etichetta', () => {
      rf.riempi(riga({ prezzoSpeciale: true, applicaA: 'DOCUMENTO' }))
      rf.impostaErrori(
        errore([{ campo: 'riferimentoGiorno', messaggio: 'La data non vale qui.' }]),
        'ripiego'
      )
      expect(rf.erroriDi('riferimentoGiorno')).toEqual([])
      expect(rf.generali()).toEqual(['Giorno di riferimento: La data non vale qui.'])
    })

    it('lo stesso errore, con il campo visibile, sta sotto il campo', () => {
      rf.riempi(riga({ prezzoSpeciale: true, applicaA: 'CONGUAGLIO_365' }))
      rf.impostaErrori(
        errore([{ campo: 'riferimentoGiorno', messaggio: 'Data non valida.' }]),
        'ripiego'
      )
      expect(rf.erroriDi('riferimentoGiorno')).toEqual(['Data non valida.'])
      expect(rf.generali()).toEqual([])
    })
  })
})
