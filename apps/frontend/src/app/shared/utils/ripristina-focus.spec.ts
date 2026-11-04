import { fakeAsync, tick } from '@angular/core/testing'
import { catturaFocus } from './ripristina-focus'

describe('catturaFocus', () => {
  let radice: HTMLDivElement

  beforeEach(() => {
    radice = document.createElement('div')
    document.body.appendChild(radice)
  })

  afterEach(() => radice.remove())

  it('riporta il focus sul pulsante che lo aveva', fakeAsync(() => {
    radice.innerHTML = '<button id="a">A</button><button id="b">B</button>'
    const a = radice.querySelector<HTMLElement>('#a')!
    a.focus()
    const ripristina = catturaFocus()
    radice.querySelector<HTMLElement>('#b')!.focus()
    ripristina()
    tick(100)
    expect(document.activeElement).toBe(a)
  }))

  it('se il pulsante è stato ridisegnato lo ritrova dal data-testid', fakeAsync(() => {
    radice.innerHTML = '<p-button data-testid="apri-1"><button>Apri</button></p-button>'
    radice.querySelector<HTMLElement>('button')!.focus()
    const ripristina = catturaFocus()
    radice.innerHTML = '<p-button data-testid="apri-1"><button>Apri</button></p-button>'
    ripristina()
    tick(100)
    expect(document.activeElement).toBe(radice.querySelector('button'))
  }))

  it('senza focus usa il data-testid di riserva e funziona una volta sola', fakeAsync(() => {
    radice.innerHTML = '<p-button data-testid="apri-2"><button>Apri</button></p-button>'
    const attivo = document.activeElement as HTMLElement | null
    attivo?.blur()
    const ripristina = catturaFocus('apri-2')
    ripristina()
    tick(100)
    expect(document.activeElement).toBe(radice.querySelector('button'))
    ;(document.activeElement as HTMLElement).blur()
    ripristina()
    tick(100)
    expect(document.activeElement).not.toBe(radice.querySelector('button'))
  }))
})
