import { Component, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { TableModule } from 'primeng/table'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { DropdownModule } from 'primeng/dropdown'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { SplitButtonModule } from 'primeng/splitbutton'
import { CardModule } from 'primeng/card'
import { MenuItem } from 'primeng/api'
import { TooltipModule } from 'primeng/tooltip'
import { FirService, CreateFIRDto, TipoTratta } from './fir.service'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { ExportService } from '../../core/services/export.service'
import { RegistryService } from '../registry/registry.service'
import { Produttore, Trasportatore, Destinatario } from '../../shared/models/registry.model'

@Component({
  selector: 'app-fir-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    TagModule,
    DialogModule,
    InputNumberModule,
    ConfirmDialogModule,
    SplitButtonModule,
    CardModule,
    TooltipModule,
    InputTextareaModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page fir-list">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Gestione FIR</h1>
          <p class="page-subtitle">
            Formulari di Identificazione dei Rifiuti: creazione, emissione e tracciamento
          </p>
        </div>
        <div class="page-actions">
          <p-splitButton
            label="Esporta"
            icon="pi pi-download"
            [model]="exportMenuItems"
            [outlined]="true"
            [disabled]="loading || firList.length === 0"
          />
          <p-button label="Nuovo FIR" icon="pi pi-plus" (onClick)="showCreateDialog()" />
        </div>
      </header>

      <!-- Barra filtri / ricerca -->
      <section class="surface-card filters" aria-label="Filtri di ricerca FIR">
        <div class="filters__field">
          <label for="fir-search" class="filters__label">Cerca</label>
          <span class="p-input-icon-left filters__search">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              id="fir-search"
              pInputText
              type="search"
              [(ngModel)]="searchText"
              placeholder="Cerca per numero progressivo..."
              aria-label="Cerca FIR per numero progressivo"
              (input)="onSearch()"
            />
          </span>
        </div>
        <div class="filters__field">
          <label for="fir-stato" class="filters__label">Filtra per stato</label>
          <p-dropdown
            inputId="fir-stato"
            [options]="statoOptions"
            [(ngModel)]="selectedStato"
            placeholder="Tutti gli stati"
            [showClear]="true"
            (onChange)="onFilterChange()"
            ariaLabel="Filtra i FIR per stato"
            styleClass="w-full"
          />
        </div>
      </section>

      <!-- Stato di errore -->
      <div *ngIf="error && !loading" class="surface-card" role="alert">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon"
            style="color: var(--color-danger);"
            aria-hidden="true"
          ></i>
          <p class="empty-state__title">Impossibile caricare i FIR</p>
          <p>Si è verificato un errore durante il recupero dei dati. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="reload()" />
        </div>
      </div>

      <!-- Tabella FIR -->
      <div *ngIf="!error" class="surface-card table-card">
        <div class="table-responsive">
          <p-table
            [value]="firList"
            [loading]="loading"
            [paginator]="true"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadFIRList($event)"
            responsiveLayout="scroll"
            styleClass="p-datatable-sm"
            [tableStyle]="{ 'min-width': '60rem' }"
          >
            <ng-template pTemplate="caption">
              <span class="sr-only">Elenco dei Formulari di Identificazione dei Rifiuti</span>
            </ng-template>
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Numero</th>
                <th scope="col">CER</th>
                <th scope="col">Quantità</th>
                <th scope="col">Stato</th>
                <th scope="col">Data creazione</th>
                <th scope="col" class="col-actions">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-fir>
              <tr>
                <td>
                  <span class="cell-mono">{{ fir.numeroProgressivo || 'N/D' }}</span>
                </td>
                <td>
                  <span class="cell-mono">{{ fir.rifiuto.cerCode }}</span>
                </td>
                <td>{{ fir.rifiuto.quantita }} {{ fir.rifiuto.unitaMisura }}</td>
                <td>
                  <p-tag
                    [value]="getStatoLabel(fir.stato)"
                    [severity]="getStatoSeverity(fir.stato)"
                  />
                </td>
                <td>{{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>
                  <div class="row-actions">
                    <p-button
                      *ngIf="fir.stato === 'BOZZA'"
                      label="Emetti"
                      icon="pi pi-send"
                      size="small"
                      (onClick)="emettiFIR(fir)"
                      [attr.aria-label]="'Emetti FIR ' + (fir.numeroProgressivo || fir.id)"
                    />
                    <p-button
                      *ngIf="fir.stato === 'EMESSO'"
                      label="Presa in carico"
                      icon="pi pi-truck"
                      size="small"
                      (onClick)="presaInCarico(fir)"
                      [attr.aria-label]="'Presa in carico FIR ' + (fir.numeroProgressivo || fir.id)"
                    />
                    <p-button
                      *ngIf="fir.stato === 'IN_TRANSITO'"
                      label="Conferma consegna"
                      icon="pi pi-check"
                      size="small"
                      (onClick)="showConsegnaDialog(fir)"
                      [attr.aria-label]="
                        'Conferma consegna FIR ' + (fir.numeroProgressivo || fir.id)
                      "
                    />
                    <p-button
                      *ngIf="
                        fir.stato === 'BOZZA' ||
                        fir.stato === 'EMESSO' ||
                        fir.stato === 'IN_TRANSITO'
                      "
                      label="Annulla"
                      icon="pi pi-times"
                      size="small"
                      severity="danger"
                      [text]="true"
                      (onClick)="annullaFIR(fir)"
                      [attr.aria-label]="'Annulla FIR ' + (fir.numeroProgressivo || fir.id)"
                    />
                    <span
                      *ngIf="fir.stato === 'CONSEGNATO' || fir.stato === 'ANNULLATO'"
                      class="row-actions__none"
                      >—</span
                    >
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun FIR trovato</p>
                    <p>Non ci sono formulari corrispondenti ai filtri selezionati.</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </div>

      <!-- Create FIR Dialog -->
      <p-dialog
        [(visible)]="displayCreateDialog"
        [modal]="true"
        styleClass="w-full max-w-30rem"
        header="Nuovo FIR"
      >
        <div class="dialog-form">
          <div class="dialog-form__field">
            <label for="new-cer">Codice CER</label>
            <input
              id="new-cer"
              pInputText
              [(ngModel)]="newFIR.rifiuto.cerCode"
              placeholder="es. 150101"
              class="w-full"
            />
          </div>
          <div class="dialog-form__row">
            <div class="dialog-form__field">
              <label for="new-qta">Quantità dichiarata</label>
              <p-inputNumber
                inputId="new-qta"
                [(ngModel)]="newFIR.rifiuto.quantita"
                [minFractionDigits]="2"
                styleClass="w-full"
              />
            </div>
            <div class="dialog-form__field">
              <label for="new-um">Unità di misura</label>
              <p-dropdown
                inputId="new-um"
                [options]="unitaMisuraOptions"
                [(ngModel)]="newFIR.rifiuto.unitaMisura"
                placeholder="Seleziona"
                styleClass="w-full"
              />
            </div>
          </div>

          <!-- Campo 2: stato fisico + numero colli -->
          <div class="dialog-form__row">
            <div class="dialog-form__field">
              <label for="new-stato-fisico">
                Stato fisico
                <abbr title="Campo 2 FIR — DM 59/2023" class="field-norm">¹</abbr>
              </label>
              <p-dropdown
                inputId="new-stato-fisico"
                [options]="statoFisicoOptions"
                [(ngModel)]="newFIR.rifiuto.statoFisico"
                placeholder="Seleziona…"
                [showClear]="true"
                styleClass="w-full"
                ariaLabel="Stato fisico del rifiuto (Campo 2 FIR)"
              />
            </div>
            <div class="dialog-form__field dialog-form__field--sm">
              <label for="new-colli">N° colli</label>
              <p-inputNumber
                inputId="new-colli"
                [(ngModel)]="newFIR.rifiuto.numeroColli"
                [min]="1"
                [useGrouping]="false"
                styleClass="w-full"
                ariaLabel="Numero colli"
              />
            </div>
          </div>

          <!-- Campo 2: caratteristiche HP -->
          <div class="dialog-form__field">
            <label for="new-hp">
              Caratteristiche pericolo HP
              <abbr title="Reg. UE 1357/2014, Campo 2 FIR" class="field-norm">¹</abbr>
            </label>
            <p-dropdown
              inputId="new-hp"
              [options]="hpOptions"
              [(ngModel)]="newFIR.rifiuto.caratteristichePericolo"
              placeholder="Seleziona (se rifiuto pericoloso)…"
              [showClear]="true"
              styleClass="w-full"
              ariaLabel="Caratteristiche di pericolo HP"
            />
          </div>

          <!-- Campo 3: codice operazione R/D -->
          <div class="dialog-form__field">
            <label for="new-op-code">
              Operazione destinatario R/D
              <abbr title="Campo 3 FIR — Allegati B e C D.Lgs 152/2006" class="field-norm">¹</abbr>
            </label>
            <p-dropdown
              inputId="new-op-code"
              [options]="operazioneRDOptions"
              [(ngModel)]="newFIR.rifiuto.codiceOperazione"
              placeholder="Seleziona operazione…"
              [showClear]="true"
              [filter]="true"
              styleClass="w-full"
              ariaLabel="Codice operazione di recupero o smaltimento"
            />
          </div>

          <div class="dialog-form__field">
            <label for="new-produttore">Produttore</label>
            <p-dropdown
              inputId="new-produttore"
              [options]="produttori()"
              [(ngModel)]="newFIR.produttoreId"
              optionLabel="ragioneSociale"
              optionValue="id"
              [filter]="true"
              filterBy="ragioneSociale,partitaIVA"
              [showClear]="true"
              placeholder="Cerca produttore…"
              [loading]="loadingAnagrafiche"
              styleClass="w-full"
            >
              <ng-template let-opt pTemplate="item">
                <div class="opt">
                  <span class="opt__name">{{ opt.ragioneSociale }}</span>
                  <span class="opt__piva">P.IVA {{ opt.partitaIVA }}</span>
                </div>
              </ng-template>
            </p-dropdown>
          </div>
          <div class="dialog-form__field">
            <label for="new-trasportatore">Trasportatore</label>
            <p-dropdown
              inputId="new-trasportatore"
              [options]="trasportatori()"
              [(ngModel)]="newFIR.trasportatoreId"
              optionLabel="ragioneSociale"
              optionValue="id"
              [filter]="true"
              filterBy="ragioneSociale,partitaIVA"
              [showClear]="true"
              placeholder="Cerca trasportatore…"
              [loading]="loadingAnagrafiche"
              styleClass="w-full"
            >
              <ng-template let-opt pTemplate="item">
                <div class="opt">
                  <span class="opt__name">{{ opt.ragioneSociale }}</span>
                  <span class="opt__piva">P.IVA {{ opt.partitaIVA }}</span>
                </div>
              </ng-template>
            </p-dropdown>
          </div>
          <div class="dialog-form__field">
            <label for="new-destinatario">Destinatario</label>
            <p-dropdown
              inputId="new-destinatario"
              [options]="destinatari()"
              [(ngModel)]="newFIR.destinatarioId"
              optionLabel="ragioneSociale"
              optionValue="id"
              [filter]="true"
              filterBy="ragioneSociale,partitaIVA"
              [showClear]="true"
              placeholder="Cerca destinatario…"
              [loading]="loadingAnagrafiche"
              styleClass="w-full"
            >
              <ng-template let-opt pTemplate="item">
                <div class="opt">
                  <span class="opt__name">{{ opt.ragioneSociale }}</span>
                  <span class="opt__piva">P.IVA {{ opt.partitaIVA }}</span>
                </div>
              </ng-template>
            </p-dropdown>
          </div>

          <!-- Campo 17: annotazioni libere -->
          <div class="dialog-form__field">
            <label for="new-annotazioni">
              Annotazioni
              <abbr title="Campo 17 FIR — DM 59/2023" class="field-norm">¹</abbr>
            </label>
            <textarea
              id="new-annotazioni"
              pTextarea
              [(ngModel)]="newFIR.annotazioni"
              rows="3"
              placeholder="Note libere, es. provenienza rifiuto, condizioni trasporto…"
              class="w-full"
              aria-label="Campo 17 FIR: annotazioni libere"
            ></textarea>
          </div>

          <!-- Trasportatori aggiuntivi (trasporto intermodale) -->
          <div class="trasporti-extra">
            <button
              type="button"
              class="trasporti-extra__toggle"
              (click)="showTrasportatoriAggiuntivi = !showTrasportatoriAggiuntivi"
              [attr.aria-expanded]="showTrasportatoriAggiuntivi"
            >
              <i
                class="pi"
                [ngClass]="showTrasportatoriAggiuntivi ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              ></i>
              <span>Trasportatori aggiuntivi (trasporto intermodale)</span>
              <span *ngIf="trasportatoriAggiuntivi.length > 0" class="trasporti-extra__count">
                {{ trasportatoriAggiuntivi.length }}
              </span>
            </button>

            <div *ngIf="showTrasportatoriAggiuntivi" class="trasporti-extra__body">
              <div *ngFor="let t of trasportatoriAggiuntivi; let i = index" class="trasporto-row">
                <div class="trasporto-row__field trasporto-row__field--tratta">
                  <p-dropdown
                    [options]="tipoTrattaOptions"
                    [(ngModel)]="t.tipoTratta"
                    optionLabel="label"
                    optionValue="value"
                    [attr.aria-label]="'Tipo tratta trasportatore ' + (i + 2)"
                    styleClass="w-full"
                  />
                </div>
                <div class="trasporto-row__field trasporto-row__field--trasp">
                  <p-dropdown
                    [options]="trasportatori()"
                    [(ngModel)]="t.trasportatoreId"
                    optionLabel="ragioneSociale"
                    optionValue="id"
                    [filter]="true"
                    filterBy="ragioneSociale,partitaIVA"
                    [showClear]="true"
                    placeholder="Cerca trasportatore…"
                    [attr.aria-label]="'Trasportatore aggiuntivo ' + (i + 2)"
                    styleClass="w-full"
                  >
                    <ng-template let-opt pTemplate="item">
                      <div class="opt">
                        <span class="opt__name">{{ opt.ragioneSociale }}</span>
                        <span class="opt__piva">P.IVA {{ opt.partitaIVA }}</span>
                      </div>
                    </ng-template>
                  </p-dropdown>
                </div>
                <p-button
                  icon="pi pi-times"
                  [rounded]="true"
                  [text]="true"
                  severity="danger"
                  (onClick)="removeTrasportatoreAggiuntivo(i)"
                  pTooltip="Rimuovi"
                  [attr.aria-label]="'Rimuovi trasportatore aggiuntivo ' + (i + 2)"
                />
              </div>

              <p-button
                label="Aggiungi trasportatore"
                icon="pi pi-plus"
                [text]="true"
                severity="secondary"
                (onClick)="addTrasportatoreAggiuntivo()"
              />
            </div>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayCreateDialog = false" />
          <p-button label="Salva" (onClick)="createFIR()" [loading]="saving" />
        </ng-template>
      </p-dialog>

      <!-- Consegna Dialog -->
      <p-dialog
        [(visible)]="displayConsegnaDialog"
        [modal]="true"
        styleClass="w-full max-w-20rem"
        header="Conferma Consegna"
      >
        <div class="dialog-form__field">
          <label for="peso-effettivo">Peso effettivo (kg)</label>
          <p-inputNumber
            inputId="peso-effettivo"
            [(ngModel)]="pesoEffettivo"
            [minFractionDigits]="2"
            styleClass="w-full"
          />
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayConsegnaDialog = false" />
          <p-button label="Conferma" (onClick)="consegnaFIR()" [loading]="saving" />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
        align-items: flex-end;
        margin-bottom: var(--spacing-lg);
      }
      .filters__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex: 1 1 240px;
        min-width: 0;
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
      .filters__search input {
        width: 100%;
      }

      .table-card {
        padding: 0;
        overflow: hidden;
      }

      .col-actions {
        width: 18rem;
      }
      .row-actions {
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
        align-items: center;
      }
      .row-actions__none {
        color: var(--text-secondary);
      }
      /* Garantisce testo leggibile (bianco) sui pulsanti pieni teal del design system B */
      .row-actions ::ng-deep .p-button:not(.p-button-text):not(.p-button-outlined) .p-button-label,
      .row-actions ::ng-deep .p-button:not(.p-button-text):not(.p-button-outlined) .p-button-icon {
        color: #ffffff;
      }

      .cell-mono {
        font-family: var(--font-family-mono);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }

      .dialog-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .dialog-form__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .dialog-form__field label {
        font-size: var(--font-size-sm);
      }
      .dialog-form__row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
      }
      .dialog-form__row .dialog-form__field {
        flex: 1 1 160px;
      }
      .dialog-form__field--sm {
        flex: 0 0 100px !important;
        min-width: 80px;
      }
      .field-norm {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        cursor: help;
        margin-left: 2px;
        text-decoration: none;
      }

      /* Dropdown option (ragione sociale + P.IVA) */
      .opt {
        display: flex;
        flex-direction: column;
        gap: 0;
        line-height: 1.3;
      }
      .opt__name {
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .opt__piva {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      /* Trasportatori aggiuntivi (intermodale) */
      .trasporti-extra {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
        border-top: 1px solid var(--surface-border, var(--border-color));
        padding-top: var(--spacing-base);
      }
      .trasporti-extra__toggle {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
        text-align: left;
      }
      .trasporti-extra__count {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
        background: var(--surface-hover, var(--surface-100));
        border-radius: 999px;
        padding: 0 var(--spacing-sm);
      }
      .trasporti-extra__body {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .trasporto-row {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .trasporto-row__field {
        min-width: 0;
      }
      .trasporto-row__field--tratta {
        flex: 0 0 9rem;
      }
      .trasporto-row__field--trasp {
        flex: 1 1 auto;
      }

      @media (max-width: 576px) {
        .filters__field {
          flex: 1 1 100%;
        }
        .trasporto-row {
          flex-wrap: wrap;
        }
        .trasporto-row__field--tratta {
          flex: 1 1 100%;
        }
        .trasporto-row__field--trasp {
          flex: 1 1 100%;
        }
      }
    `,
  ],
})
export class FirListComponent implements OnInit {
  firList: FIR[] = []
  loading = false
  error = false
  saving = false
  totalRecords = 0
  pageSize = 10
  currentPage = 1

  searchText = ''
  selectedStato: FIRStato | null = null

  displayCreateDialog = false
  displayConsegnaDialog = false
  selectedFIR: FIR | null = null
  pesoEffettivo = 0

  // Anagrafiche per i dropdown ricercabili
  produttori = signal<Produttore[]>([])
  trasportatori = signal<Trasportatore[]>([])
  destinatari = signal<Destinatario[]>([])
  loadingAnagrafiche = false

  // Trasporto intermodale: trasportatori aggiuntivi
  showTrasportatoriAggiuntivi = false
  trasportatoriAggiuntivi: { trasportatoreId: string | null; tipoTratta: TipoTratta }[] = []

  tipoTrattaOptions = [
    { label: 'Terrestre', value: 'TERRESTRE' as TipoTratta },
    { label: 'Ferroviaria', value: 'FERROVIARIA' as TipoTratta },
    { label: 'Marittima', value: 'MARITTIMA' as TipoTratta },
  ]

  /**
   * Stato fisico del rifiuto — Campo 2 FIR (DM 59/2023, art. 193 D.Lgs 152/2006).
   */
  statoFisicoOptions = [
    { label: 'Solido', value: 'Solido' },
    { label: 'Liquido', value: 'Liquido' },
    { label: 'Fangoso', value: 'Fangoso' },
    { label: 'Gassoso', value: 'Gassoso' },
    { label: 'Polvere', value: 'Polvere' },
    { label: 'Misto', value: 'Misto' },
  ]

  /**
   * Caratteristiche di pericolo HP — Reg. UE 1357/2014, All. III D.Lgs 152/2006.
   * Multi-valore; qui si seleziona un singolo codice o una lista pre-composta.
   */
  hpOptions = [
    { label: 'HP1 — Esplosivo', value: 'HP1' },
    { label: 'HP2 — Comburente', value: 'HP2' },
    { label: 'HP3 — Infiammabile', value: 'HP3' },
    { label: 'HP4 — Irritante', value: 'HP4' },
    { label: 'HP5 — Tossico (organi specifici)', value: 'HP5' },
    { label: 'HP6 — Tossicità acuta', value: 'HP6' },
    { label: 'HP7 — Cancerogeno', value: 'HP7' },
    { label: 'HP8 — Corrosivo', value: 'HP8' },
    { label: 'HP9 — Infettivo', value: 'HP9' },
    { label: 'HP10 — Tossico per riproduzione', value: 'HP10' },
    { label: 'HP11 — Mutageno', value: 'HP11' },
    { label: 'HP12 — Rilascio gas tossici', value: 'HP12' },
    { label: 'HP13 — Sensibilizzante', value: 'HP13' },
    { label: 'HP14 — Ecotossico', value: 'HP14' },
    { label: 'HP15 — Pericolosità latente', value: 'HP15' },
  ]

  /**
   * Codici operazione R (recupero) e D (smaltimento) — Allegati C e B D.Lgs 152/2006.
   * Campo 3 FIR (DM 59/2023).
   */
  operazioneRDOptions = [
    { label: '— Recupero —', value: null, disabled: true },
    { label: 'R1 — Utilizzazione come combustibile', value: 'R1' },
    { label: 'R2 — Recupero/rigenerazione solventi', value: 'R2' },
    { label: 'R3 — Riciclo/recupero sostanze organiche', value: 'R3' },
    { label: 'R4 — Riciclo/recupero metalli', value: 'R4' },
    { label: 'R5 — Riciclo/recupero altre sostanze inorganiche', value: 'R5' },
    { label: 'R6 — Rigenerazione acidi/basi', value: 'R6' },
    { label: "R7 — Recupero componenti per la riduzione dell'inquinamento", value: 'R7' },
    { label: 'R8 — Recupero componenti catalizzatori', value: 'R8' },
    { label: 'R9 — Rigenerazione oli usati', value: 'R9' },
    { label: 'R10 — Spandimento sul suolo', value: 'R10' },
    { label: 'R11 — Utilizzo rifiuti da R1–R10', value: 'R11' },
    { label: 'R12 — Scambio per sottoposizione a R1–R11', value: 'R12' },
    { label: 'R13 — Messa in riserva per R1–R12', value: 'R13' },
    { label: '— Smaltimento —', value: null, disabled: true },
    { label: 'D1 — Deposito sul suolo', value: 'D1' },
    { label: 'D2 — Trattamento nel suolo', value: 'D2' },
    { label: 'D3 — Iniezione in profondità', value: 'D3' },
    { label: 'D4 — Lagunaggio', value: 'D4' },
    { label: 'D5 — Messa in discarica', value: 'D5' },
    { label: 'D6 — Scarico in corpi idrici', value: 'D6' },
    { label: 'D7 — Immersione', value: 'D7' },
    { label: 'D8 — Trattamento biologico', value: 'D8' },
    { label: 'D9 — Trattamento fisico-chimico', value: 'D9' },
    { label: 'D10 — Incenerimento a terra', value: 'D10' },
    { label: 'D11 — Incenerimento in mare', value: 'D11' },
    { label: 'D12 — Deposito permanente', value: 'D12' },
    { label: 'D13 — Raggruppamento per D1–D12', value: 'D13' },
    { label: 'D14 — Ricondizionamento per D1–D13', value: 'D14' },
    { label: 'D15 — Deposito in attesa di D1–D14', value: 'D15' },
  ]

  newFIR: CreateFIRDto = {
    produttoreId: '',
    trasportatoreId: '',
    destinatarioId: '',
    rifiuto: {
      cerCode: '',
      quantita: 0,
      unitaMisura: 'kg',
      statoFisico: undefined,
      caratteristichePericolo: undefined,
      numeroColli: undefined,
      codiceOperazione: undefined,
    },
    annotazioni: undefined,
  }

  statoOptions = [
    { label: 'Bozza', value: FIRStato.BOZZA },
    { label: 'Emesso', value: FIRStato.EMESSO },
    { label: 'In Transito', value: FIRStato.IN_TRANSITO },
    { label: 'Consegnato', value: FIRStato.CONSEGNATO },
    { label: 'Annullato', value: FIRStato.ANNULLATO },
  ]

  unitaMisuraOptions = [
    { label: 'kg', value: 'kg' },
    { label: 't', value: 't' },
    { label: 'm³', value: 'm3' },
  ]

  exportMenuItems: MenuItem[] = []
  private lastLoadEvent: any = { first: 0, rows: this.pageSize }

  constructor(
    private firService: FirService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private exportService: ExportService,
    private registryService: RegistryService
  ) {}

  ngOnInit(): void {
    this.initializeExportMenu()
    this.loadAnagrafiche()
    this.loadFIRList({ first: 0, rows: this.pageSize })
  }

  /**
   * Carica le anagrafiche per i dropdown ricercabili.
   * La ricerca dei dropdown è client-side sulle opzioni caricate (limit alto).
   */
  loadAnagrafiche(): void {
    this.loadingAnagrafiche = true
    const limit = 200
    let pending = 3
    const done = () => {
      pending -= 1
      if (pending === 0) this.loadingAnagrafiche = false
    }
    this.registryService.getProduttori(1, limit).subscribe({
      next: res => this.produttori.set(res.items),
      error: () => done(),
      complete: () => done(),
    })
    this.registryService.getTrasportatori(1, limit).subscribe({
      next: res => this.trasportatori.set(res.items),
      error: () => done(),
      complete: () => done(),
    })
    this.registryService.getDestinatari(1, limit).subscribe({
      next: res => this.destinatari.set(res.items),
      error: () => done(),
      complete: () => done(),
    })
  }

  addTrasportatoreAggiuntivo(): void {
    this.trasportatoriAggiuntivi.push({ trasportatoreId: null, tipoTratta: 'TERRESTRE' })
  }

  removeTrasportatoreAggiuntivo(index: number): void {
    this.trasportatoriAggiuntivi.splice(index, 1)
  }

  initializeExportMenu(): void {
    this.exportMenuItems = [
      {
        label: 'Esporta PDF',
        icon: 'pi pi-file-pdf',
        command: () => this.exportToPDF(),
      },
      {
        label: 'Esporta Excel',
        icon: 'pi pi-file-excel',
        command: () => this.exportToExcel(),
      },
    ]
  }

  exportToPDF(): void {
    if (this.firList.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Nessun FIR da esportare',
      })
      return
    }

    this.exportService.exportFIRListToPDF(this.firList)
    this.messageService.add({
      severity: 'success',
      summary: 'Successo',
      detail: 'FIR esportati in PDF',
    })
  }

  exportToExcel(): void {
    if (this.firList.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Nessun FIR da esportare',
      })
      return
    }

    this.exportService.exportFIRListToExcel(this.firList)
    this.messageService.add({
      severity: 'success',
      summary: 'Successo',
      detail: 'FIR esportati in Excel',
    })
  }

  loadFIRList(event: any): void {
    this.loading = true
    this.error = false
    this.lastLoadEvent = event
    const page = Math.floor(event.first / event.rows) + 1
    this.currentPage = page

    this.firService.getFIRList(page, event.rows, this.selectedStato || undefined).subscribe({
      next: response => {
        this.firList = response.items
        this.totalRecords = response.total
        this.loading = false
      },
      error: () => {
        this.loading = false
        this.error = true
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel caricamento dei FIR',
        })
      },
    })
  }

  onSearch(): void {
    // Implement search logic
    this.loadFIRList({ first: 0, rows: this.pageSize })
  }

  onFilterChange(): void {
    this.loadFIRList({ first: 0, rows: this.pageSize })
  }

  showCreateDialog(): void {
    this.newFIR = {
      produttoreId: '',
      trasportatoreId: '',
      destinatarioId: '',
      rifiuto: {
        cerCode: '',
        quantita: 0,
        unitaMisura: 'kg',
        statoFisico: undefined,
        caratteristichePericolo: undefined,
        numeroColli: undefined,
        codiceOperazione: undefined,
      },
      annotazioni: undefined,
    }
    this.trasportatoriAggiuntivi = []
    this.showTrasportatoriAggiuntivi = false
    this.displayCreateDialog = true
  }

  createFIR(): void {
    if (!this.newFIR.produttoreId || !this.newFIR.trasportatoreId || !this.newFIR.destinatarioId) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Campi obbligatori',
        detail: 'Seleziona produttore, trasportatore e destinatario',
      })
      return
    }

    const aggiuntivi = this.trasportatoriAggiuntivi
      .filter(t => !!t.trasportatoreId)
      .map((t, i) => ({
        trasportatoreId: t.trasportatoreId as string,
        tipoTratta: t.tipoTratta,
        ordine: i + 1,
      }))

    const dto: CreateFIRDto = { ...this.newFIR }
    if (aggiuntivi.length > 0) {
      dto.trasportatoriAggiuntivi = aggiuntivi
    }

    this.saving = true
    this.firService.createFIR(dto).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'FIR creato con successo',
        })
        this.displayCreateDialog = false
        this.saving = false
        this.loadFIRList({ first: 0, rows: this.pageSize })
      },
      error: () => {
        this.saving = false
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nella creazione del FIR',
        })
      },
    })
  }

  /** Emette il FIR (BOZZA → EMESSO), assegnando il numero progressivo. */
  emettiFIR(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Conferma emissione',
      message: 'Confermi di voler emettere questo FIR? Verrà assegnato il numero progressivo.',
      icon: 'pi pi-send',
      acceptLabel: 'Emetti',
      rejectLabel: 'Annulla',
      accept: () => {
        this.firService.emettiFIR(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR emesso con successo',
            })
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, "Errore nell'emissione del FIR"),
            })
          },
        })
      },
    })
  }

  /** Presa in carico del FIR da parte del trasportatore (EMESSO → IN_TRANSITO). */
  presaInCarico(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Conferma presa in carico',
      message: 'Confermi la presa in carico di questo FIR?',
      icon: 'pi pi-truck',
      acceptLabel: 'Presa in carico',
      rejectLabel: 'Annulla',
      accept: () => {
        this.firService.presaInCarico(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR preso in carico con successo',
            })
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, 'Errore nella presa in carico del FIR'),
            })
          },
        })
      },
    })
  }

  showConsegnaDialog(fir: FIR): void {
    this.selectedFIR = fir
    this.pesoEffettivo = fir.rifiuto.quantita
    this.displayConsegnaDialog = true
  }

  /** Conferma consegna (IN_TRANSITO → CONSEGNATO) con il peso effettivo rilevato. */
  consegnaFIR(): void {
    if (!this.selectedFIR) return

    if (!this.pesoEffettivo || this.pesoEffettivo <= 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Peso non valido',
        detail: 'Indica un peso effettivo maggiore di zero',
      })
      return
    }

    this.saving = true
    this.firService.confermaConsegna(this.selectedFIR.id, this.pesoEffettivo).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'Consegna FIR confermata con successo',
        })
        this.displayConsegnaDialog = false
        this.saving = false
        this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
      },
      error: err => {
        this.saving = false
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nella conferma della consegna'),
        })
      },
    })
  }

  /** Annulla un FIR non ancora consegnato (BOZZA/EMESSO/IN_TRANSITO → ANNULLATO). */
  annullaFIR(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Conferma annullamento',
      message: "Confermi di voler annullare questo FIR? L'operazione non è reversibile.",
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Annulla FIR',
      rejectLabel: 'Indietro',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.firService.annullaFIR(fir.id, "Annullato dall'operatore").subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR annullato con successo',
            })
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, "Errore nell'annullamento del FIR"),
            })
          },
        })
      },
    })
  }

  /** Estrae il messaggio di errore restituito dal backend, con fallback. */
  private extractError(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: string | string[] } })?.error?.message
    if (Array.isArray(message)) return message.join(', ')
    return message || fallback
  }

  reload(): void {
    this.loadFIRList(this.lastLoadEvent)
  }

  getStatoLabel(stato: FIRStato): string {
    return this.statoOptions.find(o => o.value === stato)?.label ?? stato
  }

  getStatoSeverity(
    stato: FIRStato
  ): 'success' | 'info' | 'warning' | 'danger' | 'secondary' | 'contrast' | undefined {
    const severityMap: Record<FIRStato, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
      [FIRStato.BOZZA]: 'secondary',
      [FIRStato.EMESSO]: 'info',
      [FIRStato.IN_TRANSITO]: 'warning',
      [FIRStato.CONSEGNATO]: 'success',
      [FIRStato.ANNULLATO]: 'danger',
    }
    return severityMap[stato]
  }
}
