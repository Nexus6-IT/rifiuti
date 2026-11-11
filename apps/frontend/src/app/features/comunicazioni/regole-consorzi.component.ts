import { Component, Input, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { forkJoin } from 'rxjs'
import { CausaliRegistroService } from '../registro/causali-registro.service'
import { ToastService } from '../../core/services/toast.service'
import { leggiErroriAzione } from '../listino/errori-azione'
import {
  CONSORZI,
  Consorzio,
  InputRegolaConsorzio,
  RegolaConsorzio,
  VersoRegola,
  descriviRegola,
  etichettaConsorzio,
} from './consorzi.model'
import { ConsorziService } from './consorzi.service'

interface SedeScelta {
  id: string
  denominazione: string
}

interface FormRegola {
  id: string | null
  consorzio: Consorzio
  cer: string
  verso: VersoRegola | null
  causaleCodice: string | null
  attiva: boolean
  validaDal: string
}

/** Giorno di calendario locale (non UTC: fra mezzanotte e le 2 `toISOString` darebbe il giorno prima). */
const oggi = (): string => {
  const d = new Date()
  const due = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`
}

/** Data di inizio validita' delle regole di sistema e di quelle create senza data: «da sempre». */
const DA_SEMPRE = '1970-01-01'

interface OpzioneCausale {
  codice: string | null
  etichetta: string
}

/**
 * Marcatura per consorzio (4.9b, T12): regole per azienda su CER, verso e causale, regole di
 * sistema (sola lettura) ed estratto CSV per consorzio e periodo. La modifica e' di SUPER_ADMIN e
 * ADMIN (il backend lo impone e lo dice con `puoModificare`); la lettura e l'estratto sono per tutti.
 */
@Component({
  selector: 'app-regole-consorzi',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
    TableModule,
    TagModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <p-confirmDialog key="regole-consorzi"></p-confirmDialog>

    <section class="surface-card mb-4" data-testid="regole-consorzi">
      <div class="flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h2 class="section-title m-0">Consorzi: regole di marcatura</h2>
        <p-button
          *ngIf="puoModificare()"
          label="Nuova regola"
          icon="pi pi-plus"
          (onClick)="nuova()"
          data-testid="regole-nuova"
        ></p-button>
      </div>
      <p class="text-secondary mt-0">
        Un movimento è del consorzio se una regola lo prende (CER, carico o scarico, causale).
        Finché non ne definisci per un consorzio valgono quelle di sistema. Alla tua prima regola
        per un consorzio le regole di sistema vengono copiate fra le tue: le vedi qui e puoi
        cambiarle, disattivarle o eliminarle una per una. Puoi correggere il singolo movimento dal
        dettaglio del registro.
      </p>

      <p *ngIf="errore()" role="alert" data-testid="regole-errore">{{ errore() }}</p>

      <div class="table-card">
        <p-table
          [value]="regole()"
          styleClass="p-datatable-sm"
          aria-label="Regole di marcatura per consorzio"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Consorzio</th>
              <th scope="col">Regola</th>
              <th scope="col">Valida dal</th>
              <th scope="col">Stato</th>
              <th scope="col" class="azioni-col" *ngIf="puoModificare()">
                <span class="sr-only">Azioni</span>
              </th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-r>
            <tr data-testid="regole-riga" [class.text-secondary]="!r.inVigore || !r.attiva">
              <td>{{ nome(r.consorzio) }}</td>
              <td>{{ descrivi(r) }}</td>
              <td>
                <ng-container *ngIf="r.validaDal === daSempre; else conData"
                  >da sempre</ng-container
                >
                <ng-template #conData>{{ r.validaDal | date: 'dd/MM/yyyy' }}</ng-template>
              </td>
              <td>
                <p-tag *ngIf="r.sistema && r.inVigore" value="Di sistema" severity="info"></p-tag>
                <p-tag
                  *ngIf="r.sistema && !r.inVigore"
                  value="Sostituita dalle tue regole"
                  severity="secondary"
                ></p-tag>
                <p-tag
                  *ngIf="!r.sistema"
                  [value]="r.attiva ? 'Attiva' : 'Disattiva'"
                  [severity]="r.attiva ? 'success' : 'warning'"
                ></p-tag>
              </td>
              <td class="azioni-col" *ngIf="puoModificare()">
                <ng-container *ngIf="!r.sistema">
                  <p-button
                    label="Modifica"
                    icon="pi pi-pencil"
                    [text]="true"
                    (onClick)="modifica(r)"
                    data-testid="regole-modifica"
                  ></p-button>
                  <p-button
                    label="Elimina"
                    icon="pi pi-trash"
                    [text]="true"
                    severity="danger"
                    (onClick)="confermaElimina(r)"
                    data-testid="regole-elimina"
                  ></p-button>
                </ng-container>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <h3 class="section-title mt-4">Estratto per consorzio</h3>
      <div class="flex flex-wrap gap-3 align-items-end" data-testid="estratto-consorzio">
        <div class="flex flex-column gap-1">
          <label for="est-consorzio">Consorzio</label>
          <p-dropdown
            inputId="est-consorzio"
            [options]="consorzi"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="estrattoConsorzio"
          ></p-dropdown>
        </div>
        <div class="flex flex-column gap-1">
          <label for="est-da">Dal</label>
          <input
            id="est-da"
            type="date"
            pInputText
            [(ngModel)]="estrattoDa"
            data-testid="estratto-da"
          />
        </div>
        <div class="flex flex-column gap-1">
          <label for="est-a">Al</label>
          <input
            id="est-a"
            type="date"
            pInputText
            [(ngModel)]="estrattoA"
            data-testid="estratto-a"
          />
        </div>
        <div class="flex flex-column gap-1" *ngIf="sedi.length > 1">
          <label for="est-sede">Sede</label>
          <p-dropdown
            inputId="est-sede"
            [options]="sedi"
            optionLabel="denominazione"
            optionValue="id"
            [(ngModel)]="estrattoSede"
            [showClear]="true"
            placeholder="Tutte le sedi"
          ></p-dropdown>
        </div>
        <p-button
          label="Scarica estratto CSV"
          icon="pi pi-download"
          [disabled]="!estrattoValido() || scaricando()"
          [loading]="scaricando()"
          (onClick)="scarica()"
          data-testid="estratto-scarica"
        ></p-button>
      </div>
    </section>

    <p-dialog
      [visible]="form() !== null"
      (visibleChange)="$event ? null : chiudi()"
      [modal]="true"
      [header]="form()?.id ? 'Modifica regola' : 'Nuova regola'"
      [style]="{ width: '34rem', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi"
    >
      <form
        *ngIf="form() as f"
        (ngSubmit)="salva()"
        class="flex flex-column gap-3"
        data-testid="regola-form"
      >
        <p *ngIf="erroriForm().length > 0" role="alert" data-testid="regola-errori">
          <span *ngFor="let m of erroriForm()">{{ m }}<br /></span>
        </p>
        <div class="flex flex-column gap-1">
          <label for="reg-consorzio">Consorzio</label>
          <p-dropdown
            inputId="reg-consorzio"
            [options]="consorzi"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="f.consorzio"
            name="consorzio"
            appendTo="body"
            [disabled]="f.id !== null"
            data-testid="regola-consorzio"
          ></p-dropdown>
          <small *ngIf="f.id !== null" class="text-secondary"
            >Il consorzio di una regola non si cambia: elimina la regola e creane un'altra.</small
          >
        </div>
        <div class="flex flex-column gap-1">
          <label for="reg-cer">CER</label>
          <input
            id="reg-cer"
            pInputText
            [(ngModel)]="f.cer"
            name="cer"
            placeholder="13, 16 06 oppure 16 06 01"
            data-testid="regola-cer"
          />
          <small class="text-secondary"
            >2 cifre = capitolo, 4 cifre = sottocapitolo, 6 cifre = codice esatto.</small
          >
        </div>
        <div class="flex flex-column gap-1">
          <label for="reg-verso">Verso</label>
          <p-dropdown
            inputId="reg-verso"
            [options]="versi"
            optionLabel="label"
            optionValue="value"
            [(ngModel)]="f.verso"
            name="verso"
            appendTo="body"
          ></p-dropdown>
        </div>
        <div class="flex flex-column gap-1">
          <label for="reg-causale">Causale (facoltativa)</label>
          <p-dropdown
            inputId="reg-causale"
            [options]="causali()"
            optionLabel="etichetta"
            optionValue="codice"
            [(ngModel)]="f.causaleCodice"
            name="causale"
            [showClear]="true"
            placeholder="Qualsiasi causale"
            appendTo="body"
            data-testid="regola-causale"
          ></p-dropdown>
        </div>
        <div class="flex flex-column gap-1">
          <label for="reg-valida">Valida dal (facoltativa)</label>
          <input
            id="reg-valida"
            type="date"
            pInputText
            [(ngModel)]="f.validaDal"
            name="validaDal"
          />
          <small class="text-secondary"
            >Se lasci vuoto la regola vale da sempre, anche per i movimenti passati.</small
          >
        </div>
        <label class="flex align-items-center gap-2">
          <input type="checkbox" [(ngModel)]="f.attiva" name="attiva" data-testid="regola-attiva" />
          Regola attiva
        </label>
        <div class="flex justify-content-end gap-2">
          <p-button label="Annulla" [text]="true" (onClick)="chiudi()"></p-button>
          <p-button
            label="Salva"
            type="submit"
            [loading]="inCorso()"
            [disabled]="inCorso()"
            data-testid="regola-salva"
          ></p-button>
        </div>
      </form>
    </p-dialog>
  `,
})
export class RegoleConsorziComponent implements OnInit {
  private readonly servizio = inject(ConsorziService)
  private readonly toast = inject(ToastService)
  private readonly conferma = inject(ConfirmationService)
  private readonly causaliCatalogo = inject(CausaliRegistroService)

  /** Sedi attive, per limitare l'estratto a una sede. */
  @Input() sedi: SedeScelta[] = []

  readonly consorzi = [...CONSORZI]
  readonly versi: Array<{ value: VersoRegola | null; label: string }> = [
    { value: null, label: 'Carichi e scarichi' },
    { value: 'CARICO', label: 'Solo carichi' },
    { value: 'SCARICO', label: 'Solo scarichi' },
  ]

  readonly regole = signal<RegolaConsorzio[]>([])
  readonly puoModificare = signal(false)
  readonly errore = signal<string | null>(null)
  readonly form = signal<FormRegola | null>(null)
  readonly erroriForm = signal<string[]>([])
  readonly inCorso = signal(false)
  readonly scaricando = signal(false)
  /** Causali del catalogo (carichi e scarichi) fra cui scegliere; la prima voce e' «nessun filtro». */
  readonly causali = signal<OpzioneCausale[]>([])
  readonly daSempre = DA_SEMPRE

  estrattoConsorzio: Consorzio = 'CONOU'
  estrattoDa = `${new Date().getFullYear()}-01-01`
  estrattoA = oggi()
  estrattoSede: string | null = null

  readonly nome = etichettaConsorzio
  readonly descrivi = descriviRegola

  ngOnInit(): void {
    this.carica()
  }

  carica(): void {
    this.servizio.regole().subscribe({
      next: r => {
        this.regole.set(r.regole)
        this.puoModificare.set(r.puoModificare)
        this.errore.set(null)
      },
      error: () => this.errore.set('Impossibile caricare le regole dei consorzi.'),
    })
  }

  /** Carica le causali selezionabili oggi, per i due versi, senza doppioni. Un errore lascia l'elenco com'e'. */
  private caricaCausali(inUso: string | null): void {
    forkJoin([
      this.causaliCatalogo.opzioni('CARICO'),
      this.causaliCatalogo.opzioni('SCARICO'),
    ]).subscribe({
      next: ([carichi, scarichi]) => {
        const perCodice = new Map<string, OpzioneCausale>()
        for (const c of [...carichi, ...scarichi]) {
          if (!perCodice.has(c.codice)) {
            perCodice.set(c.codice, {
              codice: c.codice,
              etichetta: `${c.descrizione} (${c.codice})`,
            })
          }
        }
        // La causale gia' scelta resta selezionabile anche se oggi non e' piu' proponibile.
        if (inUso && !perCodice.has(inUso))
          perCodice.set(inUso, { codice: inUso, etichetta: inUso })
        this.causali.set(
          [...perCodice.values()].sort((a, b) => a.etichetta.localeCompare(b.etichetta))
        )
      },
      error: () => this.causali.set(inUso ? [{ codice: inUso, etichetta: inUso }] : []),
    })
  }

  nuova(): void {
    this.erroriForm.set([])
    this.caricaCausali(null)
    // Senza data la regola vale da sempre: «oggi» spegnerebbe le regole di sistema anche per il passato.
    this.form.set({
      id: null,
      consorzio: 'CONOU',
      cer: '',
      verso: null,
      causaleCodice: null,
      attiva: true,
      validaDal: '',
    })
  }

  modifica(r: RegolaConsorzio): void {
    if (r.sistema || !r.id) return
    this.erroriForm.set([])
    this.caricaCausali(r.causaleCodice)
    this.form.set({
      id: r.id,
      consorzio: r.consorzio,
      cer: r.cer,
      verso: r.verso,
      causaleCodice: r.causaleCodice,
      attiva: r.attiva,
      validaDal: r.validaDal === DA_SEMPRE ? '' : r.validaDal,
    })
  }

  chiudi(): void {
    this.form.set(null)
    this.erroriForm.set([])
  }

  salva(): void {
    const f = this.form()
    if (!f || this.inCorso()) return
    const cifre = f.cer.replace(/[^0-9]/g, '')
    if (![2, 4, 6].includes(cifre.length)) {
      this.erroriForm.set([
        'CER non valido: indica 2 o 4 cifre (capitolo o sottocapitolo) oppure le 6 cifre del codice.',
      ])
      return
    }
    const input: InputRegolaConsorzio = {
      consorzio: f.consorzio,
      cer: f.cer.trim(),
      verso: f.verso,
      causaleCodice: f.causaleCodice?.trim() || null,
      attiva: f.attiva,
      // Campo vuoto = da sempre, anche in modifica (altrimenti la vecchia data resterebbe).
      validaDal: f.validaDal || DA_SEMPRE,
    }
    this.inCorso.set(true)
    this.erroriForm.set([])
    const chiamata = f.id
      ? this.servizio.modificaRegola(f.id, input)
      : this.servizio.creaRegola(input)
    chiamata.subscribe({
      next: () => {
        this.inCorso.set(false)
        this.chiudi()
        this.toast.success('Regola salvata')
        this.carica()
      },
      error: err => {
        this.inCorso.set(false)
        this.erroriForm.set(leggiErroriAzione(err, 'Salvataggio non riuscito.').messaggi)
      },
    })
  }

  confermaElimina(r: RegolaConsorzio): void {
    if (!r.id) return
    this.conferma.confirm({
      key: 'regole-consorzi',
      header: 'Elimina la regola',
      message: `Eliminare la regola «${this.nome(r.consorzio)}, ${this.descrivi(r)}»? I movimenti già marcati non cambiano nei file generati. Se è l'ultima regola del consorzio tornano a valere quelle di sistema: per spegnere il consorzio disattiva la regola invece di eliminarla.`,
      acceptLabel: 'Elimina',
      rejectLabel: 'Annulla',
      defaultFocus: 'reject',
      accept: () => this.elimina(r.id as string),
    })
  }

  elimina(id: string): void {
    this.servizio.eliminaRegola(id).subscribe({
      next: () => {
        this.toast.success('Regola eliminata')
        this.carica()
      },
      error: () => this.toast.error('Eliminazione non riuscita.'),
    })
  }

  estrattoValido(): boolean {
    return !!this.estrattoDa && !!this.estrattoA && this.estrattoDa <= this.estrattoA
  }

  scarica(): void {
    if (!this.estrattoValido() || this.scaricando()) return
    this.scaricando.set(true)
    this.servizio
      .scaricaEstratto(
        this.estrattoConsorzio,
        this.estrattoDa,
        this.estrattoA,
        this.estrattoSede ?? undefined
      )
      .subscribe({
        next: f => {
          this.scaricando.set(false)
          const url = URL.createObjectURL(f.blob)
          const a = document.createElement('a')
          a.href = url
          a.download =
            f.nomeFile ?? `estratto-${this.estrattoConsorzio.toLowerCase()}-${this.estrattoDa}.csv`
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 60_000)
        },
        error: () => {
          this.scaricando.set(false)
          this.toast.error('Download non riuscito.')
        },
      })
  }
}
