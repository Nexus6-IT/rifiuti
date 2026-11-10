import { ComponentFixture, TestBed } from '@angular/core/testing'
import { signal } from '@angular/core'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ConfirmationService } from 'primeng/api'
import { of } from 'rxjs'

import { TenantAdminComponent } from './tenant-admin.component'
import { Tenant, TenantAdminService } from './tenant-admin.service'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { UserAdminService } from '../users/user-admin.service'

function tenant(overrides: Partial<Tenant> = {}): Tenant {
  return {
    id: 't1',
    partitaIva: '12345678901',
    ragioneSociale: 'Ecologia Srl',
    address: 'Via Roma',
    city: 'Roma',
    province: 'RM',
    postalCode: '00100',
    subscriptionTier: 'TRIAL',
    subscriptionStatus: 'TRIAL',
    firLimitPerMonth: 100,
    userLimitTotal: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('TenantAdminComponent - Numero REA', () => {
  let fixture: ComponentFixture<TenantAdminComponent>
  let component: TenantAdminComponent
  let service: jasmine.SpyObj<TenantAdminService>

  beforeEach(async () => {
    service = jasmine.createSpyObj<TenantAdminService>('TenantAdminService', [
      'list',
      'create',
      'update',
      'setStatus',
    ])
    service.list.and.returnValue(of([]))
    service.create.and.returnValue(of(tenant()))
    service.update.and.returnValue(of(tenant()))
    const userService = jasmine.createSpyObj<UserAdminService>('UserAdminService', ['list'])
    userService.list.and.returnValue(of([]))

    await TestBed.configureTestingModule({
      imports: [TenantAdminComponent],
      providers: [
        provideNoopAnimations(),
        ConfirmationService,
        { provide: TenantAdminService, useValue: service },
        { provide: UserAdminService, useValue: userService },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u1', email: 'u@test.com', role: 'SUPER_ADMIN' }) },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', [
            'success',
            'error',
            'info',
            'warn',
          ]),
        },
      ],
    }).compileComponents()

    fixture = TestBed.createComponent(TenantAdminComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  async function apriDialog(t?: Tenant): Promise<HTMLInputElement> {
    if (t) {
      component.openEditDialog(t)
    } else {
      component.openCreateDialog()
    }
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="tenant-rea-number"]')
    expect(input).not.toBeNull()
    return input as HTMLInputElement
  }

  async function scrivi(input: HTMLInputElement, valore: string): Promise<void> {
    input.value = valore
    input.dispatchEvent(new Event('input'))
    fixture.detectChanges()
    await fixture.whenStable()
  }

  function compilaObbligatori(): void {
    Object.assign(component.form, {
      ragioneSociale: 'Ecologia Srl',
      partitaIva: '12345678901',
      address: 'Via Roma',
      city: 'Roma',
      province: 'RM',
      postalCode: '00100',
    })
  }

  it('mostra il campo con label, id e maxlength 9', async () => {
    const input = await apriDialog()

    expect(input.id).toBe('t-rea')
    expect(input.getAttribute('maxlength')).toBe('9')
    const label = document.body.querySelector<HTMLLabelElement>('label[for="t-rea"]')
    expect(label?.textContent).toContain('Numero REA')
  })

  it('invia il numero REA in creazione', async () => {
    const input = await apriDialog()
    compilaObbligatori()
    await scrivi(input, ' RM-123456 ')

    component.save()

    expect(service.create).toHaveBeenCalledTimes(1)
    expect(service.create.calls.mostRecent().args[0].reaNumber).toBe('RM-123456')
  })

  it('non invia il campo in creazione se vuoto', async () => {
    await apriDialog()
    compilaObbligatori()

    component.save()

    expect(service.create.calls.mostRecent().args[0].reaNumber).toBeUndefined()
  })

  it('precarica il numero REA in modifica', async () => {
    const input = await apriDialog(tenant({ reaNumber: '654321' }))

    expect(component.form.reaNumber).toBe('654321')
    expect(input.value).toBe('654321')
  })

  it('invia il numero REA modificato in modifica', async () => {
    const input = await apriDialog(tenant({ reaNumber: '654321' }))
    await scrivi(input, '777888')

    component.save()

    expect(service.update).toHaveBeenCalledTimes(1)
    expect(service.update.calls.mostRecent().args[1].reaNumber).toBe('777888')
  })

  it('svuotando REA e ATECO in modifica invia null (azzera il valore)', async () => {
    const input = await apriDialog(tenant({ reaNumber: '654321', atecoCode: '381100' }))
    await scrivi(input, '')
    component.form.atecoCode = '  '

    component.save()

    const dto = service.update.calls.mostRecent().args[1]
    expect(dto.reaNumber).toBeNull()
    expect(dto.atecoCode).toBeNull()
  })

  it('il suggerimento del REA dice solo cifre, senza sigla', async () => {
    const input = await apriDialog()

    expect(input.placeholder).toContain('solo cifre')
  })
})

describe('TenantAdminComponent - moduli (feature flags) azienda', () => {
  let fixture: ComponentFixture<TenantAdminComponent>
  let component: TenantAdminComponent
  let service: jasmine.SpyObj<TenantAdminService>

  beforeEach(async () => {
    service = jasmine.createSpyObj<TenantAdminService>('TenantAdminService', [
      'list',
      'create',
      'update',
      'setStatus',
    ])
    service.list.and.returnValue(of([]))
    service.update.and.returnValue(of(tenant()))
    const userService = jasmine.createSpyObj<UserAdminService>('UserAdminService', ['list'])
    userService.list.and.returnValue(of([]))

    await TestBed.configureTestingModule({
      imports: [TenantAdminComponent],
      providers: [
        provideNoopAnimations(),
        ConfirmationService,
        { provide: TenantAdminService, useValue: service },
        { provide: UserAdminService, useValue: userService },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u1', email: 'u@test.com', role: 'SUPER_ADMIN' }) },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj<ToastService>('ToastService', [
            'success',
            'error',
            'info',
            'warn',
          ]),
        },
      ],
    }).compileComponents()

    fixture = TestBed.createComponent(TenantAdminComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  async function apriModifica(t: Tenant): Promise<void> {
    component.openEditDialog(t)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  function casella(key: string): HTMLElement {
    const el = document.body.querySelector<HTMLElement>(
      `p-checkbox[ng-reflect-input-id="feat-${key}"] .p-checkbox-box`
    )
    expect(el).withContext(`casella ${key}`).not.toBeNull()
    return el as HTMLElement
  }

  async function clicca(key: string): Promise<void> {
    casella(key).click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  it('il click sul DOM aggiunge e toglie il modulo, e update lo invia', async () => {
    await apriModifica(tenant({ moduliEffettivi: ['fir'] }))
    const catalogo = component.featureCatalog.map(f => f.key)
    const daAggiungere = catalogo.find(k => !component.form.featureFlags.includes(k))!
    const daTogliere = component.form.featureFlags[0]

    await clicca(daAggiungere)
    expect(component.form.featureFlags).toContain(daAggiungere)

    await clicca(daTogliere)
    expect(component.form.featureFlags).not.toContain(daTogliere)

    component.save()
    const dto = service.update.calls.mostRecent().args[1]
    expect(dto.featureFlags).toContain(daAggiungere)
    expect(dto.featureFlags).not.toContain(daTogliere)
  })

  function casellaChecked(key: string): boolean {
    return casella(key).classList.contains('p-highlight')
  }

  it('deseleziona un modulo del piano: il payload non lo contiene', async () => {
    await apriModifica(tenant({ moduliEffettivi: ['fir', 'cer', 'anagrafiche', 'registro'] }))
    expect(casellaChecked('cer')).toBeTrue()

    await clicca('cer')
    component.save()

    const dto = service.update.calls.mostRecent().args[1]
    expect(dto.featureFlags).not.toContain('cer')
    expect(dto.featureFlags).toContain('fir')
  })

  it('riapre con moduliEffettivi senza quel modulo: casella vuota', async () => {
    await apriModifica(tenant({ moduliEffettivi: ['fir', 'anagrafiche', 'registro'] }))
    expect(casellaChecked('cer')).toBeFalse()
    expect(casellaChecked('fir')).toBeTrue()
  })

  it('nessun modulo resta nessun modulo alla riapertura', async () => {
    await apriModifica(tenant({ moduliEffettivi: [] }))
    expect(component.form.featureFlags).toEqual([])
    for (const f of component.featureCatalog) {
      expect(casellaChecked(f.key)).withContext(f.key).toBeFalse()
    }
  })

  it('cambio piano: caselle = moduli del piano + aggiunti - tolti', async () => {
    await apriModifica(
      tenant({
        subscriptionTier: 'TRIAL',
        moduliEffettivi: ['fir', 'cer', 'anagrafiche', 'esg'],
        featureFlags: ['esg'],
        featureTolte: ['registro'],
      })
    )
    component.onTierChange('PROFESSIONAL')
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()

    expect(component.form.featureFlags).toContain('mud')
    expect(component.form.featureFlags).toContain('esg')
    expect(component.form.featureFlags).not.toContain('registro')
  })

  it('azienda figlia: caselle disabilitate, nota visibile, save senza featureFlags', async () => {
    await apriModifica(tenant({ parentTenantId: 'madre-1', moduliEffettivi: ['fir'] }))

    const input = document.body.querySelector<HTMLInputElement>(
      'p-checkbox[ng-reflect-input-id="feat-fir"] input'
    )
    expect(input?.disabled).toBeTrue()
    expect(document.body.textContent).toContain(
      "I moduli arrivano dal contratto del gruppo: si cambiano sull'azienda madre"
    )

    component.save()
    const dto = service.update.calls.mostRecent().args[1]
    expect(dto.featureFlags).toBeUndefined()
  })

  it('il catalogo contiene registro', () => {
    expect(component.featureCatalog.map(f => f.key)).toContain('registro')
  })

  it('cambio piano dopo i clic: conserva le scelte fatte (nuovo piano + aggiunti - tolti)', async () => {
    await apriModifica(
      tenant({
        subscriptionTier: 'TRIAL',
        moduliEffettivi: ['fir', 'cer', 'anagrafiche', 'registro'],
      })
    )
    await clicca('cer') // tolto dal piano TRIAL
    await clicca('esg') // aggiunto oltre il piano TRIAL

    component.form.subscriptionTier = 'PROFESSIONAL'
    component.onTierChange('PROFESSIONAL')
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()

    expect(component.form.featureFlags).toContain('mud') // nuovo del piano
    expect(component.form.featureFlags).toContain('esg') // aggiunto, resta
    expect(component.form.featureFlags).not.toContain('cer') // tolto, resta tolto
  })
})
