import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { Router, provideRouter } from '@angular/router'
import { of } from 'rxjs'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { ComunicazioniTracciatiComponent } from './comunicazioni-tracciati.component'
import { TracciatoConsorzioComponent } from './tracciato-consorzio.component'
import { TracciatiService } from './tracciati.service'
import { ComunicazioniService } from './comunicazioni.service'
import { ToastService } from '../../core/services/toast.service'

const sede = (id: string, denominazione: string, attiva = true) => ({
  id,
  denominazione,
  attiva,
  numIscrSito: 'X',
  principale: false,
  createdAt: '',
  updatedAt: '',
})

describe('ComunicazioniTracciatiComponent', () => {
  let fixture: ComponentFixture<ComunicazioniTracciatiComponent>
  const q = (id: string) =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  function setup(sedi: ReturnType<typeof sede>[]): void {
    const unita = jasmine.createSpyObj<RentriUnitaLocaleService>('RentriUnitaLocaleService', [
      'list',
    ])
    unita.list.and.returnValue(of(sedi as never))
    const tracciati = jasmine.createSpyObj<TracciatiService>('TracciatiService', [
      'anteprima',
      'genera',
      'storico',
    ])
    tracciati.anteprima.and.returnValue(
      of({
        unitaLocale: { id: 'ul-1', nome: 'S' },
        consorzio: 'CONOU',
        periodo: { da: '', a: '' },
        tracciato: 't',
        versione: 'v',
        affidabilita: 'RICAVATO_WINWASTE',
        notaAffidabilita: 'n',
        numeroRecord: 0,
        numeroMovimenti: 0,
        avvisi: [],
        bloccanti: false,
        hashDati: 'h',
      })
    )
    tracciati.storico.and.returnValue(of([]))
    TestBed.configureTestingModule({
      imports: [ComunicazioniTracciatiComponent, NoopAnimationsModule],
      providers: [
        provideRouter([]),
        { provide: RentriUnitaLocaleService, useValue: unita },
        { provide: TracciatiService, useValue: tracciati },
        { provide: ComunicazioniService, useValue: {} },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['success', 'error']),
        },
      ],
    })
    fixture = TestBed.createComponent(ComunicazioniTracciatiComponent)
    fixture.detectChanges()
  }

  it('una sola sede attiva: scelta in automatico, scheda CONOU', () => {
    setup([sede('ul-1', 'Sede 1'), sede('ul-2', 'Sede chiusa', false)])
    expect(q('tracciati-sede-unica')?.textContent).toContain('Sede 1')
    expect(fixture.nativeElement.querySelector('app-tracciato-consorzio')).not.toBeNull()
  })

  it('piu sedi: nessuna scheda finche non si sceglie la sede', () => {
    setup([sede('ul-1', 'Sede 1'), sede('ul-2', 'Sede 2')])
    expect(fixture.nativeElement.querySelector('app-tracciato-consorzio')).toBeNull()
    fixture.componentInstance.unitaLocaleId.set('ul-2')
    fixture.detectChanges()
    const comp = fixture.debugElement.query(
      d => d.componentInstance instanceof TracciatoConsorzioComponent
    ).componentInstance as TracciatoConsorzioComponent
    expect(comp.unitaLocaleId).toBe('ul-2')
    expect(comp.consorzio).toBe('CONOU')
  })

  it('scegliere COBAT cambia la scheda', () => {
    setup([sede('ul-1', 'Sede 1')])
    ;(q('tracciati-scegli-COBAT')?.querySelector('button') as HTMLButtonElement).click()
    fixture.detectChanges()
    const comp = fixture.debugElement.query(
      d => d.componentInstance instanceof TracciatoConsorzioComponent
    ).componentInstance as TracciatoConsorzioComponent
    expect(comp.consorzio).toBe('COBAT')
  })

  it('nessuna sede attiva: avviso', () => {
    setup([])
    expect(fixture.nativeElement.textContent).toContain('Nessuna sede attiva')
  })

  it('il pulsante O.R.SO. torna alla pagina delle comunicazioni', () => {
    setup([sede('ul-1', 'Sede 1')])
    const router = TestBed.inject(Router)
    const nav = spyOn(router, 'navigate').and.resolveTo(true)
    ;(q('tracciati-vai-orso')?.querySelector('button') as HTMLButtonElement).click()
    expect(nav).toHaveBeenCalledWith(['/comunicazioni'])
  })
})
