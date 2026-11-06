import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ElencoPaginato } from '../clienti/tabelle/elenco-paginato'
import {
  chiediConferma,
  eseguiERicarica,
  permessoScrittura,
} from '../clienti/tabelle/tabella-comune'
import { AddebitoDialogComponent } from './addebito-dialog.component'
import { Addebito, FiltroAddebiti } from './listino.model'
import { ListinoService } from './listino.service'
import { puoVariarePrezzi } from './permessi-listino'
import { VariazioneArchivioDialogComponent } from './variazione-archivio-dialog.component'

/**
 * Archivio degli addebiti: ricerca con debounce, "Solo attivi", paginazione lazy, disattiva ed
 * elimina (con `versione`), dialog con i sei listini e variazione dei prezzi con anteprima.
 */
@Component({
  selector: 'app-addebiti-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    ConfirmDialogModule,
    InputTextModule,
    TableModule,
    AddebitoDialogComponent,
    VariazioneArchivioDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Archivio addebiti</h1>
      <div class="barra">
        <span class="p-input-icon-left">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per codice o descrizione"
            aria-label="Cerca un addebito"
            (input)="elenco.cerca($any($event.target).value)"
            data-testid="addebiti-cerca"
          />
        </span>
        <div class="barra__azioni">
          <label class="spunta" for="addebiti-solo-attivi">
            <p-checkbox
              inputId="addebiti-solo-attivi"
              [binary]="true"
              [ngModel]="soloAttivi"
              (ngModelChange)="impostaSoloAttivi($event)"
              data-testid="addebiti-solo-attivi"
            />
            Solo attivi
          </label>
          <p-button
            *ngIf="puoVariare()"
            label="Variazione prezzi"
            icon="pi pi-percentage"
            [outlined]="true"
            (onClick)="apriVariazione(null)"
            data-testid="addebiti-variazione"
          />
          <p-button
            *ngIf="puoScrivere()"
            label="Nuovo addebito"
            icon="pi pi-plus"
            (onClick)="apri(null)"
            data-testid="addebiti-nuovo"
          />
        </div>
      </div>
      <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
      <p-table
        [value]="righe()"
        [lazy]="true"
        [lazyLoadOnInit]="false"
        [paginator]="true"
        [rows]="elenco.dimensione"
        [first]="elenco.primo"
        [totalRecords]="totale()"
        [loading]="elenco.caricamento()"
        [rowsPerPageOptions]="[10, 25, 50]"
        (onLazyLoad)="elenco.cambiaPagina($event)"
        currentPageReportTemplate="{first}-{last} di {totalRecords}"
        [showCurrentPageReport]="totale() > 0"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Codice</th>
            <th scope="col">Descrizione</th>
            <th scope="col">Gruppo</th>
            <th scope="col">Tipo</th>
            <th scope="col">U.M.</th>
            <th scope="col">Prezzo listino 1</th>
            <th scope="col">Attivo</th>
            <th scope="col" *ngIf="puoScrivere() || puoVariare()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr [attr.data-testid]="'addebiti-riga-' + a.id">
            <td>{{ a.codice }}</td>
            <td>{{ a.descrizione }}</td>
            <td>{{ a.gruppo.descrizione }}</td>
            <td [attr.title]="a.etichettaTipo">{{ a.tipo }}</td>
            <td>{{ a.unitaMisura }}</td>
            <td>{{ prezzoBase(a) }}</td>
            <td>{{ a.attivo ? 'Sì' : 'No' }}</td>
            <td *ngIf="puoScrivere() || puoVariare()">
              <p-button
                *ngIf="puoScrivere()"
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                [ariaLabel]="'Modifica l’addebito ' + a.descrizione"
                (onClick)="apri(a)"
                [attr.data-testid]="'addebiti-modifica-' + a.id"
              />
              <p-button
                *ngIf="puoVariare()"
                label="Varia prezzi"
                icon="pi pi-percentage"
                [text]="true"
                size="small"
                [ariaLabel]="'Varia i prezzi dell’addebito ' + a.descrizione"
                (onClick)="apriVariazione(a)"
                [attr.data-testid]="'addebiti-varia-' + a.id"
              />
              <p-button
                *ngIf="puoScrivere()"
                [label]="a.attivo ? 'Disattiva' : 'Riattiva'"
                [icon]="a.attivo ? 'pi pi-ban' : 'pi pi-replay'"
                [text]="true"
                size="small"
                [ariaLabel]="(a.attivo ? 'Disattiva' : 'Riattiva') + ' l’addebito ' + a.descrizione"
                (onClick)="cambiaStato(a)"
                [attr.data-testid]="'addebiti-attiva-' + a.id"
              />
              <p-button
                *ngIf="puoScrivere() && a.eliminabile"
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                size="small"
                [ariaLabel]="'Elimina l’addebito ' + a.descrizione"
                (onClick)="elimina(a)"
                [attr.data-testid]="'addebiti-elimina-' + a.id"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="puoScrivere() || puoVariare() ? 8 : 7">Nessun addebito.</td>
          </tr>
        </ng-template>
      </p-table>
      <app-addebito-dialog
        [visible]="dialogoAperto()"
        [addebito]="selezionato()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="carica()"
        (daRicaricare)="carica()"
      />
      <app-variazione-archivio-dialog
        [visible]="variazioneAperta()"
        [addebitiIds]="addebitiVariazione()"
        (visibleChange)="variazioneAperta.set($event)"
        (applicata)="carica()"
      />
      <p-confirmDialog />
    </section>
  `,
  styles: [
    `
      /* Stessi margini delle altre pagine: gutter laterale e 24px sopra il titolo. */
      .pagina {
        padding: var(--spacing-lg) 0;
      }
      .barra {
        display: flex;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .barra__azioni {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
    `,
  ],
})
export class AddebitiListComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly auth = inject(AuthService)

  readonly puoScrivere = permessoScrittura()
  readonly puoVariare = () => puoVariarePrezzi(this.auth.currentUser()?.role)
  readonly elenco = new ElencoPaginato<Addebito, Pick<FiltroAddebiti, 'soloAttivi'>>(
    filtro => this.servizio.addebiti.list(filtro),
    "Impossibile caricare l'archivio degli addebiti."
  )
  readonly righe = this.elenco.righe
  readonly totale = this.elenco.totale
  readonly erroreElenco = this.elenco.errore
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<Addebito | null>(null)
  readonly variazioneAperta = signal(false)
  readonly addebitiVariazione = signal<string[] | null>(null)
  soloAttivi = false

  ngOnInit(): void {
    this.elenco.avvia()
  }

  ngOnDestroy(): void {
    this.elenco.ferma()
  }

  carica(): void {
    this.elenco.carica()
  }

  /** Il listino 1 è quello di base: il prezzo mostrato in elenco. */
  prezzoBase(a: Addebito): string {
    return a.listini.find(l => l.numero === 1)?.prezzo ?? ''
  }

  impostaSoloAttivi(valore: boolean): void {
    this.soloAttivi = valore
    this.elenco.impostaFiltri(valore ? { soloAttivi: true } : {})
  }

  apri(a: Addebito | null): void {
    this.selezionato.set(a)
    this.dialogoAperto.set(true)
  }

  apriVariazione(a: Addebito | null): void {
    this.addebitiVariazione.set(a ? [a.id] : null)
    this.variazioneAperta.set(true)
  }

  cambiaStato(a: Addebito): void {
    eseguiERicarica(
      this.servizio.addebiti.modifica(a.id, { attivo: !a.attivo, versione: a.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(a: Addebito): void {
    chiediConferma(this.conferma, `Eliminare l'addebito "${a.descrizione}"?`, () =>
      this.eliminaConfermato(a)
    )
  }

  eliminaConfermato(a: Addebito): void {
    eseguiERicarica(
      this.servizio.addebiti.elimina(a.id, a.versione),
      this.toast,
      "Impossibile eliminare l'addebito.",
      () => this.carica()
    )
  }
}
