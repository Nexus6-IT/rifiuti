import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ToastService } from '../../core/services/toast.service'
import { ConsorzioConfigurabile, erroriDaRisposta } from './dati-comunicazioni.model'
import { DatiComunicazioniService } from './dati-comunicazioni.service'

const TIPI_IMPIANTO_ORR = ['STO', 'SMA', 'REC', 'R/S', 'AUT', 'ROT', 'FRA']
const PRODOTTI_CONOU = ['A', 'B', 'C', 'E', 'G']
const PGF_COBAT = ['A', 'B', 'C', 'D', 'E']

interface RigaPredefinito {
  cer: string
  prodotto: string
  percentuale: string
}
interface RigaPgf {
  cer: string
  pgf: string
}

/** Solo le cifre del CER (`13 02 05*` -> `130205`). */
const soloCifre = (cer: string): string => cer.replace(/\D/g, '')

/**
 * Configurazione delle comunicazioni per sede propria e consorzio (4.9c-f, D4). Campi semplici per
 * ciascun consorzio; le mappe per CER (predefiniti CONOU, PGF COBAT) non si perdono salvando: si
 * conservano cosi' come sono. Lettura per tutti, scrittura ADMIN/OPERATOR.
 */
@Component({
  selector: 'app-configurazione-sede',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule],
  template: `
    <section
      class="configurazione-sede"
      data-testid="configurazione-sede"
      aria-labelledby="config-sede-titolo"
    >
      <h3 id="config-sede-titolo" class="section-title">
        Configurazione della sede per i consorzi
      </h3>
      <div class="campo">
        <label for="config-consorzio">Consorzio</label>
        <select
          id="config-consorzio"
          name="consorzio"
          [ngModel]="consorzio()"
          (ngModelChange)="scegli($event)"
        >
          <option *ngFor="let c of consorzi" [value]="c.value">{{ c.label }}</option>
        </select>
      </div>
      <p *ngIf="errore()" role="alert" data-testid="config-errore">{{ errore() }}</p>
      <ul *ngIf="erroriCampo().length > 0" role="alert" data-testid="config-errori-campo">
        <li *ngFor="let e of erroriCampo()">{{ e }}</li>
      </ul>
      <p *ngIf="caricata() && !salvata()" class="text-secondary" data-testid="config-predefiniti">
        Nessuna configurazione salvata: valgono i valori di partenza.
      </p>
      <form *ngIf="caricata()" (ngSubmit)="salva()" novalidate>
        <ng-container [ngSwitch]="consorzio()">
          <ng-container *ngSwitchCase="'CONOU'">
            <div class="campo">
              <label for="config-deposito">Codice deposito (3-10 caratteri)</label>
              <input
                pInputText
                id="config-deposito"
                name="deposito"
                [(ngModel)]="deposito"
                [disabled]="!puoModificare()"
                maxlength="10"
              />
            </div>
            <fieldset class="campo" data-testid="config-predefiniti-conou">
              <legend>Prodotto e percentuale di olio predefiniti per CER</legend>
              <div
                *ngFor="let r of predefiniti; let i = index"
                class="flex flex-wrap gap-2 mb-2"
                data-testid="config-predefinito-riga"
              >
                <input
                  pInputText
                  [name]="'pc-cer-' + i"
                  [(ngModel)]="r.cer"
                  [disabled]="!puoModificare()"
                  maxlength="8"
                  placeholder="CER (130205)"
                  [attr.aria-label]="'CER della riga ' + (i + 1)"
                />
                <select
                  [name]="'pc-prod-' + i"
                  [(ngModel)]="r.prodotto"
                  [disabled]="!puoModificare()"
                  [attr.aria-label]="'Prodotto della riga ' + (i + 1)"
                >
                  <option *ngFor="let p of prodotti" [value]="p">{{ p }}</option>
                </select>
                <input
                  pInputText
                  [name]="'pc-perc-' + i"
                  [(ngModel)]="r.percentuale"
                  [disabled]="!puoModificare()"
                  maxlength="5"
                  placeholder="% olio"
                  [attr.aria-label]="'Percentuale di olio della riga ' + (i + 1)"
                />
                <p-button
                  *ngIf="puoModificare()"
                  icon="pi pi-trash"
                  [text]="true"
                  severity="danger"
                  ariaLabel="Togli la riga"
                  (onClick)="togliPredefinito(i)"
                  data-testid="config-predefinito-togli"
                ></p-button>
              </div>
              <p-button
                *ngIf="puoModificare()"
                label="Aggiungi un CER"
                icon="pi pi-plus"
                [text]="true"
                (onClick)="aggiungiPredefinito()"
                data-testid="config-predefinito-aggiungi"
              ></p-button>
            </fieldset>
          </ng-container>
          <ng-container *ngSwitchCase="'COBAT'">
            <div class="campo">
              <label for="config-camp-codice">Campagna predefinita, codice (2 caratteri)</label>
              <input
                pInputText
                id="config-camp-codice"
                name="campCodice"
                [(ngModel)]="campagnaCodice"
                [disabled]="!puoModificare()"
                maxlength="2"
              />
            </div>
            <div class="campo">
              <label for="config-camp-desc">Campagna predefinita, descrizione</label>
              <input
                pInputText
                id="config-camp-desc"
                name="campDesc"
                [(ngModel)]="campagnaDescrizione"
                [disabled]="!puoModificare()"
                maxlength="30"
              />
            </div>
            <fieldset class="campo" data-testid="config-pgf-cobat">
              <legend>PGF / tipologia per CER</legend>
              <div
                *ngFor="let r of pgfRighe; let i = index"
                class="flex flex-wrap gap-2 mb-2"
                data-testid="config-pgf-riga"
              >
                <input
                  pInputText
                  [name]="'pgf-cer-' + i"
                  [(ngModel)]="r.cer"
                  [disabled]="!puoModificare()"
                  maxlength="8"
                  placeholder="CER (160601)"
                  [attr.aria-label]="'CER della riga ' + (i + 1)"
                />
                <select
                  [name]="'pgf-val-' + i"
                  [(ngModel)]="r.pgf"
                  [disabled]="!puoModificare()"
                  [attr.aria-label]="'PGF della riga ' + (i + 1)"
                >
                  <option *ngFor="let p of pgfValori" [value]="p">{{ p }}</option>
                </select>
                <p-button
                  *ngIf="puoModificare()"
                  icon="pi pi-trash"
                  [text]="true"
                  severity="danger"
                  ariaLabel="Togli la riga"
                  (onClick)="togliPgf(i)"
                  data-testid="config-pgf-togli"
                ></p-button>
              </div>
              <p-button
                *ngIf="puoModificare()"
                label="Aggiungi un CER"
                icon="pi pi-plus"
                [text]="true"
                (onClick)="aggiungiPgf()"
                data-testid="config-pgf-aggiungi"
              ></p-button>
            </fieldset>
          </ng-container>
          <div *ngSwitchCase="'ORSO'" class="campo">
            <label for="config-modalita">Modalità</label>
            <select
              id="config-modalita"
              name="modalita"
              [(ngModel)]="modalita"
              [disabled]="!puoModificare()"
            >
              <option value="NORMALE">Normale</option>
              <option value="DETTAGLIATA">Dettagliata</option>
            </select>
          </div>
          <ng-container *ngSwitchCase="'ORR'">
            <div class="campo">
              <label for="config-tipo-impianto">Tipo di impianto</label>
              <select
                id="config-tipo-impianto"
                name="tipoImpianto"
                [(ngModel)]="tipoImpianto"
                [disabled]="!puoModificare()"
              >
                <option value="">Non indicato</option>
                <option *ngFor="let t of tipiImpianto" [value]="t">{{ t }}</option>
              </select>
            </div>
            <div class="campo">
              <input
                type="checkbox"
                id="config-ateco-zero"
                name="atecoZero"
                [(ngModel)]="atecoZero"
                [disabled]="!puoModificare()"
              />
              <label for="config-ateco-zero">ATECO del produttore mancante scritto come zeri</label>
            </div>
            <div class="campo">
              <input
                type="checkbox"
                id="config-aut-pred"
                name="autPred"
                [(ngModel)]="autorizzazioniPredefinite"
                [disabled]="!puoModificare()"
              />
              <label for="config-aut-pred">Usa le autorizzazioni predefinite</label>
            </div>
          </ng-container>
        </ng-container>
        <p-button
          *ngIf="puoModificare()"
          label="Salva configurazione"
          icon="pi pi-check"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="salva()"
          data-testid="config-salva"
        />
      </form>
    </section>
  `,
})
export class ConfigurazioneSedeComponent implements OnChanges {
  private readonly servizio = inject(DatiComunicazioniService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) unitaLocaleId!: string

  readonly consorzi: ReadonlyArray<{ value: ConsorzioConfigurabile; label: string }> = [
    { value: 'CONOU', label: 'CONOU' },
    { value: 'COBAT', label: 'COBAT' },
    { value: 'ORSO', label: 'O.R.SO.' },
    { value: 'ORR', label: 'O.R.R. Campania' },
  ]
  readonly tipiImpianto = TIPI_IMPIANTO_ORR
  readonly prodotti = PRODOTTI_CONOU
  readonly pgfValori = PGF_COBAT

  readonly consorzio = signal<ConsorzioConfigurabile>('CONOU')
  readonly caricata = signal(false)
  readonly salvata = signal(false)
  readonly puoModificare = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  readonly erroriCampo = signal<string[]>([])

  deposito = ''
  campagnaCodice = ''
  campagnaDescrizione = ''
  modalita: 'NORMALE' | 'DETTAGLIATA' = 'NORMALE'
  tipoImpianto = ''
  atecoZero = false
  autorizzazioniPredefinite = false
  /** Mappe per CER in righe modificabili (CONOU: prodotto e percentuale; COBAT: PGF). */
  predefiniti: RigaPredefinito[] = []
  pgfRighe: RigaPgf[] = []
  /** Dati letti: i campi non mostrati (mappe per CER, autorizzazione) si conservano salvando. */
  private dati: Record<string, unknown> = {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['unitaLocaleId'] && this.unitaLocaleId) this.carica()
  }

  aggiungiPredefinito(): void {
    this.predefiniti = [...this.predefiniti, { cer: '', prodotto: 'A', percentuale: '' }]
  }

  togliPredefinito(i: number): void {
    this.predefiniti = this.predefiniti.filter((_, k) => k !== i)
  }

  aggiungiPgf(): void {
    this.pgfRighe = [...this.pgfRighe, { cer: '', pgf: 'A' }]
  }

  togliPgf(i: number): void {
    this.pgfRighe = this.pgfRighe.filter((_, k) => k !== i)
  }

  scegli(c: ConsorzioConfigurabile): void {
    this.consorzio.set(c)
    this.carica()
  }

  private carica(): void {
    this.errore.set(null)
    this.erroriCampo.set([])
    this.caricata.set(false)
    const c = this.consorzio()
    this.servizio.configurazione(this.unitaLocaleId, c).subscribe({
      next: r => {
        if (this.consorzio() !== c) return
        this.dati = r.dati
        this.salvata.set(r.salvata)
        this.puoModificare.set(r.puoModificare)
        this.deposito = String(r.dati['codiceDeposito'] ?? '')
        const camp = (r.dati['campagnaPredefinita'] ?? {}) as {
          codice?: string
          descrizione?: string
        }
        this.campagnaCodice = camp.codice ?? ''
        this.campagnaDescrizione = camp.descrizione ?? ''
        this.modalita = r.dati['modalita'] === 'DETTAGLIATA' ? 'DETTAGLIATA' : 'NORMALE'
        this.tipoImpianto = String(r.dati['tipoImpianto'] ?? '')
        this.atecoZero = r.dati['atecoProduttoreMancanteComeZero'] === true
        this.autorizzazioniPredefinite = r.dati['usaAutorizzazioniPredefinite'] === true
        this.predefiniti = Object.entries(
          (r.dati['predefinitiPerCer'] ?? {}) as Record<
            string,
            { prodotto?: string; percentualeOlio?: number }
          >
        ).map(([cer, v]) => ({
          cer,
          prodotto: v?.prodotto ?? 'A',
          percentuale: v?.percentualeOlio === undefined ? '' : String(v.percentualeOlio),
        }))
        this.pgfRighe = Object.entries((r.dati['pgfPerCer'] ?? {}) as Record<string, string>).map(
          ([cer, pgf]) => ({ cer, pgf })
        )
        this.caricata.set(true)
      },
      error: () => this.errore.set('Impossibile leggere la configurazione.'),
    })
  }

  /** I dati da salvare: quelli letti, con i soli campi mostrati sostituiti. */
  datiDaSalvare(): Record<string, unknown> {
    const d: Record<string, unknown> = { ...this.dati }
    const imposta = (k: string, v: string): void => {
      if (v.trim() === '') delete d[k]
      else d[k] = v.trim()
    }
    switch (this.consorzio()) {
      case 'CONOU': {
        imposta('codiceDeposito', this.deposito)
        const mappa: Record<string, { prodotto: string; percentualeOlio?: number }> = {}
        for (const r of this.predefiniti) {
          const cer = soloCifre(r.cer)
          if (cer === '') continue
          const perc = Number(r.percentuale.replace(',', '.'))
          mappa[cer] =
            r.percentuale.trim() === '' || !Number.isFinite(perc)
              ? { prodotto: r.prodotto }
              : { prodotto: r.prodotto, percentualeOlio: perc }
        }
        if (Object.keys(mappa).length > 0 || 'predefinitiPerCer' in d)
          d['predefinitiPerCer'] = mappa
        break
      }
      case 'COBAT': {
        d['campagnaPredefinita'] = {
          codice: this.campagnaCodice.trim(),
          descrizione: this.campagnaDescrizione.trim(),
        }
        const mappa: Record<string, string> = {}
        for (const r of this.pgfRighe) {
          const cer = soloCifre(r.cer)
          if (cer !== '') mappa[cer] = r.pgf
        }
        if (Object.keys(mappa).length > 0 || 'pgfPerCer' in d) d['pgfPerCer'] = mappa
        break
      }
      case 'ORSO':
        d['modalita'] = this.modalita
        break
      case 'ORR':
        imposta('tipoImpianto', this.tipoImpianto)
        d['atecoProduttoreMancanteComeZero'] = this.atecoZero
        d['usaAutorizzazioniPredefinite'] = this.autorizzazioniPredefinite
        break
    }
    return d
  }

  salva(): void {
    if (!this.caricata() || !this.puoModificare() || this.inCorso()) return
    this.inCorso.set(true)
    this.erroriCampo.set([])
    this.servizio
      .impostaConfigurazione(this.unitaLocaleId, this.consorzio(), this.datiDaSalvare())
      .subscribe({
        next: r => {
          this.inCorso.set(false)
          this.dati = r.dati
          this.salvata.set(true)
          this.toast.success('Configurazione salvata.')
        },
        error: err => {
          this.inCorso.set(false)
          const errori = erroriDaRisposta(err)
          this.erroriCampo.set(errori.length > 0 ? errori : ['Salvataggio non riuscito.'])
        },
      })
  }
}
