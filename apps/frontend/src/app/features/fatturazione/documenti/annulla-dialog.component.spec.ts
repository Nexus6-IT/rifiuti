import { SimpleChange } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { AnnullaDialogComponent, MAX_MOTIVO } from './annulla-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('AnnullaDialogComponent', () => {
  let fixture: ComponentFixture<AnnullaDialogComponent>
  let comp: AnnullaDialogComponent
  let motivi: string[]

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnnullaDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(AnnullaDialogComponent)
    comp = fixture.componentInstance
    motivi = []
    comp.confermato.subscribe(m => motivi.push(m))
    comp.visible = true
    comp.ngOnChanges({ visible: new SimpleChange(false, true, true) })
    fixture.detectChanges()
  })

  const pulsante = (): HTMLButtonElement =>
    q('annulla-conferma')?.querySelector('button') as HTMLButtonElement

  it('motivo vuoto o di soli spazi: pulsante disattivato e nessun evento', () => {
    expect(pulsante().disabled).toBeTrue()
    comp.motivo = '   '
    fixture.detectChanges()
    expect(pulsante().disabled).toBeTrue()
    comp.conferma()
    expect(motivi).toEqual([])
  })

  it('manda il motivo senza spazi ai bordi', () => {
    comp.motivo = '  Errore di importo  '
    fixture.detectChanges()
    expect(pulsante().disabled).toBeFalse()
    comp.conferma()
    expect(motivi).toEqual(['Errore di importo'])
  })

  it('oltre 200 caratteri non conferma', () => {
    comp.motivo = 'x'.repeat(MAX_MOTIVO + 1)
    expect(comp.valido()).toBeFalse()
    comp.motivo = 'x'.repeat(MAX_MOTIVO)
    expect(comp.valido()).toBeTrue()
  })

  it('in corso: non conferma due volte e non chiude', () => {
    comp.motivo = 'Motivo'
    comp.inCorso = true
    comp.conferma()
    const chiusure: number[] = []
    comp.chiuso.subscribe(() => chiusure.push(1))
    comp.chiudi()
    expect(motivi).toEqual([])
    expect(chiusure).toEqual([])
  })

  it('riaprendo il dialog il motivo riparte vuoto', () => {
    comp.motivo = 'Vecchio'
    comp.ngOnChanges({ visible: new SimpleChange(false, true, false) })
    expect(comp.motivo).toBe('')
  })
})
