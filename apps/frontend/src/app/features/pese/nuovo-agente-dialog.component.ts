/**
 * Abbinamento di un agente di pesa: crea l'agente (o rigenera il codice di uno ancora in attesa) e
 * mostra il codice monouso UNA volta, con la scadenza, il comando da lanciare sul PC della pesa e
 * il pulsante «Copia». Alla chiusura il codice si cancella dalla memoria del componente.
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  NgZone,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { environment } from '../../../environments/environment'
import { RegistroVista } from '../registro/registro.service'
import { contoAllaRovescia, indirizzoServerAgente, messaggioErrorePese } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { AgenteCreato, AgenteVista, PeseService } from './pese.service'

/** `XXXXXXXXXXXX` o `XXXX-XXXX-XXXX` -> gruppi da 4 separati da trattino. */
const gruppi = (codice: string): string[] => codice.replace(/-/g, '').match(/.{1,4}/g) ?? []

@Component({
  selector: 'app-nuovo-agente-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiudi()"
      [header]="agenteEsistente ? 'Nuovo codice di abbinamento' : 'Nuovo agente di pesa'"
      [modal]="true"
      [style]="{ width: '620px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra dell'agente"
      (onShow)="mettiAFuoco()"
    >
      <ng-container *ngIf="!creato(); else mostraCodice">
        <form
          [formGroup]="form"
          (submit)="$event.preventDefault()"
          novalidate
          data-testid="ag-form"
        >
          <ng-container *ngIf="!agenteEsistente; else soloCodice">
            <div class="field">
              <label for="ag-descrizione"
                >Nome del PC della pesa <span class="req" aria-hidden="true">*</span></label
              >
              <input
                id="ag-descrizione"
                type="text"
                class="p-inputtext w-full"
                formControlName="descrizione"
                maxlength="255"
                aria-required="true"
                [attr.aria-invalid]="tentato() && !form.value.descrizione?.trim() ? true : null"
                [attr.aria-describedby]="
                  tentato() && !form.value.descrizione?.trim() ? 'ag-descrizione-errore' : null
                "
                data-testid="ag-descrizione"
              />
              <small
                *ngIf="tentato() && !form.value.descrizione?.trim()"
                id="ag-descrizione-errore"
                class="field-error"
                role="alert"
                data-testid="ag-descrizione-errore"
                >Il nome è obbligatorio.</small
              >
            </div>
            <div class="field" *ngIf="registri.length > 0">
              <label for="ag-registro">Sede</label>
              <select
                id="ag-registro"
                class="p-inputtext w-full"
                formControlName="registroId"
                data-testid="ag-registro"
              >
                <option value="">Tutta l'azienda</option>
                <option *ngFor="let r of registri" [value]="r.id">{{ r.denominazione }}</option>
              </select>
            </div>
          </ng-container>
          <ng-template #soloCodice>
            <p class="nota" data-testid="ag-nota-codice">
              Il codice precedente di «{{ agenteEsistente?.descrizione }}» smette di valere. Il
              nuovo vale 15 minuti e si usa una volta sola.
            </p>
          </ng-template>
        </form>
        <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="ag-errore">
          {{ e }}
        </p>
        <div class="azioni">
          <p-button label="Annulla" [text]="true" (onClick)="chiudi()"></p-button>
          <p-button
            [label]="agenteEsistente ? 'Genera il codice' : 'Crea agente'"
            icon="pi pi-check"
            [loading]="salvataggio()"
            [disabled]="salvataggio()"
            (onClick)="salva()"
            data-testid="ag-salva"
          ></p-button>
        </div>
      </ng-container>

      <ng-template #mostraCodice>
        <p class="avviso-manuale" role="alert" data-testid="ag-avviso-una-volta">
          Il codice si vede una volta sola: copialo ora. Se lo perdi se ne genera un altro.
        </p>
        <div class="field">
          <span class="etichetta" id="ag-codice-etichetta">Codice di abbinamento</span>
          <div
            class="codice"
            role="group"
            aria-labelledby="ag-codice-etichetta"
            data-testid="ag-codice"
          >
            <ng-container *ngFor="let g of gruppiCodice(); let ultimo = last">
              <span class="gruppo">{{ g }}</span
              ><span *ngIf="!ultimo" aria-hidden="true">-</span>
            </ng-container>
          </div>
          <small class="field-hint" data-testid="ag-scadenza" role="timer">{{
            testoScadenza()
          }}</small>
        </div>
        <div class="field">
          <span class="etichetta" id="ag-comando-etichetta"
            >Comando da lanciare sul PC della pesa</span
          >
          <code class="comando" aria-labelledby="ag-comando-etichetta" data-testid="ag-comando">{{
            comando()
          }}</code>
          <small class="field-hint"
            >L'indirizzo del server finisce con <code>/api/v1</code>: l'agente aggiunge solo il
            resto del percorso.</small
          >
        </div>
        <p *ngIf="copiato()" role="status" class="nota" data-testid="ag-copiato">Copiato.</p>
        <div class="azioni">
          <p-button
            label="Copia il comando"
            icon="pi pi-copy"
            [outlined]="true"
            (onClick)="copia()"
            data-testid="ag-copia"
          ></p-button>
          <p-button label="Chiudi" (onClick)="chiudi()" data-testid="ag-chiudi"></p-button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    STILI_PESE,
    `
      .codice {
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--font-size-xl, 1.5rem);
        font-weight: var(--font-weight-semibold);
        letter-spacing: 0.08em;
        padding: var(--spacing-sm) var(--spacing-base);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
        background: var(--surface-ground, transparent);
      }
      .gruppo {
        padding: 0 var(--spacing-xs);
      }
      .comando {
        display: block;
        font-family: var(--font-mono, ui-monospace, monospace);
        font-size: var(--font-size-sm);
        padding: var(--spacing-sm) var(--spacing-base);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
        overflow-wrap: anywhere;
        user-select: all;
      }
    `,
  ],
})
export class NuovoAgenteDialogComponent implements OnInit, OnDestroy {
  private readonly pese = inject(PeseService)
  private readonly zona = inject(NgZone)

  @Input() registri: RegistroVista[] = []
  /** Se presente: si rigenera il codice di quell'agente (in attesa) invece di crearne uno. */
  @Input() agenteEsistente: AgenteVista | null = null
  /** L'agente e' stato creato (o il codice rigenerato): il padre ricarica l'elenco. */
  @Output() fatto = new EventEmitter<void>()
  @Output() chiuso = new EventEmitter<void>()

  readonly form = new FormGroup({
    descrizione: new FormControl('', { nonNullable: true }),
    registroId: new FormControl('', { nonNullable: true }),
  })
  readonly tentato = signal(false)
  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  readonly copiato = signal(false)
  /** Il codice sta SOLO qui e si azzera alla chiusura. */
  readonly creato = signal<AgenteCreato | null>(null)
  readonly scade = signal('')
  private timer: ReturnType<typeof setInterval> | null = null

  ngOnInit(): void {
    this.aggiornaScadenza()
  }

  ngOnDestroy(): void {
    this.azzera()
  }

  testoScadenza(): string {
    return this.scade() === 'scaduto'
      ? "Codice scaduto: generane un altro dall'elenco degli agenti."
      : `Scade fra ${this.scade()}.`
  }

  gruppiCodice = (): string[] => gruppi(this.creato()?.codice ?? '')

  comando(): string {
    const c = this.creato()
    const server = indirizzoServerAgente(environment.apiUrl, window.location.origin)
    return c ? `agente-pesa abbina --server ${server} --codice ${c.codice}` : ''
  }

  mettiAFuoco(): void {
    setTimeout(() => document.getElementById('ag-descrizione')?.focus())
  }

  salva(): void {
    if (this.salvataggio()) return
    this.tentato.set(true)
    const v = this.form.getRawValue()
    const chiamata = this.agenteEsistente
      ? this.pese.nuovoCodiceAgente(this.agenteEsistente.id)
      : v.descrizione.trim()
        ? this.pese.creaAgente({
            descrizione: v.descrizione.trim(),
            registroId: v.registroId || null,
          })
        : null
    if (!chiamata) {
      document.getElementById('ag-descrizione')?.focus()
      return
    }
    this.errore.set(null)
    this.salvataggio.set(true)
    chiamata.subscribe({
      next: r => {
        this.salvataggio.set(false)
        this.creato.set(r)
        this.aggiornaScadenza()
        this.timer = this.zona.runOutsideAngular(() =>
          setInterval(() => this.zona.run(() => this.aggiornaScadenza()), 1000)
        )
        this.fatto.emit()
      },
      error: err => {
        this.salvataggio.set(false)
        this.errore.set(messaggioErrorePese(err, 'Operazione non riuscita.'))
      },
    })
  }

  async copia(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.comando())
      this.copiato.set(true)
    } catch {
      this.copiato.set(false)
      this.errore.set('Copia non riuscita: seleziona il comando e copialo a mano.')
    }
  }

  chiudi(): void {
    this.azzera()
    this.chiuso.emit()
  }

  private azzera(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.creato.set(null)
  }

  private aggiornaScadenza(): void {
    const c = this.creato()
    this.scade.set(c ? contoAllaRovescia(c.scadeIl) : '')
  }
}
