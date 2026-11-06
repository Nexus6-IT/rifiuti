import { Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core'
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
import { MessageModule } from 'primeng/message'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { SplitButtonModule } from 'primeng/splitbutton'
import { CardModule } from 'primeng/card'
import { MenuItem } from 'primeng/api'
import { TooltipModule } from 'primeng/tooltip'
import { Observable } from 'rxjs'
import { shareReplay } from 'rxjs/operators'
import { FirService, CreateFIRDto, ModificaFIRDto, TipoTratta } from './fir.service'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { ExportService } from '../../core/services/export.service'
import { RegistryService } from '../registry/registry.service'
import { Produttore, Trasportatore, Destinatario, Ditta } from '../../shared/models/registry.model'
import { etichettaIdentificativo } from '../registry/identificativo-fiscale'
import {
  AnagraficaFormDialogComponent,
  TipoAnagrafica,
  ModalitaAnagrafica,
  AnagraficaSavedEvent,
} from '../registry/anagrafica-form-dialog.component'
import { CerSelectComponent } from '../cer/cer-select.component'
import { puoCreareFir, puoModificareFir } from './fir-permissions'
import {
  etichettaSede,
  formDaFir,
  sedeSoloSeCambiata,
  testoMotivoNonModificabile,
} from './fir-form'
import { ActivatedRoute, Router } from '@angular/router'
import { calcolaScostamentoPeso, testoAvvisoScostamento } from './scostamento-peso'
import { RENTRISyncBadgeComponent } from './components/rentri-sync-badge/rentri-sync-badge.component'
import { RENTRISyncService } from './services/rentri-sync.service'
import { AuthService } from '../../core/services/auth.service'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { ConsegnaDaAccessoComponent, SceltaConsegna } from './consegna-da-accesso.component'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

/** Ruoli autorizzati a trasmettere/confermare verso RENTRI (v. RENTRISyncController backend). */
const RENTRI_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

type RuoloConSede = 'produttore' | 'destinatario'
type FirOriginale = Record<RuoloConSede, { id: string; sedeId: string | null }>
interface OpzioneSede {
  id: string
  etichetta: string
}

@Component({
  selector: 'app-fir-list',
  standalone: true,
  imports: [
    ConsegnaDaAccessoComponent,
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    TagModule,
    DialogModule,
    InputNumberModule,
    NumeroItalianoDirective,
    MessageModule,
    ConfirmDialogModule,
    SplitButtonModule,
    CardModule,
    TooltipModule,
    InputTextareaModule,
    AnagraficaFormDialogComponent,
    CerSelectComponent,
    RENTRISyncBadgeComponent,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page pagina-lavoro fir-list">
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
          @if (puoCreareFir()) {
            <p-button label="Nuovo FIR" icon="pi pi-plus" (onClick)="showCreateDialog()" />
          }
        </div>
      </header>

      <!-- Barra filtri / ricerca -->
      <section class="filters" aria-label="Filtri di ricerca FIR">
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
                <th scope="col" class="num-col">Quantità</th>
                <th scope="col">Stato</th>
                <th scope="col">RENTRI</th>
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
                <td class="num-col cell-nowrap">
                  {{ fir.rifiuto.quantita }} {{ fir.rifiuto.unitaMisura }}
                </td>
                <td>
                  <p-tag
                    [value]="getStatoLabel(fir.stato)"
                    [severity]="getStatoSeverity(fir.stato)"
                    [pTooltip]="motivoNonModificabileRiga(fir)"
                    tooltipPosition="top"
                    [attr.data-testid]="'fir-stato-' + fir.id"
                  />
                </td>
                <td>
                  <app-rentri-sync-badge
                    *ngIf="mostraStatoRentri(fir)"
                    [numeroFir]="fir.numeroProgressivo || fir.id"
                    [rentriSyncStatus]="fir.rentriSyncStatus || 'PENDING'"
                    [rentriNumeroFir]="fir.rentriNumeroFir"
                    [rentriNumeroFirProposto]="fir.rentriNumeroFirProposto"
                    [syncAttempts]="fir.rentriSyncAttempts || 0"
                    [lastSyncError]="fir.rentriLastSyncError"
                    [messaggioErrore]="fir.rentriMessaggioErrore"
                  />
                  <span *ngIf="!mostraStatoRentri(fir)" class="row-actions__none">—</span>
                </td>
                <td class="cell-nowrap">{{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
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
                      *ngIf="puoModificaRiga(fir)"
                      label="Modifica"
                      icon="pi pi-pencil"
                      size="small"
                      [outlined]="true"
                      (onClick)="apriModifica(fir)"
                      [attr.data-testid]="'fir-modifica-' + fir.id"
                      [attr.aria-label]="'Modifica FIR ' + (fir.numeroProgressivo || fir.id)"
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
                    <!-- Azioni RENTRI: verbi del mestiere, solo quando hanno senso (canManageRENTRI + regole di dominio). -->
                    <p-button
                      *ngIf="canTrasmettereRentri(fir)"
                      label="Trasmetti a RENTRI"
                      icon="pi pi-send"
                      size="small"
                      [outlined]="true"
                      (onClick)="trasmettiRENTRI(fir)"
                      [attr.data-testid]="
                        'fir-rentri-trasmetti-' + (fir.numeroProgressivo || fir.id)
                      "
                      [attr.aria-label]="
                        'Trasmetti a RENTRI il FIR ' + (fir.numeroProgressivo || fir.id)
                      "
                    />
                    <p-button
                      *ngIf="canRiprovareRentri(fir)"
                      label="Riprova"
                      icon="pi pi-refresh"
                      size="small"
                      severity="warning"
                      [outlined]="true"
                      (onClick)="trasmettiRENTRI(fir)"
                      [attr.data-testid]="'fir-rentri-riprova-' + (fir.numeroProgressivo || fir.id)"
                      [attr.aria-label]="
                        'Riprova la trasmissione RENTRI del FIR ' +
                        (fir.numeroProgressivo || fir.id)
                      "
                    />
                    <p-button
                      *ngIf="canConfermareLegameRentri(fir)"
                      label="Conferma il legame"
                      icon="pi pi-check-circle"
                      size="small"
                      severity="info"
                      [outlined]="true"
                      (onClick)="confermaLegameRENTRI(fir)"
                      [attr.data-testid]="
                        'fir-rentri-conferma-legame-' + (fir.numeroProgressivo || fir.id)
                      "
                      [attr.aria-label]="
                        'Conferma il legame RENTRI del FIR ' + (fir.numeroProgressivo || fir.id)
                      "
                    />
                    <span *ngIf="isRigaSenzaAzioni(fir)" class="row-actions__none">—</span>
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7">
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
        [visible]="displayCreateDialog"
        (visibleChange)="onCreateDialogVisibleChange($event)"
        [modal]="true"
        styleClass="fir-dialog"
        [style]="{ width: '48rem', maxHeight: '90vh' }"
        [breakpoints]="{ '960px': '90vw', '640px': '100vw' }"
        [contentStyle]="{ overflow: 'auto' }"
        [header]="firInModifica ? 'Modifica bozza FIR' : 'Nuovo FIR'"
        [closeAriaLabel]="
          firInModifica ? 'Chiudi la finestra Modifica bozza FIR' : 'Chiudi la finestra Nuovo FIR'
        "
      >
        <div class="fir-form p-fluid">
          <!-- L'avviso "emissione non possibile" (GET /rentri/emissione-possibile) è
               stato tolto da qui il 2026-09-11: ConsumaNumeroVidimatoUseCase non ha
               ancora alcun chiamante (v. la sua classe), quindi l'emissione reale non
               consuma mai dalla scorta e questo controllo era un falso allarme
               permanente per ogni tenant senza R6 configurato, cioè tutti oggi.
               Il banner tornerà qui quando il consumo sarà ricablato in
               EmettiFIRUseCase (v. verifica-emissione-possibile.use-case.ts, che
               resta e viene ancora usato per l'endpoint). -->
          <p class="fir-form__legend">
            I campi contrassegnati con <span class="req">*</span> sono obbligatori.
          </p>

          <!-- ===== Sezione 1: Parti coinvolte ===== -->
          <section class="fir-section" aria-labelledby="fir-sec-parti">
            <h3 id="fir-sec-parti" class="fir-section__title">Parti coinvolte</h3>

            <div class="field">
              <label for="new-produttore"
                >Produttore <span class="req" aria-hidden="true">*</span></label
              >
              <div class="field__control">
                <p-dropdown
                  inputId="new-produttore"
                  [options]="produttori()"
                  [(ngModel)]="newFIR.produttoreId"
                  (onChange)="clearFirError('produttoreId'); aggiornaSedi('produttore')"
                  optionLabel="ragioneSociale"
                  optionValue="id"
                  [required]="true"
                  [filter]="true"
                  filterBy="ragioneSociale,partitaIVA,codiceFiscale"
                  [showClear]="true"
                  placeholder="Cerca produttore…"
                  [loading]="loadingAnagrafiche"
                  [styleClass]="firErrors['produttoreId'] ? 'w-full p-invalid' : 'w-full'"
                  [attr.aria-invalid]="firErrors['produttoreId'] ? true : null"
                  [attr.aria-describedby]="firErrors['produttoreId'] ? 'new-produttore-err' : null"
                >
                  <ng-template let-opt pTemplate="item">
                    <div class="opt">
                      <span class="opt__name">{{ opt.ragioneSociale }}</span>
                      <span class="opt__piva">{{
                        etichettaIdentificativo(opt.partitaIVA, opt.codiceFiscale)
                      }}</span>
                    </div>
                  </ng-template>
                </p-dropdown>
                <p-button
                  icon="pi pi-plus"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Nuovo produttore"
                  tooltipPosition="top"
                  aria-label="Nuovo produttore"
                  (onClick)="openAnagraficaDialog('produttore', 'create')"
                />
                <p-button
                  icon="pi pi-pencil"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Modifica produttore selezionato"
                  tooltipPosition="top"
                  aria-label="Modifica produttore selezionato"
                  [disabled]="!newFIR.produttoreId"
                  (onClick)="openAnagraficaDialog('produttore', 'edit', newFIR.produttoreId)"
                />
              </div>
              <small
                *ngIf="firErrors['produttoreId']"
                id="new-produttore-err"
                class="field-error"
                role="alert"
                >{{ firErrors['produttoreId'] }}</small
              >
              @if (sediProduttore().length > 1) {
                <div class="fir-sede" data-testid="fir-sede-produttore">
                  <label for="new-produttore-sede">Sede del produttore</label>
                  <p-dropdown
                    inputId="new-produttore-sede"
                    [options]="sediProduttore()"
                    [(ngModel)]="newFIR.produttoreSedeId"
                    optionValue="id"
                    [optionLabel]="'etichetta'"
                    placeholder="Scegli la sede"
                    styleClass="w-full"
                  />
                </div>
              }
            </div>

            <div class="field">
              <label for="new-trasportatore"
                >Trasportatore <span class="req" aria-hidden="true">*</span></label
              >
              <div class="field__control">
                <p-dropdown
                  inputId="new-trasportatore"
                  [options]="trasportatori()"
                  [(ngModel)]="newFIR.trasportatoreId"
                  (onChange)="clearFirError('trasportatoreId')"
                  optionLabel="ragioneSociale"
                  optionValue="id"
                  [required]="true"
                  [filter]="true"
                  filterBy="ragioneSociale,partitaIVA,codiceFiscale"
                  [showClear]="true"
                  placeholder="Cerca trasportatore…"
                  [loading]="loadingAnagrafiche"
                  [styleClass]="firErrors['trasportatoreId'] ? 'w-full p-invalid' : 'w-full'"
                  [attr.aria-invalid]="firErrors['trasportatoreId'] ? true : null"
                  [attr.aria-describedby]="
                    firErrors['trasportatoreId'] ? 'new-trasportatore-err' : null
                  "
                >
                  <ng-template let-opt pTemplate="item">
                    <div class="opt">
                      <span class="opt__name">{{ opt.ragioneSociale }}</span>
                      <span class="opt__piva">{{
                        etichettaIdentificativo(opt.partitaIVA, opt.codiceFiscale)
                      }}</span>
                    </div>
                  </ng-template>
                </p-dropdown>
                <p-button
                  icon="pi pi-plus"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Nuovo trasportatore"
                  tooltipPosition="top"
                  aria-label="Nuovo trasportatore"
                  (onClick)="openAnagraficaDialog('trasportatore', 'create')"
                />
                <p-button
                  icon="pi pi-pencil"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Modifica trasportatore selezionato"
                  tooltipPosition="top"
                  aria-label="Modifica trasportatore selezionato"
                  [disabled]="!newFIR.trasportatoreId"
                  (onClick)="openAnagraficaDialog('trasportatore', 'edit', newFIR.trasportatoreId)"
                />
              </div>
              <small
                *ngIf="firErrors['trasportatoreId']"
                id="new-trasportatore-err"
                class="field-error"
                role="alert"
                >{{ firErrors['trasportatoreId'] }}</small
              >
              <!-- Avviso "a scelta" (Task 4 dello scadenzario): AVVISA, non IMPEDISCE —
                   la scadenza potrebbe essere un nostro dato non aggiornato. -->
              @if (trasportatoreSelezionato()?.iscrizioneScaduta) {
                <p-message
                  severity="warn"
                  text="L'iscrizione all'Albo Gestori di questo trasportatore risulta scaduta. Verifica il dato prima di procedere: l'emissione non viene bloccata."
                  styleClass="w-full mt-2"
                  data-testid="fir-trasportatore-iscrizione-scaduta"
                />
              }
            </div>

            <div class="field">
              <label for="new-destinatario"
                >Destinatario <span class="req" aria-hidden="true">*</span></label
              >
              <div class="field__control">
                <p-dropdown
                  inputId="new-destinatario"
                  [options]="destinatari()"
                  [(ngModel)]="newFIR.destinatarioId"
                  (onChange)="clearFirError('destinatarioId'); aggiornaSedi('destinatario')"
                  optionLabel="ragioneSociale"
                  optionValue="id"
                  [required]="true"
                  [filter]="true"
                  filterBy="ragioneSociale,partitaIVA,codiceFiscale"
                  [showClear]="true"
                  placeholder="Cerca destinatario…"
                  [loading]="loadingAnagrafiche"
                  [styleClass]="firErrors['destinatarioId'] ? 'w-full p-invalid' : 'w-full'"
                  [attr.aria-invalid]="firErrors['destinatarioId'] ? true : null"
                  [attr.aria-describedby]="
                    firErrors['destinatarioId'] ? 'new-destinatario-err' : null
                  "
                >
                  <ng-template let-opt pTemplate="item">
                    <div class="opt">
                      <span class="opt__name">{{ opt.ragioneSociale }}</span>
                      <span class="opt__piva">{{
                        etichettaIdentificativo(opt.partitaIVA, opt.codiceFiscale)
                      }}</span>
                    </div>
                  </ng-template>
                </p-dropdown>
                <p-button
                  icon="pi pi-plus"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Nuovo destinatario"
                  tooltipPosition="top"
                  aria-label="Nuovo destinatario"
                  (onClick)="openAnagraficaDialog('destinatario', 'create')"
                />
                <p-button
                  icon="pi pi-pencil"
                  [outlined]="true"
                  styleClass="fir-icon-btn"
                  pTooltip="Modifica destinatario selezionato"
                  tooltipPosition="top"
                  aria-label="Modifica destinatario selezionato"
                  [disabled]="!newFIR.destinatarioId"
                  (onClick)="openAnagraficaDialog('destinatario', 'edit', newFIR.destinatarioId)"
                />
              </div>
              <small
                *ngIf="firErrors['destinatarioId']"
                id="new-destinatario-err"
                class="field-error"
                role="alert"
                >{{ firErrors['destinatarioId'] }}</small
              >
              @if (sediDestinatario().length > 1) {
                <div class="fir-sede" data-testid="fir-sede-destinatario">
                  <label for="new-destinatario-sede">Sede del destinatario</label>
                  <p-dropdown
                    inputId="new-destinatario-sede"
                    [options]="sediDestinatario()"
                    [(ngModel)]="newFIR.destinatarioSedeId"
                    optionValue="id"
                    [optionLabel]="'etichetta'"
                    placeholder="Scegli la sede"
                    styleClass="w-full"
                  />
                </div>
              }
              <!-- Avviso "a scelta" (Task 4 dello scadenzario): AVVISA, non IMPEDISCE. -->
              @if (destinatarioSelezionato()?.autorizzazioneScaduta) {
                <p-message
                  severity="warn"
                  text="L'autorizzazione di questo destinatario risulta scaduta. Verifica il dato prima di procedere: l'emissione non viene bloccata."
                  styleClass="w-full mt-2"
                  data-testid="fir-destinatario-autorizzazione-scaduta"
                />
              }
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
                      filterBy="ragioneSociale,partitaIVA,codiceFiscale"
                      [showClear]="true"
                      placeholder="Cerca trasportatore…"
                      [attr.aria-label]="'Trasportatore aggiuntivo ' + (i + 2)"
                      styleClass="w-full"
                    >
                      <ng-template let-opt pTemplate="item">
                        <div class="opt">
                          <span class="opt__name">{{ opt.ragioneSociale }}</span>
                          <span class="opt__piva">{{
                            etichettaIdentificativo(opt.partitaIVA, opt.codiceFiscale)
                          }}</span>
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
                  size="small"
                  styleClass="trasporti-extra__add"
                  (onClick)="addTrasportatoreAggiuntivo()"
                />
              </div>
            </div>
          </section>

          <hr class="fir-divider" aria-hidden="true" />

          <!-- ===== Sezione 2: Dati rifiuto ===== -->
          <section class="fir-section" aria-labelledby="fir-sec-rifiuto">
            <h3 id="fir-sec-rifiuto" class="fir-section__title">Dati rifiuto</h3>

            <div class="grid">
              <div class="col-12">
                <div class="field">
                  <label for="new-cer"
                    >Codice CER <span class="req" aria-hidden="true">*</span></label
                  >
                  <app-cer-select
                    inputId="new-cer"
                    data-testid="fir-cer-autocomplete"
                    [(ngModel)]="newFIR.rifiuto.cerCode"
                    (ngModelChange)="clearFirError('cerCode')"
                    ariaLabel="Codice CER del rifiuto"
                    placeholder="Cerca per codice o descrizione…"
                    [required]="true"
                    [invalid]="!!firErrors['cerCode']"
                    [ariaDescribedBy]="firErrors['cerCode'] ? 'new-cer-err' : null"
                  />
                  <small
                    *ngIf="firErrors['cerCode']"
                    id="new-cer-err"
                    class="field-error"
                    role="alert"
                    >{{ firErrors['cerCode'] }}</small
                  >
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-qta"
                    >Quantità dichiarata <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-inputNumber
                    appNumeroIt
                    locale="it-IT"
                    [useGrouping]="false"
                    mode="decimal"
                    [maxFractionDigits]="2"
                    inputId="new-qta"
                    [(ngModel)]="newFIR.rifiuto.quantita"
                    (ngModelChange)="clearFirError('quantita')"
                    [minFractionDigits]="2"
                    [required]="true"
                    ariaRequired="true"
                    [styleClass]="firErrors['quantita'] ? 'w-full p-invalid' : 'w-full'"
                    [attr.aria-invalid]="firErrors['quantita'] ? true : null"
                    [attr.aria-describedby]="firErrors['quantita'] ? 'new-qta-err' : null"
                  />
                  <small
                    *ngIf="firErrors['quantita']"
                    id="new-qta-err"
                    class="field-error"
                    role="alert"
                    >{{ firErrors['quantita'] }}</small
                  >
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
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

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-provenienza"
                    >Provenienza del rifiuto <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-dropdown
                    inputId="new-provenienza"
                    [options]="provenienzaOptions"
                    [(ngModel)]="newFIR.provenienza"
                    (onChange)="clearFirError('provenienza')"
                    placeholder="Seleziona…"
                    [required]="true"
                    [styleClass]="firErrors['provenienza'] ? 'w-full p-invalid' : 'w-full'"
                    [attr.aria-invalid]="firErrors['provenienza'] ? true : null"
                    [attr.aria-describedby]="
                      firErrors['provenienza'] ? 'new-provenienza-err' : null
                    "
                    ariaLabel="Provenienza del rifiuto"
                  />
                  <small
                    *ngIf="firErrors['provenienza']"
                    id="new-provenienza-err"
                    class="field-error"
                    role="alert"
                    >{{ firErrors['provenienza'] }}</small
                  >
                </div>
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-tipo-tratta-principale"
                    >Modalità di trasporto <span class="req" aria-hidden="true">*</span></label
                  >
                  <p-dropdown
                    inputId="new-tipo-tratta-principale"
                    [options]="tipoTrattaOptions"
                    [(ngModel)]="newFIR.tipoTrattaPrincipale"
                    (onChange)="clearFirError('tipoTrattaPrincipale')"
                    optionLabel="label"
                    optionValue="value"
                    placeholder="Seleziona…"
                    [required]="true"
                    [styleClass]="firErrors['tipoTrattaPrincipale'] ? 'w-full p-invalid' : 'w-full'"
                    [attr.aria-invalid]="firErrors['tipoTrattaPrincipale'] ? true : null"
                    [attr.aria-describedby]="
                      firErrors['tipoTrattaPrincipale'] ? 'new-tipo-tratta-principale-err' : null
                    "
                    ariaLabel="Modalità di trasporto della tratta principale"
                  />
                  <small
                    *ngIf="firErrors['tipoTrattaPrincipale']"
                    id="new-tipo-tratta-principale-err"
                    class="field-error"
                    role="alert"
                    >{{ firErrors['tipoTrattaPrincipale'] }}</small
                  >
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-stato-fisico">
                    Stato fisico
                    <i
                      class="pi pi-info-circle field-norm"
                      title="Campo 2 FIR — DM 59/2023"
                      aria-hidden="true"
                    ></i>
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
              </div>
              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-colli">N° colli</label>
                  <p-inputNumber
                    appNumeroIt
                    locale="it-IT"
                    soloIntero
                    [maxFractionDigits]="0"
                    inputId="new-colli"
                    [(ngModel)]="newFIR.rifiuto.numeroColli"
                    [min]="1"
                    [useGrouping]="false"
                    styleClass="w-full"
                    ariaLabel="Numero colli"
                  />
                </div>
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-hp">
                    Caratteristiche pericolo HP
                    <i
                      class="pi pi-info-circle field-norm"
                      title="Reg. UE 1357/2014, Campo 2 FIR"
                      aria-hidden="true"
                    ></i>
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
              </div>

              <div class="col-12 sm:col-6">
                <div class="field">
                  <label for="new-op-code">
                    Operazione destinatario R/D
                    <i
                      class="pi pi-info-circle field-norm"
                      title="Campo 3 FIR — Allegati B e C D.Lgs 152/2006"
                      aria-hidden="true"
                    ></i>
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
              </div>
            </div>
          </section>

          <hr class="fir-divider" aria-hidden="true" />

          <!-- ===== Sezione 3: Dati aggiuntivi ===== -->
          <section class="fir-section" aria-labelledby="fir-sec-extra">
            <h3 id="fir-sec-extra" class="fir-section__title">Dati aggiuntivi</h3>

            <div class="field">
              <label for="new-annotazioni">
                Annotazioni
                <i
                  class="pi pi-info-circle field-norm"
                  title="Campo 17 FIR — DM 59/2023"
                  aria-hidden="true"
                ></i>
              </label>
              <textarea
                id="new-annotazioni"
                pInputTextarea
                [(ngModel)]="newFIR.annotazioni"
                rows="3"
                placeholder="Note libere, es. provenienza rifiuto, condizioni trasporto…"
                class="w-full fir-textarea"
                aria-label="Campo 17 FIR: annotazioni libere"
              ></textarea>
            </div>
          </section>
        </div>
        <ng-template pTemplate="footer">
          <div class="fir-dialog-footer">
            <p-button
              label="Annulla"
              icon="pi pi-times"
              [outlined]="true"
              (onClick)="displayCreateDialog = false"
            />
            <p-button
              [label]="firInModifica ? 'Salva modifiche' : 'Crea FIR'"
              icon="pi pi-check"
              data-testid="fir-dialog-salva"
              (onClick)="salvaFIR()"
              [loading]="saving"
            />
          </div>
        </ng-template>
      </p-dialog>

      <!-- Sub-dialog crea/modifica anagrafica (aperto dalla form FIR) -->
      <app-anagrafica-form-dialog
        [(visible)]="showAnagraficaDialog"
        [tipo]="anagraficaTipo"
        [modalita]="anagraficaModalita"
        [entityData]="anagraficaEntityData"
        (saved)="onAnagraficaSaved($event)"
      />

      <!-- Consegna Dialog -->
      <p-dialog
        [(visible)]="displayConsegnaDialog"
        [modal]="true"
        [styleClass]="ff.has('pese') ? 'w-full max-w-30rem' : 'w-full max-w-20rem'"
        header="Conferma Consegna"
        (onHide)="chiudiConsegna()"
      >
        @if (displayConsegnaDialog && ff.has('pese') && selectedFIR) {
          @for (f of [selectedFIR]; track f.id) {
            <app-consegna-da-accesso [fir]="f" (cambio)="scelta = $event"></app-consegna-da-accesso>
          }
        }
        @if (!scelta.attivo) {
          <div class="dialog-form__field">
            <label for="peso-effettivo">Quantità verificata a destino ({{ unitaConsegna }})</label>
            <p-inputNumber
              appNumeroIt
              locale="it-IT"
              [useGrouping]="false"
              mode="decimal"
              inputId="peso-effettivo"
              [(ngModel)]="pesoEffettivo"
              [minFractionDigits]="2"
              [maxFractionDigits]="2"
              [max]="99999999.99"
              styleClass="w-full"
            />
            @if (avvisoScostamento; as avviso) {
              <small class="dialog-form__warning" role="status" data-testid="avviso-scostamento">{{
                avviso
              }}</small>
            }
          </div>
        }
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="chiudiConsegna()" />
          <p-button
            label="Conferma"
            (onClick)="consegnaFIR()"
            [loading]="saving"
            [disabled]="scelta.attivo && !scelta.accessoId"
          />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [
    `
      .col-actions {
        width: 20rem;
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
      /* Testo leggibile sui pulsanti pieni teal, in chiaro e in scuro */
      .row-actions ::ng-deep .p-button:not(.p-button-text):not(.p-button-outlined) .p-button-label,
      .row-actions ::ng-deep .p-button:not(.p-button-text):not(.p-button-outlined) .p-button-icon {
        color: var(--on-accent);
      }

      /* ===== Form FIR — sezioni logiche (griglia 8pt, densità operativa) ===== */
      .fir-form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base); /* 16px tra sezioni (era 24px) */
      }
      .fir-form__legend {
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .fir-form__legend .req {
        color: var(--color-danger);
        font-weight: var(--font-weight-bold);
      }
      .fir-section {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md); /* 12px intra-sezione (era 16px) */
      }
      .fir-section__title {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--text-tertiary);
      }
      .fir-divider {
        border: 0;
        border-top: 1px solid var(--surface-border);
        margin: 0; /* la spaziatura la dà il gap di .fir-form (24px) */
      }

      /* Campo: label (6px) sopra il controllo — densità operativa */
      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      /* Le celle della griglia PrimeFlex compattano il gutter verticale (8px) */
      .fir-form .grid > [class*='col'] {
        padding-top: var(--spacing-xs);
        padding-bottom: var(--spacing-xs);
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

      /* Errore inline per-campo — rosso WCAG AA. */
      .field-error {
        margin-top: 4px;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
        line-height: 1.3;
      }
      /* Bordo rosso sul controllo (input testuale) non valido. */
      .input-error,
      .input-error:enabled:focus {
        border-color: var(--color-danger) !important;
        box-shadow: 0 0 0 1px var(--color-danger) !important;
      }
      /* Riga controllo + azioni: dropdown + pulsanti Nuovo/Modifica (WS-4) */
      .field__control {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .field__control > p-dropdown {
        flex: 1 1 auto;
        min-width: 0;
      }
      /* I pulsanti azione non si espandono e rimangono allineati al centro */
      .field__control > p-button {
        flex: 0 0 auto;
        align-self: stretch;
        display: flex;
      }
      /* Pulsanti icona Nuovo/Modifica: quadrati 40px, bordo neutro, icona teal-700.
         Coerenti con l'altezza del control (griglia 8pt), contrasto WCAG AA. */
      .field__control ::ng-deep .p-button.fir-icon-btn {
        width: var(--control-md);
        height: var(--control-md);
        padding: 0 !important;
        color: var(--brand-primary-dark); /* teal-700 su superficie chiara: AA */
        border-color: var(--surface-border-strong);
        background: var(--surface-section);
      }
      .field__control ::ng-deep .p-button.fir-icon-btn:not(:disabled):hover {
        color: var(--brand-primary-dark);
        border-color: var(--brand-primary-dark);
        background: var(--brand-primary-50);
      }
      .field__control ::ng-deep .p-button.fir-icon-btn:disabled,
      .field__control ::ng-deep .p-button.fir-icon-btn.p-disabled {
        color: var(--text-disabled);
      }

      /* Griglia PrimeFlex: annulla il margin-top negativo di default (allineamento sezione) */
      .fir-form .grid {
        margin: 0 calc(-1 * var(--spacing-sm));
      }

      /* Nota normativa (facoltativa) accanto alla label */
      .field-norm {
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
        cursor: help;
      }

      /* Textarea annotazioni (Campo 17): min 80px, resize verticale, bordo DS */
      .fir-textarea {
        min-height: 80px;
        font-size: var(--font-size-sm);
        resize: vertical;
      }

      /* ===== Dialog FIR: altezza limitata, body scrollabile, footer sticky ===== */
      :host ::ng-deep .fir-dialog.p-dialog {
        display: flex;
        flex-direction: column;
        max-height: 90vh;
      }
      :host ::ng-deep .fir-dialog .p-dialog-content {
        flex: 1 1 auto;
        overflow-y: auto;
      }
      /* Header e footer non scorrono (restano visibili) */
      :host ::ng-deep .fir-dialog .p-dialog-header,
      :host ::ng-deep .fir-dialog .p-dialog-footer {
        flex: 0 0 auto;
      }
      /* Footer: azioni allineate a destra con spaziatura coerente */
      .fir-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
      }
      /* Il bottone "Aggiungi trasportatore" non deve ingombrare */
      :host ::ng-deep .trasporti-extra__add.p-button {
        align-self: flex-start;
        padding-left: 0 !important;
        color: var(--brand-primary-dark);
      }
      :host ::ng-deep .trasporti-extra__add.p-button:not(:disabled):hover {
        background: var(--brand-primary-50);
        color: var(--brand-primary-dark);
      }

      /* Dialog Consegna (campo singolo) */
      .dialog-form__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .dialog-form__field label {
        font-size: var(--font-size-sm);
      }
      .dialog-form__warning {
        color: var(--color-warning);
        font-size: var(--font-size-sm);
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
  /** Esito dell'interruttore "peso da un accesso di pesa" nel dialog di consegna. */
  @ViewChild(ConsegnaDaAccessoComponent) consegnaDaAccesso?: ConsegnaDaAccessoComponent
  scelta: SceltaConsegna = { attivo: false, accessoId: null, convertito: null }

  /** Errori di validazione per-campo del form "Nuovo FIR" (mostrati inline). */
  firErrors: Record<string, string> = {}

  // Anagrafiche per i dropdown ricercabili
  produttori = signal<Produttore[]>([])
  trasportatori = signal<Trasportatore[]>([])
  destinatari = signal<Destinatario[]>([])
  loadingAnagrafiche = false

  readonly etichettaIdentificativo = etichettaIdentificativo

  // Sede delle parti (F2-10): la tendina compare solo se la ditta ha più sedi
  sediProduttore = signal<OpzioneSede[]>([])
  sediDestinatario = signal<OpzioneSede[]>([])
  /** Valore iniziale della sede per ruolo: l'invio al backend avviene solo se l'utente lo cambia (I4). */
  private sedeIniziale: Record<RuoloConSede, string | null> = {
    produttore: null,
    destinatario: null,
  }
  /** Id di ruolo e sede del FIR aperto in modifica (per ricostruire il valore iniziale). */
  private firOriginale: FirOriginale | null = null
  private tokenSedi: Record<RuoloConSede, number> = { produttore: 0, destinatario: 0 }
  /** `getDitta` una sola volta per ditta, finché il dialog resta aperto. */
  private dittaInCache = new Map<string, Observable<Ditta>>()

  // Sub-dialog crea/modifica anagrafica dalla form FIR (WS-4)
  showAnagraficaDialog = false
  anagraficaTipo: TipoAnagrafica = 'produttore'
  anagraficaModalita: ModalitaAnagrafica = 'create'
  anagraficaEntityData: Produttore | Trasportatore | Destinatario | null = null

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
    { label: 'Polvere', value: 'Polvere' },
  ]

  /**
   * Provenienza del rifiuto — Campo 1 FIR, obbligatoria per la trasmissione
   * RENTRI: senza questo dato il contratto ufficiale rifiuta l'invio.
   */
  provenienzaOptions = [
    { label: 'Urbano', value: 'URBANO' as const },
    { label: 'Speciale', value: 'SPECIALE' as const },
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

  /** Se valorizzato il dialog modifica una bozza esistente (con la versione letta) invece di crearne una. */
  firInModifica: { id: string; versione: number } | null = null

  newFIR: CreateFIRDto = {
    produttoreId: '',
    trasportatoreId: '',
    destinatarioId: '',
    provenienza: undefined,
    tipoTrattaPrincipale: undefined,
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
    { label: 'litri', value: 'litri' },
  ]

  exportMenuItems: MenuItem[] = []
  private lastLoadEvent: any = { first: 0, rows: this.pageSize }

  private readonly rentriSyncService = inject(RENTRISyncService)
  private readonly authService = inject(AuthService)
  /** Pubblico: il template decide se offrire la consegna dal netto di un accesso di pesa. */
  readonly ff = inject(FeatureFlagsService)
  private readonly router = inject(Router)
  private readonly route = inject(ActivatedRoute)

  /**
   * Il VIEWER ha sola lettura: il backend rifiuta la creazione con un 403
   * (`@Roles('SUPER_ADMIN','ADMIN','OPERATOR')` su `FIRControllerV2.create`),
   * quindi l'azione non va nemmeno mostrata. La regola vive in
   * `fir-permissions.ts`, allineata a quell'elenco.
   */
  readonly puoCreareFir = computed(() => puoCreareFir(this.authService.currentUser()?.role))

  readonly puoModificareFir = computed(() => puoModificareFir(this.authService.currentUser()?.role))

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
    const idModifica = this.route.snapshot.queryParamMap.get('modifica')
    if (idModifica) this.apriModificaDaId(idModifica)
    this.apriNuovoDaParametro()
  }

  /**
   * `?nuovo=1` (dal pulsante «Nuovo FIR» della Dashboard) apre il dialog di creazione, ma solo a
   * chi puo' creare un FIR; il parametro si toglie sempre dall'URL, cosi' un ricaricamento della
   * pagina non riapre il dialog.
   */
  private apriNuovoDaParametro(): void {
    if (this.route.snapshot.queryParamMap.get('nuovo') !== '1') return
    if (this.puoCreareFir()) this.showCreateDialog()
    void this.router.navigate([], {
      queryParams: { nuovo: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    })
  }

  /**
   * Aggiorna la tendina della sede per produttore o destinatario. `azzera` = true quando cambia il
   * ruolo scelto (la sede torna al valore iniziale); false quando si ricaricano solo le anagrafiche.
   */
  aggiornaSedi(ruolo: RuoloConSede, azzera = true): void {
    const sediSignal = ruolo === 'produttore' ? this.sediProduttore : this.sediDestinatario
    const chiave = ruolo === 'produttore' ? 'produttoreSedeId' : 'destinatarioSedeId'
    const id = ruolo === 'produttore' ? this.newFIR.produttoreId : this.newFIR.destinatarioId
    const righe: { id: string; dittaId?: string; sedeId?: string }[] =
      ruolo === 'produttore' ? this.produttori() : this.destinatari()
    const riga = id ? righe.find(r => r.id === id) : undefined
    const originale = this.firOriginale?.[ruolo]
    // Sede del FIR se il ruolo è quello del FIR; altrimenti la predefinita del ruolo
    const iniziale =
      (originale && originale.id === id ? originale.sedeId : null) ?? riga?.sedeId ?? null
    this.sedeIniziale[ruolo] = iniziale
    if (azzera || !this.newFIR[chiave]) this.newFIR[chiave] = iniziale ?? undefined

    const token = ++this.tokenSedi[ruolo]
    if (!riga?.dittaId) {
      sediSignal.set([])
      return
    }
    this.ditta(riga.dittaId).subscribe({
      next: ditta => {
        if (token !== this.tokenSedi[ruolo]) return // nel frattempo è cambiato il ruolo
        sediSignal.set(
          ditta.sedi
            // La sede attuale del FIR resta in elenco anche se disattivata: l'utente vede dov'è il FIR
            .filter(sede => sede.attiva || sede.id === this.sedeIniziale[ruolo])
            .map(sede => ({ id: sede.id, etichetta: etichettaSede(sede) }))
        )
      },
      error: () => {
        if (token === this.tokenSedi[ruolo]) sediSignal.set([])
      },
    })
  }

  private ditta(dittaId: string): Observable<Ditta> {
    let richiesta = this.dittaInCache.get(dittaId)
    if (!richiesta) {
      richiesta = this.registryService.getDitta(dittaId).pipe(shareReplay(1))
      this.dittaInCache.set(dittaId, richiesta)
    }
    return richiesta
  }

  /** Azzera tendine, valori iniziali e cache all'apertura del dialog. */
  private reimpostaSedi(originale: FirOriginale | null): void {
    this.firOriginale = originale
    this.dittaInCache.clear()
    this.tokenSedi.produttore++
    this.tokenSedi.destinatario++
    this.sedeIniziale = { produttore: null, destinatario: null }
    this.sediProduttore.set([])
    this.sediDestinatario.set([])
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
      next: res => {
        this.produttori.set(res.items)
        if (this.newFIR.produttoreId) this.aggiornaSedi('produttore', false)
      },
      error: () => done(),
      complete: () => done(),
    })
    this.registryService.getTrasportatori(1, limit).subscribe({
      next: res => this.trasportatori.set(res.items),
      error: () => done(),
      complete: () => done(),
    })
    this.registryService.getDestinatari(1, limit).subscribe({
      next: res => {
        this.destinatari.set(res.items)
        if (this.newFIR.destinatarioId) this.aggiornaSedi('destinatario', false)
      },
      error: () => done(),
      complete: () => done(),
    })
  }

  /**
   * Apre il sub-dialog anagrafica in modalità create o edit.
   * In modalità edit recupera i dati dall'array già caricato in memoria.
   */
  /**
   * Esc nel sub-dialog anagrafica fa chiudere anche questo dialog (PrimeNG chiude ogni dialog
   * aperto con closeOnEscape): si ignora, o si perde il FIR in compilazione.
   */
  onCreateDialogVisibleChange(v: boolean): void {
    if (!v && this.showAnagraficaDialog) return
    this.displayCreateDialog = v
  }

  openAnagraficaDialog(
    tipo: TipoAnagrafica,
    modalita: ModalitaAnagrafica,
    entityId?: string
  ): void {
    this.anagraficaTipo = tipo
    this.anagraficaModalita = modalita
    this.anagraficaEntityData = null

    if (modalita === 'edit' && entityId) {
      // Recupera i dati dall'array in memoria (già caricato da loadAnagrafiche)
      if (tipo === 'produttore') {
        this.anagraficaEntityData = this.produttori().find(p => p.id === entityId) ?? null
      } else if (tipo === 'trasportatore') {
        this.anagraficaEntityData = this.trasportatori().find(t => t.id === entityId) ?? null
      } else {
        this.anagraficaEntityData = this.destinatari().find(d => d.id === entityId) ?? null
      }
    }

    this.showAnagraficaDialog = true
  }

  /**
   * Callback al salvataggio del sub-dialog:
   * ricarica la lista anagrafica interessata e seleziona l'entità salvata.
   */
  onAnagraficaSaved(event: AnagraficaSavedEvent): void {
    const { tipo, entity } = event
    const limit = 200

    if (tipo === 'produttore') {
      this.registryService.getProduttori(1, limit).subscribe({
        next: res => {
          this.produttori.set(res.items)
          this.newFIR.produttoreId = entity.id
          this.dittaInCache.clear() // le sedi possono essere cambiate nel sub-dialog
          this.aggiornaSedi('produttore')
        },
      })
    } else if (tipo === 'trasportatore') {
      this.registryService.getTrasportatori(1, limit).subscribe({
        next: res => {
          this.trasportatori.set(res.items)
          this.newFIR.trasportatoreId = entity.id
        },
      })
    } else {
      this.registryService.getDestinatari(1, limit).subscribe({
        next: res => {
          this.destinatari.set(res.items)
          this.newFIR.destinatarioId = entity.id
          this.dittaInCache.clear()
          this.aggiornaSedi('destinatario')
        },
      })
    }
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
    this.firInModifica = null
    this.newFIR = {
      produttoreId: '',
      trasportatoreId: '',
      destinatarioId: '',
      provenienza: undefined,
      tipoTrattaPrincipale: undefined,
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
    this.reimpostaSedi(null)
    this.firErrors = {}
    this.displayCreateDialog = true
  }

  /** Pulisce l'errore inline di un campo del form FIR mentre l'utente lo corregge. */
  clearFirError(field: string): void {
    if (this.firErrors[field]) {
      delete this.firErrors[field]
    }
  }

  /**
   * Trasportatore attualmente scelto nel form "Nuovo FIR" (o `null`), usato
   * per l'avviso inline di iscrizione scaduta — Task 4 dello scadenzario:
   * si AVVISA alla scelta della controparte, non solo via email il giorno
   * dopo. `iscrizioneScaduta` arriva già calcolata dal backend
   * (`RegistryController`, stessa `calcolaScadenza` del controllo
   * periodico) e vale `false` quando la scadenza non è nota: nessun avviso
   * inventato su un dato assente.
   */
  trasportatoreSelezionato(): Trasportatore | null {
    return this.trasportatori().find(t => t.id === this.newFIR.trasportatoreId) ?? null
  }

  /** Destinatario attualmente scelto nel form "Nuovo FIR" (o `null`), stessa logica sopra. */
  destinatarioSelezionato(): Destinatario | null {
    return this.destinatari().find(d => d.id === this.newFIR.destinatarioId) ?? null
  }

  /** Valida i campi obbligatori del form FIR popolando `firErrors`. */
  private validateFir(): boolean {
    const errors: Record<string, string> = {}
    if (!this.newFIR.produttoreId) errors['produttoreId'] = 'Seleziona un produttore.'
    if (!this.newFIR.trasportatoreId) errors['trasportatoreId'] = 'Seleziona un trasportatore.'
    if (!this.newFIR.destinatarioId) errors['destinatarioId'] = 'Seleziona un destinatario.'
    if (!this.newFIR.rifiuto.cerCode?.trim()) errors['cerCode'] = 'Il codice CER è obbligatorio.'
    if (!this.newFIR.rifiuto.quantita || this.newFIR.rifiuto.quantita <= 0) {
      errors['quantita'] = 'Indica una quantità maggiore di zero.'
    }
    if (!this.newFIR.provenienza) {
      errors['provenienza'] = 'Seleziona la provenienza del rifiuto.'
    }
    if (!this.newFIR.tipoTrattaPrincipale) {
      errors['tipoTrattaPrincipale'] = 'Seleziona la modalità di trasporto.'
    }
    this.firErrors = errors
    return Object.keys(errors).length === 0
  }

  /** Mappa un errore backend (400/409) al campo pertinente del form FIR. */
  private mapFirBackendError(message: string): void {
    const m = message.toLowerCase()
    if (m.includes('cer')) {
      this.firErrors = { ...this.firErrors, cerCode: message }
    } else if (m.includes('quantit')) {
      this.firErrors = { ...this.firErrors, quantita: message }
    } else if (m.includes('produttore')) {
      this.firErrors = { ...this.firErrors, produttoreId: message }
    } else if (m.includes('trasportatore')) {
      this.firErrors = { ...this.firErrors, trasportatoreId: message }
    } else if (m.includes('destinatario')) {
      this.firErrors = { ...this.firErrors, destinatarioId: message }
    }
  }

  /** Il pulsante «Modifica» compare solo su una bozza modificabile e solo per i ruoli che possono farlo. */
  puoModificaRiga(fir: FIR): boolean {
    return fir.stato === FIRStato.BOZZA && !!fir.modificabile && this.puoModificareFir()
  }

  /** Tooltip del badge di stato: perché la bozza non si può modificare (null se non serve). */
  motivoNonModificabileRiga(fir: FIR): string | undefined {
    if (fir.stato !== FIRStato.BOZZA || fir.modificabile !== false) return undefined
    return testoMotivoNonModificabile(fir.motivoNonModificabile) || undefined
  }

  /** Apre il dialog in modalità modifica, precompilato campo per campo dal FIR. */
  showEditDialog(fir: FIR): boolean {
    const tratte = fir.trasportatoriAggiuntivi ?? []
    if (tratte.some(t => !t.trasportatoreId)) {
      this.rifiutaApertura(
        'Il FIR ha tratte intermodali con trasportatori non presenti nel registro: non sono modificabili dall’interfaccia.'
      )
      return false
    }
    if (typeof fir.versione !== 'number' || !Number.isInteger(fir.versione)) {
      this.rifiutaApertura('Versione del FIR non disponibile: ricarica la pagina e riprova.')
      return false
    }
    this.newFIR = formDaFir(fir)
    this.trasportatoriAggiuntivi = (this.newFIR.trasportatoriAggiuntivi ?? []).map(t => ({
      trasportatoreId: t.trasportatoreId,
      tipoTratta: t.tipoTratta,
    }))
    this.showTrasportatoriAggiuntivi = this.trasportatoriAggiuntivi.length > 0
    this.firInModifica = { id: fir.id, versione: fir.versione }
    this.reimpostaSedi({
      produttore: { id: fir.produttoreId, sedeId: fir.produttore?.sedeId ?? null },
      destinatario: { id: fir.destinatarioId, sedeId: fir.destinatario?.sedeId ?? null },
    })
    this.aggiornaSedi('produttore')
    this.aggiornaSedi('destinatario')
    this.firErrors = {}
    this.displayCreateDialog = true
    return true
  }

  /** La modifica non si può aprire: messaggio e dialog chiuso (anche se era già aperto, dopo una rilettura). */
  private rifiutaApertura(detail: string): void {
    this.messageService.add({ severity: 'error', summary: 'Modifica non possibile', detail })
    this.displayCreateDialog = false
    this.firInModifica = null
  }

  /** Dalla riga della lista: rilegge il FIR (versione e dati correnti) e apre la modifica. */
  apriModifica(fir: FIR): void {
    this.apriModificaDaId(fir.id)
  }

  /** Legge il FIR dal backend (non dalla pagina corrente) e apre la modifica se è ancora modificabile. */
  private apriModificaDaId(id: string): void {
    this.firService.getFIRById(id).subscribe({
      next: fir => {
        this.togliParametroModifica()
        if (!this.puoModificareFir()) {
          this.messageService.add({
            severity: 'error',
            summary: 'Modifica non consentita',
            detail: 'Il tuo ruolo non può modificare i FIR.',
          })
        } else if (fir.stato !== FIRStato.BOZZA || fir.modificabile === false) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Bozza non modificabile',
            detail:
              testoMotivoNonModificabile(fir.motivoNonModificabile) ||
              'Questo FIR non si può più modificare.',
          })
        } else {
          this.showEditDialog(fir)
        }
      },
      error: err => {
        this.togliParametroModifica()
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nella lettura del FIR'),
        })
      },
    })
  }

  /** Toglie il parametro "modifica" dall'URL, così un ricaricamento della pagina non riapre il dialog. */
  private togliParametroModifica(): void {
    if (!this.route.snapshot.queryParamMap.has('modifica')) return
    void this.router.navigate([], {
      queryParams: { modifica: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    })
  }

  /** Salvataggio del dialog: creazione o modifica, a seconda di come è stato aperto. */
  salvaFIR(): void {
    if (this.firInModifica) this.modificaFIR()
    else this.createFIR()
  }

  private modificaFIR(): void {
    const target = this.firInModifica
    if (!target) return
    if (!this.validateFir()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Campi obbligatori',
        detail: 'Controlla i campi evidenziati e riprova.',
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
    const dto: ModificaFIRDto = {
      ...this.newFIR,
      rifiuto: { ...this.newFIR.rifiuto },
      versione: target.versione,
    }
    this.applicaSedeSoloSeCambiata(dto)
    if (aggiuntivi.length > 0) dto.trasportatoriAggiuntivi = aggiuntivi
    else delete dto.trasportatoriAggiuntivi

    this.saving = true
    this.firService.modificaFIR(target.id, dto).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'Bozza FIR modificata con successo',
        })
        this.displayCreateDialog = false
        this.firInModifica = null
        this.saving = false
        this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
      },
      error: err => {
        this.saving = false
        this.gestisciErroreModifica(err, target.id)
      },
    })
  }

  /** Il DTO porta la sede di produttore e destinatario solo se l'utente l'ha cambiata (I4). */
  private applicaSedeSoloSeCambiata(dto: CreateFIRDto): void {
    dto.produttoreSedeId = sedeSoloSeCambiata(
      this.newFIR.produttoreSedeId,
      this.sedeIniziale.produttore
    )
    dto.destinatarioSedeId = sedeSoloSeCambiata(
      this.newFIR.destinatarioSedeId,
      this.sedeIniziale.destinatario
    )
    if (dto.produttoreSedeId === undefined) delete dto.produttoreSedeId
    if (dto.destinatarioSedeId === undefined) delete dto.destinatarioSedeId
  }

  private gestisciErroreModifica(err: unknown, id: string): void {
    const http = err as { status?: number; error?: { error?: string } }
    const codice = http?.error?.error
    if (http?.status === 409 && codice === 'FIR_MODIFICATO_NEL_FRATTEMPO') {
      const detail = this.extractError(err, 'Il FIR è stato modificato da un altro utente.')
      this.messageService.add({
        severity: 'warn',
        summary: 'Bozza modificata nel frattempo',
        detail: detail + ' I dati sono stati ricaricati: ripeti la modifica.',
      })
      this.firService.getFIRById(id).subscribe({
        next: fir => {
          if (fir.stato === FIRStato.BOZZA && fir.modificabile !== false) {
            this.showEditDialog(fir)
          } else {
            this.chiudiModificaConErrore(
              testoMotivoNonModificabile(fir.motivoNonModificabile) ||
                'Questo FIR non si può più modificare.'
            )
          }
        },
        error: e =>
          this.chiudiModificaConErrore(this.extractError(e, 'Errore nella lettura del FIR')),
      })
      return
    }
    if (
      (http?.status === 409 && codice === 'FIR_NON_MODIFICABILE') ||
      (http?.status === 404 && codice === 'FIR_NON_TROVATO')
    ) {
      this.chiudiModificaConErrore(this.extractError(err, 'Il FIR non si può più modificare.'))
      return
    }
    const detail = this.extractError(err, 'Errore nella modifica del FIR')
    this.mapFirBackendError(detail)
    this.messageService.add({ severity: 'error', summary: 'Errore', detail })
  }

  private chiudiModificaConErrore(detail: string): void {
    this.messageService.add({ severity: 'error', summary: 'Errore', detail })
    this.displayCreateDialog = false
    this.firInModifica = null
    this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
  }

  createFIR(): void {
    if (!this.validateFir()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Campi obbligatori',
        detail: 'Controlla i campi evidenziati e riprova.',
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
    this.applicaSedeSoloSeCambiata(dto)
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
      error: err => {
        this.saving = false
        const detail = this.extractError(err, 'Errore nella creazione del FIR')
        this.mapFirBackendError(detail)
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail,
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

  /** Unità del FIR: il peso verificato è espresso nella stessa unità della quantità dichiarata. */
  get unitaConsegna(): string {
    return this.selectedFIR?.rifiuto.unitaMisura ?? 'kg'
  }

  /**
   * Avviso non bloccante sotto il campo: appare solo se la quantità digitata si scosta oltre la
   * soglia da quella dichiarata. Il pulsante Conferma non dipende da questo.
   */
  get avvisoScostamento(): string | null {
    const fir = this.selectedFIR
    if (!fir || !this.pesoEffettivo || this.pesoEffettivo <= 0) return null
    const s = calcolaScostamentoPeso(fir.rifiuto.quantita, this.pesoEffettivo, this.unitaConsegna)
    return s.oltreSoglia ? testoAvvisoScostamento(s, fir.rifiuto.quantita) : null
  }

  showConsegnaDialog(fir: FIR): void {
    this.selectedFIR = fir
    this.pesoEffettivo = fir.rifiuto.quantita
    this.scelta = { attivo: false, accessoId: null, convertito: null }
    this.displayConsegnaDialog = true
  }

  /** Chiude il dialog di consegna e azzera la scelta: la prossima apertura parte da zero. */
  chiudiConsegna(): void {
    this.displayConsegnaDialog = false
    this.scelta = { attivo: false, accessoId: null, convertito: null }
  }

  /** Conferma consegna (IN_TRANSITO → CONSEGNATO) con il peso effettivo rilevato. */
  consegnaFIR(): void {
    if (!this.selectedFIR) return
    const daAccesso = this.scelta.attivo
    if (daAccesso && !this.scelta.accessoId) return

    if (!daAccesso && (!this.pesoEffettivo || this.pesoEffettivo <= 0)) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Peso non valido',
        detail: 'Indica una quantità verificata maggiore di zero',
      })
      return
    }

    const dichiarata = this.selectedFIR.rifiuto.quantita
    this.saving = true
    const dati = daAccesso
      ? { accessoId: this.scelta.accessoId! }
      : { pesoEffettivo: this.pesoEffettivo }
    this.firService.confermaConsegna(this.selectedFIR.id, dati).subscribe({
      next: fir => {
        const scostamento = fir?.scostamentoPeso
        if (scostamento?.oltreSoglia) {
          this.messageService.add({
            severity: 'warn',
            summary: 'Consegna confermata con scostamento',
            detail: testoAvvisoScostamento(scostamento, dichiarata),
            life: 10000,
          })
        } else {
          this.messageService.add({
            severity: 'success',
            summary: 'Successo',
            detail: 'Consegna FIR confermata con successo',
          })
        }
        this.chiudiConsegna()
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
        // l'accesso potrebbe non essere piu' disponibile (409): si rilegge l'elenco
        if (daAccesso && err?.status === 409) this.consegnaDaAccesso?.ricarica()
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

  /**
   * Lo stato RENTRI non ha senso per un FIR mai emesso (BOZZA) o annullato:
   * mostrare "Da trasmettere" prima ancora dell'emissione confonderebbe
   * l'operatore. La colonna resta muta (—) in questi due stati.
   */
  mostraStatoRentri(fir: FIR): boolean {
    return fir.stato !== FIRStato.BOZZA && fir.stato !== FIRStato.ANNULLATO
  }

  /** Ruoli SUPER_ADMIN/ADMIN/OPERATOR: stessi ruoli richiesti dal backend su RENTRISyncController. */
  private canManageRENTRI(): boolean {
    const role = this.authService.currentUser()?.role
    return !!role && RENTRI_ROLES.includes(role)
  }

  /** Prima trasmissione: nessun tentativo ancora effettuato. */
  canTrasmettereRentri(fir: FIR): boolean {
    return !!fir.canSyncToRENTRI && fir.rentriSyncStatus === 'PENDING' && this.canManageRENTRI()
  }

  /** Un tentativo precedente è fallito ma ce ne sono ancora a disposizione. */
  canRiprovareRentri(fir: FIR): boolean {
    return !!fir.canSyncToRENTRI && fir.rentriSyncStatus === 'FAILED' && this.canManageRENTRI()
  }

  /** Modalità ibrida: c'è una proposta di legame in attesa di conferma esplicita. */
  canConfermareLegameRentri(fir: FIR): boolean {
    return !!fir.rentriNumeroFirProposto && !fir.rentriNumeroFir && this.canManageRENTRI()
  }

  /** Nessuna azione di ciclo vita né RENTRI applicabile: la riga mostra solo il trattino. */
  isRigaSenzaAzioni(fir: FIR): boolean {
    if (this.puoModificaRiga(fir)) return false
    const haAzioneCiclo =
      fir.stato === FIRStato.BOZZA ||
      fir.stato === FIRStato.EMESSO ||
      fir.stato === FIRStato.IN_TRANSITO
    const haAzioneRentri =
      this.canTrasmettereRentri(fir) ||
      this.canRiprovareRentri(fir) ||
      this.canConfermareLegameRentri(fir)
    return !haAzioneCiclo && !haAzioneRentri
  }

  /** Trasmette (o ritrasmette) il FIR a RENTRI: verbo del mestiere, non del protocollo. */
  trasmettiRENTRI(fir: FIR): void {
    this.rentriSyncService.syncFIR(fir.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Trasmissione avviata',
          detail: 'Il FIR è stato messo in coda per la trasmissione a RENTRI',
        })
        this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
      },
      error: err => {
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.extractError(err, 'Errore nella trasmissione a RENTRI'),
        })
      },
    })
  }

  /** Conferma il legame RENTRI proposto in modalità ibrida, promuovendolo a legame ufficiale. */
  confermaLegameRENTRI(fir: FIR): void {
    this.confirmationService.confirm({
      header: 'Conferma legame RENTRI',
      message: `Confermi il legame con il numero FIR RENTRI ${fir.rentriNumeroFirProposto}?`,
      icon: 'pi pi-check-circle',
      acceptLabel: 'Conferma',
      rejectLabel: 'Annulla',
      accept: () => {
        this.rentriSyncService.confermaLegame(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Legame confermato',
              detail: 'Il numero FIR RENTRI è ora il legame ufficiale',
            })
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize })
          },
          error: err => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: this.extractError(err, 'Errore nella conferma del legame RENTRI'),
            })
          },
        })
      },
    })
  }
}
