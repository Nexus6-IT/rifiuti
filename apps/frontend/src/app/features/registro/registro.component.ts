/**
 * Registro Cronologico di Carico/Scarico — Art. 190 D.Lgs 152/2006
 *
 * Pagina del registro operativo: mostra la lista dei movimenti e permette
 * la registrazione di un nuovo movimento (CARICO o SCARICO) tramite un
 * dialog con form validato, raggruppato in sezioni logiche.
 *
 * Design system "B": slate + teal-700 #0f766e, IBM Plex, griglia 8pt, WCAG 2.1 AA.
 */

import { Component, DestroyRef, OnInit, inject, signal, computed } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { EMPTY, Subject, Subscription, combineLatest, merge } from 'rxjs'
import {
  auditTime,
  catchError,
  distinctUntilChanged,
  filter,
  map,
  startWith,
  switchMap,
} from 'rxjs/operators'
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
  STATI_FISICI,
  EsitoVerificaCatena,
  StatoProgressivoIniziale,
  RegistroVista,
  offrireProgressivoIniziale,
  offrireRegistrazione,
  annoItaliano,
  EsitoCorrezioneMovimento,
} from './registro.service'
import { etichettaRegistro, registroPredefinito } from './registro-sede'
import { messaggioMovimentoRegistrato } from './registro-messaggi'
import { giorniDiRitardo } from './registro-ritardo'
import {
  causalePredefinitaDaFir,
  dataOperazioneDaFir,
  firCollegabileNelRegistro,
  quantitaDaFir,
  RuoloFir,
} from './registro-fir'
import { CerSelectComponent } from '../cer/cer-select.component'
import { GiacenzeInizialiDialogComponent } from './giacenze-iniziali-dialog.component'
import {
  RentriRegistroPannelloComponent,
  RentriRigaAzioniComponent,
  StatoPannelloRentri,
} from './rentri-registro-pannello.component'
import { eSelezionabile } from './stato-rentri'
import { CausaliRegistroDialogComponent } from './causali-registro-dialog.component'
import {
  CorreggiMovimentoDialogComponent,
  ModoCorrezione,
  messaggioErroreCorrezione,
} from './correggi-movimento-dialog.component'
import {
  MESSAGGIO_CAUSALE_NON_VALIDA,
  causaleSelezionabile,
  giornoLocale,
  opzioniCausali,
} from './registro-opzioni'
import { CausaliRegistroService, OpzioneCausaleApi } from './causali-registro.service'
import {
  eVigente,
  testoAnnotazione,
  testoCorrezione,
  testoEsitoVerifica,
} from './registro-correzioni'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

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
    NumeroItalianoDirective,
    InputTextModule,
    InputTextareaModule,
    DropdownModule,
    AutoCompleteModule,
    TooltipModule,
    PaginatorModule,
    CerSelectComponent,
    GiacenzeInizialiDialogComponent,
    RentriRegistroPannelloComponent,
    RentriRigaAzioniComponent,
    CausaliRegistroDialogComponent,
    CorreggiMovimentoDialogComponent,
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
            *ngIf="offriProgressivo()"
            label="Imposta il primo numero dell'anno"
            icon="pi pi-sort-numeric-up"
            [outlined]="true"
            (onClick)="apriProgressivo()"
            ariaLabel="Imposta il primo numero del registro dell'anno"
          ></p-button>
          <p-button
            *ngIf="offriGiacenzeIniziali()"
            label="Giacenze iniziali"
            icon="pi pi-database"
            [outlined]="true"
            data-testid="registro-giacenze-iniziali"
            (onClick)="apriGiacenzeIniziali()"
            ariaLabel="Apri le giacenze iniziali del registro"
          ></p-button>
          <p-button
            *ngIf="offriGestioneCausali()"
            label="Causali"
            icon="pi pi-tags"
            [outlined]="true"
            data-testid="registro-causali"
            (onClick)="apriGestioneCausali()"
            ariaLabel="Gestisci le causali del registro"
          ></p-button>
          <p-button
            *ngIf="offriVerificaCatena()"
            label="Verifica catena"
            icon="pi pi-shield"
            [outlined]="true"
            [loading]="verificando()"
            data-testid="registro-verifica-catena"
            (onClick)="verificaCatena()"
            ariaLabel="Verifica l'integrità del registro dell'anno corrente"
          ></p-button>
          <p-button
            *ngIf="offriRegistrazione()"
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

        <div class="filters__field" *ngIf="piuRegistri()">
          <label class="filters__label" for="filtro-sede">Sede</label>
          <p-dropdown
            inputId="filtro-sede"
            data-testid="registro-sede-filtro"
            [options]="registriFiltroOptions()"
            [(ngModel)]="filtroRegistro"
            [ngModelOptions]="{ standalone: true }"
            (onChange)="onFiltroRegistroChange()"
            optionLabel="label"
            optionValue="value"
            placeholder="Tutte le sedi"
            [showClear]="true"
            styleClass="w-full"
            ariaLabel="Filtra per sede del registro"
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

      <!-- Esito della verifica della catena ----------------------------------->
      <section
        *ngIf="esitoVerifica() as e"
        class="esito-verifica"
        [class.esito-verifica--errore]="!!e.primoErrore"
        role="status"
        data-testid="registro-esito-verifica"
      >
        <i
          [class]="e.primoErrore ? 'pi pi-times-circle' : 'pi pi-check-circle'"
          aria-hidden="true"
        ></i>
        <span>{{ testoEsito(e) }}</span>
      </section>

      <!-- Trasmissione a RENTRI (solo con un registro determinato) -------------->
      <app-rentri-registro-pannello
        *ngIf="registroRentri() as registroId"
        [registroId]="registroId"
        [selezionati]="rentriSelezionati()"
        [annoCorrente]="annoCorrente"
        [aggiornamento]="rentriVersione()"
        (statoChange)="rentriStato.set($event)"
        (aggiornato)="onRentriAggiornato()"
      ></app-rentri-registro-pannello>

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
                <th *ngIf="rentriSelezionabile()" scope="col" style="width: 48px">
                  <span class="sr-only">Seleziona per la trasmissione a RENTRI</span>
                </th>
                <th scope="col" style="width: 96px">N° prog.</th>
                <th *ngIf="piuRegistri()" scope="col" data-testid="registro-col-sede">Sede</th>
                <th scope="col" style="width: 104px">Tipo</th>
                <th scope="col" style="width: 116px">Data op.</th>
                <th scope="col" style="width: 96px">CER</th>
                <th scope="col">Causale</th>
                <th scope="col" class="num-col" style="width: 128px">Quantità</th>
                <th scope="col">Controparte</th>
                <th scope="col" style="width: 72px">FIR</th>
                <th scope="col" style="width: 132px">Stato</th>
                <th
                  *ngIf="rentriColonna()"
                  scope="col"
                  style="width: 200px"
                  data-testid="registro-col-rentri"
                >
                  RENTRI
                </th>
                <th *ngIf="offriCorrezioni()" scope="col" style="width: 168px">
                  <span class="sr-only">Correzioni</span>
                </th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-m>
              <tr
                [class.riga-non-vigente]="!vigente(m)"
                [attr.data-testid]="'registro-riga-' + m.id"
              >
                <td *ngIf="rentriSelezionabile()">
                  <input
                    type="checkbox"
                    [attr.data-testid]="'registro-rentri-sel-' + m.id"
                    [checked]="rentriSelezionati().includes(m.id)"
                    [disabled]="!rentriSelezionabileRiga(m)"
                    (change)="rentriSeleziona(m, $any($event.target).checked)"
                    [attr.aria-label]="
                      'Seleziona l\\'annotazione ' +
                      numeroMovimento(m) +
                      ' per la trasmissione a RENTRI'
                    "
                  />
                </td>
                <td>
                  <span class="prog-badge">{{ m.progressiveYear }}/{{ m.progressiveNumber }}</span>
                </td>
                <td *ngIf="piuRegistri()" data-testid="registro-col-sede">
                  {{ etichettaSede(m.registroId) }}
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
                  <span class="causale-label">{{ causaleLabel(m) }}</span>
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
                    *ngIf="correzione(m) as c"
                    [value]="c"
                    severity="secondary"
                    icon="pi pi-history"
                    styleClass="stato-tag stato-tag--correzione"
                    [pTooltip]="tooltipCorrezione(m)"
                    [attr.data-testid]="'registro-correzione-' + m.id"
                  ></p-tag>
                  <p-tag
                    *ngIf="annotazione(m) as a"
                    [value]="a"
                    severity="info"
                    icon="pi pi-pencil"
                    styleClass="stato-tag stato-tag--correzione"
                    [pTooltip]="m.motivoAnnotazione ? 'Motivo: ' + m.motivoAnnotazione : a"
                    [attr.data-testid]="'registro-annotazione-' + m.id"
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
                <td *ngIf="rentriColonna()">
                  <app-rentri-riga-azioni
                    [movimentoId]="m.id"
                    [registroId]="m.registroId ?? registroRentri() ?? null"
                    [numero]="numeroMovimento(m)"
                    [trasmissione]="m.trasmissioneRentri ?? null"
                    [puoTrasmettere]="rentriStato().puoTrasmettere"
                    [puoConfigurare]="rentriStato().puoConfigurare === true"
                    (cambiato)="onRentriAggiornato()"
                  ></app-rentri-riga-azioni>
                </td>
                <td *ngIf="offriCorrezioni()" class="azioni-col">
                  <ng-container *ngIf="vigente(m)">
                    <p-button
                      label="Rettifica"
                      icon="pi pi-pencil"
                      [text]="true"
                      size="small"
                      [attr.data-testid]="'registro-rettifica-' + m.id"
                      (onClick)="apriCorrezione(m, 'rettifica')"
                      [ariaLabel]="'Rettifica il movimento ' + numeroMovimento(m)"
                    ></p-button>
                    <p-button
                      label="Annulla"
                      icon="pi pi-ban"
                      [text]="true"
                      severity="danger"
                      size="small"
                      [attr.data-testid]="'registro-annulla-' + m.id"
                      (onClick)="apriCorrezione(m, 'annullamento')"
                      [ariaLabel]="'Annulla il movimento ' + numeroMovimento(m)"
                    ></p-button>
                  </ng-container>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td [attr.colspan]="colonne()">
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

            <div class="field" *ngIf="piuRegistri()">
              <label for="registroSede"
                >Sede del registro <span class="req" aria-hidden="true">*</span></label
              >
              <p-dropdown
                inputId="registroSede"
                data-testid="registro-sede-select"
                formControlName="registroId"
                [options]="registriFormOptions()"
                optionLabel="label"
                optionValue="value"
                placeholder="Scegli la sede"
                styleClass="w-full"
                ariaLabel="Sede del registro in cui registrare il movimento"
                [attr.aria-invalid]="hasError('registroId') ? true : null"
              ></p-dropdown>
              <small *ngIf="hasError('registroId')" class="field-error" role="alert"
                >Scegli la sede: l'azienda ha più registri e nessuno è predefinito.</small
              >
              <small *ngIf="sedeBloccataDaFir()" data-testid="sede-bloccata-fir"
                >Un FIR si registra nel registro della sede principale.</small
              >
            </div>

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
              <small
                *ngIf="messaggioCausale() as msg"
                class="field-hint"
                role="status"
                data-testid="registro-causale-messaggio"
                >{{ msg }}</small
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
                  <label for="registrationDate">Data registrazione</label>
                  <!-- In sola lettura: la data di registrazione la assegna il server. -->
                  <p-calendar
                    formControlName="registrationDate"
                    [showIcon]="true"
                    dateFormat="dd/mm/yy"
                    inputId="registrationDate"
                    ariaLabel="Data di annotazione nel registro, assegnata dal sistema"
                    styleClass="w-full"
                  ></p-calendar>
                  <small class="field-hint">Assegnata dal sistema alla conferma.</small>
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
                    appNumeroIt
                    [useGrouping]="false"
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

      <!-- Dialog progressivo iniziale (C-W-02) ---------------------------------->
      <p-dialog
        [(visible)]="progressivoVisible"
        [header]="titoloProgressivo()"
        [modal]="true"
        [closable]="true"
        [style]="{ width: '480px', maxWidth: '95vw' }"
        (onHide)="chiudiProgressivo()"
        closeAriaLabel="Chiudi la finestra del primo numero del registro"
      >
        <form [formGroup]="progressivoForm" class="mov-form">
          <p
            *ngIf="etichettaSedeProgressivo() as sede"
            class="progressivo-sede"
            data-testid="progressivo-sede"
          >
            Il numero vale per il registro di <strong>{{ sede }}</strong
            >. L'impostazione è irreversibile.
          </p>
          <p class="progressivo-nota">
            Serve solo a chi arriva da un altro programma a metà anno: il primo movimento registrato
            qui prenderà questo numero. Si imposta una volta sola.
          </p>
          <div class="field">
            <label for="primoProgressivo"
              >Primo numero <span class="req" aria-hidden="true">*</span></label
            >
            <p-inputNumber
              appNumeroIt
              locale="it-IT"
              soloIntero
              [maxFractionDigits]="0"
              formControlName="primoProgressivo"
              inputId="primoProgressivo"
              [min]="1"
              [max]="9999999"
              [useGrouping]="false"
              ariaRequired="true"
              [styleClass]="errorProgressivo('primoProgressivo') ? 'w-full p-invalid' : 'w-full'"
              [attr.aria-invalid]="errorProgressivo('primoProgressivo') ? true : null"
              [attr.aria-describedby]="
                errorProgressivo('primoProgressivo') ? 'primo-progressivo-err' : null
              "
            ></p-inputNumber>
            <small
              *ngIf="errorProgressivo('primoProgressivo')"
              id="primo-progressivo-err"
              class="field-error"
              role="alert"
              >Indica un numero intero da 1 a 9999999.</small
            >
          </div>
          <div class="field">
            <label for="motivoProgressivo"
              >Motivo <span class="req" aria-hidden="true">*</span></label
            >
            <textarea
              id="motivoProgressivo"
              pInputTextarea
              formControlName="motivo"
              rows="3"
              maxlength="500"
              placeholder="Es. migrazione da WinWaste: ultimo movimento trasmesso il n. 811"
              aria-required="true"
              [class.p-invalid]="errorProgressivo('motivo')"
              [attr.aria-invalid]="errorProgressivo('motivo') ? true : null"
              [attr.aria-describedby]="errorProgressivo('motivo') ? 'motivo-progressivo-err' : null"
            ></textarea>
            <small
              *ngIf="errorProgressivo('motivo')"
              id="motivo-progressivo-err"
              class="field-error"
              role="alert"
              >Scrivi il motivo (da 5 a 500 caratteri).</small
            >
          </div>
        </form>

        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudiProgressivo()"
            ariaLabel="Annulla e chiudi"
          ></p-button>
          <p-button
            label="Imposta"
            icon="pi pi-check"
            [loading]="savingProgressivo()"
            (onClick)="salvaProgressivo()"
            ariaLabel="Imposta il primo numero del registro"
          ></p-button>
        </ng-template>
      </p-dialog>

      <!-- Dialog rettifica / annullamento ------------------------------------->
      <app-correggi-movimento-dialog
        *ngIf="correzioneVisibile"
        [(visible)]="correzioneVisibile"
        [modo]="correzioneModo"
        [movimento]="correzioneMovimento"
        (corretto)="onCorretto($event)"
      ></app-correggi-movimento-dialog>

      <!-- Dialog gestione causali (solo ADMIN) -------------------------------->
      <app-causali-registro-dialog
        *ngIf="causaliVisible"
        [(visible)]="causaliVisible"
      ></app-causali-registro-dialog>

      <!-- Dialog giacenze iniziali -------------------------------------------->
      <app-giacenze-iniziali-dialog
        *ngIf="giacenzeInizialiVisible"
        [(visible)]="giacenzeInizialiVisible"
        [registroId]="registroGiacenzeIniziali()"
        [sede]="etichettaSedeProgressivo()"
      ></app-giacenze-iniziali-dialog>
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
      :host ::ng-deep .stato-tag--correzione {
        margin-top: 4px;
      }
      /* Annotazioni non più vigenti: restano leggibili ma attenuate. */
      .riga-non-vigente > td {
        opacity: 0.6;
      }
      .azioni-col {
        white-space: nowrap;
        text-align: right;
      }
      .esito-verifica {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        margin-bottom: var(--spacing-base);
        border: 1px solid var(--brand-primary-100);
        background: var(--brand-primary-50);
        color: var(--brand-primary-dark);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
      }
      .esito-verifica--errore {
        border-color: var(--color-danger);
        background: var(--color-danger-bg, #fef2f2);
        color: var(--color-danger);
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
      .progressivo-nota {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.5;
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
  private readonly causali = inject(CausaliRegistroService)
  private readonly destroyRef = inject(DestroyRef)
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

  /** Opzioni arrivate dall'API per un tipo e un giorno (assenti finché non arrivano). */
  private readonly opzioniApi = signal<{
    tipo: TipoMovimento
    giorno: string
    causali: OpzioneCausaleApi[]
  } | null>(null)

  /** Spiega perché la causale è stata azzerata dopo un cambio di data. */
  readonly messaggioCausale = signal<string | null>(null)

  /** Causali del tipo e della data del form, dall'API: mai quelle di un altro tipo. */
  readonly causaliOptions = computed<DropdownOption<string>[]>(() => {
    const o = this.opzioniApi()
    return o && o.tipo === this.tipoCorrente() ? opzioniCausali(o.causali) : []
  })

  private readonly ricaricaOpzioni = new Subject<{ tipo: TipoMovimento; giorno: string }>()
  private sottoscrizioneOpzioni: Subscription | null = null
  private sottoscrizioneProposta: Subscription | null = null

  readonly statiFisiciOptions = STATI_FISICI.map(s => ({ label: s, value: s }))

  readonly formTitolo = computed(() =>
    this.tipoCorrente() === 'SCARICO' ? 'Registra scarico' : 'Registra carico'
  )

  // ─── Avvertimento ritardo ────────────────────────────────────────────────

  readonly ritardoGgCalcolati = computed(() => {
    const mov = this.form?.get('movementDate')?.value as Date | null
    // La registrazione avviene alla conferma: il ritardo si misura rispetto a oggi,
    // in giorni di calendario italiani come fa il backend.
    if (!mov) return 0
    return giorniDiRitardo(mov)
  })

  readonly ritardoGgCalcolato = computed(() => this.ritardoGgCalcolati())

  readonly ritardoAvvertimento = computed(() => this.ritardoGgCalcolati() > 14)

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  ngOnInit(): void {
    this.initForm()
    this.ricarica()
    this.caricaRegistri()
    // Identità della società attiva: serve all'auto-tipo carico/scarico dal FIR.
    this.company.loadActiveCompany().subscribe()
  }

  // ─── Form ─────────────────────────────────────────────────────────────────

  initForm(): void {
    this.form = this.fb.group({
      registroId: [null as string | null],
      type: ['CARICO', Validators.required],
      movementDate: [new Date(), Validators.required],
      // Sola lettura: mostra la data di oggi, il server assegna quella vera alla conferma.
      registrationDate: [{ value: new Date(), disabled: true }],
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
    this.avviaOpzioniCausali()
  }

  /**
   * Le opzioni delle causali si caricano con `switchMap` sulle modifiche di tipo e di data (il
   * giorno, non la `Date`: nessuna richiesta per ogni tasto e nessuno spostamento di fuso). Se
   * dopo un cambio di data la causale scelta non è più fra le opzioni, si azzera con un messaggio.
   */
  private avviaOpzioniCausali(): void {
    this.sottoscrizioneOpzioni?.unsubscribe()
    const tipo = this.form.get('type')!
    const data = this.form.get('movementDate')!
    const chiavi$ = combineLatest([
      tipo.valueChanges.pipe(startWith(tipo.value as TipoMovimento)),
      data.valueChanges.pipe(startWith(data.value as Date | null)),
    ]).pipe(
      // tipo e data cambiano in sequenza (anche con un reset): una sola richiesta
      auditTime(0),
      map(([t, d]) =>
        d instanceof Date && !isNaN(d.getTime())
          ? { tipo: t as TipoMovimento, giorno: giornoLocale(d) }
          : null
      ),
      filter((k): k is { tipo: TipoMovimento; giorno: string } => k !== null),
      distinctUntilChanged((a, b) => a.tipo === b.tipo && a.giorno === b.giorno)
    )
    this.sottoscrizioneOpzioni = merge(chiavi$, this.ricaricaOpzioni)
      .pipe(
        switchMap(k =>
          this.causali.opzioni(k.tipo, k.giorno).pipe(
            map(causali => ({ ...k, causali })),
            catchError(() => {
              this.toast.error('Impossibile caricare le causali: riprova fra poco.')
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(o => {
        const precedente = this.opzioniApi()
        this.opzioniApi.set(o)
        const ctrl = this.form.get('causale')
        const scelta = ctrl?.value as string | null
        if (scelta && !causaleSelezionabile(o.causali, scelta)) {
          ctrl?.reset(null)
          // al cambio di tipo la causale si azzera comunque (`onTipoChange`): il messaggio
          // serve solo quando a far decadere la scelta è stata la data
          this.messaggioCausale.set(
            precedente && precedente.tipo === o.tipo ? MESSAGGIO_CAUSALE_NON_VALIDA : null
          )
        } else {
          this.messaggioCausale.set(null)
        }
      })
  }

  apriForm(): void {
    // opzioni fresche a ogni apertura: il catalogo può essere cambiato nel frattempo
    this.causali.invalida()
    this.messaggioCausale.set(null)
    this.tipoCorrente.set('CARICO')
    this.form.reset({
      type: 'CARICO',
      movementDate: new Date(),
      registrationDate: new Date(),
      causale: null,
      unit: 'KG',
    })
    // la chiave dopo il reset puo' essere uguale all'ultima vista (distinctUntilChanged) e il
    // catalogo e' stato invalidato: la rilettura va chiesta esplicitamente
    this.ricaricaOpzioni.next({ tipo: 'CARICO', giorno: giornoLocale(new Date()) })
    this.sottoscrizioneProposta?.unsubscribe()
    this.sottoscrizioneProposta = null
    this.sedeBloccataDaFir.set(false)
    this.form.get('registroId')?.enable({ emitEvent: false })
    this.applicaRegistroAlForm(true)
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

  /**
   * Con più sedi la sede è obbligatoria e si precompila: la sede filtrata (se attiva), altrimenti
   * il predefinito; se non c'è, si deve scegliere. Con `precompila` false non tocca un valore già scelto.
   */
  private applicaRegistroAlForm(precompila: boolean): void {
    const regCtrl = this.form.get('registroId')
    if (!regCtrl) return
    regCtrl.setValidators(this.piuRegistri() ? [Validators.required] : [])
    if (!this.piuRegistri()) regCtrl.setValue(null)
    else if (precompila || !regCtrl.value) {
      const filtrato = this.registri().find(r => r.id === this.filtroRegistro && r.attivo)
      regCtrl.setValue(filtrato?.id ?? registroPredefinito(this.registri()) ?? null)
    }
    regCtrl.updateValueAndValidity()
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
    this.messaggioCausale.set(null)
    // Se è collegato un FIR, controparte e quantità dipendono dalla direzione: per un
    // CARICO la controparte è il produttore/cedente, per uno SCARICO il destinatario; la
    // quantità è il peso a destino solo per il carico del destinatario (C-W-01).
    if (this.firCollegato) {
      this.applicaControparteDaFir(this.firCollegato, tipo)
      const q = quantitaDaFir(this.firCollegato, tipo, this.determinaRuolo(this.firCollegato))
      this.form.patchValue({ quantity: q.quantita, unit: q.unita })
    }
  }

  // ─── Collegamento FIR (autocomplete ricercabile + auto-compilazione) ────────

  /** Carica (una volta) i FIR del tenant per l'autocomplete. */
  private caricaFir(): void {
    if (this.tuttiFir.length > 0) return
    this.firService.getFIRList(1, 200).subscribe({
      next: res => {
        this.tuttiFir = (res.items ?? []).filter(firCollegabileNelRegistro)
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
    this.bloccaSedeSeFir()

    // Determina il ruolo della società attiva rispetto alle parti del FIR.
    const ruolo = this.determinaRuolo(fir)
    let tipo: TipoMovimento = this.form.get('type')?.value ?? 'CARICO'
    if (ruolo === 'PRODUTTORE') tipo = 'SCARICO'
    else if (ruolo === 'DESTINATARIO') tipo = 'CARICO'

    this.form.get('type')?.setValue(tipo)
    this.tipoCorrente.set(tipo)

    // Causale di default solo con il ruolo riconosciuto (Decisione 13): altrimenti il
    // campo resta com'è e, se vuoto, la sceglie l'utente (è obbligatorio). Si applica più
    // sotto, dopo che sono arrivate le opzioni del tipo e della data del FIR.
    const causaleDefault = causalePredefinitaDaFir(tipo, ruolo)

    // Data dell'operazione solo se WasteFlow la conosce davvero e non è nel futuro;
    // altrimenti resta quella del form e il suggerimento spiega dove trovarla.
    const esito = dataOperazioneDaFir(fir, tipo)
    let suggerimentoData: string | null = esito.suggerimento
    if (esito.data) {
      if (this.giornoLocale(esito.data) > this.giornoLocale(new Date())) {
        suggerimentoData =
          'La data del FIR è successiva a oggi: inserisci la data effettiva dell’operazione.'
      } else {
        this.form.get('movementDate')?.setValue(esito.data)
      }
    }

    // Auto-compilazione dei dati del rifiuto dal FIR (campi modificabili). La quantità
    // dipende dal verso: il carico del destinatario prende il peso verificato a destino.
    const r = fir.rifiuto
    const q = quantitaDaFir(fir, tipo, ruolo)
    this.form.patchValue({
      firId: fir.id,
      cerCode: r.cerCode,
      quantity: q.quantita,
      unit: q.unita,
      wasteDescription: r.descrizione ?? '',
      wastePhysicalState: this.matchStatoFisico(r.statoFisico),
      wasteHazardClasses: r.caratteristichePericolo ?? '',
      operationCode: r.codiceOperazione ?? '',
    })

    // Controparte in base alla direzione del movimento.
    this.applicaControparteDaFir(fir, tipo)

    this.proponiCausaleDaFir(causaleDefault, tipo)

    // Hint sul ruolo determinato, seguito dagli eventuali suggerimenti su data e quantità.
    let hint: string
    if (ruolo === 'PRODUTTORE') {
      hint = 'La società attiva risulta PRODUTTORE del FIR: movimento impostato come SCARICO.'
    } else if (ruolo === 'DESTINATARIO') {
      hint = 'La società attiva risulta DESTINATARIO del FIR: movimento impostato come CARICO.'
    } else {
      hint =
        'Ruolo della società non determinabile dal FIR: verifica il tipo (carico/scarico) ' +
        'e scegli la causale. I dati del rifiuto sono stati comunque precompilati.'
    }
    this.ruoloHint.set([hint, suggerimentoData, q.suggerimento].filter(Boolean).join(' '))
  }

  /**
   * M7. La causale proposta dal FIR si applica solo quando le opzioni del tipo e della data
   * del form (già quelli del FIR) sono arrivate e la contengono: prima non si imposta nulla
   * (un caricamento lento non deve cancellare né saltare la proposta), e se la causale è
   * disattivata o non valida a quella data non c'è proposta e si sceglie a mano.
   */
  private proponiCausaleDaFir(codice: string | null, tipo: TipoMovimento): void {
    this.sottoscrizioneProposta?.unsubscribe()
    this.sottoscrizioneProposta = null
    if (!codice) return
    const data = this.form.get('movementDate')?.value as Date | null
    if (!(data instanceof Date) || isNaN(data.getTime())) return
    const giorno = giornoLocale(data)
    const ctrl = this.form.get('causale')
    const valorePrima = (ctrl?.value ?? null) as string | null
    this.sottoscrizioneProposta = this.causali
      .opzioni(tipo, giorno)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: righe => {
          const corrente = this.form.get('movementDate')?.value as Date | null
          const ancoraQuesto =
            this.form.get('type')?.value === tipo &&
            corrente instanceof Date &&
            giornoLocale(corrente) === giorno
          if (!ancoraQuesto) return
          if (!causaleSelezionabile(righe, codice)) {
            this.ruoloHint.update(h =>
              [
                h,
                'La causale prevista per questo FIR non è disponibile alla data indicata: scegli la causale.',
              ]
                .filter(Boolean)
                .join(' ')
            )
            return
          }
          // se nel frattempo l'utente ha scelto un'altra causale, la sua scelta vince
          const attuale = (ctrl?.value ?? null) as string | null
          if (attuale === null || attuale === valorePrima) ctrl?.setValue(codice)
        },
        error: () => {
          // il messaggio di errore lo mostra già il caricamento delle opzioni del form
        },
      })
  }

  /** Giorno di calendario locale ('AAAA-MM-GG'), come lo invia `toIsoDate` al backend. */
  private giornoLocale(d: Date): string {
    return giornoLocale(d)
  }

  /** D10: un FIR si ricopia solo nel registro della sede principale; senza principale la scelta resta libera. */
  readonly sedeBloccataDaFir = signal(false)

  private bloccaSedeSeFir(): void {
    const principale = this.registri().find(r => r.principale)
    if (!this.piuRegistri() || !principale) return
    const ctrl = this.form.get('registroId')
    ctrl?.setValue(principale.id)
    ctrl?.disable({ emitEvent: false })
    this.sedeBloccataDaFir.set(true)
  }

  /** Rimozione del FIR collegato: azzera il riferimento e l'hint. */
  onFirClear(): void {
    this.selectedFir = null
    this.firCollegato = null
    this.sedeBloccataDaFir.set(false)
    this.form.get('registroId')?.enable({ emitEvent: false })
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
  private determinaRuolo(fir: FIR): RuoloFir | null {
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
    // il controllo della sede è disabilitato (assente da `value`) quando la blocca il FIR
    const registroScelto: string | null = this.form.get('registroId')?.value ?? null
    this.saving.set(true)

    // Usa i componenti locali della data per evitare lo shift UTC negativo
    // (es. GMT+2: scegliendo il 29 giugno, toISOString() restituirebbe il 28).
    const toIsoDate = giornoLocale

    this.registroService
      .registra({
        registroId: this.piuRegistri() && registroScelto ? registroScelto : undefined,
        type: v.type,
        movementDate: toIsoDate(v.movementDate),
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
          const messaggio = messaggioMovimentoRegistrato(m)
          if (m.giaRegistrato) this.toast.info(messaggio)
          else this.toast.success(messaggio)
          for (const avviso of m.avvisi ?? []) this.toast.warn(avviso)
          this.ricarica()
          // Dopo il primo movimento dell'anno il progressivo iniziale non si offre più.
          this.caricaProgressivo()
        },
        error: err => {
          this.saving.set(false)
          const msg = err?.error?.message ?? err?.message ?? 'Errore durante la registrazione'
          this.toast.error(msg)
          if (err?.status === 409 && err?.error?.error === 'CAUSALE_MODIFICATA') {
            // la causale è cambiata mentre si compilava: opzioni nuove per tipo e data del form
            this.causali.invalida()
            this.ricaricaOpzioni.next({ tipo: v.type, giorno: toIsoDate(v.movementDate) })
          }
        },
      })
  }

  // ─── Rettifica, annullamento, verifica della catena (Fase 2 pezzo 3) ───────

  correzioneVisibile = false
  correzioneModo: ModoCorrezione = 'rettifica'
  correzioneMovimento: Movimento | null = null

  readonly esitoVerifica = signal<EsitoVerificaCatena | null>(null)
  readonly verificando = signal(false)

  vigente(m: Movimento): boolean {
    return eVigente(m)
  }
  correzione(m: Movimento): string | null {
    return testoCorrezione(m)
  }
  annotazione(m: Movimento): string | null {
    return testoAnnotazione(m)
  }
  testoEsito(e: EsitoVerificaCatena): string {
    const sede = this.piuRegistri() ? `${this.etichettaSede(e.registroId)}: ` : ''
    return sede + testoEsitoVerifica(e)
  }
  numeroMovimento(m: Movimento): string {
    return `${m.progressiveNumber}/${m.progressiveYear}`
  }
  tooltipCorrezione(m: Movimento): string {
    return m.stato === 'ANNULLATO'
      ? 'Annullato: la registrazione non conta più nei calcoli'
      : 'Sostituito da una rettifica: non conta più nei calcoli'
  }

  /** Come "Registra movimento": il backend è l'arbitro, qui si nasconde solo la sola consultazione. */
  readonly offriCorrezioni = computed(() => offrireRegistrazione(this.statoProgressivo()))

  /** Colonne della tabella (serve al colspan del messaggio di elenco vuoto). */
  readonly colonne = computed(
    () =>
      9 +
      (this.piuRegistri() ? 1 : 0) +
      (this.offriCorrezioni() ? 1 : 0) +
      (this.rentriColonna() ? 1 : 0) +
      (this.rentriSelezionabile() ? 1 : 0)
  )

  // ─── Trasmissione a RENTRI ────────────────────────────────────────────────

  /** Stato comunicato dal pannello: collegato a RENTRI e permesso di trasmettere (dal backend). */
  readonly rentriStato = signal<StatoPannelloRentri>({ collegato: false, puoTrasmettere: false })
  readonly rentriSelezionati = signal<string[]>([])
  /** Il pannello c'è solo con un registro determinato (come le giacenze iniziali). */
  registroRentri(): string | undefined {
    return this.registroGiacenzeIniziali()
  }
  /**
   * Con più sedi la colonna e la selezione valgono solo con la sede filtrata: senza filtro
   * l'elenco mescola registri diversi e un invio con id di altri registri fallirebbe per intero.
   */
  readonly rentriColonna = () =>
    !!this.registroRentri() &&
    this.rentriStato().collegato &&
    (!this.piuRegistri() || !!this.filtroRegistro)
  readonly rentriVersione = signal(0)
  readonly rentriSelezionabile = () => this.rentriColonna() && this.rentriStato().puoTrasmettere

  rentriSelezionabileRiga(m: Movimento): boolean {
    return eSelezionabile(m.trasmissioneRentri?.stato) && m.registroId === this.registroRentri()
  }

  rentriSeleziona(m: Movimento, scelta: boolean): void {
    if (scelta && !this.rentriSelezionabileRiga(m)) return
    this.rentriSelezionati.update(ids =>
      scelta ? (ids.includes(m.id) ? ids : [...ids, m.id]) : ids.filter(id => id !== m.id)
    )
  }

  /** Dopo un invio o un'azione di riga: selezione svuotata ed elenco riletto. */
  onRentriAggiornato(): void {
    this.rentriSelezionati.set([])
    this.rentriVersione.update(v => v + 1)
    this.ricarica(this.paginazione().page)
  }

  /** Registro da verificare: lo stesso delle giacenze iniziali (filtro, predefinito, stato). */
  private registroVerifica(): string | undefined {
    return this.registroGiacenzeIniziali()
  }

  /** Solo chi amministra l'azienda (lo dice il backend, non il token) e con un registro determinato. */
  readonly offriVerificaCatena = computed(
    () =>
      this.statoProgressivo()?.puoImpostare === true &&
      (!this.piuRegistri() || !!this.registroVerifica())
  )

  apriCorrezione(m: Movimento, modo: ModoCorrezione): void {
    this.correzioneMovimento = m
    this.correzioneModo = modo
    this.correzioneVisibile = true
  }

  /** Dopo una correzione riuscita: elenco e stato del progressivo si rileggono. */
  onCorretto(esito?: EsitoCorrezioneMovimento): void {
    // Correzione di un'annotazione già su RENTRI: l'utente deve sapere come verrà trasmessa.
    if (esito?.avvisoRentri) this.toast.warn(esito.avvisoRentri)
    this.esitoVerifica.set(null)
    this.ricarica(this.paginazione().page)
    this.caricaProgressivo()
  }

  verificaCatena(): void {
    this.verificando.set(true)
    this.registroService.verificaCatena(this.annoCorrente, this.registroVerifica()).subscribe({
      next: esito => {
        this.verificando.set(false)
        this.esitoVerifica.set(esito)
      },
      error: err => {
        this.verificando.set(false)
        this.esitoVerifica.set(null)
        this.toast.error(messaggioErroreCorrezione(err))
      },
    })
  }

  // ─── Progressivo iniziale (C-W-02) ─────────────────────────────────────────

  /** Stato letto dal backend; null finché non arriva o se la lettura fallisce. */
  readonly statoProgressivo = signal<StatoProgressivoIniziale | null>(null)
  readonly savingProgressivo = signal(false)
  /** Il pulsante dipende da ruolo e movimenti come li vede il backend, non dal token. */
  readonly offriProgressivo = computed(
    () =>
      offrireProgressivoIniziale(this.statoProgressivo()) &&
      // Con più sedi e nessuna scelta non si offre un valore di cui non si sa il registro.
      (!this.piuRegistri() || !!this.statoProgressivo()?.registroId)
  )
  /**
   * Registro delle giacenze iniziali: lo stesso del progressivo (sede filtrata, predefinito o
   * quello risolto dal backend). Undefined = non determinato (più sedi senza scelta).
   */
  registroGiacenzeIniziali(): string | undefined {
    return (
      this.filtroRegistro ??
      registroPredefinito(this.registri()) ??
      this.statoProgressivo()?.registroId ??
      undefined
    )
  }
  /** Visibile a tutti quando il registro è determinato: la scrittura la decide il backend. */
  offriGiacenzeIniziali(): boolean {
    return !this.piuRegistri() || !!this.registroGiacenzeIniziali()
  }
  giacenzeInizialiVisible = false

  /** La gestione delle causali e' per l'amministratore effettivo (lo dice il backend); il 403 si mostra. */
  readonly offriGestioneCausali = computed(() => this.statoProgressivo()?.puoImpostare === true)
  causaliVisible = false

  apriGestioneCausali(): void {
    this.causaliVisible = true
  }

  apriGiacenzeIniziali(): void {
    this.giacenzeInizialiVisible = true
  }

  /** Nasconde "Registra movimento" a chi è in sola consultazione nell'azienda selezionata. */
  readonly offriRegistrazione = computed(() => offrireRegistrazione(this.statoProgressivo()))
  readonly annoCorrente = annoItaliano(new Date())

  // ─── Registri (uno per sede) ───────────────────────────────────────────────

  readonly registri = signal<RegistroVista[]>([])
  /** Selettore, filtro e colonna "Sede" compaiono solo se l'azienda ha più di un registro. */
  readonly piuRegistri = computed(() => this.registri().length > 1)
  readonly registriFiltroOptions = computed(() =>
    this.registri().map(r => ({ label: etichettaRegistro(r), value: r.id }))
  )
  readonly registriFormOptions = computed(() =>
    this.registri()
      .filter(r => r.attivo)
      .map(r => ({ label: etichettaRegistro(r), value: r.id }))
  )
  filtroRegistro: string | null = null

  /**
   * Registro a cui si riferisce il progressivo iniziale: la sede filtrata, altrimenti il
   * predefinito. Con più sedi e nessuna scelta resta `undefined`: nessun valore finché
   * la sede non è scelta.
   */
  private registroProgressivo(): string | undefined {
    return this.filtroRegistro ?? registroPredefinito(this.registri())
  }

  /** Sede a cui si applica il progressivo; null con un solo registro (nessuna ambiguità). */
  etichettaSedeProgressivo(): string | null {
    if (!this.piuRegistri()) return null
    const id = this.registroProgressivo() ?? this.statoProgressivo()?.registroId ?? undefined
    const r = this.registri().find(x => x.id === id)
    return r ? etichettaRegistro(r) : null
  }

  titoloProgressivo(): string {
    const sede = this.etichettaSedeProgressivo()
    return `Primo numero del registro ${this.annoCorrente}` + (sede ? ` · ${sede}` : '')
  }

  etichettaSede(registroId?: string | null): string {
    const r = this.registri().find(x => x.id === registroId)
    return r ? etichettaRegistro(r) : '—'
  }

  /**
   * All'apertura: lo stato del backend dice se l'utente può registrare. Chi può chiede
   * `assicura` (crea il registro di ogni sede); gli altri, o se `assicura` rifiuta con
   * 403, ripiegano sulla sola lettura senza mostrare errori.
   */
  caricaRegistri(): void {
    this.registroService.getProgressivoIniziale(this.annoCorrente).subscribe({
      next: stato => {
        this.statoProgressivo.set(stato)
        this.leggiRegistri(offrireRegistrazione(stato))
      },
      error: () => {
        this.statoProgressivo.set(null)
        this.leggiRegistri(false)
      },
    })
  }

  private leggiRegistri(puoRegistrare: boolean): void {
    const ripiego = () =>
      this.registroService.listRegistri().subscribe({
        next: r => this.impostaRegistri(r),
        error: () => this.impostaRegistri([]),
      })
    if (!puoRegistrare) {
      ripiego()
      return
    }
    this.registroService.assicuraRegistri().subscribe({
      next: r => this.impostaRegistri(r),
      error: () => ripiego(),
    })
  }

  private impostaRegistri(registri: RegistroVista[]): void {
    this.registri.set(registri)
    // Registri arrivati a form già aperto: validatore e valore vanno applicati anche qui.
    if (this.formVisible) this.applicaRegistroAlForm(false)
    this.caricaProgressivo()
  }

  onFiltroRegistroChange(): void {
    this.rentriStato.set({ collegato: false, puoTrasmettere: false })
    this.rentriSelezionati.set([])
    this.rentriVersione.update(v => v + 1)
    this.esitoVerifica.set(null)
    this.ricarica(1)
    this.caricaProgressivo()
  }
  progressivoVisible = false

  readonly progressivoForm: FormGroup = this.fb.group({
    primoProgressivo: [
      null,
      [
        Validators.required,
        Validators.min(1),
        Validators.max(9999999),
        Validators.pattern(/^\d+$/),
      ],
    ],
    motivo: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(500)]],
  })

  caricaProgressivo(): void {
    this.registroService
      .getProgressivoIniziale(this.annoCorrente, this.registroProgressivo())
      .subscribe({
        next: stato => this.statoProgressivo.set(stato),
        // In errore non si offre l'impostazione (non si sa a che punto è la sede), ma si
        // conserva ciò che si sapeva sul ruolo: "Registra movimento" non sparisce né compare.
        error: () =>
          this.statoProgressivo.update(prec =>
            prec ? { ...prec, puoImpostare: false, primoProgressivo: null } : null
          ),
      })
  }

  apriProgressivo(): void {
    this.progressivoForm.reset({ primoProgressivo: null, motivo: '' })
    this.progressivoVisible = true
  }

  chiudiProgressivo(): void {
    this.progressivoVisible = false
  }

  errorProgressivo(controlName: string): boolean {
    const control = this.progressivoForm.get(controlName)
    return !!(control && control.invalid && control.touched)
  }

  salvaProgressivo(): void {
    if (this.progressivoForm.invalid) {
      this.progressivoForm.markAllAsTouched()
      this.toast.error('Controlla i campi evidenziati e riprova.')
      return
    }
    const { primoProgressivo, motivo } = this.progressivoForm.value
    this.savingProgressivo.set(true)
    this.registroService
      .impostaProgressivoIniziale(
        this.annoCorrente,
        primoProgressivo,
        String(motivo).trim(),
        this.registroProgressivo()
      )
      .subscribe({
        next: r => {
          this.savingProgressivo.set(false)
          this.chiudiProgressivo()
          this.toast.success(
            `Il primo movimento del ${r.anno} registrato qui prenderà il numero ${r.primoProgressivo}.`
          )
          this.caricaProgressivo()
        },
        error: err => {
          this.savingProgressivo.set(false)
          const msg =
            err?.error?.message ?? err?.message ?? "Impossibile impostare il primo numero dell'anno"
          this.toast.error(msg)
          this.caricaProgressivo()
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
        registroId: this.filtroRegistro ?? undefined,
        page,
        limit: this.paginazione().limit,
      })
      .subscribe({
        next: (data: PaginatedMovimenti) => {
          this.movimenti.set(data.items)
          this.rentriSelezionati.set([])
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
    const cambiaSede = this.filtroRegistro !== null
    this.filtroRegistro = null
    if (cambiaSede) {
      this.esitoVerifica.set(null)
      this.rentriStato.set({ collegato: false, puoTrasmettere: false })
      this.rentriSelezionati.set([])
      this.rentriVersione.update(v => v + 1)
    }
    this.ricarica(1)
    if (cambiaSede) this.caricaProgressivo()
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
        registroId: this.filtroRegistro ?? undefined,
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
            // più registri: con il filtro la sede va nell'intestazione, senza nella colonna
            sede:
              this.piuRegistri() && this.filtroRegistro
                ? this.etichettaSede(this.filtroRegistro)
                : null,
            etichettaSede:
              this.piuRegistri() && !this.filtroRegistro
                ? (m: Movimento) => this.etichettaSede(m.registroId)
                : undefined,
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

  /** Etichetta della causale nell'elenco: la descrizione alla data del movimento, o il codice. */
  causaleLabel(m: Pick<Movimento, 'causale' | 'causaleDescrizione'>): string {
    return m.causaleDescrizione || m.causale
  }
}
