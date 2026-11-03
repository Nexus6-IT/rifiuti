import { CommonModule } from '@angular/common'
import {
  Directive,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  Signal,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Observable, Subscription } from 'rxjs'
import { ToastService } from '../../../core/services/toast.service'
import { messaggioErrore } from './tabella-comune'

/**
 * Parte comune di dialog e scheda delle codifiche (R25): `codifiche-contratto` (4.1) e
 * `codifiche-addebito` (4.2a). Le differenze volute (testid, lunghezza della descrizione, codice
 * numerico, servizio, vocabolari) arrivano da una `ConfigCodificaDialog`; i due componenti
 * concreti restano con il loro selettore e la loro classe perché li usano molti altri file.
 */

export interface CodificaBase<G extends string> {
  id: string
  genere: G
  codice: string
  descrizione: string
  attiva: boolean
  versione: number
  eliminabile: boolean
}

/** Rotte usate da dialog e scheda: le due classi di rotte (`TabellaCodifiche*`) le soddisfano. */
export interface ApiCodifiche<T, G extends string> {
  list(genere: G, incluseDisattivate?: boolean): Observable<T[]>
  prossimoCodice(genere: G): Observable<string>
  crea(dati: { genere: G; descrizione: string; codice?: string | null }): Observable<T>
  modifica(
    id: string,
    dati: { codice?: string; descrizione?: string; attiva?: boolean; versione: number }
  ): Observable<T>
  elimina(id: string, versione: number): Observable<void>
}

export interface VocabolarioCodifiche<G extends string> {
  etichetta(genere: G): string
  concordanza(genere: G): { nuovo: string; articolo: string }
}

export interface ConfigCodificaDialog<G extends string> extends VocabolarioCodifiche<G> {
  /** Prefisso dei `data-testid` (`codifica-dlg` -> `codifica-dlg-codice`). */
  testid: string
  /** Prefisso degli `id` dei campi (`codifica` -> `#codifica-codice`). */
  idCampi: string
  etichettaCodice: string
  /** Colonna del database: 60 per il contratto, 45 per l'addebito. */
  descrizioneMax: number
  /** Codice di sole cifre (da 1 a 3): pattern, `inputmode` e codice obbligatorio in modifica. */
  codiceNumerico: boolean
  /** Codice d'errore HTTP del codice già usato, per il messaggio della creazione rapida. */
  codiceDuplicato: string
}

/** Template unico del dialog: tutto ciò che cambia passa da `cfg`. */
export const TEMPLATE_CODIFICA_DIALOG = `
  <p-dialog
    [visible]="visible"
    (visibleChange)="chiudi()"
    [header]="
      (elemento ? 'Modifica ' : concordanza().nuovo + ' ') + etichettaGenere().toLowerCase()
    "
    [modal]="true"
    [style]="{ width: '28rem' }"
  >
    <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
      <ng-container *ngIf="!rapida">
        <label [attr.for]="cfg.idCampi + '-codice'">{{ cfg.etichettaCodice }}</label>
        <input
          pInputText
          [id]="cfg.idCampi + '-codice'"
          formControlName="codice"
          maxlength="3"
          [attr.inputmode]="cfg.codiceNumerico ? 'numeric' : null"
          [attr.data-testid]="cfg.testid + '-codice'"
        />
      </ng-container>
      <label [attr.for]="cfg.idCampi + '-descrizione'">Descrizione</label>
      <input
        pInputText
        [id]="cfg.idCampi + '-descrizione'"
        formControlName="descrizione"
        [attr.maxlength]="cfg.descrizioneMax"
        (keydown.enter)="invio($event)"
        [attr.data-testid]="cfg.testid + '-descrizione'"
      />
      <p
        *ngIf="errore() as e"
        role="alert"
        class="field-error"
        [attr.data-testid]="cfg.testid + '-errore'"
      >
        {{ e }}
      </p>
    </form>
    <ng-template pTemplate="footer">
      <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
      <p-button
        label="Salva"
        icon="pi pi-check"
        [disabled]="form.invalid || inCorso() || !puoScrivere()"
        (onClick)="salva()"
        [attr.data-testid]="cfg.testid + '-salva'"
      />
    </ng-template>
  </p-dialog>
`

export const STILI_CODIFICA_DIALOG = `
  .dlg-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
`

export const IMPORT_CODIFICA_DIALOG = [CommonModule, ButtonModule, DialogModule, InputTextModule]

/**
 * Nuova codifica o modifica. Modalità `rapida` (aggiunta in linea, come F4 di WinWaste): solo la
 * descrizione, Invio salva e il codice lo assegna il server. Nella modalità normale il codice è
 * proposto da `prossimoCodice`; se lasciato vuoto o ancora quello proposto lo assegna il server e
 * il toast mostra il codice definitivo.
 */
@Directive()
export abstract class CodificaDialogBase<T extends CodificaBase<G>, G extends string>
  implements OnChanges
{
  protected abstract readonly api: ApiCodifiche<T, G>
  abstract readonly cfg: ConfigCodificaDialog<G>
  /** Chi non può scrivere vede Salva disattivato (le codifiche di addebito); il contratto non lo verifica. */
  abstract readonly puoScrivere: Signal<boolean>

  private readonly toast = inject(ToastService)

  @Input() visible = false
  /** Il valore iniziale lo imposta il componente concreto. */
  @Input() genere!: G
  /** null = nuova. */
  @Input() elemento: T | null = null
  /** Solo la descrizione; il codice lo assegna il server. */
  @Input() rapida = false
  @Output() salvato = new EventEmitter<T>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  private proposta?: Subscription
  private salvataggio?: Subscription
  /** Codice proposto da `prossimoCodice` e non ancora modificato dall'utente. */
  private codiceProposto: string | null = null

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  })

  concordanza(): { nuovo: string; articolo: string } {
    return this.cfg.concordanza(this.genere)
  }

  etichettaGenere(): string {
    return this.cfg.etichetta(this.genere)
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    this.proposta?.unsubscribe()
    this.salvataggio?.unsubscribe()
    this.codiceProposto = null
    const e = this.elemento
    if (this.cfg.codiceNumerico) {
      // In modifica il codice non può essere vuoto (T12): il form lo rifiuta prima del backend.
      this.form.controls.codice.setValidators(
        e
          ? [Validators.required, Validators.pattern(/^\d{1,3}$/)]
          : [Validators.pattern(/^\d{0,3}$/)]
      )
    }
    this.form.reset({ codice: e?.codice ?? '', descrizione: e?.descrizione ?? '' })
    this.errore.set(null)
    this.inCorso.set(false)
    if (e || this.rapida) return
    // Informativo: se nel frattempo qualcuno prende il codice, lo ricalcola il server.
    this.proposta = this.api.prossimoCodice(this.genere).subscribe({
      next: codice => {
        this.codiceProposto = codice
        this.form.controls.codice.setValue(codice)
      },
      error: () => undefined,
    })
  }

  invio(evento: Event): void {
    evento.preventDefault()
    this.salva()
  }

  salva(): void {
    if (this.form.invalid || this.inCorso() || !this.puoScrivere()) return
    const v = this.form.getRawValue()
    const descrizione = v.descrizione.trim()
    const codice = v.codice.trim()
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.api.modifica(this.elemento.id, {
          codice,
          descrizione,
          versione: this.elemento.versione,
        })
      : this.api.crea({
          genere: this.genere,
          descrizione,
          ...(this.rapida
            ? {}
            : { codice: codice === '' || codice === this.codiceProposto ? null : codice }),
        })
    this.salvataggio = chiamata.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        if (!this.elemento) this.toast.success(`Codice assegnato: ${salvata.codice}.`)
        this.salvato.emit(salvata)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        const e = err as { status?: number; error?: { error?: string } }
        const terzoOperatore =
          this.rapida &&
          !this.elemento &&
          e?.status === 409 &&
          e.error?.error === this.cfg.codiceDuplicato
        this.errore.set(
          terzoOperatore
            ? 'Un collega ha appena usato lo stesso codice: riprova.'
            : messaggioErrore(err, 'Impossibile salvare.')
        )
      },
    })
  }

  chiudi(): void {
    // Nessuna proposta di codice in volo dopo la chiusura.
    this.proposta?.unsubscribe()
    this.salvataggio?.unsubscribe()
    this.inCorso.set(false)
    this.form.reset()
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
