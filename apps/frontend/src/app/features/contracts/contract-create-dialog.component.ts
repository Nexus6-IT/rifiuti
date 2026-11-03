/**
 * ContractCreateDialogComponent — creazione e modifica di un contratto.
 *
 * Estratto da `contracts-list.component.ts`, che faceva lista, creazione e
 * cambio stato in un solo file.
 *
 * Con `contratto` null il dialog crea; con un contratto in ingresso lo modifica (Fase 4 pezzo 0).
 * In modifica quali campi si possono cambiare lo decide il backend (`modificabili` della vista,
 * D10): il frontend non replica le regole per stato, disabilita i campi non elencati. Alla
 * conferma manda solo i campi cambiati più la `versione` letta (lock ottimistico); `null` solo
 * quando l'operatore svuota un campo facoltativo. Il confronto locale serve a non mandare un
 * corpo inutile: la decisione resta del backend, di cui si mostrano i messaggi (400 e 409).
 *
 * Scelta portante: l'operatore non conosce gli id interni, quindi qui non se ne
 * digita nessuno. Il "Tipo controparte" non è più un campo: si deduce dal tipo
 * di contratto, e solo per i tipi che non ne implicano uno solo (servizio
 * completo, accordo quadro) viene chiesto esplicitamente.
 */

import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core'
import { HttpErrorResponse } from '@angular/common/http'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { CalendarModule } from 'primeng/calendar'
import { CheckboxModule } from 'primeng/checkbox'
import {
  MSG_NUMERO,
  formatNumero,
  leggiIntero,
  leggiNumero,
} from '../../shared/utils/numero-modificabile'
import { ToastService } from '../../core/services/toast.service'
import { TooltipModule } from 'primeng/tooltip'
import { AuthService } from '../../core/services/auth.service'
import { AnagraficaSelectComponent } from '../registry/anagrafica-select.component'
import {
  AnagraficaFormDialogComponent,
  AnagraficaSavedEvent,
  ModalitaAnagrafica,
  TipoAnagrafica,
} from '../registry/anagrafica-form-dialog.component'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import { CerMultiSelectComponent } from '../cer/cer-multi-select.component'
import {
  CAMPI_CONTRATTO,
  CampoContratto,
  Contract,
  ContractsService,
  ContractType,
  CreateContractDto,
  ModificaContrattoDto,
  messaggioDaErrore,
} from './contracts.service'
import {
  BILLING_FREQUENCY_LABELS,
  PAYMENT_TERM_LABELS,
  PRICING_LABELS,
  RegistroControparte,
  SelectOption,
  TYPE_LABELS,
  opzioni,
  registroDaTipoContratto,
  tipoControparteDaRegistro,
} from './contract-vocabulary'

const MSG_DUE_DECIMALI = 'Al massimo due decimali'
const MSG_CIFRE_INTERE = 'Al massimo otto cifre prima della virgola'

type CampoNumerico = 'basePrice' | 'durationMonths' | 'renewalNoticeDays'

@Component({
  selector: 'app-contract-create-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputTextareaModule,
    CalendarModule,
    CheckboxModule,
    TooltipModule,
    AnagraficaSelectComponent,
    AnagraficaFormDialogComponent,
    CerMultiSelectComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="onVisibleChange($event)"
      [modal]="true"
      [style]="{ width: '760px' }"
      [breakpoints]="{ '768px': '95vw' }"
      [header]="contratto ? 'Modifica contratto' : 'Nuovo contratto'"
    >
      <p
        *ngIf="contratto && ciSonoBloccati()"
        class="text-tertiary"
        role="status"
        id="c-bloccati-nota"
        data-testid="c-bloccati"
      >
        Alcuni campi non si possono cambiare nello stato attuale del contratto.
      </p>
      <div class="grid formgrid">
        <div class="field col-12 md:col-6">
          <label for="c-number" class="block mb-2">Numero contratto *</label>
          <input
            id="c-number"
            pInputText
            [(ngModel)]="form.contractNumber"
            placeholder="CTR-2026-001"
            class="w-full"
            aria-required="true"
            [attr.aria-describedby]="
              contratto
                ? campoBloccato('contractNumber')
                  ? 'c-bloccati-nota'
                  : null
                : 'c-number-hint'
            "
            [disabled]="campoBloccato('contractNumber')"
          />
          <small *ngIf="!contratto" id="c-number-hint" class="block mt-1 text-tertiary"
            >Proposto in automatico, modificabile.</small
          >
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-type" class="block mb-2">Tipo contratto *</label>
          <p-dropdown
            inputId="c-type"
            [options]="contractTypeOptions"
            [ngModel]="form.contractType"
            (ngModelChange)="onTipoContrattoCambiato($event)"
            [disabled]="campoBloccato('contractType')"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-producer" class="block mb-2">Produttore *</label>
          <div class="anagrafica-riga">
            <app-anagrafica-select
              #selProduttore
              inputId="c-producer"
              registro="produttori"
              ariaLabel="Produttore del contratto"
              [(ngModel)]="form.producerId"
              [disabled]="campoBloccato('producerId')"
            ></app-anagrafica-select>
            <ng-container *ngIf="puoGestire()">
              <p-button
                *ngIf="!campoBloccato('producerId')"
                icon="pi pi-plus"
                [outlined]="true"
                pTooltip="Nuovo produttore"
                tooltipPosition="top"
                ariaLabel="Nuovo produttore"
                data-testid="c-nuovo-produttore"
                (onClick)="apriAnagrafica('produttore', 'create', $event)"
              />
              <p-button
                icon="pi pi-pencil"
                [outlined]="true"
                pTooltip="Modifica produttore selezionato"
                tooltipPosition="top"
                ariaLabel="Modifica produttore selezionato"
                data-testid="c-modifica-produttore"
                [disabled]="!form.producerId"
                (onClick)="apriAnagrafica('produttore', 'edit', $event)"
              />
            </ng-container>
          </div>
        </div>

        <!-- Solo per i tipi che non implicano un registro univoco. -->
        <div class="field col-12 md:col-6" *ngIf="!registroImplicito()">
          <label for="c-cp-registro" class="block mb-2">Tipo controparte *</label>
          <p-dropdown
            inputId="c-cp-registro"
            [options]="registroOptions"
            [ngModel]="registroScelto()"
            (ngModelChange)="onRegistroScelto($event)"
            [disabled]="campoBloccato('counterpartyType')"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-counterparty" class="block mb-2">
            Controparte * <span class="text-tertiary">({{ etichettaControparte() }})</span>
          </label>
          <div class="anagrafica-riga" *ngIf="registroEffettivo() as reg">
            <app-anagrafica-select
              #selControparte
              inputId="c-counterparty"
              [registro]="reg"
              ariaLabel="Controparte del contratto"
              [(ngModel)]="form.counterpartyId"
              [disabled]="campoBloccato('counterpartyId')"
            ></app-anagrafica-select>
            <ng-container *ngIf="puoGestire()">
              <p-button
                *ngIf="!campoBloccato('counterpartyId')"
                icon="pi pi-plus"
                [outlined]="true"
                [pTooltip]="'Nuovo ' + tipoControparte(reg)"
                tooltipPosition="top"
                [ariaLabel]="'Nuovo ' + tipoControparte(reg)"
                data-testid="c-nuova-controparte"
                (onClick)="apriAnagrafica(tipoControparte(reg), 'create', $event)"
              />
              <p-button
                icon="pi pi-pencil"
                [outlined]="true"
                [pTooltip]="'Modifica ' + tipoControparte(reg) + ' selezionato'"
                tooltipPosition="top"
                [ariaLabel]="'Modifica ' + tipoControparte(reg) + ' selezionato'"
                data-testid="c-modifica-controparte"
                [disabled]="!form.counterpartyId"
                (onClick)="apriAnagrafica(tipoControparte(reg), 'edit', $event)"
              />
            </ng-container>
          </div>
          <small *ngIf="!registroEffettivo()" class="block text-tertiary">
            Scegli prima il tipo di controparte.
          </small>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-pricing" class="block mb-2">Modello di pricing *</label>
          <p-dropdown
            inputId="c-pricing"
            [options]="pricingModelOptions"
            [(ngModel)]="form.pricingModel"
            [disabled]="campoBloccato('pricingModel')"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12">
          <label for="c-cer" class="block mb-2">Codici CER *</label>
          <app-cer-multi-select
            inputId="c-cer"
            [(ngModel)]="form.cerCodes"
            [disabled]="campoBloccato('cerCodes')"
          ></app-cer-multi-select>
          <small class="block mt-1 text-tertiary">
            Cerca per codice o descrizione e scegli dal catalogo.
          </small>
        </div>

        <div class="field col-12 md:col-4">
          <label for="c-price" class="block mb-2">Prezzo base</label>
          <input
            id="c-price"
            pInputText
            inputmode="decimal"
            [ngModel]="testi.basePrice"
            (ngModelChange)="scriviNumero('basePrice', $event)"
            [disabled]="campoBloccato('basePrice')"
            [attr.aria-invalid]="erroriNumeri().basePrice ? 'true' : null"
            [attr.aria-describedby]="erroriNumeri().basePrice ? 'c-price-errore' : null"
            class="w-full"
          />
          <small
            *ngIf="erroriNumeri().basePrice as e"
            id="c-price-errore"
            role="alert"
            class="block mt-1 field-error"
            >{{ e }}</small
          >
        </div>
        <div class="field col-12 md:col-4">
          <label for="c-uom" class="block mb-2">Unità di misura</label>
          <input
            id="c-uom"
            pInputText
            [(ngModel)]="form.unitOfMeasure"
            [disabled]="campoBloccato('unitOfMeasure')"
            placeholder="kg"
            class="w-full"
          />
        </div>
        <div class="field col-12 md:col-4">
          <label for="c-duration" class="block mb-2">Durata (mesi)</label>
          <input
            id="c-duration"
            pInputText
            inputmode="numeric"
            [ngModel]="testi.durationMonths"
            (ngModelChange)="scriviNumero('durationMonths', $event)"
            [disabled]="campoBloccato('durationMonths')"
            [attr.aria-invalid]="erroriNumeri().durationMonths ? 'true' : null"
            [attr.aria-describedby]="erroriNumeri().durationMonths ? 'c-duration-errore' : null"
            class="w-full"
          />
          <small
            *ngIf="erroriNumeri().durationMonths as e"
            id="c-duration-errore"
            role="alert"
            class="block mt-1 field-error"
            >{{ e }}</small
          >
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-start" class="block mb-2">Data inizio *</label>
          <p-calendar
            inputId="c-start"
            [(ngModel)]="startDate"
            [disabled]="campoBloccato('startDate')"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            appendTo="body"
          ></p-calendar>
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-end" class="block mb-2">Data fine</label>
          <p-calendar
            inputId="c-end"
            [(ngModel)]="endDate"
            [disabled]="campoBloccato('endDate')"
            dateFormat="dd/mm/yy"
            [showIcon]="true"
            styleClass="w-full"
            inputStyleClass="w-full"
            appendTo="body"
          ></p-calendar>
        </div>

        <div class="field col-12 md:col-6">
          <label for="c-payment" class="block mb-2">Termini di pagamento</label>
          <p-dropdown
            inputId="c-payment"
            [options]="paymentTermsOptions"
            [(ngModel)]="form.paymentTerms"
            [disabled]="campoBloccato('paymentTerms')"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>
        <div class="field col-12 md:col-6">
          <label for="c-billing" class="block mb-2">Frequenza fatturazione</label>
          <p-dropdown
            inputId="c-billing"
            [options]="billingFrequencyOptions"
            [(ngModel)]="form.billingFrequency"
            [disabled]="campoBloccato('billingFrequency')"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>

        <div class="field col-12 flex align-items-center gap-2">
          <p-checkbox
            [(ngModel)]="form.autoRenew"
            [binary]="true"
            inputId="autoRenew"
            [disabled]="campoBloccato('autoRenew')"
          ></p-checkbox>
          <label for="autoRenew" class="mb-0">Rinnovo automatico</label>
        </div>
        <div class="field col-12 md:col-6" *ngIf="form.autoRenew">
          <label for="c-notice" class="block mb-2">Preavviso rinnovo (giorni)</label>
          <input
            id="c-notice"
            pInputText
            inputmode="numeric"
            [ngModel]="testi.renewalNoticeDays"
            (ngModelChange)="scriviNumero('renewalNoticeDays', $event)"
            [disabled]="campoBloccato('renewalNoticeDays')"
            [attr.aria-invalid]="erroriNumeri().renewalNoticeDays ? 'true' : null"
            [attr.aria-describedby]="erroriNumeri().renewalNoticeDays ? 'c-notice-errore' : null"
            class="w-full"
          />
          <small
            *ngIf="erroriNumeri().renewalNoticeDays as e"
            id="c-notice-errore"
            role="alert"
            class="block mt-1 field-error"
            >{{ e }}</small
          >
        </div>

        <div class="field col-12">
          <label for="c-desc" class="block mb-2">Descrizione</label>
          <textarea
            id="c-desc"
            pInputTextarea
            [(ngModel)]="form.description"
            [disabled]="campoBloccato('description')"
            rows="2"
            class="w-full"
          ></textarea>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          [label]="contratto ? 'Salva modifiche' : 'Crea contratto'"
          icon="pi pi-check"
          [loading]="saving()"
          (onClick)="salva()"
        />
      </ng-template>
    </p-dialog>

    <!-- Sub-dialog crea/modifica anagrafica (stesso componente della form FIR). -->
    <app-anagrafica-form-dialog
      [visible]="showAnagraficaDialog"
      (visibleChange)="onAnagraficaVisibleChange($event)"
      [tipo]="anagraficaTipo"
      [modalita]="anagraficaModalita"
      [entityData]="anagraficaEntityData"
      (saved)="onAnagraficaSaved($event)"
    />
  `,
  styles: [
    `
      .anagrafica-riga {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
      .anagrafica-riga > app-anagrafica-select {
        flex: 1 1 auto;
        min-width: 0;
      }
      .anagrafica-riga > p-button {
        flex: 0 0 auto;
      }
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .field {
        margin-bottom: 0;
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mb-0 {
        margin-bottom: 0;
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
    `,
  ],
})
export class ContractCreateDialogComponent implements OnChanges {
  private readonly contractsService = inject(ContractsService)
  private readonly toast = inject(ToastService)
  private readonly authService = inject(AuthService)

  /** Come per le liste anagrafiche: solo chi può scrivere nel registro vede «Nuovo»/«Modifica». */
  readonly puoGestire = computed(() => puoGestireAnagrafiche(this.authService.currentUser()?.role))

  @ViewChild('selProduttore') private selProduttore?: AnagraficaSelectComponent
  @ViewChild('selControparte') private selControparte?: AnagraficaSelectComponent

  // Sub-dialog anagrafica
  showAnagraficaDialog = false
  anagraficaTipo: TipoAnagrafica = 'produttore'
  anagraficaModalita: ModalitaAnagrafica = 'create'
  anagraficaEntityData: AnagraficaFormDialogComponent['entityData'] = null
  /** Il pulsante che ha aperto il sub-dialog: il focus gli torna alla chiusura. */
  private triggerAnagrafica: HTMLElement | null = null

  @Input() visible = false
  /** Contratto da modificare; `null` = creazione. */
  @Input() contratto: Contract | null = null
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Emesso a creazione avvenuta, perché la lista si ricarichi. */
  @Output() creato = new EventEmitter<void>()
  /** Emesso dopo una modifica (o un conflitto che rende vecchi i dati), perché la lista si ricarichi. */
  @Output() modificato = new EventEmitter<void>()

  readonly saving = signal(false)
  /** Registro scelto a mano, quando il tipo di contratto non ne implica uno. */
  readonly registroScelto = signal<RegistroControparte | null>(null)

  form: CreateContractDto = this.emptyForm()
  /**
   * Testo dei tre campi numerici, come lo scrive l'operatore: virgola decimale, il punto è un
   * errore e non compaiono le migliaia. `form` tiene il numero che parte per il backend.
   */
  testi: Record<CampoNumerico, string> = this.testiDa(this.form)
  /** Errore di ciascun campo numerico (null se vuoto o valido). */
  readonly erroriNumeri = signal<Partial<Record<CampoNumerico, string>>>({})
  startDate: Date | null = null
  endDate: Date | null = null

  readonly contractTypeOptions: SelectOption<ContractType>[] = (
    Object.keys(TYPE_LABELS) as ContractType[]
  ).map(t => ({ label: TYPE_LABELS[t], value: t }))

  // "Intermediario" non compare: non esiste un registro Intermediari da cui
  // scegliere la società, quindi sarebbe una scelta impossibile da portare a
  // termine. L'enum resta a DB per i contratti storici.
  readonly registroOptions: SelectOption<RegistroControparte>[] = [
    { label: 'Trasportatore', value: 'trasportatori' },
    { label: 'Destinatario', value: 'destinatari' },
  ]

  readonly pricingModelOptions = opzioni(PRICING_LABELS)
  readonly paymentTermsOptions = opzioni(PAYMENT_TERM_LABELS)
  readonly billingFrequencyOptions = opzioni(BILLING_FREQUENCY_LABELS)

  /** Scrive il testo di un campo numerico e ne aggiorna valore ed errore. */
  scriviNumero(campo: CampoNumerico, testo: string): void {
    this.testi = { ...this.testi, [campo]: testo }
    const errore = this.leggiCampoNumerico(campo, testo)
    if (campo === 'basePrice') {
      const e = leggiNumero(testo)
      this.form.basePrice = e.valore === null || errore ? undefined : Number(e.valore)
    } else {
      const e = leggiIntero(testo)
      const v = e.valore === null || errore ? null : e.valore
      if (campo === 'durationMonths') this.form.durationMonths = v ?? undefined
      else this.form.renewalNoticeDays = v ?? undefined
    }
    this.erroriNumeri.update(x => ({ ...x, [campo]: errore ?? undefined }))
  }

  private leggiCampoNumerico(campo: CampoNumerico, testo: string): string | null {
    if (campo === 'basePrice') {
      const e = leggiNumero(testo)
      if (e.errore) return e.errore
      if (e.valore !== null && Number(e.valore) < 0) return MSG_NUMERO
      // Il campo è Decimal(10,2): oltre due decimali il database arrotonderebbe in silenzio.
      if (e.valore !== null && (e.valore.split('.')[1]?.length ?? 0) > 2) return MSG_DUE_DECIMALI
      // Decimal(10,2): oltre otto cifre intere il database va in overflow.
      if (e.valore !== null && e.valore.replace('-', '').split('.')[0].length > 8) {
        return MSG_CIFRE_INTERE
      }
      return null
    }
    const e = leggiIntero(testo)
    return e.errore ?? (campo === 'durationMonths' && e.valore === 0 ? MSG_NUMERO : null)
  }

  private testiDa(f: CreateContractDto): Record<CampoNumerico, string> {
    return {
      basePrice: formatNumero(f.basePrice == null ? null : String(f.basePrice)),
      durationMonths: f.durationMonths == null ? '' : String(f.durationMonths),
      renewalNoticeDays: f.renewalNoticeDays == null ? '' : String(f.renewalNoticeDays),
    }
  }

  /** Allinea testi ed errori al form appena caricato o azzerato. */
  private riallineaNumeri(): void {
    this.testi = this.testiDa(this.form)
    this.erroriNumeri.set({})
  }

  /** Vero (con avviso) se un campo numerico modificabile ha un errore: non si salva. */
  private numeriErrati(): boolean {
    const errori = this.erroriNumeri()
    // Il preavviso compare solo con il rinnovo automatico: un suo errore rimasto a campo
    // nascosto non deve bloccare il salvataggio.
    const campo = (Object.keys(errori) as CampoNumerico[]).find(
      c => errori[c] && !this.campoBloccato(c) && (c !== 'renewalNoticeDays' || this.form.autoRenew)
    )
    if (!campo) return false
    this.toast.warn(errori[campo] as string)
    return true
  }

  /** In modifica: il campo non è fra quelli che il backend dichiara modificabili. */
  campoBloccato(campo: CampoContratto): boolean {
    return !!this.contratto && !this.contratto.modificabili.includes(campo)
  }

  ciSonoBloccati(): boolean {
    return CAMPI_CONTRATTO.some(c => this.campoBloccato(c))
  }

  ngOnChanges(changes: SimpleChanges): void {
    // L'apertura la decide il padre con `visible`: PrimeNG non emette true. Il form si riallinea
    // solo all'apertura o se, a dialog aperto, arriva un altro contratto: mai mentre si digita.
    if (!this.visible) return
    const contratto = changes['contratto']
    const altroContratto =
      !!contratto &&
      !contratto.firstChange &&
      contratto.previousValue?.id !== contratto.currentValue?.id
    if (changes['visible'] || altroContratto) this.reimposta()
  }

  // ─── Derivazione del registro ─────────────────────────────────────────────

  /** Registro implicato dal tipo di contratto, se univoco. */
  registroImplicito(): RegistroControparte | null {
    return registroDaTipoContratto(this.form.contractType)
  }

  /** Registro effettivamente in uso: quello implicito, o quello scelto a mano. */
  registroEffettivo(): RegistroControparte | null {
    return this.registroImplicito() ?? this.registroScelto()
  }

  etichettaControparte(): string {
    const reg = this.registroEffettivo()
    if (!reg) return 'da definire'
    return reg === 'trasportatori' ? 'Trasportatore' : 'Destinatario'
  }

  /**
   * Cambiando tipo contratto la controparte già scelta viene azzerata: potrebbe
   * appartenere al registro sbagliato, e un id valido nel registro sbagliato è
   * peggio di un campo vuoto.
   */
  onTipoContrattoCambiato(tipo: ContractType): void {
    const registroPrima = this.registroEffettivo()
    this.form.contractType = tipo
    if (registroDaTipoContratto(tipo)) this.registroScelto.set(null)
    if (this.registroEffettivo() !== registroPrima) this.form.counterpartyId = ''
  }

  onRegistroScelto(registro: RegistroControparte): void {
    if (registro === this.registroScelto()) return
    this.registroScelto.set(registro)
    this.form.counterpartyId = ''
  }

  // ─── Anagrafiche inline (Nuovo / Modifica dal form) ──────────────────────

  tipoControparte(registro: RegistroControparte): TipoAnagrafica {
    return registro === 'trasportatori' ? 'trasportatore' : 'destinatario'
  }

  private selettoreDi(tipo: TipoAnagrafica): AnagraficaSelectComponent | undefined {
    return tipo === 'produttore' ? this.selProduttore : this.selControparte
  }

  apriAnagrafica(tipo: TipoAnagrafica, modalita: ModalitaAnagrafica, ev?: unknown): void {
    if (modalita === 'create' && this.campoBloccato(this.campoDi(tipo))) return
    const target = (ev as MouseEvent | undefined)?.currentTarget ?? (ev as Event)?.target
    const el = target instanceof HTMLElement ? target : null
    this.triggerAnagrafica = el?.closest('button') ?? el
    const id = tipo === 'produttore' ? this.form.producerId : this.form.counterpartyId
    this.anagraficaTipo = tipo
    this.anagraficaModalita = modalita
    this.anagraficaEntityData =
      modalita === 'edit' && id ? (this.selettoreDi(tipo)?.trovaEntita(id) ?? null) : null
    this.showAnagraficaDialog = true
  }

  private campoDi(tipo: TipoAnagrafica): CampoContratto {
    return tipo === 'produttore' ? 'producerId' : 'counterpartyId'
  }

  onAnagraficaVisibleChange(v: boolean): void {
    this.showAnagraficaDialog = v
    if (!v) {
      const t = this.triggerAnagrafica
      this.triggerAnagrafica = null
      // Dopo che PrimeNG ha rimosso il sub-dialog dal DOM.
      setTimeout(() => t?.isConnected && t.focus())
    }
  }

  /** Ricarica il registro interessato e, in creazione, seleziona il record appena salvato. */
  onAnagraficaSaved(event: AnagraficaSavedEvent): void {
    const { tipo, entity } = event
    const campo = this.campoDi(tipo)
    // Campo bloccato: si aggiorna l'elenco ma la selezione del contratto non cambia.
    const seleziona = !this.campoBloccato(campo)
    if (seleziona) {
      if (tipo === 'produttore') this.form.producerId = entity.id
      else this.form.counterpartyId = entity.id
    }
    const idCampo = tipo === 'produttore' ? this.form.producerId : this.form.counterpartyId
    this.selettoreDi(tipo)?.ricarica(seleziona ? entity.id : idCampo || undefined)
  }

  // ─── Apertura / chiusura ──────────────────────────────────────────────────

  onVisibleChange(v: boolean): void {
    // Esc nel sub-dialog anagrafica fa chiudere anche questo (PrimeNG chiude ogni dialog
    // aperto con closeOnEscape): si ignora, o si perde il form compilato.
    if (!v && this.showAnagraficaDialog) return
    this.visible = v
    this.visibleChange.emit(v)
    if (v) this.reimposta()
  }

  chiudi(): void {
    this.onVisibleChange(false)
  }

  private reimposta(): void {
    this.registroScelto.set(null)

    if (this.contratto) {
      this.precompila(this.contratto)
      this.riallineaNumeri()
      return
    }

    this.form = this.emptyForm()
    this.riallineaNumeri()
    this.startDate = null
    this.endDate = null

    // Numero proposto dal backend: se non arriva, il campo resta libero — è un
    // suggerimento, non un requisito per poter creare.
    this.contractsService.nextNumber().subscribe({
      next: ({ contractNumber }) => (this.form.contractNumber = contractNumber),
      error: () => {
        /* campo lasciato vuoto */
      },
    })
  }

  /** Riempie il form dal contratto; il registro della controparte si deduce dal suo tipo. */
  private precompila(c: Contract): void {
    this.form = {
      contractNumber: c.contractNumber,
      producerId: c.producerId,
      counterpartyId: c.counterpartyId,
      counterpartyType: c.counterpartyType,
      contractType: c.contractType,
      description: c.description ?? '',
      cerCodes: [...c.cerCodes],
      pricingModel: c.pricingModel,
      basePrice:
        c.basePrice === null || c.basePrice === undefined ? undefined : Number(c.basePrice),
      unitOfMeasure: c.unitOfMeasure,
      startDate: '',
      endDate: undefined,
      durationMonths: c.durationMonths ?? undefined,
      autoRenew: c.autoRenew,
      renewalNoticeDays: c.renewalNoticeDays,
      paymentTerms: c.paymentTerms,
      billingFrequency: c.billingFrequency,
    }
    this.startDate = this.daIso(c.startDate)
    this.endDate = c.endDate ? this.daIso(c.endDate) : null
    if (!registroDaTipoContratto(c.contractType)) {
      this.registroScelto.set(
        c.counterpartyType === 'TRANSPORTER'
          ? 'trasportatori'
          : c.counterpartyType === 'DISPOSER'
            ? 'destinatari'
            : null
      )
    }
  }

  /** Il giorno (AAAA-MM-GG) di una data ISO, come `Date` locale a mezzanotte. */
  private daIso(iso: string): Date {
    const [a, m, g] = iso.slice(0, 10).split('-').map(Number)
    return new Date(a, m - 1, g)
  }

  // ─── Salvataggio ──────────────────────────────────────────────────────────

  salva(): void {
    if (this.contratto) this.modifica()
    else this.crea()
  }

  crea(): void {
    if (this.numeriErrati()) return
    const registro = this.registroEffettivo()
    if (!this.validate(registro)) {
      this.toast.warn('Compila tutti i campi obbligatori')
      return
    }

    const dto: CreateContractDto = {
      ...this.form,
      counterpartyType: tipoControparteDaRegistro(registro as RegistroControparte),
      startDate: this.toIsoDate(this.startDate as Date),
      endDate: this.endDate ? this.toIsoDate(this.endDate) : undefined,
    }

    this.saving.set(true)
    this.contractsService.create(dto).subscribe({
      next: () => {
        this.saving.set(false)
        this.toast.success('Contratto creato')
        this.creato.emit()
        this.chiudi()
      },
      error: (err: unknown) => {
        this.saving.set(false)
        this.toast.error(messaggioDaErrore(err, 'Errore nella creazione del contratto'))
      },
    })
  }

  modifica(): void {
    const originale = this.contratto
    if (!originale) return
    if (this.numeriErrati()) return
    const registro = this.registroEffettivo()
    if (!this.validate(registro)) {
      this.toast.warn('Compila tutti i campi obbligatori')
      return
    }

    const cambi = this.campiCambiati(originale, registro)
    if (Object.keys(cambi).length === 0) {
      this.toast.info('Nessuna modifica da salvare')
      this.chiudi()
      return
    }

    const dto: ModificaContrattoDto = { ...cambi, versione: originale.versione }
    this.saving.set(true)
    this.contractsService.update(originale.id, dto).subscribe({
      next: () => {
        this.saving.set(false)
        this.toast.success('Contratto aggiornato')
        this.modificato.emit()
        this.chiudi()
      },
      error: (err: unknown) => {
        this.saving.set(false)
        this.toast.error(messaggioDaErrore(err, 'Errore nel salvataggio del contratto'))
        // I dati mostrati sono vecchi (modificato nel frattempo, stato che non consente la
        // modifica, contratto sparito): la lista si ricarica e il dialog si chiude. Numero
        // duplicato, campi non ammessi e 400 lasciano il dialog aperto per correggere.
        if (this.datiVecchi(err)) {
          this.modificato.emit()
          this.chiudi()
        }
      },
    })
  }

  /**
   * Solo i campi diversi dal contratto ricevuto (date per giorno, CER come insieme, stringhe
   * con trim). È un risparmio di corpo, non una regola: il backend decide cosa è ammesso.
   */
  private campiCambiati(
    o: Contract,
    registro: RegistroControparte | null
  ): Omit<ModificaContrattoDto, 'versione'> {
    const f = this.form
    const cambi: Record<string, unknown> = {}
    // I campi bloccati non vanno mai nel corpo (anche se il form li avesse alterati).
    const se = (campo: CampoContratto, nuovo: unknown, vecchio: unknown) => {
      if (this.campoBloccato(campo)) return
      if (nuovo !== vecchio) cambi[campo] = nuovo
    }
    const testoOpz = (v: string | null | undefined) => (v?.trim() ? v.trim() : null)
    const numOpz = (v: number | string | null | undefined) =>
      v === null || v === undefined || v === '' ? null : Number(v)

    se('contractNumber', f.contractNumber.trim(), o.contractNumber.trim())
    se('producerId', f.producerId, o.producerId)
    se('counterpartyId', f.counterpartyId, o.counterpartyId)
    if (registro) se('counterpartyType', tipoControparteDaRegistro(registro), o.counterpartyType)
    se('contractType', f.contractType, o.contractType)
    se('description', testoOpz(f.description), testoOpz(o.description))
    const nuoviCer = [...new Set(f.cerCodes)].sort()
    const vecchiCer = [...new Set(o.cerCodes)].sort()
    if (!this.campoBloccato('cerCodes') && nuoviCer.join('|') !== vecchiCer.join('|'))
      cambi['cerCodes'] = nuoviCer
    se('pricingModel', f.pricingModel, o.pricingModel)
    se('basePrice', numOpz(f.basePrice), numOpz(o.basePrice))
    se('unitOfMeasure', (f.unitOfMeasure ?? '').trim(), o.unitOfMeasure.trim())
    if (this.startDate) se('startDate', this.toIsoDate(this.startDate), o.startDate.slice(0, 10))
    se(
      'endDate',
      this.endDate ? this.toIsoDate(this.endDate) : null,
      o.endDate ? o.endDate.slice(0, 10) : null
    )
    se('durationMonths', numOpz(f.durationMonths), numOpz(o.durationMonths))
    se('autoRenew', !!f.autoRenew, o.autoRenew)
    se('renewalNoticeDays', f.renewalNoticeDays ?? o.renewalNoticeDays, o.renewalNoticeDays)
    se('paymentTerms', f.paymentTerms, o.paymentTerms)
    se('billingFrequency', f.billingFrequency, o.billingFrequency)
    return cambi as Omit<ModificaContrattoDto, 'versione'>
  }

  /**
   * Dati mostrati ormai vecchi, decisi dal solo codice del backend: modificato nel frattempo,
   * stato che non consente la modifica (`CONTRATTO_NON_MODIFICABILE`) o contratto sparito (404).
   * `CONTRATTO_CAMPI_NON_AMMESSI` e `CONTRATTO_NUMERO_DUPLICATO` non lo sono: il dialog resta aperto.
   */
  private datiVecchi(err: unknown): boolean {
    if (!(err instanceof HttpErrorResponse)) return false
    if (err.status === 404) return true
    if (err.status !== 409) return false
    const codice = err.error?.error
    return (
      codice === 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' || codice === 'CONTRATTO_NON_MODIFICABILE'
    )
  }

  /** Obbligatori compilati; in modifica i campi bloccati non si controllano (dati storici). */
  private validate(registro: RegistroControparte | null): boolean {
    const ok = (campo: CampoContratto, valido: unknown) => this.campoBloccato(campo) || !!valido
    const f = this.form
    return (
      ok('contractNumber', f.contractNumber?.trim()) &&
      ok('contractType', f.contractType) &&
      (registro !== null ||
        (this.campoBloccato('counterpartyType') && this.campoBloccato('counterpartyId'))) &&
      ok('producerId', f.producerId?.trim()) &&
      ok('counterpartyId', f.counterpartyId?.trim()) &&
      ok('pricingModel', f.pricingModel) &&
      ok('cerCodes', f.cerCodes?.length) &&
      // Preavviso svuotato con il rinnovo automatico attivo: errore, non un 0 spedito in silenzio.
      (!f.autoRenew ||
        this.campoBloccato('renewalNoticeDays') ||
        (f.renewalNoticeDays !== null && f.renewalNoticeDays !== undefined)) &&
      ok('startDate', this.startDate)
    )
  }

  private toIsoDate(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  private emptyForm(): CreateContractDto {
    return {
      contractNumber: '',
      producerId: '',
      counterpartyId: '',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      description: '',
      cerCodes: [],
      pricingModel: 'FLAT_RATE',
      basePrice: undefined,
      unitOfMeasure: 'kg',
      startDate: '',
      endDate: undefined,
      durationMonths: undefined,
      autoRenew: false,
      renewalNoticeDays: 60,
      paymentTerms: 'net_30',
      billingFrequency: 'monthly',
    }
  }
}
