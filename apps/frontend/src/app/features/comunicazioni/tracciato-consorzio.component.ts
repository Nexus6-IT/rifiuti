import { Component, Input, OnChanges, SimpleChanges, computed, inject, signal } from '@angular/core'
import { CommonModule, DatePipe } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { ToastService } from '../../core/services/toast.service'
import { codiceErrore } from '../listino/errori-azione'
import { ComunicazioniService } from './comunicazioni.service'
import {
  AnteprimaTracciato,
  AvvisoTracciato,
  ComunicazioneTracciatoVista,
  ConsorzioTracciato,
  NOMI_CONSORZIO,
  TESTO_DA_CONFERMARE,
  annoSolare,
  daConfermare,
  linkCorrezione,
  mesePrecedente,
} from './tracciati.model'
import { TracciatiService } from './tracciati.service'

/**
 * Scheda di un tracciato a record (CONOU o COBAT, 4.9c-d): sede e periodo, anteprima con avvisi per
 * movimento e link alle correzioni, genera, scarica file e manifest, «segna inviata» con conferma
 * di verifica, storico con l'etichetta «da confermare». Il banner e l'etichetta dipendono da
 * `affidabilita`, non dal consorzio. Lettura per tutti i ruoli, scrittura ADMIN/OPERATOR (backend).
 */
@Component({
  selector: 'app-tracciato-consorzio',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ButtonModule, TagModule, ConfirmDialogModule],
  providers: [ConfirmationService, DatePipe],
  template: `
    <section class="surface-card mb-4" [attr.data-testid]="'tracciato-' + consorzio">
      <p-confirmDialog [key]="consorzio"></p-confirmDialog>
      <h2 class="section-title">{{ nome }}</h2>

      <div class="flex flex-wrap gap-3 align-items-end mb-3">
        <div class="flex flex-column gap-1">
          <label [for]="'tr-da-' + consorzio">Dal</label>
          <input
            [id]="'tr-da-' + consorzio"
            type="date"
            class="p-inputtext"
            [ngModel]="da()"
            (ngModelChange)="scegliPeriodo($event, a())"
            data-testid="tracciato-da"
          />
        </div>
        <div class="flex flex-column gap-1">
          <label [for]="'tr-a-' + consorzio">Al</label>
          <input
            [id]="'tr-a-' + consorzio"
            type="date"
            class="p-inputtext"
            [ngModel]="a()"
            (ngModelChange)="scegliPeriodo(da(), $event)"
            data-testid="tracciato-a"
          />
        </div>
        <p-button
          label="Mese scorso"
          [text]="true"
          (onClick)="usaMesePrecedente()"
          data-testid="tracciato-mese-scorso"
        ></p-button>
        <p-button
          label="Anno in corso"
          [text]="true"
          *ngIf="consorzio === 'COBAT'"
          (onClick)="usaAnno()"
          data-testid="tracciato-anno"
        ></p-button>
      </div>

      <p *ngIf="errore()" role="alert" data-testid="tracciato-errore">{{ errore() }}</p>

      <ng-container *ngIf="anteprima() as p">
        <p
          *ngIf="daConfermareAnteprima()"
          class="p-3 surface-100 border-round mb-3"
          role="note"
          data-testid="tracciato-banner"
        >
          <strong>{{ testoDaConfermare }}.</strong> {{ p.notaAffidabilita }}
        </p>

        <ul class="m-0 pl-3 mb-3" *ngIf="p.avvisi.length > 0" data-testid="tracciato-avvisi">
          <li *ngFor="let v of p.avvisi" data-testid="tracciato-avviso">
            <p-tag
              [value]="v.bloccante ? 'Bloccante' : 'Informativo'"
              [severity]="v.bloccante ? 'danger' : 'info'"
            ></p-tag>
            <span class="ml-2">{{ v.messaggio }}</span>
            <span *ngIf="v.movimentoIds.length > 0" class="text-secondary">
              ({{ v.movimentoIds.length }} movimenti)</span
            >
            <span *ngFor="let l of link(v)" class="ml-2">
              <a [routerLink]="l.rotta" data-testid="tracciato-correggi">{{ l.etichetta }}</a>
            </span>
            <ul *ngIf="v.movimenti?.length" class="m-0 pl-3 text-secondary">
              <li *ngFor="let mv of v.movimenti">
                n. {{ mv.numero }} del {{ mv.data | date: 'dd/MM/yyyy' }} — CER {{ mv.cer }}
              </li>
            </ul>
          </li>
        </ul>

        <div class="flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
          <span data-testid="tracciato-riepilogo">
            {{ p.numeroRecord }} record da {{ p.numeroMovimenti }} movimenti
          </span>
          <span class="flex gap-2">
            <p-button
              *ngIf="p.puoGenerare === true"
              label="Genera il file"
              icon="pi pi-cog"
              styleClass="wf-primario"
              [disabled]="p.bloccanti || p.numeroRecord === 0 || inCorso()"
              [loading]="inCorso()"
              (onClick)="genera()"
              data-testid="tracciato-genera"
            ></p-button>
          </span>
        </div>
        <p *ngIf="p.bloccanti" data-testid="tracciato-bloccanti">
          Ci sono avvisi bloccanti: correggili prima di generare il file.
        </p>
      </ng-container>

      <h3 class="section-title">Storico</h3>
      <p
        *ngIf="storico().length === 0"
        class="text-secondary"
        data-testid="tracciato-storico-vuoto"
      >
        Nessun file generato per questo periodo.
      </p>
      <ul class="m-0 pl-0 list-none" *ngIf="storico().length > 0">
        <li
          *ngFor="let c of storico()"
          class="flex flex-wrap align-items-center gap-2 mb-2"
          data-testid="tracciato-storico-riga"
        >
          <span>{{ c.generataIl | date: 'dd/MM/yyyy HH:mm' }}</span>
          <span class="cell-mono">{{ c.nomeFile }}</span>
          <p-tag
            [value]="c.stato === 'INVIATA' ? 'Inviata' : 'Generata'"
            [severity]="c.stato === 'INVIATA' ? 'success' : 'info'"
          ></p-tag>
          <p-tag
            *ngIf="daConfermareVista(c)"
            value="Da confermare"
            severity="warning"
            data-testid="tracciato-etichetta"
          ></p-tag>
          <span *ngIf="c.modificataDopoInvio" data-testid="tracciato-modificata"
            >Modificata dopo l'invio</span
          >
          <p-button
            label="Scarica file"
            icon="pi pi-download"
            [text]="true"
            (onClick)="scarica(c)"
            data-testid="tracciato-scarica"
          ></p-button>
          <p-button
            label="Scarica manifest"
            icon="pi pi-file"
            [text]="true"
            (onClick)="scaricaManifest(c)"
            data-testid="tracciato-manifest"
          ></p-button>
          <p-button
            *ngIf="anteprima()?.puoGenerare === true && c.stato === 'GENERATA'"
            label="Segna inviata"
            icon="pi pi-check"
            [text]="true"
            (onClick)="confermaInviata(c)"
            data-testid="tracciato-segna-inviata"
          ></p-button>
        </li>
      </ul>
    </section>
  `,
})
export class TracciatoConsorzioComponent implements OnChanges {
  private readonly tracciati = inject(TracciatiService)
  private readonly comunicazioni = inject(ComunicazioniService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)

  @Input({ required: true }) consorzio!: ConsorzioTracciato
  @Input({ required: true }) unitaLocaleId!: string

  readonly testoDaConfermare = TESTO_DA_CONFERMARE

  readonly da = signal(mesePrecedente().da)
  readonly a = signal(mesePrecedente().a)
  readonly anteprima = signal<AnteprimaTracciato | null>(null)
  readonly storico = signal<ComunicazioneTracciatoVista[]>([])
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  readonly daConfermareAnteprima = computed(() => daConfermare(this.anteprima()))

  private contatore = 0

  get nome(): string {
    return NOMI_CONSORZIO[this.consorzio]
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['unitaLocaleId'] || changes['consorzio']) this.carica()
  }

  link(a: AvvisoTracciato) {
    return linkCorrezione(a)
  }

  daConfermareVista(c: ComunicazioneTracciatoVista): boolean {
    return daConfermare(c)
  }

  scegliPeriodo(da: string, a: string): void {
    this.da.set(da)
    this.a.set(a)
    if (da && a) this.carica()
  }

  usaMesePrecedente(): void {
    const p = mesePrecedente()
    this.scegliPeriodo(p.da, p.a)
  }

  usaAnno(): void {
    const p = annoSolare(new Date().getFullYear())
    this.scegliPeriodo(p.da, p.a)
  }

  carica(): void {
    if (!this.unitaLocaleId) return
    const richiesta = ++this.contatore
    // Una risposta di una richiesta superata (sede o periodo cambiati nel frattempo) si scarta.
    const attuale = () => richiesta === this.contatore
    this.errore.set(null)
    this.tracciati.anteprima(this.consorzio, this.unitaLocaleId, this.da(), this.a()).subscribe({
      next: p => {
        if (attuale()) this.anteprima.set(p)
      },
      error: err => {
        if (!attuale()) return
        this.anteprima.set(null)
        this.errore.set(
          codiceErrore(err) === 'RICHIESTA_COMUNICAZIONE_NON_VALIDA'
            ? (err?.error?.details?.errori?.join(' ') ?? 'Periodo non valido.')
            : "Impossibile calcolare l'anteprima."
        )
      },
    })
    this.caricaStorico(attuale)
  }

  private caricaStorico(attuale: () => boolean = () => true): void {
    this.tracciati.storico(this.consorzio, this.unitaLocaleId, this.da(), this.a()).subscribe({
      next: s => {
        if (attuale()) this.storico.set(s)
      },
      error: () => {
        if (attuale()) this.errore.set('Impossibile caricare lo storico.')
      },
    })
  }

  genera(): void {
    const p = this.anteprima()
    if (!p || p.bloccanti || this.inCorso()) return
    this.inCorso.set(true)
    this.tracciati.genera(this.consorzio, this.unitaLocaleId, this.da(), this.a()).subscribe({
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

  /**
   * «Segna inviata»: per un tracciato da confermare serve la conferma esplicita «Ho verificato che
   * il consorzio accetta questo file» (Q2), registrata dal backend.
   */
  confermaInviata(c: ComunicazioneTracciatoVista): void {
    const verifica = daConfermare(c)
    this.conferma.confirm({
      key: this.consorzio,
      header: 'Segna come inviata',
      message: verifica
        ? `Il tracciato di «${c.nomeFile}» e ricavato da WinWaste e non e stato confermato con un file reale. Confermi di aver verificato che il consorzio accetta questo file?`
        : `Confermi di aver inviato «${c.nomeFile}»?`,
      acceptLabel: verifica
        ? 'Ho verificato che il consorzio accetta questo file'
        : 'Segna inviata',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      accept: () => this.segnaInviata(c, verifica),
    })
  }

  segnaInviata(c: ComunicazioneTracciatoVista, confermaVerifica: boolean): void {
    this.comunicazioni.segnaInviata(c.id, confermaVerifica ? true : undefined).subscribe({
      next: () => {
        this.toast.success('Comunicazione segnata come inviata')
        this.carica()
      },
      error: () => this.toast.error('Operazione non riuscita.'),
    })
  }

  scarica(c: ComunicazioneTracciatoVista): void {
    this.comunicazioni.scaricaFile(c.id).subscribe({
      next: f => this.salvaFile(f.blob, f.nomeFile ?? c.nomeFile),
      error: () => this.toast.error('Download non riuscito.'),
    })
  }

  scaricaManifest(c: ComunicazioneTracciatoVista): void {
    this.comunicazioni.scaricaManifest(c.id).subscribe({
      next: f => this.salvaFile(f.blob, f.nomeFile ?? `${c.nomeFile}.manifest.txt`),
      error: () => this.toast.error('Download non riuscito.'),
    })
  }

  private salvaFile(blob: Blob, nome: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nome
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
