import { CommonModule } from '@angular/common'
import { Component, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { Router } from '@angular/router'
import { EMPTY, Observable, Subject, catchError, concat, of, switchMap, tap, timer } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { PaginatorModule, PaginatorState } from 'primeng/paginator'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { AuthService } from '../../../core/services/auth.service'
import { formattaGiorno } from '../../giacenze/giorno'
import { importoItaliano } from '../../listino/listino-calcoli'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import { ElaborazioneRiga, Pagina, StatoElaborazione } from '../fatturazione.model'
import { DIMENSIONE_MASSIMA, FatturazioneService } from '../fatturazione.service'
import { permessiFatturazione } from '../permessi-fatturazione'
import {
  SeveritaFatturazione,
  STATI_ELABORAZIONE_VOCI,
  VoceVocabolario,
} from '../vocabolario-fatturazione'
import { NuovaElaborazioneDialogComponent } from './nuova-elaborazione-dialog.component'

/** Ogni quanto si rilegge la lista finché una riga è in calcolo o in emissione. */
export const INTERVALLO_LISTA_MS = 3000
const STATI_TRANSITORI: readonly StatoElaborazione[] = ['IN_CODA', 'IN_CORSO', 'IN_DEFINITIVA']

type SeveritaTag = 'success' | 'info' | 'warning' | 'danger'

const SEVERITA_TAG: Record<SeveritaFatturazione, SeveritaTag> = {
  successo: 'success',
  info: 'info',
  avviso: 'warning',
  errore: 'danger',
}

/**
 * Lista delle elaborazioni di fatturazione (4.4c, Task 31): data, periodo, stato, documenti,
 * totale ed errori, con «Nuova elaborazione» per chi può preparare (OPERATOR e amministratori).
 */
@Component({
  selector: 'app-elaborazioni-lista',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    PaginatorModule,
    TableModule,
    TagModule,
    NuovaElaborazioneDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Elaborazioni</h1>
          <p class="page-subtitle">
            Le fatture preparate per periodo: anteprima, controlli ed emissione definitiva.
          </p>
        </div>
        <div class="page-actions" data-testid="elaborazioni-azioni-pagina">
          <p-button
            label="Documenti"
            icon="pi pi-list"
            [outlined]="true"
            (onClick)="vaiAiDocumenti()"
            data-testid="elaborazioni-documenti"
          />
          <p-button
            *ngIf="permessi().prepara"
            label="Nuova elaborazione"
            icon="pi pi-plus"
            (onClick)="nuovaAperta.set(true)"
            data-testid="nuova-elaborazione-apri"
          />
        </div>
      </header>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="elaborazioni-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="elaborazioni-riprova"
        />
      </p>

      <div class="table-card">
        <p-table
          [value]="righe()"
          [loading]="caricamento()"
          dataKey="id"
          styleClass="p-datatable-sm tabella-schede"
          aria-label="Elaborazioni di fatturazione"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Data</th>
              <th scope="col">Periodo</th>
              <th scope="col">Stato</th>
              <th scope="col" class="num-col">Documenti</th>
              <th scope="col" class="num-col">Totale</th>
              <th scope="col" class="num-col">Errori</th>
              <th scope="col"><span class="sr-only">Azioni</span></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr [attr.data-testid]="'elaborazione-' + r.id">
              <td class="cell-nowrap" data-etichetta="Data" data-testid="el-data">
                {{ r.createdAt | date: 'dd/MM/yyyy HH:mm' }}
              </td>
              <td class="cell-nowrap" data-etichetta="Periodo" data-testid="el-periodo">
                {{ giorno(r.periodoDal) }} – {{ giorno(r.periodoAl) }}
              </td>
              <td data-etichetta="Stato" data-testid="el-stato">
                <p-tag [value]="etichettaStato(r.stato)" [severity]="severitaStato(r.stato)" />
              </td>
              <td class="num-col" data-etichetta="Documenti" data-testid="el-documenti">
                {{ r.documenti }}
              </td>
              <td class="num-col" data-etichetta="Totale" data-testid="el-totale">
                {{ importo(r.totale) }}
              </td>
              <td class="num-col" data-etichetta="Errori" data-testid="el-errori">
                {{ r.errori }}
              </td>
              <td class="cell-nowrap">
                <p-button
                  label="Apri"
                  icon="pi pi-arrow-right"
                  [text]="true"
                  size="small"
                  (onClick)="apri(r)"
                  [attr.data-testid]="'apri-' + r.id"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7">
                <div class="empty-state" data-testid="elaborazioni-vuota">
                  <span class="empty-state__title">Nessuna elaborazione.</span>
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
          data-testid="elaborazioni-paginatore"
        />
      </div>

      <app-nuova-elaborazione-dialog
        *ngIf="permessi().prepara"
        [visible]="nuovaAperta()"
        (avviato)="dopoAvvio($event)"
        (chiuso)="nuovaAperta.set(false)"
      />
    </div>
  `,
})
export class ElaborazioniListaComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly router = inject(Router)
  private readonly auth = inject(AuthService)

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly righe = signal<ElaborazioneRiga[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  /** Mai oltre 100: il backend risponde 400 sopra il tetto. */
  readonly dimensione = Math.min(50, DIMENSIONE_MASSIMA)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly nuovaAperta = signal(false)

  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  /** Uno stato fuori dall'insieme (backend più nuovo del frontend) non rompe la riga. */
  private voceStato(s: StatoElaborazione): VoceVocabolario {
    return STATI_ELABORAZIONE_VOCI[s] ?? { etichetta: s, severita: 'info' }
  }
  readonly etichettaStato = (s: StatoElaborazione): string => this.voceStato(s).etichetta
  readonly severitaStato = (s: StatoElaborazione): SeveritaTag =>
    SEVERITA_TAG[this.voceStato(s).severita]

  /** Una lettura nuova annulla quella pendente (`switchMap`): una risposta lenta non copre la nuova. */
  private readonly richiesta$ = new Subject<number>()

  constructor() {
    this.richiesta$
      .pipe(
        tap(() => {
          this.caricamento.set(true)
          this.errore.set(null)
        }),
        switchMap(pagina =>
          this.giro(pagina).pipe(
            catchError(err => {
              this.caricamento.set(false)
              this.errore.set(
                messaggiErroreFatturazione(err, 'Impossibile caricare le elaborazioni.').join(' ')
              )
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(p => {
        this.righe.set(p.elementi)
        this.totale.set(p.totale)
        this.caricamento.set(false)
      })
    this.carica()
  }

  /**
   * Legge la pagina; finché una riga visibile è transitoria aspetta 3 s dalla risposta e rilegge
   * (mai due richieste insieme). Una lettura nuova (`switchMap`) o la distruzione lo interrompe.
   */
  private giro(pagina: number): Observable<Pagina<ElaborazioneRiga>> {
    return this.servizio
      .lista({ pagina, dimensione: this.dimensione })
      .pipe(
        switchMap(p =>
          p.elementi.some(r => STATI_TRANSITORI.includes(r.stato))
            ? concat(of(p), timer(INTERVALLO_LISTA_MS).pipe(switchMap(() => this.giro(pagina))))
            : of(p)
        )
      )
  }

  carica(): void {
    this.richiesta$.next(this.pagina())
  }

  cambiaPagina(e: PaginatorState): void {
    this.pagina.set((e.page ?? 0) + 1)
    this.carica()
  }

  vaiAiDocumenti(): void {
    void this.router.navigate(['/fatturazione', 'documenti'])
  }

  apri(r: ElaborazioneRiga): void {
    void this.router.navigate(['/fatturazione', 'elaborazioni', r.id])
  }

  /** Anteprima avviata: si chiude il dialog e si va al dettaglio. */
  dopoAvvio(id: string): void {
    this.nuovaAperta.set(false)
    void this.router.navigate(['/fatturazione', 'elaborazioni', id])
  }
}
