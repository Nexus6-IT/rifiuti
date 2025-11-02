import { Component, OnInit, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AutoCompleteModule, AutoCompleteCompleteEvent, AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { TableModule } from 'primeng/table';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { CheckboxModule } from 'primeng/checkbox';
import { CerService } from './cer.service';
import { CER, CERSearchResult } from '../../shared/models/cer.model';

@Component({
  selector: 'app-cer-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AutoCompleteModule,
    TableModule,
    CardModule,
    ButtonModule,
    TagModule,
    InputTextModule,
    DropdownModule,
    CheckboxModule
  ],
  template: `
    <div class="cer-search">
      <p-card *ngIf="!compactMode">
        <ng-template pTemplate="header">
          <div class="p-3">
            <h2>Ricerca Codici CER</h2>
            <p class="text-muted">Catalogo Europeo dei Rifiuti</p>
          </div>
        </ng-template>

        <!-- Search Filters -->
        <div class="grid mb-3">
          <div class="col-12 md:col-6">
            <label class="block mb-2">Cerca per Codice o Descrizione</label>
            <p-autoComplete
              [(ngModel)]="selectedCER"
              [suggestions]="filteredCERs"
              (completeMethod)="searchCER($event)"
              field="description"
              [dropdown]="true"
              [minLength]="2"
              placeholder="es. 150101 o carta"
              styleClass="w-full"
              inputStyleClass="w-full"
              (onSelect)="onCERSelect($event)"
            >
              <ng-template let-cer pTemplate="item">
                <div class="flex justify-content-between align-items-center w-full">
                  <div>
                    <strong>{{ cer.code }}</strong> - {{ cer.description }}
                  </div>
                  <p-tag
                    *ngIf="cer.isPericoloso"
                    value="Pericoloso"
                    severity="danger"
                    [rounded]="true"
                  />
                </div>
              </ng-template>
            </p-autoComplete>
          </div>

          <div class="col-12 md:col-3">
            <label class="block mb-2">Categoria</label>
            <p-dropdown
              [options]="categoryOptions"
              [(ngModel)]="selectedCategory"
              placeholder="Tutte"
              [showClear]="true"
              (onChange)="onFilterChange()"
              styleClass="w-full"
            />
          </div>

          <div class="col-12 md:col-3 flex align-items-end">
            <div class="field-checkbox">
              <p-checkbox
                [(ngModel)]="onlyPericolosi"
                [binary]="true"
                inputId="pericolosi"
                (onChange)="onFilterChange()"
              />
              <label for="pericolosi" class="ml-2">Solo pericolosi</label>
            </div>
          </div>
        </div>

        <!-- CER Table -->
        <p-table
          [value]="cerList"
          [loading]="loading"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords"
          [lazy]="true"
          (onLazyLoad)="loadCERList($event)"
          responsiveLayout="scroll"
          [rowHover]="true"
          selectionMode="single"
          [(selection)]="selectedCERFromTable"
          (onRowSelect)="onRowSelect($event)"
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 120px">Codice</th>
              <th>Descrizione</th>
              <th style="width: 150px">Categoria</th>
              <th style="width: 120px" class="text-center">Pericoloso</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-cer>
            <tr [pSelectableRow]="cer">
              <td><strong>{{ cer.code }}</strong></td>
              <td>{{ cer.description }}</td>
              <td>{{ cer.category }}</td>
              <td class="text-center">
                <p-tag
                  *ngIf="cer.isPericoloso"
                  value="Sì"
                  severity="danger"
                  [rounded]="true"
                />
                <span *ngIf="!cer.isPericoloso">-</span>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4" class="text-center">Nessun codice CER trovato</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Compact Mode (for use in forms) -->
      <div *ngIf="compactMode" class="compact-search">
        <label *ngIf="label" class="block mb-2">{{ label }}</label>
        <p-autoComplete
          [(ngModel)]="selectedCER"
          [suggestions]="filteredCERs"
          (completeMethod)="searchCER($event)"
          field="description"
          [dropdown]="true"
          [minLength]="2"
          [placeholder]="placeholder"
          styleClass="w-full"
          inputStyleClass="w-full"
          (onSelect)="onCERSelect($event)"
          [required]="required"
        >
          <ng-template let-cer pTemplate="item">
            <div class="flex justify-content-between align-items-center w-full">
              <div>
                <strong>{{ cer.code }}</strong> - {{ cer.description }}
              </div>
              <p-tag
                *ngIf="cer.isPericoloso"
                value="Pericoloso"
                severity="danger"
                [rounded]="true"
              />
            </div>
          </ng-template>
        </p-autoComplete>
      </div>
    </div>
  `,
  styles: [`
    .cer-search {
      max-width: 1400px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 1rem;
    }

    .col-12 { grid-column: span 12; }
    .col-6 { grid-column: span 6; }
    .col-3 { grid-column: span 3; }

    @media (min-width: 768px) {
      .md\\:col-6 { grid-column: span 6; }
      .md\\:col-3 { grid-column: span 3; }
    }

    .text-muted {
      color: #6c757d;
      margin: 0;
    }

    :host ::ng-deep {
      .p-autocomplete {
        width: 100%;
      }

      .p-autocomplete-input {
        width: 100%;
      }

      .p-datatable .p-datatable-tbody > tr.p-selectable-row:hover {
        cursor: pointer;
      }
    }
  `]
})
export class CerSearchComponent implements OnInit {
  @Input() compactMode = false;
  @Input() label = 'Codice CER';
  @Input() placeholder = 'Cerca codice CER...';
  @Input() required = false;
  @Output() cerSelected = new EventEmitter<CERSearchResult>();

  cerList: CER[] = [];
  filteredCERs: CERSearchResult[] = [];
  selectedCER: CERSearchResult | null = null;
  selectedCERFromTable: CER | null = null;
  selectedCategory: string | null = null;
  onlyPericolosi = false;

  loading = false;
  totalRecords = 0;
  pageSize = 20;
  currentPage = 1;

  categoryOptions = [
    { label: 'Carta e Cartone', value: 'CARTA' },
    { label: 'Plastica', value: 'PLASTICA' },
    { label: 'Vetro', value: 'VETRO' },
    { label: 'Metalli', value: 'METALLI' },
    { label: 'Legno', value: 'LEGNO' },
    { label: 'Tessili', value: 'TESSILI' },
    { label: 'Rifiuti Urbani', value: 'URBANI' },
    { label: 'Costruzione e Demolizione', value: 'COSTRUZIONE' },
    { label: 'Rifiuti Chimici', value: 'CHIMICI' },
    { label: 'Rifiuti Sanitari', value: 'SANITARI' }
  ];

  constructor(private cerService: CerService) {}

  ngOnInit(): void {
    if (!this.compactMode) {
      this.loadCERList({ first: 0, rows: this.pageSize });
    }
  }

  loadCERList(event: any): void {
    this.loading = true;
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    let observable;
    if (this.onlyPericolosi) {
      observable = this.cerService.getCERPericolosi(page, event.rows);
    } else if (this.selectedCategory) {
      observable = this.cerService.getCERByCategory(this.selectedCategory, page, event.rows);
    } else {
      observable = this.cerService.getCERList(page, event.rows);
    }

    observable.subscribe({
      next: (response) => {
        this.cerList = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  searchCER(event: AutoCompleteCompleteEvent): void {
    const query = event.query;
    if (query.length < 2) {
      this.filteredCERs = [];
      return;
    }

    this.cerService.searchCER(query).subscribe({
      next: (results) => {
        this.filteredCERs = results;
      },
      error: () => {
        this.filteredCERs = [];
      }
    });
  }

  onCERSelect(event: AutoCompleteSelectEvent): void {
    this.cerSelected.emit(event.value);
  }

  onRowSelect(event: any): void {
    const cer = event.data as CER;
    const searchResult: CERSearchResult = {
      code: cer.code,
      description: cer.description,
      isPericoloso: cer.isPericoloso
    };
    this.cerSelected.emit(searchResult);
  }

  onFilterChange(): void {
    this.loadCERList({ first: 0, rows: this.pageSize });
  }
}
