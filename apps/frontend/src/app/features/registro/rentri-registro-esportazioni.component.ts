/**
 * Esportazioni XML firmate del registro (eREGI E7): elenco, scarico, «Genera esportazione»,
 * «Riprova la validazione» e «Sostituisci da qui».
 *
 * Regole di presentazione:
 * - Un file è «Validato» solo quando RENTRI lo ha detto (`VALIDATA`, `VALIDATA_CON_AVVISI`):
 *   `GENERATA`, `IN_VALIDAZIONE` e `VALIDAZIONE_NON_DISPONIBILE` non si presentano mai come validi
 *   (un errore tecnico non è un rifiuto, e il rifiuto è solo `RIFIUTATA`).
 * - Generare e riprovare la validazione: chi può trasmettere (`puoGenerare`, dal backend).
 *   «Sostituisci da qui» è una decisione sulla catena dei file firmati: solo amministratori
 *   (`puoSostituire`), con conferma, e solo per una esportazione `RIFIUTATA`.
 * - La generazione automatica mensile è SPENTA di predefinito: l'elenco dice se è accesa
 *   (`automaticaAttiva`) e il testo non promette un file che nessuno sta producendo.
 * - Gli errori del backend (già in italiano) si mostrano verbatim; nessun dato dell'XML in pagina.
 */
import { Component, Input, OnChanges, OnInit, SimpleChanges, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { ToastService } from '../../core/services/toast.service'
import { messaggioErroreRentri } from './rentri-registro.service'
import {
  EsitoGenerazione,
  EsportazioneRegistro,
  RentriEsportazioniService,
  StatoEsportazione,
} from './rentri-esportazioni.service'

type Severita = 'success' | 'info' | 'warning' | 'danger' | 'secondary'

const ETICHETTE: Record<StatoEsportazione, string> = {
  GENERATA: 'Generata, da validare',
  IN_VALIDAZIONE: 'In validazione',
  VALIDATA: 'Validata',
  VALIDATA_CON_AVVISI: 'Validata con avvisi',
  RIFIUTATA: 'Rifiutata da RENTRI',
  VALIDAZIONE_NON_DISPONIBILE: 'Validazione non disponibile',
  SOSTITUITA: 'Sostituita',
}

const SEVERITA: Record<StatoEsportazione, Severita> = {
  GENERATA: 'secondary',
  IN_VALIDAZIONE: 'info',
  VALIDATA: 'success',
  VALIDATA_CON_AVVISI: 'warning',
  RIFIUTATA: 'danger',
  VALIDAZIONE_NON_DISPONIBILE: 'warning',
  SOSTITUITA: 'secondary',
}

const SPIEGAZIONI: Partial<Record<StatoEsportazione, string>> = {
  GENERATA: 'Il file è firmato e salvato; la validazione di RENTRI non è ancora partita.',
  IN_VALIDAZIONE: 'RENTRI sta ancora controllando il file.',
  VALIDAZIONE_NON_DISPONIBILE:
    'Non è stato possibile avere l’esito (problema tecnico, non un rifiuto): riprova la validazione.',
  RIFIUTATA:
    'RENTRI ha segnalato errori nel file. Le esportazioni successive restano ferme finché un amministratore non decide di sostituirla.',
}

/** Stati senza esito: si può riprovare la validazione. */
const SENZA_ESITO: readonly StatoEsportazione[] = [
  'GENERATA',
  'IN_VALIDAZIONE',
  'VALIDAZIONE_NON_DISPONIBILE',
]

@Component({
  selector: 'app-rentri-registro-esportazioni',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule],
  template: `
    <section aria-labelledby="rentri-esp-titolo" class="rentri-esp" data-testid="rentri-esp">
      <h3 id="rentri-esp-titolo" class="rentri-esp-titolo">Esportazioni XML del registro</h3>
      <p class="rentri-esp-nota">
        File XML firmato con il certificato RENTRI dell'azienda, validato da RENTRI e collegato ai
        precedenti: ogni file riparte dall'ultimo numero esportato.
      </p>
      <p class="rentri-esp-nota" data-testid="rentri-esp-automatica">
        <ng-container *ngIf="automaticaAttiva(); else manuale">
          La generazione mensile automatica è attiva: i mesi chiusi e confermati da RENTRI vengono
          esportati da soli.
        </ng-container>
        <ng-template #manuale>
          La generazione mensile automatica non è attiva: genera il file con «Genera esportazione».
        </ng-template>
      </p>

      <div class="rentri-esp-azioni" *ngIf="puoGenerare">
        <p-button
          label="Genera esportazione"
          icon="pi pi-file-export"
          [loading]="occupato()"
          [disabled]="occupato()"
          (onClick)="genera()"
          data-testid="rentri-esp-genera"
          ariaLabel="Genera la prossima esportazione XML del registro"
        ></p-button>
      </div>

      <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rentri-esp-errore">
        {{ e }}
      </p>

      <p
        *ngIf="caricato() && !errore() && esportazioni().length === 0"
        class="rentri-esp-nota"
        data-testid="rentri-esp-vuoto"
      >
        Nessuna esportazione ancora generata per questo registro.
      </p>

      <table
        *ngIf="esportazioni().length > 0"
        class="rentri-esp-tabella"
        aria-label="Esportazioni XML del registro"
      >
        <thead>
          <tr>
            <th scope="col">Anno</th>
            <th scope="col">Numeri</th>
            <th scope="col">Creata il</th>
            <th scope="col">Stato</th>
            <th scope="col">Impronta</th>
            <th scope="col"><span class="sr-only">Azioni</span></th>
          </tr>
        </thead>
        <tbody>
          <ng-container *ngFor="let e of esportazioni()">
            <tr
              [attr.data-testid]="'rentri-esp-riga-' + e.id"
              [class.rentri-esp-sostituita]="e.stato === 'SOSTITUITA'"
            >
              <td>{{ e.anno }}</td>
              <td>
                {{ e.progressivoDa }}–{{ e.progressivoA }}
                <small>({{ e.numeroRegistrazioni }})</small>
              </td>
              <td>{{ e.dataCreazione | date: 'dd/MM/yyyy HH:mm' }}</td>
              <td>
                <p-tag
                  [value]="etichetta(e.stato)"
                  [severity]="severita(e.stato)"
                  [attr.data-testid]="'rentri-esp-stato-' + e.id"
                ></p-tag>
              </td>
              <td>
                <code>{{ e.digestAbbreviato ?? '—' }}</code>
              </td>
              <td class="rentri-esp-riga-azioni">
                <p-button
                  label="Scarica XML"
                  icon="pi pi-download"
                  [text]="true"
                  size="small"
                  [disabled]="occupato()"
                  (onClick)="scarica(e)"
                  [attr.data-testid]="'rentri-esp-scarica-' + e.id"
                  [ariaLabel]="
                    'Scarica l\\'XML firmato dei numeri ' + e.progressivoDa + '-' + e.progressivoA
                  "
                ></p-button>
                <p-button
                  *ngIf="puoGenerare && eSenzaEsito(e)"
                  label="Riprova la validazione"
                  icon="pi pi-refresh"
                  [text]="true"
                  size="small"
                  [disabled]="occupato()"
                  (onClick)="rivalida(e)"
                  [attr.data-testid]="'rentri-esp-rivalida-' + e.id"
                  [ariaLabel]="
                    'Riprova la validazione dei numeri ' + e.progressivoDa + '-' + e.progressivoA
                  "
                ></p-button>
                <p-button
                  *ngIf="puoSostituire && e.stato === 'RIFIUTATA' && inConferma() !== e.id"
                  label="Sostituisci da qui"
                  icon="pi pi-replay"
                  [text]="true"
                  severity="danger"
                  size="small"
                  [disabled]="occupato()"
                  (onClick)="inConferma.set(e.id)"
                  [attr.data-testid]="'rentri-esp-sostituisci-' + e.id"
                  [ariaLabel]="
                    'Sostituisci da questa esportazione, numeri ' +
                    e.progressivoDa +
                    '-' +
                    e.progressivoA
                  "
                ></p-button>
              </td>
            </tr>
            <tr
              *ngIf="spiegazione(e.stato) || e.messaggi.length > 0 || inConferma() === e.id"
              class="rentri-esp-dettaglio"
            >
              <td colspan="6">
                <small *ngIf="spiegazione(e.stato) as s">{{ s }}</small>
                <ul
                  *ngIf="e.messaggi.length > 0"
                  class="rentri-esp-messaggi"
                  [attr.data-testid]="'rentri-esp-messaggi-' + e.id"
                  aria-label="Messaggi di RENTRI"
                >
                  <li *ngFor="let m of e.messaggi">
                    {{ m.tipo }}<ng-container *ngIf="m.codice"> {{ m.codice }}</ng-container
                    ><ng-container *ngIf="m.campo"> · {{ m.campo }}</ng-container>
                  </li>
                </ul>
                <div
                  *ngIf="inConferma() === e.id"
                  role="group"
                  (keydown.escape)="inConferma.set(null)"
                  class="rentri-esp-conferma"
                  [attr.aria-label]="
                    'Conferma della sostituzione dei numeri ' +
                    e.progressivoDa +
                    '-' +
                    e.progressivoA
                  "
                  [attr.data-testid]="'rentri-esp-sostituisci-conferma-' + e.id"
                >
                  Questa esportazione e le successive saranno segnate come sostituite (restano in
                  elenco) e la catena ripartirà dall'ultimo file valido. Il prossimo «Genera
                  esportazione» le rifarà. Procedere?
                  <p-button
                    label="Sostituisci"
                    size="small"
                    severity="danger"
                    [loading]="occupato()"
                    (onClick)="sostituisci(e)"
                    [attr.data-testid]="'rentri-esp-sostituisci-si-' + e.id"
                    ariaLabel="Conferma la sostituzione"
                  ></p-button>
                  <p-button
                    label="No"
                    [text]="true"
                    size="small"
                    (onClick)="inConferma.set(null)"
                    [attr.data-testid]="'rentri-esp-sostituisci-no-' + e.id"
                    ariaLabel="Annulla la sostituzione"
                  ></p-button>
                </div>
              </td>
            </tr>
          </ng-container>
        </tbody>
      </table>
    </section>
  `,
  styles: [
    `
      .rentri-esp {
        margin-top: 1rem;
      }
      .rentri-esp-titolo {
        margin: 0 0 0.5rem;
        font-size: 1rem;
      }
      .rentri-esp-nota {
        font-size: 0.85rem;
        color: var(--text-color-secondary);
        margin: 0.25rem 0;
      }
      .rentri-esp-azioni {
        margin: 0.5rem 0;
      }
      .rentri-esp-tabella {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.9rem;
      }
      .rentri-esp-tabella th,
      .rentri-esp-tabella td {
        text-align: left;
        padding: 0.35rem 0.5rem;
        border-bottom: 1px solid var(--surface-border);
        vertical-align: middle;
      }
      .rentri-esp-sostituita {
        opacity: 0.65;
      }
      .rentri-esp-riga-azioni {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .rentri-esp-messaggi {
        margin: 0.25rem 0 0;
        padding-left: 1.25rem;
      }
      .rentri-esp-conferma {
        margin-top: 0.25rem;
      }
    `,
  ],
})
export class RentriRegistroEsportazioniComponent implements OnInit, OnChanges {
  private readonly servizio = inject(RentriEsportazioniService)
  private readonly toast = inject(ToastService)

  @Input({ required: true }) registroId!: string
  /** Genera e riprova la validazione: chi può trasmettere a RENTRI (dal backend). */
  @Input() puoGenerare = false
  /** «Sostituisci da qui»: solo amministratori dell'azienda (dal backend). */
  @Input() puoSostituire = false

  readonly esportazioni = signal<EsportazioneRegistro[]>([])
  readonly automaticaAttiva = signal(false)
  readonly caricato = signal(false)
  readonly errore = signal<string | null>(null)
  readonly occupato = signal(false)
  /** Id dell'esportazione per cui è aperta la conferma di sostituzione. */
  readonly inConferma = signal<string | null>(null)

  etichetta = (s: StatoEsportazione): string => ETICHETTE[s]
  severita = (s: StatoEsportazione): Severita => SEVERITA[s]
  spiegazione = (s: StatoEsportazione): string | null => SPIEGAZIONI[s] ?? null
  eSenzaEsito = (e: EsportazioneRegistro): boolean => SENZA_ESITO.includes(e.stato)

  ngOnInit(): void {
    this.carica()
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['registroId'] && !changes['registroId'].firstChange) {
      // Nessun dato del registro precedente resta visibile mentre arriva quello nuovo.
      this.esportazioni.set([])
      this.caricato.set(false)
      this.inConferma.set(null)
      this.carica()
    }
  }

  carica(): void {
    const registroId = this.registroId
    this.servizio.elenco(registroId).subscribe({
      next: r => {
        // Risposta di un registro già lasciato: si scarta.
        if (registroId !== this.registroId) return
        this.esportazioni.set(r.esportazioni)
        this.automaticaAttiva.set(r.automaticaAttiva === true)
        this.errore.set(null)
        this.caricato.set(true)
      },
      error: err => {
        if (registroId !== this.registroId) return
        this.esportazioni.set([])
        this.errore.set(messaggioErroreRentri(err))
        this.caricato.set(true)
      },
    })
  }

  genera(): void {
    this.occupato.set(true)
    this.servizio.genera(this.registroId).subscribe({
      next: esito => {
        this.occupato.set(false)
        this.notificaGenerazione(esito)
        this.carica()
      },
      error: err => {
        this.occupato.set(false)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }

  private notificaGenerazione(esito: EsitoGenerazione): void {
    if (esito.esito === 'CREATA') {
      const n = esito.esportazione.numeroRegistrazioni
      const base = `Esportazione generata e firmata: ${n} ${n === 1 ? 'registrazione' : 'registrazioni'}.`
      if (esito.fermataA) {
        this.toast.warn(
          `${base} Si ferma al numero ${esito.fermataA.progressivo}: ${esito.fermataA.motivi.join(' ')}`
        )
      } else {
        this.toast.success(base)
      }
    } else if (esito.esito === 'BLOCCATA') {
      this.toast.warn(
        `Esportazione ferma al numero ${esito.progressivo} del ${esito.anno}: ${esito.motivi.join(' ')}`
      )
    } else {
      this.toast.info('Nessuna annotazione nuova da esportare.')
    }
  }

  scarica(e: EsportazioneRegistro): void {
    this.servizio.scarica(e.id).subscribe({
      next: f =>
        this.salva(
          f.blob,
          f.nomeFile ?? `registro_${e.anno}_${e.progressivoDa}-${e.progressivoA}.SignedR.xml`
        ),
      error: () => this.toast.error('Download non riuscito.'),
    })
  }

  /** Salva il blob con un link temporaneo (separato per i test). */
  protected salva(blob: Blob, nomeFile: string): void {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = nomeFile
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  rivalida(e: EsportazioneRegistro): void {
    this.occupato.set(true)
    this.servizio.rivalida(e.id).subscribe({
      next: r => {
        this.occupato.set(false)
        if (r.stato === 'VALIDATA' || r.stato === 'VALIDATA_CON_AVVISI') {
          this.toast.success(`RENTRI ha validato il file: ${ETICHETTE[r.stato].toLowerCase()}.`)
        } else if (r.stato === 'RIFIUTATA') {
          this.toast.warn('RENTRI ha rifiutato il file: guarda i messaggi nell’elenco.')
        } else {
          this.toast.info(`Esito non ancora disponibile (${ETICHETTE[r.stato].toLowerCase()}).`)
        }
        this.carica()
      },
      error: err => {
        this.occupato.set(false)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }

  sostituisci(e: EsportazioneRegistro): void {
    this.occupato.set(true)
    this.servizio.sostituisci(e.id).subscribe({
      next: r => {
        this.occupato.set(false)
        this.inConferma.set(null)
        this.toast.success(
          `${r.sostituite} ${r.sostituite === 1 ? 'esportazione sostituita' : 'esportazioni sostituite'}: la catena riparte dall'ultimo file valido.`
        )
        this.carica()
      },
      error: err => {
        this.occupato.set(false)
        this.inConferma.set(null)
        this.toast.error(messaggioErroreRentri(err))
      },
    })
  }
}
