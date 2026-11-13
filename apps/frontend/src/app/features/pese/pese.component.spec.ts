import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService } from '../registro/registro.service'
import { PeseComponent } from './pese.component'
import { AccessoRiepilogo, ElencoAccessi, PeseService } from './pese.service'

const riga = (id: string, p: Partial<AccessoRiepilogo> = {}): AccessoRiepilogo => ({
  id,
  numero: 'ACC-2026-000' + id,
  stato: 'CHIUSO',
  verso: 'CARICO',
  modo: 'DOPPIA',
  targa: 'AB123CD',
  cerCode: '17 05 04',
  apertoIl: '2026-10-30T08:00:00.000Z',
  nettoKg: 16000,
  qualita: 'DUE_PESATE',
  manuale: true,
  rettificato: true,
  collegato: true,
  ...p,
})
const elenco = (righe: AccessoRiepilogo[]): ElencoAccessi => ({
  righe,
  totale: righe.length,
  pagina: 1,
  puoOperare: true,
  puoRettificare: false,
})

describe('PeseComponent (larghezza a 390 px)', () => {
  let fixture: ComponentFixture<PeseComponent>

  beforeEach(async () => {
    const pese = jasmine.createSpyObj<PeseService>('PeseService', [
      'elencaAccessi',
      'elencaStrumenti',
      'elencaAgenti',
      'elencaAutomezzi',
    ])
    pese.elencaAccessi.and.callFake(f =>
      of(
        f?.stato === 'APERTO'
          ? elenco([
              riga('1', { stato: 'APERTO', nettoKg: null, qualita: null, targa: 'AB123CD-LUNGA' }),
            ])
          : elenco([riga('2'), riga('3', { targa: null, cerCode: null })])
      )
    )
    pese.elencaStrumenti.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: true }))
    pese.elencaAgenti.and.returnValue(of({ righe: [], puoGestire: false }))
    pese.elencaAutomezzi.and.returnValue(of({ righe: [], puoOperare: true, puoRettificare: true }))
    const registri = jasmine.createSpyObj<RegistroService>('RegistroService', ['listRegistri'])
    registri.listRegistri.and.returnValue(of([]))
    await TestBed.configureTestingModule({
      imports: [PeseComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: PeseService, useValue: pese },
        { provide: RegistroService, useValue: registri },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error']) },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(PeseComponent)
    // `documentElement` in Karma ha la larghezza della finestra: si stringe il componente
    fixture.nativeElement.style.display = 'block'
    fixture.nativeElement.style.width = '390px'
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  })
  afterEach(() => fixture.destroy())

  it('il contenitore della pagina non scorre in orizzontale', () => {
    const pagina = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.page')!
    expect(pagina.clientWidth).toBeLessThanOrEqual(390)
    expect(pagina.scrollWidth).toBeLessThanOrEqual(pagina.clientWidth)
  })

  it('nessun elemento fuori dalla tabella scorrevole è più largo del viewport', () => {
    const host = fixture.nativeElement as HTMLElement
    const limite = host.getBoundingClientRect().left + 390 + 0.5
    const fuori = Array.from(host.querySelectorAll<HTMLElement>('*')).filter(
      e => !e.closest('.table-responsive') && e.getBoundingClientRect().right > limite
    )
    expect(fuori.map(e => e.tagName + '.' + e.className)).toEqual([])
  })

  it('il titolo della pagina non porta padding proprio', () => {
    const titolo = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.titolo')!
    const s = getComputedStyle(titolo)
    expect(s.paddingLeft).toBe('0px')
    expect(s.paddingRight).toBe('0px')
  })
})
