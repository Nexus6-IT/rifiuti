import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core'
import { Router } from '@angular/router'
import { ConfirmationService } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { Subject, takeUntil } from 'rxjs'
import { ToastService } from '../../core/services/toast.service'
import { etichettaIdentificativo } from '../registry/identificativo-fiscale'
import { ClienteDialogComponent } from './cliente-dialog.component'
import { Cliente } from './clienti.model'
import { ClientiService } from './clienti.service'
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
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Clienti</h1>
      <div class="barra">
        <span class="p-input-icon-left">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per ragione sociale, partita IVA o codice"
            aria-label="Cerca un cliente"
            (input)="elenco.cerca($any($event.target).value)"
            data-testid="clienti-cerca"
          />
        </span>
        <div class="barra__azioni">
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
            <th scope="col">Ragione sociale</th>
            <th scope="col">P.IVA / C.F.</th>
            <th scope="col">Codice</th>
            <th scope="col">Codice destinatario</th>
            <th scope="col">Condizione di pagamento</th>
            <th scope="col">Agente</th>
            <th scope="col">Contratti</th>
            <th scope="col">Attivo</th>
            <th scope="col" *ngIf="puoScrivere()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [attr.data-testid]="'clienti-riga-' + c.id">
            <td>{{ c.ditta.ragioneSociale }}</td>
            <td>{{ identificativo(c) }}</td>
            <td>{{ c.codice }}</td>
            <td>{{ c.codiceDestinatario }}</td>
            <td>{{ c.condizionePagamento?.descrizione }}</td>
            <td>{{ c.agente?.descrizione }}</td>
            <td>{{ c.contratti }}</td>
            <td>{{ c.attivo ? 'Sì' : 'No' }}</td>
            <td *ngIf="puoScrivere()">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                [ariaLabel]="'Modifica il cliente ' + c.ditta.ragioneSociale"
                (onClick)="apriModifica(c)"
                [attr.data-testid]="'clienti-modifica-' + c.id"
              />
              <p-button
                [label]="c.attivo ? 'Disattiva' : 'Riattiva'"
                [icon]="c.attivo ? 'pi pi-ban' : 'pi pi-replay'"
                [text]="true"
                size="small"
                [ariaLabel]="
                  (c.attivo ? 'Disattiva' : 'Riattiva') + ' il cliente ' + c.ditta.ragioneSociale
                "
                (onClick)="disattiva(c)"
                [attr.data-testid]="'clienti-attiva-' + c.id"
              />
              <p-button
                *ngIf="c.eliminabile"
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                size="small"
                [ariaLabel]="'Elimina il cliente ' + c.ditta.ragioneSociale"
                (onClick)="elimina(c)"
                [attr.data-testid]="'clienti-elimina-' + c.id"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="puoScrivere() ? 9 : 8">Nessun cliente.</td>
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
      .pagina {
        padding: 1rem;
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
        gap: 0.5rem;
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
