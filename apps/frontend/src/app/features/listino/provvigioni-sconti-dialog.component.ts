import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { focalizzaPasso } from '../../shared/utils/focalizza-passo'
import { leggiErroriAzione } from './errori-azione'
import { EsitoImpostazione, TipoProvvigione } from './listino.model'
import { ListinoService } from './listino.service'
import { leggiCascata } from '../../shared/utils/numero-modificabile'
import { OPZIONI_TIPO_PROVVIGIONE } from './vocabolario-listino'

/** Regola di WinWaste: il backend la rifiuta con questo testo (anche senza campo). */
const MESSAGGIO_ENTRAMBI_SCONTI = 'Specificare entrambi gli sconti.'

type Azione = 'PROVVIGIONE' | 'SCONTO'

/**
 * Provvigione o sconto su TUTTE le righe del contratto (D19, E20). La provvigione si imposta sulle
 * righe senza prezzo speciale (vuota = si svuotano provvigione e tipo, R45); lo sconto sostituisce
 * quello attuale solo nelle righe che hanno esattamente quella formula. Le righe a prezzo speciale
 * non si toccano e vanno sistemate a mano: l'avviso c'è prima e il conteggio dopo. Le formule si
 * scrivono con la virgola (`10+5,5`); con un errore nel campo non si salva. Prima di scrivere c'è
 * una conferma, perché l'azione tocca molte righe.
 */
@Component({
  selector: 'app-provvigioni-sconti-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Provvigioni e sconti del contratto"
      [modal]="true"
      [closable]="!inCorso()"
      [style]="{ width: '38rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <div *ngIf="esito() as e" class="dlg-form" role="status" data-testid="ps-esito">
        <p>Righe aggiornate: {{ e.aggiornate }}.</p>
        <p *ngIf="e.speciali > 0" data-testid="ps-esito-speciali">
          Righe a prezzo speciale non modificate: {{ e.speciali }}. Vanno sistemate a mano.
        </p>
        <p *ngIf="e.escluse > 0" data-testid="ps-esito-escluse">
          Righe escluse (detrazioni e anticipi non hanno provvigione): {{ e.escluse }}.
        </p>
      </div>

      <div
        *ngIf="!esito() && inConferma()"
        class="dlg-form"
        tabindex="-1"
        data-testid="ps-conferma"
      >
        <p>{{ riepilogo() }}</p>
        <p>L'operazione tocca tutte le righe interessate del contratto e non si annulla.</p>
      </div>

      <div *ngIf="!esito()" class="dlg-form" [hidden]="inConferma()">
        <p class="field-hint" data-testid="ps-avviso">
          Le righe con prezzo speciale non vengono modificate: dopo l'operazione vanno sistemate a
          mano.
        </p>
        <fieldset class="scelta">
          <legend>Che cosa vuoi cambiare</legend>
          <label class="spunta">
            <input
              type="radio"
              name="ps-azione"
              value="PROVVIGIONE"
              [ngModel]="azione()"
              (ngModelChange)="cambiaAzione($event)"
              data-testid="ps-azione-provvigione"
            />
            Provvigione
          </label>
          <label class="spunta">
            <input
              type="radio"
              name="ps-azione"
              value="SCONTO"
              [ngModel]="azione()"
              (ngModelChange)="cambiaAzione($event)"
              data-testid="ps-azione-sconto"
            />
            Sconto
          </label>
        </fieldset>

        <ng-container *ngIf="azione() === 'PROVVIGIONE'">
          <label for="ps-provvigione">Provvigione (%)</label>
          <input
            pInputText
            id="ps-provvigione"
            [ngModel]="provvigione()"
            (ngModelChange)="cambiaProvvigione($event)"
            inputmode="decimal"
            [attr.aria-invalid]="erroreProvvigione() || backendProvvigione() ? 'true' : null"
            [attr.aria-describedby]="
              erroreProvvigione()
                ? 'ps-errore-provvigione'
                : backendProvvigione()
                  ? 'ps-errore-provvigione-backend'
                  : null
            "
            data-testid="ps-provvigione"
          />
          <small
            *ngIf="erroreProvvigione() as e"
            role="alert"
            class="field-error"
            id="ps-errore-provvigione"
            data-testid="ps-errore-provvigione"
            >{{ e }}</small
          >
          <small
            *ngIf="!erroreProvvigione() && backendProvvigione() as e"
            role="alert"
            class="field-error"
            id="ps-errore-provvigione-backend"
            data-testid="ps-errore-provvigione-backend"
            >{{ e }}</small
          >
          <ng-container *ngIf="provvigioneVuota(); else conTipo">
            <p class="field-hint" data-testid="ps-svuota">
              Lasciando vuoto si svuotano provvigione e tipo di tutte le righe.
            </p>
          </ng-container>
          <ng-template #conTipo>
            <label for="ps-tipo">Calcolata</label>
            <select
              id="ps-tipo"
              class="p-inputtext"
              [ngModel]="tipo()"
              (ngModelChange)="tipo.set($event)"
              data-testid="ps-tipo"
            >
              <option *ngFor="let o of opzioniTipo" [value]="o.value">{{ o.label }}</option>
            </select>
          </ng-template>
        </ng-container>

        <ng-container *ngIf="azione() === 'SCONTO'">
          <label for="ps-attuale">Sconto attuale</label>
          <input
            pInputText
            id="ps-attuale"
            [ngModel]="scontoAttuale()"
            (ngModelChange)="cambiaAttuale($event)"
            [attr.aria-invalid]="erroreAttuale() || backendAttuale() ? 'true' : null"
            [attr.aria-describedby]="
              erroreAttuale()
                ? 'ps-errore-attuale'
                : backendAttuale()
                  ? 'ps-errore-attuale-backend'
                  : null
            "
            data-testid="ps-sconto-attuale"
          />
          <small
            *ngIf="erroreAttuale() as e"
            role="alert"
            class="field-error"
            id="ps-errore-attuale"
            data-testid="ps-errore-attuale"
            >{{ e }}</small
          >
          <small
            *ngIf="!erroreAttuale() && backendAttuale() as e"
            role="alert"
            class="field-error"
            id="ps-errore-attuale-backend"
            data-testid="ps-errore-attuale-backend"
            >{{ e }}</small
          >
          <label for="ps-nuovo">Sconto nuovo</label>
          <input
            pInputText
            id="ps-nuovo"
            [ngModel]="scontoNuovo()"
            (ngModelChange)="cambiaNuovo($event)"
            [attr.aria-invalid]="erroreNuovo() || backendNuovo() ? 'true' : null"
            [attr.aria-describedby]="
              erroreNuovo() ? 'ps-errore-nuovo' : backendNuovo() ? 'ps-errore-nuovo-backend' : null
            "
            data-testid="ps-sconto-nuovo"
          />
          <small
            *ngIf="erroreNuovo() as e"
            role="alert"
            class="field-error"
            id="ps-errore-nuovo"
            data-testid="ps-errore-nuovo"
            >{{ e }}</small
          >
          <small
            *ngIf="!erroreNuovo() && backendNuovo() as e"
            role="alert"
            class="field-error"
            id="ps-errore-nuovo-backend"
            data-testid="ps-errore-nuovo-backend"
            >{{ e }}</small
          >
          <p class="field-hint">Si scrivono come sulla riga, per esempio 10 oppure 10+5,5.</p>
        </ng-container>
      </div>

      <ul *ngIf="errori().length > 0" role="alert" class="field-error" data-testid="ps-errore">
        <li *ngFor="let m of errori()">{{ m }}</li>
      </ul>

      <ng-template pTemplate="footer">
        <p-button
          *ngIf="conflitto()"
          label="Ricarica"
          icon="pi pi-refresh"
          [outlined]="true"
          (onClick)="ricarica.emit()"
          data-testid="ps-ricarica"
        />
        <p-button
          [label]="esito() ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="ps-chiudi"
        />
        <ng-container *ngIf="!esito()">
          <p-button
            *ngIf="!inConferma()"
            label="Avanti"
            [disabled]="!puoProseguire()"
            (onClick)="vaiAConferma()"
            data-testid="ps-avanti"
          />
          <ng-container *ngIf="inConferma()">
            <p-button
              label="Indietro"
              [text]="true"
              [disabled]="inCorso()"
              (onClick)="inConferma.set(false)"
              data-testid="ps-indietro"
            />
            <p-button
              label="Applica"
              icon="pi pi-check"
              [disabled]="inCorso() || !puoProseguire()"
              (onClick)="applica()"
              data-testid="ps-applica"
            />
          </ng-container>
        </ng-container>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .scelta {
        display: flex;
        gap: 1rem;
        border: 0;
        padding: 0;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
    `,
  ],
})
export class ProvvigioniScontiDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)

  @Input() visible = false
  @Input({ required: true }) contrattoId = ''
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() applicata = new EventEmitter<EsitoImpostazione>()
  @Output() ricarica = new EventEmitter<void>()

  readonly opzioniTipo = OPZIONI_TIPO_PROVVIGIONE
  readonly azione = signal<Azione>('PROVVIGIONE')
  readonly provvigione = signal('')
  readonly tipo = signal<TipoProvvigione>('SCONTATO')
  readonly scontoAttuale = signal('')
  readonly scontoNuovo = signal('')
  readonly inConferma = signal(false)
  readonly inCorso = signal(false)
  readonly esito = signal<EsitoImpostazione | null>(null)
  readonly errori = signal<string[]>([])
  /** Errori del backend sul campo (400 con `campo`), mostrati sotto il campo e tolti alla modifica. */
  readonly backendProvvigione = signal<string | null>(null)
  readonly backendAttuale = signal<string | null>(null)
  readonly backendNuovo = signal<string | null>(null)
  readonly conflitto = signal(false)

  private readonly letturaProvvigione = computed(() => leggiCascata(this.provvigione()))
  private readonly letturaAttuale = computed(() => leggiCascata(this.scontoAttuale()))
  private readonly letturaNuovo = computed(() => leggiCascata(this.scontoNuovo()))
  readonly erroreProvvigione = computed(() => this.letturaProvvigione().errore)
  readonly erroreAttuale = computed(() => this.letturaAttuale().errore)
  readonly erroreNuovo = computed(() => this.letturaNuovo().errore)
  readonly provvigioneVuota = computed(() => this.provvigione().trim() === '')

  /** Niente da salvare con un errore nel campo, o con lo sconto attuale/nuovo vuoti. */
  readonly puoProseguire = computed(() => {
    if (this.azione() === 'PROVVIGIONE') return this.erroreProvvigione() === null
    return (
      this.erroreAttuale() === null &&
      this.erroreNuovo() === null &&
      this.letturaAttuale().valore !== null &&
      this.letturaNuovo().valore !== null
    )
  })

  readonly riepilogo = computed(() => {
    if (this.azione() === 'SCONTO') {
      return `Lo sconto ${this.scontoAttuale().trim()} diventa ${this.scontoNuovo().trim()} nelle righe che lo hanno.`
    }
    if (this.provvigioneVuota()) {
      return 'Provvigione e tipo vengono svuotati in tutte le righe senza prezzo speciale.'
    }
    const t = this.opzioniTipo.find(o => o.value === this.tipo())?.label.toLowerCase()
    return `Provvigione ${this.provvigione().trim()} % (${t}) su tutte le righe senza prezzo speciale.`
  })

  private richiesta?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) {
      this.richiesta?.unsubscribe()
      this.azione.set('PROVVIGIONE')
      this.provvigione.set('')
      this.tipo.set('SCONTATO')
      this.scontoAttuale.set('')
      this.scontoNuovo.set('')
      this.inConferma.set(false)
      this.inCorso.set(false)
      this.esito.set(null)
      this.errori.set([])
      this.backendProvvigione.set(null)
      this.backendAttuale.set(null)
      this.backendNuovo.set(null)
      this.conflitto.set(false)
    }
  }

  ngOnDestroy(): void {
    this.richiesta?.unsubscribe()
  }

  cambiaProvvigione(v: string): void {
    this.provvigione.set(v)
    this.backendProvvigione.set(null)
  }

  cambiaAttuale(v: string): void {
    this.scontoAttuale.set(v)
    this.backendAttuale.set(null)
  }

  cambiaNuovo(v: string): void {
    this.scontoNuovo.set(v)
    this.backendNuovo.set(null)
  }

  cambiaAzione(a: Azione): void {
    this.azione.set(a)
    this.errori.set([])
  }

  applica(): void {
    if (this.inCorso() || !this.inConferma() || !this.puoProseguire()) return
    this.inCorso.set(true)
    this.errori.set([])
    this.conflitto.set(false)
    const richiesta =
      this.azione() === 'PROVVIGIONE'
        ? this.servizio.azioni.provvigioni(
            this.contrattoId,
            this.provvigioneVuota()
              ? { provvigione: null, tipoProvvigione: null }
              : { provvigione: this.letturaProvvigione().valore, tipoProvvigione: this.tipo() }
          )
        : this.servizio.azioni.sconti(this.contrattoId, {
            scontoAttuale: this.letturaAttuale().valore ?? '',
            scontoNuovo: this.letturaNuovo().valore ?? '',
          })
    this.richiesta = richiesta.subscribe({
      next: r => {
        this.inCorso.set(false)
        this.inConferma.set(false)
        this.esito.set(r)
        this.applicata.emit(r)
      },
      error: err => {
        const e = leggiErroriAzione(err, "Impossibile applicare l'operazione.")
        this.inCorso.set(false)
        this.inConferma.set(false)
        this.backendProvvigione.set(null)
        this.backendAttuale.set(null)
        this.backendNuovo.set(null)
        const generali: string[] = []
        for (const c of e.campi) {
          if (c.campo === 'provvigione' || c.campo === 'tipoProvvigione') {
            this.backendProvvigione.set(c.messaggio)
          } else if (c.campo === 'scontoAttuale') this.backendAttuale.set(c.messaggio)
          else if (c.campo === 'scontoNuovo' || c.messaggio === MESSAGGIO_ENTRAMBI_SCONTI) {
            this.backendNuovo.set(c.messaggio)
          } else generali.push(c.messaggio)
        }
        this.errori.set(generali)
        this.conflitto.set(e.rilettura)
      },
    })
  }

  /** Passo di conferma: il focus passa al riepilogo, che il lettore di schermo annuncia. */
  vaiAConferma(): void {
    this.inConferma.set(true)
    focalizzaPasso('ps-conferma')
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.visibleChange.emit(false)
  }
}
