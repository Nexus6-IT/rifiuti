/**
 * Scelta della pesata «Da strumento»: l'elenco delle letture libere dell'agente di pesa (ultime
 * 24 ore) per la sede, aggiornato ogni 5 secondi finche' il componente e' in vita (chiuso il
 * dialog, il timer si ferma). Il peso arriva firmato dall'agente e NON si digita: si sceglie una
 * riga e si manda solo `letturaId`. Una lettura non utilizzabile (usata, vecchia o con firma non
 * verificata) resta visibile ma non si sceglie.
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  NgZone,
  OnInit,
  Output,
  inject,
  signal,
} from '@angular/core'
import { dataOraItaliana, formattaKg, messaggioErrorePese } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { AgenteVista, LetturaVista, PeseService } from './pese.service'

export const INTERVALLO_LETTURE_MS = 5000
export const MESSAGGIO_NESSUNA_LETTURA = 'Nessuna lettura dallo strumento nelle ultime 24 ore.'

/** C'e' almeno un agente attivo con uno strumento assegnato, per la sede (o per tutta l'azienda). */
export function haStrumentoConAgente(agenti: AgenteVista[], registroId: string | null): boolean {
  return agenti.some(
    a =>
      a.stato === 'ATTIVO' &&
      a.strumenti.length > 0 &&
      (!registroId || !a.registro || a.registro.id === registroId)
  )
}

@Component({
  selector: 'app-letture-strumento',
  standalone: true,
  imports: [CommonModule],
  template: `
    <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="ls-errore">{{ e }}</p>
    <p
      *ngIf="caricato() && !righe().length && !errore()"
      class="nota"
      role="status"
      data-testid="ls-vuota"
    >
      {{ messaggioVuoto }}
    </p>
    <fieldset class="ls-elenco" *ngIf="righe().length" data-testid="ls-elenco">
      <legend class="etichetta">Letture dello strumento (la più recente per prima)</legend>
      <label
        class="ls-riga"
        *ngFor="let l of righe()"
        [class.ls-spenta]="!l.utilizzabile || !l.firmaValida"
        [attr.data-testid]="'ls-riga-' + l.id"
      >
        <input
          type="radio"
          [name]="idPrefisso + '-lettura'"
          [value]="l.id"
          [checked]="scelta() === l.id"
          [disabled]="!sceglibile(l)"
          (change)="scegli(l.id)"
          [attr.data-testid]="'ls-scegli-' + l.id"
        />
        <span class="ls-peso">{{ kg(l.pesoKg) }}</span>
        <span class="ls-dettagli">
          {{ l.strumento.descrizione }}
          <span *ngIf="l.alibiId"> · alibi {{ l.alibiId }}</span>
          · strumento {{ l.oraStrumento ? ora(l.oraStrumento) : 'senza ora' }} · PC
          {{ ora(l.oraAgente) }}
        </span>
        <span class="ls-badge">
          <span class="badge badge-simulata" *ngIf="l.simulata" data-testid="ls-simulata"
            >Simulata</span
          >
          <span class="badge" *ngIf="differita(l)" data-testid="ls-differita">In differita</span>
          <span class="badge badge-ko" *ngIf="!l.firmaValida">Firma non verificata</span>
          <span class="badge" *ngIf="l.usataIn">Già usata ({{ l.usataIn.numero }})</span>
          <span class="badge" *ngIf="!l.utilizzabile && !l.usataIn">Oltre 24 ore</span>
        </span>
      </label>
    </fieldset>
  `,
  styles: [
    STILI_PESE,
    `
      .ls-elenco {
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm) var(--spacing-base);
        margin: 0 0 var(--spacing-base);
      }
      .ls-riga {
        display: grid;
        grid-template-columns: auto max-content 1fr;
        gap: var(--spacing-xs) var(--spacing-sm);
        align-items: baseline;
        padding: var(--spacing-xs) 0;
        border-bottom: 1px solid var(--surface-border);
        cursor: pointer;
      }
      .ls-riga:last-child {
        border-bottom: 0;
      }
      .ls-spenta {
        color: var(--text-secondary);
        cursor: default;
      }
      .ls-peso {
        font-weight: var(--font-weight-semibold);
        font-variant-numeric: tabular-nums;
      }
      .ls-dettagli {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .ls-badge {
        grid-column: 2 / -1;
      }
      .badge {
        display: inline-block;
        padding: 0 var(--spacing-sm);
        margin-right: var(--spacing-xs);
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
      }
      .badge-ko {
        color: var(--color-danger);
      }
      .badge-simulata {
        color: var(--badge-simulata-ink, #6d28d9);
      }
    `,
  ],
})
export class LettureStrumentoComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly zona = inject(NgZone)
  private readonly distrutto = inject(DestroyRef)

  /** Sede dell'accesso: le letture sono quelle degli strumenti della sede e di tutta l'azienda. */
  @Input() registroId: string | null = null
  @Input() idPrefisso = 'ls'
  /** Lettura scelta (`null` = nessuna): il padre la manda al backend come `letturaId`. */
  @Output() letturaScelta = new EventEmitter<string | null>()

  readonly righe = signal<LetturaVista[]>([])
  readonly scelta = signal<string | null>(null)
  readonly caricato = signal(false)
  readonly errore = signal<string | null>(null)
  readonly messaggioVuoto = MESSAGGIO_NESSUNA_LETTURA
  readonly kg = formattaKg
  readonly ora = dataOraItaliana

  ngOnInit(): void {
    this.aggiorna()
    // Fuori dalla zona: il timer non tiene "instabile" l'app; si ferma con il componente.
    const timer = this.zona.runOutsideAngular(() =>
      setInterval(() => this.zona.run(() => this.aggiorna()), INTERVALLO_LETTURE_MS)
    )
    this.distrutto.onDestroy(() => clearInterval(timer))
  }

  sceglibile = (l: LetturaVista): boolean => l.utilizzabile && l.firmaValida

  differita = (l: LetturaVista): boolean =>
    l.avvisi.some(a => a.startsWith('Trasmessa in differita'))

  scegli(id: string): void {
    this.scelta.set(id)
    this.letturaScelta.emit(id)
  }

  private aggiorna(): void {
    this.pese
      .elencaLetture({ ...(this.registroId ? { registroId: this.registroId } : {}), libere: true })
      .subscribe({
        next: e => {
          this.righe.set(e.righe)
          this.errore.set(null)
          this.caricato.set(true)
          const s = this.scelta()
          // La lettura scelta e' sparita (usata da un altro operatore, scaduta): si azzera.
          if (s && !e.righe.some(l => l.id === s && this.sceglibile(l))) {
            this.scelta.set(null)
            this.letturaScelta.emit(null)
          }
        },
        error: err => {
          this.caricato.set(true)
          this.errore.set(
            messaggioErrorePese(err, 'Impossibile leggere le letture dello strumento.')
          )
        },
      })
  }
}
