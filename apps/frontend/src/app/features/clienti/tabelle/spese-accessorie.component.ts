import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { SpesaAccessoria, TipoSpesa } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_TIPO_SPESA, OPZIONI_TIPO_SPESA } from '../vocabolario-clienti'
import { SpesaAccessoriaDialogComponent } from './spesa-accessoria-dialog.component'
import { chiediConferma, messaggioErrore, permessoScrittura } from './tabella-comune'

@Component({
  selector: 'app-spese-accessorie',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    DropdownModule,
    TableModule,
    SpesaAccessoriaDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-dropdown
        [options]="filtri"
        optionLabel="label"
        optionValue="value"
        [ngModel]="filtro()"
        (onChange)="impostaFiltro($event.value)"
        ariaLabel="Filtra per tipo"
        data-testid="spesa-filtro"
      />
      <p-button
        *ngIf="puoScrivere()"
        label="Nuova spesa"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="spesa-nuova"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Tipo</th>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Importo</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr [attr.data-testid]="'spesa-riga-' + s.codice">
          <td>{{ etichettaTipo(s.tipo) }}</td>
          <td>{{ s.codice }}</td>
          <td>{{ s.descrizione }}</td>
          <td>{{ s.importo }}</td>
          <td>{{ s.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(s)"
              [attr.data-testid]="'spesa-modifica-' + s.codice"
            />
            <p-button
              [label]="s.attiva ? 'Disattiva' : 'Riattiva'"
              [icon]="s.attiva ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(s)"
              [attr.data-testid]="'spesa-attiva-' + s.codice"
            />
            <p-button
              *ngIf="s.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(s)"
              [attr.data-testid]="'spesa-elimina-' + s.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="6">Nessuna spesa accessoria.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-spesa-accessoria-dialog
      [visible]="dialogoAperto()"
      [elemento]="selezionata()"
      [tipo]="filtro() ?? undefined"
      (visibleChange)="dialogoAperto.set($event)"
      (salvato)="carica()"
    />
    <p-confirmDialog />
  `,
  styles: [
    `
      .barra {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class SpeseAccessorieComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly filtri: { label: string; value: TipoSpesa | null }[] = [
    { label: 'Tutti i tipi', value: null },
    ...OPZIONI_TIPO_SPESA,
  ]
  readonly filtro = signal<TipoSpesa | null>(null)
  readonly righe = signal<SpesaAccessoria[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionata = signal<SpesaAccessoria | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  etichettaTipo(t: TipoSpesa): string {
    return ETICHETTE_TIPO_SPESA[t] ?? t
  }

  impostaFiltro(tipo: TipoSpesa | null): void {
    this.filtro.set(tipo)
    this.carica()
  }

  carica(): void {
    const tipo = this.filtro()
    this.servizio.spese.list({ incluseDisattivate: true, ...(tipo ? { tipo } : {}) }).subscribe({
      next: r => {
        this.righe.set(r)
        this.erroreElenco.set(null)
      },
      error: err =>
        this.erroreElenco.set(messaggioErrore(err, 'Impossibile caricare le spese accessorie.')),
    })
  }

  apri(s: SpesaAccessoria | null): void {
    this.selezionata.set(s)
    this.dialogoAperto.set(true)
  }

  cambiaStato(s: SpesaAccessoria): void {
    this.servizio.spese.modifica(s.id, { attiva: !s.attiva, versione: s.versione }).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, 'Impossibile cambiare lo stato.'))
        // Dopo un conflitto di versione la riga è vecchia: si rilegge.
        this.carica()
      },
    })
  }

  elimina(s: SpesaAccessoria): void {
    chiediConferma(this.conferma, `Eliminare la spesa "${s.codice} - ${s.descrizione}"?`, () =>
      this.eliminaConfermata(s)
    )
  }

  eliminaConfermata(s: SpesaAccessoria): void {
    this.servizio.spese.elimina(s.id, s.versione).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, 'Impossibile eliminare la spesa.'))
        // Dopo un conflitto di versione la riga è vecchia: si rilegge.
        this.carica()
      },
    })
  }
}
