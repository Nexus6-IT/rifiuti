import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { EMPTY, Subject, from } from 'rxjs'
import { catchError, switchMap, tap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { formattaGiorno } from '../../giacenze/giorno'
import { decimaleItaliano, importoItaliano } from '../../listino/listino-calcoli'
import { erroreDaBlob, salvaFile } from '../download-fatturazione'
import { messaggioDaCodice } from '../messaggio-da-codice'
import { DocumentoDettaglio, SegnalazioneVista } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { TIPI_RIGA_VOCI, voceSegnalazione } from '../vocabolario-fatturazione'

export const MSG_DOCUMENTO_NON_CARICATO = 'Impossibile caricare il documento.'
export const MSG_PDF_NON_SCARICATO = 'Impossibile scaricare la copia di cortesia.'

/** Testo di una segnalazione dal vocabolario dei codici (mai il messaggio libero del backend). */
export const testoSegnalazione = (s: SegnalazioneVista): string =>
  voceSegnalazione(s.codice).etichetta

/**
 * Finestra «Documento in anteprima» (4.4c, Task 32): righe, riepilogo IVA, rate, totali,
 * segnalazioni e link alla copia di cortesia in PDF. Una sola lettura alla volta: cambiare
 * documento o chiudere annulla quella pendente.
 */
@Component({
  selector: 'app-documento-anteprima-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, TableModule, TagModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiuso.emit()"
      header="Documento in anteprima"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '64rem', maxWidth: '96vw' }"
      data-testid="documento-anteprima-dialog"
    >
      <p *ngIf="caricamento()" data-testid="doc-caricamento">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Caricamento del documento…
      </p>
      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="doc-errore">{{ e }}</p>

      <ng-container *ngIf="documento() as d">
        <div class="da-testata" data-testid="doc-testata">
          <span
            ><strong>{{ d.cliente.denominazione }}</strong></span
          >
          <span>Contratto {{ d.contratto.numero }}</span>
          <span>Registro {{ d.registro.codice }}</span>
          <span>{{ d.tipoDocumento }} del {{ giorno(d.dataDocumento) }}</span>
        </div>

        <ul class="da-segnalazioni" *ngIf="d.errori.length" data-testid="doc-errori">
          <li *ngFor="let s of d.errori">
            <p-tag severity="danger" [value]="testo(s)" />
          </li>
        </ul>
        <ul class="da-segnalazioni" *ngIf="d.avvisi.length" data-testid="doc-avvisi">
          <li *ngFor="let s of d.avvisi">
            <p-tag severity="warning" [value]="testo(s)" />
          </li>
        </ul>

        <h3 class="da-titolo">Righe</h3>
        <div data-testid="doc-righe">
          <p-table [value]="d.righe" styleClass="p-datatable-sm" aria-label="Righe del documento">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" class="num-col">N.</th>
                <th scope="col">Descrizione</th>
                <th scope="col" class="num-col">Quantità</th>
                <th scope="col" class="num-col">Prezzo</th>
                <th scope="col" class="num-col">Sconto</th>
                <th scope="col" class="num-col">Importo</th>
                <th scope="col" class="num-col">IVA %</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-r>
              <tr>
                <td class="num-col">{{ r.numeroLinea }}</td>
                <td>
                  {{ r.descrizione }}
                  <small class="text-muted">{{ tipoRiga(r.tipoRiga) }}</small>
                </td>
                <td class="num-col">
                  {{ r.quantita === null ? '' : numero(r.quantita) }} {{ r.unitaMisura ?? '' }}
                </td>
                <td class="num-col">{{ importo(r.prezzoUnitario) }}</td>
                <td class="num-col">{{ r.sconto === null ? '' : numero(r.sconto) }}</td>
                <td class="num-col">{{ importo(r.prezzoTotale) }}</td>
                <td class="num-col">{{ importo(r.aliquotaIva) }}</td>
              </tr>
            </ng-template>
          </p-table>
        </div>

        <h3 class="da-titolo">Riepilogo IVA</h3>
        <div data-testid="doc-riepilogo-iva">
          <p-table
            [value]="d.riepiloghi"
            styleClass="p-datatable-sm"
            aria-label="Riepilogo IVA per aliquota"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" class="num-col">Aliquota %</th>
                <th scope="col">Natura</th>
                <th scope="col" class="num-col">Imponibile</th>
                <th scope="col" class="num-col">Imposta</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-x>
              <tr>
                <td class="num-col">{{ importo(x.aliquota) }}</td>
                <td>{{ x.natura ?? '' }}</td>
                <td class="num-col">{{ importo(x.imponibile) }}</td>
                <td class="num-col">{{ importo(x.imposta) }}</td>
              </tr>
            </ng-template>
          </p-table>
        </div>

        <ng-container *ngIf="d.rate.length">
          <h3 class="da-titolo">Rate</h3>
          <div data-testid="doc-rate">
            <p-table [value]="d.rate" styleClass="p-datatable-sm" aria-label="Rate di pagamento">
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col" class="num-col">N.</th>
                  <th scope="col">Scadenza</th>
                  <th scope="col" class="num-col">Importo</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-x>
                <tr>
                  <td class="num-col">{{ x.ordine }}</td>
                  <td>{{ giorno(x.dataScadenza) }}</td>
                  <td class="num-col">{{ importo(x.importo) }}</td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </ng-container>

        <dl class="da-totali" data-testid="doc-totali">
          <dt>Imponibile</dt>
          <dd>{{ importo(d.totaleImponibile) }}</dd>
          <dt>IVA</dt>
          <dd>{{ importo(d.totaleIva) }}</dd>
          <ng-container *ngIf="d.bolloDovuto && d.importoBollo">
            <dt>Bollo</dt>
            <dd data-testid="doc-bollo">{{ importo(d.importoBollo) }}</dd>
          </ng-container>
          <dt>Totale documento</dt>
          <dd data-testid="doc-totale">{{ importo(d.totaleDocumento) }}</dd>
          <dt>Netto a pagare</dt>
          <dd>{{ importo(d.nettoAPagare) }}</dd>
        </dl>
      </ng-container>

      <p *ngIf="erroreScarico() as e" role="alert" class="field-error" data-testid="doc-errore-pdf">
        {{ e }}
      </p>

      <ng-template pTemplate="footer">
        <p-button
          label="Copia di cortesia (PDF)"
          icon="pi pi-file-pdf"
          [text]="true"
          [disabled]="!documento() || scaricando()"
          [loading]="scaricando()"
          (onClick)="scaricaPdf()"
          data-testid="doc-pdf"
        />
        <p-button label="Chiudi" (onClick)="chiuso.emit()" data-testid="doc-chiudi" />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .da-testata {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
      .da-titolo {
        margin: var(--spacing-md) 0 var(--spacing-xs);
        font-size: 1rem;
      }
      .da-segnalazioni {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        list-style: none;
        padding: 0;
        margin: 0 0 var(--spacing-sm);
      }
      .da-totali {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--spacing-xs) var(--spacing-lg);
        max-width: 22rem;
        margin: var(--spacing-md) 0 0 auto;
        font-variant-numeric: tabular-nums;
      }
      .da-totali dd {
        margin: 0;
        text-align: right;
      }
    `,
  ],
})
export class DocumentoAnteprimaDialogComponent implements OnChanges {
  @Input() visible = false
  @Input() documentoId: string | null = null
  @Output() readonly chiuso = new EventEmitter<void>()

  readonly documento = signal<DocumentoDettaglio | null>(null)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly scaricando = signal(false)
  readonly erroreScarico = signal<string | null>(null)

  private readonly servizio = inject(FatturazioneService)
  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  readonly numero = (v: string): string => decimaleItaliano(v)
  readonly testo = testoSegnalazione
  readonly tipoRiga = (t: string): string => TIPI_RIGA_VOCI[t]?.etichetta ?? t
  /** Salvataggio del file: sostituibile nei test. */
  salva = salvaFile

  /** `null` annulla la lettura pendente (chiusura o cambio di documento). */
  private readonly lettura$ = new Subject<string | null>()
  private readonly pdf$ = new Subject<string>()

  constructor() {
    this.lettura$
      .pipe(
        tap(() => {
          this.documento.set(null)
          this.errore.set(null)
          this.erroreScarico.set(null)
          this.caricamento.set(false)
        }),
        switchMap(id => {
          if (id === null) return EMPTY
          this.caricamento.set(true)
          return this.servizio.documento(id).pipe(
            catchError(err => {
              this.caricamento.set(false)
              this.errore.set(messaggioDaCodice(err, MSG_DOCUMENTO_NON_CARICATO))
              return EMPTY
            })
          )
        }),
        takeUntilDestroyed()
      )
      .subscribe(d => {
        this.documento.set(d)
        this.caricamento.set(false)
      })

    this.pdf$
      .pipe(
        tap(() => {
          this.scaricando.set(true)
          this.erroreScarico.set(null)
        }),
        switchMap(id =>
          this.servizio.scaricaPdf(id).pipe(
            catchError(err =>
              from(erroreDaBlob(err)).pipe(
                tap(e => {
                  this.scaricando.set(false)
                  this.erroreScarico.set(messaggioDaCodice(e, MSG_PDF_NON_SCARICATO))
                }),
                switchMap(() => EMPTY)
              )
            )
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(file => {
        this.scaricando.set(false)
        this.salva(file, 'documento.pdf')
      })
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['documentoId'] || c['visible']) {
      this.lettura$.next(this.visible ? this.documentoId : null)
    }
  }

  scaricaPdf(): void {
    const d = this.documento()
    if (d && !this.scaricando()) this.pdf$.next(d.id)
  }
}
