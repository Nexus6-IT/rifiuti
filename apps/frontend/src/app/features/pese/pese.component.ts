/**
 * Pagina delle pese: accessi, automezzi e strumenti di pesa in tre schede. Le schede si
 * montano solo quando servono. Lo stato della scheda attiva e' annunciato con aria-selected.
 */
import { CommonModule } from '@angular/common'
import { Component, signal } from '@angular/core'
import { AccessiComponent } from './accessi.component'
import { AutomezziComponent } from './automezzi.component'
import { StrumentiPesaComponent } from './strumenti-pesa.component'

type Scheda = 'accessi' | 'automezzi' | 'strumenti'

@Component({
  selector: 'app-pese',
  standalone: true,
  imports: [CommonModule, AccessiComponent, AutomezziComponent, StrumentiPesaComponent],
  template: `
    <h1 class="titolo">Pese</h1>
    <div role="tablist" aria-label="Sezioni delle pese" class="schede">
      <button
        *ngFor="let s of schede"
        type="button"
        role="tab"
        class="scheda"
        [id]="'pese-scheda-' + s.id"
        [attr.aria-selected]="attiva() === s.id"
        [attr.aria-controls]="'pese-pannello'"
        [attr.tabindex]="attiva() === s.id ? 0 : -1"
        [class.attiva]="attiva() === s.id"
        (click)="attiva.set(s.id)"
        (keydown)="tasto($event)"
        [attr.data-testid]="'pese-scheda-' + s.id"
      >
        {{ s.etichetta }}
      </button>
    </div>
    <div id="pese-pannello" role="tabpanel" [attr.aria-labelledby]="'pese-scheda-' + attiva()">
      <app-pese-accessi *ngIf="attiva() === 'accessi'"></app-pese-accessi>
      <app-pese-automezzi *ngIf="attiva() === 'automezzi'"></app-pese-automezzi>
      <app-pese-strumenti *ngIf="attiva() === 'strumenti'"></app-pese-strumenti>
    </div>
  `,
  styles: [
    `
      .titolo {
        font-size: var(--font-size-xl);
        margin: 0 0 var(--spacing-base);
      }
      .schede {
        display: flex;
        gap: var(--spacing-sm);
        border-bottom: 1px solid var(--border-color, #ddd);
        margin-bottom: var(--spacing-base);
      }
      .scheda {
        background: none;
        border: 0;
        border-bottom: 3px solid transparent;
        padding: var(--spacing-sm) var(--spacing-base);
        cursor: pointer;
        font: inherit;
        color: var(--text-secondary);
      }
      .scheda.attiva {
        border-bottom-color: var(--color-primary, #2563eb);
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
      }
    `,
  ],
})
export class PeseComponent {
  readonly schede: { id: Scheda; etichetta: string }[] = [
    { id: 'accessi', etichetta: 'Accessi' },
    { id: 'automezzi', etichetta: 'Automezzi' },
    { id: 'strumenti', etichetta: 'Strumenti di pesa' },
  ]
  readonly attiva = signal<Scheda>('accessi')

  /** Frecce sinistra/destra: sposta la scheda come nel pattern WAI-ARIA dei tab. */
  tasto(ev: KeyboardEvent): void {
    const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0
    if (!passo) return
    const i = this.schede.findIndex(s => s.id === this.attiva())
    const prossima = this.schede[(i + passo + this.schede.length) % this.schede.length]
    this.attiva.set(prossima.id)
    ev.preventDefault()
    setTimeout(() => document.getElementById('pese-scheda-' + prossima.id)?.focus())
  }
}
