/**
 * Registro Cronologico di Carico/Scarico — Art. 190 D.Lgs 152/2006
 *
 * Pagina del registro operativo: mostra la lista dei movimenti e permette
 * la registrazione di un nuovo movimento (CARICO o SCARICO) tramite un
 * dialog con form validato, raggruppato in sezioni logiche.
 *
 * Design system "B": slate + teal-700 #0f766e, IBM Plex, griglia 8pt, WCAG 2.1 AA.
 */

import { Component, OnInit, inject, signal, computed } from '@angular/core'
import { CommonModule, DatePipe } from '@angular/common'
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { SplitButtonModule } from 'primeng/splitbutton'
import { MenuItem } from 'primeng/api'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { DialogModule } from 'primeng/dialog'
import { CalendarModule } from 'primeng/calendar'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { DropdownModule } from 'primeng/dropdown'
import {
  AutoCompleteModule,
  AutoCompleteCompleteEvent,
  AutoCompleteSelectEvent,
} from 'primeng/autocomplete'
import { TooltipModule } from 'primeng/tooltip'
import { PaginatorModule } from 'primeng/paginator'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { FIR, ParteFIR } from '../../shared/models/fir.model'
import { Produttore } from '../../shared/models/registry.model'
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
} from './registro.service'
import { CerSelectComponent } from '../cer/cer-select.component'

interface DropdownOption<T> {
  label: string
  value: T
}

/** Opzione dell'autocomplete FIR: il FIR + l'etichetta mostrata nel menu. */
interface FirOption {
  fir: FIR
  label: string
}

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    ButtonModule,
    SplitButtonModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    DialogModule,
    CalendarModule,
    InputNumberModule,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    AutoCompleteModule,
    TooltipModule,
    PaginatorModule,
    CerSelectComponent,
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
          <p-splitButton
            label="Esporta"
            icon="pi pi-download"
            [model]="exportMenuItems"
            [outlined]="true"
            [disabled]="loading() || exporting() || paginazione().total === 0"
            (onClick)="esportaPdf()"
            ariaLabel="Esporta il registro filtrato"
            pTooltip="Esporta il registro cronologico filtrato"
          ></p-splitButton>
          <p-button
            label="Registra movimento"
            icon="pi pi-plus"
            (onClick)="apriForm()"
            ariaLabel="Registra un nuovo movimento di carico o scarico"
          ></p-button>
        </div>
      </header>

      <!-- Filtri rapidi -------------------------------------------------------->
      <section class="surface-card filters" aria-label="Filtri registro">
        <div class="filters__field filters__field--tipo">
          <label class="filters__label" for="filtro-tipo">Tipo movimento</label>
          <p-dropdown
            inputId="filtro-tipo"
            [options]="tipoOptions"
            [(ngModel)]="filtroTipo"
            [ngModelOptions]="{ standalone: true }"
            (onChange)="onFiltroTipoChange()"
            optionLabel="label"
            optionValue="value"
            placeholder="Tutti i movimenti"
            styleClass="w-full"
            ariaLabel="Filtra per tipo movimento"
          ></p-dropdown>
        </div>

        <div class="filters__field filters__field--cer">
          <label class="filters__label" for="filtro-cer">Codice CER</label>
          <span class="p-input-icon-left filters__search">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              id="filtro-cer"
              pInputText
              type="search"
              class="filtro-cer"
              placeholder="Es. 20 03 01"
              [(ngModel)]="filtroCer"
              [ngModelOptions]="{ standalone: true }"
              (keyup.enter)="ricarica()"
              aria-label="Filtra per codice CER"
            />
          </span>
        </div>

        <div class="filters__actions">
          <p-button
            label="Filtra"
            icon="pi pi-search"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="ricarica()"
            ariaLabel="Applica filtri"
          ></p-button>
          <p-button
            label="Azzera"
            icon="pi pi-times"
            [text]="true"
            (onClick)="resetFiltri()"
            ariaLabel="Azzera filtri"
          ></p-button>
        </div>
      </section>

      <!-- Errore ---------------------------------------------------------------->
      <section *ngIf="error()" class="surface-card" role="alert">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon"
            style="color: var(--color-danger);"
            aria-hidden="true"
          ></i>
          <p class="empty-state__title">{{ error() }}</p>
          <p>Si è verificato un errore durante il recupero del registro. Riprova.</p>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="ricarica()"
          ></p-button>
        </div>
      </section>

      <!-- Loading --------------------------------------------------------------->
      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner
            strokeWidth="4"
            [style]="{ width: '48px', height: '48px' }"
            ariaLabel="Caricamento registro"
          ></p-progressSpinner>
        </div>
      </section>

      <!-- Tabella --------------------------------------------------------------->
      <section class="surface-card table-card" *ngIf="!loading() && !error()">
        <div class="table-responsive">
          <p-table
            [value]="movimenti()"
            styleClass="p-datatable-sm"
            [rowHover]="true"
            [responsiveLayout]="'scroll'"
            [tableStyle]="{ 'min-width': '64rem' }"
            aria-label="Registro cronologico carico e scarico"
          >
            <ng-template pTemplate="caption">
              <span class="sr-only">Elenco cronologico dei movimenti di carico e scarico</span>
            </ng-template>

            <ng-template pTemplate="header">
              <tr>
                <th scope="col" style="width: 96px">N° prog.</th>
                <th scope="col" style="width: 104px">Tipo</th>
                <th scope="col" style="width: 116px">Data op.</th>
                <th scope="col" style="width: 96px">CER</th>
                <th scope="col">Causale</th>
                <th scope="col" class="num-col" style="width: 128px">Quantità</th>
                <th scope="col">Controparte</th>
                <th scope="col" style="width: 72px">FIR</th>
                <th scope="col" style="width: 132px">Stato</th>
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
                <td>
                  <span class="cell-mono">{{ m.cerCode }}</span>
                </td>
                <td>
                  <span class="causale-label">{{ causaleLabel(m.causale) }}</span>
                  <span *ngIf="m.wasteDescription" class="waste-desc">{{
                    m.wasteDescription
                  }}</span>
                </td>
                <td class="num-col">
                  <span class="num">{{ m.quantity | number: '1.0-2' }}</span>
                  <span class="unit">{{ m.unit }}</span>
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
                  <p-tag
                    *ngIf="!m.fuoriTermine"
                    value="Nei termini"
                    severity="success"
                    icon="pi pi-check"
                    styleClass="stato-tag"
                    pTooltip="Registrato entro il termine di legge"
                  ></p-tag>
                  <p-tag
                    *ngIf="m.fuoriTermine"
                    [value]="'Fuori termine' + (m.ritardoGg ? ' · +' + m.ritardoGg + ' gg' : '')"
                    severity="warning"
                    icon="pi pi-clock"
                    styleClass="stato-tag"
                    [pTooltip]="
                      'Registrato con ' + (m.ritardoGg ?? 0) + ' gg di ritardo sul termine di legge'
                    "
                  ></p-tag>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="9">
                  <div class="empty-state">
                    <i class="pi pi-book empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun movimento registrato</p>
                    <p>
                      Usa il tasto "Registra movimento" per aggiungere il primo carico o scarico.
                    </p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>

        <!-- Paginazione -------------------------------------------------------->
        <p-paginator
          *ngIf="paginazione().total > paginazione().limit"
          [rows]="paginazione().limit"
          [totalRecords]="paginazione().total"
          [first]="(paginazione().page - 1) * paginazione().limit"
          (onPageChange)="onPageChange($event)"
          [rowsPerPageOptions]="[20, 50, 100]"
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
        closeAriaLabel="Chiudi la finestra di registrazione movimento"
      >
        <form [formGroup]="form" class="mov-form">
          <p class="form-legend">
            I campi contrassegnati con <span class="req">*</span> sono obbligatori.
          </p>

          <!-- ===== Sezione 1: Movimento ===== -->
          <section class="form-section" aria-labelledby="mov-sec-movimento">
            <h3 id="mov-sec-movimento" class="form-section__title">Movimento</h3>

            <!-- Collegamento a un FIR (opzionale): auto-compila rifiuto e controparte -->
            <div class="field">
              <label for="firSelect">FIR collegato</label>
              <p-autoComplete
                inputId="firSelect"
                [(ngModel)]="selectedFir"
                [ngModelOptions]="{ standalone: true }"
                [suggestions]="firSuggestions"
                (completeMethod)="cercaFir($event)"
                (onSelect)="onFirSelect($event)"
                (onClear)="onFirClear()"
                field="label"
                [dropdown]="true"
                [forceSelection]="true"
                [showClear]="true"
                [delay]="200"
                [scrollHeight]="'260px'"
                placeholder="Cerca per numero, produttore, destinatario o CER…"
                ariaLabel="Formulario (FIR) da collegare al movimento"
                styleClass="w-full"
                inputStyleClass="w-full"
              >
                <ng-template let-opt pTemplate="item">
                  <div class="fir-opt">
                    <span class="fir-opt__num">{{ firNumeroLabel(opt.fir) }}</span>
                    <span class="fir-opt__parti"
                      >{{ parteLabel(opt.fir.produttore) }} →
                      {{ parteLabel(opt.fir.destinatario) }}</span
                    >
                    <span class="fir-opt__rifiuto"
                      >{{ opt.fir.rifiuto.cerCode }} ·
                      {{ opt.fir.rifiuto.quantita | number: '1.0-2' }}
                      {{ opt.fir.rifiuto.unitaMisura }}</span
                    >
                  </div>
                </ng-template>
                <ng-template pTemplate="empty">
                  <div class="fir-empty">Nessun FIR trovato.</div>
                </ng-template>
              </p-autoComplete>
              <small class="field-hint">
                Opzionale. Collegando un FIR i dati del rifiuto e la controparte vengono
                precompilati (restano modificabili).
              </small>
              <div *ngIf="ruoloHint()" class="ruolo-hint" role="status">
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span>{{ ruoloHint() }}</span>
              </div>
            </div>

            <div class="field">
              <label id="tipo-label"
                >Tipo movimento <span class="req" aria-hidden="true">*</span></label
              >
              <div class="type-toggle" role="group" aria-labelledby="tipo-label">
                <p-button
                  label="Carico"
                  icon="pi pi-arrow-down"
                  [outlined]="tipoCorrente() !== 'CARICO'"
                  (onClick)="setTipo('CARICO')"
                  styleClass="type-toggle__btn"
                  [attr.aria-pressed]="tipoCorrente() === 'CARICO'"
                ></p-button>
                <p-button
                  label="Scarico"
                  icon="pi pi-arrow-up"
                  [outlined]="tipoCorrente() !== 'SCARICO'"
                  (onClick)="setTipo('SCARICO')"
                  styleClass="type-toggle__btn"
                  [attr.aria-pressed]="tipoCorrente() === 'SCARICO'"
                ></p-button>
              </div>
            </div>

            <div class="field">
              <label for="causale">Causale <span class="req" aria-hidden="true">*</span></label>
              <p-dropdown
                formControlName="causale"
                [options]="causaliOptions()"
                optionLabel="label"
                optionValue="value"
                placeholder="Seleziona causale"
                inputId="causale"
                aria-required="true"
                [styleClass]="hasError('causale') ? 'w-full p-invalid' : 'w-full'"
                [attr.aria-invalid]="hasError('causale') ? true : null"
                [attr.aria-describedby]="hasError('causale') ? 'causale-err' : null"
              ></p-dropdown>
              <small *ngIf="hasError('causale')" id="causale-err" class="field-error" role="alert"
                >Seleziona una causale.</small
              >
            </div>

            <div class="grid">
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="movementDate"
                    >Data operazione <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-calendar
                    formControlName="movementDate"
                    [showIcon]="true"
                    dateFormat="dd/mm/yy"
                    [maxDate]="oggi"
                    inputId="movementDate"
                    aria-required="true"
                    ariaLabel="Data effettiva dell'operazione"
                    styleClass="w-full"
                  ></p-calendar>
                  <small class="field-hint">Data effettiva del carico o scarico.</small>
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="registrationDate"
                    >Data registrazione <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-calendar
                    formControlName="registrationDate"
                    [showIcon]="true"
                    dateFormat="dd/mm/yy"
                    [maxDate]="oggi"
                    inputId="registrationDate"
                    aria-required="true"
                    ariaLabel="Data di annotazione nel registro"
                    styleClass="w-full"
                  ></p-calendar>
                  <small class="field-hint">Termine: 10 gg lav. per produttori (art. 190).</small>
                </div>
              </div>
            </div>

            <!-- Alert ritardo -->
            <div *ngIf="ritardoAvvertimento()" class="avvertimento-ritardo" role="alert">
              <i class="pi pi-clock" aria-hidden="true"></i>
              <span>
                Attenzione: sono trascorsi {{ ritardoGgCalcolato() }} gg dalla data dell'operazione.
                Il termine di legge per i produttori è di 10 giorni lavorativi (≈ 14 gg di
                calendario).
              </span>
            </div>
          </section>

          <hr class="form-divider" aria-hidden="true" />

          <!-- ===== Sezione 2: Rifiuto ===== -->
          <section class="form-section" aria-labelledby="mov-sec-rifiuto">
            <h3 id="mov-sec-rifiuto" class="form-section__title">Rifiuto</h3>

            <div class="grid">
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="cerCode"
                    >Codice CER <span class="req" aria-hidden="true">*</span></label
                  >
                  <app-cer-select
                    inputId="cerCode"
                    formControlName="cerCode"
                    ariaLabel="Codice CER del rifiuto"
                    placeholder="Cerca per codice o descrizione…"
                    [required]="true"
                    [invalid]="hasError('cerCode')"
                    [ariaDescribedBy]="hasError('cerCode') ? 'cer-err' : null"
                  />
                  <small *ngIf="hasError('cerCode')" id="cer-err" class="field-error" role="alert"
                    >Il codice CER è obbligatorio.</small
                  >
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="quantity"
                    >Quantità ({{ form.get('unit')?.value ?? 'KG' }})
                    <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-inputNumber
                    formControlName="quantity"
                    inputId="quantity"
                    [minFractionDigits]="0"
                    [maxFractionDigits]="2"
                    [min]="0.01"
                    mode="decimal"
                    locale="it-IT"
                    ariaRequired="true"
                    [styleClass]="hasError('quantity') ? 'w-full p-invalid' : 'w-full'"
                    [attr.aria-invalid]="hasError('quantity') ? true : null"
                    [attr.aria-describedby]="hasError('quantity') ? 'qta-err' : null"
                  ></p-inputNumber>
                  <small *ngIf="hasError('quantity')" id="qta-err" class="field-error" role="alert"
                    >Indica una quantità maggiore di zero.</small
                  >
                </div>
              </div>

              <div class="col-12">
                <div class="field">
                  <label for="wasteDescription">Descrizione rifiuto</label>
                  <input
                    pInputText
                    formControlName="wasteDescription"
                    id="wasteDescription"
                    class="w-full"
                    placeholder="Descrizione del rifiuto"
                  />
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="wastePhysicalState">Stato fisico</label>
                  <p-dropdown
                    formControlName="wastePhysicalState"
                    [options]="statiFisiciOptions"
                    placeholder="Seleziona stato"
                    inputId="wastePhysicalState"
                    styleClass="w-full"
                    [showClear]="true"
                  ></p-dropdown>
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="wasteHazardClasses">
                    Classi pericolo HP
                    <i
                      class="pi pi-info-circle field-norm"
                      pTooltip="Obbligatorio per rifiuti pericolosi (es. HP4,HP14)"
                      aria-hidden="true"
                    ></i>
                  </label>
                  <input
                    pInputText
                    formControlName="wasteHazardClasses"
                    id="wasteHazardClasses"
                    class="w-full"
                    placeholder="es. HP4,HP14"
                  />
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="operationCode">
                    Codice operazione R/D
                    <i
                      class="pi pi-info-circle field-norm"
                      pTooltip="Allegati B e C D.Lgs 152/2006 (es. R13, D15)"
                      aria-hidden="true"
                    ></i>
                  </label>
                  <input
                    pInputText
                    formControlName="operationCode"
                    id="operationCode"
                    class="w-full"
                    placeholder="es. R1, D13"
                  />
                </div>
              </div>
            </div>
          </section>

          <hr class="form-divider" aria-hidden="true" />

          <!-- ===== Sezione 3: Controparte e note ===== -->
          <section class="form-section" aria-labelledby="mov-sec-controparte">
            <h3 id="mov-sec-controparte" class="form-section__title">Controparte e note</h3>

            <div class="grid">
              <div class="col-12">
                <div class="field">
                  <label for="produttoreSelect">Seleziona da anagrafica produttori</label>
                  <p-autoComplete
                    inputId="produttoreSelect"
                    [(ngModel)]="selectedProduttore"
                    [ngModelOptions]="{ standalone: true }"
                    [suggestions]="produttoreSuggestions"
                    (completeMethod)="cercaProduttore($event)"
                    (onSelect)="onProduttoreSelect($event)"
                    field="ragioneSociale"
                    [dropdown]="true"
                    [forceSelection]="true"
                    [showClear]="true"
                    [delay]="200"
                    [scrollHeight]="'240px'"
                    placeholder="Cerca per ragione sociale o partita IVA…"
                    ariaLabel="Seleziona la controparte dall'anagrafica produttori"
                    styleClass="w-full"
                    inputStyleClass="w-full"
                  >
                    <ng-template let-p pTemplate="item">
                      <div class="prod-opt">
                        <span class="prod-opt__nome">{{ p.ragioneSociale }}</span>
                        <span class="prod-opt__piva">P.IVA {{ p.partitaIVA }}</span>
                      </div>
                    </ng-template>
                    <ng-template pTemplate="empty">
                      <div class="fir-empty">Nessun produttore trovato.</div>
                    </ng-template>
                  </p-autoComplete>
                  <small class="field-hint"
                    >Compila i campi controparte sottostanti (restano modificabili).</small
                  >
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="counterpartName">
                    {{
                      form.get('type')?.value === 'CARICO' ? 'Cedente / Produttore' : 'Destinatario'
                    }}
                  </label>
                  <input
                    pInputText
                    formControlName="counterpartName"
                    id="counterpartName"
                    class="w-full"
                    placeholder="Denominazione"
                  />
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="counterpartAddress">Indirizzo impianto / sede</label>
                  <input
                    pInputText
                    formControlName="counterpartAddress"
                    id="counterpartAddress"
                    class="w-full"
                    placeholder="Via, Comune, Provincia"
                  />
                </div>
              </div>

              <div class="col-12">
                <div class="field">
                  <label for="notes">Note</label>
                  <textarea
                    pInputTextarea
                    formControlName="notes"
                    id="notes"
                    rows="2"
                    placeholder="Annotazioni libere"
                    class="w-full mov-textarea"
                  ></textarea>
                </div>
              </div>
            </div>
          </section>
        </form>

        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudiForm()"
            ariaLabel="Annulla e chiudi"
          ></p-button>
          <p-button
            label="Registra"
            icon="pi pi-check"
            [loading]="saving()"
            (onClick)="salva()"
            ariaLabel="Registra il movimento"
          ></p-button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      /* ─── Filtri ──────────────────────────────────────────────────────────── */
      .filters {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--spacing-base);
        margin-bottom: var(--spacing-lg);
      }
      .filters__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        min-width: 0;
      }
      .filters__field--tipo {
        flex: 0 1 200px;
      }
      .filters__field--cer {
        flex: 0 1 260px;
      }
      .filters__label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .filters__search {
        display: block;
        width: 100%;
      }
      .filters__search .filtro-cer {
        width: 100%;
      }
      .filters__actions {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-end;
        margin-left: auto;
      }

      /* Toggle Carico/Scarico nel form: due p-button (selezionato = teal pieno,
         non selezionato = outlined). Evita il SelectButton di PrimeNG, il cui
         pseudo-elemento ::before (tema Aura) copre lo sfondo del segmento
         attivo rendendolo bianco su bianco con le override globali del DS. */
      .type-toggle {
        display: flex;
        gap: var(--spacing-sm);
      }
      :host ::ng-deep .type-toggle .type-toggle__btn {
        flex: 1 1 0;
      }

      /* ─── Tabella ─────────────────────────────────────────────────────────── */
      .table-card {
        padding: 0;
        overflow: hidden;
      }
      .prog-badge {
        font-family: var(--font-family-mono);
        font-variant-numeric: tabular-nums;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--brand-primary-dark);
        background: var(--brand-primary-50);
        border: 1px solid var(--brand-primary-100);
        padding: 2px 8px;
        border-radius: var(--radius-full);
        white-space: nowrap;
      }
      .cell-mono {
        font-family: var(--font-family-mono);
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .causale-label {
        color: var(--text-primary);
      }
      .waste-desc {
        display: block;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      /* Colonne numeriche: allineate a destra, cifre tabellari. */
      .num-col {
        text-align: right;
      }
      .num {
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .unit {
        margin-left: 4px;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .fir-ref {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        background: var(--brand-primary-50);
        color: var(--brand-primary-dark);
        border: 1px solid var(--brand-primary-100);
        border-radius: var(--radius-sm);
        padding: 2px 6px;
        cursor: default;
      }
      :host ::ng-deep .stato-tag {
        white-space: nowrap;
      }
      .text-muted {
        color: var(--text-tertiary);
      }

      /* ─── Form dialog ─────────────────────────────────────────────────────── */
      .mov-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }
      .form-legend {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .form-legend .req {
        color: var(--color-danger);
        font-weight: var(--font-weight-bold);
      }
      .form-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .form-section__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
      }
      .form-divider {
        border: 0;
        border-top: 1px solid var(--surface-border);
        margin: 0;
      }
      /* Griglia PrimeFlex: annulla il gutter negativo di default per allineare
         i campi al titolo di sezione. */
      .mov-form .grid {
        margin: 0 calc(-1 * var(--spacing-sm));
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .field > label {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .req {
        color: var(--color-danger);
        font-weight: var(--font-weight-bold);
      }
      .field-hint {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        line-height: 1.3;
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
        line-height: 1.3;
      }
      .input-error,
      .input-error:enabled:focus {
        border-color: var(--color-danger) !important;
        box-shadow: 0 0 0 1px var(--color-danger) !important;
      }
      .field-norm {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        cursor: help;
      }
      .mov-textarea {
        min-height: 64px;
        resize: vertical;
      }

      /* ─── Autocomplete FIR / Produttore ───────────────────────────────────── */
      .fir-opt {
        display: flex;
        flex-direction: column;
        gap: 2px;
        line-height: 1.3;
        min-width: 0;
      }
      .fir-opt__num {
        font-family: var(--font-family-mono);
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }
      .fir-opt__parti {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fir-opt__rifiuto {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .prod-opt {
        display: flex;
        flex-direction: column;
        gap: 0;
        line-height: 1.3;
        min-width: 0;
      }
      .prod-opt__nome {
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .prod-opt__piva {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        font-variant-numeric: tabular-nums;
      }
      .fir-empty {
        padding: var(--spacing-sm) var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
      }
      .ruolo-hint {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        background: var(--brand-primary-50);
        border: 1px solid var(--brand-primary-100);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        color: var(--brand-primary-dark);
      }
      .ruolo-hint i {
        margin-top: 2px;
      }
      :host ::ng-deep .p-autocomplete {
        width: 100%;
      }
      :host ::ng-deep .p-autocomplete .p-inputtext {
        width: 100%;
      }

      .avvertimento-ritardo {
        display: flex;
        align-items: flex-start;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        background: var(--color-warning-bg);
        border: 1px solid var(--color-warning);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        color: var(--color-warning);
      }
      .avvertimento-ritardo i {
        margin-top: 2px;
      }

      .w-full {
        width: 100%;
      }

      @media (max-width: 576px) {
        .filters__field,
        .filters__field--tipo,
        .filters__field--cer,
        .filters__actions {
          flex: 1 1 100%;
          margin-left: 0;
        }
        .filters__actions .p-button {
          flex: 1 1 auto;
        }
      }
    `,
  ],
})
export class RegistroComponent implements OnInit {
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)
  private readonly fb = inject(FormBuilder)
  private readonly datePipe = inject(DatePipe)
  private readonly exportService = inject(ExportService)
  private readonly auth = inject(AuthService)
  private readonly tenantContext = inject(AdminTenantContextService)
  private readonly company = inject(CompanyService)
  private readonly firService = inject(FirService)
  private readonly registryService = inject(RegistryService)

  // ─── Stato ────────────────────────────────────────────────────────────────

  readonly movimenti = signal<Movimento[]>([])
  readonly paginazione = signal({ total: 0, page: 1, limit: 20, totalPages: 0 })
  readonly loading = signal(false)
  readonly saving = signal(false)
  readonly exporting = signal(false)
  readonly error = signal<string | null>(null)

  formVisible = false
  filtroTipo: TipoMovimento | null = null
  filtroCer = ''

  // ─── Collegamento FIR / anagrafica (autocomplete) ──────────────────────────

  /** Opzione FIR attualmente selezionata nell'autocomplete (null se nessuna). */
  selectedFir: FirOption | null = null
  /** Suggerimenti mostrati nel menu FIR (filtrati client-side sul catalogo). */
  firSuggestions: FirOption[] = []
  /** Opzione produttore selezionata (o testo digitato) nell'autocomplete controparte. */
  selectedProduttore: Produttore | string | null = null
  /** Suggerimenti produttori (filtrati client-side sull'anagrafica del tenant). */
  produttoreSuggestions: Produttore[] = []

  /** Messaggio informativo sul ruolo determinato per la società attiva. */
  readonly ruoloHint = signal<string | null>(null)

  /** Cache in memoria dei FIR del tenant (caricata all'apertura del form). */
  private tuttiFir: FIR[] = []
  /** Cache in memoria dei produttori del tenant. */
  private tuttiProduttori: Produttore[] = []
  /** FIR attualmente collegato (per ricalcolare la controparte al cambio tipo). */
  private firCollegato: FIR | null = null

  readonly oggi = new Date()

  /** Voci del menu di export (allineate al pattern del FIR). */
  readonly exportMenuItems: MenuItem[] = [
    { label: 'Esporta PDF', icon: 'pi pi-file-pdf', command: () => this.esportaPdf() },
    { label: 'Esporta Excel', icon: 'pi pi-file-excel', command: () => this.esportaExcel() },
  ]

  // ─── Form ─────────────────────────────────────────────────────────────────

  form!: FormGroup

  // ─── Opzioni dropdown ────────────────────────────────────────────────────

  readonly tipoOptions: DropdownOption<TipoMovimento | null>[] = [
    { label: 'Tutti', value: null },
    { label: 'Carico', value: 'CARICO' },
    { label: 'Scarico', value: 'SCARICO' },
  ]

  /**
   * Signal reattivo che rispecchia il valore del controllo "type" nel form.
   * Necessario perché computed() non traccia le proprietà di un FormControl
   * (non sono signal): senza questo, causaliOptions/formTitolo e lo stato attivo
   * del toggle Carico/Scarico non si aggiornerebbero al cambio di tipo.
   */
  readonly tipoCorrente = signal<TipoMovimento>('CARICO')

  readonly causaliOptions = computed<DropdownOption<CausaleMovimento>[]>(() => {
    const tipo = this.tipoCorrente()
    const causali = tipo === 'CARICO' ? CAUSALI_CARICO : CAUSALI_SCARICO
    return causali.map(c => ({ label: CAUSALE_LABELS[c], value: c }))
  })

  readonly statiFisiciOptions = STATI_FISICI.map(s => ({ label: s, value: s }))

  readonly formTitolo = computed(() =>
    this.tipoCorrente() === 'SCARICO' ? 'Registra scarico' : 'Registra carico'
  )

  // ─── Avvertimento ritardo ────────────────────────────────────────────────

  readonly ritardoGgCalcolati = computed(() => {
    const mov = this.form?.get('movementDate')?.value as Date | null
    const reg = this.form?.get('registrationDate')?.value as Date | null
    if (!mov || !reg) return 0
    return Math.max(0, Math.floor((reg.getTime() - mov.getTime()) / (1000 * 60 * 60 * 24)))
  })

  readonly ritardoGgCalcolato = computed(() => this.ritardoGgCalcolati())

  readonly ritardoAvvertimento = computed(() => this.ritardoGgCalcolati() > 14)

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.initForm()
    this.ricarica()
    // Identità della società attiva: serve all'auto-tipo carico/scarico dal FIR.
    this.company.loadActiveCompany().subscribe()
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
    })
  }

  apriForm(): void {
    this.tipoCorrente.set('CARICO')
    this.form.reset({
      type: 'CARICO',
      movementDate: new Date(),
      registrationDate: new Date(),
      causale: null,
      unit: 'KG',
    })
    // Azzera lo stato del collegamento FIR / anagrafica.
    this.selectedFir = null
    this.selectedProduttore = null
    this.firCollegato = null
    this.ruoloHint.set(null)
    // Precarica i cataloghi per gli autocomplete (best-effort, non bloccante).
    this.caricaFir()
    this.caricaProduttori()
    this.company.loadActiveCompany().subscribe()
    this.formVisible = true
  }

  chiudiForm(): void {
    this.formVisible = false
  }

  /** Imposta il tipo movimento dal toggle Carico/Scarico e aggiorna lo stato. */
  setTipo(tipo: TipoMovimento): void {
    this.form.get('type')?.setValue(tipo)
    this.onTipoChange()
  }

  onTipoChange(): void {
    // Aggiorna il signal reattivo (per causaliOptions/formTitolo/toggle) e azzera
    // la causale perché il set valido è diverso tra CARICO e SCARICO.
    const tipo: TipoMovimento = this.form?.get('type')?.value ?? 'CARICO'
    this.tipoCorrente.set(tipo)
    this.form.get('causale')?.reset(null)
    // Se è collegato un FIR, la controparte dipende dalla direzione: per un
    // CARICO è il produttore/cedente, per uno SCARICO è il destinatario.
    if (this.firCollegato) {
      this.applicaControparteDaFir(this.firCollegato, tipo)
    }
  }

  // ─── Collegamento FIR (autocomplete ricercabile + auto-compilazione) ────────

  /** Carica (una volta) i FIR del tenant per l'autocomplete. */
  private caricaFir(): void {
    if (this.tuttiFir.length > 0) return
    this.firService.getFIRList(1, 200).subscribe({
      next: res => {
        this.tuttiFir = res.items ?? []
      },
      error: () => {
        this.tuttiFir = []
      },
    })
  }

  /** Carica (una volta) i produttori del tenant per l'autocomplete controparte. */
  private caricaProduttori(): void {
    if (this.tuttiProduttori.length > 0) return
    this.registryService.getProduttori(1, 1000).subscribe({
      next: res => {
        this.tuttiProduttori = res.items ?? []
      },
      error: () => {
        this.tuttiProduttori = []
      },
    })
  }

  /** Filtra i FIR in cache in base alla query digitata (o li mostra tutti). */
  cercaFir(event: AutoCompleteCompleteEvent): void {
    const q = (event.query || '').trim().toLowerCase()
    const options = this.tuttiFir.map(fir => ({ fir, label: this.firLabel(fir) }))
    if (!q) {
      this.firSuggestions = options.slice(0, 50)
      return
    }
    this.firSuggestions = options.filter(o => o.label.toLowerCase().includes(q)).slice(0, 50)
  }

  /** Filtra i produttori in cache in base alla query digitata. */
  cercaProduttore(event: AutoCompleteCompleteEvent): void {
    const q = (event.query || '').trim().toLowerCase()
    if (!q) {
      this.produttoreSuggestions = this.tuttiProduttori.slice(0, 50)
      return
    }
    this.produttoreSuggestions = this.tuttiProduttori
      .filter(
        p =>
          p.ragioneSociale.toLowerCase().includes(q) ||
          (p.partitaIVA ?? '').toLowerCase().includes(q)
      )
      .slice(0, 50)
  }

  /** Selezione di un FIR: imposta tipo/causale (se determinabile) e auto-compila. */
  onFirSelect(event: AutoCompleteSelectEvent): void {
    const fir = (event.value as FirOption)?.fir
    if (!fir) return
    this.firCollegato = fir

    // Determina il ruolo della società attiva rispetto alle parti del FIR.
    const ruolo = this.determinaRuolo(fir)
    let tipo: TipoMovimento = this.form.get('type')?.value ?? 'CARICO'
    if (ruolo === 'PRODUTTORE') tipo = 'SCARICO'
    else if (ruolo === 'DESTINATARIO') tipo = 'CARICO'

    this.form.get('type')?.setValue(tipo)
    this.tipoCorrente.set(tipo)

    // Causale di default coerente: la impostiamo se il ruolo è determinato
    // oppure se l'utente non ne ha ancora scelta una (resta modificabile).
    const causaleDefault: CausaleMovimento =
      tipo === 'SCARICO' ? 'CONFERIMENTO_TRASPORTATORE' : 'INGRESSO_ESTERNO'
    if (ruolo || !this.form.get('causale')?.value) {
      this.form.get('causale')?.setValue(causaleDefault)
    }

    // Auto-compilazione dei dati del rifiuto dal FIR (campi modificabili).
    const r = fir.rifiuto
    this.form.patchValue({
      firId: fir.id,
      cerCode: r.cerCode,
      quantity: r.quantita,
      unit: (r.unitaMisura || 'KG').toUpperCase(),
      wasteDescription: r.descrizione ?? '',
      wastePhysicalState: this.matchStatoFisico(r.statoFisico),
      wasteHazardClasses: r.caratteristichePericolo ?? '',
      operationCode: r.codiceOperazione ?? '',
    })

    // Controparte in base alla direzione del movimento.
    this.applicaControparteDaFir(fir, tipo)

    // Hint sul ruolo determinato.
    if (ruolo === 'PRODUTTORE') {
      this.ruoloHint.set(
        'La società attiva risulta PRODUTTORE del FIR: movimento impostato come SCARICO.'
      )
    } else if (ruolo === 'DESTINATARIO') {
      this.ruoloHint.set(
        'La società attiva risulta DESTINATARIO del FIR: movimento impostato come CARICO.'
      )
    } else {
      this.ruoloHint.set(
        'Ruolo della società non determinabile dal FIR: verifica il tipo (carico/scarico). ' +
          'I dati del rifiuto sono stati comunque precompilati.'
      )
    }
  }

  /** Rimozione del FIR collegato: azzera il riferimento e l'hint. */
  onFirClear(): void {
    this.selectedFir = null
    this.firCollegato = null
    this.ruoloHint.set(null)
    this.form.get('firId')?.setValue('')
  }

  /** Selezione di un produttore dall'anagrafica: compila i campi controparte. */
  onProduttoreSelect(event: AutoCompleteSelectEvent): void {
    const p = event.value as Produttore
    if (!p) return
    this.form.patchValue({
      counterpartName: p.ragioneSociale,
      counterpartAddress: this.indirizzoProduttore(p),
    })
  }

  /** Imposta la controparte (nome + indirizzo) dallo snapshot del FIR. */
  private applicaControparteDaFir(fir: FIR, tipo: TipoMovimento): void {
    const parte = tipo === 'CARICO' ? fir.produttore : fir.destinatario
    this.form.patchValue({
      counterpartName: parte?.ragioneSociale ?? '',
      counterpartAddress: parte?.indirizzo ?? '',
    })
  }

  /**
   * Determina se la società attiva è il PRODUTTORE o il DESTINATARIO del FIR,
   * confrontando (per prima) la partita IVA e (in fallback) la ragione sociale
   * dello snapshot con l'identità della società attiva. `null` se non
   * determinabile in modo affidabile.
   */
  private determinaRuolo(fir: FIR): 'PRODUTTORE' | 'DESTINATARIO' | null {
    const azienda = this.company.activeCompany()
    if (!azienda) return null
    const piva = this.normalizza(azienda.partitaIva)
    const rag = this.normalizza(azienda.ragioneSociale)
    const combacia = (parte?: ParteFIR | null): boolean => {
      if (!parte) return false
      if (piva && this.normalizza(parte.partitaIva) === piva) return true
      if (rag && this.normalizza(parte.ragioneSociale) === rag) return true
      return false
    }
    if (combacia(fir.produttore)) return 'PRODUTTORE'
    if (combacia(fir.destinatario)) return 'DESTINATARIO'
    return null
  }

  /** Normalizza un identificativo per il confronto (senza spazi, maiuscolo). */
  private normalizza(v?: string | null): string {
    return (v ?? '').replace(/\s+/g, '').toUpperCase()
  }

  /** Mappa lo stato fisico del FIR su una delle opzioni valide (o null). */
  private matchStatoFisico(stato?: string): string | null {
    if (!stato) return null
    const norm = stato.trim().toLowerCase()
    return STATI_FISICI.find(s => s.toLowerCase() === norm) ?? null
  }

  /** Etichetta compatta del FIR per input e ricerca dell'autocomplete. */
  private firLabel(fir: FIR): string {
    const num = this.firNumeroLabel(fir)
    const prod = this.parteLabel(fir.produttore)
    const dest = this.parteLabel(fir.destinatario)
    const r = fir.rifiuto
    return `${num} · ${prod} → ${dest} · ${r.cerCode} · ${r.quantita} ${r.unitaMisura}`
  }

  /** Numero progressivo del FIR o, in mancanza, un id breve leggibile. */
  firNumeroLabel(fir: FIR): string {
    return fir.numeroProgressivo || `Bozza ${fir.id.slice(0, 8)}`
  }

  /** Ragione sociale di una parte del FIR (o segnaposto). */
  parteLabel(parte?: ParteFIR | null): string {
    return parte?.ragioneSociale?.trim() || '—'
  }

  /** Compone l'indirizzo di un produttore in stringa unica per la controparte. */
  private indirizzoProduttore(p: Produttore): string {
    const s = p.sedeLegale
    if (!s) return ''
    const via = [s.via, s.civico].filter(Boolean).join(' ').trim()
    const comune = [s.cap, s.comune].filter(Boolean).join(' ').trim()
    const prov = s.provincia ? `(${s.provincia})` : ''
    return [via, comune, prov].filter(Boolean).join(', ').replace(', (', ' (')
  }

  /** True se un controllo è invalido ed è stato toccato (per mostrare l'errore inline). */
  hasError(controlName: string): boolean {
    const control = this.form?.get(controlName)
    return !!(control && control.invalid && control.touched)
  }

  // ─── Salvataggio ─────────────────────────────────────────────────────────

  salva(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched()
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }

    const v = this.form.value
    this.saving.set(true)

    // Usa i componenti locali della data per evitare lo shift UTC negativo
    // (es. GMT+2: scegliendo il 29 giugno, toISOString() restituirebbe il 28).
    const toIsoDate = (d: Date) => {
      const yyyy = d.getFullYear()
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${yyyy}-${mm}-${dd}`
    }

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
        next: m => {
          this.saving.set(false)
          this.chiudiForm()
          this.toast.success(
            `Movimento ${m.progressiveYear}/${m.progressiveNumber} registrato` +
              (m.fuoriTermine ? ' — ATTENZIONE: fuori termine di legge' : '')
          )
          this.ricarica()
        },
        error: err => {
          this.saving.set(false)
          const msg = err?.error?.message ?? err?.message ?? 'Errore durante la registrazione'
          this.toast.error(msg)
        },
      })
  }

  // ─── Lista ────────────────────────────────────────────────────────────────

  ricarica(page = 1): void {
    this.loading.set(true)
    this.error.set(null)

    this.registroService
      .lista({
        type: this.filtroTipo ?? undefined,
        cerCode: this.filtroCer || undefined,
        page,
        limit: this.paginazione().limit,
      })
      .subscribe({
        next: (data: PaginatedMovimenti) => {
          this.movimenti.set(data.items)
          this.paginazione.set({
            total: data.total,
            page: data.page,
            limit: data.limit,
            totalPages: data.totalPages,
          })
          this.loading.set(false)
        },
        error: () => {
          this.error.set('Impossibile caricare il registro')
          this.toast.error('Errore nel caricamento del registro')
          this.loading.set(false)
        },
      })
  }

  onFiltroTipoChange(): void {
    this.ricarica(1)
  }

  resetFiltri(): void {
    this.filtroTipo = null
    this.filtroCer = ''
    this.ricarica(1)
  }

  onPageChange(event: { page?: number }): void {
    this.ricarica((event.page ?? 0) + 1)
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  esportaPdf(): void {
    this.esporta('pdf')
  }

  esportaExcel(): void {
    this.esporta('excel')
  }

  /**
   * Esporta la lista movimenti attualmente filtrata (per tipo/CER), NON solo la
   * pagina visibile: recupera l'intero set filtrato dal backend e delega la
   * generazione del file (PDF/Excel) all'ExportService condiviso.
   */
  private esporta(formato: 'pdf' | 'excel'): void {
    if (this.paginazione().total === 0) {
      this.toast.error('Nessun movimento da esportare')
      return
    }

    this.exporting.set(true)

    this.registroService
      .lista({
        type: this.filtroTipo ?? undefined,
        cerCode: this.filtroCer || undefined,
        page: 1,
        limit: Math.max(this.paginazione().total, 1),
      })
      .subscribe({
        next: (data: PaginatedMovimenti) => {
          const meta = {
            companyName: this.tenantContext.selectedTenantName(),
            operatore: this.nomeOperatore(),
            filtroTipo: this.filtroTipo,
            filtroCer: this.filtroCer || null,
          }
          if (formato === 'pdf') {
            this.exportService.exportRegistroToPDF(data.items, meta)
          } else {
            this.exportService.exportRegistroToExcel(data.items, meta)
          }
          this.exporting.set(false)
          this.toast.success(
            `Registro esportato (${data.items.length} movimenti) in ${formato.toUpperCase()}`
          )
        },
        error: () => {
          this.exporting.set(false)
          this.toast.error("Errore durante l'export del registro")
        },
      })
  }

  /** Nome leggibile dell'operatore corrente per l'intestazione dell'export. */
  private nomeOperatore(): string | null {
    const u = this.auth.currentUser()
    if (!u) return null
    const nome = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
    return nome || u.email || null
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  causaleLabel(causale: string): string {
    return CAUSALE_LABELS[causale as CausaleMovimento] ?? causale
  }
}
