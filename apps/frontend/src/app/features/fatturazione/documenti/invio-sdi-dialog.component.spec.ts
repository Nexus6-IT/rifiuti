import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import {
  InvioSdiDialogComponent,
  MSG_GIA_EMESSI,
  MSG_INVIO_SDI,
} from './invio-sdi-dialog.component'

const q = <T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${id}"]`)

describe('InvioSdiDialogComponent', () => {
  let fixture: ComponentFixture<InvioSdiDialogComponent>
  let comp: InvioSdiDialogComponent

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InvioSdiDialogComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents()
    fixture = TestBed.createComponent(InvioSdiDialogComponent)
    comp = fixture.componentInstance
    comp.visible = true
    comp.quanti = 3
  })

  it('mostra il conteggio e il testo, senza la conferma dei gia emessi se non ce ne sono', () => {
    fixture.detectChanges()
    expect(q('invio-sdi-conteggio')!.textContent).toContain('3 documenti selezionati')
    expect(q('invio-sdi-testo')!.textContent).toContain(MSG_INVIO_SDI)
    expect(q('invio-sdi-gia-emessi')).toBeNull()
    const confermati: { confermaGiaEmesso: boolean }[] = []
    comp.confermato.subscribe(v => confermati.push(v))
    q('invio-sdi-ok')!.querySelector('button')!.click()
    expect(confermati).toEqual([{ confermaGiaEmesso: false }])
  })

  it('con documenti gia emessi: avviso del duplicato e conferma obbligatoria', () => {
    comp.giaEmessi = 2
    fixture.detectChanges()
    const nota = q('invio-sdi-gia-emessi')!.textContent!
    expect(nota).toContain('2 documenti risultano già emessi')
    expect(nota).toContain(MSG_GIA_EMESSI)
    const ok = () => q('invio-sdi-ok')!.querySelector('button')!
    expect(ok().disabled).toBeTrue()
    const confermati: { confermaGiaEmesso: boolean }[] = []
    comp.confermato.subscribe(v => confermati.push(v))
    comp.conferma()
    expect(confermati).toEqual([])
    comp.confermaGiaEmesso = true
    fixture.detectChanges()
    expect(ok().disabled).toBeFalse()
    comp.conferma()
    expect(confermati).toEqual([{ confermaGiaEmesso: true }])
  })

  it('durante la richiesta: conferma e chiusura bloccate', () => {
    comp.inCorso = true
    fixture.detectChanges()
    let chiuso = 0
    let confermato = 0
    comp.chiuso.subscribe(() => chiuso++)
    comp.confermato.subscribe(() => confermato++)
    comp.conferma()
    comp.chiudi()
    expect(chiuso).toBe(0)
    expect(confermato).toBe(0)
  })

  it('dopo la risposta: accodati, saltati col motivo in italiano e solo «Chiudi»', () => {
    comp.nomi = { a: '5/A', b: '6/A' }
    comp.esito = {
      accodate: [{ documentoId: 'a', trasmissioneId: 't', avvisi: [] }],
      saltate: [
        { documentoId: 'b', motivo: 'GIA_EMESSO' },
        { documentoId: 'zz', motivo: 'NON_TROVATO' },
      ],
    }
    fixture.detectChanges()
    expect(q('invio-sdi-esito')!.textContent).toContain('1 documento accodato')
    const voci = Array.from(
      document.body.querySelectorAll('[data-testid="invio-sdi-saltato"]')
    ).map(x => x.textContent!.replace(/\s+/g, ' ').trim())
    expect(voci).toEqual([
      '6/A: È già stato emesso (XML scaricato): serve la conferma',
      'Documento: Documento non trovato',
    ])
    expect(q('invio-sdi-ok')).toBeNull()
    expect(q('invio-sdi-chiudi')).not.toBeNull()
  })

  it('mostra l errore, senza HTML interpretato', () => {
    comp.errore = '<b>x</b>'
    fixture.detectChanges()
    expect(q('invio-sdi-errore')!.textContent).toContain('<b>x</b>')
    expect(q('invio-sdi-errore')!.querySelector('b')).toBeNull()
  })
})
