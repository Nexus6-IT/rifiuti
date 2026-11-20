/**
 * Modificare e chiudere il registro su RENTRI (eREGI E3, solo amministratori: la visibilità la
 * decide il dialog). Compare solo per un registro collegato e non chiuso.
 * - Modifica: descrizione e codici R/D (solo per registri con Recupero o Smaltimento); la
 *   casella «forza» salva i codici anche se non coincidono con le autorizzazioni della sede.
 * - Chiusura: IRREVERSIBILE su RENTRI. Doppia conferma: un primo pulsante apre la conferma, il
 *   secondo si accende solo digitando per esteso l'identificativo del registro. Se ci sono
 *   annotazioni in volo o da trasmettere il backend risponde 409 con i conteggi (messaggio già
 *   in italiano, mostrato così com'è). Con la chiusura in corso (esito incerto) gli invii sono
 *   già fermi e la stessa richiesta si ripete in sicurezza.
 */
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ToastService } from '../../core/services/toast.service'
import {
  DatiModificaRegistroRentri,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
  messaggioErroreRentri,
} from './rentri-registro.service'

const normalizza = (v: string): string => v.trim().toUpperCase()

@Component({
  selector: 'app-rentri-registro-gestione',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule],
  template: `
    <section
      *ngIf="registro.identificativoRentri && !registro.rentriChiusoIl"
      aria-labelledby="rentri-gest-titolo"
      data-testid="rentri-gest"
    >
      <h3 id="rentri-gest-titolo" class="rentri-gest-titolo">Modifica e chiusura del registro</h3>

      <p
        *ngIf="registro.chiusuraInCorso"
        class="field-error"
        role="status"
        data-testid="rentri-gest-in-corso"
      >
        La chiusura su RENTRI è stata richiesta e non è ancora confermata: gli invii verso questo
        registro sono fermi. Ripeti «Chiudi il registro» per completarla.
      </p>

      <form
        *ngIf="!registro.chiusuraInCorso"
        (ngSubmit)="salva()"
        data-testid="rentri-gest-modifica"
      >
        <div class="field">
          <label for="rentri-gest-descrizione">Descrizione su RENTRI</label>
          <input
            id="rentri-gest-descrizione"
            name="descrizione"
            type="text"
            pInputText
            class="w-full"
            maxlength="250"
            [value]="descrizione()"
            (input)="descrizione.set($any($event.target).value)"
            autocomplete="off"
            data-testid="rentri-gest-descrizione"
          />
        </div>
        <div class="field" *ngIf="serveCodici()">
          <label for="rentri-gest-codici">Codici di recupero e smaltimento (R1-R13, D1-D15)</label>
          <input
            id="rentri-gest-codici"
            name="codici"
            type="text"
            pInputText
            class="w-full"
            [value]="codici()"
            (input)="codici.set($any($event.target).value)"
            autocomplete="off"
            data-testid="rentri-gest-codici"
          />
          <label class="rentri-gest-check">
            <input
              type="checkbox"
              name="forza"
              [checked]="forza()"
              (change)="forza.set(!forza())"
              data-testid="rentri-gest-forza"
            />
            Salva i codici anche se non coincidono con le autorizzazioni della sede
          </label>
        </div>
        <p-button
          type="submit"
          label="Salva le modifiche"
          icon="pi pi-save"
          [disabled]="!modificato() || lavoro()"
          [loading]="lavoro()"
          data-testid="rentri-gest-salva"
          ariaLabel="Salva le modifiche del registro su RENTRI"
        ></p-button>
      </form>

      <div class="rentri-gest-chiusura">
        <p-button
          *ngIf="!inConferma()"
          [label]="
            registro.chiusuraInCorso ? 'Ripeti la chiusura del registro' : 'Chiudi il registro…'
          "
          icon="pi pi-lock"
          severity="danger"
          [outlined]="true"
          (onClick)="inConferma.set(true)"
          data-testid="rentri-gest-chiudi"
          ariaLabel="Chiudi il registro su RENTRI"
        ></p-button>
        <div
          *ngIf="inConferma()"
          class="rentri-gest-conferma"
          role="alertdialog"
          aria-labelledby="rentri-gest-conferma-intro"
          (keydown.escape)="annulla(); $event.stopPropagation()"
          data-testid="rentri-gest-conferma"
        >
          <p id="rentri-gest-conferma-intro">
            La chiusura è <strong>irreversibile</strong>: dopo, RENTRI non accetta più annotazioni
            su questo registro e WasteFlow non ne trasmette più. Per confermare digita
            l'identificativo <strong>{{ registro.identificativoRentri }}</strong
            >.
          </p>
          <label for="rentri-gest-conferma-testo" class="rentri-gest-etichetta"
            >Identificativo del registro</label
          >
          <input
            id="rentri-gest-conferma-testo"
            name="conferma"
            type="text"
            pInputText
            [value]="conferma()"
            (input)="conferma.set($any($event.target).value)"
            autocomplete="off"
            data-testid="rentri-gest-conferma-testo"
          />
          <p-button
            label="Chiudi definitivamente"
            severity="danger"
            size="small"
            [disabled]="!confermaValida() || lavoro()"
            [loading]="lavoro()"
            (onClick)="chiudi()"
            data-testid="rentri-gest-conferma-si"
            ariaLabel="Chiudi definitivamente il registro su RENTRI"
          ></p-button>
          <p-button
            label="Annulla"
            [text]="true"
            size="small"
            (onClick)="annulla()"
            data-testid="rentri-gest-conferma-no"
            ariaLabel="Annulla la chiusura"
          ></p-button>
        </div>
      </div>

      <p *ngIf="avviso() as a" role="status" data-testid="rentri-gest-avviso">{{ a }}</p>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rentri-gest-errore">
        {{ e }}
      </p>
    </section>
  `,
  styles: [
    `
      .rentri-gest-titolo {
        margin: 0 0 0.25rem;
        font-size: 1.05rem;
      }
      .rentri-gest-check {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        margin-top: 0.5rem;
      }
      .rentri-gest-chiusura {
        margin-top: 1rem;
      }
      .rentri-gest-conferma {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
      .rentri-gest-etichetta {
        font-weight: 600;
      }
    `,
  ],
})
export class RentriRegistroGestioneComponent {
  private readonly servizio = inject(RentriRegistroService)
  private readonly toast = inject(ToastService)

  private _registro!: ImpostazioniRegistroRentri
  @Input({ required: true })
  set registro(r: ImpostazioniRegistroRentri) {
    this._registro = r
    this.descrizione.set(r.descrizione)
    this.codici.set(r.rentriAttivitaRecSmalt.join(', '))
  }
  get registro(): ImpostazioniRegistroRentri {
    return this._registro
  }

  /** `true` = modificato o chiuso (il dialog si chiude); `false` = esito incerto, solo da rileggere. */
  @Output() aggiornato = new EventEmitter<boolean>()

  readonly descrizione = signal('')
  readonly codici = signal('')
  readonly forza = signal(false)
  readonly conferma = signal('')
  readonly inConferma = signal(false)
  readonly lavoro = signal(false)
  readonly errore = signal<string | null>(null)
  readonly avviso = signal<string | null>(null)

  serveCodici(): boolean {
    const a = this.registro.rentriAttivita
    return a.includes('Recupero') || a.includes('Smaltimento')
  }

  private codiciInseriti(): string[] {
    return this.codici()
      .split(/[\s,;]+/)
      .map(c => c.trim().toUpperCase())
      .filter(c => c !== '')
  }

  private differenze(): DatiModificaRegistroRentri {
    const dati: DatiModificaRegistroRentri = {}
    const descrizione = this.descrizione().trim()
    if (descrizione !== '' && descrizione !== this.registro.descrizione) {
      dati.descrizione = descrizione
    }
    if (this.serveCodici()) {
      const attuali = [...this.registro.rentriAttivitaRecSmalt].sort().join('|')
      const nuovi = this.codiciInseriti()
      if (nuovi.length > 0 && [...nuovi].sort().join('|') !== attuali) {
        dati.attivitaRecSmalt = nuovi
        if (this.forza()) dati.forza = true
      }
    }
    return dati
  }

  modificato(): boolean {
    return Object.keys(this.differenze()).length > 0
  }

  confermaValida(): boolean {
    return normalizza(this.conferma()) === this.registro.identificativoRentri
  }

  salva(): void {
    const dati = this.differenze()
    if (Object.keys(dati).length === 0) return
    this.errore.set(null)
    this.avviso.set(null)
    this.lavoro.set(true)
    this.servizio.modifica(this.registro.registroId, dati).subscribe({
      next: esito => {
        this.lavoro.set(false)
        if (esito.esito === 'INCERTO') {
          this.avviso.set(esito.messaggio)
          this.aggiornato.emit(false)
          return
        }
        this.toast.success('Registro RENTRI modificato.')
        this.aggiornato.emit(true)
      },
      error: err => {
        this.lavoro.set(false)
        this.errore.set(messaggioErroreRentri(err))
      },
    })
  }

  annulla(): void {
    this.inConferma.set(false)
    this.conferma.set('')
  }

  chiudi(): void {
    if (!this.confermaValida()) return
    this.errore.set(null)
    this.avviso.set(null)
    this.lavoro.set(true)
    this.servizio.chiudi(this.registro.registroId, normalizza(this.conferma())).subscribe({
      next: esito => {
        this.lavoro.set(false)
        if (esito.esito === 'INCERTO') {
          this.avviso.set(esito.messaggio)
          this.annulla()
          this.aggiornato.emit(false)
          return
        }
        this.toast.success('Registro chiuso su RENTRI.')
        this.annulla()
        this.aggiornato.emit(true)
      },
      error: err => {
        this.lavoro.set(false)
        this.errore.set(messaggioErroreRentri(err))
      },
    })
  }
}
