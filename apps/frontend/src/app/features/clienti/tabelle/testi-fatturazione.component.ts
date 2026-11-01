import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { caricaElenco, chiediConferma, eseguiERicarica, permessoScrittura } from './tabella-comune'
import { TestoFatturazione } from '../clienti.model'
import { TestoFatturazioneDialogComponent } from './testo-fatturazione-dialog.component'

@Component({
  selector: 'app-testi-fatturazione',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    TestoFatturazioneDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuovo testo"
        icon="pi pi-plus"
        (onClick)="apri(null)"
        data-testid="testo-nuovo"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table [value]="righe()" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Testo</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-t>
        <tr [attr.data-testid]="'testo-riga-' + t.codice">
          <td>{{ t.codice }}</td>
          <td>
            <strong>{{ t.titolo }}</strong>
            <div class="anteprima">{{ t.righe[0] }}</div>
          </td>
          <td>{{ t.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td *ngIf="puoScrivere()">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="apri(t)"
              [attr.data-testid]="'testo-modifica-' + t.codice"
            />
            <p-button
              [label]="t.attivo ? 'Disattiva' : 'Riattiva'"
              [icon]="t.attivo ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato(t)"
              [attr.data-testid]="'testo-attivo-' + t.codice"
            />
            <p-button
              *ngIf="t.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina(t)"
              [attr.data-testid]="'testo-elimina-' + t.codice"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="4">Nessun testo di fatturazione.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-testo-fatturazione-dialog
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
      .anteprima {
        color: var(--text-color-secondary);
        font-size: 0.9rem;
      }
    `,
  ],
})
export class TestiFatturazioneComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<TestoFatturazione[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<TestoFatturazione | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    caricaElenco(
      this.servizio.testi.list({ incluseDisattivate: true }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare i testi di fatturazione.'
    )
  }

  apri(t: TestoFatturazione | null): void {
    this.selezionato.set(t)
    this.dialogoAperto.set(true)
  }

  cambiaStato(t: TestoFatturazione): void {
    eseguiERicarica(
      this.servizio.testi.modifica(t.id, { attivo: !t.attivo, versione: t.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(t: TestoFatturazione): void {
    chiediConferma(this.conferma, `Eliminare il testo "${t.codice} - ${t.titolo}"?`, () =>
      this.eliminaConfermata(t)
    )
  }

  eliminaConfermata(t: TestoFatturazione): void {
    eseguiERicarica(
      this.servizio.testi.elimina(t.id, t.versione),
      this.toast,
      'Impossibile eliminare il testo.',
      () => this.carica()
    )
  }
}
