import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { RouterModule } from '@angular/router'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { RadioButtonModule } from 'primeng/radiobutton'
import { DropdownModule } from 'primeng/dropdown'
import { ToastService } from '../../core/services/toast.service'
import { AuthService } from '../../core/services/auth.service'
import { FirService } from '../fir/fir.service'
import { FIR } from '../../shared/models/fir.model'
import {
  RentriFormulariService,
  FormularioTrovato,
  ModalitaAggancio,
} from './rentri-formulari.service'

/** Stessi ruoli abilitati dal backend (`RentriFormulariController`, `@Roles(...)`). */
const RENTRI_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATOR']

/**
 * Quanti FIR locali (senza `rentriNumeroFir`) offrire nel selettore del ramo
 * "collega a un formulario esistente". Scelta di scope per questa fase: nessun
 * endpoint dedicato lato backend restituisce solo i FIR ancora liberi (il
 * filtro non esiste su `GET /fir`), quindi il filtro è applicato qui, sul
 * client, su una singola pagina ragionevolmente ampia. Un tenant con più FIR
 * "liberi" di questo numero è un'estensione futura (paginazione/ricerca nel
 * selettore), non necessaria per il valore che questo task deve consegnare.
 *
 * IL LIMITE NON RESTA SILENZIOSO: quando i FIR dell'azienda superano questa
 * soglia, il selettore lo DICE (`firLiberiTroncati`). Un elenco troncato senza
 * avviso farebbe concludere all'utente che il formulario cercato non esiste,
 * quando invece esiste e non è stato caricato — l'errore peggiore, perché porta
 * a rifare a mano un lavoro già fatto. Dichiararlo costa una riga di testo.
 */
const FIR_LIBERI_PAGE_SIZE = 200

type StatoRiga = 'GIA_NEL_GESTIONALE' | 'DA_AGGANCIARE' | 'IN_CORSO'

/**
 * Area RENTRI — ricerca e aggancio dei formulari (R2 Task 8).
 *
 * Coerente col principio di design del programma: la ricerca vive qui,
 * nell'area RENTRI (è l'unica cosa che non appartiene a un singolo
 * formulario), ma l'ESITO dell'aggancio atterra dove l'utente già lavora — la
 * lista/il dettaglio FIR — non in una vista RENTRI parallela che duplichi il
 * portale. Questa pagina, di conseguenza, non mostra nessun dettaglio
 * completo del formulario: solo ciò che serve a decidere se e come agganciarlo.
 */
@Component({
  selector: 'app-rentri-formulari',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    TableModule,
    TagModule,
    DialogModule,
    RadioButtonModule,
    DropdownModule,
  ],
  template: `
    <div class="page" style="max-width: 1100px;">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Formulari da agganciare</h1>
          <p class="page-subtitle">
            Formulari RENTRI in cui compari, anche se creati da un'altra controparte
          </p>
        </div>
        <a
          routerLink="/rentri/sedi"
          class="rentri-cross-link"
          data-testid="rentri-formulari-sedi-link"
          >Sedi RENTRI</a
        >
      </header>

      <!-- Ruolo non abilitato: stessa policy del backend (SUPER_ADMIN/ADMIN/OPERATOR) -->
      <section
        *ngIf="!isAutorizzato()"
        class="surface-card"
        data-testid="rentri-formulari-non-autorizzato"
      >
        <div class="empty-state">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato</span>
          <p>Il tuo ruolo non consente di cercare o agganciare formulari RENTRI.</p>
        </div>
      </section>

      <ng-container *ngIf="isAutorizzato()">
        <section class="surface-card mb-4" aria-label="Ricerca formulari">
          <div class="ricerca-row">
            <div class="field ricerca-field">
              <label for="rentri-formulari-cf">Codice fiscale usato per la ricerca</label>
              <input
                id="rentri-formulari-cf"
                pInputText
                class="w-full"
                value="Il codice fiscale già configurato per l'azienda"
                disabled
                data-testid="rentri-formulari-search-input"
                aria-describedby="rentri-formulari-cf-hint"
              />
              <small id="rentri-formulari-cf-hint" class="text-tertiary">
                La ricerca usa sempre il codice fiscale dell'azienda: non c'è nulla da digitare.
              </small>
            </div>
            <p-button
              label="Cerca formulari"
              icon="pi pi-search"
              [loading]="loading()"
              (onClick)="cerca()"
              data-testid="rentri-formulari-cerca-button"
            ></p-button>
          </div>
        </section>

        <div
          *ngIf="loading()"
          class="flex align-items-center gap-2 text-secondary"
          data-testid="rentri-formulari-loading"
        >
          <i class="pi pi-spin pi-spinner" aria-hidden="true"></i>
          <span>Ricerca in corso…</span>
        </div>

        <section *ngIf="errore() && !loading()" class="surface-card" role="alert">
          <div class="empty-state" data-testid="rentri-formulari-errore">
            <i
              class="pi pi-exclamation-triangle empty-state__icon"
              style="color: var(--color-danger);"
              aria-hidden="true"
            ></i>
            <p class="empty-state__title">Impossibile completare la ricerca</p>
            <p>{{ errore() }}</p>
          </div>
        </section>

        <section
          *ngIf="!loading() && !errore() && ricercaEseguita() && risultati().length === 0"
          class="surface-card"
          data-testid="rentri-formulari-empty-state"
        >
          <div class="empty-state">
            <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
            <span class="empty-state__title">Nessun formulario trovato</span>
            <p>Non risulta nessun formulario RENTRI in cui l'azienda compaia come soggetto.</p>
          </div>
        </section>

        <section
          *ngIf="!loading() && !errore() && risultati().length > 0"
          class="surface-card"
          aria-label="Risultati ricerca formulari RENTRI"
        >
          <p-table [value]="risultati()" dataKey="numeroFir" data-testid="rentri-formulari-table">
            <ng-template pTemplate="header">
              <tr>
                <th>Numero FIR</th>
                <th>Soggetto coinvolto</th>
                <th>Rifiuto</th>
                <th>Stato</th>
                <th></th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-formulario>
              <tr [attr.data-testid]="'rentri-formulari-row-' + formulario.numeroFir">
                <td class="cell-mono">{{ formulario.numeroFir }}</td>
                <td>{{ formulario.identificativoSoggetto || 'N/D' }}</td>
                <td>{{ formulario.descrizioneRifiuto || formulario.codiceEer || 'N/D' }}</td>
                <td>
                  <p-tag
                    [severity]="statoRigaSeverity(formulario)"
                    [value]="statoRigaLabel(formulario)"
                    [attr.data-testid]="'rentri-formulari-status-' + formulario.numeroFir"
                  ></p-tag>
                </td>
                <td>
                  <p-button
                    label="Aggancia"
                    icon="pi pi-link"
                    size="small"
                    [disabled]="formulario.giaAgganciatoLocalmente || agganciando() !== null"
                    [loading]="agganciando() === formulario.numeroFir"
                    (onClick)="apriDialogAggancio(formulario)"
                    [attr.data-testid]="'rentri-formulari-aggancia-' + formulario.numeroFir"
                  ></p-button>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </section>
      </ng-container>
    </div>

    <!-- Dialog di aggancio: due modalità come scelta esplicita, nessun default -->
    <p-dialog
      [(visible)]="dialogVisibile"
      [modal]="true"
      [draggable]="false"
      [style]="{ width: '32rem' }"
      header="Aggancia formulario"
      [dismissableMask]="true"
      appendTo="body"
      data-testid="rentri-formulari-confirm-dialog"
    >
      <div *ngIf="formularioSelezionato() as f" class="dialog-body">
        <p>
          Formulario <strong class="cell-mono">{{ f.numeroFir }}</strong
          >: come vuoi agganciarlo?
        </p>

        <div class="modalita-option">
          <p-radioButton
            name="modalitaAggancio"
            inputId="modalita-nuovo"
            value="NUOVO"
            [(ngModel)]="modalitaScelta"
            data-testid="rentri-formulari-confirm-dialog-modalita-nuovo"
          ></p-radioButton>
          <label for="modalita-nuovo">
            Crea un nuovo formulario nel gestionale
            <small class="block text-tertiary">
              I dati (produttore, trasportatore, destinatario, rifiuto) vengono importati dal
              dettaglio RENTRI come istantanea, non aggiornata in seguito.
            </small>
          </label>
        </div>

        <div class="modalita-option">
          <p-radioButton
            name="modalitaAggancio"
            inputId="modalita-esistente"
            value="ESISTENTE"
            [(ngModel)]="modalitaScelta"
            (ngModelChange)="onModalitaEsistenteScelta()"
            data-testid="rentri-formulari-confirm-dialog-modalita-esistente"
          ></p-radioButton>
          <label for="modalita-esistente">
            Collega a un formulario già presente
            <small class="block text-tertiary">
              Completa un FIR che hai già nel gestionale (es. una bozza) con il numero ufficiale
              RENTRI, senza sovrascrivere i dati che hai già inserito.
            </small>
          </label>
        </div>

        <div class="field mt-3" *ngIf="modalitaScelta === 'ESISTENTE'">
          <label for="fir-locale-select">FIR locale a cui collegare *</label>
          <p-dropdown
            inputId="fir-locale-select"
            [options]="firLiberi()"
            optionLabel="label"
            optionValue="id"
            [(ngModel)]="firLocaleSelezionato"
            [loading]="caricandoFirLiberi()"
            placeholder="Seleziona un FIR locale"
            [style]="{ width: '100%' }"
            appendTo="body"
            data-testid="rentri-formulari-confirm-dialog-fir-locale-select"
          ></p-dropdown>
          <small *ngIf="!caricandoFirLiberi() && firLiberi().length === 0" class="text-tertiary">
            Non ci sono FIR locali ancora liberi (senza numero RENTRI) a cui collegarlo: crealo come
            nuovo formulario.
          </small>
          <small
            *ngIf="!caricandoFirLiberi() && firLiberiTroncati()"
            class="text-tertiary"
            data-testid="rentri-formulari-confirm-dialog-fir-locali-troncati"
          >
            L'elenco mostra solo i formulari piu' recenti dell'azienda. Se quello che cerchi non
            compare, potrebbe essere piu' vecchio: agganciarlo come nuovo formulario creerebbe un
            doppione, quindi verificalo prima nella lista dei FIR.
          </small>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          (onClick)="chiudiDialog()"
          data-testid="rentri-formulari-confirm-dialog-cancel-button"
        ></p-button>
        <p-button
          label="Aggancia"
          icon="pi pi-link"
          [loading]="agganciando() !== null"
          [disabled]="!puoConfermareAggancio()"
          (onClick)="confermaAggancio()"
          data-testid="rentri-formulari-confirm-dialog-confirm-button"
        ></p-button>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .rentri-cross-link {
        align-self: center;
        font-size: var(--font-size-sm);
      }
      .ricerca-row {
        display: flex;
        align-items: flex-end;
        gap: var(--spacing-base);
        flex-wrap: wrap;
      }
      .ricerca-field {
        flex: 1;
        min-width: 260px;
      }
      .field label {
        display: block;
        margin-bottom: var(--spacing-xs);
      }
      .text-secondary {
        color: var(--text-secondary);
      }
      .text-tertiary {
        color: var(--text-tertiary);
      }
      .cell-mono {
        font-family: var(--font-family-mono);
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mt-3 {
        margin-top: var(--spacing-base);
      }
      .dialog-body {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-base);
      }
      .modalita-option {
        display: flex;
        gap: var(--spacing-sm);
        align-items: flex-start;
      }
    `,
  ],
})
export class RentriFormulariComponent implements OnInit {
  private readonly rentriFormulariService = inject(RentriFormulariService)
  private readonly firService = inject(FirService)
  private readonly auth = inject(AuthService)
  private readonly toast = inject(ToastService)

  readonly isAutorizzato = computed(() => {
    const role = this.auth.currentUser()?.role
    return !!role && RENTRI_ROLES.includes(role)
  })

  readonly loading = signal(false)
  readonly errore = signal<string | null>(null)
  readonly ricercaEseguita = signal(false)
  readonly risultati = signal<FormularioTrovato[]>([])
  /** Numero FIR il cui aggancio è attualmente in corso (nessun altro pulsante deve reagire nel frattempo). */
  readonly agganciando = signal<string | null>(null)

  readonly dialogVisibile = signal(false)
  readonly formularioSelezionato = signal<FormularioTrovato | null>(null)
  /** null: nessuna scelta ancora fatta — mai un default silenzioso fra le due modalità. */
  modalitaScelta: 'NUOVO' | 'ESISTENTE' | null = null
  firLocaleSelezionato: string | null = null
  readonly caricandoFirLiberi = signal(false)
  readonly firLiberi = signal<{ id: string; label: string }[]>([])
  /** Vero quando i FIR dell'azienda superano la pagina caricata: il selettore lo dichiara. */
  readonly firLiberiTroncati = signal(false)

  ngOnInit(): void {
    if (this.isAutorizzato()) {
      this.cerca()
    }
  }

  cerca(): void {
    this.loading.set(true)
    this.errore.set(null)
    this.rentriFormulariService.cerca().subscribe({
      next: esito => {
        this.risultati.set(esito.risultati)
        this.ricercaEseguita.set(true)
        this.loading.set(false)
      },
      error: err => {
        this.errore.set(this.extractError(err, 'Errore nella ricerca dei formulari RENTRI'))
        this.ricercaEseguita.set(true)
        this.loading.set(false)
      },
    })
  }

  statoRiga(formulario: FormularioTrovato): StatoRiga {
    if (this.agganciando() === formulario.numeroFir) return 'IN_CORSO'
    if (formulario.giaAgganciatoLocalmente) return 'GIA_NEL_GESTIONALE'
    return 'DA_AGGANCIARE'
  }

  statoRigaLabel(formulario: FormularioTrovato): string {
    const labels: Record<StatoRiga, string> = {
      GIA_NEL_GESTIONALE: 'Già nel gestionale',
      DA_AGGANCIARE: 'Da agganciare',
      IN_CORSO: 'In corso',
    }
    return labels[this.statoRiga(formulario)]
  }

  statoRigaSeverity(formulario: FormularioTrovato): 'success' | 'info' | 'warning' | 'secondary' {
    const severityMap: Record<StatoRiga, 'success' | 'info' | 'warning' | 'secondary'> = {
      GIA_NEL_GESTIONALE: 'success',
      DA_AGGANCIARE: 'info',
      IN_CORSO: 'warning',
    }
    return severityMap[this.statoRiga(formulario)]
  }

  apriDialogAggancio(formulario: FormularioTrovato): void {
    this.formularioSelezionato.set(formulario)
    this.modalitaScelta = null
    this.firLocaleSelezionato = null
    this.firLiberi.set([])
    this.firLiberiTroncati.set(false)
    this.dialogVisibile.set(true)
  }

  chiudiDialog(): void {
    this.dialogVisibile.set(false)
    this.formularioSelezionato.set(null)
  }

  onModalitaEsistenteScelta(): void {
    if (this.firLiberi().length > 0 || this.caricandoFirLiberi()) return
    this.caricandoFirLiberi.set(true)
    this.firService.getFIRList(1, FIR_LIBERI_PAGE_SIZE).subscribe({
      next: pagina => {
        // `total` conta TUTTI i FIR dell'azienda, non solo quelli liberi: se
        // supera la pagina caricata, esistono formulari che questo selettore
        // non ha visto e non puo' escludere.
        this.firLiberiTroncati.set((pagina.total ?? 0) > FIR_LIBERI_PAGE_SIZE)
        this.firLiberi.set(
          pagina.items
            .filter((fir: FIR) => !fir.rentriNumeroFir)
            .map((fir: FIR) => ({
              id: fir.id,
              label: `${fir.numeroProgressivo || fir.id} — ${fir.produttore?.ragioneSociale || 'N/D'}`,
            }))
        )
        this.caricandoFirLiberi.set(false)
      },
      error: () => {
        this.caricandoFirLiberi.set(false)
        this.toast.error('Impossibile caricare i FIR locali ancora liberi')
      },
    })
  }

  puoConfermareAggancio(): boolean {
    if (this.agganciando() !== null) return false
    if (this.modalitaScelta === 'NUOVO') return true
    if (this.modalitaScelta === 'ESISTENTE') return !!this.firLocaleSelezionato
    return false
  }

  confermaAggancio(): void {
    const formulario = this.formularioSelezionato()
    if (!formulario || !this.puoConfermareAggancio()) return

    const scelta: ModalitaAggancio =
      this.modalitaScelta === 'ESISTENTE'
        ? { modalita: 'ESISTENTE', firId: this.firLocaleSelezionato! }
        : { modalita: 'NUOVO' }

    this.agganciando.set(formulario.numeroFir)
    this.rentriFormulariService
      .aggancia(formulario.numeroFir, scelta, {
        visibilitaGiaAcquisita: formulario.visibilitaGiaAcquisita,
      })
      .subscribe({
        next: () => {
          this.agganciando.set(null)
          this.toast.success(`Formulario ${formulario.numeroFir} agganciato`)
          this.chiudiDialog()
          this.cerca()
        },
        error: err => {
          this.agganciando.set(null)
          this.toast.error(this.extractError(err, "Errore nell'aggancio del formulario"))
        },
      })
  }

  private extractError(err: unknown, fallback: string): string {
    const message = (err as { error?: { message?: string | string[] } })?.error?.message
    if (Array.isArray(message)) return message.join(', ')
    return message || fallback
  }
}
