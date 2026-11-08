import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { colonneConDati } from '../../../shared/utils/colonne-visibili'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from '../../clienti/tabelle/azioni-lista'
import {
  caricaElenco,
  chiediConferma,
  eseguiERicarica,
  permessoScrittura,
} from '../../clienti/tabelle/tabella-comune'
import { ListinoService } from '../listino.service'
import { CodiceIva } from '../listino.model'
import { CodiceIvaDialogComponent } from './codice-iva-dialog.component'

/** Scheda "Codici IVA" delle tabelle di fatturazione. */
@Component({
  selector: 'app-codici-iva-tab',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    CodiceIvaDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuovo codice IVA"
        icon="pi pi-plus"
        styleClass="wf-primario"
        (onClick)="apri(null)"
        data-testid="iva-nuovo"
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
          <th scope="col" class="num-col">Aliquota</th>
          <th scope="col" *ngIf="visibili().has('natura')">Natura</th>
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr [attr.data-testid]="'iva-riga-' + r.codice">
          <td>{{ r.codice }}</td>
          <td class="m2">
            {{ r.descrizione }}<span class="solo-tel" *ngIf="!r.attivo"> · Disattivato</span>
          </td>
          <td class="num-col m-hide">{{ r.aliquota }}%</td>
          <td class="m-hide" *ngIf="visibili().has('natura')">{{ r.natura }}</td>
          <td class="m-hide">{{ r.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere()">
            <app-azioni-riga
              [attr.data-testid]="'iva-modifica-' + r.codice"
              [nome]="r.codice + ' - ' + r.descrizione"
              [principale]="azioni.di(r).principale"
              [altre]="azioni.di(r).altre"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="colonneTotali()">Nessun codice IVA.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-codice-iva-dialog
      [visible]="dialogoAperto()"
      [elemento]="selezionato()"
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
export class CodiciIvaTabComponent implements OnInit {
  private readonly servizio = inject(ListinoService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<CodiceIva[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly visibili = computed(() => colonneConDati(this.righe(), { natura: r => r.natura }))
  readonly colonneTotali = computed(() => 4 + this.visibili().size + (this.puoScrivere() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<CodiceIva>(r =>
    azioniDiRiga({
      modifica: () => this.apri(r),
      etichettaModifica: 'Modifica',
      attivo: r.attivo,
      cambiaStato: () => this.cambiaStato(r),
      elimina: r.eliminabile ? () => this.elimina(r) : undefined,
    })
  )
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<CodiceIva | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    caricaElenco(
      this.servizio.codiciIva.list({ incluseDisattivate: true }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare i codici IVA.'
    )
  }

  apri(r: CodiceIva | null): void {
    this.selezionato.set(r)
    this.dialogoAperto.set(true)
  }

  cambiaStato(r: CodiceIva): void {
    eseguiERicarica(
      this.servizio.codiciIva.modifica(r.id, { attivo: !r.attivo, versione: r.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(r: CodiceIva): void {
    chiediConferma(this.conferma, `Eliminare il codice IVA "${r.codice} - ${r.descrizione}"?`, () =>
      this.eliminaConfermata(r)
    )
  }

  eliminaConfermata(r: CodiceIva): void {
    eseguiERicarica(
      this.servizio.codiciIva.elimina(r.id, r.versione),
      this.toast,
      'Impossibile eliminare il codice IVA.',
      () => this.carica()
    )
  }
}
