import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ActivatedRoute } from '@angular/router'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Subscription, forkJoin, of } from 'rxjs'
import { catchError } from 'rxjs/operators'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { MessageModule } from 'primeng/message'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { formattaQuantita } from '../../shared/format/formatta-quantita'
import { ToastService } from '../../core/services/toast.service'
import { RegistroService, RegistroVista } from '../registro/registro.service'
import { etichettaRegistro, registroPredefinito } from '../registro/registro-sede'
import {
  AbbinamentiService,
  AmbitoVista,
  CaricoVista,
  DifferenzaVista,
  EsitoSalvataggio,
  ScaricoVista,
  StatoCarico,
  StatoScarico,
  VistaAbbinamenti,
} from './abbinamenti.service'
import { formattaGiorno } from './giorno'
import {
  AbbinamentoScaricoDialogComponent,
  messaggioErrore,
} from './abbinamento-scarico-dialog.component'

export const MSG_NESSUN_AMBITO =
  'Nessun rifiuto in stoccaggio R13/D15 in questo registro. Compaiono qui i carichi con operazione R13 o D15.'
export const MSG_NESSUN_REGISTRO = 'Nessun registro disponibile per questa azienda.'
export const MSG_DIFFERENZE_NON_DISPONIBILI = 'Differenze non disponibili, riprova'
export const MSG_CONFERMA_RICALCOLO =
  'Le righe automatiche di questo registro vengono ricalcolate con FIFO; quelle inserite a mano restano.'

const ETICHETTE_STATO: Record<StatoScarico | StatoCarico, string> = {
  ABBINATO: 'Abbinato',
  PARZIALE: 'Parziale',
  NON_ABBINATO: 'Non abbinato',
  INCOERENTE: 'Incoerente',
  APERTO: 'Aperto',
  ESAURITO: 'Esaurito',
}

type Gravita = 'success' | 'warning' | 'secondary' | 'danger' | 'info'
const GRAVITA: Record<StatoScarico | StatoCarico, Gravita> = {
  ABBINATO: 'success',
  PARZIALE: 'warning',
  NON_ABBINATO: 'secondary',
  INCOERENTE: 'danger',
  APERTO: 'info',
  ESAURITO: 'success',
}

/** Chiave dell'ambito (CER + famiglia): serve a trackBy e agli id, senza spazi. */
export const chiaveAmbito = (a: { cerCode: string; famiglia: string }): string =>
  `${a.cerCode.replace(/\s+/g, '')}-${a.famiglia}`

/**
 * Pagina Abbinamenti R13/D15: per ogni rifiuto in stoccaggio, carichi e scarichi con lo stato
 * dell'abbinamento. Il calcolo (FIFO, residui, stati, permessi) è tutto del backend: qui si
 * mostra e si inviano le scelte dell'operatore.
 */
@Component({
  selector: 'app-abbinamenti',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DropdownModule,
    MessageModule,
    ProgressSpinnerModule,
    TableModule,
    TagModule,
    AbbinamentoScaricoDialogComponent,
  ],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Abbinamenti carichi-scarichi R13/D15</h1>
          <p class="page-subtitle">
            Per ogni scarico, da quali carichi in stoccaggio proviene. Il FIFO propone, tu puoi
            correggere a mano.
          </p>
        </div>
        <div class="page-actions">
          <p-button
            *ngIf="vista()?.puoModificare"
            label="Abbina con FIFO i non abbinati"
            icon="pi pi-link"
            [outlined]="true"
            [loading]="inElaborazione()"
            (onClick)="abbinaNonAbbinati()"
            data-testid="abbina-non-abbinati"
          ></p-button>
          <p-button
            *ngIf="vista()?.puoRicalcolare"
            label="Ricalcola gli automatici"
            icon="pi pi-sync"
            [outlined]="true"
            [disabled]="inElaborazione()"
            (onClick)="chiediRicalcolo()"
            data-testid="ricalcola-automatici"
          ></p-button>
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            [loading]="loading()"
            (onClick)="reload()"
            ariaLabel="Aggiorna gli abbinamenti"
            data-testid="aggiorna"
          ></p-button>
        </div>
      </header>

      <section *ngIf="piuRegistri()" class="surface-card mb-4" aria-label="Sede">
        <label class="ab-label" for="abbinamenti-sede">Sede</label>
        <p-dropdown
          inputId="abbinamenti-sede"
          data-testid="abbinamenti-sede"
          [options]="opzioniRegistro()"
          [ngModel]="registroSel()"
          (onChange)="cambiaRegistro($event.value)"
          optionLabel="label"
          optionValue="value"
          placeholder="Scegli la sede"
          styleClass="w-full"
          ariaLabel="Sede"
        ></p-dropdown>
      </section>

      <section
        *ngIf="confermaRicalcolo()"
        class="surface-card mb-4"
        role="alertdialog"
        aria-labelledby="ab-conferma-testo"
        data-testid="conferma-ricalcolo"
        (keydown.escape)="annullaRicalcolo()"
      >
        <p id="ab-conferma-testo" class="m-0 mb-3">{{ msgConfermaRicalcolo }}</p>
        <p-button
          label="Sì, ricalcola"
          severity="danger"
          size="small"
          [loading]="inElaborazione()"
          (onClick)="ricalcolaAutomatici()"
          data-testid="ricalcola-conferma"
          ariaLabel="Conferma il ricalcolo degli abbinamenti automatici"
        ></p-button>
        <p-button
          label="No"
          [text]="true"
          size="small"
          (onClick)="annullaRicalcolo()"
          data-testid="ricalcola-annulla"
          ariaLabel="Annulla il ricalcolo"
        ></p-button>
      </section>

      <div class="mb-4" aria-live="polite" data-testid="avvisi">
        <p-message
          *ngFor="let a of avvisi()"
          severity="warn"
          [text]="a"
          styleClass="w-full mb-2"
          data-testid="avviso"
        ></p-message>
      </div>

      <section *ngIf="error()" class="surface-card mb-4" role="alert">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title" data-testid="errore">{{ error() }}</span>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="reload()"
          ></p-button>
        </div>
      </section>

      <section *ngIf="loading()" class="surface-card">
        <div class="flex justify-content-center p-5">
          <p-progressSpinner
            strokeWidth="4"
            [style]="{ width: '48px', height: '48px' }"
            ariaLabel="Caricamento degli abbinamenti"
          ></p-progressSpinner>
        </div>
      </section>

      <p *ngIf="nessunRegistro()" class="ab-vuoto" data-testid="nessun-registro">
        {{ msgNessunRegistro }}
      </p>

      <p
        *ngIf="!registroSel() && piuRegistri() && !loading()"
        class="ab-vuoto"
        data-testid="scegli-sede"
      >
        Scegli la sede di cui vedere gli abbinamenti.
      </p>

      <ng-container *ngIf="vista() && !loading() && !error()">
        <p
          *ngIf="vista()!.ambiti.length === 0"
          class="surface-card ab-vuoto"
          data-testid="nessun-ambito"
        >
          {{ msgNessunAmbito }}
        </p>

        <div *ngIf="vista()!.ambiti.length > 0" class="surface-card mb-4 ab-filtro">
          <input
            type="checkbox"
            id="ab-solo-da-completare"
            data-testid="solo-da-completare"
            aria-describedby="ab-filtro-aiuto"
            [checked]="soloDaCompletare()"
            (change)="soloDaCompletare.set($any($event.target).checked)"
          />
          <label for="ab-solo-da-completare">Solo da completare</label>
          <small id="ab-filtro-aiuto" class="ab-nota"
            >Nasconde scarichi abbinati e carichi esauriti.</small
          >
        </div>

        <section
          *ngFor="let a of vista()!.ambiti; trackBy: trackAmbito"
          class="surface-card mb-4"
          [attr.aria-labelledby]="'ab-titolo-' + chiaveAmbito(a)"
          [attr.data-testid]="'ambito-' + a.cerCode"
        >
          <h2 class="ab-titolo" [id]="'ab-titolo-' + chiaveAmbito(a)">{{ titoloAmbito(a) }}</h2>
          <p *ngIf="a.differenzeFifo > 0" class="ab-nota" data-testid="differenze-ambito">
            {{ a.differenzeFifo }}
            {{ a.differenzeFifo === 1 ? 'scarico diverso' : 'scarichi diversi' }} dal FIFO da capo
          </p>
          <p-message
            *ngFor="let i of a.incoerenze"
            severity="error"
            [text]="'Incoerenza: ' + i"
            styleClass="w-full mb-2"
            data-testid="incoerenza"
          ></p-message>

          <h3 class="ab-sottotitolo">Carichi in stoccaggio ({{ a.unita }})</h3>
          <p-table
            [value]="carichiVisibili(a)"
            [tableStyle]="{ 'min-width': '40rem' }"
            [attr.data-testid]="'tabella-carichi-' + a.cerCode"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">N.</th>
                <th scope="col">Data</th>
                <th scope="col">Classe</th>
                <th scope="col" class="text-right">Quantità</th>
                <th scope="col" class="text-right">Abbinato</th>
                <th scope="col" class="text-right">Residuo</th>
                <th scope="col" class="text-right">Età (giorni)</th>
                <th scope="col">Stato</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr [attr.data-testid]="'carico-' + (c.numero ?? 'giacenza-' + c.giorno)">
                <td>{{ c.numero ?? 'Giacenza iniziale' }}</td>
                <td>{{ formattaGiorno(c.giorno) }}</td>
                <td>{{ c.classe ?? '-' }}</td>
                <td class="text-right">{{ formattaQuantita(c.quantita) }}</td>
                <td class="text-right">{{ formattaQuantita(c.abbinato) }}</td>
                <td class="text-right">{{ formattaQuantita(c.residuo) }}</td>
                <td class="text-right">{{ c.etaGiorni ?? '-' }}</td>
                <td>
                  <p-tag [value]="etichettaStato(c.stato)" [severity]="gravita(c.stato)"></p-tag>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="8">Nessun carico da mostrare.</td>
              </tr>
            </ng-template>
          </p-table>

          <h3 class="ab-sottotitolo">Scarichi ({{ a.unita }})</h3>
          <p-table
            [value]="scarichiVisibili(a)"
            [tableStyle]="{ 'min-width': '44rem' }"
            [attr.data-testid]="'tabella-scarichi-' + a.cerCode"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">N.</th>
                <th scope="col">Data</th>
                <th scope="col">Classe attesa</th>
                <th scope="col" class="text-right">Quantità</th>
                <th scope="col" class="text-right">Abbinato</th>
                <th scope="col">Stato</th>
                <th scope="col">Carichi usati</th>
                <th scope="col"><span class="sr-only">Azioni</span></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-s>
              <tr [attr.data-testid]="'scarico-' + s.numero">
                <td>{{ s.numero }}</td>
                <td>{{ formattaGiorno(s.giorno) }}</td>
                <td>{{ s.classeAttesa ?? '-' }}</td>
                <td class="text-right">{{ formattaQuantita(s.quantita) }}</td>
                <td class="text-right">{{ formattaQuantita(s.abbinato) }}</td>
                <td>
                  <p-tag
                    [value]="etichettaStato(s.stato)"
                    [severity]="gravita(s.stato)"
                    [attr.data-testid]="'stato-' + s.numero"
                  ></p-tag>
                </td>
                <td>
                  <span *ngIf="s.righe.length === 0">-</span>
                  <span *ngFor="let r of s.righe; let ultimo = last"
                    >{{ r.carico.numero ?? 'giacenza iniziale' }}:
                    {{ formattaQuantita(r.quantita) }}
                    <small>({{ r.origine === 'MANUALE' ? 'a mano' : 'automatico' }})</small
                    >{{ ultimo ? '' : '; ' }}</span
                  >
                </td>
                <td>
                  <p-button
                    *ngIf="vista()!.puoModificare"
                    label="Modifica"
                    size="small"
                    [text]="true"
                    (onClick)="apriModifica(s, a.unita)"
                    [attr.data-testid]="'modifica-' + s.numero"
                    [ariaLabel]="'Modifica gli abbinamenti dello scarico n. ' + s.numero"
                  ></p-button>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="8">Nessuno scarico da mostrare.</td>
              </tr>
            </ng-template>
          </p-table>
        </section>

        <section *ngIf="vista()!.ambiti.length > 0" class="surface-card mb-4">
          <h2 class="ab-titolo">
            <button
              type="button"
              class="ab-toggle"
              [attr.aria-expanded]="differenzeAperte()"
              aria-controls="ab-differenze"
              (click)="differenzeAperte.set(!differenzeAperte())"
              data-testid="differenze-toggle"
            >
              Differenze dal FIFO ({{
                differenzeNonDisponibili() ? 'non disponibili' : differenze().length
              }})
            </button>
          </h2>
          <div id="ab-differenze" *ngIf="differenzeAperte()" data-testid="differenze">
            <p
              *ngIf="differenzeNonDisponibili()"
              class="field-error"
              role="alert"
              data-testid="differenze-non-disponibili"
            >
              {{ msgDifferenzeNonDisponibili }}
            </p>
            <ng-container *ngIf="!differenzeNonDisponibili()">
              <p class="ab-nota">
                Righe salvate a confronto con il FIFO ricalcolato da capo: {{ scarichiDiversi() }}
                {{ scarichiDiversi() === 1 ? 'scarico diverso' : 'scarichi diversi' }} dal FIFO da
                capo.
              </p>
              <p-table [value]="differenze()" styleClass="p-datatable-sm">
                <ng-template pTemplate="header">
                  <tr>
                    <th scope="col">Scarico</th>
                    <th scope="col">Carico</th>
                    <th scope="col" class="text-right">Salvato</th>
                    <th scope="col" class="text-right">FIFO</th>
                  </tr>
                </ng-template>
                <ng-template pTemplate="body" let-d>
                  <tr>
                    <td>{{ d.scarico.numero }}</td>
                    <td>
                      {{
                        d.carico.numero ??
                          'Giacenza iniziale del ' + formattaGiorno(d.carico.giorno)
                      }}
                    </td>
                    <td class="text-right">{{ formattaQuantita(d.persistita) }}</td>
                    <td class="text-right">{{ formattaQuantita(d.fifo) }}</td>
                  </tr>
                </ng-template>
                <ng-template pTemplate="emptymessage">
                  <tr>
                    <td colspan="4">Nessuna differenza: gli abbinamenti coincidono con il FIFO.</td>
                  </tr>
                </ng-template>
              </p-table>
            </ng-container>
          </div>
        </section>
      </ng-container>

      <app-abbinamento-scarico-dialog
        [visible]="dialogAperto()"
        [scarico]="scaricoInModifica()"
        [unita]="unitaInModifica()"
        (visibleChange)="cambiaDialog($event)"
        (salvato)="dopoSalvataggio($event)"
      ></app-abbinamento-scarico-dialog>
    </div>
  `,
  styles: [
    `
      .ab-label {
        display: block;
        margin-bottom: var(--spacing-sm);
      }
      .ab-titolo {
        font-size: var(--font-size-lg);
        margin: 0 0 var(--spacing-sm);
      }
      .ab-sottotitolo {
        font-size: var(--font-size-base);
        margin: var(--spacing-md) 0 var(--spacing-sm);
      }
      .ab-nota,
      .ab-vuoto {
        color: var(--text-tertiary);
      }
      .ab-vuoto {
        padding: var(--spacing-md);
      }
      .ab-filtro {
        display: flex;
        gap: var(--spacing-sm);
        align-items: center;
      }
      .ab-toggle {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
        color: inherit;
      }
      .ab-riga {
        margin-bottom: var(--spacing-sm);
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
      }
    `,
  ],
})
export class AbbinamentiComponent implements OnInit, OnDestroy {
  private readonly servizio = inject(AbbinamentiService)
  private readonly registroService = inject(RegistroService)
  private readonly toast = inject(ToastService)

  readonly registri = signal<RegistroVista[]>([])
  readonly registroSel = signal<string | null>(null)
  readonly vista = signal<VistaAbbinamenti | null>(null)
  readonly differenze = signal<DifferenzaVista[]>([])
  readonly loading = signal(false)
  readonly error = signal<string | null>(null)
  readonly inElaborazione = signal(false)
  readonly soloDaCompletare = signal(false)
  readonly differenzeAperte = signal(false)
  readonly confermaRicalcolo = signal(false)
  /** Avvisi dell'ultima operazione (ricalcolo o salvataggio), mostrati finché non si cambia. */
  readonly avvisi = signal<string[]>([])
  /** Scarico di cui il dialog sta modificando gli abbinamenti. */
  readonly scaricoInModifica = signal<ScaricoVista | null>(null)
  readonly unitaInModifica = signal('')
  readonly dialogAperto = signal(false)
  private numeroDaRifocalizzare: string | null = null
  private caricamento?: Subscription
  private readonly destroyRef = inject(DestroyRef)
  private readonly route = inject(ActivatedRoute, { optional: true })
  readonly nessunRegistro = signal(false)
  readonly differenzeNonDisponibili = signal(false)

  readonly piuRegistri = computed(() => this.registri().length > 1)
  readonly opzioniRegistro = computed(() =>
    this.registri().map(r => ({ label: etichettaRegistro(r), value: r.id }))
  )
  readonly scarichiDiversi = computed(() => new Set(this.differenze().map(d => d.scarico.id)).size)

  readonly msgNessunRegistro = MSG_NESSUN_REGISTRO
  readonly msgDifferenzeNonDisponibili = MSG_DIFFERENZE_NON_DISPONIBILI
  readonly msgConfermaRicalcolo = MSG_CONFERMA_RICALCOLO
  readonly msgNessunAmbito = MSG_NESSUN_AMBITO
  readonly formattaQuantita = formattaQuantita
  readonly formattaGiorno = formattaGiorno

  ngOnInit(): void {
    this.loading.set(true)
    this.registroService
      .listRegistri()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: registri => {
          this.registri.set(registri ?? [])
          this.nessunRegistro.set((registri ?? []).length === 0)
          const richiesto = this.route?.snapshot?.queryParamMap?.get('registroId')
          const scelto =
            richiesto && registri.some(r => r.id === richiesto)
              ? richiesto
              : registri.length === 1
                ? registri[0].id
                : (registroPredefinito(registri) ?? null)
          this.registroSel.set(scelto)
          if (scelto) this.reload()
          else this.loading.set(false)
        },
        error: () => {
          this.loading.set(false)
          this.error.set('Impossibile caricare i registri.')
          this.toast.error('Errore nel caricamento dei registri')
        },
      })
  }

  ngOnDestroy(): void {
    this.caricamento?.unsubscribe()
  }

  cambiaRegistro(valore: string | null): void {
    this.registroSel.set(valore || null)
    this.vista.set(null)
    this.differenze.set([])
    this.avvisi.set([])
    this.chiudiModifica(false)
    if (valore) this.reload()
  }

  reload(): void {
    const registroId = this.registroSel()
    if (!registroId) return
    this.caricamento?.unsubscribe()
    // l'editor aperto lavora su dati vecchi: si chiude, la vista si rilegge
    this.chiudiModifica(false)
    this.loading.set(true)
    this.error.set(null)
    this.caricamento = forkJoin({
      vista: this.servizio.vista(registroId),
      // Le differenze sono accessorie: se mancano la pagina funziona lo stesso.
      differenze: this.servizio
        .differenze(registroId)
        .pipe(catchError(() => of<DifferenzaVista[] | null>(null))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ vista, differenze }) => {
          this.vista.set(vista)
          this.differenze.set(differenze ?? [])
          this.differenzeNonDisponibili.set(differenze === null)
          this.loading.set(false)
          this.ripristinaFocus()
        },
        error: e => {
          this.error.set(messaggioErrore(e, 'Impossibile caricare gli abbinamenti.'))
          this.loading.set(false)
        },
      })
  }

  readonly chiaveAmbito = chiaveAmbito
  trackAmbito = (_: number, a: AmbitoVista): string => chiaveAmbito(a)

  titoloAmbito(a: AmbitoVista): string {
    return `CER ${a.cerCode} · ${a.classi.join(' / ')}`
  }

  carichiVisibili(a: AmbitoVista): CaricoVista[] {
    return this.soloDaCompletare() ? a.carichi.filter(c => c.stato !== 'ESAURITO') : a.carichi
  }

  scarichiVisibili(a: AmbitoVista): ScaricoVista[] {
    return this.soloDaCompletare() ? a.scarichi.filter(s => s.stato !== 'ABBINATO') : a.scarichi
  }

  etichettaStato(stato: StatoScarico | StatoCarico): string {
    return ETICHETTE_STATO[stato]
  }

  gravita(stato: StatoScarico | StatoCarico): Gravita {
    return GRAVITA[stato]
  }

  // --- ricalcolo ---

  abbinaNonAbbinati(): void {
    this.ricalcola('NON_ABBINATI')
  }

  chiediRicalcolo(): void {
    this.confermaRicalcolo.set(true)
    setTimeout(() => {
      document.querySelector<HTMLElement>('[data-testid="ricalcola-conferma"] button')?.focus()
    })
  }

  annullaRicalcolo(): void {
    this.confermaRicalcolo.set(false)
    setTimeout(() =>
      document.querySelector<HTMLElement>('[data-testid="ricalcola-automatici"] button')?.focus()
    )
  }

  ricalcolaAutomatici(): void {
    this.confermaRicalcolo.set(false)
    this.ricalcola('AUTOMATICI')
  }

  private ricalcola(modalita: 'NON_ABBINATI' | 'AUTOMATICI'): void {
    const registroId = this.registroSel()
    if (!registroId) return
    this.inElaborazione.set(true)
    this.servizio
      .ricalcola({ registroId, modalita })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: esito => {
          this.inElaborazione.set(false)
          this.avvisi.set(esito.avvisi)
          this.toast.success(
            esito.righeScritte === 0 && esito.righeCancellate === 0
              ? 'Nessun abbinamento da aggiornare.'
              : 'Abbinamenti aggiornati.'
          )
          this.reload()
        },
        error: e => {
          this.inElaborazione.set(false)
          this.toast.error(messaggioErrore(e, 'Impossibile ricalcolare gli abbinamenti.'))
        },
      })
  }

  // --- modifica a mano (dialog) ---

  apriModifica(s: ScaricoVista, unita = ''): void {
    this.scaricoInModifica.set(s)
    this.unitaInModifica.set(unita || this.unitaDi(s.id))
    this.dialogAperto.set(true)
  }

  private unitaDi(scaricoId: string): string {
    return this.vista()?.ambiti.find(a => a.scarichi.some(s => s.id === scaricoId))?.unita ?? ''
  }

  cambiaDialog(aperto: boolean): void {
    if (aperto) this.dialogAperto.set(true)
    else this.chiudiModifica()
  }

  dopoSalvataggio(esito: EsitoSalvataggio): void {
    this.avvisi.set(esito.avvisi)
    // le tabelle vengono ricreate dal reload: il focus si rimette a vista caricata
    this.numeroDaRifocalizzare = this.scaricoInModifica()?.numero ?? null
    this.reload()
  }

  /** Focus sul pulsante Modifica dello scarico appena salvato; se la riga non c'è più, su Aggiorna. */
  private ripristinaFocus(): void {
    const numero = this.numeroDaRifocalizzare
    if (numero === null) return
    this.numeroDaRifocalizzare = null
    setTimeout(() =>
      (
        document.querySelector<HTMLElement>(`[data-testid="modifica-${numero}"] button`) ??
        document.querySelector<HTMLElement>('[data-testid="aggiorna"] button')
      )?.focus()
    )
  }

  chiudiModifica(rendiFocus = true): void {
    const s = this.scaricoInModifica()
    this.dialogAperto.set(false)
    // con un reload in corso il focus lo rimette ripristinaFocus a vista caricata
    if (s && rendiFocus && !this.loading()) {
      setTimeout(() =>
        document.querySelector<HTMLElement>(`[data-testid="modifica-${s.numero}"] button`)?.focus()
      )
    }
  }
}
