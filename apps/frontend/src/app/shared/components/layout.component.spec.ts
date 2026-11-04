import { HttpClientTestingModule } from '@angular/common/http/testing'
import { MessageService } from 'primeng/api'
import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { signal } from '@angular/core'
import { Observable, of, throwError } from 'rxjs'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { LegamiService } from '../../features/legami/legami.service'
import { LayoutComponent, ordinaAziendePerGruppo } from './layout.component'

describe('ordinaAziendePerGruppo', () => {
  it('mette ogni figlia sotto la propria madre e la marca come annidata', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'beta', name: 'Beta Srl', parentTenantId: 'madre' },
      { id: 'madre', name: 'Gruppo Madre Srl', parentTenantId: null },
      { id: 'alfa', name: 'Alfa Srl', parentTenantId: 'madre' },
    ])

    expect(risultato.map(a => a.id)).toEqual(['madre', 'alfa', 'beta'])
    expect(risultato.map(a => a.annidata)).toEqual([false, true, true])
  })

  it('lascia in elenco piatto le aziende senza gruppo', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'due', name: 'Due Srl', parentTenantId: null },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id)).toEqual(['due', 'uno'])
    expect(risultato.every(a => !a.annidata)).toBe(true)
  })

  it("non perde le figlie la cui madre non e' accessibile all'utente", () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'orfana', name: 'Orfana Srl', parentTenantId: 'madre-non-visibile' },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id).sort()).toEqual(['orfana', 'uno'])
    expect(risultato.find(a => a.id === 'orfana')?.annidata).toBe(false)
  })
})

describe('LayoutComponent: voce di menu Pese', () => {
  it('la voce Pese punta a /pese ed è gated dalla feature pese', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/pese')
    expect(voce).toEqual(jasmine.objectContaining({ label: 'Pese', feature: 'pese' }))
  })
})

describe('LayoutComponent: voce di menu Clienti', () => {
  it('la voce Clienti sostituisce quella temporanea delle tabelle di fatturazione', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/clienti')
    expect(voce).toEqual(
      jasmine.objectContaining({ label: 'Clienti', icon: 'pi pi-users', feature: 'contratti' })
    )
    expect(layout.navMain.find(v => v.label === 'Tabelle di fatturazione')).toBeUndefined()
  })

  it('"Contratti clienti" segue "Clienti" e porta a /contratti-clienti (D20)', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const nav = TestBed.createComponent(LayoutComponent).componentInstance.navMain
    const i = nav.findIndex(v => v.route === '/clienti')
    expect(nav[i + 1]).toEqual(
      jasmine.objectContaining({
        label: 'Contratti clienti',
        route: '/contratti-clienti',
        icon: 'pi pi-file-edit',
        feature: 'contratti',
      })
    )
  })
})

describe('LayoutComponent: voce di menu «Da collegare»', () => {
  async function crea(contatori: unknown): Promise<HTMLElement> {
    // Come il servizio vero: `aggiornaContatori` rilegge e scrive il signal (0 se fallisce).
    const daCollegare = signal(0)
    const servizio = {
      daCollegare,
      aggiornaContatori: () =>
        (contatori as Observable<{ daCollegare: number }>).subscribe({
          next: c => daCollegare.set(c.daCollegare),
          error: () => daCollegare.set(0),
        }),
    }
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: LegamiService, useValue: servizio },
      ],
    })
    const ff = TestBed.inject(FeatureFlagsService)
    spyOn(ff, 'load').and.returnValue(
      of({ features: ['contratti'], tier: null, userLimitTotal: null })
    )
    spyOn(ff, 'has').and.returnValue(true)
    const fixture = TestBed.createComponent(LayoutComponent)
    // Niente `whenStable`: il layout ha timer propri che non finiscono mai. Gli observable sono sincroni.
    fixture.detectChanges()
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('la voce porta a /legami/da-collegare ed è gated dalla feature contratti', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const voce = TestBed.createComponent(LayoutComponent).componentInstance.navMain.find(
      v => v.route === '/legami/da-collegare'
    )
    expect(voce).toEqual(
      jasmine.objectContaining({
        label: 'Da collegare',
        feature: 'contratti',
        contatoreLegami: true,
      })
    )
  })

  it('contatore del menu: mostra il totale della lista', async () => {
    const el = await crea(of({ daCollegare: 7, proposti: 2, mancanti: 3, daRiallineare: 2 }))
    expect(el.querySelector('[data-testid="contatore-legami"]')?.textContent?.trim()).toBe('7')
  })

  it('contatore a zero o errore: nessun numero accanto alla voce', async () => {
    const el = await crea(throwError(() => new Error('rete')))
    expect(el.querySelector('[data-testid="contatore-legami"]')).toBeNull()
  })
})
