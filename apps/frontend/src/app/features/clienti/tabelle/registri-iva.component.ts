import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from './azioni-lista'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { caricaElenco, chiediConferma, eseguiERicarica, permessoScrittura } from './tabella-comune'
import { RegistroIva } from '../clienti.model'
import { RegistroIvaDialogComponent } from './registro-iva-dialog.component'

@Component({
  selector: 'app-registri-iva',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    RegistroIvaDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="barra">
      <p-button
        *ngIf="puoScrivere()"
        label="Nuovo registro"
        icon="pi pi-plus"
        styleClass="wf-primario"
        (onClick)="apri(null)"
        data-testid="registro-nuovo"
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
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-r>
        <tr [attr.data-testid]="'registro-riga-' + r.codice">
          <td>{{ r.codice }}</td>
          <td class="m2">
            {{ r.descrizione }}
            <span *ngIf="r.ricevuteSplit" class="badge-split">Ricevute split</span>
            <span class="solo-tel" *ngIf="!r.attivo"> · Disattivato</span>
          </td>
          <td class="m-hide">{{ r.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere()">
            <app-azioni-riga
              [attr.data-testid]="'registro-modifica-' + r.codice"
              [nome]="r.codice + ' - ' + r.descrizione"
              [principale]="azioni.di(r).principale"
              [altre]="azioni.di(r).altre"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="4">Nessun registro IVA.</td>
        </tr>
      </ng-template>
    </p-table>
    <app-registro-iva-dialog
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
      .badge-split {
        margin-left: 0.5rem;
        padding: 0.1rem 0.5rem;
        border-radius: 1rem;
        background: var(--surface-200);
        font-size: 0.8rem;
      }
    `,
  ],
})
export class RegistriIvaComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<RegistroIva[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly azioni = new MemoriaAzioni<RegistroIva>(r =>
    azioniDiRiga({
      modifica: () => this.apri(r),
      etichettaModifica: 'Modifica',
      attivo: r.attivo,
      cambiaStato: () => this.cambiaStato(r),
      elimina: r.eliminabile ? () => this.elimina(r) : undefined,
    })
  )
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<RegistroIva | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    caricaElenco(
      this.servizio.registri.list({ incluseDisattivate: true }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare i registri IVA.'
    )
  }

  apri(r: RegistroIva | null): void {
    this.selezionato.set(r)
    this.dialogoAperto.set(true)
  }

  cambiaStato(r: RegistroIva): void {
    eseguiERicarica(
      this.servizio.registri.modifica(r.id, { attivo: !r.attivo, versione: r.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(r: RegistroIva): void {
    chiediConferma(this.conferma, `Eliminare il registro "${r.codice} - ${r.descrizione}"?`, () =>
      this.eliminaConfermata(r)
    )
  }

  eliminaConfermata(r: RegistroIva): void {
    eseguiERicarica(
      this.servizio.registri.elimina(r.id, r.versione),
      this.toast,
      'Impossibile eliminare il registro.',
      () => this.carica()
    )
  }
}
