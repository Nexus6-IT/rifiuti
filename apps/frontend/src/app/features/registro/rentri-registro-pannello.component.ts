/**
 * Pannello RENTRI del registro e azioni per riga.
 *
 * Regole di presentazione:
 * - "Confermata" solo se l'annotazione è `TRASMESSA` o `GIA_SU_RENTRI` (`eConfermata`). Un invio
 *   in corso o in attesa dell'esito, o di esito ignoto, non si presenta mai come confermato.
 * - Il 202 di "Trasmetti" dice solo che l'invio è partito o in coda (`descrizioneAvvio`).
 * - Permessi (`puoConfigurare`, `puoTrasmettere`) dal backend, mai dal token.
 * - Gli errori del backend (già in italiano) si mostrano verbatim.
 */

import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'
import { ToastService } from '../../core/services/toast.service'
import {
  AllineamentoRentri,
  ElencoRegistriRentri,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
  RispostaAccodamento,
  messaggioErroreRentri,
} from './rentri-registro.service'
import { RentriRegistroImpostazioniDialogComponent } from './rentri-registro-impostazioni-dialog.component'
import {
  STATI_RENTRI,
  StatoRentri,
  descrizioneAvvio,
  descrizioneEsitoVerifica,
  eVerificabile,
  etichettaStatoRentri,
  severitaStatoRentri,
  tooltipStatoRentri,
} from './stato-rentri'

export interface TrasmissioneRentriRiga {
  stato: StatoRentri
  identificativo: string | null
  motivo: string | null
}

/** Cosa la pagina deve sapere dal pannello: se il registro è collegato e se si può trasmettere. */
export interface StatoPannelloRentri {
  collegato: boolean
  puoTrasmettere: boolean
}

const annotazioni = (n: number): string => (n === 1 ? '1 annotazione' : `${n} annotazioni`)

/** Esito di una risposta 202: avviso se qualcosa non è partito, informazione altrimenti. */
function notificaAccodamento(toast: ToastService, r: RispostaAccodamento): void {
  const testo = descrizioneAvvio(r.avvio, r.accodate)
  const saltate = r.saltate.map(s => `${s.motivo}: ${s.numero}`).join('; ')
  const completo = saltate ? `${testo} Non accodate: ${saltate}.` : testo
  if (r.avvio === 'AVVIATO') toast.info(completo)
  else toast.warn(completo)
}

// ─── Azioni e stato della singola riga ──────────────────────────────────────

@Component({
  selector: 'app-rentri-riga-azioni',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, TooltipModule],
  template: `
    <p-tag
      [value]="etichetta()"
      [severity]="severita()"
      [pTooltip]="tooltip()"
      styleClass="stato-tag"
      [attr.data-testid]="'rentri-stato-' + movimentoId"
    ></p-tag>
    <span class="sr-only" [attr.data-testid]="'rentri-motivo-' + movimentoId">{{ tooltip() }}</span>
    <small
      *ngIf="trasmissione?.stato === 'INCERTA'"
      class="rentri-riga-nota"
      [attr.data-testid]="'rentri-incerta-' + movimentoId"
      >Esito incerto: verificare.</small
    >

    <div class="rentri-riga-azioni" *ngIf="puoTrasmettere">
      <p-button
        *ngIf="verificabile()"
        label="Verifica"
        icon="pi pi-search"
        [text]="true"
        size="small"
        [loading]="occupato()"
        (onClick)="verifica()"
        [attr.data-testid]="'rentri-verifica-' + movimentoId"
        [ariaLabel]="'Verifica su RENTRI l\\'annotazione ' + numero"
      ></p-button>
      <p-button
        *ngIf="trasmissione?.stato === 'DA_TRASMETTERE'"
        label="Togli dalla coda"
        icon="pi pi-times"
        [text]="true"
        size="small"
        [loading]="occupato()"
        (onClick)="togli()"
        [attr.data-testid]="'rentri-togli-' + movimentoId"
        [ariaLabel]="'Togli dalla coda di invio l\\'annotazione ' + numero"
      ></p-button>
      <ng-container *ngIf="riprovabile()">
        <p-button
          *ngIf="!inConferma()"
          label="Trasmetti di nuovo"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="apriConferma()"
          [attr.data-testid]="'rentri-riprova-' + movimentoId"
          [ariaLabel]="'Trasmetti di nuovo a RENTRI l\\'annotazione ' + numero"
        ></p-button>
        <span
          *ngIf="inConferma()"
          role="group"
          (keydown.escape)="chiudiConferma()"
          [attr.aria-label]="'Conferma del nuovo invio dell\\'annotazione ' + numero"
          [attr.data-testid]="'rentri-riprova-conferma-' + movimentoId"
        >
          Trasmettere di nuovo la {{ numero }}?
          <p-button
            label="Sì"
            size="small"
            [loading]="occupato()"
            (onClick)="riprova()"
            [attr.data-testid]="'rentri-riprova-si-' + movimentoId"
            ariaLabel="Conferma il nuovo invio a RENTRI"
          ></p-button>
          <p-button
            label="No"
            [text]="true"
            size="small"
            (onClick)="chiudiConferma()"
            ariaLabel="Annulla il nuovo invio"
          ></p-button>
        </span>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .rentri-riga-azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
        align-items: center;
      }
      .rentri-riga-nota {
        display: block;
        color: var(--orange-700, #b45309);
      }
    `,
  ],
})
export class RentriRigaAzioniComponent {
  private readonly servizio = inject(RentriRegistroService)
  private readonly toast = inject(ToastService)
  private readonly host = inject(ElementRef<HTMLElement>)

  @Input({ required: true }) movimentoId!: string
  @Input() registroId: string | null = null
  /** Numero dell'annotazione per i testi ("2026/12"). */
  @Input() numero = ''
  @Input() trasmissione: TrasmissioneRentriRiga | null = null
  @Input() puoTrasmettere = false
  /** L'elenco va riletto (la riga è cambiata). */
  @Output() cambiato = new EventEmitter<void>()

  readonly occupato = signal(false)
  readonly inConferma = signal(false)

  etichetta = (): string => etichettaStatoRentri(this.trasmissione?.stato)
  severita = () => severitaStatoRentri(this.trasmissione?.stato)
  tooltip = (): string => tooltipStatoRentri(this.trasmissione?.stato, this.trasmissione?.motivo)
  verificabile = (): boolean => eVerificabile(this.trasmissione?.stato)
  riprovabile = (): boolean =>
    this.trasmissione?.stato === 'RIFIUTATA' || this.trasmissione?.stato === 'NON_TRASMISSIBILE'

  private focalizza(testid: string): void {
    setTimeout(() =>
      this.host.nativeElement
        .querySelector(`[data-testid="${testid}"] button, button[data-testid="${testid}"]`)
        ?.focus()
    )
  }

  apriConferma(): void {
    this.inConferma.set(true)
    this.focalizza('rentri-riprova-si-' + this.movimentoId)
  }

  /** Il focus torna sul pulsante che ha aperto la conferma. */
  chiudiConferma(): void {
    this.inConferma.set(false)
    this.focalizza('rentri-riprova-' + this.movimentoId)
  }

  verifica(): void {
    this.occupato.set(true)
    this.servizio.verifica(this.movimentoId).subscribe({
      next: esito => {
        this.occupato.set(false)
        const testo = descrizioneEsitoVerifica(esito)
        if (esito.stato === 'TRASMESSA' || esito.stato === 'GIA_SU_RENTRI') this.toast.info(testo)
        else this.toast.warn(testo)
        this.cambiato.emit()
      },
      error: err => {
        this.occupato.set(false)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }

  togli(): void {
    this.occupato.set(true)
    this.servizio.togliDallaCoda(this.movimentoId).subscribe({
      next: () => {
        this.occupato.set(false)
        this.toast.success("L'annotazione è stata tolta dalla coda di invio.")
        this.cambiato.emit()
      },
      error: err => {
        this.occupato.set(false)
        // 409 su annotazioni automatiche o di correzione: spiegazione del dominio, verbatim.
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }

  riprova(): void {
    if (!this.registroId) return
    this.occupato.set(true)
    this.servizio.trasmetti(this.registroId, [this.movimentoId]).subscribe({
      next: r => {
        this.occupato.set(false)
        this.inConferma.set(false)
        notificaAccodamento(this.toast, r)
        this.cambiato.emit()
      },
      error: err => {
        this.occupato.set(false)
        this.inConferma.set(false)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }
}

// ─── Pannello del registro ──────────────────────────────────────────────────

type TipoConferma = 'selezionati' | 'storico'

@Component({
  selector: 'app-rentri-registro-pannello',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    TagModule,
    RentriRegistroImpostazioniDialogComponent,
  ],
  template: `
    <section
      *ngIf="registro() as r"
      class="surface-card rentri-pannello"
      aria-labelledby="rentri-titolo"
      data-testid="rentri-pannello"
    >
      <h2 id="rentri-titolo" class="rentri-titolo">Trasmissione a RENTRI</h2>

      <p
        *ngIf="!r.identificativoRentri"
        class="rentri-non-collegato"
        data-testid="rentri-non-collegato"
      >
        Registro non collegato a RENTRI: inserisci l'identificativo preso dal portale.
        <span *ngIf="!puoConfigurare()">Lo imposta un amministratore dell'azienda.</span>
      </p>

      <ng-container *ngIf="r.identificativoRentri">
        <p data-testid="rentri-modalita">
          <ng-container *ngIf="r.invioAutomatico; else manuale">
            Invio <strong>automatico</strong> delle nuove annotazioni dal
            {{ r.invioAutomaticoDal | date: 'dd/MM/yyyy' }}. Lo storico precedente non parte da
            solo.
          </ng-container>
          <ng-template #manuale>
            Invio <strong>manuale</strong>: scegli le annotazioni nella tabella e premi «Trasmetti».
          </ng-template>
        </p>

        <p
          *ngIf="!r.haCertificato"
          class="field-error"
          role="status"
          data-testid="rentri-senza-certificato"
        >
          Manca il certificato RENTRI dell'azienda: le annotazioni restano in coda e non partono.
        </p>

        <ul class="rentri-conteggi" aria-label="Annotazioni per stato di trasmissione">
          <li *ngFor="let c of conteggi()" [attr.data-testid]="'rentri-conteggio-' + c.stato">
            {{ c.etichetta }}: <strong>{{ c.numero }}</strong>
          </li>
          <li data-testid="rentri-conteggio-mai">
            Non trasmesse: <strong>{{ r.nonTrasmessi }}</strong>
          </li>
        </ul>
      </ng-container>

      <div class="rentri-azioni">
        <p-button
          *ngIf="puoTrasmettere() && r.identificativoRentri"
          [label]="'Trasmetti selezionati (' + selezionati.length + ')'"
          icon="pi pi-send"
          [disabled]="selezionati.length === 0 || occupato()"
          (onClick)="chiedi('selezionati')"
          data-testid="rentri-trasmetti"
          ariaLabel="Trasmetti a RENTRI le annotazioni selezionate"
        ></p-button>
        <p-button
          *ngIf="puoConfigurare() && r.identificativoRentri"
          label="Trasmetti lo storico dell'anno…"
          icon="pi pi-history"
          [outlined]="true"
          [disabled]="occupato()"
          (onClick)="chiedi('storico')"
          data-testid="rentri-storico"
          ariaLabel="Trasmetti a RENTRI lo storico di un anno"
        ></p-button>
        <p-button
          *ngIf="r.identificativoRentri && puoTrasmettere()"
          label="Verifica allineamento"
          icon="pi pi-sync"
          [outlined]="true"
          [loading]="verificando()"
          (onClick)="verificaAllineamento()"
          data-testid="rentri-allineamento"
          ariaLabel="Confronta le annotazioni del registro con quelle presenti su RENTRI"
        ></p-button>
        <p-button
          *ngIf="puoConfigurare()"
          [label]="r.identificativoRentri ? 'Impostazioni RENTRI' : 'Collega a RENTRI'"
          icon="pi pi-cog"
          [text]="true"
          (onClick)="impostazioniVisibili = true"
          data-testid="rentri-impostazioni"
          ariaLabel="Apri le impostazioni RENTRI del registro"
        ></p-button>
      </div>

      <p *ngIf="allineamento() as a" role="status" data-testid="rentri-allineamento-esito">
        <ng-container *ngIf="a.suRentri !== null; else senzaRisposta">
          Anno {{ annoCorrente }}: nel registro {{ a.locali }}
          {{ a.locali === 1 ? 'annotazione' : 'annotazioni' }}, {{ a.trasmessi }} confermate o
          dichiarate già su RENTRI; su RENTRI ne risultano {{ a.suRentri }}.
          <strong *ngIf="a.suRentri !== a.trasmessi"
            >I numeri non coincidono: controlla sul portale.</strong
          >
        </ng-container>
        <ng-template #senzaRisposta>
          RENTRI non ha risposto: nel registro {{ a.locali }}
          {{ a.locali === 1 ? 'annotazione' : 'annotazioni' }}, {{ a.trasmessi }} confermate.
          Riprova fra poco.
        </ng-template>
      </p>

      <p class="rentri-nota" data-testid="rentri-nota-obbligo">
        L'obbligo di trasmettere il registro dipende dalla categoria dell'azienda (DM 59/2023):
        l'applicazione non lo verifica. Controlla sul portale RENTRI se ti riguarda.
      </p>
    </section>

    <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rentri-pannello-errore">
      {{ e }}
    </p>

    <!-- Conferma prima di inviare ------------------------------------------------>
    <p-dialog
      [visible]="conferma() !== null"
      (visibleChange)="!$event && annullaConferma()"
      [header]="
        conferma() === 'storico' ? 'Trasmetti lo storico dell\\'anno' : 'Trasmetti a RENTRI'
      "
      [modal]="true"
      [closable]="true"
      [closeOnEscape]="true"
      [style]="{ width: '520px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi senza trasmettere"
    >
      <div data-testid="rentri-conferma" aria-describedby="rentri-conferma-testo">
        <ng-container *ngIf="conferma() === 'storico'">
          <div class="field">
            <label id="rentri-storico-anno-label" for="rentri-storico-anno">Anno</label>
            <p-inputNumber
              [(ngModel)]="annoStorico"
              inputId="rentri-storico-anno"
              [useGrouping]="false"
              [min]="2000"
              [max]="2100"
              ariaLabelledBy="rentri-storico-anno-label"
            ></p-inputNumber>
          </div>
        </ng-container>
        <p id="rentri-conferma-testo">{{ testoConferma() }}</p>
        <p class="rentri-nota">
          Le annotazioni accettate da RENTRI non si possono ritirare: una correzione si trasmette
          poi come rettifica o annullamento.
        </p>
      </div>
      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="annullaConferma()"
          data-testid="rentri-conferma-no"
          ariaLabel="Non trasmettere"
        ></p-button>
        <p-button
          label="Trasmetti"
          icon="pi pi-send"
          [loading]="occupato()"
          [disabled]="numeroConferma() === 0 || !annoValido()"
          (onClick)="conferma_()"
          data-testid="rentri-conferma-si"
          ariaLabel="Conferma la trasmissione a RENTRI"
        ></p-button>
      </ng-template>
    </p-dialog>

    <app-rentri-registro-impostazioni-dialog
      *ngIf="impostazioniVisibili && registro() as r"
      [(visible)]="impostazioniVisibili"
      [registro]="r"
      [annoCorrente]="annoCorrente"
      (aggiornato)="dopoImpostazioni()"
    ></app-rentri-registro-impostazioni-dialog>
  `,
  styles: [
    `
      .rentri-pannello {
        padding: 1rem;
        margin-bottom: 1rem;
      }
      .rentri-titolo {
        margin: 0 0 0.5rem;
        font-size: 1.1rem;
      }
      .rentri-conteggi {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1.25rem;
        padding: 0;
        margin: 0.5rem 0;
        list-style: none;
      }
      .rentri-azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.75rem 0;
      }
      .rentri-nota {
        font-size: 0.85rem;
        color: var(--text-color-secondary, #6b7280);
      }
    `,
  ],
})
export class RentriRegistroPannelloComponent implements OnInit, OnChanges {
  private readonly servizio = inject(RentriRegistroService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) registroId!: string
  /** Annotazioni scelte nella tabella per "Trasmetti". */
  @Input() selezionati: string[] = []
  @Input() annoCorrente = new Date().getFullYear()
  /** Cambia quando la pagina ha modificato qualcosa (azione di riga): il pannello si rilegge. */
  @Input() aggiornamento = 0
  /** Qualcosa è cambiato sul backend: la pagina rilegge l'elenco e svuota la selezione. */
  @Output() aggiornato = new EventEmitter<void>()
  @Output() statoChange = new EventEmitter<StatoPannelloRentri>()

  private readonly elenco = signal<ElencoRegistriRentri | null>(null)
  readonly registro = computed<ImpostazioniRegistroRentri | null>(
    () => this.elenco()?.registri.find(r => r.registroId === this.registroId) ?? null
  )
  readonly puoConfigurare = computed(() => this.elenco()?.puoConfigurare === true)
  readonly puoTrasmettere = computed(() => this.elenco()?.puoTrasmettere === true)
  readonly errore = signal<string | null>(null)
  readonly occupato = signal(false)
  readonly verificando = signal(false)
  readonly allineamento = signal<AllineamentoRentri | null>(null)
  readonly conferma = signal<TipoConferma | null>(null)
  impostazioniVisibili = false
  annoStorico = this.annoCorrente

  readonly conteggi = computed(() => {
    const per = this.registro()?.perStato ?? {}
    return STATI_RENTRI.filter(s => (per[s] ?? 0) > 0).map(s => ({
      stato: s,
      etichetta: etichettaStatoRentri(s),
      numero: per[s] as number,
    }))
  })

  ngOnInit(): void {
    this.annoStorico = this.annoCorrente
    this.carica()
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['registroId'] && !changes['registroId'].firstChange) {
      // Nessun dato del registro precedente resta visibile mentre arriva quello nuovo.
      this.elenco.set(null)
      this.allineamento.set(null)
      this.statoChange.emit({ collegato: false, puoTrasmettere: false })
      this.carica()
    } else if (changes['aggiornamento'] && !changes['aggiornamento'].firstChange) {
      this.carica()
    }
  }

  carica(): void {
    this.servizio.registri().subscribe({
      next: e => {
        this.elenco.set(e)
        this.errore.set(null)
        const r = this.registro()
        this.statoChange.emit({
          collegato: !!r?.identificativoRentri,
          puoTrasmettere: e.puoTrasmettere,
        })
      },
      error: err => {
        this.elenco.set(null)
        this.errore.set(messaggioErroreRentri(err))
        this.statoChange.emit({ collegato: false, puoTrasmettere: false })
      },
    })
  }

  /** Le impostazioni o una dichiarazione sono cambiate: pannello ed elenco si rileggono. */
  dopoImpostazioni(): void {
    this.aggiornato.emit()
  }

  chiedi(tipo: TipoConferma): void {
    this.annoStorico = this.annoCorrente
    this.conferma.set(tipo)
  }

  annullaConferma(): void {
    this.conferma.set(null)
  }

  /** Quante annotazioni partiranno: le scelte, o (storico) al più quelle mai trasmesse. */
  annoValido(): boolean {
    if (this.conferma() !== 'storico') return true
    const a = this.annoStorico as number | null
    return a != null && Number.isInteger(a) && a >= 2000 && a <= 2100
  }

  numeroConferma(): number {
    return this.conferma() === 'storico'
      ? (this.registro()?.nonTrasmessi ?? 0)
      : this.selezionati.length
  }

  testoConferma(): string {
    const n = this.numeroConferma()
    if (this.conferma() === 'storico') {
      if (n === 0)
        return 'Non ci sono annotazioni da trasmettere: tutte sono già state trasmesse o messe in coda.'
      const parte = this.registro()?.haCertificato ? " L'invio parte subito." : ''
      return (
        `Il registro ha ${annotazioni(n)} mai trasmesse, in tutti gli anni. ` +
        `Partiranno quelle del ${this.annoStorico} (più eventuali annotazioni di anni precedenti ` +
        "corrette da queste); il numero esatto comparirà dopo l'avvio." +
        parte +
        ' Una volta accettate da RENTRI non si possono ritirare.'
      )
    }
    return (
      `Stai per trasmettere ${annotazioni(n)} a RENTRI. ` +
      'Una volta accettate da RENTRI non si possono ritirare.'
    )
  }

  conferma_(): void {
    const tipo = this.conferma()
    const r = this.registro()
    if (!tipo || !r) return
    this.occupato.set(true)
    const chiamata =
      tipo === 'storico'
        ? this.servizio.trasmettiStorico(r.registroId, this.annoStorico)
        : this.servizio.trasmetti(r.registroId, this.selezionati)
    chiamata.subscribe({
      next: risposta => {
        this.occupato.set(false)
        this.conferma.set(null)
        notificaAccodamento(this.toast, risposta)
        this.aggiornato.emit()
      },
      error: err => {
        this.occupato.set(false)
        this.conferma.set(null)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }

  verificaAllineamento(): void {
    this.verificando.set(true)
    this.servizio.allineamento(this.registroId, this.annoCorrente).subscribe({
      next: a => {
        this.verificando.set(false)
        this.allineamento.set(a)
      },
      error: err => {
        this.verificando.set(false)
        this.allineamento.set(null)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }
}
