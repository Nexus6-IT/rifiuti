import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { colonneConDati } from '../../../shared/utils/colonne-visibili'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from './azioni-lista'
import { CondizionePagamento } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_MODALITA } from '../vocabolario-clienti'
import { CondizionePagamentoDialogComponent } from './condizione-pagamento-dialog.component'
import {
  caricaElenco,
  chiediConferma,
  eseguiERicarica,
  permessoScrittura,
  cambiaStatoConConferma,
} from './tabella-comune'

@Component({
  selector: 'app-condizioni-pagamento',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
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
        styleClass="wf-primario"
        (onClick)="apri(null)"
        data-testid="cond-nuova"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table
      [value]="righe()"
      [styleClass]="'p-datatable-sm lista-telefono' + (righe().length === 0 ? ' senza-righe' : '')"
    >
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Modalità</th>
          <th scope="col" *ngIf="visibili().has('rate')">Rate</th>
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="'cond-riga-' + c.codice">
          <td>{{ c.codice }}</td>
          <td class="m2">
            {{ c.descrizione }}<span class="solo-tel" *ngIf="!c.attiva"> · Disattivata</span>
          </td>
          <td class="m-hide">{{ etichetta(c.modalita) }}</td>
          <td class="m-hide" *ngIf="visibili().has('rate')">{{ c.descrizioneRate }}</td>
          <td class="m-hide">{{ c.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere()">
            <app-azioni-riga
              [attr.data-testid]="'cond-modifica-' + c.codice"
              [nome]="c.codice + ' - ' + c.descrizione"
              [principale]="azioni.di(c).principale"
              [altre]="azioni.di(c).altre"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="colonneTotali()">Nessuna condizione di pagamento.</td>
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
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline;
        }
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
  readonly visibili = computed(() => colonneConDati(this.righe(), { rate: c => c.descrizioneRate }))
  readonly colonneTotali = computed(() => 4 + this.visibili().size + (this.puoScrivere() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<CondizionePagamento>(c =>
    azioniDiRiga({
      modifica: () => this.apri(c),
      etichettaModifica: 'Modifica',
      attivo: c.attiva,
      cambiaStato: () => this.chiediCambiaStato(c),
      elimina: c.eliminabile ? () => this.elimina(c) : undefined,
    })
  )
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

  /** «Disattiva» chiede conferma, «Riattiva» no. */
  chiediCambiaStato(c: CondizionePagamento): void {
    cambiaStatoConConferma(
      this.conferma,
      c.attiva,
      `la condizione "${c.codice} - ${c.descrizione}"`,
      () => this.cambiaStato(c)
    )
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
