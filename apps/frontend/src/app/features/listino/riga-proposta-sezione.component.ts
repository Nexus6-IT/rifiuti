import { CommonModule } from '@angular/common'
import { Component, Input } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { Observable } from 'rxjs'
import { RigaForm } from './riga-modulo'
import { RigaRicercaComponent, VoceRicerca } from './riga-ricerca.component'

/**
 * Sezione "Proposta" (D6): per le righe `V` i CER che il listino propone al movimento, per le
 * righe `CER` gli addebiti variabili proposti insieme. Sono liste di codici: si aggiungono dalla
 * ricerca e si tolgono dai chip. Compare solo per le famiglie che la ammettono.
 */
@Component({
  selector: 'app-riga-proposta-sezione',
  standalone: true,
  imports: [CommonModule, ButtonModule, RigaRicercaComponent],
  template: `
    <fieldset
      class="gruppo"
      *ngIf="stato.abilitato('cerProposta') || stato.abilitato('addebitiProposti')"
      data-testid="riga-sezione-proposta"
    >
      <legend>Proposta</legend>

      <div class="blocco" *ngIf="stato.abilitato('cerProposta')">
        <span class="etichetta" id="riga-cer-proposti-etichetta">CER proposti</span>
        <ul
          class="chip"
          aria-labelledby="riga-cer-proposti-etichetta"
          data-testid="riga-cer-proposti"
        >
          <li *ngFor="let c of stato.form.controls.cerProposta.value">
            {{ c }}
            <button
              type="button"
              *ngIf="!soloLettura"
              [attr.aria-label]="'Togli il CER ' + c"
              (click)="togli('cerProposta', c)"
              [attr.data-testid]="'riga-cer-togli-' + c"
            >
              ×
            </button>
          </li>
        </ul>
        <app-riga-ricerca
          *ngIf="!soloLettura"
          inputId="riga-cer-proposto"
          testid="riga-cer-proposto"
          segnaposto="Cerca un codice CER da proporre"
          [cerca]="cercaCer"
          (scelta)="aggiungi('cerProposta', $event)"
        />
        <small
          *ngFor="let e of stato.erroriDi('cerProposta')"
          role="alert"
          class="field-error"
          data-testid="riga-errore-cerProposta"
          >{{ e }}</small
        >
      </div>

      <div class="blocco" *ngIf="stato.abilitato('addebitiProposti')">
        <span class="etichetta" id="riga-addebiti-proposti-etichetta">Addebiti proposti</span>
        <ul
          class="chip"
          aria-labelledby="riga-addebiti-proposti-etichetta"
          data-testid="riga-addebiti-proposti"
        >
          <li *ngFor="let c of stato.form.controls.addebitiProposti.value">
            {{ c }}
            <button
              type="button"
              *ngIf="!soloLettura"
              [attr.aria-label]="'Togli l’addebito ' + c"
              (click)="togli('addebitiProposti', c)"
              [attr.data-testid]="'riga-addebito-togli-' + c"
            >
              ×
            </button>
          </li>
        </ul>
        <app-riga-ricerca
          *ngIf="!soloLettura"
          inputId="riga-addebito-proposto"
          testid="riga-addebito-proposto"
          segnaposto="Cerca un addebito variabile da proporre"
          [cerca]="cercaAddebitoVariabile"
          (scelta)="aggiungi('addebitiProposti', $event)"
        />
        <small
          *ngFor="let e of stato.erroriDi('addebitiProposti')"
          role="alert"
          class="field-error"
          data-testid="riga-errore-addebitiProposti"
          >{{ e }}</small
        >
      </div>
    </fieldset>
  `,
  styles: [
    `
      .gruppo {
        border: 1px solid var(--surface-border, #ddd);
        border-radius: 6px;
        padding: 0.5rem 0.75rem 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
      }
      .blocco {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .chip {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
      }
      .chip li {
        display: inline-flex;
        gap: 0.3rem;
        align-items: center;
        padding: 0.1rem 0.5rem;
        border: 1px solid var(--surface-border, #ccc);
        border-radius: 999px;
      }
      .chip button {
        background: transparent;
        border: 0;
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
    `,
  ],
})
export class RigaPropostaSezioneComponent {
  @Input({ required: true }) stato!: RigaForm
  @Input({ required: true }) cercaCer!: (testo: string) => Observable<VoceRicerca[]>
  @Input({ required: true }) cercaAddebitoVariabile!: (testo: string) => Observable<VoceRicerca[]>
  @Input() soloLettura = false

  /** La voce è un CER (`chiave` = codice) o un addebito (`chiave` = codice dell'archivio). */
  aggiungi(campo: 'cerProposta' | 'addebitiProposti', voce: VoceRicerca): void {
    const c = this.stato.form.controls[campo]
    if (c.value.includes(voce.chiave)) return
    c.setValue([...c.value, voce.chiave])
  }

  togli(campo: 'cerProposta' | 'addebitiProposti', codice: string): void {
    const c = this.stato.form.controls[campo]
    c.setValue(c.value.filter(x => x !== codice))
  }
}
