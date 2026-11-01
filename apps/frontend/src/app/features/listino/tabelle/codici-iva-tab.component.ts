import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
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
  imports: [CommonModule, ButtonModule, ConfirmDialogModule, TableModule, CodiceIvaDialogComponent],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuovo codice IVA"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="iva-nuovo"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Aliquota</th>
          <th scope="col">Natura</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr [attr.data-testid]="'iva-riga-' + r.codice">
          <td>{{ r.codice }}</td>
          <td>{{ r.descrizione }}</td>
          <td>{{ r.aliquota }}%</td>
          <td>{{ r.natura ?? '' }}</td>
          <td>{{ r.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(r)"
              [attr.data-testid]="'iva-modifica-' + r.codice"
            />
            <p-button
              [label]="r.attivo ? 'Disattiva' : 'Riattiva'"
              [icon]="r.attivo ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(r)"
              [attr.data-testid]="'iva-attivo-' + r.codice"
            />
            <p-button
              *ngIf="r.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(r)"
              [attr.data-testid]="'iva-elimina-' + r.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="6">Nessun codice IVA.</td>
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
