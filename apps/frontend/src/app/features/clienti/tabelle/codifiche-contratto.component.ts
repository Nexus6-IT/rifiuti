import { CommonModule } from '@angular/common'
import { Component, Input, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { chiediConferma, messaggioErrore, permessoScrittura } from './tabella-comune'
import { CodificaContratto, GenereCodifica } from '../clienti.model'
import { CONCORDANZA_GENERE, ETICHETTE_GENERE } from '../vocabolario-clienti'
import { CodificaDialogComponent } from './codifica-dialog.component'

const TITOLI: Readonly<Record<GenereCodifica, string>> = {
  CATEGORIA: 'Categorie',
  TIPO: 'Tipi di contratto',
  MOTIVO_ANNULLO: 'Motivi di annullo',
}

/** Elenco e gestione di un genere di codifiche (categorie, tipi o motivi di annullo). */
@Component({
  selector: 'app-codifiche-contratto',
  standalone: true,
  imports: [CommonModule, ButtonModule, ConfirmDialogModule, TableModule, CodificaDialogComponent],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <h2 [attr.data-testid]="'codifiche-titolo-' + genere">{{ titolo() }}</h2>
      <p-button
        *ngIf="puoScrivere()"
        [label]="concordanza().nuovo"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        [attr.data-testid]="'codifica-nuova-' + genere"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="'codifica-riga-' + genere + '-' + c.codice">
          <td>{{ c.codice }}</td>
          <td>{{ c.descrizione }}</td>
          <td>{{ c.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(c)"
              [attr.data-testid]="'codifica-modifica-' + genere + '-' + c.codice"
            />
            <p-button
              [label]="c.attiva ? 'Disattiva' : 'Riattiva'"
              [icon]="c.attiva ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(c)"
              [attr.data-testid]="'codifica-attiva-' + genere + '-' + c.codice"
            />
            <p-button
              *ngIf="c.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(c)"
              [attr.data-testid]="'codifica-elimina-' + genere + '-' + c.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="4">Nessun elemento.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-codifica-dialog
      [visible]="dialogoAperto()"
      [genere]="genere"
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
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      h2 {
        margin: 0;
        font-size: 1.1rem;
      }
    `,
  ],
})
export class CodificheContrattoComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  @Input() genere: GenereCodifica = 'CATEGORIA'

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<CodificaContratto[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionata = signal<CodificaContratto | null>(null)

  concordanza(): { nuovo: string; articolo: string } {
    return CONCORDANZA_GENERE[this.genere]
  }

  titolo(): string {
    return TITOLI[this.genere]
  }

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    this.servizio.codifiche.list(this.genere, true).subscribe({
      next: r => {
        this.righe.set(r)
        this.erroreElenco.set(null)
      },
      error: err => this.erroreElenco.set(messaggioErrore(err, "Impossibile caricare l'elenco.")),
    })
  }

  apri(c: CodificaContratto | null): void {
    this.selezionata.set(c)
    this.dialogoAperto.set(true)
  }

  cambiaStato(c: CodificaContratto): void {
    this.servizio.codifiche.modifica(c.id, { attiva: !c.attiva, versione: c.versione }).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, 'Impossibile cambiare lo stato.'))
        // Dopo un conflitto di versione la riga è vecchia: si rilegge.
        this.carica()
      },
    })
  }

  elimina(c: CodificaContratto): void {
    const g = ETICHETTE_GENERE[c.genere].toLowerCase()
    chiediConferma(
      this.conferma,
      `Eliminare ${CONCORDANZA_GENERE[c.genere].articolo} ${g} "${c.codice} - ${c.descrizione}"?`,
      () => this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: CodificaContratto): void {
    this.servizio.codifiche.elimina(c.id, c.versione).subscribe({
      next: () => this.carica(),
      error: err => {
        this.toast.error(messaggioErrore(err, "Impossibile eliminare l'elemento."))
        this.carica()
      },
    })
  }
}
