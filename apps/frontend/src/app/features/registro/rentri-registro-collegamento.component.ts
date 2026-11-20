/**
 * Collegare o aprire il registro su RENTRI (eREGI E2, solo amministratori: la visibilità la decide
 * il dialog). Due strade oltre all'inserimento a mano:
 * - «Scegli dall'elenco»: i registri aperti sul portale per la sede del registro; il backend
 *   verifica che esistano, siano della sede e non chiusi.
 * - «Apri un nuovo registro»: attività (e codici R/D per Recupero e Smaltimento) e descrizione.
 *   L'apertura è irreversibile e non si ripete da sola: se RENTRI non conferma (202) si mostra
 *   l'avviso di NON riprovare, il backend cerca il registro aperto.
 * Gli errori del backend sono già in italiano e si mostrano così come arrivano.
 */
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { ToastService } from '../../core/services/toast.service'
import {
  ATTIVITA_REGISTRO_RENTRI,
  CandidatoRegistroRentri,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
  messaggioErroreRentri,
} from './rentri-registro.service'

type Modo = 'ELENCO' | 'APRI' | null

@Component({
  selector: 'app-rentri-registro-collegamento',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule],
  template: `
    <section aria-labelledby="rentri-col-titolo" data-testid="rentri-col">
      <h3 id="rentri-col-titolo" class="rentri-col-titolo">Registro su RENTRI</h3>

      <p *ngIf="registro.identificativoRentri" data-testid="rentri-col-attuale">
        Collegato al registro <strong>{{ registro.identificativoRentri }}</strong
        ><ng-container *ngIf="registro.rentriAttivita.length">
          ({{ registro.rentriAttivita.join(', ') }})</ng-container
        >.
      </p>
      <p
        *ngIf="registro.rentriChiusoIl"
        class="field-error"
        role="alert"
        data-testid="rentri-col-chiuso"
      >
        Questo registro risulta chiuso su RENTRI: non si trasmette più.
      </p>
      <p *ngIf="!registro.numIscrSito" class="field-hint" data-testid="rentri-col-senza-sede">
        Il registro non è legato a una sede con il numero di iscrizione RENTRI: aggiorna prima le
        unità locali dalle impostazioni RENTRI. Puoi comunque inserire l'identificativo a mano.
      </p>
      <p
        *ngIf="registro.aperturaInCorso && !registro.identificativoRentri"
        class="field-hint"
        role="status"
        data-testid="rentri-col-in-corso"
      >
        L'apertura su RENTRI è in corso o da verificare: non riprovare. Scegli il registro
        dall'elenco, oppure rifai «Apri» tra qualche minuto per far cercare il registro a WasteFlow.
      </p>

      <div *ngIf="registro.numIscrSito && !registro.identificativoRentri" class="rentri-col-scelte">
        <p-button
          label="Scegli dall'elenco di RENTRI"
          icon="pi pi-list"
          [outlined]="true"
          (onClick)="apriElenco()"
          data-testid="rentri-col-elenco"
          ariaLabel="Scegli il registro da collegare dall'elenco dei registri RENTRI"
        ></p-button>
        <p-button
          label="Apri un nuovo registro"
          icon="pi pi-plus"
          [outlined]="true"
          (onClick)="modo.set('APRI')"
          data-testid="rentri-col-apri-nuovo"
          ariaLabel="Apri un nuovo registro su RENTRI"
        ></p-button>
      </div>

      <div *ngIf="modo() === 'ELENCO'" data-testid="rentri-col-lista">
        <p *ngIf="caricamento()" role="status">Lettura dei registri da RENTRI…</p>
        <p
          *ngIf="!caricamento() && candidati().length === 0 && !errore()"
          data-testid="rentri-col-vuoto"
        >
          Nessun registro aperto su RENTRI per questa sede: aprine uno nuovo.
        </p>
        <ul class="rentri-col-elenco" *ngIf="candidati().length">
          <li
            *ngFor="let c of candidati()"
            [attr.data-testid]="'rentri-col-cand-' + c.identificativo"
          >
            <div>
              <strong>{{ c.identificativo }}</strong> {{ c.descrizione || '(senza descrizione)' }}
              <small class="field-hint"
                >{{ c.attivita.join(', ')
                }}<ng-container *ngIf="c.collegatoA">
                  · già collegato a un altro registro</ng-container
                ></small
              >
            </div>
            <p-button
              label="Collega"
              size="small"
              [disabled]="c.collegatoA !== null || lavoro()"
              (onClick)="collega(c.identificativo)"
              [attr.data-testid]="'rentri-col-collega-' + c.identificativo"
              [ariaLabel]="'Collega il registro ' + c.identificativo"
            ></p-button>
          </li>
        </ul>
      </div>

      <form
        *ngIf="modo() === 'APRI'"
        (ngSubmit)="chiediApertura()"
        data-testid="rentri-col-form-apri"
      >
        <fieldset class="rentri-col-fieldset">
          <legend>Attività del registro</legend>
          <label class="rentri-col-check" *ngFor="let a of attivitaElenco">
            <input
              type="checkbox"
              [name]="'att-' + a.valore"
              [checked]="attivita().includes(a.valore)"
              (change)="commutaAttivita(a.valore)"
              [attr.data-testid]="'rentri-col-att-' + a.valore"
            />
            {{ a.etichetta }}
          </label>
        </fieldset>
        <div class="field" *ngIf="serveCodici()">
          <label for="rentri-col-codici">Codici di recupero e smaltimento (R1-R13, D1-D15)</label>
          <input
            id="rentri-col-codici"
            type="text"
            pInputText
            class="w-full"
            [value]="codici()"
            (input)="codici.set($any($event.target).value)"
            placeholder="per esempio R13, D15"
            autocomplete="off"
            data-testid="rentri-col-codici"
          />
        </div>
        <div class="field">
          <label for="rentri-col-descrizione">Descrizione (facoltativa)</label>
          <input
            id="rentri-col-descrizione"
            type="text"
            pInputText
            class="w-full"
            maxlength="250"
            [value]="descrizione()"
            (input)="descrizione.set($any($event.target).value)"
            [placeholder]="registro.descrizione"
            autocomplete="off"
            data-testid="rentri-col-descrizione"
          />
        </div>

        <div *ngIf="!inConferma(); else conferma">
          <p-button
            type="submit"
            label="Apri su RENTRI…"
            icon="pi pi-check"
            [disabled]="attivita().length === 0"
            data-testid="rentri-col-apri-avvia"
            ariaLabel="Apri il registro su RENTRI"
          ></p-button>
        </div>
        <ng-template #conferma>
          <div
            class="rentri-col-conferma"
            role="alertdialog"
            aria-labelledby="rentri-col-conferma-testo"
            (keydown.escape)="inConferma.set(false); $event.stopPropagation()"
            data-testid="rentri-col-conferma"
          >
            <p id="rentri-col-conferma-testo">
              Apri un nuovo registro sul portale RENTRI per la sede di questo registro. L'apertura
              non si annulla da qui. Confermi?
            </p>
            <p-button
              label="Sì, apri"
              severity="danger"
              size="small"
              [loading]="lavoro()"
              (onClick)="apri()"
              data-testid="rentri-col-conferma-si"
              ariaLabel="Conferma l'apertura del registro su RENTRI"
            ></p-button>
            <p-button
              label="No"
              [text]="true"
              size="small"
              (onClick)="inConferma.set(false)"
              data-testid="rentri-col-conferma-no"
              ariaLabel="Annulla l'apertura"
            ></p-button>
          </div>
        </ng-template>
      </form>

      <p
        *ngIf="avviso() as a"
        role="status"
        class="rentri-col-avviso"
        data-testid="rentri-col-avviso"
      >
        {{ a }}
      </p>
      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rentri-col-errore">
        {{ e }}
      </p>
    </section>
  `,
  styles: [
    `
      .rentri-col-titolo {
        margin: 0 0 0.25rem;
        font-size: 1.05rem;
      }
      .rentri-col-scelte {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.5rem 0;
      }
      .rentri-col-elenco {
        list-style: none;
        margin: 0.5rem 0;
        padding: 0;
        display: grid;
        gap: 0.5rem;
      }
      .rentri-col-elenco li {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
      }
      .rentri-col-fieldset {
        border: 0;
        padding: 0;
        margin: 0 0 0.75rem;
      }
      .rentri-col-check {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .rentri-col-conferma {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
    `,
  ],
})
export class RentriRegistroCollegamentoComponent {
  private readonly servizio = inject(RentriRegistroService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) registro!: ImpostazioniRegistroRentri
  /** Il registro è stato collegato o aperto: il dialog e la pagina rileggono. */
  /** `true` = registro collegato o aperto (il dialog si chiude); `false` = solo da rileggere (esito incerto). */
  @Output() aggiornato = new EventEmitter<boolean>()

  readonly attivitaElenco = ATTIVITA_REGISTRO_RENTRI
  readonly modo = signal<Modo>(null)
  readonly candidati = signal<CandidatoRegistroRentri[]>([])
  readonly caricamento = signal(false)
  readonly lavoro = signal(false)
  readonly errore = signal<string | null>(null)
  readonly avviso = signal<string | null>(null)
  readonly inConferma = signal(false)
  readonly attivita = signal<string[]>([])
  readonly codici = signal('')
  readonly descrizione = signal('')

  serveCodici(): boolean {
    return this.attivita().includes('Recupero') || this.attivita().includes('Smaltimento')
  }

  commutaAttivita(valore: string): void {
    this.attivita.update(a => (a.includes(valore) ? a.filter(x => x !== valore) : [...a, valore]))
  }

  apriElenco(): void {
    this.modo.set('ELENCO')
    this.errore.set(null)
    this.avviso.set(null)
    this.caricamento.set(true)
    this.servizio.candidati(this.registro.registroId).subscribe({
      next: r => {
        this.candidati.set(r.candidati)
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.candidati.set([])
        this.errore.set(messaggioErroreRentri(err))
      },
    })
  }

  collega(identificativo: string): void {
    this.errore.set(null)
    this.lavoro.set(true)
    this.servizio.collega(this.registro.registroId, identificativo).subscribe({
      next: () => {
        this.lavoro.set(false)
        this.toast.success('Registro collegato a RENTRI.')
        this.modo.set(null)
        this.aggiornato.emit(true)
      },
      error: err => {
        this.lavoro.set(false)
        this.errore.set(messaggioErroreRentri(err))
      },
    })
  }

  chiediApertura(): void {
    this.errore.set(null)
    if (this.attivita().length === 0) return
    if (this.serveCodici() && this.codiciInseriti().length === 0) {
      this.errore.set('Per Recupero e Smaltimento indica almeno un codice (R1-R13, D1-D15).')
      return
    }
    this.inConferma.set(true)
  }

  private codiciInseriti(): string[] {
    return this.codici()
      .split(/[\s,;]+/)
      .map(c => c.trim().toUpperCase())
      .filter(c => c !== '')
  }

  apri(): void {
    this.errore.set(null)
    this.avviso.set(null)
    this.lavoro.set(true)
    const descrizione = this.descrizione().trim()
    this.servizio
      .apri(this.registro.registroId, {
        attivita: this.attivita(),
        attivitaRecSmalt: this.serveCodici() ? this.codiciInseriti() : [],
        ...(descrizione ? { descrizione } : {}),
      })
      .subscribe({
        next: esito => {
          this.lavoro.set(false)
          this.inConferma.set(false)
          if (esito.esito === 'INCERTO') {
            // Non riprovare: la POST potrebbe essere già andata a buon fine.
            this.avviso.set(esito.messaggio)
            this.aggiornato.emit(false)
            return
          }
          this.toast.success(
            esito.esito === 'APERTO'
              ? 'Registro aperto su RENTRI e collegato.'
              : 'Registro ritrovato su RENTRI e collegato.'
          )
          this.modo.set(null)
          this.aggiornato.emit(true)
        },
        error: err => {
          this.lavoro.set(false)
          this.inConferma.set(false)
          this.errore.set(messaggioErroreRentri(err))
        },
      })
  }
}
