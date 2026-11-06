import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core'
import { RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { MenuModule } from 'primeng/menu'
import { MenuItem, MessageService } from 'primeng/api'
import { AuthService } from '../../../core/services/auth.service'
import { DashboardData, DashboardService } from '../../../core/services/dashboard.service'
import { FeatureFlagsService } from '../../../core/services/feature-flags.service'
import { FIR, FIRStato } from '../../../shared/models/fir.model'
import { contaPerStatoFir } from '../../../shared/models/stati-fir'
import { puoCreareFir } from '../../fir/fir-permissions'
import { FirService } from '../../fir/fir.service'
import { DepositoTemporaneoVista, GiacenzeService } from '../../giacenze/giacenze.service'
import { AndamentoMensileVoce, AndamentoService } from '../andamento.service'
import { AttenzioneService, VoceAttenzione } from '../attenzione.service'
import { AnalisiSintesiComponent } from './analisi-sintesi.component'
import { BarreMensiliComponent } from './barre-mensili.component'
import { BarreOrizzontaliComponent, VoceBarra } from './barre-orizzontali.component'
import { ClassificaDitteComponent } from './classifica-ditte.component'
import {
  celleAnalisi,
  intervalloMeseCorrente,
  livelloConformita,
  rispostaDelGiorno,
  unisciVoci,
  vociClassifica,
  vociDaDeposito,
} from './dashboard-dati'
import { DaFareOggiComponent } from './da-fare-oggi.component'
import { DepositoSintesiComponent } from './deposito-sintesi.component'
import { FirMeseStatiComponent } from './fir-mese-stati.component'
import { FirRecentiComponent } from './fir-recenti.component'

/** Una sorgente di dati con il proprio caricamento ed errore: un errore non spegne le altre. */
interface Sorgente<T> {
  caricamento: boolean
  errore: boolean
  dati: T | null
}

function inCaricamento<T>(): Sorgente<T> {
  return { caricamento: true, errore: false, dati: null }
}

/**
 * Panoramica (Dashboard), direzione B «Libro mastro».
 *
 * In alto i blocchi del mockup: «Da fare oggi», deposito temporaneo, FIR recenti, FIR del
 * mese per stato e formulari per mese. Sotto, «Analisi dell'azienda»: i riquadri di sempre
 * sui dati di tutto il tenant, rifatti senza grafici Chart.js e con i dati corretti.
 * Ogni sorgente carica per conto suo, con il proprio stato di caricamento e di errore.
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ButtonModule,
    MenuModule,
    DaFareOggiComponent,
    DepositoSintesiComponent,
    FirRecentiComponent,
    FirMeseStatiComponent,
    BarreMensiliComponent,
    AnalisiSintesiComponent,
    BarreOrizzontaliComponent,
    ClassificaDitteComponent,
  ],
  template: `
    <div class="pagina">
      <header class="titolo">
        <div class="titolo__testo">
          <h1 class="page-title">Panoramica</h1>
          <p class="sotto" data-testid="panoramica-sottotitolo">
            {{ dataEstesa() }}
            @if (rispostaPronta()) {
              · <b>{{ risposta() }}</b>
            } @else {
              · <span class="sk sk--riga" aria-hidden="true"></span>
              <span class="sr-only">Controllo delle scadenze in corso</span>
            }
          </p>
        </div>
        <div class="azioni">
          @if (mostraNuovoFir()) {
            <a
              pButton
              class="wf-primario"
              routerLink="/fir"
              [queryParams]="{ nuovo: 1 }"
              icon="pi pi-plus"
              label="Nuovo FIR"
              data-testid="panoramica-nuovo-fir"
            ></a>
          }
          <p-button
            class="esporta"
            label="Esporta CSV"
            [text]="true"
            [disabled]="!dashboard().dati"
            (onClick)="esportaCsv()"
            ariaLabel="Esporta i dati della dashboard in formato CSV"
          />
          <p-menu #menu [popup]="true" [model]="menuAzioni" appendTo="body" />
          <p-button
            class="altre"
            icon="pi pi-ellipsis-h"
            [text]="true"
            (onClick)="menu.toggle($event)"
            ariaLabel="Altre azioni"
          />
        </div>
      </header>

      <div class="griglia">
        <div class="col col--sx">
          @if (ff.has('giacenze')) {
            <app-deposito-sintesi
              class="b-deposito"
              [vista]="deposito().dati"
              [caricamento]="deposito().caricamento"
              [errore]="deposito().errore"
            />
          }
          @if (ff.has('fir')) {
            <app-fir-recenti
              class="b-recenti"
              [fir]="firRecenti().dati ?? []"
              [caricamento]="firRecenti().caricamento"
              [errore]="firRecenti().errore"
              [puoCreare]="puoCreare()"
            />
          }
        </div>
        <div class="col col--dx">
          <app-da-fare-oggi
            class="b-da-fare"
            [voci]="voci()"
            [errore]="attenzione().errore"
            [caricamento]="attenzione().caricamento"
            (riprova)="caricaAttenzione()"
          />
          <app-fir-mese-stati
            class="b-mese"
            [conteggi]="conteggiMese()"
            [mese]="oggi()"
            [caricamento]="dashboard().caricamento"
            [errore]="dashboard().errore"
          />
          <app-barre-mensili
            class="b-mesi"
            [mesi]="mesi()"
            [caricamento]="andamento().caricamento"
            [errore]="andamento().errore"
            (riprova)="caricaAndamento()"
          />
        </div>
      </div>

      <section class="analisi" aria-labelledby="analisi-titolo" data-testid="analisi-azienda">
        <div class="analisi__h">
          <h2 id="analisi-titolo">Analisi dell'azienda</h2>
          <span class="meta">Tutti i formulari dell'azienda</span>
        </div>
        @if (dashboard().errore) {
          <div class="errore-analisi" role="alert" data-testid="analisi-errore">
            <span>Non è stato possibile caricare l'analisi dell'azienda.</span>
            <button type="button" class="riprova" (click)="caricaDashboard()">Riprova</button>
          </div>
        } @else {
          <app-analisi-sintesi
            [celle]="celle()"
            [livello]="livello()"
            [caricamento]="dashboard().caricamento"
          />
          <div class="coppia">
            <app-barre-orizzontali
              titolo="Destinazione"
              [voci]="destinazione()"
              [caricamento]="dashboard().caricamento"
            />
            <app-barre-orizzontali
              titolo="Top 10 codici CER"
              [voci]="topCer()"
              [caricamento]="dashboard().caricamento"
            />
          </div>
          <div class="coppia">
            <app-classifica-ditte
              titolo="Produttori più frequenti"
              [voci]="produttori()"
              [caricamento]="dashboard().caricamento"
            />
            <app-classifica-ditte
              titolo="Trasportatori più frequenti"
              [voci]="trasportatori()"
              [caricamento]="dashboard().caricamento"
            />
          </div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .titolo {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
      .titolo__testo {
        min-width: 0;
      }
      .page-title {
        margin: 0;
      }
      .sotto {
        margin: 6px 0 0;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 20px;
      }
      .sotto b {
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
      }
      .sk--riga {
        display: inline-block;
        width: 160px;
        height: 14px;
        vertical-align: middle;
        background: var(--surface-border);
        border-radius: var(--radius-sm);
      }
      .azioni {
        display: flex;
        gap: 8px;
        align-items: center;
        flex: none;
      }
      .altre {
        display: none;
      }

      .griglia {
        display: grid;
        gap: 24px;
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
      }
      .col {
        display: contents;
      }
      .b-da-fare {
        order: 1;
      }
      .b-mese {
        order: 2;
      }
      .b-deposito {
        order: 3;
      }
      .b-mesi {
        order: 4;
      }
      .b-recenti {
        order: 5;
      }
      @media (min-width: 1200px) {
        .griglia {
          grid-template-columns: 306px minmax(0, 1fr);
        }
        .col {
          display: grid;
          gap: 24px;
          align-content: start;
          min-width: 0;
        }
        .col--sx {
          position: sticky;
          top: 24px;
        }
        .col > * {
          order: 0;
        }
      }

      .analisi {
        margin-top: 40px;
        display: grid;
        gap: 16px;
      }
      .analisi__h {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .analisi__h h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 20px;
        line-height: 28px;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }
      .meta {
        font-size: 12px;
        color: var(--text-secondary);
      }
      .coppia {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1fr);
      }
      @media (min-width: 992px) {
        .coppia {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      .errore-analisi {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 16px 20px;
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-lg);
        background: var(--surface-card);
        color: var(--text-secondary);
      }
      .riprova {
        min-height: 32px;
        padding: 0 8px;
        border: 0;
        background: transparent;
        font: inherit;
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }

      @media (max-width: 575.98px) {
        .titolo {
          flex-direction: column;
          align-items: stretch;
        }
        .azioni {
          justify-content: space-between;
        }
        .azioni a[pButton] {
          flex: 1;
          justify-content: center;
          min-height: 44px;
        }
        .esporta {
          display: none;
        }
        .altre {
          display: inline-flex;
        }
        .analisi__h {
          flex-direction: column;
          gap: 2px;
        }
      }
    `,
  ],
})
export class DashboardPageComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService)
  private readonly attenzioneService = inject(AttenzioneService)
  private readonly andamentoService = inject(AndamentoService)
  private readonly giacenzeService = inject(GiacenzeService)
  private readonly firService = inject(FirService)
  private readonly auth = inject(AuthService)
  private readonly messageService = inject(MessageService)
  protected readonly ff = inject(FeatureFlagsService)

  /** Il giorno di riferimento della pagina (intervallo del mese, data estesa). */
  protected readonly oggi = signal(new Date())

  protected readonly attenzione = signal<Sorgente<VoceAttenzione[]>>(inCaricamento())
  protected readonly andamento = signal<Sorgente<AndamentoMensileVoce[]>>(inCaricamento())
  protected readonly dashboard = signal<Sorgente<DashboardData>>(inCaricamento())
  protected readonly deposito = signal<Sorgente<DepositoTemporaneoVista>>(inCaricamento())
  protected readonly firRecenti = signal<Sorgente<FIR[]>>(inCaricamento())

  protected readonly menuAzioni: MenuItem[] = [
    { label: 'Esporta CSV', icon: 'pi pi-download', command: () => this.esportaCsv() },
  ]

  protected readonly puoCreare = computed(() => puoCreareFir(this.auth.currentUser()?.role))
  protected readonly mostraNuovoFir = computed(() => this.ff.has('fir') && this.puoCreare())

  protected readonly voci = computed(() =>
    unisciVoci(
      this.attenzione().dati ?? [],
      this.deposito().dati ? vociDaDeposito(this.deposito().dati as DepositoTemporaneoVista) : []
    )
  )

  /** La risposta del giorno si scrive solo quando le sorgenti che la compongono hanno risposto. */
  protected readonly rispostaPronta = computed(
    () =>
      !this.attenzione().caricamento && !(this.ff.has('giacenze') && this.deposito().caricamento)
  )

  protected readonly risposta = computed(() =>
    // Una verifica fallita non e' «nessuna scadenza»: non si dichiara il via libera.
    this.attenzione().errore
      ? 'Controllo delle scadenze non riuscito'
      : rispostaDelGiorno(this.voci())
  )

  protected readonly dataEstesa = computed(() =>
    this.oggi().toLocaleDateString('it-IT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  )

  protected readonly mesi = computed(() => this.andamento().dati ?? [])

  protected readonly conteggiMese = computed<Record<FIRStato, number> | null>(() => {
    const d = this.dashboard().dati
    return d ? contaPerStatoFir(d.status.breakdown) : null
  })

  protected readonly celle = computed(() => {
    const d = this.dashboard().dati
    return d ? celleAnalisi(d, this.mesi()) : []
  })
  protected readonly livello = computed(() => {
    const d = this.dashboard().dati
    return d ? livelloConformita(d) : null
  })

  protected readonly destinazione = computed<VoceBarra[]>(() => {
    const d = this.dashboard().dati
    if (!d) return []
    const { recovery, disposal } = d.waste.byDestination
    if (recovery.quantity + disposal.quantity <= 0) return []
    return [
      { etichetta: 'Recupero', valore: recovery.quantity },
      { etichetta: 'Smaltimento', valore: disposal.quantity },
    ]
  })
  protected readonly topCer = computed<VoceBarra[]>(() =>
    (this.dashboard().dati?.waste.byCERCode ?? [])
      .slice(0, 10)
      .map(w => ({ etichetta: w.cerCode, valore: w.totalQuantity, mono: true }))
  )
  protected readonly produttori = computed(() =>
    vociClassifica(this.dashboard().dati?.top.producers ?? [])
  )
  protected readonly trasportatori = computed(() =>
    vociClassifica(this.dashboard().dati?.top.carriers ?? [])
  )

  private depositoAvviato = false
  private firAvviato = false

  constructor() {
    // Le feature arrivano dopo l'avvio della pagina: ogni sorgente opzionale parte una sola
    // volta, quando la sua feature risulta attiva, e non parte mai se non lo e'.
    effect(
      () => {
        if (this.ff.has('giacenze') && !this.depositoAvviato) {
          this.depositoAvviato = true
          untracked(() => this.caricaDeposito())
        }
      },
      { allowSignalWrites: true }
    )
    effect(
      () => {
        if (this.ff.has('fir') && !this.firAvviato) {
          this.firAvviato = true
          untracked(() => this.caricaFirRecenti())
        }
      },
      { allowSignalWrites: true }
    )
  }

  ngOnInit(): void {
    this.caricaAttenzione()
    this.caricaAndamento()
    this.caricaDashboard()
  }

  protected caricaAttenzione(): void {
    this.attenzione.set(inCaricamento())
    this.attenzioneService.getAttenzione().subscribe({
      next: r => this.attenzione.set({ caricamento: false, errore: false, dati: r.voci }),
      error: () => this.attenzione.set({ caricamento: false, errore: true, dati: null }),
    })
  }

  protected caricaAndamento(): void {
    this.andamento.set(inCaricamento())
    this.andamentoService.getAndamento().subscribe({
      next: r => this.andamento.set({ caricamento: false, errore: false, dati: r.mesi }),
      error: () => this.andamento.set({ caricamento: false, errore: true, dati: null }),
    })
  }

  protected caricaDashboard(): void {
    this.dashboard.set(inCaricamento())
    this.dashboardService.getDashboard(intervalloMeseCorrente(this.oggi())).subscribe({
      next: d => this.dashboard.set({ caricamento: false, errore: false, dati: d }),
      error: () => this.dashboard.set({ caricamento: false, errore: true, dati: null }),
    })
  }

  private caricaDeposito(): void {
    this.deposito.set(inCaricamento())
    this.giacenzeService.getDepositoTemporaneo().subscribe({
      next: v => this.deposito.set({ caricamento: false, errore: false, dati: v }),
      error: () => this.deposito.set({ caricamento: false, errore: true, dati: null }),
    })
  }

  private caricaFirRecenti(): void {
    this.firRecenti.set(inCaricamento())
    this.firService.getFIRList(1, 5).subscribe({
      next: r => this.firRecenti.set({ caricamento: false, errore: false, dati: r.items }),
      error: () => this.firRecenti.set({ caricamento: false, errore: true, dati: null }),
    })
  }

  protected esportaCsv(): void {
    this.dashboardService.downloadExport('csv')
    this.messageService.add({
      severity: 'success',
      summary: 'Esportazione avviata',
      detail: 'Il download del CSV inizierà a breve',
    })
  }
}
