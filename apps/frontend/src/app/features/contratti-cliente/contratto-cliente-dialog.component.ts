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
import { Router } from '@angular/router'
import { ConfirmationService } from 'primeng/api'
import { AccordionModule } from 'primeng/accordion'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { Subscription } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { Cliente, ContrattoCliente, PeriodoFatturazione } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { Opzione, OpzioniFatturazione } from '../clienti/opzioni-fatturazione'
import { TabelleFatturazioneService } from '../clienti/tabelle-fatturazione.service'
import { chiediConferma, messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { ETICHETTE_STATO_CONTRATTO } from '../clienti/vocabolario-clienti'
import { puoGestireAnagrafiche } from '../registry/registry-permissions'
import {
  CAMPI_DAL_CLIENTE,
  CampoForm,
  codiceDestinatarioVero,
  creaFormContratto,
  datiNuovo,
  differenze,
  valoriDaContratto,
} from './contratto-cliente-form'
import { AllegatiContrattoComponent } from './allegati-contratto.component'
import { formatNumero } from '../../shared/utils/numero-modificabile'
import { PeriodiFatturazioneComponent } from './periodi-fatturazione.component'
import { etichettaCliente } from './scelta-cliente.component'
import { CorrentiGenerali, SezioneDatiGeneraliComponent } from './sezione-dati-generali.component'
import { SEZIONE_CONTRATTO, SezioneContratto } from './sezione-contratto'
import { SezioneAltroComponent } from './sezione-altro.component'
import { SezionePagamentoComponent } from './sezione-pagamento.component'
import { SezionePaComponent } from './sezione-pa.component'
import { SezioneRinnovoSogliaComponent } from './sezione-rinnovo-soglia.component'

const NESSUNA_VOCE = '—'

/**
 * Nuovo contratto cliente o modifica. In una bozza tutti i campi sono modificabili; in un
 * contratto già attivo `modificabili` (dal backend) toglie numero, cliente e data di inizio, e un
 * contratto annullato non si modifica. Il frontend non replica le regole di dominio (D20): il
 * backend valida e il suo messaggio si mostra com'è. Sezioni in `p-accordion`: dati generali,
 * pagamento e fatturazione, pubblica amministrazione, rinnovo e soglia, periodi, altro (contratto
 * principale, commessa, annotazioni) e allegati PDF (solo per un contratto già salvato).
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
    ConfirmDialogModule,
    SezioneDatiGeneraliComponent,
    SezionePagamentoComponent,
    SezionePaComponent,
    SezioneRinnovoSogliaComponent,
    SezioneAltroComponent,
    AllegatiContrattoComponent,
    PeriodiFatturazioneComponent,
  ],
  providers: [ConfirmationService],
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
        <p-accordion [multiple]="true" [activeIndex]="[0, 1, 2, 3, 4, 5, 6]">
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
              [predefinitiDisattivati]="predefinitiDisattivati()"
              [segnalaErrore]="segnalaErrore"
            />
          </p-accordionTab>
          <p-accordionTab header="Pubblica amministrazione">
            <app-sezione-pa [form]="form" />
          </p-accordionTab>
          <p-accordionTab header="Rinnovo e soglia">
            <app-sezione-rinnovo-soglia [form]="form" />
          </p-accordionTab>
          <p-accordionTab header="Periodi di fatturazione">
            <app-periodi-fatturazione
              [periodi]="form.controls.periodi.value"
              [disabled]="form.controls.periodi.disabled"
              (periodiChange)="cambiaPeriodi($event)"
            />
          </p-accordionTab>
          <p-accordionTab header="Altro">
            <app-sezione-altro
              [form]="form"
              [contrattoId]="contratto?.id ?? null"
              [contrattiAllegati]="letto()?.allegati ?? 0"
              [principaleCorrente]="letto()?.contrattoPrincipale ?? null"
            />
          </p-accordionTab>
          <p-accordionTab header="Allegati PDF">
            <app-allegati-contratto
              [contrattoId]="contratto?.id ?? null"
              [soloLettura]="!puoScrivere()"
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
        <p-button
          *ngIf="contratto"
          label="Listino"
          icon="pi pi-list"
          [outlined]="true"
          (onClick)="apriListino()"
          data-testid="contratto-dlg-listino"
        />
        <small
          *ngIf="motivoSalvaBloccato() as m"
          role="status"
          class="field-hint"
          data-testid="contratto-dlg-salva-motivo"
          >{{ m }}</small
        >
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
    <p-confirmDialog />
  `,
})
export class ContrattoClienteDialogComponent implements OnChanges {
  private readonly servizio = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)
  private readonly conferma = inject(ConfirmationService)

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
  /** Campi il cui predefinito del cliente è una voce disattivata (R42): lasciati vuoti. */
  readonly predefinitiDisattivati = signal<ReadonlySet<CampoForm>>(new Set())
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

  /** Pagina del listino del contratto (4.2b): visibile anche al VIEWER, che lo legge soltanto. */
  apriListino(): void {
    const id = this.contratto?.id
    if (!id) return
    // Andare al listino chiude il dialog e scarta le modifiche non salvate: prima si chiede.
    if (this.form.dirty && this.puoScrivere()) {
      chiediConferma(
        this.conferma,
        'Ci sono modifiche non salvate al contratto: andando al listino andranno perse. Continuare?',
        () => this.vaiAlListino(id),
        { header: 'Modifiche non salvate', acceptLabel: 'Vai al listino' }
      )
      return
    }
    this.vaiAlListino(id)
  }

  private vaiAlListino(id: string): void {
    this.chiudi()
    void this.router.navigate(['/contratti-clienti', id, 'listino'])
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
    this.predefinitiDisattivati.set(new Set())
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
    // Il contratto principale era di un altro cliente (D28).
    this.form.controls.contrattoPrincipaleId.setValue('')
    this.precompila()
  }

  alFatturazioneScelta(c: Cliente | null): void {
    this.fatturazioneOpt.set(c ? { id: c.id, etichetta: etichettaCliente(c.ditta) } : null)
    this.fatturazioneScelta = c
    this.form.controls.clienteFatturazioneId.setValue(c?.id ?? '')
    this.form.controls.clienteFatturazioneId.markAsDirty()
    if (this.contratto) this.riallineaRecapitoSdi(c)
    else this.precompila()
  }

  /**
   * In modifica (R44): cambiando il cliente di fatturazione il recapito SDI segue il nuovo
   * intestatario, come fa il backend (che resta l'autorità). Si mostrano i valori nuovi così
   * l'operatore li vede; quelli che ha già toccato non si sovrascrivono.
   */
  private riallineaRecapitoSdi(c: Cliente | null): void {
    const sorgente = c ?? this.clienteScelto()
    if (!sorgente || this.bloccati().has('codiceDestinatario')) return
    const f = this.form.controls
    this.senzaTocco(() => {
      if (f.codiceDestinatario.pristine)
        f.codiceDestinatario.setValue(sorgente.codiceDestinatario ?? '')
      if (f.riferimentoAmministrazione.pristine) {
        f.riferimentoAmministrazione.setValue(
          codiceDestinatarioVero(f.codiceDestinatario.value)
            ? (sorgente.riferimentoAmministrazione ?? '')
            : ''
        )
      }
    })
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
    // Un predefinito lasciato vuoto perché disattivato (R42) torna ricalcolabile.
    // Solo se e' ancora vuoto: un valore scelto a mano dopo non si deve perdere.
    for (const campo of this.predefinitiDisattivati()) {
      if (f[campo].value === '') f[campo].markAsPristine()
    }
    const disattivati = new Set<CampoForm>()
    const imposta = (campo: CampoForm, valore: string): void => {
      const ctrl = f[campo]
      if (ctrl.pristine) this.senzaTocco(() => ctrl.setValue(valore as never))
    }
    // R42: un id che non è fra le voci attive non si scrive (il backend lo rifiuterebbe): il campo
    // resta vuoto e "toccato", così parte un null esplicito, e si avvisa l'operatore.
    const impostaTabella = (campo: CampoForm, id: string, attive: Opzione[]): void => {
      const disattivato = id !== '' && attive.length > 0 && !attive.some(o => o.id === id)
      if (!disattivato) return imposta(campo, id)
      if (f[campo].pristine) {
        this.senzaTocco(() => f[campo].setValue('' as never))
        f[campo].markAsDirty()
        disattivati.add(campo)
      }
    }
    impostaTabella(
      'condizionePagamentoId',
      c?.condizionePagamentoId ?? '',
      this.opzioni.opzCondizioni()
    )
    imposta('agenteId', c?.agenteId ?? '')
    impostaTabella('registroIvaId', c?.registroIvaId ?? '', this.opzioni.opzRegistri())
    impostaTabella('speseIncassoId', c?.speseIncassoId ?? '', this.opzioni.opzSpese())
    impostaTabella('bolloId', c?.bolloId ?? '', this.opzioni.opzBolli())
    imposta('esigibilitaIva', c?.esigibilitaIva ?? 'IMMEDIATA')
    imposta('ritenutaPercentuale', formatNumero(c?.ritenutaPercentuale))
    imposta('codiceDestinatario', sdi?.codiceDestinatario ?? '')
    imposta('riferimentoAmministrazione', sdi?.riferimentoAmministrazione ?? '')
    this.predefinitiDisattivati.set(disattivati)
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
    // Ritenuta e soglia con il punto o con testo errato: il form non si salva.
    if (this.form.invalid) return false
    return !this.contratto || this.letto() !== null
  }

  /** Perché «Salva» è spento quando la causa è nei campi (negli altri casi è ovvia). */
  motivoSalvaBloccato(): string | null {
    if (this.inCorso() || this.caricamento() || !this.puoScrivere()) return null
    return this.form.invalid
      ? 'Salva è disattivato: correggi i campi con errore (ritenuta e soglia vogliono la virgola per i decimali).'
      : null
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
