import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { Subscription } from 'rxjs'
import { Cliente, ContrattoCliente } from '../clienti/clienti.model'
import { ClientiService } from '../clienti/clienti.service'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { SceltaClienteComponent } from '../contratti-cliente/scelta-cliente.component'
import { ElencoAddebiti } from './listino.model'
import { ListinoService } from './listino.service'

/**
 * Scelta dell'elenco di origine di una copia (D18): cliente, poi uno dei suoi contratti, poi uno
 * degli elenchi del contratto. Qualunque cliente e contratto non eliminato dell'azienda; l'elenco
 * di arrivo (`escludiElencoId`) non si propone: il backend rifiuta comunque la copia su sé stesso.
 * Emette l'elenco scelto, `null` appena la catena si rompe. Le tre letture hanno ciascuna il suo
 * errore: un contratto che non si legge non cancella la scelta del cliente.
 */
@Component({
  selector: 'app-scelta-elenco-origine',
  standalone: true,
  imports: [CommonModule, SceltaClienteComponent],
  template: `
    <app-scelta-cliente
      *ngIf="visibile"
      [prefisso]="prefisso + '-cliente'"
      [prefissoNuovo]="prefisso + '-cliente-nuovo'"
      etichetta="Cliente di origine"
      (scelto)="sceltoCliente($event)"
    />
    <p
      *ngIf="erroreContratti() as e"
      role="alert"
      class="field-error"
      [attr.data-testid]="prefisso + '-errore-contratti'"
    >
      {{ e }}
    </p>
    <p
      *ngIf="avvisoContratti() as a"
      role="status"
      class="field-hint"
      [attr.data-testid]="prefisso + '-avviso-contratti'"
    >
      {{ a }}
    </p>
    <ng-container *ngIf="contratti() !== null">
      <label [for]="prefisso + '-contratto'">Contratto</label>
      <select
        class="p-inputtext"
        [id]="prefisso + '-contratto'"
        (change)="sceltoContratto($any($event.target).value)"
        [attr.data-testid]="prefisso + '-contratto'"
      >
        <option value="">—</option>
        <option *ngFor="let c of contratti()" [value]="c.id">
          {{ c.numero }}{{ c.descrizione ? ' - ' + c.descrizione : '' }}
        </option>
      </select>
      <p
        *ngIf="contratti()?.length === 0"
        class="field-hint"
        [attr.data-testid]="prefisso + '-nessun-contratto'"
      >
        Il cliente non ha contratti.
      </p>
    </ng-container>
    <p
      *ngIf="erroreElenchi() as e"
      role="alert"
      class="field-error"
      [attr.data-testid]="prefisso + '-errore-elenchi'"
    >
      {{ e }}
    </p>
    <ng-container *ngIf="elenchi() !== null">
      <label [for]="prefisso + '-elenco'">Elenco</label>
      <select
        class="p-inputtext"
        [id]="prefisso + '-elenco'"
        (change)="sceltoElenco($any($event.target).value)"
        [attr.data-testid]="prefisso + '-elenco'"
      >
        <option value="">—</option>
        <option *ngFor="let e of elenchi()" [value]="e.id">
          {{ e.codice }} - {{ e.descrizione }} ({{ e.righe }} righe)
        </option>
      </select>
      <p
        *ngIf="elenchi()?.length === 0"
        class="field-hint"
        [attr.data-testid]="prefisso + '-nessun-elenco'"
      >
        Il contratto non ha altri elenchi.
      </p>
    </ng-container>
  `,
  styles: [':host { display: flex; flex-direction: column; gap: 0.5rem; }'],
})
export class SceltaElencoOrigineComponent implements OnChanges, OnDestroy {
  private readonly clienti = inject(ClientiService)
  private readonly listino = inject(ListinoService)

  @Input() prefisso = 'origine'
  @Input() escludiElencoId: string | null = null
  /** Cambia a ogni apertura del dialog: la scelta riparte da zero. */
  @Input() azzera = 0
  @Output() scelto = new EventEmitter<ElencoAddebiti | null>()

  readonly contratti = signal<ContrattoCliente[] | null>(null)
  readonly elenchi = signal<ElencoAddebiti[] | null>(null)
  readonly erroreContratti = signal<string | null>(null)
  /** Informazione, non errore: i contratti oltre il limite di lettura non sono nell'elenco. */
  readonly avvisoContratti = signal<string | null>(null)
  readonly erroreElenchi = signal<string | null>(null)
  private letturaContratti?: Subscription
  private letturaElenchi?: Subscription
  private tutti: ElencoAddebiti[] = []

  /** Il cliente si ricrea a ogni azzeramento: il suo campo di testo non ha un reset proprio (M5). */
  visibile = true

  ngOnChanges(c: SimpleChanges): void {
    if (c['azzera'] && !c['azzera'].firstChange) {
      this.svuota()
      this.visibile = false
      queueMicrotask(() => (this.visibile = true))
    }
  }

  ngOnDestroy(): void {
    this.letturaContratti?.unsubscribe()
    this.letturaElenchi?.unsubscribe()
  }

  private svuota(): void {
    this.letturaContratti?.unsubscribe()
    this.letturaElenchi?.unsubscribe()
    this.contratti.set(null)
    this.elenchi.set(null)
    this.erroreContratti.set(null)
    this.avvisoContratti.set(null)
    this.erroreElenchi.set(null)
    this.tutti = []
  }

  sceltoCliente(cliente: Cliente | null): void {
    this.svuota()
    this.scelto.emit(null)
    if (!cliente) return
    this.letturaContratti = this.clienti.contratti
      .list({ clienteId: cliente.id, pagina: 1, dimensione: 100 })
      .subscribe({
        next: p => {
          this.contratti.set(p.elementi)
          if (p.totale > p.elementi.length) {
            this.avvisoContratti.set(
              `Il cliente ha ${p.totale} contratti: ne sono mostrati solo i primi ${p.elementi.length}.`
            )
          }
        },
        error: err =>
          this.erroreContratti.set(
            messaggioErrore(err, 'Impossibile caricare i contratti del cliente.')
          ),
      })
  }

  sceltoContratto(id: string): void {
    this.letturaElenchi?.unsubscribe()
    this.elenchi.set(null)
    this.erroreElenchi.set(null)
    this.tutti = []
    this.scelto.emit(null)
    if (!id) return
    this.letturaElenchi = this.listino.elenchi.delContratto(id).subscribe({
      next: r => {
        this.tutti = r.elenchi.filter(e => e.id !== this.escludiElencoId)
        this.elenchi.set(this.tutti)
      },
      error: err =>
        this.erroreElenchi.set(
          messaggioErrore(err, 'Impossibile caricare gli elenchi del contratto.')
        ),
    })
  }

  sceltoElenco(id: string): void {
    this.scelto.emit(this.tutti.find(e => e.id === id) ?? null)
  }
}
