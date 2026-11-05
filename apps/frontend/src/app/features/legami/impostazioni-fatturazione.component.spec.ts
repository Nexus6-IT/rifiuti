import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { accettaConferma, bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ImpostazioniFatturazioneComponent } from './impostazioni-fatturazione.component'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { ImpostazioneFatturazione } from './legami.model'

const spenta: ImpostazioneFatturazione = { fatturazioneDa: null, versione: 0, modificatoIl: null }

describe('ImpostazioniFatturazioneComponent', () => {
  let fixture: ComponentFixture<ImpostazioniFatturazioneComponent>
  let servizio: jasmine.SpyObj<ImpostazioneFatturazioneService>

  async function crea(ruolo: string, iniziale = spenta): Promise<void> {
    servizio = jasmine.createSpyObj('ImpostazioneFatturazioneService', ['leggi', 'salva'])
    servizio.leggi.and.returnValue(of(iniziale))
    await TestBed.configureTestingModule({
      imports: [ImpostazioniFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioneFatturazioneService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(ImpostazioniFatturazioneComponent)
    await stabilizza(fixture)
  }

  async function scriviData(valore: string): Promise<void> {
    const el = q<HTMLInputElement>('fatt-data')!
    el.value = valore
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await stabilizza(fixture)
  }

  afterEach(() => fixture?.destroy())

  it('ha tre schede: «Fatturazione da», «Dati del cedente», «Numerazione»', async () => {
    await crea('ADMIN')
    const intestazioni = Array.from(
      fixture.nativeElement.querySelectorAll('.p-tabview-nav .p-tabview-title')
    ).map(e => (e as HTMLElement).textContent?.trim())
    expect(intestazioni).toEqual(['Fatturazione da', 'Dati del cedente', 'Numerazione'])
    // Le schede nuove si montano solo quando le apri.
    expect(fixture.nativeElement.querySelector('app-cedente-scheda')).toBeNull()
    expect(fixture.nativeElement.querySelector('app-numerazione-scheda')).toBeNull()
  })

  it('mostra "Fatturazione spenta" quando la data è vuota', async () => {
    await crea('ADMIN')
    expect(q('fatt-spenta')?.textContent).toContain('Fatturazione spenta')
    expect(fixture.nativeElement.querySelector('.pagina-lavoro')).not.toBeNull()
  })

  it('salva con una data: chiama PUT con AAAA-MM-GG', async () => {
    await crea('ADMIN')
    servizio.salva.and.returnValue(
      of({ fatturazioneDa: '2026-01-01', versione: 1, modificatoIl: '2026-11-03' })
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledOnceWith({ fatturazioneDa: '2026-01-01', versione: 0 })
    expect(q('fatt-spenta')).toBeNull()
  })

  it('409 CONFERMA_RICHIESTA: apre la conferma «Verranno toccati 3 movimenti», e solo dopo il consenso rimanda con confermaMovimenti 3', async () => {
    await crea('ADMIN', { fatturazioneDa: '2026-06-01', versione: 2, modificatoIl: null })
    servizio.salva.and.returnValues(
      throwError(() => ({
        status: 409,
        error: {
          error: 'CONFERMA_RICHIESTA',
          message: 'Conferma richiesta',
          details: { movimentiToccati: 3 },
        },
      })),
      of({ fatturazioneDa: '2026-01-01', versione: 3, modificatoIl: null })
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(document.body.textContent).toContain('Verranno toccati 3 movimenti')
    expect(servizio.salva).toHaveBeenCalledTimes(1)

    accettaConferma()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledTimes(2)
    expect(servizio.salva.calls.mostRecent().args[0]).toEqual({
      fatturazioneDa: '2026-01-01',
      versione: 2,
      confermaMovimenti: 3,
    })
  })

  for (const ruolo of ['VIEWER', 'OPERATOR']) {
    it(`${ruolo}: campo e pulsante disabilitati`, async () => {
      await crea(ruolo)
      expect(q<HTMLInputElement>('fatt-data')!.disabled).toBeTrue()
      expect(bottone('fatt-salva')!.disabled).toBeTrue()
    })
  }

  it('409 VERSIONE_SUPERATA: messaggio e ricarica', async () => {
    await crea('ADMIN')
    servizio.salva.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA' } }))
    )
    servizio.leggi.and.returnValue(
      of({ fatturazioneDa: '2026-03-01', versione: 5, modificatoIl: null })
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggi).toHaveBeenCalledTimes(2)
    expect(q('fatt-errore')?.textContent).toContain('modificata da un altro utente')
    expect(q<HTMLInputElement>('fatt-data')!.value).toBe('2026-03-01')
  })

  it('Annulla sulla conferma: nessun rinvio', async () => {
    await crea('ADMIN', { fatturazioneDa: '2026-06-01', versione: 2, modificatoIl: null })
    servizio.salva.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'CONFERMA_RICHIESTA', message: 'x', details: { movimentiToccati: 3 } },
      }))
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    document.body.querySelector<HTMLButtonElement>('.p-confirm-dialog-reject')!.click()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledTimes(1)
  })

  it('codice *_NEL_FRATTEMPO è trattato come versione superata', async () => {
    await crea('ADMIN')
    servizio.salva.and.returnValue(
      throwError(() => ({ status: 409, error: { error: 'IMPOSTAZIONE_NEL_FRATTEMPO' } }))
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggi).toHaveBeenCalledTimes(2)
  })

  it('data incompleta: errore «Data non valida», nessuna PUT', async () => {
    await crea('ADMIN', { fatturazioneDa: '2026-06-01', versione: 2, modificatoIl: null })
    await scriviData('')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(q('fatt-errore')?.textContent).toContain('Data non valida')
    expect(servizio.salva).not.toHaveBeenCalled()
  })

  it('«Spegni la fatturazione» invia data null', async () => {
    await crea('ADMIN', { fatturazioneDa: '2026-06-01', versione: 2, modificatoIl: null })
    servizio.salva.and.returnValue(of(spenta))
    bottone('fatt-spegni')!.click()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledOnceWith({ fatturazioneDa: null, versione: 2 })
  })

  it('GET fallito: niente «Fatturazione spenta», errore con Riprova, Salva assente', async () => {
    servizio = jasmine.createSpyObj('ImpostazioneFatturazioneService', ['leggi', 'salva'])
    servizio.leggi.and.returnValues(
      throwError(() => ({ status: 500, error: {} })),
      of(spenta)
    )
    await TestBed.configureTestingModule({
      imports: [ImpostazioniFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioneFatturazioneService, useValue: servizio },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    }).compileComponents()
    fixture = TestBed.createComponent(ImpostazioniFatturazioneComponent)
    await stabilizza(fixture)
    expect(q('fatt-spenta')).toBeNull()
    expect(q('fatt-salva')).toBeNull()
    expect(q('fatt-errore')).not.toBeNull()
    bottone('fatt-riprova')!.click()
    await stabilizza(fixture)
    expect(q('fatt-spenta')).not.toBeNull()
    expect(bottone('fatt-salva')!.disabled).toBeFalse()
  })
})
