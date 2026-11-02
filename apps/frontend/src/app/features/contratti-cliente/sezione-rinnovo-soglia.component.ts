import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'
import { ReactiveFormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { CodiceRinnovo } from '../clienti/clienti.model'
import { messaggioNumero } from '../../shared/utils/numero-modificabile'
import { FormContratto } from './contratto-cliente-form'

/**
 * Sezione "Rinnovo e soglia": rinnovo automatico, codice rinnovo (solo S e N, Q8), incremento
 * ISTAT, inizio controllo soglia, soglia massima e "IVA esclusa". Il codice rinnovo S spunta il
 * rinnovo automatico e N lo toglie (D27); vuoto non lo tocca. Il controllo sul fatturato è di
 * 4.4: qui si raccolgono solo i dati. "IVA esclusa" non ha senso senza soglia.
 */
@Component({
  selector: 'app-sezione-rinnovo-soglia',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextModule],
  template: `
    <div class="sezione" [formGroup]="form">
      <label class="casella">
        <input
          type="checkbox"
          formControlName="rinnovoAutomatico"
          data-testid="contratto-dlg-rinnovo-auto"
        />
        Rinnovo automatico
      </label>
      <small
        *ngIf="rinnovoSenzaFine()"
        class="field-hint"
        data-testid="contratto-dlg-rinnovo-senza-fine"
        >Il rinnovo automatico sposta la data di fine: indicane una.</small
      >
      <label for="contratto-dlg-codice-rinnovo">Codice rinnovo</label>
      <select
        id="contratto-dlg-codice-rinnovo"
        formControlName="codiceRinnovo"
        class="p-inputtext"
        (change)="alCodiceRinnovo($event)"
        data-testid="contratto-dlg-codice-rinnovo"
      >
        <option value="">—</option>
        <option value="S">Sì</option>
        <option value="N">No</option>
      </select>
      <label class="casella">
        <input
          type="checkbox"
          formControlName="incrementoIstat"
          data-testid="contratto-dlg-istat"
        />
        Incremento ISTAT
      </label>

      <label for="contratto-dlg-soglia-dal">Inizio controllo soglia</label>
      <input
        pInputText
        type="date"
        id="contratto-dlg-soglia-dal"
        formControlName="sogliaDal"
        data-testid="contratto-dlg-soglia-dal"
      />
      <label for="contratto-dlg-soglia">Soglia massima (€)</label>
      <input
        pInputText
        id="contratto-dlg-soglia"
        formControlName="sogliaImporto"
        inputmode="decimal"
        [attr.aria-invalid]="errore('sogliaImporto') ? 'true' : null"
        [attr.aria-describedby]="errore('sogliaImporto') ? 'contratto-dlg-soglia-errore' : null"
        data-testid="contratto-dlg-soglia"
      />
      <small
        *ngIf="errore('sogliaImporto') as e"
        id="contratto-dlg-soglia-errore"
        role="alert"
        class="field-error"
        data-testid="contratto-dlg-soglia-errore"
        >{{ e }}</small
      >
      <label class="casella">
        <input
          type="checkbox"
          [checked]="conSoglia() && form.controls.sogliaIvaEsclusa.value"
          [disabled]="!conSoglia() || form.controls.sogliaIvaEsclusa.disabled"
          (change)="form.controls.sogliaIvaEsclusa.setValue($any($event.target).checked)"
          data-testid="contratto-dlg-soglia-iva"
        />
        Soglia al netto dell'IVA
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
      .casella {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
    `,
  ],
})
export class SezioneRinnovoSogliaComponent {
  @Input({ required: true }) form!: FormContratto

  /** Errore di numero (punto o testo) del campo, o null. */
  errore(campo: 'ritenutaPercentuale' | 'sogliaImporto'): string | null {
    return messaggioNumero(this.form.controls[campo])
  }

  conSoglia(): boolean {
    return this.form.controls.sogliaImporto.value.trim() !== ''
  }

  rinnovoSenzaFine(): boolean {
    return (
      this.form.controls.rinnovoAutomatico.value && this.form.controls.dataFine.value.trim() === ''
    )
  }

  /** Solo su scelta dell'operatore (non quando il dialog carica un contratto). */
  alCodiceRinnovo(e: Event): void {
    const codice = (e.target as HTMLSelectElement).value as CodiceRinnovo | ''
    if (codice === 'S') this.form.controls.rinnovoAutomatico.setValue(true)
    else if (codice === 'N') this.form.controls.rinnovoAutomatico.setValue(false)
  }
}
