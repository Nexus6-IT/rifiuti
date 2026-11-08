import { CommonModule } from '@angular/common'
import { Component, DestroyRef, computed, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { ActivatedRoute, RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { Observable, Subject, catchError, forkJoin, map, of, switchMap } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ToastService } from '../../../core/services/toast.service'
import { codiceErrore, leggiErroriAzione } from '../../listino/errori-azione'
import { messaggiErroreFatturazione } from '../errori-fatturazione'
import {
  AdattatoreVista,
  CHIAVE_SELEZIONE_MAPPATURE,
  ChiaveMancante,
  MAX_VALORE_MAPPATURA,
  MAX_VOCI_MAPPATURE,
  MappaturaVista,
  rimuoviSelezioneMappature,
  SelezioneExport,
  TIPI_MAPPATURA,
  TipoMappatura,
  VoceMappatura,
} from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { permessiFatturazione } from '../permessi-fatturazione'
import { ERRORI_HTTP_VOCI } from '../vocabolario-fatturazione'

/** Titoli delle sezioni, nell'ordine in cui compaiono. */
export const TITOLI_TIPI_MAPPATURA: Readonly<Record<TipoMappatura, string>> = {
  CODICE_IVA: 'Codici IVA',
  CONTO_RICAVI: 'Conti ricavi',
  CLIENTE: 'Clienti',
  PAGAMENTO: 'Condizioni di pagamento',
  REGISTRO: 'Registri IVA',
}

/**
 * Formato che il tracciato TeamSystem richiede per ogni tipo di mappatura: solo cifre, al massimo
 * N (i codici piu' corti si riempiono di zeri a sinistra). Le larghezze sono quelle del tracciato
 * (`teamsystem.adattatore.ts`); un valore fuori formato fa rispondere l'export 400
 * `EXPORT_TEAMSYSTEM_NON_GENERABILE`, quindi lo si dice prima.
 */
export const FORMATO_MAPPATURA_TEAMSYSTEM: Readonly<
  Record<TipoMappatura, { cifre: number; suggerimento: string }>
> = {
  CODICE_IVA: { cifre: 3, suggerimento: 'Codice di al massimo 3 cifre, solo numeri (es. 022).' },
  CONTO_RICAVI: {
    cifre: 7,
    suggerimento:
      'Conto di al massimo 7 cifre, solo numeri. Si sceglie per centro di ricavo, poi categoria, poi tipo di riga.',
  },
  CLIENTE: { cifre: 5, suggerimento: 'Codice cliente di al massimo 5 cifre, solo numeri.' },
  PAGAMENTO: { cifre: 3, suggerimento: 'Codice di al massimo 3 cifre, solo numeri.' },
  REGISTRO: { cifre: 2, suggerimento: 'Codice registro di al massimo 2 cifre, solo numeri.' },
}

/** Conti di ricavo distinti ammessi in un documento dal tracciato TeamSystem (`MAX_CONTI_RICAVI`). */
export const MAX_CONTI_RICAVI_TEAMSYSTEM = 8

export const MESSAGGIO_TROPPE_MODIFICHE =
  'Salva le modifiche fatte prima di continuare (massimo 500 per volta)'
const RIGHE_PER_PAGINA = 50
const ETICHETTA_ASSENTE = '(non più presente)'
const MESSAGGIO_VERSIONE_SUPERATA = ERRORI_HTTP_VOCI.VERSIONE_SUPERATA.etichetta

/** Una riga della pagina: una voce salvata oppure una chiave mancante ancora da compilare. */
export interface RigaMappatura {
  tipo: TipoMappatura
  chiaveWasteflow: string
  /** Solo per le chiavi arrivate da un export respinto (`MAPPATURE_MANCANTI`). */
  etichetta: string | null
  /** Valore salvato sul server; `null` = voce mai salvata. */
  salvato: string | null
  /** Versione letta dal server; `null` = voce nuova. */
  versione: number | null
  /** Valore nel campo. */
  valore: string
}

interface Richiesta {
  adattatore: string | null
  messaggio: string | null
}

interface Caricamento {
  adattatori: AdattatoreVista[]
  mappature: MappaturaVista[]
  mancanti: ChiaveMancante[]
}

/** Chiavi mancanti passate dalla pagina dei documenti (`history.state`); ignora il resto. */
export function mancantiDaStato(stato: unknown): ChiaveMancante[] {
  const elenco = (stato as { mancanti?: unknown } | null)?.mancanti
  if (!Array.isArray(elenco)) return []
  return elenco.filter(
    (x): x is ChiaveMancante =>
      typeof x === 'object' &&
      x !== null &&
      (TIPI_MAPPATURA as readonly string[]).includes((x as ChiaveMancante).tipo) &&
      typeof (x as ChiaveMancante).chiaveWasteflow === 'string' &&
      (x as ChiaveMancante).chiaveWasteflow.length > 0 &&
      typeof (x as ChiaveMancante).etichetta === 'string'
  )
}

/** Selezione dell'export lasciata in `sessionStorage`; `null` se assente o illeggibile. */
export function selezioneDaSessione(): SelezioneExport | null {
  try {
    const testo = sessionStorage.getItem(CHIAVE_SELEZIONE_MAPPATURE)
    const valore: unknown = testo === null ? null : JSON.parse(testo)
    return typeof valore === 'object' && valore !== null && !Array.isArray(valore)
      ? (valore as SelezioneExport)
      : null
  } catch {
    return null
  }
}

const chiaveRiga = (r: { tipo: TipoMappatura; chiaveWasteflow: string }): string =>
  `${r.tipo}:${r.chiaveWasteflow}`

/**
 * Pagina «Export contabile»: le mappature fra le chiavi di WasteFlow (codici IVA, conti ricavi,
 * clienti, pagamenti, registri) e i codici del gestionale scelto. Solo ADMIN e SUPER_ADMIN, come
 * le rotte del backend. Le chiavi mancanti arrivano da un export respinto (`history.state`).
 */
@Component({
  selector: 'app-mappature',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, TableModule],
  template: `
    <div class="page pagina-lavoro">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Export contabile</h1>
          <p class="page-subtitle">
            <ng-container *ngIf="adattatore() as a; else sottotitolo"
              >Mappature per {{ a.nome }}: i codici di WasteFlow e i loro corrispondenti nel
              gestionale.</ng-container
            >
            <ng-template #sottotitolo>Le mappature per il gestionale contabile.</ng-template>
          </p>
        </div>
        <div class="page-actions">
          <p-button
            *ngIf="adattatore() && permessi().imposta"
            label="Salva"
            icon="pi pi-check"
            [disabled]="!puoSalvare()"
            [loading]="inCorso()"
            (onClick)="salva()"
            data-testid="mappature-salva"
          />
        </div>
      </header>

      <p *ngIf="troppeModifiche()" class="field-error" role="alert" data-testid="mappature-troppe">
        {{ messaggioTroppe }}
      </p>

      <p
        *ngIf="!permessi().imposta"
        class="surface-card nota-pagina"
        role="status"
        data-testid="mappature-non-autorizzato"
      >
        Solo gli amministratori possono gestire le mappature dell'export contabile.
      </p>

      <ng-container *ngIf="permessi().imposta">
        <div
          *ngIf="adattatore() && !adattatore()!.verificato"
          class="avviso-riquadro avviso-riquadro--warn"
          role="note"
          data-testid="mappature-non-verificato"
        >
          <strong>Tracciato non verificato su un'installazione reale.</strong>
          Prima di usare il file in produzione, fallo controllare dal tuo gestionale o dal
          commercialista.
        </div>

        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="mappature-errore">
          {{ e }}
          <p-button
            *ngIf="puoRiprovare()"
            label="Riprova"
            icon="pi pi-refresh"
            [text]="true"
            (onClick)="ricarica()"
            data-testid="mappature-riprova"
          />
        </p>

        <p
          *ngIf="caricamento()"
          class="surface-card"
          role="status"
          data-testid="mappature-caricamento"
        >
          Caricamento in corso...
        </p>

        <section *ngIf="vuoto()" class="surface-card empty-state" data-testid="mappature-vuoto">
          <p>Nessun gestionale contabile è ancora disponibile per questa azienda.</p>
        </section>

        <section
          *ngIf="!adattatore() && adattatori().length > 0 && !caricamento()"
          class="surface-card"
          data-testid="mappature-adattatori"
        >
          <h2 class="titolo-sezione">Gestionali disponibili</h2>
          <ul class="elenco-adattatori">
            <li *ngFor="let a of adattatori(); trackBy: perCodice">
              <a
                [routerLink]="['/fatturazione/export-contabile', a.codice]"
                [attr.data-testid]="'mappature-adattatore-' + a.codice"
                >{{ a.nome }}</a
              >
            </li>
          </ul>
        </section>

        <ng-container *ngIf="adattatore() && !caricamento()">
          <section
            *ngIf="mancanti().length > 0"
            class="surface-card mancanti"
            aria-labelledby="mappature-mancanti-titolo"
            data-testid="mappature-mancanti"
          >
            <h2 class="titolo-sezione" id="mappature-mancanti-titolo">Mappature mancanti</h2>
            <p>Per esportare servono ancora questi corrispondenti:</p>
            <ul>
              <li *ngFor="let r of mancanti(); trackBy: perRiga">
                {{ titolo(r.tipo) }}: {{ r.etichetta || assente }}
              </li>
            </ul>
          </section>

          <p
            *ngIf="righe().length === 0"
            class="surface-card nota-pagina"
            data-testid="mappature-nessuna"
          >
            Nessuna mappatura: compariranno quando un export ne richiederà.
          </p>

          <section
            *ngFor="let s of sezioni(); trackBy: perSezione"
            class="surface-card"
            [attr.data-testid]="'mappature-sezione-' + s.tipo"
          >
            <h2 class="titolo-sezione">{{ titoli[s.tipo] }}</h2>
            <p
              *ngIf="formato(s.tipo) as f"
              class="nota-pagina"
              [attr.id]="'mappature-formato-' + s.tipo"
              [attr.data-testid]="'mappature-formato-' + s.tipo"
            >
              {{ f.suggerimento }}
            </p>
            <p
              *ngIf="s.tipo === 'CONTO_RICAVI' && formato(s.tipo)"
              class="nota-pagina"
              id="mappature-limite-conti"
              data-testid="mappature-limite-conti"
            >
              Un documento può avere al massimo {{ maxContiRicavi }} conti di ricavo diversi: se i
              suoi centri di ricavo finiscono su più conti, l'export viene respinto. In quel caso
              assegna lo stesso conto a più centri.
            </p>
            <p-table
              [value]="s.righe"
              [paginator]="s.righe.length > righePerPagina"
              [rows]="righePerPagina"
              [rowTrackBy]="perRiga"
              styleClass="mappature"
            >
              <ng-template pTemplate="caption">
                <span class="sr-only"
                  >{{ titoli[s.tipo] }}: voce di WasteFlow e valore nel gestionale</span
                >
              </ng-template>
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">Voce di WasteFlow</th>
                  <th scope="col">Valore nel gestionale</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-r>
                <tr [attr.data-testid]="'mappature-riga-' + r.tipo + '-' + r.chiaveWasteflow">
                  <th scope="row">{{ r.etichetta || assente }}</th>
                  <td>
                    <input
                      type="text"
                      class="p-inputtext p-component"
                      [attr.aria-label]="
                        'Valore nel gestionale per ' +
                        titolo(r.tipo) +
                        ' ' +
                        (r.etichetta || assente)
                      "
                      [maxLength]="formato(r.tipo)?.cifre ?? maxValore"
                      [attr.inputmode]="formato(r.tipo) ? 'numeric' : null"
                      [attr.aria-describedby]="descrizioneCampo(r.tipo)"
                      [class.campo-mancante]="eMancante(r)"
                      [attr.aria-invalid]="eMancante(r) ? 'true' : null"
                      [ngModel]="r.valore"
                      [disabled]="inCorso()"
                      (ngModelChange)="modifica(r, $event)"
                      autocomplete="off"
                      [attr.data-testid]="'mappature-valore-' + r.tipo + '-' + r.chiaveWasteflow"
                    />
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </section>
        </ng-container>
      </ng-container>
    </div>
  `,
  styles: [
    `
      .titolo-sezione {
        font-size: 1.05rem;
        margin: 0 0 var(--spacing-sm, 0.5rem);
      }
      .surface-card + .surface-card {
        margin-top: var(--spacing-base);
      }
      :host ::ng-deep .mappature table {
        table-layout: fixed;
        width: 100%;
      }
      :host ::ng-deep .mappature th:first-child {
        width: 55%;
      }
      .mancanti ul {
        margin: 0;
        padding-left: 1.25rem;
      }
      :host ::ng-deep .mappature th,
      :host ::ng-deep .mappature td {
        text-align: left;
      }
      :host ::ng-deep .mappature input {
        width: 100%;
        max-width: 16rem;
      }
      :host ::ng-deep .mappature input.campo-mancante {
        border-color: var(--color-danger);
      }
      .elenco-adattatori {
        margin: 0;
        padding-left: 1.25rem;
      }
    `,
  ],
})
export class MappatureComponent {
  private readonly servizio = inject(FatturazioneService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly route = inject(ActivatedRoute)
  private readonly distruzione = inject(DestroyRef)

  readonly titoli = TITOLI_TIPI_MAPPATURA
  readonly maxValore = MAX_VALORE_MAPPATURA
  readonly maxContiRicavi = MAX_CONTI_RICAVI_TEAMSYSTEM
  readonly righePerPagina = RIGHE_PER_PAGINA
  readonly assente = ETICHETTA_ASSENTE
  readonly messaggioTroppe = MESSAGGIO_TROPPE_MODIFICHE

  readonly permessi = computed(() => permessiFatturazione(this.auth.currentUser()?.role))

  readonly adattatori = signal<AdattatoreVista[]>([])
  readonly adattatore = signal<AdattatoreVista | null>(null)
  readonly righe = signal<RigaMappatura[]>([])
  readonly caricamento = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  /** Dopo un errore di caricamento si offre «Riprova». */
  readonly puoRiprovare = signal(false)
  /** Nessun adattatore registrato (dopo il caricamento). */
  readonly vuoto = signal(false)

  /** Chiavi richieste da un export respinto: restano finché non hanno un valore. */
  private mancantiRicevute: ChiaveMancante[] = mancantiDaStato(history.state)
  private codiceCorrente: string | null = null
  private readonly richieste$ = new Subject<Richiesta>()

  readonly mancanti = computed(() => this.righe().filter(r => this.eMancante(r)))

  readonly sezioni = computed(() =>
    TIPI_MAPPATURA.map(tipo => ({ tipo, righe: this.righe().filter(r => r.tipo === tipo) })).filter(
      s => s.righe.length > 0
    )
  )

  private readonly voci = computed<VoceMappatura[]>(() => {
    const voci: VoceMappatura[] = []
    for (const r of this.righe()) {
      const nuovo = r.valore.trim()
      if (nuovo === (r.salvato ?? '')) continue
      voci.push({
        tipo: r.tipo,
        chiaveWasteflow: r.chiaveWasteflow,
        valore: nuovo === '' ? null : nuovo,
        versione: r.versione,
      })
    }
    return voci
  })

  /** Oltre il tetto del backend «Salva» si disattiva: niente invii a blocchi. */
  readonly troppeModifiche = computed(() => this.voci().length > MAX_VOCI_MAPPATURE)
  readonly puoSalvare = computed(
    () => this.voci().length > 0 && !this.troppeModifiche() && !this.inCorso()
  )

  constructor() {
    this.richieste$
      .pipe(
        switchMap(r => this.carica$(r)),
        takeUntilDestroyed()
      )
      .subscribe()
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(p => {
      this.codiceCorrente = p.get('adattatore')
      this.richieste$.next({ adattatore: this.codiceCorrente, messaggio: null })
    })
  }

  /** Formato richiesto per il gestionale in uso (oggi solo TeamSystem), o `null` se non noto. */
  formato = (tipo: TipoMappatura): { cifre: number; suggerimento: string } | null =>
    this.adattatore()?.codice.toUpperCase() === 'TEAMSYSTEM'
      ? FORMATO_MAPPATURA_TEAMSYSTEM[tipo]
      : null

  /** Chiave richiesta da un export respinto e ancora senza valore. */
  eMancante = (r: RigaMappatura): boolean =>
    r.etichetta !== null && r.valore.trim() === '' && r.salvato === null

  /** Id dei suggerimenti che descrivono il campo (formato e, per i conti, il limite di 8). */
  descrizioneCampo = (tipo: TipoMappatura): string | null => {
    if (!this.formato(tipo)) return null
    const id = 'mappature-formato-' + tipo
    return tipo === 'CONTO_RICAVI' ? `${id} mappature-limite-conti` : id
  }

  titolo = (tipo: string): string => this.titoli[tipo as TipoMappatura] ?? tipo
  perCodice = (_: number, a: AdattatoreVista): string => a.codice
  perRiga = (
    _: number,
    r: RigaMappatura | { tipo: TipoMappatura; chiaveWasteflow: string }
  ): string => chiaveRiga(r)
  perSezione = (_: number, s: { tipo: TipoMappatura }): string => s.tipo

  /** Rilegge adattatori e mappature; un eventuale messaggio resta visibile dopo la rilettura. */
  ricarica(messaggio: string | null = null): void {
    this.richieste$.next({ adattatore: this.codiceCorrente, messaggio })
  }

  modifica(riga: RigaMappatura, valore: string | null): void {
    this.righe.update(l => l.map(r => (r === riga ? { ...r, valore: valore ?? '' } : r)))
  }

  salva(): void {
    const codice = this.adattatore()?.codice
    const voci = this.voci()
    if (!codice || voci.length === 0 || this.inCorso()) return
    if (voci.length > MAX_VOCI_MAPPATURE) return
    const cancellate = voci.filter(v => v.valore === null).length
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio
      .salvaMappature(codice, voci)
      .pipe(takeUntilDestroyed(this.distruzione))
      .subscribe({
        next: salvate => {
          this.inCorso.set(false)
          this.righe.set(this.costruisciRighe(salvate, this.righe()))
          // Completate le mappature mancanti, la selezione dell'export non serve piu' (35 r4).
          if (this.mancanti().length === 0) rimuoviSelezioneMappature()
          this.toast.success(
            cancellate > 0 ? `Mappature salvate (${cancellate} cancellate).` : 'Mappature salvate.',
            'Export contabile'
          )
        },
        error: err => {
          this.inCorso.set(false)
          if (leggiErroriAzione(err, '').rilettura) {
            this.ricarica(MESSAGGIO_VERSIONE_SUPERATA)
            return
          }
          // Un valore rifiutato per il formato del gestionale ha un testo suo, per l'utente.
          this.errore.set(
            (codiceErrore(err) === 'VOCI_NON_VALIDE'
              ? leggiErroriAzione(err, 'Una mappatura non è valida.').messaggi
              : messaggiErroreFatturazione(err, 'Impossibile salvare le mappature.')
            ).join(' ')
          )
        },
      })
  }

  private carica$(r: Richiesta): Observable<null> {
    this.errore.set(r.messaggio)
    this.puoRiprovare.set(false)
    this.vuoto.set(false)
    if (!this.permessi().imposta) return of(null)
    this.caricamento.set(true)
    return this.servizio.adattatori().pipe(
      // Le mappature si chiedono solo per un adattatore che esiste.
      switchMap(adattatori =>
        r.adattatore && adattatori.some(a => a.codice === r.adattatore)
          ? forkJoin({
              mappature: this.servizio.mappature(r.adattatore),
              mancanti: this.mancanti$(r.adattatore),
            }).pipe(map((x): Caricamento => ({ adattatori, ...x })))
          : of<Caricamento>({ adattatori, mappature: [], mancanti: [] })
      ),
      map(esito => {
        this.applica(r, esito)
        return null
      }),
      catchError(err => {
        this.caricamento.set(false)
        this.errore.set(
          messaggiErroreFatturazione(err, 'Impossibile caricare le mappature.').join(' ')
        )
        this.puoRiprovare.set(true)
        return of(null)
      })
    )
  }

  /**
   * Chiavi mancanti: prima quelle passate nella navigazione (`history.state`); altrimenti la
   * selezione lasciata in `sessionStorage` si manda al backend, che dice che cosa manca ora.
   * Un errore qui non blocca la pagina: le mappature restano modificabili.
   */
  private mancanti$(adattatore: string): Observable<ChiaveMancante[]> {
    if (this.mancantiRicevute.length > 0) return of(this.mancantiRicevute)
    const selezione = selezioneDaSessione()
    if (selezione === null) return of([])
    return this.servizio.chiaviMancanti(adattatore, selezione).pipe(
      catchError(() => {
        this.errore.set('Non è stato possibile verificare quali mappature mancano.')
        return of([])
      })
    )
  }

  private applica(r: Richiesta, esito: Caricamento): void {
    this.caricamento.set(false)
    this.adattatori.set(esito.adattatori)
    this.vuoto.set(esito.adattatori.length === 0)
    const scelto = r.adattatore
      ? (esito.adattatori.find(a => a.codice === r.adattatore) ?? null)
      : null
    this.adattatore.set(scelto)
    if (r.adattatore && !scelto && esito.adattatori.length > 0) {
      this.errore.set(ERRORI_HTTP_VOCI.ADATTATORE_SCONOSCIUTO.etichetta)
    }
    this.mancantiRicevute = esito.mancanti
    this.righe.set(scelto ? this.costruisciRighe(esito.mappature, []) : [])
  }

  /**
   * Righe = voci salvate (con etichetta del backend) + chiavi mancanti non ancora salvate.
   */
  private costruisciRighe(
    salvate: MappaturaVista[],
    _precedenti: RigaMappatura[]
  ): RigaMappatura[] {
    const righe: RigaMappatura[] = salvate.map(m => ({
      tipo: m.tipo,
      chiaveWasteflow: m.chiaveWasteflow,
      etichetta: m.etichetta,
      salvato: m.valore,
      versione: m.versione,
      valore: m.valore,
    }))
    const presenti = new Set(righe.map(chiaveRiga))
    for (const m of this.mancantiRicevute) {
      if (presenti.has(chiaveRiga(m))) continue
      righe.push({
        tipo: m.tipo,
        chiaveWasteflow: m.chiaveWasteflow,
        etichetta: m.etichetta,
        salvato: null,
        versione: null,
        valore: '',
      })
    }
    return righe.sort(
      (a, b) =>
        TIPI_MAPPATURA.indexOf(a.tipo) - TIPI_MAPPATURA.indexOf(b.tipo) ||
        (a.etichetta ?? '').localeCompare(b.etichetta ?? '', 'it') ||
        a.chiaveWasteflow.localeCompare(b.chiaveWasteflow, 'it')
    )
  }
}
