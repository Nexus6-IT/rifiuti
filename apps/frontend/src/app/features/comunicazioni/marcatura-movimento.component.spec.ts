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

  function setup(puoModificare: boolean, stato: MarcaturaMovimento = vuoto): void {
    svc = jasmine.createSpyObj<ConsorziService>('ConsorziService', [
      'regole',
      'consorziDeiMovimenti',
      'impostaOverride',
      'rimuoviOverride',
    ])
    svc.regole.and.returnValue(of({ regole: [], puoModificare }))
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
})
