import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { EMPTY, Subject, of } from 'rxjs'
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { ClientiService } from '../../clienti/clienti.service'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import { NuovaElaborazione, Raggruppamento } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { fineGiornoDiOggi, isoLocale } from '../impostazioni/numerazione-scheda.component'

/** Righe delle ricerche lato server: il backend accetta fino a 100. */
export const DIMENSIONE_RICERCA = 25

export const MSG_PERIODO_ROVESCIATO = 'La data iniziale è dopo quella finale.'
export const MSG_PERIODO_DUE_ANNI =
  'Il periodo non può attraversare due anni: avvia un’elaborazione per ciascun anno.'
export const MSG_DATA_FUTURA = 'La data del documento non può essere nel futuro.'

interface Opzione {
  label: string
  value: string
  partitaIva?: string
}

/** `null` annulla la ricerca in corso (chiusura del dialog). */
type Ricerca = string | null

/**
 * Finestra «Nuova elaborazione» (4.4c, Task 31): periodo (dentro un solo anno), data del
 * documento (mai nel futuro), raggruppamento, arretrati e filtri facoltativi per cliente e
 * contratto, con ricerca sul server. All'avvio (202) emette l'id: la pagina va al dettaglio.
 */
@Component({
  selector: 'app-nuova-elaborazione-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CalendarModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Nuova elaborazione"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso()"
      [closeOnEscape]="!inCorso()"
      [style]="{ width: '44rem', maxWidth: '96vw' }"
      data-testid="nuova-elaborazione-dialog"
    >
      <div class="ne-campi">
        <div class="ne-campo">
          <label for="ne-dal">Periodo dal (obbligatorio)</label>
          <p-calendar
            inputId="ne-dal"
            [required]="true"
            [(ngModel)]="periodoDal"
            [showIcon]="true"
            dateFormat="dd/mm/yy"
            [disabled]="inCorso()"
            styleClass="w-full"
            data-testid="nuova-periodo-dal"
          />
        </div>
        <div class="ne-campo">
          <label for="ne-al">Periodo al (obbligatorio)</label>
          <p-calendar
            inputId="ne-al"
            [required]="true"
            [(ngModel)]="periodoAl"
            [showIcon]="true"
            dateFormat="dd/mm/yy"
            [disabled]="inCorso()"
            styleClass="w-full"
            data-testid="nuova-periodo-al"
          />
        </div>
        <div class="ne-campo">
          <label for="ne-doc">Data del documento (obbligatorio)</label>
          <p-calendar
            inputId="ne-doc"
            [required]="true"
            [(ngModel)]="dataDocumento"
            [showIcon]="true"
            dateFormat="dd/mm/yy"
            [maxDate]="fineGiorno()"
            (onShow)="aggiornaFineGiorno()"
            (onFocus)="aggiornaFineGiorno()"
            [disabled]="inCorso()"
            styleClass="w-full"
            data-testid="nuova-data-documento"
          />
        </div>
        <div class="ne-campo">
          <label for="ne-raggr">Raggruppamento</label>
          <p-dropdown
            inputId="ne-raggr"
            [options]="opzioniRaggruppamento"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="raggruppamento"
            [disabled]="inCorso()"
            styleClass="w-full"
            data-testid="nuova-raggruppamento"
          />
        </div>
      </div>

      <p
        *ngIf="errori().periodoRovesciato"
        role="alert"
        class="field-error"
        data-testid="nuova-errore-periodo"
      >
        {{ msgPeriodoRovesciato }}
      </p>
      <p *ngIf="errori().dueAnni" role="alert" class="field-error" data-testid="nuova-errore-anno">
        {{ msgDueAnni }}
      </p>
      <p
        *ngIf="errori().dataFutura"
        role="alert"
        class="field-error"
        data-testid="nuova-errore-data"
      >
        {{ msgDataFutura }}
      </p>

      <div class="ne-arretrati">
        <p-checkbox
          inputId="ne-arretrati"
          [binary]="true"
          [(ngModel)]="includiArretrati"
          [disabled]="inCorso()"
          data-testid="nuova-arretrati"
        />
        <label for="ne-arretrati">Includi gli arretrati dei canoni fissi (fino a 12 mesi)</label>
      </div>

      <fieldset class="ne-filtri">
        <legend>Filtri (facoltativi)</legend>
        <div class="ne-campi">
          <div class="ne-campo">
            <label for="ne-cliente">Cliente</label>
            <p-dropdown
              inputId="ne-cliente"
              [options]="opzioniClienti()"
              optionLabel="label"
              optionValue="value"
              [ngModel]="clienteId"
              (ngModelChange)="scegliCliente($event)"
              [filter]="true"
              filterBy="label,partitaIva"
              filterPlaceholder="Cerca per nome, codice o partita IVA"
              (onFilter)="cercaClienti($event.filter ?? '')"
              [showClear]="true"
              [disabled]="inCorso()"
              placeholder="Tutti"
              styleClass="w-full"
              data-testid="nuova-filtro-cliente"
            />
          </div>
          <div class="ne-campo">
            <label for="ne-contratto">Contratto</label>
            <p-dropdown
              inputId="ne-contratto"
              [options]="opzioniContratti()"
              optionLabel="label"
              optionValue="value"
              [ngModel]="contrattoId"
              (ngModelChange)="scegliContratto($event)"
              [filter]="true"
              filterBy="label"
              filterPlaceholder="Cerca per numero o cliente"
              (onFilter)="cercaContratti($event.filter ?? '')"
              [showClear]="true"
              [disabled]="inCorso()"
              placeholder="Tutti"
              styleClass="w-full"
              data-testid="nuova-filtro-contratto"
            />
          </div>
        </div>
        <p
          *ngIf="erroreClienti() as e"
          role="alert"
          class="field-error"
          data-testid="nuova-errore-clienti"
        >
          {{ e }}
        </p>
        <p
          *ngIf="erroreContratti() as e"
          role="alert"
          class="field-error"
          data-testid="nuova-errore-contratti"
        >
          {{ e }}
        </p>
      </fieldset>

      <div *ngIf="errore().length > 0" role="alert" class="field-error" data-testid="nuova-errore">
        <p *ngFor="let e of errore()">{{ e }}</p>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="nuova-annulla"
        />
        <p-button
          label="Avvia anteprima"
          icon="pi pi-play"
          [disabled]="!valido() || inCorso()"
          [loading]="inCorso()"
          (onClick)="avvia()"
          data-testid="nuova-avvia"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .ne-campi {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
        gap: var(--spacing-md);
      }
      .ne-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        min-width: 0;
      }
      .ne-arretrati {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        margin: var(--spacing-md) 0;
      }
      .ne-filtri {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 6px);
        padding: var(--spacing-md);
        margin: 0 0 var(--spacing-md);
      }
    `,
  ],
})
export class NuovaElaborazioneDialogComponent implements OnChanges {
  @Input() visible = false
  @Output() chiuso = new EventEmitter<void>()
  /** Id dell'elaborazione appena avviata (202): la pagina va al dettaglio. */
  @Output() avviato = new EventEmitter<string>()

  private readonly servizio = inject(FatturazioneService)
  private readonly clienti = inject(ClientiService)
  private readonly destroyRef = inject(DestroyRef)

  // Campi del form (ngModel).
  periodoDal: Date | null = null
  periodoAl: Date | null = null
  dataDocumento: Date | null = null
  raggruppamento: Raggruppamento = 'PER_CONTRATTO'
  includiArretrati = false
  clienteId: string | null = null
  contrattoId: string | null = null

  /**
   * Fine del giorno italiano di oggi, ricalcolata a ogni apertura: `maxDate` di PrimeNG confronta
   * istanti e svuota il valore se la data scelta è "dopo" un `new Date()` preso al costruttore.
   */
  readonly fineGiorno = signal<Date>(fineGiornoDiOggi())
  readonly inCorso = signal(false)
  readonly errore = signal<string[]>([])
  readonly erroreClienti = signal<string | null>(null)
  readonly erroreContratti = signal<string | null>(null)
  private clienteScelto: Opzione | null = null
  private contrattoScelto: Opzione | null = null
  readonly opzioniClienti = signal<Opzione[]>([])
  readonly opzioniContratti = signal<Opzione[]>([])

  readonly msgPeriodoRovesciato = MSG_PERIODO_ROVESCIATO
  readonly msgDueAnni = MSG_PERIODO_DUE_ANNI
  readonly msgDataFutura = MSG_DATA_FUTURA
  readonly opzioniRaggruppamento: { label: string; value: Raggruppamento }[] = [
    { label: 'Un documento per contratto', value: 'PER_CONTRATTO' },
    { label: 'Un documento per elenco di addebiti', value: 'PER_ELENCO' },
  ]

  private readonly ricercaClienti$ = new Subject<Ricerca>()
  private readonly ricercaContratti$ = new Subject<Ricerca>()
  /** Cliente della ricerca contratti in corso (la ricerca segue il cliente scelto). */
  private clienteRicerca: string | null = null

  // I valori dei campi non sono signal: `errori` si ricalcola a ogni lettura (poco costoso).
  errori(): { periodoRovesciato: boolean; dueAnni: boolean; dataFutura: boolean } {
    const dal = this.periodoDal
    const al = this.periodoAl
    const doc = this.dataDocumento
    return {
      periodoRovesciato: !!dal && !!al && dal.getTime() > al.getTime(),
      dueAnni: !!dal && !!al && dal.getFullYear() !== al.getFullYear(),
      dataFutura: !!doc && doc.getTime() > this.fineGiorno().getTime(),
    }
  }

  valido(): boolean {
    const e = this.errori()
    return (
      !!this.periodoDal &&
      !!this.periodoAl &&
      !!this.dataDocumento &&
      !e.periodoRovesciato &&
      !e.dueAnni &&
      !e.dataFutura
    )
  }

  constructor() {
    // Nel costruttore, non in ngOnInit: il primo ngOnChanges (visible=true) arriva prima.
    // Un solo flusso per ricerca: la lettura nuova annulla la pendente, `null` la annulla e basta.
    this.ricercaClienti$
      .pipe(
        switchMap(t =>
          t === null
            ? EMPTY
            : (t === '' ? of(t) : of(t).pipe(debounceTime(300))).pipe(
                switchMap(x => this.leggiClienti(x))
              )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(o => {
        if (o !== null) this.opzioniClienti.set(this.conScelto(o, this.clienteScelto))
      })
    this.ricercaContratti$
      .pipe(
        switchMap(t =>
          t === null
            ? EMPTY
            : (t === '' ? of(t) : of(t).pipe(debounceTime(300))).pipe(
                switchMap(x => this.leggiContratti(x))
              )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(o => {
        if (o !== null) this.opzioniContratti.set(this.conScelto(o, this.contrattoScelto))
      })
  }

  ngOnChanges(c: SimpleChanges): void {
    if (!c['visible']) return
    this.azzera()
    if (this.visible) {
      this.fineGiorno.set(fineGiornoDiOggi())
      this.ricercaClienti$.next('')
      this.ricercaContratti$.next('')
    } else {
      // Chiusura: le GET pendenti si annullano, nessuna risposta tardiva.
      this.ricercaClienti$.next(null)
      this.ricercaContratti$.next(null)
    }
  }

  aggiornaFineGiorno(): void {
    this.fineGiorno.set(fineGiornoDiOggi())
  }

  private azzera(): void {
    this.periodoDal = null
    this.periodoAl = null
    this.dataDocumento = null
    this.raggruppamento = 'PER_CONTRATTO'
    this.includiArretrati = false
    this.clienteId = null
    this.contrattoId = null
    this.clienteRicerca = null
    this.errore.set([])
    this.erroreClienti.set(null)
    this.erroreContratti.set(null)
    this.clienteScelto = null
    this.contrattoScelto = null
    this.inCorso.set(false)
    this.opzioniClienti.set([])
    this.opzioniContratti.set([])
  }

  private leggiClienti(testo: string) {
    this.erroreClienti.set(null)
    const t = testo.trim()
    return this.clienti.clienti
      .list({ ...(t ? { testo: t } : {}), soloAttivi: true, dimensione: DIMENSIONE_RICERCA })
      .pipe(
        map(
          p =>
            p.elementi.map(c => ({
              label: c.codice ? `${c.codice} · ${c.ditta.ragioneSociale}` : c.ditta.ragioneSociale,
              value: c.id,
              partitaIva: c.ditta.partitaIva ?? '',
            })) as Opzione[]
        ),
        catchError(() => {
          this.erroreClienti.set('Impossibile caricare i clienti: riprova a cercare.')
          return of(null)
        })
      )
  }

  private leggiContratti(testo: string) {
    this.erroreContratti.set(null)
    const t = testo.trim()
    return this.clienti.contratti
      .list({
        ...(t ? { testo: t } : {}),
        ...(this.clienteRicerca ? { clienteId: this.clienteRicerca } : {}),
        dimensione: DIMENSIONE_RICERCA,
      })
      .pipe(
        map(
          p =>
            p.elementi.map(c => ({
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

  /** L'opzione scelta resta in testa all'elenco: PrimeNG mostra «Tutti» se il valore non è fra le opzioni. */
  private conScelto(o: Opzione[], scelto: Opzione | null): Opzione[] {
    return scelto && !o.some(x => x.value === scelto.value) ? [scelto, ...o] : o
  }

  cercaClienti(testo: string): void {
    this.ricercaClienti$.next(testo)
  }

  cercaContratti(testo: string): void {
    this.ricercaContratti$.next(testo)
  }

  /** Cliente scelto (o tolto): il contratto già scelto si azzera e la ricerca dei contratti lo segue. */
  scegliCliente(id: string | null): void {
    this.clienteId = id || null
    this.clienteScelto = this.opzioniClienti().find(o => o.value === this.clienteId) ?? null
    this.contrattoScelto = null
    this.clienteRicerca = this.clienteId
    this.contrattoId = null
    this.ricercaContratti$.next('')
  }

  scegliContratto(id: string | null): void {
    this.contrattoId = id || null
    this.contrattoScelto = this.opzioniContratti().find(o => o.value === this.contrattoId) ?? null
  }

  /** Il corpo della richiesta, con le date `AAAA-MM-GG`. Solo a form valido. */
  private corpo(): NuovaElaborazione {
    return {
      periodoDal: isoLocale(this.periodoDal as Date),
      periodoAl: isoLocale(this.periodoAl as Date),
      dataDocumento: isoLocale(this.dataDocumento as Date),
      raggruppamento: this.raggruppamento,
      includiArretrati: this.includiArretrati,
      filtri: {
        ...(this.clienteId ? { clienteIds: [this.clienteId] } : {}),
        ...(this.contrattoId ? { contrattoIds: [this.contrattoId] } : {}),
      },
    }
  }

  avvia(): void {
    if (!this.valido() || this.inCorso()) return
    this.inCorso.set(true)
    this.errore.set([])
    this.servizio
      .avvia(this.corpo())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.avviato.emit(r.id)
        },
        error: err => {
          this.inCorso.set(false)
          this.errore.set(messaggiErroreFatturazione(err, "Impossibile avviare l'elaborazione."))
        },
      })
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.chiuso.emit()
  }
}
