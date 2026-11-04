import { CommonModule } from '@angular/common'
import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Subject, of } from 'rxjs'
import { catchError, debounceTime, switchMap, tap } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { PaginatorModule, PaginatorState } from 'primeng/paginator'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { formattaGiorno } from '../giacenze/giorno'
import { ClientiService } from '../clienti/clienti.service'
import { RegistroService } from '../registro/registro.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import { ImpostazioneFatturazioneService } from './impostazioni-fatturazione.service'
import { AggiornaPrezziDialogComponent } from './aggiorna-prezzi-dialog.component'
import { LegameDialogComponent } from './legame-dialog.component'
import { LegamiService } from './legami.service'
import {
  CorpoAzioneMassa,
  EsitoAggiornamento,
  EsitoAzioneMassa,
  FiltriLista,
  LegameVista,
  MOTIVI_LEGAME,
  RigaLista,
  StatoLista,
} from './legami.model'
import { permessiLegami } from './permessi-legami'
import { etichettaAvviso, etichettaMotivo, etichettaStato, severitaTag } from './vocabolario-legami'

/** Righe per azione di massa: il tetto del backend (`@ArrayMaxSize(500)` su elementi + movimenti). */
export const TETTO_AZIONE_MASSA = 500
export const MSG_TETTO = `Puoi agire su al massimo ${TETTO_AZIONE_MASSA} righe alla volta.`
export const MSG_FATTURAZIONE_NON_ATTIVA = 'Fatturazione non attiva'
export const LUNGHEZZA_MAX_MOTIVO = 200

/** Stati che si possono scegliere nel filtro (gli altri non compaiono mai nella lista). */
const STATI_FILTRO: StatoLista[] = ['MANCANTE', 'DA_COLLEGARE', 'PROPOSTO', 'DA_RIALLINEARE']

const plurale = (n: number, uno: string, molti: string): string => `${n} ${n === 1 ? uno : molti}`

/** «3 confermati, 1 saltato» (o «2 esclusi»). */
export function riepilogoEsito(azione: 'CONFERMA' | 'ESCLUDI', e: EsitoAzioneMassa): string {
  const fatti =
    azione === 'CONFERMA'
      ? plurale(e.riusciti, 'confermato', 'confermati')
      : plurale(e.riusciti, 'escluso', 'esclusi')
  return e.falliti.length ? `${fatti}, ${plurale(e.falliti.length, 'saltato', 'saltati')}` : fatti
}

interface OpzioneId {
  label: string
  value: string
}

/**
 * Pagina «Da collegare» (fase 4.3, Task 28): i movimenti del registro che aspettano un legame col
 * cliente e il listino. Filtri, selezione multipla, «Conferma» ed «Escludi» di massa (tetto 500),
 * apertura del legame in finestra per modifica e conferma singola, «Riammetti» dagli esclusi.
 * Il VIEWER legge soltanto.
 */
@Component({
  selector: 'app-da-collegare',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DropdownModule,
    InputTextModule,
    InputTextareaModule,
    PaginatorModule,
    AggiornaPrezziDialogComponent,
    TableModule,
    TagModule,
    LegameDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Da collegare</h1>
          <p class="page-subtitle">
            Movimenti del registro che aspettano di essere collegati a un cliente e al suo listino
            per la fatturazione.
          </p>
        </div>
        <!-- Azioni di pagina: «Aggiorna prezzi» solo per ADMIN e SUPER_ADMIN (spec §9). -->
        <div class="page-actions" data-testid="legami-azioni-pagina">
          <p-button
            *ngIf="permessi().aggiornaPrezzi"
            label="Aggiorna prezzi"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="aggiornaPrezziAperta.set(true)"
            data-testid="aggiorna-prezzi-apri"
          />
        </div>
      </header>

      <div class="filters" role="search" aria-label="Filtri">
        <div class="filters__field">
          <label class="filters__label" for="dc-dal">Dal</label>
          <input
            pInputText
            id="dc-dal"
            type="date"
            [ngModel]="dal"
            (ngModelChange)="dal = $event; applica()"
            data-testid="filtro-dal"
          />
        </div>
        <div class="filters__field">
          <label class="filters__label" for="dc-al">Al</label>
          <input
            pInputText
            id="dc-al"
            type="date"
            [ngModel]="al"
            (ngModelChange)="al = $event; applica()"
            data-testid="filtro-al"
          />
        </div>
        <div class="filters__field">
          <label class="filters__label" for="dc-cliente">Cliente</label>
          <p-dropdown
            inputId="dc-cliente"
            [options]="opzioniClienti()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="clienteId"
            (ngModelChange)="clienteId = $event; applica()"
            [showClear]="true"
            [filter]="true"
            (onFilter)="cercaClienti($event.filter ?? '')"
            placeholder="Tutti"
            data-testid="filtro-cliente"
          />
        </div>
        <div class="filters__field">
          <label class="filters__label" for="dc-registro">Registro</label>
          <p-dropdown
            inputId="dc-registro"
            [options]="opzioniRegistri()"
            optionLabel="label"
            optionValue="value"
            [ngModel]="registroId"
            (ngModelChange)="registroId = $event; applica()"
            [showClear]="true"
            placeholder="Tutti"
            data-testid="filtro-registro"
          />
        </div>
        <div class="filters__field">
          <label class="filters__label" for="dc-stato">Stato</label>
          <p-dropdown
            inputId="dc-stato"
            [options]="opzioniStato"
            optionLabel="label"
            optionValue="value"
            [ngModel]="stato"
            (ngModelChange)="stato = $event; applica()"
            [showClear]="true"
            [disabled]="esclusi"
            placeholder="Tutti"
            data-testid="filtro-stato"
          />
        </div>
        <div class="filters__field">
          <label class="filters__label" for="dc-motivo">Motivo</label>
          <p-dropdown
            inputId="dc-motivo"
            [options]="opzioniMotivo"
            optionLabel="label"
            optionValue="value"
            [ngModel]="motivo"
            (ngModelChange)="motivo = $event; applica()"
            [showClear]="true"
            placeholder="Tutti"
            data-testid="filtro-motivo"
          />
        </div>
        <div class="filters__field filters__field--stretto">
          <label class="filters__label" for="dc-esclusi">Esclusi</label>
          <input
            id="dc-esclusi"
            type="checkbox"
            [ngModel]="esclusi"
            (ngModelChange)="esclusi = $event; applica()"
            data-testid="filtro-esclusi"
          />
        </div>
      </div>

      <p *ngIf="erroreClienti() as e" role="alert" class="field-error" data-testid="clienti-errore">
        {{ e }}
      </p>

      <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="legami-errore">
        {{ e }}
        <p-button
          label="Riprova"
          icon="pi pi-refresh"
          [text]="true"
          size="small"
          (onClick)="carica()"
          data-testid="legami-riprova"
        />
      </p>

      <section
        *ngIf="esito() as e"
        class="avviso-riquadro"
        [class.avviso-riquadro--warn]="e.falliti.length > 0"
        [class.avviso-riquadro--ok]="e.falliti.length === 0"
        role="status"
        data-testid="esito-massa"
      >
        <strong data-testid="esito-riepilogo">{{ riepilogo() }}</strong>
        <ul *ngIf="e.falliti.length" class="esito-saltati" data-testid="esito-saltati">
          <li *ngFor="let f of e.falliti">{{ descrizioneFallito(f) }}: {{ f.messaggio }}</li>
        </ul>
        <p-button
          label="Chiudi"
          [text]="true"
          size="small"
          (onClick)="esito.set(null)"
          data-testid="esito-chiudi"
        />
      </section>

      <section
        *ngIf="permessi().scrive && !esclusi && selezionate() > 0"
        class="barra-massa"
        aria-label="Azioni sulle righe selezionate"
        data-testid="barra-massa"
      >
        <span data-testid="selezione-conteggio">{{ selezionate() }} selezionate</span>
        <p-button
          label="Conferma"
          icon="pi pi-check"
          [disabled]="oltreTetto() || inCorso()"
          (onClick)="conferma()"
          data-testid="massa-conferma"
        />
        <p-button
          label="Escludi"
          icon="pi pi-ban"
          [outlined]="true"
          severity="danger"
          [disabled]="oltreTetto() || inCorso()"
          (onClick)="apriEscludi()"
          data-testid="massa-escludi"
        />
        <p-button
          label="Deseleziona"
          [text]="true"
          (onClick)="deseleziona()"
          data-testid="massa-deseleziona"
        />
        <p *ngIf="oltreTetto()" class="field-error" role="alert" data-testid="massa-tetto">
          {{ msgTetto }} Ne hai selezionate {{ selezionate() }}.
        </p>
        <div *ngIf="escludiAperto()" class="massa-escludi" data-testid="massa-escludi-pannello">
          <label for="dc-motivo-esclusione">Motivo dell'esclusione (obbligatorio)</label>
          <textarea
            pInputTextarea
            id="dc-motivo-esclusione"
            rows="2"
            [maxLength]="lunghezzaMaxMotivo"
            [(ngModel)]="motivoEsclusione"
            data-testid="massa-motivo"
          ></textarea>
          <p-button
            label="Conferma esclusione"
            icon="pi pi-ban"
            severity="danger"
            [disabled]="!motivoValido() || oltreTetto() || inCorso()"
            (onClick)="escludi()"
            data-testid="massa-escludi-conferma"
          />
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="escludiAperto.set(false)"
            data-testid="massa-escludi-annulla"
          />
        </div>
      </section>

      <div class="table-card">
        <p-table
          [value]="righe()"
          [loading]="caricamento()"
          dataKey="movimentoId"
          styleClass="p-datatable-sm"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col" *ngIf="permessi().scrive && !esclusi" style="width: 2.5rem">
                <input
                  type="checkbox"
                  aria-label="Seleziona tutte le righe della pagina"
                  [checked]="tuttiSelezionati()"
                  (change)="selezionaPagina($any($event.target).checked)"
                  data-testid="seleziona-pagina"
                />
              </th>
              <th scope="col">Data</th>
              <th scope="col">CER</th>
              <th scope="col" class="num-col">Quantità</th>
              <th scope="col">Cliente</th>
              <th scope="col">Stato</th>
              <th scope="col">Da sistemare</th>
              <th scope="col"><span class="sr-only">Azioni</span></th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr [attr.data-testid]="'riga-' + r.movimentoId">
              <td *ngIf="permessi().scrive && !esclusi">
                <input
                  type="checkbox"
                  [attr.aria-label]="'Seleziona il movimento del ' + giorno(r.dataMovimento)"
                  [checked]="eSelezionata(r)"
                  (change)="seleziona(r, $any($event.target).checked)"
                  [attr.data-testid]="'sel-' + r.movimentoId"
                />
              </td>
              <td class="cell-nowrap">{{ giorno(r.dataMovimento) }}</td>
              <td class="cell-mono">
                {{ r.cerCode }}
                <small class="cell-sub cell-ellipsis" *ngIf="r.descrizioneMovimento">{{
                  r.descrizioneMovimento
                }}</small>
              </td>
              <td class="num-col">{{ r.quantita }} {{ r.unita }}</td>
              <td>{{ r.cliente?.etichetta ?? '-' }}</td>
              <td>
                <div class="stato-stack">
                  <p-tag
                    [value]="statoEtichetta(r.stato)"
                    [severity]="statoSeverita(r.stato)"
                    [attr.data-testid]="'stato-' + r.movimentoId"
                  />
                  <small *ngIf="r.fatturato" class="cell-sub">fatturato</small>
                </div>
              </td>
              <td>
                <ul class="elenco-compatto" [attr.data-testid]="'motivi-' + r.movimentoId">
                  <li *ngFor="let m of r.motivi" data-testid="motivo">{{ motivoEt(m) }}</li>
                  <li *ngFor="let a of r.avvisi" data-testid="avviso">{{ avvisoEt(a) }}</li>
                </ul>
              </td>
              <td class="cell-nowrap">
                <p-button
                  *ngIf="r.stato === 'ESCLUSO' && permessi().scrive; else apri"
                  label="Riammetti"
                  icon="pi pi-undo"
                  [outlined]="true"
                  size="small"
                  [disabled]="inCorso()"
                  (onClick)="riammetti(r)"
                  [attr.data-testid]="'riammetti-' + r.movimentoId"
                />
                <ng-template #apri>
                  <p-button
                    [label]="permessi().scrive ? 'Apri' : 'Dettaglio'"
                    icon="pi pi-pencil"
                    [text]="true"
                    size="small"
                    [disabled]="inCorso() || (!permessi().scrive && r.legameId === null)"
                    [title]="
                      !permessi().scrive && r.legameId === null ? 'Nessun legame ancora' : ''
                    "
                    (onClick)="apriLegame(r)"
                    [attr.data-testid]="'apri-' + r.movimentoId"
                  />
                </ng-template>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td [attr.colspan]="8">
                <div class="empty-state" data-testid="legami-vuota">
                  <span class="empty-state__title">{{ messaggioVuoto() }}</span>
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
          data-testid="legami-paginatore"
        />
      </div>

      <app-aggiorna-prezzi-dialog
        *ngIf="aggiornaPrezziAperta() && permessi().aggiornaPrezzi"
        [visible]="true"
        (applicato)="dopoAggiornaPrezzi($event)"
        (chiuso)="aggiornaPrezziAperta.set(false)"
      />

      <app-legame-dialog
        [legame]="aperto()"
        [puoScrivere]="permessi().scrive"
        [clienti]="opzioniClienti()"
        (cercaCliente)="cercaClienti($event)"
        (aggiornato)="dopoAggiornamento($event)"
        (chiuso)="chiudiLegame()"
      />
    </div>
  `,
  styles: [
    `
      .barra-massa {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
        align-items: center;
        margin-bottom: var(--spacing-md);
      }
      .massa-escludi {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex-basis: 100%;
        max-width: 40rem;
      }
      .elenco-compatto {
        list-style: none;
        margin: 0;
        padding: 0;
        font-size: var(--font-size-sm);
      }
      .esito-saltati {
        margin: var(--spacing-xs) 0;
        padding-left: var(--spacing-lg);
      }
    `,
  ],
})
export class DaCollegareComponent implements OnInit {
  private readonly servizio = inject(LegamiService)
  private readonly fatturazione = inject(ImpostazioneFatturazioneService)
  private readonly clienti = inject(ClientiService)
  private readonly registri = inject(RegistroService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly permessi = computed(() => permessiLegami(this.auth.currentUser()?.role))

  readonly righe = signal<RigaLista[]>([])
  readonly totale = signal(0)
  readonly pagina = signal(1)
  readonly dimensione = 50
  readonly caricamento = signal(false)
  readonly errore = signal<string | null>(null)
  readonly fatturazioneSpenta = signal(false)
  readonly inCorso = signal(false)
  readonly esito = signal<({ azione: 'CONFERMA' | 'ESCLUDI' } & EsitoAzioneMassa) | null>(null)
  readonly aperto = signal<LegameVista | null>(null)
  readonly aggiornaPrezziAperta = signal(false)
  readonly opzioniClienti = signal<OpzioneId[]>([])
  readonly erroreClienti = signal<string | null>(null)
  private readonly ricercaClienti = new Subject<string>()
  readonly opzioniRegistri = signal<OpzioneId[]>([])

  /** Selezione per movimento: attraversa le pagine. */
  private readonly sel = signal<ReadonlyMap<string, RigaLista>>(new Map())
  readonly selezionate = computed(() => this.sel().size)
  readonly oltreTetto = computed(() => this.sel().size > TETTO_AZIONE_MASSA)
  readonly escludiAperto = signal(false)
  readonly riepilogo = computed(() => {
    const e = this.esito()
    return e ? riepilogoEsito(e.azione, e) : ''
  })

  // Filtri (campi del form).
  dal = ''
  al = ''
  clienteId: string | null = null
  registroId: string | null = null
  stato: StatoLista | null = null
  motivo: string | null = null
  esclusi = false
  motivoEsclusione = ''

  readonly msgTetto = MSG_TETTO
  readonly lunghezzaMaxMotivo = LUNGHEZZA_MAX_MOTIVO
  readonly opzioniStato = STATI_FILTRO.map(s => ({ label: etichettaStato(s), value: s }))
  readonly opzioniMotivo = MOTIVI_LEGAME.map(m => ({ label: etichettaMotivo(m), value: m }))
  readonly statoEtichetta = etichettaStato
  readonly statoSeverita = severitaTag
  readonly motivoEt = etichettaMotivo
  readonly avvisoEt = etichettaAvviso
  readonly giorno = formattaGiorno

  ngOnInit(): void {
    this.carica()
    // I menu dei filtri sono un di più: se non si caricano la lista funziona lo stesso.
    this.ricercaClienti
      .pipe(
        debounceTime(300),
        switchMap(testo => this.leggiClienti(testo))
      )
      .subscribe(o => this.impostaClienti(o))
    this.leggiClienti('').subscribe(o => this.impostaClienti(o))
    this.registri.listRegistri().subscribe({
      next: r =>
        this.opzioniRegistri.set(
          r.filter(x => x.attivo).map(x => ({ label: x.denominazione, value: x.id }))
        ),
      error: () => this.opzioniRegistri.set([]),
    })
  }

  /** Ricerca sul server: solo clienti attivi, al massimo 25 (il backend accetta fino a 100). */
  private leggiClienti(testo: string) {
    this.erroreClienti.set(null)
    const t = testo.trim()
    return this.clienti.clienti
      .list({ ...(t ? { testo: t } : {}), soloAttivi: true, dimensione: 25 })
      .pipe(
        switchMap(p =>
          of(p.elementi.map(c => ({ label: c.ditta.ragioneSociale, value: c.id })) as OpzioneId[])
        ),
        catchError(() => {
          this.erroreClienti.set('Impossibile caricare i clienti: riprova a cercare.')
          return of(null)
        })
      )
  }

  private impostaClienti(o: OpzioneId[] | null): void {
    // Con un errore il menu resta com'era; il messaggio lo dice.
    if (o !== null) this.opzioniClienti.set(o)
  }

  /** «Aggiorna prezzi» applicato: si chiude la finestra, si rilegge la lista e il contatore del menu. */
  dopoAggiornaPrezzi(e: EsitoAggiornamento): void {
    this.aggiornaPrezziAperta.set(false)
    const dc = e.daCollegare ?? 0
    this.toast.success(
      `Prezzi aggiornati: ${e.aggiornati} ${e.aggiornati === 1 ? 'legame' : 'legami'}` +
        (e.saltati > 0 ? `, ${e.saltati} saltati` : '') +
        (dc > 0 ? `, ${dc} tornati a Da collegare` : '') +
        '.'
    )
    this.servizio.aggiornaContatori()
    this.carica()
  }

  /** Testo del filtro del menu cliente (pagina e dialog): ricerca sul server con attesa di 300 ms. */
  cercaClienti(testo: string): void {
    this.ricercaClienti.next(testo)
  }

  /** Filtri per il backend: «Esclusi» mostra solo gli esclusi (per riammetterli). */
  filtri(): FiltriLista {
    const f: FiltriLista = {
      esclusi: this.esclusi,
      pagina: this.pagina(),
      dimensione: this.dimensione,
    }
    if (this.dal) f.dal = this.dal
    if (this.al) f.al = this.al
    if (this.clienteId) f.clienteId = this.clienteId
    if (this.registroId) f.registroId = this.registroId
    if (this.motivo) f.motivo = this.motivo as FiltriLista['motivo']
    if (this.esclusi) f.stati = ['ESCLUSO']
    else if (this.stato) f.stati = [this.stato]
    return f
  }

  /** Cambio di un filtro: si riparte dalla prima pagina. */
  applica(): void {
    // La selezione riguardava righe che con i nuovi filtri potrebbero non essere più visibili.
    this.deseleziona()
    this.pagina.set(1)
    this.carica()
  }

  cambiaPagina(e: PaginatorState): void {
    this.pagina.set((e.page ?? 0) + 1)
    this.carica()
  }

  carica(): void {
    this.caricamento.set(true)
    this.errore.set(null)
    this.servizio.lista(this.filtri()).subscribe({
      next: p => {
        this.righe.set(p.elementi)
        this.totale.set(p.totale)
        this.caricamento.set(false)
        if (p.totale === 0) this.controllaFatturazione()
        else this.fatturazioneSpenta.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(leggiErroriAzione(err, 'Impossibile caricare la lista.').messaggi.join(' '))
      },
    })
  }

  /** Lista vuota: distingue «nulla da fare» da «fatturazione spenta» (nessuna data impostata). */
  private controllaFatturazione(): void {
    this.fatturazione.leggi().subscribe({
      next: i => this.fatturazioneSpenta.set(i.fatturazioneDa === null),
      error: () => this.fatturazioneSpenta.set(false),
    })
  }

  messaggioVuoto(): string {
    if (this.fatturazioneSpenta()) return MSG_FATTURAZIONE_NON_ATTIVA
    return this.esclusi ? 'Nessun movimento escluso.' : 'Nessun movimento da collegare.'
  }

  // ---- selezione ----

  eSelezionata(r: RigaLista): boolean {
    return this.sel().has(r.movimentoId)
  }

  seleziona(r: RigaLista, si: boolean): void {
    const m = new Map(this.sel())
    if (si) m.set(r.movimentoId, r)
    else m.delete(r.movimentoId)
    this.sel.set(m)
  }

  tuttiSelezionati(): boolean {
    const r = this.righe()
    return r.length > 0 && r.every(x => this.sel().has(x.movimentoId))
  }

  selezionaPagina(si: boolean): void {
    const m = new Map(this.sel())
    for (const r of this.righe()) {
      if (si) m.set(r.movimentoId, r)
      else m.delete(r.movimentoId)
    }
    this.sel.set(m)
  }

  deseleziona(): void {
    this.sel.set(new Map())
    this.escludiAperto.set(false)
  }

  // ---- azioni di massa ----

  /** Corpo dell'azione: i legami esistenti con la versione vista, i MANCANTI per movimento. */
  corpo(azione: 'CONFERMA' | 'ESCLUDI', motivo?: string): CorpoAzioneMassa {
    const elementi: CorpoAzioneMassa['elementi'] = []
    const movimentoIds: string[] = []
    for (const r of this.sel().values()) {
      if (r.legameId !== null && r.versione !== null) {
        elementi.push({ legameId: r.legameId, versione: r.versione })
      } else {
        movimentoIds.push(r.movimentoId)
      }
    }
    return {
      azione,
      elementi,
      ...(movimentoIds.length ? { movimentoIds } : {}),
      ...(motivo !== undefined ? { motivo } : {}),
    }
  }

  conferma(): void {
    this.eseguiMassa(this.corpo('CONFERMA'))
  }

  apriEscludi(): void {
    this.motivoEsclusione = ''
    this.escludiAperto.set(true)
  }

  motivoValido(): boolean {
    const t = this.motivoEsclusione.trim()
    return t.length > 0 && t.length <= LUNGHEZZA_MAX_MOTIVO
  }

  escludi(): void {
    if (!this.motivoValido()) return
    this.eseguiMassa(this.corpo('ESCLUDI', this.motivoEsclusione.trim()))
  }

  private eseguiMassa(corpo: CorpoAzioneMassa): void {
    if (this.oltreTetto() || this.selezionate() === 0) return
    const mappa = new Map(this.sel())
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.azioni(corpo).subscribe({
      next: e => {
        this.inCorso.set(false)
        this.esito.set({ azione: corpo.azione, ...e })
        this.escludiAperto.set(false)
        // Restano selezionate solo le righe saltate, per poterle rivedere.
        const saltate = new Map<string, RigaLista>()
        for (const f of e.falliti) {
          const r = [...mappa.values()].find(
            x => (f.legameId && x.legameId === f.legameId) || x.movimentoId === f.movimentoId
          )
          if (r) saltate.set(r.movimentoId, r)
        }
        this.sel.set(saltate)
        this.carica()
        this.servizio.aggiornaContatori()
      },
      error: err => {
        this.inCorso.set(false)
        // OPERAZIONE_CONCORRENTE: il messaggio dice di riprovare, la selezione resta.
        this.errore.set(leggiErroriAzione(err, 'Operazione non riuscita.').messaggi.join(' '))
      },
    })
  }

  /** Riga saltata → «12/03/2026 · 08.01.01» (nessun id da mostrare). */
  descrizioneFallito(f: EsitoAzioneMassa['falliti'][number]): string {
    const r = this.righe().find(
      x =>
        (f.legameId && x.legameId === f.legameId) ||
        (f.movimentoId && x.movimentoId === f.movimentoId)
    )
    return r ? `${formattaGiorno(r.dataMovimento)} · CER ${r.cerCode}` : 'Movimento'
  }

  // ---- singolo legame ----

  /** Aprendo un MANCANTE `daMovimento` crea il legame: alla chiusura la lista si rilegge. */
  private ricaricaAllaChiusura = false

  /**
   * MANCANTE e DA_RIALLINEARE si aprono dopo `daMovimento` (crea o riallinea il legame), poi
   * `dettaglio` per avere anche i candidati dei menu. Chi non scrive non chiama mai
   * `daMovimento` (è una scrittura, il VIEWER avrebbe 403): un DA_RIALLINEARE si legge con
   * `dettaglio`, un MANCANTE non ha ancora un legame da mostrare.
   */
  apriLegame(r: RigaLista): void {
    const scrive = this.permessi().scrive
    const daCreare = r.stato === 'MANCANTE' || r.stato === 'DA_RIALLINEARE' || r.legameId === null
    if (!scrive && r.legameId === null) return
    this.inCorso.set(true)
    const lettura =
      scrive && daCreare
        ? this.servizio.daMovimento(r.movimentoId).pipe(
            // Il legame ora esiste: anche se `dettaglio` fallisce la lista va riletta.
            tap(() => (this.ricaricaAllaChiusura = true)),
            switchMap(l => this.servizio.dettaglio(l.id))
          )
        : this.servizio.dettaglio(r.legameId!)
    lettura.subscribe({
      next: l => {
        this.inCorso.set(false)
        if (scrive && daCreare) this.ricaricaAllaChiusura = true
        this.aperto.set(l)
      },
      error: err => {
        this.inCorso.set(false)
        // `chiudiLegame` rilegge la lista (e azzera l'errore): il messaggio va scritto dopo.
        if (this.ricaricaAllaChiusura) this.chiudiLegame()
        this.errore.set(leggiErroriAzione(err, 'Impossibile aprire il legame.').messaggi.join(' '))
      },
    })
  }

  chiudiLegame(): void {
    this.aperto.set(null)
    if (this.ricaricaAllaChiusura) {
      this.ricaricaAllaChiusura = false
      this.carica()
      this.servizio.aggiornaContatori()
    }
  }

  dopoAggiornamento(e: { legame: LegameVista; confermato: boolean }): void {
    this.aperto.set(null)
    this.ricaricaAllaChiusura = false
    this.toast.success(e.confermato ? 'Legame confermato.' : 'Legame salvato.')
    this.carica()
    this.servizio.aggiornaContatori()
  }

  riammetti(r: RigaLista): void {
    if (r.legameId === null || r.versione === null) return
    this.inCorso.set(true)
    this.servizio.riammetti(r.legameId, r.versione).subscribe({
      next: () => {
        this.inCorso.set(false)
        this.toast.success('Movimento riammesso nella lista.')
        this.carica()
        this.servizio.aggiornaContatori()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(
          leggiErroriAzione(err, 'Impossibile riammettere il movimento.').messaggi.join(' ')
        )
      },
    })
  }
}
