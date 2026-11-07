import { Directive, Input, OnChanges, SimpleChanges } from '@angular/core'
import { catturaFocus } from '../utils/ripristina-focus'

/**
 * Su un `p-dialog`: `[appRipristinaFocus]="visible"`. All'apertura ricorda il pulsante che ha il
 * focus, alla chiusura glielo riporta. PrimeNG 17 sposta il focus dentro il dialog ma alla chiusura
 * non lo restituisce: dopo Esc o «Chiudi» chi usa la tastiera ripartirebbe dall'inizio della pagina.
 */
@Directive({ selector: '[appRipristinaFocus]', standalone: true })
export class RipristinaFocusDirective implements OnChanges {
  @Input('appRipristinaFocus') aperto: boolean | null | undefined = false

  private ripristina: (() => void) | null = null

  ngOnChanges(cambi: SimpleChanges): void {
    if (!cambi['aperto']) return
    if (this.aperto) {
      this.ripristina ??= catturaFocus()
    } else if (this.ripristina) {
      const r = this.ripristina
      this.ripristina = null
      r()
    }
  }
}
