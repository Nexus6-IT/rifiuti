import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastService } from '../../core/services/toast.service';
import { MudService, MudVersion } from './mud.service';

/**
 * Pagina MUD: genera il report annuale e scarica il file telematico
 * (versionato per anno) conforme al tracciato Unioncamere.
 */
@Component({
  selector: 'app-mud',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, DropdownModule, TableModule, TagModule],
  template: `
    <div class="mud-page" style="max-width: 900px; margin: 0 auto;">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3">
            <h2>MUD — Modello Unico di Dichiarazione Ambientale</h2>
            <p class="text-muted">Report annuale ed export telematico (versionato per anno)</p>
          </div>
        </ng-template>

        <div class="grid mb-3" style="align-items: end;">
          <div class="col-12 md:col-4">
            <label class="block mb-2">Anno di dichiarazione</label>
            <p-dropdown
              [options]="years()"
              [(ngModel)]="selectedYear"
              optionLabel="label"
              optionValue="value"
              styleClass="w-full"
              placeholder="Seleziona anno"
            ></p-dropdown>
            <small *ngIf="versionForSelected() as v" class="block mt-1">Tracciato: {{ v }}</small>
          </div>
          <div class="col-12 md:col-8 flex gap-2">
            <p-button label="Genera report" icon="pi pi-chart-bar" [loading]="loadingReport()" (onClick)="loadReport()"></p-button>
            <p-button label="Scarica file MUD" icon="pi pi-download" severity="success" [loading]="downloading()" (onClick)="download()"></p-button>
          </div>
        </div>

        <div *ngIf="!supportedYears().length" class="mt-2">
          <p-tag severity="warning" value="Nessun tracciato disponibile"></p-tag>
        </div>

        <!-- Report -->
        <div *ngIf="report() as r" class="mt-4">
          <h3>Riepilogo {{ r.year }}</h3>
          <div class="grid">
            <div class="col-6 md:col-3"><strong>Prodotto:</strong> {{ r.totals?.produced | number }} kg</div>
            <div class="col-6 md:col-3"><strong>Recupero:</strong> {{ r.totals?.recovery | number }} kg</div>
            <div class="col-6 md:col-3"><strong>Smaltimento:</strong> {{ r.totals?.disposal | number }} kg</div>
            <div class="col-6 md:col-3"><strong>Tasso recupero:</strong> {{ (r.totals?.recyclingRate * 100) | number: '1.0-1' }}%</div>
          </div>

          <p-table [value]="r.wasteProduced || []" styleClass="p-datatable-sm mt-3">
            <ng-template pTemplate="header">
              <tr><th>CER</th><th class="text-right">Quantità (kg)</th><th class="text-right">N. FIR</th></tr>
            </ng-template>
            <ng-template pTemplate="body" let-w>
              <tr><td>{{ w.cerCode }}</td><td class="text-right">{{ w.totalQuantity | number }}</td><td class="text-right">{{ w.count }}</td></tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="3">Nessun rifiuto registrato per l'anno selezionato.</td></tr>
            </ng-template>
          </p-table>
        </div>
      </p-card>
    </div>
  `,
})
export class MudComponent implements OnInit {
  private readonly mudService = inject(MudService);
  private readonly toast = inject(ToastService);

  readonly supportedYears = signal<MudVersion[]>([]);
  readonly report = signal<any | null>(null);
  readonly loadingReport = signal(false);
  readonly downloading = signal(false);

  selectedYear: number | null = null;

  years() {
    return this.supportedYears().map((v) => ({ label: String(v.year), value: v.year }));
  }

  versionForSelected(): string | null {
    return this.supportedYears().find((v) => v.year === this.selectedYear)?.version ?? null;
  }

  ngOnInit(): void {
    this.mudService.getVersions().subscribe({
      next: (res) => {
        this.supportedYears.set(res.versions || []);
        if (res.versions?.length) this.selectedYear = res.versions[0].year;
      },
      error: () => this.toast.error('Impossibile caricare le versioni MUD'),
    });
  }

  loadReport(): void {
    if (!this.selectedYear) return;
    this.loadingReport.set(true);
    this.mudService.getReport(this.selectedYear).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loadingReport.set(false);
      },
      error: () => {
        this.loadingReport.set(false);
        this.toast.error('Errore nella generazione del report MUD');
      },
    });
  }

  download(): void {
    if (!this.selectedYear) return;
    this.downloading.set(true);
    this.mudService.downloadExport(this.selectedYear).subscribe({
      next: (res) => {
        this.downloading.set(false);
        const blob = res.body as Blob;
        const filename = this.filenameFrom(res.headers.get('content-disposition')) || `MUD_${this.selectedYear}.txt`;
        this.triggerDownload(blob, filename);
        this.toast.success('File MUD generato');
      },
      error: () => {
        this.downloading.set(false);
        this.toast.error('Errore nel download del file MUD');
      },
    });
  }

  private filenameFrom(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const m = /filename="?([^"]+)"?/.exec(contentDisposition);
    return m ? m[1] : null;
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
