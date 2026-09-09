import { ComponentFixture, TestBed } from '@angular/core/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'

import { SystemHealthComponent } from './system-health.component'
import { HealthItem, SystemHealth, SystemHealthService } from './system-health.service'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'

function voce(overrides: Partial<HealthItem> = {}): HealthItem {
  return {
    key: 'infra.postgres',
    label: 'Banca dati PostgreSQL',
    state: 'ok',
    since: null,
    detail: 'SELECT 1 eseguita (3 ms).',
    ...overrides,
  }
}

function stato(overrides: Partial<SystemHealth> = {}): SystemHealth {
  return {
    generatedAt: '2026-09-01T10:00:00.000Z',
    cached: false,
    cacheAgeSeconds: 0,
    infrastructure: [voce()],
    queues: [],
    scheduledJobs: [],
    freshness: [],
    credentials: [],
    flags: [],
    ...overrides,
  }
}

describe('SystemHealthComponent', () => {
  let fixture: ComponentFixture<SystemHealthComponent>
  let component: SystemHealthComponent
  let service: jasmine.SpyObj<SystemHealthService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<SystemHealthService>('SystemHealthService', [
      'stato',
      'avviaJob',
      'storico',
    ])
    service.stato.and.returnValue(of(stato()))
    service.storico.and.returnValue(of([]))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info'])

    TestBed.configureTestingModule({
      imports: [SystemHealthComponent],
      providers: [
        { provide: SystemHealthService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(SystemHealthComponent)
    component = fixture.componentInstance
  }

  it('nega la pagina a un ADMIN e non chiama il backend: i dati sono di piattaforma', () => {
    setup('ADMIN')
    fixture.detectChanges()

    expect(component.autorizzato()).toBe(false)
    expect(service.stato).not.toHaveBeenCalled()
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="system-health-non-autorizzato"]')).not.toBeNull()
  })

  it('carica e mostra lo stato per il SUPER_ADMIN', () => {
    setup('SUPER_ADMIN')
    fixture.detectChanges()

    expect(service.stato).toHaveBeenCalledTimes(1)
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="system-health-voce-infra.postgres"]')).not.toBeNull()
    expect(html.textContent).toContain('SELECT 1 eseguita')
  })

  it('dichiara quando i dati vengono dalla cache e di che eta', () => {
    setup('SUPER_ADMIN')
    service.stato.and.returnValue(of(stato({ cached: true, cacheAgeSeconds: 42 })))
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="system-health-generato"]')?.textContent).toContain(
      'dalla cache (42 s fa)'
    )
  })

  it('non mostra alcun pulsante sulle voci non azionabili', () => {
    setup('SUPER_ADMIN')
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="system-health-esegui-infra.postgres"]')).toBeNull()
  })

  it('mostra «Esegui ora» solo dove il backend ha dichiarato la voce azionabile', () => {
    setup('SUPER_ADMIN')
    service.stato.and.returnValue(
      of(
        stato({
          scheduledJobs: [
            voce({
              key: 'job.codifiche-rentri',
              label: 'Allineamento codifiche RENTRI',
              actionable: true,
              actionKey: 'codifiche-rentri',
            }),
          ],
        })
      )
    )
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(
      html.querySelector('[data-testid="system-health-esegui-job.codifiche-rentri"]')
    ).not.toBeNull()
  })

  it('avvia il job con la chiave azione e annuncia AVVIATO, non completato', () => {
    setup('SUPER_ADMIN')
    fixture.detectChanges()
    service.avviaJob.and.returnValue(
      of({
        jobKey: 'codifiche-rentri',
        stato: 'avviato' as const,
        messaggio: 'Allineamento codifiche RENTRI: avviato.',
        avviatoAl: '2026-09-01T10:05:00.000Z',
      })
    )

    component.esegui(
      voce({ key: 'job.codifiche-rentri', actionable: true, actionKey: 'codifiche-rentri' })
    )

    expect(service.avviaJob).toHaveBeenCalledWith('codifiche-rentri')
    expect(toast.info).toHaveBeenCalledWith(
      'Allineamento codifiche RENTRI: avviato.',
      'Job avviato'
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('spiega il rifiuto quando il job risulta gia in corso', () => {
    setup('SUPER_ADMIN')
    fixture.detectChanges()
    service.avviaJob.and.returnValue(
      throwError(() => ({ status: 409, error: { message: 'gia in corso' } }))
    )

    component.esegui(voce({ key: 'job.x', actionable: true, actionKey: 'x' }))

    expect(toast.error).toHaveBeenCalledWith('gia in corso', 'Job gia in corso')
    expect(component.inAvvio()).toEqual([])
  })

  it('mostra un errore leggibile se lo stato non e recuperabile', () => {
    setup('SUPER_ADMIN')
    service.stato.and.returnValue(throwError(() => ({ error: { message: 'backend giu' } })))
    fixture.detectChanges()

    expect(component.errore()).toBe('backend giu')
    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="system-health-errore"]')).not.toBeNull()
  })

  it('resta utile anche se lo storico dei rilanci non arriva', () => {
    setup('SUPER_ADMIN')
    service.storico.and.returnValue(throwError(() => new Error('boom')))
    fixture.detectChanges()

    expect(component.stato()).not.toBeNull()
    expect(component.storico()).toEqual([])
  })
})
