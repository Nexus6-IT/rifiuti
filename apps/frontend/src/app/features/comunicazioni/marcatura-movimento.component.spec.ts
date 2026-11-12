import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { MarcaturaMovimentoComponent } from './marcatura-movimento.component'
import { ConsorziService } from './consorzi.service'
import { MarcaturaMovimento } from './consorzi.model'
import { ToastService } from '../../core/services/toast.service'

const vuoto: MarcaturaMovimento = { marcature: [], esclusi: [] }

describe('MarcaturaMovimentoComponent', () => {
  let fixture: ComponentFixture<MarcaturaMovimentoComponent>
  let svc: jasmine.SpyObj<ConsorziService>
  let toast: jasmine.SpyObj<ToastService>

  function setup(
    puoModificare: boolean,
    stato: MarcaturaMovimento = vuoto,
    lettureRegole: Array<ReturnType<ConsorziService['regole']>> = []
  ): void {
    svc = jasmine.createSpyObj<ConsorziService>('ConsorziService', [
      'regole',
      'consorziDeiMovimenti',
      'impostaOverride',
      'rimuoviOverride',
    ])
    svc.regole.and.returnValue(of({ regole: [], puoModificare }))
    if (lettureRegole.length) svc.regole.and.returnValues(...lettureRegole)
    svc.consorziDeiMovimenti.and.returnValue(of({ m1: stato }))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [MarcaturaMovimentoComponent],
      providers: [
        { provide: ConsorziService, useValue: svc },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(MarcaturaMovimentoComponent)
    fixture.componentRef.setInput('movimentoId', 'm1')
    fixture.detectChanges()
  }
  const q = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`)

  it('mostra lo stato di ogni consorzio: da regola, a mano, escluso, non marcato', () => {
    setup(false, {
      marcature: [
        { consorzio: 'CONOU', origine: 'REGOLA' },
        { consorzio: 'COREPLA', origine: 'MANUALE' },
      ],
      esclusi: ['COBAT'],
    })
    expect(q('marcatura-riga-CONOU')?.textContent).toContain('Marcato da una regola')
    expect(q('marcatura-riga-COREPLA')?.textContent).toContain('Marcato a mano')
    expect(q('marcatura-riga-COBAT')?.textContent).toContain('Escluso a mano')
  })

  it('chi non puo modificare non vede i pulsanti', () => {
    setup(false)
    expect(q('marcatura-marca-CONOU')).toBeNull()
  })

  it('«Marca a mano» imposta la marcatura (escluso false) ed emette l esito', () => {
    setup(true)
    const dopo: MarcaturaMovimento = {
      marcature: [{ consorzio: 'CONOU', origine: 'MANUALE' }],
      esclusi: [],
    }
    svc.impostaOverride.and.returnValue(of(dopo))
    let emesso: MarcaturaMovimento | undefined
    fixture.componentInstance.cambiato.subscribe(m => (emesso = m))
    ;(q('marcatura-marca-CONOU')?.querySelector('button') as HTMLButtonElement).click()
    expect(svc.impostaOverride).toHaveBeenCalledWith('m1', 'CONOU', false)
    expect(emesso).toEqual(dopo)
    fixture.detectChanges()
    expect(q('marcatura-riga-CONOU')?.textContent).toContain('Marcato a mano')
  })

  it('un movimento marcato da una regola si puo escludere; una correzione si toglie', () => {
    setup(true, {
      marcature: [{ consorzio: 'CONOU', origine: 'REGOLA' }],
      esclusi: ['COBAT'],
    })
    svc.impostaOverride.and.returnValue(of({ marcature: [], esclusi: ['CONOU', 'COBAT'] }))
    ;(q('marcatura-escludi-CONOU')?.querySelector('button') as HTMLButtonElement).click()
    expect(svc.impostaOverride).toHaveBeenCalledWith('m1', 'CONOU', true)
    svc.rimuoviOverride.and.returnValue(of(vuoto))
    fixture.detectChanges()
    ;(q('marcatura-togli-COBAT')?.querySelector('button') as HTMLButtonElement).click()
    expect(svc.rimuoviOverride).toHaveBeenCalledWith('m1', 'COBAT')
  })

  it('errore di scrittura: avvisa e lascia lo stato com era', () => {
    setup(true)
    svc.impostaOverride.and.returnValue(throwError(() => ({ status: 403 })))
    fixture.componentInstance.imposta('CONOU', false)
    expect(toast.error).toHaveBeenCalled()
    expect(fixture.componentInstance.corrente()).toEqual(vuoto)
    expect(fixture.componentInstance.inCorso()).toBe(false)
  })

  it('il permesso di modifica si legge una volta sola, anche se il padre aggiorna la marcatura', () => {
    setup(true)
    fixture.componentRef.setInput('marcatura', {
      marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }],
      esclusi: [],
    })
    fixture.detectChanges()
    fixture.componentRef.setInput('marcatura', vuoto)
    fixture.detectChanges()
    expect(svc.regole).toHaveBeenCalledTimes(1)
  })

  it('se l esito e gia noto dall elenco non rilegge', () => {
    svc = jasmine.createSpyObj<ConsorziService>('ConsorziService', [
      'regole',
      'consorziDeiMovimenti',
    ])
    svc.regole.and.returnValue(of({ regole: [], puoModificare: false }))
    TestBed.configureTestingModule({
      imports: [MarcaturaMovimentoComponent],
      providers: [
        { provide: ConsorziService, useValue: svc },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    })
    fixture = TestBed.createComponent(MarcaturaMovimentoComponent)
    fixture.componentRef.setInput('movimentoId', 'm1')
    fixture.componentRef.setInput('marcatura', {
      marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }],
      esclusi: [],
    })
    fixture.detectChanges()
    expect(svc.consorziDeiMovimenti).not.toHaveBeenCalled()
    expect(q('marcatura-riga-COBAT')?.textContent).toContain('Marcato da una regola')
  })
  describe('correzione manuale e regola concorrente (regolaPrende)', () => {
    const manuale = (regolaPrende?: Array<'CONOU' | 'COBAT' | 'COREPLA'>): MarcaturaMovimento => ({
      marcature: [{ consorzio: 'CONOU', origine: 'MANUALE' }],
      esclusi: [],
      ...(regolaPrende ? { regolaPrende } : {}),
    })

    it('se una regola prenderebbe il movimento propone «Torna alla regola» e lo dice', () => {
      setup(true, manuale(['CONOU']))
      expect(q('marcatura-riga-CONOU')?.textContent).toContain('una regola lo prenderebbe')
      expect(q('marcatura-togli-CONOU')?.textContent).toContain('Torna alla regola')
    })

    it('se nessuna regola lo prende lo dice e togliere la marcatura lo lascia non marcato', () => {
      setup(true, manuale([]))
      expect(q('marcatura-riga-CONOU')?.textContent).toContain('nessuna regola lo prende')
      expect(q('marcatura-togli-CONOU')?.textContent).toContain('Togli la marcatura')
      expect(q('marcatura-togli-CONOU')?.textContent).not.toContain('Torna alla regola')
    })

    it('senza il campo (risposta di un backend piu vecchio) resta il comportamento di prima', () => {
      setup(true, manuale())
      expect(q('marcatura-riga-CONOU')?.textContent).toContain('Marcato a mano')
      expect(q('marcatura-togli-CONOU')?.textContent).toContain('Togli la marcatura')
    })
  })

  describe('lettura del permesso: nuovo tentativo dopo un errore', () => {
    const errore = () => throwError(() => ({ status: 500 }))

    it('dopo un errore non resta bloccata: al prossimo uso rilegge e abilita i pulsanti', () => {
      setup(true, vuoto, [errore(), of({ regole: [], puoModificare: true })])
      expect(svc.regole).toHaveBeenCalledTimes(1)
      expect(q('marcatura-marca-CONOU')).toBeNull()
      // Nessun'altra chiamata senza un nuovo uso.
      fixture.detectChanges()
      expect(svc.regole).toHaveBeenCalledTimes(1)
      fixture.componentRef.setInput('marcatura', vuoto)
      fixture.detectChanges()
      expect(svc.regole).toHaveBeenCalledTimes(2)
      expect(q('marcatura-marca-CONOU')).not.toBeNull()
      // Riuscita: da qui non rilegge piu.
      fixture.componentRef.setInput('marcatura', { marcature: [], esclusi: ['COBAT'] })
      fixture.detectChanges()
      expect(svc.regole).toHaveBeenCalledTimes(2)
    })

    it('il pulsante «Riprova» rilegge il permesso e sparisce a lettura riuscita', () => {
      setup(true, vuoto, [errore(), of({ regole: [], puoModificare: true })])
      expect(q('marcatura-riprova')).not.toBeNull()
      ;(q('marcatura-riprova')?.querySelector('button') as HTMLButtonElement).click()
      fixture.detectChanges()
      expect(svc.regole).toHaveBeenCalledTimes(2)
      expect(q('marcatura-riprova')).toBeNull()
      expect(q('marcatura-marca-CONOU')).not.toBeNull()
    })
  })
})
