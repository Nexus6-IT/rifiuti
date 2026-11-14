import { HttpClientTestingModule } from '@angular/common/http/testing'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Subject, of, throwError } from 'rxjs'
import { RegistroVista } from '../registro/registro.service'
import { NuovoAccessoDialogComponent } from './nuovo-accesso-dialog.component'
import { AccessoVista, Automezzo, DatiPesataManuale, PeseService } from './pese.service'
import { By } from '@angular/platform-browser'
import { accesso, incolla, q, qb, scegli, scrivi } from './pese-test-utils'

const reg = (id: string, p: Partial<RegistroVista> = {}): RegistroVista => ({
  id,
  unitaLocaleId: 'u-' + id,
  numIscrSito: null,
  denominazione: 'Sede ' + id,
  codice: id,
  attivo: true,
  principale: false,
  ...p,
})
const mezzo: Automezzo = {
  id: 'm1',
  targa: 'AB123CD',
  targaRimorchio: null,
  trasportatoreId: null,
  taraKg: 8000,
  taraOrigine: 'DICHIARATA',
  taraPesataId: null,
  taraAggiornataIl: null,
  ultimaPesataVuotoIl: null,
  note: null,
  attivo: true,
}

describe('NuovoAccessoDialogComponent (DOM)', () => {
  let pese: jasmine.SpyObj<PeseService>
  let fixture: ComponentFixture<NuovoAccessoDialogComponent>
  const creati: AccessoVista[] = []

  function apri(registri: RegistroVista[] = [reg('r1', { principale: true })]) {
    fixture = TestBed.createComponent(NuovoAccessoDialogComponent)
    fixture.componentRef.setInput('registri', registri)
    fixture.componentRef.setInput('automezzi', [mezzo])
    fixture.componentRef.setInput('strumenti', [])
    fixture.componentInstance.creato.subscribe(a => creati.push(a))
    fixture.detectChanges()
  }
  function compila() {
    incolla(document.getElementById('na-pm-peso') as HTMLInputElement, '24000')
    scegli(q<HTMLSelectElement>('pm-strumento')!, '__esterno')
    fixture.detectChanges()
    scrivi(q<HTMLInputElement>('pm-esterno')!, 'Pesa del cliente')
    scrivi(q<HTMLInputElement>('pm-motivo')!, 'Pesa fuori servizio')
    q<HTMLInputElement>('pm-stabile')!.click()
    scrivi(q<HTMLInputElement>('na-targa')!, 'ab 123 cd')
    fixture.detectChanges()
  }

  beforeEach(() => {
    creati.length = 0
    pese = jasmine.createSpyObj<PeseService>('PeseService', ['apriAccesso'])
    TestBed.configureTestingModule({
      imports: [NuovoAccessoDialogComponent, HttpClientTestingModule],
      providers: [provideNoopAnimations(), { provide: PeseService, useValue: pese }],
    })
  })
  afterEach(() => fixture?.destroy())

  it('il registro si sceglie solo con più registri, con il predefinito preselezionato', () => {
    apri()
    expect(q('na-registro')).toBeNull()
    fixture.destroy()
    apri([reg('r1'), reg('r2', { principale: true })])
    expect(q<HTMLSelectElement>('na-registro')!.value).toBe('r2')
  })

  it('doppio clic su Salva invia una sola richiesta e il tentativo dopo l errore riusa la stessa chiave', () => {
    const risposta = new Subject<AccessoVista>()
    pese.apriAccesso.and.returnValue(risposta)
    apri()
    compila()
    qb('na-salva')!.click()
    fixture.detectChanges()
    expect(qb('na-salva')!.disabled).toBeTrue()
    qb('na-salva')!.click()
    expect(pese.apriAccesso).toHaveBeenCalledTimes(1)
    risposta.error({ status: 0, error: null })
    fixture.detectChanges()
    pese.apriAccesso.and.returnValue(of(accesso()))
    qb('na-salva')!.click()
    expect(pese.apriAccesso).toHaveBeenCalledTimes(2)
    const [a, b] = pese.apriAccesso.calls.allArgs()
    expect(b[0].chiaveIdempotenza).toBe(a[0].chiaveIdempotenza)
    expect(creati.length).toBe(1)
  })

  it('doppio onClick sincrono (che aggira il pulsante disabilitato) invia una sola richiesta', () => {
    pese.apriAccesso.and.returnValue(new Subject<AccessoVista>())
    apri()
    compila()
    const pulsante = fixture.debugElement.query(By.css('[data-testid="na-salva"]'))
    pulsante.triggerEventHandler('onClick', {})
    pulsante.triggerEventHandler('onClick', {})
    expect(pese.apriAccesso).toHaveBeenCalledTimes(1)
  })

  it('l aiuto del peso dice che non ci sono separatori delle migliaia', () => {
    apri()
    expect(document.body.textContent?.replace(/\s+/g, ' ')).toContain(
      'Niente separatore delle migliaia'
    )
  })

  it('invia verso, modo, targa e pesata', () => {
    pese.apriAccesso.and.returnValue(of(accesso()))
    apri()
    compila()
    scegli(q<HTMLSelectElement>('na-verso')!, 'SCARICO')
    qb('na-salva')!.click()
    const dati = pese.apriAccesso.calls.mostRecent().args[0]
    expect(dati.verso).toBe('SCARICO')
    expect(dati.modo).toBe('DOPPIA')
    expect(dati.targa).toBe('ab 123 cd')
    const manuale = dati.pesata as DatiPesataManuale
    expect(manuale.pesoKg).toBe(24000)
    expect(manuale.strumentoEsterno).toBe('Pesa del cliente')
  })

  it('con la tara registrata serve un automezzo dell elenco', () => {
    apri()
    compila()
    scegli(q<HTMLSelectElement>('na-modo')!, 'TARA_ANAGRAFICA')
    fixture.detectChanges()
    qb('na-salva')!.click()
    fixture.detectChanges()
    expect(pese.apriAccesso).not.toHaveBeenCalled()
    expect(q('na-automezzo-errore')?.textContent).toContain('automezzo')
    scegli(q<HTMLSelectElement>('na-automezzo')!, 'm1')
    fixture.detectChanges()
    pese.apriAccesso.and.returnValue(of(accesso()))
    qb('na-salva')!.click()
    const dati = pese.apriAccesso.calls.mostRecent().args[0]
    expect(dati.automezzoId).toBe('m1')
    expect(dati.targa).toBeNull()
  })

  it('un 422 del backend è mostrato testuale', () => {
    pese.apriAccesso.and.returnValue(
      throwError(() => ({
        status: 422,
        error: { message: "La tara dell'automezzo non è registrata." },
      }))
    )
    apri()
    compila()
    qb('na-salva')!.click()
    fixture.detectChanges()
    expect(q('na-errore')?.textContent).toContain("La tara dell'automezzo non è registrata.")
  })
})
