import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ToastService } from '../../core/services/toast.service'
import { Anomaly, AnomalySeverity, AnomalyService, AnomalyType } from './anomaly.service'

type TagSeverity = 'success' | 'info' | 'warning' | 'danger' | undefined

/**
 * Pagina Anomalie: rilevamento automatico di incongruenze su FIR e movimenti
 * (CER non in catalogo, quantità anomale, descrizioni mancanti, giacenze impossibili).
 * Consuma GET /anomaly. Filtri (severità/tipo) applicati lato client.
 */
@Component({
  selector: 'app-anomaly',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DropdownModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Anomalie</h1>
          <p class="page-subtitle">Rilevamento automatico di incongruenze su FIR e movimenti</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="load()"
            ariaLabel="Ricalcola le anomalie"
          ></p-button>
        </div>
      </header>

      <!-- KPI per gravità -->
      <div *ngIf="!loading() && !error() && loaded()" class="stat-grid mb-4">
        <div class="stat-card stat-card--danger">
          <span class="stat-card__label">Gravità alta</span>
          <span class="stat-card__value">{{ countBySeverity('HIGH') | number }}</span>
          <span class="stat-card__hint">richiedono intervento</span>
        </div>
        <div class="stat-card stat-card--warning">
          <span class="stat-card__label">Gravità media</span>
          <span class="stat-card__value">{{ countBySeverity('MEDIUM') | number }}</span>
          <span class="stat-card__hint">da verificare</span>
        </div>
        <div class="stat-card stat-card--info">
          <span class="stat-card__label">Gravità bassa</span>
          <span class="stat-card__value">{{ countBySeverity('LOW') | number }}</span>
          <span class="stat-card__hint">segnalazioni minori</span>
        </div>
      </div>

      <!-- Filtri -->
      <section
        class="surface-card mb-4"
        *ngIf="!loading() && !error()"
        aria-label="Filtri anomalie"
      >
        <div class="grid formgrid" style="align-items: end;">
          <div class="field col-12 md:col-4">
            <label for="anomaly-severity" class="block mb-2">Gravità</label>
            <p-dropdown
              inputId="anomaly-severity"
              [options]="severityOptions"
              [(ngModel)]="selectedSeverity"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              placeholder="Tutte"
              styleClass="w-full"
              ariaLabel="Filtra per gravità"
              (onChange)="applyFilters()"
            ></p-dropdown>
          </div>
          <div class="field col-12 md:col-4">
            <label for="anomaly-type" class="block mb-2">Tipo</label>
            <p-dropdown
              inputId="anomaly-type"
              [options]="typeOptions"
              [(ngModel)]="selectedType"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              placeholder="Tutti"
              styleClass="w-full"
              ariaLabel="Filtra per tipo di anomalia"
              (onChange)="applyFilters()"
            ></p-dropdown>
          </div>
          <div class="field col-12 md:col-4 flex align-items-end">
            <span class="text-tertiary" role="status">{{ filtered().length }} anomalie</span>
          </div>
        </div>
      </section>

      <!-- Loading -->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner
            styleClass="w-4rem h-4rem"
            strokeWidth="4"
            ariaLabel="Caricamento anomalie"
          ></p-progressSpinner>
        </div>
      </section>

      <!-- Error -->
      <section *ngIf="error() && !loading()" class="surface-card">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger"
            aria-hidden="true"
          ></i>
          <span class="empty-state__title">Impossibile caricare le anomalie</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="load()"
          ></p-button>
        </div>
      </section>

      <!-- Empty -->
      <section
        *ngIf="!loading() && !error() && loaded() && filtered().length === 0"
        class="surface-card"
      >
        <div class="empty-state">
          <i
            class="pi pi-check-circle empty-state__icon empty-state__icon--success"
            aria-hidden="true"
          ></i>
          <span class="empty-state__title">Nessuna anomalia rilevata</span>
          <p>Nessuna anomalia per i criteri selezionati.</p>
        </div>
      </section>

      <!-- Tabella -->
      <section *ngIf="!loading() && !error() && filtered().length > 0" class="surface-card">
        <div class="table-responsive">
          <p-table
            [value]="filtered()"
            styleClass="p-datatable-sm"
            [paginator]="filtered().length > 10"
            [rows]="10"
            [rowHover]="true"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" style="width: 120px">Gravità</th>
                <th scope="col" style="width: 200px">Tipo</th>
                <th scope="col">Messaggio</th>
                <th scope="col" style="width: 160px">FIR</th>
                <th scope="col" style="width: 120px">CER</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-a>
              <tr>
                <td>
                  <p-tag
                    [value]="severityLabel(a.severity)"
                    [severity]="severityTag(a.severity)"
                    [rounded]="true"
                  ></p-tag>
                </td>
                <td>{{ typeLabel(a.type) }}</td>
                <td>{{ a.message }}</td>
                <td>{{ a.firNumber || '-' }}</td>
                <td>{{ a.cerCode || '-' }}</td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .empty-state__icon--danger {
        color: var(--color-danger);
      }
      .empty-state__icon--success {
        color: var(--color-success);
      }
      .stat-card--danger {
        border-color: var(--color-danger);
      }
      .stat-card--danger .stat-card__value {
        color: var(--color-danger);
      }
      .stat-card--warning {
        border-color: var(--color-warning);
      }
      .stat-card--warning .stat-card__value {
        color: var(--color-warning);
      }
      .stat-card--info {
        border-color: var(--color-info);
      }
      .stat-card--info .stat-card__value {
        color: var(--color-info);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
    `,
  ],
})
export class AnomalyComponent implements OnInit {
  private readonly anomalyService = inject(AnomalyService)
  private readonly toast = inject(ToastService)

  readonly anomalies = signal<Anomaly[]>([])
  readonly loading = signal(false)
  readonly loaded = signal(false)
  readonly error = signal(false)

  selectedSeverity: AnomalySeverity | null = null
  selectedType: AnomalyType | null = null

  // Trigger per ricalcolare il computed sui filtri (ngModel non è signal-based).
  private readonly filterTick = signal(0)

  readonly filtered = computed<Anomaly[]>(() => {
    this.filterTick()
    return this.anomalies().filter(
      a =>
        (!this.selectedSeverity || a.severity === this.selectedSeverity) &&
        (!this.selectedType || a.type === this.selectedType)
    )
  })

  readonly severityOptions = [
    { label: 'Alta', value: 'HIGH' as AnomalySeverity },
    { label: 'Media', value: 'MEDIUM' as AnomalySeverity },
    { label: 'Bassa', value: 'LOW' as AnomalySeverity },
  ]

  readonly typeOptions = [
    { label: 'CER non in catalogo', value: 'INVALID_CER' as AnomalyType },
    { label: 'Quantità non positiva', value: 'NON_POSITIVE_QUANTITY' as AnomalyType },
    { label: 'Quantità eccessiva', value: 'EXCESSIVE_QUANTITY' as AnomalyType },
    { label: 'Descrizione mancante', value: 'MISSING_DESCRIPTION' as AnomalyType },
    { label: 'Giacenza impossibile', value: 'NEGATIVE_STOCK' as AnomalyType },
  ]

  ngOnInit(): void {
    this.load()
  }

  load(): void {
    this.loading.set(true)
    this.error.set(false)
    this.anomalyService.detect().subscribe({
      next: data => {
        this.anomalies.set(data || [])
        this.loaded.set(true)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.error.set(true)
        this.toast.error('Errore nel caricamento delle anomalie')
      },
    })
  }

  applyFilters(): void {
    this.filterTick.update(v => v + 1)
  }

  /** Conta le anomalie (su tutto il set, non filtrato) per livello di gravità. */
  countBySeverity(severity: AnomalySeverity): number {
    return this.anomalies().filter(a => a.severity === severity).length
  }

  severityTag(severity: AnomalySeverity): TagSeverity {
    switch (severity) {
      case 'HIGH':
        return 'danger'
      case 'MEDIUM':
        return 'warning'
      case 'LOW':
        return 'info'
      default:
        return undefined
    }
  }

  severityLabel(severity: AnomalySeverity): string {
    return this.severityOptions.find(o => o.value === severity)?.label ?? severity
  }

  typeLabel(type: AnomalyType): string {
    return this.typeOptions.find(o => o.value === type)?.label ?? type
  }
}
