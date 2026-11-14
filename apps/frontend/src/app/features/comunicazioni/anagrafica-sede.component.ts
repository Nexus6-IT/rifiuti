import { Component, Input, OnChanges, SimpleChanges, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ToastService } from '../../core/services/toast.service'
import {
  InputAnagraficaComunicazioni,
  MOTIVI_ISTAT,
  RisoluzioneIstat,
  erroriDaRisposta,
} from './dati-comunicazioni.model'
import { DatiComunicazioniService } from './dati-comunicazioni.service'

interface Modulo {
  eComune: boolean
  codiceIstatComune: string
  codiceAteco: string
  codiceOrso: string
  alboDataIscrizione: string
  alboClassi: string
  autorizzazioneData: string
  legaleRappresentanteCognome: string
  legaleRappresentanteNome: string
  esclusaOrr: boolean
}

const vuoto = (s: string | null | undefined): string => s ?? ''
const nullo = (s: string): string | null => (s.trim() === '' ? null : s.trim())

/**
 * Dati di una sede ditta per le comunicazioni ai consorzi (4.9c-f, D3): ATECO, ISTAT, codice ARPA,
 * Albo, autorizzazione, legale rappresentante, esclusione O.R.R. Va nella scheda della sede,
 * dietro il modulo `comunicazioni`. Lettura per tutti, scrittura ADMIN/OPERATOR (lo dice il backend
 * con `puoModificare`).
 */
@Component({
  selector: 'app-anagrafica-sede',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule],
  template: `
    <section
      class="anagrafica-sede"
      data-testid="anagrafica-sede"
      aria-labelledby="anagrafica-sede-titolo"
    >
      <h4 id="anagrafica-sede-titolo" class="section-title">
        Dati per le comunicazioni ai consorzi
      </h4>
      <p *ngIf="errore()" role="alert" data-testid="anagrafica-errore">{{ errore() }}</p>
      <ul *ngIf="erroriCampo().length > 0" role="alert" data-testid="anagrafica-errori-campo">
        <li *ngFor="let e of erroriCampo()">{{ e }}</li>
      </ul>
      <div *ngIf="modulo() as m" class="anagrafica-sede__campi">
        <div class="campo">
          <label for="ana-ateco">Codice ATECO</label>
          <input
            pInputText
            id="ana-ateco"
            name="ateco"
            [(ngModel)]="m.codiceAteco"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            placeholder="NN.NN.NN"
          />
        </div>
        <div class="campo">
          <label for="ana-istat">Codice ISTAT del comune (forzatura)</label>
          <input
            pInputText
            id="ana-istat"
            name="istat"
            [(ngModel)]="m.codiceIstatComune"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            maxlength="6"
          />
          <small data-testid="anagrafica-istat">{{ testoIstat() }}</small>
        </div>
        <div class="campo">
          <label for="ana-orso">Codice ARPA dell’impianto (O.R.SO.)</label>
          <input
            pInputText
            id="ana-orso"
            name="orso"
            [(ngModel)]="m.codiceOrso"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            maxlength="9"
          />
          <small data-testid="anagrafica-orso-aiuto">
            Serve alla modalità dettagliata di O.R.SO.: con il codice ARPA la sede è un impianto
            noto; senza, è descritta nel file come nuovo impianto. L’elenco ARPA non si importa: il
            codice si inserisce a mano.
          </small>
        </div>
        <div class="campo">
          <input
            type="checkbox"
            id="ana-comune"
            name="eComune"
            [(ngModel)]="m.eComune"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
          />
          <label for="ana-comune">La sede è di un comune</label>
        </div>
        <div class="campo">
          <label for="ana-albo-data">Data di iscrizione all’Albo</label>
          <input
            pInputText
            id="ana-albo-data"
            name="alboData"
            type="date"
            [(ngModel)]="m.alboDataIscrizione"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
          />
        </div>
        <div class="campo">
          <label for="ana-albo-classi">Classi dell’Albo</label>
          <input
            pInputText
            id="ana-albo-classi"
            name="alboClassi"
            [(ngModel)]="m.alboClassi"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            maxlength="30"
          />
        </div>
        <div class="campo">
          <label for="ana-aut-data">Data dell’autorizzazione</label>
          <input
            pInputText
            id="ana-aut-data"
            name="autData"
            type="date"
            [(ngModel)]="m.autorizzazioneData"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
          />
        </div>
        <div class="campo">
          <label for="ana-cognome">Legale rappresentante, cognome</label>
          <input
            pInputText
            id="ana-cognome"
            name="cognome"
            [(ngModel)]="m.legaleRappresentanteCognome"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            maxlength="25"
          />
        </div>
        <div class="campo">
          <label for="ana-nome">Legale rappresentante, nome</label>
          <input
            pInputText
            id="ana-nome"
            name="nome"
            [(ngModel)]="m.legaleRappresentanteNome"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
            maxlength="25"
          />
        </div>
        <div class="campo">
          <input
            type="checkbox"
            id="ana-esclusa"
            name="esclusaOrr"
            [(ngModel)]="m.esclusaOrr"
            [ngModelOptions]="{ standalone: true }"
            [disabled]="!puoModificare()"
          />
          <label for="ana-esclusa">Non includere questa sede nei file O.R.R.</label>
        </div>
        <p-button
          *ngIf="puoModificare()"
          label="Salva dati comunicazioni"
          icon="pi pi-check"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="salva()"
          data-testid="anagrafica-salva"
        />
      </div>
    </section>
  `,
})
export class AnagraficaSedeComponent implements OnChanges {
  private readonly servizio = inject(DatiComunicazioniService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) sedeDittaId!: string

  readonly modulo = signal<Modulo | null>(null)
  readonly puoModificare = signal(false)
  readonly inCorso = signal(false)
  readonly errore = signal<string | null>(null)
  readonly erroriCampo = signal<string[]>([])
  private readonly istat = signal<RisoluzioneIstat | null>(null)

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['sedeDittaId'] || !this.sedeDittaId) return
    this.errore.set(null)
    this.erroriCampo.set([])
    this.servizio.anagraficaSede(this.sedeDittaId).subscribe({
      next: r => {
        const a = r.anagrafica
        this.puoModificare.set(r.puoModificare)
        this.istat.set(r.istat)
        this.modulo.set({
          eComune: a.eComune,
          codiceIstatComune: vuoto(a.codiceIstatComune),
          codiceAteco: vuoto(a.codiceAteco),
          codiceOrso: vuoto(a.codiceOrso),
          alboDataIscrizione: vuoto(a.alboDataIscrizione),
          alboClassi: vuoto(a.alboClassi),
          autorizzazioneData: vuoto(a.autorizzazioneData),
          legaleRappresentanteCognome: vuoto(a.legaleRappresentanteCognome),
          legaleRappresentanteNome: vuoto(a.legaleRappresentanteNome),
          esclusaOrr: a.esclusaOrr,
        })
      },
      error: () => this.errore.set('Impossibile leggere i dati per le comunicazioni.'),
    })
  }

  testoIstat(): string {
    const r = this.istat()
    if (!r) return ''
    return r.codice === null
      ? (MOTIVI_ISTAT[r.motivo] ?? '')
      : `ISTAT in uso: ${r.codice} (${r.origine === 'FORZATO' ? 'forzato' : 'dal nome del comune'})`
  }

  salva(): void {
    const m = this.modulo()
    if (!m || !this.puoModificare() || this.inCorso()) return
    const input: InputAnagraficaComunicazioni = {
      eComune: m.eComune,
      codiceIstatComune: nullo(m.codiceIstatComune),
      codiceAteco: nullo(m.codiceAteco),
      codiceOrso: nullo(m.codiceOrso),
      alboDataIscrizione: nullo(m.alboDataIscrizione),
      alboClassi: nullo(m.alboClassi),
      autorizzazioneData: nullo(m.autorizzazioneData),
      legaleRappresentanteCognome: nullo(m.legaleRappresentanteCognome),
      legaleRappresentanteNome: nullo(m.legaleRappresentanteNome),
      esclusaOrr: m.esclusaOrr,
    }
    this.inCorso.set(true)
    this.erroriCampo.set([])
    this.servizio.impostaAnagraficaSede(this.sedeDittaId, input).subscribe({
      next: () => {
        this.inCorso.set(false)
        this.toast.success('Dati per le comunicazioni salvati.')
        // L'ISTAT risolto dipende dalla forzatura appena salvata: si rilegge.
        this.ngOnChanges({ sedeDittaId: {} as never })
      },
      error: err => {
        this.inCorso.set(false)
        const errori = erroriDaRisposta(err)
        this.erroriCampo.set(errori.length > 0 ? errori : ['Salvataggio non riuscito.'])
      },
    })
  }
}
