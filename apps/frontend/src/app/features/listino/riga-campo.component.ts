import { CommonModule } from '@angular/common'
import { AfterContentChecked, Component, ElementRef, Input, inject } from '@angular/core'

/**
 * Etichetta, controllo (proiettato) e messaggi del backend sotto il campo (R36). Il controllo
 * porta lo stesso id (`campoId`) dell'etichetta; `campo` dà il `data-testid` degli errori.
 */
@Component({
  selector: 'app-riga-campo',
  standalone: true,
  imports: [CommonModule],
  template: `
    <label [for]="campoId">{{ etichetta }}</label>
    <ng-content />
    <small
      *ngFor="let e of errori; let i = index"
      role="alert"
      class="field-error"
      [attr.id]="i === 0 ? campoId + '-errore' : null"
      [attr.data-testid]="'riga-errore-' + campo"
      >{{ e }}</small
    >
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        flex: 1 1 10rem;
        min-width: 0;
      }
    `,
  ],
})
export class RigaCampoComponent implements AfterContentChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef)

  @Input({ required: true }) campoId!: string
  @Input({ required: true }) etichetta!: string
  @Input({ required: true }) campo!: string
  @Input() errori: readonly string[] = []

  /** Il controllo proiettato è marcato non valido e collegato ai messaggi sotto di lui. */
  ngAfterContentChecked(): void {
    const el = this.host.nativeElement.querySelector(`[id="${this.campoId}"]`)
    if (!el) return
    if (this.errori.length > 0) {
      el.setAttribute('aria-invalid', 'true')
      el.setAttribute('aria-describedby', `${this.campoId}-errore`)
    } else {
      el.removeAttribute('aria-invalid')
      el.removeAttribute('aria-describedby')
    }
  }
}
