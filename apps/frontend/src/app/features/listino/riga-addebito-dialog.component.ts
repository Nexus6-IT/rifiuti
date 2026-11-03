import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import {
  Observable,
  Subscription,
  catchError,
  forkJoin,
  map,
  merge,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs'
import { CerService } from '../cer/cer.service'
import { AggiuntaInLinea } from '../clienti/aggiunta-in-linea'
import { messaggioErrore, permessoScrittura } from '../clienti/tabelle/tabella-comune'
import { CERSearchResult } from '../../shared/models/cer.model'
import { AddebitoDialogComponent } from './addebito-dialog.component'
import { Addebito, CodificaRentri, RigaAddebito } from './listino.model'
import { ListinoService } from './listino.service'
import { ChiaveOpzione, OpzioniListino } from './opzioni-listino'
import { RigaDatiSezioneComponent, RichiestaNuovo } from './riga-dati-sezione.component'
import { RigaFasceSezioneComponent } from './riga-fasce-sezione.component'
import { RigaForm, tipoPerMenu } from './riga-modulo'
import { RigaPropostaSezioneComponent } from './riga-proposta-sezione.component'
import { MESSAGGIO_CONCORRENTE, naturaConflitto } from './errori-azione'
import { RigaScadenzeSezioneComponent } from './riga-scadenze-sezione.component'
import { VoceRicerca } from './riga-ricerca.component'
import { CodiceIvaDialogComponent } from './tabelle/codice-iva-dialog.component'
import { CodificaAddebitoDialogComponent } from './tabelle/codifica-addebito-dialog.component'

type ScelteRicerca =
  | { tipo: 'CER'; cer: CERSearchResult }
  | { tipo: 'ADDEBITO'; addebito: Addebito }

const CHIAVI_RIGA: readonly ChiaveOpzione[] = ['IVA', 'CATEGORIA', 'CENTRO_RICAVO']
const GENERI_IN_LINEA = ['CATEGORIA', 'CENTRO_RICAVO'] as const

/**
 * Nuova riga o modifica di una riga di un elenco (4.2b, Task 27, parte 1: dati, quantità, prezzo
 * e proposta). I campi che valgono dipendono dalla famiglia del tipo (`CAMPI_PER_FAMIGLIA`);
 * cambiando tipo quelli fuori famiglia si svuotano e spariscono. Alla scelta del CER o
 * dell'addebito il backend propone i valori, che riempiono solo i campi vuoti. Il backend è
 * l'arbitro delle regole: i suoi errori (R36) compaiono sotto il campo, quelli senza campo in
 * testa; un 409 mostra il messaggio con "Ricarica".
 *
 * Task 28: fra i dati e la proposta stanno le fasce del prezzo speciale e le scadenze dei fissi
 * (sezioni proprie, sui controlli di `RigaForm`); i loro errori del backend compaiono sull'editor.
 */
@Component({
  selector: 'app-riga-addebito-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    DialogModule,
    RigaDatiSezioneComponent,
    RigaFasceSezioneComponent,
    RigaScadenzeSezioneComponent,
    RigaPropostaSezioneComponent,
    AddebitoDialogComponent,
    CodificaAddebitoDialogComponent,
    CodiceIvaDialogComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="alCambioVisibilita($event)"
      [header]="riga ? 'Modifica riga' : 'Nuova riga'"
      [modal]="true"
      [closable]="!inCorso()"
      [style]="{ width: '64rem', maxWidth: '95vw' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <ul
        *ngIf="stato.generali().length > 0"
        role="alert"
        class="field-error"
        data-testid="riga-errori-generali"
      >
        <li *ngFor="let m of stato.generali()">{{ m }}</li>
      </ul>
      <p *ngIf="avviso() as a" role="status" class="field-hint" data-testid="riga-avviso">
        {{ a }}
      </p>

      <p
        *ngIf="avvisoRicerca() as a"
        role="status"
        class="field-hint"
        data-testid="riga-avviso-ricerca"
      >
        {{ a }}
      </p>

      <app-riga-dati-sezione
        [stato]="stato"
        [opzioni]="opzioni"
        [cerca]="cercaCerOAddebito"
        [statiFisici]="statiFisici()"
        [operazioni]="operazioni()"
        [puoCreare]="puoScrivere()"
        [soloLettura]="soloLettura"
        (sceltaVoce)="scegli($event)"
        (nuovoAddebito)="inLineaAddebito.apri('ADDEBITO', 'create', $any($event))"
        (nuovo)="apriNuovo($event)"
      />

      <app-riga-fasce-sezione [stato]="stato" [soloLettura]="soloLettura" />
      <app-riga-scadenze-sezione [stato]="stato" [soloLettura]="soloLettura" />

      <app-riga-proposta-sezione
        [stato]="stato"
        [cercaCer]="cercaCer"
        [cercaAddebitoVariabile]="cercaAddebitoVariabile"
        [soloLettura]="soloLettura"
      />

      <ng-template pTemplate="footer">
        <p-button
          *ngIf="conflitto()"
          label="Ricarica"
          icon="pi pi-refresh"
          [outlined]="true"
          (onClick)="ricarica.emit()"
          data-testid="riga-ricarica"
        />
        <p-button
          label="Annulla"
          [text]="true"
          [disabled]="inCorso()"
          (onClick)="chiudi()"
          data-testid="riga-annulla"
        />
        <p-button
          *ngIf="!soloLettura"
          label="Salva"
          icon="pi pi-check"
          [disabled]="!puoSalvare()"
          (onClick)="salva()"
          data-testid="riga-salva"
        />
      </ng-template>
    </p-dialog>

    <app-addebito-dialog
      [visible]="inLineaAddebito.aperto === 'ADDEBITO'"
      [rapida]="true"
      (visibleChange)="chiudiSubAddebito($event)"
      (salvato)="dopoAddebito($event)"
    />
    <app-codifica-addebito-dialog
      *ngFor="let g of generi"
      [visible]="opzioni.inLinea.aperto === g"
      [genere]="g"
      [rapida]="true"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoCodifica($event)"
    />
    <app-codice-iva-dialog
      [visible]="opzioni.inLinea.aperto === 'IVA'"
      (visibleChange)="opzioni.chiudiSub($event)"
      (salvato)="opzioni.dopoIva($event)"
    />
  `,
})
export class RigaAddebitoDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(ListinoService)
  private readonly cer = inject(CerService)

  @Input() visible = false
  @Input({ required: true }) contrattoId = ''
  @Input({ required: true }) elencoId = ''
  /** null = nuova. */
  @Input() riga: RigaAddebito | null = null
  /** VIEWER o contratto annullato (D16): niente scrittura, il backend resta l'arbitro. */
  @Input() soloLettura = false
  @Output() visibleChange = new EventEmitter<boolean>()
  @Output() salvato = new EventEmitter<RigaAddebito>()
  /** "Ricarica" dopo un 409: la pagina rilegge e chiude il dialog. */
  @Output() ricarica = new EventEmitter<void>()

  readonly puoScrivere = permessoScrittura()
  readonly stato = new RigaForm()
  readonly generi = GENERI_IN_LINEA
  readonly inLineaAddebito = new AggiuntaInLinea<'ADDEBITO'>()
  readonly opzioni = new OpzioniListino(
    this.servizio,
    {
      IVA: this.stato.form.controls.codiceIvaId,
      CATEGORIA: this.stato.form.controls.categoriaId,
      CENTRO_RICAVO: this.stato.form.controls.centroRicavoId,
    },
    messaggio => this.avviso.set(messaggio),
    CHIAVI_RIGA
  )

  readonly avviso = signal<string | null>(null)
  /** Guasto parziale della ricerca "CER o addebito": mancano i risultati di una delle due. */
  readonly avvisoRicerca = signal<string | null>(null)
  readonly conflitto = signal(false)
  readonly inCorso = signal(false)
  readonly statiFisici = signal<CodificaRentri[]>([])
  readonly operazioni = signal<CodificaRentri[]>([])

  private correnti: Partial<
    Record<ChiaveOpzione, { id: string; codice: string; descrizione: string } | null>
  > = {}
  private proposta?: Subscription
  private salvataggio?: Subscription
  private codifiche?: Subscription

  constructor() {
    const f = this.stato.form.controls
    merge(f.tipo.valueChanges, f.tipoCifre.valueChanges, f.prezzoSpeciale.valueChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.stato.adatta())
  }

  // --- ricerche ----------------------------------------------------------------------------

  /** Catalogo CER e archivio degli addebiti insieme (la scelta "CER o addebito"). */
  readonly cercaCerOAddebito = (testo: string): Observable<VoceRicerca[]> =>
    forkJoin([
      // Solo i CER confermati dall'ultimo allineamento RENTRI: i capitoli e i codici storici il
      // catalogo li rifiuterebbe con 400. Se una delle due ricerche fallisce si mostrano i
      // risultati dell'altra; solo se falliscono entrambe la ricerca risulta non riuscita.
      this.cer.searchCER(testo, true).pipe(catchError(() => of(null))),
      this.servizio.addebiti
        .list({ testo, soloAttivi: true, dimensione: 20 })
        .pipe(catchError(() => of(null))),
    ]).pipe(
      tap(([cer, addebiti]) =>
        this.avvisoRicerca.set(
          cer === null && addebiti !== null
            ? 'Ricerca dei CER non riuscita: sono mostrati solo gli addebiti.'
            : addebiti === null && cer !== null
              ? 'Ricerca degli addebiti non riuscita: sono mostrati solo i CER.'
              : null
        )
      ),
      switchMap(([cer, addebiti]) =>
        cer === null && addebiti === null
          ? throwError(() => new Error('Ricerca non riuscita'))
          : of([
              ...(cer ?? []).map(
                (c): VoceRicerca<ScelteRicerca> => ({
                  chiave: `cer-${c.code}`,
                  etichetta: `CER ${c.code} - ${c.description}`,
                  dato: { tipo: 'CER', cer: c },
                })
              ),
              ...(addebiti?.elementi ?? []).map(
                (a): VoceRicerca<ScelteRicerca> => ({
                  chiave: `add-${a.codice}`,
                  etichetta: `${a.codice} - ${a.descrizione} (${a.tipo})`,
                  dato: { tipo: 'ADDEBITO', addebito: a },
                })
              ),
            ])
      )
    )

  readonly cercaCer = (testo: string): Observable<VoceRicerca[]> =>
    this.cer
      .searchCER(testo, true)
      .pipe(
        map(l =>
          l.map(c => ({ chiave: c.code, etichetta: `${c.code} - ${c.description}`, dato: c }))
        )
      )

  readonly cercaAddebitoVariabile = (testo: string): Observable<VoceRicerca[]> =>
    this.servizio.addebiti.list({ testo, tipo: 'V', soloAttivi: true, dimensione: 20 }).pipe(
      map(p =>
        p.elementi.map(a => ({
          chiave: a.codice,
          etichetta: `${a.codice} - ${a.descrizione}`,
          dato: a,
        }))
      )
    )

  // --- ciclo di vita -----------------------------------------------------------------------

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
    if (c['visible'] && !this.visible) this.interrompi()
    else if (c['soloLettura'] && !c['soloLettura'].firstChange) {
      this.stato.impostaSolaLettura(this.soloLettura)
    }
  }

  ngOnDestroy(): void {
    this.interrompi()
    this.opzioni.azzera()
  }

  private interrompi(): void {
    this.proposta?.unsubscribe()
    this.salvataggio?.unsubscribe()
    this.codifiche?.unsubscribe()
    this.inCorso.set(false)
  }

  private inizializza(): void {
    this.interrompi()
    this.opzioni.azzera()
    this.stato.azzera()
    this.avviso.set(null)
    this.conflitto.set(false)
    this.correnti = {}
    this.opzioni.carica()
    this.caricaCodificheRentri()
    const r = this.riga
    if (r) {
      this.stato.riempi(r)
      this.correnti = { IVA: r.codiceIva, CATEGORIA: r.categoria, CENTRO_RICAVO: r.centroRicavo }
      this.opzioni.impostaCorrenti(this.correnti)
    }
    this.stato.impostaSolaLettura(this.soloLettura)
  }

  private caricaCodificheRentri(): void {
    this.statiFisici.set([])
    this.operazioni.set([])
    const fallito = () => this.avviso.set('Impossibile caricare gli stati fisici e le operazioni.')
    const s = new Subscription()
    s.add(
      this.servizio.righe.codificheRentri('stati-fisici').subscribe({
        next: l => this.statiFisici.set(l),
        error: fallito,
      })
    )
    s.add(
      this.servizio.righe.codificheRentri('attivita-rs').subscribe({
        next: l => this.operazioni.set(l),
        error: fallito,
      })
    )
    this.codifiche = s
  }

  // --- scelta del CER o dell'addebito e valori proposti ------------------------------------

  scegli(voce: VoceRicerca): void {
    const d = voce.dato as ScelteRicerca
    if (d.tipo === 'CER') this.scegliCer(d.cer)
    else this.scegliAddebito(d.addebito)
  }

  private scegliCer(c: CERSearchResult): void {
    const f = this.stato.form.controls
    f.tipo.setValue('CER')
    f.tipoCifre.setValue('')
    f.addebitoId.setValue('')
    // La tipologia dipende dal CER: cambiato il codice la proposta (o il backend) la ricalcola.
    if (f.cerCode.value !== c.code) f.tipologiaRifiuto.setValue('')
    f.cerCode.setValue(c.code)
    this.stato.etichettaCer = `${c.code} - ${c.description}`
    this.stato.adatta()
    this.chiediProposta({ cerCode: c.code })
  }

  private scegliAddebito(a: Addebito): void {
    const f = this.stato.form.controls
    const m = tipoPerMenu(a.tipo)
    f.cerCode.setValue('')
    f.tipoCifre.setValue(m.cifre)
    f.tipo.setValue(m.tipo)
    f.addebitoId.setValue(a.id)
    this.stato.etichettaAddebito = `${a.codice} - ${a.descrizione}`
    this.stato.adatta()
    this.chiediProposta({ addebitoId: a.id })
  }

  private chiediProposta(scelta: { addebitoId?: string; cerCode?: string }): void {
    this.proposta?.unsubscribe()
    this.proposta = this.servizio.righe.proposta(this.contrattoId, scelta).subscribe({
      next: p => {
        const nuovi = this.stato.applicaProposta(p)
        this.correnti = {
          ...this.correnti,
          ...(nuovi.IVA ? { IVA: nuovi.IVA } : {}),
          ...(nuovi.CATEGORIA ? { CATEGORIA: nuovi.CATEGORIA } : {}),
          ...(nuovi.CENTRO_RICAVO ? { CENTRO_RICAVO: nuovi.CENTRO_RICAVO } : {}),
        }
        this.opzioni.impostaCorrenti(this.correnti)
      },
      // La proposta è un aiuto: se manca si compila a mano, il dialog resta utilizzabile.
      error: err => this.avviso.set(messaggioErrore(err, 'Impossibile leggere i valori proposti.')),
    })
  }

  // --- aggiunta in linea -------------------------------------------------------------------

  apriNuovo(r: RichiestaNuovo): void {
    this.opzioni.inLinea.apri(r.chiave, 'create', r.evento)
  }

  chiudiSubAddebito(visibile: boolean): void {
    if (!visibile) this.inLineaAddebito.chiudi()
  }

  dopoAddebito(a: Addebito): void {
    this.scegliAddebito(a)
  }

  /** Esc in un sub-dialog chiude anche questo (PrimeNG): si ignora, o si perde il form. */
  alCambioVisibilita(visibile: boolean): void {
    if (visibile) return
    if (
      this.opzioni.inLinea.bloccaChiusuraEsterna(visibile) ||
      this.inLineaAddebito.bloccaChiusuraEsterna(visibile)
    ) {
      return
    }
    this.chiudi()
  }

  chiudi(): void {
    if (this.inCorso()) return
    this.visibleChange.emit(false)
  }

  // --- salvataggio -------------------------------------------------------------------------

  puoSalvare(): boolean {
    return (
      !this.inCorso() &&
      !this.soloLettura &&
      this.stato.famiglia() !== null &&
      !this.stato.haErroriLocali()
    )
  }

  salva(): void {
    if (!this.puoSalvare()) return
    const dati = this.stato.dati()
    const esistente = this.riga
    this.inCorso.set(true)
    this.stato.pulisciErrori()
    this.avviso.set(null)
    this.conflitto.set(false)
    const richiesta = esistente
      ? this.servizio.righe.modifica(esistente.id, { ...dati, versione: esistente.versione })
      : this.servizio.righe.crea(this.elencoId, dati)
    this.salvataggio = richiesta.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        this.salvato.emit(salvata)
      },
      error: err => {
        this.inCorso.set(false)
        const natura = naturaConflitto(err)
        if (natura === 'concorrente') this.stato.impostaMessaggio(MESSAGGIO_CONCORRENTE)
        else this.stato.impostaErrori(err, 'Impossibile salvare la riga.')
        // "Ricarica" solo se i dati sono cambiati: un duplicato o un minimo già presente si
        // correggono nel form, che resta com'è.
        this.conflitto.set(natura === 'rilettura')
      },
    })
  }
}
