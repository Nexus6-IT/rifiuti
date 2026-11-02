import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'

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
      *ngFor="let e of errori"
      role="alert"
      class="field-error"
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
export class RigaCampoComponent {
  @Input({ required: true }) campoId!: string
  @Input({ required: true }) etichetta!: string
  @Input({ required: true }) campo!: string
  @Input() errori: readonly string[] = []
}
