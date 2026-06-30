import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ToastService } from '../../core/services/toast.service'
import { EsgReport, EsgService } from './esg.service'

/**
 * Pagina ESG / CO2: indicatori ambientali aggregati del tenant.
 * Mostra tasso di recupero, kg deviati da discarica, CO2 evitata e i totali
 * prodotto/recupero/smaltimento, con dettaglio per codice CER.
 * Filtro periodo opzionale (data inizio/fine).
 */
@Component({
  selector: 'app-esg',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CalendarModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">ESG / CO2 — Indicatori ambientali</h1>
          <p class="page-subtitle">
            Tasso di recupero, rifiuti deviati da discarica e CO2 evitata, con dettaglio per codice
            CER
          </p>
        </div>
        <div class="page-actions">
          <p-tag
            *ngIf="report() as r"
            severity="info"
            [value]="
              r.period
                ? 'Periodo: ' +
                  (r.period.from | date: 'dd/MM/yyyy') +
                  ' — ' +
                  (r.period.to | date: 'dd/MM/yyyy')
                : 'Periodo: tutto lo storico'
            "
            icon="pi pi-calendar"
          ></p-tag>
        </div>
      </header>

      <!-- Filtro periodo -->
      <section class="surface-card mb-4" aria-label="Filtro per periodo">
        <div class="grid formgrid" style="align-items: end;">
          <div class="field col-12 md:col-4">
            <label for="esg-start" class="block mb-2">Data inizio</label>
            <p-calendar
              inputId="esg-start"
              [(ngModel)]="startDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [showButtonBar]="true"
              [maxDate]="endDate || undefined"
              placeholder="Tutto il periodo"
              styleClass="w-full"
              inputStyleClass="w-full"
              ariaLabel="Data inizio del periodo"
            ></p-calendar>
          </div>
          <div class="field col-12 md:col-4">
            <label for="esg-end" class="block mb-2">Data fine</label>
            <p-calendar
              inputId="esg-end"
              [(ngModel)]="endDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [showButtonBar]="true"
              [minDate]="startDate || undefined"
              placeholder="Tutto il periodo"
              styleClass="w-full"
              inputStyleClass="w-full"
              ariaLabel="Data fine del periodo"
            ></p-calendar>
          </div>
          <div class="field col-12 md:col-4 flex flex-wrap gap-2">
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [loading]="loading()"
              (onClick)="loadReport()"
              ariaLabel="Aggiorna il report con il periodo selezionato"
            ></p-button>
            <p-button
              label="Azzera filtro"
              icon="pi pi-filter-slash"
              [text]="true"
              [disabled]="loading()"
              (onClick)="clearFilter()"
              ariaLabel="Azzera il filtro per periodo"
            ></p-button>
          </div>
        </div>
      </section>

      <!-- Loading -->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner
            strokeWidth="4"
            [style]="{ width: '50px', height: '50px' }"
            ariaLabel="Caricamento report ESG"
          ></p-progressSpinner>
        </div>
      </section>

      <!-- Error -->
      <section *ngIf="!loading() && error()" class="surface-card">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger"
            aria-hidden="true"
          ></i>
          <span class="empty-state__title">Impossibile caricare il report ESG</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="loadReport()"
          ></p-button>
        </div>
      </section>

      <!-- Report -->
      <ng-container *ngIf="!loading() && !error() && report() as r">
        <!-- KPI principali -->
        <div class="stat-grid mb-3">
          <div class="stat-card">
            <span class="stat-card__label">Tasso di recupero</span>
            <span class="stat-card__value"
              >{{ r.totals.recyclingRate * 100 | number: '1.0-1' }}%</span
            >
            <span class="stat-card__hint">quota avviata a recupero</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Deviati da discarica</span>
            <span class="stat-card__value">{{ r.landfillDivertedKg | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg non conferiti in discarica</span>
          </div>
          <div class="stat-card stat-card--accent">
            <span class="stat-card__label">CO2 evitata</span>
            <span class="stat-card__value">{{ r.co2AvoidedKg | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg di CO2 equivalente</span>
          </div>
        </div>

        <!-- KPI secondari: totali -->
        <div class="stat-grid mb-4">
          <div class="stat-card stat-card--sub">
            <span class="stat-card__label">Prodotto</span>
            <span class="stat-card__value">{{ r.totals.producedKg | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg totali prodotti</span>
          </div>
          <div class="stat-card stat-card--sub">
            <span class="stat-card__label">Recupero</span>
            <span class="stat-card__value">{{ r.totals.recoveryKg | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg avviati a recupero</span>
          </div>
          <div class="stat-card stat-card--sub">
            <span class="stat-card__label">Smaltimento</span>
            <span class="stat-card__value">{{ r.totals.disposalKg | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg avviati a smaltimento</span>
          </div>
        </div>

        <!-- Dettaglio per CER -->
        <section class="surface-card">
          <h2 class="esg-section-title mb-3">Dettaglio per codice CER</h2>
          <div class="table-responsive">
            <p-table [value]="r.byCer" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">CER</th>
                  <th scope="col" class="text-right">Recupero (kg)</th>
                  <th scope="col" class="text-right">Smaltimento (kg)</th>
                  <th scope="col" class="text-right">CO2 evitata (kg)</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-row>
                <tr>
                  <td>
                    <strong>{{ row.cerCode }}</strong>
                  </td>
                  <td class="text-right">{{ row.recoveryKg | number: '1.0-0' }}</td>
                  <td class="text-right">{{ row.disposalKg | number: '1.0-0' }}</td>
                  <td class="text-right">{{ row.co2AvoidedKg | number: '1.0-0' }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="4">
                    <div class="empty-state">
                      <i class="pi pi-chart-line empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessun dato disponibile</span>
                      <p>Non risultano dati per il periodo selezionato.</p>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .esg-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .stat-card--accent {
        border-color: var(--brand-primary);
        background: var(--brand-primary-50);
      }
      .stat-card--sub .stat-card__value {
        font-size: var(--font-size-2xl);
      }
      .empty-state__icon--danger {
        color: var(--color-danger);
      }
      .text-right {
        text-align: right;
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
    `,
  ],
})
export class EsgComponent implements OnInit {
  private readonly esgService = inject(EsgService)
  private readonly toast = inject(ToastService)

  readonly report = signal<EsgReport | null>(null)
  readonly loading = signal(false)
  readonly error = signal(false)

  startDate: Date | null = null
  endDate: Date | null = null

  ngOnInit(): void {
    this.loadReport()
  }

  loadReport(): void {
    this.loading.set(true)
    this.error.set(false)

    this.esgService.getReport(this.toIso(this.startDate), this.toIso(this.endDate)).subscribe({
      next: r => {
        this.report.set(r)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.error.set(true)
        this.report.set(null)
        this.toast.error('Errore nel caricamento del report ESG')
      },
    })
  }

  clearFilter(): void {
    this.startDate = null
    this.endDate = null
    this.loadReport()
  }

  /** Converte una Date locale in stringa ISO yyyy-mm-dd (senza shift di fuso). */
  private toIso(date: Date | null): string | undefined {
    if (!date) return undefined
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
}
