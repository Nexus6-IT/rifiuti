/**
 * Distinta dei ritiri del giorno (4.7, T17): scelta della data e del mezzo (o tutti) e download
 * del PDF. Lettura: disponibile a tutti i ruoli dell'azienda.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { ToastService } from '../../core/services/toast.service'
import { CampoDataComponent } from '../../shared/components/campo-data.component'
import { messaggioErroreRitiri } from './ritiri.model'
import { RitiriService } from './ritiri.service'
import { scaricaPdf } from './scarica-pdf'

@Component({
  selector: 'app-distinta-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, CampoDataComponent],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      header="Distinta dei ritiri"
      [modal]="true"
      [focusOnShow]="false"
      [style]="{ width: '480px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi senza scaricare"
    >
      <div class="field">
        <label for="di-data">Giorno <span class="req" aria-hidden="true">*</span></label>
        <app-campo-data
          inputId="di-data"
          [(ngModel)]="data"
          name="data"
          data-testid="di-data"
          ariaDescribedby="di-errore"
        />
      </div>
      <div class="field">
        <label for="di-mezzo">Mezzo</label>
        <select
          id="di-mezzo"
          class="p-inputtext"
          [(ngModel)]="mezzo"
          name="mezzo"
          data-testid="di-mezzo"
        >
          <option value="">Tutti i mezzi</option>
          <option *ngFor="let m of mezzi" [value]="m.id">{{ m.targa }}</option>
        </select>
      </div>
      <p
        *ngIf="errore() as e"
        id="di-errore"
        role="alert"
        class="field-error"
        data-testid="di-errore"
      >
        {{ e }}
      </p>
      <div class="azioni">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="chiuso.emit()"
          data-testid="di-annulla"
        ></p-button>
        <p-button
          label="Scarica la distinta"
          icon="pi pi-download"
          styleClass="wf-primario"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="scarica()"
          data-testid="di-scarica"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .field {
        margin-bottom: var(--spacing-base);
      }
      .azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
      }
    `,
  ],
})
export class DistintaDialogComponent {
  private readonly servizio = inject(RitiriService)
  private readonly toast = inject(ToastService)

  @Input() data = ''
  @Input() mezzi: { id: string; targa: string }[] = []
  @Output() chiuso = new EventEmitter<void>()

  mezzo = ''
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  scarica(): void {
    if (this.inCorso()) return
    if (!this.data) {
      this.errore.set('Indica il giorno della distinta.')
      return
    }
    this.errore.set(null)
    this.inCorso.set(true)
    this.servizio.distinta(this.data, this.mezzo || undefined).subscribe({
      next: risposta => {
        this.inCorso.set(false)
        if (!scaricaPdf(risposta, `distinta-ritiri-${this.data}.pdf`)) {
          this.errore.set('PDF non disponibile.')
          return
        }
        this.toast.success('Distinta scaricata.')
        this.chiuso.emit()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Impossibile scaricare la distinta.'))
      },
    })
  }
}
