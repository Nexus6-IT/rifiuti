import { signal } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { apriMenuRiga, chiudiMenuRiga, scegliVoceRiga } from '../clienti/tabelle/azioni-test-utils'
import { Tenant, TenantAdminService } from './tenants/tenant-admin.service'
import { TenantAdminComponent } from './tenants/tenant-admin.component'
import { UserAdminComponent } from './users/user-admin.component'
import { AdminUser, ImpersonateResult, UserAdminService } from './users/user-admin.service'

/**
 * Task 15: Utenti e Le mie aziende / Tenant seguono il pattern delle liste. Il restyle non cambia
 * chi puo' fare cosa: ogni azione compare solo per i ruoli che il controller backend ammette
 * (`user-admin.controller.ts`, `tenant.controller.ts`).
 */
const utente = (over: Partial<AdminUser> = {}): AdminUser => ({
  id: 'u1',
  tenantId: 't1',
  keycloakId: 'k1',
  fiscalCode: 'RSSMRA80A01H501U',
  firstName: 'Mario',
  lastName: 'Rossi',
  email: 'mario.rossi@esempio.it',
  role: 'OPERATOR',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
})

const tenant = (over: Partial<Tenant> = {}): Tenant =>
  ({
    id: 't1',
    partitaIva: '12345678903',
    ragioneSociale: 'Ecologia Srl',
    address: 'Via Roma',
    city: 'Roma',
    province: 'RM',
    postalCode: '00100',
    subscriptionTier: 'PROFESSIONAL',
    subscriptionStatus: 'ACTIVE',
    firLimitPerMonth: 100,
    userLimitTotal: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Tenant

const toast = jasmine.createSpyObj<ToastService>('ToastService', [
  'success',
  'error',
  'info',
  'warn',
])

async function assesta(fixture: ComponentFixture<unknown>): Promise<void> {
  fixture.detectChanges()
  await fixture.whenStable()
  fixture.detectChanges()
}

describe('UserAdminComponent (stile)', () => {
  let fixture: ComponentFixture<UserAdminComponent>
  let servizio: jasmine.SpyObj<UserAdminService>

  const monta = async (ruolo: 'SUPER_ADMIN' | 'ADMIN', utenti: AdminUser[]) => {
    servizio = jasmine.createSpyObj<UserAdminService>('UserAdminService', [
      'list',
      'listTenants',
      'create',
      'updateRole',
      'setStatus',
      'setCompanyLimit',
      'impersonate',
    ])
    servizio.list.and.returnValue(of(utenti))
    servizio.listTenants.and.returnValue(of([]))
    servizio.setStatus.and.returnValue(of({} as AdminUser))
    servizio.impersonate.and.returnValue(
      of({ accessToken: 'a', refreshToken: 'r' } as ImpersonateResult)
    )
    TestBed.configureTestingModule({
      imports: [UserAdminComponent],
      providers: [
        provideNoopAnimations(),
        { provide: UserAdminService, useValue: servizio },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'me', email: 'x@y.it', role: ruolo }) },
        },
      ],
    })
    fixture = TestBed.createComponent(UserAdminComponent)
    await assesta(fixture)
    return fixture.nativeElement as HTMLElement
  }
  const riga = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="utente-riga-${id}"]`)!

  afterEach(() => {
    chiudiMenuRiga()
    document.body.querySelectorAll('.p-dialog-mask, .p-confirm-dialog').forEach(n => n.remove())
  })

  it('un solo h1 e un solo bottone primario («Nuovo utente»)', async () => {
    const el = await monta('ADMIN', [utente()])
    expect(el.querySelectorAll('h1').length).toBe(1)
    const primari = el.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].closest('[data-testid]')?.getAttribute('data-testid')).toBe('utenti-nuovo')
  })

  it('SUPER_ADMIN su un ADMIN: principale «Cambia ruolo», nel menu Impersona, quota e Disabilita', async () => {
    const el = await monta('SUPER_ADMIN', [utente({ id: 'a1', role: 'ADMIN', companyLimit: 3 })])
    const r = riga(el, 'a1')
    expect(r.querySelector('[data-testid="azione-principale"]')?.getAttribute('aria-label')).toBe(
      'Cambia ruolo Mario Rossi'
    )
    expect(await apriMenuRiga(fixture, r)).toEqual([
      'Impersona',
      'Imposta quota aziende',
      'Disabilita',
    ])
  })

  it('SUPER_ADMIN non impersona un altro SUPER_ADMIN e la quota e solo per gli ADMIN', async () => {
    const el = await monta('SUPER_ADMIN', [
      utente({ id: 's1', role: 'SUPER_ADMIN' }),
      utente({ id: 'o1', role: 'OPERATOR' }),
    ])
    expect(await apriMenuRiga(fixture, riga(el, 's1'))).toEqual(['Disabilita'])
    chiudiMenuRiga()
    expect(await apriMenuRiga(fixture, riga(el, 'o1'))).toEqual(['Impersona', 'Disabilita'])
  })

  it('ADMIN non vede Impersona ne la quota (solo il SUPER_ADMIN, come il backend)', async () => {
    const el = await monta('ADMIN', [utente({ id: 'a1', role: 'ADMIN' }), utente({ id: 'o1' })])
    expect(await apriMenuRiga(fixture, riga(el, 'a1'))).toEqual(['Disabilita'])
    expect(el.textContent).not.toContain('Quota aziende')
    expect(el.textContent).not.toContain('Impersona')
  })

  it('un utente disabilitato offre «Abilita»', async () => {
    const el = await monta('ADMIN', [utente({ id: 'd1', enabled: false })])
    expect(await apriMenuRiga(fixture, riga(el, 'd1'))).toEqual(['Abilita'])
  })

  it('Disabilita chiede conferma: bottone rosso e focus iniziale su «Annulla»', async () => {
    const el = await monta('ADMIN', [utente()])
    await scegliVoceRiga(fixture, riga(el, 'u1'), 'Disabilita')
    await new Promise(r => setTimeout(r, 100))
    fixture.detectChanges()
    const accetta = document.body.querySelector('.p-confirm-dialog-accept') as HTMLElement
    const annulla = document.body.querySelector('.p-confirm-dialog-reject') as HTMLElement
    expect(accetta.textContent?.trim()).toBe('Disabilita')
    expect(accetta.classList).toContain('p-button-danger')
    expect(document.activeElement).toBe(annulla)
    expect(servizio.setStatus).not.toHaveBeenCalled()
  })

  it('Impersona chiede conferma prima di partire, con il focus su «Annulla»', async () => {
    const el = await monta('SUPER_ADMIN', [utente()])
    await scegliVoceRiga(fixture, riga(el, 'u1'), 'Impersona')
    await new Promise(r => setTimeout(r, 100))
    expect(servizio.impersonate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(document.body.querySelector('.p-confirm-dialog-reject'))
  })

  it('pattern lista: lista-telefono, azioni sempre visibili sul telefono, nessun paginatore a zero righe', async () => {
    const el = await monta('ADMIN', [utente()])
    expect(el.querySelector('.p-datatable.lista-telefono')).not.toBeNull()
    expect(el.querySelector('td.azioni-col')?.classList).not.toContain('m-hide')
    const vuoto = await (async () => {
      TestBed.resetTestingModule()
      return monta('ADMIN', [])
    })()
    expect(vuoto.querySelector('.p-datatable.senza-righe')).not.toBeNull()
    expect(vuoto.textContent).toContain('Nessun utente')
  })

  it('il filtro per tenant esiste solo per il SUPER_ADMIN', async () => {
    const su = await monta('SUPER_ADMIN', [utente()])
    expect(su.querySelector('#tenant-filter, [inputid="tenant-filter"]')).not.toBeNull()
    TestBed.resetTestingModule()
    const ad = await monta('ADMIN', [utente()])
    expect(ad.querySelector('[inputid="tenant-filter"]')).toBeNull()
  })
})

describe('TenantAdminComponent (stile)', () => {
  let fixture: ComponentFixture<TenantAdminComponent>

  const monta = async (ruolo: 'SUPER_ADMIN' | 'ADMIN', righe: Tenant[]) => {
    const servizio = jasmine.createSpyObj<TenantAdminService>('TenantAdminService', [
      'list',
      'create',
      'update',
      'setStatus',
    ])
    servizio.list.and.returnValue(of(righe))
    const utenti = jasmine.createSpyObj<UserAdminService>('UserAdminService', ['list'])
    utenti.list.and.returnValue(of([]))
    TestBed.configureTestingModule({
      imports: [TenantAdminComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TenantAdminService, useValue: servizio },
        { provide: UserAdminService, useValue: utenti },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'me', email: 'x@y.it', role: ruolo }) },
        },
      ],
    })
    fixture = TestBed.createComponent(TenantAdminComponent)
    await assesta(fixture)
    return fixture.nativeElement as HTMLElement
  }
  const riga = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="tenant-riga-${id}"]`)!

  afterEach(() => {
    chiudiMenuRiga()
    document.body.querySelectorAll('.p-confirm-dialog').forEach(n => n.remove())
  })

  it('un solo h1 (per ruolo) e un solo bottone primario', async () => {
    const su = await monta('SUPER_ADMIN', [tenant()])
    expect(su.querySelectorAll('h1').length).toBe(1)
    expect(su.querySelector('h1')?.textContent?.trim()).toBe('Gestione Tenant')
    expect(su.querySelectorAll('.wf-primario').length).toBe(1)
    TestBed.resetTestingModule()
    const ad = await monta('ADMIN', [tenant()])
    expect(ad.querySelector('h1')?.textContent?.trim()).toBe('Le mie aziende')
    expect(ad.querySelectorAll('.wf-primario').length).toBe(1)
  })

  it('con zero righe il bottone nello stato vuoto non e un secondo primario', async () => {
    const el = await monta('SUPER_ADMIN', [])
    expect(el.querySelectorAll('.wf-primario').length).toBe(1)
    expect(el.querySelector('.p-datatable.senza-righe')).not.toBeNull()
  })

  it('SUPER_ADMIN: principale «Modifica», nel menu «Sospendi» (o «Riattiva» se sospeso)', async () => {
    const el = await monta('SUPER_ADMIN', [
      tenant(),
      tenant({ id: 't2', subscriptionStatus: 'SUSPENDED', ragioneSociale: 'Sospesa Srl' }),
    ])
    expect(
      riga(el, 't1').querySelector('[data-testid="azione-principale"]')?.getAttribute('aria-label')
    ).toBe('Modifica Ecologia Srl')
    expect(await apriMenuRiga(fixture, riga(el, 't1'))).toEqual(['Sospendi'])
    chiudiMenuRiga()
    expect(await apriMenuRiga(fixture, riga(el, 't2'))).toEqual(['Riattiva'])
  })

  it('ADMIN: solo «Modifica», nessun menu (Sospendi e riservato al SUPER_ADMIN)', async () => {
    const el = await monta('ADMIN', [tenant()])
    const r = riga(el, 't1')
    expect(r.querySelector('[data-testid="azione-principale"]')).not.toBeNull()
    expect(r.querySelector('[data-testid="azioni-altre"]')).toBeNull()
    expect(el.textContent).not.toMatch(/Sospendi|Riattiva/)
  })

  it('Sospendi chiede conferma: bottone rosso e focus su «Annulla»', async () => {
    const el = await monta('SUPER_ADMIN', [tenant()])
    await scegliVoceRiga(fixture, riga(el, 't1'), 'Sospendi')
    await new Promise(r => setTimeout(r, 100))
    const accetta = document.body.querySelector('.p-confirm-dialog-accept') as HTMLElement
    expect(accetta.classList).toContain('p-button-danger')
    expect(document.activeElement).toBe(document.body.querySelector('.p-confirm-dialog-reject'))
  })

  it('pattern lista: lista-telefono e azioni mai nascoste sul telefono', async () => {
    const el = await monta('ADMIN', [tenant()])
    expect(el.querySelector('.p-datatable.lista-telefono')).not.toBeNull()
    expect(el.querySelector('td.azioni-col')?.classList).not.toContain('m-hide')
    expect(el.querySelectorAll('.cell-label').length).toBe(0)
  })
})
