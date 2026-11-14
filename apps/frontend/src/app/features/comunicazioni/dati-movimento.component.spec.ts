import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { DatiMovimentoComponent } from './dati-movimento.component'
import { DatiComunicazioniService } from './dati-comunicazioni.service'
import { DatiMovimentoRisposta } from './dati-comunicazioni.model'
import { ToastService } from '../../core/services/toast.service'

describe('DatiMovimentoComponent', () => {
  let fixture: ComponentFixture<DatiMovimentoComponent>
  let svc: jasmine.SpyObj<DatiComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>
  const q = <T extends HTMLElement>(id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as T | null

  function setup(
    tracciato: 'CONOU' | 'COBAT',
    r: DatiMovimentoRisposta = { dati: null, puoModificare: true }
  ): void {
    svc = jasmine.createSpyObj<DatiComunicazioniService>('DatiComunicazioniService', [
      'datiMovimento',
      'impostaDatiMovimento',
      'cancellaDatiMovimento',
    ])
    svc.datiMovimento.and.returnValue(of(r))
    svc.impostaDatiMovimento.and.returnValue(
      of({ tracciato, dati: {}, versioneSchema: 1, aggiornatoIl: 'x' })
    )
    svc.cancellaDatiMovimento.and.returnValue(of(undefined))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    TestBed.configureTestingModule({
      imports: [DatiMovimentoComponent],
      providers: [
        { provide: DatiComunicazioniService, useValue: svc },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(DatiMovimentoComponent)
    fixture.componentRef.setInput('movimentoId', 'm1')
    fixture.componentRef.setInput('tracciato', tracciato)
    fixture.detectChanges()
  }

  it('CONOU: legge i dati e li mostra', () => {
    setup('CONOU', {
      dati: {
        tracciato: 'CONOU',
        dati: { prodotto: 'B', percentualeOlio: 84.5, scaricoInterno: true },
        versioneSchema: 1,
        aggiornatoIl: 'x',
      },
      puoModificare: true,
    })
    const c = fixture.componentInstance
    expect(svc.datiMovimento).toHaveBeenCalledWith('m1', 'CONOU')
    expect(c.prodotto).toBe('B')
    expect(c.percentuale).toBe(84.5)
    expect(c.scaricoInterno).toBeTrue()
    expect(c.presenti()).toBeTrue()
  })

  it('CONOU: salva solo i campi valorizzati', () => {
    setup('CONOU')
    const c = fixture.componentInstance
    c.prodotto = 'A'
    c.percentuale = 90
    c.salva()
    expect(svc.impostaDatiMovimento).toHaveBeenCalledWith('m1', 'CONOU', {
      prodotto: 'A',
      percentualeOlio: 90,
    })
    expect(toast.success).toHaveBeenCalled()
    expect(c.presenti()).toBeTrue()
  })

  it('COBAT: tipo, causa e PGF', () => {
    setup('COBAT')
    const c = fixture.componentInstance
    c.tipoMovimento = 3
    c.causa = 5
    c.pgf = 'C'
    expect(c.dati()).toEqual({ tipoMovimento: 3, causa: 5, pgf: 'C' })
    expect(fixture.nativeElement.querySelector('#dm-tipo')).not.toBeNull()
    expect(fixture.nativeElement.querySelector('#dm-prodotto')).toBeNull()
  })

  it('«Togli i dati» cancella e rilegge', () => {
    setup('CONOU', {
      dati: { tracciato: 'CONOU', dati: { prodotto: 'A' }, versioneSchema: 1, aggiornatoIl: 'x' },
      puoModificare: true,
    })
    fixture.componentInstance.togli()
    expect(svc.cancellaDatiMovimento).toHaveBeenCalledWith('m1', 'CONOU')
    expect(svc.datiMovimento).toHaveBeenCalledTimes(2)
  })

  it('errori del backend: elenco; sola lettura: niente salvataggio né pulsanti', () => {
    setup('CONOU')
    svc.impostaDatiMovimento.and.returnValue(
      throwError(() => ({ error: { details: { errori: ['prodotto: uno tra A, B, C, E, G'] } } }))
    )
    fixture.componentInstance.salva()
    fixture.detectChanges()
    expect(q('dati-errori-campo')?.textContent).toContain('prodotto')
    expect(toast.success).not.toHaveBeenCalled()

    TestBed.resetTestingModule()
    setup('CONOU', { dati: null, puoModificare: false })
    fixture.componentInstance.salva()
    expect(svc.impostaDatiMovimento).not.toHaveBeenCalled()
    expect(q('dati-salva')).toBeNull()
  })

  it('lettura fallita: messaggio di errore', () => {
    setup('CONOU')
    svc.datiMovimento.and.returnValue(throwError(() => new Error('x')))
    fixture.componentInstance.ngOnChanges({ movimentoId: {} as never })
    fixture.detectChanges()
    expect(q('dati-errore')?.textContent).toContain('Impossibile leggere')
  })
})
