import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule, DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { ToastService } from '../../core/services/toast.service'
import { codiceErrore } from '../listino/errori-azione'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { nomeMese } from './comunicazioni.model'
import { ComunicazioniService } from './comunicazioni.service'
import { ConfigurazioneSedeComponent } from './configurazione-sede.component'
import {
  ATTIVITA_ORR_ETICHETTE,
  AVVISO_TRACCIATO_ORR,
  AnteprimaOrr,
  ComunicazioneOrr,
  etichettaPeriodoOrr,
} from './orr.model'
import { OrrService } from './orr.service'

interface SedeScelta {
  id: string
  denominazione: string
}

/**
 * Comunicazione O.R.R. Campania (4.9f): una sede e un periodo a mesi interi producono un file per
 * attività (trasportatore, stoccaggio, smaltimento, recupero, ...). Anteprima con avvisi e link alla
 * correzione, generazione di tutti i file (con un bloccante non se ne genera nessuno), storico con
 * manifest e «segna inviata» (con la conferma esplicita richiesta dal tracciato non verificato).
 * Lettura per tutti i ruoli, scrittura ADMIN/OPERATOR (enforcement anche lato backend).
 */
@Component({
  selector: 'app-orr',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ButtonModule,
    DropdownModule,
    TableModule,
    TagModule,
    ConfirmDialogModule,
    ConfigurazioneSedeComponent,
  ],
  providers: [ConfirmationService, DatePipe],
  template: `
    <div class="page pagina-lavoro">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Comunicazione O.R.R. Campania</h1>
          <p class="page-subtitle">
            Osservatorio Regionale Rifiuti: un file di testo per sede e per attività, a mesi interi
          </p>
        </div>
        <a routerLink="/comunicazioni" data-testid="orr-torna-orso">Comunicazioni O.R.SO.</a>
      </header>

      <section
        class="surface-card mb-4"
        role="note"
        data-testid="orr-banner-ricavato"
        aria-label="Affidabilità del tracciato"
      >
        <strong>Da confermare.</strong> {{ avvisoTracciato }}
      </section>

      <section class="surface-card mb-4" data-testid="orr-filtri">
        <div class="flex flex-wrap gap-3 align-items-end">
          <div class="flex flex-column gap-1" *ngIf="sedi().length > 1">
            <label for="orr-sede">Sede</label>
            <p-dropdown
              inputId="orr-sede"
              [options]="sedi()"
              optionLabel="denominazione"
              optionValue="id"
              [ngModel]="unitaLocaleId()"
              (ngModelChange)="scegliSede($event)"
              placeholder="Scegli la sede"
              data-testid="orr-sede"
            ></p-dropdown>
          </div>
          <div class="flex flex-column gap-1" *ngIf="sedi().length === 1">
            <span class="text-secondary">Sede</span>
            <strong data-testid="orr-sede-unica">{{ sedi()[0].denominazione }}</strong>
          </div>
          <div class="flex flex-column gap-1">
            <label for="orr-anno">Anno</label>
            <p-dropdown
              inputId="orr-anno"
              [options]="anni"
              [ngModel]="anno()"
              (ngModelChange)="scegliAnno($event)"
              data-testid="orr-anno"
            ></p-dropdown>
          </div>
          <div class="flex flex-column gap-1">
            <label for="orr-mese-da">Dal mese</label>
            <p-dropdown
              inputId="orr-mese-da"
              [options]="mesi"
              optionLabel="nome"
              optionValue="numero"
              [ngModel]="meseDa()"
              (ngModelChange)="scegliMeseDa($event)"
              data-testid="orr-mese-da"
            ></p-dropdown>
          </div>
          <div class="flex flex-column gap-1">
            <label for="orr-mese-a">Al mese</label>
            <p-dropdown
              inputId="orr-mese-a"
              [options]="mesi"
              optionLabel="nome"
              optionValue="numero"
              [ngModel]="meseA()"
              (ngModelChange)="scegliMeseA($event)"
              data-testid="orr-mese-a"
            ></p-dropdown>
          </div>
        </div>
      </section>

      <div *ngIf="caricamento()" class="flex align-items-center gap-2 text-secondary">
        <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
        <span>Caricamento…</span>
      </div>

      <section *ngIf="errore()" class="surface-card mb-4" role="alert" data-testid="orr-errore">
        {{ errore() }}
      </section>

      <p
        *ngIf="sedi().length === 0 && !caricamento()"
        class="text-secondary"
        data-testid="orr-nessuna-sede"
      >
        Nessuna sede attiva: aggiungi un'unità locale in «Sedi RENTRI».
      </p>

      <ng-container *ngIf="anteprima() as a">
        <section
          *ngIf="a.avvisiGenerali.length > 0"
          class="surface-card mb-4"
          data-testid="orr-avvisi-generali"
        >
          <h2 class="section-title">Da correggere</h2>
          <ul class="m-0 pl-3">
            <li *ngFor="let v of a.avvisiGenerali" data-testid="orr-avviso-generale">
              <span class="mono">{{ v.codice }}</span> — {{ v.messaggio }}
              <ng-container
                *ngTemplateOutlet="correzione; context: { $implicit: v }"
              ></ng-container>
            </li>
          </ul>
        </section>

        <p *ngIf="a.nessunDato" class="surface-card mb-4" data-testid="orr-nessun-dato">
          Non ci sono dati da comunicare per questa sede e questo periodo.
        </p>

        <section
          *ngFor="let f of a.file"
          class="surface-card mb-4"
          [attr.data-testid]="'orr-file-' + f.attivita"
        >
          <div class="flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
            <h2 class="section-title m-0">
              {{ etichetta(f.attivita) }}
              <span class="text-secondary">({{ f.attivita }})</span>
            </h2>
            <p-tag
              [value]="f.bloccanti ? 'Da correggere' : 'Pronto'"
              [severity]="f.bloccanti ? 'danger' : 'success'"
              data-testid="orr-file-stato"
            ></p-tag>
          </div>
          <p class="m-0 mb-2" data-testid="orr-file-riepilogo">
            {{ f.numeroRecord }} record da {{ f.numeroMovimenti }} movimenti
            <span class="text-secondary"> — tracciato {{ f.versione }}</span>
          </p>
          <ul *ngIf="f.avvisi.length > 0" class="m-0 pl-3" data-testid="orr-file-avvisi">
            <li *ngFor="let v of f.avvisi" data-testid="orr-file-avviso">
              <strong *ngIf="v.bloccante">Bloccante: </strong>
              <span class="mono">{{ v.codice }}</span> — {{ v.messaggio }}
              <span *ngIf="v.movimentoIds.length > 0" class="text-secondary">
                ({{ v.movimentoIds.length }} movimenti)</span
              >
              <ul *ngIf="v.movimenti?.length" class="m-0 pl-3 text-secondary">
                <li *ngFor="let mv of v.movimenti">
                  n. {{ mv.numero }} del {{ mv.data | date: 'dd/MM/yyyy' }} — CER {{ mv.cer }}
                </li>
              </ul>
              <ng-container
                *ngTemplateOutlet="correzione; context: { $implicit: v }"
              ></ng-container>
            </li>
          </ul>
        </section>

        <section *ngIf="a.file.length > 0" class="surface-card mb-4">
          <p *ngIf="a.bloccanti" class="mt-0" data-testid="orr-bloccanti">
            Ci sono avvisi bloccanti: correggili prima di generare. Se un solo file ha un errore non
            se ne genera nessuno.
          </p>
          <p-button
            *ngIf="puoScrivere()"
            [label]="a.file.length > 1 ? 'Genera i ' + a.file.length + ' file' : 'Genera il file'"
            icon="pi pi-cog"
            styleClass="wf-primario"
            [disabled]="generaDisabilitato()"
            [loading]="inCorso()"
            (onClick)="genera()"
            data-testid="orr-genera"
          ></p-button>
        </section>
      </ng-container>

      <ng-template #correzione let-v>
        <span *ngIf="v.correzione as c" class="ml-2" data-testid="orr-correzione">
          <ng-container [ngSwitch]="c.tipo">
            <a *ngSwitchCase="'MOVIMENTO'" routerLink="/registro">Apri il registro</a>
            <span *ngSwitchCase="'ANAGRAFICA_SEDE'">
              Correggi i dati nell'anagrafica della sede:
              <a routerLink="/produttori">produttori</a> ·
              <a routerLink="/trasportatori">trasportatori</a> ·
              <a routerLink="/destinatari">destinatari</a>
            </span>
            <a *ngSwitchCase="'CONFIGURAZIONE_SEDE'" href="#orr-configurazione"
              >Apri la configurazione O.R.R.</a
            >
          </ng-container>
        </span>
      </ng-template>

      <div id="orr-configurazione">
        <app-configurazione-sede
          *ngIf="unitaLocaleId() as sedeConfigurazione"
          [unitaLocaleId]="sedeConfigurazione"
        ></app-configurazione-sede>
      </div>

      <section *ngIf="unitaLocaleId()" class="surface-card" data-testid="orr-storico">
        <h2 class="section-title">Storico</h2>
        <p *ngIf="storico().length === 0" class="text-secondary">
          Nessun file generato per questo anno.
        </p>
        <div class="table-card" *ngIf="storico().length > 0">
          <p-table [value]="storico()" styleClass="p-datatable-sm" aria-label="Storico O.R.R.">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Generata il</th>
                <th scope="col">Periodo</th>
                <th scope="col">Attività</th>
                <th scope="col">Stato</th>
                <th scope="col">File</th>
                <th scope="col" class="azioni-col">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr data-testid="orr-storico-riga">
                <td>{{ c.generataIl | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ periodo(c) }}</td>
                <td>{{ etichetta(c.attivita) }}</td>
                <td>
                  <p-tag
                    [value]="c.stato === 'INVIATA' ? 'Inviata' : 'Generata'"
                    [severity]="c.stato === 'INVIATA' ? 'success' : 'info'"
                  ></p-tag>
                  <span
                    *ngIf="c.affidabilita === 'RICAVATO_WINWASTE'"
                    class="ml-2"
                    data-testid="orr-storico-da-confermare"
                    >Da confermare</span
                  >
                  <span *ngIf="c.modificataDopoInvio" class="ml-2" data-testid="orr-modificata"
                    >Modificata dopo l'invio</span
                  >
                </td>
                <td class="cell-mono">{{ c.nomeFile }}</td>
                <td class="azioni-col">
                  <p-button
                    label="Scarica file"
                    icon="pi pi-download"
                    [text]="true"
                    (onClick)="scarica(c)"
                    data-testid="orr-scarica"
                  ></p-button>
                  <p-button
                    label="Manifest"
                    icon="pi pi-file"
                    [text]="true"
                    (onClick)="scaricaManifest(c)"
                    data-testid="orr-manifest"
                  ></p-button>
                  <p-button
                    *ngIf="puoScrivere() && c.stato === 'GENERATA'"
                    label="Segna inviata"
                    icon="pi pi-check"
                    [text]="true"
                    (onClick)="confermaInviata(c)"
                    data-testid="orr-segna-inviata"
                  ></p-button>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>
    </div>
  `,
})
export class OrrComponent implements OnInit {
  private readonly servizio = inject(OrrService)
  private readonly comunicazioni = inject(ComunicazioniService)
  private readonly sediServizio = inject(RentriUnitaLocaleService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  private contatoreRichieste = 0

  readonly avvisoTracciato = AVVISO_TRACCIATO_ORR
  readonly sedi = signal<SedeScelta[]>([])
  readonly unitaLocaleId = signal<string | null>(null)
  readonly anno = signal(new Date().getFullYear())
  readonly meseDa = signal(1)
  readonly meseA = signal(new Date().getMonth() + 1)
  readonly anteprima = signal<AnteprimaOrr | null>(null)
  readonly storico = signal<ComunicazioneOrr[]>([])
  readonly caricamento = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)

  readonly anni = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i)
  readonly mesi = Array.from({ length: 12 }, (_, i) => ({ numero: i + 1, nome: nomeMese(i + 1) }))
  /** Ruolo effettivo nell'azienda selezionata, calcolato dal backend con l'anteprima. */
  readonly puoScrivere = computed(() => this.anteprima()?.puoGenerare === true)
  readonly generaDisabilitato = computed(
    () =>
      this.inCorso() ||
      this.caricamento() ||
      (this.anteprima()?.bloccanti ?? true) ||
      (this.anteprima()?.file.length ?? 0) === 0
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

  etichetta(attivita: keyof typeof ATTIVITA_ORR_ETICHETTE): string {
    return ATTIVITA_ORR_ETICHETTE[attivita] ?? attivita
  }

  periodo(c: ComunicazioneOrr): string {
    return etichettaPeriodoOrr(c.periodoDa, c.periodoA)
  }

  scegliSede(id: string): void {
    this.unitaLocaleId.set(id)
    this.carica()
  }

  scegliAnno(anno: number): void {
    this.anno.set(anno)
    this.carica()
  }

  scegliMeseDa(m: number): void {
    this.meseDa.set(m)
    // Mesi interi dello stesso anno: se il mese finale precede l'iniziale lo si porta a coincidere.
    if (this.meseA() < m) this.meseA.set(m)
    this.carica()
  }

  scegliMeseA(m: number): void {
    this.meseA.set(m)
    if (this.meseDa() > m) this.meseDa.set(m)
    this.carica()
  }

  /** Ricarica anteprima e storico della sede, dell'anno e dei mesi scelti. */
  carica(): void {
    const sede = this.unitaLocaleId()
    if (!sede) return
    const richiesta = ++this.contatoreRichieste
    // Una risposta di una richiesta superata (sede o periodo cambiati nel frattempo) si scarta.
    const attuale = () => richiesta === this.contatoreRichieste
    this.errore.set(null)
    this.caricamento.set(true)
    this.servizio.anteprima(sede, this.anno(), this.meseDa(), this.meseA()).subscribe({
      next: a => {
        if (!attuale()) return
        this.anteprima.set(a)
        this.caricamento.set(false)
      },
      error: err => {
        if (!attuale()) return
        this.anteprima.set(null)
        this.caricamento.set(false)
        this.errore.set(
          codiceErrore(err) === 'RICHIESTA_COMUNICAZIONE_NON_VALIDA'
            ? 'Periodo non valido: servono mesi interi dello stesso anno.'
            : "Impossibile calcolare l'anteprima."
        )
      },
    })
    this.caricaStorico(sede, richiesta)
  }

  private caricaStorico(sede: string, richiesta: number): void {
    this.servizio.storico(sede, this.anno()).subscribe({
      next: s => {
        if (richiesta === this.contatoreRichieste) this.storico.set(s)
      },
      error: () => {
        if (richiesta === this.contatoreRichieste)
          this.errore.set('Impossibile caricare lo storico.')
      },
    })
  }

  genera(): void {
    const sede = this.unitaLocaleId()
    if (!sede || this.generaDisabilitato()) return
    this.inCorso.set(true)
    this.servizio.genera(sede, this.anno(), this.meseDa(), this.meseA()).subscribe({
      next: r => {
        this.inCorso.set(false)
        this.toast.success(r.file.length > 1 ? `${r.file.length} file generati` : 'File generato')
        this.carica()
      },
      error: err => {
        this.inCorso.set(false)
        this.toast.error(
          codiceErrore(err) === 'COMUNICAZIONE_CON_BLOCCANTI'
            ? 'Ci sono avvisi bloccanti: correggili prima di generare i file.'
            : 'Generazione non riuscita.'
        )
        this.carica()
      },
    })
  }

  /** Il tracciato e' ricavato da WinWaste: la conferma di verifica e' esplicita (Q2). */
  confermaInviata(c: ComunicazioneOrr): void {
    this.conferma.confirm({
      header: 'Segna come inviata',
      message: `Ho verificato che il consorzio accetta questo file («${c.nomeFile}»). Il tracciato è ricavato da WinWaste e non è stato confermato con un file reale: segnalo come inviato solo dopo averlo caricato sul portale.`,
      acceptLabel: 'Ho verificato, segna inviata',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      accept: () => this.segnaInviata(c),
    })
  }

  segnaInviata(c: ComunicazioneOrr): void {
    this.comunicazioni.segnaInviata(c.id, true).subscribe({
      next: () => {
        this.toast.success('File segnato come inviato')
        this.carica()
      },
      error: () => this.toast.error('Operazione non riuscita.'),
    })
  }

  scarica(c: ComunicazioneOrr): void {
    this.comunicazioni.scaricaFile(c.id).subscribe({
      next: f => this.salvaBlob(f.blob, f.nomeFile ?? c.nomeFile),
      error: () => this.toast.error('Download non riuscito.'),
    })
  }

  scaricaManifest(c: ComunicazioneOrr): void {
    this.comunicazioni.scaricaManifest(c.id).subscribe({
      next: f => this.salvaBlob(f.blob, f.nomeFile ?? `${c.nomeFile}.manifest.txt`),
      error: () => this.toast.error('Download non riuscito.'),
    })
  }

  private salvaBlob(blob: Blob, nome: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
