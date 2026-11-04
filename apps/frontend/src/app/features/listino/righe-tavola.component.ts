import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, computed, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import {
  cascataItaliana,
  decimaleItaliano,
  importoItaliano,
  totaleFissiAnnuo,
} from './listino-calcoli'
import { RigaAddebito } from './listino.model'
import { ETICHETTE_TIPO_QUANTITA } from './vocabolario-listino'

/**
 * Tavola delle righe di un elenco (D28, `riempitavola`): colonne, numeri in formato italiano,
 * "Totale fissi", apertura della riga (doppio clic, Invio o pulsante "Apri") ed eliminazione.
 * Qui si emettono `apri` ed `elimina`: dialog e conferma sono della pagina.
 */
@Component({
  selector: 'app-righe-tavola',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule],
  template: `
    <p *ngIf="errore" role="alert" class="field-error" data-testid="listino-errore-righe">
      {{ errore }}
    </p>
    <p-table
      [value]="righe()"
      [loading]="caricamento"
      styleClass="p-datatable-sm"
      [scrollable]="true"
    >
      <ng-template pTemplate="caption">
        <span class="sr-only">Righe dell'elenco</span>
      </ng-template>
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Tipo</th>
          <th scope="col">CER / addebito</th>
          <th scope="col">Rif.</th>
          <th scope="col">Descrizione</th>
          <th scope="col">U.M.</th>
          <th scope="col">Quantità</th>
          <th scope="col">Prezzo</th>
          <th scope="col">Sconto</th>
          <th scope="col">IVA</th>
          <th scope="col">Provvigione</th>
          <th scope="col">Cond.</th>
          <th scope="col">Minimo</th>
          <th scope="col">Categoria</th>
          <th scope="col">Appunti</th>
          <th scope="col"><span class="visually-hidden">Azioni</span></th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr (dblclick)="apri.emit(r)" [attr.data-testid]="'listino-riga-' + r.id">
          <td [attr.title]="r.etichettaTipo">{{ r.tipo }}</td>
          <td>{{ r.cerCode ?? r.addebito?.codice }}</td>
          <td>{{ r.riferimento }}</td>
          <td>{{ r.descrizione ?? r.addebito?.descrizione }}</td>
          <td>{{ r.unitaMisura }}</td>
          <td>{{ quantita(r) }}</td>
          <td>{{ r.prezzoSpeciale ? 'speciale' : prezzo(r.prezzo) }}</td>
          <td>{{ cascata(r.sconto) }}</td>
          <td>{{ r.codiceIva.codice }}</td>
          <td>{{ cascata(r.provvigione) }}</td>
          <td>{{ r.condizione }}</td>
          <td>{{ prezzo(r.minimoFatturabile) }}</td>
          <td>{{ r.categoria?.descrizione }}</td>
          <td>{{ r.appunti }}</td>
          <td>
            <p-button
              icon="pi pi-external-link"
              [text]="true"
              size="small"
              [ariaLabel]="'Apri la riga ' + (r.cerCode ?? r.addebito?.codice ?? r.tipo)"
              (onClick)="apri.emit(r)"
              [attr.data-testid]="'listino-apri-' + r.id"
            />
            <!-- Disabilitato, non nascosto: una riga usata dai legami resta chiusa/disattivata da "Apri". -->
            <span
              *ngIf="puoEliminare"
              [attr.title]="r.eliminabile ? null : MOTIVO_IN_USO"
              [attr.data-testid]="'listino-elimina-riga-tip-' + r.id"
            >
              <p-button
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                size="small"
                [disabled]="!r.eliminabile"
                [ariaLabel]="
                  'Elimina la riga ' +
                  (r.cerCode ?? r.addebito?.codice ?? r.tipo) +
                  (r.eliminabile ? '' : ' (' + MOTIVO_IN_USO + ')')
                "
                (onClick)="elimina.emit(r)"
                [attr.data-testid]="'listino-elimina-riga-' + r.id"
              />
              <small *ngIf="!r.eliminabile" class="cell-sub" aria-hidden="true">In uso</small>
            </span>
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="15">Nessuna riga.</td>
        </tr>
      </ng-template>
    </p-table>
    <p class="totale" data-testid="listino-totale-fissi">Totale fissi: {{ totaleFissiTesto() }}</p>
  `,
  styles: [
    `
      .totale {
        text-align: right;
        font-weight: 600;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class RigheTavolaComponent {
  readonly righe = signal<RigaAddebito[]>([])
  readonly totaleFissiTesto = computed(() => importoItaliano(totaleFissiAnnuo(this.righe())))

  @Input({ required: true }) set elementi(v: RigaAddebito[]) {
    this.righe.set(v)
  }
  @Input() caricamento = false
  @Input() errore: string | null = null
  /** Mostra "Elimina" su ogni riga: solo a chi scrive, con elenco modificabile e contratto attivo. */
  @Input() puoEliminare = false
  @Output() apri = new EventEmitter<RigaAddebito>()
  @Output() elimina = new EventEmitter<RigaAddebito>()

  readonly MOTIVO_IN_USO = 'In uso: la riga è citata da movimenti'

  /** Fisso: quantità fissa (vuota = 1); `CER`/`V`: etichetta del tipo di quantità (E15). */
  quantita(r: RigaAddebito): string {
    if (r.tipo === 'F') return decimaleItaliano(r.quantitaFissa ?? '1')
    return r.tipoQuantita ? ETICHETTE_TIPO_QUANTITA[r.tipoQuantita] : ''
  }

  cascata(v: string | null): string {
    return cascataItaliana(v)
  }

  prezzo(v: string | null): string {
    return decimaleItaliano(v, 2)
  }
}
