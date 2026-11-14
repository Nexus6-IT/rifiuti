import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ToastService } from '../../core/services/toast.service'
import { ConsorzioConfigurabile, erroriDaRisposta } from './dati-comunicazioni.model'
import { DatiComunicazioniService } from './dati-comunicazioni.service'

const TIPI_IMPIANTO_ORR = ['STO', 'SMA', 'REC', 'R/S', 'AUT', 'ROT', 'FRA']

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
          <div *ngSwitchCase="'CONOU'" class="campo">
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
  /** Dati letti: i campi non mostrati (mappe per CER, autorizzazione) si conservano salvando. */
  private dati: Record<string, unknown> = {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['unitaLocaleId'] && this.unitaLocaleId) this.carica()
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
      case 'CONOU':
        imposta('codiceDeposito', this.deposito)
        break
      case 'COBAT':
        d['campagnaPredefinita'] = {
          codice: this.campagnaCodice.trim(),
          descrizione: this.campagnaDescrizione.trim(),
        }
        break
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
