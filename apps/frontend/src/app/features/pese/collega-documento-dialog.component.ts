/**
 * Collega un accesso a un documento: un FIR dell'azienda (cercato per numero) oppure una
 * annotazione del registro dello stesso registro e verso (solo lettura, dal servizio del
 * registro). Le regole (stesso registro, stesso verso, stesso CER, FIR emesso) le arbitra il
 * backend: un 409/422 si mostra testuale. Il FIR non cambia: il collegamento serve a
 * confrontare il peso della pesata con quello del documento.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { forkJoin } from 'rxjs'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { FirService } from '../fir/fir.service'
import { Movimento, RegistroService } from '../registro/registro.service'
import { messaggioErrorePese } from './pese-formato'
import { STILI_PESE } from './pese-stili'
import { AccessoVista, PeseService } from './pese.service'

const STATI_COLLEGABILI = [FIRStato.EMESSO, FIRStato.IN_TRANSITO, FIRStato.CONSEGNATO]
const LIMITE = 100

@Component({
  selector: 'app-collega-documento-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      [header]="'Collega un documento — accesso ' + accesso.numero"
      [modal]="true"
      [style]="{ width: '680px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra del collegamento"
      (onShow)="mettiAFuoco()"
    >
      <div class="schede" role="group" aria-label="Tipo di documento">
        <button
          type="button"
          class="p-button p-button-sm"
          [class.p-button-outlined]="tipo() !== 'FIR'"
          [attr.aria-pressed]="tipo() === 'FIR'"
          (click)="scegliTipo('FIR')"
          data-testid="cd-tipo-fir"
        >
          FIR
        </button>
        <button
          type="button"
          class="p-button p-button-sm"
          [class.p-button-outlined]="tipo() !== 'MOVIMENTO'"
          [attr.aria-pressed]="tipo() === 'MOVIMENTO'"
          (click)="scegliTipo('MOVIMENTO')"
          data-testid="cd-tipo-movimento"
        >
          Annotazione del registro
        </button>
      </div>

      <div *ngIf="tipo() === 'FIR'" class="field">
        <label for="cd-ricerca">Numero del FIR</label>
        <input
          id="cd-ricerca"
          type="text"
          class="p-inputtext w-full"
          [(ngModel)]="ricerca"
          aria-describedby="cd-ricerca-aiuto"
          data-testid="cd-ricerca"
          autocomplete="off"
        />
        <small id="cd-ricerca-aiuto" class="field-hint"
          >Compaiono i FIR emessi dell'azienda (fino a {{ limite }} per stato).</small
        >
      </div>
      <p *ngIf="caricamento()" role="status" class="nota">Caricamento…</p>
      <p
        *ngIf="erroreElenco() as e"
        role="alert"
        class="field-error"
        data-testid="cd-errore-elenco"
      >
        {{ e }}
      </p>

      <fieldset class="elenco" *ngIf="tipo() === 'FIR'">
        <legend class="nota">FIR collegabili</legend>
        <label class="voce" *ngFor="let f of firFiltrati()">
          <input
            type="radio"
            name="cd-doc"
            [value]="f.id"
            [(ngModel)]="selezionato"
            [attr.data-testid]="'cd-fir-' + f.id"
          />
          <span
            >{{ f.numeroProgressivo }} — {{ f.stato }} — CER {{ f.rifiuto.cerCode }} —
            {{ f.rifiuto.quantita }} {{ f.rifiuto.unitaMisura }}</span
          >
        </label>
        <p class="nota" *ngIf="!caricamento() && !firFiltrati().length" data-testid="cd-fir-vuoti">
          {{
            firPieno()
              ? 'Nessun risultato: nessun FIR tra i ' + limite + ' più recenti di ciascuno stato.'
              : 'Nessun FIR emesso corrisponde.'
          }}
        </p>
      </fieldset>

      <fieldset class="elenco" *ngIf="tipo() === 'MOVIMENTO'">
        <legend class="nota">
          Annotazioni vigenti dello stesso registro e verso ({{
            accesso.verso === 'CARICO' ? 'carico' : 'scarico'
          }})
        </legend>
        <label class="voce" *ngFor="let m of movimenti()">
          <input
            type="radio"
            name="cd-doc"
            [value]="m.id"
            [(ngModel)]="selezionato"
            [attr.data-testid]="'cd-mov-' + m.id"
          />
          <span
            >n. {{ m.progressiveNumber }}/{{ m.progressiveYear }} — CER {{ m.cerCode }} —
            {{ m.quantity }} {{ m.unit }}</span
          >
        </label>
        <p class="nota" *ngIf="!caricamento() && !movimenti().length" data-testid="cd-mov-vuoti">
          {{
            movimentiPieni()
              ? 'Nessun risultato: nessuna annotazione tra le ultime ' + limite + '.'
              : 'Nessuna annotazione vigente disponibile.'
          }}
        </p>
      </fieldset>

      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="cd-errore">{{ e }}</p>
      <div class="azioni">
        <p-button label="Annulla" [text]="true" (onClick)="chiuso.emit()"></p-button>
        <p-button
          label="Collega"
          icon="pi pi-link"
          [loading]="salvataggio()"
          [disabled]="salvataggio() || !selezionato"
          (onClick)="salva()"
          data-testid="cd-salva"
          ariaLabel="Collega il documento selezionato"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [
    STILI_PESE,
    `
      .schede {
        display: flex;
        gap: var(--spacing-sm);
        margin-bottom: var(--spacing-base);
      }
      .elenco {
        border: 1px solid var(--border-color, #ccc);
        max-height: 260px;
        overflow: auto;
        padding: var(--spacing-sm);
      }
      .voce {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
        padding: var(--spacing-xs) 0;
      }
    `,
  ],
})
export class CollegaDocumentoDialogComponent implements OnInit {
  private readonly pese = inject(PeseService)
  private readonly firService = inject(FirService)
  private readonly registro = inject(RegistroService)

  @Input({ required: true }) accesso!: AccessoVista
  @Output() fatto = new EventEmitter<AccessoVista>()
  @Output() chiuso = new EventEmitter<void>()
  @Output() ricarica = new EventEmitter<void>()

  readonly limite = LIMITE
  readonly tipo = signal<'FIR' | 'MOVIMENTO'>('FIR')
  readonly fir = signal<FIR[]>([])
  readonly movimenti = signal<Movimento[]>([])
  readonly caricamento = signal(false)
  readonly firPieno = signal(false)
  readonly movimentiPieni = signal(false)
  readonly erroreElenco = signal<string | null>(null)
  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  ricerca = ''
  selezionato = ''

  ngOnInit(): void {
    this.caricaFir()
  }

  mettiAFuoco(): void {
    setTimeout(() => document.getElementById('cd-ricerca')?.focus())
  }

  scegliTipo(t: 'FIR' | 'MOVIMENTO'): void {
    this.tipo.set(t)
    this.selezionato = ''
    this.errore.set(null)
    if (t === 'MOVIMENTO' && !this.movimenti().length) this.caricaMovimenti()
  }

  firFiltrati(): FIR[] {
    const q = this.ricerca.trim().toLowerCase()
    return this.fir().filter(f => !q || (f.numeroProgressivo ?? '').toLowerCase().includes(q))
  }

  private caricaFir(): void {
    this.caricamento.set(true)
    forkJoin(STATI_COLLEGABILI.map(s => this.firService.getFIRList(1, LIMITE, s))).subscribe({
      next: pagine => {
        this.firPieno.set(pagine.some(p => p.items.length >= LIMITE))
        this.fir.set(pagine.flatMap(p => p.items).filter(f => !!f.numeroProgressivo))
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile leggere i FIR.'))
      },
    })
  }

  private caricaMovimenti(): void {
    this.caricamento.set(true)
    this.registro
      .lista({ registroId: this.accesso.registro.id, type: this.accesso.verso, limit: LIMITE })
      .subscribe({
        next: p => {
          this.movimentiPieni.set(p.items.length >= LIMITE)
          this.movimenti.set(
            p.items.filter(
              m => (m.stato ?? 'VIGENTE') === 'VIGENTE' && m.tipoAnnotazione !== 'ANNULLAMENTO'
            )
          )
          this.caricamento.set(false)
        },
        error: err => {
          this.caricamento.set(false)
          this.erroreElenco.set(messaggioErrorePese(err, 'Impossibile leggere il registro.'))
        },
      })
  }

  salva(): void {
    if (this.salvataggio() || !this.selezionato) return
    this.errore.set(null)
    this.salvataggio.set(true)
    const dati =
      this.tipo() === 'FIR'
        ? { tipo: 'FIR' as const, firId: this.selezionato }
        : { tipo: 'MOVIMENTO' as const, movimentoId: this.selezionato }
    this.pese.collega(this.accesso.id, dati).subscribe({
      next: a => {
        this.salvataggio.set(false)
        this.fatto.emit(a)
      },
      error: err => {
        this.salvataggio.set(false)
        this.errore.set(messaggioErrorePese(err, 'Collegamento non riuscito.'))
        if (err?.status === 409) this.ricarica.emit()
      },
    })
  }
}
