import { Component } from '@angular/core'
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { RipristinaFocusDirective } from './ripristina-focus.directive'

@Component({
  standalone: true,
  imports: [RipristinaFocusDirective],
  template: `
    <button id="origine" data-testid="origine" type="button">Apri</button>
    <div [appRipristinaFocus]="aperto"><input id="dentro" /></div>
  `,
})
class OspiteComponent {
  aperto = false
}

describe('RipristinaFocusDirective', () => {
  let fixture: ComponentFixture<OspiteComponent>

  beforeEach(() => {
    fixture = TestBed.createComponent(OspiteComponent)
    document.body.appendChild(fixture.nativeElement)
    fixture.detectChanges()
  })
  afterEach(() => fixture.nativeElement.remove())

  const origine = () => fixture.nativeElement.querySelector('#origine') as HTMLElement
  const dentro = () => fixture.nativeElement.querySelector('#dentro') as HTMLElement

  it('alla chiusura riporta il focus al pulsante che aveva aperto la finestra', fakeAsync(() => {
    origine().focus()
    fixture.componentInstance.aperto = true
    fixture.detectChanges()
    dentro().focus() // PrimeNG sposta il focus nel dialog
    expect(document.activeElement).toBe(dentro())

    fixture.componentInstance.aperto = false
    fixture.detectChanges()
    tick(100)
    expect(document.activeElement).toBe(origine())
  }))

  it('non tocca il focus finche la finestra resta aperta', fakeAsync(() => {
    origine().focus()
    fixture.componentInstance.aperto = true
    fixture.detectChanges()
    dentro().focus()
    tick(100)
    expect(document.activeElement).toBe(dentro())
  }))

  it('riapre e richiude piu volte, sempre sul pulsante corrente', fakeAsync(() => {
    for (let i = 0; i < 2; i++) {
      origine().focus()
      fixture.componentInstance.aperto = true
      fixture.detectChanges()
      dentro().focus()
      fixture.componentInstance.aperto = false
      fixture.detectChanges()
      tick(100)
      expect(document.activeElement).toBe(origine())
      ;(document.activeElement as HTMLElement).blur()
    }
  }))
})
