import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriUnitaLocaleComponent } from './rentri-unita-locale.component'
import { RentriUnitaLocaleService, RentriUnitaLocale } from './rentri-unita-locale.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function sede(overrides: Partial<RentriUnitaLocale> = {}): RentriUnitaLocale {
  return {
    id: 'ul-1',
    numIscrSito: 'OP1234ABC123456-RM1234',
    denominazione: 'Sede principale',
    principale: true,
    attiva: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('RentriUnitaLocaleComponent', () => {
  let fixture: ComponentFixture<RentriUnitaLocaleComponent>
  let component: RentriUnitaLocaleComponent
  let service: jasmine.SpyObj<RentriUnitaLocaleService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriUnitaLocaleService>('RentriUnitaLocaleService', [
      'list',
      'create',
      'update',
      'setPrincipale',
      'remove',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriUnitaLocaleComponent, RouterTestingModule, NoopAnimationsModule],
      providers: [
        { provide: RentriUnitaLocaleService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriUnitaLocaleComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo non admin, senza chiamare il backend', () => {
    setup('OPERATOR')
    fixture.detectChanges()

    expect(component.isAdmin()).toBe(false)
    expect(service.list).not.toHaveBeenCalled()
  })

  it('carica le sedi per un ADMIN', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))

    fixture.detectChanges()

    expect(service.list).toHaveBeenCalled()
    expect(component.sedi()).toEqual([sede()])
  })

  it('con una sola sede non propone alcuna scelta di "sede principale" (costo pagato solo da chi ne ha bisogno)', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-1"]')).toBeNull()
    // Anche nel form di aggiunta: con zero sedi esistenti non c'è nulla da
    // scegliere. Con UNA sede esistente, invece, la checkbox compare (la
    // scelta serve solo alla seconda sede in poi).
  })

  it('con due o più sedi mostra il selettore "rendi principale" per quella non principale', () => {
    setup('ADMIN')
    service.list.and.returnValue(
      of([sede(), sede({ id: 'ul-2', principale: false, denominazione: 'Sede secondaria' })])
    )

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(
      html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-2"]')
    ).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-unita-locale-set-principale-ul-1"]')).toBeNull()
  })

  it('crea la primissima sede senza inviare "principale" (il backend la forza comunque a true)', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([]))
    fixture.detectChanges()

    service.create.and.returnValue(of(sede()))
    component.denominazione = 'Sede principale'
    component.numIscrSito = 'OP1234ABC123456-RM1234'
    component.create()

    expect(service.create).toHaveBeenCalledWith({
      denominazione: 'Sede principale',
      numIscrSito: 'OP1234ABC123456-RM1234',
    })
    expect(toast.success).toHaveBeenCalled()
  })

  it('crea una seconda sede includendo la scelta esplicita di "principale"', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede()]))
    fixture.detectChanges()

    service.create.and.returnValue(
      of(sede({ id: 'ul-2', principale: true, denominazione: 'Sede secondaria' }))
    )
    component.denominazione = 'Sede secondaria'
    component.numIscrSito = 'OP5678DEF987654-TO5678'
    component.nuovaSedePrincipale = true
    component.create()

    expect(service.create).toHaveBeenCalledWith({
      denominazione: 'Sede secondaria',
      numIscrSito: 'OP5678DEF987654-TO5678',
      principale: true,
    })
  })

  it("imposta una sede come principale e ricarica l'elenco", () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede(), sede({ id: 'ul-2', principale: false })]))
    fixture.detectChanges()

    service.setPrincipale.and.returnValue(of(sede({ id: 'ul-2', principale: true })))
    component.setPrincipale(sede({ id: 'ul-2', principale: false }))

    expect(service.setPrincipale).toHaveBeenCalledWith('ul-2')
    expect(toast.success).toHaveBeenCalled()
  })

  it('mostra un errore quando il backend rifiuta la cancellazione della sede principale', () => {
    setup('ADMIN')
    service.list.and.returnValue(of([sede(), sede({ id: 'ul-2', principale: false })]))
    fixture.detectChanges()

    service.remove.and.returnValue(
      throwError(() => ({ error: { message: "Imposta prima un'altra sede come principale" } }))
    )
    component['remove'](sede())

    expect(toast.error).toHaveBeenCalledWith("Imposta prima un'altra sede come principale")
  })

  describe('dati per il MUD', () => {
    const q = (id: string): HTMLInputElement | null =>
      document.querySelector(`[data-testid="${id}"]`)
    const scrivi = (id: string, valore: string): void => {
      const el = q(id) as HTMLInputElement
      el.value = valore
      el.dispatchEvent(new Event('input', { bubbles: true }))
      fixture.detectChanges()
    }
    const click = (id: string): void => {
      const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement
      ;(el.querySelector('button') ?? el).click()
      fixture.detectChanges()
    }
    const piena = sede({
      indirizzo: 'Via Roma',
      civico: '12/A',
      cap: '20121',
      comune: 'Milano',
      provincia: 'MI',
      numeroAddetti: 7,
      progressivoMud: 1,
    })

    it('apre i dati MUD precompilati', async () => {
      setup('ADMIN')
      service.list.and.returnValue(of([piena]))
      fixture.detectChanges()

      click('rentri-unita-locale-dati-mud-ul-1')
      await fixture.whenStable()
      fixture.detectChanges()

      expect(q('rentri-unita-locale-mud-indirizzo')?.value).toBe('Via Roma')
      expect(q('rentri-unita-locale-mud-civico')?.value).toBe('12/A')
      expect(q('rentri-unita-locale-mud-cap')?.value).toBe('20121')
      expect(q('rentri-unita-locale-mud-comune')?.value).toBe('Milano')
      expect(q('rentri-unita-locale-mud-provincia')?.value).toBe('MI')
      expect(q('rentri-unita-locale-mud-addetti')?.value).toBe('7')
      expect(fixture.nativeElement.textContent).toContain('Codice MUD 1')
    })

    it('CAP non valido blocca il salvataggio', async () => {
      setup('ADMIN')
      service.list.and.returnValue(of([piena]))
      fixture.detectChanges()
      click('rentri-unita-locale-dati-mud-ul-1')
      await fixture.whenStable()
      fixture.detectChanges()

      scrivi('rentri-unita-locale-mud-cap', '123')

      expect(q('rentri-unita-locale-mud-cap-errore')).not.toBeNull()
      expect(q('rentri-unita-locale-mud-cap')?.getAttribute('aria-invalid')).toBe('true')
      click('rentri-unita-locale-mud-salva')
      expect(service.update).not.toHaveBeenCalled()
    })

    it('CAP vuoto si salva', async () => {
      setup('ADMIN')
      service.list.and.returnValue(of([piena]))
      service.update.and.returnValue(of({ ...piena, cap: null }))
      fixture.detectChanges()
      click('rentri-unita-locale-dati-mud-ul-1')
      await fixture.whenStable()
      fixture.detectChanges()

      scrivi('rentri-unita-locale-mud-cap', '')
      click('rentri-unita-locale-mud-salva')

      expect(service.update).toHaveBeenCalledWith(
        'ul-1',
        jasmine.objectContaining({ cap: '', provincia: 'MI', numeroAddetti: 7 })
      )
    })

    it('salva e aggiorna la riga', async () => {
      setup('ADMIN')
      service.list.and.returnValue(of([sede({ principale: false })]))
      service.update.and.returnValue(
        of(
          sede({
            principale: false,
            indirizzo: 'Via Dante',
            cap: '10100',
            comune: 'Torino',
            provincia: 'TO',
            progressivoMud: 2,
          })
        )
      )
      fixture.detectChanges()
      expect(q('rentri-unita-locale-mud-mancante-ul-1')).not.toBeNull()
      click('rentri-unita-locale-dati-mud-ul-1')
      await fixture.whenStable()
      fixture.detectChanges()

      scrivi('rentri-unita-locale-mud-indirizzo', ' Via Dante ')
      scrivi('rentri-unita-locale-mud-cap', '10100')
      scrivi('rentri-unita-locale-mud-comune', 'Torino')
      scrivi('rentri-unita-locale-mud-provincia', 'to')
      scrivi('rentri-unita-locale-mud-addetti', '3')
      click('rentri-unita-locale-mud-salva')

      expect(service.update).toHaveBeenCalledWith('ul-1', {
        indirizzo: 'Via Dante',
        civico: '',
        cap: '10100',
        comune: 'Torino',
        provincia: 'TO',
        numeroAddetti: 3,
      })
      expect(component.sedi()[0].indirizzo).toBe('Via Dante')
      expect(component.datiMudAperto()).toBe(false)
      await fixture.whenStable()
      fixture.detectChanges()
      expect(q('rentri-unita-locale-mud-indirizzo')).toBeNull()
      expect(q('rentri-unita-locale-mud-mancante-ul-1')).toBeNull()
      expect(q('rentri-unita-locale-codice-mud-ul-1')?.textContent).toContain('Codice MUD 2')
    })

    it("mostra l'avviso di indirizzo mancante solo per le sedi non principali", () => {
      setup('ADMIN')
      service.list.and.returnValue(
        of([
          sede(),
          sede({ id: 'ul-2', principale: false }),
          sede({
            id: 'ul-3',
            principale: false,
            indirizzo: 'Via X',
            cap: '00100',
            comune: 'Roma',
            provincia: 'RM',
          }),
        ])
      )
      fixture.detectChanges()

      expect(q('rentri-unita-locale-mud-mancante-ul-1')).toBeNull()
      expect(q('rentri-unita-locale-mud-mancante-ul-2')).not.toBeNull()
      expect(q('rentri-unita-locale-mud-mancante-ul-3')).toBeNull()
    })

    it('un utente non amministratore non vede il pulsante', () => {
      setup('OPERATOR')
      fixture.detectChanges()

      expect(q('rentri-unita-locale-dati-mud-ul-1')).toBeNull()
      expect(document.body.textContent).not.toContain('Dati per il MUD')
    })
  })
})
