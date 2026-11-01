import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { NUMERO_ANNOTAZIONI, FormContratto } from './contratto-cliente-form'
import { ContrattoPrincipaleSelectComponent } from './contratto-principale-select.component'

/**
 * Sezione "Altro": contratto principale a cui questo è allegato (D28), commessa (testo libero,
 * D27) e tre annotazioni da 45 caratteri. Un contratto che ha già contratti allegati non può
 * essere allegato a sua volta: al posto del campo c'è il numero dei suoi allegati.
 */
@Component({
  selector: 'app-sezione-altro',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextModule, ContrattoPrincipaleSelectComponent],
  template: `
    <div class="sezione" [formGroup]="form">
      <app-contratto-principale-select
        *ngIf="contrattiAllegati === 0; else conAllegati"
        [controllo]="form.controls.contrattoPrincipaleId"
        [clienteId]="form.controls.clienteId.value"
        [contrattoId]="contrattoId"
        [corrente]="principaleCorrente"
      />
      <ng-template #conAllegati>
        <p class="badge" data-testid="contratto-dlg-allegati-badge">
          Ha {{ contrattiAllegati }}
          {{ contrattiAllegati === 1 ? 'contratto allegato' : 'contratti allegati' }}: non può
          essere allegato a un altro contratto.
        </p>
      </ng-template>

      <label for="contratto-dlg-commessa">Commessa</label>
      <input
        pInputText
        id="contratto-dlg-commessa"
        formControlName="commessa"
        maxlength="12"
        data-testid="contratto-dlg-commessa"
      />

      <label *ngFor="let n of numeri" [for]="'contratto-dlg-annotazione-' + n"
        >Annotazione {{ n }}
        <input
          pInputText
          [id]="'contratto-dlg-annotazione-' + n"
          maxlength="45"
          [value]="annotazione(n)"
          [disabled]="form.controls.annotazioni.disabled"
          (input)="scrivi(n, $any($event.target).value)"
          [attr.data-testid]="'contratto-dlg-annotazione-' + n"
        />
      </label>
    </div>
  `,
  styles: [
    `
      .sezione {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      label input {
        display: block;
        width: 100%;
        margin-top: 0.25rem;
      }
      .badge {
        margin: 0;
        font-weight: 600;
      }
    `,
  ],
})
export class SezioneAltroComponent {
  @Input({ required: true }) form!: FormContratto
  /** null = contratto nuovo. */
  @Input() contrattoId: string | null = null
  /** Quanti contratti sono allegati a questo (D28). */
  @Input() contrattiAllegati = 0
  @Input() principaleCorrente: { id: string; numero: string } | null = null

  readonly numeri = Array.from({ length: NUMERO_ANNOTAZIONI }, (_, i) => i + 1)

  annotazione(n: number): string {
    return this.form.controls.annotazioni.value[n - 1] ?? ''
  }

  scrivi(n: number, testo: string): void {
    const c = this.form.controls.annotazioni
    const nuove = [...c.value]
    nuove[n - 1] = testo
    c.setValue(nuove)
    c.markAsDirty()
  }
}
