import { CommonModule } from '@angular/common'
import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { RouterLink } from '@angular/router'
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { PaginatorModule, PaginatorState } from 'primeng/paginator'
import { TableModule } from 'primeng/table'
import { AuthService } from '../../../core/services/auth.service'
import { formattaGiorno } from '../../giacenze/giorno'
import { decimaleItaliano, importoItaliano } from '../../listino/listino-calcoli'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import { Pagina, ScostamentoRiga } from '../fatturazione.model'
import { DIMENSIONE_MASSIMA, FatturazioneService } from '../fatturazione.service'
import { permessiFatturazione } from '../permessi-fatturazione'
import { PresaAttoDialogComponent } from './presa-atto-dialog.component'

const TIPI_CORREZIONE: Record<ScostamentoRiga['tipoCorrezione'], string> = {
  RETTIFICA: 'Rettifica',
  ANNULLO: 'Annullo',
  CAMBIO_CER: 'Cambio di CER',
  CAMBIO_CAUSALE: 'Cambio di causale',
}

/**
 * Scostamenti (4.4c, Task 34): movimenti già fatturati e poi corretti. Per ognuno la fattura e
 * il valore attuale, con due strade per l'amministratore: «Presa d'atto» (la fattura resta) o
 * «Storna e rifattura» (porta allo storno del documento, che si fa nel suo dettaglio).
 * Operator e viewer leggono soltanto.
 */
@Component({
  selector: 'app-scostamenti',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    PaginatorModule,
    TableModule,
    PresaAttoDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Scostamenti</h1>
          <p class="page-subtitle">
            Movimenti corretti dopo la fattura: la fattura non cambia da sola.
          </p>
        </div>
      </header>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="scostamenti-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="scostamenti-riprova"
        />
      </p>

      <div class="table-card">
        <p-table
          [value]="righe()"
          [loading]="caricamento()"
          dataKey="legameId"
          styleClass="p-datatable-sm"
          aria-label="Scostamenti dopo la fattura"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Correzione</th>
              <th scope="col" class="num-col">Quantità fatturata</th>
              <th scope="col" class="num-col">Quantità attuale</th>
              <th scope="col" class="num-col">Importo fatturato</th>
              <th scope="col" class="num-col">Importo attuale</th>
              <th scope="col"><span class="sr-only">Azioni</span></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr [attr.data-testid]="'scostamento-' + r.legameId">
              <td class="cell-nowrap" data-testid="sc-documento">
                <a
                  [routerLink]="['/fatturazione', 'documenti', r.documento.id]"
                  [attr.data-testid]="'sc-link-documento-' + r.legameId"
                  >{{ r.documento.numeroTesto }}</a
                >
                del {{ giorno(r.documento.dataDocumento) }}
              </td>
              <td data-testid="sc-tipo">{{ tipo(r.tipoCorrezione) }}</td>
              <td class="num-col" data-testid="sc-qta-fatturata">
                {{ quantita(r.quantitaFatturata) }}
              </td>
              <td class="num-col" data-testid="sc-qta-attuale">
                {{ quantita(r.quantitaAttuale) }}
              </td>
              <td class="num-col" data-testid="sc-importo-fatturato">
                {{ importo(r.importoFatturato) }}
              </td>
              <td class="num-col">
                <span data-testid="sc-importo-attuale">{{
                  r.importoAttuale === null ? '—' : importo(r.importoAttuale)
                }}</span>
                <small *ngIf="r.soloQuantita" class="field-hint" data-testid="sc-solo-quantita"
                  >Prezzo speciale: conta solo la differenza di quantità.</small
                >
              </td>
              <td class="cell-nowrap">
                <ng-container *ngIf="permessi().rendeDefinitiva">
                  <p-button
                    label="Presa d'atto"
                    [text]="true"
                    size="small"
                    (onClick)="apriPresaAtto(r)"
                    [attr.data-testid]="'presa-atto-' + r.legameId"
                  />
                  <a
                    class="p-button p-button-text p-button-sm"
                    [routerLink]="['/fatturazione', 'documenti', r.documento.id]"
                    [queryParams]="{ storno: 1, rifatturabile: 1 }"
                    [attr.data-testid]="'storna-' + r.legameId"
                    >Storna e rifattura</a
                  >
                </ng-container>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7">
                <div class="empty-state" data-testid="scostamenti-vuota">
                  <span class="empty-state__title">Nessuno scostamento da gestire.</span>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
        <p-paginator
          [first]="(pagina() - 1) * dimensione"
          [rows]="dimensione"
          [totalRecords]="totale()"
          (onPageChange)="cambiaPagina($event)"
          data-testid="scostamenti-paginatore"
        />
      </div>

      <app-presa-atto-dialog
        *ngIf="permessi().rendeDefinitiva"
        [visible]="scelto() !== null"
        [scostamento]="scelto()"
        (registrata)="dopoPresaAtto()"
        (chiuso)="scelto.set(null)"
      />
    </div>
  `,
})
export class ScostamentiComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly auth = inject(AuthService)

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly righe = signal<ScostamentoRiga[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  /** Mai oltre 100: il backend risponde 400 sopra il tetto. */
  readonly dimensione = Math.min(50, DIMENSIONE_MASSIMA)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly scelto = signal<ScostamentoRiga | null>(null)

  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  readonly quantita = (v: string | null): string => (v === null ? '—' : decimaleItaliano(v))
  readonly tipo = (t: ScostamentoRiga['tipoCorrezione']): string => TIPI_CORREZIONE[t] ?? t

  /** Una lettura nuova annulla quella pendente (`switchMap`). */
  private readonly richiesta$ = new Subject<number>()

  constructor() {
    this.richiesta$
      .pipe(
        tap(() => {
          this.caricamento.set(true)
          this.errore.set(null)
        }),
        switchMap(pagina =>
          this.servizio.scostamenti({ pagina, dimensione: this.dimensione }).pipe(
            catchError(err => {
              this.caricamento.set(false)
              this.errore.set(
                messaggiErroreFatturazione(err, 'Impossibile caricare gli scostamenti.').join(' ')
              )
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe((p: Pagina<ScostamentoRiga>) => {
        this.righe.set(p.elementi)
        this.totale.set(p.totale)
        this.caricamento.set(false)
      })
    this.carica()
  }

  carica(): void {
    this.richiesta$.next(this.pagina())
  }

  cambiaPagina(e: PaginatorState): void {
    this.pagina.set((e.page ?? 0) + 1)
    this.carica()
  }

  apriPresaAtto(r: ScostamentoRiga): void {
    this.scelto.set(r)
  }

  /** Presa d'atto registrata (o lista superata): chiude il dialog e rilegge. */
  dopoPresaAtto(): void {
    this.scelto.set(null)
    this.carica()
  }
}
