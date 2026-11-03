import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { CerService } from '../cer/cer.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { AddebitoDialogComponent } from './addebito-dialog.component'
import {
  Addebito,
  CodiceIva,
  CodificaAddebito,
  GenereCodificaAddebito,
  PropostaRiga,
  RigaAddebito,
} from './listino.model'
import { MESSAGGIO_CONCORRENTE } from './errori-azione'
import { ListinoService } from './listino.service'
import { RigaAddebitoDialogComponent } from './riga-addebito-dialog.component'
import { CodiceIvaDialogComponent } from './tabelle/codice-iva-dialog.component'

const cod = (genere: GenereCodificaAddebito, id: string, codice: string, descrizione: string) =>
  ({
    id,
    genere,
    codice,
    descrizione,
    attiva: true,
    versione: 1,
    eliminabile: true,
  }) as CodificaAddebito

const IVA: CodiceIva[] = [
  {
    id: 'i1',
    versione: 1,
    eliminabile: true,
    codice: '22',
    descrizione: 'Ordinaria',
    aliquota: '22.00',
    natura: null,
    attivo: true,
  },
  {
    id: 'i2',
    versione: 1,
    eliminabile: true,
    codice: '10',
    descrizione: 'Ridotta',
    aliquota: '10.00',
    natura: null,
    attivo: true,
  },
]

const addebito = (over: Partial<Addebito> = {}): Addebito =>
  ({
    id: 'ad1',
    codice: '00012',
    descrizione: 'Trasporto variabile',
    gruppo: { id: 'g1', codice: '001', descrizione: 'Trasporti' },
    unitaMisura: 'KG',
    codiceIva: null,
    tipo: 'V',
    etichettaTipo: 'La quantità va specificata in immissione documento',
    categoria: null,
    tipoProvvigione: 'SCONTATO',
    centroRicavo: null,
    categoriaStatistica1: null,
    categoriaStatistica2: null,
    notaUsoInterno: null,
    appunti: null,
    listini: [],
    attivo: true,
    versione: 1,
    eliminabile: true,
    ...over,
  }) as Addebito

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
    categoria: null,
    centroRicavo: null,
    applicaA: null,
    scaglioni: [],
    condizione: null,
    condizioniRiferite: null,
    minimoFatturabile: null,
    minimoPerCategoria: false,
    riferimentoGiorno: null,
    riferimentoMese: null,
    periodoScadenze: null,
    periodoExtraDal: null,
    periodoExtraAl: null,
    scadenze: [],
    stimaAnnuaKg: null,
    cerProposta: [],
    addebitiProposti: [],
    appunti: null,
    notaUsoInterno: null,
    versione: 4,
    ...over,
  }) as RigaAddebito

const proposta = (over: Partial<PropostaRiga> = {}): PropostaRiga => ({
  descrizione: 'Rifiuti urbani',
  unitaMisura: 'KG',
  codiceIva: { id: 'i1', codice: '22', descrizione: 'Ordinaria' },
  tipo: null,
  categoria: null,
  centroRicavo: null,
  prezzo: '0.080000',
  sconto: null,
  provvigione: null,
  tipoProvvigione: null,
  tipologiaRifiuto: 'URBANO',
  ...over,
})

describe('RigaAddebitoDialogComponent', () => {
  let fixture: ComponentFixture<RigaAddebitoDialogComponent>
  let righe: {
    crea: jasmine.Spy
    modifica: jasmine.Spy
    proposta: jasmine.Spy
    codificheRentri: jasmine.Spy
  }
  let codifiche: { list: jasmine.Spy }
  let addebiti: { list: jasmine.Spy; crea: jasmine.Spy }
  let cer: { searchCER: jasmine.Spy }
  let salvate: RigaAddebito[]
  let chiusure: boolean[]
  let ricariche: number

  const valore = (id: string) =>
    (q<HTMLInputElement | HTMLSelectElement>(id) as HTMLInputElement).value
  const testo = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

  function imposta(id: string, v: string): void {
    const el = q<HTMLSelectElement>(id)!
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function apri(
    opzioni: { riga?: RigaAddebito | null; ruolo?: string; soloLettura?: boolean } = {}
  ): Promise<RigaAddebitoDialogComponent> {
    TestBed.overrideProvider(AuthService, {
      useValue: { currentUser: () => ({ role: opzioni.ruolo ?? 'ADMIN' }) },
    })
    fixture = TestBed.createComponent(RigaAddebitoDialogComponent)
    const c = fixture.componentInstance
    c.salvato.subscribe(r => salvate.push(r))
    c.visibleChange.subscribe(v => chiusure.push(v))
    c.ricarica.subscribe(() => ricariche++)
    fixture.componentRef.setInput('contrattoId', 'cc1')
    fixture.componentRef.setInput('elencoId', 'e1')
    fixture.componentRef.setInput('riga', opzioni.riga ?? null)
    fixture.componentRef.setInput('soloLettura', opzioni.soloLettura ?? false)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    return c
  }

  async function cerca(id: string, t: string): Promise<void> {
    scrivi(id, t)
    await stabilizza(fixture)
  }

  beforeEach(() => {
    salvate = []
    chiusure = []
    ricariche = 0
    righe = {
      crea: jasmine
        .createSpy('crea')
        .and.callFake((_e: string, d: unknown) => of({ ...riga(), ...(d as object) })),
      modifica: jasmine.createSpy('modifica').and.returnValue(of(riga())),
      proposta: jasmine.createSpy('proposta').and.returnValue(of(proposta())),
      codificheRentri: jasmine.createSpy('codificheRentri').and.callFake((t: string) =>
        of(
          t === 'stati-fisici'
            ? [
                { codice: '1', descrizione: 'Solido' },
                { codice: '3', descrizione: 'Liquido' },
              ]
            : [
                { codice: 'R13', descrizione: 'Messa in riserva' },
                { codice: 'D15', descrizione: 'Deposito' },
              ]
        )
      ),
    }
    codifiche = {
      list: jasmine
        .createSpy('list')
        .and.callFake((g: GenereCodificaAddebito) =>
          of(
            g === 'CATEGORIA'
              ? [cod('CATEGORIA', 'c1', '001', 'Standard')]
              : [cod('CENTRO_RICAVO', 'r1', '001', 'Sede')]
          )
        ),
    }
    addebiti = {
      list: jasmine.createSpy('list').and.returnValue(of({ elementi: [addebito()], totale: 1 })),
      crea: jasmine.createSpy('crea'),
    }
    cer = {
      searchCER: jasmine.createSpy('searchCER').and.returnValue(
        of([
          {
            code: '20 03 01',
            description: 'Rifiuti urbani non differenziati',
            isPericoloso: false,
          },
        ])
      ),
    }
    TestBed.configureTestingModule({
      imports: [RigaAddebitoDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error']),
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        { provide: CerService, useValue: cer },
        {
          provide: ListinoService,
          useValue: {
            righe,
            codifiche,
            addebiti,
            codiciIva: { list: () => of(IVA), crea: jasmine.createSpy('creaIva') },
          },
        },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('apertura', () => {
    it('nuova riga: solo la scelta e il tipo, finché il tipo non c’è', async () => {
      await apri()
      expect(q('riga-ricerca')).toBeTruthy()
      expect(q('riga-tipo')).toBeTruthy()
      expect(q('riga-prezzo')).toBeNull()
      expect(testo('riga-scelta')).toBe('Nessuna scelta')
      expect(bottone('riga-salva')!.disabled).toBeTrue()
    })

    it('carica le tre liste della riga e gli stati fisici e le operazioni da R42', async () => {
      await apri()
      expect(
        codifiche.list.calls
          .allArgs()
          .map(a => a[0])
          .sort()
      ).toEqual(['CATEGORIA', 'CENTRO_RICAVO'])
      expect(righe.codificheRentri).toHaveBeenCalledWith('stati-fisici')
      expect(righe.codificheRentri).toHaveBeenCalledWith('attivita-rs')
    })

    it('modifica: riempie il modulo con i numeri in formato italiano', async () => {
      await apri({ riga: riga() })
      expect(testo('riga-scelta')).toBe('20 03 01')
      expect(valore('riga-tipo')).toBe('CER')
      expect(valore('riga-prezzo')).toBe('0,12')
      expect(valore('riga-sconto')).toBe('12,5+5')
      expect(valore('riga-unita')).toBe('KG')
      expect(testo('riga-sezione-quantita')).toContain('Quantità')
    })

    it('stati fisici e operazioni sono selezioni dall’elenco, con il valore salvato', async () => {
      await apri({ riga: riga({ statoFisico: '3', operazione: 'X99' }) })
      const stati = Array.from(q<HTMLSelectElement>('riga-stato-fisico')!.options).map(o => o.value)
      expect(stati).toEqual(['', '1', '3'])
      expect(valore('riga-stato-fisico')).toBe('3')
      const operazioni = Array.from(q<HTMLSelectElement>('riga-operazione')!.options).map(
        o => o.value
      )
      expect(operazioni).toEqual(['', 'R13', 'D15', 'X99'])
      expect(valore('riga-operazione')).toBe('X99')
    })
  })

  describe('tipo e campi per famiglia', () => {
    it('il tipo F mostra la quantità fissa, non il tipo quantità né i dati del rifiuto', async () => {
      await apri()
      imposta('riga-tipo', 'F')
      await stabilizza(fixture)
      expect(q('riga-quantita-fissa')).toBeTruthy()
      expect(q('riga-tipo-quantita')).toBeNull()
      expect(q('riga-sezione-rifiuto')).toBeNull()
      expect(testo('riga-famiglia')).toBe('Importo fisso periodico')
    })

    it('cambiando tipo i campi fuori famiglia si svuotano e spariscono', async () => {
      await apri({ riga: riga() })
      expect(q('riga-stato-fisico')).toBeTruthy()
      imposta('riga-tipo', 'F')
      await stabilizza(fixture)
      expect(q('riga-stato-fisico')).toBeNull()
      imposta('riga-tipo', 'CER')
      await stabilizza(fixture)
      expect(valore('riga-stato-fisico')).toBe('')
      expect(testo('riga-scelta')).toBe('Nessuna scelta')
    })

    it('T??? chiede le tre cifre e fino ad allora non mostra i campi', async () => {
      await apri()
      imposta('riga-tipo', 'T???')
      await stabilizza(fixture)
      expect(q('riga-tipo-cifre')).toBeTruthy()
      expect(q('riga-prezzo')).toBeNull()
      scrivi('riga-tipo-cifre', '123')
      await stabilizza(fixture)
      expect(q('riga-prezzo')).toBeTruthy()
    })

    it('lo sconto non c’è per M e $, la provvigione non c’è per $D', async () => {
      await apri()
      imposta('riga-tipo', 'MF')
      await stabilizza(fixture)
      expect(q('riga-sconto')).toBeNull()
      expect(q('riga-provvigione')).toBeTruthy()
      imposta('riga-tipo', '$D')
      await stabilizza(fixture)
      expect(q('riga-sconto')).toBeNull()
      expect(q('riga-provvigione')).toBeNull()
    })

    it('prezzo speciale: il minimo fatturabile si disabilita e si svuota, quello per categoria resta', async () => {
      await apri({ riga: riga({ minimoFatturabile: '15.00' }) })
      expect(valore('riga-minimo')).toBe('15,00')
      const spunta = q<HTMLInputElement>('riga-prezzo-speciale')!
      spunta.click()
      await stabilizza(fixture)
      const minimo = q<HTMLInputElement>('riga-minimo')!
      expect(minimo.disabled).toBeTrue()
      expect(minimo.value).toBe('')
      expect(testo('riga-minimo-nota')).toContain('Con il prezzo speciale')
      expect(q<HTMLInputElement>('riga-minimo-categoria')!.disabled).toBeFalse()
    })

    it('il tipo quantità propone le etichette di E15', async () => {
      await apri({ riga: riga() })
      const etichette = Array.from(q<HTMLSelectElement>('riga-tipo-quantita')!.options).map(o =>
        o.text.trim()
      )
      expect(etichette).toEqual([
        '—',
        'Peso netto',
        'Peso lordo',
        'Volume',
        'Sempre 1',
        'Altro (si indica nel documento)',
      ])
    })
  })

  describe('scelta del CER o dell’addebito e valori proposti', () => {
    it('cerca nel catalogo e nell’archivio solo da due caratteri', async () => {
      await apri()
      await cerca('riga-ricerca', '2')
      expect(cer.searchCER).not.toHaveBeenCalled()
      await cerca('riga-ricerca', '20 03')
      expect(cer.searchCER).toHaveBeenCalledWith('20 03', true)
      expect(addebiti.list).toHaveBeenCalledWith({
        testo: '20 03',
        soloAttivi: true,
        dimensione: 20,
      })
      expect(q('riga-ricerca-voce-cer-20 03 01')).toBeTruthy()
      expect(q('riga-ricerca-voce-add-00012')).toBeTruthy()
    })

    it('se l’archivio non risponde restano i CER, e viceversa (voce 24)', async () => {
      addebiti.list.and.returnValue(throwError(() => ({ status: 500 })))
      await apri()
      await cerca('riga-ricerca', '20 03')
      expect(q('riga-ricerca-voce-cer-20 03 01')).toBeTruthy()
      expect(q('riga-ricerca-voce-add-00012')).toBeNull()
      addebiti.list.and.returnValue(of({ elementi: [addebito()], totale: 1 }))
      cer.searchCER.and.returnValue(throwError(() => ({ status: 500 })))
      await cerca('riga-ricerca', '20 04')
      expect(q('riga-ricerca-voce-cer-20 03 01')).toBeNull()
      expect(q('riga-ricerca-voce-add-00012')).toBeTruthy()
    })

    it('se falliscono entrambe la ricerca risulta non riuscita (voce 24)', async () => {
      addebiti.list.and.returnValue(throwError(() => ({ status: 500 })))
      cer.searchCER.and.returnValue(throwError(() => ({ status: 500 })))
      await apri()
      await cerca('riga-ricerca', '20 03')
      expect(fixture.nativeElement.textContent).toContain('Ricerca non riuscita')
    })

    it('scegliere un CER imposta il tipo, chiama la proposta e riempie i campi vuoti', async () => {
      await apri()
      await cerca('riga-ricerca', '20 03')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      expect(righe.proposta).toHaveBeenCalledOnceWith('cc1', { cerCode: '20 03 01' })
      expect(valore('riga-tipo')).toBe('CER')
      expect(testo('riga-scelta')).toContain('20 03 01')
      expect(valore('riga-descrizione')).toBe('Rifiuti urbani')
      expect(valore('riga-prezzo')).toBe('0,08')
      expect(valore('riga-iva')).toBe('i1')
      expect(valore('riga-tipologia')).toBe('URBANO')
    })

    it('i valori proposti non toccano ciò che l’utente ha già scritto', async () => {
      await apri({ riga: riga({ descrizione: 'Mia descrizione', prezzo: '0.500000' }) })
      await cerca('riga-ricerca', '20 03')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      expect(valore('riga-descrizione')).toBe('Mia descrizione')
      expect(valore('riga-prezzo')).toBe('0,5')
    })

    it('cambiando CER la tipologia del CER precedente non resta (I2)', async () => {
      cer.searchCER.and.callFake((t: string) =>
        of([
          t === 'a'.repeat(3)
            ? { code: '15 01 10*', description: 'Imballaggi pericolosi', isPericoloso: true }
            : { code: '20 03 01', description: 'Urbani', isPericoloso: false },
        ])
      )
      righe.proposta.and.callFake((_c: string, s: { cerCode?: string }) =>
        of(
          proposta({
            tipologiaRifiuto: s.cerCode === '20 03 01' ? 'URBANO' : 'SPECIALE_PERICOLOSO',
          })
        )
      )
      await apri()
      await cerca('riga-ricerca', 'urb')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      expect(valore('riga-tipologia')).toBe('URBANO')
      righe.proposta.and.returnValue(throwError(() => ({ status: 500 })))
      await cerca('riga-ricerca', 'aaa')
      q('riga-ricerca-voce-cer-15 01 10*')!.click()
      await stabilizza(fixture)
      expect(valore('riga-tipologia')).toBe('')
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.crea.calls.mostRecent().args[1].tipologiaRifiuto).toBeNull()
    })

    it('scelto un addebito il menu del tipo è bloccato (m7); un CER lo sblocca', async () => {
      await apri()
      await cerca('riga-ricerca', 'tras')
      q('riga-ricerca-voce-add-00012')!.click()
      await stabilizza(fixture)
      expect(q<HTMLSelectElement>('riga-tipo')!.disabled).toBeTrue()
      await cerca('riga-ricerca', '20 03')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      expect(q<HTMLSelectElement>('riga-tipo')!.disabled).toBeFalse()
      expect(valore('riga-tipo')).toBe('CER')
    })

    it('scegliere un addebito imposta il suo tipo e chiama la proposta con l’id', async () => {
      await apri()
      await cerca('riga-ricerca', 'tras')
      q('riga-ricerca-voce-add-00012')!.click()
      await stabilizza(fixture)
      expect(righe.proposta).toHaveBeenCalledOnceWith('cc1', { addebitoId: 'ad1' })
      expect(valore('riga-tipo')).toBe('V')
      expect(testo('riga-scelta')).toContain('00012 - Trasporto variabile')
      expect(q('riga-tipo-quantita')).toBeTruthy()
    })

    it('l’addebito T123 apre il tipo T??? con le cifre', async () => {
      addebiti.list.and.returnValue(of({ elementi: [addebito({ tipo: 'T123' })], totale: 1 }))
      await apri()
      await cerca('riga-ricerca', 'tras')
      q('riga-ricerca-voce-add-00012')!.click()
      await stabilizza(fixture)
      expect(valore('riga-tipo')).toBe('T???')
      expect(valore('riga-tipo-cifre')).toBe('123')
    })

    it('la proposta che fallisce lascia il dialog utilizzabile', async () => {
      righe.proposta.and.returnValue(throwError(() => ({ status: 500 })))
      await apri()
      await cerca('riga-ricerca', '20 03')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      expect(testo('riga-avviso')).toContain('Impossibile leggere i valori proposti.')
      expect(valore('riga-tipo')).toBe('CER')
      expect(bottone('riga-salva')!.disabled).toBeFalse()
    })
  })

  describe('salvataggio', () => {
    it('crea nell’elenco con il corpo normalizzato e lo emette', async () => {
      await apri()
      await cerca('riga-ricerca', '20 03')
      q('riga-ricerca-voce-cer-20 03 01')!.click()
      await stabilizza(fixture)
      scrivi('riga-prezzo', '0,125')
      imposta('riga-tipo-quantita', 'PESO_NETTO')
      scrivi('riga-unita', 'kg')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.crea).toHaveBeenCalledTimes(1)
      const [elencoId, corpo] = righe.crea.calls.mostRecent().args
      expect(elencoId).toBe('e1')
      expect(corpo.tipo).toBe('CER')
      expect(corpo.cerCode).toBe('20 03 01')
      expect(corpo.prezzo).toBe('0.125')
      expect(corpo.unitaMisura).toBe('KG')
      expect(corpo.tipoQuantita).toBe('PESO_NETTO')
      expect(corpo.codiceIvaId).toBe('i1')
      expect(corpo.addebitoId).toBeNull()
      expect(corpo.sconto).toBeNull()
      expect(salvate.length).toBe(1)
    })

    it('modifica manda la versione della riga e i campi fuori famiglia vuoti', async () => {
      await apri({ riga: riga() })
      imposta('riga-tipo', 'F')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      const [id, corpo] = righe.modifica.calls.mostRecent().args
      expect(id).toBe('r1')
      expect(corpo.versione).toBe(4)
      expect(corpo.tipo).toBe('F')
      expect(corpo.cerCode).toBeNull()
      expect(corpo.tipoQuantita).toBeNull()
      expect(corpo.statoFisico).toBeNull()
    })

    it('Salva è disabilitato durante il salvataggio, e un secondo clic non manda altro', async () => {
      const risposta$ = new Subject<RigaAddebito>()
      righe.modifica.and.returnValue(risposta$)
      const c = await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(bottone('riga-salva')!.disabled).toBeTrue()
      c.salva()
      expect(righe.modifica).toHaveBeenCalledTimes(1)
    })

    it('chiudere durante il salvataggio non emette più nulla', async () => {
      const risposta$ = new Subject<RigaAddebito>()
      righe.modifica.and.returnValue(risposta$)
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      fixture.componentRef.setInput('visible', false)
      await stabilizza(fixture)
      risposta$.next(riga())
      expect(salvate.length).toBe(0)
    })
  })

  describe('errori del backend (R36)', () => {
    const rifiuto = (errori: unknown[], status = 400) => ({
      status,
      error: { error: 'RIGA_ADDEBITO_NON_VALIDA', message: errori.map(() => 'x'), errori },
    })

    it('ogni messaggio sotto il suo campo, quelli senza campo in testa, il dialog resta aperto', async () => {
      righe.modifica.and.returnValue(
        throwError(() =>
          rifiuto([
            { campo: 'prezzo', messaggio: 'Indica il prezzo, anche zero.' },
            { campo: 'unitaMisura', messaggio: 'Indica l’unità di misura.' },
            { campo: 'cerCode', messaggio: 'Il codice CER non è nel catalogo.' },
            { campo: null, messaggio: 'Regola fra più campi.' },
          ])
        )
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errore-prezzo')).toBe('Indica il prezzo, anche zero.')
      expect(testo('riga-errore-unitaMisura')).toBe('Indica l’unità di misura.')
      expect(testo('riga-errore-scelta')).toBe('Il codice CER non è nel catalogo.')
      expect(testo('riga-errori-generali')).toBe('Regola fra più campi.')
      expect(salvate.length).toBe(0)
      expect(chiusure).toEqual([])
      expect(bottone('riga-salva')!.disabled).toBeFalse()
    })

    it('un errore su un campo che il dialog non disegna compare in testa', async () => {
      righe.modifica.and.returnValue(
        throwError(() => rifiuto([{ campo: 'campoNonNoto', messaggio: 'Messaggio.' }]))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errori-generali')).toBe('Messaggio.')
    })

    it('Task 28: prezzo speciale acceso senza fasce, il 400 sul campo scaglioni sta sull’editor', async () => {
      righe.modifica.and.returnValue(
        throwError(() => rifiuto([{ campo: 'scaglioni', messaggio: 'Indica le fasce.' }]))
      )
      await apri({ riga: riga({ prezzoSpeciale: true, applicaA: 'DOCUMENTO', prezzo: null }) })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errore-scaglioni')).toBe('Indica le fasce.')
      expect(q('riga-errori-generali')).toBeNull()
    })

    it('Task 28: le fasce scritte nel dialog partono nel corpo del salvataggio', async () => {
      await apri({ riga: riga({ prezzoSpeciale: true, applicaA: 'DOCUMENTO', prezzo: null }) })
      scrivi('fascia-1-fino', '1000')
      scrivi('fascia-1-prezzo', '0,10')
      scrivi('fascia-oltre-prezzo', '0,05')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      const corpo = righe.modifica.calls.mostRecent().args[1]
      expect(corpo.applicaA).toBe('DOCUMENTO')
      expect(corpo.scaglioni).toEqual([
        {
          ordine: 1,
          finoA: '1000',
          prezzo: '0.10',
          sconto: null,
          provvigione: null,
          tipoCalcolo: 'A',
        },
        {
          ordine: 7,
          finoA: null,
          prezzo: '0.05',
          sconto: null,
          provvigione: null,
          tipoCalcolo: 'A',
        },
      ])
    })

    it('Task 28: riga fissa con le scadenze e il periodo extra', async () => {
      await apri({
        riga: riga({
          tipo: 'F',
          famiglia: 'FISSO',
          cerCode: null,
          addebito: { id: 'ad9', codice: '00009', descrizione: 'Canone' },
          prezzo: '10.000000',
          quantitaFissa: '1',
          scadenze: [{ ordine: 1, giorno: 15, mese: 1, anno: null, fatturabileNelContratto: true }],
        }),
      })
      expect(q('riga-sezione-scadenze')).toBeTruthy()
      expect(q('riga-sezione-fasce')).toBeNull()
      expect(valore('scadenza-1-giorno')).toBe('15')
      expect(testo('scadenze-totale-importo')).toBe('10,00 €')
      bottone('scadenze-calendario')!.click()
      await stabilizza(fixture)
      expect(testo('scadenze-totale-importo')).toBe('120,00 €')
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.modifica.calls.mostRecent().args[1].scadenze.length).toBe(12)
    })

    it('un nuovo salvataggio toglie gli errori precedenti', async () => {
      righe.modifica.and.returnValues(
        throwError(() => rifiuto([{ campo: 'prezzo', messaggio: 'Errore.' }])),
        of(riga())
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(q('riga-errore-prezzo')).toBeTruthy()
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(q('riga-errore-prezzo')).toBeNull()
    })

    it('409: messaggio del backend e "Ricarica"', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({ status: 409, error: { message: 'La riga è stata modificata.' } }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errori-generali')).toBe('La riga è stata modificata.')
      bottone('riga-ricarica')!.click()
      expect(ricariche).toBe(1)
    })

    it('409 di dato scritto (riga duplicata): messaggio in testa, niente "Ricarica", form intatto', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: { error: 'RIGA_ADDEBITO_DUPLICATA', message: 'Esiste già una riga uguale.' },
        }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errori-generali')).toBe('Esiste già una riga uguale.')
      expect(q('riga-ricarica')).toBeNull()
      expect(q('riga-salva')).not.toBeNull()
    })

    it('409 di versione: "Ricarica"', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: { error: 'RIGA_ADDEBITO_MODIFICATA_NEL_FRATTEMPO', message: 'Modificata.' },
        }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(q('riga-ricarica')).not.toBeNull()
    })

    it('operazione concorrente: testo unico, niente "Ricarica"', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 409,
          error: { error: 'OPERAZIONE_CONCORRENTE', message: 'altro testo' },
        }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errori-generali')).toBe(MESSAGGIO_CONCORRENTE)
      expect(q('riga-ricarica')).toBeNull()
    })

    it('un 400 senza `errori` mostra il messaggio in testa', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({ status: 400, error: { message: ['Il corpo non è valido.'] } }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errori-generali')).toBe('Il corpo non è valido.')
    })
  })

  describe('proposta', () => {
    it('riga V: i CER proposti si aggiungono dalla ricerca e si tolgono dai chip', async () => {
      await apri({
        riga: riga({
          tipo: 'V',
          cerCode: null,
          tipoQuantita: 'PESO_NETTO',
          cerProposta: ['15 01 01'],
        }),
      })
      expect(testo('riga-cer-proposti')).toContain('15 01 01')
      expect(q('riga-addebiti-proposti')).toBeNull()
      await cerca('riga-cer-proposto', '20 03')
      q('riga-cer-proposto-voce-20 03 01')!.click()
      await stabilizza(fixture)
      expect(testo('riga-cer-proposti')).toContain('20 03 01')
      q('riga-cer-togli-15 01 01')!.click()
      await stabilizza(fixture)
      expect(testo('riga-cer-proposti')).not.toContain('15 01 01')
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.modifica.calls.mostRecent().args[1].cerProposta).toEqual(['20 03 01'])
    })

    it('riga CER: gli addebiti proposti sono solo quelli di tipo V', async () => {
      await apri({ riga: riga({ addebitiProposti: ['00007'] }) })
      expect(q('riga-cer-proposti')).toBeNull()
      expect(testo('riga-addebiti-proposti')).toContain('00007')
      await cerca('riga-addebito-proposto', 'tras')
      expect(addebiti.list).toHaveBeenCalledWith({
        testo: 'tras',
        tipo: 'V',
        soloAttivi: true,
        dimensione: 20,
      })
      q('riga-addebito-proposto-voce-00012')!.click()
      await stabilizza(fixture)
      expect(testo('riga-addebiti-proposti')).toContain('00012')
    })

    it('le famiglie senza proposta non hanno la sezione', async () => {
      await apri({
        riga: riga({
          tipo: 'F',
          cerCode: null,
          addebito: { id: 'ad1', codice: '00001', descrizione: 'Canone' },
        }),
      })
      expect(q('riga-sezione-proposta')).toBeNull()
    })

    it('errore sul campo dei CER proposti sotto la lista', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: { errori: [{ campo: 'cerProposta', messaggio: 'CER non nel catalogo.' }] },
        }))
      )
      await apri({ riga: riga({ tipo: 'V', cerCode: null, cerProposta: ['99 99 99'] }) })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(testo('riga-errore-cerProposta')).toBe('CER non nel catalogo.')
    })
  })

  describe('accessibilità e Esc', () => {
    it('la ricerca ha un nome e i campi con errore sono marcati', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: { details: { errori: [{ campo: 'prezzo', messaggio: 'Errore.' }] } },
        }))
      )
      await apri({ riga: riga() })
      expect(q('riga-ricerca')!.getAttribute('aria-label')).toBe('CER o addebito')
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      const prezzo = q('riga-prezzo')!
      expect(prezzo.getAttribute('aria-invalid')).toBe('true')
      expect(prezzo.getAttribute('aria-describedby')).toBe('riga-prezzo-errore')
      expect(document.getElementById('riga-prezzo-errore')).toBeTruthy()
    })

    it('il 400 sul tipo incoerente con l’addebito compare sotto il campo Tipo (decisione 4)', async () => {
      righe.modifica.and.returnValue(
        throwError(() => ({
          status: 400,
          error: {
            details: {
              errori: [
                { campo: 'tipo', messaggio: 'Il tipo non corrisponde all’addebito scelto.' },
              ],
            },
          },
        }))
      )
      await apri({ riga: riga() })
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(document.getElementById('riga-tipo-errore')?.textContent).toContain(
        'non corrisponde all’addebito'
      )
      expect(q('riga-errori-generali')).toBeNull()
    })

    it('Esc a elenco aperto chiude l’elenco e non arriva al dialog', async () => {
      await apri()
      await cerca('riga-ricerca', '20 03')
      let arrivato = false
      const ascolta = () => (arrivato = true)
      document.addEventListener('keydown', ascolta)
      q('riga-ricerca')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
      document.removeEventListener('keydown', ascolta)
      await stabilizza(fixture)
      expect(arrivato).toBeFalse()
      expect(q('riga-ricerca-risultati')).toBeNull()
    })

    it('a elenco chiuso Esc passa al dialog', async () => {
      await apri()
      let arrivato = false
      const ascolta = () => (arrivato = true)
      document.addEventListener('keydown', ascolta)
      q('riga-ricerca')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      )
      document.removeEventListener('keydown', ascolta)
      expect(arrivato).toBeTrue()
    })

    it('un valore salvato fuori elenco compare col solo codice (m9)', async () => {
      await apri({ riga: riga({ operazione: 'X99' }) })
      const o = Array.from(q<HTMLSelectElement>('riga-operazione')!.options).find(
        x => x.value === 'X99'
      )!
      expect(o.text.trim()).toBe('X99')
    })

    it('appunti e nota hanno i limiti del backend (m3)', async () => {
      await apri({ riga: riga() })
      expect(q('riga-appunti')!.getAttribute('maxlength')).toBe('135')
      expect(q('riga-nota')!.getAttribute('maxlength')).toBe('45')
    })
  })

  describe('note', () => {
    it('appunti e nota d’uso interno viaggiano e un errore compare sotto il campo', async () => {
      await apri({ riga: riga() })
      scrivi('riga-appunti', 'ritiro il lunedì')
      scrivi('riga-nota', 'solo per noi')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      const corpo = righe.modifica.calls.mostRecent().args[1]
      expect(corpo.appunti).toBe('ritiro il lunedì')
      expect(corpo.notaUsoInterno).toBe('solo per noi')
    })
  })

  describe('aggiunta in linea', () => {
    const figlio = () => fixture.debugElement.query(By.directive(AddebitoDialogComponent))

    it('"Nuovo addebito" apre il dialog rapido e l’addebito creato diventa la scelta', async () => {
      const c = await apri()
      bottone('riga-nuovo-addebito')!.click()
      await stabilizza(fixture)
      const dlg = figlio().componentInstance as AddebitoDialogComponent
      expect(dlg.visible).toBeTrue()
      expect(dlg.rapida).toBeTrue()
      dlg.salvato.emit(addebito({ id: 'ad9', codice: '00099', descrizione: 'Nuovo' }))
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(righe.proposta).toHaveBeenCalledWith('cc1', { addebitoId: 'ad9' })
      expect(testo('riga-scelta')).toContain('00099 - Nuovo')
      expect(valore('riga-tipo')).toBe('V')
      expect(c.inLineaAddebito.aperto).toBeNull()
    })

    it('Esc nel sub-dialog non chiude il dialog della riga', async () => {
      const c = await apri()
      bottone('riga-nuovo-addebito')!.click()
      await stabilizza(fixture)
      c.alCambioVisibilita(false)
      expect(chiusure).toEqual([])
      ;(figlio().componentInstance as AddebitoDialogComponent).visibleChange.emit(false)
      await stabilizza(fixture)
      c.alCambioVisibilita(false)
      expect(chiusure).toEqual([false])
    })

    it('"Nuovo codice IVA" apre il dialog dei codici e la voce salvata finisce nel campo', async () => {
      await apri({ riga: riga() })
      bottone('riga-nuovo-iva')!.click()
      await stabilizza(fixture)
      // Anche il dialog rapido dell'addebito contiene un dialog dei codici IVA: serve quello della riga.
      const dlg = fixture.debugElement
        .queryAll(By.directive(CodiceIvaDialogComponent))
        .map(e => e.componentInstance as CodiceIvaDialogComponent)
        .find(d => d.visible) as CodiceIvaDialogComponent
      expect(dlg.visible).toBeTrue()
      dlg.salvato.emit({ ...IVA[1], id: 'i9', codice: '4', descrizione: 'Minima' })
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(valore('riga-iva')).toBe('i9')
    })

    it('"Nuova categoria" e "Nuovo centro di ricavo" ci sono, rapidi', async () => {
      await apri({ riga: riga() })
      expect(q('riga-nuova-categoria')).toBeTruthy()
      expect(q('riga-nuovo-centro')).toBeTruthy()
    })

    it('Esc con il sub-dialog dei codici IVA aperto non chiude la riga', async () => {
      const c = await apri({ riga: riga() })
      bottone('riga-nuovo-iva')!.click()
      await stabilizza(fixture)
      c.alCambioVisibilita(false)
      expect(chiusure).toEqual([])
    })
  })

  describe('sola lettura', () => {
    it('niente Salva né "Nuovo …", modulo disabilitato', async () => {
      await apri({ riga: riga(), soloLettura: true })
      expect(q('riga-salva')).toBeNull()
      expect(q('riga-nuovo-addebito')).toBeNull()
      expect(q('riga-nuovo-iva')).toBeNull()
      expect(q<HTMLInputElement>('riga-prezzo')!.disabled).toBeTrue()
      expect(q('riga-ricerca')).toBeTruthy()
      expect(q<HTMLInputElement>('riga-ricerca')!.disabled).toBeTrue()
    })

    it('salva() non scrive in sola lettura', async () => {
      const c = await apri({ riga: riga(), soloLettura: true })
      c.salva()
      expect(righe.modifica).not.toHaveBeenCalled()
    })

    it('il VIEWER non ha "Nuovo …" anche se la riga è modificabile', async () => {
      await apri({ riga: riga(), ruolo: 'VIEWER' })
      expect(q('riga-nuovo-addebito')).toBeNull()
      expect(q('riga-nuovo-iva')).toBeNull()
    })
  })

  describe('chiusura', () => {
    it('Annulla chiude e riaprendo il modulo è vuoto', async () => {
      await apri({ riga: riga() })
      bottone('riga-annulla')!.click()
      expect(chiusure).toEqual([false])
      fixture.componentRef.setInput('visible', false)
      await stabilizza(fixture)
      fixture.componentRef.setInput('riga', null)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      expect(valore('riga-tipo')).toBe('')
      expect(testo('riga-scelta')).toBe('Nessuna scelta')
    })
  })

  describe('virgola decimale obbligatoria', () => {
    it('1000 riaperto e risalvato parte come "1000"', async () => {
      await apri({ riga: riga({ prezzo: '1000.00' }) })
      expect(valore('riga-prezzo')).toBe('1000')
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.modifica.calls.mostRecent().args[1].prezzo).toBe('1000')
    })

    it('«1.000» dà l’errore sul campo e Salva è spento', async () => {
      await apri({ riga: riga() })
      scrivi('riga-prezzo', '1.000')
      await stabilizza(fixture)
      expect(testo('riga-errore-prezzo')).toBe('Usa la virgola per i decimali')
      expect(bottone('riga-salva')!.disabled).toBeTrue()
      scrivi('riga-prezzo', '1000')
      await stabilizza(fixture)
      expect(bottone('riga-salva')!.disabled).toBeFalse()
    })

    it('«1234,5» parte come 1234.5', async () => {
      await apri({ riga: riga() })
      scrivi('riga-prezzo', '1234,5')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      expect(righe.modifica.calls.mostRecent().args[1].prezzo).toBe('1234.5')
    })

    it('una fascia con il punto spegne Salva', async () => {
      await apri({ riga: riga({ prezzoSpeciale: true, applicaA: 'DOCUMENTO', prezzo: null }) })
      scrivi('fascia-1-fino', '1.000')
      await stabilizza(fixture)
      expect(bottone('riga-salva')!.disabled).toBeTrue()
    })

    it('«si applica a» cambiato: giorno e mese di riferimento non partono (I3)', async () => {
      await apri({
        riga: riga({
          prezzoSpeciale: true,
          prezzo: null,
          applicaA: 'PROGRESSIVO_DA_DATA',
          riferimentoGiorno: 5,
          riferimentoMese: 3,
          scaglioni: [
            {
              ordine: 1,
              finoA: '10',
              prezzo: '1',
              sconto: null,
              provvigione: null,
              tipoCalcolo: 'A',
            },
            {
              ordine: 7,
              finoA: null,
              prezzo: '1',
              sconto: null,
              provvigione: null,
              tipoCalcolo: 'A',
            },
          ],
        }),
      })
      imposta('riga-applica-a', 'DOCUMENTO')
      await stabilizza(fixture)
      bottone('riga-salva')!.click()
      await stabilizza(fixture)
      const corpo = righe.modifica.calls.mostRecent().args[1]
      expect(corpo.riferimentoGiorno).toBeNull()
      expect(corpo.riferimentoMese).toBeNull()
    })
  })
})
