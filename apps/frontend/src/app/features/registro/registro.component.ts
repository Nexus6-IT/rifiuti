/**
 * Registro Cronologico di Carico/Scarico — Art. 190 D.Lgs 152/2006
 *
 * Pagina del registro operativo: mostra la lista dei movimenti e permette
 * la registrazione di un nuovo movimento (CARICO o SCARICO) tramite un
 * pannello laterale/dialog con form validato.
 *
 * Design system "B": slate + teal #0d9488, IBM Plex, griglia 8pt, WCAG 2.1 AA.
 */

import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DialogModule } from 'primeng/dialog';
import { SelectButtonModule } from 'primeng/selectbutton';
import { CalendarModule } from 'primeng/calendar';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { DropdownModule } from 'primeng/dropdown';
import { TooltipModule } from 'primeng/tooltip';
import { PaginatorModule } from 'primeng/paginator';
import { ToastService } from '../../core/services/toast.service';
import {
  RegistroService,
  Movimento,
  PaginatedMovimenti,
  TipoMovimento,
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
  CAUSALE_LABELS,
  STATI_FISICI,
  CausaleMovimento,
} from './registro.service';

interface DropdownOption<T> { label: string; value: T }

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    DialogModule,
    SelectButtonModule,
    CalendarModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    TooltipModule,
    PaginatorModule,
  ],
  providers: [DatePipe],
  template: `
    <div class="page">
      <!-- Intestazione -------------------------------------------------------->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Registro cronologico C/S</h1>
          <p class="page-subtitle">
            Registro di carico e scarico rifiuti — art. 190 D.Lgs 152/2006 · DM 59/2023
          </p>
        </div>
        <div class="page-actions">
          <p-button
            label="Registra movimento"
            icon="pi pi-plus"
            (onClick)="apriForm()"
            ariaLabel="Registra un nuovo movimento di carico o scarico"
          ></p-button>
        </div>
      </header>

      <!-- Filtri rapidi -------------------------------------------------------->
      <section class="surface-card mb-4" aria-label="Filtri registro">
        <div class="filtri-row">
          <p-selectButton
            [options]="tipoOptions"
            [(ngModel)]="filtroTipo"
            (ngModelChange)="onFiltroTipoChange()"
            optionLabel="label"
            optionValue="value"
            [ngModelOptions]="{ standalone: true }"
            ariaLabel="Filtra per tipo movimento"
          ></p-selectButton>

          <input
            pInputText
            class="filtro-cer"
            placeholder="Filtra per CER (es. 20 03 01)"
            [(ngModel)]="filtroCer"
            [ngModelOptions]="{ standalone: true }"
            (keyup.enter)="ricarica()"
            ariaLabel="Filtra per codice CER"
          />

          <p-button
            icon="pi pi-search"
            [outlined]="true"
            (onClick)="ricarica()"
            ariaLabel="Applica filtri"
            pTooltip="Applica filtri"
          ></p-button>

          <p-button
            icon="pi pi-times"
            severity="secondary"
            [outlined]="true"
            (onClick)="resetFiltri()"
            ariaLabel="Reset filtri"
            pTooltip="Reset filtri"
          ></p-button>

          <p-button
            icon="pi pi-refresh"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="ricarica()"
            ariaLabel="Aggiorna lista"
            pTooltip="Aggiorna"
          ></p-button>
        </div>
      </section>

      <!-- Errore ---------------------------------------------------------------->
      <section *ngIf="error()" class="surface-card mb-4">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger"></i>
          <span class="empty-state__title">{{ error() }}</span>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="ricarica()"></p-button>
        </div>
      </section>

      <!-- Loading --------------------------------------------------------------->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner strokeWidth="4" [style]="{ width: '48px', height: '48px' }" ariaLabel="Caricamento registro"></p-progressSpinner>
        </div>
      </section>

      <!-- Tabella --------------------------------------------------------------->
      <section class="surface-card" *ngIf="!loading() && !error()">
        <p-table
          [value]="movimenti()"
          styleClass="p-datatable-sm"
          [rowHover]="true"
          [responsiveLayout]="'scroll'"
          aria-label="Registro cronologico carico e scarico"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" style="width: 100px">N° Prog.</th>
              <th scope="col" style="width: 90px">Tipo</th>
              <th scope="col" style="width: 120px">Data op.</th>
              <th scope="col" style="width: 120px">CER</th>
              <th scope="col">Causale</th>
              <th scope="col" class="text-right" style="width: 110px">Quantità</th>
              <th scope="col">Controparte</th>
              <th scope="col" style="width: 80px">FIR</th>
              <th scope="col" style="width: 60px" aria-label="Stato registrazione">Stato</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-m>
            <tr>
              <td>
                <span class="prog-badge">{{ m.progressiveYear }}/{{ m.progressiveNumber }}</span>
              </td>
              <td>
                <p-tag
                  [value]="m.type"
                  [severity]="m.type === 'CARICO' ? 'success' : 'info'"
                  [icon]="m.type === 'CARICO' ? 'pi pi-arrow-down' : 'pi pi-arrow-up'"
                ></p-tag>
              </td>
              <td>{{ m.movementDate | date: 'dd/MM/yyyy' }}</td>
              <td><strong>{{ m.cerCode }}</strong></td>
              <td>
                {{ causaleLabel(m.causale) }}
                <span *ngIf="m.wasteDescription" class="waste-desc">· {{ m.wasteDescription }}</span>
              </td>
              <td class="text-right">
                {{ m.quantity | number: '1.0-2' }} {{ m.unit }}
              </td>
              <td>
                <span *ngIf="m.counterpartName; else nessuno">{{ m.counterpartName }}</span>
                <ng-template #nessuno><span class="text-muted">—</span></ng-template>
              </td>
              <td>
                <span *ngIf="m.firId" class="fir-ref" [pTooltip]="m.firId">FIR</span>
                <span *ngIf="!m.firId" class="text-muted">—</span>
              </td>
              <td>
                <span
                  *ngIf="m.fuoriTermine"
                  class="fuori-termine-badge"
                  [pTooltip]="'Registrato con ' + m.ritardoGg + ' gg di ritardo sul termine di legge'"
                  aria-label="Fuori termine"
                >
                  <i class="pi pi-clock"></i>
                </span>
                <span
                  *ngIf="!m.fuoriTermine"
                  class="nei-termini-badge"
                  pTooltip="Nei termini di legge"
                  aria-label="Nei termini"
                >
                  <i class="pi pi-check"></i>
                </span>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="9">
                <div class="empty-state">
                  <i class="pi pi-book empty-state__icon" aria-hidden="true"></i>
                  <span class="empty-state__title">Nessun movimento registrato</span>
                  <p>Usa il tasto "Registra movimento" per aggiungere il primo carico o scarico.</p>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>

        <!-- Paginazione -------------------------------------------------------->
        <p-paginator
          *ngIf="paginazione().total > paginazione().limit"
          [rows]="paginazione().limit"
          [totalRecords]="paginazione().total"
          [first]="(paginazione().page - 1) * paginazione().limit"
          (onPageChange)="onPageChange($event)"
          [rowsPerPageOptions]="[20, 50, 100]"
          styleClass="mt-2"
        ></p-paginator>
      </section>

      <!-- Dialog form registrazione -------------------------------------------->
      <p-dialog
        [(visible)]="formVisible"
        [header]="formTitolo()"
        [modal]="true"
        [closable]="true"
        [style]="{ width: '640px', maxWidth: '95vw' }"
        (onHide)="chiudiForm()"
        aria-labelledby="dialog-title"
      >
        <form [formGroup]="form" class="form-grid" (ngSubmit)="salva()">
          <!-- Tipo ------------------------------------------------------------->
          <div class="form-row">
            <label class="form-label" id="tipo-label">Tipo movimento *</label>
            <p-selectButton
              formControlName="type"
              [options]="tipoFormOptions"
              optionLabel="label"
              optionValue="value"
              (onChange)="onTipoChange()"
              ariaLabelledBy="tipo-label"
            ></p-selectButton>
          </div>

          <!-- Date ------------------------------------------------------------->
          <div class="form-cols-2">
            <div class="form-field">
              <label class="form-label" for="movementDate">Data operazione *</label>
              <p-calendar
                formControlName="movementDate"
                [showIcon]="true"
                dateFormat="dd/mm/yy"
                [maxDate]="oggi"
                inputId="movementDate"
                ariaLabel="Data effettiva dell'operazione"
                styleClass="w-full"
              ></p-calendar>
              <small class="form-hint">Data effettiva del carico o scarico</small>
            </div>
            <div class="form-field">
              <label class="form-label" for="registrationDate">Data registrazione *</label>
              <p-calendar
                formControlName="registrationDate"
                [showIcon]="true"
                dateFormat="dd/mm/yy"
                [maxDate]="oggi"
                inputId="registrationDate"
                ariaLabel="Data di annotazione nel registro"
                styleClass="w-full"
              ></p-calendar>
              <small class="form-hint">Termine: 10 gg lav. per produttori (art. 190 D.Lgs 152/2006)</small>
            </div>
          </div>

          <!-- Causale ---------------------------------------------------------->
          <div class="form-field">
            <label class="form-label" for="causale">Causale *</label>
            <p-dropdown
              formControlName="causale"
              [options]="causaliOptions()"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona causale"
              inputId="causale"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <!-- CER e descrizione ---------------------------------------------->
          <div class="form-cols-2">
            <div class="form-field">
              <label class="form-label" for="cerCode">Codice CER *</label>
              <input
                pInputText
                formControlName="cerCode"
                id="cerCode"
                placeholder="es. 20 03 01"
                ariaLabel="Codice CER"
              />
              <small
                *ngIf="form.get('cerCode')?.invalid && form.get('cerCode')?.touched"
                class="form-error"
              >Campo obbligatorio</small>
            </div>
            <div class="form-field">
              <label class="form-label" for="quantity">Quantità ({{ form.get('unit')?.value ?? 'KG' }}) *</label>
              <p-inputNumber
                formControlName="quantity"
                id="quantity"
                [minFractionDigits]="0"
                [maxFractionDigits]="2"
                [min]="0.01"
                mode="decimal"
                locale="it-IT"
                ariaLabel="Quantità"
                styleClass="w-full"
              ></p-inputNumber>
            </div>
          </div>

          <div class="form-field">
            <label class="form-label" for="wasteDescription">Descrizione rifiuto</label>
            <input
              pInputText
              formControlName="wasteDescription"
              id="wasteDescription"
              placeholder="Descrizione del rifiuto"
            />
          </div>

          <!-- Stato fisico e HP ---------------------------------------------->
          <div class="form-cols-2">
            <div class="form-field">
              <label class="form-label" for="wastePhysicalState">Stato fisico</label>
              <p-dropdown
                formControlName="wastePhysicalState"
                [options]="statiFisiciOptions"
                placeholder="Seleziona stato"
                inputId="wastePhysicalState"
                styleClass="w-full"
                [showClear]="true"
              ></p-dropdown>
            </div>
            <div class="form-field">
              <label class="form-label" for="wasteHazardClasses">
                Classi pericolo HP
                <i class="pi pi-info-circle" pTooltip="Obbligatorio per rifiuti pericolosi (es. HP4,HP14)" aria-hidden="true"></i>
              </label>
              <input
                pInputText
                formControlName="wasteHazardClasses"
                id="wasteHazardClasses"
                placeholder="es. HP4,HP14"
              />
            </div>
          </div>

          <!-- Operazione R/D e FIR ------------------------------------------>
          <div class="form-cols-2">
            <div class="form-field">
              <label class="form-label" for="operationCode">Codice operazione R/D</label>
              <input
                pInputText
                formControlName="operationCode"
                id="operationCode"
                placeholder="es. R1, D13"
              />
            </div>
            <div class="form-field">
              <label class="form-label" for="firId">ID FIR collegato
                <span *ngIf="form.get('type')?.value === 'SCARICO' && form.get('causale')?.value === 'CONFERIMENTO_TRASPORTATORE'"
                  class="required-mark">*</span>
              </label>
              <input
                pInputText
                formControlName="firId"
                id="firId"
                placeholder="UUID del FIR"
              />
            </div>
          </div>

          <!-- Controparte -------------------------------------------------->
          <div class="form-cols-2">
            <div class="form-field">
              <label class="form-label" for="counterpartName">
                {{ form.get('type')?.value === 'CARICO' ? 'Cedente/Produttore' : 'Destinatario' }}
              </label>
              <input
                pInputText
                formControlName="counterpartName"
                id="counterpartName"
                placeholder="Denominazione"
              />
            </div>
            <div class="form-field">
              <label class="form-label" for="counterpartAddress">Indirizzo impianto/sede</label>
              <input
                pInputText
                formControlName="counterpartAddress"
                id="counterpartAddress"
                placeholder="Via, Comune, Provincia"
              />
            </div>
          </div>

          <!-- Note --------------------------------------------------------->
          <div class="form-field">
            <label class="form-label" for="notes">Note</label>
            <textarea
              pTextarea
              formControlName="notes"
              id="notes"
              rows="2"
              placeholder="Annotazioni libere"
              class="w-full"
            ></textarea>
          </div>

          <!-- Alert ritardo ------------------------------------------------->
          <div *ngIf="ritardoAvvertimento()" class="avvertimento-ritardo" role="alert">
            <i class="pi pi-clock" aria-hidden="true"></i>
            Attenzione: sono trascorsi {{ ritardoGgCalcolato() }} gg dalla data dell'operazione.
            Il termine di legge per i produttori è di 10 giorni lavorativi (≈ 14 gg di calendario).
          </div>

          <!-- Azioni form --------------------------------------------------->
          <div class="form-actions">
            <p-button
              type="button"
              label="Annulla"
              severity="secondary"
              [outlined]="true"
              (onClick)="chiudiForm()"
            ></p-button>
            <p-button
              type="submit"
              label="Registra"
              icon="pi pi-check"
              [loading]="saving()"
              [disabled]="form.invalid"
            ></p-button>
          </div>
        </form>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      /* ─── Layout ──────────────────────────────────────────────────────────── */
      .filtri-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        padding: var(--spacing-base);
      }

      .filtro-cer {
        width: 200px;
      }

      /* ─── Tabella ─────────────────────────────────────────────────────────── */
      .prog-badge {
        font-family: var(--font-mono, monospace);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        background: var(--color-gray-100);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }

      .waste-desc {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .fir-ref {
        font-size: var(--font-size-xs);
        background: var(--color-teal-50, #f0fdfa);
        color: var(--color-teal-700, #0f766e);
        border: 1px solid var(--color-teal-200, #99f6e4);
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        cursor: default;
      }

      .fuori-termine-badge {
        color: var(--color-warning, #f59e0b);
        cursor: help;
      }
      .nei-termini-badge {
        color: var(--color-success, #10b981);
      }

      .text-muted {
        color: var(--text-tertiary);
      }
      .text-right {
        text-align: right;
      }
      .mb-4 { margin-bottom: var(--spacing-xl); }
      .mt-2 { margin-top: var(--spacing-sm); }

      /* ─── Form dialog ─────────────────────────────────────────────────────── */
      .form-grid {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
        padding: var(--spacing-sm) 0;
      }

      .form-row {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-cols-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--spacing-base);
      }

      @media (max-width: 480px) {
        .form-cols-2 { grid-template-columns: 1fr; }
      }

      .form-field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .form-label {
        font-size: var(--font-size-sm);
        font-weight: 500;
        color: var(--text-primary);
      }

      .form-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }

      .form-error {
        font-size: var(--font-size-xs);
        color: var(--color-danger);
      }

      .required-mark {
        color: var(--color-danger);
      }

      .avvertimento-ritardo {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        background: var(--color-warning-bg, #fefce8);
        border: 1px solid var(--color-warning, #f59e0b);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        color: var(--color-warning-dark, #b45309);
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        padding-top: var(--spacing-sm);
        border-top: 1px solid var(--surface-border);
      }

      .w-full {
        width: 100%;
      }
    `,
  ],
})
export class RegistroComponent implements OnInit {
  private readonly registroService = inject(RegistroService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly datePipe = inject(DatePipe);

  // ─── Stato ────────────────────────────────────────────────────────────────

  readonly movimenti = signal<Movimento[]>([]);
  readonly paginazione = signal({ total: 0, page: 1, limit: 20, totalPages: 0 });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  formVisible = false;
  filtroTipo: TipoMovimento | null = null;
  filtroCer = '';

  readonly oggi = new Date();

  // ─── Form ─────────────────────────────────────────────────────────────────

  form!: FormGroup;

  // ─── Opzioni dropdown ────────────────────────────────────────────────────

  readonly tipoOptions: DropdownOption<TipoMovimento | null>[] = [
    { label: 'Tutti', value: null },
    { label: 'Carico', value: 'CARICO' },
    { label: 'Scarico', value: 'SCARICO' },
  ];

  readonly tipoFormOptions: DropdownOption<TipoMovimento>[] = [
    { label: 'Carico', value: 'CARICO' },
    { label: 'Scarico', value: 'SCARICO' },
  ];

  readonly causaliOptions = computed<DropdownOption<CausaleMovimento>[]>(() => {
    const tipo: TipoMovimento = this.form?.get('type')?.value ?? 'CARICO';
    const causali = tipo === 'CARICO' ? CAUSALI_CARICO : CAUSALI_SCARICO;
    return causali.map((c) => ({ label: CAUSALE_LABELS[c], value: c }));
  });

  readonly statiFisiciOptions = STATI_FISICI.map((s) => ({ label: s, value: s }));

  readonly formTitolo = computed(() =>
    this.form?.get('type')?.value === 'SCARICO'
      ? 'Registra scarico'
      : 'Registra carico',
  );

  // ─── Avvertimento ritardo ────────────────────────────────────────────────

  readonly ritardoGgCalcolati = computed(() => {
    const mov = this.form?.get('movementDate')?.value as Date | null;
    const reg = this.form?.get('registrationDate')?.value as Date | null;
    if (!mov || !reg) return 0;
    return Math.max(
      0,
      Math.floor((reg.getTime() - mov.getTime()) / (1000 * 60 * 60 * 24)),
    );
  });

  readonly ritardoGgCalcolato = computed(() => this.ritardoGgCalcolati());

  readonly ritardoAvvertimento = computed(
    () => this.ritardoGgCalcolati() > 14,
  );

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.initForm();
    this.ricarica();
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  initForm(): void {
    this.form = this.fb.group({
      type: ['CARICO', Validators.required],
      movementDate: [new Date(), Validators.required],
      registrationDate: [new Date(), Validators.required],
      causale: [null, Validators.required],
      cerCode: ['', [Validators.required, Validators.maxLength(10)]],
      wasteDescription: [''],
      quantity: [null, [Validators.required, Validators.min(0.01)]],
      unit: ['KG'],
      wastePhysicalState: [null],
      wasteHazardClasses: [''],
      operationCode: [''],
      counterpartName: [''],
      counterpartAddress: [''],
      firId: [''],
      notes: [''],
    });
  }

  apriForm(): void {
    this.form.reset({
      type: 'CARICO',
      movementDate: new Date(),
      registrationDate: new Date(),
      causale: null,
      unit: 'KG',
    });
    this.formVisible = true;
  }

  chiudiForm(): void {
    this.formVisible = false;
  }

  onTipoChange(): void {
    // Azzera la causale quando cambia il tipo (causali diverse per CARICO/SCARICO)
    this.form.get('causale')?.reset(null);
  }

  // ─── Salvataggio ─────────────────────────────────────────────────────────

  salva(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const v = this.form.value;
    this.saving.set(true);

    const toIsoDate = (d: Date) => d.toISOString().split('T')[0];

    this.registroService
      .registra({
        type: v.type,
        movementDate: toIsoDate(v.movementDate),
        registrationDate: toIsoDate(v.registrationDate),
        causale: v.causale,
        cerCode: v.cerCode?.trim(),
        wasteDescription: v.wasteDescription || undefined,
        quantity: v.quantity,
        unit: v.unit || 'KG',
        wastePhysicalState: v.wastePhysicalState || undefined,
        wasteHazardClasses: v.wasteHazardClasses || undefined,
        operationCode: v.operationCode || undefined,
        counterpartName: v.counterpartName || undefined,
        counterpartAddress: v.counterpartAddress || undefined,
        firId: v.firId || undefined,
        notes: v.notes || undefined,
      })
      .subscribe({
        next: (m) => {
          this.saving.set(false);
          this.chiudiForm();
          this.toast.success(
            `Movimento ${m.progressiveYear}/${m.progressiveNumber} registrato` +
              (m.fuoriTermine ? ' — ATTENZIONE: fuori termine di legge' : ''),
          );
          this.ricarica();
        },
        error: (err) => {
          this.saving.set(false);
          const msg =
            err?.error?.message ?? err?.message ?? 'Errore durante la registrazione';
          this.toast.error(msg);
        },
      });
  }

  // ─── Lista ────────────────────────────────────────────────────────────────

  ricarica(page = 1): void {
    this.loading.set(true);
    this.error.set(null);

    this.registroService
      .lista({
        type: this.filtroTipo ?? undefined,
        cerCode: this.filtroCer || undefined,
        page,
        limit: this.paginazione().limit,
      })
      .subscribe({
        next: (data: PaginatedMovimenti) => {
          this.movimenti.set(data.items);
          this.paginazione.set({
            total: data.total,
            page: data.page,
            limit: data.limit,
            totalPages: data.totalPages,
          });
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Impossibile caricare il registro');
          this.toast.error('Errore nel caricamento del registro');
          this.loading.set(false);
        },
      });
  }

  onFiltroTipoChange(): void {
    this.ricarica(1);
  }

  resetFiltri(): void {
    this.filtroTipo = null;
    this.filtroCer = '';
    this.ricarica(1);
  }

  onPageChange(event: { page?: number }): void {
    this.ricarica((event.page ?? 0) + 1);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  causaleLabel(causale: string): string {
    return CAUSALE_LABELS[causale as CausaleMovimento] ?? causale;
  }
}
