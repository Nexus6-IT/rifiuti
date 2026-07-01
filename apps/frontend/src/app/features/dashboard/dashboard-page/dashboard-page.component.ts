import { Component, inject, signal, OnInit, computed } from '@angular/core'
import { CommonModule } from '@angular/common'
import { CardModule } from 'primeng/card'
import { ChartModule } from 'primeng/chart'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { ProgressBarModule } from 'primeng/progressbar'
import { SkeletonModule } from 'primeng/skeleton'
import { DashboardService, DashboardData } from '../../../core/services/dashboard.service'
import { MessageService } from 'primeng/api'

/**
 * Dashboard Page Component
 *
 * Cruscotto analitico per la gestione dei rifiuti (FIR, conformità, RENTRI,
 * firme, andamenti). Allineato al design system v2 (token, .page, .stat-grid,
 * .surface-card, .empty-state, .table-responsive).
 *
 * Caratteristiche:
 * - KPI in `.stat-grid` / `.stat-card` (leggibili, non solo colore)
 * - Grafici e tabelle dentro card con spaziatura generosa
 * - Stati loading / empty / error coerenti
 * - Responsive mobile-first, WCAG 2.1 AA (un solo h1, heading ordinati,
 *   aria-label su icone/azioni, focus visibile via design system)
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ChartModule,
    ButtonModule,
    TagModule,
    ProgressBarModule,
    SkeletonModule,
  ],
  template: `
    <div class="page">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Dashboard analitiche</h1>
          <p class="page-subtitle">Monitoraggio FIR e gestione rifiuti in tempo reale</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="loadDashboard()"
            [loading]="isLoading()"
            ariaLabel="Aggiorna i dati della dashboard"
          />
          <p-button
            label="Esporta CSV"
            icon="pi pi-download"
            [outlined]="true"
            (onClick)="exportCSV()"
            [disabled]="!dashboard()"
            ariaLabel="Esporta i dati della dashboard in formato CSV"
          />
        </div>
      </header>

      <!-- Stato di caricamento iniziale -->
      <div *ngIf="isLoading() && !dashboard()" aria-busy="true" aria-live="polite">
        <span class="sr-only">Caricamento dati della dashboard in corso</span>
        <div class="stat-grid">
          <div class="stat-card" *ngFor="let i of [1, 2, 3, 4]">
            <p-skeleton width="6rem" height="1rem" styleClass="mb-2" />
            <p-skeleton width="4rem" height="2.25rem" />
          </div>
        </div>
        <div class="dashboard-grid dashboard-grid--two mt-4">
          <div class="surface-card" *ngFor="let i of [1, 2]">
            <p-skeleton width="10rem" height="1.25rem" styleClass="mb-3" />
            <p-skeleton width="100%" height="16rem" />
          </div>
        </div>
      </div>

      <!-- Stato di errore -->
      <div *ngIf="error() && !isLoading()" class="surface-card" role="alert">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon" aria-hidden="true"></i>
          <p class="empty-state__title">Impossibile caricare la dashboard</p>
          <p>{{ error() }}</p>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            (onClick)="loadDashboard()"
            ariaLabel="Riprova a caricare la dashboard"
          />
        </div>
      </div>

      <!-- Contenuto -->
      <div *ngIf="dashboard() as data" class="dashboard-content">
        <!-- KPI principali -->
        <section aria-labelledby="kpi-heading">
          <h2 id="kpi-heading" class="sr-only">Indicatori principali</h2>
          <div class="stat-grid">
            <article class="stat-card">
              <span class="stat-card__label">
                <i class="pi pi-file" aria-hidden="true"></i> FIR totali
              </span>
              <span class="stat-card__value">{{ data.overview.totalFIRs }}</span>
              <span class="stat-card__hint" *ngIf="growthPercentage() !== 0">
                <i
                  class="pi"
                  [class.pi-arrow-up]="growthPercentage() > 0"
                  [class.pi-arrow-down]="growthPercentage() < 0"
                  aria-hidden="true"
                ></i>
                {{ growthPercentage() > 0 ? '+' : '' }}{{ (growthPercentage() * 100).toFixed(1) }}%
                rispetto al mese precedente
              </span>
            </article>

            <article class="stat-card">
              <span class="stat-card__label">
                <i class="pi pi-check-circle" aria-hidden="true"></i> FIR completati
              </span>
              <span class="stat-card__value">{{ data.overview.completedFIRs }}</span>
              <span class="stat-card__hint"
                >{{ (completionRate() * 100).toFixed(0) }}% del totale</span
              >
            </article>

            <article class="stat-card">
              <span class="stat-card__label">
                <i class="pi pi-box" aria-hidden="true"></i> Rifiuti totali
              </span>
              <span class="stat-card__value">{{ formatWeight(data.overview.totalWasteKg) }}</span>
              <span class="stat-card__hint">tonnellate gestite</span>
            </article>

            <article class="stat-card">
              <span class="stat-card__label">
                <i class="pi pi-shield" aria-hidden="true"></i> Conformità
              </span>
              <span class="stat-card__value">{{ (data.compliance.score * 100).toFixed(0) }}%</span>
              <span class="stat-card__hint">
                <p-tag
                  [value]="complianceLabel(data.compliance.level)"
                  [severity]="getComplianceSeverity(data.compliance.level)"
                />
              </span>
            </article>
          </div>
        </section>

        <!-- Grafici: stato FIR + destinazione rifiuti -->
        <section class="dashboard-grid dashboard-grid--two mt-4" aria-labelledby="charts-heading-1">
          <h2 id="charts-heading-1" class="sr-only">Distribuzione FIR e rifiuti</h2>

          <div class="surface-card">
            <h3 class="card-title">Stato dei FIR</h3>
            <p-chart
              *ngIf="hasStatusData(); else chartEmpty"
              type="pie"
              [data]="statusChartData()"
              [options]="chartOptions"
              height="300px"
              role="img"
              aria-label="Grafico a torta della distribuzione dei FIR per stato"
            />
          </div>

          <div class="surface-card">
            <h3 class="card-title">Destinazione rifiuti</h3>
            <p-chart
              *ngIf="hasDestinationData(); else chartEmpty"
              type="doughnut"
              [data]="destinationChartData()"
              [options]="chartOptions"
              height="300px"
              role="img"
              aria-label="Grafico a ciambella della destinazione dei rifiuti tra recupero e smaltimento"
            />
            <div class="recycling">
              <p class="recycling__label">
                Tasso di riciclo:
                <strong>{{ (data.waste.recyclingRate * 100).toFixed(1) }}%</strong>
              </p>
              <p-progressBar
                [value]="data.waste.recyclingRate * 100"
                [showValue]="false"
                [attr.aria-label]="
                  'Tasso di riciclo ' + (data.waste.recyclingRate * 100).toFixed(0) + ' percento'
                "
              />
            </div>
          </div>
        </section>

        <!-- Grafici: codici CER + andamento mensile -->
        <section class="dashboard-grid dashboard-grid--two mt-4" aria-labelledby="charts-heading-2">
          <h2 id="charts-heading-2" class="sr-only">Codici CER e andamento</h2>

          <div class="surface-card">
            <h3 class="card-title">Top 10 codici CER</h3>
            <p-chart
              *ngIf="hasCerData(); else chartEmpty"
              type="bar"
              [data]="cerChartData()"
              [options]="barChartOptions"
              height="300px"
              role="img"
              aria-label="Grafico a barre dei dieci codici CER con maggiore quantità di rifiuti"
            />
          </div>

          <div class="surface-card">
            <h3 class="card-title">Andamento mensile</h3>
            <dl class="trend-grid">
              <div class="trend-item">
                <dt class="trend-item__label">Mese corrente</dt>
                <dd class="trend-item__value">{{ data.trends.monthOverMonth.current }}</dd>
              </div>
              <div class="trend-item">
                <dt class="trend-item__label">Mese precedente</dt>
                <dd class="trend-item__value">{{ data.trends.monthOverMonth.previous }}</dd>
              </div>
              <div class="trend-item">
                <dt class="trend-item__label">Crescita</dt>
                <dd
                  class="trend-item__value"
                  [class.trend-item__value--up]="data.trends.monthOverMonth.percentage > 0"
                  [class.trend-item__value--down]="data.trends.monthOverMonth.percentage < 0"
                >
                  <i
                    class="pi"
                    [class.pi-arrow-up]="data.trends.monthOverMonth.percentage > 0"
                    [class.pi-arrow-down]="data.trends.monthOverMonth.percentage < 0"
                    aria-hidden="true"
                  ></i>
                  {{ (data.trends.monthOverMonth.percentage * 100).toFixed(1) }}%
                </dd>
              </div>
              <div class="trend-item">
                <dt class="trend-item__label">Previsione prossimo mese</dt>
                <dd class="trend-item__value trend-item__value--accent">
                  {{ data.trends.prediction.nextMonth }}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <!-- Metriche: RENTRI + firme -->
        <section class="dashboard-grid dashboard-grid--two mt-4" aria-labelledby="metrics-heading">
          <h2 id="metrics-heading" class="sr-only">Sincronizzazione RENTRI e firme digitali</h2>

          <div class="surface-card">
            <h3 class="card-title">Sincronizzazione RENTRI</h3>
            <div class="metric-block">
              <label class="metric-block__label" id="rentri-rate">Tasso di sincronizzazione</label>
              <p-progressBar
                [value]="data.rentri.syncRate * 100"
                [showValue]="true"
                valueTemplate="{value}%"
                aria-labelledby="rentri-rate"
              />
            </div>
            <div class="metric-pair">
              <div class="metric-pair__item">
                <span class="metric-pair__label">FIR sincronizzati</span>
                <span class="metric-pair__value metric-pair__value--success">{{
                  data.rentri.synced
                }}</span>
              </div>
              <div class="metric-pair__item">
                <span class="metric-pair__label">In attesa</span>
                <span class="metric-pair__value metric-pair__value--warning">{{
                  data.rentri.pending
                }}</span>
              </div>
            </div>
          </div>

          <div class="surface-card">
            <h3 class="card-title">Firme digitali</h3>
            <div class="metric-block">
              <label class="metric-block__label" id="sign-rate">Tasso di completamento</label>
              <p-progressBar
                [value]="data.signatures.completionRate * 100"
                [showValue]="true"
                valueTemplate="{value}%"
                aria-labelledby="sign-rate"
              />
            </div>
            <div class="metric-pair">
              <div class="metric-pair__item">
                <span class="metric-pair__label">Firme complete</span>
                <span class="metric-pair__value metric-pair__value--success">{{
                  data.signatures.completed
                }}</span>
              </div>
              <div class="metric-pair__item">
                <span class="metric-pair__label">Tempo medio</span>
                <span class="metric-pair__value metric-pair__value--accent"
                  >{{ data.signatures.averageTimeHours }}h</span
                >
              </div>
            </div>
          </div>
        </section>

        <!-- Top liste -->
        <section class="dashboard-grid dashboard-grid--two mt-4" aria-labelledby="top-heading">
          <h2 id="top-heading" class="sr-only">Principali produttori e trasportatori</h2>

          <div class="surface-card">
            <h3 class="card-title">Top 5 produttori</h3>
            <ol class="rank-list" *ngIf="data.top.producers.length; else noProducers">
              <li
                class="rank-list__item"
                *ngFor="let producer of data.top.producers; let i = index"
              >
                <span class="rank-list__rank" aria-hidden="true">{{ i + 1 }}</span>
                <span class="rank-list__label">{{ producer.partitaIva }}</span>
                <p-tag [value]="producer.count + ' FIR'" severity="info" />
              </li>
            </ol>
            <ng-template #noProducers>
              <div class="empty-state">
                <i class="pi pi-users empty-state__icon" aria-hidden="true"></i>
                <p class="empty-state__title">Nessun produttore</p>
                <p>Non ci sono ancora dati sui produttori.</p>
              </div>
            </ng-template>
          </div>

          <div class="surface-card">
            <h3 class="card-title">Top 5 trasportatori</h3>
            <ol class="rank-list" *ngIf="data.top.carriers.length; else noCarriers">
              <li class="rank-list__item" *ngFor="let carrier of data.top.carriers; let i = index">
                <span class="rank-list__rank" aria-hidden="true">{{ i + 1 }}</span>
                <span class="rank-list__label">{{ carrier.partitaIva }}</span>
                <p-tag [value]="carrier.count + ' FIR'" severity="warning" />
              </li>
            </ol>
            <ng-template #noCarriers>
              <div class="empty-state">
                <i class="pi pi-truck empty-state__icon" aria-hidden="true"></i>
                <p class="empty-state__title">Nessun trasportatore</p>
                <p>Non ci sono ancora dati sui trasportatori.</p>
              </div>
            </ng-template>
          </div>
        </section>

        <!-- Stato vuoto condiviso per i grafici senza dati -->
        <ng-template #chartEmpty>
          <div class="empty-state">
            <i class="pi pi-chart-bar empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessun dato disponibile</p>
          </div>
        </ng-template>
      </div>
    </div>
  `,
  styles: [
    `
      .dashboard-grid {
        display: grid;
        /* Allineato al gap delle KPI (.stat-grid) per continuità visiva */
        gap: var(--spacing-base);
      }
      .dashboard-grid--two {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }

      .card-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0 0 var(--spacing-base);
      }

      .stat-card__label {
        display: inline-flex;
        align-items: center;
        gap: var(--spacing-xs);
      }
      .stat-card__label .pi {
        color: var(--brand-primary);
      }

      /* Riciclo */
      .recycling {
        margin-top: var(--spacing-lg);
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }
      .recycling__label {
        margin: 0 0 var(--spacing-sm);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .recycling__label strong {
        color: var(--text-primary);
      }

      /* Andamento */
      .trend-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-base);
        margin: 0;
      }
      .trend-item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        padding: var(--spacing-base);
        background: var(--color-gray-50);
        border-radius: var(--radius-md);
      }
      .trend-item__label {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        font-weight: var(--font-weight-medium);
      }
      .trend-item__value {
        font-family: var(--font-display);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        margin: 0;
        line-height: 1.1;
      }
      /* Stato reale (direzione crescita): colore semantico mantenuto */
      .trend-item__value--up {
        color: var(--color-success);
      }
      .trend-item__value--down {
        color: var(--color-danger);
      }
      /* Valore neutro: la previsione non rappresenta uno stato/soglia */
      .trend-item__value--accent {
        color: var(--text-primary);
      }

      /* Metriche */
      .metric-block {
        margin-bottom: var(--spacing-lg);
      }
      .metric-block__label {
        display: block;
        margin-bottom: var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-weight: var(--font-weight-medium);
      }
      .metric-pair {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-base);
      }
      .metric-pair__item {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .metric-pair__label {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
      }
      .metric-pair__value {
        font-family: var(--font-display);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-bold);
        color: var(--text-primary);
        line-height: 1.1;
      }
      /* Valori KPI neutri di default: sono conteggi, non stati/soglie */
      .metric-pair__value--success {
        color: var(--text-primary);
      }
      .metric-pair__value--warning {
        color: var(--text-primary);
      }
      .metric-pair__value--accent {
        color: var(--text-primary);
      }

      /* Liste classifica */
      .rank-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .rank-list__item {
        display: flex;
        align-items: center;
        gap: var(--spacing-base);
        padding: var(--spacing-md);
        background: var(--color-gray-50);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
      }
      .rank-list__rank {
        flex: 0 0 auto;
        width: 2rem;
        height: 2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--radius-full);
        /* teal-700 per 5.47:1 col numero bianco (AA). */
        background: var(--brand-primary-dark);
        color: var(--text-inverse);
        font-family: var(--font-display);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-sm);
      }
      .rank-list__label {
        flex: 1 1 auto;
        min-width: 0;
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        color: var(--text-primary);
        overflow-wrap: anywhere;
      }

      .mt-4 {
        margin-top: var(--spacing-lg);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mb-3 {
        margin-bottom: var(--spacing-md);
      }

      @media (max-width: 576px) {
        .trend-grid {
          grid-template-columns: 1fr;
        }
        .metric-pair {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class DashboardPageComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService)
  private readonly messageService = inject(MessageService)

  protected readonly isLoading = signal(false)
  protected readonly dashboard = signal<DashboardData | null>(null)
  protected readonly error = signal<string | null>(null)

  // Colore neutro leggibile (WCAG AA) per tick/legenda/titoli assi -> --text-secondary
  private readonly axisTextColor = '#475569'
  private readonly axisGridColor = '#e2e8f0'

  protected readonly chartOptions = {
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: this.axisTextColor,
        },
      },
    },
  }

  protected readonly barChartOptions = {
    ...this.chartOptions,
    indexAxis: 'y' as const,
    scales: {
      x: {
        ticks: { color: this.axisTextColor },
        grid: { color: this.axisGridColor },
        title: { color: this.axisTextColor },
      },
      y: {
        ticks: { color: this.axisTextColor },
        grid: { color: this.axisGridColor },
        title: { color: this.axisTextColor },
      },
    },
  }

  // Computed values
  protected readonly growthPercentage = computed(() => {
    const data = this.dashboard()
    return data ? data.trends.monthOverMonth.percentage : 0
  })

  protected readonly completionRate = computed(() => {
    const data = this.dashboard()
    if (!data || data.overview.totalFIRs === 0) return 0
    return data.overview.completedFIRs / data.overview.totalFIRs
  })

  protected readonly statusChartData = computed(() => {
    const data = this.dashboard()
    if (!data) return {}

    return {
      labels: Object.keys(data.status.breakdown),
      datasets: [
        {
          data: Object.values(data.status.breakdown),
          // Palette semantica: info / success / warning / danger
          backgroundColor: ['#1d4ed8', '#15803d', '#b45309', '#b91c1c'],
        },
      ],
    }
  })

  // True quando il grafico "Stato dei FIR" ha almeno un valore > 0
  protected readonly hasStatusData = computed(() => {
    const data = this.dashboard()
    if (!data) return false
    return Object.values(data.status.breakdown).some(v => (v as number) > 0)
  })

  protected readonly destinationChartData = computed(() => {
    const data = this.dashboard()
    if (!data) return {}

    return {
      labels: ['Recupero', 'Smaltimento'],
      datasets: [
        {
          data: [data.waste.byDestination.recovery.count, data.waste.byDestination.disposal.count],
          // Palette semantica: success (recupero) / warning (smaltimento)
          backgroundColor: ['#15803d', '#b45309'],
        },
      ],
    }
  })

  // True quando il grafico "Destinazione rifiuti" ha almeno un valore > 0
  protected readonly hasDestinationData = computed(() => {
    const data = this.dashboard()
    if (!data) return false
    return data.waste.byDestination.recovery.count + data.waste.byDestination.disposal.count > 0
  })

  protected readonly cerChartData = computed(() => {
    const data = this.dashboard()
    if (!data) return {}

    const top10 = data.waste.byCERCode.slice(0, 10)

    return {
      labels: top10.map(w => w.cerCode),
      datasets: [
        {
          label: 'Quantità (kg)',
          data: top10.map(w => w.totalQuantity),
          // Colore brand primario (scuro, contrasto adeguato)
          backgroundColor: '#0f766e',
        },
      ],
    }
  })

  // True quando il grafico "Top 10 codici CER" ha almeno una voce
  protected readonly hasCerData = computed(() => {
    const data = this.dashboard()
    return !!data && data.waste.byCERCode.length > 0
  })

  ngOnInit(): void {
    this.loadDashboard()
  }

  protected async loadDashboard(): Promise<void> {
    this.isLoading.set(true)
    this.error.set(null)

    try {
      const data = await this.dashboardService.getDashboard().toPromise()
      this.dashboard.set(data || null)
    } catch (error) {
      console.error('Failed to load dashboard', error)
      this.error.set('Impossibile caricare i dati del dashboard. Riprova più tardi.')
      this.messageService.add({
        severity: 'error',
        summary: 'Errore',
        detail: 'Impossibile caricare i dati del dashboard',
      })
    } finally {
      this.isLoading.set(false)
    }
  }

  protected exportCSV(): void {
    this.dashboardService.downloadExport('csv')
    this.messageService.add({
      severity: 'success',
      summary: 'Export Avviato',
      detail: 'Il download del CSV inizierà a breve',
    })
  }

  protected formatWeight(kg: number): string {
    return (kg / 1000).toFixed(1)
  }

  protected complianceLabel(level: string): string {
    const labels: Record<string, string> = {
      EXCELLENT: 'Eccellente',
      GOOD: 'Buona',
      NEEDS_IMPROVEMENT: 'Da migliorare',
      CRITICAL: 'Critica',
    }
    return labels[level] || level
  }

  protected getComplianceSeverity(level: string): 'success' | 'info' | 'warning' | 'danger' {
    const severities: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
      EXCELLENT: 'success',
      GOOD: 'info',
      NEEDS_IMPROVEMENT: 'warning',
      CRITICAL: 'danger',
    }
    return severities[level] || 'info'
  }
}
