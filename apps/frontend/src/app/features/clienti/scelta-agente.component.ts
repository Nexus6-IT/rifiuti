import { Component, Input } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { AutoCompleteModule } from 'primeng/autocomplete'
import { ButtonModule } from 'primeng/button'
import { CommonModule } from '@angular/common'
import { OpzioniFatturazione } from './opzioni-fatturazione'

/** Agente: autocomplete sugli agenti attivi e "Nuovo agente" accanto (aggiunta in linea). */
@Component({
  selector: 'app-scelta-agente',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule, ButtonModule],
  template: `
    <label [for]="prefisso + '-agente'">Agente</label>
    <div class="scelta">
      <p-autoComplete
        [inputId]="prefisso + '-agente'"
        [ngModel]="opzioni.agenteSelezionato"
        (ngModelChange)="opzioni.cambiaModelloAgente($event)"
        [ngModelOptions]="{ standalone: true }"
        [suggestions]="opzioni.suggerimentiAgenti()"
        (completeMethod)="opzioni.cercaAgenti($event)"
        (onSelect)="opzioni.scegliAgente($event.value)"
        (onClear)="opzioni.scegliAgente(null)"
        field="etichetta"
        [dropdown]="true"
        [forceSelection]="true"
        [minLength]="0"
        [showClear]="true"
        [disabled]="!puoScegliere"
        ariaLabel="Agente"
        styleClass="w-full"
        [attr.data-testid]="prefisso + '-agente'"
      />
      <p-button
        *ngIf="puoCreare"
        label="Nuovo agente"
        icon="pi pi-plus"
        [text]="true"
        size="small"
        (onClick)="opzioni.inLinea.apri('agente', 'create', $event)"
        [attr.data-testid]="prefisso + '-nuovo-agente'"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .scelta {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .scelta p-autocomplete {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ],
})
export class SceltaAgenteComponent {
  @Input({ required: true }) opzioni!: OpzioniFatturazione
  /** Prefisso di id e data-testid (es. `cliente-dlg`). */
  @Input({ required: true }) prefisso!: string
  /** Si può scegliere un agente (false = campo disabilitato: VIEWER o campo bloccato). */
  @Input() puoScegliere = true
  /** Compare "Nuovo agente" (aggiunta in linea): separato da `puoScegliere`, R41. */
  @Input() puoCreare = false
}
