import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { Subject, takeUntil } from 'rxjs'
import { AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { ToastService } from '../../core/services/toast.service'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { etichettaIdentificativo } from '../registry/identificativo-fiscale'
import { ClienteDialogComponent } from './cliente-dialog.component'
import { Cliente } from './clienti.model'
import { ClientiService } from './clienti.service'
import { azioniDiRiga, MemoriaAzioni } from './tabelle/azioni-lista'
import { ElencoPaginato } from './tabelle/elenco-paginato'
import {
  chiediConferma,
  eseguiERicarica,
  messaggioErrore,
  permessoScrittura,
} from './tabelle/tabella-comune'

/**
 * Elenco dei clienti: ricerca con debounce, paginazione lazy, disattiva ed elimina. Da qui si
 * raggiungono gli agenti, le tabelle di fatturazione (D20) e l'archivio degli addebiti (D28).
 */
@Component({
  selector: 'app-clienti-list',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    TableModule,
    ClienteDialogComponent,
    AzioniRigaComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Clienti</h1>
      <div class="barra-filtri">
        <span class="barra-filtri__ricerca">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per nome, P. IVA o codice"
            aria-label="Cerca un cliente"
            (input)="elenco.cerca($any($event.target).value)"
            data-testid="clienti-cerca"
          />
        </span>
        <div class="barra-filtri__destra">
          <p-button
            label="Agenti"
            icon="pi pi-briefcase"
            [outlined]="true"
            (onClick)="vai('/clienti/agenti')"
            data-testid="clienti-agenti"
          />
          <p-button
            label="Tabelle di fatturazione"
            icon="pi pi-table"
            [outlined]="true"
            (onClick)="vai('/clienti/tabelle')"
            data-testid="clienti-tabelle"
          />
          <p-button
            label="Archivio addebiti"
            icon="pi pi-list"
            [outlined]="true"
            (onClick)="vai('/clienti/addebiti')"
            data-testid="clienti-addebiti"
          />
          <p-button
            *ngIf="puoScrivere()"
            label="Nuovo cliente"
            icon="pi pi-plus"
            styleClass="wf-primario"
            (onClick)="apriNuovo()"
            data-testid="clienti-nuovo"
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
            <th scope="col">Ragione sociale</th>
            <th scope="col" class="num-col">P.IVA / C.F.</th>
            <th scope="col" *ngIf="visibili().has('codice')">Codice</th>
            <th scope="col" *ngIf="visibili().has('codiceDestinatario')">Codice destinatario</th>
            <th scope="col" *ngIf="visibili().has('condizione')">Condizione di pagamento</th>
            <th scope="col" *ngIf="visibili().has('agente')">Agente</th>
            <th scope="col" class="num-col">Contratti</th>
            <th scope="col">Attivo</th>
            <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [attr.data-testid]="'clienti-riga-' + c.id">
            <td class="chi">
              {{ c.ditta.ragioneSociale }}
            </td>
            <td class="num-col m2 mono">
              {{ identificativo(c) }}<span class="solo-tel" *ngIf="!c.attivo"> · Disattivato</span>
            </td>
            <td class="m-hide" *ngIf="visibili().has('codice')">{{ c.codice }}</td>
            <td class="m-hide" *ngIf="visibili().has('codiceDestinatario')">
              {{ c.codiceDestinatario }}
            </td>
            <td class="m-hide" *ngIf="visibili().has('condizione')">
              {{ c.condizionePagamento?.descrizione }}
            </td>
            <td class="m-hide" *ngIf="visibili().has('agente')">{{ c.agente?.descrizione }}</td>
            <td class="num-col m-hide">{{ c.contratti }}</td>
            <td class="m-hide">{{ c.attivo ? 'Sì' : 'No' }}</td>
            <td class="azioni-col" *ngIf="puoScrivere()">
              <app-azioni-riga
                [attr.data-testid]="'clienti-modifica-' + c.id"
                [nome]="c.ditta.ragioneSociale"
                [principale]="azioni.di(c).principale"
                [altre]="azioni.di(c).altre"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="colonneTotali()">Nessun cliente.</td>
          </tr>
        </ng-template>
      </p-table>
      <app-cliente-dialog
        [visible]="dialogoAperto()"
        [cliente]="selezionato()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="dopoSalvataggio()"
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
      .mono {
        font-family: var(--font-family-mono);
      }
      /* Un nome lungo va a capo dentro la cella, non allarga la pagina. */
      .chi {
        overflow-wrap: anywhere;
      }
      .barra-filtri__destra {
        flex-wrap: wrap;
      }
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline;
        }
        td.num-col.m2 {
          text-align: left;
        }
      }
    `,
  ],
})
export class ClientiListComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly router = inject(Router)

  readonly puoScrivere = permessoScrittura()
  readonly elenco = new ElencoPaginato<Cliente>(
    filtro => this.servizio.clienti.list(filtro),
    'Impossibile caricare i clienti.'
  )
  readonly righe = this.elenco.righe
  readonly totale = this.elenco.totale
  readonly erroreElenco = this.elenco.errore
  /** Colonne facoltative con almeno un dato nella pagina: le altre non si disegnano. */
  readonly visibili = computed(() =>
    colonneConDati(this.righe(), {
      codice: c => c.codice,
      codiceDestinatario: c => c.codiceDestinatario,
      condizione: c => c.condizionePagamento?.descrizione,
      agente: c => c.agente?.descrizione,
    })
  )
  /** Colonne del p-table (per la riga dello stato vuoto). */
  readonly colonneTotali = computed(() => 4 + this.visibili().size + (this.puoScrivere() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<Cliente>(c =>
    azioniDiRiga({
      modifica: () => this.apriModifica(c),
      etichettaModifica: `Modifica il cliente ${c.ditta.ragioneSociale}`,
      attivo: c.attivo,
      cambiaStato: () => this.disattiva(c),
      elimina: c.eliminabile ? () => this.elimina(c) : undefined,
    })
  )
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<Cliente | null>(null)

  /** Ogni apertura annulla la lettura precedente. */
  private readonly annullaLettura = new Subject<void>()

  ngOnInit(): void {
    this.elenco.avvia()
  }

  ngOnDestroy(): void {
    this.annullaLettura.next()
    this.elenco.ferma()
  }

  carica(): void {
    this.elenco.carica()
  }

  cerca(valore: string): void {
    this.elenco.cerca(valore)
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.elenco.cambiaPagina(ev)
  }

  identificativo(c: Cliente): string {
    return etichettaIdentificativo(c.ditta.partitaIva, c.ditta.codiceFiscale)
  }

  vai(percorso: string): void {
    void this.router.navigateByUrl(percorso)
  }

  apriNuovo(): void {
    this.selezionato.set(null)
    this.dialogoAperto.set(true)
  }

  /** La riga dell'elenco può essere vecchia: si rilegge il cliente e si apre con la versione vera. */
  apriModifica(c: Cliente): void {
    this.annullaLettura.next()
    this.servizio.clienti
      .get(c.id)
      .pipe(takeUntil(this.annullaLettura))
      .subscribe({
        next: fresco => {
          this.selezionato.set(fresco)
          this.dialogoAperto.set(true)
        },
        error: err => {
          this.toast.error(messaggioErrore(err, 'Impossibile caricare il cliente.'))
          this.carica()
        },
      })
  }

  dopoSalvataggio(): void {
    this.carica()
  }

  /** Disattivare chiede conferma (i contratti lo citano); riattivare no. */
  disattiva(c: Cliente): void {
    if (!c.attivo) {
      this.cambiaStato(c)
      return
    }
    chiediConferma(
      this.conferma,
      `Disattivare il cliente "${c.ditta.ragioneSociale}"? Resta sui contratti che lo usano, ma non si sceglie per i contratti nuovi.`,
      () => this.cambiaStato(c),
      { header: 'Conferma disattivazione', acceptLabel: 'Disattiva' }
    )
  }

  cambiaStato(c: Cliente): void {
    eseguiERicarica(
      this.servizio.clienti.modifica(c.id, { attivo: !c.attivo, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(c: Cliente): void {
    chiediConferma(
      this.conferma,
      `Eliminare il cliente ${c.ditta.ragioneSociale}? La ditta e le sedi restano.`,
      () => this.eliminaConfermato(c)
    )
  }

  eliminaConfermato(c: Cliente): void {
    eseguiERicarica(
      this.servizio.clienti.elimina(c.id, c.versione),
      this.toast,
      'Impossibile eliminare il cliente.',
      () => this.carica()
    )
  }
}
