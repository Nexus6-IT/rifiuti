/**
 * Seconda pesata manuale di un accesso aperto (il mezzo esce dall'impianto).
 *
 * La chiave di idempotenza e' quella del form, creata all'apertura: un doppio clic o un nuovo
 * invio dopo un errore di rete non registrano due pesate. Un 409 (l'accesso non e' piu'
 * aperto, memoria alibi gia' usata) si mostra testuale e chiede al chiamante di rileggere
 * l'accesso (`ricarica`).
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
  inject,
  signal,
} from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { messaggioErrorePese, uuidV4 } from './pese-formato'
import { haStrumentoConAgente } from './letture-strumento.component'
import { SorgentePesata, SorgentePesataComponent } from './sorgente-pesata.component'
import { STILI_PESE } from './pese-stili'
import { PesataManualeFormComponent } from './pesata-manuale-form.component'
import { AccessoVista, AgenteVista, PeseService, StrumentoPesa } from './pese.service'

@Component({
  selector: 'app-seconda-pesata-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    DialogModule,
    PesataManualeFormComponent,
    SorgentePesataComponent,
  ],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      [header]="'Seconda pesata — accesso ' + accesso.numero"
      [modal]="true"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra della seconda pesata"
      (onShow)="mettiAFuoco()"
    >
      <app-sorgente-pesata
        idPrefisso="sp-src"
        [sorgente]="sorgente()"
        [registroId]="accesso.registro.id"
        (sorgenteChange)="cambiaSorgente($event)"
        (letturaScelta)="lettura.set($event)"
      ></app-sorgente-pesata>
      <p *ngIf="erroreLettura()" class="field-error" role="alert" data-testid="sp-lettura-errore">
        Scegliere una lettura dello strumento.
      </p>
      <div [hidden]="sorgente() === 'STRUMENTO'">
        <app-pesata-manuale-form
          idPrefisso="sp"
          etichettaPeso="Seconda pesata (kg)"
          [strumenti]="strumentiAttivi()"
        ></app-pesata-manuale-form>
      </div>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="sp-errore">{{ e }}</p>
      <div class="azioni">
        <p-button label="Annulla" [text]="true" (onClick)="chiuso.emit()"></p-button>
        <p-button
          label="Salva"
          icon="pi pi-check"
          [loading]="salvataggio()"
          [disabled]="salvataggio()"
          (onClick)="salva()"
          data-testid="sp-salva"
          ariaLabel="Salva la seconda pesata"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [STILI_PESE],
})
export class SecondaPesataDialogComponent implements OnInit {
  private readonly pese = inject(PeseService)

  @Input({ required: true }) accesso!: AccessoVista
  @Input() strumenti: StrumentoPesa[] = []
  /** Agenti di pesa dell'azienda: decidono se il predefinito e' «Da strumento». */
  @Input() agenti: AgenteVista[] = []
  @Output() fatto = new EventEmitter<AccessoVista>()
  @Output() chiuso = new EventEmitter<void>()
  /** Il backend ha risposto 409: l'accesso va riletto. */
  @Output() ricarica = new EventEmitter<void>()

  @ViewChild(PesataManualeFormComponent) form?: PesataManualeFormComponent

  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  readonly strumentiAttivi = signal<StrumentoPesa[]>([])
  readonly sorgente = signal<SorgentePesata>('MANUALE')
  readonly lettura = signal<string | null>(null)
  readonly tentato = signal(false)
  private readonly chiaveLettura = uuidV4()

  ngOnInit(): void {
    this.sorgente.set(
      haStrumentoConAgente(this.agenti, this.accesso.registro.id) ? 'STRUMENTO' : 'MANUALE'
    )
    this.strumentiAttivi.set(
      this.strumenti.filter(
        s => s.attivo && (!s.registroId || s.registroId === this.accesso.registro.id)
      )
    )
  }

  cambiaSorgente(s: SorgentePesata): void {
    this.sorgente.set(s)
    this.lettura.set(null)
  }

  erroreLettura(): boolean {
    return this.tentato() && this.sorgente() === 'STRUMENTO' && !this.lettura()
  }

  mettiAFuoco(): void {
    setTimeout(() => document.getElementById('sp-peso')?.focus())
  }

  salva(): void {
    if (this.salvataggio() || !this.form) return
    this.tentato.set(true)
    const daStrumento = this.sorgente() === 'STRUMENTO'
    const r = daStrumento ? null : this.form.raccogli()
    const letturaId = this.lettura()
    if (daStrumento ? !letturaId : !r) return
    this.errore.set(null)
    this.salvataggio.set(true)
    this.pese
      .secondaPesata(
        this.accesso.id,
        daStrumento
          ? { chiaveIdempotenza: this.chiaveLettura, pesata: { letturaId: letturaId! } }
          : { chiaveIdempotenza: this.form.chiaveIdempotenza, pesata: r!.pesata },
        daStrumento ? null : r!.allegato,
        daStrumento ? undefined : r!.nomeFile
      )
      .subscribe({
        next: a => {
          this.salvataggio.set(false)
          this.fatto.emit(a)
        },
        error: err => {
          this.salvataggio.set(false)
          this.errore.set(
            messaggioErrorePese(err, 'Registrazione della seconda pesata non riuscita.')
          )
          if (err?.status === 409) this.ricarica.emit()
        },
      })
  }
}
