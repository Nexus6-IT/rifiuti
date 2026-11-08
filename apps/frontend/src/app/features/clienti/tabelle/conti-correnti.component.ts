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
import { ContoCorrenteInElenco } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ContoCorrenteDialogComponent } from './conto-corrente-dialog.component'
import { caricaElenco, chiediConferma, eseguiERicarica, permessoScrittura } from './tabella-comune'

@Component({
  selector: 'app-conti-correnti',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
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
        styleClass="wf-primario"
        (onClick)="apri(null)"
        data-testid="conto-nuovo"
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
          <th scope="col" *ngIf="visibili().has('banca')">Banca</th>
          <th scope="col" *ngIf="visibili().has('iban')">IBAN</th>
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="'conto-riga-' + c.codice">
          <td>{{ c.codice }}</td>
          <td class="m2">
            {{ c.descrizione }}<span class="solo-tel" *ngIf="!c.attivo"> · Disattivato</span>
          </td>
          <td class="m-hide" *ngIf="visibili().has('banca')">{{ c.banca }}</td>
          <td class="m-hide mono" *ngIf="visibili().has('iban')">{{ c.ibanMascherato }}</td>
          <td class="m-hide">{{ c.attivo ? 'Attivo' : 'Disattivato' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere()">
            <app-azioni-riga
              [attr.data-testid]="'conto-modifica-' + c.codice"
              [nome]="c.codice + ' - ' + c.descrizione"
              [principale]="azioni.di(c).principale"
              [altre]="azioni.di(c).altre"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="colonneTotali()">Nessun conto corrente.</td>
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
      .mono {
        font-family: var(--font-family-mono);
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
export class ContiCorrentiComponent implements OnInit {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<ContoCorrenteInElenco[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly visibili = computed(() =>
    colonneConDati(this.righe(), { banca: c => c.banca, iban: c => c.ibanMascherato })
  )
  readonly colonneTotali = computed(() => 3 + this.visibili().size + (this.puoScrivere() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<ContoCorrenteInElenco>(c =>
    azioniDiRiga({
      modifica: () => this.apri(c),
      etichettaModifica: 'Modifica',
      attivo: c.attivo,
      cambiaStato: () => this.cambiaStato(c),
      elimina: c.eliminabile ? () => this.elimina(c) : undefined,
    })
  )
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<ContoCorrenteInElenco | null>(null)

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    caricaElenco(
      this.servizio.conti.list({ incluseDisattivate: true }),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare i conti correnti.'
    )
  }

  apri(c: ContoCorrenteInElenco | null): void {
    this.selezionato.set(c)
    this.dialogoAperto.set(true)
  }

  cambiaStato(c: ContoCorrenteInElenco): void {
    eseguiERicarica(
      this.servizio.conti.modifica(c.id, { attivo: !c.attivo, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(c: ContoCorrenteInElenco): void {
    chiediConferma(this.conferma, `Eliminare il conto "${c.codice} - ${c.descrizione}"?`, () =>
      this.eliminaConfermata(c)
    )
  }

  eliminaConfermata(c: ContoCorrenteInElenco): void {
    eseguiERicarica(
      this.servizio.conti.elimina(c.id, c.versione),
      this.toast,
      'Impossibile eliminare il conto.',
      () => this.carica()
    )
  }
}
