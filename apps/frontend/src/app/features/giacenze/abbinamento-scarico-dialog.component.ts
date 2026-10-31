import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Subscription } from 'rxjs'
import { SharedModule } from 'primeng/api'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { MessageModule } from 'primeng/message'
import { formattaQuantita } from '../../shared/format/formatta-quantita'
import { ToastService } from '../../core/services/toast.service'
import {
  AbbinamentiService,
  CaricoVista,
  EsitoSalvataggio,
  PropostaScarico,
  RigaDaSalvare,
  RigaVista,
  ScaricoVista,
} from './abbinamenti.service'
import { formattaGiorno } from './giorno'

export const MSG_CONFERMA_SCOLLEGA =
  'Lo scarico resta senza abbinamento; il prossimo ricalcolo lo riabbina con il FIFO.'

/** Editor dell'abbinamento di uno scarico (candidati dalla proposta del backend). */
export interface ModificaScarico {
  scarico: ScaricoVista
  unita: string
  candidati: CaricoVista[]
  proposta: PropostaScarico['proposta']
  scoperto: number
  /** Abbinamenti esistenti su carichi che non sono fra i candidati: un salvataggio li toglie. */
  righeFuori: RigaVista[]
}

export const chiaveCarico = (c: { tipo: string; id: string }): string => `${c.tipo}:${c.id}`

/** Messaggio del server (già in italiano e senza id), altrimenti quello di ripiego. */
export function messaggioErrore(e: unknown, ripiego: string): string {
  const m = (e as { error?: { message?: unknown } })?.error?.message
  if (typeof m === 'string' && m) return m
  if (Array.isArray(m) && m.length > 0) return m.join(' ')
  return ripiego
}

/**
 * Dialog dell'abbinamento manuale di uno scarico: carica la proposta FIFO, permette di
 * correggere le quantità per carico e salva. Il calcolo e i controlli veri sono del backend;
 * qui si blocca solo il totale oltre lo scarico e si mostra il messaggio del server così com'è.
 * Il chiamante imposta `visible` e `scarico` e ricarica la pagina all'evento `salvato`.
 */
@Component({
  selector: 'app-abbinamento-scarico-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    MessageModule,
    SharedModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudiDaDialog($event)"
      [header]="'Abbinamenti dello scarico n. ' + (scarico?.numero ?? '')"
      [modal]="true"
      [closable]="!inElaborazione()"
      [closeOnEscape]="!inElaborazione()"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra degli abbinamenti"
    >
      <p *ngIf="!modifica()" class="ab-nota" role="status" data-testid="caricamento-proposta">
        Caricamento della proposta...
      </p>
      <div *ngIf="modifica() as m" data-testid="editor">
        <p id="ab-ed-aiuto" class="ab-nota">
          Scarico di {{ formattaQuantita(m.scarico.quantita) }} {{ m.unita }}. Indica quanto
          prendere da ogni carico: il totale non può superare lo scarico. Se togli tutti gli
          abbinamenti, il prossimo ricalcolo riabbina lo scarico con il FIFO.
        </p>
        <p-message
          *ngIf="m.righeFuori.length > 0"
          severity="warn"
          styleClass="w-full mb-2"
          data-testid="righe-fuori"
          [text]="testoRigheFuori(m)"
        ></p-message>
        <p *ngIf="m.scoperto > 0" class="ab-nota" data-testid="scoperto">
          I carichi disponibili non coprono tutto lo scarico: con il FIFO restano scoperti
          {{ formattaQuantita(m.scoperto) }} {{ m.unita }}.
        </p>
        <div *ngFor="let c of m.candidati; let i = index" class="field ab-riga">
          <label [for]="'ab-q-' + i" [id]="'ab-q-lbl-' + i">
            {{ c.numero ? 'Carico n. ' + c.numero : 'Giacenza iniziale' }} del
            {{ formattaGiorno(c.giorno) }}, residuo {{ formattaQuantita(c.residuo) }} {{ m.unita
            }}<span
              *ngIf="classeDiversa(m, c)"
              class="ab-classe-diversa"
              [attr.data-testid]="'classe-diversa-' + i"
            >
              (classe diversa: {{ c.classe }}, attesa {{ m.scarico.classeAttesa }})</span
            >
          </label>
          <p-inputNumber
            [inputId]="'ab-q-' + i"
            mode="decimal"
            locale="it-IT"
            [minFractionDigits]="0"
            [maxFractionDigits]="3"
            [min]="0"
            [max]="c.residuo"
            [ngModel]="quantitaDi(c)"
            (ngModelChange)="impostaQuantita(c, $event)"
            [ariaLabelledBy]="'ab-q-lbl-' + i + ' ab-ed-aiuto'"
            [attr.data-testid]="'quantita-' + i"
          ></p-inputNumber>
        </div>
        <p *ngIf="m.candidati.length === 0" class="ab-nota">
          Nessun carico disponibile per questo scarico.
        </p>
        <p class="ab-nota" aria-live="polite" data-testid="totale">
          Totale abbinato: {{ formattaQuantita(totaleModifica()) }} di
          {{ formattaQuantita(m.scarico.quantita) }} {{ m.unita }}
        </p>
        <p *ngIf="superaScarico()" class="field-error" role="alert" data-testid="supera-scarico">
          Il totale abbinato supera la quantità dello scarico.
        </p>
        <p *ngIf="erroreModifica()" class="field-error" role="alert" data-testid="errore-modifica">
          {{ erroreModifica() }}
        </p>
        <div
          *ngIf="confermaScollega()"
          role="alertdialog"
          aria-labelledby="ab-scollega-testo"
          data-testid="conferma-scollega"
          (keydown.escape)="annullaScollega($event)"
        >
          <p id="ab-scollega-testo" class="ab-nota">{{ msgConfermaScollega }}</p>
          <p-button
            label="Sì, scollega"
            severity="danger"
            size="small"
            [loading]="inElaborazione()"
            (onClick)="scollega()"
            data-testid="scollega-conferma"
            ariaLabel="Conferma lo scollegamento dello scarico"
          ></p-button>
          <p-button
            label="No"
            [text]="true"
            size="small"
            (onClick)="annullaScollega()"
            data-testid="scollega-annulla"
            ariaLabel="Annulla lo scollegamento"
          ></p-button>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <ng-container *ngIf="modifica()">
          <p-button
            label="Usa la proposta FIFO"
            [outlined]="true"
            size="small"
            [disabled]="inElaborazione()"
            (onClick)="usaProposta()"
            data-testid="usa-proposta"
          ></p-button>
          <p-button
            label="Scollega lo scarico"
            severity="danger"
            [text]="true"
            size="small"
            [disabled]="inElaborazione()"
            (onClick)="chiediScollega()"
            data-testid="scollega"
          ></p-button>
          <p-button
            label="Annulla"
            [text]="true"
            size="small"
            [disabled]="inElaborazione()"
            (onClick)="chiudi()"
            data-testid="annulla-modifica"
          ></p-button>
          <p-button
            label="Salva"
            size="small"
            [loading]="inElaborazione()"
            [disabled]="superaScarico()"
            (onClick)="salvaModifica()"
            data-testid="salva-modifica"
          ></p-button>
        </ng-container>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .ab-nota {
        color: var(--text-color-secondary);
      }
      .ab-riga {
        margin-bottom: var(--spacing-sm);
      }
      .ab-classe-diversa {
        font-weight: 600;
      }
    `,
  ],
})
export class AbbinamentoScaricoDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(AbbinamentiService)
  private readonly toast = inject(ToastService)
  private readonly destroyRef = inject(DestroyRef)

  @Input() visible = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Input() scarico: ScaricoVista | null = null
  @Input() unita = ''
  /** Emesso dopo un salvataggio riuscito (il dialog si chiude da solo). */
  @Output() salvato = new EventEmitter<EsitoSalvataggio>()

  readonly modifica = signal<ModificaScarico | null>(null)
  readonly erroreModifica = signal<string | null>(null)
  readonly inElaborazione = signal(false)
  readonly confermaScollega = signal(false)
  private readonly quantite = signal<Record<string, number | null>>({})
  private propostaSub?: Subscription

  readonly msgConfermaScollega = MSG_CONFERMA_SCOLLEGA
  readonly formattaQuantita = formattaQuantita
  readonly formattaGiorno = formattaGiorno

  readonly totaleModifica = computed(() => {
    const m = this.modifica()
    if (!m) return 0
    const mill = m.candidati.reduce(
      (t, c) => t + Math.round((this.quantite()[chiaveCarico(c)] ?? 0) * 1000),
      0
    )
    return mill / 1000
  })
  readonly superaScarico = computed(() => {
    const m = this.modifica()
    return !!m && Math.round(this.totaleModifica() * 1000) > Math.round(m.scarico.quantita * 1000)
  })

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible']) {
      if (this.visible && this.scarico) this.apri(this.scarico)
      else this.azzera()
    }
  }

  ngOnDestroy(): void {
    this.propostaSub?.unsubscribe()
  }

  private azzera(): void {
    this.propostaSub?.unsubscribe()
    this.confermaScollega.set(false)
    this.inElaborazione.set(false)
    this.modifica.set(null)
    this.erroreModifica.set(null)
  }

  private apri(s: ScaricoVista): void {
    this.azzera()
    this.propostaSub = this.servizio
      .proposta(s.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: p => {
          const iniziali: Record<string, number | null> = {}
          for (const r of p.scarico.righe) iniziali[chiaveCarico(r.carico)] = r.quantita
          this.quantite.set(iniziali)
          this.modifica.set({
            scarico: p.scarico,
            unita: this.unita,
            candidati: p.candidati,
            proposta: p.proposta,
            scoperto: p.scoperto,
            righeFuori: p.scarico.righe.filter(
              r => !p.candidati.some(c => chiaveCarico(c) === chiaveCarico(r.carico))
            ),
          })
          setTimeout(() => document.getElementById('ab-q-0')?.focus())
        },
        error: e => {
          this.toast.error(messaggioErrore(e, 'Impossibile caricare la proposta.'))
          this.visibleChange.emit(false)
        },
      })
  }

  /** La classe del carico è nota e non è quella attesa dallo scarico. */
  classeDiversa(m: ModificaScarico, c: CaricoVista): boolean {
    return !!c.classe && !!m.scarico.classeAttesa && c.classe !== m.scarico.classeAttesa
  }

  quantitaDi(c: CaricoVista): number | null {
    return this.quantite()[chiaveCarico(c)] ?? null
  }

  impostaQuantita(c: CaricoVista, q: number | null): void {
    this.quantite.update(m => ({ ...m, [chiaveCarico(c)]: q }))
  }

  usaProposta(): void {
    const m = this.modifica()
    if (!m) return
    const nuove: Record<string, number | null> = {}
    for (const r of m.proposta) nuove[chiaveCarico(r.carico)] = r.quantita
    this.quantite.set(nuove)
  }

  salvaModifica(): void {
    const m = this.modifica()
    if (!m || this.superaScarico()) return
    const righe: RigaDaSalvare[] = []
    for (const c of m.candidati) {
      const q = this.quantite()[chiaveCarico(c)]
      if (q && q > 0) {
        righe.push(
          c.tipo === 'MOVIMENTO'
            ? { caricoId: c.id, quantita: q }
            : { giacenzaInizialeId: c.id, quantita: q }
        )
      }
    }
    this.invia(m.scarico.id, righe)
  }

  chiediScollega(): void {
    this.confermaScollega.set(true)
    setTimeout(() =>
      document.querySelector<HTMLElement>('[data-testid="scollega-conferma"] button')?.focus()
    )
  }

  annullaScollega(evento?: Event): void {
    // Esc annulla solo la conferma: non deve arrivare al dialog che si chiuderebbe.
    evento?.stopPropagation()
    this.confermaScollega.set(false)
    setTimeout(() =>
      document.querySelector<HTMLElement>('[data-testid="scollega"] button')?.focus()
    )
  }

  scollega(): void {
    const m = this.modifica()
    this.confermaScollega.set(false)
    if (m) this.invia(m.scarico.id, [])
  }

  testoRigheFuori(m: ModificaScarico): string {
    const elenco = m.righeFuori
      .map(r => `${r.carico.numero ?? 'giacenza iniziale'} (${formattaQuantita(r.quantita)})`)
      .join(', ')
    return `Questi abbinamenti esistenti non sono fra i carichi disponibili e non si possono modificare qui: ${elenco}. Se salvi, vengono tolti.`
  }

  private invia(scaricoId: string, righe: RigaDaSalvare[]): void {
    this.inElaborazione.set(true)
    this.erroreModifica.set(null)
    this.servizio
      .salva(scaricoId, righe)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: esito => {
          this.inElaborazione.set(false)
          this.toast.success('Abbinamenti dello scarico salvati.')
          this.salvato.emit(esito)
          this.visibleChange.emit(false)
        },
        error: e => {
          this.inElaborazione.set(false)
          this.erroreModifica.set(messaggioErrore(e, 'Impossibile salvare gli abbinamenti.'))
        },
      })
  }

  chiudi(): void {
    this.visibleChange.emit(false)
  }

  /** Chiusura dal dialog (X, Esc): mai durante un salvataggio. */
  chiudiDaDialog(aperto: boolean): void {
    if (!aperto && this.inElaborazione()) return
    this.visibleChange.emit(aperto)
  }
}
