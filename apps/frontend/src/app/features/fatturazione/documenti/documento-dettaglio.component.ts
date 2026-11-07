import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { EMPTY, Observable, Subject, combineLatest, merge } from 'rxjs'
import { catchError, switchMap, tap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'
import { AuthService } from '../../../core/services/auth.service'
import { formattaGiorno } from '../../giacenze/giorno'
import { codiceErrore } from '../../listino/errori-azione'
import { decimaleItaliano, importoItaliano } from '../../listino/listino-calcoli'
import { erroreDaBlob, salvaFile } from '../download-fatturazione'
import { DocumentoDettaglio } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { messaggioDaCodice } from '../messaggio-da-codice'
import { permessiFatturazione } from '../permessi-fatturazione'
import {
  ERRORI_HTTP_VOCI,
  MOTIVI_NON_ANNULLABILE_VOCI,
  SeveritaFatturazione,
  STATI_DOCUMENTO_VOCI,
  TIPI_DOCUMENTO_VOCI,
  TIPI_RIGA_VOCI,
  VoceVocabolario,
  voceSegnalazione,
} from '../vocabolario-fatturazione'
import { AnnullaDialogComponent } from './annulla-dialog.component'
import {
  ConfermaEmissioneDialogComponent,
  MSG_EMISSIONE,
} from './conferma-emissione-dialog.component'
import { DatiStorno, StornoDialogComponent } from './storno-dialog.component'

export const MSG_DOCUMENTO_NON_CARICATO = 'Impossibile caricare il documento.'
export const MSG_PDF_NON_SCARICATO = 'Impossibile scaricare la copia di cortesia.'
export const MSG_XML_NON_SCARICATO = "Impossibile scaricare l'XML del documento."
export const MSG_ANNULLO_FALLITO = 'Impossibile annullare il documento.'
export const MSG_STORNO_FALLITO = 'Impossibile stornare il documento.'
export const MSG_EMESSO_FALLITO = 'Impossibile segnare il documento come emesso.'
export const MSG_ANNULLO_NON_POSSIBILE = 'Il documento non si può annullare.'

/** 409 che dicono «il documento non è più quello che vedi»: si rilegge. */
const RILEGGI_DOPO = [
  'VERSIONE_SUPERATA',
  'ANNULLO_NON_AMMESSO',
  'STORNO_GIA_PRESENTE',
  'STORNO_NON_AMMESSO',
  'OPERAZIONE_CONCORRENTE',
]

type SeveritaTag = 'success' | 'info' | 'warning' | 'danger'
const SEVERITA_TAG: Record<SeveritaFatturazione, SeveritaTag> = {
  successo: 'success',
  info: 'info',
  avviso: 'warning',
  errore: 'danger',
}

type Conferma = 'xml' | 'emesso'

/**
 * Dettaglio di un documento di fattura (4.4c, Task 33): righe, riepilogo IVA, rate, totali e le
 * azioni. PDF per tutti; XML («Segna come emesso», annullo e storno) solo per gli amministratori.
 * Ogni azione rimanda la `versione` letta; il doppio clic è protetto da `inAzione`. Con
 * `?storno=1&rifatturabile=1` (dalla pagina degli scostamenti) apre lo storno.
 */
@Component({
  selector: 'app-documento-dettaglio',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    ButtonModule,
    TableModule,
    TagModule,
    TooltipModule,
    AnnullaDialogComponent,
    StornoDialogComponent,
    ConfermaEmissioneDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <a routerLink="/fatturazione/documenti" class="dd-indietro" data-testid="dd-indietro"
            >← Documenti</a
          >
          <h1 class="page-title">
            {{ dettaglio() ? tipoDocumento(dettaglio()!.tipoDocumento) : 'Documento' }}
            <span *ngIf="dettaglio()?.numeroTesto as n" data-testid="dd-numero">{{ n }}</span>
          </h1>
          <p class="page-subtitle" *ngIf="dettaglio() as d" data-testid="dd-testata">
            <strong>{{ d.cliente.denominazione }}</strong> · contratto {{ d.contratto.numero }} ·
            registro {{ d.registro.codice }} · del {{ giorno(d.dataDocumento) }}
          </p>
        </div>
        <div class="page-actions" *ngIf="dettaglio() as d" data-testid="dd-azioni">
          <p-tag
            [value]="voceStato(d).etichetta"
            [severity]="severita(voceStato(d))"
            data-testid="dd-stato"
          />
          <p-button
            label="PDF"
            icon="pi pi-file-pdf"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="scaricaPdf()"
            data-testid="dd-pdf"
          />
          <p-button
            *ngIf="permessi().scaricaXml && d.stato !== 'ANNULLATO' && d.stato !== 'BOZZA'"
            label="Scarica XML"
            icon="pi pi-download"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="scaricaXml()"
            data-testid="dd-xml"
          />
          <p-button
            *ngIf="permessi().rendeDefinitiva && d.stato === 'DEFINITIVO' && d.emessoIl === null"
            label="Segna come emesso"
            icon="pi pi-send"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="apriConferma('emesso')"
            data-testid="dd-emesso"
          />
          <span
            *ngIf="permessi().rendeDefinitiva && d.stato !== 'BOZZA'"
            [pTooltip]="motivoNonAnnullabile(d) ?? ''"
            [tooltipDisabled]="motivoNonAnnullabile(d) === null"
            tooltipPosition="bottom"
            data-testid="dd-annulla-wrap"
          >
            <p-button
              label="Annulla"
              icon="pi pi-times"
              severity="danger"
              [outlined]="true"
              [disabled]="motivoNonAnnullabile(d) !== null || inAzione()"
              (onClick)="apriAnnulla()"
              data-testid="dd-annulla"
            />
          </span>
          <p-button
            *ngIf="permessi().rendeDefinitiva && d.stornabile"
            label="Storna"
            icon="pi pi-undo"
            severity="danger"
            [outlined]="true"
            [disabled]="inAzione()"
            (onClick)="apriStorno(false)"
            data-testid="dd-storno"
          />
        </div>
      </header>

      <p
        *ngIf="dettaglio() && permessi().rendeDefinitiva && motivoNonAnnullabile(dettaglio()!) as m"
        class="text-secondary"
        data-testid="dd-motivo-annullo"
      >
        {{ m }}
      </p>

      <p *ngIf="caricamento()" role="status" data-testid="dd-caricamento">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i> Caricamento del documento…
      </p>
      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="dd-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="dd-riprova"
        />
      </p>
      <p *ngIf="esito() as e" role="alert" class="field-error" data-testid="dd-esito">{{ e }}</p>

      <ng-container *ngIf="dettaglio() as d">
        <p *ngIf="d.stato === 'ANNULLATO'" class="text-secondary" data-testid="dd-annullato">
          Il documento è annullato.
        </p>
        <p *ngIf="d.emessoIl" class="text-secondary" data-testid="dd-emesso-il">
          Emesso il {{ d.emessoIl | date: 'dd/MM/yyyy HH:mm' }}.
        </p>
        <p class="dd-collegati" *ngIf="d.documentoOrigineId || d.stornoId">
          <a
            *ngIf="d.documentoOrigineId as o"
            [routerLink]="['/fatturazione/documenti', o]"
            data-testid="dd-origine"
            >Documento stornato</a
          >
          <a
            *ngIf="d.stornoId as s"
            [routerLink]="['/fatturazione/documenti', s]"
            data-testid="dd-nota-storno"
            >Nota di credito di storno</a
          >
        </p>

        <ul class="dd-segnalazioni" *ngIf="d.errori.length" data-testid="dd-errori">
          <li *ngFor="let s of d.errori">
            <p-tag severity="danger" [value]="testo(s.codice)" />
          </li>
        </ul>
        <ul class="dd-segnalazioni" *ngIf="d.avvisi.length" data-testid="dd-avvisi">
          <li *ngFor="let s of d.avvisi">
            <p-tag severity="warning" [value]="testo(s.codice)" />
          </li>
        </ul>

        <h2 class="dd-titolo">Righe</h2>
        <div data-testid="dd-righe">
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
                  <small class="text-secondary">{{ tipoRiga(r.tipoRiga) }}</small>
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

        <h2 class="dd-titolo">Riepilogo IVA</h2>
        <div data-testid="dd-riepilogo-iva">
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
          <h2 class="dd-titolo">Rate</h2>
          <div data-testid="dd-rate">
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

        <dl class="dd-totali" data-testid="dd-totali">
          <dt>Imponibile</dt>
          <dd>{{ importo(d.totaleImponibile) }}</dd>
          <dt>IVA</dt>
          <dd>{{ importo(d.totaleIva) }}</dd>
          <ng-container *ngIf="d.bolloDovuto && d.importoBollo">
            <dt>Bollo</dt>
            <dd data-testid="dd-bollo">{{ importo(d.importoBollo) }}</dd>
          </ng-container>
          <dt>Totale documento</dt>
          <dd data-testid="dd-totale">{{ importo(d.totaleDocumento) }}</dd>
          <dt>Netto a pagare</dt>
          <dd>{{ importo(d.nettoAPagare) }}</dd>
        </dl>
      </ng-container>

      <app-annulla-dialog
        *ngIf="permessi().rendeDefinitiva"
        [visible]="annullaAperta()"
        [inCorso]="inAzione()"
        [errore]="erroreDialog()"
        (confermato)="annulla($event)"
        (chiuso)="chiudiDialog()"
      />
      <app-storno-dialog
        *ngIf="permessi().rendeDefinitiva"
        [visible]="stornoAperto()"
        [rifatturabileIniziale]="rifatturabileIniziale()"
        [inCorso]="inAzione()"
        [errore]="erroreDialog()"
        (confermato)="storna($event)"
        (chiuso)="chiudiDialog()"
      />
      <app-conferma-emissione-dialog
        *ngIf="permessi().scaricaXml"
        [visible]="conferma() !== null"
        [titolo]="conferma() === 'xml' ? 'Scarica XML' : 'Segna come emesso'"
        [messaggio]="messaggioEmissione"
        [etichettaConferma]="conferma() === 'xml' ? 'Scarica XML' : 'Segna come emesso'"
        [inCorso]="inAzione()"
        [errore]="erroreDialog()"
        (confermato)="confermaEmissione()"
        (chiuso)="chiudiDialog()"
      />
    </div>
  `,
  styles: [
    `
      .dd-indietro {
        font-size: 0.875rem;
      }
      .dd-titolo {
        margin: var(--spacing-md) 0 var(--spacing-xs);
        font-size: 1rem;
      }
      .dd-segnalazioni {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
        list-style: none;
        padding: 0;
        margin: 0 0 var(--spacing-sm);
      }
      .dd-collegati {
        display: flex;
        gap: var(--spacing-md);
      }
      .dd-totali {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--spacing-xs) var(--spacing-lg);
        max-width: 22rem;
        margin: var(--spacing-md) 0 0 auto;
        font-variant-numeric: tabular-nums;
      }
      .dd-totali dd {
        margin: 0;
        text-align: right;
      }
    `,
  ],
})
export class DocumentoDettaglioComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly route = inject(ActivatedRoute)
  private readonly auth = inject(AuthService)
  private readonly destroyRef = inject(DestroyRef)

  /** Id e parametri seguono la rotta: da un documento all'altro il componente è lo stesso. */
  private id = ''
  private chiedeStorno = false
  private chiedeRifatturabile = false
  /** Il parametro `storno` apre il dialog una volta sola. */
  private stornoRichiestoGestito = false

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly dettaglio = signal<DocumentoDettaglio | null>(null)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  /** Errore di un'azione fuori dai dialog (PDF, XML diretto). */
  readonly esito = signal<string | null>(null)
  /** Errore di un'azione fatta da un dialog: resta dentro il dialog. */
  readonly erroreDialog = signal<string | null>(null)
  readonly inAzione = signal(false)

  readonly annullaAperta = signal(false)
  readonly stornoAperto = signal(false)
  readonly rifatturabileIniziale = signal(false)
  readonly conferma = signal<Conferma | null>(null)

  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  readonly numero = (v: string): string => decimaleItaliano(v)
  readonly testo = (codice: string): string => voceSegnalazione(codice).etichetta
  readonly tipoDocumento = (t: string): string => TIPI_DOCUMENTO_VOCI[t]?.etichetta ?? t
  readonly tipoRiga = (t: string): string => TIPI_RIGA_VOCI[t]?.etichetta ?? t
  readonly messaggioEmissione = MSG_EMISSIONE
  readonly voceStato = (d: DocumentoDettaglio): VoceVocabolario =>
    STATI_DOCUMENTO_VOCI[d.stato] ?? { etichetta: d.stato, severita: 'info' }
  readonly severita = (v: VoceVocabolario): SeveritaTag => SEVERITA_TAG[v.severita]
  /** Salvataggio del file: sostituibile nei test. */
  salva = salvaFile

  /** Perché «Annulla» è disattivato; `null` se si può annullare. */
  motivoNonAnnullabile(d: DocumentoDettaglio): string | null {
    if (d.annullabile) return null
    return (
      (d.motivoNonAnnullabile
        ? MOTIVI_NON_ANNULLABILE_VOCI[d.motivoNonAnnullabile]?.etichetta
        : null) ?? MSG_ANNULLO_NON_POSSIBILE
    )
  }

  /** Una lettura nuova annulla quella pendente: una risposta tardiva non sovrascrive. */
  private readonly lettura$ = new Subject<void>()

  constructor() {
    const rotta$ = combineLatest([this.route.paramMap, this.route.queryParamMap]).pipe(
      tap(([p, q]) =>
        this.cambiaRotta(p.get('id') ?? '', q.get('storno') === '1', q.get('rifatturabile') === '1')
      )
    )
    merge(rotta$, this.lettura$)
      .pipe(
        tap(() => {
          this.caricamento.set(true)
          this.errore.set(null)
        }),
        // Una lettura nuova (altro documento o «Riprova») annulla la pendente.
        switchMap(() =>
          this.servizio.documento(this.id).pipe(
            catchError(err => {
              this.caricamento.set(false)
              this.errore.set(messaggioDaCodice(err, MSG_DOCUMENTO_NON_CARICATO))
              return EMPTY
            })
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(d => {
        this.dettaglio.set(d)
        this.caricamento.set(false)
        this.apriStornoRichiesto(d)
      })
  }

  /** Nuova rotta: azzera il documento, i dialog, gli esiti e il parametro `storno`. */
  private cambiaRotta(id: string, storno: boolean, rifatturabile: boolean): void {
    this.id = id
    this.chiedeStorno = storno
    this.chiedeRifatturabile = rifatturabile
    this.stornoRichiestoGestito = false
    this.dettaglio.set(null)
    this.esito.set(null)
    this.erroreDialog.set(null)
    this.annullaAperta.set(false)
    this.stornoAperto.set(false)
    this.conferma.set(null)
  }

  /** XML ed emissione: solo ADMIN (il template nasconde i pulsanti, il metodo si difende). */
  private puoXml(): boolean {
    return this.permessi().scaricaXml
  }

  /** Annullo, storno e «emesso»: solo chi rende definitivo. */
  private puoScrivere(): boolean {
    return this.permessi().rendeDefinitiva
  }

  carica(): void {
    this.lettura$.next()
  }

  /** Dalla pagina degli scostamenti: `?storno=1` apre lo storno se il documento è stornabile. */
  private apriStornoRichiesto(d: DocumentoDettaglio): void {
    if (!this.chiedeStorno || this.stornoRichiestoGestito) return
    this.stornoRichiestoGestito = true
    if (d.stornabile && this.permessi().rendeDefinitiva) this.apriStorno(this.chiedeRifatturabile)
  }

  // --- Dialog ------------------------------------------------------------------------------

  apriAnnulla(): void {
    if (!this.puoScrivere()) return
    this.erroreDialog.set(null)
    this.annullaAperta.set(true)
  }

  apriStorno(rifatturabile: boolean): void {
    if (!this.puoScrivere()) return
    this.erroreDialog.set(null)
    this.rifatturabileIniziale.set(rifatturabile)
    this.stornoAperto.set(true)
  }

  apriConferma(tipo: Conferma): void {
    if (!(tipo === 'xml' ? this.puoXml() : this.puoScrivere())) return
    this.erroreDialog.set(null)
    this.conferma.set(tipo)
  }

  chiudiDialog(): void {
    if (this.inAzione()) return
    this.annullaAperta.set(false)
    this.stornoAperto.set(false)
    this.conferma.set(null)
    this.erroreDialog.set(null)
  }

  // --- Azioni ------------------------------------------------------------------------------

  /** Esegue l'azione che restituisce il documento aggiornato; una alla volta. */
  private scrivi(
    chiamata: (versione: number) => Observable<DocumentoDettaglio>,
    ripiego: string
  ): void {
    const d = this.dettaglio()
    if (!this.puoScrivere() || d === null || this.inAzione()) return
    this.inAzione.set(true)
    this.erroreDialog.set(null)
    chiamata(d.versione)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: nuovo => {
          this.inAzione.set(false)
          // Se nel frattempo si è passati a un altro documento, la risposta non lo copre.
          if (nuovo.id !== this.id) return
          this.dettaglio.set(nuovo)
          this.annullaAperta.set(false)
          this.stornoAperto.set(false)
          this.conferma.set(null)
        },
        error: err => {
          this.inAzione.set(false)
          this.erroreDialog.set(messaggioDaCodice(err, ripiego))
          const codice = codiceErrore(err)
          if (codice !== null && RILEGGI_DOPO.includes(codice)) this.carica()
        },
      })
  }

  annulla(motivo: string): void {
    if (!this.puoScrivere()) return
    this.scrivi(v => this.servizio.annulla(this.id, motivo, v), MSG_ANNULLO_FALLITO)
  }

  storna(dati: DatiStorno): void {
    if (!this.puoScrivere()) return
    this.scrivi(v => this.servizio.storno(this.id, { ...dati, versione: v }), MSG_STORNO_FALLITO)
  }

  confermaEmissione(): void {
    const tipo = this.conferma()
    if (tipo === 'xml') this.scarica(true)
    else if (tipo === 'emesso' && this.puoScrivere())
      this.scrivi(v => this.servizio.segnaEmesso(this.id, v), MSG_EMESSO_FALLITO)
  }

  /** «Scarica XML»: un documento già emesso si scarica subito, gli altri chiedono conferma. */
  scaricaXml(): void {
    const d = this.dettaglio()
    if (!this.puoXml() || d === null || this.inAzione()) return
    if (d.emessoIl === null) this.apriConferma('xml')
    else this.scarica(false)
  }

  private scarica(confermaEmissione: boolean): void {
    if (!this.puoXml() || this.inAzione()) return
    this.inAzione.set(true)
    this.esito.set(null)
    this.erroreDialog.set(null)
    this.servizio
      .scaricaXml(this.id, confermaEmissione)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: file => {
          this.inAzione.set(false)
          this.salva(file, 'fattura.xml')
          this.conferma.set(null)
          // Con la conferma il documento è diventato emesso: versione ed `emessoIl` nuovi.
          if (confermaEmissione) this.carica()
        },
        error: (err: unknown) =>
          void erroreDaBlob(err).then(e => {
            this.inAzione.set(false)
            const msg = messaggioXml(e)
            if (this.conferma() !== null) this.erroreDialog.set(msg)
            else this.esito.set(msg)
          }),
      })
  }

  scaricaPdf(): void {
    if (this.inAzione()) return
    this.inAzione.set(true)
    this.esito.set(null)
    this.servizio
      .scaricaPdf(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: file => {
          this.inAzione.set(false)
          this.salva(file, 'fattura.pdf')
        },
        error: (err: unknown) =>
          void erroreDaBlob(err).then(e => {
            this.inAzione.set(false)
            this.esito.set(messaggioDaCodice(e, MSG_PDF_NON_SCARICATO))
          }),
      })
  }
}

/** 422 senza codice (m3 della 4.4b2): l'XML non è valido, senza dati personali. */
export function messaggioXml(err: unknown): string {
  const stato = (err as { status?: number } | null)?.status
  if (stato === 422 && codiceErrore(err) === null) return ERRORI_HTTP_VOCI.XML_NON_VALIDO.etichetta
  return messaggioDaCodice(err, MSG_XML_NON_SCARICATO)
}
