import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { Subject, debounceTime, takeUntil } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { etichettaIdentificativo } from '../registry/identificativo-fiscale'
import { AgenteDialogComponent } from './agente-dialog.component'
import { Agente } from './clienti.model'
import { ClientiService } from './clienti.service'
import {
  caricaPagina,
  chiediConferma,
  eseguiERicarica,
  permessoScrittura,
} from './tabelle/tabella-comune'

const DIMENSIONE_PREDEFINITA = 25

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
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Agenti</h1>
      <div class="barra">
        <span class="p-input-icon-left">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per ragione sociale, partita IVA o codice"
            aria-label="Cerca un agente"
            (input)="cerca($any($event.target).value)"
            data-testid="agenti-cerca"
          />
        </span>
        <p-button
          *ngIf="puoScrivere()"
          label="Nuovo agente"
          icon="pi pi-plus"
          (onClick)="apri(null)"
          data-testid="agenti-nuovo"
        />
      </div>
      <p *ngIf="erroreElenco() as e" role="alert" class="field-error">{{ e }}</p>
      <p-table
        [value]="righe()"
        [lazy]="true"
        [lazyLoadOnInit]="false"
        [paginator]="true"
        [rows]="dimensione"
        [first]="primo"
        [totalRecords]="totale()"
        [rowsPerPageOptions]="[10, 25, 50]"
        (onLazyLoad)="cambiaPagina($event)"
        currentPageReportTemplate="{first}-{last} di {totalRecords}"
        [showCurrentPageReport]="totale() > 0"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Ragione sociale</th>
            <th scope="col">P.IVA / C.F.</th>
            <th scope="col">Codice</th>
            <th scope="col">Clienti</th>
            <th scope="col">Contratti</th>
            <th scope="col">Attivo</th>
            <th scope="col" *ngIf="puoScrivere()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-a>
          <tr [attr.data-testid]="'agenti-riga-' + a.id">
            <td>{{ a.ditta.ragioneSociale }}</td>
            <td>{{ identificativo(a) }}</td>
            <td>{{ a.codice }}</td>
            <td>{{ a.clienti }}</td>
            <td>{{ a.contratti }}</td>
            <td>{{ a.attivo ? 'Sì' : 'No' }}</td>
            <td *ngIf="puoScrivere()">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="apri(a)"
                [attr.data-testid]="'agenti-modifica-' + a.id"
              />
              <p-button
                [label]="a.attivo ? 'Disattiva' : 'Riattiva'"
                [icon]="a.attivo ? 'pi pi-ban' : 'pi pi-replay'"
                [text]="true"
                size="small"
                (onClick)="disattiva(a)"
                [attr.data-testid]="'agenti-attiva-' + a.id"
              />
              <p-button
                *ngIf="a.eliminabile"
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                size="small"
                (onClick)="elimina(a)"
                [attr.data-testid]="'agenti-elimina-' + a.id"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="puoScrivere() ? 7 : 6">Nessun agente.</td>
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
      .pagina {
        padding: 1rem;
      }
      .barra {
        display: flex;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
    `,
  ],
})
export class AgentiListComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly puoScrivere = permessoScrittura()
  readonly righe = signal<Agente[]>([])
  readonly totale = signal(0)
  readonly erroreElenco = signal<string | null>(null)
  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<Agente | null>(null)

  dimensione = DIMENSIONE_PREDEFINITA
  primo = 0
  private testo = ''
  private readonly ricerca = new Subject<string>()
  /** Ogni nuovo caricamento annulla il precedente: una risposta in ritardo non vale più. */
  private readonly annulla = new Subject<void>()
  private readonly distrutto = new Subject<void>()

  ngOnInit(): void {
    this.ricerca.pipe(debounceTime(300), takeUntil(this.distrutto)).subscribe(t => {
      this.testo = t.trim()
      this.primo = 0
      this.carica()
    })
    this.carica()
  }

  ngOnDestroy(): void {
    this.annulla.next()
    this.distrutto.next()
  }

  cerca(valore: string): void {
    this.ricerca.next(valore)
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.dimensione = ev.rows || this.dimensione
    this.primo = ev.first ?? 0
    this.carica()
  }

  carica(): void {
    this.annulla.next()
    caricaPagina(
      this.servizio.agenti
        .list({
          pagina: Math.floor(this.primo / this.dimensione) + 1,
          dimensione: this.dimensione,
          ...(this.testo ? { testo: this.testo } : {}),
        })
        .pipe(takeUntil(this.annulla)),
      this.righe,
      this.totale,
      this.erroreElenco,
      'Impossibile caricare gli agenti.'
    )
  }

  identificativo(a: Agente): string {
    return etichettaIdentificativo(a.ditta.partitaIva, a.ditta.codiceFiscale)
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
