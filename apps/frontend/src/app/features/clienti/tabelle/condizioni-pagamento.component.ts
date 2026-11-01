import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { CondizionePagamento } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_MODALITA } from '../vocabolario-clienti'
import { CondizionePagamentoDialogComponent } from './condizione-pagamento-dialog.component'
import { caricaElenco, chiediConferma, eseguiERicarica, permessoScrittura } from './tabella-comune'

@Component({
  selector: 'app-condizioni-pagamento',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    CondizionePagamentoDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuova condizione"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="cond-nuova"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Modalità</th>
          <th scope="col">Rate</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="'cond-riga-' + c.codice">
          <td>{{ c.codice }}</td>
          <td>{{ c.descrizione }}</td>
          <td>{{ etichetta(c.modalita) }}</td>
          <td>{{ c.descrizioneRate }}</td>
          <td>{{ c.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(c)"
              [attr.data-testid]="'cond-modifica-' + c.codice"
            />
            <p-button
              [label]="c.attiva ? 'Disattiva' : 'Riattiva'"
              [icon]="c.attiva ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(c)"
              [attr.data-testid]="'cond-attiva-' + c.codice"
            />
            <p-button
              *ngIf="c.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(c)"
              [attr.data-testid]="'cond-elimina-' + c.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="6">Nessuna condizione di pagamento.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-condizione-pagamento-dialog
      [visible]="dialogoAperto()"
      [elemento]="selezionata()"
      (visibleChange)="dialogoAperto.set($event)"
      (salvato)="carica()"
    />
    <p-confirmDialog />
  `,
  styles: [
    `
      .barra {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class CondizioniPagamentoComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<CondizionePagamento[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionata = signal<CondizionePagamento | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  etichetta(m: keyof typeof ETICHETTE_MODALITA): string {
    return ETICHETTE_MODALITA[m] ?? m
  }

  carica(): void {
    caricaElenco(
      this.servizio.condizioni.list({ incluseDisattivate: true }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare le condizioni di pagamento.'
    )
  }

  apri(c: CondizionePagamento | null): void {
    this.selezionata.set(c)
    this.dialogoAperto.set(true)
  }

  cambiaStato(c: CondizionePagamento): void {
    eseguiERicarica(
      this.servizio.condizioni.modifica(c.id, { attiva: !c.attiva, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(c: CondizionePagamento): void {
    chiediConferma(this.conferma, `Eliminare la condizione "${c.codice} - ${c.descrizione}"?`, () =>
      this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: CondizionePagamento): void {
    eseguiERicarica(
      this.servizio.condizioni.elimina(c.id, c.versione),
      this.toast,
      'Impossibile eliminare la condizione.',
      () => this.carica()
    )
  }
}
