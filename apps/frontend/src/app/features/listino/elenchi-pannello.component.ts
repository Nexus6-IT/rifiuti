import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { TagModule } from 'primeng/tag'
import { ElencoAddebiti } from './listino.model'

/** Colonna degli elenchi (D28): voci, "Solo validi oggi" e azioni. Lo stato sta nella pagina. */
@Component({
  selector: 'app-elenchi-pannello',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CheckboxModule, TagModule],
  template: `
    <div class="barra">
      <label class="spunta" for="listino-solo-validi">
        <p-checkbox
          inputId="listino-solo-validi"
          [binary]="true"
          [ngModel]="soloValidi"
          (ngModelChange)="soloValidiChange.emit($event)"
          data-testid="listino-solo-validi"
        />
        Solo validi oggi
      </label>
      <p-button
        *ngIf="!soloLettura"
        label="Nuovo elenco"
        icon="pi pi-plus"
        size="small"
        [outlined]="true"
        severity="secondary"
        (onClick)="nuovo.emit()"
        data-testid="listino-nuovo-elenco"
      />
    </div>
    <p *ngIf="elenchi.length === 0" data-testid="listino-nessun-elenco">Nessun elenco.</p>
    <ul class="lista">
      <li
        *ngFor="let e of elenchi"
        [class.scelto]="e.id === scelto?.id"
        [attr.data-testid]="'listino-elenco-' + e.id"
      >
        <button
          type="button"
          class="voce"
          [attr.title]="e.codice + ' ' + e.descrizione"
          [attr.aria-pressed]="e.id === scelto?.id"
          (click)="scegli.emit(e)"
          [attr.data-testid]="'listino-scegli-' + e.id"
        >
          <span class="voce__testo"
            ><strong>{{ e.codice }}</strong> {{ e.descrizione }}</span
          >
          <span class="validita" *ngIf="e.validoDal && e.validoAl">
            dal {{ e.validoDal | date: 'dd/MM/yyyy' }} al {{ e.validoAl | date: 'dd/MM/yyyy' }}
          </span>
        </button>
        <p-tag
          *ngIf="e.predefinito"
          value="Predefinito"
          severity="success"
          [attr.data-testid]="'listino-predefinito-' + e.id"
        />
        <span *ngIf="!soloLettura">
          <p-button
            *ngIf="e.modificabile"
            icon="pi pi-pencil"
            [text]="true"
            size="small"
            [ariaLabel]="'Modifica l’elenco ' + e.codice"
            (onClick)="modifica.emit(e)"
            [attr.data-testid]="'listino-modifica-' + e.id"
          />
          <span
            *ngIf="e.modificabile"
            [attr.title]="e.eliminabile ? null : MOTIVO_IN_USO"
            [attr.data-testid]="'listino-elimina-tip-' + e.id"
          >
            <p-button
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              [disabled]="!e.eliminabile"
              [ariaLabel]="
                'Elimina l’elenco ' + e.codice + (e.eliminabile ? '' : ' (' + MOTIVO_IN_USO + ')')
              "
              (onClick)="elimina.emit(e)"
              [attr.data-testid]="'listino-elimina-' + e.id"
            />
            <small *ngIf="!e.eliminabile" class="cell-sub" aria-hidden="true">In uso</small>
          </span>
        </span>
      </li>
    </ul>
  `,
  styles: [
    `
      .barra {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
      }
      .lista {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .lista li {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        align-items: center;
        padding: 0.25rem 0.5rem;
        border-left: 3px solid transparent;
      }
      .lista li.scelto {
        border-left-color: var(--selected-line);
        background: var(--selected);
      }
      .voce {
        background: none;
        border: 0;
        text-align: left;
        cursor: pointer;
        flex: 1;
        min-width: 0;
        font: inherit;
        color: inherit;
      }
      /* Descrizione su una riga con ellissi: il title del bottone la dice intera. */
      .voce__testo {
        display: block;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .validita {
        display: block;
        font-size: 0.85em;
        color: var(--text-secondary);
      }
    `,
  ],
})
export class ElenchiPannelloComponent {
  /** Già filtrati dalla pagina. */
  @Input({ required: true }) elenchi: ElencoAddebiti[] = []
  @Input() scelto: ElencoAddebiti | null = null
  @Input() soloValidi = false
  @Input() soloLettura = false
  @Output() soloValidiChange = new EventEmitter<boolean>()
  @Output() scegli = new EventEmitter<ElencoAddebiti>()
  @Output() nuovo = new EventEmitter<void>()
  @Output() modifica = new EventEmitter<ElencoAddebiti>()
  @Output() elimina = new EventEmitter<ElencoAddebiti>()

  readonly MOTIVO_IN_USO = 'In uso: l’elenco è citato da movimenti'
}
