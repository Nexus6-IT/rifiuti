import { SimpleChange } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { fineGiornoDiOggi, isoLocale } from '../impostazioni/numerazione-scheda.component'
import { DatiStorno, StornoDialogComponent } from './storno-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('StornoDialogComponent', () => {
  let fixture: ComponentFixture<StornoDialogComponent>
  let comp: StornoDialogComponent
  let dati: DatiStorno[]

  const apri = (rifatturabile = false): void => {
    comp.rifatturabileIniziale = rifatturabile
    comp.visible = true
    comp.ngOnChanges({
      visible: new SimpleChange(false, true, true),
      rifatturabileIniziale: new SimpleChange(false, rifatturabile, true),
    })
    fixture.detectChanges()
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StornoDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(StornoDialogComponent)
    comp = fixture.componentInstance
    dati = []
    comp.confermato.subscribe(d => dati.push(d))
  })

  const pulsante = (): HTMLButtonElement =>
    q('storno-conferma')?.querySelector('button') as HTMLButtonElement

  it('motivo vuoto: pulsante disattivato', () => {
    apri()
    expect(pulsante().disabled).toBeTrue()
    comp.motivo = '  '
    fixture.detectChanges()
    expect(pulsante().disabled).toBeTrue()
    comp.conferma()
    expect(dati).toEqual([])
  })

  it('la data parte da oggi e maxDate è la fine del giorno', () => {
    apri()
    expect(comp.fineGiorno().getTime()).toBe(fineGiornoDiOggi().getTime())
    expect(comp.fineGiorno().getHours()).toBe(23)
    expect(comp.fineGiorno().getMinutes()).toBe(59)
    expect(isoLocale(comp.data as Date)).toBe(isoLocale(fineGiornoDiOggi()))
    expect(comp.dataFutura()).toBeFalse()
  })

  it('una data nel futuro non si conferma', () => {
    apri()
    comp.motivo = 'Errore'
    comp.data = new Date(fineGiornoDiOggi().getTime() + 24 * 3600 * 1000)
    fixture.detectChanges()
    expect(comp.dataFutura()).toBeTrue()
    expect(comp.valido()).toBeFalse()
    expect(q('storno-errore-data')).not.toBeNull()
  })

  it('conferma con motivo ripulito, data AAAA-MM-GG e rifatturabile', () => {
    apri(true)
    comp.motivo = ' Fattura doppia '
    comp.conferma()
    expect(dati).toEqual([
      {
        motivo: 'Fattura doppia',
        dataDocumento: isoLocale(fineGiornoDiOggi()),
        rifatturabile: true,
      },
    ])
  })

  it('«rifatturabile» parte spento se non richiesto', () => {
    apri(false)
    expect(comp.rifatturabile).toBeFalse()
  })

  it('in corso: non conferma due volte', () => {
    apri()
    comp.motivo = 'Errore'
    comp.inCorso = true
    comp.conferma()
    expect(dati).toEqual([])
  })
})
