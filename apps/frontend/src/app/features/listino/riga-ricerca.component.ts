import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { InputTextModule } from 'primeng/inputtext'
import { Observable, Subject, catchError, debounceTime, of, switchMap } from 'rxjs'

/** Una voce proposta dalla ricerca: `dato` è l'oggetto originale (CER, addebito). */
export interface VoceRicerca<T = unknown> {
  chiave: string
  etichetta: string
  dato: T
}

/**
 * Campo di ricerca con elenco dei risultati (da due caratteri). Esc chiude l'elenco senza chiudere
 * il dialog. La ricerca è una funzione del chiamante: il catalogo CER, l'archivio degli addebiti.
 */
@Component({
  selector: 'app-riga-ricerca',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule],
  template: `
    <input
      pInputText
      type="search"
      autocomplete="off"
      [id]="inputId"
      [name]="inputId"
      [placeholder]="segnaposto"
      [attr.aria-label]="ariaLabel || null"
      [attr.aria-controls]="voci().length > 0 ? inputId + '-risultati' : null"
      [ngModel]="testo()"
      (ngModelChange)="digita($event)"
      (keydown.escape)="chiudiElenco($event)"
      [disabled]="disabilitato"
      [attr.data-testid]="testid"
    />
    <small *ngIf="messaggio() as m" role="status" class="field-hint">{{ m }}</small>
    <ul
      *ngIf="voci().length > 0"
      class="risultati"
      [id]="inputId + '-risultati'"
      [attr.data-testid]="testid + '-risultati'"
    >
      <li *ngFor="let v of voci()">
        <button type="button" (click)="scegli(v)" [attr.data-testid]="testid + '-voce-' + v.chiave">
          {{ v.etichetta }}
        </button>
      </li>
    </ul>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }
      .risultati {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 12rem;
        overflow-y: auto;
        border: 1px solid var(--surface-border, #ccc);
        border-radius: 4px;
      }
      .risultati button {
        width: 100%;
        text-align: left;
        padding: 0.4rem 0.6rem;
        background: transparent;
        border: 0;
        cursor: pointer;
        font: inherit;
        color: inherit;
      }
      .risultati button:hover,
      .risultati button:focus-visible {
        background: var(--surface-hover, #eee);
      }
    `,
  ],
})
export class RigaRicercaComponent implements OnInit {
  private readonly distrutto = inject(DestroyRef)
  private readonly richieste = new Subject<string>()

  @Input({ required: true }) inputId!: string
  @Input({ required: true }) testid!: string
  @Input({ required: true }) cerca!: (testo: string) => Observable<VoceRicerca[]>
  @Input() segnaposto = 'Scrivi almeno due caratteri'
  @Input() ariaLabel = ''
  @Input() disabilitato = false
  @Output() scelta = new EventEmitter<VoceRicerca>()

  readonly testo = signal('')
  readonly voci = signal<VoceRicerca[]>([])
  readonly messaggio = signal<string | null>(null)

  ngOnInit(): void {
    this.richieste
      .pipe(
        debounceTime(250),
        switchMap(t =>
          t.trim().length < 2
            ? of<VoceRicerca[] | null>([])
            : this.cerca(t.trim()).pipe(catchError(() => of(null)))
        ),
        takeUntilDestroyed(this.distrutto)
      )
      .subscribe(r => {
        this.messaggio.set(r === null ? 'Ricerca non riuscita: riprova.' : null)
        this.voci.set(r ?? [])
        if (r !== null && r.length === 0 && this.testo().trim().length >= 2) {
          this.messaggio.set('Nessun risultato.')
        }
      })
  }

  digita(t: string): void {
    this.testo.set(t)
    this.richieste.next(t)
  }

  scegli(v: VoceRicerca): void {
    this.testo.set('')
    this.voci.set([])
    this.messaggio.set(null)
    this.scelta.emit(v)
  }

  /** Con l'elenco aperto Esc lo chiude; a elenco chiuso passa al dialog. */
  chiudiElenco(ev: Event): void {
    if (this.voci().length === 0 && !this.messaggio()) return
    ev.stopPropagation()
    this.voci.set([])
    this.messaggio.set(null)
  }
}
