/**
 * Emissione in serie dei FIR dei ritiri (4.7, T17): il dialog esegue il ciclo (uno alla volta, in
 * ordine) con una barra di avanzamento e l'esito per riga. Si ferma alla prima mancanza di firma o
 * di certificato (o errore del server) con un messaggio chiaro; le righe non tentate restano «Non
 * tentato». Il ciclo parte all'apertura; «Interrompi» lo ferma fra una riga e l'altra: la richiesta
 * già partita non si annulla (il server la completa comunque) e la riga mostra il suo esito vero.
 */
import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnDestroy,
  OnInit,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core'
import { RouterLink } from '@angular/router'
import { Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { PillolaStatoComponent } from '../../shared/components/pillola-stato.component'
import { TonoStato } from '../../shared/models/stati-fir'
import { FirService } from '../fir/fir.service'
import { emettiInSerie, EsitoEmissione, RigaEmissione } from './emissione-serie'
import { dataItaliana, RitiroVista } from './ritiri.model'

const TESTO: Record<EsitoEmissione | 'NON_TENTATO', string> = {
  EMESSO: 'Emesso',
  GIA_EMESSO: 'Già emesso',
  ERRORE: 'Errore',
  NON_TENTATO: 'Non tentato',
}
const TONO: Record<EsitoEmissione | 'NON_TENTATO', TonoStato> = {
  EMESSO: 'ok',
  GIA_EMESSO: 'none',
  ERRORE: 'err',
  NON_TENTATO: 'warn',
}

@Component({
  selector: 'app-emissione-serie-dialog',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonModule, DialogModule, PillolaStatoComponent],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiudi()"
      header="Emissione dei FIR"
      [modal]="true"
      [closable]="finito()"
      [closeOnEscape]="finito()"
      [style]="{ width: '860px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi l'emissione"
    >
      <p class="riepilogo" role="status" data-testid="em-riepilogo">
        <ng-container *ngIf="!finito()">
          Emissione in corso: {{ tentate() }} di {{ righe().length }}.
        </ng-container>
        <ng-container *ngIf="finito()">
          {{ conteggio('EMESSO') }} emessi, {{ conteggio('GIA_EMESSO') }} già emessi,
          {{ conteggio('ERRORE') }} con errore, {{ nonTentate() }} non tentati.
        </ng-container>
      </p>
      <progress
        class="barra"
        [value]="tentate()"
        [max]="righe().length"
        aria-label="Avanzamento dell'emissione"
        data-testid="em-barra"
      ></progress>
      <p *ngIf="stop() as s" role="alert" class="errore-stop" data-testid="em-stop">{{ s }}</p>
      <div class="table-responsive">
        <table class="tabella" data-testid="em-tabella">
          <caption class="solo-lettori">
            Esito per FIR
          </caption>
          <thead>
            <tr>
              <th scope="col">Ritiro</th>
              <th scope="col">Esito</th>
              <th scope="col">Dettaglio</th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let r of righe()" [attr.data-testid]="'em-riga-' + r.ritiroId">
              <td>{{ descrizione(r.ritiroId) }}</td>
              <td>
                <app-pillola-stato [tono]="tono(r)" [testo]="testo(r)" />
              </td>
              <td>
                <a
                  [routerLink]="['/fir', r.firId]"
                  [attr.aria-label]="'Apri il FIR del ritiro ' + descrizione(r.ritiroId)"
                  >Apri il FIR</a
                >
                <span *ngIf="r.messaggio" class="errore">{{ r.messaggio }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="azioni">
        <p-button
          *ngIf="!finito()"
          label="Interrompi"
          [outlined]="true"
          [disabled]="interrompendo()"
          (onClick)="interrompi()"
          data-testid="em-interrompi"
        ></p-button>
        <p-button
          *ngIf="finito()"
          label="Chiudi"
          styleClass="wf-primario"
          (onClick)="chiudi()"
          data-testid="em-chiudi"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .riepilogo {
        margin: 0 0 var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .barra {
        width: 100%;
        height: 0.5rem;
        margin-bottom: var(--spacing-base);
      }
      .errore-stop {
        color: var(--color-danger);
        font-weight: var(--font-weight-medium);
      }
      .tabella {
        width: 100%;
        border-collapse: collapse;
      }
      .tabella th,
      .tabella td {
        text-align: left;
        padding: var(--spacing-sm);
        border-bottom: 1px solid var(--rule);
        vertical-align: middle;
      }
      .tabella th {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-medium);
        color: var(--text-tertiary);
      }
      .errore {
        display: block;
        color: var(--color-danger);
      }
      .solo-lettori {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
      .azioni {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--spacing-base);
      }
    `,
  ],
})
export class EmissioneSerieDialogComponent implements OnInit, OnDestroy {
  private readonly fir = inject(FirService)
  private sub: Subscription | null = null
  private avviato = false
  private interrotto = false

  /** I ritiri da emettere: servono solo `id`, il FIR e la descrizione. */
  @Input({ required: true }) set ritiri(v: RitiroVista[]) {
    // Fotografia presa una volta sola: il ciclo lavora per indice, un nuovo input a metà strada
    // (elenco ricaricato) non deve riscrivere le righe.
    if (this.avviato) return
    this._ritiri = v
    this.righe.set(
      v
        .filter((r): r is RitiroVista & { fir: NonNullable<RitiroVista['fir']> } => r.fir !== null)
        .map(r => ({ ritiroId: r.id, firId: r.fir.id, esito: null }))
    )
  }
  @Output() chiuso = new EventEmitter<void>()

  private _ritiri: RitiroVista[] = []
  readonly righe = signal<RigaEmissione[]>([])
  readonly finito = signal(false)
  readonly stop = signal<string | null>(null)
  readonly interrompendo = signal(false)
  readonly tentate = computed(() => this.righe().filter(r => r.esito !== null).length)
  readonly nonTentate = computed(() => this.righe().filter(r => r.esito === null).length)

  ngOnInit(): void {
    this.avviato = true
    const daEmettere = this.righe()
    this.sub = emettiInSerie(
      daEmettere,
      id => this.fir.emettiFIR(id),
      () => this.interrotto
    ).subscribe({
      next: a => {
        this.righe.update(rs => rs.map((r, i) => (i === a.indice ? a.riga : r)))
        if (a.ferma) {
          this.stop.set(
            `Emissione fermata: ${a.riga.messaggio ?? 'errore'} I FIR non tentati restano in bozza.`
          )
        }
      },
      complete: () => this.finito.set(true),
    })
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe()
  }

  /** Chiede lo stop: il FIR in corso arriva al suo esito, poi il ciclo si completa da solo. */
  interrompi(): void {
    this.interrotto = true
    this.interrompendo.set(true)
    this.stop.set('Emissione interrotta dopo il FIR in corso. I FIR non tentati restano in bozza.')
  }

  chiudi(): void {
    if (this.finito()) this.chiuso.emit()
  }

  conteggio(e: EsitoEmissione): number {
    return this.righe().filter(r => r.esito === e).length
  }
  testo(r: RigaEmissione): string {
    return TESTO[r.esito ?? 'NON_TENTATO']
  }
  tono(r: RigaEmissione): TonoStato {
    return TONO[r.esito ?? 'NON_TENTATO']
  }
  descrizione(id: string): string {
    const r = this._ritiri.find(x => x.id === id)
    return r
      ? `${dataItaliana(r.dataPrevista)} · ${r.produttore.nome} · CER ${r.cerCode}`
      : 'Ritiro'
  }
}
