import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { Subject, catchError, debounce, map, merge, of, switchMap, timer } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import {
  AvvisoLegame,
  DatiLegameRegistrazione,
  DatiProposta,
  PropostaLegame,
  RigaLegame,
  RigaLegameRegistrazione,
} from './legami.model'
import { LegamiService } from './legami.service'
import { permessiLegami } from './permessi-legami'
import {
  CampoRiga,
  ModificaCampoRiga,
  RigheLegameTabellaComponent,
} from './righe-legame-tabella.component'
import { etichettaAvviso, etichettaMotivo } from './vocabolario-legami'

/** Scelte dell'utente sul legame: sono le `scelte` della richiesta di proposta (senza le righe). */
export type SceltaLegame = Omit<NonNullable<DatiProposta['scelte']>, 'righe'>

/** Dati del movimento che il blocco usa per chiedere la proposta (tutto tranne `scelte`). */
export type DatiMovimentoLegame = Omit<DatiProposta, 'scelte'>

/** Attesa prima di chiedere una nuova proposta dopo una modifica dei dati del movimento. */
export const ATTESA_PROPOSTA_MS = 400

export const MESSAGGIO_PROPOSTA_NON_DISPONIBILE =
  'La proposta di fatturazione non è disponibile adesso. Puoi registrare il movimento: lo troverai in «Da collegare».'

type Modifiche = Partial<Record<CampoRiga, string | null>>

/**
 * Blocco «Fatturazione» del form di registrazione (spec §7.1, §8.2). Chiede la proposta di
 * legame al listino (sola lettura) e mostra cliente, contratto, elenco, righe con quantità,
 * prezzo e sconto modificabili, motivi e avvisi. Emette `legameChange` con il blocco `legame`
 * da mettere nella registrazione (null = nessun blocco).
 *
 * Due scelte alla registrazione, come pulsanti a commutazione: «Registra senza collegare»
 * (azione PROPOSTA, predefinita: nessuna conferma automatica) e «Conferma legame» (azione
 * CONFERMA, ammessa solo con una proposta completa).
 *
 * Riusabile dalla rettifica (Task 27): stessi `datiMovimento`, `scelta` e `legameChange`.
 */
@Component({
  selector: 'app-blocco-fatturazione',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, RigheLegameTabellaComponent],
  template: `
    <section
      *ngIf="visibile()"
      class="blocco-fatturazione"
      aria-labelledby="blocco-fatt-titolo"
      data-testid="blocco-fatturazione"
      [attr.aria-busy]="caricamento() ? 'true' : null"
    >
      <h3 id="blocco-fatt-titolo" class="blocco-titolo">Fatturazione</h3>

      <p
        *ngIf="erroreProposta()"
        class="avviso avviso-warn"
        role="alert"
        data-testid="fatt-errore-proposta"
      >
        {{ messaggioNonDisponibile }}
      </p>

      <ng-container *ngIf="proposta() as p">
        <p *ngIf="caricamento()" role="status" class="aggiornamento">Aggiorno la proposta…</p>

        <dl class="dati-legame">
          <div>
            <dt>Cliente</dt>
            <dd data-testid="fatt-cliente">
              <ng-container *ngIf="p.cliente; else senzaCliente">
                {{ p.cliente.etichetta }}
                <p-tag
                  *ngIf="p.cliente.fonte === 'FIR'"
                  severity="info"
                  value="da FIR"
                  data-testid="fatt-da-fir"
                ></p-tag>
              </ng-container>
              <ng-template #senzaCliente>
                <span>Nessun cliente</span>
                <small *ngIf="p.dettaglioCliente"> ({{ p.dettaglioCliente }})</small>
              </ng-template>
            </dd>
          </div>

          <div>
            <dt><label for="fatt-contratto">Contratto</label></dt>
            <dd>
              <select
                *ngIf="mostraMenuContratti(p); else soloContratto"
                id="fatt-contratto"
                class="p-inputtext p-component menu-legame"
                data-testid="fatt-contratto-menu"
                (change)="scegli('contrattoId', $any($event.target))"
              >
                <option value="" [selected]="!p.contratto">Scegli un contratto</option>
                <option
                  *ngFor="let c of p.candidati.contratti"
                  [value]="c.id"
                  [selected]="c.id === p.contratto?.id"
                >
                  {{ c.etichetta }}
                </option>
              </select>
              <ng-template #soloContratto>
                <span data-testid="fatt-contratto">{{ p.contratto?.etichetta ?? '—' }}</span>
              </ng-template>
            </dd>
          </div>

          <div>
            <dt><label for="fatt-elenco">Elenco di addebiti</label></dt>
            <dd>
              <select
                *ngIf="mostraMenuElenchi(p); else soloElenco"
                id="fatt-elenco"
                class="p-inputtext p-component menu-legame"
                data-testid="fatt-elenco-menu"
                (change)="scegli('elencoId', $any($event.target))"
              >
                <option value="" [selected]="!p.elenco">Scegli un elenco</option>
                <option
                  *ngFor="let e of p.candidati.elenchi"
                  [value]="e.id"
                  [selected]="e.id === p.elenco?.id"
                >
                  {{ e.etichetta }}
                </option>
              </select>
              <ng-template #soloElenco>
                <span data-testid="fatt-elenco">{{ p.elenco?.etichetta ?? '—' }}</span>
              </ng-template>
            </dd>
          </div>
        </dl>

        <div
          *ngIf="cambioInSospeso() as c"
          class="avviso avviso-warn"
          role="alert"
          data-testid="fatt-cambio-avviso"
        >
          <p>
            Cambiando {{ c.tipo === 'contrattoId' ? 'il contratto' : "l'elenco" }} le righe vengono
            rigenerate e i prezzi e gli sconti scritti a mano andranno persi.
          </p>
          <button
            pButton
            type="button"
            label="Cambia comunque"
            class="p-button-sm"
            data-testid="fatt-cambio-conferma"
            (click)="confermaCambio()"
          ></button>
          <button
            pButton
            type="button"
            label="Annulla"
            class="p-button-sm p-button-text"
            data-testid="fatt-cambio-annulla"
            (click)="annullaCambio()"
          ></button>
        </div>

        <ul *ngIf="p.motivi.length" class="elenco-avvisi" data-testid="fatt-motivi">
          <li *ngFor="let m of p.motivi" class="avviso avviso-warn">{{ motivo(m) }}</li>
        </ul>

        <ul *ngIf="avvisi().length" class="elenco-avvisi" data-testid="fatt-avvisi">
          <li
            *ngFor="let a of avvisi()"
            class="avviso avviso-warn"
            [attr.data-testid]="'fatt-avviso-' + a"
          >
            {{ avviso(a) }}
          </li>
        </ul>

        <app-righe-legame-tabella
          [righe]="righeVista()"
          [modificabile]="true"
          (modifica)="alModifica($event)"
          (erroriChange)="alErrori($event)"
        ></app-righe-legame-tabella>

        <div
          class="azioni-legame"
          role="group"
          aria-label="Cosa fare con il legame alla registrazione"
        >
          <button
            pButton
            type="button"
            label="Conferma legame"
            icon="pi pi-check"
            data-testid="fatt-conferma"
            [class.p-button-outlined]="modo() !== 'CONFERMA'"
            [attr.aria-pressed]="modo() === 'CONFERMA'"
            [disabled]="!puoConfermare()"
            (click)="imposta('CONFERMA')"
          ></button>
          <button
            pButton
            type="button"
            label="Registra senza collegare"
            data-testid="fatt-senza-collegare"
            [class.p-button-outlined]="modo() !== 'PROPOSTA'"
            [attr.aria-pressed]="modo() === 'PROPOSTA'"
            (click)="imposta('PROPOSTA')"
          ></button>
        </div>
        <small class="aiuto" data-testid="fatt-aiuto">
          {{
            modo() === 'CONFERMA'
              ? 'Alla registrazione il movimento viene collegato al listino con questi valori.'
              : 'Il movimento resta «proposto»: potrai confermarlo dopo da «Da collegare».'
          }}
        </small>
      </ng-container>
    </section>
  `,
  styles: [
    `
      .blocco-fatturazione {
        margin-top: 1rem;
      }
      .blocco-titolo {
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 0 0 0.5rem;
      }
      .dati-legame {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: 0.5rem 1rem;
        margin: 0 0 0.75rem;
      }
      .dati-legame dt {
        font-size: 0.8rem;
        color: var(--text-color-secondary, #6b7280);
      }
      .dati-legame dd {
        margin: 0;
      }
      .menu-legame {
        width: 100%;
      }
      .elenco-avvisi {
        list-style: none;
        padding: 0;
        margin: 0 0 0.75rem;
      }
      .avviso {
        margin: 0.25rem 0;
        padding: 0.4rem 0.6rem;
        border-radius: 6px;
      }
      .avviso-warn {
        background: var(--color-warning-bg, #fef3c7);
        border: 1px solid var(--color-warning, #b45309);
        color: var(--color-warning, #92400e);
      }
      .azioni-legame {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }
      .aiuto {
        display: block;
        margin-top: 0.35rem;
        color: var(--text-color-secondary, #6b7280);
      }
    `,
  ],
})
export class BloccoFatturazioneComponent implements OnChanges {
  private readonly servizio = inject(LegamiService)
  private readonly auth = inject(AuthService)
  private readonly destroyRef = inject(DestroyRef)

  /** Dati del movimento in compilazione; `null` finché mancano i campi obbligatori. */
  @Input() set datiMovimento(v: DatiMovimentoLegame | null) {
    this.dati.set(v)
  }
  get datiMovimento(): DatiMovimentoLegame | null {
    return this.dati()
  }
  private readonly dati = signal<DatiMovimentoLegame | null>(null)
  /** Scelte dell'utente (contratto, elenco): si usa con `[(scelta)]`. */
  @Input() scelta: SceltaLegame | null = null
  @Output() sceltaChange = new EventEmitter<SceltaLegame | null>()
  /** Il blocco `legame` per la registrazione; null = nessun blocco da inviare. */
  @Output() legameChange = new EventEmitter<DatiLegameRegistrazione | null>()
  /** Falso se un campo delle righe è in errore: chi registra deve aspettare. */
  @Output() validoChange = new EventEmitter<boolean>()

  readonly messaggioNonDisponibile = MESSAGGIO_PROPOSTA_NON_DISPONIBILE

  readonly proposta = signal<PropostaLegame | null>(null)
  readonly caricamento = signal(false)
  readonly erroreProposta = signal(false)
  readonly modo = signal<'CONFERMA' | 'PROPOSTA'>('PROPOSTA')
  readonly cambioInSospeso = signal<{ tipo: 'contrattoId' | 'elencoId'; id: string } | null>(null)

  private readonly modifiche = signal<Readonly<Record<string, Modifiche>>>({})
  private readonly campiInErrore = signal(false)

  private readonly datiDebounce$ = new Subject<DatiMovimentoLegame | null>()
  private readonly subito$ = new Subject<void>()
  private chiaveDati: string | null = null

  readonly puoScrivere = computed(() => permessiLegami(this.auth.currentUser()?.role).scrive)

  /** Visibile solo se la causale è fatturabile e la fatturazione è attiva (o se la proposta è fallita). */
  readonly visibile = computed(() => {
    if (!this.puoScrivere() || !this.datiMovimento) return false
    if (this.erroreProposta()) return true
    const p = this.proposta()
    return !!p && p.fatturabile && p.attiva
  })

  /** Righe della proposta con i valori ritoccati dall'utente. */
  readonly righeVista = computed<RigaLegame[]>(() => {
    const p = this.proposta()
    if (!p) return []
    const m = this.modifiche()
    return p.righe.map(r => {
      const x = m[r.rigaAddebitoId]
      if (!x) return r
      const prezzoOSconto = 'prezzo' in x || 'sconto' in x
      return {
        ...r,
        quantita: 'quantita' in x ? (x.quantita ?? r.quantita) : r.quantita,
        quantitaOrigine: 'quantita' in x ? 'MANUALE' : r.quantitaOrigine,
        prezzo: 'prezzo' in x ? (x.prezzo ?? null) : r.prezzo,
        sconto: 'sconto' in x ? (x.sconto ?? null) : r.sconto,
        prezzoManuale: r.prezzoManuale || prezzoOSconto,
        // L'importo lo calcola il server: con valori ritoccati non è più quello della proposta.
        importo: null,
      }
    })
  })

  /** Avvisi della proposta più `PREZZO_MANUALE` se l'utente ha scritto un prezzo o uno sconto. */
  readonly avvisi = computed<AvvisoLegame[]>(() => {
    const p = this.proposta()
    if (!p) return []
    const codici = new Set<AvvisoLegame>(p.avvisi)
    if (this.righeVista().some(r => r.prezzoManuale)) codici.add('PREZZO_MANUALE')
    return [...codici]
  })

  readonly puoConfermare = computed(() => {
    const p = this.proposta()
    return !!p && p.motivi.length === 0 && !this.campiInErrore()
  })

  motivo = etichettaMotivo
  avviso = etichettaAvviso

  constructor() {
    // Si sottoscrive subito: `ngOnChanges` precede `ngOnInit` e la prima richiesta non va persa.
    merge(
      this.datiDebounce$.pipe(debounce(d => timer(d ? ATTESA_PROPOSTA_MS : 0))),
      this.subito$.pipe(map(() => this.datiMovimento))
    )
      .pipe(
        switchMap(dati => {
          if (!dati || !this.puoScrivere()) return of({ stato: 'vuoto' as const })
          this.caricamento.set(true)
          const scelte = this.sceltePerRichiesta()
          return this.servizio.proposta({ ...dati, ...(scelte ? { scelte } : {}) }).pipe(
            map(proposta => ({ stato: 'ok' as const, proposta })),
            catchError(() => of({ stato: 'errore' as const }))
          )
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(esito => {
        this.caricamento.set(false)
        if (esito.stato === 'ok') {
          this.erroreProposta.set(false)
          this.proposta.set(esito.proposta)
          this.potaModifiche(esito.proposta)
          if (esito.proposta.motivi.length > 0) this.modo.set('PROPOSTA')
        } else if (esito.stato === 'errore') {
          // Il registro non si blocca mai: avviso e registrazione possibile, senza blocco `legame`.
          this.erroreProposta.set(true)
          this.proposta.set(null)
        } else {
          this.erroreProposta.set(false)
          this.proposta.set(null)
        }
        this.emetti()
      })
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['datiMovimento']) return
    const dati = this.datiMovimento
    const chiave = dati ? JSON.stringify(dati) : null
    if (chiave === this.chiaveDati) return
    const precedente = this.chiaveDati ? (JSON.parse(this.chiaveDati) as DatiMovimentoLegame) : null
    this.chiaveDati = chiave
    // Un altro FIR può avere un altro cliente: le scelte su contratto ed elenco non valgono più.
    if (precedente && dati && (precedente.firId ?? null) !== (dati.firId ?? null)) {
      this.aggiornaScelta(null)
      this.modifiche.set({})
    }
    if (!dati) {
      this.proposta.set(null)
      this.erroreProposta.set(false)
      this.caricamento.set(false)
      this.emetti()
    }
    this.datiDebounce$.next(dati)
  }

  mostraMenuContratti(p: PropostaLegame): boolean {
    return p.candidati.contratti.length > 1 || p.motivi.includes('CONTRATTO_AMBIGUO')
  }

  mostraMenuElenchi(p: PropostaLegame): boolean {
    return p.candidati.elenchi.length > 1
  }

  /** Cambio di contratto o elenco dal menu. */
  scegli(tipo: 'contrattoId' | 'elencoId', el: HTMLSelectElement): void {
    const p = this.proposta()
    const id = el.value
    const corrente = (tipo === 'contrattoId' ? p?.contratto?.id : p?.elenco?.id) ?? ''
    if (!p || id === '' || id === corrente) {
      el.value = corrente
      return
    }
    if (this.haPrezziManuali()) {
      // I valori scritti a mano andrebbero persi: prima si avvisa, l'utente decide.
      el.value = corrente
      this.cambioInSospeso.set({ tipo, id })
      return
    }
    this.applicaScelta(tipo, id)
  }

  confermaCambio(): void {
    const c = this.cambioInSospeso()
    if (!c) return
    this.cambioInSospeso.set(null)
    this.applicaScelta(c.tipo, c.id)
  }

  annullaCambio(): void {
    this.cambioInSospeso.set(null)
  }

  imposta(modo: 'CONFERMA' | 'PROPOSTA'): void {
    if (modo === 'CONFERMA' && !this.puoConfermare()) return
    this.modo.set(modo)
    this.emetti()
  }

  alModifica(m: ModificaCampoRiga): void {
    const attuali = this.modifiche()
    const riga: Modifiche = { ...(attuali[m.rigaAddebitoId] ?? {}), [m.campo]: m.valore }
    this.modifiche.set({ ...attuali, [m.rigaAddebitoId]: riga })
    this.emetti()
  }

  alErrori(inErrore: boolean): void {
    this.campiInErrore.set(inErrore)
    if (inErrore && this.modo() === 'CONFERMA') this.modo.set('PROPOSTA')
    this.validoChange.emit(!inErrore)
    this.emetti()
  }

  private haPrezziManuali(): boolean {
    return this.righeVista().some(r => r.prezzoManuale)
  }

  private applicaScelta(tipo: 'contrattoId' | 'elencoId', id: string): void {
    const base: SceltaLegame = { ...(this.scelta ?? {}) }
    // L'elenco appartiene al contratto: cambiando contratto la scelta dell'elenco decade.
    if (tipo === 'contrattoId') delete base.elencoId
    this.aggiornaScelta({ ...base, [tipo]: id })
    this.modifiche.set({})
    this.subito$.next()
  }

  private aggiornaScelta(s: SceltaLegame | null): void {
    this.scelta = s
    this.sceltaChange.emit(s)
  }

  private sceltePerRichiesta(): SceltaLegame | null {
    const s = this.scelta
    if (!s) return null
    return Object.keys(s).length > 0 ? s : null
  }

  /** Dopo una nuova proposta le modifiche di righe che non ci sono più si scartano. */
  private potaModifiche(p: PropostaLegame): void {
    const ids = new Set(p.righe.map(r => r.rigaAddebitoId))
    const attuali = this.modifiche()
    const restano = Object.entries(attuali).filter(([id]) => ids.has(id))
    if (restano.length !== Object.keys(attuali).length) {
      this.modifiche.set(Object.fromEntries(restano))
    }
  }

  /** Costruisce il blocco `legame`: TUTTE le righe della proposta, con i ritocchi solo dove ci sono. */
  private costruisciLegame(): DatiLegameRegistrazione | null {
    const p = this.proposta()
    if (!this.visibile() || !p) return null
    const m = this.modifiche()
    const righe: RigaLegameRegistrazione[] = p.righe.map(r => {
      const x = m[r.rigaAddebitoId] ?? {}
      const out: RigaLegameRegistrazione = { rigaAddebitoId: r.rigaAddebitoId }
      if ('quantita' in x && x.quantita !== undefined) out.quantita = x.quantita
      if ('prezzo' in x && x.prezzo !== undefined && x.prezzo !== null) out.prezzo = x.prezzo
      if ('sconto' in x) out.sconto = x.sconto ?? null
      return out
    })
    // Solo le scelte esplicite dell'utente: il resto lo deriva il server, come nella proposta.
    const s = this.scelta
    return {
      azione: this.modo(),
      ...(s?.clienteId ? { clienteId: s.clienteId } : {}),
      ...(s?.contrattoId ? { contrattoId: s.contrattoId } : {}),
      ...(s?.elencoId ? { elencoId: s.elencoId } : {}),
      righe,
    }
  }

  private emetti(): void {
    this.legameChange.emit(this.costruisciLegame())
  }
}
