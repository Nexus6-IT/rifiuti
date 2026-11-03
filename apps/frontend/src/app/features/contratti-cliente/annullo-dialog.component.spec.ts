import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { CodificaContratto, ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { CodificaDialogComponent } from '../clienti/tabelle/codifica-dialog.component'
import { bottone, q, scrivi, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { AnnulloDialogComponent } from './annullo-dialog.component'

const motivo = (id: string, codice: string, descrizione: string): CodificaContratto => ({
  id,
  versione: 1,
  eliminabile: true,
  genere: 'MOTIVO_ANNULLO',
  codice,
  descrizione,
  attiva: true,
})

const contratto = {
  id: 'cc1',
  numero: 'CC-2026-001',
  versione: 5,
  stato: 'ATTIVO',
} as ContrattoCliente

describe('AnnulloDialogComponent', () => {
  let fixture: ComponentFixture<AnnulloDialogComponent>
  let listCodifiche: jasmine.Spy
  let cambiaStato: jasmine.Spy
  let toast: jasmine.SpyObj<ToastService>
  let annullati: ContrattoCliente[]
  let falliti: string[]
  let visibilita: boolean[]

  async function apri() {
    fixture = TestBed.createComponent(AnnulloDialogComponent)
    fixture.componentRef.setInput('contratto', contratto)
    fixture.componentRef.setInput('visible', true)
    annullati = []
    falliti = []
    visibilita = []
    fixture.componentInstance.annullato.subscribe(c => annullati.push(c))
    fixture.componentInstance.fallito.subscribe(m => falliti.push(m))
    fixture.componentInstance.visibleChange.subscribe(v => visibilita.push(v))
    await stabilizza(fixture)
  }

  beforeEach(() => {
    listCodifiche = jasmine
      .createSpy('list')
      .and.returnValue(
        of([motivo('m1', '001', 'Disdetta del cliente'), motivo('m2', '002', 'Errore')])
      )
    cambiaStato = jasmine
      .createSpy('cambiaStato')
      .and.returnValue(of({ ...contratto, stato: 'ANNULLATO' }))
    toast = jasmine.createSpyObj('ToastService', ['error', 'success'])
    TestBed.configureTestingModule({
      imports: [AnnulloDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: TabelleFatturazioneService, useValue: { codifiche: { list: listCodifiche } } },
        { provide: ClientiService, useValue: { contratti: { cambiaStato } } },
        { provide: ToastService, useValue: toast },
        // Chi annulla un contratto ha sempre un ruolo di scrittura (la lista nasconde l'azione agli altri).
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("all'apertura legge i motivi attivi (non le disattivate)", async () => {
    await apri()
    expect(listCodifiche).toHaveBeenCalledOnceWith('MOTIVO_ANNULLO')
    expect(fixture.componentInstance.motivi().map(m => m.etichetta)).toEqual([
      'Disdetta del cliente',
      'Errore',
    ])
  })

  it("il titolo cita il numero del contratto, mai l'id", async () => {
    await apri()
    expect(document.body.textContent).toContain('CC-2026-001')
    expect(document.body.textContent).not.toContain('cc1')
  })

  it('senza motivo né testo: indicatore visibile e conferma disabilitata', async () => {
    await apri()
    expect(q('annullo-indicatore')!.textContent).toContain('Indica un motivo')
    expect(bottone('annullo-conferma')!.disabled).toBeTrue()
  })

  it('con solo il testo: indicatore sparito e conferma abilitata', async () => {
    await apri()
    scrivi('annullo-testo', 'Chiusura anticipata')
    await stabilizza(fixture)
    expect(q('annullo-indicatore')).toBeNull()
    expect(bottone('annullo-conferma')!.disabled).toBeFalse()
  })

  it('con solo il codice: conferma abilitata', async () => {
    await apri()
    fixture.componentInstance.scegliMotivo('m2')
    await stabilizza(fixture)
    expect(bottone('annullo-conferma')!.disabled).toBeFalse()
  })

  it("scelto il codice, il testo si precompila con la descrizione (anche se c'era altro)", async () => {
    await apri()
    scrivi('annullo-testo', 'vecchio')
    fixture.componentInstance.scegliMotivo('m1')
    await stabilizza(fixture)
    expect(q<HTMLTextAreaElement>('annullo-testo')!.value).toBe('Disdetta del cliente')
  })

  it('il testo ha al massimo 255 caratteri', async () => {
    await apri()
    expect(q<HTMLTextAreaElement>('annullo-testo')!.maxLength).toBe(255)
  })

  it('conferma: manda stato ANNULLATO, versione, motivoAnnulloId e motivo', async () => {
    await apri()
    fixture.componentInstance.scegliMotivo('m1')
    scrivi('annullo-testo', 'Disdetta del cliente, lettera del 3 marzo')
    await stabilizza(fixture)
    bottone('annullo-conferma')!.click()
    expect(cambiaStato).toHaveBeenCalledOnceWith('cc1', {
      stato: 'ANNULLATO',
      versione: 5,
      motivoAnnulloId: 'm1',
      motivo: 'Disdetta del cliente, lettera del 3 marzo',
    })
    expect(annullati.length).toBe(1)
    expect(visibilita).toEqual([false])
  })

  it('conferma con solo il testo: nessun motivoAnnulloId', async () => {
    await apri()
    scrivi('annullo-testo', '  Chiusura anticipata  ')
    await stabilizza(fixture)
    bottone('annullo-conferma')!.click()
    expect(cambiaStato).toHaveBeenCalledOnceWith('cc1', {
      stato: 'ANNULLATO',
      versione: 5,
      motivo: 'Chiusura anticipata',
    })
  })

  it('errore (409 compreso): segnala il messaggio del backend e chiude, così la lista si ricarica', async () => {
    cambiaStato.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { message: 'Il contratto è stato modificato da un altro utente.' },
      }))
    )
    await apri()
    scrivi('annullo-testo', 'x')
    await stabilizza(fixture)
    bottone('annullo-conferma')!.click()
    expect(falliti).toEqual(['Il contratto è stato modificato da un altro utente.'])
    expect(annullati).toEqual([])
    expect(visibilita).toEqual([false])
  })

  it('errore senza messaggio: ripiego', async () => {
    cambiaStato.and.returnValue(throwError(() => ({})))
    await apri()
    scrivi('annullo-testo', 'x')
    await stabilizza(fixture)
    bottone('annullo-conferma')!.click()
    expect(falliti).toEqual(['Impossibile annullare il contratto.'])
  })

  describe('"Nuovo motivo" in linea', () => {
    const sub = () =>
      fixture.debugElement.query(By.directive(CodificaDialogComponent))
        .componentInstance as CodificaDialogComponent

    it("apre app-codifica-dialog per i motivi, in modalità rapida; il salvato entra nell'elenco, si sceglie e precompila il testo", async () => {
      await apri()
      expect(sub().visible).toBeFalse()
      bottone('annullo-nuovo-motivo')!.click()
      await stabilizza(fixture)
      expect(sub().visible).toBeTrue()
      expect(sub().genere).toBe('MOTIVO_ANNULLO')
      expect(sub().rapida).toBeTrue()
      sub().salvato.emit(motivo('m9', '009', 'Fusione societaria'))
      sub().visibleChange.emit(false)
      await stabilizza(fixture)
      expect(fixture.componentInstance.motivi().map(m => m.etichetta)).toContain(
        'Fusione societaria'
      )
      expect(fixture.componentInstance.form.getRawValue().motivoId).toBe('m9')
      expect(q<HTMLTextAreaElement>('annullo-testo')!.value).toBe('Fusione societaria')
      expect(sub().visible).toBeFalse()
    })

    it("Esc nel sub-dialog non chiude il dialog dell'annullo e non perde il testo", async () => {
      await apri()
      scrivi('annullo-testo', 'in corso')
      bottone('annullo-nuovo-motivo')!.click()
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([])
      expect(fixture.componentInstance.form.getRawValue().motivo).toBe('in corso')
      sub().visibleChange.emit(false)
      await stabilizza(fixture)
      fixture.componentInstance.alCambioVisibilita(false)
      expect(visibilita).toEqual([false])
    })

    it('chiuso il sub-dialog, il focus torna a "Nuovo motivo"', async () => {
      await apri()
      bottone('annullo-nuovo-motivo')!.click()
      await stabilizza(fixture)
      sub().visibleChange.emit(false)
      await stabilizza(fixture)
      await new Promise(r => setTimeout(r))
      expect(document.activeElement).toBe(bottone('annullo-nuovo-motivo'))
    })
  })
})
