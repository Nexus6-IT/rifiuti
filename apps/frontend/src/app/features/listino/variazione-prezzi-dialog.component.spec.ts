import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { Cliente } from '../clienti/clienti.model'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { SceltaClienteComponent } from '../contratti-cliente/scelta-cliente.component'
import { AnteprimaVariazioneContratti, EsitoVariazione } from './listino.model'
import { ListinoService } from './listino.service'
import {
  MESSAGGIO_VARIAZIONE_SUPERATA,
  VariazionePrezziDialogComponent,
} from './variazione-prezzi-dialog.component'

@Component({ selector: 'app-scelta-cliente', standalone: true, template: '' })
class SceltaClienteFinta {
  @Input() prefisso = ''
  @Input() prefissoNuovo = ''
  @Input() etichetta = ''
  @Output() scelto = new EventEmitter<Cliente | null>()
}

const ANTEPRIMA: AnteprimaVariazioneContratti = {
  totale: 2,
  righe: [
    {
      id: 'r1',
      cliente: 'Verdi',
      contratto: 'CC-1',
      elenco: '001',
      voce: '20 03 01',
      prima: '10',
      dopo: '10,5',
    },
    {
      id: 'r2',
      cliente: 'Verdi',
      contratto: 'CC-1',
      elenco: '001',
      voce: '15 01 01',
      prima: '8',
      dopo: '8,4',
    },
  ],
  errori: [],
  impronta: 'imp1',
}
const cod = (id: string, descrizione: string) => ({
  id,
  codice: id,
  descrizione,
  genere: 'CATEGORIA',
})

describe('VariazionePrezziDialogComponent', () => {
  let fixture: ComponentFixture<VariazionePrezziDialogComponent>
  let anteprimaSpy: jasmine.Spy
  let applicaSpy: jasmine.Spy
  let addebitiList: jasmine.Spy
  let applicati: number[]
  let visibilita: boolean[]

  async function apri(role = 'ADMIN', contrattiIds: string[] | null = null) {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
    fixture = TestBed.createComponent(VariazionePrezziDialogComponent)
    applicati = []
    visibilita = []
    fixture.componentInstance.applicata.subscribe(n => applicati.push(n))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    fixture.componentRef.setInput('contrattiIds', contrattiIds)
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
  }
  const sel = (id: string, v: string) => {
    const s = q<HTMLSelectElement>(id)!
    s.value = v
    s.dispatchEvent(new Event('change'))
  }
  async function aumento(valore = '3,5') {
    scrivi('vp-valore', valore)
    await stabilizza(fixture)
  }
  async function anteprima() {
    bottone('vp-anteprima')!.click()
    await stabilizza(fixture)
  }
  async function fino_a_conferma() {
    await anteprima()
    bottone('vp-applica')!.click()
    await stabilizza(fixture)
  }

  beforeEach(() => {
    anteprimaSpy = jasmine.createSpy('anteprima').and.returnValue(of(ANTEPRIMA))
    applicaSpy = jasmine
      .createSpy('applica')
      .and.returnValue(of({ aggiornati: 2 } as EsitoVariazione))
    addebitiList = jasmine
      .createSpy('list')
      .and.returnValue(
        of({ elementi: [{ id: 'ad1', codice: '00001', descrizione: 'Trasporto' }], totale: 1 })
      )
    TestBed.configureTestingModule({
      imports: [VariazionePrezziDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: ListinoService,
          useValue: {
            variazioniContratti: { anteprima: anteprimaSpy, applica: applicaSpy },
            addebiti: { list: addebitiList },
            codifiche: {
              list: (g: string) =>
                of(g === 'CENTRO_RICAVO' ? [cod('cr1', 'Centro 1')] : [cod('ca1', 'Cat A')]),
            },
            codiciIva: {
              list: () =>
                of([
                  { id: 'i1', codice: '22', descrizione: 'Ordinaria' },
                  { id: 'i2', codice: '10', descrizione: 'Ridotta' },
                ]),
            },
          },
        },
        {
          provide: TabelleFatturazioneService,
          useValue: {
            codifiche: {
              list: (g: string) =>
                of(g === 'TIPO' ? [cod('tc1', 'Annuale')] : [cod('cc1', 'Urbani')]),
            },
          },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
    TestBed.overrideComponent(VariazionePrezziDialogComponent, {
      remove: { imports: [SceltaClienteComponent] },
      add: { imports: [SceltaClienteFinta] },
    })
  })
  afterEach(() => fixture?.destroy())

  it('senza anteprima non c’è "Applica"; senza valore l’anteprima è spenta', async () => {
    await apri()
    expect(q('vp-applica')).toBeNull()
    expect(bottone('vp-anteprima')!.disabled).toBeTrue()
  })

  it('un OPERATOR non può chiedere l’anteprima', async () => {
    await apri('OPERATOR')
    await aumento()
    expect(bottone('vp-anteprima')!.disabled).toBeTrue()
  })

  it('virgola obbligatoria: «3.5» dà l’errore e l’anteprima resta spenta; «1.000» idem', async () => {
    await apri()
    await aumento('3.5')
    expect(q('vp-errore-valore')!.textContent).toContain('Usa la virgola per i decimali')
    expect(bottone('vp-anteprima')!.disabled).toBeTrue()
    await aumento('1.000')
    expect(bottone('vp-anteprima')!.disabled).toBeTrue()
  })

  it('prezzo attuale col punto: errore sul campo e anteprima spenta', async () => {
    await apri()
    await aumento()
    scrivi('vp-prezzo-attuale', '10.00')
    await stabilizza(fixture)
    expect(q('vp-errore-prezzo')!.textContent).toContain('Usa la virgola')
    expect(bottone('vp-anteprima')!.disabled).toBeTrue()
  })

  it('il corpo ha il valore col punto e solo i filtri impostati', async () => {
    await apri()
    await aumento('3,5')
    scrivi('vp-prezzo-attuale', '10,00')
    scrivi('vp-cer', '20 03 01')
    scrivi('vp-riferimento', 'R1')
    q<HTMLInputElement>('vp-prezzi-zero')!.click()
    q<HTMLInputElement>('vp-prezzo-SPECIALE')!.click()
    q<HTMLInputElement>('vp-tipo-F')!.click()
    q<HTMLInputElement>('vp-categorieAddebito-ca1')!.click()
    q<HTMLInputElement>('vp-tipiContratto-tc1')!.click()
    scrivi('vp-inizio-dal', '2026-01-01')
    scrivi('vp-prima-scadenza', '2026-06-30')
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy).toHaveBeenCalledOnceWith({
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3.5',
      filtri: {
        cerCode: '20 03 01',
        riferimento: 'R1',
        prezzoAttuale: '10.00',
        anchePrezziZero: true,
        tipiPrezzo: ['SPECIALE'],
        tipi: ['F'],
        categorieAddebitoIds: ['ca1'],
        tipiContrattoIds: ['tc1'],
        inizioDal: '2026-01-01',
        primaScadenzaFissi: '2026-06-30',
      },
    })
  })

  it('"contratti scelti" (R51): filtro contrattiIds, che si può togliere', async () => {
    await apri('ADMIN', ['cc1', 'cc2'])
    expect(q('vp-contratti-scelti')!.parentElement!.textContent).toContain('2 contratti scelti')
    await aumento()
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0].filtri).toEqual({ contrattiIds: ['cc1', 'cc2'] })
    q<HTMLInputElement>('vp-contratti-scelti')!.click()
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0].filtri).toEqual({})
  })

  it('senza contratti scelti il filtro non c’è', async () => {
    await apri()
    expect(q('vp-contratti-scelti')).toBeNull()
  })

  it('cliente e addebito scelti viaggiano come id', async () => {
    await apri()
    await aumento()
    fixture.debugElement
      .query(By.directive(SceltaClienteFinta))
      .componentInstance.scelto.emit({ id: 'cl7' })
    scrivi('vp-addebito-cerca', 'tras')
    q<HTMLInputElement>('vp-addebito-cerca')!.dispatchEvent(new Event('change'))
    await stabilizza(fixture)
    expect(addebitiList).toHaveBeenCalledWith({ testo: 'tras', pagina: 1, dimensione: 50 })
    sel('vp-addebito', 'ad1')
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0].filtri).toEqual({
      clienteId: 'cl7',
      addebitoId: 'ad1',
    })
  })

  it('"solo minimi" e la sostituzione IVA cambiano il corpo', async () => {
    await apri()
    await aumento()
    q<HTMLInputElement>('vp-solo-minimi')!.click()
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0]).toEqual({
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3.5',
      soloMinimi: true,
      filtri: {},
    })
    sel('vp-tipo', 'SOSTITUZIONE_IVA')
    await stabilizza(fixture)
    sel('vp-da-iva', 'i1')
    sel('vp-a-iva', 'i2')
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0]).toEqual({
      tipo: 'SOSTITUZIONE_IVA',
      daCodiceIvaId: 'i1',
      aCodiceIvaId: 'i2',
      filtri: {},
    })
  })

  it('anteprima mostrata; un criterio cambiato la scarta e con lei il pulsante Applica', async () => {
    await apri()
    await aumento()
    await anteprima()
    expect(q('anteprima-righe')).not.toBeNull()
    expect(bottone('vp-applica')!.disabled).toBeFalse()
    await aumento('4')
    expect(q('anteprima-righe')).toBeNull()
    expect(q('vp-applica')).toBeNull()
  })

  it('con errori nell’anteprima non si applica', async () => {
    anteprimaSpy.and.returnValue(
      of({
        ...ANTEPRIMA,
        errori: [{ id: 'r1', voce: '20 03 01', messaggio: 'Il nuovo prezzo sarebbe negativo.' }],
      })
    )
    await apri()
    await aumento('-90')
    await anteprima()
    expect(q('anteprima-errori')).not.toBeNull()
    expect(bottone('vp-applica')!.disabled).toBeTrue()
  })

  it('errore dell’anteprima in una zona sua, i vocabolari che non si caricano in un’altra', async () => {
    anteprimaSpy.and.returnValue(
      throwError(() => ({ status: 400, error: { message: 'Scegli un filtro.' } }))
    )
    await apri()
    await aumento()
    await anteprima()
    expect(q('vp-errore-anteprima')!.textContent).toContain('Scegli un filtro.')
    expect(q('vp-errore-caricamento')).toBeNull()
  })

  it('riepilogo e conferma: applica con l’impronta dell’anteprima e il corpo dell’anteprima', async () => {
    await apri()
    await aumento()
    await fino_a_conferma()
    expect(q('vp-riepilogo')!.textContent).toContain('Prezzi da modificare: 2')
    expect(applicaSpy).not.toHaveBeenCalled()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(applicaSpy).toHaveBeenCalledOnceWith({
      tipo: 'AUMENTO_PERCENTUALE',
      valore: '3.5',
      filtri: {},
      impronta: 'imp1',
    })
    expect(q('vp-esito')!.textContent).toContain('Prezzi aggiornati: 2')
    expect(applicati).toEqual([2])
  })

  it('409: "rifai l’anteprima", l’anteprima è scartata', async () => {
    applicaSpy.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'altro testo' } }))
    )
    await apri()
    await aumento()
    await fino_a_conferma()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('vp-errore-applica')!.textContent).toContain(MESSAGGIO_VARIAZIONE_SUPERATA)
    expect(q('vp-errore-applica')!.textContent).toContain('rifai l’anteprima')
    expect(q('vp-applica')).toBeNull()
  })

  it('400 all’applicazione: i messaggi del backend', async () => {
    applicaSpy.and.returnValue(
      throwError(() => ({
        status: 400,
        error: { message: 'La variazione tocca troppe righe: restringi i filtri.' },
      }))
    )
    await apri()
    await aumento()
    await fino_a_conferma()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('vp-errore-applica')!.textContent).toContain('troppe righe')
  })

  it('durante l’applicazione né Annulla né Esc chiudono', async () => {
    const lenta = new Subject<EsitoVariazione>()
    applicaSpy.and.returnValue(lenta)
    await apri()
    await aumento()
    await fino_a_conferma()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(bottone('vp-chiudi')!.disabled).toBeTrue()
    fixture.componentInstance.chiudi()
    fixture.componentInstance.applica()
    expect(visibilita).toEqual([])
    expect(applicaSpy).toHaveBeenCalledTimes(1)
    lenta.next({ aggiornati: 2 })
    await stabilizza(fixture)
    fixture.componentInstance.chiudi()
    expect(visibilita).toEqual([false])
  })

  it('se i vocabolari non si caricano lo dice, senza bloccare il resto', async () => {
    TestBed.overrideProvider(TabelleFatturazioneService, {
      useValue: { codifiche: { list: () => throwError(() => ({ status: 500 })) } },
    })
    await apri()
    expect(q('vp-errore-caricamento')!.textContent).toContain('tipi di contratto')
    await aumento()
    expect(bottone('vp-anteprima')!.disabled).toBeFalse()
  })

  it('VARIAZIONE_SUPERATA: "rifai l’anteprima" e anteprima scartata', async () => {
    applicaSpy.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VARIAZIONE_SUPERATA' } }))
    )
    await apri()
    await aumento()
    await fino_a_conferma()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('vp-errore-applica')!.textContent).toContain('rifai l’anteprima')
    expect(q('vp-applica')).toBeNull()
    expect(q('anteprima-righe')).toBeNull()
  })

  it('OPERAZIONE_CONCORRENTE: "riprova", anteprima mantenuta e riapplicabile con un clic', async () => {
    applicaSpy.and.returnValues(
      throwError(() => ({ status: 409, error: { error: 'OPERAZIONE_CONCORRENTE' } })),
      of({ aggiornati: 2 })
    )
    await apri()
    await aumento()
    await fino_a_conferma()
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(q('vp-errore-applica')!.textContent).toContain('riprova')
    expect(q('vp-errore-applica')!.textContent).not.toContain('rifai')
    expect(q('anteprima-righe')).not.toBeNull()
    bottone('vp-applica')!.click()
    await stabilizza(fixture)
    bottone('vp-conferma-finale')!.click()
    await stabilizza(fixture)
    expect(applicaSpy.calls.count()).toBe(2)
    expect(applicaSpy.calls.mostRecent().args[0].impronta).toBe('imp1')
    expect(applicati).toEqual([2])
  })

  it('addebitiIds: filtro con spunta, che si può togliere', async () => {
    TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role: 'ADMIN' }) } })
    fixture = TestBed.createComponent(VariazionePrezziDialogComponent)
    fixture.componentRef.setInput('addebitiIds', ['ad1', 'ad2'])
    fixture.componentRef.setInput('visible', true)
    await stabilizza(fixture)
    expect(q('vp-addebiti-scelti')!.parentElement!.textContent).toContain('2 addebiti scelti')
    await aumento()
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0].filtri).toEqual({ addebitiIds: ['ad1', 'ad2'] })
    q<HTMLInputElement>('vp-addebiti-scelti')!.click()
    await stabilizza(fixture)
    await anteprima()
    expect(anteprimaSpy.calls.mostRecent().args[0].filtri).toEqual({})
  })

  it('righe invariate dell’anteprima mostrate', async () => {
    anteprimaSpy.and.returnValue(of({ ...ANTEPRIMA, invariate: 4 }))
    await apri()
    await aumento()
    await anteprima()
    expect(q('anteprima-invariate')!.textContent).toContain('4 righe invariate')
  })
})
