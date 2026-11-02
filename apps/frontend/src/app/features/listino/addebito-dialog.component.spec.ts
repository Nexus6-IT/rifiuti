import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AddebitoDialogComponent } from './addebito-dialog.component'
import { CodificaAddebitoDialogComponent } from './tabelle/codifica-addebito-dialog.component'
import { CodiceIvaDialogComponent } from './tabelle/codice-iva-dialog.component'
import { ListinoService } from './listino.service'
import { Addebito, CodiceIva, CodificaAddebito, GenereCodificaAddebito } from './listino.model'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'

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

const CODIFICHE: Record<GenereCodificaAddebito, CodificaAddebito[]> = {
  GRUPPO: [cod('GRUPPO', 'g1', '001', 'Trasporti'), cod('GRUPPO', 'g2', '002', 'Analisi')],
  CATEGORIA: [cod('CATEGORIA', 'c1', '001', 'Standard')],
  CENTRO_RICAVO: [cod('CENTRO_RICAVO', 'r1', '001', 'Sede')],
  CATEGORIA_STATISTICA_1: [cod('CATEGORIA_STATISTICA_1', 's1', '001', 'Stat uno')],
  CATEGORIA_STATISTICA_2: [cod('CATEGORIA_STATISTICA_2', 't1', '001', 'Stat due')],
}

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
]

const rif = (id: string, codice: string, descrizione: string) => ({ id, codice, descrizione })

const esistente = (over: Partial<Addebito> = {}): Addebito => ({
  id: 'ad1',
  codice: '00001',
  descrizione: 'Trasporto rifiuti',
  gruppo: rif('g1', '001', 'Trasporti'),
  unitaMisura: 'KG',
  codiceIva: rif('i1', '22', 'Ordinaria'),
  tipo: 'T123',
  etichettaTipo: 'Peso netto di tutti i rifiuti di cat. 123 del presente elenco',
  categoria: null,
  tipoProvvigione: 'LORDO',
  centroRicavo: null,
  categoriaStatistica1: null,
  categoriaStatistica2: null,
  notaUsoInterno: null,
  appunti: 'vecchio appunto',
  listini: [1, 2, 3, 4, 5, 6].map(n => ({
    numero: n as 1,
    prezzo: n === 1 ? '10.50' : null,
    sconto: n === 1 ? '10+5' : null,
    provvigione: n === 1 ? '3' : null,
  })),
  attivo: true,
  versione: 7,
  eliminabile: true,
  ...over,
})

describe('AddebitoDialogComponent', () => {
  let fixture: ComponentFixture<AddebitoDialogComponent>
  let addebiti: { get: jasmine.Spy; crea: jasmine.Spy; modifica: jasmine.Spy }
  let codifiche: { list: jasmine.Spy }
  let codiciIva: { list: jasmine.Spy }
  let salvati: Addebito[]
  let visibilita: boolean[]
  let daRicaricare: number

  async function apri(a: Addebito | null = null, role = 'ADMIN') {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(AddebitoDialogComponent)
    salvati = []
    visibilita = []
    daRicaricare = 0
    fixture.componentInstance.salvato.subscribe(v => salvati.push(v))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentInstance.daRicaricare.subscribe(() => daRicaricare++)
    fixture.componentRef.setInput('addebito', a)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }

  const sel = (id: string, v: string) => {
    const s = q<HTMLSelectElement>(id)!
    s.value = v
    s.dispatchEvent(new Event('change'))
  }
  const sub = (nome: string) =>
    fixture.debugElement.queryAll(e => e.name === nome).map(e => e.componentInstance)
  const disabilitato = () => bottone('add-dlg-salva')!.disabled

  async function compilaMinimo() {
    scrivi('add-dlg-descrizione', '  Servizio  ')
    scrivi('add-dlg-um', 'NR')
    sel('add-dlg-gruppo', 'g1')
    sel('add-dlg-tipo', 'V')
    await stabilizza(fixture)
  }

  beforeEach(() => {
    addebiti = {
      get: jasmine.createSpy('get'),
      crea: jasmine
        .createSpy('crea')
        .and.callFake((d: unknown) => of({ ...esistente(), ...(d as object) })),
      modifica: jasmine
        .createSpy('modifica')
        .and.callFake((_i: string, d: unknown) => of({ ...esistente(), ...(d as object) })),
    }
    codifiche = {
      list: jasmine.createSpy('list').and.callFake((g: GenereCodificaAddebito) => of(CODIFICHE[g])),
    }
    codiciIva = { list: jasmine.createSpy('list').and.returnValue(of(IVA)) }
    TestBed.configureTestingModule({
      imports: [AddebitoDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ListinoService, useValue: { addebiti, codifiche, codiciIva } },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  describe('nuovo', () => {
    it('carica le sole voci attive dei cinque generi e dei codici IVA', async () => {
      await apri()
      expect(
        codifiche.list.calls
          .allArgs()
          .map(a => a[0])
          .sort()
      ).toEqual(Object.keys(CODIFICHE).sort())
      expect(codiciIva.list).toHaveBeenCalled()
      expect(q('add-dlg-gruppo')!.textContent).toContain('001 - Trasporti')
      expect(q('add-dlg-iva')!.textContent).toContain('22 - Ordinaria')
    })

    it('mostra la tabella dei sei listini con prezzo, sconto e provvigione', async () => {
      await apri()
      for (let n = 1; n <= 6; n++) {
        expect(q(`add-dlg-prezzo-${n}`)).toBeTruthy()
        expect(q(`add-dlg-sconto-${n}`)).toBeTruthy()
        expect(q(`add-dlg-provv-${n}`)).toBeTruthy()
      }
      expect(q('add-dlg-prezzo-7')).toBeNull()
    })

    it('l’unità di misura accetta al massimo tre caratteri', async () => {
      await apri()
      expect(q('add-dlg-um')!.getAttribute('maxlength')).toBe('3')
    })

    it('Salva è disabilitato finché mancano descrizione, gruppo, unità di misura e tipo', async () => {
      await apri()
      expect(disabilitato()).toBeTrue()
      await compilaMinimo()
      expect(disabilitato()).toBeFalse()
    })

    it('manda i prezzi con il punto, i vuoti a null, sei listini e nessun codice', async () => {
      await apri()
      await compilaMinimo()
      scrivi('add-dlg-prezzo-1', '10,50')
      scrivi('add-dlg-sconto-1', '10,5+5')
      scrivi('add-dlg-provv-1', '2,5')
      scrivi('add-dlg-prezzo-3', ' 0,0125 ')
      sel('add-dlg-tipo-provv', 'LORDO')
      bottone('add-dlg-salva')!.click()
      const corpo = addebiti.crea.calls.mostRecent().args[0]
      expect(corpo).toEqual(
        jasmine.objectContaining({
          descrizione: 'Servizio',
          unitaMisura: 'NR',
          gruppoId: 'g1',
          tipo: 'V',
          tipoProvvigione: 'LORDO',
          codiceIvaId: null,
          categoriaId: null,
          centroRicavoId: null,
        })
      )
      expect('codice' in corpo).toBeFalse()
      expect(corpo.listini.length).toBe(6)
      expect(corpo.listini[0]).toEqual({
        numero: 1,
        prezzo: '10.50',
        sconto: '10.5+5',
        provvigione: '2.5',
      })
      expect(corpo.listini[2].prezzo).toBe('0.0125')
      expect(corpo.listini[1]).toEqual({
        numero: 2,
        prezzo: null,
        sconto: null,
        provvigione: null,
      })
      expect(typeof corpo.listini[0].prezzo).toBe('string')
    })

    it('un codice scritto viaggia, uno vuoto no', async () => {
      await apri()
      await compilaMinimo()
      scrivi('add-dlg-codice', '00042')
      bottone('add-dlg-salva')!.click()
      expect(addebiti.crea.calls.mostRecent().args[0].codice).toBe('00042')
    })

    for (const [prefisso, cifre] of [
      ['T', '123'],
      ['M', '045'],
    ] as const) {
      it(`${prefisso}???: chiede le tre cifre e compone il tipo`, async () => {
        await apri()
        await compilaMinimo()
        expect(q('add-dlg-tipo-cifre')).toBeNull()
        sel('add-dlg-tipo', `${prefisso}???`)
        await stabilizza(fixture)
        expect(q('add-dlg-tipo-cifre')).toBeTruthy()
        expect(disabilitato()).toBeTrue()
        scrivi('add-dlg-tipo-cifre', '12')
        await stabilizza(fixture)
        expect(disabilitato()).toBeTrue()
        scrivi('add-dlg-tipo-cifre', cifre)
        await stabilizza(fixture)
        expect(disabilitato()).toBeFalse()
        bottone('add-dlg-salva')!.click()
        expect(addebiti.crea.calls.mostRecent().args[0].tipo).toBe(`${prefisso}${cifre}`)
      })
    }

    it('il menu dei tipi propone i tipi d’archivio con la loro descrizione', async () => {
      await apri()
      const testo = q('add-dlg-tipo')!.textContent!
      expect(testo).toContain('Importo fisso periodico')
      expect(testo).toContain('T???')
      expect(testo).not.toContain('Riga CER')
    })

    it('errore del backend: messaggio nel dialog, il dialog resta aperto', async () => {
      addebiti.crea.and.returnValue(
        throwError(() => ({ status: 400, error: { message: 'Il prezzo non è valido.' } }))
      )
      await apri()
      await compilaMinimo()
      bottone('add-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('add-dlg-errore')!.textContent).toContain('Il prezzo non è valido.')
      expect(visibilita).toEqual([])
      expect(daRicaricare).toBe(0)
    })

    it('409: messaggio e richiesta di ricaricare l’elenco', async () => {
      addebiti.crea.and.returnValue(
        throwError(() => ({ status: 409, error: { message: 'Il codice è già usato.' } }))
      )
      await apri()
      await compilaMinimo()
      bottone('add-dlg-salva')!.click()
      await stabilizza(fixture)
      expect(q('add-dlg-errore')!.textContent).toContain('Il codice è già usato.')
      expect(daRicaricare).toBe(1)
    })

    it('salvato: emette l’addebito e chiude', async () => {
      await apri()
      await compilaMinimo()
      bottone('add-dlg-salva')!.click()
      expect(salvati.length).toBe(1)
      expect(visibilita).toEqual([false])
    })

    it('chiusura: il form si azzera, alla riapertura è vuoto', async () => {
      await apri()
      await compilaMinimo()
      fixture.componentInstance.chiudi()
      fixture.componentRef.setInput('visible', false)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      expect(q<HTMLInputElement>('add-dlg-descrizione')!.value).toBe('')
      expect(disabilitato()).toBeTrue()
    })

    it('VIEWER: Salva disabilitato e nessun "Nuovo …"', async () => {
      await apri(null, 'VIEWER')
      await compilaMinimo()
      expect(disabilitato()).toBeTrue()
      expect(q('add-dlg-nuovo-gruppo')).toBeNull()
    })
  })

  describe('modifica', () => {
    it('Salva resta disabilitato finché la lettura non riesce', async () => {
      const lettura = new Subject<Addebito>()
      addebiti.get.and.returnValue(lettura)
      await apri(esistente())
      expect(addebiti.get).toHaveBeenCalledOnceWith('ad1')
      expect(disabilitato()).toBeTrue()
      lettura.next(esistente())
      await stabilizza(fixture)
      expect(disabilitato()).toBeFalse()
    })

    it('lettura fallita: messaggio e Salva disabilitato', async () => {
      addebiti.get.and.returnValue(
        throwError(() => ({ status: 404, error: { message: "L'addebito non esiste." } }))
      )
      await apri(esistente())
      expect(q('add-dlg-errore')!.textContent).toContain("L'addebito non esiste.")
      expect(disabilitato()).toBeTrue()
    })

    it('riempie il form dal record letto: tipo T123 → T??? con 123, prezzi, sconto', async () => {
      addebiti.get.and.returnValue(of(esistente()))
      await apri(esistente())
      expect(q<HTMLInputElement>('add-dlg-descrizione')!.value).toBe('Trasporto rifiuti')
      expect(q<HTMLSelectElement>('add-dlg-tipo')!.value).toBe('T???')
      expect(q<HTMLInputElement>('add-dlg-tipo-cifre')!.value).toBe('123')
      expect(q<HTMLSelectElement>('add-dlg-gruppo')!.value).toBe('g1')
      expect(q<HTMLInputElement>('add-dlg-prezzo-1')!.value).toBe('10.50')
      expect(q<HTMLInputElement>('add-dlg-sconto-1')!.value).toBe('10+5')
      expect(q<HTMLSelectElement>('add-dlg-tipo-provv')!.value).toBe('LORDO')
    })

    it('manda la versione del record letto, non quella della riga, e il codice solo se cambia', async () => {
      addebiti.get.and.returnValue(of(esistente({ versione: 9 })))
      await apri(esistente({ versione: 7 }))
      scrivi('add-dlg-descrizione', 'Nuova descrizione')
      bottone('add-dlg-salva')!.click()
      const [id, corpo] = addebiti.modifica.calls.mostRecent().args
      expect(id).toBe('ad1')
      expect(corpo.versione).toBe(9)
      expect(corpo.descrizione).toBe('Nuova descrizione')
      expect('codice' in corpo).toBeFalse()
      expect(corpo.tipo).toBe('T123')
      expect(corpo.listini.length).toBe(6)
    })

    it('cancellare un prezzo lo manda a null', async () => {
      addebiti.get.and.returnValue(of(esistente()))
      await apri(esistente())
      scrivi('add-dlg-prezzo-1', '')
      bottone('add-dlg-salva')!.click()
      expect(addebiti.modifica.calls.mostRecent().args[1].listini[0].prezzo).toBeNull()
    })

    it('una lettura in ritardo di una riapertura precedente non sovrascrive il form', async () => {
      const vecchia = new Subject<Addebito>()
      const nuova = new Subject<Addebito>()
      addebiti.get.and.returnValues(vecchia, nuova)
      await apri(esistente())
      fixture.componentRef.setInput('addebito', esistente({ id: 'ad2', descrizione: 'Secondo' }))
      fixture.componentRef.setInput('visible', false)
      fixture.componentRef.setInput('visible', true)
      await stabilizza(fixture)
      nuova.next(esistente({ id: 'ad2', descrizione: 'Secondo' }))
      vecchia.next(esistente({ descrizione: 'Primo, in ritardo' }))
      await stabilizza(fixture)
      expect(q<HTMLInputElement>('add-dlg-descrizione')!.value).toBe('Secondo')
    })

    it('una voce disattivata dopo la scelta resta fra le opzioni', async () => {
      addebiti.get.and.returnValue(of(esistente({ gruppo: rif('g9', '009', 'Vecchio gruppo') })))
      await apri(esistente())
      expect(q('add-dlg-gruppo')!.textContent).toContain(
        '009 - Vecchio gruppo (non più disponibile)'
      )
    })

    it('VIEWER: Salva disabilitato anche a lettura riuscita', async () => {
      addebiti.get.and.returnValue(of(esistente()))
      await apri(esistente(), 'VIEWER')
      expect(disabilitato()).toBeTrue()
    })
  })

  describe('aggiunta in linea', () => {
    const casi: { nome: string; bottone: string; genere: GenereCodificaAddebito; id: string }[] = [
      { nome: 'gruppo', bottone: 'add-dlg-nuovo-gruppo', genere: 'GRUPPO', id: 'add-dlg-gruppo' },
      {
        nome: 'categoria',
        bottone: 'add-dlg-nuovo-categoria',
        genere: 'CATEGORIA',
        id: 'add-dlg-categoria',
      },
      {
        nome: 'centro di ricavo',
        bottone: 'add-dlg-nuovo-centro',
        genere: 'CENTRO_RICAVO',
        id: 'add-dlg-centro',
      },
      {
        nome: 'statistica 1',
        bottone: 'add-dlg-nuovo-stat1',
        genere: 'CATEGORIA_STATISTICA_1',
        id: 'add-dlg-stat1',
      },
      {
        nome: 'statistica 2',
        bottone: 'add-dlg-nuovo-stat2',
        genere: 'CATEGORIA_STATISTICA_2',
        id: 'add-dlg-stat2',
      },
    ]
    for (const c of casi) {
      describe(c.nome, () => {
        it('apre il sub-dialog rapido del genere e la voce salvata finisce nel campo', async () => {
          await apri()
          const dlg = () => sub('app-codifica-addebito-dialog').find(d => d.genere === c.genere)
          expect(dlg().visible).toBeFalse()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          expect(dlg().visible).toBeTrue()
          expect(dlg().rapida).toBeTrue()
          const nuova = cod(c.genere, 'nuovo1', '777', 'Appena creata')
          dlg().salvato.emit(nuova)
          dlg().visibleChange.emit(false)
          await stabilizza(fixture)
          expect(q<HTMLSelectElement>(c.id)!.value).toBe('nuovo1')
          expect(dlg().visible).toBeFalse()
        })

        it('Esc nel sub-dialog non chiude il dialog dell’addebito e non perde il form', async () => {
          await apri()
          scrivi('add-dlg-descrizione', 'in corso')
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([])
          expect(q<HTMLInputElement>('add-dlg-descrizione')!.value).toBe('in corso')
          sub('app-codifica-addebito-dialog')
            .find(d => d.genere === c.genere)
            .visibleChange.emit(false)
          await stabilizza(fixture)
          fixture.componentInstance.alCambioVisibilita(false)
          expect(visibilita).toEqual([false])
        })

        it('chiuso il sub-dialog il focus torna al pulsante d’origine', async () => {
          await apri()
          bottone(c.bottone)!.click()
          await stabilizza(fixture)
          sub('app-codifica-addebito-dialog')
            .find(d => d.genere === c.genere)
            .visibleChange.emit(false)
          await stabilizza(fixture)
          await new Promise(r => setTimeout(r))
          expect(document.activeElement).toBe(bottone(c.bottone))
        })
      })
    }

    it('codice IVA: "Nuovo codice IVA" apre il dialog dei codici IVA e la scelta finisce nel campo', async () => {
      await apri()
      bottone('add-dlg-nuovo-iva')!.click()
      await stabilizza(fixture)
      const dlg = sub('app-codice-iva-dialog')[0] as CodiceIvaDialogComponent
      expect(dlg.visible).toBeTrue()
      dlg.salvato.emit({ ...IVA[0], id: 'i9', codice: '10', descrizione: 'Ridotta' })
      dlg.visibleChange.emit(false)
      await stabilizza(fixture)
      expect(q<HTMLSelectElement>('add-dlg-iva')!.value).toBe('i9')
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(bottone('add-dlg-nuovo-iva'))
    })

    it('Esc nel sub-dialog dei codici IVA non chiude l’addebito', async () => {
      await apri()
      bottone('add-dlg-nuovo-iva')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
    })

    it('il sub-dialog è il componente delle codifiche (tipo)', async () => {
      await apri()
      expect(sub('app-codifica-addebito-dialog').length).toBe(5)
      expect(
        sub('app-codifica-addebito-dialog')[0] instanceof CodificaAddebitoDialogComponent
      ).toBeTrue()
    })
  })
})
