/**
 * Dialog delle sedi di una ditta (F2-10): elenco, aggiunta, modifica, disattivazione/riattivazione
 * e scelta della sede principale. Le sedi sono della ditta, condivise da tutti i suoi ruoli.
 *
 * Accessibilita': etichette sui campi, errori collegati con `aria-describedby`, stato dei
 * caricamenti in `role="status"`, focus sul primo campo del modulo quando si apre e di nuovo sul
 * pulsante "Aggiungi sede" quando si chiude; Esc chiude il dialog (comportamento di p-dialog).
 */
import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { MessageService } from 'primeng/api'
import { DialogModule } from 'primeng/dialog'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { RegistryService } from './registry.service'
import { DatiSedeDitta, Ditta, SedeDitta } from '../../shared/models/registry.model'

interface ModuloSede {
  denominazione: string
  via: string
  civico: string
  cap: string
  citta: string
  provincia: string
  referente: string
  email: string
  telefono: string
  pec: string
}

function moduloVuoto(): ModuloSede {
  return {
    denominazione: '',
    via: '',
    civico: '',
    cap: '',
    citta: '',
    provincia: '',
    referente: '',
    email: '',
    telefono: '',
    pec: '',
  }
}

type CampoObbligatorio = 'via' | 'civico' | 'cap' | 'citta' | 'provincia'

const ETICHETTE: Record<CampoObbligatorio, string> = {
  via: 'La via è obbligatoria.',
  civico: 'Il civico è obbligatorio.',
  cap: 'Il CAP è obbligatorio.',
  citta: 'Il comune è obbligatorio.',
  provincia: 'La provincia è obbligatoria.',
}

@Component({
  selector: 'app-sedi-ditta-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      (onHide)="annullaModulo()"
      [modal]="true"
      [draggable]="false"
      [closeOnEscape]="true"
      [style]="{ width: '50rem' }"
      [breakpoints]="{ '768px': '95vw' }"
      [header]="'Sedi di ' + ragioneSociale"
      [dismissableMask]="true"
      appendTo="body"
      data-testid="sedi-ditta-dialog"
    >
      <div *ngIf="visible" class="sedi">
        <p *ngIf="caricamento" role="status" class="sedi__stato">Caricamento delle sedi…</p>
        <p *ngIf="erroreGenerale" role="alert" class="field-error" data-testid="sedi-errore">
          {{ erroreGenerale }}
        </p>

        <ul class="sedi__elenco" *ngIf="ditta" aria-label="Sedi della ditta">
          <li
            *ngFor="let s of ditta.sedi"
            class="sede"
            [class.sede--disattivata]="!s.attiva"
            [attr.data-testid]="'sede-' + s.id"
          >
            <div class="sede__testo">
              <strong>{{ s.denominazione || s.via + ' ' + s.civico }}</strong>
              <span *ngIf="s.principale" class="sede__badge">Principale</span>
              <span *ngIf="!s.attiva" class="sede__badge sede__badge--off">Disattivata</span>
              <br />
              <span>{{ s.via }} {{ s.civico }}, {{ s.cap }} {{ s.citta }} ({{ s.provincia }})</span>
            </div>
            <div class="sede__azioni" *ngIf="puoGestire">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                (onClick)="modifica(s)"
                [ariaLabel]="'Modifica la sede ' + s.via + ' ' + s.civico"
                [attr.data-testid]="'sede-modifica-' + s.id"
              />
              <p-button
                *ngIf="s.attiva && !s.principale"
                label="Rendi principale"
                icon="pi pi-star"
                [text]="true"
                size="small"
                (onClick)="rendiPrincipale(s)"
                [ariaLabel]="'Rendi principale la sede ' + s.via + ' ' + s.civico"
                [attr.data-testid]="'sede-principale-' + s.id"
              />
              <p-button
                *ngIf="!s.principale"
                [label]="s.attiva ? 'Disattiva' : 'Riattiva'"
                [icon]="s.attiva ? 'pi pi-eye-slash' : 'pi pi-eye'"
                [text]="true"
                size="small"
                (onClick)="impostaAttiva(s, !s.attiva)"
                [ariaLabel]="
                  (s.attiva ? 'Disattiva' : 'Riattiva') + ' la sede ' + s.via + ' ' + s.civico
                "
                [attr.data-testid]="'sede-attiva-' + s.id"
              />
            </div>
          </li>
        </ul>

        <div class="sedi__nuova" *ngIf="puoGestire && ditta && !modulo">
          <p-button
            #pulsanteAggiungi
            label="Aggiungi sede"
            icon="pi pi-plus"
            [outlined]="true"
            (onClick)="nuova()"
            data-testid="sede-aggiungi"
          />
        </div>

        <!-- Modulo di aggiunta / modifica -->
        <form
          *ngIf="modulo"
          class="sedi__modulo"
          (ngSubmit)="salva()"
          novalidate
          aria-labelledby="sede-modulo-titolo"
          data-testid="sede-modulo"
        >
          <h3 id="sede-modulo-titolo" class="sedi__titolo">
            {{ inModifica ? 'Modifica sede' : 'Nuova sede' }}
          </h3>
          <div class="campo">
            <label for="sede-denominazione">Denominazione</label>
            <input
              pInputText
              id="sede-denominazione"
              name="denominazione"
              [(ngModel)]="modulo.denominazione"
              placeholder="es. Stabilimento di Latina"
              class="w-full"
            />
          </div>
          <div class="riga">
            <div class="campo campo--largo">
              <label for="sede-via">Via <span class="req" aria-hidden="true">*</span></label>
              <input
                pInputText
                id="sede-via"
                name="via"
                [(ngModel)]="modulo.via"
                (ngModelChange)="pulisci('via')"
                required
                aria-required="true"
                [attr.aria-invalid]="errori.via ? true : null"
                [attr.aria-describedby]="errori.via ? 'sede-via-err' : null"
                class="w-full"
              />
              <small *ngIf="errori.via" id="sede-via-err" class="field-error" role="alert">{{
                errori.via
              }}</small>
            </div>
            <div class="campo">
              <label for="sede-civico">Civico <span class="req" aria-hidden="true">*</span></label>
              <input
                pInputText
                id="sede-civico"
                name="civico"
                [(ngModel)]="modulo.civico"
                (ngModelChange)="pulisci('civico')"
                required
                aria-required="true"
                [attr.aria-invalid]="errori.civico ? true : null"
                [attr.aria-describedby]="errori.civico ? 'sede-civico-err' : null"
                class="w-full"
              />
              <small *ngIf="errori.civico" id="sede-civico-err" class="field-error" role="alert">{{
                errori.civico
              }}</small>
            </div>
          </div>
          <div class="riga">
            <div class="campo">
              <label for="sede-cap">CAP <span class="req" aria-hidden="true">*</span></label>
              <input
                pInputText
                id="sede-cap"
                name="cap"
                [(ngModel)]="modulo.cap"
                (ngModelChange)="pulisci('cap')"
                maxlength="5"
                inputmode="numeric"
                required
                aria-required="true"
                [attr.aria-invalid]="errori.cap ? true : null"
                [attr.aria-describedby]="errori.cap ? 'sede-cap-err' : null"
                class="w-full"
              />
              <small *ngIf="errori.cap" id="sede-cap-err" class="field-error" role="alert">{{
                errori.cap
              }}</small>
            </div>
            <div class="campo">
              <label for="sede-citta">Comune <span class="req" aria-hidden="true">*</span></label>
              <input
                pInputText
                id="sede-citta"
                name="citta"
                [(ngModel)]="modulo.citta"
                (ngModelChange)="pulisci('citta')"
                required
                aria-required="true"
                [attr.aria-invalid]="errori.citta ? true : null"
                [attr.aria-describedby]="errori.citta ? 'sede-citta-err' : null"
                class="w-full"
              />
              <small *ngIf="errori.citta" id="sede-citta-err" class="field-error" role="alert">{{
                errori.citta
              }}</small>
            </div>
            <div class="campo">
              <label for="sede-provincia"
                >Provincia <span class="req" aria-hidden="true">*</span></label
              >
              <input
                pInputText
                id="sede-provincia"
                name="provincia"
                [(ngModel)]="modulo.provincia"
                (ngModelChange)="pulisci('provincia')"
                maxlength="2"
                required
                aria-required="true"
                [attr.aria-invalid]="errori.provincia ? true : null"
                [attr.aria-describedby]="errori.provincia ? 'sede-provincia-err' : null"
                class="w-full prov"
              />
              <small
                *ngIf="errori.provincia"
                id="sede-provincia-err"
                class="field-error"
                role="alert"
                >{{ errori.provincia }}</small
              >
            </div>
          </div>
          <div class="riga">
            <div class="campo">
              <label for="sede-referente">Referente</label>
              <input
                pInputText
                id="sede-referente"
                name="referente"
                [(ngModel)]="modulo.referente"
                class="w-full"
              />
            </div>
            <div class="campo">
              <label for="sede-telefono">Telefono</label>
              <input
                pInputText
                id="sede-telefono"
                name="telefono"
                [(ngModel)]="modulo.telefono"
                class="w-full"
              />
            </div>
          </div>
          <div class="riga">
            <div class="campo">
              <label for="sede-email">E-mail</label>
              <input
                pInputText
                id="sede-email"
                name="email"
                type="email"
                [(ngModel)]="modulo.email"
                class="w-full"
              />
            </div>
            <div class="campo">
              <label for="sede-pec">PEC</label>
              <input pInputText id="sede-pec" name="pec" [(ngModel)]="modulo.pec" class="w-full" />
            </div>
          </div>
          <div class="sedi__bottoni">
            <p-button
              label="Annulla"
              [text]="true"
              icon="pi pi-times"
              (onClick)="annullaModulo()"
              [disabled]="salvataggio"
              data-testid="sede-annulla"
            />
            <p-button
              label="Salva sede"
              icon="pi pi-check"
              (onClick)="salva()"
              [loading]="salvataggio"
              data-testid="sede-salva"
            />
          </div>
        </form>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .sedi {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .sedi__stato {
        margin: 0;
        color: var(--text-tertiary);
      }
      .sedi__elenco {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .sede {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: var(--spacing-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md, 6px);
      }
      .sede--disattivata {
        opacity: 0.75;
      }
      .sede__badge {
        margin-left: var(--spacing-sm);
        padding: 0 var(--spacing-sm);
        border: 1px solid var(--surface-border);
        border-radius: 999px;
        font-size: var(--font-size-xs);
        color: var(--text-primary);
      }
      .sede__azioni {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        align-items: center;
      }
      .sedi__titolo {
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--font-size-base);
      }
      .sedi__modulo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }
      .riga {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
      }
      .campo {
        flex: 1 1 8rem;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .campo--largo {
        flex: 3 1 14rem;
      }
      .campo label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .prov {
        text-transform: uppercase;
      }
      .req {
        color: var(--color-danger);
      }
      .field-error {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--color-danger);
      }
      .sedi__bottoni {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
      }
    `,
  ],
})
export class SediDittaDialogComponent implements OnChanges {
  @Input() visible = false
  @Input() dittaId = ''
  @Input() ragioneSociale = ''
  /** Solo chi puo' gestire le anagrafiche modifica le sedi; gli altri le leggono. */
  @Input() puoGestire = false

  @Output() visibleChange = new EventEmitter<boolean>()
  /** Una sede e' stata aggiunta o cambiata: la lista chiamante deve ricaricarsi. */
  @Output() modificata = new EventEmitter<void>()

  @ViewChild('pulsanteAggiungi', { read: ElementRef }) pulsanteAggiungi?: ElementRef<HTMLElement>

  ditta: Ditta | null = null
  caricamento = false
  salvataggio = false
  erroreGenerale = ''
  modulo: ModuloSede | null = null
  inModifica: SedeDitta | null = null
  errori: Partial<Record<CampoObbligatorio, string>> = {}

  constructor(
    private registry: RegistryService,
    private messageService: MessageService
  ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible && this.dittaId) {
      this.carica()
    }
    if (changes['visible'] && !this.visible) {
      this.annullaModulo()
    }
  }

  private carica(): void {
    this.caricamento = true
    this.erroreGenerale = ''
    this.registry.getDitta(this.dittaId).subscribe({
      next: d => {
        this.ditta = d
        this.caricamento = false
      },
      error: err => {
        this.caricamento = false
        this.erroreGenerale = this.messaggio(err, 'Impossibile caricare le sedi.')
      },
    })
  }

  nuova(): void {
    this.inModifica = null
    this.modulo = moduloVuoto()
    this.errori = {}
    this.erroreGenerale = ''
    this.focusPrimoCampo()
  }

  modifica(s: SedeDitta): void {
    this.inModifica = s
    this.modulo = {
      denominazione: s.denominazione ?? '',
      via: s.via,
      civico: s.civico,
      cap: s.cap,
      citta: s.citta,
      provincia: s.provincia,
      referente: s.referente ?? '',
      email: s.email ?? '',
      telefono: s.telefono ?? '',
      pec: s.pec ?? '',
    }
    this.errori = {}
    this.erroreGenerale = ''
    this.focusPrimoCampo()
  }

  annullaModulo(): void {
    const eraAperto = !!this.modulo
    this.modulo = null
    this.inModifica = null
    this.errori = {}
    if (eraAperto && this.visible) {
      // il modulo sparisce: il focus torna sul pulsante che lo apre
      setTimeout(() => this.pulsanteAggiungi?.nativeElement.querySelector('button')?.focus())
    }
  }

  pulisci(campo: CampoObbligatorio): void {
    delete this.errori[campo]
  }

  private focusPrimoCampo(): void {
    setTimeout(() => document.getElementById('sede-denominazione')?.focus())
  }

  salva(): void {
    if (!this.modulo || !this.ditta) return
    const m = this.modulo
    const errori: Partial<Record<CampoObbligatorio, string>> = {}
    for (const c of Object.keys(ETICHETTE) as CampoObbligatorio[]) {
      if (!m[c].trim()) errori[c] = ETICHETTE[c]
    }
    this.errori = errori
    if (Object.keys(errori).length > 0) {
      setTimeout(() =>
        document.querySelector<HTMLElement>('.sedi__modulo [aria-invalid="true"]')?.focus()
      )
      return
    }

    const dati: DatiSedeDitta = {
      via: m.via.trim(),
      civico: m.civico.trim(),
      cap: m.cap.trim(),
      citta: m.citta.trim(),
      provincia: m.provincia.trim().toUpperCase(),
      ...this.contatti(m),
    }
    this.salvataggio = true
    this.erroreGenerale = ''
    const op$ = this.inModifica
      ? this.registry.aggiornaSede(this.ditta.id, this.inModifica.id, dati)
      : this.registry.creaSede(this.ditta.id, dati)
    op$.subscribe({
      next: () => {
        this.salvataggio = false
        this.messageService.add({
          severity: 'success',
          summary: 'Salvato',
          detail: this.inModifica ? 'Sede aggiornata.' : 'Sede aggiunta.',
        })
        this.annullaModulo()
        this.modificata.emit()
        this.carica()
      },
      error: err => {
        this.salvataggio = false
        this.erroreGenerale = this.messaggio(err, 'Errore durante il salvataggio della sede.')
      },
    })
  }

  /**
   * Contatti facoltativi: in creazione un campo vuoto si omette; in modifica si invia `null`
   * (il backend: undefined = invariato, null = svuota).
   */
  private contatti(m: ModuloSede): Partial<DatiSedeDitta> {
    const out: Record<string, string | null> = {}
    for (const c of ['denominazione', 'referente', 'email', 'telefono', 'pec'] as const) {
      const v = m[c].trim()
      if (v) out[c] = v
      else if (this.inModifica) out[c] = null
    }
    return out
  }

  rendiPrincipale(s: SedeDitta): void {
    if (!this.ditta) return
    this.erroreGenerale = ''
    this.registry.impostaSedePrincipale(this.ditta.id, s.id).subscribe({
      next: d => {
        this.ditta = d
        this.modificata.emit()
      },
      error: err =>
        (this.erroreGenerale = this.messaggio(err, 'Impossibile cambiare la sede principale.')),
    })
  }

  impostaAttiva(s: SedeDitta, attiva: boolean): void {
    if (!this.ditta) return
    this.erroreGenerale = ''
    this.registry.aggiornaSede(this.ditta.id, s.id, { attiva }).subscribe({
      next: () => {
        this.modificata.emit()
        this.carica()
      },
      error: err => (this.erroreGenerale = this.messaggio(err, 'Impossibile modificare la sede.')),
    })
  }

  private messaggio(err: unknown, predefinito: string): string {
    const raw = (err as { error?: { message?: string | string[] } })?.error?.message
    return Array.isArray(raw) ? raw.join(', ') : (raw ?? predefinito)
  }
}
