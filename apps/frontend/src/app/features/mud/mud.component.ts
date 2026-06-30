import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ToastService } from '../../core/services/toast.service'
import { MudService, MudVersion } from './mud.service'

/**
 * Pagina MUD: genera il report annuale e scarica il file telematico
 * (versionato per anno) conforme al tracciato Unioncamere.
 */
@Component({
  selector: 'app-mud',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DropdownModule, TableModule, TagModule],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">MUD — Dichiarazione Ambientale</h1>
          <p class="page-subtitle">
            Report annuale ed export telematico, versionato per anno (tracciato Unioncamere)
          </p>
        </div>
      </header>

      <!-- Pannello selezione anno + azioni -->
      <section class="surface-card mb-4">
        <div class="mud-toolbar">
          <div class="mud-toolbar__field">
            <label for="mud-year" class="block mb-2">Anno di dichiarazione</label>
            <p-dropdown
              inputId="mud-year"
              [options]="years()"
              [(ngModel)]="selectedYear"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              placeholder="Seleziona anno"
              ariaLabel="Anno di dichiarazione"
              [disabled]="!supportedYears().length"
            ></p-dropdown>
          </div>
          <div class="mud-toolbar__actions">
            <p-button
              label="Genera report"
              icon="pi pi-chart-bar"
              [loading]="loadingReport()"
              [disabled]="!selectedYear"
              (onClick)="loadReport()"
              ariaLabel="Genera il report MUD per l'anno selezionato"
            ></p-button>
            <p-button
              label="Scarica file MUD"
              icon="pi pi-download"
              [outlined]="true"
              [loading]="downloading()"
              [disabled]="!selectedYear"
              (onClick)="download()"
              ariaLabel="Scarica il file telematico MUD per l'anno selezionato"
            ></p-button>
          </div>
        </div>
        <small *ngIf="versionForSelected() as v" class="block mt-1 text-tertiary"
          >Tracciato: {{ v }}</small
        >

        <div *ngIf="!supportedYears().length" class="mt-3">
          <p-tag
            severity="warning"
            value="Nessun tracciato disponibile"
            icon="pi pi-exclamation-triangle"
          ></p-tag>
        </div>
      </section>

      <!-- Report -->
      <ng-container *ngIf="report() as r">
        <h2 class="mud-section-title">Riepilogo {{ r.year }}</h2>

        <div class="stat-grid mb-4">
          <div class="stat-card">
            <span class="stat-card__label">Prodotto</span>
            <span class="stat-card__value">{{ r.totals?.produced | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg di rifiuto prodotto</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Recupero</span>
            <span class="stat-card__value">{{ r.totals?.recovery | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg avviati a recupero</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Smaltimento</span>
            <span class="stat-card__value">{{ r.totals?.disposal | number: '1.0-0' }}</span>
            <span class="stat-card__hint">kg avviati a smaltimento</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Tasso di recupero</span>
            <span class="stat-card__value"
              >{{ r.totals?.recyclingRate * 100 | number: '1.0-1' }}%</span
            >
            <span class="stat-card__hint">quota avviata a recupero</span>
          </div>
        </div>

        <section class="surface-card">
          <h3 class="mud-section-title mb-3">Rifiuti prodotti per codice CER</h3>
          <div class="table-responsive">
            <p-table [value]="r.wasteProduced || []" styleClass="p-datatable-sm" [rowHover]="true">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">CER</th>
                  <th scope="col" class="text-right">Quantità (kg)</th>
                  <th scope="col" class="text-right">N. FIR</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-w>
                <tr>
                  <td>
                    <strong>{{ w.cerCode }}</strong>
                  </td>
                  <td class="text-right">{{ w.totalQuantity | number: '1.0-0' }}</td>
                  <td class="text-right">{{ w.count }}</td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="3">
                    <div class="empty-state">
                      <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                      <span class="empty-state__title">Nessun rifiuto registrato</span>
                      <p>Non risultano rifiuti per l'anno selezionato.</p>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </section>
      </ng-container>

      <!-- Stato iniziale: nessun report ancora generato -->
      <section *ngIf="!report() && supportedYears().length" class="surface-card">
        <div class="empty-state">
          <i class="pi pi-file-export empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Nessun report generato</span>
          <p>Seleziona un anno e premi "Genera report" per visualizzare il riepilogo MUD.</p>
        </div>
      </section>
    </div>
  `,
  styles: [
    `
      .mud-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      /* Toolbar: dropdown anno + azioni allineati sulla linea del controllo (40px) */
      .mud-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--spacing-md);
      }
      .mud-toolbar__field {
        flex: 1 1 220px;
        min-width: 200px;
        max-width: 320px;
      }
      .mud-toolbar__actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
      }
      .mud-toolbar__field label {
        font-weight: var(--font-weight-medium);
      }
      @media (max-width: 576px) {
        .mud-toolbar__field {
          max-width: none;
          flex-basis: 100%;
        }
        .mud-toolbar__actions {
          width: 100%;
        }
        .mud-toolbar__actions .p-button {
          flex: 1 1 auto;
        }
      }
      .text-right {
        text-align: right;
      }
      .text-tertiary {
        color: var(--text-tertiary);
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
      .mt-3 {
        margin-top: var(--spacing-base);
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
    `,
  ],
})
export class MudComponent implements OnInit {
  private readonly mudService = inject(MudService)
  private readonly toast = inject(ToastService)

  readonly supportedYears = signal<MudVersion[]>([])
  readonly report = signal<any | null>(null)
  readonly loadingReport = signal(false)
  readonly downloading = signal(false)

  selectedYear: number | null = null

  years() {
    return this.supportedYears().map(v => ({ label: String(v.year), value: v.year }))
  }

  versionForSelected(): string | null {
    return this.supportedYears().find(v => v.year === this.selectedYear)?.version ?? null
  }

  ngOnInit(): void {
    this.mudService.getVersions().subscribe({
      next: res => {
        this.supportedYears.set(res.versions || [])
        if (res.versions?.length) this.selectedYear = res.versions[0].year
      },
      error: () => this.toast.error('Impossibile caricare le versioni MUD'),
    })
  }

  loadReport(): void {
    if (!this.selectedYear) return
    this.loadingReport.set(true)
    this.mudService.getReport(this.selectedYear).subscribe({
      next: r => {
        this.report.set(r)
        this.loadingReport.set(false)
      },
      error: () => {
        this.loadingReport.set(false)
        this.toast.error('Errore nella generazione del report MUD')
      },
    })
  }

  download(): void {
    if (!this.selectedYear) return
    this.downloading.set(true)
    this.mudService.downloadExport(this.selectedYear).subscribe({
      next: res => {
        this.downloading.set(false)
        const blob = res.body as Blob
        const filename =
          this.filenameFrom(res.headers.get('content-disposition')) ||
          `MUD_${this.selectedYear}.txt`
        this.triggerDownload(blob, filename)
        this.toast.success('File MUD generato')
      },
      error: () => {
        this.downloading.set(false)
        this.toast.error('Errore nel download del file MUD')
      },
    })
  }

  private filenameFrom(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null
    const m = /filename="?([^"]+)"?/.exec(contentDisposition)
    return m ? m[1] : null
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    window.URL.revokeObjectURL(url)
  }
}
