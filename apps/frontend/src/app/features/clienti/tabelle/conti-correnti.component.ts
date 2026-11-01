import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { ContoCorrenteInElenco } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ContoCorrenteDialogComponent } from './conto-corrente-dialog.component'
import { chiediConferma, messaggioErrore, permessoScrittura } from './tabella-comune'

@Component({
  selector: 'app-conti-correnti',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    ContoCorrenteDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuovo conto"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="conto-nuovo"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Banca</th>
          <th scope="col">IBAN</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="'conto-riga-' + c.codice">
          <td>{{ c.codice }}</td>
          <td>{{ c.descrizione }}</td>
          <td>{{ c.banca }}</td>
          <td>{{ c.ibanMascherato }}</td>
          <td>{{ c.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(c)"
              [attr.data-testid]="'conto-modifica-' + c.codice"
            />
            <p-button
              [label]="c.attivo ? 'Disattiva' : 'Riattiva'"
              [icon]="c.attivo ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(c)"
              [attr.data-testid]="'conto-attiva-' + c.codice"
            />
            <p-button
              *ngIf="c.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(c)"
              [attr.data-testid]="'conto-elimina-' + c.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="6">Nessun conto corrente.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-conto-corrente-dialog
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
export class ContiCorrentiComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<ContoCorrenteInElenco[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<ContoCorrenteInElenco | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    this.servizio.conti.list({ incluseDisattivate: true }).subscribe({
      next: r => {
        this.righe.set(r)
        this.erroreElenco.set(null)
      },
      error: err =>
        this.erroreElenco.set(messaggioErrore(err, 'Impossibile caricare i conti correnti.')),
    })
  }

  apri(c: ContoCorrenteInElenco | null): void {
    this.selezionato.set(c)
    this.dialogoAperto.set(true)
  }

  cambiaStato(c: ContoCorrenteInElenco): void {
    this.servizio.conti.modifica(c.id, { attivo: !c.attivo, versione: c.versione }).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, 'Impossibile cambiare lo stato.'))
        // Dopo un conflitto di versione la riga è vecchia: si rilegge.
        this.carica()
      },
    })
  }

  elimina(c: ContoCorrenteInElenco): void {
    chiediConferma(this.conferma, `Eliminare il conto "${c.codice} - ${c.descrizione}"?`, () =>
      this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: ContoCorrenteInElenco): void {
    this.servizio.conti.elimina(c.id, c.versione).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, 'Impossibile eliminare il conto.'))
        // Dopo un conflitto di versione la riga è vecchia: si rilegge.
        this.carica()
      },
    })
  }
}
