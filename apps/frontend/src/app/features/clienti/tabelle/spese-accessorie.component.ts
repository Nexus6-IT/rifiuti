import { CommonModule } from '@angular/common'
import { Component, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../../core/services/toast.service'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from './azioni-lista'
import { SpesaAccessoria, TipoSpesa } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_TIPO_SPESA, OPZIONI_TIPO_SPESA } from '../vocabolario-clienti'
import { SpesaAccessoriaDialogComponent } from './spesa-accessoria-dialog.component'
import { caricaElenco, chiediConferma, eseguiERicarica, permessoScrittura } from './tabella-comune'

@Component({
  selector: 'app-spese-accessorie',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
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
        styleClass="wf-primario"
        (onClick)="apri(null)"
        data-testid="spesa-nuova"
      />
    </div>
    <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
    <p-table
      [value]="righe()"
      [styleClass]="'p-datatable-sm lista-telefono' + (righe().length === 0 ? ' senza-righe' : '')"
    >
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Tipo</th>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col" class="num-col">Importo</th>
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-s>
        <tr [attr.data-testid]="'spesa-riga-' + s.codice">
          <td class="m-hide">{{ etichettaTipo(s.tipo) }}</td>
          <td>{{ s.codice }}</td>
          <td class="m2">
            {{ s.descrizione }}<span class="solo-tel" *ngIf="!s.attiva"> · Disattivata</span>
          </td>
          <td class="num-col m-hide">{{ s.importo | number: '1.2-2' }}</td>
          <td class="m-hide">{{ s.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere()">
            <app-azioni-riga
              [attr.data-testid]="'spesa-modifica-' + s.codice"
              [nome]="s.codice + ' - ' + s.descrizione"
              [principale]="azioni.di(s).principale"
              [altre]="azioni.di(s).altre"
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
  readonly azioni = new MemoriaAzioni<SpesaAccessoria>(s =>
    azioniDiRiga({
      modifica: () => this.apri(s),
      etichettaModifica: 'Modifica',
      attivo: s.attiva,
      cambiaStato: () => this.cambiaStato(s),
      elimina: s.eliminabile ? () => this.elimina(s) : undefined,
    })
  )
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
    caricaElenco(
      this.servizio.spese.list({ incluseDisattivate: true, ...(tipo ? { tipo } : {}) }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare le spese accessorie.'
    )
  }

  apri(s: SpesaAccessoria | null): void {
    this.selezionata.set(s)
    this.dialogoAperto.set(true)
  }

  cambiaStato(s: SpesaAccessoria): void {
    eseguiERicarica(
      this.servizio.spese.modifica(s.id, { attiva: !s.attiva, versione: s.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(s: SpesaAccessoria): void {
    chiediConferma(this.conferma, `Eliminare la spesa "${s.codice} - ${s.descrizione}"?`, () =>
      this.eliminaConfermata(s)
    )
  }

  eliminaConfermata(s: SpesaAccessoria): void {
    eseguiERicarica(
      this.servizio.spese.elimina(s.id, s.versione),
      this.toast,
      'Impossibile eliminare la spesa.',
      () => this.carica()
    )
  }
}
