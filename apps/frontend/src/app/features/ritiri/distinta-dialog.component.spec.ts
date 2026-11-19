import { HttpResponse } from '@angular/common/http'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { ModelliStampaService } from '../impostazioni/modelli-stampa/modelli-stampa.service'
import { Autista, AutistiService } from '../autisti/autisti.service'
import { DistintaDialogComponent } from './distinta-dialog.component'
import { RitiriService } from './ritiri.service'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}
const autista = (p: Partial<Autista>): Autista => ({
  id: 'au1',
  nome: 'Luca',
  cognome: 'Bianchi',
  codiceFiscale: null,
  trasportatoreId: null,
  patenteNumero: null,
  patenteCategoria: null,
  patenteScadenza: null,
  cqcScadenza: null,
  adrScadenza: null,
  telefono: null,
  userId: null,
  attivo: true,
  ...p,
})

describe('DistintaDialogComponent', () => {
  let fixture: ComponentFixture<DistintaDialogComponent>
  let servizio: jasmine.SpyObj<RitiriService>

  async function apri(autisti: Autista[] | 'errore'): Promise<void> {
    servizio = jasmine.createSpyObj<RitiriService>('RitiriService', ['distinta'])
    servizio.distinta.and.returnValue(of(new HttpResponse({ body: new Blob(['%PDF']) })))
    await TestBed.configureTestingModule({
      imports: [DistintaDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: RitiriService, useValue: servizio },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success']) },
        { provide: ModelliStampaService, useValue: { elenco: () => of([]) } },
        {
          provide: AutistiService,
          useValue: {
            elenca: () =>
              autisti === 'errore'
                ? throwError(() => new Error('403'))
                : of({ righe: autisti, puoOperare: true }),
          },
        },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(DistintaDialogComponent)
    fixture.componentInstance.data = '2026-12-01'
    fixture.componentInstance.mezzi = [{ id: 'm1', targa: 'AB123CD' }]
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('senza autisti il campo non si vede e la distinta parte senza autista', async () => {
    await apri([])
    expect(q('di-autista')).toBeNull()
    bottone('di-scarica')!.click()
    expect(servizio.distinta).toHaveBeenCalledWith('2026-12-01', undefined, undefined, undefined)
  })

  it('se l’elenco degli autisti non si legge (nessun permesso) il campo resta nascosto', async () => {
    await apri('errore')
    expect(q('di-autista')).toBeNull()
  })

  it('con autisti attivi offre “Tutti gli autisti” e manda l’autista scelto', async () => {
    await apri([autista({}), autista({ id: 'au2', nome: 'Anna', cognome: 'Verdi' })])
    const select = q<HTMLSelectElement>('di-autista')!
    expect(Array.from(select.options).map(o => o.textContent?.trim())).toEqual([
      'Tutti gli autisti',
      'Bianchi Luca',
      'Verdi Anna',
    ])
    fixture.componentInstance.autista = 'au2'
    bottone('di-scarica')!.click()
    expect(servizio.distinta).toHaveBeenCalledWith('2026-12-01', undefined, undefined, 'au2')
  })
})
