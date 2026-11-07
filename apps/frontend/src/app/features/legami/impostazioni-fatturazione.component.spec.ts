import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { MessageService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { accettaConferma, bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { ImpostazioniFatturazioneComponent } from './impostazioni-fatturazione.component'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { ImpostazioneFatturazione } from './legami.model'
import { ImpostazioniFatturazione44Service } from '../fatturazione/impostazioni/impostazioni-fatturazione-4-4.service'
import { Subject } from 'rxjs'

const spenta: ImpostazioneFatturazione = {
  fatturazioneDa: null,
  versione: 0,
  modificatoIl: null,
  definitiveAttive: false,
}
const AVVISO =
  'Accendi le definitive solo dopo la conferma del commercialista su TD24, documenti misti e nature soggette a bollo'

describe('ImpostazioniFatturazioneComponent', () => {
  let fixture: ComponentFixture<ImpostazioniFatturazioneComponent>
  let servizio: jasmine.SpyObj<ImpostazioneFatturazioneService>
  let servizio44: jasmine.SpyObj<ImpostazioniFatturazione44Service>

  async function crea(ruolo: string, iniziale = spenta): Promise<void> {
    servizio = jasmine.createSpyObj('ImpostazioneFatturazioneService', ['leggi', 'salva'])
    servizio.leggi.and.returnValue(of(iniziale))
    servizio44 = jasmine.createSpyObj('ImpostazioniFatturazione44Service', ['impostaDefinitive'])
    await TestBed.configureTestingModule({
      imports: [ImpostazioniFatturazioneComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ImpostazioneFatturazioneService, useValue: servizio },
        { provide: ImpostazioniFatturazione44Service, useValue: servizio44 },
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
      of({
        fatturazioneDa: '2026-01-01',
        versione: 1,
        modificatoIl: '2026-11-03',
        definitiveAttive: false,
      })
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.salva).toHaveBeenCalledOnceWith({ fatturazioneDa: '2026-01-01', versione: 0 })
    expect(q('fatt-spenta')).toBeNull()
  })

  it('409 CONFERMA_RICHIESTA: apre la conferma «Verranno toccati 3 movimenti», e solo dopo il consenso rimanda con confermaMovimenti 3', async () => {
    await crea('ADMIN', {
      fatturazioneDa: '2026-06-01',
      versione: 2,
      modificatoIl: null,
      definitiveAttive: false,
    })
    servizio.salva.and.returnValues(
      throwError(() => ({
        status: 409,
        error: {
          error: 'CONFERMA_RICHIESTA',
          message: 'Conferma richiesta',
          details: { movimentiToccati: 3 },
        },
      })),
      of({ fatturazioneDa: '2026-01-01', versione: 3, modificatoIl: null, definitiveAttive: false })
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
      of({ fatturazioneDa: '2026-03-01', versione: 5, modificatoIl: null, definitiveAttive: false })
    )
    await scriviData('2026-01-01')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(servizio.leggi).toHaveBeenCalledTimes(2)
    expect(q('fatt-errore')?.textContent).toContain('modificata da un altro utente')
    expect(q<HTMLInputElement>('fatt-data')!.value).toBe('2026-03-01')
  })

  it('Annulla sulla conferma: nessun rinvio', async () => {
    await crea('ADMIN', {
      fatturazioneDa: '2026-06-01',
      versione: 2,
      modificatoIl: null,
      definitiveAttive: false,
    })
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
    await crea('ADMIN', {
      fatturazioneDa: '2026-06-01',
      versione: 2,
      modificatoIl: null,
      definitiveAttive: false,
    })
    await scriviData('')
    bottone('fatt-salva')!.click()
    await stabilizza(fixture)
    expect(q('fatt-errore')?.textContent).toContain('Data non valida')
    expect(servizio.salva).not.toHaveBeenCalled()
  })

  it('«Spegni la fatturazione» invia data null', async () => {
    await crea('ADMIN', {
      fatturazioneDa: '2026-06-01',
      versione: 2,
      modificatoIl: null,
      definitiveAttive: false,
    })
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
        { provide: ImpostazioniFatturazione44Service, useValue: servizio44 },
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
  describe('interruttore «Definitive attive»', () => {
    const interruttore = () => q('fatt-definitive')!
    const input = () => interruttore().querySelector<HTMLInputElement>('input[type=checkbox]')!
    const clicca = async () => {
      input().click()
      await stabilizza(fixture)
    }

    for (const ruolo of ['ADMIN', 'SUPER_ADMIN']) {
      it(`${ruolo}: interruttore visibile e modificabile`, async () => {
        await crea(ruolo)
        expect(q('fatt-definitive')).not.toBeNull()
        expect(input().disabled).toBeFalse()
      })
    }

    for (const ruolo of ['VIEWER', 'OPERATOR']) {
      it(`${ruolo}: interruttore visibile ma disabilitato`, async () => {
        await crea(ruolo, { ...spenta, definitiveAttive: true })
        expect(q('fatt-definitive')).not.toBeNull()
        expect(input().disabled).toBeTrue()
        expect(input().checked).toBeTrue()
      })
    }

    it("accensione: dialog con l'avviso del commercialista, PUT solo dopo la conferma", async () => {
      await crea('ADMIN')
      servizio44.impostaDefinitive.and.returnValue(of({ definitiveAttive: true, versione: 1 }))
      await clicca()
      expect(document.body.textContent).toContain(AVVISO)
      expect(servizio44.impostaDefinitive).not.toHaveBeenCalled()
      accettaConferma()
      await stabilizza(fixture)
      expect(servizio44.impostaDefinitive).toHaveBeenCalledOnceWith(true, 0)
      expect(input().checked).toBeTrue()
    })

    it('accensione rifiutata: nessuna chiamata e interruttore di nuovo spento', async () => {
      await crea('ADMIN')
      await clicca()
      document.body.querySelector<HTMLButtonElement>('.p-confirm-dialog-reject')!.click()
      await stabilizza(fixture)
      expect(servizio44.impostaDefinitive).not.toHaveBeenCalled()
      expect(input().checked).toBeFalse()
    })

    it('spegnimento: nessun avviso, PUT immediata', async () => {
      await crea('ADMIN', { ...spenta, versione: 4, definitiveAttive: true })
      servizio44.impostaDefinitive.and.returnValue(of({ definitiveAttive: false, versione: 5 }))
      await clicca()
      expect(document.body.textContent).not.toContain(AVVISO)
      expect(servizio44.impostaDefinitive).toHaveBeenCalledOnceWith(false, 4)
      expect(input().checked).toBeFalse()
    })

    it('409 VERSIONE_SUPERATA: messaggio, ricarica e interruttore riallineato', async () => {
      await crea('ADMIN')
      servizio44.impostaDefinitive.and.returnValue(
        throwError(() => ({ status: 409, error: { error: 'VERSIONE_SUPERATA' } }))
      )
      servizio.leggi.and.returnValue(of({ ...spenta, versione: 7, definitiveAttive: false }))
      await clicca()
      accettaConferma()
      await stabilizza(fixture)
      expect(servizio.leggi).toHaveBeenCalledTimes(2)
      expect(q('fatt-errore')?.textContent).toContain('modificata da un altro utente')
      expect(input().checked).toBeFalse()
    })

    it('altro errore: messaggio senza id e interruttore riportato al valore salvato', async () => {
      await crea('ADMIN')
      servizio44.impostaDefinitive.and.returnValue(throwError(() => ({ status: 500, error: {} })))
      await clicca()
      accettaConferma()
      await stabilizza(fixture)
      expect(q('fatt-errore')?.textContent).toContain('Impossibile')
      expect(input().checked).toBeFalse()
    })

    it('la versione è condivisa: accendi le definitive e poi cambia la data, senza ricaricare', async () => {
      await crea('ADMIN')
      servizio44.impostaDefinitive.and.returnValue(of({ definitiveAttive: true, versione: 1 }))
      await clicca()
      accettaConferma()
      await stabilizza(fixture)
      servizio.salva.and.returnValue(
        of({
          fatturazioneDa: '2026-01-01',
          versione: 2,
          modificatoIl: null,
          definitiveAttive: true,
        })
      )
      await scriviData('2026-01-01')
      bottone('fatt-salva')!.click()
      await stabilizza(fixture)
      expect(servizio.salva).toHaveBeenCalledOnceWith({ fatturazioneDa: '2026-01-01', versione: 1 })
      // E viceversa: dopo il salvataggio della data, le definitive usano la versione nuova.
      servizio44.impostaDefinitive.calls.reset()
      servizio44.impostaDefinitive.and.returnValue(of({ definitiveAttive: false, versione: 3 }))
      await clicca()
      expect(servizio44.impostaDefinitive).toHaveBeenCalledOnceWith(false, 2)
      expect(servizio.leggi).toHaveBeenCalledTimes(1)
      expect(q('fatt-errore')).toBeNull()
    })

    it('la lettura pendente viene annullata alla chiusura della pagina', async () => {
      const pendente = new Subject<ImpostazioneFatturazione>()
      await crea('ADMIN')
      servizio.leggi.and.returnValue(pendente)
      fixture.componentInstance.carica()
      expect(pendente.observed).toBeTrue()
      fixture.destroy()
      expect(pendente.observed).toBeFalse()
    })

    it('una nuova lettura annulla quella ancora pendente', async () => {
      const prima = new Subject<ImpostazioneFatturazione>()
      await crea('ADMIN')
      servizio.leggi.and.returnValue(prima)
      fixture.componentInstance.carica()
      servizio.leggi.and.returnValue(of(spenta))
      fixture.componentInstance.carica()
      expect(prima.observed).toBeFalse()
    })
  })
})
