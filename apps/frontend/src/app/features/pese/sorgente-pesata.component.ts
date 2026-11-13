/**
 * Scelta della sorgente della pesata nei dialog di apertura e di seconda pesata: «Da strumento»
 * (lettura firmata dell'agente) o «Manuale». Il predefinito lo decide il padre con
 * `haStrumentoConAgente`. Il form manuale resta nel padre: qui solo il selettore e le letture.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { LettureStrumentoComponent } from './letture-strumento.component'
import { STILI_PESE } from './pese-stili'

export type SorgentePesata = 'STRUMENTO' | 'MANUALE'

@Component({
  selector: 'app-sorgente-pesata',
  standalone: true,
  imports: [CommonModule, LettureStrumentoComponent],
  template: `
    <fieldset class="sp-sorgente">
      <legend class="etichetta">Come si registra il peso</legend>
      <label class="sp-opzione">
        <input
          type="radio"
          [name]="idPrefisso + '-sorgente'"
          value="STRUMENTO"
          [checked]="sorgente === 'STRUMENTO'"
          (change)="sorgenteChange.emit('STRUMENTO')"
          [attr.data-testid]="idPrefisso + '-da-strumento'"
        />
        Da strumento
      </label>
      <label class="sp-opzione">
        <input
          type="radio"
          [name]="idPrefisso + '-sorgente'"
          value="MANUALE"
          [checked]="sorgente === 'MANUALE'"
          (change)="sorgenteChange.emit('MANUALE')"
          [attr.data-testid]="idPrefisso + '-manuale'"
        />
        Manuale
      </label>
    </fieldset>
    <app-letture-strumento
      *ngIf="sorgente === 'STRUMENTO'"
      [registroId]="registroId"
      [idPrefisso]="idPrefisso"
      (letturaScelta)="letturaScelta.emit($event)"
    ></app-letture-strumento>
  `,
  styles: [
    STILI_PESE,
    `
      .sp-sorgente {
        display: flex;
        gap: var(--spacing-base);
        flex-wrap: wrap;
        border: 0;
        padding: 0;
        margin: 0 0 var(--spacing-base);
      }
      .sp-opzione {
        display: inline-flex;
        gap: var(--spacing-xs);
        align-items: center;
        cursor: pointer;
      }
    `,
  ],
})
export class SorgentePesataComponent {
  @Input() sorgente: SorgentePesata = 'MANUALE'
  @Input() registroId: string | null = null
  @Input() idPrefisso = 'sp'
  @Output() sorgenteChange = new EventEmitter<SorgentePesata>()
  @Output() letturaScelta = new EventEmitter<string | null>()
}
