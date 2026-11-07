import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { Subscription } from 'rxjs'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import { ScostamentoRiga } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'

/** Lunghezza massima della nota (come il backend: 1-200 caratteri dopo il trim). */
export const NOTA_MASSIMA = 200

/**
 * Presa d'atto di uno scostamento (4.4c, Task 34, solo ADMIN): una nota obbligatoria di 1-200
 * caratteri. Manda la versione del legame letta con la lista. Dopo un errore di concorrenza o di
 * stato la chiusura chiede di rileggere la lista (`registrata`), perché lo scostamento può
 * essere già stato gestito.
 */
@Component({
  selector: 'app-presa-atto-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextareaModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      header="Presa d'atto dello scostamento"
      [modal]="true"
      [closable]="!inCorso()"
      [closeOnEscape]="!inCorso()"
      [style]="{ width: '32rem' }"
    >
      <div class="dlg-form">
        <p>La fattura resta com'è: la nota spiega perché lo scostamento non richiede uno storno.</p>
        <label for="presa-atto-nota">Nota</label>
        <textarea
          pInputTextarea
          id="presa-atto-nota"
          rows="4"
          [ngModel]="nota()"
          (ngModelChange)="nota.set($event)"
          [maxLength]="notaMassima"
          [attr.aria-describedby]="'presa-atto-contatore'"
          data-testid="presa-atto-nota"
        ></textarea>
        <small id="presa-atto-contatore" class="field-hint" data-testid="presa-atto-contatore">
          {{ nota().length }} / {{ notaMassima }}
        </small>
        <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="presa-atto-errore">
          {{ e }}
        </p>
      </div>
      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="presa-atto-annulla"
        />
        <p-button
          label="Registra la presa d'atto"
          icon="pi pi-check"
          [disabled]="!valida() || inCorso()"
          [loading]="inCorso()"
          (onClick)="conferma()"
          data-testid="presa-atto-conferma"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
    `,
  ],
})
export class PresaAttoDialogComponent implements OnChanges {
  private readonly servizio = inject(FatturazioneService)
  private readonly destroyRef = inject(DestroyRef)

  @Input() visible = false
  @Input() scostamento: ScostamentoRiga | null = null
  /** Presa d'atto registrata, o lista da rileggere dopo un errore di stato. */
  @Output() registrata = new EventEmitter<void>()
  @Output() chiuso = new EventEmitter<void>()

  readonly notaMassima = NOTA_MASSIMA
  readonly nota = signal('')
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  private daRileggere = false
  private richiesta?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) {
      this.nota.set('')
      this.errore.set(null)
      this.inCorso.set(false)
      this.daRileggere = false
    }
  }

  valida(): boolean {
    const n = this.nota().trim().length
    return n >= 1 && n <= NOTA_MASSIMA
  }

  conferma(): void {
    const s = this.scostamento
    if (!s || !this.valida() || this.inCorso()) return
    this.inCorso.set(true)
    this.errore.set(null)
    this.richiesta = this.servizio
      .presaAtto(s.legameId, this.nota().trim(), s.versioneLegame)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.inCorso.set(false)
          this.registrata.emit()
        },
        error: err => {
          this.inCorso.set(false)
          this.daRileggere = true
          this.errore.set(
            messaggiErroreFatturazione(err, "Impossibile registrare la presa d'atto.").join(' ')
          )
        },
      })
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.richiesta?.unsubscribe()
    if (this.daRileggere) this.registrata.emit()
    this.chiuso.emit()
  }

  alCambioVisibilita(v: boolean): void {
    if (!v) this.chiudi()
  }
}
