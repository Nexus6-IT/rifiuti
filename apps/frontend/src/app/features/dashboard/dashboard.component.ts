import { Component, OnInit } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterLink } from '@angular/router'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ChartModule } from 'primeng/chart'
import { FirService } from '../fir/fir.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader.component'
import { EmptyStateComponent } from '../../shared/components/empty-state.component'
import { ErrorStateComponent } from '../../shared/components/error-state.component'
import { AttenzioneService, VoceAttenzione } from './attenzione.service'
import { AndamentoService, AndamentoMensileVoce } from './andamento.service'

interface DashboardStats {
  totalFIR: number
  firInTransito: number
  firConsegnati: number
  firBozza: number
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    ChartModule,
    SkeletonLoaderComponent,
    EmptyStateComponent,
    ErrorStateComponent,
  ],
  template: `
    <div class="page">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Panoramica generale del sistema di gestione rifiuti</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo FIR"
            icon="pi pi-plus"
            routerLink="/fir"
            ariaLabel="Crea un nuovo FIR"
          />
        </div>
      </header>

      <!-- Fascia delle cose che richiedono attenzione oggi: compare quando
           c'è un fatto da comunicare — voci reali oppure il fatto che il
           controllo stesso non è riuscito. Resta assente SOLO quando il
           controllo è andato a buon fine e non ha trovato nulla: mai un
           riquadro vuoto permanente. -->
      <section
        *ngIf="vociAttenzione.length > 0 || erroreAttenzione"
        class="attenzione-fascia"
        aria-labelledby="attenzione-heading"
        data-testid="attenzione-fascia"
      >
        <h2 id="attenzione-heading" class="attenzione-fascia__title">
          <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
          Richiede attenzione
        </h2>
        <ul class="attenzione-fascia__list">
          <!-- La verifica stessa non è riuscita: "non lo so" non è "tutto a
               posto", va comunicato con la stessa fascia, non inghiottito. -->
          <li
            *ngIf="erroreAttenzione"
            class="attenzione-voce attenzione-voce--critico"
            data-testid="attenzione-voce-verifica-fallita"
          >
            <p-tag value="Critico" severity="danger" aria-label="Gravità: Critico" />
            <div class="attenzione-voce__testo">
              <span class="attenzione-voce__titolo">Verifica delle scadenze non riuscita</span>
              <span class="attenzione-voce__dettaglio"
                >Non è stato possibile controllare oggi certificato RENTRI e autorizzazioni.
                Riprova.</span
              >
            </div>
            <p-button
              label="Riprova"
              [text]="true"
              icon="pi pi-refresh"
              iconPos="right"
              ariaLabel="Riprova a verificare le scadenze"
              data-testid="attenzione-azione-verifica-fallita"
              (onClick)="loadAttenzione()"
            />
          </li>

          <li
            *ngFor="let voce of vociAttenzione"
            class="attenzione-voce"
            [ngClass]="'attenzione-voce--' + voce.gravita"
            [attr.data-testid]="'attenzione-voce-' + voce.chiave"
          >
            <p-tag
              [value]="etichettaGravita(voce.gravita)"
              [severity]="getGravitaSeverity(voce.gravita)"
              [attr.aria-label]="'Gravità: ' + etichettaGravita(voce.gravita)"
            />
            <div class="attenzione-voce__testo">
              <span class="attenzione-voce__titolo">{{ voce.titolo }}</span>
              <span class="attenzione-voce__dettaglio">{{ voce.dettaglio }}</span>
            </div>
            <p-button
              *ngIf="voce.azione as azione"
              [label]="azione.etichetta"
              [text]="true"
              [routerLink]="azione.rotta"
              icon="pi pi-arrow-right"
              iconPos="right"
              [ariaLabel]="azione.etichetta + ': ' + voce.titolo"
              [attr.data-testid]="'attenzione-azione-' + voce.chiave"
            />
          </li>
        </ul>
      </section>

      <!-- Stato di caricamento KPI -->
      <ng-container *ngIf="loading && recentFIR.length === 0">
        <div class="stat-grid" aria-busy="true">
          <span class="sr-only">Caricamento statistiche in corso</span>
          <app-skeleton-loader *ngFor="let _ of [1, 2, 3, 4]" variant="stats" [repeat]="1" />
        </div>
      </ng-container>

      <!-- KPI -->
      <section *ngIf="!loading || recentFIR.length > 0" aria-labelledby="kpi-heading">
        <h2 id="kpi-heading" class="sr-only">Indicatori principali</h2>
        <div class="stat-grid">
          <article class="stat-card">
            <span class="stat-card__label">
              <i class="pi pi-file" aria-hidden="true"></i> Totale FIR
            </span>
            <span class="stat-card__value">{{ stats.totalFIR }}</span>
          </article>

          <article class="stat-card">
            <span class="stat-card__label">
              <i class="pi pi-truck" aria-hidden="true"></i> In transito
            </span>
            <span class="stat-card__value stat-card__value--warning">{{
              stats.firInTransito
            }}</span>
          </article>

          <article class="stat-card">
            <span class="stat-card__label">
              <i class="pi pi-check-circle" aria-hidden="true"></i> Consegnati
            </span>
            <span class="stat-card__value stat-card__value--success">{{
              stats.firConsegnati
            }}</span>
          </article>

          <article class="stat-card">
            <span class="stat-card__label">
              <i class="pi pi-pencil" aria-hidden="true"></i> Bozze
            </span>
            <span class="stat-card__value">{{ stats.firBozza }}</span>
          </article>
        </div>
      </section>

      <!-- Stato di errore -->
      <app-error-state
        *ngIf="error && !loading"
        title="Errore nel caricamento della dashboard"
        [message]="error"
        (retry)="loadDashboardData()"
      />

      <!-- Contenuto -->
      <div class="dashboard-grid mt-4" *ngIf="!error">
        <!-- Tabella FIR recenti -->
        <div class="surface-card dashboard-grid__main">
          <div class="card-header">
            <h2 class="card-title">FIR recenti</h2>
            <p-button
              label="Vedi tutti"
              [text]="true"
              routerLink="/fir"
              icon="pi pi-arrow-right"
              iconPos="right"
              ariaLabel="Visualizza tutti i FIR"
            />
          </div>

          <!-- Loading -->
          <app-skeleton-loader *ngIf="loading" variant="table" [rows]="5" />

          <!-- Tabella -->
          <div class="table-responsive" *ngIf="!loading">
            <p-table [value]="recentFIR" responsiveLayout="scroll" styleClass="dashboard-table">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">Numero</th>
                  <th scope="col">CER</th>
                  <th scope="col">Stato</th>
                  <th scope="col">Data</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-fir>
                <tr>
                  <td>
                    <span class="font-semibold">{{ fir.numeroProgressivo || 'N/A' }}</span>
                  </td>
                  <td>{{ fir.rifiuto.cerCode }}</td>
                  <td>
                    <p-tag
                      [value]="fir.stato"
                      [severity]="getStatoSeverity(fir.stato)"
                      [attr.aria-label]="'Stato: ' + fir.stato"
                    />
                  </td>
                  <td>
                    <time [dateTime]="fir.createdAt">
                      {{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}
                    </time>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="4">
                    <app-empty-state
                      icon="pi-file"
                      title="Nessun FIR recente"
                      message="Non ci sono FIR recenti da visualizzare. Inizia creando il tuo primo FIR."
                      actionLabel="Crea FIR"
                      actionIcon="pi pi-plus"
                      [routerLink]="['/fir']"
                    />
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </div>

        <!-- Grafico FIR per stato -->
        <div class="surface-card dashboard-grid__aside">
          <h2 class="card-title">FIR per stato</h2>

          <div *ngIf="loading" class="chart-skeleton">
            <app-skeleton-loader variant="circle" width="200px" [repeat]="1" />
          </div>

          <p-chart
            *ngIf="!loading && hasChartData"
            type="doughnut"
            [data]="chartData"
            [options]="chartOptions"
            role="img"
            aria-label="Grafico a ciambella che mostra la distribuzione dei FIR per stato"
          />

          <div *ngIf="!loading && !hasChartData" class="empty-state">
            <i class="pi pi-chart-bar empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessun dato disponibile</p>
          </div>
        </div>
      </div>

      <!-- Andamento mensile: un conteggio dice dove sei, una serie dice
           dove stai andando (Task 4). -->
      <section class="surface-card mt-4" aria-labelledby="andamento-heading" *ngIf="!error">
        <h2 id="andamento-heading" class="card-title">Andamento mensile</h2>
        <p class="andamento-sottotitolo">Formulari emessi negli ultimi dodici mesi</p>

        <ng-container *ngIf="loadingAndamento">
          <div aria-busy="true">
            <span class="sr-only">Caricamento andamento mensile in corso</span>
            <app-skeleton-loader variant="rectangle" width="100%" height="220px" [repeat]="1" />
          </div>
        </ng-container>

        <ng-container *ngIf="!loadingAndamento">
          <p *ngIf="erroreAndamento" class="andamento-errore" data-testid="andamento-errore">
            Non è stato possibile caricare l'andamento mensile. Riprova più tardi.
          </p>

          <ng-container *ngIf="!erroreAndamento">
            <p-chart
              *ngIf="hasAndamentoData"
              data-testid="andamento-grafico"
              type="line"
              [data]="andamentoChartData"
              [options]="andamentoChartOptions"
              role="img"
              aria-label="Grafico a linee dei formulari emessi negli ultimi dodici mesi"
            />

            <div *ngIf="!hasAndamentoData" class="empty-state" data-testid="andamento-vuoto">
              <i class="pi pi-chart-line empty-state__icon" aria-hidden="true"></i>
              <p class="empty-state__title">Nessun formulario emesso negli ultimi dodici mesi</p>
            </div>
          </ng-container>

          <!-- Alternativa testuale (WCAG): un grafico che uno screen reader
               non sa leggere non comunica niente. Presente sempre insieme
               al grafico, non solo come ripiego in caso di errore. -->
          <table class="sr-only" data-testid="andamento-tabella-testuale">
            <caption>
              Formulari emessi per mese, ultimi dodici mesi
            </caption>
            <thead>
              <tr>
                <th scope="col">Mese</th>
                <th scope="col">Formulari emessi</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let voce of andamentoMesi">
                <td>{{ formattaMeseEtichetta(voce.mese) }}</td>
                <td>{{ voce.conteggio }}</td>
              </tr>
            </tbody>
          </table>
        </ng-container>
      </section>
    </div>
  `,
  styles: [
    `
      .dashboard-grid {
        display: grid;
        /* Allineato al gap delle KPI (.stat-grid) per continuità visiva */
        gap: var(--spacing-base);
        grid-template-columns: 1fr;
      }
      @media (min-width: 992px) {
        .dashboard-grid {
          grid-template-columns: 2fr 1fr;
          align-items: start;
        }
      }

      .card-header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }

      .card-title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .stat-card__label {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
      }
      .stat-card__label .pi {
        color: var(--brand-primary);
      }
      /* Valori KPI neutri: sono conteggi, non stati/soglie da evidenziare */
      .stat-card__value--warning {
        color: var(--text-primary);
      }
      .stat-card__value--success {
        color: var(--text-primary);
      }

      .chart-skeleton {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-2xl);
      }

      .attenzione-fascia {
        margin-bottom: var(--spacing-base);
      }

      .attenzione-fascia__title {
        display: flex;
        align-items: center;
        gap: var(--spacing-xs);
        margin: 0 0 var(--spacing-sm) 0;
        font-family: var(--font-display);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .attenzione-fascia__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }

      .attenzione-voce {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        border-radius: var(--radius-md, 8px);
        border-left: 4px solid var(--text-secondary);
        background: var(--surface-card, #fff);
      }

      .attenzione-voce--critico {
        border-left-color: var(--color-danger);
      }
      .attenzione-voce--avviso {
        border-left-color: var(--color-warning);
      }
      .attenzione-voce--informativo {
        border-left-color: var(--color-info);
      }

      .attenzione-voce__testo {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-width: 0;
      }

      .attenzione-voce__titolo {
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .attenzione-voce__dettaglio {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }

      .mt-4 {
        margin-top: var(--spacing-lg);
      }

      .andamento-sottotitolo {
        margin: 0 0 var(--spacing-base) 0;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }

      .andamento-errore {
        color: var(--color-danger);
      }
    `,
  ],
})
export class DashboardComponent implements OnInit {
  stats: DashboardStats = {
    totalFIR: 0,
    firInTransito: 0,
    firConsegnati: 0,
    firBozza: 0,
  }

  recentFIR: FIR[] = []
  loading = false
  error = ''

  /**
   * Cose che richiedono attenzione oggi. Un errore nel loro caricamento non
   * deve rompere il resto del cruscotto (vedi loadAttenzione), ma NON deve
   * nemmeno sparire in silenzio: "non sono riuscito a controllare" è un
   * fatto da comunicare tanto quanto una scadenza vera, non equivale a
   * "controllato, nessuna voce" — vedi erroreAttenzione.
   */
  vociAttenzione: VoceAttenzione[] = []

  /**
   * True quando l'ultima chiamata a getAttenzione() è fallita. In questo
   * caso la fascia compare comunque, con un'unica voce sintetica che dice
   * che la verifica non è riuscita: la fascia assente deve significare SOLO
   * "controllato, tutto a posto", mai "non lo so".
   */
  erroreAttenzione = false

  chartData: any
  chartOptions: any

  /**
   * Formulari emessi per mese, ultimi dodici mesi (Task 4): un conteggio
   * dice dove sei, questa serie dice dove stai andando. Tenuta anche a
   * parte da `andamentoChartData` perché alimenta l'alternativa testuale
   * della tabella (v. template) — un grafico che uno screen reader non sa
   * leggere non comunica niente.
   */
  andamentoMesi: AndamentoMensileVoce[] = []
  loadingAndamento = false

  /**
   * True quando l'ultima chiamata a getAndamento() è fallita. Stesso
   * principio di erroreAttenzione: non deve rompere il resto del cruscotto,
   * ma nemmeno sparire in silenzio.
   */
  erroreAndamento = false

  andamentoChartData: any
  andamentoChartOptions: any

  constructor(
    private firService: FirService,
    private attenzioneService: AttenzioneService,
    private andamentoService: AndamentoService
  ) {}

  ngOnInit(): void {
    this.loadDashboardData()
    this.loadAttenzione()
    this.loadAndamento()
    this.initChart()
    this.initAndamentoChart()
  }

  /**
   * Carica le voci di attenzione indipendentemente dal resto del cruscotto:
   * un fallimento qui non deve impedire la visualizzazione di indicatori,
   * FIR recenti e grafico (è una subscribe separata da loadDashboardData).
   * Ma un fallimento QUI è comunque un fatto da mostrare nella fascia stessa
   * (erroreAttenzione): non sappiamo se ci sono scadenze critiche, e quello
   * non è la stessa cosa di sapere che non ce ne sono.
   */
  loadAttenzione(): void {
    this.erroreAttenzione = false
    this.attenzioneService.getAttenzione().subscribe({
      next: risultato => {
        this.vociAttenzione = risultato.voci
      },
      error: () => {
        this.vociAttenzione = []
        this.erroreAttenzione = true
      },
    })
  }

  etichettaGravita(gravita: VoceAttenzione['gravita']): string {
    const etichette: Record<VoceAttenzione['gravita'], string> = {
      critico: 'Critico',
      avviso: 'Avviso',
      informativo: 'Informativo',
    }
    return etichette[gravita]
  }

  getGravitaSeverity(gravita: VoceAttenzione['gravita']): 'danger' | 'warning' | 'info' {
    const severityMap: Record<VoceAttenzione['gravita'], 'danger' | 'warning' | 'info'> = {
      critico: 'danger',
      avviso: 'warning',
      informativo: 'info',
    }
    return severityMap[gravita]
  }

  /**
   * Carica l'andamento mensile indipendentemente dal resto del cruscotto
   * (stessa indipendenza di loadAttenzione): un fallimento qui non deve
   * impedire la visualizzazione di indicatori, FIR recenti e grafico "per
   * stato". Un fallimento resta comunque un fatto da comunicare
   * (erroreAndamento), mai inghiottito in silenzio.
   */
  loadAndamento(): void {
    this.loadingAndamento = true
    this.erroreAndamento = false
    this.andamentoService.getAndamento().subscribe({
      next: risultato => {
        this.andamentoMesi = risultato.mesi
        this.updateAndamentoChartData()
        this.loadingAndamento = false
      },
      error: () => {
        this.andamentoMesi = []
        this.erroreAndamento = true
        this.loadingAndamento = false
      },
    })
  }

  loadDashboardData(): void {
    this.loading = true
    this.error = ''
    this.firService.getFIRList(1, 5).subscribe({
      next: response => {
        this.recentFIR = response.items
        this.calculateStats(response.items)
        this.updateChartData()
        this.loading = false
      },
      error: err => {
        this.loading = false
        this.error =
          err.error?.message ||
          'Si è verificato un errore nel caricamento dei dati. Riprova più tardi.'
      },
    })
  }

  calculateStats(firList: FIR[]): void {
    this.stats.totalFIR = firList.length
    this.stats.firInTransito = firList.filter(f => f.stato === FIRStato.IN_TRANSITO).length
    this.stats.firConsegnati = firList.filter(f => f.stato === FIRStato.CONSEGNATO).length
    this.stats.firBozza = firList.filter(f => f.stato === FIRStato.BOZZA).length
  }

  initChart(): void {
    this.chartOptions = {
      plugins: {
        legend: {
          position: 'bottom',
          // Etichette leggibili (WCAG AA) -> --text-secondary
          labels: { color: '#475569' },
        },
      },
    }
  }

  updateChartData(): void {
    this.chartData = {
      labels: ['Bozza', 'Emesso', 'In Transito', 'Consegnato', 'Annullato'],
      datasets: [
        {
          data: [
            this.stats.firBozza,
            0, // Count emesso separately if needed
            this.stats.firInTransito,
            this.stats.firConsegnati,
            0, // Count annullato separately if needed
          ],
          // Palette semantica: secondary / info / warning / success / danger
          backgroundColor: ['#64748b', '#1d4ed8', '#b45309', '#15803d', '#b91c1c'],
        },
      ],
    }
  }

  /** True quando il grafico "FIR per stato" ha almeno un valore > 0 */
  get hasChartData(): boolean {
    const data: number[] = this.chartData?.datasets?.[0]?.data ?? []
    return data.some(v => v > 0)
  }

  initAndamentoChart(): void {
    this.andamentoChartOptions = {
      plugins: {
        legend: { display: false },
      },
      scales: {
        // Conteggi interi: niente tacche a metà formulario.
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#e2e8f0' } },
        x: { grid: { display: false } },
      },
    }
  }

  updateAndamentoChartData(): void {
    this.andamentoChartData = {
      labels: this.andamentoMesi.map(voce => this.formattaMeseEtichetta(voce.mese)),
      datasets: [
        {
          label: 'Formulari emessi',
          data: this.andamentoMesi.map(voce => voce.conteggio),
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29, 78, 216, 0.15)',
          tension: 0.3,
          fill: true,
        },
      ],
    }
  }

  /** True quando almeno un mese ha un formulario emesso — un grafico piatto a zero non aggiunge nulla. */
  get hasAndamentoData(): boolean {
    return this.andamentoMesi.some(voce => voce.conteggio > 0)
  }

  /** 'YYYY-MM' -> «set 2026», etichetta breve in italiano per asse del grafico e tabella testuale. */
  formattaMeseEtichetta(mese: string): string {
    const [anno, meseNumero] = mese.split('-').map(Number)
    const data = new Date(Date.UTC(anno, meseNumero - 1, 1))
    const etichetta = data.toLocaleDateString('it-IT', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    return etichetta
  }

  getStatoSeverity(
    stato: FIRStato
  ): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | undefined {
    const severityMap: Record<FIRStato, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
      [FIRStato.BOZZA]: 'secondary',
      [FIRStato.EMESSO]: 'info',
      [FIRStato.IN_TRANSITO]: 'warning',
      [FIRStato.CONSEGNATO]: 'success',
      [FIRStato.ANNULLATO]: 'danger',
    }
    return severityMap[stato]
  }
}
