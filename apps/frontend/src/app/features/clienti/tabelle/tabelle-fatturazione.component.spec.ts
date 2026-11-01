import { TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Router, provideRouter } from '@angular/router'
import { RouterTestingHarness } from '@angular/router/testing'
import { of } from 'rxjs'
import { TabelleFatturazioneComponent } from './tabelle-fatturazione.component'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { tabellaFinta } from './tabelle-test-utils'

describe('TabelleFatturazioneComponent', () => {
  beforeEach(() => {
    const t = () => {
      const x = tabellaFinta()
      x.list.and.returnValue(of([]))
      return x
    }
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([{ path: 'clienti/tabelle', component: TabelleFatturazioneComponent }]),
        {
          provide: TabelleFatturazioneService,
          useValue: {
            condizioni: t(),
            conti: t(),
            spese: t(),
            registri: t(),
            testi: t(),
            codifiche: t(),
          },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success']),
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })

  it("sette schede nell'ordine di D20", async () => {
    const h = await RouterTestingHarness.create('/clienti/tabelle')
    const intestazioni = Array.from(h.routeNativeElement!.querySelectorAll('.p-tabview-nav li'))
      .map(li => li.textContent!.trim())
      .filter(t => t !== '')
    expect(intestazioni).toEqual([
      'Condizioni di pagamento',
      'Conti correnti',
      'Spese e bollo',
      'Registri IVA',
      'Testi di fatturazione',
      'Categorie e tipi',
      'Motivi di annullo',
    ])
  })

  it("la scheda scelta resta nell'URL (?scheda=)", async () => {
    const h = await RouterTestingHarness.create('/clienti/tabelle?scheda=conti')
    const attiva = h.routeNativeElement!.querySelector('.p-tabview-nav li.p-highlight')!
    expect(attiva.textContent).toContain('Conti correnti')
    const spese = h.routeNativeElement!.querySelectorAll<HTMLElement>('.p-tabview-nav a')[2]
    spese.click()
    h.detectChanges()
    await h.fixture.whenStable()
    expect(TestBed.inject(Router).url).toContain('scheda=spese')
  })

  it("'Categorie e tipi' mostra i due generi uno sopra l'altro", async () => {
    const h = await RouterTestingHarness.create('/clienti/tabelle?scheda=categorie')
    const titoli = Array.from(
      h.routeNativeElement!.querySelectorAll('[data-testid^="codifiche-titolo-"]')
    ).map(e => e.getAttribute('data-testid'))
    expect(titoli).toEqual(['codifiche-titolo-CATEGORIA', 'codifiche-titolo-TIPO'])
  })
})
