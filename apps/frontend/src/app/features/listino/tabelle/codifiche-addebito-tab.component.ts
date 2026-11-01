import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { SelectButtonModule } from 'primeng/selectbutton'
import { TableModule } from 'primeng/table'
import { Subscription } from 'rxjs'
import { ToastService } from '../../../core/services/toast.service'
import {
  chiediConferma,
  eseguiERicarica,
  messaggioErrore,
  permessoScrittura,
} from '../../clienti/tabelle/tabella-comune'
import { ListinoService } from '../listino.service'
import { CodificaAddebito, GenereCodificaAddebito } from '../listino.model'
import {
  CONCORDANZA_GENERE_ADDEBITO,
  ETICHETTE_GENERE_ADDEBITO,
  OPZIONI_GENERE_ADDEBITO,
} from '../vocabolario-listino'
import { CodificaAddebitoDialogComponent } from './codifica-addebito-dialog.component'

/** Scheda "Gruppi e categorie di addebito": il genere si sceglie con un `p-selectButton` (D28). */
@Component({
  selector: 'app-codifiche-addebito-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    ConfirmDialogModule,
    SelectButtonModule,
    TableModule,
    CodificaAddebitoDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-selectButton
        [options]="generi"
        optionLabel="label"
        optionValue="value"
        [allowEmpty]="false"
        [ngModel]="genere()"
        (ngModelChange)="scegli($event)"
        ariaLabelledBy="codifiche-add-genere"
        data-testid="codifiche-add-genere"
      />
      <p-button
        *ngIf="puoScrivere()"
        [label]="concordanza().nuovo"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="codifica-add-nuova"
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
        <tr [attr.data-testid]="'codifica-add-riga-' + c.codice">
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
              [attr.data-testid]="'codifica-add-modifica-' + c.codice"
            />
            <p-button
              [label]="c.attiva ? 'Disattiva' : 'Riattiva'"
              [icon]="c.attiva ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(c)"
              [attr.data-testid]="'codifica-add-attiva-' + c.codice"
            />
            <p-button
              *ngIf="c.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(c)"
              [attr.data-testid]="'codifica-add-elimina-' + c.codice"
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
    <app-codifica-addebito-dialog
      [visible]="dialogoAperto()"
      [genere]="genere()"
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
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class CodificheAddebitoTabComponent implements OnInit {
  private readonly servizio = inject(ListinoService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private lettura?: Subscription

  readonly generi = OPZIONI_GENERE_ADDEBITO
  readonly puoScrivere = permessoScrittura()
  readonly genere = signal<GenereCodificaAddebito>('GRUPPO')
  readonly righe = signal<CodificaAddebito[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionata = signal<CodificaAddebito | null>(null)

  concordanza(): { nuovo: string; articolo: string } {
    return CONCORDANZA_GENERE_ADDEBITO[this.genere()]
  }

  ngOnInit(): void {
    this.carica()
  }

  scegli(genere: GenereCodificaAddebito): void {
    if (genere === this.genere()) return
    this.genere.set(genere)
    this.righe.set([])
    this.carica()
  }

  /** Una risposta in ritardo del genere precedente non deve riempire l'elenco del corrente. */
  carica(): void {
    this.lettura?.unsubscribe()
    this.lettura = this.servizio.codifiche.list(this.genere(), true).subscribe({
      next: r => {
        this.righe.set(r)
        this.erroreElenco.set(null)
      },
      error: err => this.erroreElenco.set(messaggioErrore(err, "Impossibile caricare l'elenco.")),
    })
  }

  apri(c: CodificaAddebito | null): void {
    this.selezionata.set(c)
    this.dialogoAperto.set(true)
  }

  cambiaStato(c: CodificaAddebito): void {
    eseguiERicarica(
      this.servizio.codifiche.modifica(c.id, { attiva: !c.attiva, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(c: CodificaAddebito): void {
    const g = ETICHETTE_GENERE_ADDEBITO[c.genere].toLowerCase()
    chiediConferma(
      this.conferma,
      `Eliminare ${CONCORDANZA_GENERE_ADDEBITO[c.genere].articolo} ${g} "${c.codice} - ${c.descrizione}"?`,
      () => this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: CodificaAddebito): void {
    eseguiERicarica(
      this.servizio.codifiche.elimina(c.id, c.versione),
      this.toast,
      "Impossibile eliminare l'elemento.",
      () => this.carica()
    )
  }
}
