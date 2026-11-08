import { CommonModule } from '@angular/common'
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core'
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
import { AzioneRiga, AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
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
import { LegamiService } from '../legami/legami.service'
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
    AzioniRigaComponent,
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
      <div class="barra-filtri">
        <span class="barra-filtri__ricerca">
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
              severity="secondary"
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
              severity="secondary"
              (onClick)="proroga()"
              data-testid="contratti-proroga"
            />
            <p-button
              label="Nuovo contratto"
              icon="pi pi-plus"
              styleClass="wf-primario"
              (onClick)="apriNuovo()"
              data-testid="contratti-nuovo"
            />
          </ng-container>
        </div>
      </div>
      <div class="barra-filtri" data-testid="contratti-filtri">
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
          class="filtro-cliente"
          prefisso="contratti-filtro-cliente"
          prefissoNuovo="contratti-filtro-cliente-nuovo"
          etichetta="Filtra per cliente"
          segnaposto="Tutti i clienti"
          [senzaEtichetta]="true"
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
      <!-- Legami con cliente ma senza contratto: non stanno in nessuna riga, quindi si dicono qui. -->
      <p
        *ngIf="senzaContratto() as s"
        class="senza-contratto"
        role="status"
        data-testid="contratti-senza-contratto"
      >
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
        {{ s.totale }}
        {{
          s.totale === 1
            ? 'movimento da collegare senza contratto'
            : 'movimenti da collegare senza contratto'
        }}
        <ng-container *ngIf="s.clienti > 1"> (in {{ s.clienti }} clienti)</ng-container>
        <a
          routerLink="/legami/da-collegare"
          [queryParams]="s.clienteId ? { clienteId: s.clienteId } : {}"
          data-testid="contratti-senza-contratto-link"
          >Vedi i movimenti</a
        >
      </p>
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
        class="tabella-fitta"
        [styleClass]="
          'p-datatable-sm lista-telefono' + (righe().length === 0 ? ' senza-righe' : '')
        "
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col" *ngIf="puoVariare()" class="m-hide">
              <input
                type="checkbox"
                [checked]="tuttiScelti()"
                [indeterminate]="alcuniScelti()"
                (change)="scegliPagina($any($event.target).checked)"
                aria-label="Scegli tutti i contratti della pagina"
                data-testid="contratti-scegli-pagina"
              />
            </th>
            <th scope="col">Numero</th>
            <th scope="col">Cliente</th>
            <th scope="col" *ngIf="colonne().has('descrizione')">Descrizione</th>
            <th scope="col" *ngIf="colonne().has('categoria')">Categoria</th>
            <th scope="col">Stato</th>
            <th scope="col">Inizio</th>
            <th scope="col" *ngIf="colonne().has('fine')">Fine</th>
            <th scope="col" *ngIf="colonne().has('prossima')">Prossima fatturazione</th>
            <th scope="col" *ngIf="colonne().has('daCollegare')">Da collegare</th>
            <th scope="col">Listino</th>
            <th scope="col" *ngIf="puoScrivere()" class="azioni-col">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [attr.data-testid]="'contratti-riga-' + c.id">
            <td *ngIf="puoVariare()" class="m-hide">
              <input
                type="checkbox"
                [checked]="scelti().has(c.id)"
                (change)="scegli(c.id, $any($event.target).checked)"
                [attr.aria-label]="'Scegli il contratto ' + c.numero"
                [attr.data-testid]="'contratti-scegli-' + c.id"
              />
            </td>
            <td class="cella-numero">{{ c.numero }}</td>
            <td class="cella-testo" [attr.title]="c.cliente.ragioneSociale">
              {{ c.cliente.ragioneSociale }}
            </td>
            <td
              *ngIf="colonne().has('descrizione')"
              class="cella-testo m-hide"
              [attr.title]="c.descrizione"
            >
              {{ c.descrizione }}
            </td>
            <td
              *ngIf="colonne().has('categoria')"
              class="cella-categoria m-hide"
              [attr.title]="c.categoria?.descrizione"
            >
              {{ c.categoria?.descrizione }}
            </td>
            <td class="cella-stato m2">
              <p-tag [value]="etichettaStato(c.stato)" [severity]="severita(c.stato)" />
            </td>
            <td class="m-hide">{{ c.dataInizio | date: 'dd/MM/yyyy' }}</td>
            <td *ngIf="colonne().has('fine')" class="m-hide cella-fine">
              {{ c.dataFine | date: 'dd/MM/yyyy' }}
              <p-tag
                *ngIf="c.scaduto"
                value="Scaduto"
                severity="danger"
                data-testid="contratti-scaduto"
              />
            </td>
            <td *ngIf="colonne().has('prossima')" class="m-hide">
              {{ c.prossimaFinePeriodo | date: 'dd/MM/yyyy' }}
            </td>
            <td *ngIf="colonne().has('daCollegare')" class="m-hide">
              <a
                *ngIf="daCollegarePer(c.id) as n"
                routerLink="/legami/da-collegare"
                [queryParams]="{ clienteId: c.cliente.id, contrattoId: c.id }"
                class="da-collegare"
                [attr.aria-label]="'Movimenti da collegare del contratto ' + c.numero + ': ' + n"
                [attr.data-testid]="'contratti-da-collegare-' + c.id"
              >
                <p-tag [value]="'' + n" severity="warning" />
              </a>
            </td>
            <td class="cella-listino m2">
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
            <td *ngIf="puoScrivere()" class="azioni-col">
              <app-azioni-riga
                [principale]="azioniDi(c).principale"
                [altre]="azioniDi(c).altre"
                [nome]="c.numero"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="numeroColonne()">Nessun contratto.</td>
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
        (applicata)="dopoVariazione()"
      />
      <app-istat-dialog
        *ngIf="puoVariare()"
        [visible]="istatAperto()"
        (visibleChange)="istatAperto.set($event)"
        (applicata)="dopoVariazione()"
      />
      <p-confirmDialog />
    </section>
  `,
  styles: [
    `
      .barra__azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin-left: auto;
      }
      /* Dodici colonne in 1150px: il respiro fra le celle scende da 12 a circa 6px. */
      .tabella-fitta {
        --spacing-md: 0.4rem;
      }
      .filtro-cliente {
        width: 16rem; /* il segnaposto «Tutti i clienti» sta intero */
      }
      .spunta {
        display: inline-flex;
        gap: 0.4rem;
        align-items: center;
        height: var(--control-md);
      }
      /* Cliente, descrizione e categoria su una riga sola: l'ellissi taglia, il title dice tutto. */
      .cella-testo,
      .cella-categoria {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 12rem;
      }
      .cella-categoria {
        max-width: 8rem;
      }
      .cella-numero,
      .cella-fine,
      .cella-stato,
      .cella-listino {
        white-space: nowrap;
      }
      /* Colonna delle azioni: larghezza fissa e sempre in vista. Se le colonne piene non stanno nella
         larghezza, scorre la tavola (il wrapper di p-table) e questa cella resta ferma a destra. */
      th.azioni-col,
      td.azioni-col {
        min-width: 7.5rem;
        width: 7.5rem;
        text-align: right;
        white-space: nowrap;
        position: sticky;
        right: 0;
        z-index: 1;
        background: var(--surface-ground);
        box-shadow: -1px 0 0 var(--rule);
      }
      .senza-contratto {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
        margin: 0 0 0.75rem;
      }
      /* Telefono: numero e cliente su due righe, stato e listino sulla terza. */
      @media (max-width: 640px) {
        th.azioni-col,
        td.azioni-col {
          position: static;
          box-shadow: none;
          background: none;
          width: auto;
          min-width: 0;
        }
        .filtro-cliente {
          width: 100%;
        }
        .cella-testo,
        .cella-numero {
          max-width: none;
        }
        .cella-numero {
          font-weight: 500;
        }
        .cella-stato {
          grid-column: 1 !important;
          grid-row: 3;
        }
        .cella-listino {
          grid-column: 2 !important;
          grid-row: 3;
          justify-self: end;
        }
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
  private readonly legami = inject(LegamiService)

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

  /** Colonne facoltative con almeno un dato nella pagina: le altre non si mostrano. */
  readonly colonne = computed(() =>
    colonneConDati<ContrattoCliente>(this.righe(), {
      descrizione: c => c.descrizione,
      categoria: c => c.categoria?.descrizione,
      fine: c => c.dataFine,
      prossima: c => c.prossimaFinePeriodo,
      daCollegare: c => this.daCollegarePer(c.id) || null,
    })
  )

  /** Intestazioni mostrate (per il colspan dello stato vuoto). */
  readonly numeroColonne = computed(
    () => 5 + (this.puoVariare() ? 1 : 0) + (this.puoScrivere() ? 1 : 0) + this.colonne().size
  )

  /** Azioni di ogni riga, calcolate una volta per pagina: il menu aperto non vede il modello cambiare. */
  private readonly azioniPerContratto = computed(
    () => new Map(this.righe().map(c => [c.id, this.costruisciAzioni(c)]))
  )

  azioniDi(c: ContrattoCliente): { principale: AzioneRiga; altre: AzioneRiga[] } {
    return this.azioniPerContratto().get(c.id) ?? this.costruisciAzioni(c)
  }

  /**
   * «Modifica» sulla riga; nel menu ⋯ le transizioni di stato della vista, «Rinnova» e, in fondo e
   * in rosso, «Annulla il contratto» ed «Elimina».
   */
  private costruisciAzioni(c: ContrattoCliente): { principale: AzioneRiga; altre: AzioneRiga[] } {
    const stati: AzioneRiga[] = c.transizioni.map(s => ({
      etichetta:
        s === 'ANNULLATO' ? `Annulla il contratto ${c.numero}` : this.etichettaAzione(c, s),
      pericolosa: s === 'ANNULLATO',
      esegui: () => this.cambiaStato(c, s),
    }))
    const altre: AzioneRiga[] = [
      ...stati.filter(a => !a.pericolosa),
      ...(c.rinnovabile ? [{ etichetta: 'Rinnova', esegui: () => this.rinnova(c) }] : []),
      ...stati.filter(a => a.pericolosa),
      ...(c.eliminabile
        ? [{ etichetta: 'Elimina', pericolosa: true, esegui: () => this.elimina(c) }]
        : []),
    ]
    return {
      principale: {
        etichetta: 'Modifica',
        icona: 'pi pi-pencil',
        esegui: () => this.apriModifica(c),
      },
      altre,
    }
  }

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
    this.caricaSenzaContratto()
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
    this.annullaDaCollegare.next()
    this.distrutto.next()
    this.elenco.ferma()
  }

  carica(): void {
    this.elenco.carica()
  }

  /** Movimenti da collegare per contratto della pagina visibile (id del contratto → numero). */
  private readonly perContratto = signal<ReadonlyMap<string, number>>(new Map())
  private readonly annullaDaCollegare = new Subject<void>()

  /** A ogni pagina caricata: una sola chiamata con gli id dei contratti visibili. */
  private readonly rileggiDaCollegare = effect(() => {
    const ids = this.righe().map(c => c.id)
    untracked(() => this.caricaDaCollegare(ids))
  })

  /** Conteggio esatto dal backend; se la chiamata fallisce la colonna resta vuota. */
  private caricaDaCollegare(ids: string[]): void {
    this.annullaDaCollegare.next()
    if (ids.length === 0) {
      this.perContratto.set(new Map())
      return
    }
    this.legami
      .contatoriPerContratto(ids)
      .pipe(takeUntil(this.annullaDaCollegare), takeUntil(this.distrutto))
      .subscribe({
        next: r =>
          this.perContratto.set(new Map(r.perContratto.map(x => [x.contrattoId, x.daCollegare]))),
        error: () => this.perContratto.set(new Map()),
      })
  }

  /**
   * Riepilogo dei legami con cliente e senza contratto: tutta l'azienda, oppure il solo cliente
   * scelto nel filtro (gli altri filtri non si applicano a legami che non hanno un contratto).
   * Una chiamata sola all'apertura. `clienteId` c'e' solo se il cliente e' uno, e il link filtra.
   */
  private readonly senzaContrattoPerCliente = signal<
    readonly { clienteId: string; daCollegare: number }[]
  >([])
  /** Il cliente scelto nel filtro della lista: il riepilogo lo segue. */
  private readonly clienteFiltroSegnale = signal<string | null>(null)

  readonly senzaContratto = computed(() => {
    const filtro = this.clienteFiltroSegnale()
    const voci = this.senzaContrattoPerCliente().filter(
      x => filtro === null || x.clienteId === filtro
    )
    const totale = voci.reduce((n, x) => n + x.daCollegare, 0)
    return totale === 0
      ? null
      : { totale, clienti: voci.length, clienteId: voci.length === 1 ? voci[0].clienteId : null }
  })

  private caricaSenzaContratto(): void {
    this.legami
      .contatoriPerContratto()
      .pipe(takeUntil(this.distrutto))
      .subscribe({
        next: r => this.senzaContrattoPerCliente.set(r.senzaContratto),
        error: () => this.senzaContrattoPerCliente.set([]),
      })
  }

  /** Movimenti da collegare del contratto, o 0. */
  daCollegarePer(contrattoId: string): number {
    return this.perContratto().get(contrattoId) ?? 0
  }

  cambiaPagina(ev: { first?: number | null; rows?: number | null }): void {
    this.elenco.cambiaPagina(ev)
  }

  /** Tutti i contratti della pagina visibile sono spuntati. */
  readonly tuttiScelti = computed(() => {
    const r = this.righe()
    return r.length > 0 && r.every(c => this.scelti().has(c.id))
  })

  /** Solo una parte della pagina è spuntata. */
  readonly alcuniScelti = computed(() => {
    const r = this.righe()
    const n = r.filter(c => this.scelti().has(c.id)).length
    return n > 0 && n < r.length
  })

  /** Spunta o toglie tutti i contratti della pagina, senza toccare quelli scelti in altre pagine. */
  scegliPagina(si: boolean): void {
    const n = new Set(this.scelti())
    for (const c of this.righe()) {
      if (si) n.add(c.id)
      else n.delete(c.id)
    }
    this.scelti.set(n)
  }

  /** A variazione applicata i prezzi sono cambiati: la scelta non vale più e la lista si ricarica. */
  dopoVariazione(): void {
    this.scelti.set(this.vuoto)
    this.carica()
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
    this.clienteFiltroSegnale.set(this.clienteFiltro)
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
