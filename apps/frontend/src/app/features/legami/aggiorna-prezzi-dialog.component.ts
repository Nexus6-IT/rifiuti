import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Subject, Subscription, of } from 'rxjs'
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { focalizzaPasso } from '../../shared/utils/focalizza-passo'
import { ClientiService } from '../clienti/clienti.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { ListinoService } from '../listino/listino.service'
import { AnteprimaAggiornamento, EsitoAggiornamento, PerimetroAggiornamento } from './legami.model'
import { LegamiService } from './legami.service'

export const MSG_ANTEPRIMA_RICARICATA =
  'I dati sono cambiati dopo l’anteprima: ecco quella aggiornata. Controllala e conferma di nuovo.'
/** Lo stesso tetto di `MAX_DIFFERENZE` del backend: oltre, le righe d'esempio sono troncate. */
export const MAX_ESEMPI = 200
export const MSG_DATE_INCOERENTI = 'La data iniziale è dopo quella finale.'

/** Righe per la ricerca dei contratti: il backend accetta fino a 100 (`@Max(100)`). */
const DIMENSIONE_RICERCA = 25

const SALTATI: Record<string, string> = {
  FATTURATO: 'fatturati',
  IMPORTATO_FATTURATO: 'già fatturati in precedenza',
  ESCLUSO: 'esclusi',
  ANNULLATO: 'annullati',
  PREZZO_SPECIALE: 'prezzo speciale',
}

const num = (n: number): string => n.toLocaleString('it-IT')

/**
 * Riepilogo in una riga, come lo vede l'utente: «12 cambiano, 3 saltati (2 fatturati, 1 prezzo
 * speciale), 2 escluse, prezzo modificato a mano, 1 passa a Da collegare». Le parti a zero si
 * omettono. Le righe a prezzo manuale non sono «saltati»: hanno la loro voce.
 */
export function descriviAnteprima(a: AnteprimaAggiornamento): string {
  const parti: string[] = [
    `${num(a.cambiano)} ${a.cambiano === 1 ? 'legame cambia' : 'legami cambiano'}`,
  ]
  const saltati = a.saltati.filter(s => s.motivo !== 'PREZZO_MANUALE' && s.numero > 0)
  const totale = saltati.reduce((n, s) => n + s.numero, 0)
  if (totale > 0) {
    const dettaglio = saltati
      .map(s => `${num(s.numero)} ${SALTATI[s.motivo] ?? s.motivo}`)
      .join(', ')
    parti.push(`${num(totale)} saltati (${dettaglio})`)
  }
  if (a.righeEscluseManuali > 0) {
    parti.push(
      `${num(a.righeEscluseManuali)} ${a.righeEscluseManuali === 1 ? 'esclusa' : 'escluse'}, prezzo modificato a mano`
    )
  }
  const dc = a.daCollegare ?? 0
  if (dc > 0) parti.push(`${num(dc)} ${dc === 1 ? 'passa' : 'passano'} a Da collegare`)
  return parti.join(', ')
}

/** Prezzo col punto del backend → «10,50»; assente → «—». */
export function mostraPrezzo(v: string | null): string {
  if (v === null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return v
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

/** Sconto a cascata col punto del backend → virgola; assente → «—». */
export function mostraSconto(v: string | null): string {
  return v === null || v === '' ? '—' : v.replace(/\./g, ',')
}

interface Opzione {
  label: string
  value: string
}

/**
 * Finestra «Aggiorna prezzi» (fase 4.3, Task 29; spec §7.4 e §8.2). Solo ADMIN e SUPER_ADMIN (la
 * pagina non la apre agli altri e il backend risponde 403). Due passi nella stessa finestra:
 * 1. perimetro (un contratto, facoltativamente un suo elenco, facoltativamente un periodo);
 * 2. anteprima con le differenze e conferma esplicita (casella): si applica con la firma
 *    dell'anteprima vista. Se nel frattempo i dati cambiano (409 `ANTEPRIMA_SUPERATA`) si ricarica
 *    l'anteprima e si chiede una nuova conferma: non si scrive mai un prezzo che l'utente non ha visto.
 */
@Component({
  selector: 'app-aggiorna-prezzi-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, DropdownModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      (onShow)="alleApertura()"
      header="Aggiorna prezzi dal listino"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso()"
      [closeOnEscape]="!inCorso()"
      [style]="{ width: '52rem', maxWidth: '96vw' }"
      data-testid="aggiorna-prezzi-dialog"
    >
      <p class="ap-intro">
        Porta i prezzi dei legami <strong>non ancora fatturati</strong> ai valori attuali del
        listino. I legami fatturati, quelli a prezzo speciale e le righe con prezzo modificato a
        mano non cambiano.
      </p>

      <div class="ap-campi" role="group" aria-label="Perimetro dell’aggiornamento">
        <div class="ap-campo">
          <label for="ap-contratto">Contratto</label>
          <p-dropdown
            inputId="ap-contratto"
            [options]="opzioniContratti()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="contrattoId"
            (ngModelChange)="scegliContratto($event)"
            [filter]="true"
            (onFilter)="cercaContratti($event.filter ?? '')"
            [showClear]="true"
            [disabled]="inCorso()"
            placeholder="Cerca per numero o cliente"
            ariaLabel="Contratto"
            data-testid="ap-contratto"
          />
        </div>
        <div class="ap-campo">
          <label for="ap-elenco">Elenco di addebiti (facoltativo)</label>
          <p-dropdown
            inputId="ap-elenco"
            [options]="opzioniElenchi()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="elencoId"
            (ngModelChange)="elencoId = $event; cambiaPerimetro()"
            [showClear]="true"
            [disabled]="inCorso() || !contrattoId"
            placeholder="Tutti gli elenchi del contratto"
            ariaLabel="Elenco di addebiti"
            data-testid="ap-elenco"
          />
        </div>
        <div class="ap-campo">
          <label for="ap-dal">Movimenti dal (facoltativo)</label>
          <input
            pInputText
            id="ap-dal"
            type="date"
            [ngModel]="dal"
            (ngModelChange)="dal = $event; cambiaPerimetro()"
            [disabled]="inCorso()"
            data-testid="ap-dal"
          />
        </div>
        <div class="ap-campo">
          <label for="ap-al">Movimenti al (facoltativo)</label>
          <input
            pInputText
            id="ap-al"
            type="date"
            [ngModel]="al"
            (ngModelChange)="al = $event; cambiaPerimetro()"
            [disabled]="inCorso()"
            data-testid="ap-al"
          />
        </div>
      </div>
      <p *ngIf="dateIncoerenti()" role="alert" class="field-error" data-testid="ap-errore-date">
        {{ msgDate }}
      </p>
      <p
        *ngIf="erroreContratti() as e"
        role="alert"
        class="field-error"
        data-testid="ap-errore-contratti"
      >
        {{ e }}
      </p>

      <div class="ap-azione">
        <p-button
          label="Mostra anteprima"
          icon="pi pi-search"
          [outlined]="true"
          [disabled]="!perimetroValido() || inCorso()"
          [loading]="inCorso() && !anteprimaCorrente()"
          (onClick)="anteprima()"
          data-testid="ap-anteprima"
        />
      </div>

      <p *ngIf="messaggio() as m" role="status" class="ap-messaggio" data-testid="ap-messaggio">
        {{ m }}
      </p>
      <div *ngIf="errori().length > 0" role="alert" class="field-error" data-testid="ap-errore">
        <p *ngFor="let e of errori()">{{ e }}</p>
      </div>

      <section
        *ngIf="anteprimaCorrente() as a"
        class="ap-anteprima"
        tabindex="-1"
        aria-labelledby="ap-titolo-anteprima"
        data-testid="ap-anteprima-sezione"
      >
        <h3 id="ap-titolo-anteprima">Anteprima</h3>
        <p class="ap-riepilogo" data-testid="ap-riepilogo">{{ riepilogo() }}</p>
        <p *ngIf="a.invariati > 0" class="ap-nota" data-testid="ap-invariati">
          {{ numero(a.invariati ?? 0) }} legami già allineati al listino.
        </p>

        <ng-container *ngIf="a.differenze.length > 0">
          <table class="ap-esempi" data-testid="ap-esempi">
            <caption>
              Righe con prezzo o sconto diverso{{
                a.differenze.length >= maxEsempi ? ' (le prime ' + maxEsempi + ')' : ''
              }}
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Prezzo prima</th>
                <th scope="col">Prezzo dopo</th>
                <th scope="col">Sconto prima</th>
                <th scope="col">Sconto dopo</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let d of a.differenze; let i = index">
                <td>{{ i + 1 }}</td>
                <td>{{ prezzo(d.prezzoPrima) }}</td>
                <td>{{ prezzo(d.prezzoDopo) }}</td>
                <td>{{ sconto(d.scontoPrima) }}</td>
                <td>{{ sconto(d.scontoDopo) }}</td>
              </tr>
            </tbody>
          </table>
        </ng-container>

        <p
          *ngIf="a.cambiano > 0 && a.differenze.length === 0"
          class="ap-nota"
          data-testid="ap-solo-altro"
        >
          Cambiano l’IVA o lo stato dei legami, non prezzi o sconti.
        </p>

        <p *ngIf="a.cambiano === 0" class="ap-nota" data-testid="ap-niente">
          Non c’è niente da aggiornare.
        </p>

        <div class="ap-conferma" *ngIf="a.cambiano > 0">
          <input
            type="checkbox"
            id="ap-conferma"
            [(ngModel)]="confermato"
            [disabled]="inCorso()"
            data-testid="ap-conferma"
          />
          <label for="ap-conferma"> Ho controllato l’anteprima e voglio aggiornare i prezzi </label>
        </div>
      </section>

      <ng-template pTemplate="footer">
        <p-button
          label="Chiudi"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="ap-chiudi"
        />
        <p-button
          label="Applica"
          icon="pi pi-check"
          [disabled]="!puoApplicare()"
          [loading]="inCorso() && !!anteprimaCorrente()"
          (onClick)="applica()"
          data-testid="ap-applica"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .ap-intro {
        margin: 0 0 var(--spacing-md);
      }
      .ap-campi {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--spacing-md);
      }
      .ap-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }
      .ap-azione {
        margin: var(--spacing-md) 0;
      }
      .ap-messaggio {
        padding: var(--spacing-sm) var(--spacing-md);
        border-left: 4px solid var(--color-warning, #b45309);
        background: var(--color-surface-alt, #f5f5f4);
      }
      .ap-anteprima {
        outline: none;
        border-top: 1px solid var(--color-border, #d6d3d1);
        padding-top: var(--spacing-md);
      }
      .ap-riepilogo {
        font-weight: 600;
      }
      .ap-esempi {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--font-size-sm);
      }
      .ap-esempi caption {
        text-align: left;
        padding-bottom: var(--spacing-xs);
      }
      .ap-esempi th,
      .ap-esempi td {
        padding: var(--spacing-xs) var(--spacing-sm);
        border-bottom: 1px solid var(--color-border, #d6d3d1);
        text-align: right;
      }
      .ap-esempi th:first-child,
      .ap-esempi td:first-child {
        text-align: left;
      }
      .ap-conferma {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        margin-top: var(--spacing-md);
      }
    `,
  ],
})
export class AggiornaPrezziDialogComponent implements OnInit, OnChanges, OnDestroy {
  @Input() visible = false
  @Output() chiuso = new EventEmitter<void>()
  /** Esito dell'applicazione: la pagina rilegge la lista e il contatore del menu. */
  @Output() applicato = new EventEmitter<EsitoAggiornamento>()

  private readonly servizio = inject(LegamiService)
  private readonly clienti = inject(ClientiService)
  private readonly listino = inject(ListinoService)

  contrattoId: string | null = null
  elencoId: string | null = null
  dal = ''
  al = ''
  confermato = false

  readonly msgDate = MSG_DATE_INCOERENTI
  readonly opzioniContratti = signal<Opzione[]>([])
  readonly opzioniElenchi = signal<Opzione[]>([])
  readonly erroreContratti = signal<string | null>(null)
  readonly anteprimaCorrente = signal<AnteprimaAggiornamento | null>(null)
  readonly inCorso = signal(false)
  readonly errori = signal<string[]>([])
  readonly messaggio = signal<string | null>(null)
  /** Perimetro dell'anteprima mostrata: si applica QUELLO, anche se i campi cambiano dopo. */
  private perimetroAnteprima: PerimetroAggiornamento | null = null

  private readonly ricerca = new Subject<string>()
  private readonly scelta = new Subject<string | null>()
  private sub = new Subscription()

  ngOnInit(): void {
    this.sub.add(
      this.ricerca
        .pipe(
          // La prima lettura (testo vuoto) passa dallo stesso flusso: una risposta lenta non
          // può sovrascrivere una ricerca digitata dopo.
          switchMap(t => (t === '' ? of(t) : of(t).pipe(debounceTime(300)))),
          switchMap(t => this.leggiContratti(t))
        )
        .subscribe(o => this.impostaContratti(o))
    )
    // Un solo caricamento di elenchi alla volta: cambiando contratto in fretta vale l'ultimo.
    this.sub.add(
      this.scelta
        .pipe(
          switchMap(id =>
            id === null
              ? of(null)
              : this.listino.elenchi.delContratto(id).pipe(catchError(() => of(null)))
          )
        )
        .subscribe(r =>
          this.opzioniElenchi.set(
            r === null
              ? []
              : r.elenchi.map(e => ({ label: `${e.codice} — ${e.descrizione}`, value: e.id }))
          )
        )
    )
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) {
      this.azzera()
      this.ricerca.next('')
    }
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe()
  }

  /** Il focus entra nella finestra sul primo campo (il dialog lo intrappola poi da solo). */
  alleApertura(): void {
    setTimeout(() => document.getElementById('ap-contratto')?.focus())
  }

  private azzera(): void {
    this.contrattoId = null
    this.elencoId = null
    this.dal = ''
    this.al = ''
    this.confermato = false
    this.opzioniElenchi.set([])
    this.anteprimaCorrente.set(null)
    this.perimetroAnteprima = null
    this.errori.set([])
    this.messaggio.set(null)
    this.inCorso.set(false)
  }

  /** Ricerca sul server: al massimo 25 contratti per volta. */
  private leggiContratti(testo: string) {
    this.erroreContratti.set(null)
    const t = testo.trim()
    return this.clienti.contratti
      .list({ ...(t ? { testo: t } : {}), dimensione: DIMENSIONE_RICERCA })
      .pipe(
        map(
          p =>
            // Un contratto annullato non ha listino modificabile (409): non si offre.
            p.elementi
              .filter(c => c.stato !== 'ANNULLATO')
              .map(c => ({
                label: `${c.numero} — ${c.cliente.ragioneSociale}`,
                value: c.id,
              })) as Opzione[]
        ),
        catchError(() => {
          this.erroreContratti.set('Impossibile caricare i contratti: riprova a cercare.')
          return of(null)
        })
      )
  }

  private impostaContratti(o: Opzione[] | null): void {
    if (o !== null) this.opzioniContratti.set(o)
  }

  cercaContratti(testo: string): void {
    this.ricerca.next(testo)
  }

  scegliContratto(id: string | null): void {
    this.contrattoId = id || null
    this.elencoId = null
    this.opzioniElenchi.set([])
    this.cambiaPerimetro()
    this.scelta.next(this.contrattoId)
  }

  /** Un campo del perimetro è cambiato: l'anteprima vista non vale più. */
  cambiaPerimetro(): void {
    this.anteprimaCorrente.set(null)
    this.perimetroAnteprima = null
    this.confermato = false
    this.errori.set([])
    this.messaggio.set(null)
  }

  dateIncoerenti(): boolean {
    return !!this.dal && !!this.al && this.dal > this.al
  }

  /** Spec §7.4: il perimetro è un contratto o un elenco (qui sempre un contratto, con elenco facoltativo). */
  perimetroValido(): boolean {
    return (!!this.contrattoId || !!this.elencoId) && !this.dateIncoerenti()
  }

  private perimetro(): PerimetroAggiornamento {
    const p: PerimetroAggiornamento = {}
    if (this.contrattoId) p.contrattoId = this.contrattoId
    if (this.elencoId) p.elencoId = this.elencoId
    if (this.dal) p.dal = this.dal
    if (this.al) p.al = this.al
    return p
  }

  riepilogo(): string {
    const a = this.anteprimaCorrente()
    return a ? descriviAnteprima(a) : ''
  }

  readonly maxEsempi = MAX_ESEMPI
  numero = num
  prezzo = mostraPrezzo
  sconto = mostraSconto

  puoApplicare(): boolean {
    const a = this.anteprimaCorrente()
    return !!a && a.cambiano > 0 && this.confermato && !this.inCorso()
  }

  /** Calcola l'anteprima del perimetro scelto (sola lettura sul server). */
  anteprima(): void {
    if (!this.perimetroValido() || this.inCorso()) return
    this.caricaAnteprima(this.perimetro(), null)
  }

  private caricaAnteprima(p: PerimetroAggiornamento, messaggio: string | null): void {
    this.inCorso.set(true)
    this.errori.set([])
    this.messaggio.set(messaggio)
    this.confermato = false
    this.servizio.anteprimaAggiornamento(p).subscribe({
      next: a => {
        this.perimetroAnteprima = p
        this.anteprimaCorrente.set(a)
        this.inCorso.set(false)
        focalizzaPasso('ap-anteprima-sezione')
      },
      error: err => {
        this.anteprimaCorrente.set(null)
        this.perimetroAnteprima = null
        this.inCorso.set(false)
        this.errori.set(leggiErroriAzione(err, 'Impossibile calcolare l’anteprima.').messaggi)
      },
    })
  }

  /** Applica con la firma dell'anteprima vista; serve la casella di conferma. */
  applica(): void {
    const a = this.anteprimaCorrente()
    const p = this.perimetroAnteprima
    if (!a || !p || !this.puoApplicare()) return
    this.inCorso.set(true)
    this.errori.set([])
    this.servizio.applicaAggiornamento(p, a.firma).subscribe({
      next: esito => {
        this.inCorso.set(false)
        this.applicato.emit(esito)
      },
      error: err => {
        const e = leggiErroriAzione(err, 'Impossibile aggiornare i prezzi.')
        if (e.codice === 'ANTEPRIMA_SUPERATA') {
          // Si ricalcola l'anteprima: la conferma data riguardava dati che non valgono più.
          this.inCorso.set(false)
          this.caricaAnteprima(p, MSG_ANTEPRIMA_RICARICATA)
          return
        }
        this.inCorso.set(false)
        this.errori.set(e.messaggi)
      },
    })
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.chiuso.emit()
  }
}
