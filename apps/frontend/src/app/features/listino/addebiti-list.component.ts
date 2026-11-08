import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { azioniDiRiga, MemoriaAzioni } from '../clienti/tabelle/azioni-lista'
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
    AzioniRigaComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Archivio addebiti</h1>
      <div class="barra-filtri">
        <span class="barra-filtri__ricerca">
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
        <div class="barra-filtri__destra">
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
            styleClass="wf-primario"
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
        [alwaysShowPaginator]="false"
        [rows]="elenco.dimensione"
        [first]="elenco.primo"
        [totalRecords]="totale()"
        [loading]="elenco.caricamento()"
        [rowsPerPageOptions]="[10, 25, 50]"
        (onLazyLoad)="elenco.cambiaPagina($event)"
        currentPageReportTemplate="{first}-{last} di {totalRecords}"
        [showCurrentPageReport]="totale() > 0"
        [styleClass]="
          'p-datatable-sm lista-telefono' + (righe().length === 0 ? ' senza-righe' : '')
        "
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Codice</th>
            <th scope="col">Descrizione</th>
            <th scope="col" *ngIf="visibili().has('gruppo')">Gruppo</th>
            <th scope="col" *ngIf="visibili().has('tipo')">Tipo</th>
            <th scope="col" *ngIf="visibili().has('unitaMisura')">U.M.</th>
            <th scope="col" class="num-col" *ngIf="visibili().has('prezzo')">Prezzo listino 1</th>
            <th scope="col">Attivo</th>
            <th scope="col" class="num-col azioni-col" *ngIf="haAzioni()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr [attr.data-testid]="'addebiti-riga-' + a.id">
            <td>{{ a.codice }}</td>
            <td class="m2 chi">
              {{ a.descrizione }}<span class="solo-tel" *ngIf="!a.attivo"> · Disattivato</span>
            </td>
            <td class="m-hide" *ngIf="visibili().has('gruppo')">{{ a.gruppo.descrizione }}</td>
            <td class="m-hide" *ngIf="visibili().has('tipo')" [attr.title]="a.etichettaTipo">
              {{ a.tipo }}
            </td>
            <td class="m-hide" *ngIf="visibili().has('unitaMisura')">{{ a.unitaMisura }}</td>
            <td class="num-col m-hide" *ngIf="visibili().has('prezzo')">
              {{ prezzoBase(a) | number: '1.2-2' }}
            </td>
            <td class="m-hide">{{ a.attivo ? 'Sì' : 'No' }}</td>
            <td class="azioni-col" *ngIf="haAzioni()">
              <app-azioni-riga
                [attr.data-testid]="'addebiti-modifica-' + a.id"
                [nome]="a.descrizione"
                [principale]="azioni.di(a).principale"
                [altre]="azioni.di(a).altre"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="colonneTotali()">Nessun addebito.</td>
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
      /* Il gutter laterale e' della shell: la pagina tiene solo lo spazio sopra il titolo. */
      .pagina {
        padding: var(--spacing-lg) 0;
      }
      .barra-filtri__destra {
        flex-wrap: wrap;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .chi {
        overflow-wrap: anywhere;
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
  /** Colonne facoltative con almeno un dato nella pagina: le altre non si disegnano. */
  readonly visibili = computed(() =>
    colonneConDati(this.righe(), {
      gruppo: a => a.gruppo?.descrizione,
      tipo: a => a.tipo,
      unitaMisura: a => a.unitaMisura,
      prezzo: a => this.prezzoBase(a),
    })
  )
  /** La colonna delle azioni c'e' per chi puo' modificare o variare i prezzi. */
  readonly haAzioni = () => this.puoScrivere() || this.puoVariare()
  /** Colonne del p-table (per la riga dello stato vuoto). */
  readonly colonneTotali = computed(() => 3 + this.visibili().size + (this.haAzioni() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<Addebito>(a => {
    const scrive = this.puoScrivere()
    return azioniDiRiga({
      modifica: scrive ? () => this.apri(a) : undefined,
      etichettaModifica: `Modifica l’addebito ${a.descrizione}`,
      extra: this.puoVariare()
        ? [
            {
              etichetta: 'Varia i prezzi…',
              icona: 'pi pi-percentage',
              esegui: () => this.apriVariazione(a),
            },
          ]
        : [],
      attivo: a.attivo,
      cambiaStato: scrive ? () => this.cambiaStato(a) : undefined,
      elimina: scrive && a.eliminabile ? () => this.elimina(a) : undefined,
    })
  })
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
