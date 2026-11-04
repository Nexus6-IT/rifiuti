import { AfterViewChecked, Directive, ElementRef, Input, Renderer2, inject } from '@angular/core'

/**
 * I componenti PrimeNG (`p-inputNumber`, `p-button`, ...) non girano `aria-invalid` e
 * `aria-describedby` al controllo nativo che hanno dentro: messi sull'host non li legge nessun
 * lettore di schermo. Questa direttiva li imposta sul primo `input`/`textarea`/`button` interno,
 * a ogni giro di change detection (il controllo nasce dopo l'host e PrimeNG lo ridisegna).
 *
 * Uso: `<p-inputNumber [appAriaInterno]="!!errore" [ariaDescrittoDa]="errore ? 'err-id' : null">`.
 * Due valori semplici (non un oggetto): un letterale nel template cambierebbe identita' a ogni giro.
 */
@Directive({ selector: '[appAriaInterno]', standalone: true })
export class AriaInternoDirective implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)
  private readonly renderer = inject(Renderer2)

  /** Campo in errore: `aria-invalid="true"` (assente altrimenti). */
  @Input('appAriaInterno') invalido: boolean | null | '' = false
  /** Id dell'elemento che spiega l'errore o il motivo del blocco: `aria-describedby`. */
  @Input() ariaDescrittoDa: string | null = null

  ngAfterViewChecked(): void {
    const el = this.host.nativeElement.querySelector('input, textarea, button')
    if (!el) return
    this.imposta(el, 'aria-invalid', this.invalido === true || this.invalido === '' ? 'true' : null)
    this.imposta(el, 'aria-describedby', this.ariaDescrittoDa)
  }

  private imposta(el: Element, nome: string, valore: string | null): void {
    if (valore === null) {
      if (el.hasAttribute(nome)) this.renderer.removeAttribute(el, nome)
    } else if (el.getAttribute(nome) !== valore) {
      this.renderer.setAttribute(el, nome, valore)
    }
  }
}
