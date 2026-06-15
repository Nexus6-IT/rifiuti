import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ChartModule } from 'primeng/chart';
import { FirService } from '../fir/fir.service';
import { FIR, FIRStato } from '../../shared/models/fir.model';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ErrorStateComponent } from '../../shared/components/error-state.component';

interface DashboardStats {
  totalFIR: number;
  firInTransito: number;
  firConsegnati: number;
  firBozza: number;
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
    ErrorStateComponent
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

      <!-- Stato di caricamento KPI -->
      <ng-container *ngIf="loading && recentFIR.length === 0">
        <div class="stat-grid" aria-busy="true">
          <span class="sr-only">Caricamento statistiche in corso</span>
          <app-skeleton-loader *ngFor="let _ of [1,2,3,4]" variant="stats" [repeat]="1" />
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
            <span class="stat-card__value stat-card__value--warning">{{ stats.firInTransito }}</span>
          </article>

          <article class="stat-card">
            <span class="stat-card__label">
              <i class="pi pi-check-circle" aria-hidden="true"></i> Consegnati
            </span>
            <span class="stat-card__value stat-card__value--success">{{ stats.firConsegnati }}</span>
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
                  <td><span class="font-semibold">{{ fir.numeroProgressivo || 'N/A' }}</span></td>
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
            *ngIf="!loading"
            type="doughnut"
            [data]="chartData"
            [options]="chartOptions"
            role="img"
            aria-label="Grafico a ciambella che mostra la distribuzione dei FIR per stato"
          />
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-grid {
      display: grid;
      gap: var(--spacing-lg);
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
    .stat-card__label .pi { color: var(--brand-primary); }
    .stat-card__value--warning { color: var(--brand-secondary); }
    .stat-card__value--success { color: var(--brand-primary); }

    .chart-skeleton {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: var(--spacing-2xl);
    }

    .mt-4 { margin-top: var(--spacing-lg); }
  `]
})
export class DashboardComponent implements OnInit {
  stats: DashboardStats = {
    totalFIR: 0,
    firInTransito: 0,
    firConsegnati: 0,
    firBozza: 0
  };

  recentFIR: FIR[] = [];
  loading = false;
  error = '';

  chartData: any;
  chartOptions: any;

  constructor(private firService: FirService) {}

  ngOnInit(): void {
    this.loadDashboardData();
    this.initChart();
  }

  loadDashboardData(): void {
    this.loading = true;
    this.error = '';
    this.firService.getFIRList(1, 5).subscribe({
      next: (response) => {
        this.recentFIR = response.items;
        this.calculateStats(response.items);
        this.updateChartData();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Si è verificato un errore nel caricamento dei dati. Riprova più tardi.';
      }
    });
  }

  calculateStats(firList: FIR[]): void {
    this.stats.totalFIR = firList.length;
    this.stats.firInTransito = firList.filter(f => f.stato === FIRStato.IN_TRANSITO).length;
    this.stats.firConsegnati = firList.filter(f => f.stato === FIRStato.CONSEGNATO).length;
    this.stats.firBozza = firList.filter(f => f.stato === FIRStato.BOZZA).length;
  }

  initChart(): void {
    this.chartOptions = {
      plugins: {
        legend: {
          position: 'bottom'
        }
      }
    };
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
            0  // Count annullato separately if needed
          ],
          backgroundColor: ['#6b7770', '#0e7490', '#b45309', '#15803d', '#b91c1c']
        }
      ]
    };
  }

  getStatoSeverity(stato: FIRStato): "success" | "info" | "warning" | "danger" | "secondary" | "contrast" | undefined {
    const severityMap: Record<FIRStato, "success" | "info" | "warning" | "danger" | "secondary"> = {
      [FIRStato.BOZZA]: 'secondary',
      [FIRStato.EMESSO]: 'info',
      [FIRStato.IN_TRANSITO]: 'warning',
      [FIRStato.CONSEGNATO]: 'success',
      [FIRStato.ANNULLATO]: 'danger'
    };
    return severityMap[stato];
  }
}
