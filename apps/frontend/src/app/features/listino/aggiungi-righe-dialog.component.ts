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
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { Subscription } from 'rxjs'
import { messaggioErrore } from '../clienti/tabelle/tabella-comune'
import { righeEscluse } from './copia-elenco-dialog.component'
import { leggiErroriAzione } from './errori-azione'
import { ElencoAddebiti, EsitoCopia, RigaAddebito } from './listino.model'
import { ListinoService } from './listino.service'
import { SceltaElencoOrigineComponent } from './scelta-elenco-origine.component'

/**
 * Aggiungi righe da un altro elenco (F9/F7 di WinWaste): si sceglie l'elenco di origine, poi le
 * righe da ricopiare; il backend le aggiunge in coda saltando i duplicati e le righe che
 * violerebbero le regole di condizione, e restituisce i conteggi (R45). Le righe già nell'elenco di
 * arrivo non si tolgono mai. Stessi 409 e stessa regola di Esc del dialog di copia.
 */
@Component({
  selector: 'app-aggiungi-righe-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, SceltaElencoOrigineComponent],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Aggiungi righe da un altro elenco"
      [modal]="true"
      [closable]="!inCorso()"
      [style]="{ width: '48rem' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <div *ngIf="esito() as e" class="dlg-form" role="status" data-testid="aggiungi-esito">
        <p>Righe aggiunte: {{ e.copiate }}.</p>
        <p *ngIf="escluse().length > 0" data-testid="aggiungi-escluse">
          Non aggiunte: {{ escluse().join(', ') }}.
        </p>
      </div>

      <div *ngIf="!esito()" class="dlg-form">
        <app-scelta-elenco-origine
          prefisso="aggiungi-origine"
          [escludiElencoId]="elenco?.id ?? null"
          [azzera]="aperture"
          (scelto)="sceltaOrigine($event)"
        />
        <p
          *ngIf="erroreRighe() as e"
          role="alert"
          class="field-error"
          data-testid="aggiungi-errore-righe"
        >
          {{ e }}
        </p>
        <ng-container *ngIf="righe() as elencoRighe">
          <p
            *ngIf="elencoRighe.length === 0"
            class="field-hint"
            data-testid="aggiungi-nessuna-riga"
          >
            L'elenco non ha righe.
          </p>
          <ng-container *ngIf="elencoRighe.length > 0">
            <label class="spunta">
              <input
                type="checkbox"
                [checked]="tutteScelte()"
                (change)="sceltaTutte($any($event.target).checked)"
                data-testid="aggiungi-tutte"
              />
              Seleziona tutte
            </label>
            <ul class="righe" data-testid="aggiungi-righe">
              <li *ngFor="let r of elencoRighe">
                <label class="spunta">
                  <input
                    type="checkbox"
                    [checked]="scelte().has(r.id)"
                    (change)="scegli(r.id, $any($event.target).checked)"
                    [attr.data-testid]="'aggiungi-riga-' + r.id"
                  />
                  {{ r.cerCode ?? r.addebito?.codice ?? r.tipo }} -
                  {{ r.descrizione ?? r.addebito?.descrizione }}
                </label>
              </li>
            </ul>
          </ng-container>
        </ng-container>
      </div>

      <ul
        *ngIf="errori().length > 0"
        role="alert"
        class="field-error"
        data-testid="aggiungi-errore"
      >
        <li *ngFor="let m of errori()">{{ m }}</li>
      </ul>

      <ng-template pTemplate="footer">
        <p-button
          *ngIf="conflitto()"
          label="Ricarica"
          icon="pi pi-refresh"
          [outlined]="true"
          (onClick)="ricarica.emit()"
          data-testid="aggiungi-ricarica"
        />
        <p-button
          [label]="esito() ? 'Chiudi' : 'Annulla'"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="aggiungi-chiudi"
        />
        <p-button
          *ngIf="!esito()"
          [label]="'Aggiungi ' + scelte().size + (scelte().size === 1 ? ' riga' : ' righe')"
          icon="pi pi-check"
          [disabled]="inCorso() || scelte().size === 0"
          (onClick)="aggiungi()"
          data-testid="aggiungi-conferma"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .righe {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: 16rem;
        overflow: auto;
      }
      .spunta {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
    `,
  ],
})
export class AggiungiRigheDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)

  @Input() visible = false
  /** L'elenco di arrivo. */
  @Input() elenco: ElencoAddebiti | null = null
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() aggiunte = new EventEmitter<EsitoCopia>()
  @Output() ricarica = new EventEmitter<void>()

  aperture = 0
  readonly righe = signal<RigaAddebito[] | null>(null)
  readonly scelte = signal<ReadonlySet<string>>(new Set())
  readonly erroreRighe = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly esito = signal<EsitoCopia | null>(null)
  readonly escluse = signal<string[]>([])
  readonly errori = signal<string[]>([])
  readonly conflitto = signal(false)
  private lettura?: Subscription
  private richiesta?: Subscription

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) {
      this.lettura?.unsubscribe()
      this.richiesta?.unsubscribe()
      this.aperture++
      this.righe.set(null)
      this.scelte.set(new Set())
      this.erroreRighe.set(null)
      this.inCorso.set(false)
      this.esito.set(null)
      this.escluse.set([])
      this.errori.set([])
      this.conflitto.set(false)
    }
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
    this.richiesta?.unsubscribe()
  }

  sceltaOrigine(origine: ElencoAddebiti | null): void {
    this.lettura?.unsubscribe()
    this.righe.set(null)
    this.scelte.set(new Set())
    this.erroreRighe.set(null)
    if (!origine) return
    this.lettura = this.servizio.righe.list(origine.id).subscribe({
      next: r => this.righe.set(r),
      error: err =>
        this.erroreRighe.set(messaggioErrore(err, "Impossibile caricare le righe dell'elenco.")),
    })
  }

  tutteScelte(): boolean {
    const r = this.righe()
    return !!r && r.length > 0 && this.scelte().size === r.length
  }

  sceltaTutte(si: boolean): void {
    this.scelte.set(new Set(si ? (this.righe() ?? []).map(r => r.id) : []))
  }

  scegli(id: string, si: boolean): void {
    const n = new Set(this.scelte())
    if (si) n.add(id)
    else n.delete(id)
    this.scelte.set(n)
  }

  aggiungi(): void {
    const arrivo = this.elenco
    if (!arrivo || this.inCorso() || this.scelte().size === 0) return
    this.inCorso.set(true)
    this.errori.set([])
    this.conflitto.set(false)
    this.richiesta = this.servizio.azioni
      .aggiungiRighe(arrivo.id, [...this.scelte()], arrivo.versione)
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.esito.set(r)
          this.escluse.set(righeEscluse(r.escluse))
          this.aggiunte.emit(r)
        },
        error: err => {
          const e = leggiErroriAzione(err, 'Impossibile aggiungere le righe.')
          this.inCorso.set(false)
          this.errori.set(e.messaggi)
          this.conflitto.set(e.conflitto)
        },
      })
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.visibleChange.emit(false)
  }
}
