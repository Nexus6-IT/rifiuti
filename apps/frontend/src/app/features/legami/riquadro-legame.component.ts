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
import { Subject, catchError, map, of, switchMap } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { STATI_MODIFICABILI } from './legame-dialog.component'
import {
  AvvisoLegame,
  LegameVista,
  ModificaRigaLegame,
  MotivoLegame,
  RigaLegame,
} from './legami.model'
import { LegamiService } from './legami.service'
import { permessiLegami } from './permessi-legami'
import {
  CampoRiga,
  ModificaCampoRiga,
  RigheLegameTabellaComponent,
} from './righe-legame-tabella.component'
import { etichettaAvviso, etichettaMotivo, etichettaStato, severitaTag } from './vocabolario-legami'

/** Testo dell'avviso quando il movimento è stato corretto dopo la fattura (come `AVVISO_SCOSTAMENTO` del backend). */
export const TESTO_SCOSTAMENTO =
  'Il movimento è già stato fatturato; la correzione non cambia la fattura'

/** Esito del caricamento, per chi ospita il riquadro (nel dettaglio: «nessun collegamento»). */
export type EsitoRiquadro = 'presente' | 'assente' | 'errore'

type Ritocchi = Readonly<Record<string, Partial<Record<CampoRiga, string | null>>>>

const VALORE_DI = { quantita: 'quantita', prezzo: 'prezzo', sconto: 'sconto' } as const

/** Un valore scritto coincide con quello già nel legame (numeri a confronto numerico, sconti per testo). */
function uguale(campo: CampoRiga, nuovo: string | null, originale: string | null): boolean {
  if (nuovo === null || originale === null) return nuovo === originale
  return campo === 'sconto' ? nuovo === originale : Number(nuovo) === Number(originale)
}

/**
 * Messaggi di un errore delle rotte del legame. Il 409 `LEGAME_INCOMPLETO` della conferma porta in
 * `details.motivi` i codici di ciò che manca: si traducono con `etichettaMotivo`, mai mostrati grezzi.
 */
export function messaggiErroreLegame(err: unknown): {
  messaggi: string[]
  rilettura: boolean
} {
  const e = leggiErroriAzione(err, 'Operazione non riuscita. Riprova.')
  const dettagli = (
    err as { error?: { details?: { motivi?: unknown; dettaglioCliente?: unknown } } } | null
  )?.error?.details
  if (e.codice === 'LEGAME_INCOMPLETO' && dettagli && Array.isArray(dettagli.motivi)) {
    const testi = (dettagli.motivi as MotivoLegame[]).map(etichettaMotivo)
    if (typeof dettagli.dettaglioCliente === 'string') testi.push(dettagli.dettaglioCliente)
    return { messaggi: ['Il legame è incompleto:', ...testi.map(t => `${t}.`)], rilettura: false }
  }
  return {
    messaggi: e.messaggi,
    rilettura: e.rilettura,
  }
}

/**
 * Riquadro «Fatturazione» del dettaglio di un movimento (spec §8, Task 27). Carica il legame
 * della catena (`perMovimento`, uno qualunque dei movimenti) e ne mostra stato, cliente, contratto,
 * elenco, valori CONGELATI (prezzo, sconto, IVA, quantità) e importi calcolati dal SERVER: qui non si
 * calcola nulla. Senza legame (404) il riquadro non c'è.
 *
 * OPERATOR e ADMIN ritoccano quantità, prezzo e sconto delle righe finché il legame non è
 * fatturato: è un «ritocco», si inviano solo le righe toccate (come nella finestra di «Da
 * collegare»). Il VIEWER legge soltanto e non chiama mai le rotte di scrittura.
 */
@Component({
  selector: 'app-riquadro-legame',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule, RigheLegameTabellaComponent],
  template: `
    <section
      *ngIf="legame() as l"
      class="riquadro-legame"
      aria-labelledby="riquadro-legame-titolo"
      data-testid="riquadro-legame"
    >
      <header class="riquadro-testa">
        <h3 id="riquadro-legame-titolo" class="riquadro-titolo">Fatturazione</h3>
        <p-tag
          [value]="etichettaStato(l.stato)"
          [severity]="severitaTag(l.stato)"
          data-testid="riquadro-stato"
        ></p-tag>
      </header>

      <dl class="riquadro-dati">
        <div>
          <dt>Cliente</dt>
          <dd data-testid="riquadro-cliente">{{ l.cliente?.etichetta ?? '—' }}</dd>
        </div>
        <div>
          <dt>Contratto</dt>
          <dd data-testid="riquadro-contratto">{{ l.contratto?.etichetta ?? '—' }}</dd>
        </div>
        <div>
          <dt>Elenco di addebiti</dt>
          <dd data-testid="riquadro-elenco">{{ l.elenco?.etichetta ?? '—' }}</dd>
        </div>
        <div *ngIf="l.confermatoIl && l.stato === 'CONFERMATO'">
          <dt>Valori congelati</dt>
          <dd data-testid="riquadro-congelati">
            alla conferma del {{ l.confermatoIl | date: 'dd/MM/yyyy' }}
          </dd>
        </div>
        <div *ngIf="l.fatturatoIl">
          <dt>Fatturato il</dt>
          <dd data-testid="riquadro-fatturato">
            {{ l.fatturatoIl | date: 'dd/MM/yyyy'
            }}<span *ngIf="l.riferimentoFattura"> · {{ l.riferimentoFattura }}</span>
          </dd>
        </div>
        <div *ngIf="l.motivoEsclusione">
          <dt>Motivo dell'esclusione</dt>
          <dd data-testid="riquadro-esclusione">{{ l.motivoEsclusione }}</dd>
        </div>
      </dl>

      <p
        *ngIf="indietro()"
        class="avviso avviso-warn"
        role="status"
        data-testid="riquadro-da-riallineare"
      >
        Il legame è rimasto indietro rispetto all'ultima correzione del movimento: i valori qui
        sotto sono quelli precedenti. Riallinealo dalla pagina «Da collegare».
      </p>

      <p
        *ngIf="l.scostamentoDopoFattura"
        class="avviso avviso-warn"
        role="status"
        data-testid="riquadro-avviso-AVVISO_SCOSTAMENTO"
      >
        {{ testoScostamento
        }}<span *ngIf="l.scostamentoIl">
          (correzione del {{ l.scostamentoIl | date: 'dd/MM/yyyy' }})</span
        >.
      </p>

      <ul *ngIf="motivi().length" class="elenco-avvisi" data-testid="riquadro-motivi">
        <li *ngFor="let m of motivi()" class="avviso avviso-warn">{{ etichettaMotivo(m) }}</li>
      </ul>

      <ul *ngIf="avvisi().length" class="elenco-avvisi" data-testid="riquadro-avvisi">
        <li
          *ngFor="let a of avvisi()"
          class="avviso avviso-warn"
          [attr.data-testid]="'riquadro-avviso-' + a"
        >
          {{ etichettaAvviso(a) }}
        </li>
      </ul>

      <app-righe-legame-tabella
        [righe]="righeVista()"
        [modificabile]="puoModificare()"
        [mostraIva]="true"
        [generazione]="generazione()"
        (modifica)="alModifica($event)"
        (erroriChange)="campiInErrore.set($event)"
      ></app-righe-legame-tabella>

      <div *ngIf="puoModificare()" class="riquadro-azioni" data-testid="riquadro-azioni">
        <p-button
          label="Salva modifiche"
          [outlined]="true"
          [disabled]="!haRitocchi() || campiInErrore() || inCorso()"
          [loading]="inCorso()"
          data-testid="riquadro-salva"
          (onClick)="salva()"
        ></p-button>
        <p-button
          *ngIf="l.stato !== 'CONFERMATO'"
          label="Conferma legame"
          icon="pi pi-check"
          [disabled]="campiInErrore() || inCorso()"
          [loading]="inCorso()"
          data-testid="riquadro-conferma"
          (onClick)="conferma()"
        ></p-button>
      </div>

      <div
        *ngIf="errori().length"
        class="avviso avviso-errore"
        role="alert"
        data-testid="riquadro-errori"
      >
        <p *ngFor="let e of errori()">{{ e }}</p>
        <p-button
          *ngIf="serveRicarica()"
          label="Ricarica"
          [text]="true"
          size="small"
          data-testid="riquadro-ricarica"
          (onClick)="ricarica()"
        ></p-button>
      </div>
    </section>

    <p
      *ngIf="esito() === 'errore'"
      class="avviso avviso-warn"
      role="alert"
      data-testid="riquadro-errore-lettura"
    >
      Non riesco a leggere il collegamento alla fatturazione.
      <p-button
        label="Riprova"
        [text]="true"
        size="small"
        data-testid="riquadro-riprova"
        (onClick)="ricarica()"
      ></p-button>
    </p>
  `,
  styles: [
    `
      .riquadro-legame {
        margin-top: 1rem;
      }
      .riquadro-testa {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.5rem;
      }
      .riquadro-titolo {
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin: 0;
      }
      .riquadro-dati {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: 0.5rem 1rem;
        margin: 0 0 0.75rem;
      }
      .riquadro-dati dt {
        font-size: 0.8rem;
        color: var(--text-color-secondary, #6b7280);
      }
      .riquadro-dati dd {
        margin: 0;
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
      .avviso-errore {
        background: var(--color-danger-bg, #fee2e2);
        border: 1px solid var(--color-danger, #b91c1c);
        color: var(--color-danger, #991b1b);
      }
      .avviso p {
        margin: 0;
      }
      .riquadro-azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.75rem;
      }
    `,
  ],
})
export class RiquadroLegameComponent implements OnChanges {
  private readonly servizio = inject(LegamiService)
  private readonly auth = inject(AuthService)
  private readonly destroyRef = inject(DestroyRef)

  /** Un movimento qualunque della catena. */
  @Input() set movimentoId(v: string | null) {
    this.idMovimento.set(v)
  }
  get movimentoId(): string | null {
    return this.idMovimento()
  }
  private readonly idMovimento = signal<string | null>(null)
  /**
   * Vero se `movimentoId` è la testa (l'annotazione vigente) della catena: solo allora si può dire
   * che un legame con un altro movimento vigente è rimasto indietro (DA_RIALLINEARE).
   */
  @Input() eTesta = false
  /** Dopo il caricamento: il legame c'è, non c'è (404) o la lettura è fallita. */
  @Output() esitoChange = new EventEmitter<EsitoRiquadro>()
  /** Dopo un salvataggio o una conferma riusciti (chi ospita può rileggere elenchi e contatori). */
  @Output() aggiornato = new EventEmitter<LegameVista>()

  readonly legame = signal<LegameVista | null>(null)
  readonly esito = signal<EsitoRiquadro | null>(null)
  readonly errori = signal<string[]>([])
  readonly serveRicarica = signal(false)
  readonly inCorso = signal(false)
  readonly campiInErrore = signal(false)
  /** Cambia dopo ogni salvataggio o ricarica: la tabella scorda errori e testi in corso. */
  readonly generazione = signal(0)
  private readonly ritocchi = signal<Ritocchi>({})

  readonly puoScrivere = computed(() => permessiLegami(this.auth.currentUser()?.role).scrive)
  /** Solo OPERATOR/ADMIN e solo negli stati in cui il backend accetta modifiche (mai FATTURATO). */
  readonly puoModificare = computed(() => {
    const l = this.legame()
    return this.puoScrivere() && !!l && STATI_MODIFICABILI.includes(l.stato) && !this.indietro()
  })

  /** Il legame punta a un movimento vigente diverso dalla testa: la correzione non l'ha riallineato. */
  readonly indietro = computed(() => {
    const l = this.legame()
    return this.eTesta && !!l && !!this.movimentoId && l.movimentoVigenteId !== this.movimentoId
  })

  /** Righe con i ritocchi non ancora salvati: l'importo di una riga ritoccata lo calcola il server. */
  readonly righeVista = computed<RigaLegame[]>(() => {
    const l = this.legame()
    if (!l) return []
    const r = this.ritocchi()
    return l.righe.map(riga => {
      const x = r[riga.rigaAddebitoId]
      if (!x) return riga
      return {
        ...riga,
        quantita: 'quantita' in x ? (x.quantita ?? riga.quantita) : riga.quantita,
        quantitaOrigine: 'quantita' in x ? 'MANUALE' : riga.quantitaOrigine,
        prezzo: 'prezzo' in x ? (x.prezzo ?? null) : riga.prezzo,
        sconto: 'sconto' in x ? (x.sconto ?? null) : riga.sconto,
        prezzoManuale: riga.prezzoManuale || 'prezzo' in x || 'sconto' in x,
        importo: null,
      }
    })
  })

  readonly haRitocchi = computed(() => Object.keys(this.ritocchi()).length > 0)

  readonly motivi = computed<MotivoLegame[]>(() => this.legame()?.motivi ?? [])

  /** Avvisi del legame più `PREZZO_MANUALE` se una riga ha il prezzo scritto a mano. */
  readonly avvisi = computed<AvvisoLegame[]>(() => {
    const l = this.legame()
    if (!l) return []
    const codici = new Set<AvvisoLegame>(l.avvisi)
    if (this.righeVista().some(r => r.prezzoManuale)) codici.add('PREZZO_MANUALE')
    return [...codici]
  })

  readonly testoScostamento = TESTO_SCOSTAMENTO
  etichettaStato = etichettaStato
  etichettaMotivo = etichettaMotivo
  etichettaAvviso = etichettaAvviso
  severitaTag = severitaTag

  private readonly richiesta$ = new Subject<string | null>()

  constructor() {
    this.richiesta$
      .pipe(
        switchMap(id =>
          id
            ? this.servizio.perMovimento(id).pipe(
                map(legame => ({ legame, esito: 'presente' as EsitoRiquadro })),
                // 404: la catena non ha un legame, il riquadro non c'è. Altro: si dice che la lettura è fallita.
                catchError(err =>
                  of({
                    legame: null,
                    esito: ((err as { status?: number } | null)?.status === 404
                      ? 'assente'
                      : 'errore') as EsitoRiquadro,
                  })
                )
              )
            : of({ legame: null, esito: 'assente' as EsitoRiquadro })
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ legame, esito }) => {
        this.imposta(legame)
        this.esito.set(esito)
        this.esitoChange.emit(esito)
      })
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['movimentoId']) {
      this.imposta(null)
      this.esito.set(null)
      this.richiesta$.next(this.movimentoId)
    }
  }

  ricarica(): void {
    this.errori.set([])
    this.serveRicarica.set(false)
    this.richiesta$.next(this.movimentoId)
  }

  alModifica(m: ModificaCampoRiga): void {
    const originale = this.legame()?.righe.find(r => r.rigaAddebitoId === m.rigaAddebitoId)
    const attuali = this.ritocchi()
    const riga = { ...(attuali[m.rigaAddebitoId] ?? {}) }
    if (originale && uguale(m.campo, m.valore, originale[VALORE_DI[m.campo]])) {
      // Tornato al valore del legame: non è più un ritocco.
      delete riga[m.campo]
    } else {
      riga[m.campo] = m.valore
    }
    const nuovi = { ...attuali }
    if (Object.keys(riga).length > 0) nuovi[m.rigaAddebitoId] = riga
    else delete nuovi[m.rigaAddebitoId]
    this.ritocchi.set(nuovi)
    this.errori.set([])
  }

  /** Solo le righe toccate: per un legame esistente `righe` è un ritocco, non la selezione intera. */
  righeDaInviare(): ModificaRigaLegame[] {
    return Object.entries(this.ritocchi()).map(([rigaAddebitoId, x]) => ({
      rigaAddebitoId,
      ...('quantita' in x && x.quantita ? { quantita: x.quantita } : {}),
      ...('prezzo' in x && x.prezzo ? { prezzo: x.prezzo } : {}),
      ...('sconto' in x ? { sconto: x.sconto ?? null } : {}),
    }))
  }

  salva(): void {
    const l = this.legame()
    if (!l || !this.puoModificare() || this.campiInErrore() || this.inCorso()) return
    const righe = this.righeDaInviare()
    if (righe.length === 0) return
    this.esegui(this.servizio.modifica(l.id, { versione: l.versione, righe }))
  }

  conferma(): void {
    const l = this.legame()
    if (!l || !this.puoModificare() || this.campiInErrore() || this.inCorso()) return
    const righe = this.righeDaInviare()
    this.esegui(
      this.servizio.conferma(l.id, {
        versione: l.versione,
        ...(righe.length ? { modifiche: { righe } } : {}),
      })
    )
  }

  private esegui(chiamata: ReturnType<LegamiService['modifica']>): void {
    this.inCorso.set(true)
    this.errori.set([])
    this.serveRicarica.set(false)
    chiamata.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: nuovo => {
        this.inCorso.set(false)
        this.imposta(nuovo)
        this.aggiornato.emit(nuovo)
      },
      error: err => {
        this.inCorso.set(false)
        const e = messaggiErroreLegame(err)
        this.errori.set(e.messaggi)
        this.serveRicarica.set(e.rilettura)
      },
    })
  }

  private imposta(legame: LegameVista | null): void {
    this.legame.set(legame)
    this.ritocchi.set({})
    this.campiInErrore.set(false)
    this.errori.set([])
    this.serveRicarica.set(false)
    this.generazione.update(g => g + 1)
  }
}
