import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MessageService } from 'primeng/api'
import { SediDittaDialogComponent } from './sedi-ditta-dialog.component'
import { RegistryService } from './registry.service'
import { Ditta, SedeDitta } from '../../shared/models/registry.model'

function sede(id: string, over: Partial<SedeDitta> = {}): SedeDitta {
  return {
    id,
    denominazione: null,
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
    referente: null,
    email: null,
    telefono: null,
    pec: null,
    principale: false,
    attiva: true,
    ...over,
  }
}

function ditta(): Ditta {
  return {
    id: 'd1',
    ragioneSociale: 'ACME S.r.l.',
    partitaIva: '12345678903',
    codiceFiscale: null,
    partitaIvaDaVerificare: false,
    privato: false,
    sedi: [
      sede('s1', { principale: true }),
      sede('s2', { via: 'Via Milano', civico: '9', citta: 'Milano', provincia: 'MI' }),
      sede('s3', { via: 'Via Chiusa', attiva: false }),
    ],
    ruoli: {},
  }
}

describe('SediDittaDialogComponent', () => {
  let fixture: ComponentFixture<SediDittaDialogComponent>
  let component: SediDittaDialogComponent
  let registry: jasmine.SpyObj<RegistryService>
  const doc = document.body
  const q = <T extends HTMLElement>(sel: string) => doc.querySelector(sel) as T | null

  async function apri(puoGestire = true) {
    fixture.componentRef.setInput('dittaId', 'd1')
    fixture.componentRef.setInput('ragioneSociale', 'ACME S.r.l.')
    fixture.componentRef.setInput('puoGestire', puoGestire)
    fixture.componentRef.setInput('visible', true)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }
  async function scrivi(id: string, valore: string) {
    const input = q<HTMLInputElement>(`#${id}`)!
    input.value = valore
    input.dispatchEvent(new Event('input'))
    fixture.detectChanges()
  }

  beforeEach(async () => {
    registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getDitta',
      'creaSede',
      'aggiornaSede',
      'impostaSedePrincipale',
    ])
    registry.getDitta.and.callFake(() => of(ditta()))
    registry.creaSede.and.returnValue(of(sede('s4')))
    registry.aggiornaSede.and.returnValue(of(sede('s2')))
    registry.impostaSedePrincipale.and.callFake(() => {
      const d = ditta()
      d.sedi[0].principale = false
      d.sedi[1].principale = true
      return of(d)
    })
    await TestBed.configureTestingModule({
      imports: [SediDittaDialogComponent, NoopAnimationsModule],
      providers: [{ provide: RegistryService, useValue: registry }, MessageService],
    }).compileComponents()
    fixture = TestBed.createComponent(SediDittaDialogComponent)
    component = fixture.componentInstance
  })

  afterEach(() => {
    fixture.destroy()
    doc.querySelectorAll('.p-dialog-mask').forEach(e => e.remove())
  })

  it('si apre con le sedi della ditta (anche le disattivate, segnalate) e il titolo con la ragione sociale', async () => {
    await apri()
    expect(registry.getDitta).toHaveBeenCalledOnceWith('d1')
    expect(q('.p-dialog-title')!.textContent).toContain('Sedi di ACME S.r.l.')
    expect(doc.querySelectorAll('li.sede').length).toBe(3)
    expect(q('[data-testid="sede-s1"]')!.textContent).toContain('Principale')
    expect(q('[data-testid="sede-s3"]')!.textContent).toContain('Disattivata')
  })

  it('chi non può gestire le anagrafiche le legge soltanto', async () => {
    await apri(false)
    expect(doc.querySelectorAll('li.sede').length).toBe(3)
    expect(q('[data-testid="sede-aggiungi"]')).toBeNull()
    expect(q('[data-testid="sede-modifica-s2"]')).toBeNull()
  })

  it('"Rendi principale" chiama il servizio, aggiorna l\'elenco e avvisa la lista', async () => {
    await apri()
    const eventi: void[] = []
    component.modificata.subscribe(() => eventi.push(undefined))
    q<HTMLButtonElement>('[data-testid="sede-principale-s2"] button')!.click()
    fixture.detectChanges()
    expect(registry.impostaSedePrincipale).toHaveBeenCalledOnceWith('d1', 's2')
    expect(q('[data-testid="sede-s2"]')!.textContent).toContain('Principale')
    expect(q('[data-testid="sede-s1"]')!.textContent).not.toContain('Principale')
    expect(eventi.length).toBe(1)
  })

  it('la sede principale non si disattiva né si rende principale di nuovo', async () => {
    await apri()
    expect(q('[data-testid="sede-attiva-s1"]')).toBeNull()
    expect(q('[data-testid="sede-principale-s1"]')).toBeNull()
  })

  it('disattiva e riattiva una sede', async () => {
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-attiva-s2"] button')!.click()
    expect(registry.aggiornaSede).toHaveBeenCalledWith('d1', 's2', { attiva: false })
    q<HTMLButtonElement>('[data-testid="sede-attiva-s3"] button')!.click()
    expect(registry.aggiornaSede).toHaveBeenCalledWith('d1', 's3', { attiva: true })
  })

  it('aggiunta: campi obbligatori con errori collegati, poi creaSede con i dati', async () => {
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-aggiungi"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable() // NgModel scrive il valore iniziale in un microtask
    fixture.detectChanges()
    expect(q('[data-testid="sede-modulo"]')).toBeTruthy()

    q<HTMLButtonElement>('[data-testid="sede-salva"] button')!.click()
    fixture.detectChanges()
    expect(registry.creaSede).not.toHaveBeenCalled()
    expect(q('#sede-via')!.getAttribute('aria-invalid')).toBe('true')
    expect(q('#sede-via')!.getAttribute('aria-describedby')).toBe('sede-via-err')
    expect(q('#sede-via-err')!.getAttribute('role')).toBe('alert')
    expect(q('#sede-via-err')!.textContent).toContain('La via è obbligatoria.')

    await scrivi('sede-via', 'Via Nuova')
    await scrivi('sede-civico', '5')
    await scrivi('sede-cap', '40100')
    await scrivi('sede-citta', 'Bologna')
    await scrivi('sede-provincia', 'bo')
    await scrivi('sede-denominazione', 'Magazzino')
    q<HTMLButtonElement>('[data-testid="sede-salva"] button')!.click()
    fixture.detectChanges()
    expect(registry.creaSede).toHaveBeenCalledOnceWith('d1', {
      via: 'Via Nuova',
      civico: '5',
      cap: '40100',
      citta: 'Bologna',
      provincia: 'BO',
      denominazione: 'Magazzino',
    })
    // dopo il salvataggio il modulo si chiude e l'elenco si ricarica
    expect(q('[data-testid="sede-modulo"]')).toBeNull()
    expect(registry.getDitta).toHaveBeenCalledTimes(2)
  })

  it('modifica: il modulo parte dai dati della sede e salva con aggiornaSede', async () => {
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-modifica-s2"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q<HTMLInputElement>('#sede-via')!.value).toBe('Via Milano')
    await scrivi('sede-civico', '11')
    q<HTMLButtonElement>('[data-testid="sede-salva"] button')!.click()
    fixture.detectChanges()
    expect(registry.aggiornaSede).toHaveBeenCalledWith(
      'd1',
      's2',
      jasmine.objectContaining({ via: 'Via Milano', civico: '11' })
    )
  })

  it("modifica: svuotando l'email di una sede esistente il PUT invia email: null", async () => {
    registry.getDitta.and.callFake(() => {
      const d = ditta()
      d.sedi[1].email = 'sede@example.it'
      return of(d)
    })
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-modifica-s2"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(q<HTMLInputElement>('#sede-email')!.value).toBe('sede@example.it')
    await scrivi('sede-email', '')
    q<HTMLButtonElement>('[data-testid="sede-salva"] button')!.click()
    fixture.detectChanges()
    const dati = registry.aggiornaSede.calls.mostRecent().args[2] as Record<string, unknown>
    expect(dati['email']).toBeNull()
    expect(dati['telefono']).toBeNull()
  })

  it('un errore del backend compare in un messaggio role="alert" e il modulo resta aperto', async () => {
    registry.creaSede.and.returnValue(
      throwError(() => ({ error: { message: 'Esiste già una sede con questo indirizzo.' } }))
    )
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-aggiungi"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable() // NgModel scrive il valore iniziale in un microtask
    fixture.detectChanges()
    for (const [id, v] of [
      ['sede-via', 'Via Roma'],
      ['sede-civico', '1'],
      ['sede-cap', '00100'],
      ['sede-citta', 'Roma'],
      ['sede-provincia', 'RM'],
    ]) {
      await scrivi(id, v)
    }
    q<HTMLButtonElement>('[data-testid="sede-salva"] button')!.click()
    fixture.detectChanges()
    const err = q('[data-testid="sedi-errore"]')!
    expect(err.getAttribute('role')).toBe('alert')
    expect(err.textContent).toContain('Esiste già una sede con questo indirizzo.')
    expect(q('[data-testid="sede-modulo"]')).toBeTruthy()
  })

  it('apre il modulo con il focus sul primo campo; Annulla riporta il focus su "Aggiungi sede"', async () => {
    await apri()
    q<HTMLButtonElement>('[data-testid="sede-aggiungi"] button')!.click()
    fixture.detectChanges()
    await fixture.whenStable() // NgModel scrive il valore iniziale in un microtask
    fixture.detectChanges()
    await new Promise(r => setTimeout(r))
    expect(document.activeElement?.id).toBe('sede-denominazione')

    q<HTMLButtonElement>('[data-testid="sede-annulla"] button')!.click()
    fixture.detectChanges()
    await new Promise(r => setTimeout(r))
    fixture.detectChanges()
    expect(q('[data-testid="sede-modulo"]')).toBeNull()
    expect(document.activeElement).toBe(q('[data-testid="sede-aggiungi"] button'))
  })

  it('Esc chiude il dialog', async () => {
    await apri()
    const chiusure: boolean[] = []
    component.visibleChange.subscribe(v => chiusure.push(v))
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    fixture.detectChanges()
    expect(chiusure).toContain(false)
  })

  it("se il caricamento fallisce mostra l'errore", async () => {
    registry.getDitta.and.returnValue(
      throwError(() => ({ error: { message: 'Ditta non trovata' } }))
    )
    await apri()
    expect(q('[data-testid="sedi-errore"]')!.textContent).toContain('Ditta non trovata')
  })
})
