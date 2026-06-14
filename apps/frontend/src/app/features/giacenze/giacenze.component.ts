import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
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
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    MessageModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="giacenze-page" style="max-width: 1200px; margin: 0 auto;">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3 flex justify-content-between align-items-center">
            <div>
              <h2>Giacenze e deposito temporaneo</h2>
              <p class="text-muted">Riepilogo delle giacenze per codice CER e controllo dei limiti di deposito temporaneo</p>
            </div>
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [text]="true"
              [loading]="loading()"
              (onClick)="reload()"
            ></p-button>
          </div>
        </ng-template>

        <!-- Stato di errore -->
        <p-message
          *ngIf="error()"
          severity="error"
          [text]="error()!"
          styleClass="w-full mb-3"
        ></p-message>

        <!-- Stato di caricamento -->
        <div *ngIf="loading()" class="flex justify-content-center p-5">
          <p-progressSpinner strokeWidth="4" [style]="{ width: '48px', height: '48px' }"></p-progressSpinner>
        </div>

        <ng-container *ngIf="!loading() && !error()">
          <!-- Alert deposito temporaneo -->
          <div class="mt-2 mb-4">
            <h3 class="mb-2">Alert deposito temporaneo</h3>

            <p-message
              *ngIf="!alerts().length"
              severity="success"
              text="Nessun codice CER supera le soglie di deposito temporaneo."
              styleClass="w-full"
            ></p-message>

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
          </div>

          <!-- Tabella giacenze -->
          <h3 class="mb-2">Giacenze per codice CER</h3>
          <p-table
            [value]="giacenze()"
            styleClass="p-datatable-sm"
            responsiveLayout="scroll"
            [rowHover]="true"
          >
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 140px">CER</th>
                <th class="text-right">Carico (kg)</th>
                <th class="text-right">Scarico (kg)</th>
                <th class="text-right">Giacenza (kg)</th>
                <th style="width: 180px">Carico più vecchio</th>
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
                <td colspan="5" class="text-center">Nessuna giacenza registrata.</td>
              </tr>
            </ng-template>
          </p-table>
        </ng-container>
      </p-card>
    </div>
  `,
  styles: [
    `
      .text-muted {
        color: #6c757d;
        margin: 0;
      }

      .alert-banner {
        border: 1px solid var(--surface-border, #dee2e6);
        border-left: 4px solid var(--yellow-500, #f59e0b);
        border-radius: 6px;
        padding: 0.75rem 1rem;
        background: var(--surface-50, #fafafa);
      }

      .alert-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
      }

      .alert-cer {
        font-size: 1rem;
      }

      .alert-qty {
        color: #6c757d;
      }

      .alert-tags {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .alert-days {
        color: #6c757d;
        font-size: 0.875rem;
      }

      .text-right {
        text-align: right;
      }

      .text-center {
        text-align: center;
      }
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
