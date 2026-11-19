import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { AdminUser, UserAdminService } from '../admin/users/user-admin.service'
import { RegistryService } from '../registry/registry.service'
import { AutistiComponent } from './autisti.component'
import { Autista, AutistiService, ElencoAutisti } from './autisti.service'

const autista = (p: Partial<Autista> = {}): Autista => ({
  id: 'au1',
  nome: 'Luca',
  cognome: 'Bianchi',
  codiceFiscale: 'BNCLCU80A01H501Z',
  trasportatoreId: 't1',
  patenteNumero: 'RM1234567',
  patenteCategoria: 'CE',
  patenteScadenza: '2030-05-31',
  cqcScadenza: null,
  adrScadenza: null,
  telefono: '333 1234567',
  userId: 'u1',
  attivo: true,
  ...p,
})

const utente = {
  id: 'u1',
  firstName: 'Luca',
  lastName: 'Bianchi',
  email: 'l@x.it',
  role: 'AUTISTA',
}
const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)
const bottone = (id: string): HTMLButtonElement | null => {
  const e = q(id)
  return e instanceof HTMLButtonElement ? e : (e?.querySelector('button') ?? null)
}
function scrivi(id: string, valore: string): void {
  const el = document.getElementById(id) as HTMLInputElement
  el.value = valore
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('AutistiComponent (DOM)', () => {
  let servizio: jasmine.SpyObj<AutistiService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<AutistiComponent>
  let utenti: jasmine.SpyObj<UserAdminService>

  async function apri(elenco: ElencoAutisti | 'errore', admin = true): Promise<void> {
    servizio.elenca.and.returnValue(
      elenco === 'errore' ? throwError(() => ({ status: 500, error: {} })) : of(elenco)
    )
    utenti.list.and.returnValue(
      admin ? of([utente as unknown as AdminUser]) : throwError(() => ({ status: 403 }))
    )
    fixture = TestBed.createComponent(AutistiComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(async () => {
    servizio = jasmine.createSpyObj<AutistiService>('AutistiService', [
      'elenca',
      'crea',
      'aggiorna',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])
    utenti = jasmine.createSpyObj<UserAdminService>('UserAdminService', ['list'])
    const registry = jasmine.createSpyObj<RegistryService>('RegistryService', ['getTrasportatori'])
    registry.getTrasportatori.and.returnValue(
      of({
        items: [{ id: 't1', ragioneSociale: 'Trasporti Rossi' } as any],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      })
    )
    await TestBed.configureTestingModule({
      imports: [AutistiComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: AutistiService, useValue: servizio },
        { provide: UserAdminService, useValue: utenti },
        { provide: RegistryService, useValue: registry },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents()
  })

  afterEach(() => document.body.querySelectorAll('.p-dialog-mask').forEach(e => e.remove()))

  it('elenca gli autisti con patente, trasportatore e utente collegato', async () => {
    await apri({ righe: [autista()], puoOperare: true })
    const riga = q('au-riga-au1')!
    expect(riga.textContent).toContain('Bianchi Luca')
    expect(riga.textContent).toContain('Trasporti Rossi')
    expect(riga.textContent).toContain('BNCLCU80A01H501Z')
    expect(riga.textContent).toContain('scade il 31/05/2030')
    expect(q('au-patente-scaduta-au1')).toBeNull()
    expect(q('au-accesso-au1')!.textContent).toContain('Bianchi Luca (l@x.it)')
  })

  it('segnala la patente scaduta e l’autista senza accesso', async () => {
    await apri({
      righe: [autista({ patenteScadenza: '2020-01-01', userId: null, attivo: false })],
      puoOperare: true,
    })
    expect(q('au-patente-scaduta-au1')).not.toBeNull()
    expect(q('au-accesso-au1')!.textContent).toContain('Nessuno')
    expect(q('au-riga-au1')!.textContent).toContain('Disattivato')
  })

  it('lista vuota: messaggio dedicato', async () => {
    await apri({ righe: [], puoOperare: true })
    expect(q('au-vuota')).not.toBeNull()
  })

  it('senza permesso di scrittura niente “Nuovo” ne “Modifica”', async () => {
    await apri({ righe: [autista()], puoOperare: false })
    expect(q('au-nuovo')).toBeNull()
    expect(q('au-modifica-au1')).toBeNull()
  })

  it('un errore di lettura si mostra testuale', async () => {
    await apri('errore')
    expect(q('au-errore-elenco')!.textContent).toContain('Impossibile leggere gli autisti.')
  })

  it('crea: nome e cognome obbligatori, poi POST col corpo normalizzato e ricarica', async () => {
    await apri({ righe: [], puoOperare: true })
    servizio.crea.and.returnValue(of(autista()))
    bottone('au-nuovo')!.click()
    fixture.detectChanges()
    bottone('au-salva')!.click()
    fixture.detectChanges()
    expect(servizio.crea).not.toHaveBeenCalled()
    expect(q('au-errore')!.textContent).toContain('Nome e cognome sono obbligatori.')

    scrivi('au-nome', '  Luca ')
    scrivi('au-cognome', 'Bianchi')
    scrivi('au-cf', 'BNCLCU80A01H501Z')
    scrivi('au-telefono', '')
    fixture.detectChanges()
    bottone('au-salva')!.click()
    expect(servizio.crea).toHaveBeenCalledTimes(1)
    const corpo = servizio.crea.calls.mostRecent().args[0]
    expect(corpo).toEqual(
      jasmine.objectContaining({
        nome: 'Luca',
        cognome: 'Bianchi',
        codiceFiscale: 'BNCLCU80A01H501Z',
        telefono: null,
        userId: null,
        trasportatoreId: null,
      })
    )
    expect('attivo' in corpo).toBeFalse()
    expect(toast.success).toHaveBeenCalledWith('Autista creato.')
    expect(servizio.elenca).toHaveBeenCalledTimes(2)
  })

  it('modifica: precompila, manda anche `attivo` e disattiva', async () => {
    await apri({ righe: [autista()], puoOperare: true })
    servizio.aggiorna.and.returnValue(of(autista({ attivo: false })))
    bottone('au-modifica-au1')!.click()
    fixture.detectChanges()
    expect((document.getElementById('au-nome') as HTMLInputElement).value).toBe('Luca')
    expect((document.getElementById('au-utente') as HTMLSelectElement).value).toBe('u1')
    fixture.componentInstance.form.patchValue({ attivo: false })
    bottone('au-salva')!.click()
    const [id, corpo] = servizio.aggiorna.calls.mostRecent().args
    expect(id).toBe('au1')
    expect(corpo.attivo).toBeFalse()
    expect(corpo.userId).toBe('u1')
    expect(toast.success).toHaveBeenCalledWith('Autista aggiornato.')
  })

  it('un errore del backend (409) resta nel dialog col suo messaggio e non chiude', async () => {
    await apri({ righe: [], puoOperare: true })
    servizio.crea.and.returnValue(
      throwError(() => ({
        status: 409,
        error: {
          error: 'AUTISTA_DUPLICATO',
          message: 'Esiste già un autista con questo codice fiscale.',
        },
      }))
    )
    bottone('au-nuovo')!.click()
    fixture.detectChanges()
    scrivi('au-nome', 'Luca')
    scrivi('au-cognome', 'Bianchi')
    bottone('au-salva')!.click()
    fixture.detectChanges()
    expect(q('au-errore')!.textContent).toContain(
      'Esiste già un autista con questo codice fiscale.'
    )
    expect(q('au-form')).not.toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('un operatore non amministratore non vede la scelta dell’utente ma salva lo stesso', async () => {
    await apri({ righe: [], puoOperare: true }, false)
    bottone('au-nuovo')!.click()
    fixture.detectChanges()
    expect(document.getElementById('au-utente')).toBeNull()
  })
})
