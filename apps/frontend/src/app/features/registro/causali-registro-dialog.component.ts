/**
 * Gestione delle causali del registro (F2-5, solo ADMIN effettivo).
 *
 * Il pulsante lo offre il registro a chi ha `puoImpostare`; il backend resta l'arbitro e un
 * 403 si mostra così com'è. Le causali di sistema si disattivano per l'azienda; quelle proprie
 * hanno versioni con data di inizio e di fine. Le date sono stringhe 'AAAA-MM-GG' e non passano
 * mai da `Date` (nessuno spostamento di fuso). Il PATCH invia solo i campi cambiati.
 */

import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { Observable, Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { InputNumberModule } from 'primeng/inputnumber'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'
import { TableModule } from 'primeng/table'
import { ToastService } from '../../core/services/toast.service'
import {
  CausaleAziendaleGestione,
  CausaleSistemaGestione,
  CausaliRegistroService,
  GestioneCausali,
  RuoloMudCausale,
  VersoCausaleApi,
} from './causali-registro.service'
import {
  differenzeModifica,
  etichettaCodiceRentri,
  etichettaOperazione,
  etichettaRuoloMud,
  chiusuraProposta,
  idUltimeVersioni,
  inizioProposto,
  leggiErroreCausali,
  operazioneAmmessa,
  opzioniCodiceRentri,
  opzioniOperazione,
  opzioniRuoloMud,
} from './causali-gestione'
import { dataItaliana, oggiItaliano } from './giacenze-iniziali-dialog.component'

export type ModoFormCausale = 'nuova' | 'modifica' | 'versione' | 'chiusura'

/** Codice di errore 409 che il server dà quando la versione è già usata da dei movimenti. */
export const CAUSALE_USATA_NUOVA_VERSIONE = 'CAUSALE_USATA_NUOVA_VERSIONE'

const PATTERN_CODICE = /^AZ_[A-Z0-9_]{2,40}$/

@Component({
  selector: 'app-causali-registro-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    InputNumberModule,
    NumeroItalianoDirective,
    TableModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      header="Causali del registro"
      [modal]="true"
      [closable]="true"
      [style]="{ width: '980px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra delle causali"
    >
      <p class="cg-nota">
        Le causali di sistema si possono disattivare per l'azienda. Le causali proprie hanno un
        codice che inizia con AZ_ e si cambiano per versioni: una versione già usata da dei
        movimenti non si modifica nel ruolo MUD o nel codice RENTRI, se ne crea una nuova.
      </p>

      <p *ngIf="caricamento()" class="cg-nota" role="status">Caricamento…</p>
      <p
        *ngIf="erroreCaricamento() as e"
        class="field-error"
        role="alert"
        data-testid="cg-errore-caricamento"
      >
        {{ e }}
      </p>

      <div *ngIf="erroreAzione() as e" class="cg-errore" role="alert" data-testid="cg-errore">
        <span data-testid="cg-errore-testo">{{ e.messaggio }}</span>
        <p-button
          *ngIf="e.codice === codiceUsata && bersaglio()"
          label="Crea una nuova versione"
          icon="pi pi-copy"
          size="small"
          [outlined]="true"
          (onClick)="passaANuovaVersione()"
          data-testid="cg-proponi-versione"
          ariaLabel="Crea una nuova versione della causale"
        ></p-button>
      </div>

      <ng-container *ngIf="gestione() as g">
        <h3 class="cg-titolo">Causali di sistema</h3>
        <p-table [value]="g.sistema" styleClass="p-datatable-sm" data-testid="cg-tabella-sistema">
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Codice</th>
              <th scope="col">Descrizione</th>
              <th scope="col">Ruolo nel MUD</th>
              <th scope="col">Codice RENTRI</th>
              <th scope="col">Stato</th>
              <th scope="col" style="width: 140px">Azioni</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-s>
            <tr [attr.data-testid]="'cg-sistema-' + s.verso + '-' + s.codice">
              <td>{{ etichettaVerso(s.verso) }}</td>
              <td>
                <code>{{ s.codice }}</code>
              </td>
              <td>{{ s.descrizione }}</td>
              <td>{{ etichettaRuoloMud(s.ruoloMud) }}</td>
              <td>{{ etichettaCodiceRentri(s.codiceRentri) }}</td>
              <td>
                {{
                  s.disattivataPerAzienda ? 'Disattivata' : s.attiva ? 'Attiva' : 'Non disponibile'
                }}
              </td>
              <td>
                <p-button
                  *ngIf="s.attiva && !s.disattivataPerAzienda"
                  label="Disattiva"
                  icon="pi pi-ban"
                  [text]="true"
                  size="small"
                  severity="danger"
                  [disabled]="salvataggio()"
                  (onClick)="disattiva(s)"
                  [attr.data-testid]="'cg-disattiva-' + s.verso + '-' + s.codice"
                  [ariaLabel]="'Disattiva la causale ' + s.codice"
                ></p-button>
                <p-button
                  *ngIf="s.disattivataPerAzienda"
                  label="Riattiva"
                  icon="pi pi-undo"
                  [text]="true"
                  size="small"
                  [disabled]="salvataggio()"
                  (onClick)="riattiva(s)"
                  [attr.data-testid]="'cg-riattiva-' + s.verso + '-' + s.codice"
                  [ariaLabel]="'Riattiva la causale ' + s.codice"
                ></p-button>
              </td>
            </tr>
          </ng-template>
        </p-table>

        <h3 class="cg-titolo">Causali dell'azienda</h3>
        <p-table
          [value]="g.aziendali"
          styleClass="p-datatable-sm"
          data-testid="cg-tabella-aziendali"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Tipo</th>
              <th scope="col">Codice</th>
              <th scope="col">Descrizione</th>
              <th scope="col">Ruolo nel MUD</th>
              <th scope="col">Codice RENTRI</th>
              <th scope="col">Valida</th>
              <th scope="col">Uso</th>
              <th scope="col" style="width: 330px">Azioni</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-a>
            <tr [attr.data-testid]="'cg-az-' + a.id">
              <td>{{ etichettaVerso(a.verso) }}</td>
              <td>
                <code>{{ a.codice }}</code>
              </td>
              <td>{{ a.descrizione }}</td>
              <td>{{ etichettaRuoloMud(a.ruoloMud) }}</td>
              <td>
                {{ etichettaCodiceRentri(a.codiceRentri) }}
                <span *ngIf="a.operazione"> · {{ etichettaOperazione(a.operazione) }}</span>
              </td>
              <td>
                dal {{ dataItaliana(a.validaDal) }}
                <span *ngIf="a.validaAl">al {{ dataItaliana(a.validaAl) }}</span>
              </td>
              <td>
                <ng-container *ngIf="a.usata; else mai"
                  >Usata<span *ngIf="a.ultimoGiornoUso">
                    fino al {{ dataItaliana(a.ultimoGiornoUso) }}</span
                  ></ng-container
                >
                <ng-template #mai>Mai usata</ng-template>
              </td>
              <td>
                <ng-container *ngIf="daEliminare() !== a.id; else conferma">
                  <p-button
                    label="Modifica"
                    icon="pi pi-pencil"
                    [text]="true"
                    size="small"
                    [disabled]="salvataggio()"
                    (onClick)="apriModifica(a)"
                    [attr.data-testid]="'cg-modifica-' + a.id"
                    [ariaLabel]="'Modifica la causale ' + a.codice"
                  ></p-button>
                  <p-button
                    *ngIf="ultime().has(a.id)"
                    label="Nuova versione"
                    icon="pi pi-copy"
                    [text]="true"
                    size="small"
                    [disabled]="salvataggio()"
                    (onClick)="apriVersione(a)"
                    [attr.data-testid]="'cg-versione-' + a.id"
                    [ariaLabel]="'Crea una nuova versione della causale ' + a.codice"
                  ></p-button>
                  <p-button
                    *ngIf="ultime().has(a.id) && !a.validaAl"
                    label="Chiudi"
                    icon="pi pi-calendar-times"
                    [text]="true"
                    size="small"
                    [disabled]="salvataggio()"
                    (onClick)="apriChiusura(a)"
                    [attr.data-testid]="'cg-chiudi-' + a.id"
                    [ariaLabel]="'Imposta l\\'ultimo giorno di validità della causale ' + a.codice"
                  ></p-button>
                  <p-button
                    *ngIf="!a.usata"
                    label="Elimina"
                    icon="pi pi-trash"
                    severity="danger"
                    [text]="true"
                    size="small"
                    [disabled]="salvataggio()"
                    (onClick)="chiediEliminazione(a.id)"
                    [attr.data-testid]="'cg-elimina-' + a.id"
                    [ariaLabel]="'Elimina la causale ' + a.codice"
                  ></p-button>
                </ng-container>
                <ng-template #conferma>
                  <span class="cg-conferma">Eliminare?</span>
                  <p-button
                    label="Sì"
                    severity="danger"
                    size="small"
                    [loading]="salvataggio()"
                    (onClick)="elimina(a)"
                    [attr.data-testid]="'cg-elimina-conferma-' + a.id"
                    ariaLabel="Conferma l'eliminazione della causale"
                  ></p-button>
                  <p-button
                    label="No"
                    [text]="true"
                    size="small"
                    [disabled]="salvataggio()"
                    (onClick)="daEliminare.set(null)"
                    ariaLabel="Annulla l'eliminazione"
                  ></p-button>
                </ng-template>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8">
                <span data-testid="cg-vuota">Nessuna causale propria.</span>
              </td>
            </tr>
          </ng-template>
        </p-table>

        <p-button
          *ngIf="!modo()"
          label="Nuova causale"
          icon="pi pi-plus"
          [outlined]="true"
          styleClass="cg-aggiungi"
          (onClick)="apriNuova()"
          data-testid="cg-nuova"
          ariaLabel="Crea una nuova causale dell'azienda"
        ></p-button>
      </ng-container>

      <form
        *ngIf="modo() as m"
        [formGroup]="form"
        class="mov-form cg-form"
        data-testid="cg-form"
        (ngSubmit)="salva()"
      >
        <h3 class="cg-titolo">{{ titoloForm() }}</h3>
        <div class="grid">
          <ng-container *ngIf="m === 'nuova'">
            <div class="col-12 sm:col-6">
              <div class="field">
                <label for="cg-codice">Codice <span class="req" aria-hidden="true">*</span></label>
                <input
                  id="cg-codice"
                  type="text"
                  pInputText
                  formControlName="codice"
                  class="w-full"
                  placeholder="AZ_RESO_CLIENTE"
                  aria-required="true"
                  [attr.aria-invalid]="errore('codice') ? true : null"
                  [attr.aria-describedby]="errore('codice') ? 'cg-codice-err' : 'cg-codice-hint'"
                />
                <small id="cg-codice-hint" class="field-hint"
                  >Inizia con AZ_; solo lettere maiuscole, cifre e underscore.</small
                >
                <small *ngIf="errore('codice')" id="cg-codice-err" class="field-error" role="alert"
                  >Il codice deve iniziare con AZ_ e avere da 2 a 40 caratteri tra lettere
                  maiuscole, cifre e underscore.</small
                >
              </div>
            </div>
            <div class="col-12 sm:col-6">
              <div class="field">
                <label for="cg-verso">Tipo di movimento</label>
                <p-dropdown
                  formControlName="verso"
                  inputId="cg-verso"
                  [options]="opzioniVerso"
                  styleClass="w-full"
                  data-testid="cg-verso"
                ></p-dropdown>
              </div>
            </div>
          </ng-container>

          <div *ngIf="m === 'chiusura'" class="col-12 sm:col-6">
            <div class="field">
              <label for="cg-al"
                >Ultimo giorno di validità <span class="req" aria-hidden="true">*</span></label
              >
              <input
                id="cg-al"
                type="date"
                formControlName="validaAl"
                class="p-inputtext w-full"
                aria-required="true"
                [attr.aria-invalid]="errore('validaAl') ? true : null"
                [attr.aria-describedby]="errore('validaAl') ? 'cg-al-err' : null"
              />
              <small *ngIf="errore('validaAl')" id="cg-al-err" class="field-error" role="alert"
                >Indica una data.</small
              >
            </div>
          </div>

          <ng-container *ngIf="m !== 'chiusura'">
            <div class="col-12">
              <div class="field">
                <label for="cg-descrizione"
                  >Descrizione <span class="req" aria-hidden="true">*</span></label
                >
                <input
                  id="cg-descrizione"
                  type="text"
                  pInputText
                  formControlName="descrizione"
                  class="w-full"
                  maxlength="200"
                  aria-required="true"
                  [attr.aria-invalid]="errore('descrizione') ? true : null"
                  [attr.aria-describedby]="errore('descrizione') ? 'cg-descrizione-err' : null"
                />
                <small
                  *ngIf="errore('descrizione')"
                  id="cg-descrizione-err"
                  class="field-error"
                  role="alert"
                  >La descrizione è obbligatoria (al più 200 caratteri).</small
                >
              </div>
            </div>
            <div class="col-12 sm:col-6">
              <div class="field">
                <label for="cg-ruolo"
                  >Ruolo nel MUD <span class="req" aria-hidden="true">*</span></label
                >
                <p-dropdown
                  formControlName="ruoloMud"
                  inputId="cg-ruolo"
                  ariaRequired="true"
                  [options]="opzioniRuolo()"
                  styleClass="w-full"
                  data-testid="cg-ruolo"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-12 sm:col-6">
              <div class="field">
                <label for="cg-rentri">Codice RENTRI</label>
                <p-dropdown
                  formControlName="codiceRentri"
                  inputId="cg-rentri"
                  [options]="opzioniRentri()"
                  placeholder="Nessun codice RENTRI"
                  [showClear]="true"
                  styleClass="w-full"
                  data-testid="cg-rentri"
                ></p-dropdown>
                <small class="field-hint"
                  >Facoltativo: vuoto significa nessun codice (la registrazione non verrà trasmessa
                  a RENTRI con questa causale).</small
                >
              </div>
            </div>
            <div class="col-12 sm:col-6" *ngIf="operazioneVisibile()">
              <div class="field">
                <label for="cg-operazione">Operazione</label>
                <p-dropdown
                  formControlName="operazione"
                  inputId="cg-operazione"
                  [options]="opzioniOp"
                  placeholder="Nessuna operazione"
                  [showClear]="true"
                  styleClass="w-full"
                  data-testid="cg-operazione"
                ></p-dropdown>
              </div>
            </div>
            <div class="col-12 sm:col-3">
              <div class="field">
                <label for="cg-ordine">Ordine</label>
                <p-inputNumber
                  appNumeroIt
                  soloIntero
                  locale="it-IT"
                  [useGrouping]="false"
                  [maxFractionDigits]="0"
                  inputId="cg-ordine"
                  formControlName="ordine"
                  styleClass="w-full"
                  inputStyleClass="w-full"
                  [min]="0"
                  [max]="9999"
                  [numeroErroreId]="errore('ordine') ? 'cg-ordine-err' : null"
                ></p-inputNumber>
                <small *ngIf="errore('ordine')" id="cg-ordine-err" class="field-error" role="alert"
                  >Un numero intero da 0 a 9999.</small
                >
              </div>
            </div>
            <div class="col-12 sm:col-3">
              <div class="field">
                <label for="cg-dal"
                  >Valida dal
                  <span *ngIf="m !== 'nuova'" class="req" aria-hidden="true">*</span></label
                >
                <input
                  id="cg-dal"
                  type="date"
                  formControlName="validaDal"
                  class="p-inputtext w-full"
                  [attr.aria-required]="m !== 'nuova' ? 'true' : null"
                  [attr.aria-invalid]="errore('validaDal') ? true : null"
                  [attr.aria-describedby]="errore('validaDal') ? 'cg-dal-err' : null"
                />
                <small *ngIf="errore('validaDal')" id="cg-dal-err" class="field-error" role="alert"
                  >Indica una data.</small
                >
              </div>
            </div>
          </ng-container>
        </div>
        <p
          *ngIf="erroreAzione() as e"
          class="field-error"
          id="cg-form-err"
          data-testid="cg-errore-form"
        >
          {{ e.messaggio }}
        </p>
        <div class="cg-azioni">
          <p-button
            label="Annulla"
            [text]="true"
            type="button"
            (onClick)="chiudiForm()"
            data-testid="cg-annulla"
            ariaLabel="Annulla"
          ></p-button>
          <p-button
            [label]="etichettaInvio()"
            type="submit"
            [loading]="salvataggio()"
            data-testid="cg-invia"
            [ariaLabel]="etichettaInvio()"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
  styles: [
    `
      .cg-nota {
        margin: 0 0 var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: 1.5;
      }
      .cg-titolo {
        margin: var(--spacing-base) 0 var(--spacing-sm);
        font-family: var(--font-display);
        font-size: var(--font-size-base);
      }
      .cg-conferma {
        font-size: var(--font-size-sm);
        margin-right: var(--spacing-sm);
      }
      .cg-errore {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
        padding: var(--spacing-md) var(--spacing-base);
        border: 1px solid var(--color-danger);
        border-radius: var(--radius-md);
        font-size: var(--font-size-sm);
        color: var(--color-danger);
      }
      .cg-form {
        margin-top: var(--spacing-base);
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }
      .cg-azioni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
        margin-top: var(--spacing-base);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .field > label {
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
    `,
  ],
})
export class CausaliRegistroDialogComponent implements OnChanges, OnDestroy {
  private readonly fb = inject(FormBuilder)
  private readonly causali = inject(CausaliRegistroService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly gestione = signal<GestioneCausali | null>(null)
  readonly ultime = signal<Set<string>>(new Set())
  readonly caricamento = signal(false)
  readonly erroreCaricamento = signal<string | null>(null)
  readonly erroreAzione = signal<{ messaggio: string; codice: string | null } | null>(null)
  readonly salvataggio = signal(false)
  readonly modo = signal<ModoFormCausale | null>(null)
  /** Versione su cui agisce il form (modifica, nuova versione, chiusura). */
  readonly bersaglio = signal<CausaleAziendaleGestione | null>(null)
  readonly daEliminare = signal<string | null>(null)

  readonly codiceUsata = CAUSALE_USATA_NUOVA_VERSIONE
  readonly etichettaRuoloMud = etichettaRuoloMud
  readonly etichettaCodiceRentri = etichettaCodiceRentri
  readonly etichettaOperazione = etichettaOperazione
  readonly dataItaliana = dataItaliana
  readonly opzioniOp = opzioniOperazione()
  readonly opzioniVerso = [
    { label: 'Carico', value: 'CARICO' },
    { label: 'Scarico', value: 'SCARICO' },
  ]

  readonly form: FormGroup = this.fb.group({
    codice: [''],
    verso: ['CARICO' as VersoCausaleApi],
    descrizione: [''],
    ruoloMud: ['PRODOTTO' as RuoloMudCausale],
    codiceRentri: [null as string | null],
    operazione: [null as string | null],
    ordine: [null as number | null],
    validaDal: [''],
    validaAl: [''],
  })

  private lettura?: Subscription
  private scrittura?: Subscription

  constructor() {
    this.form.get('verso')!.valueChanges.subscribe(() => this.riallineaSceltePerVerso())
    this.form.get('ruoloMud')!.valueChanges.subscribe(() => this.riallineaOperazione())
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.chiudiForm()
      this.erroreAzione.set(null)
      this.daEliminare.set(null)
      this.carica()
    }
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
    this.scrittura?.unsubscribe()
  }

  etichettaVerso(verso: string): string {
    return verso === 'CARICO' ? 'Carico' : 'Scarico'
  }

  private versoForm(): VersoCausaleApi {
    return (this.bersaglio()?.verso ?? this.form.get('verso')!.value) as VersoCausaleApi
  }

  opzioniRuolo() {
    return opzioniRuoloMud(this.versoForm())
  }

  opzioniRentri() {
    return opzioniCodiceRentri(this.versoForm())
  }

  operazioneVisibile(): boolean {
    return operazioneAmmessa(this.versoForm(), this.form.get('ruoloMud')!.value)
  }

  titoloForm(): string {
    const b = this.bersaglio()
    switch (this.modo()) {
      case 'nuova':
        return 'Nuova causale'
      case 'modifica':
        return `Modifica ${b?.codice ?? ''}`
      case 'versione':
        return `Nuova versione di ${b?.codice ?? ''}`
      case 'chiusura':
        return `Chiudi ${b?.codice ?? ''}`
      default:
        return ''
    }
  }

  etichettaInvio(): string {
    switch (this.modo()) {
      case 'nuova':
        return 'Crea la causale'
      case 'modifica':
        return 'Salva le modifiche'
      case 'versione':
        return 'Crea la versione'
      default:
        return 'Chiudi la causale'
    }
  }

  errore(nome: string): boolean {
    const c = this.form.get(nome)
    return !!(c && c.invalid && c.touched)
  }

  carica(): void {
    this.lettura?.unsubscribe()
    this.caricamento.set(true)
    this.erroreCaricamento.set(null)
    this.lettura = this.causali.gestione().subscribe({
      next: g => {
        this.gestione.set(g)
        this.ultime.set(idUltimeVersioni(g.aziendali))
        this.caricamento.set(false)
      },
      error: err => {
        this.gestione.set(null)
        this.caricamento.set(false)
        this.erroreCaricamento.set(leggiErroreCausali(err).messaggio)
      },
    })
  }

  // --- Causali di sistema -----------------------------------------------------------------

  disattiva(s: CausaleSistemaGestione): void {
    this.esegui(
      this.causali.disattivaSistema(s.verso, s.codice),
      `Causale ${s.codice} disattivata per l'azienda`
    )
  }

  riattiva(s: CausaleSistemaGestione): void {
    this.esegui(
      this.causali.riattivaSistema(s.verso, s.codice),
      `Causale ${s.codice} riattivata per l'azienda`
    )
  }

  // --- Form -----------------------------------------------------------------------------

  apriNuova(): void {
    this.preparaForm('nuova', null)
    this.form.reset({
      codice: '',
      verso: 'CARICO',
      descrizione: '',
      ruoloMud: 'PRODOTTO',
      codiceRentri: null,
      operazione: null,
      ordine: null,
      validaDal: '',
      validaAl: '',
    })
    this.impostaValidatori('nuova')
    this.focus('cg-codice')
  }

  apriModifica(a: CausaleAziendaleGestione): void {
    this.preparaForm('modifica', a)
    this.form.reset({
      codice: a.codice,
      verso: a.verso,
      descrizione: a.descrizione,
      ruoloMud: a.ruoloMud,
      codiceRentri: a.codiceRentri,
      operazione: a.operazione,
      ordine: a.ordine,
      validaDal: a.validaDal,
      validaAl: '',
    })
    this.impostaValidatori('modifica')
    this.focus('cg-descrizione')
  }

  apriVersione(a: CausaleAziendaleGestione, preimpostati?: Record<string, unknown>): void {
    this.preparaForm('versione', a)
    this.form.reset({
      codice: a.codice,
      verso: a.verso,
      descrizione: a.descrizione,
      ruoloMud: a.ruoloMud,
      codiceRentri: a.codiceRentri,
      operazione: a.operazione,
      ordine: a.ordine,
      validaDal: inizioProposto(oggiItaliano(), a.ultimoGiornoUso, a.validaDal),
      validaAl: '',
      ...preimpostati,
    })
    this.impostaValidatori('versione')
    this.focus('cg-ruolo')
  }

  apriChiusura(a: CausaleAziendaleGestione): void {
    this.preparaForm('chiusura', a)
    this.form.reset({
      codice: a.codice,
      verso: a.verso,
      descrizione: a.descrizione,
      ruoloMud: a.ruoloMud,
      codiceRentri: a.codiceRentri,
      operazione: a.operazione,
      ordine: a.ordine,
      validaDal: a.validaDal,
      validaAl: chiusuraProposta(oggiItaliano(), a.validaDal, a.ultimoGiornoUso),
    })
    this.impostaValidatori('chiusura')
    this.focus('cg-al')
  }

  /** Dopo un 409 "versione già usata": riapre il form come nuova versione con i valori scritti. */
  passaANuovaVersione(): void {
    const corrente = this.bersaglio()
    if (!corrente) return
    // la nuova versione parte sempre dall'ultima della causale (il backend rifiuta le altre)
    const ultima =
      (this.gestione()?.aziendali ?? [])
        .filter(r => r.verso === corrente.verso && r.codice === corrente.codice)
        .sort((x, y) => (x.validaDal < y.validaDal ? 1 : -1))[0] ?? corrente
    const v = this.form.getRawValue()
    this.apriVersione(ultima, {
      descrizione: v.descrizione,
      ruoloMud: v.ruoloMud,
      codiceRentri: v.codiceRentri,
      operazione: v.operazione,
      ordine: v.ordine,
    })
  }

  chiudiForm(): void {
    this.modo.set(null)
    this.bersaglio.set(null)
    this.erroreAzione.set(null)
  }

  private preparaForm(modo: ModoFormCausale, bersaglio: CausaleAziendaleGestione | null): void {
    this.erroreAzione.set(null)
    this.daEliminare.set(null)
    this.bersaglio.set(bersaglio)
    this.modo.set(modo)
  }

  private impostaValidatori(modo: ModoFormCausale): void {
    const f = this.form
    const imposta = (nome: string, v: any[]) => {
      f.get(nome)!.setValidators(v)
      f.get(nome)!.updateValueAndValidity({ emitEvent: false })
    }
    imposta(
      'codice',
      modo === 'nuova' ? [Validators.required, Validators.pattern(PATTERN_CODICE)] : []
    )
    imposta(
      'descrizione',
      modo === 'chiusura' ? [] : [Validators.required, Validators.maxLength(200)]
    )
    imposta('ordine', [Validators.min(0), Validators.max(9999), integro])
    imposta('validaDal', modo === 'modifica' || modo === 'versione' ? [Validators.required] : [])
    imposta('validaAl', modo === 'chiusura' ? [Validators.required] : [])
    f.markAsUntouched()
  }

  /** Al cambio di verso (solo nuova causale) le scelte non più ammesse tornano al valore sicuro. */
  private riallineaSceltePerVerso(): void {
    const verso = this.form.get('verso')!.value as VersoCausaleApi
    const ruolo = this.form.get('ruoloMud')!.value
    if (!opzioniRuoloMud(verso).some(o => o.value === ruolo)) {
      this.form.get('ruoloMud')!.setValue(opzioniRuoloMud(verso)[0].value)
    }
    const rentri = this.form.get('codiceRentri')!.value
    if (rentri && !opzioniCodiceRentri(verso).some(o => o.value === rentri)) {
      this.form.get('codiceRentri')!.setValue(null)
    }
    this.riallineaOperazione()
  }

  private riallineaOperazione(): void {
    if (!this.operazioneVisibile() && this.form.get('operazione')!.value) {
      this.form.get('operazione')!.setValue(null)
    }
  }

  private focus(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0)
  }

  // --- Invio ----------------------------------------------------------------------------

  salva(): void {
    const modo = this.modo()
    if (!modo) return
    this.form.markAllAsTouched()
    if (this.form.invalid) return
    const v = this.form.getRawValue()
    const b = this.bersaglio()
    const ordine: number | null = v.ordine === null || v.ordine === '' ? null : Number(v.ordine)

    if (modo === 'nuova') {
      this.esegui(
        this.causali.crea({
          codice: String(v.codice).trim(),
          verso: v.verso,
          descrizione: String(v.descrizione).trim(),
          ruoloMud: v.ruoloMud,
          ...(v.codiceRentri ? { codiceRentri: v.codiceRentri } : {}),
          ...(v.operazione && this.operazioneVisibile() ? { operazione: v.operazione } : {}),
          ...(ordine !== null ? { ordine } : {}),
          ...(v.validaDal ? { validaDal: v.validaDal } : {}),
        }),
        'Causale creata',
        true
      )
      return
    }
    if (!b) return
    if (modo === 'modifica') {
      const diff = differenzeModifica(b, {
        descrizione: v.descrizione,
        ordine,
        ruoloMud: v.ruoloMud,
        codiceRentri: v.codiceRentri,
        operazione: this.operazioneVisibile() ? v.operazione : null,
        validaDal: v.validaDal,
      })
      if (Object.keys(diff).length === 0) {
        this.toast.info('Nessuna modifica da salvare')
        return
      }
      this.esegui(this.causali.modifica(b.id, diff), 'Causale modificata', true)
      return
    }
    if (modo === 'versione') {
      this.esegui(
        this.causali.nuovaVersione(b.id, {
          validaDal: v.validaDal,
          ruoloMud: v.ruoloMud,
          ...(v.codiceRentri ? { codiceRentri: v.codiceRentri } : {}),
          ...(v.operazione && this.operazioneVisibile() ? { operazione: v.operazione } : {}),
          descrizione: String(v.descrizione).trim(),
          ...(ordine !== null ? { ordine } : {}),
        }),
        'Nuova versione creata',
        true
      )
      return
    }
    this.esegui(this.causali.chiudi(b.id, v.validaAl), 'Causale chiusa', true)
  }

  chiediEliminazione(id: string): void {
    this.erroreAzione.set(null)
    this.daEliminare.set(id)
    setTimeout(
      () =>
        document
          .querySelector<HTMLElement>(`[data-testid="cg-elimina-conferma-${id}"] button`)
          ?.focus(),
      0
    )
  }

  elimina(a: CausaleAziendaleGestione): void {
    this.esegui(this.causali.elimina(a.id), `Versione di ${a.codice} eliminata`)
  }

  /**
   * Esegue una scrittura: a successo ricarica la vista (la cache delle opzioni la invalida il
   * servizio); a errore mostra il messaggio del backend. Un 409 ricarica comunque la vista,
   * che potrebbe essere cambiata sotto i piedi (altro amministratore, nuovo uso).
   */
  private esegui(op: Observable<unknown>, messaggio: string, chiudiFormAlSuccesso = false): void {
    this.erroreAzione.set(null)
    this.salvataggio.set(true)
    this.scrittura?.unsubscribe()
    this.scrittura = op.subscribe({
      next: () => {
        this.salvataggio.set(false)
        this.daEliminare.set(null)
        if (chiudiFormAlSuccesso) this.chiudiForm()
        this.toast.success(messaggio)
        this.carica()
      },
      error: err => {
        this.salvataggio.set(false)
        this.daEliminare.set(null)
        this.erroreAzione.set(leggiErroreCausali(err))
        if (err?.status === 409) this.carica()
      },
    })
  }
}

/** Numero intero (o vuoto). */
function integro(c: { value: unknown }): { intero: true } | null {
  const v = c.value
  if (v === null || v === '' || v === undefined) return null
  return Number.isInteger(Number(v)) ? null : { intero: true }
}
