import { TestBed } from '@angular/core/testing'
import { PillolaStatoComponent } from './pillola-stato.component'

describe('PillolaStatoComponent', () => {
  function crea(
    tono: 'ok' | 'warn' | 'err' | 'none' | 'todo',
    testo: string,
    barrato = false
  ): HTMLElement {
    const fixture = TestBed.createComponent(PillolaStatoComponent)
    fixture.componentInstance.tono = tono
    fixture.componentInstance.testo = testo
    fixture.componentInstance.barrato = barrato
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('stampa la parola con la classe del tono', () => {
    const el = crea('ok', 'Consegnato')
    const pillola = el.querySelector('.pillola') as HTMLElement
    expect(pillola.textContent?.trim()).toBe('Consegnato')
    expect(pillola.classList).toContain('tono-ok')
  })

  it('barrata per lo stato annullato', () => {
    const pillola = crea('none', 'Annullato', true).querySelector('.pillola') as HTMLElement
    expect(pillola.classList).toContain('pillola--barrata')
  })
})
