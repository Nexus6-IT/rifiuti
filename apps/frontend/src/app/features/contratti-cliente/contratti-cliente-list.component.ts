import { CommonModule } from '@angular/common'
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { ConfirmationService, MenuItem } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { MenuModule } from 'primeng/menu'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { Subject, takeUntil } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import {
  Cliente,
  ContrattoCliente,
  FiltroContratti,
  StatoContrattoCliente,
} from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { ElencoPaginato } from '../clienti/tabelle/elenco-paginato'
import {
  chiediConferma,
  eseguiERicarica,
  messaggioErrore,
  permessoScrittura,
} from '../clienti/tabelle/tabella-comune'
import { OPZIONI_STATO_CONTRATTO } from '../clienti/vocabolario-clienti'
import { IstatDialogComponent } from '../listino/istat-dialog.component'
import { puoVariarePrezzi } from '../listino/permessi-listino'
import { VariazionePrezziDialogComponent } from '../listino/variazione-prezzi-dialog.component'
import { AnnulloDialogComponent } from './annullo-dialog.component'
import { ContrattoClienteDialogComponent } from './contratto-cliente-dialog.component'
import { ProrogaDialogComponent } from './proroga-dialog.component'
import { SceltaClienteComponent } from './scelta-cliente.component'

type FiltriContratti = Omit<FiltroContratti, 'pagina' | 'dimensione' | 'testo'>

const GIORNI_IN_SCADENZA = 30

const SEVERITA_STATO: Readonly<
  Record<StatoContrattoCliente, 'success' | 'info' | 'warning' | 'danger' | 'secondary'>
> = {
  BOZZA: 'secondary',
  ATTIVO: 'success',
  SOSPESO: 'warning',
  SOSPESO_MOVIMENTI: 'info',
  ANNULLATO: 'danger',
}

/**
 * Elenco dei contratti dei clienti (D20): filtri, azioni di stato dalle `transizioni` della vista
 * (il frontend non ripete D8), annullo con motivo, rinnovo, eliminazione, proroga massiva delle
 * scadenze e dialog del contratto. Chi non scrive (VIEWER) vede solo l'elenco.
 */
@Component({
  selector: 'app-contratti-cliente-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    CheckboxModule,
    ConfirmDialogModule,
    DropdownModule,
    InputTextModule,
    MenuModule,
    TableModule,
    TagModule,
    AnnulloDialogComponent,
    ContrattoClienteDialogComponent,
    ProrogaDialogComponent,
    SceltaClienteComponent,
    VariazionePrezziDialogComponent,
    IstatDialogComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <section class="pagina">
      <h1>Contratti clienti</h1>
      <div class="barra">
        <span class="p-input-icon-left">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            pInputText
            type="search"
            placeholder="Cerca per numero, descrizione o cliente"
            aria-label="Cerca un contratto"
            (input)="elenco.cerca($any($event.target).value)"
            data-testid="contratti-cerca"
          />
        </span>
        <div class="barra__azioni" *ngIf="puoVariare() || puoScrivere()">
          <ng-container *ngIf="puoVariare()">
            <span *ngIf="scelti().size > 0" data-testid="contratti-scelti">
              {{ scelti().size }}
              {{ scelti().size === 1 ? 'contratto scelto' : 'contratti scelti' }}
              <p-button
                label="Deseleziona"
                [text]="true"
                size="small"
                (onClick)="scelti.set(vuoto)"
                data-testid="contratti-deseleziona"
              />
            </span>
            <p-button
              label="Variazioni prezzi"
              icon="pi pi-percentage"
              [outlined]="true"
              (onClick)="menuVariazioni.toggle($event)"
              aria-haspopup="true"
              data-testid="contratti-variazioni"
            />
            <p-menu #menuVariazioni [model]="voci" [popup]="true" appendTo="body" />
          </ng-container>
          <ng-container *ngIf="puoScrivere()">
            <p-button
              label="Proroga scadenze"
              icon="pi pi-calendar-plus"
              [outlined]="true"
              (onClick)="proroga()"
              data-testid="contratti-proroga"
            />
            <p-button
              label="Nuovo contratto"
              icon="pi pi-plus"
              (onClick)="apriNuovo()"
              data-testid="contratti-nuovo"
            />
          </ng-container>
        </div>
      </div>
      <div class="filtri">
        <p-dropdown
          [options]="opzioniStato"
          [ngModel]="statoFiltro"
          (onChange)="filtraStato($event.value)"
          placeholder="Tutti gli stati"
          [showClear]="true"
          ariaLabel="Filtra per stato"
          data-testid="contratti-filtro-stato"
        />
        <app-scelta-cliente
          prefisso="contratti-filtro-cliente"
          prefissoNuovo="contratti-filtro-cliente-nuovo"
          etichetta="Cliente"
          (scelto)="filtraCliente($event)"
        />
        <p-dropdown
          [options]="categorie()"
          optionLabel="etichetta"
          optionValue="id"
          [ngModel]="categoriaFiltro"
          (onChange)="filtraCategoria($event.value)"
          placeholder="Tutte le categorie"
          [showClear]="true"
          ariaLabel="Filtra per categoria"
          data-testid="contratti-filtro-categoria"
        />
        <p-dropdown
          [options]="tipi()"
          optionLabel="etichetta"
          optionValue="id"
          [ngModel]="tipoFiltro"
          (onChange)="filtraTipo($event.value)"
          placeholder="Tutti i tipi"
          [showClear]="true"
          ariaLabel="Filtra per tipo"
          data-testid="contratti-filtro-tipo"
        />
        <span class="spunta">
          <p-checkbox
            inputId="contratti-scadenza"
            [binary]="true"
            [ngModel]="inScadenza"
            (onChange)="filtraInScadenza($event.checked)"
            data-testid="contratti-filtro-scadenza"
          />
          <label for="contratti-scadenza">In scadenza entro 30 giorni</label>
        </span>
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
            <th scope="col" *ngIf="puoVariare()">Scelta</th>
            <th scope="col">Numero</th>
            <th scope="col">Cliente</th>
            <th scope="col">Descrizione</th>
            <th scope="col">Categoria</th>
            <th scope="col">Stato</th>
            <th scope="col">Inizio</th>
            <th scope="col">Fine</th>
            <th scope="col">Prossima fatturazione</th>
            <th scope="col">Listino</th>
            <th scope="col" *ngIf="puoScrivere()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [attr.data-testid]="'contratti-riga-' + c.id">
            <td *ngIf="puoVariare()">
              <input
                type="checkbox"
                [checked]="scelti().has(c.id)"
                (change)="scegli(c.id, $any($event.target).checked)"
                [attr.aria-label]="'Scegli il contratto ' + c.numero"
                [attr.data-testid]="'contratti-scegli-' + c.id"
              />
            </td>
            <td>{{ c.numero }}</td>
            <td>{{ c.cliente.ragioneSociale }}</td>
            <td>{{ c.descrizione }}</td>
            <td>{{ c.categoria?.descrizione }}</td>
            <td>
              <p-tag [value]="etichettaStato(c.stato)" [severity]="severita(c.stato)" />
            </td>
            <td>{{ c.dataInizio | date: 'dd/MM/yyyy' }}</td>
            <td>
              {{ c.dataFine | date: 'dd/MM/yyyy' }}
              <p-tag
                *ngIf="c.scaduto"
                value="Scaduto"
                severity="danger"
                data-testid="contratti-scaduto"
              />
            </td>
            <td>{{ c.prossimaFinePeriodo | date: 'dd/MM/yyyy' }}</td>
            <td class="azioni">
              <!-- Fuori dalla colonna di scrittura: il VIEWER legge il listino (R48). -->
              <a
                [routerLink]="['/contratti-clienti', c.id, 'listino']"
                class="p-button p-button-text p-button-sm"
                [attr.aria-label]="'Listino del contratto ' + c.numero"
                [attr.data-testid]="'contratti-listino-' + c.id"
              >
                <i class="pi pi-list" aria-hidden="true"></i>&nbsp;Listino
              </a>
            </td>
            <td *ngIf="puoScrivere()" class="azioni">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                [ariaLabel]="'Modifica il contratto ' + c.numero"
                (onClick)="apriModifica(c)"
                [attr.data-testid]="'contratti-modifica-' + c.id"
              />
              <p-button
                *ngFor="let s of c.transizioni"
                [label]="etichettaAzione(c, s)"
                [text]="true"
                size="small"
                [severity]="s === 'ANNULLATO' ? 'danger' : 'secondary'"
                [ariaLabel]="etichettaAzione(c, s) + ' il contratto ' + c.numero"
                (onClick)="cambiaStato(c, s)"
                [attr.data-testid]="'contratti-stato-' + c.id + '-' + s"
              />
              <p-button
                *ngIf="c.rinnovabile"
                label="Rinnova"
                icon="pi pi-refresh"
                [text]="true"
                size="small"
                [ariaLabel]="'Rinnova il contratto ' + c.numero"
                (onClick)="rinnova(c)"
                [attr.data-testid]="'contratti-rinnova-' + c.id"
              />
              <p-button
                *ngIf="c.eliminabile"
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                size="small"
                [ariaLabel]="'Elimina il contratto ' + c.numero"
                (onClick)="elimina(c)"
                [attr.data-testid]="'contratti-elimina-' + c.id"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="9 + (puoScrivere() ? 1 : 0) + (puoVariare() ? 1 : 0)">
              Nessun contratto.
            </td>
          </tr>
        </ng-template>
      </p-table>
      <app-contratto-cliente-dialog
        [visible]="dialogoAperto()"
        [contratto]="selezionato()"
        (visibleChange)="dialogoAperto.set($event)"
        (salvato)="carica()"
      />
      <app-annullo-dialog
        [visible]="annulloAperto()"
        [contratto]="daAnnullare()"
        (visibleChange)="annulloAperto.set($event)"
        (annullato)="dopoAnnullo()"
        (fallito)="dopoAnnulloFallito($event)"
      />
      <app-proroga-dialog
        [visible]="prorogaAperta()"
        (visibleChange)="prorogaAperta.set($event)"
        (prorogato)="carica()"
      />
      <app-variazione-prezzi-dialog
        *ngIf="puoVariare()"
        [visible]="variazioneAperta()"
        [contrattiIds]="idsScelti()"
        (visibleChange)="variazioneAperta.set($event)"
        (applicata)="carica()"
      />
      <app-istat-dialog
        *ngIf="puoVariare()"
        [visible]="istatAperto()"
        (visibleChange)="istatAperto.set($event)"
        (applicata)="carica()"
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
      .barra__azioni,
      .filtri {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .filtri {
        margin-bottom: 0.5rem;
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
      }
      .azioni {
        white-space: nowrap;
      }
    `,
  ],
})
export class ContrattiClienteListComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly auth = inject(AuthService)

  readonly puoScrivere = permessoScrittura()
  /** Le variazioni di massa toccano molti contratti: solo ADMIN (R11). */
  readonly puoVariare = () => puoVariarePrezzi(this.auth.currentUser()?.role)

  /** Contratti spuntati nella lista (anche fra più pagine): filtro "contratti scelti" (R51). */
  readonly vuoto: ReadonlySet<string> = new Set<string>()
  readonly scelti = signal<ReadonlySet<string>>(this.vuoto)
  readonly idsScelti = computed(() => [...this.scelti()])
  readonly variazioneAperta = signal(false)
  readonly istatAperto = signal(false)
  readonly voci: MenuItem[] = [
    {
      label: 'Modifica automatica dei prezzi',
      icon: 'pi pi-percentage',
      command: () => this.variazioneAperta.set(true),
    },
    {
      label: 'Adeguamento ISTAT',
      icon: 'pi pi-chart-line',
      command: () => this.istatAperto.set(true),
    },
  ]
  readonly elenco = new ElencoPaginato<ContrattoCliente, FiltriContratti>(
    filtro => this.servizio.contratti.list(filtro),
    'Impossibile caricare i contratti.'
  )
  readonly righe = this.elenco.righe
  readonly totale = this.elenco.totale
  readonly erroreElenco = this.elenco.errore

  readonly opzioniStato = OPZIONI_STATO_CONTRATTO
  readonly categorie = signal<Opzione[]>([])
  readonly tipi = signal<Opzione[]>([])

  statoFiltro: StatoContrattoCliente | null = null
  categoriaFiltro: string | null = null
  tipoFiltro: string | null = null
  inScadenza = false
  private clienteFiltro: string | null = null

  readonly dialogoAperto = signal(false)
  readonly selezionato = signal<ContrattoCliente | null>(null)
  readonly annulloAperto = signal(false)
  readonly daAnnullare = signal<ContrattoCliente | null>(null)
  readonly prorogaAperta = signal(false)

  /** Ogni apertura annulla la lettura precedente. */
  private readonly annullaLettura = new Subject<void>()
  private readonly distrutto = new Subject<void>()

  ngOnInit(): void {
    this.elenco.avvia()
    this.tabelle.codifiche
      .list('CATEGORIA')
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: l => this.categorie.set(l.map(c => ({ id: c.id, etichetta: c.descrizione }))),
        error: () => this.categorie.set([]),
      })
    this.tabelle.codifiche
      .list('TIPO')
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: l => this.tipi.set(l.map(c => ({ id: c.id, etichetta: c.descrizione }))),
        error: () => this.tipi.set([]),
      })
  }

  ngOnDestroy(): void {
    this.annullaLettura.next()
    this.distrutto.next()
    this.elenco.ferma()
  }

  carica(): void {
    this.elenco.carica()
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.elenco.cambiaPagina(ev)
  }

  scegli(id: string, si: boolean): void {
    const n = new Set(this.scelti())
    if (si) n.add(id)
    else n.delete(id)
    this.scelti.set(n)
  }

  // --- filtri -------------------------------------------------------------------------------

  filtraStato(stato: StatoContrattoCliente | null): void {
    this.statoFiltro = stato
    this.applicaFiltri()
  }

  filtraCliente(cliente: Cliente | null): void {
    this.clienteFiltro = cliente?.id ?? null
    this.applicaFiltri()
  }

  filtraCategoria(id: string | null): void {
    this.categoriaFiltro = id
    this.applicaFiltri()
  }

  filtraTipo(id: string | null): void {
    this.tipoFiltro = id
    this.applicaFiltri()
  }

  filtraInScadenza(attivo: boolean): void {
    this.inScadenza = attivo
    this.applicaFiltri()
  }

  private applicaFiltri(): void {
    this.elenco.impostaFiltri({
      stato: this.statoFiltro ?? undefined,
      clienteId: this.clienteFiltro ?? undefined,
      categoriaId: this.categoriaFiltro ?? undefined,
      tipoId: this.tipoFiltro ?? undefined,
      inScadenzaEntroGiorni: this.inScadenza ? GIORNI_IN_SCADENZA : undefined,
    })
  }

  // --- presentazione ------------------------------------------------------------------------

  etichettaStato(stato: StatoContrattoCliente): string {
    return this.opzioniStato.find(o => o.value === stato)?.label ?? stato
  }

  severita(stato: StatoContrattoCliente): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    return SEVERITA_STATO[stato]
  }

  /** Verbo dell'azione che porta il contratto in `verso`; "Riattiva" se non è una bozza. */
  etichettaAzione(c: ContrattoCliente, verso: StatoContrattoCliente): string {
    switch (verso) {
      case 'ATTIVO':
        return c.stato === 'BOZZA' ? 'Attiva' : 'Riattiva'
      case 'SOSPESO':
        return 'Sospendi'
      case 'SOSPESO_MOVIMENTI':
        return 'Sospendi solo movimenti'
      case 'ANNULLATO':
        return 'Annulla'
      case 'BOZZA':
        return 'Riporta in bozza'
    }
  }

  /** `YYYY-MM-DD` più un anno; il 29 febbraio diventa 28 febbraio (D11). */
  static finePiuUnAnno(data: string): string {
    const [anno, mese, giorno] = data.split('-')
    const nuovoGiorno = mese === '02' && giorno === '29' ? '28' : giorno
    return `${Number(anno) + 1}-${mese}-${nuovoGiorno}`
  }

  private static italiana(data: string): string {
    const [anno, mese, giorno] = data.split('-')
    return `${giorno}/${mese}/${anno}`
  }

  // --- dialog -------------------------------------------------------------------------------

  apriNuovo(): void {
    this.selezionato.set(null)
    this.dialogoAperto.set(true)
  }

  /** La riga dell'elenco può essere vecchia: si rilegge il contratto e si apre con la versione vera. */
  apriModifica(c: ContrattoCliente): void {
    this.annullaLettura.next()
    this.servizio.contratti
      .get(c.id)
      .pipe(takeUntil(this.annullaLettura))
      .subscribe({
        next: fresco => {
          this.selezionato.set(fresco)
          this.dialogoAperto.set(true)
        },
        error: err => {
          this.toast.error(messaggioErrore(err, 'Impossibile caricare il contratto.'))
          this.carica()
        },
      })
  }

  proroga(): void {
    this.prorogaAperta.set(true)
  }

  // --- stato, rinnovo, eliminazione ---------------------------------------------------------

  cambiaStato(c: ContrattoCliente, verso: StatoContrattoCliente): void {
    if (verso === 'ANNULLATO') {
      this.daAnnullare.set(c)
      this.annulloAperto.set(true)
      return
    }
    eseguiERicarica(
      this.servizio.contratti.cambiaStato(c.id, { stato: verso, versione: c.versione }),
      this.toast,
      'Impossibile cambiare lo stato del contratto.',
      () => this.carica()
    )
  }

  dopoAnnullo(): void {
    this.annulloAperto.set(false)
    this.carica()
  }

  dopoAnnulloFallito(messaggio: string): void {
    this.annulloAperto.set(false)
    this.toast.error(messaggio)
    this.carica()
  }

  rinnova(c: ContrattoCliente): void {
    const fine = c.dataFine
    const nuova = fine ? ContrattiClienteListComponent.finePiuUnAnno(fine) : null
    const testo =
      fine && nuova
        ? `Rinnovare il contratto ${c.numero}? La data di fine passa dal ${ContrattiClienteListComponent.italiana(fine)} al ${ContrattiClienteListComponent.italiana(nuova)}.`
        : `Rinnovare il contratto ${c.numero}?`
    chiediConferma(this.conferma, testo, () => this.rinnovaConfermato(c), {
      header: 'Conferma rinnovo',
      acceptLabel: 'Rinnova',
    })
  }

  rinnovaConfermato(c: ContrattoCliente): void {
    eseguiERicarica(
      this.servizio.contratti.rinnova(c.id, c.versione),
      this.toast,
      'Impossibile rinnovare il contratto.',
      () => this.carica()
    )
  }

  elimina(c: ContrattoCliente): void {
    chiediConferma(this.conferma, `Eliminare il contratto ${c.numero}?`, () =>
      this.eliminaConfermato(c)
    )
  }

  eliminaConfermato(c: ContrattoCliente): void {
    eseguiERicarica(
      this.servizio.contratti.elimina(c.id, c.versione),
      this.toast,
      'Impossibile eliminare il contratto.',
      () => this.carica()
    )
  }
}
