import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ConfirmationService, MessageService } from 'primeng/api'
import { Subject, of, throwError } from 'rxjs'
import { AllegatoContratto } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { accettaConferma, bottone, q, stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { AllegatiContrattoComponent } from './allegati-contratto.component'

const allegato = (posizione: 1 | 2, nomeFile = `doc${posizione}.pdf`): AllegatoContratto => ({
  id: `al${posizione}`,
  posizione,
  nomeFile,
  dimensioneByte: 2048,
  caricatoIl: '2026-11-01T10:00:00Z',
})

const pdf = () => new File(['%PDF-1.4'], 'nuovo.pdf', { type: 'application/pdf' })

describe('AllegatiContrattoComponent', () => {
  let fixture: ComponentFixture<AllegatiContrattoComponent>
  let allegati: Record<'elenco' | 'carica' | 'scarica' | 'rimuovi', jasmine.Spy>

  async function apri(contrattoId: string | null, soloLettura = false) {
    fixture = TestBed.createComponent(AllegatiContrattoComponent)
    fixture.componentRef.setInput('contrattoId', contrattoId)
    fixture.componentRef.setInput('soloLettura', soloLettura)
    await stabilizza(fixture)
  }

  function scegliFile(posizione: number, file: File) {
    const input = q<HTMLInputElement>(`allegato-file-${posizione}`)!
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
      imports: [AllegatiContrattoComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ClientiService, useValue: { allegati } },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('nuovo contratto: il messaggio "Salva il contratto per allegare i PDF"', async () => {
    await apri(null)
    expect(q('allegati-salva-prima')!.textContent).toContain(
      'Salva il contratto per allegare i PDF'
    )
    expect(allegati.elenco).not.toHaveBeenCalled()
    expect(q('allegato-file-1')).toBeNull()
  })

  it('elenca le due posizioni: nome del file dove c\'è, "Nessun file" dove manca', async () => {
    await apri('ct1')
    expect(allegati.elenco).toHaveBeenCalledWith('ct1')
    expect(q('allegato-nome-1')!.textContent).toContain('doc1.pdf')
    expect(q('allegato-nome-2')!.textContent).toContain('Nessun file')
    expect(bottone('allegato-apri-1')).not.toBeNull()
    expect(bottone('allegato-apri-2')).toBeNull()
  })

  it('Carica manda il file in FormData con la posizione (service) e mostra il nuovo allegato', async () => {
    allegati.carica.and.returnValue(of(allegato(2, 'secondo.pdf')))
    await apri('ct1')
    const file = pdf()
    scegliFile(2, file)
    await stabilizza(fixture)
    expect(allegati.carica).toHaveBeenCalledWith('ct1', 2, file)
    expect(q('allegato-nome-2')!.textContent).toContain('secondo.pdf')
  })

  it('file non PDF scelto: il messaggio 415 del backend', async () => {
    allegati.carica.and.returnValue(
      throwError(() => ({
        status: 415,
        error: { message: "L'allegato del contratto deve essere un PDF." },
      }))
    )
    await apri('ct1')
    scegliFile(2, new File(['x'], 'foto.png', { type: 'image/png' }))
    await stabilizza(fixture)
    expect(q('allegati-errore')!.textContent).toContain(
      "L'allegato del contratto deve essere un PDF."
    )
    expect(q('allegato-nome-2')!.textContent).toContain('Nessun file')
  })

  it('oltre 4 MB: il messaggio 413 del backend', async () => {
    allegati.carica.and.returnValue(
      throwError(() => ({ status: 413, error: { message: "L'allegato supera i 4 MB." } }))
    )
    await apri('ct1')
    scegliFile(2, pdf())
    await stabilizza(fixture)
    expect(q('allegati-errore')!.textContent).toContain("L'allegato supera i 4 MB.")
  })

  it('Apri scarica il blob e lo apre in una scheda', async () => {
    const blob = new Blob(['%PDF'], { type: 'application/pdf' })
    allegati.scarica.and.returnValue(of(blob))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    const apre = spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    const crea = spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    spyOn(URL, 'revokeObjectURL')
    await apri('ct1')
    bottone('allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(allegati.scarica).toHaveBeenCalledWith('ct1', 'al1')
    expect(crea).toHaveBeenCalledWith(blob)
    expect(apre).toHaveBeenCalled()
    expect(scheda.location.href).toBe('blob:x')
  })

  it('Apri: errore di scaricamento mostrato, scheda chiusa', async () => {
    allegati.scarica.and.returnValue(throwError(() => ({ status: 500 })))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close') }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    await apri('ct1')
    bottone('allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(scheda.close).toHaveBeenCalled()
    expect(q('allegati-errore')).not.toBeNull()
  })

  it('Rimuovi chiede conferma e poi cancella senza versione', async () => {
    allegati.rimuovi.and.returnValue(of(undefined))
    await apri('ct1')
    bottone('allegato-rimuovi-1')!.click()
    await stabilizza(fixture)
    expect(allegati.rimuovi).not.toHaveBeenCalled()
    accettaConferma()
    await stabilizza(fixture)
    expect(allegati.rimuovi).toHaveBeenCalledOnceWith('ct1', 'al1')
    expect(q('allegato-nome-1')!.textContent).toContain('Nessun file')
  })

  it('con la conferma aperta blocca la chiusura del dialog (Esc)', async () => {
    await apri('ct1')
    expect(fixture.componentInstance.bloccaChiusuraEsterna(false)).toBeFalse()
    bottone('allegato-rimuovi-1')!.click()
    await stabilizza(fixture)
    expect(fixture.componentInstance.bloccaChiusuraEsterna(false)).toBeTrue()
  })

  it('VIEWER (sola lettura): solo Apri', async () => {
    await apri('ct1', true)
    expect(bottone('allegato-apri-1')).not.toBeNull()
    expect(bottone('allegato-rimuovi-1')).toBeNull()
    expect(q('allegato-file-2')).toBeNull()
    expect(bottone('allegato-carica-2')).toBeNull()
  })

  it('riaprendo su un altro contratto, la risposta tardiva del precedente non conta', async () => {
    const prima = new Subject<AllegatoContratto[]>()
    allegati.elenco.and.returnValues(prima, of([allegato(2, 'altro.pdf')]))
    await apri('ct1')
    fixture.componentRef.setInput('contrattoId', 'ct2')
    await stabilizza(fixture)
    prima.next([allegato(1, 'vecchio.pdf')])
    await stabilizza(fixture)
    expect(q('allegato-nome-1')!.textContent).toContain('Nessun file')
    expect(q('allegato-nome-2')!.textContent).toContain('altro.pdf')
  })

  it('cambiando contratto con la conferma aperta, la conferma si chiude e non rimuove nulla', async () => {
    await apri('ct1')
    bottone('allegato-rimuovi-1')!.click()
    await stabilizza(fixture)
    const conferma = fixture.debugElement.injector.get(ConfirmationService)
    const chiude = spyOn(conferma, 'close').and.callThrough()
    allegati.elenco.and.returnValue(of([allegato(1, 'altro.pdf')]))
    fixture.componentRef.setInput('contrattoId', 'ct2')
    await stabilizza(fixture)
    expect(chiude).toHaveBeenCalled()
    expect(fixture.componentInstance.confermaAperta()).toBeFalse()
    expect(allegati.rimuovi).not.toHaveBeenCalled()
  })

  it('un upload in corso blocca ogni azione; la risposta tardiva non tocca il contratto nuovo', async () => {
    const tardiva = new Subject<AllegatoContratto>()
    allegati.carica.and.returnValue(tardiva)
    await apri('ct1')
    scegliFile(2, pdf())
    await stabilizza(fixture)
    expect(bottone('allegato-apri-1')!.disabled).toBeTrue()
    expect(bottone('allegato-rimuovi-1')!.disabled).toBeTrue()
    expect(bottone('allegato-carica-2')!.disabled).toBeTrue()
    allegati.elenco.and.returnValue(of([allegato(1, 'altro.pdf')]))
    fixture.componentRef.setInput('contrattoId', 'ct2')
    await stabilizza(fixture)
    tardiva.next(allegato(2, 'tardivo.pdf'))
    await stabilizza(fixture)
    expect(q('allegato-nome-2')!.textContent).toContain('Nessun file')
    expect(fixture.componentInstance.occupata()).toBeNull()
  })

  it('la scheda del PDF perde il riferimento alla pagina (opener nullo)', async () => {
    allegati.scarica.and.returnValue(of(new Blob(['%PDF'])))
    const scheda = { location: { href: '' }, close: jasmine.createSpy('close'), opener: window }
    spyOn(window, 'open').and.returnValue(scheda as unknown as Window)
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x')
    await apri('ct1')
    bottone('allegato-apri-1')!.click()
    await stabilizza(fixture)
    expect(scheda.opener).toBeNull()
  })

  it("errore di caricamento dell'elenco: messaggio del backend", async () => {
    allegati.elenco.and.returnValue(
      throwError(() => ({ error: { message: 'Contratto non trovato.' } }))
    )
    await apri('ct1')
    expect(q('allegati-errore')!.textContent).toContain('Contratto non trovato.')
  })
})
