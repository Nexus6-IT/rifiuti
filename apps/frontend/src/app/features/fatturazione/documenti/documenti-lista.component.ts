import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { EMPTY, Subject, of } from 'rxjs'
import { catchError, debounceTime, map, switchMap, tap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { CheckboxModule } from 'primeng/checkbox'
import { DropdownModule } from 'primeng/dropdown'
import { PaginatorModule, PaginatorState } from 'primeng/paginator'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { AuthService } from '../../../core/services/auth.service'
import { ClientiService } from '../../clienti/clienti.service'
import { RegistroIva } from '../../clienti/clienti.model'
import { TabelleFatturazioneService } from '../../clienti/tabelle-fatturazione.service'
import { formattaGiorno } from '../../giacenze/giorno'
import { codiceErrore } from '../../listino/errori-azione'
import { importoItaliano } from '../../listino/listino-calcoli'
import { erroreDaBlob, salvaFile } from '../download-fatturazione'
import {
  AdattatoreVista,
  CHIAVE_SELEZIONE_MAPPATURE,
  ChiaveMancante,
  DocumentoRiga,
  SelezioneExport,
  StatoDocumento,
  TIPI_MAPPATURA,
  TipoMappatura,
} from '../fatturazione.model'
import { DIMENSIONE_MASSIMA, FatturazioneService, FileScaricato } from '../fatturazione.service'
import { fineGiornoDiOggi, isoLocale } from '../impostazioni/numerazione-scheda.component'
import { messaggioDaCodice } from '../messaggio-da-codice'
import { permessiFatturazione } from '../permessi-fatturazione'
import {
  ERRORI_HTTP_VOCI,
  SeveritaFatturazione,
  STATI_DOCUMENTO_VOCI,
  TIPI_DOCUMENTO_VOCI,
  VoceVocabolario,
} from '../vocabolario-fatturazione'
import {
  ConfermaEmissioneDialogComponent,
  MSG_EMISSIONE_PIU_DOCUMENTI,
  MSG_TRACCIATO_NON_VERIFICATO,
} from './conferma-emissione-dialog.component'

/** Righe delle ricerche lato server. */
export const DIMENSIONE_RICERCA = 25
/** Il corpo dell'export porta al più 2000 id (limite del backend, Task 25b). */
export const MAX_DOCUMENTI_SELEZIONABILI = 2000

export const MSG_NON_CARICATI = 'Impossibile caricare i documenti.'
export const MSG_ESPORTAZIONE_FALLITA = 'Impossibile esportare i documenti.'
export const MSG_SERVE_SELEZIONE =
  'Seleziona dei documenti o imposta un filtro (registro, anno, date o cliente) per esportare.'
export const MSG_SERVE_SELEZIONE_CON_STATO = 'Seleziona i documenti oppure togli il filtro di stato'
export const MSG_PERIODO_ROVESCIATO = 'La data iniziale è dopo quella finale.'
export const MSG_TROPPI_SELEZIONATI = `Si possono selezionare al massimo ${MAX_DOCUMENTI_SELEZIONABILI} documenti per volta.`
export const MSG_GESTIONALI_NON_CARICATI = 'Impossibile caricare i gestionali per l’export.'

const TITOLI_MAPPATURA: Readonly<Record<TipoMappatura, string>> = {
  CODICE_IVA: 'Codice IVA',
  CONTO_RICAVI: 'Conto ricavi',
  CLIENTE: 'Cliente',
  PAGAMENTO: 'Pagamento',
  REGISTRO: 'Registro',
}

/** Errore di un export: il vocabolario dei codici; 422 senza codice = XML non valido (m3). */
function messaggioEsportazione(err: unknown): string {
  const stato = (err as { status?: number } | null)?.status
  if (stato === 422 && codiceErrore(err) === null) return ERRORI_HTTP_VOCI.XML_NON_VALIDO.etichetta
  return messaggioDaCodice(err, MSG_ESPORTAZIONE_FALLITA)
}

/** Testo dei documenti annullati lasciati fuori da un export (`X-Documenti-Saltati`). */
export function testoSaltati(n: number): string {
  return n === 1 ? '1 documento annullato non incluso' : `${n} documenti annullati non inclusi`
}

type SeveritaTag = 'success' | 'info' | 'warning' | 'danger'
const SEVERITA_TAG: Record<SeveritaFatturazione, SeveritaTag> = {
  successo: 'success',
  info: 'info',
  avviso: 'warning',
  errore: 'danger',
}

interface Opzione {
  label: string
  value: string
}

/** Export in attesa di conferma. */
interface ExportInAttesa {
  formato: string
  nome: string
  verificato: boolean
}

/** Chiave richiesta e non ancora mappata, come arriva in `details.mancanti` del 409. */
interface MancanteVista {
  tipo: TipoMappatura
  titolo: string
  /** Mai la chiave grezza: potrebbe essere un id. */
  etichetta: string | null
}

function leggiMancanti(err: unknown): MancanteVista[] {
  const m = (err as { error?: { details?: { mancanti?: unknown } } } | null)?.error?.details
    ?.mancanti
  if (!Array.isArray(m)) return []
  return m
    .filter(
      (x): x is { tipo: TipoMappatura; etichetta?: unknown } =>
        typeof x === 'object' &&
        x !== null &&
        (TIPI_MAPPATURA as readonly string[]).includes((x as { tipo: string }).tipo)
    )
    .map(x => ({
      tipo: x.tipo,
      titolo: TITOLI_MAPPATURA[x.tipo],
      etichetta: typeof x.etichetta === 'string' && x.etichetta ? x.etichetta : null,
    }))
}

/** Le chiavi complete (con etichetta) da passare alla pagina delle mappature. */
function chiaviPerMappature(err: unknown): ChiaveMancante[] {
  const m = (err as { error?: { details?: { mancanti?: unknown } } } | null)?.error?.details
    ?.mancanti
  if (!Array.isArray(m)) return []
  return m.filter(
    (x): x is ChiaveMancante =>
      typeof x === 'object' &&
      x !== null &&
      (TIPI_MAPPATURA as readonly string[]).includes((x as ChiaveMancante).tipo) &&
      typeof (x as ChiaveMancante).chiaveWasteflow === 'string' &&
      (x as ChiaveMancante).chiaveWasteflow.length > 0 &&
      typeof (x as ChiaveMancante).etichetta === 'string'
  )
}

/**
 * Lista dei documenti di fattura (4.4c, Task 33): filtri per registro, anno, stato, cliente (ricerca
 * lato server) e date; selezione multipla; export CSV per tutti, XML (zip) e file dei gestionali
 * solo per gli amministratori, con conferma perché rendono i documenti «emessi».
 */
@Component({
  selector: 'app-documenti-lista',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CalendarModule,
    CheckboxModule,
    DropdownModule,
    PaginatorModule,
    TableModule,
    TagModule,
    ConfermaEmissioneDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Documenti</h1>
          <p class="page-subtitle">
            I documenti di fattura: bozze delle anteprime, definitivi e annullati.
          </p>
        </div>
        <div class="page-actions" data-testid="dl-export">
          <p-button
            label="Esporta CSV"
            icon="pi pi-file"
            [outlined]="true"
            [disabled]="!selezioneExport() || inEsportazione()"
            (onClick)="esportaCsv()"
            data-testid="dl-esporta-csv"
          />
          <ng-container *ngIf="permessi().scaricaXml">
            <p-button
              label="Esporta XML (zip)"
              icon="pi pi-download"
              [outlined]="true"
              [disabled]="!selezioneExport() || inEsportazione()"
              (onClick)="chiediEsportazione('XML_ZIP', 'XML (zip)', true)"
              data-testid="dl-esporta-xml"
            />
            <p-button
              *ngFor="let a of adattatoriFile()"
              [label]="'Esporta per ' + a.nome"
              icon="pi pi-download"
              [outlined]="true"
              [disabled]="!selezioneExport() || inEsportazione()"
              (onClick)="chiediEsportazione(a.codice, a.nome, a.verificato)"
              [attr.data-testid]="'dl-esporta-' + a.codice"
            />
          </ng-container>
        </div>
      </header>

      <p *ngIf="!selezioneExport()" class="text-secondary" data-testid="dl-serve-selezione">
        {{ msgServeSelezione() }}
      </p>

      <div class="dl-filtri" data-testid="dl-filtri">
        <div class="dl-campo">
          <label for="dl-registro">Registro</label>
          <p-dropdown
            inputId="dl-registro"
            [options]="opzioniRegistri()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="registroIvaId"
            (ngModelChange)="cambia('registroIvaId', $event)"
            [showClear]="true"
            placeholder="Tutti"
            styleClass="w-full"
            data-testid="dl-filtro-registro"
          />
        </div>
        <div class="dl-campo">
          <label for="dl-anno">Anno</label>
          <p-dropdown
            inputId="dl-anno"
            [options]="opzioniAnni"
            optionLabel="label"
            optionValue="value"
            [ngModel]="anno"
            (ngModelChange)="cambia('anno', $event)"
            [showClear]="true"
            placeholder="Tutti"
            styleClass="w-full"
            data-testid="dl-filtro-anno"
          />
        </div>
        <div class="dl-campo">
          <label for="dl-stato">Stato</label>
          <p-dropdown
            inputId="dl-stato"
            [options]="opzioniStati"
            optionLabel="label"
            optionValue="value"
            [ngModel]="stato"
            (ngModelChange)="cambia('stato', $event)"
            [showClear]="true"
            placeholder="Tutti"
            styleClass="w-full"
            data-testid="dl-filtro-stato"
          />
        </div>
        <div class="dl-campo">
          <label for="dl-cliente">Cliente</label>
          <p-dropdown
            inputId="dl-cliente"
            [options]="opzioniClienti()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="clienteId"
            (ngModelChange)="cambia('clienteId', $event)"
            [filter]="true"
            filterBy="label"
            filterPlaceholder="Cerca per nome, codice o partita IVA"
            (onFilter)="cercaClienti($event.filter ?? '')"
            [showClear]="true"
            placeholder="Tutti"
            styleClass="w-full"
            data-testid="dl-filtro-cliente"
          />
        </div>
        <div class="dl-campo">
          <label for="dl-dal">Dal</label>
          <p-calendar
            inputId="dl-dal"
            [ngModel]="dataDa"
            (ngModelChange)="cambia('dataDa', $event)"
            [showIcon]="true"
            [showClear]="true"
            dateFormat="dd/mm/yy"
            [maxDate]="fineGiorno()"
            (onShow)="aggiornaFineGiorno()"
            (onFocus)="aggiornaFineGiorno()"
            styleClass="w-full"
            data-testid="dl-filtro-dal"
          />
        </div>
        <div class="dl-campo">
          <label for="dl-al">Al</label>
          <p-calendar
            inputId="dl-al"
            [ngModel]="dataA"
            (ngModelChange)="cambia('dataA', $event)"
            [showIcon]="true"
            [showClear]="true"
            dateFormat="dd/mm/yy"
            [maxDate]="fineGiorno()"
            (onShow)="aggiornaFineGiorno()"
            (onFocus)="aggiornaFineGiorno()"
            styleClass="w-full"
            data-testid="dl-filtro-al"
          />
        </div>
      </div>
      <p *ngIf="periodoRovesciato()" role="alert" class="field-error" data-testid="dl-periodo">
        {{ msgPeriodoRovesciato }}
      </p>
      <p
        *ngIf="erroreClienti() as e"
        role="alert"
        class="field-error"
        data-testid="dl-errore-clienti"
      >
        {{ e }}
      </p>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="dl-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="dl-riprova"
        />
      </p>
      <p *ngIf="esito() as e" role="alert" class="field-error" data-testid="dl-esito">{{ e }}</p>
      <p *ngIf="infoSaltati() as s" role="status" class="text-secondary" data-testid="dl-saltati">
        {{ s }}
      </p>
      <p *ngIf="erroreSelezione() as s" role="alert" class="field-error" data-testid="dl-troppi">
        {{ s }}
      </p>

      <div *ngIf="mancanti() as m" class="dl-mancanti" role="alert" data-testid="dl-mancanti">
        <p>{{ msgMappatureMancanti }}</p>
        <ul>
          <li *ngFor="let x of m.elenco" data-testid="dl-mancante">
            {{ x.titolo }}<span *ngIf="x.etichetta">: {{ x.etichetta }}</span>
          </li>
        </ul>
        <p-button
          label="Completa le mappature"
          icon="pi pi-arrow-right"
          size="small"
          (onClick)="vaiAlleMappature()"
          data-testid="dl-completa-mappature"
        />
      </div>

      <div class="table-card">
        <p-table
          [value]="righe()"
          [loading]="caricamento()"
          dataKey="id"
          styleClass="p-datatable-sm tabella-schede"
          aria-label="Documenti di fattura"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">
                <p-checkbox
                  [binary]="true"
                  [ngModel]="paginaSelezionata()"
                  (onChange)="selezionaPagina($event.checked)"
                  ariaLabel="Seleziona i documenti della pagina"
                  data-testid="dl-seleziona-pagina"
                />
              </th>
              <th scope="col">Numero</th>
              <th scope="col">Data</th>
              <th scope="col">Cliente</th>
              <th scope="col">Tipo</th>
              <th scope="col">Stato</th>
              <th scope="col" class="num-col">Totale</th>
              <th scope="col"><span class="sr-only">Azioni</span></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr [attr.data-testid]="'documento-' + r.id">
              <td>
                <p-checkbox
                  [binary]="true"
                  [ngModel]="selezionato(r.id)"
                  (onChange)="seleziona(r.id, $event.checked)"
                  [ariaLabel]="'Seleziona il documento ' + (r.numeroTesto ?? '')"
                  [attr.data-testid]="'dl-sel-' + r.id"
                />
              </td>
              <td class="cell-nowrap" data-etichetta="Numero" data-testid="dl-numero">
                {{ r.numeroTesto ?? '—' }}
              </td>
              <td
                class="cell-nowrap"
                [class.dl-annullato]="r.stato === 'ANNULLATO'"
                data-etichetta="Data"
                data-testid="dl-data"
              >
                {{ giorno(r.dataDocumento) }}
              </td>
              <td data-etichetta="Cliente" data-testid="dl-cliente">
                {{ r.cliente.denominazione }}
              </td>
              <td data-etichetta="Tipo" data-testid="dl-tipo">
                {{ tipoDocumento(r.tipoDocumento) }}
              </td>
              <td data-etichetta="Stato" data-testid="dl-stato">
                <p-tag
                  [value]="voceStato(r.stato).etichetta"
                  [severity]="severita(voceStato(r.stato))"
                />
              </td>
              <td class="num-col" data-etichetta="Totale" data-testid="dl-totale">
                {{ importo(r.totaleDocumento) }}
              </td>
              <td class="cell-nowrap">
                <p-button
                  label="Apri"
                  icon="pi pi-arrow-right"
                  [text]="true"
                  size="small"
                  (onClick)="apri(r)"
                  [attr.data-testid]="'dl-apri-' + r.id"
                />
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="8">
                <div class="empty-state" data-testid="dl-vuota">
                  <span class="empty-state__title">Nessun documento.</span>
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
          data-testid="dl-paginatore"
        />
      </div>

      <app-conferma-emissione-dialog
        *ngIf="permessi().scaricaXml"
        [visible]="inAttesa() !== null"
        [titolo]="'Esporta ' + (inAttesa()?.nome ?? '')"
        [messaggio]="messaggioEmissione"
        [avviso]="
          inAttesa() && !inAttesa()!.verificato && inAttesa()!.formato !== 'XML_ZIP'
            ? avvisoTracciato
            : null
        "
        [etichettaConferma]="'Esporta'"
        [inCorso]="inEsportazione()"
        (confermato)="confermaEsportazione()"
        (chiuso)="inAttesa.set(null)"
      />
    </div>
  `,
  styles: [
    `
      .dl-filtri {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
        gap: var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
      .dl-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        min-width: 0;
      }
      .dl-annullato {
        text-decoration: line-through;
        color: var(--text-secondary);
      }
      .dl-mancanti {
        border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-danger);
        border-radius: var(--radius-md);
        padding: var(--spacing-sm) var(--spacing-md);
        margin-bottom: var(--spacing-md);
      }
    `,
  ],
})
export class DocumentiListaComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly clienti = inject(ClientiService)
  private readonly tabelle = inject(TabelleFatturazioneService)
  private readonly router = inject(Router)
  private readonly auth = inject(AuthService)
  private readonly destroyRef = inject(DestroyRef)

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  // Filtri (ngModel).
  registroIvaId: string | null = null
  anno: number | null = null
  stato: StatoDocumento | null = null
  clienteId: string | null = null
  dataDa: Date | null = null
  dataA: Date | null = null

  readonly righe = signal<DocumentoRiga[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  /** Mai oltre 100: il backend risponde 400 sopra il tetto. */
  readonly dimensione = Math.min(50, DIMENSIONE_MASSIMA)
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly esito = signal<string | null>(null)
  readonly infoSaltati = signal<string | null>(null)
  readonly erroreSelezione = signal<string | null>(null)
  readonly erroreClienti = signal<string | null>(null)

  readonly opzioniRegistri = signal<Opzione[]>([])
  readonly opzioniClienti = signal<Opzione[]>([])
  readonly adattatori = signal<AdattatoreVista[]>([])
  readonly adattatoriFile = computed(() => this.adattatori().filter(a => a.modalita === 'FILE'))
  private clienteScelto: Opzione | null = null

  readonly selezione = signal<ReadonlySet<string>>(new Set())
  readonly inEsportazione = signal(false)
  readonly inAttesa = signal<ExportInAttesa | null>(null)
  readonly mancanti = signal<{
    formato: string
    elenco: MancanteVista[]
    chiavi: ChiaveMancante[]
    /** La selezione dell'export respinto, non quella di quando si clicca il link. */
    selezione: SelezioneExport
  } | null>(null)

  /** Fine del giorno italiano di oggi, ricalcolata a ogni apertura del calendario. */
  readonly fineGiorno = signal<Date>(fineGiornoDiOggi())

  readonly giorno = formattaGiorno
  readonly importo = importoItaliano
  readonly msgServeSelezione = (): string =>
    this.stato ? MSG_SERVE_SELEZIONE_CON_STATO : MSG_SERVE_SELEZIONE
  readonly msgPeriodoRovesciato = MSG_PERIODO_ROVESCIATO
  readonly msgMappatureMancanti =
    'Mancano delle mappature per il gestionale. Completale e ripeti l’export.'
  readonly messaggioEmissione = MSG_EMISSIONE_PIU_DOCUMENTI
  readonly avvisoTracciato = MSG_TRACCIATO_NON_VERIFICATO
  readonly tipoDocumento = (t: string): string => TIPI_DOCUMENTO_VOCI[t]?.etichetta ?? t
  readonly voceStato = (s: StatoDocumento): VoceVocabolario =>
    STATI_DOCUMENTO_VOCI[s] ?? { etichetta: s, severita: 'info' }
  readonly severita = (v: VoceVocabolario): SeveritaTag => SEVERITA_TAG[v.severita]
  readonly opzioniStati: { label: string; value: StatoDocumento }[] = (
    ['BOZZA', 'DEFINITIVO', 'ANNULLATO'] as const
  ).map(s => ({ label: STATI_DOCUMENTO_VOCI[s].etichetta, value: s }))
  readonly opzioniAnni: { label: string; value: number }[] = (() => {
    const corrente = fineGiornoDiOggi().getFullYear()
    return Array.from({ length: 7 }, (_, i) => ({
      label: String(corrente - i),
      value: corrente - i,
    }))
  })()
  /** Salvataggio del file: sostituibile nei test. */
  salva: (file: FileScaricato, nomePredefinito: string) => void = salvaFile

  /** Una lettura nuova annulla quella pendente: una risposta tardiva non sovrascrive la lista. */
  private readonly richiesta$ = new Subject<void>()
  private readonly ricercaClienti$ = new Subject<string>()

  constructor() {
    this.richiesta$
      .pipe(
        tap(() => {
          this.caricamento.set(true)
          this.errore.set(null)
        }),
        switchMap(() =>
          this.servizio
            .documenti({
              pagina: this.pagina(),
              dimensione: this.dimensione,
              registroIvaId: this.registroIvaId ?? undefined,
              anno: this.anno ?? undefined,
              stato: this.stato ?? undefined,
              clienteId: this.clienteId ?? undefined,
              dataDa: this.dataDa ? isoLocale(this.dataDa) : undefined,
              dataA: this.dataA ? isoLocale(this.dataA) : undefined,
            })
            .pipe(
              catchError(err => {
                this.caricamento.set(false)
                this.errore.set(messaggioDaCodice(err, MSG_NON_CARICATI))
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

    this.ricercaClienti$
      .pipe(
        switchMap(t =>
          (t === '' ? of(t) : of(t).pipe(debounceTime(300))).pipe(
            switchMap(x => this.leggiClienti(x))
          )
        ),
        takeUntilDestroyed()
      )
      .subscribe(o => {
        if (o !== null) this.opzioniClienti.set(this.conScelto(o))
      })

    this.tabelle.registri
      .list({ incluseDisattivate: true })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (r: RegistroIva[]) =>
          this.opzioniRegistri.set(r.map(x => ({ label: x.codice, value: x.id }))),
        error: () => this.opzioniRegistri.set([]),
      })

    if (this.permessi().scaricaXml) {
      this.servizio
        .adattatori()
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: a => this.adattatori.set(a),
          error: () => this.esito.set(MSG_GESTIONALI_NON_CARICATI),
        })
    }

    this.ricercaClienti$.next('')
    this.carica()
  }

  private leggiClienti(testo: string) {
    this.erroreClienti.set(null)
    const t = testo.trim()
    return this.clienti.clienti
      .list({ ...(t ? { testo: t } : {}), dimensione: DIMENSIONE_RICERCA })
      .pipe(
        map(
          p =>
            p.elementi.map(c => ({
              label: c.codice ? `${c.codice} · ${c.ditta.ragioneSociale}` : c.ditta.ragioneSociale,
              value: c.id,
            })) as Opzione[]
        ),
        catchError(() => {
          this.erroreClienti.set('Impossibile caricare i clienti: riprova a cercare.')
          return of(null)
        })
      )
  }

  /** Il cliente scelto resta in testa all'elenco, altrimenti PrimeNG mostrerebbe «Tutti». */
  private conScelto(o: Opzione[]): Opzione[] {
    const s = this.clienteScelto
    return s && !o.some(x => x.value === s.value) ? [s, ...o] : o
  }

  cercaClienti(testo: string): void {
    this.ricercaClienti$.next(testo)
  }

  aggiornaFineGiorno(): void {
    this.fineGiorno.set(fineGiornoDiOggi())
  }

  periodoRovesciato(): boolean {
    return !!this.dataDa && !!this.dataA && this.dataDa.getTime() > this.dataA.getTime()
  }

  /** Cambia un filtro: torna a pagina 1, azzera la selezione e rilegge (se il periodo è valido). */
  cambia(
    campo: 'registroIvaId' | 'anno' | 'stato' | 'clienteId' | 'dataDa' | 'dataA',
    valore: unknown
  ): void {
    const v = valore === '' || valore === undefined ? null : valore
    switch (campo) {
      case 'registroIvaId':
        this.registroIvaId = v as string | null
        break
      case 'anno':
        this.anno = v as number | null
        break
      case 'stato':
        this.stato = v as StatoDocumento | null
        break
      case 'clienteId':
        this.clienteId = v as string | null
        this.clienteScelto = this.opzioniClienti().find(o => o.value === this.clienteId) ?? null
        break
      case 'dataDa':
        this.dataDa = v as Date | null
        break
      case 'dataA':
        this.dataA = v as Date | null
        break
    }
    this.pagina.set(1)
    this.mancanti.set(null)
    this.esito.set(null)
    this.infoSaltati.set(null)
    this.selezione.set(new Set())
    this.erroreSelezione.set(null)
    if (!this.periodoRovesciato()) this.carica()
  }

  carica(): void {
    this.richiesta$.next()
  }

  cambiaPagina(e: PaginatorState): void {
    this.pagina.set((e.page ?? 0) + 1)
    this.carica()
  }

  apri(r: DocumentoRiga): void {
    void this.router.navigate(['/fatturazione', 'documenti', r.id])
  }

  // --- Selezione ---------------------------------------------------------------------------

  selezionato(id: string): boolean {
    return this.selezione().has(id)
  }

  paginaSelezionata(): boolean {
    const r = this.righe()
    return r.length > 0 && r.every(x => this.selezione().has(x.id))
  }

  seleziona(id: string, si: boolean): void {
    this.imposta([id], si)
  }

  selezionaPagina(si: boolean): void {
    this.imposta(
      this.righe().map(r => r.id),
      si
    )
  }

  private imposta(ids: string[], si: boolean): void {
    const nuova = new Set(this.selezione())
    for (const id of ids) {
      if (!si) nuova.delete(id)
      else if (nuova.size < MAX_DOCUMENTI_SELEZIONABILI) nuova.add(id)
    }
    const troppi = si && ids.some(id => !nuova.has(id))
    this.erroreSelezione.set(troppi ? MSG_TROPPI_SELEZIONATI : null)
    this.selezione.set(nuova)
  }

  /** Formati diversi da CSV (XML, gestionali): solo ADMIN. */
  private puoEsportareOltreCsv(): boolean {
    return this.permessi().scaricaXml
  }

  /** Che cosa esportare: i documenti scelti, altrimenti i filtri; `null` se non c'è né l'uno né l'altro. */
  readonly selezioneExport = (): SelezioneExport | null => {
    const scelti = this.selezione()
    if (scelti.size > 0) return { documentoIds: [...scelti] }
    // `SelezioneExport` non ha lo stato: un export per filtro esporterebbe più di ciò che la lista mostra.
    if (this.stato) return null
    const s: SelezioneExport = {
      ...(this.registroIvaId ? { registroIvaId: this.registroIvaId } : {}),
      ...(this.anno ? { anno: this.anno } : {}),
      ...(this.dataDa ? { dataDa: isoLocale(this.dataDa) } : {}),
      ...(this.dataA ? { dataA: isoLocale(this.dataA) } : {}),
      ...(this.clienteId ? { clienteId: this.clienteId } : {}),
    }
    return Object.keys(s).length > 0 && !this.periodoRovesciato() ? s : null
  }

  // --- Export ------------------------------------------------------------------------------

  esportaCsv(): void {
    this.esporta('CSV', false)
  }

  /** XML e gestionali rendono «emessi» i documenti: prima la conferma. */
  chiediEsportazione(formato: string, nome: string, verificato: boolean): void {
    if (!this.puoEsportareOltreCsv() || this.inEsportazione() || !this.selezioneExport()) return
    this.inAttesa.set({ formato, nome, verificato })
  }

  confermaEsportazione(): void {
    const a = this.inAttesa()
    if (a !== null && this.puoEsportareOltreCsv()) this.esporta(a.formato, true)
  }

  private esporta(formato: string, confermaEmissione: boolean): void {
    const selezione = this.selezioneExport()
    if (selezione === null || this.inEsportazione()) return
    if (formato !== 'CSV' && !this.puoEsportareOltreCsv()) return
    this.inEsportazione.set(true)
    this.esito.set(null)
    this.infoSaltati.set(null)
    this.mancanti.set(null)
    this.servizio
      .esporta(formato, selezione, confermaEmissione)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: file => {
          this.inEsportazione.set(false)
          this.inAttesa.set(null)
          this.salva(file, formato === 'XML_ZIP' ? 'documenti-xml.zip' : 'documenti.zip')
          if (file.saltati > 0) this.infoSaltati.set(testoSaltati(file.saltati))
          // I documenti esportati con conferma sono diventati emessi: la lista cambia.
          if (confermaEmissione) this.carica()
        },
        error: (err: unknown) =>
          void erroreDaBlob(err).then(e => {
            this.inEsportazione.set(false)
            this.inAttesa.set(null)
            if (codiceErrore(e) === 'MAPPATURE_MANCANTI') {
              this.mancanti.set({
                formato,
                elenco: leggiMancanti(e),
                chiavi: chiaviPerMappature(e),
                selezione,
              })
            } else {
              this.esito.set(messaggioEsportazione(e))
            }
          }),
      })
  }

  /** Salva la selezione usata e va alle mappature (contratto con il Task 35). */
  vaiAlleMappature(): void {
    const m = this.mancanti()
    if (m === null) return
    try {
      sessionStorage.setItem(CHIAVE_SELEZIONE_MAPPATURE, JSON.stringify(m.selezione))
    } catch {
      /* sessionStorage non disponibile: la pagina delle mappature riparte senza selezione */
    }
    void this.router.navigate(['/fatturazione', 'export-contabile', m.formato], {
      state: { mancanti: m.chiavi },
    })
  }
}
