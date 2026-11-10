import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { TableModule } from 'primeng/table'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from '../../clienti/tabelle/azioni-lista'
import { caricaElenco, chiediConferma, eseguiERicarica } from '../../clienti/tabelle/tabella-comune'
import { ModelloStampaDialogComponent } from './modello-stampa-dialog.component'
import { etichettaAmbito, ModelloStampaVista } from './modello-stampa.model'
import { ModelliStampaService } from './modelli-stampa.service'

/** Ruoli che gestiscono i modelli (il backend risponde 403 agli altri). */
const RUOLI_MODELLI = ['SUPER_ADMIN', 'ADMIN']

/** Pagina «Modelli di stampa»: logo, testi e colori di FIR e distinta dei ritiri. */
@Component({
  selector: 'app-modelli-stampa',
  standalone: true,
  imports: [
    CommonModule,
    AzioniRigaComponent,
    ButtonModule,
    ConfirmDialogModule,
    TableModule,
    ModelloStampaDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Modelli di stampa</h1>
          <p class="page-subtitle">
            Logo, intestazione, piè di pagina e colori dei FIR e della distinta dei ritiri. Per ogni
            ambito, il modello predefinito è quello usato quando non se ne sceglie un altro.
          </p>
        </div>
        <div class="page-actions" *ngIf="puoGestire()">
          <p-button
            label="Nuovo modello"
            icon="pi pi-plus"
            styleClass="wf-primario"
            (onClick)="apri(null)"
            data-testid="modello-nuovo"
          />
        </div>
      </header>
      <p *ngIf="!puoGestire()" class="nota-pagina" role="status" data-testid="modelli-solo-admin">
        I modelli di stampa sono gestiti dagli amministratori.
      </p>
      <ng-container *ngIf="puoGestire()">
        <p
          *ngIf="erroreElenco() as e"
          role="alert"
          class="field-error"
          data-testid="modelli-errore"
        >
          {{ e }}
        </p>
        <div class="table-card">
          <p-table
            [value]="righe()"
            [styleClass]="
              'p-datatable-sm lista-telefono' + (righe().length === 0 ? ' senza-righe' : '')
            "
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Nome</th>
                <th scope="col">Ambito</th>
                <th scope="col" class="num-col m-hide">Copie</th>
                <th scope="col" class="m-hide">Predefinito</th>
                <th scope="col" class="num-col azioni-col">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-r>
              <tr [attr.data-testid]="'modello-riga-' + r.id">
                <td>
                  {{ r.nome }}
                  <span class="solo-tel">
                    · {{ ambito(r) }}{{ r.predefinito ? ' · Predefinito' : '' }}</span
                  >
                </td>
                <td class="m-hide">{{ ambito(r) }}</td>
                <td class="num-col m-hide">{{ r.copie }}</td>
                <td class="m-hide">
                  <span *ngIf="r.predefinito" class="badge-predefinito">Predefinito</span>
                </td>
                <td class="azioni-col">
                  <app-azioni-riga
                    [attr.data-testid]="'modello-azioni-' + r.id"
                    [nome]="r.nome"
                    [principale]="azioni.di(r).principale"
                    [altre]="azioni.di(r).altre"
                  />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="5" data-testid="modelli-vuoto">
                  Nessun modello di stampa. I documenti si stampano con l'impaginazione standard.
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </ng-container>
    </div>
    <app-modello-stampa-dialog
      [visible]="dialogoAperto()"
      [elemento]="selezionato()"
      (visibleChange)="dialogoAperto.set($event)"
      (salvato)="carica()"
    />
    <p-confirmDialog />
  `,
  styles: [
    `
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline;
        }
      }
      .badge-predefinito {
        padding: 0.1rem 0.5rem;
        border-radius: 1rem;
        background: var(--surface-200);
        font-size: 0.8rem;
      }
    `,
  ],
})
export class ModelliStampaComponent implements OnInit {
  private readonly servizio = inject(ModelliStampaService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly auth = inject(AuthService)

  readonly puoGestire = computed(() => RUOLI_MODELLI.includes(this.auth.currentUser()?.role ?? ''))
  readonly righe = signal<ModelloStampaVista[]>([])
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<ModelloStampaVista | null>(null)
  readonly ambito = (r: ModelloStampaVista) => etichettaAmbito(r.ambito)

  readonly azioni = new MemoriaAzioni<ModelloStampaVista>(r =>
    azioniDiRiga({
      modifica: () => this.apri(r),
      etichettaModifica: `Modifica ${r.nome}`,
      extra: r.predefinito
        ? []
        : [
            {
              etichetta: 'Rendi predefinito',
              icona: 'pi pi-star',
              esegui: () => this.rendiPredefinito(r),
            },
          ],
      elimina: () => this.elimina(r),
    })
  )

  ngOnInit(): void {
    if (this.puoGestire()) this.carica()
  }

  carica(): void {
    caricaElenco(
      this.servizio.elenco(),
      this.righe,
      this.erroreElenco,
      'Impossibile caricare i modelli di stampa.'
    )
  }

  apri(r: ModelloStampaVista | null): void {
    this.selezionato.set(r)
    this.dialogoAperto.set(true)
  }

  rendiPredefinito(r: ModelloStampaVista): void {
    eseguiERicarica(
      this.servizio.rendiPredefinito(r.id, r.versione),
      this.toast,
      'Impossibile impostare il modello predefinito.',
      () => this.carica()
    )
  }

  elimina(r: ModelloStampaVista): void {
    const nota = r.predefinito ? ' Era il predefinito del suo ambito.' : ''
    chiediConferma(this.conferma, `Eliminare il modello "${r.nome}"?${nota}`, () =>
      eseguiERicarica(
        this.servizio.elimina(r.id, r.versione),
        this.toast,
        'Impossibile eliminare il modello.',
        () => this.carica()
      )
    )
  }
}
