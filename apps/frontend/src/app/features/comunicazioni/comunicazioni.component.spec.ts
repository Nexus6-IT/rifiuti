import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { ComunicazioniComponent } from './comunicazioni.component'
import { ComunicazioniService } from './comunicazioni.service'
import { AnteprimaOrso, ComunicazioneVista } from './comunicazioni.model'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

const sede = (id: string, denominazione: string, attiva = true) => ({
  id,
  denominazione,
  attiva,
  numIscrSito: 'X',
  principale: id === 'ul-1',
  createdAt: '',
  updatedAt: '',
})

const vista = (o: Partial<ComunicazioneVista> = {}): ComunicazioneVista => ({
  id: 'c1',
  consorzio: 'ORSO',
  unitaLocaleId: 'ul-1',
  periodoDa: '2026-01-01',
  periodoA: '2026-12-31',
  tracciato: 'ImpiantoMesi',
  versione: 1,
  stato: 'GENERATA',
  hashDati: 'h',
  nomeFile: 'f.xml',
  generataIl: '2026-11-10T10:00:00Z',
  generataDa: 'u1',
  modificataDopoInvio: false,
  ...o,
})

const anteprima = (o: Partial<AnteprimaOrso> = {}): AnteprimaOrso => ({
  unitaLocale: { id: 'ul-1', nome: 'Sede 1', provincia: 'MI' },
  anno: 2026,
  mesi: [
    {
      mese: 1,
      ricevuti: [
        {
          cer: '15 01 01',
          descrizione: 'Imballaggi',
          operazioni: ['R13'],
          totT: '10',
          extraT: '1',
          conFir: true,
        },
      ],
      prodotti: [],
    },
  ],
  avvisi: [],
  bloccanti: false,
  hashDati: 'h',
  ultima: null,
  ...o,
})

describe('ComunicazioniComponent', () => {
  let fixture: ComponentFixture<ComunicazioniComponent>
  let component: ComunicazioniComponent
  let svc: jasmine.SpyObj<ComunicazioniService>
  let toast: jasmine.SpyObj<ToastService>

  function setup(role = 'OPERATOR', sedi = [sede('ul-1', 'Sede 1'), sede('ul-2', 'Sede 2')]): void {
    svc = jasmine.createSpyObj<ComunicazioniService>('ComunicazioniService', [
      'anteprimaOrso',
      'generaOrso',
      'storicoOrso',
      'scaricaFile',
      'segnaInviata',
    ])
    svc.anteprimaOrso.and.returnValue(of(anteprima()))
    svc.storicoOrso.and.returnValue(of([]))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    const sediSvc = jasmine.createSpyObj<RentriUnitaLocaleService>('RentriUnitaLocaleService', [
      'list',
    ])
    sediSvc.list.and.returnValue(of(sedi))
    TestBed.configureTestingModule({
      imports: [ComunicazioniComponent, NoopAnimationsModule],
      providers: [
        { provide: ComunicazioniService, useValue: svc },
        { provide: RentriUnitaLocaleService, useValue: sediSvc },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u1', email: 'a@b.it', role }) },
        },
        { provide: ToastService, useValue: toast },
      ],
    })
    fixture = TestBed.createComponent(ComunicazioniComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  }
  const q = (id: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${id}"]`)

  it('con una sola sede la seleziona da sola e carica anteprima e storico', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    expect(svc.anteprimaOrso).toHaveBeenCalledWith('ul-1', component.anno())
    expect(svc.storicoOrso).toHaveBeenCalledWith('ul-1', component.anno())
  })

  it('con più sedi non carica nulla finché non si sceglie la sede', () => {
    setup()
    expect(svc.anteprimaOrso).not.toHaveBeenCalled()
    component.scegliSede('ul-2')
    expect(svc.anteprimaOrso).toHaveBeenCalledWith('ul-2', component.anno())
  })

  it('ignora le sedi non attive', () => {
    setup('OPERATOR', [sede('ul-1', 'A'), sede('ul-2', 'B', false)])
    expect(component.sedi().map(s => s.id)).toEqual(['ul-1'])
  })

  it('mostra la tabella mese × CER con le quantità in it-IT', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    const righe = fixture.nativeElement.querySelectorAll('[data-testid="comunicazioni-riga"]')
    expect(righe.length).toBe(1)
    expect(righe[0].textContent).toContain('Gennaio')
    expect(righe[0].textContent).toContain('15 01 01')
    expect(righe[0].textContent).toContain('10,000 t')
  })

  it('mostra gli avvisi e con bloccanti disabilita «Genera»', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.anteprimaOrso.and.returnValue(
      of(
        anteprima({
          bloccanti: true,
          avvisi: [
            { codice: 'PROVINCIA_MANCANTE', messaggio: 'Manca la provincia', movimentoIds: [] },
          ],
        })
      )
    )
    component.carica()
    fixture.detectChanges()
    expect(q('comunicazioni-avviso')?.textContent).toContain('Manca la provincia')
    expect(component.generaDisabilitato()).toBeTrue()
    expect(q('comunicazioni-genera')?.querySelector('button')?.disabled).toBeTrue()
  })

  it('«Genera» chiama il servizio, ricarica lo storico e avvisa', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.generaOrso.and.returnValue(of(vista()))
    component.genera()
    expect(svc.generaOrso).toHaveBeenCalledWith('ul-1', component.anno())
    expect(toast.success).toHaveBeenCalled()
    expect(svc.storicoOrso).toHaveBeenCalledTimes(2)
  })

  it('un errore COMUNICAZIONE_CON_BLOCCANTI mostra un messaggio chiaro', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.generaOrso.and.returnValue(
      throwError(() => ({ status: 400, error: { code: 'COMUNICAZIONE_CON_BLOCCANTI' } }))
    )
    component.genera()
    expect(toast.error).toHaveBeenCalledWith(jasmine.stringMatching(/bloccanti|avvisi/i))
  })

  it('un VIEWER non vede «Genera» né «Segna inviata»', () => {
    setup('VIEWER', [sede('ul-1', 'Sede 1')])
    svc.storicoOrso.and.returnValue(of([vista()]))
    component.carica()
    fixture.detectChanges()
    expect(q('comunicazioni-genera')).toBeNull()
    expect(q('comunicazioni-segna-inviata')).toBeNull()
  })

  it('«Segna inviata» chiama il servizio e ricarica', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.segnaInviata.and.returnValue(of(vista({ stato: 'INVIATA' })))
    component.segnaInviata(vista())
    expect(svc.segnaInviata).toHaveBeenCalledWith('c1')
    expect(toast.success).toHaveBeenCalled()
  })

  it("lo storico segnala «modificata dopo l'invio»", () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.storicoOrso.and.returnValue(of([vista({ stato: 'INVIATA', modificataDopoInvio: true })]))
    component.carica()
    fixture.detectChanges()
    expect(q('comunicazioni-modificata')?.textContent).toContain('dopo l')
  })

  it('«Scarica file» scarica il file della comunicazione', () => {
    setup('OPERATOR', [sede('ul-1', 'Sede 1')])
    svc.scaricaFile.and.returnValue(of({ blob: new Blob(['x']), nomeFile: 'a.xml' }))
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    component.scarica(vista())
    expect(svc.scaricaFile).toHaveBeenCalledWith('c1')
    expect(URL.createObjectURL).toHaveBeenCalled()
  })
})
