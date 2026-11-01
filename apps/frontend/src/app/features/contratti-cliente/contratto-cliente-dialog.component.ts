import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  QueryList,
  ViewChildren,
  inject,
  signal,
} from '@angular/core'
import { AbstractControl, ReactiveFormsModule } from '@angular/forms'
import { AccordionModule } from 'primeng/accordion'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { Cliente, ContrattoCliente, PeriodoFatturazione } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione, OpzioniFatturazione } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { ETICHETTE_STATO_CONTRATTO } from '../clienti/vocabolario-clienti'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import {
  CAMPI_DAL_CLIENTE,
  CampoForm,
  creaFormContratto,
  datiNuovo,
  differenze,
  valoriDaContratto,
} from './contratto-cliente-form'
import { PeriodiFatturazioneComponent } from './periodi-fatturazione.component'
import { etichettaCliente } from './scelta-cliente.component'
import { CorrentiGenerali, SezioneDatiGeneraliComponent } from './sezione-dati-generali.component'
import { SEZIONE_CONTRATTO, SezioneContratto } from './sezione-contratto'
import { SezionePagamentoComponent } from './sezione-pagamento.component'

const NESSUNA_VOCE = '—'

/**
 * Nuovo contratto cliente o modifica. In una bozza tutti i campi sono modificabili; in un
 * contratto già attivo `modificabili` (dal backend) toglie numero, cliente e data di inizio, e un
 * contratto annullato non si modifica. Il frontend non replica le regole di dominio (D20): il
 * backend valida e il suo messaggio si mostra com'è. Sezioni in `p-accordion`: dati generali,
 * pagamento e fatturazione, periodi (le altre le aggiunge il Task 26).
 */
@Component({
  selector: 'app-contratto-cliente-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    AccordionModule,
    SezioneDatiGeneraliComponent,
    SezionePagamentoComponent,
    PeriodiFatturazioneComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="contratto ? 'Modifica contratto' : 'Nuovo contratto'"
      [modal]="true"
      [style]="{ width: '60rem' }"
      [breakpoints]="{ '768px': '95vw' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <p class="stato" data-testid="contratto-dlg-stato">
        Stato: <strong>{{ etichettaStato() }}</strong>
      </p>
      <form (ngSubmit)="salva()">
        <p-accordion [multiple]="true" [activeIndex]="[0, 1, 2]">
          <p-accordionTab header="Dati generali">
            <app-sezione-dati-generali
              [form]="form"
              [visible]="visible"
              [puoScrivere]="puoScrivere()"
              [bloccati]="bloccati()"
              [clienteOpt]="clienteOpt()"
              [fatturazioneOpt]="fatturazioneOpt()"
              [dittaId]="dittaId()"
              [correnti]="correntiGenerali()"
              (clienteScelto)="alClienteScelto($event)"
              (fatturazioneScelta)="alFatturazioneScelta($event)"
              (errore)="errore.set($event)"
            />
          </p-accordionTab>
          <p-accordionTab header="Pagamento e fatturazione">
            <app-sezione-pagamento
              [form]="form"
              [opzioni]="opzioni"
              [visible]="visible"
              [puoScrivere]="puoScrivere()"
              [bloccati]="bloccati()"
              [testoCorrente]="letto()?.testoFatturazione ?? null"
              [contoVuoto]="contoVuoto()"
              [segnalaErrore]="segnalaErrore"
            />
          </p-accordionTab>
          <p-accordionTab header="Periodi di fatturazione">
            <app-periodi-fatturazione
              [periodi]="form.controls.periodi.value"
              [disabled]="form.controls.periodi.disabled"
              (periodiChange)="cambiaPeriodi($event)"
            />
          </p-accordionTab>
        </p-accordion>
        <p
          *ngIf="errore() as e"
          role="alert"
          class="field-error"
          data-testid="contratto-dlg-errore"
        >
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          *ngIf="puoScrivere()"
          label="Salva"
          icon="pi pi-check"
          [disabled]="!puoSalvare()"
          (onClick)="salva()"
          data-testid="contratto-dlg-salva"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class ContrattoClienteDialogComponent implements OnChanges {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly auth = inject(AuthService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() contratto: ContrattoCliente | null = null
  @Output() salvato = new EventEmitter<ContrattoCliente>()
  @Output() visibleChange = new EventEmitter<boolean>()

  /** Tutte le sezioni che si dichiarano con `SEZIONE_CONTRATTO`. */
  @ViewChildren(SEZIONE_CONTRATTO) private sezioni?: QueryList<SezioneContratto>

  readonly form = creaFormContratto()
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  readonly puoScrivere = () => puoGestireAnagrafiche(this.auth.currentUser()?.role)
  readonly segnalaErrore = (messaggio: string) => this.errore.set(messaggio)

  /** Il contratto letto dal server (in modifica): base dei confronti. */
  readonly letto = signal<ContrattoCliente | null>(null)
  /** Campi che il backend non lascia modificare in questo stato. */
  readonly bloccati = signal<ReadonlySet<string>>(new Set())
  readonly clienteOpt = signal<Opzione | null>(null)
  readonly fatturazioneOpt = signal<Opzione | null>(null)
  readonly dittaId = signal<string | null>(null)
  readonly correntiGenerali = signal<CorrentiGenerali | null>(null)
  /** Cliente e cliente di fatturazione scelti: i loro predefiniti (D4) e il conto "dal cliente". */
  private readonly clienteScelto = signal<Cliente | null>(null)
  private fatturazioneScelta: Cliente | null = null

  readonly etichettaStato = () => ETICHETTE_STATO_CONTRATTO[this.letto()?.stato ?? 'BOZZA']

  readonly contoVuoto = () => {
    const l = this.letto()
    const conto =
      this.clienteScelto()?.contoCorrente ??
      (l && !l.contoCorrente ? l.contoCorrenteEffettivo : null)
    return conto ? `dal cliente: ${conto.descrizione}` : NESSUNA_VOCE
  }

  readonly opzioni = new OpzioniFatturazione(
    this.tabelle,
    this.servizio,
    {
      condizione: this.form.controls.condizionePagamentoId,
      conto: this.form.controls.contoCorrenteId,
      spese: this.form.controls.speseIncassoId,
      bollo: this.form.controls.bolloId,
      registro: this.form.controls.registroIvaId,
      agente: this.form.controls.agenteId,
    },
    messaggio => this.toast.warn(messaggio, 'Registro IVA'),
    messaggio => this.errore.set(messaggio)
  )

  /** Vero mentre il dialog stesso scrive nel form: quei valori non contano come "toccati". */
  private applicando = false
  private versione = 0
  private lettura?: Subscription
  private letturaCliente?: Subscription
  private propostaNumero?: Subscription

  constructor() {
    // Un predefinito del cliente scritto da altri (autocomplete, "Nuovo …" in linea) è una
    // scelta dell'operatore quanto uno digitato: non lo si sovrascrive più.
    for (const campo of CAMPI_DAL_CLIENTE) {
      const ctrl: AbstractControl = this.form.controls[campo]
      ctrl.valueChanges.subscribe(() => {
        if (!this.applicando) ctrl.markAsDirty()
      })
    }
  }

  /** Scrive nel form senza segnare i campi come toccati. */
  private senzaTocco(scrivi: () => void): void {
    this.applicando = true
    try {
      scrivi()
    } finally {
      this.applicando = false
    }
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private azzera(): void {
    this.lettura?.unsubscribe()
    this.letturaCliente?.unsubscribe()
    this.propostaNumero?.unsubscribe()
    this.opzioni.azzera()
    this.form.enable({ emitEvent: false })
    this.senzaTocco(() => this.form.reset({ esigibilitaIva: 'IMMEDIATA', periodi: [] }))
    this.errore.set(null)
    this.inCorso.set(false)
    this.caricamento.set(false)
    this.letto.set(null)
    this.bloccati.set(new Set())
    this.clienteOpt.set(null)
    this.fatturazioneOpt.set(null)
    this.dittaId.set(null)
    this.correntiGenerali.set(null)
    this.clienteScelto.set(null)
    this.fatturazioneScelta = null
    if (!this.puoScrivere()) this.form.disable({ emitEvent: false })
  }

  private inizializza(): void {
    this.azzera()
    this.opzioni.carica()
    const c = this.contratto
    this.versione = c?.versione ?? 0
    if (!c) {
      this.proponiNumero()
      return
    }
    this.caricamento.set(true)
    this.lettura = this.servizio.contratti.get(c.id).subscribe({
      next: d => this.applicaLetto(d),
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile caricare il contratto.'))
      },
    })
  }

  /** Il numero proposto è informativo (D12): non sovrascrive quello già digitato. */
  private proponiNumero(): void {
    this.propostaNumero = this.servizio.contratti.prossimoNumero().subscribe({
      next: n => {
        if (this.form.controls.numero.pristine) this.form.controls.numero.setValue(n)
      },
      error: () => undefined,
    })
  }

  private applicaLetto(d: ContrattoCliente): void {
    this.letto.set(d)
    this.versione = d.versione
    this.form.enable({ emitEvent: false })
    this.senzaTocco(() => this.form.reset(valoriDaContratto(d)))
    const bloccati = (Object.keys(this.form.controls) as CampoForm[]).filter(
      k => !d.modificabili.includes(k)
    )
    this.bloccati.set(new Set(bloccati))
    for (const k of bloccati) this.form.controls[k].disable({ emitEvent: false })
    if (!this.puoScrivere()) this.form.disable({ emitEvent: false })
    this.opzioni.impostaCorrenti(d)
    this.clienteOpt.set({ id: d.cliente.id, etichetta: etichettaCliente(d.cliente) })
    this.fatturazioneOpt.set(
      d.clienteFatturazione
        ? { id: d.clienteFatturazione.id, etichetta: etichettaCliente(d.clienteFatturazione) }
        : null
    )
    this.correntiGenerali.set({ categoria: d.categoria, tipo: d.tipo, sede: d.sede })
    this.caricamento.set(false)
    // Il cliente intero serve per le sedi (la ditta) e per il conto "dal cliente": se manca, il
    // resto del contratto si modifica lo stesso.
    this.letturaCliente = this.servizio.clienti.get(d.clienteId).subscribe({
      next: cl => {
        this.clienteScelto.set(cl)
        this.dittaId.set(cl.ditta.id)
      },
      error: () => undefined,
    })
  }

  // ─── Scelta del cliente: predefiniti (D4) ────────────────────────────────

  alClienteScelto(c: Cliente | null): void {
    // La lettura del cliente precedente non deve più riportare la sua ditta e le sue sedi.
    this.letturaCliente?.unsubscribe()
    this.clienteOpt.set(c ? { id: c.id, etichetta: etichettaCliente(c.ditta) } : null)
    this.clienteScelto.set(c)
    this.dittaId.set(c?.ditta.id ?? null)
    this.form.controls.clienteId.setValue(c?.id ?? '')
    this.form.controls.clienteId.markAsDirty()
    // La sede era di un'altra ditta.
    this.form.controls.sedeId.setValue('')
    this.precompila()
  }

  alFatturazioneScelta(c: Cliente | null): void {
    this.fatturazioneOpt.set(c ? { id: c.id, etichetta: etichettaCliente(c.ditta) } : null)
    this.fatturazioneScelta = c
    this.form.controls.clienteFatturazioneId.setValue(c?.id ?? '')
    this.form.controls.clienteFatturazioneId.markAsDirty()
    this.precompila()
  }

  /**
   * Solo in creazione: i campi che il backend copia dal cliente (codice destinatario e
   * riferimento dal cliente di fatturazione, se c'è, R35) si mostrano precompilati, a meno che
   * l'operatore non li abbia già toccati.
   */
  private precompila(): void {
    if (this.contratto) return
    const c = this.clienteScelto()
    const sdi = this.fatturazioneScelta ?? c
    const f = this.form.controls
    const imposta = (campo: CampoForm, valore: string): void => {
      const ctrl = f[campo]
      if (ctrl.pristine) this.senzaTocco(() => ctrl.setValue(valore as never))
    }
    imposta('condizionePagamentoId', c?.condizionePagamentoId ?? '')
    imposta('agenteId', c?.agenteId ?? '')
    imposta('registroIvaId', c?.registroIvaId ?? '')
    imposta('speseIncassoId', c?.speseIncassoId ?? '')
    imposta('bolloId', c?.bolloId ?? '')
    imposta('esigibilitaIva', c?.esigibilitaIva ?? 'IMMEDIATA')
    imposta('ritenutaPercentuale', c?.ritenutaPercentuale ?? '')
    imposta('codiceDestinatario', sdi?.codiceDestinatario ?? '')
    imposta('riferimentoAmministrazione', sdi?.riferimentoAmministrazione ?? '')
    if (f.agenteId.pristine) {
      this.opzioni.agenteSelezionato = c?.agente
        ? { id: c.agente.id, etichetta: c.agente.descrizione }
        : null
    }
  }

  cambiaPeriodi(periodi: PeriodoFatturazione[]): void {
    this.form.controls.periodi.setValue(periodi)
    this.form.controls.periodi.markAsDirty()
  }

  // ─── Salvataggio ─────────────────────────────────────────────────────────

  /** In modifica serve il record letto (altrimenti il form vuoto cancellerebbe i dati). */
  puoSalvare(): boolean {
    if (this.inCorso() || this.caricamento() || !this.puoScrivere()) return false
    return !this.contratto || this.letto() !== null
  }

  /**
   * Esc nel sub-dialog (o nel dialog del cliente aperto in linea) chiude anche questo (PrimeNG
   * chiude ogni dialog aperto): si ignora, o si perde il form compilato.
   */
  alCambioVisibilita(visibile: boolean): void {
    if (!visibile && this.sezioni?.some(s => s.bloccaChiusuraEsterna(visibile))) return
    if (!visibile) this.chiudi()
  }

  salva(): void {
    if (!this.puoSalvare()) return
    const durata = this.form.controls.validitaQuantita.value.trim()
    if (durata !== '' && !/^\d+$/.test(durata)) {
      this.errore.set('La durata della validità deve essere un numero intero.')
      return
    }
    if (this.contratto) this.salvaModifica(this.contratto)
    else this.salvaNuovo()
  }

  private salvaNuovo(): void {
    const toccati = new Set<CampoForm>(
      CAMPI_DAL_CLIENTE.filter(campo => this.form.controls[campo].dirty)
    )
    const dati = datiNuovo(this.form.getRawValue(), toccati)
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.contratti.crea(dati).subscribe({
      next: creato => {
        this.inCorso.set(false)
        this.salvato.emit(creato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il contratto.'))
      },
    })
  }

  private salvaModifica(c: ContrattoCliente): void {
    const base = this.letto() ?? c
    const dati = differenze(this.form.getRawValue(), base, this.versione)
    if (Object.keys(dati).length === 1) {
      this.toast.info('Nessuna modifica da salvare.', 'Contratto')
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.contratti.modifica(c.id, dati).subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        const messaggio = messaggioErrore(err, 'Impossibile salvare il contratto.')
        const codice = String((err as { error?: { error?: unknown } })?.error?.error ?? '')
        if (
          (err as { status?: number })?.status === 409 &&
          codice.endsWith('MODIFICATO_NEL_FRATTEMPO')
        ) {
          // Il record è cambiato: avviso, e il genitore lo rilegge.
          this.toast.error(messaggio, 'Contratto')
          this.salvato.emit(base)
          this.chiudi()
          return
        }
        this.errore.set(messaggio)
      },
    })
  }

  chiudi(): void {
    this.azzera()
    this.visibleChange.emit(false)
  }
}
