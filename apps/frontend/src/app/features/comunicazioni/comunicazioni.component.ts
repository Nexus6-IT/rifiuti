import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule, DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { ComunicazioniService } from './comunicazioni.service'
import {
  AnteprimaOrso,
  ComunicazioneVista,
  puoGenerareComunicazioni,
  righeDaAnteprima,
} from './comunicazioni.model'

interface SedeScelta {
  id: string
  denominazione: string
}

/** Legge il codice d'errore del backend (corpo JSON `{ code }` o `{ message: { code } }`). */
function codiceErrore(err: unknown): string | undefined {
  const corpo = (err as { error?: { code?: string; message?: { code?: string } | string } })?.error
  if (!corpo) return undefined
  if (typeof corpo.code === 'string') return corpo.code
  if (typeof corpo.message === 'object' && corpo.message) return corpo.message.code
  return undefined
}

/**
 * Comunicazioni ai consorzi, O.R.SO. (4.9a): anteprima annuale mese × CER della sede, avvisi,
 * generazione del file, «segna inviata» e storico. Lettura per tutti i ruoli, scrittura
 * ADMIN/OPERATOR (enforcement anche lato backend).
 */
@Component({
  selector: 'app-comunicazioni',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DropdownModule,
    TableModule,
    TagModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService, DatePipe],
  template: `
    <div class="page">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Comunicazioni O.R.SO.</h1>
          <p class="page-subtitle">
            Comunicazione annuale all'Osservatorio Rifiuti Sovraregionale: ricevuti e prodotti per
            mese e CER
          </p>
        </div>
      </header>

      <section class="surface-card mb-4" data-testid="comunicazioni-filtri">
        <div class="flex flex-wrap gap-3 align-items-end">
          <div class="flex flex-column gap-1" *ngIf="sedi().length > 1">
            <label for="com-sede">Sede</label>
            <p-dropdown
              inputId="com-sede"
              [options]="sedi()"
              optionLabel="denominazione"
              optionValue="id"
              [ngModel]="unitaLocaleId()"
              (ngModelChange)="scegliSede($event)"
              placeholder="Scegli la sede"
              data-testid="comunicazioni-sede"
            ></p-dropdown>
          </div>
          <div class="flex flex-column gap-1" *ngIf="sedi().length === 1">
            <span class="text-secondary">Sede</span>
            <strong data-testid="comunicazioni-sede-unica">{{ sedi()[0].denominazione }}</strong>
          </div>
          <div class="flex flex-column gap-1">
            <label for="com-anno">Anno</label>
            <p-dropdown
              inputId="com-anno"
              [options]="anni"
              [ngModel]="anno()"
              (ngModelChange)="scegliAnno($event)"
              data-testid="comunicazioni-anno"
            ></p-dropdown>
          </div>
        </div>
      </section>

      <div *ngIf="caricamento()" class="flex align-items-center gap-2 text-secondary">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
        <span>Caricamento…</span>
      </div>

      <section
        *ngIf="errore()"
        class="surface-card mb-4"
        role="alert"
        data-testid="comunicazioni-errore"
      >
        {{ errore() }}
      </section>

      <p
        *ngIf="sedi().length === 0 && !caricamento()"
        class="text-secondary"
        data-testid="comunicazioni-nessuna-sede"
      >
        Nessuna sede attiva: aggiungi un'unità locale in «Sedi RENTRI».
      </p>

      <ng-container *ngIf="anteprima() as a">
        <section
          *ngIf="a.avvisi.length > 0"
          class="surface-card mb-4"
          data-testid="comunicazioni-avvisi"
        >
          <h2 class="section-title">Avvisi</h2>
          <ul class="m-0 pl-3">
            <li *ngFor="let v of a.avvisi" data-testid="comunicazioni-avviso">
              <span class="mono">{{ v.codice }}</span> — {{ v.messaggio }}
              <span *ngIf="v.movimentoIds.length > 0" class="text-secondary">
                ({{ v.movimentoIds.length }} movimenti)</span
              >
            </li>
          </ul>
          <p *ngIf="a.bloccanti" class="mt-2 mb-0" data-testid="comunicazioni-bloccanti">
            Ci sono avvisi bloccanti: correggili prima di generare il file.
          </p>
        </section>

        <section class="surface-card mb-4">
          <div class="flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
            <h2 class="section-title m-0">Anno {{ a.anno }} — {{ a.unitaLocale.nome }}</h2>
            <p-button
              *ngIf="puoScrivere()"
              label="Genera"
              icon="pi pi-cog"
              styleClass="wf-primario"
              [disabled]="generaDisabilitato()"
              [loading]="inCorso()"
              (onClick)="genera()"
              data-testid="comunicazioni-genera"
            ></p-button>
          </div>

          <p *ngIf="righe().length === 0" class="text-secondary" data-testid="comunicazioni-vuota">
            Nessun movimento nell'anno per questa sede.
          </p>
          <div class="table-scroll" *ngIf="righe().length > 0">
            <table class="wf-table" data-testid="comunicazioni-tabella">
              <thead>
                <tr>
                  <th>Mese</th>
                  <th>Tipo</th>
                  <th>CER</th>
                  <th>Descrizione</th>
                  <th>Operazioni</th>
                  <th class="num-col">Quantità</th>
                  <th>Dettaglio</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let r of righe()" data-testid="comunicazioni-riga">
                  <td>{{ r.meseNome }}</td>
                  <td>{{ r.direzione }}</td>
                  <td class="mono">{{ r.cer }}</td>
                  <td>{{ r.descrizione }}</td>
                  <td>{{ r.operazioni }}</td>
                  <td class="num-col">{{ r.quantita }}</td>
                  <td class="text-secondary">{{ r.dettaglio }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>

      <section *ngIf="unitaLocaleId()" class="surface-card" data-testid="comunicazioni-storico">
        <h2 class="section-title">Storico</h2>
        <p *ngIf="storico().length === 0" class="text-secondary">
          Nessun file generato per questo anno.
        </p>
        <div class="table-scroll" *ngIf="storico().length > 0">
          <table class="wf-table">
            <thead>
              <tr>
                <th>Generata il</th>
                <th>Versione</th>
                <th>Stato</th>
                <th>File</th>
                <th class="azioni-col">Azioni</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let c of storico()" data-testid="comunicazioni-storico-riga">
                <td>{{ c.generataIl | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td class="num-col">{{ c.versione }}</td>
                <td>
                  <p-tag
                    [value]="c.stato === 'INVIATA' ? 'Inviata' : 'Generata'"
                    [severity]="c.stato === 'INVIATA' ? 'success' : 'info'"
                  ></p-tag>
                  <span
                    *ngIf="c.modificataDopoInvio"
                    class="ml-2"
                    data-testid="comunicazioni-modificata"
                    >Modificata dopo l'invio</span
                  >
                </td>
                <td class="mono">{{ c.nomeFile }}</td>
                <td class="azioni-col">
                  <p-button
                    label="Scarica file"
                    icon="pi pi-download"
                    [text]="true"
                    (onClick)="scarica(c)"
                    data-testid="comunicazioni-scarica"
                  ></p-button>
                  <p-button
                    *ngIf="puoScrivere() && c.stato === 'GENERATA'"
                    label="Segna inviata"
                    icon="pi pi-check"
                    [text]="true"
                    (onClick)="confermaInviata(c)"
                    data-testid="comunicazioni-segna-inviata"
                  ></p-button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class ComunicazioniComponent implements OnInit {
  private readonly servizio = inject(ComunicazioniService)
  private readonly sediServizio = inject(RentriUnitaLocaleService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  readonly sedi = signal<SedeScelta[]>([])
  readonly unitaLocaleId = signal<string | null>(null)
  readonly anno = signal(new Date().getFullYear())
  readonly anteprima = signal<AnteprimaOrso | null>(null)
  readonly storico = signal<ComunicazioneVista[]>([])
  readonly caricamento = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)

  readonly anni = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)
  readonly righe = computed(() => righeDaAnteprima(this.anteprima()?.mesi ?? []))
  readonly puoScrivere = computed(() => puoGenerareComunicazioni(this.auth.currentUser()?.role))
  readonly generaDisabilitato = computed(
    () => this.inCorso() || this.caricamento() || (this.anteprima()?.bloccanti ?? true)
  )

  ngOnInit(): void {
    this.sediServizio.list().subscribe({
      next: elenco => {
        const attive = elenco
          .filter(s => s.attiva)
          .map(s => ({ id: s.id, denominazione: s.denominazione }))
        this.sedi.set(attive)
        if (attive.length === 1) this.scegliSede(attive[0].id)
      },
      error: () => this.errore.set('Impossibile caricare le sedi.'),
    })
  }

  scegliSede(id: string): void {
    this.unitaLocaleId.set(id)
    this.carica()
  }

  scegliAnno(anno: number): void {
    this.anno.set(anno)
    this.carica()
  }

  /** Ricarica anteprima e storico della sede e dell'anno scelti. */
  carica(): void {
    const sede = this.unitaLocaleId()
    if (!sede) return
    const anno = this.anno()
    this.errore.set(null)
    this.caricamento.set(true)
    this.servizio.anteprimaOrso(sede, anno).subscribe({
      next: a => {
        this.anteprima.set(a)
        this.caricamento.set(false)
      },
      error: () => {
        this.anteprima.set(null)
        this.caricamento.set(false)
        this.errore.set("Impossibile calcolare l'anteprima.")
      },
    })
    this.caricaStorico()
  }

  private caricaStorico(): void {
    const sede = this.unitaLocaleId()
    if (!sede) return
    this.servizio.storicoOrso(sede, this.anno()).subscribe({
      next: s => this.storico.set(s),
      error: () => this.errore.set('Impossibile caricare lo storico.'),
    })
  }

  genera(): void {
    const sede = this.unitaLocaleId()
    if (!sede || this.generaDisabilitato()) return
    this.inCorso.set(true)
    this.servizio.generaOrso(sede, this.anno()).subscribe({
      next: () => {
        this.inCorso.set(false)
        this.toast.success('Comunicazione generata')
        this.carica()
      },
      error: err => {
        this.inCorso.set(false)
        this.toast.error(
          codiceErrore(err) === 'COMUNICAZIONE_CON_BLOCCANTI'
            ? 'Ci sono avvisi bloccanti: correggili prima di generare il file.'
            : 'Generazione non riuscita.'
        )
      },
    })
  }

  confermaInviata(c: ComunicazioneVista): void {
    this.conferma.confirm({
      header: 'Segna come inviata',
      message: `Confermi di aver inviato «${c.nomeFile}» all'Osservatorio?`,
      acceptLabel: 'Segna inviata',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      accept: () => this.segnaInviata(c),
    })
  }

  segnaInviata(c: ComunicazioneVista): void {
    this.servizio.segnaInviata(c.id).subscribe({
      next: () => {
        this.toast.success('Comunicazione segnata come inviata')
        this.carica()
      },
      error: () => this.toast.error('Operazione non riuscita.'),
    })
  }

  scarica(c: ComunicazioneVista): void {
    this.servizio.scaricaFile(c.id).subscribe({
      next: f => {
        const url = URL.createObjectURL(f.blob)
        const a = document.createElement('a')
        a.href = url
        a.download = f.nomeFile ?? c.nomeFile
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      },
      error: () => this.toast.error('Download non riuscito.'),
    })
  }
}
