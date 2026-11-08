import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'

import { ToastService } from '../../core/services/toast.service'
import { AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import { separaIdentificativo } from '../registry/identificativo-fiscale'
import { AgenteDialogComponent } from './agente-dialog.component'
import { Agente } from './clienti.model'
import { ClientiService } from './clienti.service'
import { azioniDiRiga, MemoriaAzioni } from './tabelle/azioni-lista'
import { ElencoPaginato } from './tabelle/elenco-paginato'
import { chiediConferma, eseguiERicarica, permessoScrittura } from './tabelle/tabella-comune'

/** Elenco degli agenti: ricerca con debounce, paginazione lazy, disattiva ed elimina. */
@Component({
  selector: 'app-agenti-list',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    ConfirmDialogModule,
    InputTextModule,
    TableModule,
    AgenteDialogComponent,
    AzioniRigaComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Agenti</h1>
      <div class="barra-filtri">
        <span class="barra-filtri__ricerca">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per nome, P. IVA o codice"
            aria-label="Cerca un agente"
            (input)="elenco.cerca($any($event.target).value)"
            data-testid="agenti-cerca"
          />
        </span>
        <div class="barra-filtri__destra">
          <p-button
            *ngIf="puoScrivere()"
            label="Nuovo agente"
            icon="pi pi-plus"
            styleClass="wf-primario"
            (onClick)="apri(null)"
            data-testid="agenti-nuovo"
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
        styleClass="p-datatable-sm lista-telefono"
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Ragione sociale</th>
            <th scope="col" class="num-col">P.IVA / C.F.</th>
            <th scope="col" *ngIf="visibili().has('codice')">Codice</th>
            <th scope="col" class="num-col">Clienti</th>
            <th scope="col" class="num-col">Contratti</th>
            <th scope="col">Attivo</th>
            <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr [attr.data-testid]="'agenti-riga-' + a.id">
            <td class="chi">{{ a.ditta.ragioneSociale }}</td>
            <td class="num-col m2">
              {{ idDi(a).prefisso }} <span class="mono">{{ idDi(a).numero || '—' }}</span
              ><span class="solo-tel" *ngIf="!a.attivo"> · Disattivato</span>
            </td>
            <td class="m-hide" *ngIf="visibili().has('codice')">{{ a.codice }}</td>
            <td class="num-col m-hide">{{ a.clienti }}</td>
            <td class="num-col m-hide">{{ a.contratti }}</td>
            <td class="m-hide">{{ a.attivo ? 'Sì' : 'No' }}</td>
            <td class="azioni-col" *ngIf="puoScrivere()">
              <app-azioni-riga
                [attr.data-testid]="'agenti-modifica-' + a.id"
                [nome]="a.ditta.ragioneSociale"
                [principale]="azioni.di(a).principale"
                [altre]="azioni.di(a).altre"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="colonneTotali()">Nessun agente.</td>
          </tr>
        </ng-template>
      </p-table>
      <app-agente-dialog
        [visible]="dialogoAperto()"
        [agente]="selezionato()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="carica()"
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
export class AgentiListComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly elenco = new ElencoPaginato<Agente>(
    filtro => this.servizio.agenti.list(filtro),
    'Impossibile caricare gli agenti.'
  )
  readonly righe = this.elenco.righe
  readonly totale = this.elenco.totale
  readonly erroreElenco = this.elenco.errore
  /** Colonne facoltative con almeno un dato nella pagina: le altre non si disegnano. */
  readonly visibili = computed(() => colonneConDati(this.righe(), { codice: a => a.codice }))
  /** Colonne del p-table (per la riga dello stato vuoto). */
  readonly colonneTotali = computed(() => 5 + this.visibili().size + (this.puoScrivere() ? 1 : 0))
  readonly azioni = new MemoriaAzioni<Agente>(a =>
    azioniDiRiga({
      modifica: () => this.apri(a),
      etichettaModifica: `Modifica l'agente ${a.ditta.ragioneSociale}`,
      attivo: a.attivo,
      cambiaStato: () => this.disattiva(a),
      elimina: a.eliminabile ? () => this.elimina(a) : undefined,
    })
  )
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<Agente | null>(null)

  ngOnInit(): void {
    this.elenco.avvia()
  }

  ngOnDestroy(): void {
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

  /** «P.IVA» o «C.F.» in caratteri normali e il numero (l'unica parte in mono). */
  idDi(x: Agente): { prefisso: string; numero: string } {
    return separaIdentificativo(x.ditta.partitaIva, x.ditta.codiceFiscale)
  }

  apri(a: Agente | null): void {
    this.selezionato.set(a)
    this.dialogoAperto.set(true)
  }

  /** Disattivare chiede conferma (i clienti e i contratti lo citano); riattivare no. */
  disattiva(a: Agente): void {
    if (!a.attivo) {
      this.cambiaStato(a)
      return
    }
    chiediConferma(
      this.conferma,
      `Disattivare l'agente "${a.ditta.ragioneSociale}"? Resta sui clienti e sui contratti che lo usano.`,
      () => this.cambiaStato(a),
      { header: 'Conferma disattivazione', acceptLabel: 'Disattiva' }
    )
  }

  cambiaStato(a: Agente): void {
    eseguiERicarica(
      this.servizio.agenti.modifica(a.id, { attivo: !a.attivo, versione: a.versione }),
      this.toast,
      'Impossibile cambiare lo stato.',
      () => this.carica()
    )
  }

  elimina(a: Agente): void {
    chiediConferma(this.conferma, `Eliminare l'agente "${a.ditta.ragioneSociale}"?`, () =>
      this.eliminaConfermato(a)
    )
  }

  eliminaConfermato(a: Agente): void {
    eseguiERicarica(
      this.servizio.agenti.elimina(a.id, a.versione),
      this.toast,
      "Impossibile eliminare l'agente.",
      () => this.carica()
    )
  }
}
