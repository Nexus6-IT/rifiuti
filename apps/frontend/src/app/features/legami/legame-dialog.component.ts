import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { switchMap } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { TagModule } from 'primeng/tag'
import { LegamiService } from './legami.service'
import {
  LegameVista,
  ModificaRigaLegame,
  ModificheLegame,
  StatoLegame,
  VoceScelta,
} from './legami.model'
import {
  LEGAME_DA_RIALLINEARE,
  Ritocchi,
  aggiornaRitocchi,
  messaggiErroreLegame,
  righeConRitocchi,
  righeDaRitocchi,
} from './ritocchi-legame'
import { ModificaCampoRiga, RigheLegameTabellaComponent } from './righe-legame-tabella.component'
import { etichettaAvviso, etichettaMotivo, etichettaStato, severitaTag } from './vocabolario-legami'

/** Stati in cui il legame si può ancora cambiare (come il backend: gli altri sono sola lettura). */
export const STATI_MODIFICABILI: readonly StatoLegame[] = ['DA_COLLEGARE', 'PROPOSTO', 'CONFERMATO']

/**
 * Finestra di un legame esistente: cambia contratto ed elenco fra i candidati, ritocca quantità,
 * prezzo e sconto delle righe, poi «Salva» o «Conferma». I valori numerici seguono la regola unica
 * dei campi modificabili (`appNumeroIt`: virgola decimale, nessun separatore delle migliaia).
 * Solo OPERATOR/ADMIN modificano (`puoScrivere`) e solo negli stati modificabili.
 */
@Component({
  selector: 'app-legame-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    TagModule,
    RigheLegameTabellaComponent,
  ],
  template: `
    <p-dialog
      [visible]="!!corrente()"
      [modal]="true"
      [draggable]="false"
      [closable]="true"
      [style]="{ width: '56rem', maxWidth: '96vw' }"
      [header]="titolo()"
      (visibleChange)="$event ? null : chiudi()"
      data-testid="legame-dialog"
    >
      <ng-container *ngIf="corrente() as l">
        <p *ngIf="riepilogo" class="legame-riepilogo" data-testid="legame-riepilogo">
          {{ riepilogo }}
        </p>
        <div class="legame-testa">
          <p-tag
            [value]="statoEtichetta(l.stato)"
            [severity]="statoSeverita(l.stato)"
            data-testid="legame-stato"
          />
          <span *ngIf="l.cliente as c" class="legame-cliente" data-testid="legame-cliente">
            {{ c.etichetta }}
            <small *ngIf="c.fonte === 'FIR'">(da FIR)</small>
          </span>
          <span *ngIf="!l.cliente && l.dettaglioCliente" data-testid="legame-cliente-mancante">
            Cliente: {{ l.dettaglioCliente }}
          </span>
        </div>

        <p
          *ngIf="modificabile() && confermaBloccata()"
          class="field-error"
          data-testid="legame-conferma-bloccata"
          id="legame-conferma-bloccata"
        >
          Per confermare serve prima sistemare:
        </p>
        <ul *ngIf="l.motivi.length" class="legame-elenco" data-testid="legame-motivi">
          <li *ngFor="let m of l.motivi">{{ motivo(m) }}</li>
        </ul>
        <ul *ngIf="l.avvisi.length" class="legame-elenco" data-testid="legame-avvisi">
          <li *ngFor="let a of l.avvisi">{{ avviso(a) }}</li>
        </ul>

        <p *ngIf="!modificabile()" class="nota-pagina" data-testid="legame-sola-lettura">
          {{
            puoScrivere
              ? 'Nello stato attuale il legame non si può modificare.'
              : 'Solo gli operatori possono modificare il legame.'
          }}
        </p>

        <div class="legame-scelte">
          <div class="legame-campo" *ngIf="modificabile()">
            <label for="legame-cliente-scelta">Cliente da fatturare</label>
            <p-dropdown
              inputId="legame-cliente-scelta"
              [options]="opzioniClienti()"
              optionLabel="label"
              optionValue="value"
              [ngModel]="clienteId"
              (ngModelChange)="scegliCliente($event)"
              [filter]="true"
              filterBy="label"
              filterPlaceholder="Cerca per nome, codice o partita IVA"
              (onFilter)="cercaCliente.emit($event.filter ?? '')"
              placeholder="Scegli il cliente"
              styleClass="w-full"
              data-testid="legame-cliente-scelta"
            />
          </div>
          <div class="legame-campo">
            <label [attr.for]="menuContratto() ? 'legame-contratto' : null">Contratto</label>
            <p-dropdown
              *ngIf="menuContratto(); else contrattoTesto"
              inputId="legame-contratto"
              [options]="opzioniContratti()"
              optionLabel="etichetta"
              optionValue="id"
              [ngModel]="contrattoId"
              (ngModelChange)="contrattoId = $event; alCambioContratto()"
              [disabled]="clienteCambiato()"
              styleClass="w-full"
              data-testid="legame-contratto"
            />
            <ng-template #contrattoTesto>
              <span data-testid="legame-contratto-testo">{{ l.contratto?.etichetta ?? '—' }}</span>
            </ng-template>
          </div>
          <div class="legame-campo">
            <label [attr.for]="menuElenco() ? 'legame-elenco' : null">Elenco di addebiti</label>
            <p-dropdown
              *ngIf="menuElenco(); else elencoTesto"
              inputId="legame-elenco"
              [options]="opzioniElenchi()"
              optionLabel="etichetta"
              optionValue="id"
              [ngModel]="elencoId"
              (ngModelChange)="elencoId = $event; alCambioScelta()"
              [disabled]="clienteCambiato() || contrattoCambiato()"
              styleClass="w-full"
              data-testid="legame-elenco"
            />
            <ng-template #elencoTesto>
              <span data-testid="legame-elenco-testo">{{ l.elenco?.etichetta ?? '—' }}</span>
            </ng-template>
          </div>
        </div>
        <p
          *ngIf="scelteCambiate()"
          class="avviso-riquadro avviso-riquadro--warn"
          role="status"
          data-testid="legame-avviso-rigenera"
        >
          Cambiando cliente, contratto o elenco le righe si rigenerano dal listino quando salvi
          {{ haPrezzoManuale() ? ': i prezzi modificati a mano andranno persi' : '' }}.
        </p>

        <app-righe-legame-tabella
          [righe]="righeVista()"
          [modificabile]="righeModificabili()"
          [mostraIva]="true"
          [rimovibile]="righeModificabili()"
          [rimosse]="rimosse()"
          [generazione]="generazione()"
          (modifica)="alModifica($event)"
          (rimuovi)="alternaRimozione($event)"
          (erroriChange)="campiInErrore.set($event)"
        />

        <p
          *ngIf="righeModificabili() && senzaRighe()"
          class="field-error"
          role="alert"
          data-testid="legame-senza-righe"
        >
          Un legame deve avere almeno una riga.
        </p>

        <section
          *ngIf="righeModificabili() && (righeDisponibili().length || aggiunte.length)"
          class="legame-aggiunte"
          aria-label="Righe da aggiungere"
          data-testid="legame-aggiunte"
        >
          <ul *ngIf="aggiunte.length" class="legame-elenco">
            <li *ngFor="let r of aggiunte" data-testid="legame-aggiunta">
              {{ r.etichetta }}
              <p-button
                label="Togli"
                [text]="true"
                size="small"
                (onClick)="togliRiga(r)"
                [attr.data-testid]="'legame-togli-' + r.id"
              />
            </li>
          </ul>
          <div *ngIf="righeDisponibili().length" class="legame-campo">
            <label for="legame-riga-scelta">Aggiungi una riga dell'elenco</label>
            <p-dropdown
              inputId="legame-riga-scelta"
              [options]="righeDisponibili()"
              optionLabel="etichetta"
              optionValue="id"
              [(ngModel)]="rigaDaAggiungere"
              placeholder="Scegli la riga"
              styleClass="w-full"
              data-testid="legame-riga-scelta"
            />
            <p-button
              label="Aggiungi riga"
              icon="pi pi-plus"
              [outlined]="true"
              [disabled]="!rigaDaAggiungere"
              (onClick)="aggiungiRiga()"
              data-testid="legame-riga-aggiungi"
            />
          </div>
        </section>

        <p
          *ngIf="errori().length"
          class="avviso-riquadro avviso-riquadro--err"
          role="alert"
          data-testid="legame-errore"
        >
          <span *ngFor="let e of errori()">{{ e }} </span>
          <p-button
            *ngIf="serveRicarica()"
            label="Ricarica"
            icon="pi pi-refresh"
            [text]="true"
            size="small"
            (onClick)="ricarica()"
            data-testid="legame-ricarica"
          />
          <p-button
            *ngIf="serveRiallinea()"
            label="Riallinea"
            icon="pi pi-sync"
            [text]="true"
            size="small"
            [disabled]="inCorso()"
            (onClick)="riallinea()"
            data-testid="legame-riallinea"
          />
        </p>
      </ng-container>

      <ng-template pTemplate="footer">
        <p-button label="Chiudi" [text]="true" (onClick)="chiudi()" data-testid="legame-chiudi" />
        <p-button
          *ngIf="modificabile()"
          label="Salva"
          icon="pi pi-save"
          [outlined]="true"
          [disabled]="inCorso() || !valido()"
          (onClick)="salva()"
          data-testid="legame-salva"
        />
        <!-- Bottone nativo: <p-button> non inoltra aria-describedby al <button> interno. -->
        <button
          *ngIf="modificabile()"
          pButton
          type="button"
          label="Conferma"
          icon="pi pi-check"
          [disabled]="inCorso() || !valido() || confermaBloccata()"
          [loading]="inCorso()"
          [attr.aria-describedby]="confermaBloccata() ? 'legame-conferma-bloccata' : null"
          (click)="conferma()"
          data-testid="legame-conferma"
        ></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .legame-riepilogo {
        margin: 0 0 var(--spacing-sm);
        color: var(--text-secondary);
      }
      .legame-testa {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        align-items: center;
        margin-bottom: var(--spacing-md);
      }
      .legame-elenco {
        margin: 0 0 var(--spacing-md);
        padding-left: var(--spacing-lg);
      }
      .legame-scelte {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
      .legame-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .legame-aggiunte {
        margin-top: var(--spacing-md);
      }
    `,
  ],
})
export class LegameDialogComponent implements OnChanges {
  private readonly servizio = inject(LegamiService)

  /** Il legame da mostrare; `null` = finestra chiusa. Dopo «Ricarica» vale `corrente`. */
  @Input() legame: LegameVista | null = null
  @Input() puoScrivere = false
  /** Riga di riepilogo del movimento (data, CER, quantità), la compone la pagina che apre la finestra. */
  @Input() riepilogo: string | null = null
  /** Clienti scelti: li carica la pagina, con una ricerca sul server (`cercaCliente`). */
  @Input() clienti: { label: string; value: string }[] = []
  /** Testo digitato nel filtro del menu cliente: la pagina rilegge i clienti attivi che lo contengono. */
  @Output() cercaCliente = new EventEmitter<string>()
  /** Dopo un salvataggio o una conferma riusciti: il legame aggiornato. */
  @Output() aggiornato = new EventEmitter<{ legame: LegameVista; confermato: boolean }>()
  /** Dopo «Riallinea»: il legame è stato riscritto sul server, la lista va riletta alla chiusura. */
  @Output() riallineato = new EventEmitter<void>()
  @Output() chiuso = new EventEmitter<void>()

  /** Il legame in uso: parte da `legame` e si sostituisce con «Ricarica» (versione compresa). */
  readonly corrente = signal<LegameVista | null>(null)
  /** Ritocchi di quantità, prezzo e sconto non ancora salvati (emessi dalla tabella solo se validi). */
  private readonly ritocchi = signal<Ritocchi>({})
  /** Cambia a ogni nuovo caricamento: la tabella scorda errori e testi in corso. */
  readonly generazione = signal(0)
  /** Vero se un campo della tabella è in errore. */
  readonly campiInErrore = signal(false)
  clienteId: string | null = null
  contrattoId: string | null = null
  elencoId: string | null = null
  /** Righe dell'elenco aggiunte al legame (solo con le scelte invariate). */
  aggiunte: VoceScelta[] = []
  /** Righe del legame da togliere (`rimuovi: true`), solo con le scelte invariate. */
  readonly rimosse = signal<ReadonlySet<string>>(new Set())
  /** Cliente appena scelto: resta nel menu anche se la ricerca successiva non lo restituisce. */
  private clienteScelto: { label: string; value: string } | null = null
  rigaDaAggiungere: string | null = null
  readonly errori = signal<string[]>([])
  readonly serveRicarica = signal(false)
  /** Il backend dice che il legame è rimasto indietro rispetto al movimento: serve «Riallinea». */
  readonly serveRiallinea = signal(false)
  readonly inCorso = signal(false)

  readonly statoEtichetta = etichettaStato
  readonly statoSeverita = severitaTag
  readonly motivo = etichettaMotivo
  readonly avviso = etichettaAvviso

  ngOnChanges(c: SimpleChanges): void {
    if (c['legame']) {
      this.corrente.set(this.legame)
      this.carica(this.legame)
    }
  }

  private carica(l: LegameVista | null): void {
    this.errori.set([])
    this.serveRicarica.set(false)
    this.serveRiallinea.set(false)
    this.ritocchi.set({})
    this.campiInErrore.set(false)
    this.generazione.update(g => g + 1)
    this.clienteId = l?.cliente?.id ?? null
    this.contrattoId = l?.contratto?.id ?? null
    this.elencoId = l?.elenco?.id ?? null
    this.aggiunte = []
    this.rimosse.set(new Set())
    this.clienteScelto = null
    this.rigaDaAggiungere = null
  }

  /** Righe del legame con i ritocchi non ancora salvati (importo azzerato: lo calcola il server). */
  readonly righeVista = computed(() =>
    righeConRitocchi(this.corrente()?.righe ?? [], this.ritocchi())
  )

  alModifica(m: ModificaCampoRiga): void {
    const originale = this.corrente()?.righe.find(r => r.rigaAddebitoId === m.rigaAddebitoId)
    this.ritocchi.set(aggiornaRitocchi(this.ritocchi(), originale, m))
    this.errori.set([])
  }

  titolo(): string {
    return this.riepilogo
      ? `Legame del movimento del ${this.riepilogo.split(' · ')[0]}`
      : 'Legame del movimento'
  }

  menuContratto(): boolean {
    return this.modificabile() && this.opzioniContratti().length > 1
  }

  menuElenco(): boolean {
    return this.modificabile() && this.opzioniElenchi().length > 1
  }

  /**
   * Il server rifiuta la conferma finché ci sono motivi di incompletezza: se l'utente non ha
   * toccato nulla (nessuna scelta cambiata, nessuna riga ritoccata, aggiunta o tolta) il pulsante
   * resta spento invece di lasciar scoprire l'errore al clic. Appena cambia qualcosa i motivi
   * possono non valere più e il server decide.
   */
  confermaBloccata(): boolean {
    const l = this.corrente()
    if (!l || l.motivi.length === 0) return false
    // Senza cliente nessun altro ritocco basta: il server rifiuterebbe comunque la conferma.
    if (l.motivi.includes('SENZA_CLIENTE') && !this.clienteCambiato()) return true
    return this.modifiche() === undefined
  }

  modificabile(): boolean {
    const l = this.corrente()
    return this.puoScrivere && !!l && STATI_MODIFICABILI.includes(l.stato)
  }

  /** Le righe si ritoccano solo a scelte invariate: se cambiano, il server le rigenera. */
  righeModificabili(): boolean {
    return this.modificabile() && !this.scelteCambiate()
  }

  /** Clienti del menu, con quello attuale anche se non è fra i primi caricati. */
  opzioniClienti(): { label: string; value: string }[] {
    const attuale = this.corrente()?.cliente
    const extra = [
      ...(attuale ? [{ label: attuale.etichetta, value: attuale.id }] : []),
      ...(this.clienteScelto ? [this.clienteScelto] : []),
    ].filter(
      (x, i, tutti) =>
        !this.clienti.some(c => c.value === x.value) &&
        tutti.findIndex(y => y.value === x.value) === i
    )
    return [...extra, ...this.clienti]
  }

  opzioniContratti() {
    return this.corrente()?.candidati?.contratti ?? []
  }

  opzioniElenchi() {
    return this.corrente()?.candidati?.elenchi ?? []
  }

  /** Righe candidate non ancora nel legame né già scelte. */
  righeDisponibili(): VoceScelta[] {
    const gia = new Set([
      ...(this.corrente()?.righe ?? []).map(r => r.rigaAddebitoId),
      ...this.aggiunte.map(r => r.id),
    ])
    return (this.corrente()?.candidati?.righe ?? []).filter(r => !gia.has(r.id))
  }

  clienteCambiato(): boolean {
    return this.clienteId !== null && this.clienteId !== (this.corrente()?.cliente?.id ?? null)
  }

  contrattoCambiato(): boolean {
    return (
      !this.clienteCambiato() &&
      this.contrattoId !== null &&
      this.contrattoId !== (this.corrente()?.contratto?.id ?? null)
    )
  }

  elencoCambiato(): boolean {
    return (
      !this.clienteCambiato() &&
      !this.contrattoCambiato() &&
      this.elencoId !== null &&
      this.elencoId !== (this.corrente()?.elenco?.id ?? null)
    )
  }

  scelteCambiate(): boolean {
    return this.clienteCambiato() || this.contrattoCambiato() || this.elencoCambiato()
  }

  haPrezzoManuale(): boolean {
    return this.righeVista().some(r => r.prezzoManuale)
  }

  alternaRimozione(rigaAddebitoId: string): void {
    const n = new Set(this.rimosse())
    if (n.has(rigaAddebitoId)) n.delete(rigaAddebitoId)
    else n.add(rigaAddebitoId)
    this.rimosse.set(n)
    this.errori.set([])
  }

  /** Un legame deve avere almeno una riga (`RIGHE_VUOTE` del backend). */
  senzaRighe(): boolean {
    const righe = this.corrente()?.righe ?? []
    return (
      this.rimosse().size > 0 &&
      righe.every(r => this.rimosse().has(r.rigaAddebitoId)) &&
      this.aggiunte.length === 0
    )
  }

  /** Un campo non valido o nessuna riga bloccano i pulsanti (solo se le righe sono modificabili). */
  valido(): boolean {
    if (!this.righeModificabili()) return true
    return !this.senzaRighe() && !this.campiInErrore()
  }

  scegliCliente(id: string | null): void {
    this.clienteId = id
    this.clienteScelto = this.clienti.find(c => c.value === id) ?? this.clienteScelto
    this.alCambioCliente()
  }

  /** Nuovo cliente: contratto ed elenco si azzerano (i candidati erano del cliente vecchio). */
  alCambioCliente(): void {
    const l = this.corrente()
    const invariato = this.clienteId === (l?.cliente?.id ?? null)
    this.contrattoId = invariato ? (l?.contratto?.id ?? null) : null
    this.elencoId = invariato ? (l?.elenco?.id ?? null) : null
    this.alCambioScelta()
  }

  /** Nuovo contratto: l'elenco si azzera, il menu resta chiuso finché non si salva. */
  alCambioContratto(): void {
    const l = this.corrente()
    this.elencoId = this.contrattoId === (l?.contratto?.id ?? null) ? (l?.elenco?.id ?? null) : null
    this.alCambioScelta()
  }

  alCambioScelta(): void {
    this.errori.set([])
  }

  aggiungiRiga(): void {
    const r = this.righeDisponibili().find(x => x.id === this.rigaDaAggiungere)
    if (!r) return
    this.aggiunte = [...this.aggiunte, r]
    this.rigaDaAggiungere = null
  }

  togliRiga(r: VoceScelta): void {
    this.aggiunte = this.aggiunte.filter(x => x.id !== r.id)
  }

  /**
   * Cosa inviare. Se cambia il «capo» (cliente, contratto o elenco) il backend rigenera le righe
   * e tratta `righe` come selezione completa: si manda solo la scelta, mai le righe. A scelte
   * invariate `righe` è un ritocco: le righe toccate più quelle aggiunte.
   */
  modifiche(): ModificheLegame | undefined {
    if (!this.corrente()) return undefined
    if (this.clienteCambiato()) return { clienteId: this.clienteId! }
    if (this.contrattoCambiato()) return { contrattoId: this.contrattoId! }
    if (this.elencoCambiato()) return { elencoId: this.elencoId! }
    const rimosse = this.rimosse()
    const ritocchi = Object.fromEntries(
      Object.entries(this.ritocchi()).filter(([id]) => !rimosse.has(id))
    )
    const righe: ModificaRigaLegame[] = [
      ...righeDaRitocchi(ritocchi),
      ...[...rimosse].map(rigaAddebitoId => ({ rigaAddebitoId, rimuovi: true })),
      ...this.aggiunte.map(r => ({ rigaAddebitoId: r.id })),
    ]
    return righe.length ? { righe } : undefined
  }

  salva(): void {
    const l = this.corrente()
    if (!l) return
    this.esegui(
      this.servizio.modifica(l.id, { versione: l.versione, ...(this.modifiche() ?? {}) }),
      false
    )
  }

  conferma(): void {
    const l = this.corrente()
    if (!l) return
    const modifiche = this.modifiche()
    this.esegui(
      this.servizio.conferma(l.id, { versione: l.versione, ...(modifiche ? { modifiche } : {}) }),
      true
    )
  }

  /** Rilegge tutto il legame (versione, stato, candidati) e riparte dai suoi valori. */
  ricarica(): void {
    const l = this.corrente()
    if (!l) return
    this.servizio.dettaglio(l.id).subscribe({
      next: nuovo => {
        this.corrente.set(nuovo)
        this.carica(nuovo)
      },
      error: err => this.mostraErrore(err),
    })
  }

  /**
   * `LEGAME_DA_RIALLINEARE`: «Ricarica» non basta, serve riscrivere il legame sul movimento vigente
   * (`daMovimento`) e poi rileggerlo col `dettaglio` per avere anche i candidati, come all'apertura.
   */
  riallinea(): void {
    const l = this.corrente()
    if (!l || this.inCorso()) return
    this.inCorso.set(true)
    this.errori.set([])
    this.servizio
      .daMovimento(l.movimentoVigenteId)
      .pipe(switchMap(r => this.servizio.dettaglio(r.id)))
      .subscribe({
        next: nuovo => {
          this.inCorso.set(false)
          this.corrente.set(nuovo)
          this.carica(nuovo)
          this.riallineato.emit()
        },
        error: err => {
          this.inCorso.set(false)
          this.mostraErrore(err)
        },
      })
  }

  chiudi(): void {
    this.chiuso.emit()
  }

  private esegui(chiamata: ReturnType<LegamiService['modifica']>, confermato: boolean): void {
    this.inCorso.set(true)
    this.errori.set([])
    chiamata.subscribe({
      next: legame => {
        this.inCorso.set(false)
        this.aggiornato.emit({ legame, confermato })
      },
      error: err => {
        this.inCorso.set(false)
        this.mostraErrore(err)
      },
    })
  }

  private mostraErrore(err: unknown): void {
    const e = messaggiErroreLegame(err)
    this.errori.set(e.messaggi)
    this.serveRicarica.set(e.rilettura)
    this.serveRiallinea.set(e.codice === LEGAME_DA_RIALLINEARE)
  }
}
