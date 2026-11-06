import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterModule } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService, SharedModule } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriUnitaLocaleService, RentriUnitaLocale } from './rentri-unita-locale.service'

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN']

/** Stesse regole del DTO backend: CAP vuoto o 5 cifre, provincia vuota o 2 lettere. */
const RE_CAP = /^([0-9]{5})?$/
const RE_PROVINCIA = /^([A-Za-z]{2})?$/

interface FormMud {
  indirizzo: string
  civico: string
  cap: string
  comune: string
  provincia: string
  numeroAddetti: string
}
const FORM_MUD_VUOTO = (): FormMud => ({
  indirizzo: '',
  civico: '',
  cap: '',
  comune: '',
  provincia: '',
  numeroAddetti: '',
})

/**
 * Pagina admin per gestire le unità locali RENTRI del tenant (R2 multi-sede).
 *
 * Chi ha una sola sede non deve scegliere nulla: la creazione della prima
 * sede la rende principale in automatico e l'interfaccia non mostra alcun
 * selettore "quale sede" finché non ne esiste una seconda. Il costo della
 * funzionalità (scegliere quale sede è quella di default) lo paga solo chi
 * ne ha bisogno.
 */
@Component({
  selector: 'app-rentri-unita-locale',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    CheckboxModule,
    DialogModule,
    SharedModule,
    TagModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page" style="max-width: 900px;">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Sedi RENTRI</h1>
          <p class="page-subtitle">Unità locali del tenant iscritte a RENTRI</p>
        </div>
        <a
          routerLink="/rentri/certificato"
          class="rentri-cross-link"
          data-testid="rentri-unita-locale-certificato-link"
          >Certificato RENTRI</a
        >
      </header>

      <!-- Non-admin -->
      <section *ngIf="!isAdmin()" class="surface-card" data-testid="rentri-unita-locale-non-admin">
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori del tenant possono gestire le sedi RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAdmin()">
        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-unita-locale-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Caricamento…</span>
        </div>

        <div *ngIf="!loading()">
          <!-- Nessuna sede: stato vuoto + form della PRIMA sede (diventa principale da sola) -->
          <section
            *ngIf="sedi().length === 0"
            class="surface-card mb-4"
            data-testid="rentri-unita-locale-empty-state"
          >
            <div class="empty-state">
              <i class="pi pi-map-marker empty-state__icon" aria-hidden="true"></i>
              <span class="empty-state__title">Nessuna sede configurata</span>
              <p>
                Aggiungi la prima unità locale RENTRI del tenant: diventa la sede principale in
                automatico, non c'è nulla da scegliere.
              </p>
            </div>
          </section>

          <!-- Elenco sedi (mostrato anche con una sola, ma senza selettore "principale") -->
          <section
            *ngIf="sedi().length > 0"
            class="surface-card mb-4"
            aria-label="Sedi RENTRI del tenant"
            data-testid="rentri-unita-locale-list"
          >
            <h2 class="rentri-section-title mb-3">
              {{ sedi().length === 1 ? 'Sede' : 'Sedi (' + sedi().length + ')' }}
            </h2>

            <div
              *ngFor="let sede of sedi()"
              class="rentri-sede-row"
              [attr.data-testid]="'rentri-unita-locale-row-' + sede.id"
            >
              <div class="rentri-sede-row__main">
                <span class="rentri-sede-row__nome">{{ sede.denominazione }}</span>
                <span class="rentri-sede-row__codice">{{ sede.numIscrSito }}</span>
                <span
                  *ngIf="sede.progressivoMud != null"
                  class="rentri-sede-row__codice"
                  [attr.data-testid]="'rentri-unita-locale-codice-mud-' + sede.id"
                  >Codice MUD {{ sede.progressivoMud }}</span
                >
              </div>
              <div class="rentri-sede-row__badges">
                <p-tag
                  *ngIf="sede.principale"
                  severity="info"
                  value="Principale"
                  data-testid="rentri-unita-locale-badge-principale"
                ></p-tag>
                <p-tag
                  *ngIf="indirizzoMudMancante(sede)"
                  severity="warning"
                  value="Indirizzo per il MUD mancante"
                  [attr.data-testid]="'rentri-unita-locale-mud-mancante-' + sede.id"
                ></p-tag>
                <p-tag
                  [severity]="sede.attiva ? 'success' : 'danger'"
                  [value]="sede.attiva ? 'Attiva' : 'Cessata'"
                ></p-tag>
              </div>
              <div class="rentri-sede-row__actions">
                <!-- Il selettore "rendi principale" compare SOLO da due sedi in su:
                     con una sola sede non c'è nulla da scegliere. -->
                <p-button
                  *ngIf="sedi().length > 1 && !sede.principale"
                  label="Rendi principale"
                  icon="pi pi-star"
                  [text]="true"
                  size="small"
                  (onClick)="setPrincipale(sede)"
                  [attr.data-testid]="'rentri-unita-locale-set-principale-' + sede.id"
                ></p-button>
                <p-button
                  label="Dati per il MUD"
                  icon="pi pi-file-edit"
                  [text]="true"
                  size="small"
                  (onClick)="apriDatiMud(sede)"
                  [attr.data-testid]="'rentri-unita-locale-dati-mud-' + sede.id"
                ></p-button>
                <p-button
                  [label]="sede.attiva ? 'Segna cessata' : 'Riattiva'"
                  [icon]="sede.attiva ? 'pi pi-ban' : 'pi pi-refresh'"
                  [text]="true"
                  size="small"
                  (onClick)="toggleAttiva(sede)"
                  [attr.data-testid]="'rentri-unita-locale-toggle-attiva-' + sede.id"
                ></p-button>
                <p-button
                  icon="pi pi-trash"
                  severity="danger"
                  [text]="true"
                  size="small"
                  ariaLabel="Elimina sede"
                  (onClick)="confirmRemove(sede)"
                  [attr.data-testid]="'rentri-unita-locale-remove-' + sede.id"
                ></p-button>
              </div>
            </div>
          </section>

          <!-- Form di aggiunta sede -->
          <section class="surface-card" aria-label="Aggiungi sede RENTRI">
            <h2 class="rentri-section-title mb-2">Aggiungi sede</h2>

            <div class="field mb-3">
              <label for="ul-denominazione" class="block mb-2">Denominazione *</label>
              <input
                id="ul-denominazione"
                pInputText
                [(ngModel)]="denominazione"
                class="w-full"
                placeholder="es. Sede di Milano"
                data-testid="rentri-unita-locale-input-denominazione"
              />
            </div>

            <div class="field mb-3">
              <label for="ul-num-iscr-sito" class="block mb-2">Numero di iscrizione *</label>
              <input
                id="ul-num-iscr-sito"
                pInputText
                [(ngModel)]="numIscrSito"
                class="w-full"
                placeholder="es. OP1234ABC123456-RM1234"
                data-testid="rentri-unita-locale-input-num-iscr-sito"
                aria-describedby="ul-num-iscr-sito-hint"
              />
              <small id="ul-num-iscr-sito-hint" class="block mt-1 text-tertiary">
                Lo trovi sul certificato di iscrizione dell'unità locale.
              </small>
            </div>

            <!-- Checkbox "principale" mostrata solo se esiste già almeno una sede:
                 per la primissima non c'è nulla da scegliere, diventa principale da sola. -->
            <div class="field mb-4" *ngIf="sedi().length > 0">
              <p-checkbox
                [(ngModel)]="nuovaSedePrincipale"
                [binary]="true"
                inputId="ul-principale"
                data-testid="rentri-unita-locale-input-principale"
              ></p-checkbox>
              <label for="ul-principale" class="ml-2">Rendi questa la sede principale</label>
            </div>

            <p-button
              label="Aggiungi sede"
              icon="pi pi-plus"
              [loading]="saving()"
              [disabled]="!canSubmit()"
              (onClick)="create()"
              data-testid="rentri-unita-locale-submit-button"
            ></p-button>
          </section>
        </div>
      </ng-container>

      <p-dialog
        [visible]="datiMudAperto()"
        (visibleChange)="!$event && chiudiDatiMud()"
        header="Dati per il MUD"
        [modal]="true"
        [closable]="true"
        [closeOnEscape]="true"
        [style]="{ width: '560px', maxWidth: '95vw' }"
        closeAriaLabel="Chiudi la finestra dei dati per il MUD"
        (onShow)="focalizzaPrimoCampo()"
      >
        <p
          class="text-secondary mb-3"
          *ngIf="sedeMud() as s"
          data-testid="rentri-unita-locale-mud-sede"
        >
          Anagrafica di <strong>{{ s.denominazione }}</strong> per la dichiarazione MUD.
        </p>
        <div class="field mb-3">
          <label for="ul-mud-indirizzo" class="block mb-2">Indirizzo</label>
          <input
            id="ul-mud-indirizzo"
            pInputText
            class="w-full"
            maxlength="255"
            [(ngModel)]="formMud.indirizzo"
            data-testid="rentri-unita-locale-mud-indirizzo"
          />
        </div>
        <div class="field mb-3">
          <label for="ul-mud-civico" class="block mb-2">Civico</label>
          <input
            id="ul-mud-civico"
            pInputText
            class="w-full"
            maxlength="20"
            [(ngModel)]="formMud.civico"
            data-testid="rentri-unita-locale-mud-civico"
          />
        </div>
        <div class="field mb-3">
          <label for="ul-mud-cap" class="block mb-2">CAP</label>
          <input
            id="ul-mud-cap"
            pInputText
            class="w-full"
            maxlength="5"
            inputmode="numeric"
            [(ngModel)]="formMud.cap"
            [attr.aria-invalid]="capNonValido() ? true : null"
            [attr.aria-describedby]="capNonValido() ? 'ul-mud-cap-err' : null"
            data-testid="rentri-unita-locale-mud-cap"
          />
          <small
            *ngIf="capNonValido()"
            id="ul-mud-cap-err"
            role="alert"
            class="block mt-1 text-danger"
            data-testid="rentri-unita-locale-mud-cap-errore"
            >Il CAP deve essere di 5 cifre</small
          >
        </div>
        <div class="field mb-3">
          <label for="ul-mud-comune" class="block mb-2">Comune</label>
          <input
            id="ul-mud-comune"
            pInputText
            class="w-full"
            maxlength="100"
            [(ngModel)]="formMud.comune"
            data-testid="rentri-unita-locale-mud-comune"
          />
        </div>
        <div class="field mb-3">
          <label for="ul-mud-provincia" class="block mb-2">Provincia (sigla)</label>
          <input
            id="ul-mud-provincia"
            pInputText
            class="w-full"
            maxlength="2"
            [(ngModel)]="formMud.provincia"
            [attr.aria-invalid]="provinciaNonValida() ? true : null"
            [attr.aria-describedby]="provinciaNonValida() ? 'ul-mud-provincia-err' : null"
            data-testid="rentri-unita-locale-mud-provincia"
          />
          <small
            *ngIf="provinciaNonValida()"
            id="ul-mud-provincia-err"
            role="alert"
            class="block mt-1 text-danger"
            data-testid="rentri-unita-locale-mud-provincia-errore"
            >La provincia deve essere la sigla di 2 lettere</small
          >
        </div>
        <div class="field mb-3">
          <label for="ul-mud-addetti" class="block mb-2">Numero di addetti</label>
          <input
            id="ul-mud-addetti"
            pInputText
            class="w-full"
            inputmode="numeric"
            [(ngModel)]="formMud.numeroAddetti"
            [attr.aria-invalid]="addettiNonValidi() ? true : null"
            [attr.aria-describedby]="addettiNonValidi() ? 'ul-mud-addetti-err' : null"
            data-testid="rentri-unita-locale-mud-addetti"
          />
          <small
            *ngIf="addettiNonValidi()"
            id="ul-mud-addetti-err"
            role="alert"
            class="block mt-1 text-danger"
            data-testid="rentri-unita-locale-mud-addetti-errore"
            >Gli addetti devono essere un numero intero da 0 a 99999</small
          >
        </div>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="chiudiDatiMud()"
            data-testid="rentri-unita-locale-mud-annulla"
          ></p-button>
          <p-button
            label="Salva"
            icon="pi pi-check"
            [loading]="saving()"
            [disabled]="!datiMudValidi()"
            (onClick)="salvaDatiMud()"
            data-testid="rentri-unita-locale-mud-salva"
          ></p-button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      .rentri-cross-link {
        align-self: center;
        font-size: var(--font-size-sm);
      }
      .rentri-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .rentri-sede-row {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        padding: var(--spacing-base) 0;
        border-bottom: 1px solid var(--surface-border-strong);
      }
      .rentri-sede-row:last-child {
        border-bottom: none;
      }
      .rentri-sede-row__main {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 200px;
        flex: 1;
      }
      .rentri-sede-row__nome {
        font-weight: var(--font-weight-semibold);
      }
      .rentri-sede-row__codice {
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      .rentri-sede-row__badges {
        display: flex;
        gap: var(--spacing-xs);
      }
      .rentri-sede-row__actions {
        display: flex;
        gap: var(--spacing-xs);
      }
      .text-secondary {
        color: var(--text-secondary);
      }
      .text-danger {
        color: var(--color-danger);
      }
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .mt-1 {
        margin-top: var(--spacing-xs);
      }
      .ml-2 {
        margin-left: var(--spacing-sm);
      }
      .field {
        margin-bottom: 0;
      }
    `,
  ],
})
export class RentriUnitaLocaleComponent implements OnInit {
  private readonly unitaLocaleService = inject(RentriUnitaLocaleService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly confirm = inject(ConfirmationService)

  readonly sedi = signal<RentriUnitaLocale[]>([])
  readonly loading = signal(false)
  readonly saving = signal(false)

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && ADMIN_ROLES.includes(role)
  })

  // Dialog "Dati per il MUD"
  readonly sedeMud = signal<RentriUnitaLocale | null>(null)
  readonly datiMudAperto = computed(() => this.sedeMud() !== null)
  formMud: FormMud = FORM_MUD_VUOTO()

  // Form aggiunta sede
  denominazione = ''
  numIscrSito = ''
  nuovaSedePrincipale = false

  ngOnInit(): void {
    if (this.isAdmin()) {
      this.loadSedi()
    }
  }

  private loadSedi(): void {
    this.loading.set(true)
    this.unitaLocaleService.list().subscribe({
      next: sedi => {
        this.sedi.set(sedi)
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.toast.error('Impossibile caricare le sedi RENTRI del tenant')
      },
    })
  }

  /** Sede non principale a cui manca un dato dell'indirizzo (la principale ripiega sull'azienda). */
  indirizzoMudMancante(sede: RentriUnitaLocale): boolean {
    if (sede.principale) return false
    return [sede.indirizzo, sede.cap, sede.comune, sede.provincia].some(v => !v || !v.trim())
  }

  apriDatiMud(sede: RentriUnitaLocale): void {
    this.formMud = {
      indirizzo: sede.indirizzo ?? '',
      civico: sede.civico ?? '',
      cap: sede.cap ?? '',
      comune: sede.comune ?? '',
      provincia: sede.provincia ?? '',
      numeroAddetti: sede.numeroAddetti == null ? '' : String(sede.numeroAddetti),
    }
    this.sedeMud.set(sede)
  }

  chiudiDatiMud(): void {
    this.sedeMud.set(null)
  }

  /** Porta il focus sul primo campo all'apertura del dialog. */
  focalizzaPrimoCampo(): void {
    setTimeout(() => document.getElementById('ul-mud-indirizzo')?.focus())
  }

  capNonValido(): boolean {
    return !RE_CAP.test((this.formMud.cap ?? '').trim())
  }

  provinciaNonValida(): boolean {
    return !RE_PROVINCIA.test((this.formMud.provincia ?? '').trim())
  }

  addettiNonValidi(): boolean {
    const v = String(this.formMud.numeroAddetti ?? '').trim()
    // intero da 0 a 99999: il campo del file ha 5 cifre (F2)
    return v !== '' && !(/^[0-9]+$/.test(v) && Number(v) <= 99999)
  }

  datiMudValidi(): boolean {
    return !this.capNonValido() && !this.provinciaNonValida() && !this.addettiNonValidi()
  }

  salvaDatiMud(): void {
    const sede = this.sedeMud()
    if (!sede || !this.datiMudValidi()) return
    const f = this.formMud
    const addetti = String(f.numeroAddetti ?? '').trim()
    this.saving.set(true)
    // Stringa vuota = cancella il dato (come il backend); addetti vuoti = null.
    this.unitaLocaleService
      .update(sede.id, {
        indirizzo: (f.indirizzo ?? '').trim(),
        civico: (f.civico ?? '').trim(),
        cap: (f.cap ?? '').trim(),
        comune: (f.comune ?? '').trim(),
        provincia: (f.provincia ?? '').trim().toUpperCase(),
        numeroAddetti: addetti === '' ? null : Number(addetti),
      })
      .subscribe({
        next: aggiornata => {
          this.saving.set(false)
          this.sedi.update(lista => lista.map(x => (x.id === aggiornata.id ? aggiornata : x)))
          this.toast.success('Dati per il MUD salvati')
          this.chiudiDatiMud()
        },
        error: err => {
          this.saving.set(false)
          this.toast.error(err?.error?.message || 'Errore nel salvataggio dei dati per il MUD')
        },
      })
  }

  canSubmit(): boolean {
    return !!this.denominazione.trim() && !!this.numIscrSito.trim()
  }

  create(): void {
    if (!this.canSubmit()) return
    this.saving.set(true)

    const haAlmenoUnaSede = this.sedi().length > 0
    this.unitaLocaleService
      .create({
        denominazione: this.denominazione.trim(),
        numIscrSito: this.numIscrSito.trim(),
        // Ignorato dal backend per la primissima sede: forzata a true comunque.
        ...(haAlmenoUnaSede ? { principale: this.nuovaSedePrincipale } : {}),
      })
      .subscribe({
        next: () => {
          this.saving.set(false)
          this.toast.success('Sede RENTRI aggiunta')
          this.resetForm()
          this.loadSedi()
        },
        error: err => {
          this.saving.set(false)
          this.toast.error(err?.error?.message || 'Errore nel salvataggio della sede')
        },
      })
  }

  setPrincipale(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.setPrincipale(sede.id).subscribe({
      next: () => {
        this.toast.success(`"${sede.denominazione}" è ora la sede principale`)
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'impostare la sede principale")
      },
    })
  }

  toggleAttiva(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.update(sede.id, { attiva: !sede.attiva }).subscribe({
      next: () => {
        this.toast.success(sede.attiva ? 'Sede segnata come cessata' : 'Sede riattivata')
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'aggiornare la sede")
      },
    })
  }

  confirmRemove(sede: RentriUnitaLocale): void {
    this.confirm.confirm({
      message: `Eliminare la sede "${sede.denominazione}"? L'operazione non è reversibile.`,
      header: 'Conferma eliminazione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.remove(sede),
    })
  }

  private remove(sede: RentriUnitaLocale): void {
    this.unitaLocaleService.remove(sede.id).subscribe({
      next: () => {
        this.toast.success('Sede eliminata')
        this.loadSedi()
      },
      error: err => {
        this.toast.error(err?.error?.message || "Errore nell'eliminare la sede")
      },
    })
  }

  private resetForm(): void {
    this.denominazione = ''
    this.numIscrSito = ''
    this.nuovaSedePrincipale = false
  }
}
