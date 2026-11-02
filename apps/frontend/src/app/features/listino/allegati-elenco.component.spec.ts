import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ConfirmationService, MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { accettaConferma, bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { AllegatiElencoComponent } from './allegati-elenco.component'
import { AllegatoElenco } from './listino.model'
import { ListinoService } from './listino.service'

const allegato = (posizione: 1 | 2, nomeFile = `doc${posizione}.pdf`): AllegatoElenco => ({
  id: `al${posizione}`,
  posizione,
  nomeFile,
  dimensioneByte: 2048,
})

const pdf = () => new File(['%PDF-1.4'], 'nuovo.pdf', { type: 'application/pdf' })

describe('AllegatiElencoComponent', () => {
  let fixture: ComponentFixture<AllegatiElencoComponent>
  let allegati: Record<'elenco' | 'carica' | 'scarica' | 'rimuovi', jasmine.Spy>

  async function apri(elencoId: string | null, soloLettura = false) {
    fixture = TestBed.createComponent(AllegatiElencoComponent)
    fixture.componentRef.setInput('elencoId', elencoId)
    fixture.componentRef.setInput('soloLettura', soloLettura)
    await stabilizza(fixture)
  }

  function scegliFile(posizione: number, file: File) {
    const input = q<HTMLInputElement>(`elenco-allegato-file-${posizione}`)!
    const dt = new DataTransfer()
    dt.items.add(file)
    input.files = dt.files
    input.dispatchEvent(new Event('change'))
  }

  beforeEach(() => {
    allegati = {
      elenco: jasmine.createSpy('elenco').and.returnValue(of([allegato(1)])),
      carica: jasmine.createSpy('carica'),
      scarica: jasmine.createSpy('scarica'),
      rimuovi: jasmine.createSpy('rimuovi'),
    }
    TestBed.configureTestingModule({
      imports: [AllegatiElencoComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ListinoService, useValue: { allegatiElenco: allegati } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('senza elenco non legge nulla e non mostra i pulsanti', async () => {
    await apri(null)
    expect(allegati.elenco).not.toHaveBeenCalled()
    expect(q('elenco-allegato-file-1')).toBeNull()
  })

  it('elenca le due posizioni: nome del file dove c\'è, "Nessun file" dove manca', async () => {
    await apri('el1')
    expect(allegati.elenco).toHaveBeenCalledWith('el1')
    expect(q('elenco-allegato-nome-1')!.textContent).toContain('doc1.pdf')
    expect(q('elenco-allegato-nome-2')!.textContent).toContain('Nessun file')
    expect(bottone('elenco-allegato-apri-1')).not.toBeNull()
    expect(bottone('elenco-allegato-apri-2')).toBeNull()
  })

  it('Carica manda il file in FormData con la posizione (service) e mostra il nuovo allegato', async () => {
    allegati.carica.and.returnValue(of(allegato(2, 'secondo.pdf')))
    await apri('el1')
    const file = pdf()
    scegliFile(2, file)
    await stabilizza(fixture)
    expect(allegati.carica).toHaveBeenCalledWith('el1', 2, file)
    expect(q('elenco-allegato-nome-2')!.textContent).toContain('secondo.pdf')
  })

  it('file non PDF scelto: il messaggio 415 del backend', async () => {
    allegati.carica.and.returnValue(
      throwError(() => ({
        status: 415,
        error: { message: "L'allegato dell'elenco deve essere un PDF." },
      }))
    )
    await apri('el1')
    scegliFile(2, new File(['x'], 'foto.png', { type: 'image/png' }))
    await stabilizza(fixture)
    expect(q('elenco-allegati-errore')!.textContent).toContain(
      "L'allegato dell'elenco deve essere un PDF."
    )
    expect(q('elenco-allegato-nome-2')!.textContent).toContain('Nessun file')
  })

  it('oltre 4 MB: il messaggio 413 del backend', async () => {
    allegati.carica.and.returnValue(
      throwError(() => ({ status: 413, error: { message: "L'allegato supera i 4 MB." } }))
    )
    await apri('el1')
    scegliFile(2, pdf())
    await stabilizza(fixture)
    expect(q('elenco-allegati-errore')!.textContent).toContain("L'allegato supera i 4 MB.")
  })

  it('Apri scarica il blob e lo apre in una scheda', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    allegati.scarica.and.returnValue(of(blob))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    const apre = spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    const crea = spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    await apri('el1')
    bottone('elenco-allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(allegati.scarica).toHaveBeenCalledWith('el1', 'al1')
    expect(crea).toHaveBeenCalledWith(blob)
    expect(apre).toHaveBeenCalled()
    expect(scheda.location.href).toBe('blob:x')
  })

  it('Apri: errore di scaricamento mostrato, scheda chiusa', async () => {
    allegati.scarica.and.returnValue(throwError(() => ({ status: 500 })))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    await apri('el1')
    bottone('elenco-allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(scheda.close).toHaveBeenCalled()
    expect(q('elenco-allegati-errore')).not.toBeNull()
  })

  it('Rimuovi chiede conferma e poi cancella senza versione', async () => {
    allegati.rimuovi.and.returnValue(of(undefined))
    await apri('el1')
    bottone('elenco-allegato-rimuovi-1')!.click()
    await stabilizza(fixture)
    expect(allegati.rimuovi).not.toHaveBeenCalled()
    accettaConferma()
    await stabilizza(fixture)
    expect(allegati.rimuovi).toHaveBeenCalledOnceWith('el1', 'al1')
    expect(q('elenco-allegato-nome-1')!.textContent).toContain('Nessun file')
  })

  it('VIEWER (sola lettura): solo Apri', async () => {
    await apri('el1', true)
    expect(bottone('elenco-allegato-apri-1')).not.toBeNull()
    expect(bottone('elenco-allegato-rimuovi-1')).toBeNull()
    expect(q('elenco-allegato-file-2')).toBeNull()
    expect(bottone('elenco-allegato-carica-2')).toBeNull()
  })

  it('riaprendo su un altro elenco, la risposta tardiva del precedente non conta', async () => {
    const prima = new Subject<AllegatoElenco[]>()
    allegati.elenco.and.returnValues(prima, of([allegato(2, 'altro.pdf')]))
    await apri('el1')
    fixture.componentRef.setInput('elencoId', 'el2')
    await stabilizza(fixture)
    prima.next([allegato(1, 'vecchio.pdf')])
    await stabilizza(fixture)
    expect(q('elenco-allegato-nome-1')!.textContent).toContain('Nessun file')
    expect(q('elenco-allegato-nome-2')!.textContent).toContain('altro.pdf')
  })

  it('cambiando elenco con la conferma aperta, la conferma si chiude e non rimuove nulla', async () => {
    await apri('el1')
    bottone('elenco-allegato-rimuovi-1')!.click()
    await stabilizza(fixture)
    const conferma = fixture.debugElement.injector.get(ConfirmationService)
    const chiude = spyOn(conferma, 'close').and.callThrough()
    allegati.elenco.and.returnValue(of([allegato(1, 'altro.pdf')]))
    fixture.componentRef.setInput('elencoId', 'el2')
    await stabilizza(fixture)
    expect(chiude).toHaveBeenCalled()
    expect(fixture.componentInstance.confermaAperta()).toBeFalse()
    expect(allegati.rimuovi).not.toHaveBeenCalled()
  })

  it("un upload in corso blocca ogni azione; la risposta tardiva non tocca l'elenco nuovo", async () => {
    const tardiva = new Subject<AllegatoElenco>()
    allegati.carica.and.returnValue(tardiva)
    await apri('el1')
    scegliFile(2, pdf())
    await stabilizza(fixture)
    expect(bottone('elenco-allegato-apri-1')!.disabled).toBeTrue()
    expect(bottone('elenco-allegato-rimuovi-1')!.disabled).toBeTrue()
    expect(bottone('elenco-allegato-carica-2')!.disabled).toBeTrue()
    allegati.elenco.and.returnValue(of([allegato(1, 'altro.pdf')]))
    fixture.componentRef.setInput('elencoId', 'el2')
    await stabilizza(fixture)
    tardiva.next(allegato(2, 'tardivo.pdf'))
    await stabilizza(fixture)
    expect(q('elenco-allegato-nome-2')!.textContent).toContain('Nessun file')
    expect(fixture.componentInstance.occupata()).toBeNull()
  })

  it('la scheda del PDF perde il riferimento alla pagina (opener nullo)', async () => {
    allegati.scarica.and.returnValue(of(new Blob(['%PDF'])))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close'), opener: window }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    await apri('el1')
    bottone('elenco-allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(scheda.opener).toBeNull()
  })

  it("errore di caricamento dell'elenco: messaggio del backend", async () => {
    allegati.elenco.and.returnValue(
      throwError(() => ({ error: { message: 'Elenco non trovato.' } }))
    )
    await apri('el1')
    expect(q('elenco-allegati-errore')!.textContent).toContain('Elenco non trovato.')
  })
})
