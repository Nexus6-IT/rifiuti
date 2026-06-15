import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ToastService } from '../../core/services/toast.service';
import {
  GiacenzeService,
  Giacenza,
  DepositoTemporaneoAlert,
  DepositoTemporaneoReason,
} from './giacenze.service';

/**
 * Pagina Giacenze e deposito temporaneo: mostra le giacenze aggregate per CER
 * e gli alert sui CER che superano le soglie del deposito temporaneo
 * (durata massima o quantità massima).
 */
@Component({
  selector: 'app-giacenze',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Giacenze e deposito temporaneo</h1>
          <p class="page-subtitle">Riepilogo delle giacenze per codice CER e controllo dei limiti di deposito temporaneo</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="reload()"
            ariaLabel="Aggiorna giacenze e alert"
          ></p-button>
        </div>
      </header>

      <!-- Stato di errore -->
      <section *ngIf="error()" class="surface-card mb-4">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon" aria-hidden="true" style="color: var(--color-danger);"></i>
          <span class="empty-state__title">{{ error() }}</span>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="reload()"></p-button>
        </div>
      </section>

      <!-- Stato di caricamento -->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner strokeWidth="4" [style]="{ width: '48px', height: '48px' }" ariaLabel="Caricamento giacenze"></p-progressSpinner>
        </div>
      </section>

      <ng-container *ngIf="!loading() && !error()">
        <!-- KPI giacenze totali -->
        <div class="stat-grid mb-4">
          <div class="stat-card">
            <span class="stat-card__label">Codici CER in giacenza</span>
            <span class="stat-card__value">{{ giacenze().length | number }}</span>
            <span class="stat-card__hint">codici con movimenti registrati</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Giacenza totale</span>
            <span class="stat-card__value">{{ totalGiacenzaKg() | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg attualmente in deposito</span>
          </div>
          <div class="stat-card" [class.stat-card--alert]="alerts().length">
            <span class="stat-card__label">Alert deposito temporaneo</span>
            <span class="stat-card__value">{{ alerts().length | number }}</span>
            <span class="stat-card__hint">codici oltre le soglie</span>
          </div>
        </div>

        <!-- Alert deposito temporaneo -->
        <section class="surface-card mb-4" aria-label="Alert deposito temporaneo">
          <h2 class="giacenze-section-title mb-3">Alert deposito temporaneo</h2>

          <div *ngIf="!alerts().length" class="empty-state" style="padding: var(--spacing-lg);">
            <i class="pi pi-check-circle empty-state__icon" aria-hidden="true" style="color: var(--color-success);"></i>
            <span class="empty-state__title">Nessun superamento soglie</span>
            <p>Nessun codice CER supera le soglie di deposito temporaneo.</p>
          </div>

          <div *ngFor="let alert of alerts()" class="alert-banner mb-2">
            <div class="alert-header">
              <span class="alert-cer"><strong>CER {{ alert.cerCode }}</strong></span>
              <span class="alert-qty">{{ alert.giacenzaKg | number: '1.0-2' }} kg in giacenza</span>
            </div>
            <div class="alert-tags">
              <p-tag
                *ngFor="let reason of alert.reasons"
                [value]="reasonLabel(reason)"
                [severity]="reasonSeverity(reason)"
                [icon]="reasonIcon(reason)"
              ></p-tag>
              <span *ngIf="alert.durationDays != null" class="alert-days">
                Giacenza da {{ alert.durationDays }} giorni
                <ng-container *ngIf="alert.oldestCaricoDate">
                  (dal {{ alert.oldestCaricoDate | date: 'dd/MM/yyyy' }})
                </ng-container>
              </span>
            </div>
          </div>
        </section>

        <!-- Tabella giacenze -->
        <section class="surface-card">
          <h2 class="giacenze-section-title mb-3">Giacenze per codice CER</h2>
          <div class="table-responsive">
            <p-table [value]="giacenze()" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" style="width: 140px">CER</th>
                  <th scope="col" class="text-right">Carico (kg)</th>
                  <th scope="col" class="text-right">Scarico (kg)</th>
                  <th scope="col" class="text-right">Giacenza (kg)</th>
                  <th scope="col" style="width: 180px">Carico più vecchio</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-g>
                <tr>
                  <td><strong>{{ g.cerCode }}</strong></td>
                  <td class="text-right">{{ g.caricoKg | number: '1.0-2' }}</td>
                  <td class="text-right">{{ g.scaricoKg | number: '1.0-2' }}</td>
                  <td class="text-right">
                    <strong>{{ g.giacenzaKg | number: '1.0-2' }}</strong>
                  </td>
                  <td>{{ g.oldestCaricoDate ? (g.oldestCaricoDate | date: 'dd/MM/yyyy') : '-' }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="5">
                    <div class="empty-state">
                      <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessuna giacenza</span>
                      <p>Non risultano movimenti di carico/scarico registrati.</p>
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
      .giacenze-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }

      .stat-card--alert {
        border-color: var(--color-warning);
        background: var(--color-warning-bg);
      }

      .alert-banner {
        border: 1px solid var(--surface-border);
        border-left: 4px solid var(--color-warning);
        border-radius: var(--radius-md);
        padding: var(--spacing-md) var(--spacing-base);
        background: var(--color-gray-50);
      }

      .alert-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-sm);
      }

      .alert-cer { font-size: var(--font-size-base); }
      .alert-qty { color: var(--text-secondary); }

      .alert-tags {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .alert-days {
        color: var(--text-tertiary);
        font-size: var(--font-size-sm);
      }

      .text-right { text-align: right; }
      .mb-4 { margin-bottom: var(--spacing-xl); }
      .mb-3 { margin-bottom: var(--spacing-base); }
      .mb-2 { margin-bottom: var(--spacing-sm); }
    `,
  ],
})
export class GiacenzeComponent implements OnInit {
  private readonly giacenzeService = inject(GiacenzeService);
  private readonly toast = inject(ToastService);

  readonly giacenze = signal<Giacenza[]>([]);
  readonly alerts = signal<DepositoTemporaneoAlert[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** True quando non ci sono né giacenze né alert (stato vuoto complessivo). */
  readonly isEmpty = computed(() => !this.giacenze().length && !this.alerts().length);

  /** Somma delle giacenze (kg) su tutti i codici CER. */
  readonly totalGiacenzaKg = computed(() =>
    this.giacenze().reduce((sum, g) => sum + (g.giacenzaKg ?? 0), 0),
  );

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    this.error.set(null);

    let pending = 2;
    const done = () => {
      if (--pending === 0) this.loading.set(false);
    };

    this.giacenzeService.getGiacenze().subscribe({
      next: (data) => {
        this.giacenze.set(data ?? []);
        done();
      },
      error: () => {
        this.error.set('Impossibile caricare le giacenze.');
        this.toast.error('Errore nel caricamento delle giacenze');
        done();
      },
    });

    this.giacenzeService.getDepositoTemporaneoAlerts().subscribe({
      next: (data) => {
        this.alerts.set(data ?? []);
        done();
      },
      error: () => {
        this.error.set('Impossibile caricare gli alert di deposito temporaneo.');
        this.toast.error('Errore nel caricamento degli alert di deposito temporaneo');
        done();
      },
    });
  }

  reasonLabel(reason: DepositoTemporaneoReason): string {
    return reason === 'DURATION' ? 'Durata superata' : 'Quantità superata';
  }

  reasonSeverity(reason: DepositoTemporaneoReason): 'warning' | 'danger' {
    return reason === 'DURATION' ? 'warning' : 'danger';
  }

  reasonIcon(reason: DepositoTemporaneoReason): string {
    return reason === 'DURATION' ? 'pi pi-clock' : 'pi pi-exclamation-triangle';
  }
}
